import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourceDir = __dirname;

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

console.log('Parsed parameters:');
console.log(`- Lang: ${lang}`);
console.log(`- Selected: ${selectedStr}`);
console.log(`- Order: ${orderStr}`);
console.log(`- Workspace: ${workspacePath}`);

// 2. 排序解析規則
let selectedList = [];
try {
  selectedList = JSON.parse(selectedStr.replace(/^\uFEFF/, ''));
} catch (e) {
  console.error('Failed to parse --selected JSON string:', e);
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

console.log('Resolved items sequence:', items);

// 3. 部署掛鉤（Hook）腳本
const homeDir = os.homedir();
const hooksDir = path.join(homeDir, '.gemini', 'antigravity-cli', 'hooks');

console.log(`Deploying hooks to ${hooksDir}...`);
if (!fs.existsSync(hooksDir)) {
  fs.mkdirSync(hooksDir, { recursive: true });
}

const statuslineQuotaSrcPath = path.join(sourceDir, 'statusline-quota.mjs');
const fetchLocalQuotaSrcPath = path.join(sourceDir, 'fetch-local-quota.mjs');

if (!fs.existsSync(statuslineQuotaSrcPath) || !fs.existsSync(fetchLocalQuotaSrcPath)) {
  console.error('Source hook scripts not found in:', sourceDir);
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
    console.log(`[BOM Detected] Found BOM in ${filePath}, stripping...`);
    buffer = buffer.slice(3);
    fs.writeFileSync(filePath, buffer);
  }
}

writeContentAndVerifyNoBOM(path.join(hooksDir, 'statusline-quota.mjs'), statuslineQuotaContent);
writeContentAndVerifyNoBOM(path.join(hooksDir, 'fetch-local-quota.mjs'), fetchLocalQuotaContent);
console.log('Hook scripts deployed successfully.');

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
    console.error(`Error parsing ${filePath}, returning empty object:`, err);
    return {};
  }
}

function writeJsonAndVerifyNoBOM(filePath, data) {
  writeContentAndVerifyNoBOM(filePath, JSON.stringify(data, null, 2));
}

function updateSettings(settingsPath) {
  console.log(`Updating settings file: ${settingsPath}`);
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
console.log(`Updating trusted hooks: ${trustedHooksPath}`);
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
console.log('Trusted hooks updated successfully.');

// 6. Windows sh.exe 編譯
if (process.platform === 'win32') {
  let cliBinDir = '';
  try {
    const whereOut = execSync('where agy', { windowsHide: true }).toString().trim();
    const agyPath = whereOut.split('\r\n')[0].split('\n')[0].trim();
    cliBinDir = path.dirname(agyPath);
  } catch (err) {
    console.warn('Could not find agy.exe path using where command:', err.message);
  }

  if (cliBinDir) {
    const destShPath = path.join(cliBinDir, 'sh.exe');
    if (!fs.existsSync(destShPath)) {
      console.log(`sh.exe is missing in ${cliBinDir}, attempting to compile...`);
      const sourceCsPath = path.join(sourceDir, 'sh_hidden.cs');
      if (fs.existsSync(sourceCsPath)) {
        let cscPath = '';
        try {
          const cscFindCmd = `powershell.exe -NoProfile -Command "(Get-ChildItem -Path 'C:\\Windows\\Microsoft.NET\\Framework64\\v*\\csc.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName"`;
          cscPath = execSync(cscFindCmd, { windowsHide: true }).toString().trim();
        } catch (err) {
          console.error('Failed to find csc.exe using PowerShell:', err.message);
        }

        if (cscPath) {
          try {
            console.log(`Compiling hidden sh.exe using: ${cscPath}`);
            const compileCmd = `"${cscPath}" /target:winexe /out:"${destShPath}" "${sourceCsPath}"`;
            execSync(compileCmd, { windowsHide: true });
            console.log('sh.exe compiled successfully.');
          } catch (err) {
            console.error('Compilation of sh.exe failed:', err.message);
          }
        } else {
          console.warn('csc.exe was not found. sh.exe compilation skipped.');
        }
      } else {
        console.warn('sh_hidden.cs source file not found. sh.exe compilation skipped.');
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
      console.log('sh.exe already exists, skipping compilation.');
    }
  }
}

console.log('Configuration completed successfully!');
