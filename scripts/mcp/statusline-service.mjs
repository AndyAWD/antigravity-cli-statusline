import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrderAndStyles } from '../../skills/agy-cli-statusline/scripts/configure-statusline.mjs';
import { checkPluginHookSync } from '../../skills/agy-cli-statusline/scripts/diagnose-statusline.mjs';
import {
  DEFAULT_COMPACTION_THRESHOLD,
  GITHUB_LATEST_RELEASE_URL,
  STEP_UP_INTERMEDIATE_THRESHOLD
} from '../../skills/agy-cli-statusline/scripts/lib/core/constants.mjs';
import {
  readJsonSafeAsync,
  writeFileAndVerifyNoBOM
} from '../../skills/agy-cli-statusline/scripts/lib/core/fs-utils.mjs';
import {
  normalizeLanguage,
  sanitizeConversationId
} from '../../skills/agy-cli-statusline/scripts/lib/core/normalize.mjs';
import { resolveInstalledPluginVersionAsync } from '../../skills/agy-cli-statusline/scripts/lib/core/plugin-manifest.mjs';
import { isVersionBehind } from '../../skills/agy-cli-statusline/scripts/lib/core/semver.mjs';
import { getSettingsAsync } from '../../skills/agy-cli-statusline/scripts/lib/core/settings.mjs';
import {
  computeSteppedCeiling,
  extractModelCandidateKeys,
  resolveCatalogEntry
} from '../../skills/agy-cli-statusline/scripts/lib/collectors/context.mjs';
import { fetchLatestPluginReleaseAsync } from '../../skills/agy-cli-statusline/scripts/lib/collectors/plugin-update.mjs';
import { extractMetricsAsync } from '../../skills/agy-cli-statusline/scripts/lib/collectors/probes.mjs';
import {
  resolveArgonQuota,
  resolveModelQuota,
  resolveWeeklyQuota
} from '../../skills/agy-cli-statusline/scripts/lib/collectors/quota.mjs';
import { buildI18nDict } from '../../skills/agy-cli-statusline/scripts/lib/metrics/i18n.mjs';
import {
  ADJACENT_PAIRS,
  ALL_STANDARD_METRIC_IDS,
  EMOJI_MAP,
  METRIC_CATEGORIES,
  METRICS,
  SUPPORTED_LOCALES
} from '../../skills/agy-cli-statusline/scripts/lib/metrics/registry.mjs';
import { parseMetricRenderPayload } from './ansi-segments.mjs';
import {
  formatOrderExpressions,
  saveCliSettingsAtomicSync,
  validateCliLayoutInput
} from './cli-settings-bridge.mjs';
import { collectLsTelemetryAsync } from './ls-telemetry.mjs';
import {
  countArtifactsInDirAsync,
  discoverRecentBrainSessionsAsync,
  readTranscriptSummaryAsync
} from './transcript-reader.mjs';

const DEFAULT_APP_ITEMS = [
  'model-name',
  'quota',
  'quota-bar',
  'quota-reset-countdown',
  'n',
  'context-used',
  'context-used-bar',
  'token-count',
  'n',
  'git-branch',
  'vcs-dirty',
  'agent-state'
];

const UPDATE_CACHE_TTL_MS = 60 * 60 * 1000;
const MEMORY_CACHE_TTL_MS = 15 * 1000;

function resolveDefaultPluginRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function maskEmailAddress(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return email || '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0] || '*'}*@${domain}`;
  return `${local.slice(0, 2)}${'*'.repeat(Math.min(5, local.length - 2))}@${domain}`;
}

