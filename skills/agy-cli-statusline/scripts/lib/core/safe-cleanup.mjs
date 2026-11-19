import fs from 'fs';
import path from 'path';

const LEGACY_SH_BRIDGE_MAX_BYTES = 16384;

/**
 * 檢查指定的檔案是否位於 Git 專案工作區中。
 * 自檔案的父目錄開始逐級向上搜尋祖先目錄，直到根目錄。
 * @param {string} filePath
 * @returns {boolean}
 */
export function isInGitProject(filePath) {
  try {
    let currentDir = path.dirname(path.resolve(filePath));
    const root = path.parse(currentDir).root;

    while (currentDir && currentDir !== root) {
      if (fs.existsSync(path.join(currentDir, '.git'))) {
        return true;
      }
      const parent = path.dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }
    if (root && fs.existsSync(path.join(root, '.git'))) {
      return true;
    }
  } catch (_) {
    // 忽略錯誤以確保穩定性
  }
  return false;
}

/**
 * 遞迴檢查目錄或其任何實體子目錄是否為 Git 專案（包含 .git 目錄）。
 * 遇到符號連結時會跳過以防止遞迴至外部連結。
 * @param {string} dir
 * @param {number} [depth=0]
 * @returns {boolean}
 */
export function isOrContainsGitProject(dir, depth = 0) {
  if (depth > 30) {
    throw new RangeError('Directory recursion depth limit exceeded');
  }
  try {
    const stats = fs.lstatSync(dir);
    if (stats.isSymbolicLink()) {
      return false; // 符號連結本身非 Git 專案，且安全移除時只會 unlink 該連結，不影響內容
    }
    if (!stats.isDirectory()) {
      return false;
    }
    // 檢查當前層級是否為 Git 專案
    if (fs.existsSync(path.join(dir, '.git'))) {
      return true;
    }
    // 遍歷實體子目錄
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (isOrContainsGitProject(path.join(dir, file), depth + 1)) {
        return true;
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
  return false;
}

/**
 * 安全地複製檔案或目錄，完全不追隨（Dereference）符號連結。
 * 對於符號連結，會在目標位置重新建立相同的連結，並處理 Windows 上的權限限制。
 * @param {string} src
 * @param {string} dest
 */
export function safeCopySync(src, dest) {
  const stats = fs.lstatSync(src);

  if (stats.isSymbolicLink()) {
    const linkTarget = fs.readlinkSync(src);
    // 若目標已存在，先將其安全移除
    try {
      fs.lstatSync(dest);
      safeRemoveSync(dest);
    } catch (_) {}

    fs.mkdirSync(path.dirname(dest), { recursive: true });

    try {
      // 在目標位置建立相同的符號連結
      let isDir = false;
      try {
        isDir = fs.statSync(src).isDirectory();
      } catch (_) {}

      if (process.platform === 'win32') {
        fs.symlinkSync(linkTarget, dest, isDir ? 'junction' : 'file');
      } else {
        fs.symlinkSync(linkTarget, dest);
      }
    } catch (linkErr) {
      // Windows 上若無權限建立 Symlink，則寫入一個指示性文字檔以避免程序崩潰
      if (process.platform === 'win32') {
        console.warn(`[Safe Backup] Windows 權限不足，無法在 ${dest} 建立符號連結。改寫入 .lnk_target 文字檔案。`);
        fs.writeFileSync(`${dest}.lnk_target`, linkTarget, 'utf8');
      } else {
        throw linkErr;
      }
    }
    return;
  }

  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const files = fs.readdirSync(src);
    for (const file of files) {
      safeCopySync(path.join(src, file), path.join(dest, file));
    }
    return;
  }

  // 實體檔案複製
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/**
 * 安全地刪除指定路徑。如果是符號連結，僅解除連結（Unlink），絕不跟隨。
 * 如果是實體目錄，會進行 Git 專案防誤刪檢查，確認安全後再遞迴安全刪除子項。
 * @param {string} targetPath
 */
export function safeRemoveSync(targetPath) {
  let stats;
  try {
    stats = fs.lstatSync(targetPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return; // 路徑不存在
    }
    throw err;
  }

  // 1. 如果是符號連結 (macOS Symlink 或 Windows Junction/Symlink)
  if (stats.isSymbolicLink()) {
    console.log(`[Safe Clean] 正在移除符號連結/交接點: ${targetPath}`);
    try {
      fs.unlinkSync(targetPath);
    } catch (unlinkErr) {
      // Windows 下對於目錄型交接點，有時 unlink 會失敗，改以 rmdirSync 清理連結本身
      if (process.platform === 'win32') {
        try {
          fs.rmdirSync(targetPath);
          return;
        } catch (_) {}
      }
      throw unlinkErr;
    }
    return;
  }

  // 2. 如果是目錄
  if (stats.isDirectory()) {
    // 安全防禦：防止刪除本機開發專案（包含 .git）
    if (isOrContainsGitProject(targetPath)) {
      throw new Error(`[Security Violation] 刪除操作已被中止。此目錄是或包含 Git 專案: ${targetPath}`);
    }

    // 遞迴安全刪除所有子項
    const files = fs.readdirSync(targetPath);
    for (const file of files) {
      safeRemoveSync(path.join(targetPath, file));
    }

    // 刪除實體目錄本身
    console.log(`[Safe Clean] 正在移除目錄: ${targetPath}`);
    fs.rmdirSync(targetPath);
    return;
  }

  // 3. 如果是普通檔案
  // 檢查是否處於 Git 專案工作區中
  if (isInGitProject(targetPath)) {
    console.warn(`[Safe Clean] 跳過刪除。此檔案是 Git 專案的一部分: ${targetPath}`);
    return;
  }
  console.log(`[Safe Clean] 正在移除檔案: ${targetPath}`);
  fs.unlinkSync(targetPath);
}

/**
 * 安全移除早期版本於 Windows %LOCALAPPDATA%\agy\bin\ 編譯遺留的微型 sh.exe 橋接器（約 4,608 bytes）。
 * 自 agy v1.3.5+ 起改用 cmd /c 原生執行狀態列，保留未簽署 sh.exe 反易觸發防毒軟體啟發式誤報。
 * 嚴格限定非符號連結、普通檔案且大小 <= 16,384 bytes，避免誤傷真實的 Git / MSYS2 sh.exe。
 * @param {string} [localAppDataDir=process.env.LOCALAPPDATA]
 * @param {string} [platform=process.platform]
 * @returns {boolean}
 */
export function cleanupLegacyWindowsShBridge(localAppDataDir = process.env.LOCALAPPDATA, platform = process.platform) {
  if (platform !== 'win32' || !localAppDataDir || typeof localAppDataDir !== 'string') {
    return false;
  }
  const legacyShPath = path.join(localAppDataDir, 'agy', 'bin', 'sh.exe');
  try {
    const stats = fs.lstatSync(legacyShPath);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > LEGACY_SH_BRIDGE_MAX_BYTES) {
      return false;
    }
    if (isInGitProject(legacyShPath)) {
      return false;
    }
    fs.unlinkSync(legacyShPath);
    console.log(`[Clean Up] 已移除舊版 Windows sh.exe 橋接器（agy v1.3.5+ 已不再需要且可避免防毒誤報）: ${legacyShPath}`);
    return true;
  } catch (_) {
    return false;
  }
}
