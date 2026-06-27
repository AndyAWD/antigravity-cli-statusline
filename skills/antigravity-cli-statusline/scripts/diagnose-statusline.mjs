#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import os from 'os';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

function ok(msg) { return `${GREEN}✅ ${msg}${RESET}`; }
function warn(msg) { return `${YELLOW}⚠️  ${msg}${RESET}`; }
function bad(msg) { return `${RED}❌ ${msg}${RESET}`; }
function alert(msg) { return `${RED}${BOLD}🚨 ${msg}${RESET}`; }
function head(msg) { return `${BOLD}${CYAN}${msg}${RESET}`; }
function dim(msg) { return `${DIM}${msg}${RESET}`; }

function safeRead(path) {
  try { return { ok: true, raw: readFileSync(path, 'utf8'), bytes: readFileSync(path) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

function hasBOM(buf) {
  return buf && buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
}

function parseJSON(raw) {
  try { return { ok: true, value: JSON.parse(raw.replace(/^\uFEFF/, '')) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

function describeStatusLine(sl) {
  if (sl === undefined) return dim('  （此層無 statusLine 欄位）');
  if (sl === null) return alert('  statusLine 為 null（異常）');
  const lines = [];
  lines.push(`  enabled: ${JSON.stringify(sl.enabled)}`);
  lines.push(`  type:    ${JSON.stringify(sl.type)}`);
  const cmd = sl.command;
  if (cmd === undefined) lines.push(alert('  command: 不存在 ← 致命'));
  else if (cmd === '') lines.push(alert('  command: "" 空字串 ← 致命，CLI 會停止呼叫 hook'));
  else if (typeof cmd !== 'string') lines.push(alert(`  command: ${JSON.stringify(cmd)} ← 型別異常`));
  else lines.push(`  command: ${JSON.stringify(cmd)}`);
  return lines.join('\n');
}

function describeFooterItems(ui) {
  const items = ui?.footer?.items;
  if (!items) return dim('  （此層無 ui.footer.items）');
  if (!Array.isArray(items)) return alert(`  ui.footer.items 非陣列：${JSON.stringify(items)}`);
  if (items.length === 0) return warn('  ui.footer.items 為空陣列');
  return `  ui.footer.items (${items.length} 項): ${items.join(', ')}`;
}

function inspectSettings(label, path) {
  console.log(`\n${head(label)}`);
  console.log(`路徑: ${path}`);
  if (!existsSync(path)) {
    console.log(bad('狀態: 不存在'));
    return { exists: false };
  }
  const r = safeRead(path);
  if (!r.ok) {
    console.log(bad(`狀態: 讀取失敗 — ${r.error}`));
    return { exists: true, readable: false };
  }
  console.log(ok(`狀態: 存在（${r.bytes.length} bytes）`));
  if (process.platform === 'win32') {
    console.log(hasBOM(r.bytes) ? alert('BOM:  含 UTF-8 BOM ← agy CLI 會崩潰') : ok('BOM:  無 BOM'));
  }
  const p = parseJSON(r.raw);
  if (!p.ok) {
    console.log(alert(`JSON: 解析失敗 — ${p.error}`));
    return { exists: true, readable: true, parsed: false };
  }
  console.log(ok('JSON: 解析成功'));
  console.log('statusLine:');
  console.log(describeStatusLine(p.value.statusLine));
  console.log('ui.language: ' + JSON.stringify(p.value?.ui?.language));
  console.log(describeFooterItems(p.value?.ui));
  return { exists: true, readable: true, parsed: true, data: p.value };
}

function inspectTrustedHooks(path, expectedHomeAbs, expectedWorkspaceAbs) {
  console.log(`\n${head('--- trusted_hooks.json ---')}`);
  console.log(`路徑: ${path}`);
  if (!existsSync(path)) {
    console.log(bad('狀態: 不存在 ← CLI 可能將 Hook 視為未信任而拒絕執行'));
    return;
  }
  const r = safeRead(path);
  if (!r.ok) { console.log(bad(`讀取失敗: ${r.error}`)); return; }
  console.log(ok(`存在（${r.bytes.length} bytes）`));
  if (process.platform === 'win32' && hasBOM(r.bytes)) console.log(alert('含 UTF-8 BOM'));
  const p = parseJSON(r.raw);
  if (!p.ok) { console.log(alert(`JSON 解析失敗: ${p.error}`)); return; }
  const keys = Object.keys(p.value);
  console.log(`鍵總數: ${keys.length}`);
  const checkKey = (k, label) => {
    const arr = p.value[k];
    if (!arr) { console.log(`  ${bad(label + ' 鍵缺失')} (${k})`); return; }
    if (!Array.isArray(arr)) { console.log(`  ${alert(label + ' 值非陣列')}`); return; }
    const hits = arr.filter(s => typeof s === 'string' && s.includes('statusLine:node'));
    if (hits.length === 0) console.log(`  ${warn(label + ' 鍵存在但無 statusLine:node 條目')} (${k})`);
    else console.log(`  ${ok(label + `：${hits.length} 條 statusLine:node 信任字串`)} (${k})`);
    hits.forEach(h => console.log(`     ${dim('•')} ${h}`));
  };
  checkKey(expectedWorkspaceAbs, '當前工作區');
  checkKey(expectedHomeAbs, '家目錄');
  checkKey('*', '萬用字元（Wildcard） "*"');
}

function inspectHookFiles(hooksDir) {
  console.log(`\n${head('--- Hook 檔案 ---')}`);
  ['statusline-quota.mjs', 'fetch-local-quota.mjs'].forEach(f => {
    const p = join(hooksDir, f);
    if (existsSync(p)) {
      try {
        const sz = statSync(p).size;
        console.log(ok(`${f}（${sz} bytes）— ${p}`));
      } catch (e) { console.log(warn(`${f}: ${e.message}`)); }
    } else {
      console.log(bad(`${f} 不存在 — ${p}`));
    }
  });
}

function diagnose(layers) {
  console.log(`\n${head('--- 診斷結論 ---')}`);
  const findings = [];

  const cli = layers.cli?.data;
  const global = layers.global?.data;
  const project = layers.project?.data;

  const effectiveCmd = cli?.statusLine?.command ?? project?.statusLine?.command ?? global?.statusLine?.command;
  const effectiveEnabled = cli?.statusLine?.enabled ?? project?.statusLine?.enabled ?? global?.statusLine?.enabled;
  const effectiveItems = cli?.ui?.footer?.items ?? project?.ui?.footer?.items ?? global?.ui?.footer?.items;

  if (cli && 'statusLine' in cli && (cli.statusLine?.command === '' || cli.statusLine?.command === undefined)) {
    findings.push(alert('CLI 專屬層的 statusLine.command 為空或缺失 → agy CLI 不會呼叫 hook → 狀態列空白'));
    findings.push('   → 高度符合 skills/antigravity-cli-statusline/references/pitfalls.md 陷阱 #2 / #9 的徵兆（可能是 /model 指令覆寫所致）');
    findings.push('   → 建議：重新執行本技能以同步覆寫三層 statusLine');
  } else if (!effectiveCmd) {
    findings.push(alert('三層合併後 statusLine.command 仍為空 → CLI 不會呼叫 hook'));
  } else if (effectiveEnabled === false) {
    findings.push(warn('statusLine.enabled 為 false → 可用 /statusline 重新啟用'));
  } else if (!effectiveItems || effectiveItems.length === 0) {
    findings.push(warn('ui.footer.items 為空 → 腳本會走退讓模式，只顯示 "? for shortcuts | 模型名"'));
  } else {
    findings.push(ok('三層合併後狀態列設定看似完整。'));
    findings.push(`   有效 command: ${effectiveCmd}`);
    findings.push(`   有效 items（${effectiveItems.length}）: ${effectiveItems.join(', ')}`);
    findings.push(dim('   若仍看不到狀態列，請確認：(a) Node.js 是否可在 agy 環境中執行 (b) hook 檔案是否存在'));
  }
  findings.forEach(f => console.log(f));
}

function main() {
  const home = os.homedir();
  const cwd = process.cwd();

  console.log(head('=== Antigravity CLI Statusline 診斷報告 ==='));
  console.log(`產生時間: ${new Date().toISOString()}`);
  console.log(`平台:     ${process.platform} (${os.release()})`);
  console.log(`Node.js:  ${process.version}`);
  console.log(`家目錄:   ${home}`);
  console.log(`工作區:   ${cwd}`);

  const cliPath = join(home, '.gemini', 'antigravity-cli', 'settings.json');
  const globalPath = join(home, '.gemini', 'settings.json');
  const projectPath = join(cwd, '.gemini', 'settings.json');

  const layers = {
    cli: inspectSettings('--- 第 1/3 層：CLI 專屬（最高優先級）---', cliPath),
    global: inspectSettings('--- 第 2/3 層：全域 ---', globalPath),
    project: inspectSettings('--- 第 3/3 層：專案（條件性）---', projectPath),
  };

  inspectTrustedHooks(join(home, '.gemini', 'trusted_hooks.json'), home, cwd);
  inspectHookFiles(join(home, '.gemini', 'antigravity-cli', 'hooks'));
  diagnose(layers);

  console.log(`\n${dim('將以上完整輸出複製貼給 AI 代理，協助判斷根因。')}\n`);
}

main();
