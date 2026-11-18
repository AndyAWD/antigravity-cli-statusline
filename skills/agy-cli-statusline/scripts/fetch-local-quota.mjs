import { writeFileSync, mkdirSync, readFileSync, unlinkSync, renameSync, realpathSync } from 'fs';
import path, { dirname, join } from 'path';
import http from 'http';
import https from 'https';
import os from 'os';
import { fileURLToPath } from 'url';

const DEFAULT_RPC_PAYLOAD = {
  metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' }
};

function normalizeModelKey(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function sanitizeConversationId(id) {
  if (typeof id !== 'string' || !id.trim()) return '';
  return id.trim().replace(/\.\./g, '').replace(/\//g, '').replace(/\\/g, '');
}

function getTmpDir() {
  return join(os.homedir(), '.gemini', 'tmp');
}

function readJsonSafeSync(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch (_) {
    return null;
  }
}

export function formatResetTime(resetTimeStr) {
  try {
    if (!resetTimeStr || typeof resetTimeStr === 'boolean' || Array.isArray(resetTimeStr)) return '';
    const reset = new Date(resetTimeStr);
    const resetMs = reset.getTime();
    if (isNaN(resetMs)) return '';
    const diffSeconds = Math.floor((resetMs - Date.now()) / 1000);
    if (diffSeconds <= 0) return 'now';
    const minutes = Math.floor((diffSeconds + 59) / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remHours = hours % 24;
      return remHours ? `${days}d ${remHours}h` : `${days}d`;
    }
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
  } catch (e) {
    return '';
  }
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
          } catch(e) { reject(e); }
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

    const normSlug = normalizeModelKey(slug);
    const normEnum = normalizeModelKey(modelEnum);
    const normDisplay = normalizeModelKey(displayName);

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
  const list = genMetaResponse?.generatorMetadata;
  if (!Array.isArray(list) || list.length === 0) {
    return { maxContextTokens: 0, modelDisplayName: '', model: '', count: 0 };
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const cm = list[i]?.chatModel;
    const maxCtx = Number(cm?.chatStartMetadata?.contextWindowMetadata?.maxContextTokens || 0);
    if (!isNaN(maxCtx) && maxCtx > 0) {
      return {
        maxContextTokens: maxCtx,
        modelDisplayName: typeof cm?.modelDisplayName === 'string' ? cm.modelDisplayName.trim() : '',
        model: typeof cm?.model === 'string' ? cm.model.trim() : '',
        count: list.length
      };
    }
  }
  return { maxContextTokens: 0, modelDisplayName: '', model: '', count: list.length };
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
  const hasOffset = typeof runtimeContext.nextOffset === 'number' && runtimeContext.nextOffset > 0;
  if (!hasMaxCtx && !hasOffset) return;

  const existing = readJsonSafeSync(ctxCachePath) || {};
  const merged = { ...existing };
  if (hasMaxCtx) {
    merged.runtime_max_context_tokens = runtimeContext.maxContextTokens;
    merged.runtime_model_display_name = runtimeContext.modelDisplayName || '';
    merged.runtime_model_enum = runtimeContext.model || '';
    merged.runtime_model_key = normalizeModelKey(runtimeContext.modelDisplayName || runtimeContext.model || '');
  }
  if (hasOffset && runtimeContext.nextOffset >= Number(existing.generator_metadata_offset || 0)) {
    merged.generator_metadata_offset = runtimeContext.nextOffset;
  }
  mkdirSync(dirname(ctxCachePath), { recursive: true });
  writeFileSyncAndVerifyNoBOM(ctxCachePath, JSON.stringify(merged));
}

async function fetchTrajectoryGeneratorContextAsync(port, csrfToken, host, preferHttps, conversationId, ctxCachePath) {
  const existingCtx = readJsonSafeSync(ctxCachePath);
  let offset = Math.max(0, Number(existingCtx?.generator_metadata_offset || 0) || 0);
  const startOffset = offset;
  let best = { maxContextTokens: 0, modelDisplayName: '', model: '' };

  const MAX_PAGES = 5;
  const PAGE_LIMIT = 256;
  for (let page = 0; page < MAX_PAGES; page++) {
    let resp;
    try {
      resp = await requestTrajectoryGeneratorMetadata(port, csrfToken, conversationId, offset, host, preferHttps);
    } catch (_) {
      break;
    }
    const list = resp?.generatorMetadata;
    if (!Array.isArray(list) || list.length === 0) break;

    const extracted = extractRuntimeGeneratorContext(resp);
    if (extracted && extracted.maxContextTokens > 0) {
      best = {
        maxContextTokens: extracted.maxContextTokens,
        modelDisplayName: extracted.modelDisplayName,
        model: extracted.model
      };
    }
    offset += list.length;
    if (list.length < PAGE_LIMIT) break;
  }

  if (best.maxContextTokens <= 0 && offset === startOffset) {
    return null;
  }
  return {
    ...best,
    nextOffset: offset
  };
}

export async function fetchLiveQuotaCache(options = {}) {
  const allModels = {};
  const weekly = {};
  const shortTerm = {};
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

    const cascade = userStatus.cascadeModelConfigData || {};
    for (const model of cascade.clientModelConfigs || []) {
      const quotaInfo = model.quotaInfo;
      if (!quotaInfo) continue;

      let fraction = 1;
      if (quotaInfo.remainingFraction !== undefined) {
        fraction = parseFloat(quotaInfo.remainingFraction);
      } else if (quotaInfo.resetTime) {
        fraction = 0;
      } else {
        continue;
      }

      const label = model.label || (model.modelOrAlias && model.modelOrAlias.model) || 'Unknown';
      const remainingNum = fraction > 1 ? fraction : fraction * 100;
      const remaining = Math.max(0, Math.min(100, remainingNum));
      const entry = {
        name: label,
        remaining_percentage: remaining,
      };
      if (quotaInfo.resetTime) {
        entry.reset_time = quotaInfo.resetTime;
        entry.refreshes_in = formatResetTime(quotaInfo.resetTime);
      }
      const normKey = label.toLowerCase().replace(/[^a-z0-9]+/g, '');
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
    try {
      const savedEnv = JSON.parse(readFileSync(envCachePath, 'utf8'));
      if (!envLsAddr && savedEnv.ls_address) {
        envLsAddr = savedEnv.ls_address;
        envLoadedFromDisk = true;
      }
      if (!envCsrfToken && savedEnv.csrf_token) envCsrfToken = savedEnv.csrf_token;
      if (savedEnv.prefer_https !== undefined) envPreferHttps = Boolean(savedEnv.prefer_https);
    } catch (_) {}
  } else {
    // 將有效的直連位址與 Token 持久化，供後續未獲取環境變數的 Hook 子進程共用
    try {
      mkdirSync(dirname(envCachePath), { recursive: true });
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
      const [host, portStr] = envLsAddr.split(':');
      const port = parseInt(portStr, 10);
      if (!isNaN(port)) {
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
    Object.keys(modelLimits).length > 0 ||
    runtimeContext
  ) {
    const now = Date.now();
    const result = {
      models: allModels,
      weekly,
      shortTerm,
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

function writeFileSyncAndVerifyNoBOM(filePath, content) {
  const dir = dirname(filePath);
  const tmpPath = join(dir, `.tmp_${path.basename(filePath)}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  writeFileSync(tmpPath, content, { encoding: 'utf8' });
  let buffer = readFileSync(tmpPath);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    buffer = buffer.slice(3);
    writeFileSync(tmpPath, buffer);
  }
  renameSync(tmpPath, filePath);
}

export function mergeQuotaBuckets(baseBuckets = {}, incomingBuckets = {}, preferLowerWhenSameReset = true) {
  const safeBase = (baseBuckets && typeof baseBuckets === 'object' && !Array.isArray(baseBuckets)) ? baseBuckets : {};
  const safeIncoming = (incomingBuckets && typeof incomingBuckets === 'object' && !Array.isArray(incomingBuckets)) ? incomingBuckets : {};
  const merged = { ...safeBase };
  const now = Date.now();

  for (const [pool, inc] of Object.entries(safeIncoming)) {
    if (!inc || typeof inc !== 'object') continue;
    const existing = merged[pool];
    const existResetMs = existing?.reset_time ? new Date(existing.reset_time).getTime() : 0;
    const incResetMs = inc.reset_time ? new Date(inc.reset_time).getTime() : 0;
    const lowerPool = pool.toLowerCase();
    const isWeekly = lowerPool.includes('weekly') || lowerPool.includes('argon') || lowerPool.endsWith('-wtu') ||
      existing?.window === 'weekly' || inc?.window === 'weekly' ||
      Math.max(existResetMs - now, incResetMs - now) > 12 * 60 * 60 * 1000;

    if (!existing || typeof existing !== 'object') {
      const dynamicInc = inc.reset_time ? formatResetTime(inc.reset_time) : '';
      merged[pool] = dynamicInc ? { ...inc, refreshes_in: dynamicInc } : inc;
      if (isWeekly) merged[pool].window = 'weekly';
      continue;
    }

    const hasValidExistReset = existResetMs > 0 && !isNaN(existResetMs);
    const hasValidIncReset = incResetMs > 0 && !isNaN(incResetMs);

    // 1. 過期判定：若既有配額之重置時間已過期，且傳入配額具備較新重置時間或無時間戳記之100%重置額度，舊窗口讓位給新進入配額
    if (hasValidExistReset && existResetMs <= now && (incResetMs > existResetMs || (!hasValidIncReset && inc.remaining_percentage >= 100))) {
      const dynamicInc = inc.reset_time ? formatResetTime(inc.reset_time) : '';
      merged[pool] = dynamicInc ? { ...inc, refreshes_in: dynamicInc } : inc;
      if (isWeekly) merged[pool].window = 'weekly';
      continue;
    }
    // 若傳入配額本身已過期，但既有配額仍處於未來有效窗口中，保留既有配額
    if (hasValidIncReset && incResetMs <= now && hasValidExistReset && existResetMs > now) {
      const dynamicExist = existing.reset_time ? formatResetTime(existing.reset_time) : '';
      merged[pool] = dynamicExist ? { ...existing, refreshes_in: dynamicExist } : existing;
      if (isWeekly) merged[pool].window = 'weekly';
      continue;
    }

    // 2. 跨重置窗口判定：依配額池類別動態設定時間門檻
    // 週額度與 Argon 週期為 7 日，門檻設為 24 小時；五小時/短週期額度門檻設為 2 小時，消除長對話時序漂移
    const windowThresholdMs = isWeekly ? 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;

    if (hasValidExistReset && hasValidIncReset && Math.abs(incResetMs - existResetMs) > windowThresholdMs) {
      const chosen = incResetMs > existResetMs ? inc : existing;
      const dynamicChosen = chosen.reset_time ? formatResetTime(chosen.reset_time) : '';
      merged[pool] = dynamicChosen ? { ...chosen, refreshes_in: dynamicChosen } : chosen;
      if (isWeekly) merged[pool].window = 'weekly';
      continue;
    }

    if (!preferLowerWhenSameReset) {
      const dynamicInc = inc.reset_time ? formatResetTime(inc.reset_time) : '';
      merged[pool] = dynamicInc ? { ...inc, refreshes_in: dynamicInc } : inc;
      if (isWeekly) merged[pool].window = 'weekly';
      continue;
    }

    const hasExistPct = typeof existing.remaining_percentage === 'number' && !isNaN(existing.remaining_percentage);
    const hasIncPct = typeof inc.remaining_percentage === 'number' && !isNaN(inc.remaining_percentage);
    if (hasExistPct && hasIncPct) {
      const lowerEntry = existing.remaining_percentage <= inc.remaining_percentage ? existing : inc;
      const higherEntry = existing.remaining_percentage <= inc.remaining_percentage ? inc : existing;
      const targetResetTime = lowerEntry.reset_time || higherEntry.reset_time;
      let dynamicRefreshesIn = '';
      if (targetResetTime) {
        dynamicRefreshesIn = formatResetTime(targetResetTime);
      }
      merged[pool] = {
        ...higherEntry,
        ...lowerEntry,
        remaining_percentage: Math.min(existing.remaining_percentage, inc.remaining_percentage),
        reset_time: targetResetTime,
        refreshes_in: dynamicRefreshesIn || inc.refreshes_in || lowerEntry.refreshes_in || higherEntry.refreshes_in
      };
      if (isWeekly) merged[pool].window = 'weekly';
    } else if (hasIncPct) {
      const dynamicInc = inc.reset_time ? formatResetTime(inc.reset_time) : '';
      merged[pool] = dynamicInc ? { ...inc, refreshes_in: dynamicInc } : inc;
      if (isWeekly) merged[pool].window = 'weekly';
    } else {
      const dynamicExist = existing.reset_time ? formatResetTime(existing.reset_time) : '';
      merged[pool] = dynamicExist ? { ...existing, refreshes_in: dynamicExist } : existing;
      if (isWeekly) merged[pool].window = 'weekly';
    }
  }
  return merged;
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
        if (prev) {
          if (prev.lastAgentState !== undefined) cache.lastAgentState = prev.lastAgentState;
          if (prev.lastOutputTokens !== undefined) cache.lastOutputTokens = prev.lastOutputTokens;
          if (prev.lastTotalTokens !== undefined) cache.lastTotalTokens = prev.lastTotalTokens;
          if (prev.lastPollAttemptAt !== undefined) cache.lastPollAttemptAt = prev.lastPollAttemptAt;
          if (prev.lastModelKey !== undefined) cache.lastModelKey = prev.lastModelKey;
          if (prev.lastModelLimitAttemptAt !== undefined) cache.lastModelLimitAttemptAt = prev.lastModelLimitAttemptAt;
          cache.shortTerm = mergeQuotaBuckets(prev.shortTerm, cache.shortTerm, true);
          cache.weekly = mergeQuotaBuckets(prev.weekly, cache.weekly, true);
          cache.models = { ...(prev.models || {}), ...(cache.models || {}) };
          cache.modelLimits = { ...(prev.modelLimits || {}), ...(cache.modelLimits || {}) };
          if (!cache.modelLimitsUpdatedAt && prev.modelLimitsUpdatedAt) {
            cache.modelLimitsUpdatedAt = prev.modelLimitsUpdatedAt;
          }
          if (!cache.email && prev.email) cache.email = prev.email;
          if (!cache.planTier && prev.planTier) cache.planTier = prev.planTier;
          if (!cache.planStatus && prev.planStatus) cache.planStatus = prev.planStatus;
        }
        mkdirSync(dirname(cacheFilePath), { recursive: true });
        writeFileSyncAndVerifyNoBOM(cacheFilePath, JSON.stringify(cache, null, 2));
      }
    }
  } catch (e) {}
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    const scriptPath = process.argv[1].replace(/^"(.*)"$/, '$1');
    const metaPath = fileURLToPath(import.meta.url);
    if (path.resolve(scriptPath).toLowerCase() === path.resolve(metaPath).toLowerCase()) {
      return true;
    }
    try {
      if (realpathSync(scriptPath).toLowerCase() === realpathSync(metaPath).toLowerCase()) {
        return true;
      }
    } catch (_) {}
    return false;
  } catch (e) {
    return false;
  }
}

// only auto-run when executed directly, not when imported by tests
if (isDirectExecution()) {
  main();
}