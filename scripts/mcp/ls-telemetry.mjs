import os from 'node:os';
import path from 'node:path';
import {
  extractRuntimeGeneratorContext,
  mergeQuotaBuckets,
  parseModelLimits,
  parseShortTermBuckets,
  parseWeeklyBuckets,
  requestAvailableModels,
  requestQuotaSummary,
  requestTrajectoryGeneratorMetadata,
  requestUserStatus
} from '../../skills/agy-cli-statusline/scripts/fetch-local-quota.mjs';
import {
  readJsonSafeAsync,
  writeFileAndVerifyNoBOM
} from '../../skills/agy-cli-statusline/scripts/lib/core/fs-utils.mjs';
import { normalizeModelName } from '../../skills/agy-cli-statusline/scripts/lib/core/normalize.mjs';
import {
  inferModelPoolsFromModels,
  parseModelPools
} from '../../skills/agy-cli-statusline/scripts/lib/collectors/quota.mjs';

/**
 * 自 GetCascadeTrajectoryGeneratorMetadata 回應擷取完整 tokenBreakdown 與 usage。
 * @param {object} genMetaResponse
 * @returns {{ maxContextTokens: number, estimatedTokensUsed: number, modelDisplayName: string, model: string, usage: object|null, tokenBreakdown: Array<{ name: string, type: string, numTokens: number }> }}
 */
export function extractDetailedRuntimeContext(genMetaResponse) {
  const base = extractRuntimeGeneratorContext(genMetaResponse);
  const list = genMetaResponse?.generatorMetadata;
  let estimatedTokensUsed = 0;
  let usage = null;
  let tokenBreakdown = [];

  if (Array.isArray(list) && list.length > 0) {
    for (let i = list.length - 1; i >= 0; i--) {
      const cm = list[i]?.chatModel;
      if (!cm || typeof cm !== 'object') continue;
      const cwMeta = cm.chatStartMetadata?.contextWindowMetadata;
      if (cwMeta && typeof cwMeta === 'object') {
        const est = Number(cwMeta.estimatedTokensUsed || 0);
        if (!isNaN(est) && est > 0) estimatedTokensUsed = est;
        const groups = cwMeta.tokenBreakdown?.groups;
        if (Array.isArray(groups) && groups.length > 0) {
          tokenBreakdown = groups
            .filter(g => g && typeof g === 'object')
            .map(g => ({
              name: String(g.name || 'Other'),
              type: String(g.type || ''),
              numTokens: Math.max(0, Number(g.numTokens || 0) || 0)
            }));
        }
      }
      if (cm.usage && typeof cm.usage === 'object') {
        usage = {
          inputTokens: Math.max(0, Number(cm.usage.inputTokens || 0) || 0),
          outputTokens: Math.max(0, Number(cm.usage.outputTokens || 0) || 0),
          thinkingOutputTokens: Math.max(0, Number(cm.usage.thinkingOutputTokens || 0) || 0),
          responseOutputTokens: Math.max(0, Number(cm.usage.responseOutputTokens || 0) || 0),
          cacheReadTokens: Math.max(0, Number(cm.usage.cacheReadTokens || 0) || 0)
        };
      }
      if (estimatedTokensUsed > 0 || tokenBreakdown.length > 0 || usage) break;
    }
  }

  return {
    maxContextTokens: base.maxContextTokens,
    estimatedTokensUsed,
    modelDisplayName: base.modelDisplayName,
    model: base.model,
    usage,
    tokenBreakdown
  };
}

const MAX_METADATA_PAGES = 5;
const METADATA_PAGE_LIMIT = 256;
const runtimeCursorCache = new Map();

export function resetLsTelemetryMemoryCache() {
  runtimeCursorCache.clear();
}

export function parseHostPort(addr) {
  if (!addr || typeof addr !== 'string') return { host: '', port: NaN };
  const trimmed = addr.trim();
  const idx = trimmed.lastIndexOf(':');
  if (idx <= 0) return { host: '', port: NaN };
  let host = trimmed.slice(0, idx).trim();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  const port = parseInt(trimmed.slice(idx + 1).trim(), 10);
  return { host, port };
}

