import fsSync, { promises as fsPromises } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

/**
 * 檢查位元組緩衝區是否帶有 UTF-8 位元組順序記號（BOM：EF BB BF）。
 * @param {Buffer|Uint8Array|null|undefined} buf
 * @returns {boolean}
 */
export function hasBOM(buf) {
  return Boolean(buf && buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf);
}

/**
 * 非同步寫入檔案並驗證無 UTF-8 BOM（透過暫存檔與不可分割重新命名）。
 * @param {string} filePath
 * @param {string} content
 * @returns {Promise<void>}
 */
export async function writeFileAndVerifyNoBOM(filePath, content) {
  const dir = path.dirname(filePath);
  await fsPromises.mkdir(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.tmp_${path.basename(filePath)}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
  await fsPromises.writeFile(tmpPath, content, { encoding: 'utf8' });
  let buffer = await fsPromises.readFile(tmpPath);
  if (hasBOM(buffer)) {
    buffer = buffer.slice(3);
    await fsPromises.writeFile(tmpPath, buffer);
  }
  await fsPromises.rename(tmpPath, filePath);
}

/**
 * 非同步安全讀取 JSON 物件檔案，自動剝除前導 BOM；失敗或非純物件時回傳 null。
 * @param {string} filePath
 * @returns {Promise<object|null>}
 */
export async function readJsonSafeAsync(filePath) {
  try {
    const content = await fsPromises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content.replace(/^\uFEFF/, ''));
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch (_) {
    return null;
  }
}

/**
 * 同步寫入文字內容並驗證就地剝除 UTF-8 BOM（必要時自動建立父目錄）。
 * @param {string} filePath
 * @param {string} content
 */
export function writeContentAndVerifyNoBOMSync(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
  fsSync.writeFileSync(filePath, content, { encoding: 'utf8' });

  // 驗證並就地剝除位元組順序記號（BOM）
  let buffer = fsSync.readFileSync(filePath);
  if (hasBOM(buffer)) {
    console.log(`[偵測到 BOM] 在 ${filePath} 發現 BOM，正在剝除...`);
    buffer = buffer.slice(3);
    fsSync.writeFileSync(filePath, buffer);
  }
}

/**
 * 同步原子寫入檔案並驗證剝除 UTF-8 BOM（透過暫存檔與重新命名，無額外日誌輸出）。
 * @param {string} filePath
 * @param {string} content
 */
export function writeFileSyncAndVerifyNoBOM(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = path.join(
    dir,
    `.tmp_${path.basename(filePath)}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`
  );
  fsSync.writeFileSync(tmpPath, content, { encoding: 'utf8' });
  let buffer = fsSync.readFileSync(tmpPath);
  if (hasBOM(buffer)) {
    buffer = buffer.slice(3);
    fsSync.writeFileSync(tmpPath, buffer);
  }
  fsSync.renameSync(tmpPath, filePath);
}

/**
 * 同步讀取設定檔 JSON 並防禦 UTF-8 BOM 與損壞檔案。
 * 檔案不存在或內容空白時回傳 {}；解析失敗、陣列或非純物件時紀錄錯誤並回傳 null（保護既有設定不被覆寫）。
 * @param {string} filePath
 * @returns {object|null}
 */
export function readJsonWithBOMDefenseSync(filePath) {
  if (!fsSync.existsSync(filePath)) {
    return {};
  }
  let content = fsSync.readFileSync(filePath, 'utf8');
  content = content.replace(/^\uFEFF/, '');
  if (!content.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch (err) {
    console.error(`解析 ${filePath} 失敗，為保護既有設定將跳過寫入此檔案：`, err.message);
    return null;
  }
}

/**
 * 同步寫入格式化 JSON（2 格縮排）並驗證無 UTF-8 BOM。
 * @param {string} filePath
 * @param {unknown} data
 */
export function writeJsonAndVerifyNoBOMSync(filePath, data) {
  writeContentAndVerifyNoBOMSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * 同步安全讀取 JSON 物件檔案，自動剝除前導 BOM；失敗或非純物件時回傳 null。
 * @param {string} filePath
 * @returns {object|null}
 */
export function readJsonSafeSync(filePath) {
  try {
    const raw = fsSync.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch (_) {
    return null;
  }
}

/**
 * 計算字串或位元組緩衝區的 SHA-256 十六進位雜湊值。
 * @param {string|Buffer} str
 * @returns {string}
 */
export function sha256String(str) {
  if (Buffer.isBuffer(str)) {
    return createHash('sha256').update(str).digest('hex');
  }
  return createHash('sha256').update(String(str ?? ''), 'utf8').digest('hex');
}

/**
 * 同步計算檔案內容的 SHA-256 十六進位雜湊值；檔案不存在或讀取錯誤時回傳空字串。
 * @param {string} filePath
 * @returns {string}
 */
export function sha256FileSync(filePath) {
  try {
    if (!filePath || !fsSync.existsSync(filePath)) return '';
    return createHash('sha256').update(fsSync.readFileSync(filePath)).digest('hex');
  } catch (_) {
    return '';
  }
}

/**
 * 遞迴列出指定目錄下所有 .mjs 檔案，並回傳排序後的 POSIX 格式相對路徑（例如 'core/constants.mjs'）。
 * 目錄不存在時回傳空陣列。
 * @param {string} dirPath
 * @param {string} [baseDir=dirPath]
 * @returns {string[]}
 */
export function listMjsFilesRecursiveSync(dirPath, baseDir = dirPath) {
  if (!dirPath || !fsSync.existsSync(dirPath)) {
    return [];
  }
  let entries;
  try {
    const stat = fsSync.statSync(dirPath);
    if (!stat.isDirectory()) return [];
    entries = fsSync.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listMjsFilesRecursiveSync(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      const rel = path.relative(baseDir, fullPath).split(path.sep).join('/');
      results.push(rel);
    }
  }
  results.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return results;
}

/**
 * 判斷目前模組是否為 CLI 直接執行入口，相容 Windows 磁碟機代號大小寫、符號連結與 `--import ... -e 0` 呼叫方式。
 * @param {string} importMetaUrl
 * @param {{ treatEmptyArgv1AsDirect?: boolean, argv1?: string, platform?: string }} [options]
 * @returns {boolean}
 */
export function isDirectExecution(importMetaUrl, options = {}) {
  const {
    treatEmptyArgv1AsDirect = false,
    argv1 = process.argv[1],
    platform = process.platform
  } = options;

  if (!argv1) {
    return Boolean(treatEmptyArgv1AsDirect);
  }

  try {
    const cleanArgv1 = String(argv1).replace(/^"(.*)"$/, '$1');
    if (!cleanArgv1) {
      return Boolean(treatEmptyArgv1AsDirect);
    }

    const metaPath = fileURLToPath(importMetaUrl);
    const resolvedMeta = path.resolve(metaPath);
    const resolvedArgv = path.resolve(cleanArgv1);
    const caseInsensitive = platform === 'win32' || platform === 'darwin';
    const normalizeForCmp = (p) => (caseInsensitive ? p.toLowerCase() : p);

    if (normalizeForCmp(resolvedArgv) === normalizeForCmp(resolvedMeta)) {
      return true;
    }

    try {
      const realMeta = fsSync.realpathSync(resolvedMeta);
      const realArgv = fsSync.realpathSync(resolvedArgv);
      return normalizeForCmp(realArgv) === normalizeForCmp(realMeta);
    } catch (_) {
      return false;
    }
  } catch (_) {
    return false;
  }
}
