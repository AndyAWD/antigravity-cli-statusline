import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  countArtifactsInDirAsync,
  discoverRecentBrainSessionsAsync,
  readTranscriptSummaryAsync
} from '../mcp/transcript-reader.mjs';

test('readTranscriptSummaryAsync parses tail, ignores torn final line, and infers tool_use/idle', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-tr-test-'));
  try {
    const trPath = path.join(dir, 'transcript.jsonl');
    const lines = [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', status: 'DONE' }),
      JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        model: 'gemini-4-hydrogen-high',
        created_at: '2026-11-23T13:12:00Z',
        tool_calls: [{ name: 'run_command', args: { toolSummary: '"Run tests"' } }]
      }),
      '{"broken_torn_line": '
    ];
    fs.writeFileSync(trPath, lines.join('\n'), 'utf8');

    const summary = await readTranscriptSummaryAsync(trPath);
    assert.equal(summary.exists, true);
    assert.equal(summary.stepCount >= 2, true);
    assert.equal(summary.derivedAgentState, 'tool_use');
    assert.equal(summary.lastToolName, 'run_command');
    assert.equal(summary.lastToolSummary, 'Run tests');
    assert.equal(summary.lastModel, 'gemini-4-hydrogen-high');
    assert.equal(summary.lastModelHasThinking, false);

    fs.appendFileSync(trPath, '\n' + JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [] }) + '\n', 'utf8');
    const idleSummary = await readTranscriptSummaryAsync(trPath);
    assert.equal(idleSummary.derivedAgentState, 'idle');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('countArtifactsInDirAsync and discoverRecentBrainSessionsAsync work across products', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-brain-test-'));
  try {
    const convId = '12345678-abcd-ef01-2345-6789abcdef01';
    const convDir = path.join(tmpHome, '.gemini', 'antigravity', 'brain', convId);
    fs.mkdirSync(path.join(convDir, '.system_generated', 'logs'), { recursive: true });
    fs.writeFileSync(path.join(convDir, 'plan.md.metadata.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(convDir, 'walkthrough.md.metadata.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl'), '{"type":"USER_INPUT"}\n', 'utf8');

    assert.equal(await countArtifactsInDirAsync(convDir), 2);
    const sessions = await discoverRecentBrainSessionsAsync(tmpHome, 5);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].conversationId, convId);
    assert.equal(sessions[0].product, 'antigravity');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
