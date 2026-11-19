import { promises as fs } from 'fs';
import { join } from 'path';
import os from 'os';

import {
  DEFAULT_COMPACTION_THRESHOLD,
  GITHUB_LATEST_RELEASE_URL,
  HOOK_VERSION,
  PLUGIN_REPO_URL,
  STEP_UP_INTERMEDIATE_THRESHOLD
} from './lib/core/constants.mjs';
import { isDirectExecution, readJsonSafeAsync, writeFileAndVerifyNoBOM } from './lib/core/fs-utils.mjs';
import {
  normalizeLabelStyle,
  normalizeLanguage,
  normalizeModelName,
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
import { extractMetricsAsync, getGitBranch, getGitDirty } from './lib/collectors/probes.mjs';
import {
  mergeQuotaBuckets,
  parseMetaQuota,
  resolveArgonQuota,
  resolveModelQuota,
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
  resolveArgonQuota,
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
    const needsPluginVersion = footerItemsSet.has('plugin-version');
    const pluginUpdatePromise = needsPluginVersion
      ? checkPluginUpdateAsync({ enabled: true, workspacePath: projectPath }).catch(() => null)
      : Promise.resolve(null);
    const needsQuotaOrAccount = footerItems.some(
      item => typeof item === 'string' && (item.startsWith('quota') || item === 'plan-tier' || item === 'account-email')
    );
    const needsContext = footerItems.some(
      item => typeof item === 'string' && (item.startsWith('context-used') || item.startsWith('token-count'))
    );
    const needsCache = needsQuotaOrAccount || needsContext;
    if (footerItemsSet.has('account-email') && !cachedAccount.email && !(meta?.email || meta?.account?.email)) {
      cachedAccount = await manageAccountMetaCacheAsync(meta);
    }
    const conversationId = sanitizeConversationId(meta?.conversation_id) || 'default';

    // 讀取快取並優先整合 Antigravity CLI 原生 meta.quota
    const cachePath = join(os.homedir(), '.gemini', 'tmp', 'real_quota_cache.json');
    let cache = needsCache ? await readJsonSafeAsync(cachePath) : null;

    const normFallbackModel = normalizeModelName(fallbackModel);
    const activePool = normFallbackModel.includes('gemini') ? 'gemini' : ((normFallbackModel.includes('claude') || normFallbackModel.includes('gpt')) ? '3p' : '');
    const needsArgon = Array.isArray(footerItems) && footerItems.some(item => typeof item === 'string' && item.startsWith('quota-argon'));

    const metaQuota = parseMetaQuota(meta);
    const hasMetaShortTerm = activePool
      ? Boolean(metaQuota?.shortTerm?.[activePool])
      : Boolean(metaQuota?.shortTerm && Object.keys(metaQuota.shortTerm).length > 0);
    const hasMetaWeekly = activePool
      ? Boolean(metaQuota?.weekly?.[activePool])
      : Boolean(metaQuota?.weekly && Object.keys(metaQuota.weekly).some(k => !k.toLowerCase().includes('argon')));
    const hasMetaArgon = !needsArgon || Boolean(
      metaQuota && (
        Object.keys(metaQuota.weekly || {}).some(k => k.toLowerCase().includes('argon')) ||
        Object.keys(metaQuota.shortTerm || {}).some(k => k.toLowerCase().includes('argon'))
      )
    );
    const isMetaQuotaComplete = Boolean(metaQuota && hasMetaShortTerm && hasMetaWeekly && hasMetaArgon);

    const hasCacheShortTerm = Boolean(
      (activePool && cache?.shortTerm?.[activePool]) ||
      (cache?.shortTerm && Object.keys(cache.shortTerm).length > 0) ||
      (cache?.models && typeof cache.models === 'object' && Object.keys(cache.models).length > 0)
    );
    const hasCacheArgon = !needsArgon || Boolean(
      (cache?.weekly && typeof cache.weekly === 'object' && Object.keys(cache.weekly).some(k => k.toLowerCase().includes('argon'))) ||
      (cache?.shortTerm && typeof cache.shortTerm === 'object' && Object.keys(cache.shortTerm).some(k => k.toLowerCase().includes('argon'))) ||
      (cache?.models && typeof cache.models === 'object' && Object.keys(cache.models).some(k => k.toLowerCase().includes('argon')))
    );
    const missingRequiredBuckets = (!hasMetaShortTerm && !hasCacheShortTerm) || (!hasMetaArgon && !hasCacheArgon);

    const currentModelKeys = extractModelCandidateKeys(meta, fallbackModel);
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

    const shouldUpdateForQuota = needsQuotaOrAccount && (!isMetaQuotaComplete || stateOrTokensChanged || isCacheStale);
    const shouldUpdateForContext = needsContext && (missingModelLimits || stateOrTokensChanged || isCacheStale);
    if (needsCache && (shouldUpdateForQuota || shouldUpdateForContext)) {
      const updateRes = await triggerQuotaUpdateIfNeededAsync(cache, meta, {
        cachePath,
        missingRequiredBuckets: (needsQuotaOrAccount && missingRequiredBuckets) || missingModelLimits,
        conversationId
      });
      cache = updateRes.cache;
      freshlyFetchedFromLs = updateRes.freshlyFetchedFromLs;
      timedOut = updateRes.timedOut;
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
    const quotaInfo = resolveModelQuota(fallbackModel, cache);
    const weeklyInfo = resolveWeeklyQuota(fallbackModel, cache);
    const argonInfo = resolveArgonQuota(cache);
    const contextInfo = needsContext
      ? await calculateContextUsageAsync(meta, conversationId, settings, cache)
      : { totalInput: 0, contextSize: 1048576, effectiveTokenCeiling: DEFAULT_COMPACTION_THRESHOLD, usedPctNum: 0 };

    const timeFormat = settings?.ui?.footer?.timeFormat || settings?.ui?.timeFormat || 'smart';
    const barLength = settings?.ui?.footer?.barLength || settings?.ui?.barLength || 10;
    const labelStyle = normalizeLabelStyle(settings?.ui?.footer?.labelStyle || settings?.ui?.footer?.style || settings?.ui?.labelStyle || 'text');
    const rawItemStyles = settings?.ui?.footer?.itemStyles;

    // 併行執行更新檢查與系統探測（Bug #2 延遲最佳化），完成後再補回外掛版本標籤
    const [pluginUpdateInfo, metrics] = await Promise.all([
      pluginUpdatePromise,
      extractMetricsAsync(
        meta,
        lang,
        fallbackModel,
        cache,
        cachedAccount,
        quotaInfo,
        contextInfo,
        weeklyInfo,
        {
          timeFormat,
          barLength,
          argonInfo,
          footerItems: footerItemsSet,
          skipPluginVersionResolve: needsPluginVersion
        }
      )
    ]);

    if (needsPluginVersion) {
      let resolvedTag = pluginUpdateInfo?.installedTag || '';
      if (!resolvedTag) {
        const fallbackPlugin = await resolveInstalledPluginVersionAsync({ workspacePath: projectPath }).catch(() => null);
        resolvedTag = fallbackPlugin?.tag || '';
      }
      if (resolvedTag) {
        metrics.pluginVersion = resolvedTag;
      }
    }

    const extraLines = (needsPluginVersion && pluginUpdateInfo?.updateAvailable)
      ? formatPluginUpdateNoticeLines(lang, pluginUpdateInfo.installedTag, pluginUpdateInfo.latestTag)
      : [];

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
