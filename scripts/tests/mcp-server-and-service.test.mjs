import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { hasBOM } from '../../skills/agy-cli-statusline/scripts/lib/core/fs-utils.mjs';
import { parseMetricRenderPayload } from '../mcp/ansi-segments.mjs';
import { collectLsTelemetryAsync, resetLsTelemetryMemoryCache } from '../mcp/ls-telemetry.mjs';
import { StatuslineMcpHandler } from '../mcp/server.mjs';
import { isOutdatedCliHookSync, StatuslineService } from '../mcp/statusline-service.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER_SCRIPT = path.join(ROOT, 'scripts', 'mcp', 'server.mjs');

test('MCP server hides statusline_save_config from non-UI clients (CLI) and enforces uiSessionToken for UI clients', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mcp-test-'));
  const pluginData = path.join(tmpHome, 'plugin_data');
  try {
    const cliSettingsPath = path.join(tmpHome, '.gemini', 'antigravity-cli', 'settings.json');
    fs.mkdirSync(path.dirname(cliSettingsPath), { recursive: true });
    fs.writeFileSync(cliSettingsPath, JSON.stringify({
      statusLine: { enabled: true, type: 'command', command: '/usr/local/bin/node /custom/statusline-quota.mjs' },
      ui: { language: 'us', footer: { items: ['model-name', 'quota'], labelStyle: 'emoji' } }
    }), 'utf8');

    const mockService = new StatuslineService({
      homeDir: tmpHome,
      pluginRootDir: ROOT,
      pluginDataDir: pluginData,
      fetchReleaseFn: async () => ({ ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' }),
      collectLsTelemetryFn: async () => ({
        cache: {
          shortTerm: { gemini: { remaining_percentage: 82, reset_time: '2026-12-01T00:00:00Z' } },
          weekly: { gemini: { remaining_percentage: 90, reset_time: '2026-12-07T00:00:00Z' } },
          email: 'user@example.com',
          planTier: 'Pro'
        },
        runtimeTelemetry: {
          modelDisplayName: 'Gemini 4 Neon',
          maxContextTokens: 512000,
          estimatedTokensUsed: 120000,
          tokenBreakdown: [{ name: 'System Prompt', type: 'TOKEN_TYPE_SYSTEM_PROMPT', numTokens: 5000 }]
        },
        telemetryStatus: { lsConnected: true, lsEnvSource: 'env', source: 'live', warning: '' }
      })
    });

    // 1. 模擬 CLI（未宣告 io.modelcontextprotocol/ui）
    const cliHandler = new StatuslineMcpHandler({ service: mockService });
    await cliHandler.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } });
    const cliTools = await cliHandler.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.deepEqual(cliTools.result.tools.map(t => t.name), ['statusline_dashboard']);

    const cliSaveAttempt = await cliHandler.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'statusline_save_config', arguments: { uiSessionToken: 'fake', action: 'save-both' } }
    });
    assert.equal(cliSaveAttempt.result.isError, true);

    // 2. 模擬 Antigravity 2.0 App（宣告 io.modelcontextprotocol/ui）
    const appHandler = new StatuslineMcpHandler({ service: mockService });
    await appHandler.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } } }
    });
    const appTools = await appHandler.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.deepEqual(appTools.result.tools.map(t => t.name), ['statusline_dashboard', 'statusline_save_config']);

    const dashRes = await appHandler.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'statusline_dashboard', arguments: {} }
    });
    const token = dashRes.result.structuredContent.uiSessionToken;
    assert.ok(token && token.length >= 32);
    assert.equal(dashRes.result.content[0].text.includes(token), false, 'uiSessionToken must never leak into plain-text content');
    assert.equal(dashRes.result.structuredContent.session.hasWorkspace, false, 'No workspace must not leak PLUGIN_ROOT');
    assert.equal(
      dashRes.result.structuredContent.renderedItems.text['project-path'].valueText.includes('antigravity-cli-statusline'),
      false,
      'project-path must not leak PLUGIN_ROOT basename when no workspace'
    );
    assert.equal(
      dashRes.result.structuredContent.renderedItems.text['project-full-path'].valueText.includes(ROOT),
      false,
      'project-full-path must not leak PLUGIN_ROOT path when no workspace'
    );

    // 錯誤 token 必須被拒絕
    const badSave = await appHandler.handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'statusline_save_config', arguments: { uiSessionToken: 'wrong', action: 'save-panel' } }
    });
    assert.equal(badSave.result.isError, true);

    // 正確 token 同步寫回 CLI 設定（保留原 statusLine.command、無 BOM）
    const goodSave = await appHandler.handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'statusline_save_config',
        arguments: {
          uiSessionToken: token,
          action: 'save-both',
          deployHooks: true,
          layout: {
            lang: 'zh-tw',
            items: ['model-name', 'n', 'quota'],
            itemStyles: { quota: 'emoji' },
            labelStyle: 'text',
            timeFormat: '24h',
            barLength: 12
          }
        }
      }
    });
    assert.equal(goodSave.result.structuredContent.ok, true);
    const updatedCli = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));
    assert.equal(hasBOM(fs.readFileSync(cliSettingsPath)), false);
    assert.equal(updatedCli.statusLine.command, '/usr/local/bin/node /custom/statusline-quota.mjs');
    assert.deepEqual(updatedCli.ui.footer.items, ['model-name', 'n', 'quota']);
    assert.equal(fs.existsSync(path.join(tmpHome, '.gemini', 'antigravity-cli', 'hooks', '.hook-version.json')), true);
    assert.equal(fs.existsSync(path.join(tmpHome, '.gemini', 'tmp')), false, '2.0 service must never write ~/.gemini/tmp');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('MCP stdio server handles Content-Length framing and resources/read', async () => {
  const proc = spawn(process.execPath, [SERVER_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    const sendFramed = (obj) => {
      const json = JSON.stringify(obj);
      proc.stdin.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
    };
    const responses = [];
    let buf = Buffer.alloc(0);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP stdio timeout')), 4000);
      proc.stdout.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (true) {
          const headerEnd = buf.indexOf('\r\n\r\n');
          if (headerEnd === -1) break;
          const header = buf.subarray(0, headerEnd).toString('utf8');
          const m = /Content-Length:\s*(\d+)/i.exec(header);
          const len = m ? Number(m[1]) : 0;
          if (buf.length < headerEnd + 4 + len) break;
          const body = buf.subarray(headerEnd + 4, headerEnd + 4 + len).toString('utf8');
          buf = buf.subarray(headerEnd + 4 + len);
          responses.push(JSON.parse(body));
          if (responses.length >= 2) {
            clearTimeout(timer);
            resolve();
            break;
          }
        }
      });
      sendFramed({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } });
      sendFramed({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'ui://statusline/app.html' } });
    });

    assert.equal(responses[0].id, 1);
    assert.equal(responses[1].result.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.ok(responses[1].result.contents[0].text.includes('<!doctype html>'));
  } finally {
    proc.kill();
  }
});

