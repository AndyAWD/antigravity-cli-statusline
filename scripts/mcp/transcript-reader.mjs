import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isOrchestratorModelName,
  isOrchestratorWorkerModel
} from '../../skills/agy-cli-statusline/scripts/lib/collectors/runtime-model.mjs';

const TAIL_BYTES = 64 * 1024;
const FALLBACK_TAIL_BYTES = 256 * 1024;
const UUID_DIR_RE = /^[0-9a-f-]{8,}$/i;

function unquote(val) {
  if (typeof val !== 'string') return val == null ? '' : String(val);
  const s = val.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try { return String(JSON.parse(s)); } catch (_) { return s.slice(1, -1); }
  }
  return s;
}

function describeToolCall(tc) {
  const name = tc?.name || '';
  if (!name) return '';
  const args = tc.args && typeof tc.args === 'object' ? tc.args : {};
  const summary = unquote(args.toolSummary) || unquote(args.toolAction);
  if (summary) return summary;
  const target = unquote(args.Path || args.AbsolutePath || args.TargetFile);
  if (target) return `${name} ${path.basename(target)}`;
  return name;
}

async function scanTranscriptTailSummaryAsync(fh, size, mtimeMs, tailBytes) {
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
  let stepCount = lines.length;
  let lastStep = null;
  let lastToolName = '';
  let lastToolSummary = '';
  let lastError = '';
  let lastModel = '';
  let lastModelHasThinking = false;
  let lastModelTimestampMs = 0;
  let lastPlannerModel = '';
  let lastPlannerTimestampMs = 0;
  let exitPlanModel = '';
  let exitPlanTimestampMs = 0;
  let hasOrchestratorSignal = false;
  let foundPrimaryTurnBoundary = false;
  let foundUserInputBoundary = false;
  let pendingToolResults = 0;
  let derivedAgentState = 'idle';

  for (let i = lines.length - 1; i >= 0; i--) {
    let step;
    try {
      step = JSON.parse(lines[i]);
    } catch (_) {
      continue; // 略過寫入中的殘缺末行
    }
    if (!step || typeof step !== 'object') continue;

    if (!lastStep) {
      lastStep = step;
      if (Number.isFinite(step.step_index) && step.step_index >= 0) {
        stepCount = Math.max(stepCount, Math.floor(step.step_index) + 1 + (lines.length - 1 - i));
      }
      if (step.type === 'ERROR_MESSAGE' || step.status === 'ERROR') {
        lastError = typeof step.error === 'string' ? step.error.slice(0, 200) : 'error';
        derivedAgentState = 'error';
      }
    }

    if (step.type === 'SYSTEM_MESSAGE' && typeof step.content === 'string' && step.content.includes('[plan review')) {
      hasOrchestratorSignal = true;
    }

    if (step.type === 'GENERIC') {
      if (!foundPrimaryTurnBoundary) {
        pendingToolResults++;
        if (step.status === 'RUNNING' && derivedAgentState !== 'error') {
          derivedAgentState = 'tool_use';
        }
      }
      continue;
    }

    if (step.type === 'PLANNER_RESPONSE') {
      const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
      const hasExitPlan = calls.some(tc => tc?.name === 'exit_plan_mode');
      if (hasExitPlan) {
        hasOrchestratorSignal = true;
      }

      if (typeof step.model === 'string' && step.model.trim()) {
        const stepModel = step.model.trim();
        if (isOrchestratorModelName(stepModel) || isOrchestratorWorkerModel(stepModel)) {
          hasOrchestratorSignal = true;
        }
        const ts = typeof step.created_at === 'string' && step.created_at.trim() ? new Date(step.created_at).getTime() : 0;
        const resolvedTs = (Number.isFinite(ts) && ts > 0) ? ts : Math.round(mtimeMs || 0);
        if (!foundUserInputBoundary && !lastModel && !isOrchestratorModelName(stepModel)) {
          lastModel = stepModel;
          lastModelHasThinking = Boolean(typeof step.thinking === 'string' && step.thinking.trim());
          lastModelTimestampMs = resolvedTs;
        }
        if (!isOrchestratorModelName(stepModel) && !isOrchestratorWorkerModel(stepModel)) {
          if (hasExitPlan && !exitPlanModel) {
            exitPlanModel = stepModel;
            exitPlanTimestampMs = resolvedTs;
          }
          if (!lastPlannerModel) {
            lastPlannerModel = stepModel;
            lastPlannerTimestampMs = resolvedTs;
          }
        }
      }

      if (!foundPrimaryTurnBoundary) {
        if (calls.length > 0) {
          const newestCall = calls[calls.length - 1];
          lastToolName = newestCall?.name || '';
          lastToolSummary = describeToolCall(newestCall);
          if (derivedAgentState !== 'error') {
            derivedAgentState = pendingToolResults < calls.length ? 'tool_use' : 'working';
          }
        } else if (derivedAgentState !== 'error') {
          derivedAgentState = pendingToolResults === 0 && lastStep === step ? 'idle' : 'working';
        }
        foundPrimaryTurnBoundary = true;
      }
      continue;
    }

    if (step.type === 'USER_INPUT') {
      if (!foundPrimaryTurnBoundary && derivedAgentState !== 'error' && lastStep === step) {
        derivedAgentState = 'working';
      }
      foundPrimaryTurnBoundary = true;
      foundUserInputBoundary = true;
    }
  }

  const resolvedPlannerModel = exitPlanModel || lastPlannerModel || '';
  const resolvedPlannerTimestampMs = exitPlanModel
    ? exitPlanTimestampMs
    : (lastPlannerModel ? lastPlannerTimestampMs : 0);

  return {
    exists: true,
    stepCount,
    derivedAgentState,
    lastToolName,
    lastToolSummary,
    lastError,
    lastModel,
    lastModelHasThinking,
    lastModelTimestampMs,
    lastPlannerModel: resolvedPlannerModel,
    lastPlannerTimestampMs: resolvedPlannerTimestampMs,
    hasOrchestratorSignal,
    mtimeMs
  };
}

