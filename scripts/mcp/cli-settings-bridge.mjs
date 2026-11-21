import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listMjsFilesRecursiveSync,
  readJsonWithBOMDefenseSync,
  sha256String,
  writeFileSyncAndVerifyNoBOM
} from '../../skills/agy-cli-statusline/scripts/lib/core/fs-utils.mjs';
import {
  normalizeLabelStyle,
  normalizeLanguage
} from '../../skills/agy-cli-statusline/scripts/lib/core/normalize.mjs';
import { readPluginManifestFromDirSync } from '../../skills/agy-cli-statusline/scripts/lib/core/plugin-manifest.mjs';
import { getStatusLineCommand } from '../../skills/agy-cli-statusline/scripts/lib/core/settings.mjs';
import {
  ALL_STANDARD_METRIC_IDS,
  SUPPORTED_LOCALES
} from '../../skills/agy-cli-statusline/scripts/lib/metrics/registry.mjs';

const STANDARD_ID_SET = new Set(ALL_STANDARD_METRIC_IDS);
const VALID_TIME_FORMATS = new Set(['smart', 'auto', 'full', 'yyyy/MM/dd HH:mm', '24h', '12h']);

function isPathInsideOrEqual(targetPath, baseDir) {
  if (!targetPath || !baseDir) return false;
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === resolvedBase) return true;
  const rel = path.relative(resolvedBase, resolvedTarget);
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * 嚴格驗證並正規化前端傳入的狀態列排版設定。
 * @param {object} raw
 */
export function validateCliLayoutInput(raw = {}) {
  const langNorm = normalizeLanguage(raw.lang || 'zh-tw');
  const lang = SUPPORTED_LOCALES.includes(langNorm) ? langNorm : 'zh-tw';
  const labelStyle = normalizeLabelStyle(raw.labelStyle || 'text');

  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items = [];
  const seenMetrics = new Set();
  for (const item of rawItems) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed === 'n' || trimmed === 'newline') {
      items.push('n');
      continue;
    }
    if (STANDARD_ID_SET.has(trimmed) && !seenMetrics.has(trimmed)) {
      seenMetrics.add(trimmed);
      items.push(trimmed);
    }
  }
  if (items.filter(x => x !== 'n').length === 0) {
    items.push('model-name', 'quota', 'context-used', 'memory-usage');
  }

  const itemStyles = {};
  if (raw.itemStyles && typeof raw.itemStyles === 'object' && !Array.isArray(raw.itemStyles)) {
    for (const [k, v] of Object.entries(raw.itemStyles)) {
      if (!STANDARD_ID_SET.has(k)) continue;
      const st = normalizeLabelStyle(v);
      if (st === 'emoji' || st === 'text') {
        itemStyles[k] = st;
      }
    }
  }

  const rawTf = typeof raw.timeFormat === 'string' ? raw.timeFormat.trim() : 'smart';
  const timeFormat = VALID_TIME_FORMATS.has(rawTf) ? rawTf : 'smart';

  const parsedBar = parseInt(raw.barLength, 10);
  const barLength = (!isNaN(parsedBar) && parsedBar >= 1 && parsedBar <= 50) ? parsedBar : 10;

  return { lang, items, itemStyles, labelStyle, timeFormat, barLength };
}

/**
 * 產生人類可讀之排序語法（序號版與英文識別碼版）。
 */
export function formatOrderExpressions(items = [], itemStyles = {}, labelStyle = 'text') {
  const idParts = [];
  const numParts = [];
  const indexMap = new Map(ALL_STANDARD_METRIC_IDS.map((id, idx) => [id, idx + 1]));

  for (const item of items) {
    if (item === 'n') {
      idParts.push('n');
      numParts.push('n');
      continue;
    }
    const effective = (itemStyles && itemStyles[item]) ? itemStyles[item] : labelStyle;
    const isEmoji = effective === 'emoji';
    idParts.push(isEmoji ? `e:${item}` : item);
    const num = indexMap.get(item);
    if (num) {
      numParts.push(isEmoji ? `e${num}` : String(num));
    }
  }
  return {
    idExpression: idParts.join(', '),
    numericExpression: numParts.join(', ')
  };
}

/**
 * 尋找系統獨立 Node.js 執行檔（排除 Electron / .app / Antigravity 內嵌執行檔）。
 */
