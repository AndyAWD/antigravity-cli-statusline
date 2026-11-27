import { promises as fs } from 'fs';
import os from 'os';
import { join } from 'path';
import { readJsonSafeAsync } from '../core/fs-utils.mjs';
import { normalizeModelName, sanitizeConversationId } from '../core/normalize.mjs';

const TRANSCRIPT_TAIL_BYTES = 64 * 1024;
const TRANSCRIPT_FALLBACK_TAIL_BYTES = 256 * 1024;
const EFFORT_SUFFIX_RE = /-(low|medium|high|xhigh|max|minimal)$/i;
const MODEL_VARIANT_SUFFIX_RE = /@[a-z0-9._-]+$/i;
const EFFORT_PAREN_SUFFIX_RE = /\s*\(\s*(?:low|medium|high|xhigh|max|minimal)\s*\)\s*$/i;
const EFFORT_DISPLAY_MAP = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  minimal: 'Minimal'
};
const GEMINI_ELEMENT_LABEL_MAP = {
  carbon: 'Carbon',
  argon: 'Argon',
  neon: 'Neon',
  hydrogen: 'Hydrogen'
};
const WORKER_SLUG_RE = /-worker\b/i;
const CONCRETE_ORCH_SUFFIX_RE = /^\s*(?!orchestrator\b).+\(\s*orchestrator\s*\)\s*$/i;
const TRAILING_ORCH_SUFFIX_RE = /\s*\(\s*orchestrator\s*\)\s*$/i;

const TOKEN_DISPLAY_MAP = {
  gemini: 'Gemini',
  claude: 'Claude',
  gpt: 'GPT',
  oss: 'OSS',
  chatgpt: 'ChatGPT',
  openai: 'OpenAI',
  pro: 'Pro',
  flash: 'Flash',
  lite: 'Lite',
  carbon: 'Carbon',
  argon: 'Argon',
  neon: 'Neon',
  hydrogen: 'Hydrogen',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  ultra: 'Ultra',
  nano: 'Nano',
  mini: 'Mini',
  fast: 'Fast',
  thinking: 'Thinking'
};

const EXECUTOR_KEYWORDS = ['hydrogen', 'flash', 'lite', 'fast', 'mini', 'haiku', 'nano', 'worker'];
const PLANNER_KEYWORDS = ['carbon', 'argon', 'neon', 'pro', 'opus', 'sonnet', 'thinking', 'reason'];

function lookupModelLimitEntry(rawName, cache = null) {
  if (typeof rawName !== 'string' || !rawName.trim()) return null;
  if (!cache?.modelLimits || typeof cache.modelLimits !== 'object') return null;
  const norm = normalizeModelName(rawName);
  if (!norm) return null;
  const direct = cache.modelLimits[norm];
  if (direct && typeof direct === 'object') return direct;
  for (const entry of Object.values(cache.modelLimits)) {
    if (!entry || typeof entry !== 'object') continue;
    for (const field of [entry.model, entry.slug, entry.displayName]) {
      if (typeof field === 'string' && field.trim() && normalizeModelName(field) === norm) {
        return entry;
      }
    }
  }
  return null;
}

function stripConcreteOrchestratorSuffix(rawName) {
  if (typeof rawName !== 'string') return '';
  const trimmed = rawName.trim();
  if (!trimmed || !CONCRETE_ORCH_SUFFIX_RE.test(trimmed)) return trimmed;
  return trimmed.replace(TRAILING_ORCH_SUFFIX_RE, '').trim();
}

/**
 * 判斷模型識別碼是否為 Orchestrator 實際派工用的具名 Worker 執行模型（如 gemini-flash-worker-agy / MODEL_PLACEHOLDER_M669）。
 * @param {unknown} rawName
 * @param {object|null} [cache=null]
 * @returns {boolean}
 */
export function isOrchestratorWorkerModel(rawName, cache = null) {
  if (typeof rawName !== 'string' || !rawName.trim()) return false;
  const trimmed = rawName.trim();
  if (WORKER_SLUG_RE.test(trimmed) || CONCRETE_ORCH_SUFFIX_RE.test(trimmed)) {
    return true;
  }
  const entry = lookupModelLimitEntry(trimmed, cache);
  if (entry) {
    const slug = typeof entry.slug === 'string' ? entry.slug.trim() : '';
    const display = typeof entry.displayName === 'string' ? entry.displayName.trim() : '';
    if ((slug && WORKER_SLUG_RE.test(slug)) || (display && CONCRETE_ORCH_SUFFIX_RE.test(display))) {
      return true;
    }
  }
  return false;
}

/**
 * 判斷模型名稱是否屬於 Orchestrator 外層包裝名稱（而非具體執行的底層模型）。
 * 支援選用傳入 cache 以反查 MODEL_PLACEHOLDER_* 內部代號，並排除具名 Worker 執行模型。
 * @param {unknown} rawName
 * @param {object|null} [cache=null]
 * @returns {boolean}
 */
export function isOrchestratorModelName(rawName, cache = null) {
  if (typeof rawName !== 'string' || !rawName.trim()) return false;
  if (isOrchestratorWorkerModel(rawName, cache)) return false;
  if (rawName.toLowerCase().includes('orchestrator')) return true;

  const entry = lookupModelLimitEntry(rawName, cache);
  if (entry) {
    const display = typeof entry.displayName === 'string' ? entry.displayName.trim() : '';
    const slug = typeof entry.slug === 'string' ? entry.slug.trim() : '';
    if (
      (display && display.toLowerCase().includes('orchestrator')) ||
      (slug && slug.toLowerCase().includes('orchestrator'))
    ) {
      return true;
    }
  }
  return false;
}

