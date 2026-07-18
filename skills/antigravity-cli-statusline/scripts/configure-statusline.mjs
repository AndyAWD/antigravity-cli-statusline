import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourceDir = __dirname;

// ==========================================
// 跨平台安全性輔助函式 (Security Helpers)
// ==========================================

/**
 * 檢查指定的檔案是否位於 Git 專案工作區中。
 * 自檔案的父目錄開始逐級向上搜尋祖先目錄，直到根目錄。
 */
function isInGitProject(filePath) {
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
  } catch (err) {
    // 忽略錯誤以確保穩定性
  }
  return false;
}

/**
 * 遞迴檢查目錄或其任何實體子目錄是否為 Git 專案（包含 .git 目錄）。
 * 遇到符號連結時會跳過以防止遞迴至外部連結。
 */
function isOrContainsGitProject(dir, depth = 0) {
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
 */
function safeCopySync(src, dest) {
  const stats = fs.lstatSync(src);

  if (stats.isSymbolicLink()) {
    const linkTarget = fs.readlinkSync(src);
    // 若目標已存在，先將其安全移除
    try {
      const destStats = fs.lstatSync(dest);
      safeRemoveSync(dest);
    } catch (e) {}

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    
    try {
      // 在目標位置建立相同的符號連結
      let isDir = false;
      try {
        isDir = fs.statSync(src).isDirectory();
      } catch (e) {}
      
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
 */
function safeRemoveSync(targetPath) {
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
        } catch (rmdirErr) {}
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

// ==========================================
// 重構後的清理與備份執行邏輯
// ==========================================

const oldGlobalSkillDir = path.join(os.homedir(), '.gemini', 'skills', 'antigravity-cli-statusline');
const oldGlobalSkillBak = path.join(os.homedir(), '.gemini', 'skills', 'antigravity-cli-statusline.bak');

let oldDirExists = false;
try {
  fs.lstatSync(oldGlobalSkillDir);
  oldDirExists = true;
} catch (e) {}

if (oldDirExists) {
  console.log(`[Clean Up] 偵測到舊的全域技能目錄: ${oldGlobalSkillDir}`);
  try {
    // 安全移除既有的備份目錄/連結
    safeRemoveSync(oldGlobalSkillBak);
    
    console.log(`[Clean Up] 正在備份至: ${oldGlobalSkillBak}`);
    try {
      // 優先嘗試不可分割的重新命名（Rename）操作
      fs.renameSync(oldGlobalSkillDir, oldGlobalSkillBak);
    } catch (renameErr) {
      // 若跨磁碟分區或其他限制導致 rename 失敗，則執行安全複製與安全刪除
      safeCopySync(oldGlobalSkillDir, oldGlobalSkillBak);
      safeRemoveSync(oldGlobalSkillDir);
    }
    console.log('[Clean Up] 舊的全域技能目錄已安全備份並移除。');
  } catch (err) {
    console.error(`[Clean Up] 備份/移除舊的全域技能目錄失敗:`, err);
    if (err.message && err.message.includes('[Security Violation]')) {
      process.exit(1);
    }
  }
}

// ==========================================
// 重構後的冗餘 questions.json 清理邏輯
// ==========================================

const redundantQuestionsPaths = [
  path.join(__dirname, 'questions.json'),
  path.join(__dirname, '..', 'questions.json'),
  path.join(os.homedir(), '.gemini', 'config', 'plugins', 'antigravity-cli-statusline', 'skills', 'antigravity-cli-statusline', 'questions.json')
];

for (const qPath of redundantQuestionsPaths) {
  let qExists = false;
  try {
    fs.lstatSync(qPath);
    qExists = true;
  } catch (e) {}

  if (qExists) {
    console.log(`[Clean Up] 偵測到 questions.json: ${qPath}`);
    try {
      // safeRemoveSync 內部會呼叫 isInGitProject 防禦，能安全保護本機專案檔案
      safeRemoveSync(qPath);
    } catch (err) {
      console.error(`[Clean Up] 移除 questions.json 失敗: ${qPath}`, err);
      if (err.message && err.message.includes('[Security Violation]')) {
        process.exit(1);
      }
    }
  }
}


// 1. 解析命令列參數
let lang = 'zh-tw';
let selectedStr = '[]';
let orderStr = '';
let workspacePath = '';

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--lang' && process.argv[i + 1]) {
    lang = process.argv[i + 1];
    i++;
  } else if (process.argv[i] === '--selected' && process.argv[i + 1]) {
    selectedStr = process.argv[i + 1];
    i++;
  } else if (process.argv[i] === '--order' && process.argv[i + 1]) {
    orderStr = process.argv[i + 1];
    i++;
  } else if (process.argv[i] === '--workspace' && process.argv[i + 1]) {
    workspacePath = process.argv[i + 1];
    i++;
  }
}

console.log('已解析的參數：');
console.log(`- 語言：${lang}`);
console.log(`- 已選項目：${selectedStr}`);
console.log(`- 排序順序：${orderStr}`);
console.log(`- 工作區：${workspacePath}`);

// 2. 排序解析規則
let selectedList = [];
try {
  selectedList = JSON.parse(selectedStr.replace(/^\uFEFF/, ''));
} catch (e) {
  console.error('解析 --selected JSON 字串失敗：', e);
}

// 提取英文識別碼
const selectedIds = selectedList.map(item => {
  const match = item.match(/[\(（]([^）\)]+)[\)）]$/);
  return match ? match[1] : item;
});

let items = [];
const seen = new Set();
const isDefaultOrder = !orderStr || orderStr.trim() === '' || orderStr.includes('(Recommended)');

if (isDefaultOrder) {
  items = [...selectedIds];
} else {
  const orderParts = orderStr.split(',').map(s => s.trim());
  for (const part of orderParts) {
    if (part === 'n' || part === 'newline') {
      items.push(part);
    } else {
      let matchedId = null;
      const num = parseInt(part, 10);
      if (!isNaN(num) && num.toString() === part && num >= 1 && num <= selectedIds.length) {
        matchedId = selectedIds[num - 1];
      } else {
        if (selectedIds.includes(part)) {
          matchedId = part;
        }
      }
      if (matchedId && !seen.has(matchedId)) {
        seen.add(matchedId);
        items.push(matchedId);
      }
    }
  }
}

console.log('已解析的指標順序：', items);

// 3. 部署掛鉤（Hook）腳本
const homeDir = os.homedir();
const hooksDir = path.join(homeDir, '.gemini', 'antigravity-cli', 'hooks');

console.log(`正在部署掛鉤腳本至 ${hooksDir}...`);
if (!fs.existsSync(hooksDir)) {
  fs.mkdirSync(hooksDir, { recursive: true });
}

const statuslineQuotaSrcPath = path.join(sourceDir, 'statusline-quota.mjs');
const fetchLocalQuotaSrcPath = path.join(sourceDir, 'fetch-local-quota.mjs');

if (!fs.existsSync(statuslineQuotaSrcPath) || !fs.existsSync(fetchLocalQuotaSrcPath)) {
  console.error('在以下目錄找不到掛鉤腳本來源：', sourceDir);
  process.exit(1);
}

const statuslineQuotaContent = fs.readFileSync(statuslineQuotaSrcPath, 'utf8');
const fetchLocalQuotaContent = fs.readFileSync(fetchLocalQuotaSrcPath, 'utf8');

function writeContentAndVerifyNoBOM(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, { encoding: 'utf8' });
  
  // 驗證並就地剝除位元組順序記號（BOM）
  let buffer = fs.readFileSync(filePath);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    console.log(`[偵測到 BOM] 在 ${filePath} 發現 BOM，正在剝除...`);
    buffer = buffer.slice(3);
    fs.writeFileSync(filePath, buffer);
  }
}

