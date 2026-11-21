import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { hasBOM } from '../../skills/agy-cli-statusline/scripts/lib/core/fs-utils.mjs';
import { SUPPORTED_LOCALES } from '../../skills/agy-cli-statusline/scripts/lib/metrics/registry.mjs';
import { APP_UI_STRINGS } from '../../src/app/i18n.js';
import { computeSrcAppSha256 } from '../build-app.mjs';
import { StatuslineMcpHandler } from '../mcp/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('src/app/i18n.js covers all SUPPORTED_LOCALES with identical key sets', () => {
  const baseKeys = Object.keys(APP_UI_STRINGS.us).sort();
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(APP_UI_STRINGS[locale], `APP_UI_STRINGS missing locale: ${locale}`);
    assert.deepEqual(
      Object.keys(APP_UI_STRINGS[locale]).sort(),
      baseKeys,
      `APP_UI_STRINGS.${locale} key mismatch`
    );
  }
});

test('scripts/mcp/statusline-app.html is up-to-date, BOM-free, self-contained, and under 1 MiB', () => {
  const htmlPath = path.join(ROOT, 'scripts', 'mcp', 'statusline-app.html');
  assert.equal(fs.existsSync(htmlPath), true, 'statusline-app.html must exist (run npm run build:app)');
  const buf = fs.readFileSync(htmlPath);
  assert.equal(hasBOM(buf), false, 'statusline-app.html must not contain UTF-8 BOM');
  assert.equal(buf.length < 1024 * 1024, true, 'statusline-app.html must be under 1 MiB');

  const html = buf.toString('utf8');
  assert.equal(/<script[^>]+src=/i.test(html), false, 'statusline-app.html must not contain external script src');
  assert.equal(/<link[^>]+href=/i.test(html), false, 'statusline-app.html must not contain external link href');

  const m = html.match(/<!--\s*source-sha256:\s*([a-f0-9]{64})\s*-->/i);
  assert.ok(m, 'statusline-app.html must embed source-sha256 comment');
  const actualHash = computeSrcAppSha256(path.join(ROOT, 'src', 'app'));
  assert.equal(m[1], actualHash, 'statusline-app.html is stale; run npm run build:app');

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const verMatch = html.match(/<!--\s*app-version:\s*([^\s]+)\s*-->/i);
  assert.ok(verMatch, 'statusline-app.html must embed app-version comment');
  assert.equal(verMatch[1], pkg.version);
});

test('plugin.json, mcp_config.json, hooks.json, serverInfo.version, and assets/logo.svg satisfy structural invariants', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const pluginJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugin.json'), 'utf8'));
  assert.equal(pluginJson.name, 'antigravity-cli-statusline');
  assert.equal(pluginJson.displayName, 'Statusline');
  assert.equal(pluginJson.version, pkg.version);
  assert.equal(fs.existsSync(path.join(ROOT, pluginJson.logo)), true);

  const handler = new StatuslineMcpHandler();
  const initRes = await handler.handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } });
  assert.equal(initRes.result.serverInfo.version, pkg.version);

  const hooksJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks.json'), 'utf8'));
  const group = hooksJson['statusline-session-tracker'];
  assert.ok(group.SessionStart && group.PreInvocation && group.PostInvocation && group.Stop);

  const mcpJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'mcp_config.json'), 'utf8'));
  assert.equal(mcpJson.mcpServers.statusline.command, 'node');
});
