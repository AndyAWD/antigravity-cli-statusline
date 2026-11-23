import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { hasBOM } from '../../skills/agy-cli-statusline/scripts/lib/core/fs-utils.mjs';
import { SUPPORTED_LOCALES } from '../../skills/agy-cli-statusline/scripts/lib/metrics/registry.mjs';
import { isDashboardSnapshot, moveBlockInRows, moveRowInRows, rowsEqual } from '../../src/app/drag-rows.js';
import { APP_UI_STRINGS } from '../../src/app/i18n.js';
import { computeSrcAppSha256 } from '../build-app.mjs';
import { StatuslineMcpHandler } from '../mcp/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('src/app/i18n.js covers all SUPPORTED_LOCALES with identical key sets', () => {
  const baseKeys = Object.keys(APP_UI_STRINGS.us).sort();
  const requiredNewKeys = [
    'barSuffix',
    'editingBadge',
    'editGuide',
    'undo',
    'styleTextShort',
    'dropRowHere',
    'autoUpdateHooksHint',
    'autoUpdateHooksHintNoPrev',
    'savedBothAndHooksToast'
  ];
  const removedLegacyKeys = ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'doneEdit', 'deployHooksCheck'];
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(APP_UI_STRINGS[locale], `APP_UI_STRINGS missing locale: ${locale}`);
    assert.deepEqual(
      Object.keys(APP_UI_STRINGS[locale]).sort(),
      baseKeys,
      `APP_UI_STRINGS.${locale} key mismatch`
    );
    for (const k of requiredNewKeys) {
      assert.equal(typeof APP_UI_STRINGS[locale][k], 'string', `APP_UI_STRINGS.${locale}.${k} missing`);
      assert.ok(APP_UI_STRINGS[locale][k].length > 0, `APP_UI_STRINGS.${locale}.${k} empty`);
    }
    for (const k of removedLegacyKeys) {
      assert.equal(k in APP_UI_STRINGS[locale], false, `APP_UI_STRINGS.${locale}.${k} should be removed`);
    }
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
  assert.equal(/[←↑↓]/.test(html), false, 'statusline-app.html must not contain legacy arrow button glyphs');
  assert.equal(html.includes('.strip-flow-clip'), true, 'statusline-app.html must wrap strip items in .strip-flow-clip');
  assert.equal(html.includes('.strip-item::before'), true, 'statusline-app.html must render strip separators via .strip-item::before');
  assert.equal(html.includes('.strip-item-content'), true, 'statusline-app.html must keep each metric label and value inside .strip-item-content');
  assert.equal(html.includes('pinnedConversationId'), true, 'statusline-app.html must support auto-follow vs pinned conversation mode');
  assert.equal(html.includes('deployHooksCheck'), false, 'statusline-app.html must not contain legacy manual deployHooksCheck checkbox');

  const mainJs = fs.readFileSync(path.join(ROOT, 'src', 'app', 'main.js'), 'utf8');
  assert.equal(mainJs.includes('getDashboardArgs'), true, 'main.js must route dashboard calls through getDashboardArgs()');
  assert.equal(/callToolSafe\('statusline_dashboard',\s*\{[^}]*snap\.session\?\.conversationId/.test(mainJs), false, 'main.js must use getDashboardArgs() instead of hardcoding snap.session?.conversationId on refresh');
  assert.equal(/import\s*\{[^}]*\bformatResetTime\b[^}]*\}\s*from\s*['"][^'"]*time-format\.mjs['"]/.test(mainJs), true, 'main.js must import formatResetTime from shared time-format.mjs');
  assert.equal(/\bfunction\s+formatLiveCountdown\b/.test(mainJs), false, 'main.js must not reimplement duplicate formatLiveCountdown logic');
  assert.equal(/\bfunction\s+computeDraftOrderExpressions\b/.test(mainJs), false, 'main.js must use shared formatOrderExpressions instead of duplicate computeDraftOrderExpressions');
  assert.equal(/getPercentageTier/.test(mainJs), true, 'main.js must use shared getPercentageTier from ansi.mjs');

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

