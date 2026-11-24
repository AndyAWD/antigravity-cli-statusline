import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import os from 'os';
import { readJsonSafeAsync } from '../core/fs-utils.mjs';
import { normalizeModelName } from '../core/normalize.mjs';
import { formatResetTime, formatSecondsToCountdown } from './time-format.mjs';

export const EXPIRED_RESET_GRACE_MS = 60 * 1000;

function matchBrandPoolFromKey(normKey) {
  if (!normKey) return '';
  if (
    normKey.includes('claude') ||
    normKey.includes('gpt') ||
    normKey.includes('chatgpt') ||
    normKey.includes('openai') ||
    normKey.includes('anthropic')
  ) {
    return '3p';
  }
  if (normKey.includes('gemini') || normKey.includes('google')) {
    return 'gemini';
  }
  return '';
}

function isArgonPoolName(poolName) {
  const lower = String(poolName || '').toLowerCase();
  return lower.includes('argon') || lower.endsWith('-wtu');
}

function isExpiredBeyondGrace(entry, now = Date.now(), graceMs = EXPIRED_RESET_GRACE_MS) {
  if (!entry || typeof entry !== 'object' || !entry.reset_time) return false;
  const resetMs = new Date(entry.reset_time).getTime();
  return !isNaN(resetMs) && resetMs > 0 && (resetMs + graceMs) <= now;
}

function collectModelCandidateKeys(fallbackModel, meta = null) {
  const raw = [
    fallbackModel,
    meta?.model?.id,
    meta?.model?.display_name,
    meta?.model?.name
  ];
  const seen = new Set();
  const keys = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const norm = normalizeModelName(item);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      keys.push(norm);
    }
  }
  return keys;
}

function resolveBrandFallbackPool(candidates, cache = null) {
  // 第 2 層：明確品牌關鍵字
  for (const key of candidates) {
    const brandPool = matchBrandPoolFromKey(key);
    if (brandPool) return brandPool;
  }

  // 第 3 層：動態模型目錄 (cache.modelLimits)
  if (cache?.modelLimits && typeof cache.modelLimits === 'object') {
    for (const key of candidates) {
      const entry = cache.modelLimits[key];
      if (!entry || typeof entry !== 'object') continue;
      for (const field of [entry.slug, entry.model, entry.displayName]) {
        if (typeof field !== 'string' || !field.trim()) continue;
        const limitPool = matchBrandPoolFromKey(normalizeModelName(field));
        if (limitPool) return limitPool;
      }
    }
  }

  // 第 4 層：無快取冷啟動退讓
  for (const key of candidates) {
    if (
      key.includes('orchestrator') ||
      key.includes('neon') ||
      key.includes('hydrogen') ||
      key.includes('argon') ||
      key.includes('carbon')
    ) {
      return 'gemini';
    }
  }

  return '';
}

/**
 * 解析 RetrieveUserQuotaSummary 群組資訊，建立「標準化模型名稱 -> 配額池」映射表。
 * @param {object} summaryResponse
 * @returns {Record<string, string>}
 */
