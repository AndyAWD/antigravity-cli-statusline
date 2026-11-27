import { promises as fs } from 'fs';
import { dirname, join, resolve as resolvePath } from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

import {
  DEFAULT_COMPACTION_THRESHOLD,
  GITHUB_LATEST_RELEASE_URL,
  HOOK_VERSION,
  PLUGIN_REPO_URL,
  STEP_UP_INTERMEDIATE_THRESHOLD
} from './lib/core/constants.mjs';
import { maybeAutoSyncCliHooksSync } from './lib/core/cli-deploy.mjs';
import { isDirectExecution, readJsonSafeAsync, writeFileAndVerifyNoBOM } from './lib/core/fs-utils.mjs';
import {
  normalizeLabelStyle,
  normalizeLanguage,
  sanitizeConversationId
} from './lib/core/normalize.mjs';
import { resolveInstalledPluginVersionAsync } from './lib/core/plugin-manifest.mjs';
import { compareSemver, formatVersionTag, isVersionBehind, normalizeSemver } from './lib/core/semver.mjs';
import {
  getSettingsAsync,
  readStdin,
  resolveProjectPath,
  resolveTerminalWidth
} from './lib/core/settings.mjs';
import { manageAccountMetaCacheAsync } from './lib/collectors/account.mjs';
import {
  calculateContextUsageAsync,
  computeSteppedCeiling,
  extractModelCandidateKeys,
  parseCeilingValue,
  resolveCatalogEntry
} from './lib/collectors/context.mjs';
import {
  checkPluginUpdateAsync,
  extractArgsAfterExecutable,
  fetchLatestPluginReleaseAsync,
  hasNonInteractiveAgyFlag,
  isAgyProcessName,
  isHubAgyArgs,
  parseLinuxProcStat,
  parseMacPsLine,
  parseWinProcessChainJson,
  resolveAgySessionAsync,
  tokenizeCommandLine
} from './lib/collectors/plugin-update.mjs';
import {
  isOrchestratorModelName,
  isOrchestratorSession,
  readLatestTranscriptModelAsync,
  resolveConfiguredPlannerRef,
  resolveOrchestratorWrapperDisplayName,
  resolvePlannerCatalogModelRef,
  resolveRuntimeSessionPlannerRef
} from './lib/collectors/runtime-model.mjs';
import { extractMetricsAsync, getGitBranch, getGitDirty } from './lib/collectors/probes.mjs';
import {
  mergeQuotaBuckets,
  parseMetaQuota,
  resolveModelQuota,
  resolveQuotaPool,
  resolveWeeklyQuota,
  triggerQuotaUpdateIfNeededAsync
} from './lib/collectors/quota.mjs';
import {
  formatAbsoluteResetTime,
  formatResetTime,
  formatSecondsToCountdown
} from './lib/collectors/time-format.mjs';
import { buildI18nDict, formatPluginUpdateNoticeLines } from './lib/metrics/i18n.mjs';
import { ADJACENT_PAIRS, EMOJI_MAP } from './lib/metrics/registry.mjs';
import { getDisplayWidth, renderBarGraph, stripAnsi } from './lib/renderers/ansi.mjs';
import { getRenderer } from './lib/renderers/index.mjs';
import { preprocessAdjacentItems, renderStatusLine } from './lib/renderers/standard.mjs';

