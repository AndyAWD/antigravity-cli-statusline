import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import os from 'os';
import { DEFAULT_COMPACTION_THRESHOLD, STEP_UP_INTERMEDIATE_THRESHOLD } from '../core/constants.mjs';
import { readJsonSafeAsync, writeFileAndVerifyNoBOM } from '../core/fs-utils.mjs';
import { normalizeModelName } from '../core/normalize.mjs';

let stateWriteQueue = Promise.resolve();
let ctxWriteQueue = Promise.resolve();

/**
 * 解析數值、k/m 後綴、關鍵字（"model"/"physical"/"full"/"1m"/"0"）或百分比形式的壓縮上限覆寫值。
 * @param {unknown} rawValue
 * @param {number} contextSize
 * @param {boolean} [allowPercent=false]
 * @returns {number|null}
 */
export function parseCeilingValue(rawValue, contextSize, allowPercent = false) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  if (typeof rawValue === 'number') {
    if (isNaN(rawValue) || rawValue < 0) return null;
    if (rawValue === 0) return contextSize > 0 ? contextSize : null;
    return rawValue;
  }
  if (typeof rawValue === 'string') {
    const s = rawValue.trim().toLowerCase();
    if (!s) return null;
    if (s === 'model' || s === 'physical' || s === 'full' || s === '1m' || s === '0') {
      return contextSize > 0 ? contextSize : null;
    }
    if (allowPercent && s.endsWith('%')) {
      const pct = Number(s.slice(0, -1));
      if (!isNaN(pct) && pct > 0 && pct <= 100 && contextSize > 0) {
        return Math.round((contextSize * pct) / 100);
      }
      return null;
    }
    if (s.endsWith('k') && !isNaN(Number(s.slice(0, -1)))) {
      const val = Number(s.slice(0, -1)) * 1000;
      return val > 0 ? val : null;
    }
    if (s.endsWith('m') && !isNaN(Number(s.slice(0, -1)))) {
      const val = Number(s.slice(0, -1)) * 1000000;
      return val > 0 ? val : null;
    }
    if (!isNaN(Number(s))) {
      const num = Number(s);
      if (num < 0) return null;
      return num === 0 ? (contextSize > 0 ? contextSize : null) : num;
    }
  }
  return null;
}

/**
 * 自狀態列中繼資料擷取去重且標準化後的模型查詢鍵清單。
 * @param {object} [meta]
 * @param {string} [fallbackModel='']
 * @returns {string[]}
 */
