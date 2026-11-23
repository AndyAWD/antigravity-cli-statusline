import { unlinkSync } from 'fs';
import { join } from 'path';
import http from 'http';
import https from 'https';
import os from 'os';
import { isDirectExecution, readJsonSafeSync, writeFileSyncAndVerifyNoBOM } from './lib/core/fs-utils.mjs';
import { normalizeModelName, sanitizeConversationId } from './lib/core/normalize.mjs';
import { inferModelPoolsFromModels, mergeQuotaBuckets, parseModelPools } from './lib/collectors/quota.mjs';
import {
  extractDetailedRuntimeContext,
  fetchPaginatedTrajectoryMetadataAsync,
  mergeQuotaCacheSnapshots,
  parseHostPort,
  parseUserStatusModels
} from './lib/collectors/ls-rpc.mjs';
import { formatResetTime } from './lib/collectors/time-format.mjs';

export { sanitizeConversationId, formatResetTime, mergeQuotaBuckets };

const DEFAULT_RPC_PAYLOAD = {
  metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' }
};

function getTmpDir() {
  return join(os.homedir(), '.gemini', 'tmp');
}

function requestRpc(host, port, csrfToken, rpcPath, useHttps = false, payload = null) {
  return new Promise((resolve, reject) => {
    const client = useHttps ? https : http;
    const postData = JSON.stringify(payload || DEFAULT_RPC_PAYLOAD);

    const options = {
      hostname: host || '127.0.0.1',
      port: port,
      path: rpcPath,
      method: 'POST',
      rejectUnauthorized: false,
      timeout: 2000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'X-Codeium-Csrf-Token': csrfToken || '',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) { reject(e); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

function requestService(host, port, csrfToken, rpcPath, preferHttps = true, payload = null) {
  return requestRpc(host, port, csrfToken, rpcPath, preferHttps, payload).catch((err) => {
    // 若伺服器已完成 TLS/HTTP 握手並回傳 HTTP 狀態碼錯誤（如 401/404/400），
    // 說明該協定已握手成功，不可切換協定。對 Go TLS 監聽端口發送明文 HTTP 會觸發終端握手錯誤。
    if (err.message && err.message.startsWith('HTTP ')) {
      throw err;
    }
    return requestRpc(host, port, csrfToken, rpcPath, !preferHttps, payload);
  });
}

export function requestUserStatus(port, csrfToken, host = '127.0.0.1', preferHttps = true) {
  return requestService(host, port, csrfToken, '/exa.language_server_pb.LanguageServerService/GetUserStatus', preferHttps);
}

/**
 * Sends a request to retrieve the weekly quota summary from the language server.
 * @param {number} port - The port number of the active language server.
 * @param {string} csrfToken - The CSRF token for request authentication.
 * @param {string} [host='127.0.0.1'] - The host of the active language server.
 * @param {boolean} [preferHttps=true] - Whether to try HTTPS first before falling back to HTTP.
 * @returns {Promise<object>} A promise resolving to the parsed response JSON object.
 */
export function requestQuotaSummary(port, csrfToken, host = '127.0.0.1', preferHttps = true) {
  return requestService(host, port, csrfToken, '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary', preferHttps);
}

/**
 * Requests the full available models catalog including checkpointer token limits.
 * @param {number} port - The port number of the active language server.
 * @param {string} csrfToken - The CSRF token for request authentication.
 * @param {string} [host='127.0.0.1'] - The host of the active language server.
 * @param {boolean} [preferHttps=true] - Whether to try HTTPS first before falling back to HTTP.
 * @returns {Promise<object>} A promise resolving to the GetAvailableModels response.
 */
export function requestAvailableModels(port, csrfToken, host = '127.0.0.1', preferHttps = true) {
  return requestService(host, port, csrfToken, '/exa.language_server_pb.LanguageServerService/GetAvailableModels', preferHttps);
}

/**
 * Requests trajectory generator metadata from an offset to inspect runtime context limits.
 * @param {number} port - The port number of the active language server.
 * @param {string} csrfToken - The CSRF token for request authentication.
 * @param {string} cascadeId - The conversation / trajectory ID.
 * @param {number} [offset=0] - The generatorMetadataOffset cursor.
 * @param {string} [host='127.0.0.1'] - The host of the active language server.
 * @param {boolean} [preferHttps=true] - Whether to try HTTPS first before falling back to HTTP.
 * @returns {Promise<object>} A promise resolving to the GetCascadeTrajectoryGeneratorMetadata response.
 */
export function requestTrajectoryGeneratorMetadata(port, csrfToken, cascadeId, offset = 0, host = '127.0.0.1', preferHttps = true) {
  return requestService(
    host,
    port,
    csrfToken,
    '/exa.language_server_pb.LanguageServerService/GetCascadeTrajectoryGeneratorMetadata',
    preferHttps,
    {
      cascadeId,
      generatorMetadataOffset: Math.max(0, Number(offset) || 0),
      includeMessages: false
    }
  );
}

function addLimitIndexEntry(index, key, entry, isPrimary) {
  if (!key) return;
  const existing = index[key];
  if (isPrimary) {
    index[key] = { ...entry, source: 'primary' };
    return;
  }
  if (!existing) {
    index[key] = { ...entry, source: 'displayName' };
    return;
  }
  if (existing.source === 'primary') {
    return;
  }
  if (existing.ambiguous || (existing.limit && entry.limit && existing.limit !== entry.limit)) {
    index[key] = { ...existing, limit: 0, ambiguous: true, source: 'displayName' };
  }
}

/**
 * Parses per-model compaction limits and physical window sizes from GetAvailableModels.
 * Indexes by normalized slug, model enum, and unambiguous displayName so meta.model.id
 * (which agy populates with displayName) and slugs both resolve cleanly.
 * @param {object} availableModelsResponse - Parsed response from GetAvailableModels.
 * @returns {Record<string, {limit: number, maxTokens: number, slug: string, displayName: string, model: string, ambiguous?: boolean}>}
 */
export function parseModelLimits(availableModelsResponse) {
  const index = {};
  if (!availableModelsResponse || typeof availableModelsResponse !== 'object') return index;
  const modelsMap = availableModelsResponse.response?.models || availableModelsResponse.models;
  if (!modelsMap || typeof modelsMap !== 'object' || Array.isArray(modelsMap)) return index;

  for (const [slug, modelObj] of Object.entries(modelsMap)) {
    if (!modelObj || typeof modelObj !== 'object') continue;
    const maxTokens = Number(modelObj.maxTokens || 0);
    const exps = modelObj.modelExperiments?.experiments;
    const cpRaw = exps?.CASCADE_USE_EXPERIMENT_CHECKPOINTER?.stringValue;
    let limit = 0;
    if (typeof cpRaw === 'string' && cpRaw.trim()) {
      try {
        const parsed = JSON.parse(cpRaw);
        if (parsed && parsed.enabled !== false) {
          const parsedLimit = Number(parsed.max_token_limit);
          if (!isNaN(parsedLimit) && parsedLimit > 0) {
            limit = parsedLimit;
          }
        }
      } catch (_) {}
    }

    if (limit <= 0 && maxTokens <= 0) continue;

    const displayName = typeof modelObj.displayName === 'string' ? modelObj.displayName.trim() : '';
    const modelEnum = typeof modelObj.model === 'string' ? modelObj.model.trim() : '';
    const entry = {
      limit,
      maxTokens: maxTokens > 0 ? maxTokens : 0,
      slug,
      displayName,
      model: modelEnum
    };

    const normSlug = normalizeModelName(slug);
    const normEnum = normalizeModelName(modelEnum);
    const normDisplay = normalizeModelName(displayName);

    addLimitIndexEntry(index, normSlug, entry, true);
    if (normEnum && normEnum !== normSlug) {
      addLimitIndexEntry(index, normEnum, entry, true);
    }
    if (normDisplay && normDisplay !== normSlug && normDisplay !== normEnum) {
      addLimitIndexEntry(index, normDisplay, entry, false);
    }
  }

  return index;
}

/**
 * Extracts the latest runtime maxContextTokens and model identifiers from generatorMetadata.
 * @param {object} genMetaResponse - Parsed response from GetCascadeTrajectoryGeneratorMetadata.
 * @returns {{maxContextTokens: number, modelDisplayName: string, model: string, count: number}}
 */
export function extractRuntimeGeneratorContext(genMetaResponse) {
  const detail = extractDetailedRuntimeContext(genMetaResponse);
  return {
    maxContextTokens: detail.maxContextTokens,
    modelDisplayName: detail.modelDisplayName,
    model: detail.model,
    count: detail.count
  };
}

/**
 * Extracts weekly quota buckets from a RetrieveUserQuotaSummary response.
 * @param {object} summaryResponse - The parsed JSON response object from the language server.
 * @returns {Object<string, {remaining_percentage: number, reset_time?: string, refreshes_in?: string}>} Map of weekly pool remaining quota, reset time, and formatted refresh countdown.
 */
export function parseWeeklyBuckets(summaryResponse) {
  const weekly = {};
  if (!summaryResponse) return weekly;
  const resObj = summaryResponse.response || summaryResponse;
  if (!resObj.groups) return weekly;
  for (const group of resObj.groups) {
    if (!group.buckets) continue;
    for (const bucket of group.buckets) {
      const windowVal = (bucket.window || bucket.windowVal || '').toLowerCase();
      const bucketId = bucket.bucketId || '';
      if (!bucketId) continue;
      const lowerId = bucketId.toLowerCase();
      const isShortTermSuffix = /-(5h|3h|hourly|shortterm)$/i.test(bucketId);
      const isWeekly = windowVal === 'weekly' || (!windowVal && (lowerId.endsWith('-weekly') || ((lowerId.includes('argon') || lowerId.endsWith('-wtu')) && !isShortTermSuffix)));
      if (!isWeekly) continue;
      const pool = bucketId.replace(/-weekly$/, '');

      let fraction = 1;
      const remainingField = bucket.remainingFraction !== undefined ? bucket.remainingFraction : bucket.remaining;
      if (remainingField !== undefined && remainingField !== null) {
        fraction = parseFloat(remainingField);
      } else if (bucket.resetTime || bucket.reset) {
        fraction = 0;
      }

      const remainingNum = fraction > 1 ? fraction : fraction * 100;
      const remaining = Math.max(0, Math.min(100, remainingNum));

      const entry = {
        remaining_percentage: remaining,
        window: 'weekly'
      };

      const resetTime = bucket.resetTime || bucket.reset;
      if (resetTime) {
        entry.reset_time = resetTime;
        entry.refreshes_in = formatResetTime(resetTime);
      }

      if (!weekly[pool] || entry.remaining_percentage < weekly[pool].remaining_percentage) {
        weekly[pool] = entry;
      }
    }
  }
  return weekly;
}

/**
 * Extracts short-term (5h / 3h / hourly) quota buckets from a RetrieveUserQuotaSummary response.
 * @param {object} summaryResponse - The parsed JSON response object from the language server.
 * @returns {Object<string, {remaining_percentage: number, reset_time?: string, refreshes_in?: string}>} Map of short-term pool remaining quota, reset time, and formatted refresh countdown.
 */
export function parseShortTermBuckets(summaryResponse) {
  const shortTerm = {};
  if (!summaryResponse) return shortTerm;
  const resObj = summaryResponse.response || summaryResponse;
  if (!resObj.groups) return shortTerm;
  for (const group of resObj.groups) {
    if (!group.buckets) continue;
    for (const bucket of group.buckets) {
      const windowVal = (bucket.window || bucket.windowVal || '').toLowerCase();
      const bucketId = bucket.bucketId || '';
      if (!bucketId) continue;
      const lowerId = bucketId.toLowerCase();
      const isShortTermSuffix = /-(5h|3h|hourly|shortterm)$/i.test(bucketId);
      const isWeekly = windowVal === 'weekly' || (!windowVal && (lowerId.endsWith('-weekly') || ((lowerId.includes('argon') || lowerId.endsWith('-wtu')) && !isShortTermSuffix)));
      if (isWeekly) continue;
      const pool = bucketId.replace(/-(5h|3h|hourly|shortterm)$/, '');

      let fraction = 1;
      const remainingField = bucket.remainingFraction !== undefined ? bucket.remainingFraction : bucket.remaining;
      if (remainingField !== undefined && remainingField !== null) {
        fraction = parseFloat(remainingField);
      } else if (bucket.resetTime || bucket.reset) {
        fraction = 0;
      }

      const remainingNum = fraction > 1 ? fraction : fraction * 100;
      const remaining = Math.max(0, Math.min(100, remainingNum));

      const entry = {
        remaining_percentage: remaining
      };

      const resetTime = bucket.resetTime || bucket.reset;
      if (resetTime) {
        entry.reset_time = resetTime;
        entry.refreshes_in = formatResetTime(resetTime);
      }

      if (!shortTerm[pool] || entry.remaining_percentage < shortTerm[pool].remaining_percentage) {
        shortTerm[pool] = entry;
      }
    }
  }
  return shortTerm;
}

export function persistRuntimeContextToCtxFile(ctxCachePath, runtimeContext) {
  if (!ctxCachePath || !runtimeContext) return;
  const hasMaxCtx = typeof runtimeContext.maxContextTokens === 'number' && runtimeContext.maxContextTokens > 0;
  const hasRuntimeModel = Boolean(
    (typeof runtimeContext.modelDisplayName === 'string' && runtimeContext.modelDisplayName.trim()) ||
    (typeof runtimeContext.model === 'string' && runtimeContext.model.trim())
  );
  const hasOffset = typeof runtimeContext.nextOffset === 'number' && runtimeContext.nextOffset > 0;
  if (!hasMaxCtx && !hasRuntimeModel && !hasOffset) return;

  const existing = readJsonSafeSync(ctxCachePath) || {};
  const merged = { ...existing };
  if (hasMaxCtx) {
    merged.runtime_max_context_tokens = runtimeContext.maxContextTokens;
  }
  if (hasMaxCtx || hasRuntimeModel) {
    merged.runtime_model_display_name = runtimeContext.modelDisplayName || merged.runtime_model_display_name || '';
    merged.runtime_model_enum = runtimeContext.model || merged.runtime_model_enum || '';
    merged.runtime_model_key = normalizeModelName(runtimeContext.modelDisplayName || runtimeContext.model || '') || merged.runtime_model_key || '';
  }
  if (hasOffset && runtimeContext.nextOffset >= Number(existing.generator_metadata_offset || 0)) {
    merged.generator_metadata_offset = runtimeContext.nextOffset;
  }
  writeFileSyncAndVerifyNoBOM(ctxCachePath, JSON.stringify(merged));
}

async function fetchTrajectoryGeneratorContextAsync(port, csrfToken, host, preferHttps, conversationId, ctxCachePath) {
  const existingCtx = readJsonSafeSync(ctxCachePath);
  const startOffset = Math.max(0, Number(existingCtx?.generator_metadata_offset || 0) || 0);
  const paged = await fetchPaginatedTrajectoryMetadataAsync({
    port,
    csrfToken,
    host,
    preferHttps,
    conversationId,
    startOffset,
    requestFn: requestTrajectoryGeneratorMetadata
  });

  const best = paged.telemetry || { maxContextTokens: 0, modelDisplayName: '', model: '' };
  if (best.maxContextTokens <= 0 && !best.modelDisplayName && !best.model && paged.nextOffset === startOffset) {
    return null;
  }
  return {
    maxContextTokens: best.maxContextTokens || 0,
    modelDisplayName: best.modelDisplayName || '',
    model: best.model || '',
    nextOffset: paged.nextOffset
  };
}

export async function fetchLiveQuotaCache(options = {}) {
  const allModels = {};
  const weekly = {};
  const shortTerm = {};
  const modelPools = {};
  let modelLimits = {};
  let modelLimitsUpdatedAt = 0;
  let runtimeContext = null;
  let accountEmail = '';
  let planTierName = '';
  let planStatusData = {};

  const processStatusAndSummary = (response, summaryResponse) => {
    const userStatus = response?.userStatus || {};
    if (userStatus.email) accountEmail = userStatus.email;
    if (userStatus.userTier?.name) planTierName = userStatus.userTier.name;
    if (userStatus.planStatus) planStatusData = userStatus.planStatus;

    const parsedModels = parseUserStatusModels(userStatus);
    for (const [normKey, entry] of Object.entries(parsedModels)) {
      if (!allModels[normKey] || entry.remaining_percentage < allModels[normKey].remaining_percentage) {
        allModels[normKey] = entry;
      }
    }

    if (summaryResponse) {
      const weeklyBuckets = parseWeeklyBuckets(summaryResponse);
      for (const pool of Object.keys(weeklyBuckets)) {
        if (!weekly[pool] || weeklyBuckets[pool].remaining_percentage < weekly[pool].remaining_percentage) {
          weekly[pool] = weeklyBuckets[pool];
        }
      }
      const shortTermBuckets = parseShortTermBuckets(summaryResponse);
      for (const pool of Object.keys(shortTermBuckets)) {
        if (!shortTerm[pool] || shortTermBuckets[pool].remaining_percentage < shortTerm[pool].remaining_percentage) {
          shortTerm[pool] = shortTermBuckets[pool];
        }
      }
      const parsedPools = parseModelPools(summaryResponse);
      Object.assign(modelPools, parsedPools);
    }

    const inferredPools = inferModelPoolsFromModels(allModels, shortTerm);
    for (const [k, pool] of Object.entries(inferredPools)) {
      if (!modelPools[k]) {
        modelPools[k] = pool;
      }
    }
  };

  // 1. 優先使用 Antigravity CLI 注入的環境變數 (極速直連，零進程開銷)
  let envLsAddr = process.env.ANTIGRAVITY_LS_ADDRESS;
  let envCsrfToken = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
  let envPreferHttps = false;
  let envLoadedFromDisk = false;
  const envCachePath = join(getTmpDir(), 'antigravity_ls_env.json');

  // 若 statusLine.command 等子進程環境未繼承環境變數，從最新會話快取中載入
  if (!envLsAddr || !envCsrfToken) {
    const savedEnv = readJsonSafeSync(envCachePath);
    if (savedEnv) {
      if (!envLsAddr && savedEnv.ls_address) {
        envLsAddr = savedEnv.ls_address;
        envLoadedFromDisk = true;
      }
      if (!envCsrfToken && savedEnv.csrf_token) envCsrfToken = savedEnv.csrf_token;
      if (savedEnv.prefer_https !== undefined) envPreferHttps = Boolean(savedEnv.prefer_https);
    }
  } else {
    // 將有效的直連位址與 Token 持久化，供後續未獲取環境變數的 Hook 子進程共用
    try {
      writeFileSyncAndVerifyNoBOM(envCachePath, JSON.stringify({
        ls_address: envLsAddr,
        csrf_token: envCsrfToken,
        prefer_https: false,
        updatedAt: Date.now()
      }, null, 2));
    } catch (_) {}
  }

  const convId = sanitizeConversationId(options?.conversationId || process.env.STATUSLINE_CONVERSATION_ID || '');
  const ctxCachePath = (convId && convId !== 'default') ? join(getTmpDir(), `ctx_${convId}.json`) : '';

  if (envLsAddr) {
    try {
      const { host, port } = parseHostPort(envLsAddr);
      if (!isNaN(port) && port > 0 && host) {
        // 併行請求 GetUserStatus、RetrieveUserQuotaSummary、GetAvailableModels 與對話執行期 metadata 以縮短延遲
        const [response, summaryResponse, availableModelsResponse, genCtx] = await Promise.all([
          requestUserStatus(port, envCsrfToken, host, envPreferHttps),
          requestQuotaSummary(port, envCsrfToken, host, envPreferHttps).catch(() => null),
          requestAvailableModels(port, envCsrfToken, host, envPreferHttps).catch(() => null),
          ctxCachePath
            ? fetchTrajectoryGeneratorContextAsync(port, envCsrfToken, host, envPreferHttps, convId, ctxCachePath).catch(() => null)
            : Promise.resolve(null)
        ]);
        processStatusAndSummary(response, summaryResponse);
        if (availableModelsResponse) {
          modelLimits = parseModelLimits(availableModelsResponse);
          if (Object.keys(modelLimits).length > 0) {
            modelLimitsUpdatedAt = Date.now();
          }
        }
        if (genCtx) {
          runtimeContext = genCtx;
        }
      }
    } catch (_) {
      // 若從磁碟快取載入的連線位址失效（舊會話已終止），清除過期的 token 與快取檔案
      if (envLoadedFromDisk) {
        envCsrfToken = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
        try { unlinkSync(envCachePath); } catch (_) {}
      }
    }
  }

  if (
    Object.keys(allModels).length > 0 ||
    Object.keys(weekly).length > 0 ||
    Object.keys(shortTerm).length > 0 ||
    Object.keys(modelPools).length > 0 ||
    Object.keys(modelLimits).length > 0 ||
    runtimeContext
  ) {
    const now = Date.now();
    const result = {
      models: allModels,
      weekly,
      shortTerm,
      modelPools,
      modelLimits,
      ...(modelLimitsUpdatedAt > 0 ? { modelLimitsUpdatedAt } : {}),
      updatedAt: now,
      lsUpdatedAt: now,
      email: accountEmail,
      planTier: planTierName,
      planStatus: planStatusData
    };
    if (runtimeContext) {
      Object.defineProperty(result, '_runtimeContext', {
        value: runtimeContext,
        enumerable: false
      });
    }
    return result;
  }
  return null;
}

async function main() {
  try {
    const convId = sanitizeConversationId(process.env.STATUSLINE_CONVERSATION_ID || '');
    const cache = await fetchLiveQuotaCache({ conversationId: convId });
    if (cache) {
      const tmpDir = getTmpDir();
      if (cache._runtimeContext && convId && convId !== 'default') {
        try {
          persistRuntimeContextToCtxFile(join(tmpDir, `ctx_${convId}.json`), cache._runtimeContext);
        } catch (_) {}
      }

      const hasCacheData =
        Object.keys(cache.models || {}).length > 0 ||
        Object.keys(cache.weekly || {}).length > 0 ||
        Object.keys(cache.shortTerm || {}).length > 0 ||
        Object.keys(cache.modelLimits || {}).length > 0;
      if (hasCacheData) {
        const cacheFilePath = join(tmpDir, 'real_quota_cache.json');
        const prev = readJsonSafeSync(cacheFilePath);
        const finalCache = prev ? mergeQuotaCacheSnapshots(prev, cache) : cache;
        writeFileSyncAndVerifyNoBOM(cacheFilePath, JSON.stringify(finalCache, null, 2));
      }
    }
  } catch (_) {}
}

// only auto-run when executed directly, not when imported by tests
if (isDirectExecution(import.meta.url, { treatEmptyArgv1AsDirect: true })) {
  main();
}