function computePureContextInfo({ runtimeTelemetry, cache, fallbackModel, meta }) {
  const modelKeys = extractModelCandidateKeys(meta, fallbackModel);
  const catalogEntry = resolveCatalogEntry(modelKeys, cache?.modelLimits);
  const contextSize = (catalogEntry?.maxTokens > 0) ? catalogEntry.maxTokens : 1048576;

  const totalInput = runtimeTelemetry?.estimatedTokensUsed > 0
    ? runtimeTelemetry.estimatedTokensUsed
    : (runtimeTelemetry?.usage?.inputTokens || 0);

  let effectiveTokenCeiling = DEFAULT_COMPACTION_THRESHOLD;
  if (runtimeTelemetry?.maxContextTokens > 0) {
    effectiveTokenCeiling = computeSteppedCeiling(
      totalInput,
      contextSize,
      Math.min(contextSize, runtimeTelemetry.maxContextTokens)
    );
  } else if (catalogEntry?.limit > 0) {
    effectiveTokenCeiling = computeSteppedCeiling(
      totalInput,
      contextSize,
      Math.min(contextSize, catalogEntry.limit)
    );
  } else {
    const base = Math.min(contextSize, DEFAULT_COMPACTION_THRESHOLD);
    effectiveTokenCeiling = totalInput > base && contextSize >= STEP_UP_INTERMEDIATE_THRESHOLD
      ? computeSteppedCeiling(totalInput, contextSize, base)
      : base;
  }

  const usedPctNum = effectiveTokenCeiling > 0
    ? Math.min(100, Math.max(0, (totalInput / effectiveTokenCeiling) * 100))
    : 0;

  return { totalInput, contextSize, effectiveTokenCeiling, usedPctNum };
}

export class StatuslineService {
  constructor(options = {}) {
    this.homeDir = options.homeDir || os.homedir();
    this.pluginRootDir = options.pluginRootDir || resolveDefaultPluginRoot();
    this.pluginDataDir = options.pluginDataDir ||
      (typeof process.env.PLUGIN_DATA === 'string' && process.env.PLUGIN_DATA.trim()) ||
      path.join(this.homeDir, '.gemini', 'plugin-data', 'antigravity-cli-statusline');
    this.collectLsTelemetryFn = options.collectLsTelemetryFn || collectLsTelemetryAsync;
    this.fetchReleaseFn = options.fetchReleaseFn || fetchLatestPluginReleaseAsync;
    this.execFn = options.execFn;
    this._memoryCache = { at: 0, value: 0 };
  }

  async _readPanelPreferencesAsync() {
    const p = path.join(this.pluginDataDir, 'panel-preferences.json');
    const saved = await readJsonSafeAsync(p);
    return {
      version: 1,
      hasCustomLayout: Boolean(saved?.hasCustomLayout),
      layout: saved?.layout || null,
      viewDensity: saved?.viewDensity === 'strip' ? 'strip' : 'cards',
      autoRefreshSec: [0, 5, 15, 30].includes(Number(saved?.autoRefreshSec)) ? Number(saved.autoRefreshSec) : 5,
      maskEmail: Boolean(saved?.maskEmail)
    };
  }

  async _writePanelPreferencesAsync(prefs) {
    const p = path.join(this.pluginDataDir, 'panel-preferences.json');
    await writeFileAndVerifyNoBOM(p, JSON.stringify(prefs, null, 2));
  }

  async _resolveUpdateInfoAsync({ installedVersion, forceCheck = false }) {
    const cachePath = path.join(this.pluginDataDir, 'update_cache.json');
    const cached = await readJsonSafeAsync(cachePath);
    const now = Date.now();
    let latestVersion = cached?.latestVersion || '';
    let latestTag = cached?.latestTag || '';
    let checkedAt = Number(cached?.checkedAt || 0);

    if (forceCheck || !checkedAt || (now - checkedAt) > UPDATE_CACHE_TTL_MS) {
      const res = await this.fetchReleaseFn(GITHUB_LATEST_RELEASE_URL, 1500).catch(() => ({ ok: false }));
      if (res?.ok && res.latestVersion) {
        latestVersion = res.latestVersion;
        latestTag = res.latestTag || `v${res.latestVersion}`;
        checkedAt = now;
        try {
          await writeFileAndVerifyNoBOM(cachePath, JSON.stringify({ latestVersion, latestTag, checkedAt }, null, 2));
        } catch (_) {}
      }
    }

    const updateAvailable = Boolean(installedVersion && latestVersion && isVersionBehind(installedVersion, latestVersion));
    return {
      installedVersion,
      installedTag: installedVersion ? `v${installedVersion}` : '',
      latestVersion,
      latestTag,
      updateAvailable,
      releaseUrl: GITHUB_LATEST_RELEASE_URL,
      checkedAt
    };
  }

