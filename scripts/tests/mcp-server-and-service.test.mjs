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
import { StatuslineService } from '../mcp/statusline-service.mjs';

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
    assert.equal(fs.existsSync(path.join(tmpHome, '.gemini', 'tmp')), false, 'StatuslineService fallback must never touch ~/.gemini/tmp');

    const parsedRes = await svc.saveConfig({
      action: 'parse-order-expression',
      layout: { items: ['model-name'] },
      orderExpression: 'e:quota-argon, 15, n, model-name'
    });
    assert.deepEqual(parsedRes.parsed.items, ['quota-argon', 'quota-argon-countdown', 'n', 'model-name']);
    assert.equal(parsedRes.parsed.itemStyles['quota-argon'], 'emoji');

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
