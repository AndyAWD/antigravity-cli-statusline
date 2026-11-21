import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readJsonSafeSync,
  writeFileSyncAndVerifyNoBOM
} from '../../skills/agy-cli-statusline/scripts/lib/core/fs-utils.mjs';
import { sanitizeConversationId } from '../../skills/agy-cli-statusline/scripts/lib/core/normalize.mjs';

const MAX_SESSIONS = 20;

function readStdinAsyncWithLimit(timeoutMs = 200) {
  if (process.stdin.isTTY) {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    let settled = false;
    let data = '';
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeListener('data', onData);
      process.stdin.removeListener('end', onEnd);
      process.stdin.removeListener('error', onError);
      try { process.stdin.pause(); } catch (_) {}
      resolve(data.replace(/^\uFEFF/, ''));
    };
    const onData = (chunk) => {
      data += chunk;
    };
    const onEnd = () => finish();
    const onError = () => finish();
    const timer = setTimeout(finish, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', onData);
      process.stdin.on('end', onEnd);
      process.stdin.on('error', onError);
    } catch (_) {
      finish();
    }
  });
}

function writeAtomicWithRetry(filePath, content, mode) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSyncAndVerifyNoBOM(filePath, content);
      if (mode !== undefined && process.platform !== 'win32') {
        try { fs.chmodSync(filePath, mode); } catch (_) {}
      }
      return true;
    } catch (err) {
      if (attempt < 2 && err && (err.code === 'EPERM' || err.code === 'EBUSY')) {
        const until = Date.now() + 15 * (attempt + 1);
        while (Date.now() < until) { /* short spin for Windows file lock */ }
        continue;
      }
      return false;
    }
  }
  return false;
}

function deriveAgentState(eventName, payload) {
  if (eventName === 'SessionStart') return 'initializing';
  if (eventName === 'PreInvocation' || eventName === 'PostInvocation') return 'working';
  if (eventName === 'Stop') {
    if (payload && typeof payload.error === 'string' && payload.error.trim()) {
      return 'error';
    }
    return payload?.fullyIdle === false ? 'working' : 'idle';
  }
  return 'idle';
}

async function main() {
  let eventName = String(process.argv[2] || '').trim() || 'Unknown';
  try {
    const rawStdin = await readStdinAsyncWithLimit(200);
    let payload = {};
    if (rawStdin.trim()) {
      try {
        const parsed = JSON.parse(rawStdin);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed;
        }
      } catch (_) {}
    }
    if (eventName === 'Unknown' && typeof payload.hookEventName === 'string' && payload.hookEventName.trim()) {
      eventName = payload.hookEventName.trim();
    }

    const dataDir =
      (typeof process.env.PLUGIN_DATA === 'string' && process.env.PLUGIN_DATA.trim())
        ? process.env.PLUGIN_DATA.trim()
        : path.join(os.homedir(), '.gemini', 'plugin-data', 'antigravity-cli-statusline');

    fs.mkdirSync(dataDir, { recursive: true });

    const convId = sanitizeConversationId(payload.conversationId || '');
    if (convId) {
      const sessionsPath = path.join(dataDir, 'sessions.json');
      const existing = readJsonSafeSync(sessionsPath) || {};
      const prevMap = (existing.sessions && typeof existing.sessions === 'object' && !Array.isArray(existing.sessions))
        ? existing.sessions
        : {};
      const prevEntry = (prevMap[convId] && typeof prevMap[convId] === 'object') ? prevMap[convId] : {};

      const workspacePaths = Array.isArray(payload.workspacePaths)
        ? payload.workspacePaths.filter(p => typeof p === 'string' && p.trim())
        : (Array.isArray(prevEntry.workspacePaths) ? prevEntry.workspacePaths : []);

      const nowIso = new Date().toISOString();
      const updatedEntry = {
        ...prevEntry,
        conversationId: convId,
        workspacePaths,
        cwd: (typeof payload.cwd === 'string' && payload.cwd.trim()) ? payload.cwd.trim() : (prevEntry.cwd || ''),
        transcriptPath: (typeof payload.transcriptPath === 'string' && payload.transcriptPath.trim())
          ? payload.transcriptPath.trim()
          : (prevEntry.transcriptPath || ''),
        artifactDirectoryPath: (typeof payload.artifactDirectoryPath === 'string' && payload.artifactDirectoryPath.trim())
          ? payload.artifactDirectoryPath.trim()
          : (prevEntry.artifactDirectoryPath || ''),
        modelName: (typeof payload.modelName === 'string' && payload.modelName.trim())
          ? payload.modelName.trim()
          : (prevEntry.modelName || ''),
        agentState: deriveAgentState(eventName, payload),
        lastHookEvent: eventName,
        lastHookAt: nowIso,
        updatedAt: Date.now()
      };

      if (typeof payload.invocationNum === 'number') updatedEntry.invocationNum = payload.invocationNum;
      if (typeof payload.initialNumSteps === 'number') updatedEntry.initialNumSteps = payload.initialNumSteps;
      if (typeof payload.executionNum === 'number') updatedEntry.executionNum = payload.executionNum;
      if (typeof payload.terminationReason === 'string') updatedEntry.terminationReason = payload.terminationReason;
      if (typeof payload.fullyIdle === 'boolean') updatedEntry.fullyIdle = payload.fullyIdle;
      if (typeof payload.error === 'string' && payload.error) updatedEntry.error = payload.error;

      prevMap[convId] = updatedEntry;

      // 依 updatedAt 裁剪至最近 20 筆對話
      const sortedEntries = Object.entries(prevMap)
        .filter(([, v]) => v && typeof v === 'object')
        .sort((a, b) => Number(b[1].updatedAt || 0) - Number(a[1].updatedAt || 0))
        .slice(0, MAX_SESSIONS);

      const prunedSessions = {};
      for (const [k, v] of sortedEntries) {
        prunedSessions[k] = v;
      }

      writeAtomicWithRetry(sessionsPath, JSON.stringify({
        version: 1,
        latestConversationId: convId,
        lastHookEvent: eventName,
        lastHookAt: nowIso,
        sessions: prunedSessions
      }, null, 2));
    }

    const lsAddr = typeof process.env.ANTIGRAVITY_LS_ADDRESS === 'string' ? process.env.ANTIGRAVITY_LS_ADDRESS.trim() : '';
    const csrfToken = typeof process.env.ANTIGRAVITY_CSRF_TOKEN === 'string' ? process.env.ANTIGRAVITY_CSRF_TOKEN.trim() : '';
    if (lsAddr && csrfToken) {
      writeAtomicWithRetry(
        path.join(dataDir, 'ls_env.json'),
        JSON.stringify({
          ls_address: lsAddr,
          csrf_token: csrfToken,
          updatedAt: Date.now()
        }, null, 2),
        0o600
      );
    }
  } catch (_) {
    // fail-open: 絕對不阻塞代理迴圈
  }

  if (eventName === 'Stop') {
    process.stdout.write('{"decision":"allow"}\n');
  } else {
    process.stdout.write('{}\n');
  }
  process.exit(0);
}

main();