export {
  HOOK_VERSION,
  PLUGIN_REPO_URL,
  GITHUB_LATEST_RELEASE_URL,
  stripAnsi,
  getDisplayWidth,
  normalizeLanguage,
  normalizeLabelStyle,
  EMOJI_MAP,
  getGitBranch,
  getGitDirty,
  normalizeSemver,
  formatVersionTag,
  compareSemver,
  isVersionBehind,
  tokenizeCommandLine,
  isAgyProcessName,
  extractArgsAfterExecutable,
  hasNonInteractiveAgyFlag,
  isHubAgyArgs,
  parseMacPsLine,
  parseLinuxProcStat,
  parseWinProcessChainJson,
  resolveAgySessionAsync,
  resolveInstalledPluginVersionAsync,
  fetchLatestPluginReleaseAsync,
  checkPluginUpdateAsync,
  formatPluginUpdateNoticeLines,
  formatResetTime,
  formatSecondsToCountdown,
  formatAbsoluteResetTime,
  renderBarGraph,
  parseMetaQuota,
  mergeQuotaBuckets,
  triggerQuotaUpdateIfNeededAsync,
  resolveModelQuota,
  resolveWeeklyQuota,
  DEFAULT_COMPACTION_THRESHOLD,
  STEP_UP_INTERMEDIATE_THRESHOLD,
  parseCeilingValue,
  extractModelCandidateKeys,
  resolveCatalogEntry,
  computeSteppedCeiling,
  calculateContextUsageAsync,
  resolveTerminalWidth,
  extractMetricsAsync,
  buildI18nDict,
  ADJACENT_PAIRS,
  preprocessAdjacentItems,
  renderStatusLine
};

function resolveEffectiveCliModel(meta, settings, cache, currentFallback, runtimePlannerModel = '') {
  for (const cand of [meta?.model?.display_name, meta?.model?.id, currentFallback]) {
    if (typeof cand === 'string' && cand.trim() && isOrchestratorModelName(cand, cache)) {
      const resolved = resolveOrchestratorWrapperDisplayName(cand, cache, {
        settings,
        meta,
        runtimePlannerModel
      });
      if (resolved) return resolved;
    }
  }
  return currentFallback;
}

function hasPlaceholderPlannerRef(settings, meta) {
  if (typeof settings?.model === 'string' && /^MODEL_/i.test(settings.model.trim())) return true;
  for (const obj of [meta, settings, meta?.orchestrator, settings?.orchestrator]) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    const raw = obj.planner ?? obj.plannerModel ?? obj.planner_model ?? obj.plan ?? obj.planModel ?? obj.plan_model ?? obj.orchestratorModel ?? obj.orchestrator_model;
    const cand = typeof raw === 'string' ? raw : (raw && typeof raw === 'object' ? (raw.model ?? raw.modelId ?? raw.model_id ?? raw.id) : '');
    if (typeof cand === 'string' && /^MODEL_/i.test(cand.trim())) return true;
  }
  return false;
}