  async getDashboardSnapshot({
    conversationId = '',
    metaConversationId = '',
    forceRefresh = false,
    checkUpdate = false,
    hostLocale = ''
  } = {}) {
    const [panelPrefs, hookSessionsData, brainSessions, installedPlugin] = await Promise.all([
      this._readPanelPreferencesAsync(),
      readJsonSafeAsync(path.join(this.pluginDataDir, 'sessions.json')),
      discoverRecentBrainSessionsAsync(this.homeDir, 15),
      resolveInstalledPluginVersionAsync({ pluginDir: this.pluginRootDir, homeDir: this.homeDir })
    ]);

    // 合併 Hook 對話與磁碟 brain/ 掃描對話
    const sessionMap = new Map();
    for (const bs of brainSessions) {
      sessionMap.set(bs.conversationId, {
        conversationId: bs.conversationId,
        workspacePaths: [],
        cwd: '',
        transcriptPath: bs.transcriptPath,
        artifactDirectoryPath: bs.artifactDirectoryPath,
        modelName: '',
        agentState: 'idle',
        lastHookEvent: '',
        lastHookAt: '',
        updatedAt: bs.updatedAt,
        source: 'brain'
      });
    }
    const hookMap = (hookSessionsData?.sessions && typeof hookSessionsData.sessions === 'object')
      ? hookSessionsData.sessions
      : {};
    for (const [id, hs] of Object.entries(hookMap)) {
      if (!hs || typeof hs !== 'object') continue;
      const prev = sessionMap.get(id) || {};
      sessionMap.set(id, { ...prev, ...hs, conversationId: id, source: 'hook' });
    }

    const sessions = [...sessionMap.values()]
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, 15);

    const requestedId = sanitizeConversationId(conversationId) ||
      sanitizeConversationId(metaConversationId) ||
      sanitizeConversationId(hookSessionsData?.latestConversationId || '') ||
      (sessions[0]?.conversationId || '');

    const activeSession = sessionMap.get(requestedId) || sessions[0] || {
      conversationId: requestedId,
      workspacePaths: [],
      cwd: '',
      transcriptPath: '',
      artifactDirectoryPath: '',
      modelName: '',
      agentState: 'idle',
      lastHookEvent: '',
      lastHookAt: '',
      updatedAt: 0
    };

    // 無工作區防洩漏（不退回 process.cwd() / PLUGIN_ROOT）
    const rawWorkspace = (Array.isArray(activeSession.workspacePaths) && activeSession.workspacePaths[0]) ||
      activeSession.cwd || '';
    const resolvedRoot = path.resolve(this.pluginRootDir);
    const hasWorkspace = Boolean(rawWorkspace && path.resolve(rawWorkspace) !== resolvedRoot);
    const projectPath = hasWorkspace ? rawWorkspace : '';
    const settingsSentinelDir = path.join(this.homeDir, '.gemini', '__no_workspace_sentinel__');
    const cliSettings = await getSettingsAsync(
      { cwd: hasWorkspace ? projectPath : settingsSentinelDir },
      { homeDir: this.homeDir }
    );