export function parseModelPools(summaryResponse) {
  const modelPools = {};
  if (!summaryResponse || typeof summaryResponse !== 'object') return modelPools;
  const resObj = summaryResponse.response || summaryResponse;
  if (!Array.isArray(resObj?.groups)) return modelPools;

  for (const group of resObj.groups) {
    if (!group || typeof group !== 'object') continue;
    let pool = '';
    if (Array.isArray(group.buckets)) {
      let weeklyPool = '';
      for (const bucket of group.buckets) {
        const bucketId = typeof bucket?.bucketId === 'string' ? bucket.bucketId.trim() : '';
        if (!bucketId) continue;
        const lowerId = bucketId.toLowerCase();
        if (lowerId.includes('argon') || lowerId.endsWith('-wtu') || lowerId.endsWith('-wtu-weekly')) continue;
        const candidatePool = bucketId.replace(/-(5h|3h|hourly|shortterm|weekly)$/i, '');
        if (!candidatePool || isArgonPoolName(candidatePool)) continue;
        const windowVal = String(bucket.window || bucket.windowVal || '').toLowerCase();
        const isShortTermSuffix = /-(5h|3h|hourly|shortterm)$/i.test(bucketId);
        const isWeekly = windowVal === 'weekly' || (!windowVal && lowerId.endsWith('-weekly') && !isShortTermSuffix);
        if (!isWeekly) {
          pool = candidatePool;
          break;
        }
        if (!weeklyPool) weeklyPool = candidatePool;
      }
      if (!pool) pool = weeklyPool;
    }
    if (!pool) continue;

    if (typeof group.description === 'string') {
      const descMatch = group.description.match(/models\s+within\s+this\s+group\s*:\s*(.+?)(?:\.\s+|\r?\n|$)/i);
      if (descMatch && descMatch[1]) {
        const listText = descMatch[1].replace(/\.\s*$/, '');
        for (const rawName of listText.split(',')) {
          const norm = normalizeModelName(rawName);
          if (norm.length >= 2) {
            modelPools[norm] = pool;
          }
        }
      }
    }

    const structuredList = Array.isArray(group.models)
      ? group.models
      : (Array.isArray(group.modelIds) ? group.modelIds : []);
    for (const item of structuredList) {
      const rawCandidates = typeof item === 'string'
        ? [item]
        : (item && typeof item === 'object' ? [item.displayName, item.label, item.name, item.slug, item.model] : []);
      for (const raw of rawCandidates) {
        if (typeof raw !== 'string') continue;
        const norm = normalizeModelName(raw);
        if (norm.length >= 2) {
          modelPools[norm] = pool;
        }
      }
    }
  }

  return modelPools;
}

/**
 * 透過 GetUserStatus 模型快照與 RetrieveUserQuotaSummary 短週期桶之唯一重置時間交叉推斷模型配額池歸屬。
 * @param {object} [models={}]
 * @param {object} [shortTerm={}]
 * @returns {Record<string, string>}
 */
export function inferModelPoolsFromModels(models = {}, shortTerm = {}) {
  const inferred = {};
  if (!models || typeof models !== 'object' || !shortTerm || typeof shortTerm !== 'object') {
    return inferred;
  }

  const resetTimeToPools = new Map();
  for (const [pool, bucket] of Object.entries(shortTerm)) {
    if (!bucket || typeof bucket !== 'object' || isArgonPoolName(pool) || !bucket.reset_time) continue;
    const resetMs = new Date(bucket.reset_time).getTime();
    if (isNaN(resetMs) || resetMs <= 0) continue;
    const pools = resetTimeToPools.get(resetMs) || [];
    if (!pools.includes(pool)) {
      pools.push(pool);
      resetTimeToPools.set(resetMs, pools);
    }
  }

  if (resetTimeToPools.size === 0) return inferred;

  for (const [normKey, entry] of Object.entries(models)) {
    if (!normKey || !entry || typeof entry !== 'object' || !entry.reset_time) continue;
    const resetMs = new Date(entry.reset_time).getTime();
    if (isNaN(resetMs) || resetMs <= 0) continue;
    const matchedPools = resetTimeToPools.get(resetMs);
    if (!matchedPools || matchedPools.length !== 1) continue;

    const pool = matchedPools[0];
    const stEntry = shortTerm[pool];
    const hasModelPct = typeof entry.remaining_percentage === 'number' && !isNaN(entry.remaining_percentage);
    const hasStPct = typeof stEntry?.remaining_percentage === 'number' && !isNaN(stEntry.remaining_percentage);
    if (!hasModelPct || !hasStPct || Math.abs(entry.remaining_percentage - stEntry.remaining_percentage) <= 5) {
      inferred[normKey] = pool;
    }
  }

  return inferred;
}

