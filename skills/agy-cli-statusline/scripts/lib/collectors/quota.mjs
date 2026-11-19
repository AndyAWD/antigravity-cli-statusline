import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import os from 'os';
import { readJsonSafeAsync } from '../core/fs-utils.mjs';
import { normalizeModelName } from '../core/normalize.mjs';
import { formatResetTime, formatSecondsToCountdown } from './time-format.mjs';

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

    // 1. 過期判定：若既有配額之重置時間已過期，且傳入配額具備較新重置時間或無時間戳記之 100% 重置額度，舊窗口讓位給新進入配額
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

/**
 * 依目前使用中的模型解析短週期（5 小時）可用配額（優先取 shortTerm，無則退回 cache.models）。
 * @param {string} fallbackModel
 * @param {object|null} cache
 * @returns {{ remaining_percentage: number, reset_time?: string, refreshes_in?: string }}
 */
export function resolveModelQuota(fallbackModel, cache) {
  const normModel = normalizeModelName(fallbackModel);

  // 1. 優先使用 RetrieveUserQuotaSummary 解析出的短週期 (5h) 配額桶
  let pool = '';
  if (normModel.includes('gemini')) {
    pool = 'gemini';
  } else if (normModel.includes('claude') || normModel.includes('gpt')) {
    pool = '3p';
  }

  if (pool && cache && cache.shortTerm && cache.shortTerm[pool]) {
    return cache.shortTerm[pool];
  }

  if (cache && cache.shortTerm) {
    const pools = Object.keys(cache.shortTerm);
    if (pools.length > 0) {
      const matchedPool = pools.find(p => normModel.includes(p) || p.includes(normModel));
      if (matchedPool) return cache.shortTerm[matchedPool];
    }
  }

  // 2. 若無 shortTerm 桶，降級回 GetUserStatus 中的 cache.models
  let modelQuota = null;
  if (cache && cache.models) {
    // 2a. 精確匹配
    if (cache.models[normModel]) {
      modelQuota = cache.models[normModel];
    } else {
      // 2b. 子字串匹配
      for (const k in cache.models) {
        if (normModel.includes(k) || k.includes(normModel)) {
          modelQuota = cache.models[k];
          break;
        }
      }
    }
    // 2c. 家族匹配
    if (!modelQuota) {
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
  }
  // 2d. 全域最小值退讓
  if (!modelQuota && cache && cache.models) {
    const allKeys = Object.keys(cache.models);
    if (allKeys.length > 0) {
      modelQuota = allKeys.reduce((min, k) =>
        cache.models[k].remaining_percentage < min.remaining_percentage ? cache.models[k] : min
      , cache.models[allKeys[0]]);
    }
  }
  return modelQuota || { remaining_percentage: 100, refreshes_in: '' };
}

/**
 * 依目前模型對應至每週配額池（'gemini' | '3p'）並解析每週可用額度。
 * @param {string} fallbackModel
 * @param {object|null} cache
 * @returns {{ remaining_percentage: number, reset_time?: string, refreshes_in?: string }}
 */
export function resolveWeeklyQuota(fallbackModel, cache) {
  const normModel = normalizeModelName(fallbackModel);
  let pool = '';
  if (normModel.includes('gemini')) {
    pool = 'gemini';
  } else if (normModel.includes('claude') || normModel.includes('gpt')) {
    pool = '3p';
  }

  if (pool && cache && cache.weekly && cache.weekly[pool]) {
    return cache.weekly[pool];
  }

  // A4 退讓（非 Argon 每週配額池中取最低值，若無則取全部池中最低值）
  if (cache && cache.weekly) {
    const allPools = Object.keys(cache.weekly).filter(p => cache.weekly[p] && typeof cache.weekly[p] === 'object');
    const generalPools = allPools.filter(p => !p.toLowerCase().includes('argon'));
    const pools = generalPools.length > 0 ? generalPools : allPools;
    if (pools.length > 0) {
      let minPool = pools[0];
      for (const p of pools) {
        if (cache.weekly[p].remaining_percentage < cache.weekly[minPool].remaining_percentage) {
          minPool = p;
        }
      }
      return cache.weekly[minPool];
    }
  }

  return { remaining_percentage: 100, refreshes_in: '' };
}

/**
 * 自快取解析 Gemini 4 Argon 配額池（'gemini-argon-wtu' 或任何含 argon 之配額桶）。
 * @param {object|null} cache
 * @returns {{ remaining_percentage: number, reset_time?: string, refreshes_in?: string }}
 */
export function resolveArgonQuota(cache) {
  if (cache && cache.weekly && typeof cache.weekly === 'object') {
    if (cache.weekly['gemini-argon-wtu']) {
      return cache.weekly['gemini-argon-wtu'];
    }
    const argonPools = Object.keys(cache.weekly).filter(
      p => p.toLowerCase().includes('argon') && cache.weekly[p] && typeof cache.weekly[p] === 'object'
    );
    if (argonPools.length > 0) {
      let minPool = argonPools[0];
      for (const p of argonPools) {
        if (cache.weekly[p].remaining_percentage < cache.weekly[minPool].remaining_percentage) {
          minPool = p;
        }
      }
      return cache.weekly[minPool];
    }
  }

  if (cache && cache.shortTerm && typeof cache.shortTerm === 'object') {
    const argonShortPools = Object.keys(cache.shortTerm).filter(
      p => p.toLowerCase().includes('argon') && cache.shortTerm[p] && typeof cache.shortTerm[p] === 'object'
    );
    if (argonShortPools.length > 0) {
      return cache.shortTerm[argonShortPools[0]];
    }
  }

  if (cache && cache.models && typeof cache.models === 'object') {
    const argonModelKeys = Object.keys(cache.models).filter(
      k => k.toLowerCase().includes('argon') && cache.models[k] && typeof cache.models[k] === 'object'
    );
    if (argonModelKeys.length > 0) {
      let minKey = argonModelKeys[0];
      for (const k of argonModelKeys) {
        if (cache.models[k].remaining_percentage < cache.models[minKey].remaining_percentage) {
          minKey = k;
        }
      }
      return cache.models[minKey];
    }
  }

  return { remaining_percentage: 100, refreshes_in: '' };
}