test('parseMetricRenderPayload extracts valueSegments without repeating label prefix', () => {
  const payload = parseMetricRenderPayload('\x1b[38;2;255;255;255m模型:\x1b[0m \x1b[38;2;71;150;227m\x1b[1mGemini\x1b[0m');
  assert.equal(payload.label, '模型');
  assert.equal(payload.valueText, 'Gemini');
  assert.equal(payload.valueSegments.map(s => s.text).join(''), 'Gemini');
  assert.equal(payload.valueSegments[0].color, '#4796e3');
});

test('parse-order-expression resolves non-active metrics & save-both preserves CLI R27 contract', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-r27-test-'));
  try {
    const cliSettingsPath = path.join(tmpHome, '.gemini', 'antigravity-cli', 'settings.json');
    fs.mkdirSync(path.dirname(cliSettingsPath), { recursive: true });
    // CLI R27：labelStyle: 'emoji' + itemStyles: {} 在 CLI 等效於全文字
    fs.writeFileSync(cliSettingsPath, JSON.stringify({
      ui: { language: 'zh-tw', footer: { items: ['model-name', 'quota'], labelStyle: 'emoji', itemStyles: {} } }
    }), 'utf8');

    const svc = new StatuslineService({
      homeDir: tmpHome,
      pluginRootDir: ROOT,
      fetchReleaseFn: async () => ({ ok: false }),
      collectLsTelemetryFn: async () => ({
        cache: null,
        runtimeTelemetry: null,
        telemetryStatus: { lsConnected: false, lsEnvSource: 'none', source: 'public_only', warning: '' }
      })
    });

    const snapRes = await svc.getDashboardSnapshot();
    assert.equal(snapRes.snapshot.cliLayout.labelStyle, 'text', 'CLI R27 itemStyles: {} must inherit as text');
    assert.equal(snapRes.snapshot.quotas.argon, undefined, 'Removed Argon quota must not exist in snapshot.quotas');
    assert.equal(snapRes.plainText.includes('Quota (5h / 7d):'), true, 'Plain text summary must show Quota (5h / 7d)');
    assert.equal(snapRes.plainText.includes('Argon'), false, 'Plain text summary must not mention Argon');
    assert.equal(fs.existsSync(path.join(tmpHome, '.gemini', 'tmp')), false, 'StatuslineService fallback must never touch ~/.gemini/tmp');

    const parsedRes = await svc.saveConfig({
      action: 'parse-order-expression',
      layout: { items: ['model-name'] },
      orderExpression: 'e:quota-weekly, 12, n, model-name'
    });
    assert.deepEqual(parsedRes.parsed.items, ['quota-weekly', 'quota-weekly-countdown', 'n', 'model-name']);
    assert.equal(parsedRes.parsed.itemStyles['quota-weekly'], 'emoji');

    // 舊設定若仍殘留 quota-argon*，getDashboardSnapshot() 須自動過濾而不影響其他有效指標
    fs.writeFileSync(cliSettingsPath, JSON.stringify({
      ui: { language: 'zh-tw', footer: { items: ['model-name', 'quota-argon', 'quota-argon-bar', 'quota'] } }
    }), 'utf8');
    const legacySnapRes = await svc.getDashboardSnapshot({ forceRefresh: true });
    assert.deepEqual(legacySnapRes.snapshot.cliLayout.items, ['model-name', 'quota']);

    // 全 Emoji 同步至 CLI 時應刪除 itemStyles 鍵
    await svc.saveConfig({
      action: 'save-both',
      layout: { lang: 'zh-tw', items: ['model-name', 'quota'], itemStyles: {}, labelStyle: 'emoji' }
    });
    const cliAllEmoji = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));
    assert.equal(cliAllEmoji.ui.footer.labelStyle, 'emoji');
    assert.equal('itemStyles' in cliAllEmoji.ui.footer, false);

    // 混搭（全域 emoji + 單項 text）同步至 CLI 時應具象化為 labelStyle: 'text' + itemStyles
    await svc.saveConfig({
      action: 'save-both',
      layout: { lang: 'zh-tw', items: ['model-name', 'quota'], itemStyles: { 'model-name': 'text' }, labelStyle: 'emoji' }
    });
    const cliMixed = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));
    assert.equal(cliMixed.ui.footer.labelStyle, 'text');
    assert.deepEqual(cliMixed.ui.footer.itemStyles, { quota: 'emoji' });
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('collectLsTelemetryAsync paginates >256 generatorMetadata items and reads IPv6 ls_env', async () => {
  resetLsTelemetryMemoryCache();
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ls-page-'));
  const pluginData = path.join(tmpHome, 'plugin_data');
  try {
    fs.mkdirSync(pluginData, { recursive: true });
    fs.writeFileSync(path.join(pluginData, 'ls_env.json'), JSON.stringify({
      ls_address: '[::1]:54321',
      csrf_token: 'tok'
    }), 'utf8');

    const offsets = [];
    const res = await collectLsTelemetryAsync({
      homeDir: tmpHome,
      pluginDataDir: pluginData,
      conversationId: 'conv-long-300',
      env: {},
      requestTrajectoryGeneratorMetadataFn: async (_port, _csrf, _id, offset) => {
        offsets.push(offset);
        if (offset === 0) {
          return {
            generatorMetadata: Array.from({ length: 256 }, () => ({
              chatModel: { chatStartMetadata: { contextWindowMetadata: { estimatedTokensUsed: 1000 } } }
            }))
          };
        }
        return {
          generatorMetadata: [{
            chatModel: {
              chatStartMetadata: {
                contextWindowMetadata: {
                  maxContextTokens: 512000,
                  estimatedTokensUsed: 99000,
                  tokenBreakdown: { groups: [{ name: 'History', type: 'TOKEN_TYPE_HISTORY', numTokens: 88000 }] }
                }
              },
              usage: { inputTokens: 99000, outputTokens: 1200, thinkingOutputTokens: 300, cacheReadTokens: 45000 }
            }
          }]
        };
      }
    });

    assert.deepEqual(offsets, [0, 256]);
    assert.equal(res.runtimeTelemetry.estimatedTokensUsed, 99000);
    assert.equal(res.runtimeTelemetry.tokenBreakdown[0].name, 'History');
    assert.equal(res.runtimeTelemetry.usage.cacheReadTokens, 45000);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('collectLsTelemetryAsync re-reads last step when streaming fills tokens later and preserves context_cache', async () => {
  resetLsTelemetryMemoryCache();
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ls-stream-'));
  const pluginData = path.join(tmpHome, 'plugin_data');
  try {
    fs.mkdirSync(pluginData, { recursive: true });
    fs.writeFileSync(path.join(pluginData, 'ls_env.json'), JSON.stringify({
      ls_address: '127.0.0.1:54322',
      csrf_token: 'tok'
    }), 'utf8');

    let phase = 1;
    const seenOffsets = [];
    const mockReq = async (_port, _csrf, _id, offset) => {
      seenOffsets.push(offset);
      if (phase === 1) {
        // 第 1 次輪詢：串流剛開始，只有 maxContextTokens，尚未回填 estimatedTokensUsed 與 usage
        return {
          generatorMetadata: [
            { chatModel: { modelDisplayName: 'Gemini 4 Hydrogen (High)', chatStartMetadata: { contextWindowMetadata: { maxContextTokens: 512000 } } } }
          ].slice(offset)
        };
      }
      if (phase === 2) {
        // 第 2 次輪詢：第 0 筆補齊了 estimatedTokensUsed、usage 與 tokenBreakdown
        return {
          generatorMetadata: [
            {
              chatModel: {
                modelDisplayName: 'Gemini 4 Hydrogen (High)',
                chatStartMetadata: {
                  contextWindowMetadata: {
                    maxContextTokens: 512000,
                    estimatedTokensUsed: 120000,
                    tokenBreakdown: { groups: [{ name: 'System Prompt', type: 'TOKEN_TYPE_SYSTEM_PROMPT', numTokens: 4000 }] }
                  }
                },
                usage: { inputTokens: 5000, cacheReadTokens: 115000, outputTokens: 800 }
              }
            }
          ].slice(offset)
        };
      }
      // 第 3 次輪詢：新增第 1 筆正在串流（尚無 usage/estimatedTokensUsed），不得把第 0 筆的 120000 洗回 0
      return {
        generatorMetadata: [
          {
            chatModel: {
              modelDisplayName: 'Gemini 4 Hydrogen (High)',
              chatStartMetadata: {
                contextWindowMetadata: {
                  maxContextTokens: 512000,
                  estimatedTokensUsed: 120000,
                  tokenBreakdown: { groups: [{ name: 'System Prompt', type: 'TOKEN_TYPE_SYSTEM_PROMPT', numTokens: 4000 }] }
                }
              },
              usage: { inputTokens: 5000, cacheReadTokens: 115000, outputTokens: 800 }
            }
          },
          {
            chatModel: {
              modelDisplayName: 'Gemini 4 Hydrogen (High)',
              chatStartMetadata: { contextWindowMetadata: { maxContextTokens: 512000 } }
            }
          }
        ].slice(offset)
      };
    };

    const r1 = await collectLsTelemetryAsync({ homeDir: tmpHome, pluginDataDir: pluginData, conversationId: 'conv-stream', env: {}, requestTrajectoryGeneratorMetadataFn: mockReq });
    assert.equal(r1.runtimeTelemetry.maxContextTokens, 512000);
    assert.equal(r1.runtimeTelemetry.estimatedTokensUsed, 0);

    phase = 2;
    const r2 = await collectLsTelemetryAsync({ homeDir: tmpHome, pluginDataDir: pluginData, conversationId: 'conv-stream', env: {}, requestTrajectoryGeneratorMetadataFn: mockReq });
    assert.equal(seenOffsets[1], 0, 'Must re-read last index (offset 0) instead of skipping to 1');
    assert.equal(r2.runtimeTelemetry.estimatedTokensUsed, 120000);
    assert.equal(r2.runtimeTelemetry.tokenBreakdown.length, 1);

    phase = 3;
    const r3 = await collectLsTelemetryAsync({ homeDir: tmpHome, pluginDataDir: pluginData, conversationId: 'conv-stream', env: {}, requestTrajectoryGeneratorMetadataFn: mockReq });
    assert.equal(r3.runtimeTelemetry.estimatedTokensUsed, 120000, 'Incomplete streaming step must not overwrite cached estimatedTokensUsed with 0');
    assert.equal(r3.runtimeTelemetry.tokenBreakdown.length, 1);

    // 清空記憶體快取後即使斷線，仍可自 pluginDataDir/context_cache.json 還原
    resetLsTelemetryMemoryCache();
    fs.rmSync(path.join(pluginData, 'ls_env.json'));
    const r4 = await collectLsTelemetryAsync({ homeDir: tmpHome, pluginDataDir: pluginData, conversationId: 'conv-stream', env: {} });
    assert.equal(r4.runtimeTelemetry.estimatedTokensUsed, 120000);
    assert.equal(fs.existsSync(path.join(tmpHome, '.gemini', 'tmp')), false);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('StatuslineService computes cacheReadTokens + dual context/token percentages + tokenCeiling override', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ctx-pct-'));
  const pluginData = path.join(tmpHome, 'plugin_data');
  try {
    const cliSettingsPath = path.join(tmpHome, '.gemini', 'antigravity-cli', 'settings.json');
    fs.mkdirSync(path.dirname(cliSettingsPath), { recursive: true });
    fs.writeFileSync(cliSettingsPath, JSON.stringify({
      ui: { language: 'zh-tw', footer: { items: ['context-used', 'token-count'] } }
    }), 'utf8');

    const svc = new StatuslineService({
      homeDir: tmpHome,
      pluginRootDir: ROOT,
      pluginDataDir: pluginData,
      fetchReleaseFn: async () => ({ ok: false }),
      collectLsTelemetryFn: async () => ({
        cache: {
          modelLimits: {
            gemini4hydrogenhigh: { limit: 512000, maxTokens: 1048576, displayName: 'Gemini 4 Hydrogen (High)' }
          }
        },
        runtimeTelemetry: {
          modelDisplayName: 'Gemini 4 Hydrogen (High)',
          maxContextTokens: 512000,
          estimatedTokensUsed: 0,
          usage: { inputTokens: 3000, cacheReadTokens: 197000, outputTokens: 500 },
          tokenBreakdown: []
        },
        telemetryStatus: { lsConnected: true, lsEnvSource: 'env', source: 'live', warning: '' }
      })
    });

    const { snapshot } = await svc.getDashboardSnapshot();
    assert.equal(snapshot.context.totalInput, 200000);
    assert.equal(snapshot.context.contextSize, 1048576);
    assert.equal(snapshot.context.effectiveCeiling, 512000);
    assert.equal(snapshot.context.usedPct, 19.1, 'usedPct must be relative to physical contextSize (1.0M)');
    assert.equal(snapshot.context.tokenPct, 39.1, 'tokenPct must be relative to effectiveCeiling (512k)');
    assert.equal(snapshot.renderedItems.text['context-used'].valueText, '19.1%');
    assert.equal(snapshot.renderedItems.text['token-count'].valueText, '200.0k / 512.0k');

    // 驗證 CLI tokenCeiling 覆寫 (第 1b 層)
    fs.writeFileSync(cliSettingsPath, JSON.stringify({
      ui: { language: 'zh-tw', footer: { items: ['context-used', 'token-count'], tokenCeiling: '400k' } }
    }), 'utf8');
    const overridden = await svc.getDashboardSnapshot();
    assert.equal(overridden.snapshot.context.effectiveCeiling, 400000);
    assert.equal(overridden.snapshot.context.tokenPct, 50);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('StatuslineService skips ghost 404 hook sessions in auto-follow mode and falls back read-only for CLI sessions', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ghost-sess-'));
  const pluginData = path.join(tmpHome, 'plugin_data');
  try {
    fs.mkdirSync(pluginData, { recursive: true });
    const validId = '11111111-1111-1111-1111-111111111111';
    const ghostId = '22222222-2222-2222-2222-222222222222';
    const cliId = '33333333-3333-3333-3333-333333333333';

    const validBrain = path.join(tmpHome, '.gemini', 'antigravity', 'brain', validId, '.system_generated', 'logs');
    fs.mkdirSync(validBrain, { recursive: true });
    fs.writeFileSync(path.join(validBrain, 'transcript.jsonl'), '{"type":"USER_INPUT"}\n', 'utf8');

    const cliBrain = path.join(tmpHome, '.gemini', 'antigravity-cli', 'brain', cliId, '.system_generated', 'logs');
    fs.mkdirSync(cliBrain, { recursive: true });
    fs.writeFileSync(path.join(cliBrain, 'transcript.jsonl'), '{"type":"USER_INPUT"}\n', 'utf8');

    const tmpDir = path.join(tmpHome, '.gemini', 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, `ctx_${cliId}.json`), JSON.stringify({
      total_input_tokens: 77777,
      context_window_size: 1048576,
      runtime_max_context_tokens: 512000,
      runtime_model_display_name: 'Gemini 4 Hydrogen (High)'
    }), 'utf8');

    fs.writeFileSync(path.join(pluginData, 'sessions.json'), JSON.stringify({
      version: 1,
      latestConversationId: ghostId,
      sessions: {
        [ghostId]: {
          conversationId: ghostId,
          transcriptPath: path.join(tmpHome, '.gemini', 'antigravity', 'brain', ghostId, 'missing.jsonl'),
          updatedAt: Date.now() + 5000
        }
      }
    }), 'utf8');

    const svc = new StatuslineService({
      homeDir: tmpHome,
      pluginRootDir: ROOT,
      pluginDataDir: pluginData,
      fetchReleaseFn: async () => ({ ok: false }),
      collectLsTelemetryFn: async ({ conversationId }) => {
        if (conversationId === ghostId) {
          return {
            cache: null,
            runtimeTelemetry: null,
            conversationNotFound: true,
            telemetryStatus: { lsConnected: true, lsEnvSource: 'env', source: 'live', warning: '' }
          };
        }
        return {
          cache: null,
          runtimeTelemetry: {
            modelDisplayName: 'Gemini 4 Hydrogen (High)',
            maxContextTokens: 512000,
            estimatedTokensUsed: 88000,
            tokenBreakdown: []
          },
          conversationNotFound: false,
          telemetryStatus: { lsConnected: true, lsEnvSource: 'env', source: 'live', warning: '' }
        };
      }
    });

    const autoRes = await svc.getDashboardSnapshot();
    assert.equal(autoRes.snapshot.session.conversationId, validId, 'Auto-follow must skip ghost 404 session');
    assert.equal(autoRes.snapshot.session.isAutoFollow, true);
    assert.equal(autoRes.snapshot.context.totalInput, 88000);
    assert.equal(autoRes.snapshot.sessions.some(s => s.conversationId === ghostId), false, 'Ghost session should be excluded from dropdown');

    // 真實 collectLsTelemetryAsync 在 CLI 對話遇到 HTTP 404 時唯讀退讓 ctx_<id>.json
    const cliLsRes = await collectLsTelemetryAsync({
      homeDir: tmpHome,
      pluginDataDir: pluginData,
      conversationId: cliId,
      env: { ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:54323', ANTIGRAVITY_CSRF_TOKEN: 'tok' },
      requestTrajectoryGeneratorMetadataFn: async () => { throw new Error('HTTP 404'); }
    });
    assert.equal(cliLsRes.conversationNotFound, true);
    assert.equal(cliLsRes.runtimeTelemetry.estimatedTokensUsed, 77777);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('StatuslineService shares resolveContextMetricsPure and guards Layer-2 model mismatch on switch', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ctx-switch-'));
  const pluginData = path.join(tmpHome, 'plugin_data');
  try {
    fs.mkdirSync(pluginData, { recursive: true });
    fs.writeFileSync(path.join(pluginData, 'sessions.json'), JSON.stringify({
      version: 1,
      latestConversationId: 'conv-switch',
      sessions: {
        'conv-switch': {
          conversationId: 'conv-switch',
          modelName: 'Claude Opus 4.6',
          updatedAt: Date.now()
        }
      }
    }), 'utf8');

    const svc = new StatuslineService({
      homeDir: tmpHome,
      pluginRootDir: ROOT,
      pluginDataDir: pluginData,
      fetchReleaseFn: async () => ({ ok: false }),
      collectLsTelemetryFn: async () => ({
        cache: {
          modelLimits: {
            claudeopus46: { limit: 200000, maxTokens: 200000, slug: 'claude-opus-4-6' }
          }
        },
        runtimeTelemetry: {
          // 模擬切換模型時，LS 尚未更新 runtimeTelemetry 模型，仍殘留舊 Gemini 模型的 512k
          modelDisplayName: '',
          model: 'gemini-4-neon',
          maxContextTokens: 512000,
          estimatedTokensUsed: 100000
        },
        telemetryStatus: { lsConnected: true, lsEnvSource: 'env', source: 'live', warning: '' }
      })
    });

    const res = await svc.getDashboardSnapshot({ conversationId: 'conv-switch' });
    assert.equal(res.snapshot.context.effectiveCeiling, 200000, 'Must skip mismatched Layer-2 runtime ceiling and resolve Layer-3 catalog limit');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('MCP resources/read enforces strict CSP and save-both enforces workspacePath allowlist', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-sec-p5-'));
  const pluginData = path.join(tmpHome, 'plugin_data');
  const allowedWs = path.join(tmpHome, 'allowed-ws');
  const unknownWs = path.join(tmpHome, 'unknown-ws');
  try {
    fs.mkdirSync(pluginData, { recursive: true });
    fs.mkdirSync(path.join(allowedWs, '.gemini'), { recursive: true });
    fs.mkdirSync(path.join(unknownWs, '.gemini'), { recursive: true });
    fs.writeFileSync(path.join(allowedWs, '.gemini', 'settings.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(unknownWs, '.gemini', 'settings.json'), '{"keep":"untouched"}', 'utf8');
    fs.writeFileSync(path.join(pluginData, 'sessions.json'), JSON.stringify({
      version: 1,
      sessions: {
        s1: { conversationId: 's1', workspacePaths: [allowedWs], updatedAt: Date.now() }
      }
    }), 'utf8');

    const svc = new StatuslineService({
      homeDir: tmpHome,
      pluginRootDir: ROOT,
      pluginDataDir: pluginData,
      fetchReleaseFn: async () => ({ ok: false }),
      collectLsTelemetryFn: async () => ({
        cache: null,
        runtimeTelemetry: null,
        telemetryStatus: { lsConnected: false, lsEnvSource: 'none', source: 'public_only', warning: '' }
      })
    });
    const handler = new StatuslineMcpHandler({ service: svc });
    const resRead = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'ui://statusline/app.html' }
    });
    assert.deepEqual(resRead.result.contents[0]._meta.ui.csp, { connectDomains: [], resourceDomains: [] });

    await svc.saveConfig({
      action: 'save-both',
      workspacePath: unknownWs,
      layout: { lang: 'us', items: ['model-name', 'quota'] }
    });
    assert.equal(
      fs.readFileSync(path.join(unknownWs, '.gemini', 'settings.json'), 'utf8'),
      '{"keep":"untouched"}',
      'Unknown workspacePath outside sessions.json allowlist must not be modified'
    );

    await svc.saveConfig({
      action: 'save-both',
      workspacePath: allowedWs,
      layout: { lang: 'us', items: ['model-name', 'quota'] }
    });
    const updatedAllowed = JSON.parse(fs.readFileSync(path.join(allowedWs, '.gemini', 'settings.json'), 'utf8'));
    assert.deepEqual(updatedAllowed.ui.footer.items, ['model-name', 'quota']);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('StatuslineService resolves and caches both cli-version and app-version in Antigravity 2.0 snapshots', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-svc-versions-'));
  try {
    const pluginData = path.join(tmpHome, 'plugin_data');
    fs.mkdirSync(pluginData, { recursive: true });

    let cliCalls = 0;
    let appCalls = 0;
    let cliVer = 'v1.5.15';
    let appVer = 'v2.34.0';

    const svc = new StatuslineService({
      homeDir: tmpHome,
      pluginRootDir: ROOT,
      pluginDataDir: pluginData,
      fetchReleaseFn: async () => ({ ok: false }),
      collectLsTelemetryFn: async () => ({
        cache: null,
        runtimeTelemetry: null,
        telemetryStatus: { lsConnected: false, lsEnvSource: 'none', source: 'public_only', warning: '' }
      }),
      resolveCliVersionFn: async () => {
        cliCalls++;
        return { version: cliVer.replace(/^v/, ''), tag: cliVer, installed: Boolean(cliVer), source: 'mock' };
      },
      resolveAppVersionFn: async () => {
        appCalls++;
        return { version: appVer.replace(/^v/, ''), tag: appVer, installed: Boolean(appVer), source: 'mock' };
      }
    });

    // 1. Both installed -> both rendered in text & emoji modes in Antigravity 2.0 panel
    const res1 = await svc.getDashboardSnapshot({ hostLocale: 'zh-tw' });
    assert.equal(cliCalls, 1);
    assert.equal(appCalls, 1);
    assert.equal(res1.snapshot.renderedItems.text['cli-version'].plainText, 'Agy CLI 版本: v1.5.15');
    assert.equal(res1.snapshot.renderedItems.text['app-version'].plainText, 'Agy 2.0 版本: v2.34.0');
    assert.equal(res1.snapshot.renderedItems.emoji['cli-version'].plainText, '🚀 v1.5.15');
    assert.equal(res1.snapshot.renderedItems.emoji['app-version'].plainText, '💻 v2.34.0');

    // 2. Non-forced refresh reuses 60s version cache
    const res2 = await svc.getDashboardSnapshot({ hostLocale: 'zh-tw' });
    assert.equal(cliCalls, 1, 'Cached cli-version should not re-probe within TTL');
    assert.equal(appCalls, 1, 'Cached app-version should not re-probe within TTL');
    assert.equal(res2.snapshot.renderedItems.text['cli-version'].plainText, 'Agy CLI 版本: v1.5.15');
    assert.equal(res2.snapshot.renderedItems.text['app-version'].plainText, 'Agy 2.0 版本: v2.34.0');

    // 3. forceRefresh bypasses cache & uninstalled version falls back to Unknown/未知
    cliVer = '';
    appVer = 'v2.35.0';
    const res3 = await svc.getDashboardSnapshot({ hostLocale: 'us', forceRefresh: true });
    assert.equal(cliCalls, 2);
    assert.equal(appCalls, 2);
    assert.equal(res3.snapshot.renderedItems.text['cli-version'].plainText, 'Agy CLI Version: Unknown');
    assert.equal(res3.snapshot.renderedItems.text['app-version'].plainText, 'Agy 2.0 Version: v2.35.0');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('StatuslineService renders active-model for Orchestrator sessions and red off for single-model sessions', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-svc-orch-'));
  try {
    const pluginData = path.join(tmpHome, 'plugin_data');
    const cliDir = path.join(tmpHome, '.gemini', 'antigravity-cli');
    fs.mkdirSync(pluginData, { recursive: true });
    fs.mkdirSync(cliDir, { recursive: true });

    const convId = 'conv-svc-orch';
    fs.writeFileSync(path.join(cliDir, 'settings.json'), JSON.stringify({
      orchestrator: {
        planner: 'gemini-4-carbon-high',
        executor: 'gemini-4-hydrogen-high'
      },
      ui: {
        language: 'zh-tw',
        footer: { items: ['model-name', 'active-model'] }
      }
    }), 'utf8');

    fs.writeFileSync(path.join(pluginData, 'sessions.json'), JSON.stringify({
      version: 1,
      latestConversationId: convId,
      sessions: {
        [convId]: {
          conversationId: convId,
          modelName: 'Orchestrator (Carbon)',
          agentState: 'working',
          updatedAt: Date.now()
        }
      }
    }), 'utf8');

    let runtimeModelName = 'Gemini 4 Hydrogen (High)';
    let runtimeModelSlug = 'gemini-4-hydrogen-high';
    const svc = new StatuslineService({
      homeDir: tmpHome,
      pluginRootDir: ROOT,
      pluginDataDir: pluginData,
      fetchReleaseFn: async () => ({ ok: false }),
      resolveCliVersionFn: async () => ({ version: '1.5.15', tag: 'v1.5.15', installed: true, source: 'mock' }),
      resolveAppVersionFn: async () => ({ version: '2.34.0', tag: 'v2.34.0', installed: true, source: 'mock' }),
      collectLsTelemetryFn: async () => ({
        cache: null,
        runtimeTelemetry: runtimeModelName
          ? { maxContextTokens: 512000, estimatedTokensUsed: 1000, modelDisplayName: runtimeModelName, model: runtimeModelSlug, tokenBreakdown: [] }
          : null,
        telemetryStatus: { lsConnected: true, lsEnvSource: 'env', source: 'live', warning: '' }
      })
    });

    const resOrch = await svc.getDashboardSnapshot({ conversationId: convId, hostLocale: 'zh-tw' });
    assert.equal(resOrch.snapshot.renderedItems.text['model-name'].plainText, '模型: Orchestrator (Carbon)');
    assert.equal(resOrch.snapshot.renderedItems.text['active-model'].plainText, '執行者: Gemini 4 Hydrogen (High)');
    assert.equal(resOrch.snapshot.renderedItems.text['active-model'].label, '執行者');
    assert.equal(resOrch.snapshot.renderedItems.emoji['active-model'].plainText, '🪄 執行者 → Gemini 4 Hydrogen (High)');

    // 切換為一般模型時，active-model 一律以紅色顯示關閉
    fs.writeFileSync(path.join(pluginData, 'sessions.json'), JSON.stringify({
      version: 1,
      latestConversationId: convId,
      sessions: {
        [convId]: {
          conversationId: convId,
          modelName: 'Gemini 4 Neon (High)',
          agentState: 'idle',
          updatedAt: Date.now() + 1000
        }
      }
    }), 'utf8');
    runtimeModelName = 'Gemini 4 Neon (High)';
    runtimeModelSlug = 'gemini-4-neon-high';

    const resSingle = await svc.getDashboardSnapshot({ conversationId: convId, hostLocale: 'zh-tw', forceRefresh: true });
    assert.equal(resSingle.snapshot.renderedItems.text['model-name'].plainText, '模型: Gemini 4 Neon (High)');
    assert.equal(resSingle.snapshot.renderedItems.text['active-model'].plainText, '協調器: 關閉');
    assert.equal(resSingle.snapshot.renderedItems.emoji['active-model'].plainText, '🪄 關閉');
    assert.equal(resSingle.snapshot.renderedItems.text['active-model'].valueSegments[0].color, '#ff7daf');
    assert.equal(resSingle.snapshot.renderedItems.emoji['active-model'].segments.at(-1).color, '#ff7daf');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('StatuslineService detects 2.0 Orchestrator via antigravity_state.pbtxt and merges CLI sessions.json', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-svc-pbtxt-'));
  try {
    const pluginData = path.join(tmpHome, 'plugin_data');
    const cliDir = path.join(tmpHome, '.gemini', 'antigravity-cli');
    const cliPluginData = path.join(cliDir, 'plugin_data', 'antigravity-cli-statusline');
    const appStateDir = path.join(tmpHome, '.gemini', 'antigravity');
    fs.mkdirSync(pluginData, { recursive: true });
    fs.mkdirSync(cliPluginData, { recursive: true });
    fs.mkdirSync(appStateDir, { recursive: true });

    const appConvId = 'app-conv-1';
    const cliConvId = 'cli-conv-1';
    const cliWorkspace = path.join(tmpHome, 'proj-cli');
    fs.mkdirSync(cliWorkspace, { recursive: true });

    // CLI settings 設為單一模型（不應汙染 2.0 對話的 Orchestrator 判定）
    fs.writeFileSync(path.join(cliDir, 'settings.json'), JSON.stringify({
      model: 'Gemini 4 Hydrogen (Low)',
      orchestrator: { planner: 'Gemini 4 Neon (XHigh)' },
      ui: {
        language: 'zh-tw',
        footer: { items: ['model-name', 'active-model'] }
      }
    }), 'utf8');

    fs.writeFileSync(path.join(pluginData, 'sessions.json'), JSON.stringify({
      version: 1,
      latestConversationId: appConvId,
      sessions: {
        [appConvId]: {
          conversationId: appConvId,
          modelName: 'gemini-4-neon-high',
          agentState: 'working',
          updatedAt: 2000
        }
      }
    }), 'utf8');

    // CLI 自己的 sessions.json 記錄更晚時間戳的 CLI 對話
    fs.writeFileSync(path.join(cliPluginData, 'sessions.json'), JSON.stringify({
      version: 1,
      latestConversationId: cliConvId,
      sessions: {
        [cliConvId]: {
          conversationId: cliConvId,
          workspacePaths: [cliWorkspace],
          cwd: cliWorkspace,
          transcriptPath: path.join(cliDir, 'brain', cliConvId, '.system_generated', 'logs', 'transcript_full.jsonl'),
          modelName: 'gemini-4-hydrogen-low',
          agentState: 'idle',
          updatedAt: 5000
        }
      }
    }), 'utf8');

    const pbtxtPath = path.join(appStateDir, 'antigravity_state.pbtxt');
    fs.writeFileSync(pbtxtPath, 'last_selected_agent_model: MODEL_PLACEHOLDER_M537\n', 'utf8');

    const cache = {
      modelLimits: {
        modelplaceholderm537: { slug: 'gemini-pro-orchestrator-neon', model: 'MODEL_PLACEHOLDER_M537', displayName: 'Orchestrator (Neon)' },
        modelplaceholderm532: { slug: 'gemini-4-neon-high', model: 'MODEL_PLACEHOLDER_M532', displayName: 'Gemini 4 Neon (High)' },
        modelplaceholderm525: { slug: 'gemini-4-hydrogen-high', model: 'MODEL_PLACEHOLDER_M525', displayName: 'Gemini 4 Hydrogen (High)' }
      }
    };

    const svc = new StatuslineService({
      homeDir: tmpHome,
      pluginRootDir: ROOT,
      pluginDataDir: pluginData,
      fetchReleaseFn: async () => ({ ok: false }),
      resolveCliVersionFn: async () => ({ version: '1.5.15', tag: 'v1.5.15', installed: true, source: 'mock' }),
      resolveAppVersionFn: async () => ({ version: '2.34.0', tag: 'v2.34.0', installed: true, source: 'mock' }),
      collectLsTelemetryFn: async ({ conversationId }) => ({
        cache,
        runtimeTelemetry: conversationId === appConvId
          ? { maxContextTokens: 512000, estimatedTokensUsed: 1200, modelDisplayName: 'Gemini 4 Neon (High)', model: 'MODEL_PLACEHOLDER_M532', tokenBreakdown: [] }
          : null,
        telemetryStatus: { lsConnected: true, lsEnvSource: 'env', source: 'live', warning: '' }
      })
    });

    // 1. Auto-follow 維持選取 2.0 對話，model-name 顯示外層 Orchestrator (Neon)，active-model 顯示底層規劃模型
    const resAuto = await svc.getDashboardSnapshot({ hostLocale: 'zh-tw' });
    assert.equal(resAuto.snapshot.session.conversationId, appConvId);
    assert.equal(resAuto.snapshot.renderedItems.text['model-name'].plainText, '模型: Orchestrator (Neon)');
    assert.equal(resAuto.snapshot.renderedItems.text['active-model'].plainText, '規劃者: Gemini 4 Neon (High)');
    assert.equal(resAuto.snapshot.renderedItems.text['active-model'].label, '規劃者');
    assert.equal(resAuto.snapshot.renderedItems.emoji['active-model'].plainText, '🪄 規劃者 → Gemini 4 Neon (High)');

    // 2. 切回單一模型代號後，model-name 恢復顯示實際模型，active-model 顯示紅色關閉
    fs.writeFileSync(pbtxtPath, 'last_selected_agent_model: MODEL_PLACEHOLDER_M525\n', 'utf8');
    const resOff = await svc.getDashboardSnapshot({ hostLocale: 'zh-tw', forceRefresh: true });
    assert.equal(resOff.snapshot.renderedItems.text['model-name'].plainText, '模型: Gemini 4 Neon (High)');
    assert.equal(resOff.snapshot.renderedItems.text['active-model'].plainText, '協調器: 關閉');

    // 3. 明確切換檢視 CLI 對話時，可從合併後的 CLI sessions.json 拿到工作區與模型
    const resCli = await svc.getDashboardSnapshot({ conversationId: cliConvId, hostLocale: 'zh-tw' });
    assert.equal(resCli.snapshot.session.product, 'antigravity-cli');
    assert.equal(resCli.snapshot.session.projectPath, cliWorkspace);
    assert.equal(resCli.snapshot.renderedItems.text['model-name'].plainText, '模型: gemini-4-hydrogen-low');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('isOutdatedCliHookSync accurately distinguishes outdated vs synced, newer, and missing hooks', () => {
  assert.equal(isOutdatedCliHookSync({ status: 'version_mismatch', hookVersion: '1.11.4', pluginVersion: '1.13.0' }), true);
  assert.equal(isOutdatedCliHookSync({ status: 'version_mismatch', hookVersion: '99.0.0', pluginVersion: '1.13.0' }), false);
  assert.equal(isOutdatedCliHookSync({ status: 'content_mismatch', hookVersion: '1.13.0', pluginVersion: '1.13.0' }), true);
  assert.equal(isOutdatedCliHookSync({ status: 'legacy_mismatch', hookVersion: '', pluginVersion: '1.13.0' }), true);
  assert.equal(isOutdatedCliHookSync({ status: 'legacy_no_meta', hookVersion: '', pluginVersion: '1.13.0' }), true);
  assert.equal(isOutdatedCliHookSync({ status: 'in_sync', hookVersion: '1.13.0', pluginVersion: '1.13.0' }), false);
  assert.equal(isOutdatedCliHookSync({ status: 'hook_missing', hookVersion: '', pluginVersion: '1.13.0' }), false);
  assert.equal(isOutdatedCliHookSync({ status: 'plugin_not_found', hookVersion: '1.11.4', pluginVersion: '' }), false);
  assert.equal(isOutdatedCliHookSync(null), false);
});

test('save-both automatically updates outdated CLI hooks without mutating statusLine, skips in_sync/newer/missing, and save-panel never touches CLI hooks', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-auto-hook-'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  try {
    const cliDir = path.join(tmpHome, '.gemini', 'antigravity-cli');
    const hooksDir = path.join(cliDir, 'hooks');
    const cliSettingsPath = path.join(cliDir, 'settings.json');
    const hookMetaPath = path.join(hooksDir, '.hook-version.json');
    fs.mkdirSync(hooksDir, { recursive: true });

    // 1. 模擬既有舊版 CLI 掛鉤 v1.11.4，且使用者將 statusLine.enabled 設為 false
    fs.writeFileSync(path.join(hooksDir, 'statusline-quota.mjs'), '// legacy v1.11.4\n', 'utf8');
    fs.writeFileSync(path.join(hooksDir, 'fetch-local-quota.mjs'), '// legacy v1.11.4\n', 'utf8');
    fs.writeFileSync(hookMetaPath, JSON.stringify({
      pluginVersion: '1.11.4',
      syncedAt: '2026-01-01T00:00:00.000Z',
      files: {}
    }), 'utf8');
    fs.writeFileSync(cliSettingsPath, JSON.stringify({
      statusLine: {
        enabled: false,
        type: 'command',
        command: '/custom/node /custom/statusline-quota.mjs'
      },
      ui: { language: 'zh-tw', footer: { items: ['model-name'] } }
    }), 'utf8');

    const svc = new StatuslineService({
      homeDir: tmpHome,
      pluginRootDir: ROOT,
      pluginDataDir: path.join(tmpHome, 'plugin_data'),
      fetchReleaseFn: async () => ({ ok: false }),
      resolveCliVersionFn: async () => ({ version: '1.5.15', tag: 'v1.5.15', installed: true, source: 'mock' }),
      resolveAppVersionFn: async () => ({ version: '2.34.0', tag: 'v2.34.0', installed: true, source: 'mock' }),
      collectLsTelemetryFn: async () => ({
        cache: null,
        runtimeTelemetry: null,
        telemetryStatus: { lsConnected: false, lsEnvSource: 'none', source: 'public_only', warning: '' }
      })
    });

    const snapBefore = await svc.getDashboardSnapshot();
    assert.equal(snapBefore.snapshot.hookSync.status, 'version_mismatch');
    assert.equal(snapBefore.snapshot.hookSync.hookVersion, '1.11.4');
    assert.equal(snapBefore.snapshot.hookSync.needsAutoUpdate, true);

    // 2. save-panel 絕不可動到 CLI 掛鉤或 settings.json
    await svc.saveConfig({
      action: 'save-panel',
      layout: { lang: 'zh-tw', items: ['model-name', 'app-version'] }
    });
    assert.equal(JSON.parse(fs.readFileSync(hookMetaPath, 'utf8')).pluginVersion, '1.11.4');
    assert.deepEqual(JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8')).ui.footer.items, ['model-name']);

    // 3. save-both（不傳 deployHooks）偵測到過舊掛鉤，自動更新掛鉤腳本但保留既有 statusLine
    const syncRes1 = await svc.saveConfig({
      action: 'save-both',
      layout: { lang: 'zh-tw', items: ['model-name', 'app-version'] }
    });
    assert.equal(syncRes1.cliSyncResult.deployHooks, true);
    assert.equal(syncRes1.cliSyncResult.hooksAutoUpdated, true);
    assert.equal(syncRes1.cliSyncResult.hookSyncBefore.status, 'version_mismatch');
    const updatedMeta1 = JSON.parse(fs.readFileSync(hookMetaPath, 'utf8'));
    assert.equal(updatedMeta1.pluginVersion, pkg.version);
    assert.equal(fs.existsSync(path.join(hooksDir, 'lib', 'collectors', 'versions.mjs')), true);
    const updatedSettings1 = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));
    assert.deepEqual(updatedSettings1.ui.footer.items, ['model-name', 'app-version']);
    assert.equal(updatedSettings1.statusLine.enabled, false, 'Auto-updating outdated hooks must not override statusLine.enabled');
    assert.equal(updatedSettings1.statusLine.command, '/custom/node /custom/statusline-quota.mjs');

    // 4. 已同步（in_sync）時再執行 save-both，不可重複寫入掛鉤
    const syncedAtAfterUpdate = updatedMeta1.syncedAt;
    const snapSynced = await svc.getDashboardSnapshot();
    assert.equal(snapSynced.snapshot.hookSync.status, 'in_sync');
    assert.equal(snapSynced.snapshot.hookSync.needsAutoUpdate, false);

    const syncRes2 = await svc.saveConfig({
      action: 'save-both',
      layout: { lang: 'zh-tw', items: ['model-name', 'cli-version', 'app-version'] }
    });
    assert.equal(syncRes2.cliSyncResult.deployHooks, false);
    assert.equal(syncRes2.cliSyncResult.hooksAutoUpdated, false);
    assert.equal(JSON.parse(fs.readFileSync(hookMetaPath, 'utf8')).syncedAt, syncedAtAfterUpdate);

    // 5. 同版本但檔案內容不同步（content_mismatch）應自動修復
    fs.writeFileSync(path.join(hooksDir, 'statusline-quota.mjs'), '// drifted content\n', 'utf8');
    const syncRes3 = await svc.saveConfig({
      action: 'save-both',
      layout: { lang: 'zh-tw', items: ['model-name', 'app-version'] }
    });
    assert.equal(syncRes3.cliSyncResult.hooksAutoUpdated, true);
    assert.equal(syncRes3.cliSyncResult.hookSyncBefore.status, 'content_mismatch');
    assert.equal(fs.readFileSync(path.join(hooksDir, 'statusline-quota.mjs'), 'utf8').includes('drifted content'), false);

    // 6. 掛鉤版本高於外掛版本（99.0.0）時不可自動降級覆寫
    fs.writeFileSync(hookMetaPath, JSON.stringify({
      pluginVersion: '99.0.0',
      syncedAt: '2099-01-01T00:00:00.000Z',
      files: {}
    }), 'utf8');
    const syncRes4 = await svc.saveConfig({
      action: 'save-both',
      layout: { lang: 'zh-tw', items: ['model-name', 'app-version'] }
    });
    assert.equal(syncRes4.cliSyncResult.hooksAutoUpdated, false);
    assert.equal(syncRes4.cliSyncResult.deployHooks, false);
    assert.equal(JSON.parse(fs.readFileSync(hookMetaPath, 'utf8')).pluginVersion, '99.0.0');

    // 7. 本機尚未部署過掛鉤（hook_missing）時，save-both 不可擅自建立掛鉤或覆寫第三方 statusLine.command
    fs.rmSync(hooksDir, { recursive: true, force: true });
    fs.writeFileSync(cliSettingsPath, JSON.stringify({
      statusLine: { enabled: true, type: 'command', command: '/usr/local/bin/other-statusline' },
      ui: { language: 'zh-tw', footer: { items: ['model-name'] } }
    }), 'utf8');
    const syncRes5 = await svc.saveConfig({
      action: 'save-both',
      layout: { lang: 'zh-tw', items: ['model-name', 'app-version'] }
    });
    assert.equal(syncRes5.cliSyncResult.hooksAutoUpdated, false);
    assert.equal(syncRes5.cliSyncResult.deployHooks, false);
    assert.equal(fs.existsSync(hooksDir), false);
    assert.equal(JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8')).statusLine.command, '/usr/local/bin/other-statusline');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('StatuslineService shares update_cache.json with CLI without clobbering checkedSessions and picks newer quota cache read-only', async () => {
  resetLsTelemetryMemoryCache();
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-shared-cache-'));
  const pluginData = path.join(tmpHome, '.gemini', 'antigravity', 'plugin_data', 'antigravity-cli-statusline');
  try {
    fs.mkdirSync(pluginData, { recursive: true });
    const updateCachePath = path.join(pluginData, 'update_cache.json');
    fs.writeFileSync(updateCachePath, JSON.stringify({
      latestVersion: '2.0.0',
      latestTag: 'v2.0.0',
      checkedAt: 1000,
      lastSessionKey: '9001:cli',
      lastSessionStatus: 'ok',
      lastAttemptAt: 1000,
      checkedSessions: {
        '9001:cli': { status: 'ok', attemptAt: 1000 }
      }
    }, null, 2), 'utf8');

    const svc = new StatuslineService({
      homeDir: tmpHome,
      pluginRootDir: ROOT,
      pluginDataDir: pluginData,
      fetchReleaseFn: async () => ({ ok: true, latestVersion: '2.1.0', latestTag: 'v2.1.0' }),
      resolveCliVersionFn: async () => ({ version: '1.5.16', tag: 'v1.5.16', installed: true, source: 'mock' }),
      resolveAppVersionFn: async () => ({ version: '2.34.0', tag: 'v2.34.0', installed: true, source: 'mock' }),
      collectLsTelemetryFn: async () => ({
        cache: null,
        runtimeTelemetry: null,
        telemetryStatus: { lsConnected: false, lsEnvSource: 'none', source: 'public_only', warning: '' }
      })
    });

    const snap = await svc.getDashboardSnapshot({ checkUpdate: true });
    assert.equal(snap.snapshot.updateInfo.latestTag, 'v2.1.0');
    const savedUpdate = JSON.parse(fs.readFileSync(updateCachePath, 'utf8'));
    assert.equal(savedUpdate.latestVersion, '2.1.0');
    assert.deepEqual(savedUpdate.checkedSessions['9001:cli'], { status: 'ok', attemptAt: 1000 });
    assert.equal(fs.existsSync(path.join(tmpHome, '.gemini', 'tmp')), false, 'StatuslineService update check must never create ~/.gemini/tmp');

    // 離線退讓時比對 pluginData/quota_cache.json 與 ~/.gemini/tmp/real_quota_cache.json 擇新回傳（唯讀）
    const tmpDir = path.join(tmpHome, '.gemini', 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    const pluginQuotaPath = path.join(pluginData, 'quota_cache.json');
    const cliQuotaPath = path.join(tmpDir, 'real_quota_cache.json');
    fs.writeFileSync(pluginQuotaPath, JSON.stringify({
      lsUpdatedAt: 1000,
      shortTerm: { gemini: { remaining_percentage: 50 } }
    }), 'utf8');
    fs.writeFileSync(cliQuotaPath, JSON.stringify({
      lsUpdatedAt: 2000,
      shortTerm: { gemini: { remaining_percentage: 90 } }
    }), 'utf8');

    const pickedCli = await collectLsTelemetryAsync({ homeDir: tmpHome, pluginDataDir: pluginData, env: {} });
    assert.equal(pickedCli.telemetryStatus.source, 'cli_cache');
    assert.equal(pickedCli.cache.shortTerm.gemini.remaining_percentage, 90);

    fs.writeFileSync(pluginQuotaPath, JSON.stringify({
      lsUpdatedAt: 3000,
      shortTerm: { gemini: { remaining_percentage: 75 } }
    }), 'utf8');
    const pickedPlugin = await collectLsTelemetryAsync({ homeDir: tmpHome, pluginDataDir: pluginData, env: {} });
    assert.equal(pickedPlugin.telemetryStatus.source, 'plugin_cache');
    assert.equal(pickedPlugin.cache.shortTerm.gemini.remaining_percentage, 75);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