async function fetchPaginatedRuntimeTelemetryAsync({
  port,
  csrfToken,
  host,
  preferHttps,
  conversationId,
  requestFn = requestTrajectoryGeneratorMetadata
}) {
  if (!conversationId) return null;
  const cached = runtimeCursorCache.get(conversationId) || { nextOffset: 0, telemetry: null };
  let offset = Math.max(0, Number(cached.nextOffset || 0) || 0);
  let latestTelemetry = cached.telemetry || null;

  for (let page = 0; page < MAX_METADATA_PAGES; page++) {
    let resp = null;
    try {
      resp = await requestFn(port, csrfToken, conversationId, offset, host, preferHttps);
    } catch (_) {
      break;
    }
    const list = resp?.generatorMetadata;
    if (!Array.isArray(list) || list.length === 0) break;

    const extracted = extractDetailedRuntimeContext(resp);
    if (
      extracted.maxContextTokens > 0 ||
      extracted.estimatedTokensUsed > 0 ||
      extracted.usage ||
      extracted.tokenBreakdown.length > 0
    ) {
      latestTelemetry = extracted;
    }
    offset += list.length;
    if (list.length < METADATA_PAGE_LIMIT) break;
  }

  if (latestTelemetry || offset > (cached.nextOffset || 0)) {
    runtimeCursorCache.set(conversationId, { nextOffset: offset, telemetry: latestTelemetry });
  }
  return latestTelemetry;
}

/**
 * 唯讀隔離版語言伺服器遙測採集器：
 * - 絕不寫入或刪除 ~/.gemini/tmp/*（CLI 檔案僅做唯讀退讓）。
 * - 僅將 2.0 快取寫入 pluginDataDir/quota_cache.json。
 */
