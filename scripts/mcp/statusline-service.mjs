import { promises as fsPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrderAndStyles } from '../../skills/agy-cli-statusline/scripts/configure-statusline.mjs';
import { checkPluginHookSync } from '../../skills/agy-cli-statusline/scripts/diagnose-statusline.mjs';
import {
  GITHUB_LATEST_RELEASE_URL
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
import { compareSemver } from '../../skills/agy-cli-statusline/scripts/lib/core/semver.mjs';
import { getSettingsAsync } from '../../skills/agy-cli-statusline/scripts/lib/core/settings.mjs';
import {
  extractModelCandidateKeys,
  resolveCatalogEntry,
  resolveContextMetricsPure
} from '../../skills/agy-cli-statusline/scripts/lib/collectors/context.mjs';
import {
  fetchLatestPluginReleaseAsync,
  resolvePluginUpdateByTtlAsync
} from '../../skills/agy-cli-statusline/scripts/lib/collectors/plugin-update.mjs';
import { extractMetricsAsync } from '../../skills/agy-cli-statusline/scripts/lib/collectors/probes.mjs';
import {
  isOrchestratorModelName,
  readAppSelectedModelAsync,
  resolveOrchestratorWrapperDisplayName
} from '../../skills/agy-cli-statusline/scripts/lib/collectors/runtime-model.mjs';
import {
  resolveInstalledAppVersionAsync,
  resolveInstalledCliVersionAsync
} from '../../skills/agy-cli-statusline/scripts/lib/collectors/versions.mjs';
import {
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
const VERSION_CACHE_TTL_MS = 60 * 1000;

/**
 * 判斷本機既有的 CLI 掛鉤腳本是否過舊或內容不同步，應於「同步套用至 2.0 ＋ CLI」時自動更新。
 * 僅處理已存在之掛鉤（排除 hook_missing 與 plugin_not_found），且當掛鉤版本新於外掛時不降級覆寫。
 * @param {{ status?: string, hookVersion?: string, pluginVersion?: string } | null | undefined} hookSync
 * @returns {boolean}
 */
export function isOutdatedCliHookSync(hookSync) {
  if (!hookSync || typeof hookSync !== 'object') return false;
  const { status, hookVersion, pluginVersion } = hookSync;
  if (status === 'content_mismatch' || status === 'legacy_mismatch' || status === 'legacy_no_meta') {
    return true;
  }
  if (status === 'version_mismatch') {
    if (hookVersion && pluginVersion) {
      const cmp = compareSemver(hookVersion, pluginVersion);
      if (cmp !== null) return cmp < 0;
    }
    return true;
  }
  return false;
}

function resolveDefaultPluginRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function maskEmailAddress(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return email || '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0] || '*'}*@${domain}`;
  return `${local.slice(0, 2)}${'*'.repeat(Math.min(5, local.length - 2))}@${domain}`;
}

function inferProductFromPath(transcriptPath = '', artifactDir = '') {
  const combined = `${transcriptPath}\n${artifactDir}`.replace(/\\/g, '/').toLowerCase();
  if (combined.includes('/.gemini/antigravity-cli/')) return 'antigravity-cli';
  if (combined.includes('/.gemini/antigravity-ide/')) return 'antigravity-ide';
  return 'antigravity';
}

async function pathExistsAsync(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function computePureContextInfoAsync({
  runtimeTelemetry,
  cache,
  fallbackModel,
  meta,
  cliSettings = {},
  conversationId = '',
  pluginDataDir = ''
}) {
  const modelKeys = extractModelCandidateKeys(meta, fallbackModel);
  const catalogEntry = resolveCatalogEntry(modelKeys, cache?.modelLimits);
  const telemetryCtxSize = Number(runtimeTelemetry?.contextWindowSize || 0) || 0;
  const contextSize = (catalogEntry?.maxTokens > 0)
    ? catalogEntry.maxTokens
    : (telemetryCtxSize > 0 ? telemetryCtxSize : 1048576);

  const usageObj = runtimeTelemetry?.usage;
  const usageTotalInput = usageObj
    ? (Number(usageObj.inputTokens || 0) || 0) + (Number(usageObj.cacheReadTokens || 0) || 0)
    : 0;
  const totalInput = Number(runtimeTelemetry?.estimatedTokensUsed || 0) > 0
    ? Number(runtimeTelemetry.estimatedTokensUsed)
    : usageTotalInput;

  const primaryModelKey = modelKeys[0] || '';
  const convStepKey = primaryModelKey || '_default';
  const stepStatePath = pluginDataDir ? path.join(pluginDataDir, 'context_step_state.json') : '';
  const stepState = stepStatePath ? ((await readJsonSafeAsync(stepStatePath)) || {}) : {};
  const convRemembered = Number(stepState?.conversations?.[conversationId]?.[convStepKey] || 0) || 0;
  const modelRemembered = primaryModelKey ? (Number(stepState?.modelCeilings?.[primaryModelKey] || 0) || 0) : 0;

  const resolved = resolveContextMetricsPure({
    totalInput,
    contextSize,
    settings: cliSettings,
    env: process.env,
    modelKeys,
    catalogEntry,
    runtimeMaxContextTokens: runtimeTelemetry?.maxContextTokens || 0,
    runtimeModelKeys: [
      runtimeTelemetry?.modelDisplayName,
      runtimeTelemetry?.model
    ],
    convRemembered,
    modelRemembered
  });

  if (stepStatePath && resolved.stepUpdate) {
    const { needConvSave, needModelSave, stepped, persistModelCeiling } = resolved.stepUpdate;
    try {
      const nextState = {
        version: 1,
        modelCeilings: { ...(stepState.modelCeilings || {}) },
        conversations: { ...(stepState.conversations || {}) }
      };
      if (needConvSave && conversationId) {
        nextState.conversations[conversationId] = {
          ...(nextState.conversations[conversationId] || {}),
          [convStepKey]: stepped,
          updatedAt: Date.now()
        };
      }
      if (needModelSave && primaryModelKey) {
        nextState.modelCeilings[primaryModelKey] = persistModelCeiling;
      }
      await writeFileAndVerifyNoBOM(stepStatePath, JSON.stringify(nextState, null, 2));
    } catch (_) {}
  }

  return {
    totalInput: resolved.totalInput,
    contextSize: resolved.contextSize,
    effectiveTokenCeiling: resolved.effectiveTokenCeiling,
    usedPctNum: resolved.usedPctNum,
    tokenPctNum: resolved.tokenPctNum
  };
}

export class StatuslineService {
  constructor(options = {}) {
    this.homeDir = options.homeDir || os.homedir();
    this.pluginRootDir = options.pluginRootDir || resolveDefaultPluginRoot();
    this.pluginDataDir = options.pluginDataDir ||
      (typeof process.env.PLUGIN_DATA === 'string' && process.env.PLUGIN_DATA.trim()) ||
      path.join(this.homeDir, '.gemini', 'antigravity', 'plugin_data', 'antigravity-cli-statusline');
    this.collectLsTelemetryFn = options.collectLsTelemetryFn || collectLsTelemetryAsync;
    this.fetchReleaseFn = options.fetchReleaseFn || fetchLatestPluginReleaseAsync;
    this.resolveCliVersionFn = options.resolveCliVersionFn || resolveInstalledCliVersionAsync;
    this.resolveAppVersionFn = options.resolveAppVersionFn || resolveInstalledAppVersionAsync;
    this.env = options.env;
    this.execFn = options.execFn;
    this._memoryCache = { at: 0, value: 0 };
    this._versionCache = { at: 0, cliVersion: '', appVersion: '' };
  }

  async _resolveInstalledVersionsAsync(forceRefresh = false) {
    const nowMs = Date.now();
    if (!forceRefresh && this._versionCache.at > 0 && (nowMs - this._versionCache.at) < VERSION_CACHE_TTL_MS) {
      return {
        cliVersion: this._versionCache.cliVersion,
        appVersion: this._versionCache.appVersion
      };
    }
    const probeOpts = {
      homeDir: this.homeDir,
      ...(this.env !== undefined ? { env: this.env } : {}),
      ...(this.execFn ? { execFn: this.execFn } : {})
    };
    const [cliRes, appRes] = await Promise.all([
      Promise.resolve(this.resolveCliVersionFn(probeOpts)).catch(() => ({ tag: '' })),
      Promise.resolve(this.resolveAppVersionFn(probeOpts)).catch(() => ({ tag: '' }))
    ]);
    const cliVersion = cliRes?.tag || '';
    const appVersion = appRes?.tag || '';
    this._versionCache = { at: nowMs, cliVersion, appVersion };
    return { cliVersion, appVersion };
  }

  async _readPanelPreferencesAsync() {
    const p = path.join(this.pluginDataDir, 'panel-preferences.json');
    const saved = await readJsonSafeAsync(p);
    return {
      version: 1,
      hasCustomLayout: Boolean(saved?.hasCustomLayout),
      layout: saved?.layout || null,
      viewDensity: saved?.viewDensity === 'strip' ? 'strip' : 'cards',
      autoRefreshSec: [0, 5, 15, 30].includes(Number(saved?.autoRefreshSec)) ? Number(saved.autoRefreshSec) : 15,
      maskEmail: Boolean(saved?.maskEmail)
    };
  }

  async _writePanelPreferencesAsync(prefs) {
    const p = path.join(this.pluginDataDir, 'panel-preferences.json');
    await writeFileAndVerifyNoBOM(p, JSON.stringify(prefs, null, 2));
  }

  async _resolveUpdateInfoAsync({ installedVersion, forceCheck = false }) {
    return resolvePluginUpdateByTtlAsync({
      installedVersion,
      homeDir: this.homeDir,
      pluginDataDir: this.pluginDataDir,
      cachePath: path.join(this.pluginDataDir, 'update_cache.json'),
      ttlMs: UPDATE_CACHE_TTL_MS,
      forceCheck,
      releaseUrl: GITHUB_LATEST_RELEASE_URL,
      timeoutMs: 1500,
      fetchReleaseFn: this.fetchReleaseFn
    });
  }

  async getDashboardSnapshot({
    conversationId = '',
    metaConversationId = '',
    forceRefresh = false,
    checkUpdate = false,
    hostLocale = ''
  } = {}) {
    const appSessionsPath = path.join(this.pluginDataDir, 'sessions.json');
    const cliSessionsPath = path.join(
      this.homeDir,
      '.gemini',
      'antigravity-cli',
      'plugin_data',
      'antigravity-cli-statusline',
      'sessions.json'
    );
    const shouldLoadCliSessions = path.resolve(cliSessionsPath) !== path.resolve(appSessionsPath);

    const [
      panelPrefs,
      hookSessionsData,
      cliHookSessionsData,
      brainSessions,
      installedPlugin,
      installedVersions,
      appSelectedModel
    ] = await Promise.all([
      this._readPanelPreferencesAsync(),
      readJsonSafeAsync(appSessionsPath),
      shouldLoadCliSessions ? readJsonSafeAsync(cliSessionsPath) : Promise.resolve(null),
      discoverRecentBrainSessionsAsync(this.homeDir, 15),
      resolveInstalledPluginVersionAsync({ pluginDir: this.pluginRootDir, homeDir: this.homeDir }),
      this._resolveInstalledVersionsAsync(forceRefresh),
      readAppSelectedModelAsync(this.homeDir)
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
        product: bs.product || 'antigravity',
        hasLocalFiles: true,
        source: 'brain'
      });
    }
    const hookMap = {};
    for (const sourceData of [cliHookSessionsData, hookSessionsData]) {
      const rawMap = sourceData?.sessions;
      if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) continue;
      for (const [id, hs] of Object.entries(rawMap)) {
        if (!hs || typeof hs !== 'object') continue;
        const prevHs = hookMap[id];
        if (!prevHs || Number(hs.updatedAt || 0) >= Number(prevHs.updatedAt || 0)) {
          hookMap[id] = hs;
        }
      }
    }
    await Promise.all(Object.entries(hookMap).map(async ([id, hs]) => {
      if (!hs || typeof hs !== 'object') return;
      const prev = sessionMap.get(id) || {};
      const product = prev.product || inferProductFromPath(hs.transcriptPath, hs.artifactDirectoryPath);
      const hasLocalFiles = prev.hasLocalFiles ||
        await pathExistsAsync(hs.transcriptPath) ||
        await pathExistsAsync(hs.artifactDirectoryPath);
      sessionMap.set(id, {
        ...prev,
        ...hs,
        conversationId: id,
        product,
        hasLocalFiles,
        source: 'hook'
      });
    }));

    const sessions = [...sessionMap.values()]
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, 15);

    const explicitId = sanitizeConversationId(conversationId) || sanitizeConversationId(metaConversationId);
    const latestId = sanitizeConversationId(hookSessionsData?.latestConversationId || '');
    const isAutoFollow = !explicitId;

    const makeFallbackSession = (id) => ({
      conversationId: id,
      workspacePaths: [],
      cwd: '',
      transcriptPath: '',
      artifactDirectoryPath: '',
      modelName: '',
      agentState: 'idle',
      lastHookEvent: '',
      lastHookAt: '',
      updatedAt: 0,
      product: 'antigravity',
      hasLocalFiles: false
    });

    const autoCandidates = [];
    if (isAutoFollow) {
      const seenIds = new Set();
      const pushCandidate = (s) => {
        if (!s || !s.conversationId || seenIds.has(s.conversationId)) return;
        seenIds.add(s.conversationId);
        autoCandidates.push(s);
      };
      const latestEntry = latestId ? sessionMap.get(latestId) : null;
      if (latestEntry && latestEntry.product === 'antigravity') {
        pushCandidate(latestEntry);
      }
      for (const s of sessions) {
        if (s.product === 'antigravity' && s.hasLocalFiles) pushCandidate(s);
      }
      for (const s of sessions) {
        if (s.product === 'antigravity') pushCandidate(s);
      }
      if (latestEntry) pushCandidate(latestEntry);
      for (const s of sessions) pushCandidate(s);
    }

    let activeSession = explicitId
      ? (sessionMap.get(explicitId) || makeFallbackSession(explicitId))
      : (autoCandidates[0] || (latestId ? makeFallbackSession(latestId) : makeFallbackSession('')));

    const probeSessionAsync = (sess) => Promise.all([
      this.collectLsTelemetryFn({
        homeDir: this.homeDir,
        pluginDataDir: this.pluginDataDir,
        conversationId: sess.conversationId || ''
      }),
      readTranscriptSummaryAsync(sess.transcriptPath),
      countArtifactsInDirAsync(sess.artifactDirectoryPath)
    ]);

    const updatePromise = this._resolveUpdateInfoAsync({
      installedVersion: installedPlugin.version,
      forceCheck: checkUpdate
    });

    let [[lsResult, transcriptSummary, artifactsCount], updateInfo] = await Promise.all([
      probeSessionAsync(activeSession),
      updatePromise
    ]);

    // 自動追蹤模式：若首選為已銷毀／子代理幽靈對話（LS 404 且無本地檔案與脈絡），自動跳轉下一個有效 2.0 對話
    const ghostIds = new Set();
    if (
      isAutoFollow &&
      lsResult.conversationNotFound &&
      !lsResult.runtimeTelemetry &&
      !transcriptSummary.exists &&
      autoCandidates.length > 1
    ) {
      ghostIds.add(activeSession.conversationId);
      const maxFallbackTries = Math.min(autoCandidates.length, 4);
      for (let idx = 1; idx < maxFallbackTries; idx++) {
        const cand = autoCandidates[idx];
        const [candLs, candTr, candArt] = await probeSessionAsync(cand);
        const isGhost = Boolean(candLs.conversationNotFound && !candLs.runtimeTelemetry && !candTr.exists);
        if (isGhost) {
          ghostIds.add(cand.conversationId);
          continue;
        }
        activeSession = cand;
        lsResult = candLs;
        transcriptSummary = candTr;
        artifactsCount = candArt;
        break;
      }
    }

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

    const isAppProduct = (activeSession.product || 'antigravity') === 'antigravity';
    const isCurrentAppSession = isAppProduct && (
      isAutoFollow ||
      !latestId ||
      activeSession.conversationId === latestId
    );
    const effectiveAppSelectedModel = isCurrentAppSession ? appSelectedModel : '';
    let effectiveSettings = cliSettings;
    if (isAppProduct && cliSettings && typeof cliSettings === 'object' && 'model' in cliSettings) {
      const { model: _ignoredCliModel, ...restCliSettings } = cliSettings;
      effectiveSettings = restCliSettings;
    }

    const { cache, runtimeTelemetry, telemetryStatus } = lsResult;
    const appOrchWrapperName = resolveOrchestratorWrapperDisplayName(effectiveAppSelectedModel, cache);
    const hookOrchWrapperName = (!effectiveAppSelectedModel || isOrchestratorModelName(effectiveAppSelectedModel, cache))
      ? resolveOrchestratorWrapperDisplayName(activeSession.modelName, cache)
      : '';
    const wrapperDisplayName = appOrchWrapperName || hookOrchWrapperName;
    const wrapperModelId = appOrchWrapperName
      ? effectiveAppSelectedModel
      : (hookOrchWrapperName ? activeSession.modelName : '');

    const fallbackModel = wrapperDisplayName ||
      runtimeTelemetry?.modelDisplayName ||
      activeSession.modelName ||
      'Gemini';

    const derivedState = activeSession.lastHookEvent === 'Stop'
      ? activeSession.agentState
      : (transcriptSummary.exists ? transcriptSummary.derivedAgentState : (activeSession.agentState || 'idle'));

    const meta = {
      conversation_id: activeSession.conversationId || '',
      model: {
        id: wrapperModelId || runtimeTelemetry?.model || fallbackModel,
        display_name: fallbackModel
      },
      agent_state: derivedState,
      artifact_count: artifactsCount,
      ...(hasWorkspace ? { cwd: projectPath, project: { path: projectPath } } : {})
    };

    const quotaInfo = resolveModelQuota(fallbackModel, cache, meta);
    const weeklyInfo = resolveWeeklyQuota(fallbackModel, cache, meta);
    const contextInfo = await computePureContextInfoAsync({
      runtimeTelemetry,
      cache,
      fallbackModel,
      meta,
      cliSettings,
      conversationId: activeSession.conversationId || '',
      pluginDataDir: this.pluginDataDir
    });

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
        homeDir: this.homeDir,
        pluginDataDir: this.pluginDataDir,
        settings: effectiveSettings,
        hookSession: activeSession,
        runtimeTelemetry,
        transcriptSummary,
        appSelectedModel: effectiveAppSelectedModel,
        timeFormat: activeLayout.timeFormat,
        barLength: activeLayout.barLength,
        footerItems: probeItemsSet,
        workspacePath: projectPath,
        cliVersion: installedVersions.cliVersion,
        appVersion: installedVersions.appVersion,
        skipVersionProbes: true,
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

    const visibleSessions = sessions.filter(s => !ghostIds.has(s.conversationId));

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
        isAutoFollow,
        product: activeSession.product || 'antigravity',
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
      sessions: visibleSessions.map(s => ({
        conversationId: s.conversationId,
        product: s.product || 'antigravity',
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
        }
      },
      context: {
        usedPct: Number(contextInfo.usedPctNum.toFixed(1)),
        tokenPct: Number(contextInfo.tokenPctNum.toFixed(1)),
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
        hookVersion: hookSync.hookVersion,
        needsAutoUpdate: isOutdatedCliHookSync(hookSync)
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
      `Quota (5h / 7d): ${q.shortTerm.remainingPct}% / ${q.weekly.remainingPct}%`,
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
    deployHooks = undefined,
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
      const sessionsData = await readJsonSafeAsync(path.join(this.pluginDataDir, 'sessions.json'));
      const knownWorkspaces = [];
      for (const sess of Object.values(sessionsData?.sessions || {})) {
        if (!sess || typeof sess !== 'object') continue;
        if (Array.isArray(sess.workspacePaths)) {
          for (const wp of sess.workspacePaths) {
            if (typeof wp === 'string' && wp.trim()) knownWorkspaces.push(wp);
          }
        }
        if (typeof sess.cwd === 'string' && sess.cwd.trim()) {
          knownWorkspaces.push(sess.cwd);
        }
      }
      const hookSyncBefore = checkPluginHookSync({
        home: this.homeDir,
        currentPluginDir: this.pluginRootDir,
        workspacePath
      });
      const explicitDeploy = typeof deployHooks === 'boolean' ? deployHooks : undefined;
      const shouldAutoUpdateHooks = explicitDeploy === undefined && isOutdatedCliHookSync(hookSyncBefore);
      const effectiveDeployHooks = explicitDeploy === true || shouldAutoUpdateHooks;

      const syncOut = saveCliSettingsAtomicSync({
        homeDir: this.homeDir,
        pluginRootDir: this.pluginRootDir,
        workspacePath,
        knownWorkspaces,
        config: validatedLayout,
        deployHooks: effectiveDeployHooks,
        updateStatusLine: explicitDeploy === true
      });
      cliSyncResult = {
        ...syncOut,
        hooksAutoUpdated: shouldAutoUpdateHooks,
        hookSyncBefore: {
          status: hookSyncBefore.status,
          pluginVersion: hookSyncBefore.pluginVersion,
          hookVersion: hookSyncBefore.hookVersion
        }
      };
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