writeContentAndVerifyNoBOM(path.join(hooksDir, 'statusline-quota.mjs'), statuslineQuotaContent);
writeContentAndVerifyNoBOM(path.join(hooksDir, 'fetch-local-quota.mjs'), fetchLocalQuotaContent);
console.log('掛鉤腳本部署成功。');

// 4. 三層 settings.json 寫入與防禦位元組順序記號（BOM）鐵則
const statuslineQuotaMjsPath = path.join(hooksDir, 'statusline-quota.mjs');

function readJsonWithBOMDefense(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace(/^\uFEFF/, '');
  try {
    return JSON.parse(content);
  } catch (err) {
    console.error(`解析 ${filePath} 失敗，傳回空物件：`, err);
    return {};
  }
}

function writeJsonAndVerifyNoBOM(filePath, data) {
  writeContentAndVerifyNoBOM(filePath, JSON.stringify(data, null, 2));
}

function updateSettings(settingsPath) {
  console.log(`正在更新設定檔：${settingsPath}`);
  const settings = readJsonWithBOMDefense(settingsPath);
  
  if (!settings.ui) settings.ui = {};
  settings.ui.language = lang;
  
  if (!settings.ui.footer) settings.ui.footer = {};
  settings.ui.footer.items = items;
  
  settings.statusLine = {
    enabled: true,
    type: 'command',
    command: `node ${statuslineQuotaMjsPath}`
  };
  
  writeJsonAndVerifyNoBOM(settingsPath, settings);
}

// 寫入全域與 CLI 專屬 settings.json
const globalSettingsPath = path.join(homeDir, '.gemini', 'settings.json');
const cliSettingsPath = path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json');

updateSettings(globalSettingsPath);
updateSettings(cliSettingsPath);

// 寫入專案層 settings.json （如果符合條件）
if (workspacePath) {
  const projectGeminiDir = path.join(workspacePath, '.gemini');
  const projectSettingsPath = path.join(projectGeminiDir, 'settings.json');
  if (fs.existsSync(projectGeminiDir) || fs.existsSync(projectSettingsPath)) {
    updateSettings(projectSettingsPath);
  }
}