test('moveBlockInRows handles same-row left/right reordering, cross-row moves, between-rows, new-row, and drawer dedup', () => {
  const base = [
    ['a', 'b', 'c'],
    ['d']
  ];

  // 同列左往右拖至目標前/後
  assert.deepEqual(
    moveBlockInRows(base, { from: 'row', id: 'a', rowIdx: 0, colIdx: 0 }, { kind: 'chip', rowIdx: 0, colIdx: 2, position: 'before' }),
    [['b', 'a', 'c'], ['d']]
  );
  assert.deepEqual(
    moveBlockInRows(base, { from: 'row', id: 'a', rowIdx: 0, colIdx: 0 }, { kind: 'chip', rowIdx: 0, colIdx: 2, position: 'after' }),
    [['b', 'c', 'a'], ['d']]
  );

  // 同列右往左拖至目標前/後
  assert.deepEqual(
    moveBlockInRows(base, { from: 'row', id: 'c', rowIdx: 0, colIdx: 2 }, { kind: 'chip', rowIdx: 0, colIdx: 0, position: 'before' }),
    [['c', 'a', 'b'], ['d']]
  );
  assert.deepEqual(
    moveBlockInRows(base, { from: 'row', id: 'c', rowIdx: 0, colIdx: 2 }, { kind: 'chip', rowIdx: 0, colIdx: 0, position: 'after' }),
    [['a', 'c', 'b'], ['d']]
  );

  // 拖回原地自身前/後皆應維持不變 (no-op)
  assert.deepEqual(
    moveBlockInRows(base, { from: 'row', id: 'b', rowIdx: 0, colIdx: 1 }, { kind: 'chip', rowIdx: 0, colIdx: 1, position: 'before' }),
    base
  );
  assert.deepEqual(
    moveBlockInRows(base, { from: 'row', id: 'b', rowIdx: 0, colIdx: 1 }, { kind: 'chip', rowIdx: 0, colIdx: 1, position: 'after' }),
    base
  );

  // 跨列拖曳且原列變空時應自動收除空列
  assert.deepEqual(
    moveBlockInRows(base, { from: 'row', id: 'd', rowIdx: 1, colIdx: 0 }, { kind: 'chip', rowIdx: 0, colIdx: 1, position: 'before' }),
    [['a', 'd', 'b', 'c']]
  );

  // 拖曳至兩列之間建立新列（包含原列清空時索引偏移處理）
  assert.deepEqual(
    moveBlockInRows(base, { from: 'row', id: 'd', rowIdx: 1, colIdx: 0 }, { kind: 'between-rows', rowIdx: 0 }),
    [['d'], ['a', 'b', 'c']]
  );
  assert.deepEqual(
    moveBlockInRows(base, { from: 'row', id: 'b', rowIdx: 0, colIdx: 1 }, { kind: 'between-rows', rowIdx: 1 }),
    [['a', 'c'], ['b'], ['d']]
  );

  // 拖曳至最底建立新列 (new-row)
  assert.deepEqual(
    moveBlockInRows(base, { from: 'row', id: 'a', rowIdx: 0, colIdx: 0 }, { kind: 'new-row' }),
    [['b', 'c'], ['d'], ['a']]
  );

  // 從抽屜拖入全新指標與已存在指標（搬移不重複）
  assert.deepEqual(
    moveBlockInRows(base, { from: 'drawer', id: 'e' }, { kind: 'chip', rowIdx: 1, colIdx: 0, position: 'after' }),
    [['a', 'b', 'c'], ['d', 'e']]
  );
  assert.deepEqual(
    moveBlockInRows(base, { from: 'drawer', id: 'd' }, { kind: 'row', rowIdx: 0 }),
    [['a', 'b', 'c', 'd']]
  );
  // 確保不會改變原陣列參考
  assert.deepEqual(base, [['a', 'b', 'c'], ['d']]);
});

test('moveRowInRows reorders rows cleanly up, to bottom, and handles no-op', () => {
  const rows = [['r0'], ['r1'], ['r2']];

  // 下移至最底
  assert.deepEqual(moveRowInRows(rows, 0, 3), [['r1'], ['r2'], ['r0']]);
  // 下移一格（插至 r1 與 r2 之間）
  assert.deepEqual(moveRowInRows(rows, 0, 2), [['r1'], ['r0'], ['r2']]);
  // 上移至頂端
  assert.deepEqual(moveRowInRows(rows, 2, 0), [['r2'], ['r0'], ['r1']]);
  // 原地不移動 (no-op)
  assert.deepEqual(moveRowInRows(rows, 1, 1), rows);
  assert.deepEqual(moveRowInRows(rows, 1, 2), rows);
  assert.deepEqual(rows, [['r0'], ['r1'], ['r2']]);
});

test('rowsEqual compares 2D row arrays accurately', () => {
  assert.equal(rowsEqual([['a', 'b'], ['c']], [['a', 'b'], ['c']]), true);
  assert.equal(rowsEqual([[]], [[]]), true);
  assert.equal(rowsEqual([['a', 'b'], ['c']], [['b', 'a'], ['c']]), false);
  assert.equal(rowsEqual([['a', 'b'], ['c']], [['a', 'b'], ['c'], []]), false);
  assert.equal(rowsEqual([['a']], [['a', 'b']]), false);
  assert.equal(rowsEqual(null, [['a']]), false);
});

test('isDashboardSnapshot distinguishes full snapshots from save-panel / save-both responses', () => {
  const saveResponse = {
    ok: true,
    action: 'save-panel',
    layout: { lang: 'zh-tw', items: ['model-name'] },
    orderExpressions: {},
    cliSyncResult: null
  };
  assert.equal(isDashboardSnapshot(saveResponse), false);
  assert.equal(isDashboardSnapshot({ ok: true, action: 'save-both', layout: { lang: 'us', items: [] } }), false);
  assert.equal(isDashboardSnapshot(null), false);

  const fullSnapshot = {
    layout: { lang: 'zh-tw', items: ['model-name'] },
    registry: { supportedLocales: ['zh-tw', 'zh-cn', 'us', 'jp'], metrics: [] },
    renderedItems: { text: {}, emoji: {} }
  };
  assert.equal(isDashboardSnapshot(fullSnapshot), true);
});