function cleanProtoModelToken(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.replace(/^["']|["']$/g, '').trim();
  if (!cleaned || /^(?:MODEL_UNSPECIFIED|0|none|null)$/i.test(cleaned)) return '';
  return cleaned;
}

function isUsablePlannerRef(ref) {
  if (typeof ref === 'string') {
    const token = cleanProtoModelToken(ref);
    if (!token) return false;
    if (/^(?:orchestrator|gemini-orchestrator)$/i.test(token)) return false;
    return true;
  }
  if (ref && typeof ref === 'object' && !Array.isArray(ref)) {
    for (const key of ['model', 'modelId', 'model_id', 'slug', 'id', 'name', 'displayName', 'display_name']) {
      if (typeof ref[key] === 'string' && isUsablePlannerRef(ref[key])) {
        return true;
      }
    }
  }
  return false;
}

function readPlannerFieldFromOrchestratorObj(orchObj) {
  if (!orchObj || typeof orchObj !== 'object' || Array.isArray(orchObj)) return null;
  return (
    orchObj.planner ??
    orchObj.plannerModel ??
    orchObj.planner_model ??
    orchObj.plan ??
    orchObj.planModel ??
    orchObj.plan_model ??
    orchObj.orchestratorModel ??
    orchObj.orchestrator_model ??
    orchObj.model ??
    orchObj.modelId ??
    orchObj.model_id ??
    null
  );
}

function readExecutorFieldFromOrchestratorObj(orchObj) {
  if (!orchObj || typeof orchObj !== 'object' || Array.isArray(orchObj)) return null;
  return (
    orchObj.executor ??
    orchObj.executorModel ??
    orchObj.executor_model ??
    orchObj.worker ??
    orchObj.workerModel ??
    orchObj.worker_model ??
    orchObj.orchestratorExecutorModel ??
    orchObj.orchestrator_executor_model ??
    null
  );
}

function readPlannerFieldFromTopLevelObj(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  return (
    obj.planner ??
    obj.plannerModel ??
    obj.planner_model ??
    obj.planModel ??
    obj.plan_model ??
    obj.orchestratorModel ??
    obj.orchestrator_model ??
    (isUsablePlannerRef(obj.plan) ? obj.plan : null) ??
    null
  );
}

/**
 * 依據優先順序解析已配置的 Orchestrator 規劃模型參考（meta > Antigravity 2.0 狀態 > settings > settings.model 完整包裝名稱）。
 * @param {object} [meta={}]
 * @param {object} [settings={}]
 * @param {string} [appOrchestratorModel='']
 * @param {string} [rawWrapperModel='']
 * @returns {string|object|null}
 */
export function resolveConfiguredPlannerRef(meta = {}, settings = {}, appOrchestratorModel = '', rawWrapperModel = '', options = {}) {
  const includeSettingsModelWrapper = options?.includeSettingsModelWrapper !== false;
  const fromMeta = readPlannerFieldFromOrchestratorObj(meta?.orchestrator);
  if (isUsablePlannerRef(fromMeta)) return fromMeta;
  const fromMetaTop = readPlannerFieldFromTopLevelObj(meta);
  if (isUsablePlannerRef(fromMetaTop)) return fromMetaTop;
  const cleanedApp = cleanProtoModelToken(appOrchestratorModel);
  if (cleanedApp && isUsablePlannerRef(cleanedApp)) return cleanedApp;
  const fromSettings = readPlannerFieldFromOrchestratorObj(settings?.orchestrator);
  if (isUsablePlannerRef(fromSettings)) return fromSettings;
  const fromSettingsTop = readPlannerFieldFromTopLevelObj(settings);
  if (isUsablePlannerRef(fromSettingsTop)) return fromSettingsTop;
  if (
    includeSettingsModelWrapper &&
    typeof settings?.model === 'string' &&
    isOrchestratorModelName(settings.model) &&
    isUsablePlannerRef(settings.model)
  ) {
    const explicitRawLabel = typeof rawWrapperModel === 'string' && rawWrapperModel.trim()
      ? extractOrchestratorPlannerLabel(rawWrapperModel)
      : '';
    if (!explicitRawLabel || explicitRawLabel === 'Neon') {
      return settings.model.trim();
    }
  }
  return null;
}

/**
 * 從已配置的規劃模型參考擷取適合放入 Orchestrator (<Planner>) 括號內的精簡顯示名稱。
 * @param {string|object|null} plannerRef
 * @param {object|null} [cache=null]
 * @returns {string}
 */
export function extractOrchestratorPlannerLabel(plannerRef, cache = null) {
  if (!plannerRef) return '';
  let candidates = [];
  if (typeof plannerRef === 'string') {
    if (plannerRef.trim()) candidates = [plannerRef.trim()];
  } else if (typeof plannerRef === 'object' && !Array.isArray(plannerRef)) {
    for (const key of ['model', 'modelId', 'model_id', 'slug', 'id', 'name', 'displayName', 'display_name']) {
      if (typeof plannerRef[key] === 'string' && plannerRef[key].trim()) {
        candidates.push(plannerRef[key].trim());
      }
    }
  }

  for (const cand of candidates) {
    const cleaned = cand.replace(MODEL_VARIANT_SUFFIX_RE, '').trim();
    if (!cleaned || /^(?:MODEL_UNSPECIFIED|0|none|null)$/i.test(cleaned)) continue;

    const elementHit = GEMINI_ELEMENT_LABEL_MAP[cleaned.toLowerCase()];
    if (elementHit) return elementHit;

    const cleanedLower = cleaned.toLowerCase().replace(/-disabled$/i, '');
    if (cleanedLower === 'gemini-pro-orchestrator') return 'Carbon';
    if (cleanedLower === 'gemini-pro-orchestrator-g1-pro') return 'Argon';
    if (cleanedLower === 'gemini-pro-orchestrator-neon') return 'Neon';

    if (isOrchestratorModelName(cleaned, cache)) {
      const entryDisplay = lookupModelLimitEntry(cleaned, cache)?.displayName || cleaned;
      const parenMatch = entryDisplay.match(/\(\s*([^)]+?)\s*\)/);
      if (parenMatch && parenMatch[1] && !parenMatch[1].toLowerCase().includes('orchestrator')) {
        const inner = parenMatch[1].trim();
        return GEMINI_ELEMENT_LABEL_MAP[inner.toLowerCase()] || inner;
      }
      for (const tok of entryDisplay.toLowerCase().split(/[^a-z0-9]+/)) {
        if (tok === 'carbon' || tok === 'argon' || tok === 'neon') {
          return GEMINI_ELEMENT_LABEL_MAP[tok];
        }
      }
      continue;
    }

    const formatted = formatRuntimeModelDisplayName(cleaned, cache);
    if (!formatted || /^MODEL_/i.test(formatted) || formatted.includes('_')) continue;

    let baseDisplay = formatted.replace(EFFORT_PAREN_SUFFIX_RE, '').trim();
    const orchInnerMatch = baseDisplay.match(/^Orchestrator\s*\(([^)]+)\)$/i);
    if (orchInnerMatch) {
      baseDisplay = orchInnerMatch[1].replace(EFFORT_PAREN_SUFFIX_RE, '').trim();
    }
    const slugElemMatch = baseDisplay.match(/^gemini-(?:\d+(?:\.\d+)?-)?(carbon|argon|neon|hydrogen)(?:-(?:high|medium|low|minimal|fast|disabled))?$/i);
    if (slugElemMatch) {
      return GEMINI_ELEMENT_LABEL_MAP[slugElemMatch[1].toLowerCase()];
    }
    const geminiElemMatch = baseDisplay.match(/^Gemini(?:\s+\d+(?:\.\d+)?)?\s+(Carbon|Argon|Neon|Hydrogen)$/i);
    if (geminiElemMatch) {
      return GEMINI_ELEMENT_LABEL_MAP[geminiElemMatch[1].toLowerCase()];
    }
    if (baseDisplay && !/^Orchestrator$/i.test(baseDisplay)) return baseDisplay;
  }

  return '';
}