export async function collectLsTelemetryAsync({
  homeDir = os.homedir(),
  pluginDataDir,
  conversationId = '',
  env = process.env,
  requestTrajectoryGeneratorMetadataFn = requestTrajectoryGeneratorMetadata
} = {}) {
  const pluginQuotaCachePath = pluginDataDir ? path.join(pluginDataDir, 'quota_cache.json') : '';
  const pluginLsEnvPath = pluginDataDir ? path.join(pluginDataDir, 'ls_env.json') : '';
  const cliQuotaCachePath = path.join(homeDir, '.gemini', 'tmp', 'real_quota_cache.json');
  const cliLsEnvPath = path.join(homeDir, '.gemini', 'tmp', 'antigravity_ls_env.json');

  let lsAddr = typeof env.ANTIGRAVITY_LS_ADDRESS === 'string' ? env.ANTIGRAVITY_LS_ADDRESS.trim() : '';
  let csrfToken = typeof env.ANTIGRAVITY_CSRF_TOKEN === 'string' ? env.ANTIGRAVITY_CSRF_TOKEN.trim() : '';
  let preferHttps = false;
  let lsEnvSource = lsAddr ? 'env' : 'none';

  if ((!lsAddr || !csrfToken) && pluginLsEnvPath) {
    const saved = await readJsonSafeAsync(pluginLsEnvPath);
    if (saved?.ls_address && saved?.csrf_token) {
      lsAddr = saved.ls_address;
      csrfToken = saved.csrf_token;
      preferHttps = Boolean(saved.prefer_https);
      lsEnvSource = 'plugin_data';
    }
  }

  // 嚴格唯讀退讓：若 2.0 尚未觸發 Hook，唯讀讀取 CLI 既有 antigravity_ls_env.json（絕不寫入或刪除）
  if (!lsAddr || !csrfToken) {
    const cliSaved = await readJsonSafeAsync(cliLsEnvPath);
    if (cliSaved?.ls_address && cliSaved?.csrf_token) {
      lsAddr = cliSaved.ls_address;
      csrfToken = cliSaved.csrf_token;
      preferHttps = Boolean(cliSaved.prefer_https);
      lsEnvSource = 'cli_ls_env';
    }
  }

  let liveData = null;
  let runtimeTelemetry = null;
  let warning = '';

  if (lsAddr) {
    const { host, port } = parseHostPort(lsAddr);
    if (!isNaN(port) && port > 0 && host) {
      try {
        const [statusRes, summaryRes, modelsRes, pagedRuntime] = await Promise.all([
          requestUserStatus(port, csrfToken, host, preferHttps),
          requestQuotaSummary(port, csrfToken, host, preferHttps).catch(() => null),
          requestAvailableModels(port, csrfToken, host, preferHttps).catch(() => null),
          fetchPaginatedRuntimeTelemetryAsync({
            port,
            csrfToken,
            host,
            preferHttps,
            conversationId,
            requestFn: requestTrajectoryGeneratorMetadataFn
          }).catch(() => null)
        ]);

        const allModels = {};
        const userStatus = statusRes?.userStatus || {};
        for (const model of userStatus.cascadeModelConfigData?.clientModelConfigs || []) {
          const qi = model?.quotaInfo;
          if (!qi) continue;
          let fraction = 1;
          if (qi.remainingFraction !== undefined) fraction = parseFloat(qi.remainingFraction);
          else if (qi.resetTime) fraction = 0;
          else continue;
          const label = model.label || model.modelOrAlias?.model || 'Unknown';
          const remaining = Math.max(0, Math.min(100, fraction > 1 ? fraction : fraction * 100));
          const entry = { name: label, remaining_percentage: remaining };
          if (qi.resetTime) entry.reset_time = qi.resetTime;
          const normKey = normalizeModelName(label);
          if (!allModels[normKey] || entry.remaining_percentage < allModels[normKey].remaining_percentage) {
            allModels[normKey] = entry;
          }
        }

        const weekly = summaryRes ? parseWeeklyBuckets(summaryRes) : {};
        const shortTerm = summaryRes ? parseShortTermBuckets(summaryRes) : {};
        const modelPools = summaryRes ? parseModelPools(summaryRes) : {};
        const inferredPools = inferModelPoolsFromModels(allModels, shortTerm);
        for (const [k, pool] of Object.entries(inferredPools)) {
          if (!modelPools[k]) modelPools[k] = pool;
        }
        const modelLimits = modelsRes ? parseModelLimits(modelsRes) : {};

        if (pagedRuntime) {
          runtimeTelemetry = pagedRuntime;
        }

        const now = Date.now();
        liveData = {
          models: allModels,
          weekly,
          shortTerm,
          modelPools,
          modelLimits,
          updatedAt: now,
          lsUpdatedAt: now,
          email: userStatus.email || '',
          planTier: userStatus.userTier?.name || '',
          planStatus: userStatus.planStatus || {}
        };
      } catch (err) {
        warning = err?.message || 'LS unreachable';
      }
    }
  }

  if (liveData) {
    if (pluginQuotaCachePath) {
      try {
        const prev = await readJsonSafeAsync(pluginQuotaCachePath);
        if (prev) {
          liveData.shortTerm = mergeQuotaBuckets(prev.shortTerm, liveData.shortTerm, true);
          liveData.weekly = mergeQuotaBuckets(prev.weekly, liveData.weekly, true);
          const nowMs = Date.now();
          const validPrevModels = {};
          for (const [k, v] of Object.entries(prev.models || {})) {
            if (!v || typeof v !== 'object') continue;
            const rMs = v.reset_time ? new Date(v.reset_time).getTime() : 0;
            if (!rMs || isNaN(rMs) || rMs > nowMs) {
              validPrevModels[k] = v;
            }
          }
          liveData.models = { ...validPrevModels, ...(liveData.models || {}) };
          liveData.modelPools = { ...(prev.modelPools || {}), ...(liveData.modelPools || {}) };
          liveData.modelLimits = { ...(prev.modelLimits || {}), ...(liveData.modelLimits || {}) };
          if (!liveData.email && prev.email) liveData.email = prev.email;
          if (!liveData.planTier && prev.planTier) liveData.planTier = prev.planTier;
        }
        await writeFileAndVerifyNoBOM(pluginQuotaCachePath, JSON.stringify(liveData, null, 2));
      } catch (_) {}
    }
    return {
      cache: liveData,
      runtimeTelemetry,
      telemetryStatus: {
        lsConnected: true,
        lsEnvSource,
        source: 'live',
        warning: ''
      }
    };
  }

  const pluginCache = pluginQuotaCachePath ? await readJsonSafeAsync(pluginQuotaCachePath) : null;
  if (pluginCache) {
    return {
      cache: pluginCache,
      runtimeTelemetry,
      telemetryStatus: {
        lsConnected: false,
        lsEnvSource,
        source: 'plugin_cache',
        warning
      }
    };
  }

  const cliCache = await readJsonSafeAsync(cliQuotaCachePath);
  if (cliCache) {
    return {
      cache: cliCache,
      runtimeTelemetry,
      telemetryStatus: {
        lsConnected: false,
        lsEnvSource,
        source: 'cli_cache',
        warning
      }
    };
  }

  return {
    cache: null,
    runtimeTelemetry,
    telemetryStatus: {
      lsConnected: false,
      lsEnvSource,
      source: 'public_only',
      warning
    }
  };
}
