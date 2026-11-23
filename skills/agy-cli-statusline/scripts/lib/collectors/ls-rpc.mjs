import { normalizeModelName } from '../core/normalize.mjs';
import { inferModelPoolsFromModels, mergeQuotaBuckets, parseModelPools } from './quota.mjs';
import { formatResetTime } from './time-format.mjs';

const MAX_METADATA_PAGES = 5;
const METADATA_PAGE_LIMIT = 256;

/**
 * 解析 host:port 字串，支援 IPv4、hostname 與 IPv6（如 [::1]:54321）。
 * @param {string} addr
 * @returns {{ host: string, port: number }}
 */
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

/**
 * 解析 GetUserStatus.userStatus.cascadeModelConfigData.clientModelConfigs 為標準化模型配額對照表。
 * @param {object} userStatus
 * @param {number} [nowMs=Date.now()]
 * @returns {Record<string, { name: string, remaining_percentage: number, reset_time?: string, refreshes_in?: string }>}
 */
export function parseUserStatusModels(userStatus, nowMs = Date.now()) {
  const allModels = {};
  const configs = userStatus?.cascadeModelConfigData?.clientModelConfigs;
  if (!Array.isArray(configs)) return allModels;

  for (const model of configs) {
    const quotaInfo = model?.quotaInfo;
    if (!quotaInfo) continue;

    let fraction = 1;
    if (quotaInfo.remainingFraction !== undefined) {
      fraction = parseFloat(quotaInfo.remainingFraction);
    } else if (quotaInfo.resetTime) {
      fraction = 0;
    } else {
      continue;
    }

    const label = model.label || model.modelOrAlias?.model || 'Unknown';
    const remainingNum = fraction > 1 ? fraction : fraction * 100;
    const remaining = Math.max(0, Math.min(100, remainingNum));
    const entry = {
      name: label,
      remaining_percentage: remaining
    };
    if (quotaInfo.resetTime) {
      entry.reset_time = quotaInfo.resetTime;
      entry.refreshes_in = formatResetTime(quotaInfo.resetTime, nowMs);
    }
    const normKey = normalizeModelName(label);
    if (!allModels[normKey] || entry.remaining_percentage < allModels[normKey].remaining_percentage) {
      allModels[normKey] = entry;
    }
  }

  return allModels;
}

/**
 * 合併前後兩份 Language Server 配額快取快照（短週期、週額度、過期模型過濾、池對應與帳戶中繼資料）。
 * @param {object|null} prev
 * @param {object} next
 * @param {number} [nowMs=Date.now()]
 * @returns {object}
 */
export function mergeQuotaCacheSnapshots(prev, next, nowMs = Date.now()) {
  const merged = { ...(next || {}) };
  if (!prev || typeof prev !== 'object') return merged;

  if (prev.lastAgentState !== undefined && merged.lastAgentState === undefined) {
    merged.lastAgentState = prev.lastAgentState;
  }
  if (prev.lastOutputTokens !== undefined && merged.lastOutputTokens === undefined) {
    merged.lastOutputTokens = prev.lastOutputTokens;
  }
  if (prev.lastTotalTokens !== undefined && merged.lastTotalTokens === undefined) {
    merged.lastTotalTokens = prev.lastTotalTokens;
  }
  if (prev.lastPollAttemptAt !== undefined && merged.lastPollAttemptAt === undefined) {
    merged.lastPollAttemptAt = prev.lastPollAttemptAt;
  }
  if (prev.lastModelKey !== undefined && merged.lastModelKey === undefined) {
    merged.lastModelKey = prev.lastModelKey;
  }
  if (prev.lastModelLimitAttemptAt !== undefined && merged.lastModelLimitAttemptAt === undefined) {
    merged.lastModelLimitAttemptAt = prev.lastModelLimitAttemptAt;
  }

  merged.shortTerm = mergeQuotaBuckets(prev.shortTerm, merged.shortTerm, true);
  merged.weekly = mergeQuotaBuckets(prev.weekly, merged.weekly, true);

  const validPrevModels = {};
  for (const [k, v] of Object.entries(prev.models || {})) {
    if (!v || typeof v !== 'object') continue;
    const rMs = v.reset_time ? new Date(v.reset_time).getTime() : 0;
    if (!rMs || isNaN(rMs) || rMs > nowMs) {
      validPrevModels[k] = v;
    }
  }
  merged.models = { ...validPrevModels, ...(merged.models || {}) };
  merged.modelPools = { ...(prev.modelPools || {}), ...(merged.modelPools || {}) };
  merged.modelLimits = { ...(prev.modelLimits || {}), ...(merged.modelLimits || {}) };

  if (!merged.modelLimitsUpdatedAt && prev.modelLimitsUpdatedAt) {
    merged.modelLimitsUpdatedAt = prev.modelLimitsUpdatedAt;
  }
  if (!merged.email && prev.email) merged.email = prev.email;
  if (!merged.planTier && prev.planTier) merged.planTier = prev.planTier;
  if ((!merged.planStatus || Object.keys(merged.planStatus).length === 0) && prev.planStatus) {
    merged.planStatus = prev.planStatus;
  }

  return merged;
}

/**
 * 判斷 usage 物件是否包含任一正值權杖統計。
 * @param {object|null|undefined} usage
 * @returns {boolean}
 */
export function hasPositiveUsage(usage) {
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
 * 自 GetCascadeTrajectoryGeneratorMetadata 回應擷取完整 tokenBreakdown、usage 與執行期模型資訊，
 * 各欄位獨立取最新非空／非零值並往前補齊。
 * @param {object} genMetaResponse
 * @returns {{ maxContextTokens: number, estimatedTokensUsed: number, modelDisplayName: string, model: string, usage: object|null, tokenBreakdown: Array<{ name: string, type: string, numTokens: number }>, count: number }}
 */
export function extractDetailedRuntimeContext(genMetaResponse) {
  const list = genMetaResponse?.generatorMetadata;
  let maxContextTokens = 0;
  let modelDisplayName = '';
  let model = '';
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
    tokenBreakdown,
    count: Array.isArray(list) ? list.length : 0
  };
}

/**
 * 分頁擷取 GetCascadeTrajectoryGeneratorMetadata，並支援從游標前一筆重讀以防串流回填漏讀。
 * @param {object} params
 * @returns {Promise<{ telemetry: object|null, nextOffset: number, notFound: boolean, rpcOk: boolean }>}
 */
export async function fetchPaginatedTrajectoryMetadataAsync({
  port,
  csrfToken,
  host,
  preferHttps,
  conversationId,
  startOffset = 0,
  initialTelemetry = null,
  requestFn
}) {
  if (!conversationId || typeof requestFn !== 'function') {
    return { telemetry: initialTelemetry, nextOffset: startOffset, notFound: false, rpcOk: false };
  }

  let offset = Math.max(0, Number(startOffset) || 0);
  let latestTelemetry = initialTelemetry;
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
      extracted.tokenBreakdown.length > 0 ||
      extracted.modelDisplayName ||
      extracted.model
    ) {
      latestTelemetry = mergeRuntimeTelemetry(latestTelemetry, extracted);
    }
    offset += list.length;
    if (list.length < METADATA_PAGE_LIMIT) break;
  }

  return { telemetry: latestTelemetry, nextOffset: offset, notFound, rpcOk };
}

export { inferModelPoolsFromModels, parseModelPools };
