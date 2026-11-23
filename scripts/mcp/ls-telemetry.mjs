import fs from 'node:fs';
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

const MAX_CONTEXT_CACHE_ENTRIES = 20;

function hasPositiveUsage(usage) {
  if (!usage || typeof usage !== 'object') return false;
  return (
    Number(usage.inputTokens || 0) > 0 ||
    Number(usage.cacheReadTokens || 0) > 0 ||
    Number(usage.outputTokens || 0) > 0
  );
}

/**
 * 合併兩筆脈絡遙測，避免串流進行中的不完整步驟（例如只有 maxContextTokens、尚未回填 usage）洗掉既有數值。
 * @param {object|null} prev
 * @param {object|null} next
 * @returns {object|null}
 */
export function mergeRuntimeTelemetry(prev, next) {
  if (!prev && !next) return null;
  if (!prev) return next;
  if (!next) return prev;

  const nextMaxCtx = Number(next.maxContextTokens || 0) || 0;
  const prevMaxCtx = Number(prev.maxContextTokens || 0) || 0;
  const nextEst = Number(next.estimatedTokensUsed || 0) || 0;
  const prevEst = Number(prev.estimatedTokensUsed || 0) || 0;

  let usage = prev.usage || null;
  if (hasPositiveUsage(next.usage) || (!usage && next.usage)) {
    usage = next.usage;
  }

  const tokenBreakdown = (Array.isArray(next.tokenBreakdown) && next.tokenBreakdown.length > 0)
    ? next.tokenBreakdown
    : (Array.isArray(prev.tokenBreakdown) ? prev.tokenBreakdown : []);

  return {
    maxContextTokens: nextMaxCtx > 0 ? nextMaxCtx : prevMaxCtx,
    estimatedTokensUsed: nextEst > 0 ? nextEst : prevEst,
    modelDisplayName: next.modelDisplayName || prev.modelDisplayName || '',
    model: next.model || prev.model || '',
    usage,
    tokenBreakdown
  };
}

/**
 * 自 GetCascadeTrajectoryGeneratorMetadata 回應擷取完整 tokenBreakdown 與 usage，
 * 各欄位獨立取最新非空／非零值並往前補齊。
 * @param {object} genMetaResponse
 * @returns {{ maxContextTokens: number, estimatedTokensUsed: number, modelDisplayName: string, model: string, usage: object|null, tokenBreakdown: Array<{ name: string, type: string, numTokens: number }> }}
 */