    // 決定有效排版與語系（首次智慧繼承 CLI settings.json，嚴格遵守 CLI R27 itemStyles 語意）
    const cliHasFooter = Array.isArray(cliSettings?.ui?.footer?.items) && cliSettings.ui.footer.items.length > 0;
    const rawCliItemStyles = cliSettings?.ui?.footer?.itemStyles;
    const cliHasSparseItemStyles = Boolean(rawCliItemStyles && typeof rawCliItemStyles === 'object' && !Array.isArray(rawCliItemStyles));
    const inheritedLabelStyle = cliHasSparseItemStyles
      ? 'text'
      : (cliSettings?.ui?.footer?.labelStyle || 'text');
    const cliLayout = validateCliLayoutInput({
      lang: cliSettings?.ui?.language || normalizeLanguage(hostLocale || 'zh-tw'),
      items: cliHasFooter ? cliSettings.ui.footer.items : DEFAULT_APP_ITEMS,
      itemStyles: cliHasSparseItemStyles ? rawCliItemStyles : {},
      labelStyle: inheritedLabelStyle,
      timeFormat: cliSettings?.ui?.footer?.timeFormat || 'smart',
      barLength: cliSettings?.ui?.footer?.barLength || 10
    });

    const activeLayout = (panelPrefs.hasCustomLayout && panelPrefs.layout)
      ? validateCliLayoutInput(panelPrefs.layout)
      : cliLayout;

    // 採集本機 LS 遙測、Transcript 摘要與 Artifacts 數量
    const [lsResult, transcriptSummary, artifactsCount, updateInfo] = await Promise.all([
      this.collectLsTelemetryFn({
        homeDir: this.homeDir,
        pluginDataDir: this.pluginDataDir,
        conversationId: activeSession.conversationId || ''
      }),
      readTranscriptSummaryAsync(activeSession.transcriptPath),
      countArtifactsInDirAsync(activeSession.artifactDirectoryPath),
      this._resolveUpdateInfoAsync({ installedVersion: installedPlugin.version, forceCheck: checkUpdate })
    ]);

    const { cache, runtimeTelemetry, telemetryStatus } = lsResult;
    const fallbackModel = runtimeTelemetry?.modelDisplayName ||
      activeSession.modelName ||
      'Gemini';

    const derivedState = activeSession.lastHookEvent === 'Stop'
      ? activeSession.agentState
      : (transcriptSummary.exists ? transcriptSummary.derivedAgentState : (activeSession.agentState || 'idle'));

    const meta = {
      conversation_id: activeSession.conversationId || '',
      model: {
        id: runtimeTelemetry?.model || fallbackModel,
        display_name: fallbackModel
      },
      agent_state: derivedState,
      artifact_count: artifactsCount,
      ...(hasWorkspace ? { cwd: projectPath, project: { path: projectPath } } : {})
    };

    const quotaInfo = resolveModelQuota(fallbackModel, cache, meta);
    const weeklyInfo = resolveWeeklyQuota(fallbackModel, cache, meta);
    const argonInfo = resolveArgonQuota(cache);
    const contextInfo = computePureContextInfo({ runtimeTelemetry, cache, fallbackModel, meta });

    // 控制只對啟用中指標做昂貴探針（避免無工作區誤掃、避免 Windows 頻繁開 PowerShell）
    const activeItemsSet = new Set(activeLayout.items.filter(x => x !== 'n'));
    if (!hasWorkspace) {
      activeItemsSet.delete('git-branch');
      activeItemsSet.delete('vcs-dirty');
      activeItemsSet.delete('subagents');
    }

    const nowMs = Date.now();
    const skipFreshMemory = !forceRefresh && activeItemsSet.has('memory-usage') && (nowMs - this._memoryCache.at) < MEMORY_CACHE_TTL_MS;
    const probeItemsSet = new Set(activeItemsSet);
    if (skipFreshMemory) probeItemsSet.delete('memory-usage');

    const metrics = await extractMetricsAsync(
      meta,
      activeLayout.lang,
      fallbackModel,
      cache,
      { email: cache?.email || '', planTier: cache?.planTier || '' },
      quotaInfo,
      contextInfo,
      weeklyInfo,
      {
        timeFormat: activeLayout.timeFormat,
        barLength: activeLayout.barLength,
        argonInfo,
        footerItems: probeItemsSet,
        workspacePath: projectPath,
        pluginVersion: installedPlugin.tag || `v${installedPlugin.version}`,
        pluginUpdateAvailable: updateInfo.updateAvailable,
        pluginUpdateCurrentTag: updateInfo.installedTag,
        pluginUpdateLatestTag: updateInfo.latestTag,
        ...(this.execFn ? { execFn: this.execFn } : {})
      }
    );

