import fs from 'node:fs';
import path from 'node:path';
import {
  listMjsFilesRecursiveSync,
  readJsonWithBOMDefenseSync,
  sha256String,
  writeFileSyncAndVerifyNoBOM
} from './fs-utils.mjs';
import { readPluginManifestFromDirSync } from './plugin-manifest.mjs';
import { safeRemoveSync } from './safe-cleanup.mjs';

/**
 * 檢查目標路徑是否位於指定父目錄內（strict=true 時排除目錄本身）。
 * @param {string} targetPath
 * @param {string} baseDir
 * @param {boolean} [strict=false]
 * @returns {boolean}
 */
export function isPathWithinOrEqual(targetPath, baseDir, strict = false) {
  if (!targetPath || !baseDir) return false;
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === resolvedBase) return !strict;
  const rel = path.relative(resolvedBase, resolvedTarget);
  return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * 原子寫入檔案（含 Windows EPERM/EBUSY 短暫重試與無 BOM 驗證）。
 * @param {string} filePath
 * @param {string} content
 */
export function writeFileAtomicRetrySync(filePath, content) {
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

/**
 * 安全清理 hooks/lib/ 中已不再存在於來源 lib/ 的過時 .mjs 檔案（防止符號連結逃逸）。
 * @param {string} hooksLibDir
 * @param {Set<string>} expectedLibSet
 * @param {{ onWarn?: (msg: string) => void }} [options={}]
 */
export function cleanupObsoleteHookLibFilesSync(hooksLibDir, expectedLibSet, options = {}) {
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
    if (!isPathWithinOrEqual(candidate, hooksLibDir, true)) {
      options.onWarn?.(`[Safe Clean] 跳過超出 hooks/lib/ 範圍的異常路徑: ${candidate}`);
      continue;
    }
    try {
      const realBase = fs.realpathSync(hooksLibDir);
      const realParent = fs.realpathSync(path.dirname(candidate));
      if (!isPathWithinOrEqual(realParent, realBase, false)) {
        options.onWarn?.(`[Safe Clean] 跳過指向 hooks/lib/ 外部的符號連結路徑: ${candidate}`);
        continue;
      }
      const st = fs.lstatSync(candidate);
      if (st.isSymbolicLink() || !st.isFile()) continue;
      safeRemoveSync(candidate);
    } catch (_) {}
  }
}

/**
 * 部署 CLI 狀態列掛鉤主程式、遞迴 lib/ 模組與 .hook-version.json 中繼資料。
 * @param {object} params
 * @returns {string} hooksDir
 */
export function deployCliHooksFromPluginSync({
  homeDir,
  srcScriptsDir,
  pluginRootDir,
  fallbackPluginVersion = 'unknown',
  onWarn
}) {
  const hooksDir = path.join(homeDir, '.gemini', 'antigravity-cli', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const filesMeta = {};
  let statuslineQuotaContent = '';
  for (const fileName of ['statusline-quota.mjs', 'fetch-local-quota.mjs']) {
    const srcPath = path.join(srcScriptsDir, fileName);
    const dstPath = path.join(hooksDir, fileName);
    const content = fs.readFileSync(srcPath, 'utf8');
    if (fileName === 'statusline-quota.mjs') statuslineQuotaContent = content;
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

  cleanupObsoleteHookLibFilesSync(hooksLibDir, new Set(libRelPaths), { onWarn });

  const manifest = pluginRootDir ? readPluginManifestFromDirSync(pluginRootDir, false) : null;
  let deployedVersion = manifest?.version || '';
  if (!deployedVersion && statuslineQuotaContent) {
    const m = statuslineQuotaContent.match(/export\s+const\s+HOOK_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (m) deployedVersion = m[1].trim().replace(/^v/i, '');
  }
  if (!deployedVersion) {
    deployedVersion = fallbackPluginVersion ? String(fallbackPluginVersion).trim().replace(/^v/i, '') : 'unknown';
  }

  writeFileAtomicRetrySync(
    path.join(hooksDir, '.hook-version.json'),
    JSON.stringify({
      pluginVersion: deployedVersion || 'unknown',
      syncedAt: new Date().toISOString(),
      files: filesMeta
    }, null, 2)
  );

  return hooksDir;
}

/**
 * 依 CLI R27 契約正規化 footer 的 labelStyle 與 itemStyles。
 * @param {string[]} items
 * @param {Record<string, string>} [itemStyles={}]
 * @param {string} [labelStyle='text']
 * @returns {{ labelStyle: 'text'|'emoji', itemStyles?: Record<string, 'emoji'> }}
 */
export function normalizeR27FooterStyles(items = [], itemStyles = {}, labelStyle = 'text') {
  const activeMetrics = (Array.isArray(items) ? items : []).filter(x => x !== 'n');
  const rawOverrides = itemStyles || {};
  if (labelStyle === 'emoji') {
    const allEmoji = activeMetrics.every(id => (rawOverrides[id] || 'emoji') === 'emoji');
    if (allEmoji) {
      return { labelStyle: 'emoji' };
    }
    const materialized = {};
    for (const id of activeMetrics) {
      if ((rawOverrides[id] || 'emoji') === 'emoji') {
        materialized[id] = 'emoji';
      }
    }
    return { labelStyle: 'text', itemStyles: materialized };
  }
  const sparse = {};
  for (const id of activeMetrics) {
    if (rawOverrides[id] === 'emoji') {
      sparse[id] = 'emoji';
    }
  }
  return { labelStyle: 'text', itemStyles: sparse };
}

/**
 * 原子安全更新單一 settings.json（防禦 BOM 與損壞設定檔，保留既有欄位）。
 * @param {string} settingsPath
 * @param {object} config
 * @param {object} [options={}]
 * @returns {{ path: string, updated: boolean, reason?: string }}
 */
export function updateSingleSettingsAtomicSync(settingsPath, config, options = {}) {
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
  if (config.timeFormat) settings.ui.footer.timeFormat = config.timeFormat;
  if (config.barLength && !isNaN(config.barLength) && config.barLength > 0) {
    settings.ui.footer.barLength = config.barLength;
  }

  if (options.useR27StyleNormalization) {
    const normalizedStyles = normalizeR27FooterStyles(config.items, config.itemStyles, config.labelStyle || 'text');
    settings.ui.footer.labelStyle = normalizedStyles.labelStyle;
    if (normalizedStyles.itemStyles !== undefined) {
      settings.ui.footer.itemStyles = normalizedStyles.itemStyles;
    } else {
      delete settings.ui.footer.itemStyles;
    }
  } else {
    settings.ui.footer.itemStyles = config.itemStyles;
    settings.ui.footer.labelStyle = config.labelStyle || 'text';
  }

  const command = options.statusLineCommand;
  if (options.updateStatusLine && command) {
    const existingSl = (settings.statusLine && typeof settings.statusLine === 'object' && !Array.isArray(settings.statusLine))
      ? settings.statusLine
      : {};
    const existingCmd = typeof existingSl.command === 'string' ? existingSl.command.trim() : '';
    const keepExisting = Boolean(options.preserveExistingStatuslineCommand && existingCmd.includes('statusline-quota.mjs'));
    settings.statusLine = {
      ...existingSl,
      enabled: true,
      type: 'command',
      command: keepExisting ? existingSl.command : command
    };
  }

  writeFileAtomicRetrySync(settingsPath, JSON.stringify(settings, null, 2));
  return { path: settingsPath, updated: true };
}