/**
 * 正規化單一解析後配額條目：即時重算倒數，並於超過重置寬限期時自動轉為已重置狀態。
 * @param {object|null|undefined} entry
 * @param {number} [now=Date.now()]
 * @param {number} [graceMs=EXPIRED_RESET_GRACE_MS]
 * @returns {{ remaining_percentage: number, reset_time?: string, refreshes_in: string, window?: string }}
 */
export function normalizeResolvedQuotaEntry(entry, now = Date.now(), graceMs = EXPIRED_RESET_GRACE_MS) {
  if (!entry || typeof entry !== 'object') {
    return { remaining_percentage: 100, refreshes_in: '' };
  }
  const nowMs = (typeof now === 'number' && !isNaN(now)) ? now : Date.now();
  if (entry.reset_time) {
    const resetMs = new Date(entry.reset_time).getTime();
    if (!isNaN(resetMs) && resetMs > 0) {
      if ((resetMs + graceMs) <= nowMs) {
        return {
          remaining_percentage: 100,
          refreshes_in: '',
          ...(entry.window ? { window: entry.window } : {})
        };
      }
      const dynamicRefreshesIn = formatResetTime(entry.reset_time, nowMs);
      return {
        ...entry,
        refreshes_in: dynamicRefreshesIn || entry.refreshes_in || ''
      };
    }
  }
  return {
    ...entry,
    refreshes_in: entry.refreshes_in || ''
  };
}

/**
 * 依四層優先序解析模型所屬配額池：
 * 1. 動態群組對照 (cache.modelPools)
 * 2. 明確品牌關鍵字
 * 3. 模型目錄對照 (cache.modelLimits)
 * 4. 冷啟動編排器／代號退讓
 * @param {string} fallbackModel
 * @param {object|null} [cache=null]
 * @param {object|null} [meta=null]
 * @returns {string}
 */
export function resolveQuotaPool(fallbackModel, cache = null, meta = null) {
  const candidates = collectModelCandidateKeys(fallbackModel, meta);
  if (candidates.length === 0) return '';

  // 第 1 層：動態群組對照 (cache.modelPools)
  if (cache?.modelPools && typeof cache.modelPools === 'object') {
    for (const key of candidates) {
      const exact = cache.modelPools[key];
      if (typeof exact === 'string' && exact) return exact;
    }

    let bestPool = '';
    let bestLen = 0;
    for (const [modelKey, poolName] of Object.entries(cache.modelPools)) {
      if (typeof poolName !== 'string' || !poolName || modelKey.length < 4) continue;
      const matched = candidates.some(k => k.length >= 4 && (k.includes(modelKey) || modelKey.includes(k)));
      if (matched && modelKey.length > bestLen) {
        bestLen = modelKey.length;
        bestPool = poolName;
      }
    }
    if (bestPool) return bestPool;
  }

  return resolveBrandFallbackPool(candidates, cache);
}

/**
 * 解析 Antigravity CLI 原生傳入的 meta.quota 欄位，分類為 shortTerm 與 weekly 配額池。
 * @param {object} [meta]
 * @returns {{ shortTerm: Record<string, object>, weekly: Record<string, object> }|null}
 */