    if (activeItemsSet.has('memory-usage')) {
      if (skipFreshMemory) {
        metrics.rssMem = this._memoryCache.value;
        metrics.memUsage = `${this._memoryCache.value}MB`;
      } else {
        this._memoryCache = { at: nowMs, value: metrics.rssMem };
      }
    }

    if (!hasWorkspace) {
      const noneStr = activeLayout.lang === 'zh-tw'
        ? '無'
        : (activeLayout.lang === 'zh-cn' ? '无' : (activeLayout.lang === 'jp' ? 'なし' : 'N/A'));
      metrics.projectName = noneStr;
      metrics.projectFullPath = noneStr;
    }

    if (panelPrefs.maskEmail && metrics.accountEmail) {
      metrics.accountEmail = maskEmailAddress(metrics.accountEmail);
    }

    const textDict = buildI18nDict(activeLayout.lang, metrics, 'text');
    const emojiDict = buildI18nDict(activeLayout.lang, metrics, 'emoji');

    const renderedItems = { text: {}, emoji: {} };
    for (const key of Object.keys(textDict)) {
      renderedItems.text[key] = parseMetricRenderPayload(textDict[key]);
      renderedItems.emoji[key] = parseMetricRenderPayload(emojiDict[key]);
    }

    const hookSync = checkPluginHookSync({
      home: this.homeDir,
      currentPluginDir: this.pluginRootDir,
      workspacePath: projectPath
    });

    const snapshot = {
      layout: activeLayout,
      cliLayout,
      hasCustomLayout: panelPrefs.hasCustomLayout,
      panelPrefs: {
        viewDensity: panelPrefs.viewDensity,
        autoRefreshSec: panelPrefs.autoRefreshSec,
        maskEmail: panelPrefs.maskEmail
      },
      session: {
        conversationId: activeSession.conversationId || '',
        hasWorkspace,
        projectPath,
        agentState: derivedState,
        lastHookEvent: activeSession.lastHookEvent || '',
        lastHookAt: activeSession.lastHookAt || '',
        stepCount: transcriptSummary.stepCount,
        lastToolName: transcriptSummary.lastToolName,
        lastToolSummary: transcriptSummary.lastToolSummary,
        lastError: transcriptSummary.lastError
      },
      sessions: sessions.map(s => ({
        conversationId: s.conversationId,
        workspacePath: (Array.isArray(s.workspacePaths) && s.workspacePaths[0]) || s.cwd || '',
        modelName: s.modelName || '',
        agentState: s.agentState || 'idle',
        updatedAt: s.updatedAt || 0
      })),
      telemetryStatus,
      quotas: {
        shortTerm: {
          remainingPct: Math.round(quotaInfo.remaining_percentage ?? 100),
          resetTime: quotaInfo.reset_time || '',
          refreshesIn: quotaInfo.refreshes_in || ''
        },
        weekly: {
          remainingPct: Math.round(weeklyInfo.remaining_percentage ?? 100),
          resetTime: weeklyInfo.reset_time || '',
          refreshesIn: weeklyInfo.refreshes_in || ''
        },
        argon: {
          remainingPct: Math.round(argonInfo.remaining_percentage ?? 100),
          resetTime: argonInfo.reset_time || '',
          refreshesIn: argonInfo.refreshes_in || ''
        }
      },
      context: {
        usedPct: Number(contextInfo.usedPctNum.toFixed(1)),
        totalInput: contextInfo.totalInput,
        effectiveCeiling: contextInfo.effectiveTokenCeiling,
        contextSize: contextInfo.contextSize,
        usage: runtimeTelemetry?.usage || null,
        tokenBreakdown: runtimeTelemetry?.tokenBreakdown || []
      },
      renderedItems,
      updateInfo,
      hookSync: {
        status: hookSync.status,
        pluginVersion: hookSync.pluginVersion,
        hookVersion: hookSync.hookVersion
      },
      registry: {
        supportedLocales: SUPPORTED_LOCALES,
        categories: METRIC_CATEGORIES,
        metrics: METRICS,
        adjacentPairs: ADJACENT_PAIRS,
        emojiMap: EMOJI_MAP
      },
      orderExpressions: formatOrderExpressions(activeLayout.items, activeLayout.itemStyles, activeLayout.labelStyle)
    };