export function extractDetailedRuntimeContext(genMetaResponse) {
  const base = extractRuntimeGeneratorContext(genMetaResponse);
  const list = genMetaResponse?.generatorMetadata;
  let maxContextTokens = base.maxContextTokens || 0;
  let modelDisplayName = base.modelDisplayName || '';
  let model = base.model || '';
  let estimatedTokensUsed = 0;
  let usage = null;
  let fallbackZeroUsage = null;
  let tokenBreakdown = [];

  if (Array.isArray(list) && list.length > 0) {
    for (let i = list.length - 1; i >= 0; i--) {
      const cm = list[i]?.chatModel;
      if (!cm || typeof cm !== 'object') continue;

      if (!modelDisplayName && typeof cm.modelDisplayName === 'string' && cm.modelDisplayName.trim()) {
        modelDisplayName = cm.modelDisplayName.trim();
      }
      if (!model && typeof cm.model === 'string' && cm.model.trim()) {
        model = cm.model.trim();
      }

      const cwMeta = cm.chatStartMetadata?.contextWindowMetadata;
      if (cwMeta && typeof cwMeta === 'object') {
        if (maxContextTokens <= 0) {
          const mCtx = Number(cwMeta.maxContextTokens || 0);
          if (!isNaN(mCtx) && mCtx > 0) maxContextTokens = mCtx;
        }
        if (estimatedTokensUsed <= 0) {
          const est = Number(cwMeta.estimatedTokensUsed || 0);
          if (!isNaN(est) && est > 0) estimatedTokensUsed = est;
        }
        if (tokenBreakdown.length === 0) {
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
      }

      if (cm.usage && typeof cm.usage === 'object') {
        const parsedUsage = {
          inputTokens: Math.max(0, Number(cm.usage.inputTokens || 0) || 0),
          outputTokens: Math.max(0, Number(cm.usage.outputTokens || 0) || 0),
          thinkingOutputTokens: Math.max(0, Number(cm.usage.thinkingOutputTokens || 0) || 0),
          responseOutputTokens: Math.max(0, Number(cm.usage.responseOutputTokens || 0) || 0),
          cacheReadTokens: Math.max(0, Number(cm.usage.cacheReadTokens || 0) || 0)
        };
        if (hasPositiveUsage(parsedUsage)) {
          if (!usage) usage = parsedUsage;
        } else if (!fallbackZeroUsage) {
          fallbackZeroUsage = parsedUsage;
        }
      }

      if (
        maxContextTokens > 0 &&
        estimatedTokensUsed > 0 &&
        tokenBreakdown.length > 0 &&
        usage &&
        modelDisplayName &&
        model
      ) {
        break;
      }
    }
  }

  return {
    maxContextTokens,
    estimatedTokensUsed,
    modelDisplayName,
    model,
    usage: usage || fallbackZeroUsage,
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
  if (!conversationId) return { telemetry: null, notFound: false, rpcOk: false };
  const cached = runtimeCursorCache.get(conversationId) || { nextOffset: 0, telemetry: null };
  // 重讀最後一筆（nextOffset - 1），避免串流生成中只取得 maxContextTokens 後游標推進導致漏讀後續補齊的 usage 與 breakdown
  const startOffset = cached.nextOffset > 0 ? cached.nextOffset - 1 : 0;
  let offset = startOffset;
  let latestTelemetry = cached.telemetry || null;
  let notFound = false;
  let rpcOk = false;

  for (let page = 0; page < MAX_METADATA_PAGES; page++) {
    let resp = null;
    try {
      resp = await requestFn(port, csrfToken, conversationId, offset, host, preferHttps);
      rpcOk = true;
    } catch (err) {
      if (err?.message && /\b404\b/.test(err.message)) {
        notFound = true;
      }
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
      latestTelemetry = mergeRuntimeTelemetry(latestTelemetry, extracted);
    }
    offset += list.length;
    if (list.length < METADATA_PAGE_LIMIT) break;
  }

  if (latestTelemetry || offset > (cached.nextOffset || 0)) {
    runtimeCursorCache.set(conversationId, { nextOffset: offset, telemetry: latestTelemetry });
  }
  return { telemetry: latestTelemetry, notFound, rpcOk };
}

async function readContextCacheEntryAsync(pluginDataDir, conversationId) {
  if (!pluginDataDir || !conversationId) return null;
  const cachePath = path.join(pluginDataDir, 'context_cache.json');
  const data = await readJsonSafeAsync(cachePath);
  const entry = data?.contexts?.[conversationId];
  return (entry && typeof entry === 'object') ? entry : null;
}

async function persistContextCacheEntryAsync(pluginDataDir, conversationId, telemetry) {
  if (!pluginDataDir || !conversationId || !telemetry) return;
  const hasUsefulData =
    Number(telemetry.estimatedTokensUsed || 0) > 0 ||
    hasPositiveUsage(telemetry.usage) ||
    Number(telemetry.maxContextTokens || 0) > 0;
  if (!hasUsefulData) return;

  const cachePath = path.join(pluginDataDir, 'context_cache.json');
  try {
    const existing = (await readJsonSafeAsync(cachePath)) || {};
    const contexts = (existing.contexts && typeof existing.contexts === 'object' && !Array.isArray(existing.contexts))
      ? { ...existing.contexts }
      : {};
    const mergedEntry = mergeRuntimeTelemetry(contexts[conversationId] || null, telemetry);
    contexts[conversationId] = {
      ...mergedEntry,
      updatedAt: Date.now()
    };

    const sorted = Object.entries(contexts)
      .filter(([, v]) => v && typeof v === 'object')
      .sort((a, b) => Number(b[1].updatedAt || 0) - Number(a[1].updatedAt || 0))
      .slice(0, MAX_CONTEXT_CACHE_ENTRIES);
    const pruned = {};
    for (const [k, v] of sorted) pruned[k] = v;

    await writeFileAndVerifyNoBOM(cachePath, JSON.stringify({ version: 1, contexts: pruned }, null, 2));
  } catch (_) {}
}

async function buildLsEndpointCandidatesAsync({ env, pluginLsEnvPath, cliLsEnvPath }) {
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (lsAddress, csrfToken, preferHttps, source) => {
    const addr = typeof lsAddress === 'string' ? lsAddress.trim() : '';
    const token = typeof csrfToken === 'string' ? csrfToken.trim() : '';
    if (!addr || !token) return;
    const key = `${addr}|${token}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ lsAddr: addr, csrfToken: token, preferHttps: Boolean(preferHttps), source });
  };

  pushCandidate(env.ANTIGRAVITY_LS_ADDRESS, env.ANTIGRAVITY_CSRF_TOKEN, false, 'env');
  if (pluginLsEnvPath) {
    const saved = await readJsonSafeAsync(pluginLsEnvPath);
    pushCandidate(saved?.ls_address, saved?.csrf_token, saved?.prefer_https, 'plugin_data');
  }
  const cliSaved = await readJsonSafeAsync(cliLsEnvPath);
  pushCandidate(cliSaved?.ls_address, cliSaved?.csrf_token, cliSaved?.prefer_https, 'cli_ls_env');
  return candidates;
}

async function readCliCtxTelemetryFallbackAsync(homeDir, conversationId) {
  if (!homeDir || !conversationId) return null;
  const cliCtxPath = path.join(homeDir, '.gemini', 'tmp', `ctx_${conversationId}.json`);
  const cliCtx = await readJsonSafeAsync(cliCtxPath);
  if (!cliCtx || typeof cliCtx !== 'object') return null;

  const totalIn = Number(cliCtx.total_input_tokens || 0) || 0;
  const totalOut = Number(cliCtx.total_output_tokens || 0) || 0;
  const maxCtx = Number(cliCtx.runtime_max_context_tokens || 0) || 0;
  if (totalIn <= 0 && maxCtx <= 0) return null;

  return {
    maxContextTokens: maxCtx,
    estimatedTokensUsed: totalIn,
    modelDisplayName: typeof cliCtx.runtime_model_display_name === 'string' ? cliCtx.runtime_model_display_name : '',
    model: typeof cliCtx.runtime_model_enum === 'string' ? cliCtx.runtime_model_enum : '',
    usage: (totalIn > 0 || totalOut > 0)
      ? {
          inputTokens: totalIn,
          outputTokens: totalOut,
          thinkingOutputTokens: 0,
          responseOutputTokens: 0,
          cacheReadTokens: 0
        }
      : null,
    tokenBreakdown: [],
    contextWindowSize: Number(cliCtx.context_window_size || 0) || 0
  };
}

/**
 * 唯讀隔離版語言伺服器遙測採集器：
 * - 絕不寫入或刪除 ~/.gemini/tmp/*（CLI 檔案僅做唯讀退讓）。
 * - 僅將 2.0 快取寫入 pluginDataDir/{quota_cache,context_cache,ls_env}.json。
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

  const candidates = await buildLsEndpointCandidatesAsync({ env, pluginLsEnvPath, cliLsEnvPath });
  let lsEnvSource = candidates[0]?.source || 'none';

  let liveData = null;
  let runtimeTelemetry = null;
  let conversationNotFound = false;
  let lsReachable = false;
  let warning = '';

  for (const cand of candidates) {
    const { host, port } = parseHostPort(cand.lsAddr);
    if (isNaN(port) || port <= 0 || !host) continue;

    let statusErr = null;
    const [statusRes, summaryRes, modelsRes, pagedRuntime] = await Promise.all([
      requestUserStatus(port, cand.csrfToken, host, cand.preferHttps).catch((err) => {
        statusErr = err;
        return null;
      }),
      requestQuotaSummary(port, cand.csrfToken, host, cand.preferHttps).catch(() => null),
      requestAvailableModels(port, cand.csrfToken, host, cand.preferHttps).catch(() => null),
      fetchPaginatedRuntimeTelemetryAsync({
        port,
        csrfToken: cand.csrfToken,
        host,
        preferHttps: cand.preferHttps,
        conversationId,
        requestFn: requestTrajectoryGeneratorMetadataFn
      }).catch(() => ({ telemetry: null, notFound: false, rpcOk: false }))
    ]);

    const anyQuotaRpcOk = Boolean(statusRes || summaryRes || modelsRes);
    const runtimeRpcContacted = Boolean(pagedRuntime?.rpcOk || pagedRuntime?.notFound);
    if (!anyQuotaRpcOk && !runtimeRpcContacted) {
      if (statusErr?.message) warning = statusErr.message;
      continue;
    }

    lsReachable = true;
    lsEnvSource = cand.source;
    warning = '';
    conversationNotFound = Boolean(pagedRuntime?.notFound);
    if (pagedRuntime?.telemetry) {
      runtimeTelemetry = pagedRuntime.telemetry;
    }

    // 若環境變數有效連線且尚未持久化到 plugin_data/ls_env.json，則安全備份
    if (cand.source === 'env' && pluginLsEnvPath) {
      try {
        const existingEnv = await readJsonSafeAsync(pluginLsEnvPath);
        if (existingEnv?.ls_address !== cand.lsAddr || existingEnv?.csrf_token !== cand.csrfToken) {
          await writeFileAndVerifyNoBOM(
            pluginLsEnvPath,
            JSON.stringify({
              ls_address: cand.lsAddr,
              csrf_token: cand.csrfToken,
              prefer_https: cand.preferHttps,
              updatedAt: Date.now()
            }, null, 2)
          );
          if (process.platform !== 'win32') {
            try { fs.chmodSync(pluginLsEnvPath, 0o600); } catch (_) {}
          }
        }
      } catch (_) {}
    }

    if (anyQuotaRpcOk) {
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
    }

    break;
  }

  if (runtimeTelemetry && conversationId && pluginDataDir) {
    await persistContextCacheEntryAsync(pluginDataDir, conversationId, runtimeTelemetry);
  }

  if (!runtimeTelemetry && conversationId) {
    if (pluginDataDir && !conversationNotFound) {
      const cachedCtx = await readContextCacheEntryAsync(pluginDataDir, conversationId);
      if (cachedCtx) runtimeTelemetry = cachedCtx;
    }
    if (!runtimeTelemetry) {
      runtimeTelemetry = await readCliCtxTelemetryFallbackAsync(homeDir, conversationId);
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
      conversationNotFound,
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
      conversationNotFound,
      telemetryStatus: {
        lsConnected: lsReachable,
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
      conversationNotFound,
      telemetryStatus: {
        lsConnected: lsReachable,
        lsEnvSource,
        source: 'cli_cache',
        warning
      }
    };
  }

  return {
    cache: null,
    runtimeTelemetry,
    conversationNotFound,
    telemetryStatus: {
      lsConnected: lsReachable,
      lsEnvSource,
      source: 'public_only',
      warning
    }
  };
}