/**
 * 解析 Orchestrator 外層包裝模型的人類可讀顯示名稱（如 MODEL_PLACEHOLDER_M537 -> Orchestrator (Neon)）。
 * 若傳入配置之規劃模型（options.plannerModel / options.settings / options.meta / options.appOrchestratorModel），則動態合成 Orchestrator (<Planner>)。
 * 若傳入為具體底層模型或具名 Worker，回傳空字串。
 * @param {unknown} rawModel
 * @param {object|null} [cache=null]
 * @param {{ plannerModel?: string|object|null, settings?: object, meta?: object, appOrchestratorModel?: string }} [options={}]
 * @returns {string}
 */
export function resolveOrchestratorWrapperDisplayName(rawModel, cache = null, options = {}) {
  if (typeof rawModel !== 'string') return '';
  const trimmed = rawModel.trim();
  if (!trimmed || !isOrchestratorModelName(trimmed, cache)) return '';

  const explicitConfiguredRef = resolveConfiguredPlannerRef(
    options?.meta,
    options?.settings,
    options?.appOrchestratorModel,
    trimmed,
    { includeSettingsModelWrapper: false }
  );
  const settingsWrapperRef = explicitConfiguredRef
    ? null
    : resolveConfiguredPlannerRef(
        options?.meta,
        options?.settings,
        options?.appOrchestratorModel,
        trimmed,
        { includeSettingsModelWrapper: true }
      );
  const settingsWrapperLabel = settingsWrapperRef ? extractOrchestratorPlannerLabel(settingsWrapperRef, cache) : '';
  const runtimeRef = isUsablePlannerRef(options?.runtimePlannerModel) ? options.runtimePlannerModel : null;

  let plannerRef = null;
  if (isUsablePlannerRef(options?.plannerModel)) {
    plannerRef = options.plannerModel;
  } else if (explicitConfiguredRef) {
    plannerRef = explicitConfiguredRef;
  } else if (settingsWrapperRef && settingsWrapperLabel && settingsWrapperLabel !== 'Neon') {
    plannerRef = settingsWrapperRef;
  } else if (runtimeRef) {
    plannerRef = runtimeRef;
  } else {
    plannerRef = settingsWrapperRef;
  }
  let plannerLabel = extractOrchestratorPlannerLabel(plannerRef, cache);
  if (!plannerLabel && runtimeRef && plannerRef !== runtimeRef) {
    plannerLabel = extractOrchestratorPlannerLabel(runtimeRef, cache);
  }
  if (plannerLabel) {
    return `Orchestrator (${plannerLabel})`;
  }

  const entry = lookupModelLimitEntry(trimmed, cache);
  if (entry && !entry.ambiguous && typeof entry.displayName === 'string' && entry.displayName.trim()) {
    return entry.displayName.trim();
  }

  if (/\s/.test(trimmed) || /[()]/.test(trimmed)) {
    return trimmed;
  }
  if (/^MODEL_/i.test(trimmed) || trimmed.includes('_')) {
    return trimmed;
  }
  return formatRuntimeModelDisplayName(trimmed, null);
}

/**
 * 僅在 cache.modelLimits 內確實存在非歧義且具上限資訊的條目時，將規劃模型參考解析為目錄識別字串；否則回傳空字串。
 * @param {string|object|null} plannerRef
 * @param {object|null} [cache=null]
 * @returns {string}
 */
export function resolvePlannerCatalogModelRef(plannerRef, cache = null) {
  if (!isUsablePlannerRef(plannerRef) || !cache?.modelLimits || typeof cache.modelLimits !== 'object') {
    return '';
  }
  const baseCandidates = extractModelRefCandidates(plannerRef);
  const expanded = [];
  const pushUnique = (val) => {
    if (typeof val !== 'string' || !val.trim()) return;
    const t = val.trim();
    if (!expanded.includes(t)) expanded.push(t);
  };

  for (const cand of baseCandidates) {
    const cleaned = cleanProtoModelToken(cand);
    if (!cleaned) continue;
    pushUnique(cleaned);
    const lower = cleaned.toLowerCase();
    if (GEMINI_ELEMENT_LABEL_MAP[lower]) {
      pushUnique(`gemini-4-${lower}`);
      pushUnique(`gemini-4-${lower}-high`);
      pushUnique(`gemini-4-${lower}-medium`);
    } else if (cleaned.includes('-') && !EFFORT_SUFFIX_RE.test(cleaned) && !/\s/.test(cleaned)) {
      pushUnique(`${cleaned}-high`);
      pushUnique(`${cleaned}-medium`);
    }
  }

  for (const cand of expanded) {
    if (isOrchestratorModelName(cand, cache)) continue;
    const entry = lookupModelLimitEntry(cand, cache);
    if (
      entry &&
      !entry.ambiguous &&
      ((typeof entry.limit === 'number' && entry.limit > 0) || (typeof entry.maxTokens === 'number' && entry.maxTokens > 0))
    ) {
      return entry.model || entry.slug || entry.displayName || cand;
    }
  }

  return '';
}

function isKnownSingleModelRef(rawName, cache = null) {
  if (typeof rawName !== 'string' || !rawName.trim()) return false;
  if (isOrchestratorModelName(rawName, cache) || isOrchestratorWorkerModel(rawName, cache)) return false;
  const trimmed = rawName.trim();
  if (/^MODEL_/i.test(trimmed)) {
    const entry = lookupModelLimitEntry(trimmed, cache);
    return Boolean(entry && (entry.displayName || entry.slug));
  }
  return true;
}

function pushModelRefCandidate(out, rawVal) {
  if (typeof rawVal !== 'string') return;
  const trimmed = rawVal.trim();
  if (!trimmed) return;
  if (MODEL_VARIANT_SUFFIX_RE.test(trimmed)) {
    const stripped = trimmed.replace(MODEL_VARIANT_SUFFIX_RE, '').trim();
    if (stripped && !out.includes(stripped)) {
      out.push(stripped);
    }
  }
  if (!out.includes(trimmed)) {
    out.push(trimmed);
  }
}

function extractModelRefCandidates(ref) {
  if (!ref) return [];
  const out = [];
  if (typeof ref === 'string') {
    pushModelRefCandidate(out, ref);
    return out;
  }
  if (typeof ref === 'object' && !Array.isArray(ref)) {
    for (const key of ['display_name', 'displayName', 'name', 'id', 'model', 'modelId', 'model_id', 'slug']) {
      pushModelRefCandidate(out, ref[key]);
    }
    const effort = typeof ref.effort === 'string' && ref.effort.trim() ? ref.effort.trim() : '';
    if (effort && out.length > 0) {
      const base = out[0];
      if (!base.toLowerCase().includes(effort.toLowerCase())) {
        const lowerEff = effort.toLowerCase();
        if (base.includes('-') && !EFFORT_SUFFIX_RE.test(base)) {
          const hyphenated = `${base}-${lowerEff}`;
          if (!out.includes(hyphenated)) out.push(hyphenated);
        }
        const paren = `${base} (${effort})`;
        if (!out.includes(paren)) out.push(paren);
      }
    }
    return out;
  }
  return [];
}