    return {
      snapshot,
      plainText: this.formatPlainTextSummary(snapshot)
    };
  }

  formatPlainTextSummary(snapshot) {
    const s = snapshot.session;
    const q = snapshot.quotas;
    const c = snapshot.context;
    const model = snapshot.renderedItems?.text?.['model-name']?.valueText || 'Unknown';
    const branch = snapshot.renderedItems?.text?.['git-branch']?.valueText || 'N/A';
    return [
      `Model: ${model}`,
      `Quota (5h / 7d / Argon): ${q.shortTerm.remainingPct}% / ${q.weekly.remainingPct}% / ${q.argon.remainingPct}%`,
      `Context: ${c.usedPct}% (${c.totalInput} / ${c.effectiveCeiling})`,
      `Workspace: ${s.hasWorkspace ? s.projectPath : 'None'} (Git: ${branch})`,
      `Agent State: ${s.agentState} | Steps: ${s.stepCount} | Plugin: v${snapshot.updateInfo.installedVersion}`,
      `Telemetry Source: ${snapshot.telemetryStatus.source}`
    ].join('\n');
  }

  async saveConfig({
    action = 'save-panel',
    layout = null,
    panelPrefs = null,
    deployHooks = false,
    orderExpression = '',
    workspacePath = ''
  } = {}) {
    if (action === 'parse-order-expression') {
      const parsed = parseOrderAndStyles(String(orderExpression || ''), ALL_STANDARD_METRIC_IDS);
      return {
        parsed,
        orderExpressions: formatOrderExpressions(parsed.items, parsed.itemStyles, 'text')
      };
    }

    const currentPrefs = await this._readPanelPreferencesAsync();
    const nextPrefs = { ...currentPrefs };
    if (panelPrefs && typeof panelPrefs === 'object') {
      if (panelPrefs.viewDensity === 'strip' || panelPrefs.viewDensity === 'cards') {
        nextPrefs.viewDensity = panelPrefs.viewDensity;
      }
      if ([0, 5, 15, 30].includes(Number(panelPrefs.autoRefreshSec))) {
        nextPrefs.autoRefreshSec = Number(panelPrefs.autoRefreshSec);
      }
      if (typeof panelPrefs.maskEmail === 'boolean') {
        nextPrefs.maskEmail = panelPrefs.maskEmail;
      }
    }

    if (action === 'reset-from-cli') {
      nextPrefs.hasCustomLayout = false;
      nextPrefs.layout = null;
      await this._writePanelPreferencesAsync(nextPrefs);
      return { ok: true, action };
    }

    if (action === 'save-prefs') {
      await this._writePanelPreferencesAsync(nextPrefs);
      return { ok: true, action };
    }

    const validatedLayout = validateCliLayoutInput(layout || nextPrefs.layout || {});
    nextPrefs.hasCustomLayout = true;
    nextPrefs.layout = validatedLayout;
    await this._writePanelPreferencesAsync(nextPrefs);

    let cliSyncResult = null;
    if (action === 'save-both') {
      cliSyncResult = saveCliSettingsAtomicSync({
        homeDir: this.homeDir,
        pluginRootDir: this.pluginRootDir,
        workspacePath,
        config: validatedLayout,
        deployHooks: Boolean(deployHooks)
      });
    }

    return {
      ok: true,
      action,
      layout: validatedLayout,
      orderExpressions: formatOrderExpressions(validatedLayout.items, validatedLayout.itemStyles),
      cliSyncResult
    };
  }
}