export function parseMetaQuota(meta) {
  if (!meta?.quota || typeof meta.quota !== 'object') return null;
  const keys = Object.keys(meta.quota);
  if (keys.length === 0) return null;

  const shortTerm = {};
  const weekly = {};

  for (const key of keys) {
    const bucket = meta.quota[key];
    if (!bucket) continue;

    let fraction = 1;
    const remainingField = bucket.remaining_fraction !== undefined ? bucket.remaining_fraction : bucket.remainingFraction;
    if (remainingField !== undefined && remainingField !== null) {
      fraction = parseFloat(remainingField);
    } else if (bucket.reset_time || bucket.reset_in_seconds || bucket.resetTime) {
      fraction = 0;
    }

    const remainingNum = fraction > 1 ? fraction : fraction * 100;
    const remaining = Math.max(0, Math.min(100, remainingNum));

    const rawResetTime = bucket.reset_time || bucket.resetTime;
    const resetSec = bucket.reset_in_seconds !== undefined ? bucket.reset_in_seconds : bucket.resetInSeconds;
    const resetTime = rawResetTime || (resetSec !== undefined && resetSec !== null && !isNaN(resetSec)
      ? new Date(Date.now() + Number(resetSec) * 1000).toISOString()
      : undefined);

    let refreshesIn = '';
    if (resetSec !== undefined && resetSec !== null) {
      refreshesIn = formatSecondsToCountdown(resetSec);
    } else if (resetTime) {
      refreshesIn = formatResetTime(resetTime);
    }

    const entry = {
      remaining_percentage: remaining
    };
    if (resetTime) entry.reset_time = resetTime;
    if (refreshesIn) entry.refreshes_in = refreshesIn;

    const lowerKey = key.toLowerCase();
    const isWeeklyWindow = bucket.window === 'weekly' || bucket.windowVal === 'weekly';
    const isShortTermSuffix = /-(5h|3h|hourly|shortterm)$/i.test(key);
    const isWeeklyBucket =
      key.endsWith('-weekly') ||
      isWeeklyWindow ||
      ((lowerKey.includes('argon') || lowerKey.endsWith('-wtu')) && !isShortTermSuffix);

    if (isWeeklyBucket) {
      const pool = key.replace(/-weekly$/, '');
      weekly[pool] = { ...entry, window: 'weekly' };
    } else {
      const pool = key.replace(/-(5h|3h|hourly|shortterm)$/, '');
      shortTerm[pool] = entry;
    }
  }

  if (Object.keys(shortTerm).length === 0 && Object.keys(weekly).length === 0) return null;
  return { shortTerm, weekly };
}

