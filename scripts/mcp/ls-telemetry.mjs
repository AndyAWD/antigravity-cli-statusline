import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseModelLimits,
  parseShortTermBuckets,
  parseWeeklyBuckets,
  requestAvailableModels,
  requestQuotaSummary,
  requestTrajectoryGeneratorMetadata,
  requestUserStatus
} from '../../skills/agy-cli-statusline/scripts/fetch-local-quota.mjs';
import {
  extractDetailedRuntimeContext,
  fetchPaginatedTrajectoryMetadataAsync,
  hasPositiveUsage,
  inferModelPoolsFromModels,
  mergeQuotaCacheSnapshots,
  mergeRuntimeTelemetry,
  parseHostPort,
  parseModelPools,
  parseUserStatusModels
} from '../../skills/agy-cli-statusline/scripts/lib/collectors/ls-rpc.mjs';
import {
  readJsonSafeAsync,
  writeFileAndVerifyNoBOM
} from '../../skills/agy-cli-statusline/scripts/lib/core/fs-utils.mjs';

export { extractDetailedRuntimeContext, mergeRuntimeTelemetry, parseHostPort };

const MAX_CONTEXT_CACHE_ENTRIES = 20;
const runtimeCursorCache = new Map();

export function resetLsTelemetryMemoryCache() {
  runtimeCursorCache.clear();
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
  const paged = await fetchPaginatedTrajectoryMetadataAsync({
    port,
    csrfToken,
    host,
    preferHttps,
    conversationId,
    startOffset,
    initialTelemetry: cached.telemetry || null,
    requestFn
  });

  if (paged.telemetry || paged.nextOffset > (cached.nextOffset || 0)) {
    runtimeCursorCache.set(conversationId, { nextOffset: paged.nextOffset, telemetry: paged.telemetry });
  }
  return { telemetry: paged.telemetry, notFound: paged.notFound, rpcOk: paged.rpcOk };
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
      const userStatus = statusRes?.userStatus || {};
      const now = Date.now();
      const allModels = parseUserStatusModels(userStatus, now);

      const weekly = summaryRes ? parseWeeklyBuckets(summaryRes) : {};
      const shortTerm = summaryRes ? parseShortTermBuckets(summaryRes) : {};
      const modelPools = summaryRes ? parseModelPools(summaryRes) : {};
      const inferredPools = inferModelPoolsFromModels(allModels, shortTerm);
      for (const [k, pool] of Object.entries(inferredPools)) {
        if (!modelPools[k]) modelPools[k] = pool;
      }
      const modelLimits = modelsRes ? parseModelLimits(modelsRes) : {};
      const modelLimitsUpdatedAt = Object.keys(modelLimits).length > 0 ? now : 0;

      liveData = {
        models: allModels,
        weekly,
        shortTerm,
        modelPools,
        modelLimits,
        ...(modelLimitsUpdatedAt > 0 ? { modelLimitsUpdatedAt } : {}),
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
          liveData = mergeQuotaCacheSnapshots(prev, liveData);
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

  const [pluginCache, cliCache] = await Promise.all([
    pluginQuotaCachePath ? readJsonSafeAsync(pluginQuotaCachePath) : Promise.resolve(null),
    readJsonSafeAsync(cliQuotaCachePath)
  ]);

  if (pluginCache && cliCache) {
    const pluginTs = Number(pluginCache.lsUpdatedAt || pluginCache.updatedAt || 0);
    const cliTs = Number(cliCache.lsUpdatedAt || cliCache.updatedAt || 0);
    if (cliTs > pluginTs) {
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