/**
 * 僅讀取 transcript.jsonl 尾端 64 KB（必要時退讓精簡版或 256 KB）並容錯解析步驟數、目前代理狀態與底層模型訊號。
 * @param {string} transcriptPath
 * @returns {Promise<{ exists: boolean, stepCount: number, derivedAgentState: string, lastToolName: string, lastToolSummary: string, lastError: string, lastModel: string, lastModelHasThinking: boolean, lastModelTimestampMs: number, lastPlannerModel: string, lastPlannerTimestampMs: number, hasOrchestratorSignal: boolean, mtimeMs: number }>}
 */
export async function readTranscriptSummaryAsync(transcriptPath) {
  const empty = {
    exists: false,
    stepCount: 0,
    derivedAgentState: 'idle',
    lastToolName: '',
    lastToolSummary: '',
    lastError: '',
    lastModel: '',
    lastModelHasThinking: false,
    lastModelTimestampMs: 0,
    lastPlannerModel: '',
    lastPlannerTimestampMs: 0,
    hasOrchestratorSignal: false,
    mtimeMs: 0
  };
  if (!transcriptPath || typeof transcriptPath !== 'string') return empty;

  let fh;
  try {
    const stat = await fs.stat(transcriptPath);
    if (!stat.isFile()) return empty;
    const size = stat.size;
    fh = await fs.open(transcriptPath, 'r');
    const summary = await scanTranscriptTailSummaryAsync(fh, size, stat.mtimeMs, TAIL_BYTES);

    let fallbackSummary = null;
    if (!summary.lastModel && /(?:^|[\\/])transcript_full\.jsonl$/i.test(transcriptPath)) {
      const compactPath = transcriptPath.replace(/transcript_full\.jsonl$/i, 'transcript.jsonl');
      const compactRes = await readTranscriptSummaryAsync(compactPath);
      if (compactRes.exists && (compactRes.lastModel || compactRes.lastPlannerModel || compactRes.hasOrchestratorSignal)) {
        fallbackSummary = compactRes;
      }
    }

    if ((!summary.lastModel || !summary.lastPlannerModel) && !fallbackSummary?.lastModel && size > TAIL_BYTES) {
      fallbackSummary = await scanTranscriptTailSummaryAsync(fh, size, stat.mtimeMs, FALLBACK_TAIL_BYTES);
    }

    await fh.close();
    fh = null;

    if (fallbackSummary) {
      if (!summary.lastModel && fallbackSummary.lastModel) {
        summary.lastModel = fallbackSummary.lastModel;
        summary.lastModelHasThinking = fallbackSummary.lastModelHasThinking;
        summary.lastModelTimestampMs = fallbackSummary.lastModelTimestampMs;
      }
      if (!summary.lastPlannerModel && fallbackSummary.lastPlannerModel) {
        summary.lastPlannerModel = fallbackSummary.lastPlannerModel;
        summary.lastPlannerTimestampMs = fallbackSummary.lastPlannerTimestampMs;
      }
      if (fallbackSummary.hasOrchestratorSignal) {
        summary.hasOrchestratorSignal = true;
      }
    }

    return summary;
  } catch (_) {
    if (fh) {
      try { await fh.close(); } catch (_) {}
    }
    return empty;
  }
}

/**
 * 計算指定 artifact 目錄內 *.metadata.json 產出檔案數量。
 * @param {string} artifactDir
 * @returns {Promise<number>}
 */
export async function countArtifactsInDirAsync(artifactDir) {
  if (!artifactDir || typeof artifactDir !== 'string') return 0;
  try {
    const entries = await fs.readdir(artifactDir);
    return entries.filter(f => f.endsWith('.metadata.json')).length;
  } catch (_) {
    return 0;
  }
}

/**
 * 掃描 ~/.gemini/{antigravity,antigravity-cli,antigravity-ide}/brain/ 最近對話目錄，作為無 Hook 紀錄時之退讓來源。
 * @param {string} [homeDir=os.homedir()]
 * @param {number} [limit=15]
 * @returns {Promise<Array<{ conversationId: string, product: string, artifactDirectoryPath: string, transcriptPath: string, updatedAt: number }>>}
 */
export async function discoverRecentBrainSessionsAsync(homeDir = os.homedir(), limit = 15) {
  const products = ['antigravity', 'antigravity-cli', 'antigravity-ide'];
  const found = [];
  const seen = new Set();

  for (const product of products) {
    const brainRoot = path.join(homeDir, '.gemini', product, 'brain');
    let entries;
    try {
      entries = await fs.readdir(brainRoot, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID_DIR_RE.test(entry.name) || seen.has(entry.name)) continue;
      const convDir = path.join(brainRoot, entry.name);
      const tPath = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
      let mtimeMs = 0;
      try {
        const tStat = await fs.stat(tPath);
        mtimeMs = tStat.mtimeMs;
      } catch (_) {
        try {
          const dStat = await fs.stat(convDir);
          mtimeMs = dStat.mtimeMs;
        } catch (_) {
          continue;
        }
      }
      seen.add(entry.name);
      found.push({
        conversationId: entry.name,
        product,
        artifactDirectoryPath: convDir,
        transcriptPath: tPath,
        updatedAt: Math.round(mtimeMs)
      });
    }
  }

  found.sort((a, b) => b.updatedAt - a.updatedAt);
  return found.slice(0, limit);
}