// 5. trusted_hooks.json 寫入與防禦位元組順序記號（BOM）
const trustedHooksPath = path.join(homeDir, '.gemini', 'trusted_hooks.json');
console.log(`正在更新信任掛鉤設定：${trustedHooksPath}`);
const trustedHooks = readJsonWithBOMDefense(trustedHooksPath);

const trustStrings = [];
if (process.platform === 'win32') {
  // Windows 平台
  // 1. 絕對路徑變體（單反斜線）
  trustStrings.push(`statusLine:node ${statuslineQuotaMjsPath}`);
  // 2. 絕對路徑變體（雙反斜線）
  trustStrings.push(`statusLine:node ${statuslineQuotaMjsPath.replace(/\\/g, '\\\\')}`);
  // 3. forward slash 變體
  trustStrings.push(`statusLine:node ${statuslineQuotaMjsPath.replace(/\\/g, '/')}`);
  // 4. 環境變數 %USERPROFILE% 變體（單反斜線）
  trustStrings.push(`statusLine:node %USERPROFILE%\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs`);
  // 5. 環境變數 %USERPROFILE% 變體（雙反斜線）
  trustStrings.push(`statusLine:node %USERPROFILE%\\\\.gemini\\\\antigravity-cli\\\\hooks\\\\statusline-quota.mjs`);
  // 6. 環境變數 %USERPROFILE% 變體（forward slash）
  trustStrings.push(`statusLine:node %USERPROFILE%/.gemini/antigravity-cli/hooks/statusline-quota.mjs`);
} else {
  // macOS / Linux 平台
  trustStrings.push(`statusLine:node ${statuslineQuotaMjsPath}`);
  trustStrings.push(`statusLine:node $HOME/.gemini/antigravity-cli/hooks/statusline-quota.mjs`);
}

const keysToRegister = [homeDir, '*'];
if (workspacePath) {
  keysToRegister.push(path.resolve(workspacePath));
  if (process.platform === 'win32') {
    keysToRegister.push(path.resolve(workspacePath).replace(/\\/g, '/'));
  }
}

for (const key of keysToRegister) {
  if (!trustedHooks[key]) {
    trustedHooks[key] = [];
  }
  for (const ts of trustStrings) {
    if (!trustedHooks[key].includes(ts)) {
      trustedHooks[key].push(ts);
    }
  }
}

writeJsonAndVerifyNoBOM(trustedHooksPath, trustedHooks);
console.log('已成功更新信任掛鉤。');

// 6. Windows sh.exe 編譯
if (process.platform === 'win32') {
  let cliBinDir = '';
  try {
    const whereOut = execSync('where agy', { windowsHide: true }).toString().trim();
    const agyPath = whereOut.split('\r\n')[0].split('\n')[0].trim();
    cliBinDir = path.dirname(agyPath);
  } catch (err) {
    console.warn('無法使用 where 指令尋找 agy.exe 路徑：', err.message);
  }

  if (cliBinDir) {
    const destShPath = path.join(cliBinDir, 'sh.exe');
    if (!fs.existsSync(destShPath)) {
      console.log(`在 ${cliBinDir} 找不到 sh.exe，嘗試編譯...`);
      const sourceCsPath = path.join(sourceDir, 'sh_hidden.cs');
      if (fs.existsSync(sourceCsPath)) {
        let cscPath = '';
        try {
          const cscFindCmd = `powershell.exe -NoProfile -Command "(Get-ChildItem -Path 'C:\\Windows\\Microsoft.NET\\Framework64\\v*\\csc.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName"`;
          cscPath = execSync(cscFindCmd, { windowsHide: true }).toString().trim();
        } catch (err) {
          console.error('使用 PowerShell 尋找 csc.exe 失敗：', err.message);
        }

        if (cscPath) {
          try {
            console.log(`正在使用 ${cscPath} 編譯隱藏的 sh.exe...`);
            const compileCmd = `"${cscPath}" /target:winexe /out:"${destShPath}" "${sourceCsPath}"`;
            execSync(compileCmd, { windowsHide: true });
            console.log('sh.exe 編譯成功。');
          } catch (err) {
            console.error('編譯 sh.exe 失敗：', err.message);
          }
        } else {
          console.warn('找不到 csc.exe。跳過 sh.exe 編譯。');
        }
      } else {
        console.warn('找不到 sh_hidden.cs 原始碼檔案。跳過 sh.exe 編譯。');
      }

      if (!fs.existsSync(destShPath)) {
        if (lang === 'zh-tw') {
          console.warn('警告：sh.exe 編譯失敗，請檢查權限是否足夠，或嘗試以系統管理員權限重新設定。');
        } else if (lang === 'jp') {
          console.warn('警告：sh.exe のコンパイルに失敗しました。アクセス権限が十分であるか確認するか、管理者権限で再設定を試みてください。');
        } else {
          console.warn('Warning: Compilation of sh.exe failed. Please check if you have sufficient privileges, or try configuring again with administrator privileges.');
        }
      }
    } else {
      console.log('sh.exe 已存在，跳過編譯。');
    }
  }
}

console.log('設定成功完成！');