/**
 * 唯讀解析 Antigravity 2.0 狀態檔（antigravity_state.pbtxt 與 user_config.json）的選定模型與協調器模型代號。
 * @param {string} [homeDir=os.homedir()]
 * @returns {Promise<{ selectedModel: string, orchestratorModel: string, orchestratorExecutorModel: string }>}
 */
export async function readAppModelStateAsync(homeDir = os.homedir()) {
  const empty = { selectedModel: '', orchestratorModel: '', orchestratorExecutorModel: '' };
  if (!homeDir || typeof homeDir !== 'string') return empty;
  let selectedModel = '';
  let orchestratorModel = '';
  let orchestratorExecutorModel = '';
  let pbtxtMtimeMs = 0;
  let configMtimeMs = 0;
  let hasExplicitOrchestratorField = false;

  const pbtxtPath = join(homeDir, '.gemini', 'antigravity', 'antigravity_state.pbtxt');
  try {
    const [raw, st] = await Promise.all([
      fs.readFile(pbtxtPath, 'utf8'),
      fs.stat(pbtxtPath).catch(() => null)
    ]);
    if (st && Number.isFinite(st.mtimeMs)) pbtxtMtimeMs = Math.round(st.mtimeMs);
    const selectedMatch = raw.match(/^\s*last_selected_agent_model:\s*([^\s#]+)/m);
    if (selectedMatch && selectedMatch[1]) {
      selectedModel = cleanProtoModelToken(selectedMatch[1]);
    }
    const orchMatch = raw.match(/^\s*orchestrator_model:\s*([^\s#]+)/m);
    if (orchMatch && orchMatch[1]) {
      orchestratorModel = cleanProtoModelToken(orchMatch[1]);
      if (orchestratorModel) hasExplicitOrchestratorField = true;
    }
    const execMatch = raw.match(/^\s*orchestrator_executor_model:\s*([^\s#]+)/m);
    if (execMatch && execMatch[1]) {
      orchestratorExecutorModel = cleanProtoModelToken(execMatch[1]);
    }
  } catch (_) {}

  const userConfigCandidates = [
    join(homeDir, '.gemini', 'config', 'config.json'),
    join(homeDir, '.gemini', 'antigravity', 'config.json'),
    join(homeDir, '.gemini', 'config', 'user_config.json'),
    join(homeDir, '.gemini', 'antigravity', 'user_config.json')
  ];
  for (const cfgPath of userConfigCandidates) {
    const cfg = await readJsonSafeAsync(cfgPath);
    if (!cfg || typeof cfg !== 'object') continue;
    let fileMtime = 0;
    try {
      const st = await fs.stat(cfgPath);
      if (st && Number.isFinite(st.mtimeMs)) fileMtime = Math.round(st.mtimeMs);
    } catch (_) {}
    if (fileMtime > configMtimeMs) configMtimeMs = fileMtime;

    const us = cfg?.userSettings ?? cfg?.user_settings;
    const orchObj = cfg?.orchestrator ?? us?.orchestrator;

    if (!orchestratorModel) {
      const candidate =
        readPlannerFieldFromOrchestratorObj(orchObj) ??
        readPlannerFieldFromTopLevelObj(us) ??
        readPlannerFieldFromTopLevelObj(cfg);
      const cleaned = typeof candidate === 'string'
        ? cleanProtoModelToken(candidate)
        : (candidate && typeof candidate === 'object' ? (candidate.model ?? candidate.modelId ?? candidate.model_id ?? candidate.slug ?? candidate.id ?? candidate.displayName ?? candidate.display_name ?? '') : '');
      if (isUsablePlannerRef(cleaned)) {
        orchestratorModel = cleanProtoModelToken(cleaned);
        if (orchestratorModel) hasExplicitOrchestratorField = true;
      } else {
        const wrapperFallback = typeof cfg?.model === 'string'
          ? cfg.model
          : (typeof us?.model === 'string' ? us.model : '');
        if (
          wrapperFallback &&
          isOrchestratorModelName(wrapperFallback) &&
          isUsablePlannerRef(wrapperFallback) &&
          (!pbtxtMtimeMs || fileMtime >= pbtxtMtimeMs)
        ) {
          orchestratorModel = cleanProtoModelToken(wrapperFallback);
        }
      }
    }
    if (!orchestratorExecutorModel) {
      const execCand =
        readExecutorFieldFromOrchestratorObj(orchObj) ??
        us?.orchestratorExecutorModel ??
        us?.orchestrator_executor_model ??
        cfg?.orchestratorExecutorModel ??
        cfg?.orchestrator_executor_model ??
        '';
      if (typeof execCand === 'string') {
        orchestratorExecutorModel = cleanProtoModelToken(execCand);
      }
    }
    if (!selectedModel) {
      const selCand =
        cfg?.selectedModel ??
        cfg?.lastSelectedAgentModel ??
        cfg?.last_selected_agent_model ??
        us?.selectedModel ??
        us?.lastSelectedAgentModel ??
        cfg?.model ??
        us?.model ??
        '';
      if (typeof selCand === 'string') {
        selectedModel = cleanProtoModelToken(selCand);
      }
    }
    if (orchestratorModel && orchestratorExecutorModel && selectedModel) break;
  }

  const result = { selectedModel, orchestratorModel, orchestratorExecutorModel };
  Object.defineProperty(result, '_meta', {
    value: {
      pbtxtMtimeMs,
      configMtimeMs,
      mtimeMs: Math.max(pbtxtMtimeMs, configMtimeMs),
      hasExplicitOrchestratorField
    },
    enumerable: false,
    configurable: true
  });
  return result;
}

/**
 * 唯讀解析 Antigravity 2.0 狀態檔（antigravity_state.pbtxt）的目前選定模型代號。
 * @param {string} [homeDir=os.homedir()]
 * @returns {Promise<string>}
 */
export async function readAppSelectedModelAsync(homeDir = os.homedir()) {
  const state = await readAppModelStateAsync(homeDir);
  return state.selectedModel;
}

/**
 * 判斷當前對話是否處於 Orchestrator 動態路由模式。
 * @param {object} [meta]
 * @param {object} [settings={}]
 * @param {object|null} [hookSession=null]
 * @param {string} [fallbackModel='']
 * @param {{ cache?: object|null, appSelectedModel?: string, hasTranscriptOrchestratorSignal?: boolean }} [options={}]
 * @returns {boolean}
 */
export function isOrchestratorSession(meta = {}, settings = {}, hookSession = null, fallbackModel = '', options = {}) {
  const {
    cache = null,
    appSelectedModel = '',
    hasTranscriptOrchestratorSignal = false
  } = options || {};

  const candidates = [
    ...extractModelRefCandidates(meta?.model),
    ...extractModelRefCandidates(hookSession?.modelName),
    ...extractModelRefCandidates(fallbackModel),
    ...extractModelRefCandidates(settings?.model)
  ];
  if (candidates.some(c => isOrchestratorModelName(c, cache) || isOrchestratorWorkerModel(c, cache))) {
    return true;
  }
  if (typeof appSelectedModel === 'string' && appSelectedModel.trim() && isOrchestratorModelName(appSelectedModel, cache)) {
    return true;
  }
  if (meta?.orchestrator && typeof meta.orchestrator === 'object') {
    return true;
  }
  if (hasTranscriptOrchestratorSignal === true) {
    const explicitlySingleByApp = isKnownSingleModelRef(appSelectedModel, cache);
    const explicitlySingleBySettings = isKnownSingleModelRef(
      typeof settings?.model === 'string' ? settings.model : '',
      cache
    );
    const metaRefs = extractModelRefCandidates(meta?.model);
    const explicitlySingleByCliMeta =
      !appSelectedModel &&
      !hookSession &&
      metaRefs.length > 0 &&
      !metaRefs.some(c => isOrchestratorModelName(c, cache) || isOrchestratorWorkerModel(c, cache));
    if (!explicitlySingleByApp && !explicitlySingleBySettings && !explicitlySingleByCliMeta) {
      return true;
    }
  }
  return false;
}

function capitalizeWord(word) {
  if (!word) return '';
  const lower = word.toLowerCase();
  if (TOKEN_DISPLAY_MAP[lower]) return TOKEN_DISPLAY_MAP[lower];
  if (/^\d+(?:\.\d+)?$/.test(word)) return word;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * 將執行期模型識別碼或 slug 格式化為人類可讀顯示名稱（優先比對 modelLimits 目錄）。
 * @param {string} rawModel
 * @param {object|null} [cache=null]
 * @returns {string}
 */
export function formatRuntimeModelDisplayName(rawModel, cache = null) {
  if (typeof rawModel !== 'string') return '';
  let trimmed = rawModel.trim();
  if (!trimmed) return '';

  // 1. 優先透過 cache.modelLimits 反查官方 displayName（保留具名 Worker 並去除外層 (Orchestrator) 尾綴）
  if (cache?.modelLimits && typeof cache.modelLimits === 'object') {
    const entry = lookupModelLimitEntry(trimmed, cache);
    if (entry && !entry.ambiguous && typeof entry.displayName === 'string' && entry.displayName.trim()) {
      const cleanedDisplay = stripConcreteOrchestratorSuffix(entry.displayName);
      if (cleanedDisplay && !isOrchestratorModelName(cleanedDisplay, cache)) {
        return cleanedDisplay;
      }
    }
    if (entry && typeof entry.slug === 'string' && entry.slug.trim() && !isOrchestratorModelName(entry.slug, cache)) {
      trimmed = entry.slug.trim();
    }
  }

  // 2. 若已包含空白或括號，視為人類可讀名稱（若為具名 Worker 尾綴則清理後回傳）
  if (/\s/.test(trimmed) || /[()]/.test(trimmed)) {
    return stripConcreteOrchestratorSuffix(trimmed);
  }

  const normalizedSlug = trimmed.replace(MODEL_VARIANT_SUFFIX_RE, '').trim() || trimmed;

  // 3. 避免誤轉內部位元佔位符（如 MODEL_PLACEHOLDER_M401）
  if (/^MODEL_/i.test(normalizedSlug) || normalizedSlug.includes('_')) {
    return normalizedSlug;
  }

  // 4. 格式化連字號 slug（如 gemini-4-hydrogen-high -> Gemini 4 Hydrogen (High)）
  if (normalizedSlug.includes('-')) {
    let effortLabel = '';
    let baseSlug = normalizedSlug;
    const effortMatch = normalizedSlug.match(EFFORT_SUFFIX_RE);
    if (effortMatch) {
      const eff = effortMatch[1].toLowerCase();
      effortLabel = EFFORT_DISPLAY_MAP[eff] || (eff.charAt(0).toUpperCase() + eff.slice(1));
      baseSlug = normalizedSlug.slice(0, -effortMatch[0].length);
    }

    // 合併緊鄰的版本號連字號（如 3-8 -> 3.8、5-5 -> 5.5）
    const dotted = baseSlug.replace(/(^|-)(\d+)-(\d+)(?=-|$)/g, '$1$2.$3');
    const parts = dotted.split('-').filter(Boolean).map(capitalizeWord);
    const formattedBase = parts.join(' ');
    if (formattedBase) {
      return effortLabel ? `${formattedBase} (${effortLabel})` : formattedBase;
    }
  }

  return capitalizeWord(normalizedSlug);
}

function stripEffortFromNormKey(normKey) {
  return String(normKey || '').replace(/(low|medium|high|max|minimal)$/i, '');
}

function buildModelRoleKeys(ref, cache = null) {
  const exact = new Set();
  const base = new Set();
  const rawList = extractModelRefCandidates(ref);

  for (const raw of rawList) {
    if (isOrchestratorModelName(raw, cache)) continue;
    const norm = normalizeModelName(raw);
    if (!norm) continue;
    exact.add(norm);
    const stripped = stripEffortFromNormKey(norm);
    if (stripped) base.add(stripped);

    const limitEntry = cache?.modelLimits?.[norm];
    if (limitEntry && typeof limitEntry === 'object') {
      for (const field of [limitEntry.slug, limitEntry.model, limitEntry.displayName]) {
        if (typeof field !== 'string' || !field.trim() || isOrchestratorModelName(field, cache)) continue;
        const fNorm = normalizeModelName(field);
        if (fNorm) {
          exact.add(fNorm);
          const fStripped = stripEffortFromNormKey(fNorm);
          if (fStripped) base.add(fStripped);
        }
      }
    }
  }
  return { exact, base };
}

function setsIntersect(a, b) {
  for (const v of a) {
    if (b.has(v)) return true;
  }
  return false;
}

/**
 * 判定 Orchestrator 當前實際模型的角色：'planner'（思考／規劃）或 'executor'（快速／執行）。
 * @param {string} rawModel
 * @param {object} [settings={}]
 * @param {object|null} [cache=null]
 * @param {{ hasThinking?: boolean, thinkingOutputTokens?: number }} [extraHints={}]
 * @returns {'planner'|'executor'|'unknown'}
 */
export function classifyOrchestratorModelRole(rawModel, settings = {}, cache = null, extraHints = {}) {
  if (!rawModel || typeof rawModel !== 'string' || isOrchestratorModelName(rawModel, cache)) {
    return 'unknown';
  }

  const candidateKeys = buildModelRoleKeys(rawModel, cache);

  // 第 1 層：精準對照 settings.orchestrator（v1.5.14+ 原生 Planner / Executor 設定）
  const orchCfg = settings?.orchestrator;
  if ((orchCfg && typeof orchCfg === 'object') || settings) {
    const plannerRef =
      readPlannerFieldFromOrchestratorObj(orchCfg) ??
      readPlannerFieldFromTopLevelObj(settings);
    const executorRef = readExecutorFieldFromOrchestratorObj(orchCfg);
    const plannerKeys = buildModelRoleKeys(plannerRef, cache);
    const executorKeys = buildModelRoleKeys(executorRef, cache);

    const exactPlanner = setsIntersect(candidateKeys.exact, plannerKeys.exact);
    const exactExecutor = setsIntersect(candidateKeys.exact, executorKeys.exact);
    if (exactPlanner && !exactExecutor) return 'planner';
    if (exactExecutor && !exactPlanner) return 'executor';

    const basePlanner = setsIntersect(candidateKeys.base, plannerKeys.base);
    const baseExecutor = setsIntersect(candidateKeys.base, executorKeys.base);
    if (basePlanner && !baseExecutor) return 'planner';
    if (baseExecutor && !basePlanner) return 'executor';
  }

  // 第 2 層：模型名稱關鍵字退讓（使用單字邊界分詞，避免 gemini 誤中 mini 等子字串）
  const keywordTokens = new Set();
  const limitEntry = lookupModelLimitEntry(rawModel, cache);
  for (const text of [rawModel, ...(limitEntry ? [limitEntry.slug, limitEntry.displayName] : [])]) {
    if (typeof text !== 'string' || !text) continue;
    for (const tok of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (tok) keywordTokens.add(tok);
    }
  }
  const isExecutorKw = EXECUTOR_KEYWORDS.some(kw => keywordTokens.has(kw));
  const isPlannerKw = PLANNER_KEYWORDS.some(kw => keywordTokens.has(kw));
  if (isExecutorKw && !isPlannerKw) return 'executor';
  if (isPlannerKw && !isExecutorKw) return 'planner';

  // 第 3 層：執行期思考輸出退讓（僅在前兩層均未命中時參考）
  if (extraHints?.hasThinking === true || Number(extraHints?.thinkingOutputTokens || 0) > 0) {
    return 'planner';
  }

  return 'unknown';
}

function parseTimestampMs(rawTs) {
  if (typeof rawTs === 'number' && Number.isFinite(rawTs) && rawTs > 0) {
    return rawTs;
  }
  if (typeof rawTs === 'string' && rawTs.trim()) {
    const ms = new Date(rawTs).getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }
  return 0;
}

async function scanTranscriptTailAsync(fh, size, mtimeMs, tailBytes, cache = null) {
  const start = Math.max(0, size - tailBytes);
  const len = size - start;
  const buf = Buffer.alloc(len);
  await fh.read(buf, 0, len, start);

  let raw = buf.toString('utf8');
  if (start > 0) {
    const firstNl = raw.indexOf('\n');
    if (firstNl !== -1) raw = raw.slice(firstNl + 1);
  }

  let latestModel = '';
  let latestHasThinking = false;
  let latestTimestampMs = 0;
  let exitPlanModel = '';
  let exitPlanTimestampMs = 0;
  let nonWorkerModel = '';
  let nonWorkerTimestampMs = 0;
  let hasOrchestratorSignal = false;

  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    let step;
    try {
      step = JSON.parse(lines[i]);
    } catch (_) {
      continue; // 略過寫入中的殘缺末行
    }
    if (!step || typeof step !== 'object') continue;
    if (step.type !== 'PLANNER_RESPONSE' && step.source !== 'MODEL') continue;

    const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
    const hasExitPlan = calls.some(tc => tc?.name === 'exit_plan_mode');
    if (hasExitPlan) hasOrchestratorSignal = true;

    if (typeof step.model !== 'string' || !step.model.trim()) continue;
    const model = step.model.trim();
    if (isOrchestratorModelName(model, cache) || isOrchestratorWorkerModel(model, cache)) {
      hasOrchestratorSignal = true;
    }
    if (isOrchestratorModelName(model, cache)) continue;

    const timestampMs = parseTimestampMs(step.created_at) || Math.round(mtimeMs || 0);
    const hasThinking = Boolean(typeof step.thinking === 'string' && step.thinking.trim());
    if (!latestModel) {
      latestModel = model;
      latestHasThinking = hasThinking;
      latestTimestampMs = timestampMs;
    }
    if (hasExitPlan && !exitPlanModel) {
      exitPlanModel = model;
      exitPlanTimestampMs = timestampMs;
    }
    if (!isOrchestratorWorkerModel(model, cache) && !nonWorkerModel) {
      nonWorkerModel = model;
      nonWorkerTimestampMs = timestampMs;
    }
  }

  const resolvedPlannerModel = exitPlanModel || nonWorkerModel || '';
  const resolvedPlannerTs = exitPlanModel ? exitPlanTimestampMs : (nonWorkerModel ? nonWorkerTimestampMs : 0);
  return {
    exists: true,
    model: latestModel,
    hasThinking: latestHasThinking,
    timestampMs: latestModel ? latestTimestampMs : Math.round(mtimeMs || 0),
    plannerModel: resolvedPlannerModel,
    plannerTimestampMs: resolvedPlannerTs,
    hasOrchestratorSignal,
    fileMtimeMs: Math.round(mtimeMs || 0)
  };
}

/**
 * 讀取 transcript.jsonl 尾端（預設 64 KB，未命中時擴大至 256 KB），取得最新非 Orchestrator 包裝的模型識別碼與思考旗標。
 * @param {string} transcriptPath
 * @param {object|null} [cache=null]
 * @returns {Promise<{ exists: boolean, model: string, hasThinking: boolean, timestampMs: number, plannerModel: string, plannerTimestampMs: number, hasOrchestratorSignal: boolean, fileMtimeMs: number }>}
 */
export async function readLatestTranscriptModelAsync(transcriptPath, cache = null) {
  const empty = {
    exists: false,
    model: '',
    hasThinking: false,
    timestampMs: 0,
    plannerModel: '',
    plannerTimestampMs: 0,
    hasOrchestratorSignal: false,
    fileMtimeMs: 0
  };
  if (!transcriptPath || typeof transcriptPath !== 'string') return empty;

  let fh;
  try {
    const stat = await fs.stat(transcriptPath);
    if (!stat.isFile()) return empty;
    const size = stat.size;
    fh = await fs.open(transcriptPath, 'r');

    let result = await scanTranscriptTailAsync(fh, size, stat.mtimeMs, TRANSCRIPT_TAIL_BYTES, cache);
    if (!result.model && size > TRANSCRIPT_TAIL_BYTES) {
      result = await scanTranscriptTailAsync(fh, size, stat.mtimeMs, TRANSCRIPT_FALLBACK_TAIL_BYTES, cache);
    }

    await fh.close();
    fh = null;
    return result;
  } catch (_) {
    if (fh) {
      try { await fh.close(); } catch (_) {}
    }
    return empty;
  }
}

function extractNativeMetaActiveModel(meta, cache = null) {
  const candidates = [
    meta?.model?.active_model,
    meta?.model?.routed_model,
    meta?.model?.actual_model,
    meta?.model?.sub_model,
    meta?.active_model,
    meta?.routed_model,
    meta?.routing_model
  ];
  for (const cand of candidates) {
    if (typeof cand === 'string' && cand.trim() && !isOrchestratorModelName(cand, cache)) {
      return cand.trim();
    }
    if (cand && typeof cand === 'object' && !Array.isArray(cand)) {
      for (const c of extractModelRefCandidates(cand)) {
        if (!isOrchestratorModelName(c, cache)) return c;
      }
    }
  }
  return '';
}

function resolveTranscriptCandidatePaths({ meta, hookSession, conversationId, homeDir }) {
  const paths = [];
  const seen = new Set();
  const push = (p) => {
    if (typeof p !== 'string' || !p.trim()) return;
    const trimmed = p.trim();
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      paths.push(trimmed);
    }
  };
  const pushWithCompactSibling = (p) => {
    if (typeof p !== 'string' || !p.trim()) return;
    const trimmed = p.trim();
    push(trimmed);
    if (/(?:^|[\\/])transcript_full\.jsonl$/i.test(trimmed)) {
      push(trimmed.replace(/transcript_full\.jsonl$/i, 'transcript.jsonl'));
    }
  };

  pushWithCompactSibling(meta?.transcript_path);
  pushWithCompactSibling(hookSession?.transcriptPath);
  if (conversationId) {
    for (const product of ['antigravity-cli', 'antigravity', 'antigravity-ide']) {
      push(join(homeDir, '.gemini', product, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl'));
      push(join(homeDir, '.gemini', product, 'brain', conversationId, '.system_generated', 'logs', 'transcript_full.jsonl'));
    }
  }
  return paths;
}

/**
 * 解析 Orchestrator 模式下當前實際執行的底層模型與思考／快速角色（多源退讓 + 嚴格非 Orchestrator 門控）。
 * @param {object} [params={}]
 * @returns {Promise<{ isOrchestrator: boolean, modelName: string, rawModel: string, role: 'planner'|'executor'|'pending'|'unknown'|'none', source: string }>}
 */
export async function resolveActiveRuntimeModelAsync({
  meta = {},
  fallbackModel = '',
  settings = {},
  cache = null,
  homeDir = os.homedir(),
  pluginDataDir = '',
  env = process.env,
  hookSession = null,
  runtimeTelemetry = null,
  transcriptSummary = null,
  appSelectedModel = ''
} = {}) {
  const convId = sanitizeConversationId(meta?.conversation_id || hookSession?.conversationId || '');
  const metaRefs = extractModelRefCandidates(meta?.model);
  const metaExplicitlyNonOrchestrator =
    !hookSession &&
    !runtimeTelemetry &&
    !appSelectedModel &&
    metaRefs.length > 0 &&
    !metaRefs.some(c => isOrchestratorModelName(c, cache) || isOrchestratorWorkerModel(c, cache)) &&
    !(meta?.orchestrator && typeof meta.orchestrator === 'object');

  // 若尚未取得 hookSession 且對話 ID 有效，先嘗試從 sessions.json 載入（支援 CLI 與 2.0 各自獨立的 plugin_data 目錄）；
  // 若原生 CLI meta.model 已明確切換為非 Orchestrator 模型，則不回頭採信可能過時的 sessions.json。
  let resolvedHookSession = hookSession;
  if (!resolvedHookSession && convId && !metaExplicitlyNonOrchestrator) {
    const candidateSessionFiles = [];
    const seenFiles = new Set();
    const pushSessionFile = (dir) => {
      if (typeof dir !== 'string' || !dir.trim()) return;
      const p = join(dir.trim(), 'sessions.json');
      if (!seenFiles.has(p)) {
        seenFiles.add(p);
        candidateSessionFiles.push(p);
      }
    };

    if (typeof pluginDataDir === 'string' && pluginDataDir.trim()) {
      pushSessionFile(pluginDataDir);
    } else {
      if (typeof env?.PLUGIN_DATA === 'string' && env.PLUGIN_DATA.trim()) {
        pushSessionFile(env.PLUGIN_DATA);
      }
      pushSessionFile(join(homeDir, '.gemini', 'antigravity-cli', 'plugin_data', 'antigravity-cli-statusline'));
      pushSessionFile(join(homeDir, '.gemini', 'antigravity', 'plugin_data', 'antigravity-cli-statusline'));
    }

    const loaded = await Promise.all(candidateSessionFiles.map(p => readJsonSafeAsync(p)));
    let bestEntry = null;
    let bestUpdatedAt = -1;
    for (const sessionsJson of loaded) {
      const entry = sessionsJson?.sessions?.[convId];
      if (entry && typeof entry === 'object') {
        const ts = Number(entry.updatedAt || 0) || parseTimestampMs(entry.lastHookAt);
        if (!bestEntry || ts > bestUpdatedAt) {
          bestEntry = entry;
          bestUpdatedAt = ts;
        }
      }
    }
    if (bestEntry) {
      resolvedHookSession = bestEntry;
    }
  }

  const hasTranscriptOrchestratorSignal = Boolean(transcriptSummary?.hasOrchestratorSignal);
  const orchestratorActive = isOrchestratorSession(meta, settings, resolvedHookSession, fallbackModel, {
    cache,
    appSelectedModel,
    hasTranscriptOrchestratorSignal
  });
  if (!orchestratorActive) {
    return { isOrchestrator: false, modelName: '', rawModel: '', role: 'none', source: '' };
  }

  // 1. 原生 meta 擴充欄位（零 I/O）
  const nativeModel = extractNativeMetaActiveModel(meta, cache);
  if (nativeModel) {
    return {
      isOrchestrator: true,
      modelName: formatRuntimeModelDisplayName(nativeModel, cache),
      rawModel: nativeModel,
      role: classifyOrchestratorModelRole(nativeModel, settings, cache),
      source: 'meta'
    };
  }

  // 2. Hook PreInvocation / PostInvocation 快取模型
  const hookRawModel = (typeof resolvedHookSession?.modelName === 'string' && !isOrchestratorModelName(resolvedHookSession.modelName, cache))
    ? resolvedHookSession.modelName.trim()
    : '';
  const hookTs = Number(resolvedHookSession?.updatedAt || 0) || parseTimestampMs(resolvedHookSession?.lastHookAt);

  // 3. transcript.jsonl 最新 PLANNER_RESPONSE.model（若外部已讀取且含有效底層模型則直接重用；空字串時退讓讀取精簡版）
  let trModel = '';
  let trHasThinking = false;
  let trTs = 0;
  const summaryModel = (transcriptSummary && typeof transcriptSummary === 'object' && typeof transcriptSummary.lastModel === 'string')
    ? transcriptSummary.lastModel.trim()
    : '';
  if (summaryModel && !isOrchestratorModelName(summaryModel, cache)) {
    trModel = summaryModel;
    trHasThinking = Boolean(transcriptSummary.lastModelHasThinking);
    trTs = Number(transcriptSummary.lastModelTimestampMs || transcriptSummary.mtimeMs || 0);
  } else {
    const candidatePaths = resolveTranscriptCandidatePaths({
      meta,
      hookSession: resolvedHookSession,
      conversationId: convId,
      homeDir
    });
    for (const p of candidatePaths) {
      const tr = await readLatestTranscriptModelAsync(p, cache);
      if (tr.exists && tr.model) {
        trModel = tr.model;
        trHasThinking = tr.hasThinking;
        trTs = tr.timestampMs;
        break;
      }
    }
  }

  // 比對 Hook 與 Transcript 時間戳擇新
  if (hookRawModel && trModel) {
    if (hookTs > trTs) {
      return {
        isOrchestrator: true,
        modelName: formatRuntimeModelDisplayName(hookRawModel, cache),
        rawModel: hookRawModel,
        role: classifyOrchestratorModelRole(hookRawModel, settings, cache),
        source: 'hook'
      };
    }
    return {
      isOrchestrator: true,
      modelName: formatRuntimeModelDisplayName(trModel, cache),
      rawModel: trModel,
      role: classifyOrchestratorModelRole(trModel, settings, cache, { hasThinking: trHasThinking }),
      source: 'transcript'
    };
  }
  if (hookRawModel) {
    return {
      isOrchestrator: true,
      modelName: formatRuntimeModelDisplayName(hookRawModel, cache),
      rawModel: hookRawModel,
      role: classifyOrchestratorModelRole(hookRawModel, settings, cache),
      source: 'hook'
    };
  }
  if (trModel) {
    return {
      isOrchestrator: true,
      modelName: formatRuntimeModelDisplayName(trModel, cache),
      rawModel: trModel,
      role: classifyOrchestratorModelRole(trModel, settings, cache, { hasThinking: trHasThinking }),
      source: 'transcript'
    };
  }

  // 4. Language Server 執行期遙測快取（runtimeTelemetry / ctx_<id>.json）
  let lsRawModel = '';
  let thinkingOutputTokens = Number(runtimeTelemetry?.usage?.thinkingOutputTokens || 0) || 0;
  for (const cand of [runtimeTelemetry?.modelDisplayName, runtimeTelemetry?.model]) {
    if (typeof cand === 'string' && cand.trim() && !isOrchestratorModelName(cand, cache)) {
      lsRawModel = cand.trim();
      break;
    }
  }
  if (!lsRawModel && convId) {
    const cliCtx = await readJsonSafeAsync(join(homeDir, '.gemini', 'tmp', `ctx_${convId}.json`));
    if (cliCtx && typeof cliCtx === 'object') {
      for (const cand of [cliCtx.runtime_model_display_name, cliCtx.runtime_model_enum]) {
        if (typeof cand === 'string' && cand.trim() && !isOrchestratorModelName(cand, cache)) {
          lsRawModel = cand.trim();
          break;
        }
      }
      if (!thinkingOutputTokens) {
        thinkingOutputTokens = Number(cliCtx.total_thinking_tokens || 0) || 0;
      }
    }
  }

  if (lsRawModel) {
    return {
      isOrchestrator: true,
      modelName: formatRuntimeModelDisplayName(lsRawModel, cache),
      rawModel: lsRawModel,
      role: classifyOrchestratorModelRole(lsRawModel, settings, cache, { thinkingOutputTokens }),
      source: 'ls_cache'
    };
  }

  return {
    isOrchestrator: true,
    modelName: '',
    rawModel: '',
    role: 'pending',
    source: 'pending'
  };
}

/**
 * 當組態未顯式指定 Orchestrator planner（或 Antigravity 2.0 僅紀錄 Neon wrapper）時，
 * 由活躍對話的工作階段紀錄、逐字稿規劃輪次與執行期偵測結果安全推斷目前 planner 模型，並比對組態更新時間避免舊工作階段污染。
 * @param {object} [options={}]
 * @returns {string}
 */
export function resolveRuntimeSessionPlannerRef(options = {}) {
  const {
    session = null,
    transcript = null,
    runtimeModel = null,
    appModelState = null,
    settingsTimestampMs = 0,
    cache = null
  } = options || {};

  const appStateMtimeMs = Number(appModelState?._meta?.mtimeMs || 0) || 0;
  const minFreshMs = Math.max(Number(settingsTimestampMs) || 0, appStateMtimeMs);

  const isCandidateUsable = (cand) => {
    if (typeof cand !== 'string' || !cand.trim()) return false;
    const trimmed = cand.trim();
    if (!isUsablePlannerRef(trimmed)) return false;
    if (isOrchestratorModelName(trimmed, cache)) return false;
    if (isOrchestratorWorkerModel(trimmed, cache)) return false;
    return true;
  };

  const isFreshRelativeToConfig = (eventTs, fileTs = 0) => {
    if (!minFreshMs) return true;
    const bestTs = Math.max(Number(eventTs) || 0, Number(fileTs) || 0);
    if (!bestTs) return false;
    return bestTs >= minFreshMs;
  };

  if (session && typeof session === 'object') {
    const sessUpdatedAt = Number(session.updatedAt || 0) || 0;
    const sessPlannerTs = Number(session.lastPlannerUpdatedAt || sessUpdatedAt || 0) || 0;
    if (isCandidateUsable(session.lastPlannerModel) && isFreshRelativeToConfig(sessPlannerTs, sessUpdatedAt)) {
      return session.lastPlannerModel.trim();
    }
    if (isCandidateUsable(session.modelName) && isFreshRelativeToConfig(sessUpdatedAt, sessUpdatedAt)) {
      return session.modelName.trim();
    }
  }

  if (transcript && typeof transcript === 'object') {
    const trPlanner =
      (typeof transcript.lastPlannerModel === 'string' && transcript.lastPlannerModel.trim())
        ? transcript.lastPlannerModel.trim()
        : (typeof transcript.plannerModel === 'string' && transcript.plannerModel.trim() ? transcript.plannerModel.trim() : '');
    const trFileMtime = Number(transcript.fileMtimeMs || transcript.mtimeMs || 0) || 0;
    const trPlannerTs = Number(
      transcript.lastPlannerTimestampMs ||
      transcript.plannerTimestampMs ||
      transcript.lastModelTimestampMs ||
      transcript.timestampMs ||
      0
    ) || 0;
    if (isCandidateUsable(trPlanner) && isFreshRelativeToConfig(trPlannerTs, trFileMtime)) {
      return trPlanner;
    }
  }

  if (runtimeModel && typeof runtimeModel === 'object' && runtimeModel.role === 'planner') {
    const rtCand =
      (typeof runtimeModel.rawModel === 'string' && runtimeModel.rawModel.trim())
        ? runtimeModel.rawModel.trim()
        : (typeof runtimeModel.modelName === 'string' ? runtimeModel.modelName.trim() : '');
    if (isCandidateUsable(rtCand) && isFreshRelativeToConfig(Number(runtimeModel.timestampMs || 0) || 0, 0)) {
      return rtCand;
    }
  }

  return '';
}
