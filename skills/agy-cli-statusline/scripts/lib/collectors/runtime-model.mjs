import { promises as fs } from 'fs';
import os from 'os';
import { join } from 'path';
import { readJsonSafeAsync } from '../core/fs-utils.mjs';
import { normalizeModelName, sanitizeConversationId } from '../core/normalize.mjs';

const TRANSCRIPT_TAIL_BYTES = 64 * 1024;
const TRANSCRIPT_FALLBACK_TAIL_BYTES = 256 * 1024;
const EFFORT_SUFFIX_RE = /-(low|medium|high|xhigh|max|minimal)$/i;
const EFFORT_DISPLAY_MAP = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  minimal: 'Minimal'
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

function extractModelRefCandidates(ref) {
  if (!ref) return [];
  if (typeof ref === 'string') {
    return ref.trim() ? [ref.trim()] : [];
  }
  if (typeof ref === 'object' && !Array.isArray(ref)) {
    const out = [];
    for (const key of ['display_name', 'displayName', 'name', 'id', 'model', 'slug']) {
      if (typeof ref[key] === 'string' && ref[key].trim()) {
        out.push(ref[key].trim());
      }
    }
    const effort = typeof ref.effort === 'string' && ref.effort.trim() ? ref.effort.trim() : '';
    if (effort && out.length > 0) {
      const base = out[0];
      if (!base.toLowerCase().includes(effort.toLowerCase())) {
        out.push(`${base} (${effort})`);
      }
    }
    return out;
  }
  return [];
}

/**
 * 唯讀解析 Antigravity 2.0 狀態檔（antigravity_state.pbtxt）的目前選定模型代號。
 * @param {string} [homeDir=os.homedir()]
 * @returns {Promise<string>}
 */
export async function readAppSelectedModelAsync(homeDir = os.homedir()) {
  if (!homeDir || typeof homeDir !== 'string') return '';
  const pbtxtPath = join(homeDir, '.gemini', 'antigravity', 'antigravity_state.pbtxt');
  try {
    const raw = await fs.readFile(pbtxtPath, 'utf8');
    const match = raw.match(/^\s*last_selected_agent_model:\s*([^\s#]+)/m);
    if (!match || !match[1]) return '';
    return match[1].replace(/^["']|["']$/g, '').trim();
  } catch (_) {
    return '';
  }
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
  const trimmed = rawModel.trim();
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
  }

  // 2. 若已包含空白或括號，視為人類可讀名稱（若為具名 Worker 尾綴則清理後回傳）
  if (/\s/.test(trimmed) || /[()]/.test(trimmed)) {
    return stripConcreteOrchestratorSuffix(trimmed);
  }

  // 3. 避免誤轉內部位元佔位符（如 MODEL_PLACEHOLDER_M401）
  if (/^MODEL_/i.test(trimmed) || trimmed.includes('_')) {
    return trimmed;
  }

  // 4. 格式化連字號 slug（如 gemini-4-hydrogen-high -> Gemini 4 Hydrogen (High)）
  if (trimmed.includes('-')) {
    let effortLabel = '';
    let baseSlug = trimmed;
    const effortMatch = trimmed.match(EFFORT_SUFFIX_RE);
    if (effortMatch) {
      const eff = effortMatch[1].toLowerCase();
      effortLabel = EFFORT_DISPLAY_MAP[eff] || (eff.charAt(0).toUpperCase() + eff.slice(1));
      baseSlug = trimmed.slice(0, -effortMatch[0].length);
    }

    // 合併緊鄰的版本號連字號（如 3-8 -> 3.8、5-5 -> 5.5）
    const dotted = baseSlug.replace(/(^|-)(\d+)-(\d+)(?=-|$)/g, '$1$2.$3');
    const parts = dotted.split('-').filter(Boolean).map(capitalizeWord);
    const formattedBase = parts.join(' ');
    if (formattedBase) {
      return effortLabel ? `${formattedBase} (${effortLabel})` : formattedBase;
    }
  }

  return capitalizeWord(trimmed);
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
  if (orchCfg && typeof orchCfg === 'object') {
    const plannerRef = orchCfg.planner ?? orchCfg.plannerModel ?? orchCfg.planner_model;
    const executorRef = orchCfg.executor ?? orchCfg.executorModel ?? orchCfg.executor_model;
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
    if (typeof step.model !== 'string' || !step.model.trim()) continue;
    const model = step.model.trim();
    if (isOrchestratorModelName(model, cache)) continue;

    const timestampMs = parseTimestampMs(step.created_at) || Math.round(mtimeMs || 0);
    const hasThinking = Boolean(typeof step.thinking === 'string' && step.thinking.trim());
    return { exists: true, model, hasThinking, timestampMs };
  }

  return { exists: true, model: '', hasThinking: false, timestampMs: Math.round(mtimeMs || 0) };
}

/**
 * 讀取 transcript.jsonl 尾端（預設 64 KB，未命中時擴大至 256 KB），取得最新非 Orchestrator 包裝的模型識別碼與思考旗標。
 * @param {string} transcriptPath
 * @param {object|null} [cache=null]
 * @returns {Promise<{ exists: boolean, model: string, hasThinking: boolean, timestampMs: number }>}
 */
export async function readLatestTranscriptModelAsync(transcriptPath, cache = null) {
  const empty = { exists: false, model: '', hasThinking: false, timestampMs: 0 };
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