export function resolveSafeSystemNodeExecPath(platform = process.platform, execPath = process.execPath) {
  if (platform === 'win32') return execPath;
  const isEmbedded = (p) => {
    const lower = String(p || '').toLowerCase();
    return lower.includes('.app/') || lower.includes('electron') || lower.includes('antigravity');
  };
  const candidates = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node'
  ];
  if (execPath && !isEmbedded(execPath)) {
    candidates.unshift(execPath);
  }
  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        return cand;
      }
    } catch (_) {}
  }
  return execPath;
}

function writeFileAtomicRetrySync(filePath, content) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSyncAndVerifyNoBOM(filePath, content);
      return;
    } catch (err) {
      if (attempt < 2 && err && (err.code === 'EPERM' || err.code === 'EBUSY')) {
        const until = Date.now() + 15 * (attempt + 1);
        while (Date.now() < until) { /* Windows 檔案鎖定短暫等待 */ }
        continue;
      }
      throw err;
    }
  }
}

function cleanupObsoleteHookLibFilesSync(hooksLibDir, expectedLibSet) {
  let isRealDir = false;
  try {
    const st = fs.lstatSync(hooksLibDir);
    isRealDir = !st.isSymbolicLink() && st.isDirectory();
  } catch (_) {}
  if (!isRealDir) return;

  const existing = listMjsFilesRecursiveSync(hooksLibDir);
  for (const rel of existing) {
    if (expectedLibSet.has(rel)) continue;
    const candidate = path.join(hooksLibDir, ...rel.split('/'));
    if (!isPathInsideOrEqual(candidate, hooksLibDir) || path.resolve(candidate) === path.resolve(hooksLibDir)) continue;
    try {
      const realBase = fs.realpathSync(hooksLibDir);
      const realParent = fs.realpathSync(path.dirname(candidate));
      if (!isPathInsideOrEqual(realParent, realBase)) continue;
      const st = fs.lstatSync(candidate);
      if (st.isSymbolicLink() || !st.isFile()) continue;
      fs.unlinkSync(candidate);
    } catch (_) {}
  }
}