/**
 * 合併兩個配額桶映射表，具備過期窗口讓位、跨窗口門檻保護與同窗口取低值防抖動機制。
 * @param {object} [baseBuckets={}]
 * @param {object} [incomingBuckets={}]
 * @param {boolean} [preferLowerWhenSameReset=true]
 * @returns {object}
 */
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

    // 1. 過期判定：若既有配額之重置時間已過期，且傳入配額具備較新重置時間或無時間戳記之新額度，舊窗口讓位給新進入配額
    if (hasValidExistReset && existResetMs <= now && (incResetMs > existResetMs || !hasValidIncReset)) {
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
    // 週額度與 Argon 週期為 7 日，門檻設為 24 小時；五小時／短週期額度門檻設為 2 小時，消除長對話時序漂移
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

/**
 * 依快取年齡、代理狀態轉換、權杖變動或缺少必要欄位決定是否喚起背景語言伺服器配額拉取腳本。
 * @param {object|null} cacheInfo
 * @param {object} [meta={}]
 * @param {object} [options={}]
 * @returns {Promise<{ cache: object|null, freshlyFetchedFromLs: boolean, timedOut: boolean }>}
 */
export async function triggerQuotaUpdateIfNeededAsync(cacheInfo, meta = {}, options = {}) {
  const now = Date.now();
  const lastUpdatedAt = cacheInfo?.lsUpdatedAt || cacheInfo?.updatedAt || 0;
  const ageMs = now - lastUpdatedAt;
  const attemptAgeMs = now - (cacheInfo?.lastPollAttemptAt || 0);

  const currentState = typeof meta?.agent_state === 'string' ? meta.agent_state.trim().toLowerCase() : '';
  const prevState = typeof cacheInfo?.lastAgentState === 'string' ? cacheInfo.lastAgentState.trim().toLowerCase() : '';
  const currentOutputTokens = Number(meta?.context_window?.total_output_tokens || 0);
  const currentInputTokens = Number(meta?.context_window?.total_input_tokens || 0);
  const currentTotalTokens = currentInputTokens + currentOutputTokens;
  const prevOutputTokens = Number(cacheInfo?.lastOutputTokens || 0);
  const prevTotalTokens = Number(cacheInfo?.lastTotalTokens || 0);

  const stateJustBecameIdle = currentState === 'idle' && prevState !== '' && prevState !== 'idle';
  const tokensJustChanged =
    (currentOutputTokens > 0 && currentOutputTokens !== prevOutputTokens) ||
    (currentTotalTokens > 0 && currentTotalTokens !== prevTotalTokens);
  const missingBuckets = Boolean(options?.missingRequiredBuckets);

  let needUpdate = false;
  if (!cacheInfo || !lastUpdatedAt || ageMs >= 15000) {
    if (!cacheInfo?.lastPollAttemptAt || attemptAgeMs >= 15000) {
      needUpdate = true;
    }
  } else if (options?.hasExpiredQuota && (!cacheInfo?.lastPollAttemptAt || attemptAgeMs >= 5000)) {
    needUpdate = true;
  } else if ((stateJustBecameIdle || tokensJustChanged || missingBuckets) && ageMs >= 1500) {
    needUpdate = true;
  }

  if (!needUpdate) {
    return { cache: cacheInfo, freshlyFetchedFromLs: false, timedOut: false };
  }

  if (cacheInfo && typeof cacheInfo === 'object') {
    cacheInfo.lastPollAttemptAt = now;
  }

  let timedOut = false;
  let freshlyFetchedFromLs = false;
  const cachePath = options?.cachePath || join(os.homedir(), '.gemini', 'tmp', 'real_quota_cache.json');
  const envWait = parseInt(process.env.STATUSLINE_QUOTA_WAIT_MS || '', 10);
  const waitMs = typeof options?.waitMs === 'number' ? options.waitMs : (!isNaN(envWait) && envWait > 0 ? envWait : 500);

  try {
    const updaterScript = options?.updaterScript || join(os.homedir(), '.gemini', 'antigravity-cli', 'hooks', 'fetch-local-quota.mjs');
    await fs.access(updaterScript);

    await new Promise((resolve) => {
      let settled = false;
      const finish = (didTimeOut = false) => {
        if (!settled) {
          settled = true;
          timedOut = didTimeOut;
          clearTimeout(timer);
          resolve();
        }
      };
      const timer = setTimeout(() => finish(true), waitMs);
      try {
        const spawnEnv = { ...process.env, DISABLE_QUOTA_HOOK: '1' };
        if (options?.conversationId && options.conversationId !== 'default') {
          spawnEnv.STATUSLINE_CONVERSATION_ID = options.conversationId;
        }
        const proc = spawn(process.execPath, [updaterScript], {
          env: spawnEnv,
          stdio: 'ignore',
          detached: true,
          windowsHide: true
        });
        proc.on('error', () => finish(false));
        proc.on('close', () => finish(false));
        proc.unref();
      } catch (_) {
        finish(false);
      }
    });

    if (!timedOut && cachePath) {
      const freshCache = await readJsonSafeAsync(cachePath);
      if (freshCache) {
        const freshTs = freshCache.lsUpdatedAt || freshCache.updatedAt || 0;
        if (freshTs > lastUpdatedAt || (lastUpdatedAt === 0 && freshTs > 0)) {
          freshlyFetchedFromLs = true;
          if (cacheInfo && typeof cacheInfo === 'object') {
            freshCache.shortTerm = mergeQuotaBuckets(cacheInfo.shortTerm, freshCache.shortTerm, true);
            freshCache.weekly = mergeQuotaBuckets(cacheInfo.weekly, freshCache.weekly, true);
            freshCache.models = { ...(cacheInfo.models || {}), ...(freshCache.models || {}) };
            if (cacheInfo.modelLimits || freshCache.modelLimits) {
              freshCache.modelLimits = { ...(cacheInfo.modelLimits || {}), ...(freshCache.modelLimits || {}) };
            }
            if (cacheInfo.modelPools || freshCache.modelPools) {
              freshCache.modelPools = { ...(cacheInfo.modelPools || {}), ...(freshCache.modelPools || {}) };
            }
            if (!freshCache.modelLimitsUpdatedAt && cacheInfo.modelLimitsUpdatedAt) {
              freshCache.modelLimitsUpdatedAt = cacheInfo.modelLimitsUpdatedAt;
            }
            if (cacheInfo.lastPollAttemptAt !== undefined) freshCache.lastPollAttemptAt = cacheInfo.lastPollAttemptAt;
            if (cacheInfo.lastModelKey !== undefined) freshCache.lastModelKey = cacheInfo.lastModelKey;
            if (cacheInfo.lastModelLimitAttemptAt !== undefined) freshCache.lastModelLimitAttemptAt = cacheInfo.lastModelLimitAttemptAt;
          }
          return { cache: freshCache, freshlyFetchedFromLs, timedOut };
        }
      }
    }
  } catch (_) {}

  return { cache: cacheInfo, freshlyFetchedFromLs, timedOut };
}

function findMatchingPoolBucket(buckets, candidates, normModel) {
  if (!buckets || typeof buckets !== 'object') return null;
  const nonArgonPools = Object.keys(buckets).filter(p => !isArgonPoolName(p) && buckets[p] && typeof buckets[p] === 'object');
  if (nonArgonPools.length === 0) return null;

  for (const key of candidates) {
    const exactPool = nonArgonPools.find(p => normalizeModelName(p) === key);
    if (exactPool) return buckets[exactPool];
  }
  const matchedPool = nonArgonPools.find((p) => {
    const normPool = normalizeModelName(p);
    return normPool.length >= 2 && normPool !== '3p' && normModel && (normModel.includes(normPool) || normPool.includes(normModel));
  });
  return matchedPool ? buckets[matchedPool] : null;
}

/**
 * 依目前使用中的模型解析短週期（5 小時）可用配額（優先取 shortTerm，無則退回 cache.models）。
 * @param {string} fallbackModel
 * @param {object|null} cache
 * @param {object|null} [meta=null]
 * @param {number} [now=Date.now()]
 * @returns {{ remaining_percentage: number, reset_time?: string, refreshes_in?: string }}
 */
export function resolveModelQuota(fallbackModel, cache, meta = null, now = Date.now()) {
  const candidates = collectModelCandidateKeys(fallbackModel, meta);
  const normModel = candidates[0] || normalizeModelName(fallbackModel);
  const pool = resolveQuotaPool(fallbackModel, cache, meta);

  // 1. 優先使用 RetrieveUserQuotaSummary 解析出的短週期 (5h) 配額桶
  if (pool && cache && cache.shortTerm && cache.shortTerm[pool]) {
    return normalizeResolvedQuotaEntry(cache.shortTerm[pool], now);
  }

  const brandPool = resolveBrandFallbackPool(candidates, cache);
  if (brandPool && brandPool !== pool && cache && cache.shortTerm && cache.shortTerm[brandPool]) {
    return normalizeResolvedQuotaEntry(cache.shortTerm[brandPool], now);
  }

  const matchedShortBucket = findMatchingPoolBucket(cache?.shortTerm, candidates, normModel);
  if (matchedShortBucket) {
    return normalizeResolvedQuotaEntry(matchedShortBucket, now);
  }

  // 2. 若無對應 shortTerm 桶，降級回 GetUserStatus 中的 cache.models
  let modelQuota = null;
  if (cache && cache.models) {
    // 2a. 精確匹配（檢查所有候選鍵）
    for (const key of candidates) {
      if (cache.models[key]) {
        modelQuota = cache.models[key];
        break;
      }
    }
    if (!modelQuota && normModel) {
      // 2b. 子字串匹配
      for (const k in cache.models) {
        if (normModel.includes(k) || k.includes(normModel)) {
          modelQuota = cache.models[k];
          break;
        }
      }
    }
    // 2c. 家族匹配
    if (!modelQuota && normModel) {
      const families = ['claude', 'gemini', 'gpt'];
      const modelFamily = families.find(f => normModel.includes(f));
      if (modelFamily) {
        for (const k in cache.models) {
          if (k.includes(modelFamily)) {
            if (!modelQuota || cache.models[k].remaining_percentage < modelQuota.remaining_percentage) {
              modelQuota = cache.models[k];
            }
          }
        }
      }
    }
    // 2d. 全域最小值退讓
    if (!modelQuota) {
      const allKeys = Object.keys(cache.models);
      if (allKeys.length > 0) {
        modelQuota = allKeys.reduce((min, k) =>
          cache.models[k].remaining_percentage < min.remaining_percentage ? cache.models[k] : min
        , cache.models[allKeys[0]]);
      }
    }
  }

  if (modelQuota && !isExpiredBeyondGrace(modelQuota, now)) {
    return normalizeResolvedQuotaEntry(modelQuota, now);
  }

  if (cache && cache.shortTerm) {
    const validShortEntries = Object.entries(cache.shortTerm)
      .filter(([p, entry]) => !isArgonPoolName(p) && entry && typeof entry === 'object' && !isExpiredBeyondGrace(entry, now))
      .map(([, entry]) => entry);
    if (validShortEntries.length === 1) {
      return normalizeResolvedQuotaEntry(validShortEntries[0], now);
    }
    if (validShortEntries.length > 1) {
      const minShortEntry = validShortEntries.reduce((min, cur) =>
        (Number(cur.remaining_percentage) < Number(min.remaining_percentage)) ? cur : min
      , validShortEntries[0]);
      return normalizeResolvedQuotaEntry(minShortEntry, now);
    }
  }

  if (modelQuota) {
    return normalizeResolvedQuotaEntry(modelQuota, now);
  }

  return { remaining_percentage: 100, refreshes_in: '' };
}

/**
 * 依目前模型對應至每週配額池（'gemini' | '3p' 或動態獨立池）並解析每週可用額度。
 * @param {string} fallbackModel
 * @param {object|null} cache
 * @param {object|null} [meta=null]
 * @param {number} [now=Date.now()]
 * @returns {{ remaining_percentage: number, reset_time?: string, refreshes_in?: string }}
 */
export function resolveWeeklyQuota(fallbackModel, cache, meta = null, now = Date.now()) {
  const candidates = collectModelCandidateKeys(fallbackModel, meta);
  const normModel = candidates[0] || normalizeModelName(fallbackModel);
  const pool = resolveQuotaPool(fallbackModel, cache, meta);

  if (pool && cache && cache.weekly && cache.weekly[pool]) {
    return normalizeResolvedQuotaEntry(cache.weekly[pool], now);
  }

  const brandPool = resolveBrandFallbackPool(candidates, cache);
  if (brandPool && brandPool !== pool && cache && cache.weekly && cache.weekly[brandPool]) {
    return normalizeResolvedQuotaEntry(cache.weekly[brandPool], now);
  }

  const matchedWeeklyBucket = findMatchingPoolBucket(cache?.weekly, candidates, normModel);
  if (matchedWeeklyBucket) {
    return normalizeResolvedQuotaEntry(matchedWeeklyBucket, now);
  }

  // A4 退讓（非 Argon 每週配額池中取最低值，若無則取全部池中最低值）
  if (cache && cache.weekly) {
    const allPools = Object.keys(cache.weekly).filter(p => cache.weekly[p] && typeof cache.weekly[p] === 'object');
    const generalPools = allPools.filter(p => !isArgonPoolName(p));
    const pools = generalPools.length > 0 ? generalPools : allPools;
    if (pools.length > 0) {
      let minPool = pools[0];
      for (const p of pools) {
        if (cache.weekly[p].remaining_percentage < cache.weekly[minPool].remaining_percentage) {
          minPool = p;
        }
      }
      return normalizeResolvedQuotaEntry(cache.weekly[minPool], now);
    }
  }

  return { remaining_percentage: 100, refreshes_in: '' };
}