async function resolveCliRuntimePlannerFallbackAsync({ homeDir, projectPath, conversationId, meta, settings, cache, fallbackModel }) {
  const needsCheck =
    isOrchestratorModelName(fallbackModel, cache) ||
    isOrchestratorModelName(meta?.model?.display_name, cache) ||
    isOrchestratorModelName(meta?.model?.id, cache) ||
    isOrchestratorModelName(settings?.model, cache);
  if (!needsCheck) return '';

  const explicitConfigured = resolveConfiguredPlannerRef(meta, settings, '', fallbackModel, {
    includeSettingsModelWrapper: false
  });
  if (explicitConfigured) return '';

  const settingsPaths = [
    join(homeDir, '.gemini', 'settings.json'),
    join(homeDir, '.gemini', 'antigravity-cli', 'settings.json'),
    ...(projectPath ? [join(projectPath, '.gemini', 'settings.json')] : [])
  ];
  const statResults = await Promise.all(settingsPaths.map(p => fs.stat(p).catch(() => null)));
  let settingsTimestampMs = 0;
  for (const st of statResults) {
    if (st && Number.isFinite(st.mtimeMs) && st.mtimeMs > settingsTimestampMs) {
      settingsTimestampMs = Math.round(st.mtimeMs);
    }
  }

  const sessionsPath = join(homeDir, '.gemini', 'antigravity', 'plugin_data', 'antigravity-cli-statusline', 'sessions.json');
  const sessionsData = await readJsonSafeAsync(sessionsPath);
  const session = (conversationId && conversationId !== 'default' && sessionsData?.sessions && typeof sessionsData.sessions === 'object')
    ? sessionsData.sessions[conversationId] || null
    : null;

  let transcript = null;
  const trCandidates = [];
  if (typeof session?.transcriptPath === 'string' && session.transcriptPath.trim()) {
    trCandidates.push(session.transcriptPath.trim());
  }
  if (conversationId && conversationId !== 'default') {
    trCandidates.push(join(homeDir, '.gemini', 'antigravity-cli', 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl'));
  }
  for (const trPath of trCandidates) {
    const res = await readLatestTranscriptModelAsync(trPath, cache);
    if (res?.exists && (res.plannerModel || res.model)) {
      transcript = res;
      break;
    }
  }

  return resolveRuntimeSessionPlannerRef({
    session,
    transcript,
    settingsTimestampMs,
    cache
  });
}

// ==========================================
// Main Entry
// ==========================================
async function main() {
  if (process.env.DISABLE_QUOTA_HOOK) process.exit(0);
  let meta = {};

  try {
    const stdinStr = await readStdin();
    try { if (stdinStr.trim()) meta = JSON.parse(stdinStr.replace(/^\uFEFF/, '')); } catch (_) {}

    const [settings, initialCachedAccount] = await Promise.all([
      getSettingsAsync(meta),
      manageAccountMetaCacheAsync(meta, { allowCliLogScan: false })
    ]);
    let cachedAccount = initialCachedAccount;
    const termWidth = resolveTerminalWidth(meta, cachedAccount);

    let fallbackModel = 'Gemini 3.5 Flash (High)';
    if (meta?.model?.display_name) fallbackModel = meta.model.display_name;
    else if (meta?.model?.id) fallbackModel = meta.model.id;
    fallbackModel = resolveEffectiveCliModel(meta, settings, null, fallbackModel);

    // 退讓模式
    if (!settings?.ui?.footer?.items || !Array.isArray(settings.ui.footer.items) || settings.ui.footer.items.length === 0) {
      const leftText = '? for shortcuts';
      const rightText = fallbackModel;
      const spacesCount = Math.max(1, termWidth - getDisplayWidth(leftText) - getDisplayWidth(rightText) - 1);
      console.log(`${leftText}${' '.repeat(spacesCount)}${rightText}`);
      process.exit(0);
    }

    const lang = normalizeLanguage(settings?.ui?.language || 'zh-tw');
    const footerItems = settings.ui.footer.items;
    const footerItemsSet = new Set(footerItems);
    const projectPath = resolveProjectPath(meta);
    try {
      const selfDir = resolvePath(dirname(fileURLToPath(import.meta.url)));
      const deployedHooksDir = resolvePath(join(os.homedir(), '.gemini', 'antigravity-cli', 'hooks'));
      const normPath = (p) => (process.platform === 'win32' || process.platform === 'darwin') ? p.toLowerCase() : p;
      if (normPath(selfDir) === normPath(deployedHooksDir)) {
        maybeAutoSyncCliHooksSync({
          homeDir: os.homedir(),
          workspacePath: projectPath,
          verifyContentHashes: false
        });
      }
    } catch (_) {}
    const needsPluginVersion = footerItemsSet.has('plugin-version');
    const needsPluginUpdate = footerItemsSet.has('plugin-update');
    const pluginUpdatePromise = needsPluginUpdate
      ? checkPluginUpdateAsync({ enabled: true, workspacePath: projectPath }).catch(() => null)
      : Promise.resolve(null);
    const needsQuotaOrAccount = footerItems.some(
      item => typeof item === 'string' && (item.startsWith('quota') || item === 'plan-tier' || item === 'account-email')
    );
    const needsContext = footerItems.some(
      item => typeof item === 'string' && (item.startsWith('context-used') || item.startsWith('token-count'))
    );
    const wantsActiveModel = footerItemsSet.has('active-model');
    const needsCache = needsQuotaOrAccount || needsContext || wantsActiveModel;
    if (footerItemsSet.has('account-email') && !cachedAccount.email && !(meta?.email || meta?.account?.email)) {
      cachedAccount = await manageAccountMetaCacheAsync(meta);
    }
    const conversationId = sanitizeConversationId(meta?.conversation_id) || 'default';

    // 讀取快取並優先整合 Antigravity CLI 原生 meta.quota
    const cachePath = join(os.homedir(), '.gemini', 'tmp', 'real_quota_cache.json');
    const needsCatalogOnlyCache = !needsCache && footerItemsSet.has('model-name') && (
      /^MODEL_/i.test(fallbackModel) ||
      /^MODEL_/i.test(String(meta?.model?.id || '')) ||
      hasPlaceholderPlannerRef(settings, meta)
    );
    let cache = needsCache ? await readJsonSafeAsync(cachePath) : null;
    const catalogReadOnlyCache = needsCatalogOnlyCache ? await readJsonSafeAsync(cachePath) : null;
    let effectiveCache = cache || catalogReadOnlyCache;
    let runtimePlannerModel = await resolveCliRuntimePlannerFallbackAsync({
      homeDir: os.homedir(),
      projectPath,
      conversationId,
      meta,
      settings,
      cache: effectiveCache,
      fallbackModel
    });
    fallbackModel = resolveEffectiveCliModel(meta, settings, effectiveCache, fallbackModel, runtimePlannerModel);

    const buildEffectiveMetas = (resolvedModel, curCache) => {
      if (!isOrchestratorModelName(resolvedModel, curCache)) {
        return { effectiveMeta: meta, quotaMeta: meta };
      }
      const rawWrapperRef = meta?.model?.id || meta?.model?.display_name || '';
      const staticWrapperName = rawWrapperRef ? resolveOrchestratorWrapperDisplayName(rawWrapperRef, curCache) : '';
      const didOverrideWrapper = Boolean(resolvedModel !== (staticWrapperName || meta?.model?.display_name || ''));
      if (!didOverrideWrapper && meta?.model?.display_name === resolvedModel) {
        return { effectiveMeta: meta, quotaMeta: meta };
      }
      if (didOverrideWrapper) {
        const plannerRef = resolveConfiguredPlannerRef(meta, settings, '', rawWrapperRef) || runtimePlannerModel;
        const plannerCatalogRef = resolvePlannerCatalogModelRef(plannerRef, curCache);
        const baseModelObj = (meta?.model && typeof meta.model === 'object') ? meta.model : {};
        return {
          effectiveMeta: {
            ...meta,
            model: {
              ...baseModelObj,
              id: resolvedModel,
              display_name: resolvedModel,
              name: plannerCatalogRef || baseModelObj.id || baseModelObj.name || resolvedModel
            }
          },
          quotaMeta: {
            ...meta,
            model: {
              id: resolvedModel,
              display_name: resolvedModel
            }
          }
        };
      }
      const nextModel = (meta?.model && typeof meta.model === 'object') ? { ...meta.model } : {};
      nextModel.display_name = resolvedModel;
      if (typeof nextModel.id === 'string' && isOrchestratorModelName(nextModel.id, curCache) && !/^MODEL_/i.test(nextModel.id)) {
        nextModel.id = resolvedModel;
      }
      const updated = { ...meta, model: nextModel };
      return { effectiveMeta: updated, quotaMeta: updated };
    };
    let { effectiveMeta, quotaMeta } = buildEffectiveMetas(fallbackModel, effectiveCache);

    const activePool = resolveQuotaPool(fallbackModel, effectiveCache, quotaMeta);

    const metaQuota = parseMetaQuota(meta);
    const hasMetaShortTerm = activePool
      ? Boolean(metaQuota?.shortTerm?.[activePool])
      : Boolean(metaQuota?.shortTerm && Object.keys(metaQuota.shortTerm).length > 0);
    const hasMetaWeekly = activePool
      ? Boolean(metaQuota?.weekly?.[activePool])
      : Boolean(metaQuota?.weekly && Object.keys(metaQuota.weekly).some(k => !k.toLowerCase().includes('argon')));
    const isMetaQuotaComplete = Boolean(metaQuota && hasMetaShortTerm && hasMetaWeekly);

    const hasCacheShortTerm = Boolean(
      (activePool && cache?.shortTerm?.[activePool]) ||
      (cache?.shortTerm && Object.keys(cache.shortTerm).length > 0) ||
      (cache?.models && typeof cache.models === 'object' && Object.keys(cache.models).length > 0)
    );
    const missingRequiredBuckets = !hasMetaShortTerm && !hasCacheShortTerm;

    const currentModelKeys = extractModelCandidateKeys(effectiveMeta, fallbackModel);
    const primaryModelKey = currentModelKeys[0] || '';
    const catalogEntry = resolveCatalogEntry(currentModelKeys, cache?.modelLimits);
    const hasCatalogCeiling = Boolean(catalogEntry && typeof catalogEntry.limit === 'number' && catalogEntry.limit > 0);

    const now = Date.now();
    const modelJustChanged = Boolean(primaryModelKey && cache?.lastModelKey && cache.lastModelKey !== primaryModelKey);
    const modelLimitAttemptAgeMs = now - (cache?.lastModelLimitAttemptAt || cache?.lastPollAttemptAt || 0);
    const missingModelLimits = Boolean(
      needsContext &&
      currentModelKeys.length > 0 &&
      !hasCatalogCeiling &&
      (modelJustChanged || !cache?.modelLimitsUpdatedAt || modelLimitAttemptAgeMs >= 15000)
    );

    const currentState = typeof meta?.agent_state === 'string' ? meta.agent_state.trim().toLowerCase() : '';
    const prevState = typeof cache?.lastAgentState === 'string' ? cache.lastAgentState.trim().toLowerCase() : '';
    const currentOutputTokens = Number(meta?.context_window?.total_output_tokens || 0);
    const currentInputTokens = Number(meta?.context_window?.total_input_tokens || 0);
    const currentTotalTokens = currentInputTokens + currentOutputTokens;
    const prevOutputTokens = Number(cache?.lastOutputTokens || 0);
    const prevTotalTokens = Number(cache?.lastTotalTokens || 0);
    const stateOrTokensChanged =
      (currentState === 'idle' && prevState !== '' && prevState !== 'idle') ||
      (currentOutputTokens > 0 && currentOutputTokens !== prevOutputTokens) ||
      (currentTotalTokens > 0 && currentTotalTokens !== prevTotalTokens);

    const lastUpdatedAt = cache?.lsUpdatedAt || cache?.updatedAt || 0;
    const cacheAgeMs = now - lastUpdatedAt;
    const lastAttemptAgeMs = now - (cache?.lastPollAttemptAt || 0);
    const isCacheStale = (!cache || !lastUpdatedAt || cacheAgeMs >= 15000) && (!lastUpdatedAt || lastAttemptAgeMs >= 15000);

    let freshlyFetchedFromLs = false;
    let timedOut = false;
    let shouldPersistCache = false;

    const isBucketExpired = (entry) => {
      if (!entry || typeof entry !== 'object' || !entry.reset_time) return false;
      const resetMs = new Date(entry.reset_time).getTime();
      return !isNaN(resetMs) && resetMs > 0 && resetMs <= now;
    };
    const hasFutureReset = (entry) => {
      if (!entry || typeof entry !== 'object' || !entry.reset_time) return false;
      const resetMs = new Date(entry.reset_time).getTime();
      return !isNaN(resetMs) && resetMs > now;
    };
    const activeShortBucket = (activePool && cache?.shortTerm?.[activePool])
      ? cache.shortTerm[activePool]
      : (primaryModelKey ? cache?.models?.[primaryModelKey] : null);
    const activeWeeklyBucket = activePool ? cache?.weekly?.[activePool] : null;
    const metaShortBucket = activePool ? metaQuota?.shortTerm?.[activePool] : null;
    const metaWeeklyBucket = activePool ? metaQuota?.weekly?.[activePool] : null;
    const hasExpiredActiveQuota = Boolean(
      needsQuotaOrAccount && (
        (isBucketExpired(activeShortBucket) && !hasFutureReset(metaShortBucket)) ||
        (isBucketExpired(activeWeeklyBucket) && !hasFutureReset(metaWeeklyBucket))
      )
    );

    const prevPollAttemptAt = cache?.lastPollAttemptAt || 0;
    const needsActiveModel = wantsActiveModel && isOrchestratorSession(effectiveMeta, settings, null, fallbackModel, { cache });
    const shouldUpdateForQuota = needsQuotaOrAccount && (!isMetaQuotaComplete || stateOrTokensChanged || isCacheStale || hasExpiredActiveQuota);
    const shouldUpdateForContext = needsContext && (missingModelLimits || stateOrTokensChanged || isCacheStale);
    const shouldUpdateForActiveModel = needsActiveModel && (stateOrTokensChanged || isCacheStale || (currentState !== '' && currentState !== 'idle'));
    if (needsCache && (shouldUpdateForQuota || shouldUpdateForContext || shouldUpdateForActiveModel)) {
      const updateRes = await triggerQuotaUpdateIfNeededAsync(cache, effectiveMeta, {
        cachePath,
        missingRequiredBuckets: (needsQuotaOrAccount && missingRequiredBuckets) || missingModelLimits,
        hasExpiredQuota: hasExpiredActiveQuota,
        conversationId
      });
      cache = updateRes.cache;
      effectiveCache = cache || catalogReadOnlyCache;
      runtimePlannerModel = await resolveCliRuntimePlannerFallbackAsync({
        homeDir: os.homedir(),
        projectPath,
        conversationId,
        meta,
        settings,
        cache: effectiveCache,
        fallbackModel
      });
      fallbackModel = resolveEffectiveCliModel(meta, settings, effectiveCache, fallbackModel, runtimePlannerModel);
      ({ effectiveMeta, quotaMeta } = buildEffectiveMetas(fallbackModel, effectiveCache));
      freshlyFetchedFromLs = updateRes.freshlyFetchedFromLs;
      timedOut = updateRes.timedOut;
      if (cache && typeof cache === 'object' && cache.lastPollAttemptAt && cache.lastPollAttemptAt !== prevPollAttemptAt) {
        shouldPersistCache = true;
      }
    }
    if (needsQuotaOrAccount && metaQuota) {
      if (!cache || typeof cache !== 'object') cache = {};
      cache.shortTerm = mergeQuotaBuckets(cache.shortTerm, metaQuota.shortTerm, true);
      cache.weekly = mergeQuotaBuckets(cache.weekly, metaQuota.weekly, true);
      const planTier = meta?.plan_tier || meta?.account?.plan_tier;
      const email = meta?.email || meta?.account?.email;
      if (planTier) cache.planTier = planTier;
      if (email) cache.email = email;
      if (freshlyFetchedFromLs || !cache.updatedAt) {
        cache.updatedAt = Date.now();
      }
      shouldPersistCache = true;
    }

    if (cache && typeof cache === 'object') {
      if (currentState && cache.lastAgentState !== currentState) {
        cache.lastAgentState = currentState;
        shouldPersistCache = true;
      }
      if (currentOutputTokens > 0 && cache.lastOutputTokens !== currentOutputTokens) {
        cache.lastOutputTokens = currentOutputTokens;
        shouldPersistCache = true;
      }
      if (currentTotalTokens > 0 && cache.lastTotalTokens !== currentTotalTokens) {
        cache.lastTotalTokens = currentTotalTokens;
        shouldPersistCache = true;
      }
      if (primaryModelKey && cache.lastModelKey !== primaryModelKey) {
        cache.lastModelKey = primaryModelKey;
        shouldPersistCache = true;
      }
      if (missingModelLimits && !freshlyFetchedFromLs) {
        cache.lastModelLimitAttemptAt = now;
        shouldPersistCache = true;
      }
      if (shouldPersistCache && !timedOut) {
        try {
          await writeFileAndVerifyNoBOM(cachePath, JSON.stringify(cache, null, 2));
        } catch (_) {}
      }
    }

    // 解析核心資料
    const quotaInfo = resolveModelQuota(fallbackModel, effectiveCache, quotaMeta);
    const weeklyInfo = resolveWeeklyQuota(fallbackModel, effectiveCache, quotaMeta);
    const contextInfo = needsContext
      ? await calculateContextUsageAsync(effectiveMeta, conversationId, settings, cache)
      : { totalInput: 0, contextSize: 1048576, effectiveTokenCeiling: DEFAULT_COMPACTION_THRESHOLD, usedPctNum: 0 };

    const timeFormat = settings?.ui?.footer?.timeFormat || settings?.ui?.timeFormat || 'smart';
    const barLength = settings?.ui?.footer?.barLength || settings?.ui?.barLength || 10;
    const labelStyle = normalizeLabelStyle(settings?.ui?.footer?.labelStyle || settings?.ui?.footer?.style || settings?.ui?.labelStyle || 'text');
    const rawItemStyles = settings?.ui?.footer?.itemStyles;

    // 併行執行更新檢查與系統探測（Bug #2 延遲最佳化），完成後再補回外掛版本標籤
    const [pluginUpdateInfo, metrics] = await Promise.all([
      pluginUpdatePromise,
      extractMetricsAsync(
        effectiveMeta,
        lang,
        fallbackModel,
        effectiveCache,
        cachedAccount,
        quotaInfo,
        contextInfo,
        weeklyInfo,
        {
          timeFormat,
          barLength,
          footerItems: footerItemsSet,
          workspacePath: projectPath,
          settings,
          runtimePlannerModel,
          skipPluginVersionResolve: needsPluginUpdate
        }
      )
    ]);

    if (needsPluginVersion && needsPluginUpdate) {
      let resolvedTag = pluginUpdateInfo?.installedTag || '';
      if (!resolvedTag) {
        const fallbackPlugin = await resolveInstalledPluginVersionAsync({ workspacePath: projectPath }).catch(() => null);
        resolvedTag = fallbackPlugin?.tag || '';
      }
      if (resolvedTag) {
        metrics.pluginVersion = resolvedTag;
      }
    }

    if (needsPluginUpdate && pluginUpdateInfo?.updateAvailable) {
      metrics.pluginUpdateAvailable = true;
      metrics.pluginUpdateCurrentTag = pluginUpdateInfo.installedTag || metrics.pluginVersion || '';
      metrics.pluginUpdateLatestTag = pluginUpdateInfo.latestTag || '';
    } else {
      metrics.pluginUpdateAvailable = false;
      metrics.pluginUpdateCurrentTag = '';
      metrics.pluginUpdateLatestTag = '';
    }

    const extraLines = [];

    const activeDict = buildI18nDict(lang, metrics, labelStyle, rawItemStyles);
    const renderer = getRenderer('standard');
    if (renderer) {
      renderer({
        footerItems,
        activeDict,
        termWidth,
        fallbackModel,
        itemStyles: rawItemStyles,
        defaultStyle: labelStyle,
        extraLines
      });
    } else {
      renderStatusLine(footerItems, activeDict, termWidth, fallbackModel, rawItemStyles, labelStyle, extraLines);
    }
  } catch (err) {
    try {
      const projectLogDir = join(process.cwd(), '.gemini');
      await fs.access(projectLogDir);
      await fs.writeFile(join(projectLogDir, 'hook_error.log'), `[${new Date().toISOString()}] ${err.stack || err.message}\n`, { encoding: 'utf8', flag: 'a' });
    } catch (_) {}

    let fallbackModel = 'Gemini 3.5 Flash (High)';
    if (meta?.model?.display_name) fallbackModel = meta.model.display_name;
    else if (meta?.model?.id) fallbackModel = meta.model.id;
    console.log(`? for shortcuts | ${fallbackModel}`);
  }
  process.exit(0);
}

if (isDirectExecution(import.meta.url, { treatEmptyArgv1AsDirect: true })) {
  main();
}
