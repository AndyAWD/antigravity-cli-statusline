import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TAIL_BYTES = 64 * 1024;
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

/**
 * 僅讀取 transcript.jsonl 尾端 64 KB 並容錯解析步驟數與目前代理狀態。
 * @param {string} transcriptPath
 * @returns {Promise<{ exists: boolean, stepCount: number, derivedAgentState: string, lastToolName: string, lastToolSummary: string, lastError: string, mtimeMs: number }>}
 */
export async function readTranscriptSummaryAsync(transcriptPath) {
  const empty = {
    exists: false,
    stepCount: 0,
    derivedAgentState: 'idle',
    lastToolName: '',
    lastToolSummary: '',
    lastError: '',
    mtimeMs: 0
  };
  if (!transcriptPath || typeof transcriptPath !== 'string') return empty;

  let fh;
  try {
    const stat = await fs.stat(transcriptPath);
    if (!stat.isFile()) return empty;
    const size = stat.size;
    const start = Math.max(0, size - TAIL_BYTES);
    const len = size - start;
    fh = await fs.open(transcriptPath, 'r');
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    await fh.close();
    fh = null;

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

      if (step.type === 'GENERIC') {
        pendingToolResults++;
        if (step.status === 'RUNNING' && derivedAgentState !== 'error') {
          derivedAgentState = 'tool_use';
        }
        continue;
      }

      if (step.type === 'PLANNER_RESPONSE') {
        const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
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
        break;
      }

      if (step.type === 'USER_INPUT') {
        if (derivedAgentState !== 'error' && lastStep === step) {
          derivedAgentState = 'working';
        }
        break;
      }
    }

    return {
      exists: true,
      stepCount,
      derivedAgentState,
      lastToolName,
      lastToolSummary,
      lastError,
      mtimeMs: stat.mtimeMs
    };
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