function deployCliHooksFromPluginSync(homeDir, pluginRootDir) {
  const srcScriptsDir = path.join(pluginRootDir, 'skills', 'agy-cli-statusline', 'scripts');
  const hooksDir = path.join(homeDir, '.gemini', 'antigravity-cli', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const filesMeta = {};
  for (const fileName of ['statusline-quota.mjs', 'fetch-local-quota.mjs']) {
    const srcPath = path.join(srcScriptsDir, fileName);
    const dstPath = path.join(hooksDir, fileName);
    const content = fs.readFileSync(srcPath, 'utf8');
    writeFileAtomicRetrySync(dstPath, content);
    filesMeta[fileName] = sha256String(fs.readFileSync(dstPath, 'utf8'));
  }

  const srcLibDir = path.join(srcScriptsDir, 'lib');
  const hooksLibDir = path.join(hooksDir, 'lib');
  const libRelPaths = listMjsFilesRecursiveSync(srcLibDir);
  for (const relPath of libRelPaths) {
    const parts = relPath.split('/');
    const srcFile = path.join(srcLibDir, ...parts);
    const dstFile = path.join(hooksLibDir, ...parts);
    writeFileAtomicRetrySync(dstFile, fs.readFileSync(srcFile, 'utf8'));
    filesMeta[`lib/${relPath}`] = sha256String(fs.readFileSync(dstFile, 'utf8'));
  }

  cleanupObsoleteHookLibFilesSync(hooksLibDir, new Set(libRelPaths));

  const manifest = readPluginManifestFromDirSync(pluginRootDir, false);
  writeFileAtomicRetrySync(
    path.join(hooksDir, '.hook-version.json'),
    JSON.stringify({
      pluginVersion: manifest?.version || 'unknown',
      syncedAt: new Date().toISOString(),
      files: filesMeta
    }, null, 2)
  );

  return hooksDir;
}

function updateSingleSettingsAtomicSync(settingsPath, config, safeCommand, deployHooks) {
  const settings = readJsonWithBOMDefenseSync(settingsPath);
  if (settings === null) {
    return { path: settingsPath, updated: false, reason: 'corrupt_json_skipped' };
  }

  if (!settings.ui || typeof settings.ui !== 'object') settings.ui = {};
  settings.ui.language = config.lang;

  if (!settings.ui.footer || typeof settings.ui.footer !== 'object') settings.ui.footer = {};
  delete settings.ui.footer.theme;
  delete settings.ui.footer.style;
  delete settings.ui.labelStyle;

  settings.ui.footer.items = config.items;
  settings.ui.footer.timeFormat = config.timeFormat;
  settings.ui.footer.barLength = config.barLength;

  // 嚴格對齊 CLI R27 行為：
  // 只要 ui.footer.itemStyles 存在（哪怕是 {}），未列在裡面的指標在 CLI 會強制顯示為 text。
  const activeMetrics = config.items.filter(x => x !== 'n');
  const rawOverrides = config.itemStyles || {};
  if (config.labelStyle === 'emoji') {
    const allEmoji = activeMetrics.every(id => (rawOverrides[id] || 'emoji') === 'emoji');
    if (allEmoji) {
      settings.ui.footer.labelStyle = 'emoji';
      delete settings.ui.footer.itemStyles;
    } else {
      const materialized = {};
      for (const id of activeMetrics) {
        if ((rawOverrides[id] || 'emoji') === 'emoji') {
          materialized[id] = 'emoji';
        }
      }
      settings.ui.footer.labelStyle = 'text';
      settings.ui.footer.itemStyles = materialized;
    }
  } else {
    const sparse = {};
    for (const id of activeMetrics) {
      if (rawOverrides[id] === 'emoji') {
        sparse[id] = 'emoji';
      }
    }
    settings.ui.footer.labelStyle = 'text';
    settings.ui.footer.itemStyles = sparse;
  }

  if (deployHooks && safeCommand) {
    const existingSl = (settings.statusLine && typeof settings.statusLine === 'object' && !Array.isArray(settings.statusLine))
      ? settings.statusLine
      : {};
    const existingCmd = typeof existingSl.command === 'string' ? existingSl.command.trim() : '';
    const hasValidExisting = existingCmd.includes('statusline-quota.mjs');
    settings.statusLine = {
      ...existingSl,
      enabled: true,
      type: 'command',
      command: hasValidExisting ? existingSl.command : safeCommand
    };
  }

  writeFileAtomicRetrySync(settingsPath, JSON.stringify(settings, null, 2));
  return { path: settingsPath, updated: true };
}

/**
 * 原子安全寫入三層 CLI settings.json（僅鎖定白名單目標路徑），並可選同步部署 CLI 掛鉤。
 */
export function saveCliSettingsAtomicSync({
  homeDir = os.homedir(),
  pluginRootDir,
  workspacePath = '',
  config,
  deployHooks = false
}) {
  const validated = validateCliLayoutInput(config);
  let safeCommand = '';
  let hooksDir = '';

  if (deployHooks) {
    hooksDir = deployCliHooksFromPluginSync(homeDir, pluginRootDir);
    const statuslineScript = path.join(hooksDir, 'statusline-quota.mjs');
    const safeNode = resolveSafeSystemNodeExecPath();
    safeCommand = getStatusLineCommand(statuslineScript, process.platform, safeNode);
  }

  const targets = [
    path.join(homeDir, '.gemini', 'settings.json'),
    path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json')
  ];

  const geminiRoot = path.join(homeDir, '.gemini');
  if (
    workspacePath &&
    typeof workspacePath === 'string' &&
    !isPathInsideOrEqual(workspacePath, pluginRootDir) &&
    !isPathInsideOrEqual(workspacePath, geminiRoot)
  ) {
    const projGeminiDir = path.join(workspacePath, '.gemini');
    const projSettingsPath = path.join(projGeminiDir, 'settings.json');
    if (fs.existsSync(projGeminiDir) || fs.existsSync(projSettingsPath)) {
      targets.push(projSettingsPath);
    }
  }

  const results = targets.map(t => updateSingleSettingsAtomicSync(t, validated, safeCommand, deployHooks));
  return {
    config: validated,
    deployHooks,
    hooksDir,
    results,
    orderExpressions: formatOrderExpressions(validated.items, validated.itemStyles, validated.labelStyle)
  };
}
