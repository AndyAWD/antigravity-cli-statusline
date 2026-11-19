#!/usr/bin/env node
import { readFileSync, existsSync, statSync, realpathSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  console.log('ui.footer.labelStyle: ' + JSON.stringify(p.value?.ui?.footer?.labelStyle));
  console.log('ui.footer.itemStyles: ' + JSON.stringify(p.value?.ui?.footer?.itemStyles));
  console.log(describeFooterItems(p.value?.ui));
  return { exists: true, readable: true, parsed: true, data: p.value };
}

function inspectHookFiles(hooksDir) {
  console.log(`\n${head('--- 狀態列腳本檔案 ---')}`);
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

function sha256File(filePath) {
  try {
    if (!existsSync(filePath)) return '';
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
  } catch (_) {
    return '';
  }
}

function compareSemverNumeric(a, b) {
  const parse = (s) => {
    const m = String(s || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function readManifestVersion(pluginDir, requireExplicitName = false) {
  if (!pluginDir) return { version: '', source: '' };
  for (const name of ['plugin.json', 'package.json']) {
    const p = join(pluginDir, name);
    if (!existsSync(p)) continue;
    const r = safeRead(p);
    if (!r.ok) continue;
    const parsed = parseJSON(r.raw);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) continue;
    const pkgName = typeof parsed.value.name === 'string' ? parsed.value.name.trim() : '';
    if (name === 'package.json' || requireExplicitName) {
      if (pkgName !== 'antigravity-cli-statusline') continue;
    } else if (pkgName && pkgName !== 'antigravity-cli-statusline') {
      continue;
    }
    if (typeof parsed.value.version === 'string' && parsed.value.version.trim()) {
      return { version: parsed.value.version.trim().replace(/^v/i, ''), source: p };
    }
  }
  return { version: '', source: '' };
}

function discoverInstalledPlugin(home) {
  const pluginsRoot = join(home, '.gemini', 'config', 'plugins');
  const candidates = [
    { dir: join(pluginsRoot, 'antigravity-cli-statusline'), requireExplicitName: false, priority: 3 },
    { dir: join(home, '.agents', 'plugins', 'antigravity-cli-statusline'), requireExplicitName: false, priority: 2 }
  ];
  try {
    if (existsSync(pluginsRoot)) {
      const entries = readdirSync(pluginsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry || entry.name === 'antigravity-cli-statusline') continue;
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          candidates.push({
            dir: join(pluginsRoot, entry.name),
            requireExplicitName: true,
            priority: 1
          });
        }
      }
    }
  } catch (_) {}

  let best = null;
  for (const cand of candidates) {
    const info = readManifestVersion(cand.dir, cand.requireExplicitName);
    if (!info.version) continue;
    const record = { dir: cand.dir, version: info.version, source: info.source, priority: cand.priority };
    if (!best) {
      best = record;
      continue;
    }
    const cmp = compareSemverNumeric(record.version, best.version);
    if (cmp !== null) {
      if (cmp > 0 || (cmp === 0 && record.priority > best.priority)) {
        best = record;
      }
    } else if (record.priority > best.priority) {
      best = record;
    }
  }
  return best || { dir: join(pluginsRoot, 'antigravity-cli-statusline'), version: '', source: '' };
}

export function checkPluginHookSync(options = {}) {
  const home = options.home || os.homedir();
  const hooksDir = options.hooksDir || join(home, '.gemini', 'antigravity-cli', 'hooks');
  const currentPluginDir = options.currentPluginDir || resolve(__dirname, '..', '..', '..');

  const installedInfo = options.installedPluginDir
    ? { dir: options.installedPluginDir, ...readManifestVersion(options.installedPluginDir, false) }
    : discoverInstalledPlugin(home);
  const installedPluginDir = installedInfo.dir;
  const currentInfo = readManifestVersion(currentPluginDir);

  let refPluginDir = '';
  let pluginVersion = '';
  let pluginSource = '';
  if (installedInfo.version) {
    refPluginDir = installedPluginDir;
    pluginVersion = installedInfo.version;
    pluginSource = installedInfo.source;
  } else if (currentInfo.version) {
    refPluginDir = currentPluginDir;
    pluginVersion = currentInfo.version;
    pluginSource = currentInfo.source;
  }

  let localRepoVersion = '';
  try {
    if (installedInfo.version && currentInfo.version) {
      const samePath = existsSync(installedPluginDir) && existsSync(currentPluginDir) &&
        realpathSync(installedPluginDir) === realpathSync(currentPluginDir);
      if (!samePath) {
        localRepoVersion = currentInfo.version;
      }
    }
  } catch (_) {}

  const hookMetaPath = join(hooksDir, '.hook-version.json');
  let hookMeta = null;
  if (existsSync(hookMetaPath)) {
    const mr = safeRead(hookMetaPath);
    if (mr.ok) {
      const mp = parseJSON(mr.raw);
      if (mp.ok && mp.value && typeof mp.value === 'object') {
        hookMeta = mp.value;
      }
    }
  }

  const hookMainPath = join(hooksDir, 'statusline-quota.mjs');
  const hookFetchPath = join(hooksDir, 'fetch-local-quota.mjs');
  const hookExists = existsSync(hookMainPath) && existsSync(hookFetchPath);

  let embeddedHookVersion = '';
  if (existsSync(hookMainPath)) {
    const hr = safeRead(hookMainPath);
    if (hr.ok) {
      const m = hr.raw.match(/export\s+const\s+HOOK_VERSION\s*=\s*['"]([^'"]+)['"]/);
      if (m) embeddedHookVersion = m[1].trim().replace(/^v/i, '');
    }
  }

  const recordedHookVersion = (typeof hookMeta?.pluginVersion === 'string' && hookMeta.pluginVersion.trim() && hookMeta.pluginVersion !== 'unknown')
    ? hookMeta.pluginVersion.trim().replace(/^v/i, '')
    : '';
  const hookVersion = recordedHookVersion || embeddedHookVersion || '';

  const fileDiffs = [];
  if (refPluginDir) {
    const pluginScriptsDir = join(refPluginDir, 'skills', 'agy-cli-statusline', 'scripts');
    for (const fileName of ['statusline-quota.mjs', 'fetch-local-quota.mjs']) {
      const srcHash = sha256File(join(pluginScriptsDir, fileName));
      const dstHash = sha256File(join(hooksDir, fileName));
      if (!dstHash) {
        fileDiffs.push({ file: fileName, reason: 'missing_in_hooks' });
      } else if (srcHash && srcHash !== dstHash) {
        fileDiffs.push({ file: fileName, reason: 'content_differs' });
      }
    }
  }

  let updateCache = null;
  const updateCachePath = options.updateCachePath || join(home, '.gemini', 'tmp', 'plugin_update_cache.json');
  if (existsSync(updateCachePath)) {
    const ur = safeRead(updateCachePath);
    if (ur.ok) {
      const up = parseJSON(ur.raw);
      if (up.ok && up.value && typeof up.value === 'object') {
        updateCache = up.value;
      }
    }
  }

  let status = 'in_sync';
  if (!hookExists) {
    status = 'hook_missing';
  } else if (!pluginVersion) {
    status = 'plugin_not_found';
  } else if (hookVersion && hookVersion !== pluginVersion) {
    status = 'version_mismatch';
  } else if (!hookVersion && fileDiffs.length > 0) {
    status = 'legacy_mismatch';
  } else if (!hookVersion) {
    status = 'legacy_no_meta';
  } else if (fileDiffs.length > 0) {
    status = 'content_mismatch';
  }

  return {
    status,
    pluginVersion,
    pluginSource,
    localRepoVersion,
    hookVersion,
    hookSyncedAt: hookMeta?.syncedAt || '',
    hookExists,
    fileDiffs,
    updateCache
  };
}

function inspectPluginHookSync(syncResult) {
  console.log(`\n${head('--- 外掛與掛鉤版本同步檢查 ---')}`);
  const pluginLabel = syncResult.pluginVersion ? `v${syncResult.pluginVersion}` : '未偵測到（未安裝於外掛目錄）';
  const hookLabel = syncResult.hookVersion ? `v${syncResult.hookVersion}` : (syncResult.hookExists ? '未知（舊版掛鉤，無版本紀錄）' : '掛鉤尚未部署');

  console.log(`已安裝外掛版本: ${pluginLabel}${syncResult.pluginSource ? ` — ${syncResult.pluginSource}` : ''}`);
  if (syncResult.localRepoVersion) {
    console.log(dim(`目前執行診斷的工作區版本: v${syncResult.localRepoVersion}`));
  }
  console.log(`已部署掛鉤版本: ${hookLabel}${syncResult.hookSyncedAt ? `（同步於 ${syncResult.hookSyncedAt}）` : ''}`);

  if (syncResult.status === 'in_sync') {
    console.log(ok(`外掛與掛鉤版本及腳本內容一致（v${syncResult.pluginVersion}）`));
  } else if (syncResult.status === 'version_mismatch') {
    console.log(warn(`版本不一致：外掛為 v${syncResult.pluginVersion}，但已部署掛鉤為 v${syncResult.hookVersion}`));
  } else if (syncResult.status === 'legacy_mismatch') {
    console.log(warn(`掛鉤為舊版且與外掛 v${syncResult.pluginVersion} 腳本內容不一致（差異檔案：${syncResult.fileDiffs.map(d => d.file).join(', ')}）`));
  } else if (syncResult.status === 'legacy_no_meta') {
    console.log(warn('已部署掛鉤缺少 .hook-version.json 版本紀錄（可能為早期版本部署）'));
  } else if (syncResult.status === 'content_mismatch') {
    console.log(warn(`版本號相同（v${syncResult.pluginVersion}），但掛鉤腳本內容與外掛來源不一致（差異檔案：${syncResult.fileDiffs.map(d => d.file).join(', ')}）`));
  } else if (syncResult.status === 'hook_missing') {
    console.log(bad('~/.gemini/antigravity-cli/hooks/ 缺少必要掛鉤腳本'));
  } else {
    console.log(warn('無法取得外掛清單版本（plugin.json / package.json 不存在）'));
  }

  if (syncResult.updateCache) {
    const latestTag = syncResult.updateCache.latestTag || (syncResult.updateCache.latestVersion ? `v${syncResult.updateCache.latestVersion}` : '無');
    const lastSessionStatus = syncResult.updateCache.lastSessionStatus || 'unknown';
    console.log(dim(`GitHub 更新快取: 最新已知 ${latestTag} · 最近查詢狀態=${lastSessionStatus}`));
  }
}

function diagnose(layers, syncResult) {
  console.log(`\n${head('--- 診斷結論 ---')}`);
  const findings = [];

  const cli = layers.cli?.data;
  const global = layers.global?.data;
  const project = layers.project?.data;

  const effectiveCmd = cli?.statusLine?.command ?? project?.statusLine?.command ?? global?.statusLine?.command;
  const effectiveEnabled = cli?.statusLine?.enabled ?? project?.statusLine?.enabled ?? global?.statusLine?.enabled;
  const effectiveItems = cli?.ui?.footer?.items ?? project?.ui?.footer?.items ?? global?.ui?.footer?.items;
  const effectiveLabelStyle = cli?.ui?.footer?.labelStyle ?? project?.ui?.footer?.labelStyle ?? global?.ui?.footer?.labelStyle ?? 'text';
  const effectiveItemStyles = cli?.ui?.footer?.itemStyles ?? project?.ui?.footer?.itemStyles ?? global?.ui?.footer?.itemStyles;

  if (cli && 'statusLine' in cli && (cli.statusLine?.command === '' || cli.statusLine?.command === undefined)) {
    findings.push(alert('CLI 專屬層的 statusLine.command 為空或缺失 → agy CLI 不會呼叫 hook → 狀態列空白'));
    findings.push('   → 高度符合 skills/agy-cli-statusline/references/pitfalls.md 陷阱 #2 / #9 的徵兆（可能是 /model 指令覆寫所致）');
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
    findings.push(`   有效 labelStyle: ${effectiveLabelStyle}`);
    findings.push(`   有效 itemStyles: ${JSON.stringify(effectiveItemStyles)}`);
    findings.push(`   有效 items（${effectiveItems.length}）: ${effectiveItems.join(', ')}`);
    findings.push(dim('   若仍看不到狀態列，請確認：(a) Node.js 是否可在 agy 環境中執行 (b) hook 檔案是否存在'));
  }

  if (syncResult && syncResult.status === 'hook_missing') {
    findings.push(bad('~/.gemini/antigravity-cli/hooks/ 缺少必要掛鉤腳本（statusline-quota.mjs / fetch-local-quota.mjs）。'));
    findings.push('   → 建議：在 Agy CLI 執行 /antigravity-cli-statusline:agy-cli-statusline 重新部署掛鉤腳本');
  } else if (syncResult && (syncResult.status === 'version_mismatch' || syncResult.status === 'legacy_mismatch' || syncResult.status === 'content_mismatch' || syncResult.status === 'legacy_no_meta')) {
    findings.push(warn(`外掛與掛鉤版本／內容尚未同步（外掛 v${syncResult.pluginVersion || '?'} vs 掛鉤 ${syncResult.hookVersion ? 'v' + syncResult.hookVersion : '舊版/未紀錄'}）。`));
    findings.push('   → ! agy plugin install 僅更新外掛目錄，不會自動覆寫 ~/.gemini/antigravity-cli/hooks/');
    findings.push('   → 建議：在 Agy CLI 執行 /antigravity-cli-statusline:agy-cli-statusline 重新配置以更新掛鉤腳本');
  } else if (syncResult && syncResult.status === 'in_sync') {
    findings.push(ok(`外掛與掛鉤版本同步正常（v${syncResult.pluginVersion}）。`));
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

  const hooksDir = join(home, '.gemini', 'antigravity-cli', 'hooks');
  inspectHookFiles(hooksDir);
  const syncResult = checkPluginHookSync({ home, hooksDir });
  inspectPluginHookSync(syncResult);
  diagnose(layers, syncResult);

  console.log(`\n${dim('將以上完整輸出複製貼給 AI 代理，協助判斷根因。')}\n`);
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    const currentFile = fileURLToPath(import.meta.url);
    const invokedFile = resolve(process.argv[1]);
    if (currentFile === invokedFile) return true;
    return realpathSync(currentFile) === realpathSync(invokedFile);
  } catch (_) {
    return false;
  }
}

if (isDirectExecution()) {
  main();
}