export function extractModelCandidateKeys(meta, fallbackModel = '') {
  const raw = [
    meta?.model?.id,
    meta?.model?.display_name,
    meta?.model?.name,
    fallbackModel
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

/**
 * 依標準化鍵從快取之 modelLimits 目錄解析模型壓縮上限與實體視窗規格。
 * @param {string[]} modelKeys
 * @param {object} modelLimits
 * @returns {object|null}
 */
export function resolveCatalogEntry(modelKeys, modelLimits) {
  if (!Array.isArray(modelKeys) || modelKeys.length === 0 || !modelLimits || typeof modelLimits !== 'object') {
    return null;
  }
  let maxTokensFallback = null;
  for (const key of modelKeys) {
    const entry = modelLimits[key];
    if (!entry || typeof entry !== 'object' || entry.ambiguous) continue;
    if (typeof entry.limit === 'number' && entry.limit > 0) {
      return entry;
    }
    if (!maxTokensFallback && typeof entry.maxTokens === 'number' && entry.maxTokens > 0) {
      maxTokensFallback = entry;
    }
  }
  return maxTokensFallback;
}

/**
 * 計算步進式權杖上限（基準 -> 512k -> 實體 contextSize），防止進度條卡在 100%。
 * @param {number} totalInput
 * @param {number} contextSize
 * @param {number} [baseCeiling=DEFAULT_COMPACTION_THRESHOLD]
 * @returns {number}
 */
export function computeSteppedCeiling(totalInput, contextSize, baseCeiling = DEFAULT_COMPACTION_THRESHOLD) {
  const safeBase = baseCeiling > 0 ? baseCeiling : DEFAULT_COMPACTION_THRESHOLD;
  const cap = contextSize > 0 ? contextSize : safeBase;
  const clampedBase = Math.min(cap, safeBase);
  if (totalInput <= clampedBase) {
    return clampedBase;
  }
  if (clampedBase < STEP_UP_INTERMEDIATE_THRESHOLD && totalInput <= STEP_UP_INTERMEDIATE_THRESHOLD && cap >= STEP_UP_INTERMEDIATE_THRESHOLD) {
    return STEP_UP_INTERMEDIATE_THRESHOLD;
  }
  return Math.max(clampedBase, cap);
}

/**
 * 純函式：依 4 層優先序計算脈絡用量百分比與有效權杖上限，並回傳第 4 層步進自癒持久化建議。
 * 供 CLI 與 Antigravity 2.0 共用，完全不碰檔案系統。
 * @param {object} params
 * @returns {{
 *   totalInput: number,
 *   contextSize: number,
 *   effectiveTokenCeiling: number,
 *   usedPctNum: number,
 *   tokenPctNum: number,
 *   stepUpdate: { primaryModelKey: string, convStepKey: string, stepped: number, persistModelCeiling: number, needConvSave: boolean, needModelSave: boolean }|null
 * }}
 */
export function resolveContextMetricsPure({
  totalInput = 0,
  contextSize = 1048576,
  usedPctNum = 0,
  nativeLimit = undefined,
  settings = {},
  env = process.env,
  modelKeys = [],
  catalogEntry = null,
  runtimeMaxContextTokens = 0,
  runtimeModelKeys = [],
  convRemembered = 0,
  modelRemembered = 0
} = {}) {
  const safeTotalInput = Math.max(0, Number(totalInput) || 0);
  const safeContextSize = (typeof contextSize === 'number' && !isNaN(contextSize) && contextSize > 0)
    ? contextSize
    : 1048576;

  let resolvedUsedPct = Number(usedPctNum) || 0;
  if (safeContextSize > 0 && safeTotalInput > 0 && !resolvedUsedPct) {
    resolvedUsedPct = Math.min(100, Math.max(0, (safeTotalInput / safeContextSize) * 100));
  } else {
    resolvedUsedPct = Math.min(100, Math.max(0, resolvedUsedPct));
  }

  let effectiveTokenCeiling = null;
  let stepUpdate = null;

  // 第 1 層：(1a) contextWindow 原生擴充欄位嗅探
  const parsedNative = parseCeilingValue(nativeLimit, safeContextSize, false);
  if (parsedNative !== null) {
    effectiveTokenCeiling = parsedNative;
  }

  // 第 1 層：(1b) 外部設定檔與環境變數覆寫 (settings / AGY_TOKEN_CEILING / AGY_CLI_AUTO_COMPACT_OVERRIDE)
  if (effectiveTokenCeiling === null) {
    const overrideSources = [
      { raw: settings?.ui?.footer?.tokenCeiling, allowPercent: false },
      { raw: settings?.ui?.tokenCeiling, allowPercent: false },
      { raw: env?.AGY_TOKEN_CEILING, allowPercent: false },
      { raw: env?.AGY_CLI_AUTO_COMPACT_OVERRIDE, allowPercent: true }
    ];
    for (const src of overrideSources) {
      const parsedOverride = parseCeilingValue(src.raw, safeContextSize, src.allowPercent);
      if (parsedOverride !== null) {
        effectiveTokenCeiling = parsedOverride;
        break;
      }
    }
  }

  // 第 2 層：單一對話執行期 maxContextTokens（來自 GetCascadeTrajectoryGeneratorMetadata），需與當前模型吻合
  const safeRuntimeMax = Number(runtimeMaxContextTokens || 0) || 0;
  if (effectiveTokenCeiling === null && safeRuntimeMax > 0) {
    const normRuntimeKeys = (Array.isArray(runtimeModelKeys) ? runtimeModelKeys : [])
      .map(normalizeModelName)
      .filter(Boolean);
    const modelMatches =
      modelKeys.length === 0 ||
      normRuntimeKeys.length === 0 ||
      normRuntimeKeys.some(rk => modelKeys.includes(rk));
    if (modelMatches) {
      const runtimeBase = safeContextSize > 0
        ? Math.min(safeContextSize, safeRuntimeMax)
        : safeRuntimeMax;
      effectiveTokenCeiling = computeSteppedCeiling(safeTotalInput, safeContextSize, runtimeBase);
    }
  }

  // 第 3 層：動態模型目錄對照（來自 GetAvailableModels 快取 modelLimits）
  if (effectiveTokenCeiling === null && catalogEntry && typeof catalogEntry.limit === 'number' && catalogEntry.limit > 0) {
    const catalogBase = safeContextSize > 0 ? Math.min(safeContextSize, catalogEntry.limit) : catalogEntry.limit;
    effectiveTokenCeiling = computeSteppedCeiling(safeTotalInput, safeContextSize, catalogBase);
  }

  // 第 4 層：無連線與無快取時退回 256k 基準，並僅針對單一模型／單一對話破頂步進自癒（256k -> 512k -> contextSize）
  if (effectiveTokenCeiling === null) {
    const baseDefault = Math.min(safeContextSize, DEFAULT_COMPACTION_THRESHOLD);
    const primaryModelKey = modelKeys[0] || '';
    const convStepKey = primaryModelKey || '_default';

    const safeConvRemembered = Number(convRemembered || 0) || 0;
    const rawModelRemembered = primaryModelKey ? (Number(modelRemembered || 0) || 0) : 0;
    const clampedModelRemembered = (safeContextSize > STEP_UP_INTERMEDIATE_THRESHOLD)
      ? Math.min(rawModelRemembered, STEP_UP_INTERMEDIATE_THRESHOLD)
      : rawModelRemembered;

    const rememberedBase = Math.max(baseDefault, Math.min(safeContextSize, Math.max(safeConvRemembered, clampedModelRemembered)));
    const stepped = computeSteppedCeiling(safeTotalInput, safeContextSize, rememberedBase);

    if (safeTotalInput > baseDefault) {
      const needConvSave = stepped > safeConvRemembered;
      const persistModelCeiling = (safeContextSize > STEP_UP_INTERMEDIATE_THRESHOLD)
        ? Math.min(stepped, STEP_UP_INTERMEDIATE_THRESHOLD)
        : stepped;
      const needModelSave = Boolean(primaryModelKey && persistModelCeiling > baseDefault && persistModelCeiling > clampedModelRemembered);
      if (needConvSave || needModelSave) {
        stepUpdate = {
          primaryModelKey,
          convStepKey,
          stepped,
          persistModelCeiling,
          needConvSave,
          needModelSave
        };
      }
    }

    effectiveTokenCeiling = stepped;
  }

  const tokenPctNum = effectiveTokenCeiling > 0
    ? Math.min(100, Math.max(0, (safeTotalInput / effectiveTokenCeiling) * 100))
    : resolvedUsedPct;

  return {
    totalInput: safeTotalInput,
    contextSize: safeContextSize,
    effectiveTokenCeiling,
    usedPctNum: resolvedUsedPct,
    tokenPctNum,
    stepUpdate
  };
}

function updateCtxCacheAsync(ctxCachePath, patch) {
  ctxWriteQueue = ctxWriteQueue.then(async () => {
    try {
      await fs.mkdir(dirname(ctxCachePath), { recursive: true });
      const latest = (await readJsonSafeAsync(ctxCachePath)) || {};
      const merged = { ...latest, ...patch };
      if (latest.step_up_ceilings || patch.step_up_ceilings) {
        merged.step_up_ceilings = {
          ...(latest.step_up_ceilings || {}),
          ...(patch.step_up_ceilings || {})
        };
      }
      await writeFileAndVerifyNoBOM(ctxCachePath, JSON.stringify(merged));
    } catch (_) {}
  }).catch(() => {});
  return ctxWriteQueue;
}

/**
 * 計算目前對話的脈絡用量與有效權杖上限（依序套用 4 層解析與單一對話／模型步進自癒）。
 * @param {object} meta
 * @param {string} conversationId
 * @param {object} [settings={}]
 * @param {object|null} [cache=null]
 * @returns {Promise<{ totalInput: number, contextSize: number, effectiveTokenCeiling: number, usedPctNum: number }>}
 */
export async function calculateContextUsageAsync(meta, conversationId, settings = {}, cache = null) {
  const contextWindow = meta?.context_window || {};
  const ctxCachePath = join(os.homedir(), '.gemini', 'tmp', `ctx_${conversationId}.json`);
  const cachedCtx = await readJsonSafeAsync(ctxCachePath);

  let totalInput = contextWindow.total_input_tokens || 0;
  let totalOutput = contextWindow.total_output_tokens || 0;
  let usedPctNum = contextWindow.used_percentage || 0;
  let contextSize = contextWindow.context_window_size || 0;

  const nativeLimitSniffed = contextWindow.compaction_threshold ??
    contextWindow.compaction_token_limit ??
    contextWindow.compact_threshold ??
    contextWindow.effective_context_window_size;

  if (totalInput === 0 && totalOutput === 0) {
    if (cachedCtx) {
      totalInput = cachedCtx.total_input_tokens || 0;
      totalOutput = cachedCtx.total_output_tokens || 0;
      if (cachedCtx.used_percentage) usedPctNum = cachedCtx.used_percentage;
      if (cachedCtx.context_window_size) contextSize = cachedCtx.context_window_size;
      if (cachedCtx.compaction_threshold !== undefined && contextWindow.compaction_threshold === undefined) {
        contextWindow.compaction_threshold = cachedCtx.compaction_threshold;
      }
    }
  } else {
    const ctxPatch = {
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      used_percentage: usedPctNum,
      context_window_size: contextSize
    };
    const resolvedCompaction = nativeLimitSniffed !== undefined ? nativeLimitSniffed : contextWindow.compaction_threshold;
    if (resolvedCompaction !== undefined) {
      ctxPatch.compaction_threshold = resolvedCompaction;
    }
    await updateCtxCacheAsync(ctxCachePath, ctxPatch);
  }

  const currentModelKeys = extractModelCandidateKeys(meta);
  const catalogEntry = resolveCatalogEntry(currentModelKeys, cache?.modelLimits);

  if (!contextSize) {
    contextSize = (catalogEntry && catalogEntry.maxTokens > 0) ? catalogEntry.maxTokens : 1048576;
  }

  const primaryModelKey = currentModelKeys[0] || '';
  const convStepKey = primaryModelKey || '_default';
  const statePath = join(os.homedir(), '.gemini', 'tmp', 'compaction_ceiling_state.json');
  const parsedState = await readJsonSafeAsync(statePath);
  const modelCeilings = (parsedState && typeof parsedState.modelCeilings === 'object' && parsedState.modelCeilings !== null && !Array.isArray(parsedState.modelCeilings))
    ? parsedState.modelCeilings
    : {};

  const resolved = resolveContextMetricsPure({
    totalInput,
    contextSize,
    usedPctNum,
    nativeLimit: contextWindow.compaction_threshold ??
      contextWindow.compaction_token_limit ??
      contextWindow.compact_threshold ??
      contextWindow.effective_context_window_size,
    settings,
    env: process.env,
    modelKeys: currentModelKeys,
    catalogEntry,
    runtimeMaxContextTokens: cachedCtx?.runtime_max_context_tokens || 0,
    runtimeModelKeys: cachedCtx ? [
      cachedCtx.runtime_model_display_name,
      cachedCtx.runtime_model_enum,
      cachedCtx.runtime_model_key
    ] : [],
    convRemembered: Number(cachedCtx?.step_up_ceilings?.[convStepKey] || 0),
    modelRemembered: primaryModelKey ? Number(modelCeilings[primaryModelKey] || 0) : 0
  });

  if (resolved.stepUpdate) {
    const { needConvSave, needModelSave, stepped, persistModelCeiling } = resolved.stepUpdate;
    if (needConvSave) {
      await updateCtxCacheAsync(ctxCachePath, {
        step_up_ceilings: { [convStepKey]: stepped }
      });
    }
    if (needModelSave && primaryModelKey) {
      stateWriteQueue = stateWriteQueue.then(async () => {
        try {
          await fs.mkdir(join(os.homedir(), '.gemini', 'tmp'), { recursive: true });
          const diskParsed = (await readJsonSafeAsync(statePath)) || {};
          const { unlockedVersions: _legacyVersions, ...restState } = diskParsed;
          const latestModels = (restState.modelCeilings && typeof restState.modelCeilings === 'object' && !Array.isArray(restState.modelCeilings))
            ? { ...restState.modelCeilings }
            : {};
          const existingVal = Number(latestModels[primaryModelKey] || 0);
          if (persistModelCeiling > existingVal) {
            latestModels[primaryModelKey] = persistModelCeiling;
          }
          await writeFileAndVerifyNoBOM(statePath, JSON.stringify({ ...restState, modelCeilings: latestModels }, null, 2));
        } catch (_) {}
      }).catch(() => {});
      await stateWriteQueue;
    }
  }

  return {
    totalInput: resolved.totalInput,
    contextSize: resolved.contextSize,
    effectiveTokenCeiling: resolved.effectiveTokenCeiling,
    usedPctNum: resolved.usedPctNum
  };
}
