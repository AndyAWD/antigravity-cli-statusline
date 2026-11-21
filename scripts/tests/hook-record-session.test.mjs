import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { hasBOM } from '../../skills/agy-cli-statusline/scripts/lib/core/fs-utils.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK_SCRIPT = path.join(ROOT, 'scripts', 'hooks', 'record-session.mjs');

function runHook(eventName, stdinJson, envExtra = {}) {
  return spawnSync(process.execPath, [HOOK_SCRIPT, eventName], {
    input: typeof stdinJson === 'string' ? stdinJson : JSON.stringify(stdinJson),
    encoding: 'utf8',
    env: { ...process.env, ...envExtra }
  });
}

test('record-session.mjs writes sessions.json & ls_env.json without BOM and isolates from ~/.gemini/tmp', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hook-test-'));
  const pluginData = path.join(tmpHome, 'plugin_data');
  try {
    const r1 = runHook('SessionStart', {
      conversationId: 'conv-abc-123',
      workspacePaths: ['/tmp/my-proj'],
      modelName: 'Gemini 4 Neon',
      transcriptPath: '/tmp/t.jsonl',
      artifactDirectoryPath: '/tmp/art'
    }, {
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      PLUGIN_DATA: pluginData,
      ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:54321',
      ANTIGRAVITY_CSRF_TOKEN: 'csrf-xyz'
    });
    assert.equal(r1.status, 0);
    assert.deepEqual(JSON.parse(r1.stdout), {});

    const rStop = runHook('Stop', {
      conversationId: 'conv-abc-123',
      fullyIdle: true
    }, { HOME: tmpHome, USERPROFILE: tmpHome, PLUGIN_DATA: pluginData });
    assert.equal(rStop.status, 0);
    assert.deepEqual(JSON.parse(rStop.stdout), { decision: 'allow' });

    const sessionsPath = path.join(pluginData, 'sessions.json');
    const lsEnvPath = path.join(pluginData, 'ls_env.json');
    assert.equal(hasBOM(fs.readFileSync(sessionsPath)), false);
    assert.equal(hasBOM(fs.readFileSync(lsEnvPath)), false);

    const sessionsData = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    assert.equal(sessionsData.latestConversationId, 'conv-abc-123');
    assert.equal(sessionsData.sessions['conv-abc-123'].agentState, 'idle');

    // 確認絕不寫入 ~/.gemini/tmp/*
    assert.equal(fs.existsSync(path.join(tmpHome, '.gemini', 'tmp')), false);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('record-session.mjs prunes to 20 sessions and fails open on malformed stdin', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hook-prune-'));
  const pluginData = path.join(tmpHome, 'plugin_data');
  try {
    for (let i = 0; i < 23; i++) {
      const res = runHook('PreInvocation', { conversationId: `conv-${i}` }, {
        HOME: tmpHome,
        USERPROFILE: tmpHome,
        PLUGIN_DATA: pluginData
      });
      assert.equal(res.status, 0);
    }
    const data = JSON.parse(fs.readFileSync(path.join(pluginData, 'sessions.json'), 'utf8'));
    assert.equal(Object.keys(data.sessions).length, 20);

    const bad = runHook('Stop', '{broken json', { HOME: tmpHome, USERPROFILE: tmpHome, PLUGIN_DATA: pluginData });
    assert.equal(bad.status, 0);
    assert.deepEqual(JSON.parse(bad.stdout), { decision: 'allow' });
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('record-session.mjs exits within 200ms stdin timeout when pipe stays open and isolates fallback PLUGIN_DATA', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hook-openpipe-'));
  try {
    const start = Date.now();
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    delete env.PLUGIN_DATA;

    const { code, stdout } = await new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [HOOK_SCRIPT, 'SessionStart'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });
      let out = '';
      proc.stdout.on('data', (c) => { out += c; });
      const timer = setTimeout(() => {
        proc.kill();
        reject(new Error('record-session.mjs hung on open stdin pipe'));
      }, 1500);
      proc.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve({ code: exitCode, stdout: out });
      });
      // 刻意不呼叫 proc.stdin.end() 測試非同步 200ms 逾時保護
    });

    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(stdout), {});
    assert.equal(Date.now() - start < 1500, true);
    assert.equal(fs.existsSync(path.join(tmpHome, '.gemini', 'tmp')), false, 'Fallback without PLUGIN_DATA must never touch ~/.gemini/tmp');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
