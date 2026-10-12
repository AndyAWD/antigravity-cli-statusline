import fs from 'fs';
import path from 'path';
import assert from 'assert';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { getStatusLineCommand } from './configure-statusline.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 原始腳本的路徑
const originalScriptsDir = __dirname;
const configureScriptSrc = path.join(originalScriptsDir, 'configure-statusline.mjs');
const statuslineQuotaSrc = path.join(originalScriptsDir, 'statusline-quota.mjs');
const fetchLocalQuotaSrc = path.join(originalScriptsDir, 'fetch-local-quota.mjs');

// 輔助函數：執行子進程
function runScript(scriptPath, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: {
        ...process.env,
        ...env
      }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

// 輔助函數：遞迴刪除資料夾（無第三方依賴）
function rmRfSync(dirPath) {
  let stats;
  try {
    stats = fs.lstatSync(dirPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return; // 路徑不存在，直接返回
    }
    throw err;
  }

  if (stats.isSymbolicLink()) {
    try {
      fs.unlinkSync(dirPath);
    } catch (err) {
      if (process.platform === 'win32') {
        try {
          fs.rmdirSync(dirPath);
        } catch (e) {
          throw err;
        }
      } else {
        throw err;
      }
    }
    return;
  }

  if (stats.isDirectory()) {
    fs.readdirSync(dirPath).forEach((file) => {
      const curPath = path.join(dirPath, file);
      rmRfSync(curPath);
    });
    fs.rmdirSync(dirPath);
  } else {
    fs.unlinkSync(dirPath);
  }
}


// 複製檔案輔助函數
function copyFileSync(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// ==========================================
// 測試情境 1：防止符號連結遞迴刪除
// ==========================================
async function testCase1SymlinkDefense() {
  console.log('\n--- 執行測試情境 1：防止符號連結遞迴刪除 ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case1-'));
  
  try {
    const mockHome = path.join(sandbox, 'mock-home');
    fs.mkdirSync(mockHome);

    // 建立外部實體目錄，並寫入重要檔案
    const externalDir = path.join(sandbox, 'external-real-dir');
    fs.mkdirSync(externalDir);
    const importantFile = path.join(externalDir, 'important.txt');
    fs.writeFileSync(importantFile, 'This is super important data!', 'utf8');

    // 模擬舊技能目錄的位置，並在此處建立符號連結指向 externalDir
    const oldSkillDir = path.join(mockHome, '.gemini', 'skills', 'antigravity-cli-statusline');
    fs.mkdirSync(path.dirname(oldSkillDir), { recursive: true });

    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(externalDir, oldSkillDir, symlinkType);

    // 在沙盒中建立一個執行目錄，將腳本複製過去
    const runDir = path.join(sandbox, 'run');
    const targetScript = path.join(runDir, 'configure-statusline.mjs');
    copyFileSync(configureScriptSrc, targetScript);
    copyFileSync(statuslineQuotaSrc, path.join(runDir, 'statusline-quota.mjs'));
    copyFileSync(fetchLocalQuotaSrc, path.join(runDir, 'fetch-local-quota.mjs'));

    // 執行腳本
    const args = ['--lang', 'zh-tw', '--selected', '[]', '--order', '', '--workspace', sandbox];
    const env = {
      HOME: mockHome,
      USERPROFILE: mockHome
    };

    const result = await runScript(targetScript, args, env);
    console.log('Exit Code:', result.code);
    console.log('Stdout:', result.stdout);
    console.log('Stderr:', result.stderr);

    assert.strictEqual(result.code, 0, '腳本執行應該成功返回 0');

    // 驗證原本的符號連結已被移除
    let oldSkillLinkExists = true;
    try {
      fs.lstatSync(oldSkillDir);
    } catch (e) {
      oldSkillLinkExists = false;
    }
    assert.strictEqual(oldSkillLinkExists, false, '舊技能目錄位置的符號連結應該已被移走或刪除');

    // 驗證外部實體目錄與重要檔案完整無缺
    assert.ok(fs.existsSync(externalDir), '外部實體目錄必須依然存在');
    assert.ok(fs.existsSync(importantFile), '外部實體目錄內的重要檔案必須存在');
    assert.strictEqual(
      fs.readFileSync(importantFile, 'utf8'),
      'This is super important data!',
      '重要檔案內容不可被修改或損壞'
    );

        // 驗證備份目錄建立了相同的符號連結
    const oldSkillBak = path.join(mockHome, '.gemini', 'skills', 'antigravity-cli-statusline.bak');
    let bakExists = false;
    try {
      fs.lstatSync(oldSkillBak);
      bakExists = true;
    } catch (e) {}

    if (bakExists) {
      const bakStats = fs.lstatSync(oldSkillBak);
      assert.ok(bakStats.isSymbolicLink(), '備份路徑必須是一個符號連結');
      const linkTarget = fs.readlinkSync(oldSkillBak);
      assert.strictEqual(
        path.resolve(path.dirname(oldSkillBak), linkTarget),
        path.resolve(externalDir),
        '備份的符號連結目標必須指向原始外部實體目錄'
      );
    } else {
      // Windows fallback 驗證
      const fallbackFile = `${oldSkillBak}.lnk_target`;
      assert.ok(fs.existsSync(fallbackFile), '在 Windows 無權限時，必須寫入 fallback 連結指示檔');
      const fallbackTarget = fs.readFileSync(fallbackFile, 'utf8');
      assert.strictEqual(
        path.resolve(fallbackTarget),
        path.resolve(externalDir),
        '指示檔記錄的目標必須指向原始外部實體目錄'
      );
    }

    console.log('✅ 測試情境 1 通過！');
  } finally {
    rmRfSync(sandbox);
  }
}

// ==========================================
// 測試情境 2：防止誤刪包含 .git 的本機開發專案
// ==========================================
async function testCase2GitProjectDefense() {
  console.log('\n--- 執行測試情境 2：防止誤刪包含 .git 的本機開發專案 ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case2-'));

  try {
    const mockHome = path.join(sandbox, 'mock-home');
    fs.mkdirSync(mockHome);

    const oldSkillDir = path.join(mockHome, '.gemini', 'skills', 'antigravity-cli-statusline');
    const oldSkillBak = path.join(mockHome, '.gemini', 'skills', 'antigravity-cli-statusline.bak');

    // 建立舊技能目錄（實體目錄），並寫入 .git 和模擬源碼檔案
    fs.mkdirSync(oldSkillDir, { recursive: true });
    fs.mkdirSync(path.join(oldSkillDir, '.git'), { recursive: true });
    const srcFileInDir = path.join(oldSkillDir, 'index.js');
    fs.writeFileSync(srcFileInDir, 'console.log("hello");', 'utf8');

    // 建立舊技能備份目錄（實體目錄），並寫入 .git 和模擬源碼檔案
    fs.mkdirSync(oldSkillBak, { recursive: true });
    fs.mkdirSync(path.join(oldSkillBak, '.git'), { recursive: true });
    const srcFileInBak = path.join(oldSkillBak, 'index.js');
    fs.writeFileSync(srcFileInBak, 'console.log("hello bak");', 'utf8');

    // 複製待測腳本到沙盒執行目錄
    const runDir = path.join(sandbox, 'run');
    const targetScript = path.join(runDir, 'configure-statusline.mjs');
    copyFileSync(configureScriptSrc, targetScript);
    copyFileSync(statuslineQuotaSrc, path.join(runDir, 'statusline-quota.mjs'));
    copyFileSync(fetchLocalQuotaSrc, path.join(runDir, 'fetch-local-quota.mjs'));

    const args = ['--lang', 'zh-tw', '--selected', '[]', '--order', '', '--workspace', sandbox];
    const env = {
      HOME: mockHome,
      USERPROFILE: mockHome
    };

    const result = await runScript(targetScript, args, env);
    console.log('Exit Code:', result.code);
    console.log('Stdout:', result.stdout);
    console.log('Stderr:', result.stderr);

    // 驗證執行中斷並拋出 [Security Violation] 錯誤
    assert.notStrictEqual(result.code, 0, '因為安全違規，腳本執行應該以非 0 狀態碼退出');
    assert.ok(
      result.stderr.includes('[Security Violation]') || result.stdout.includes('[Security Violation]'),
      '錯誤訊息必須包含 "[Security Violation]"'
    );

    // 驗證舊技能目錄與備份目錄依然完好存在，並未被刪除
    assert.ok(fs.existsSync(oldSkillDir), '舊技能目錄必須依然存在');
    assert.ok(fs.existsSync(path.join(oldSkillDir, '.git')), '舊技能目錄下的 .git 必須存在');
    assert.strictEqual(
      fs.readFileSync(srcFileInDir, 'utf8'),
      'console.log("hello");',
      '舊技能目錄下的原始碼檔案內容不可被修改或刪除'
    );

    assert.ok(fs.existsSync(oldSkillBak), '舊技能備份目錄必須依然存在');
    assert.ok(fs.existsSync(path.join(oldSkillBak, '.git')), '舊技能備份目錄下的 .git 必須存在');
    assert.strictEqual(
      fs.readFileSync(srcFileInBak, 'utf8'),
      'console.log("hello bak");',
      '舊技能備份目錄下的原始碼檔案內容不可被修改或刪除'
    );

    console.log('✅ 測試情境 2 通過！');
  } finally {
    rmRfSync(sandbox);
  }
}

// ==========================================
// 測試情境 3：保護 Git 工作區下的 questions.json
// ==========================================
async function testCase3QuestionsJsonDefense() {
  console.log('\n--- 執行測試情境 3：保護 Git 工作區下的 questions.json ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case3-'));

  try {
    const mockHome = path.join(sandbox, 'mock-home');
    fs.mkdirSync(mockHome);

    // 建立模擬的 Git 專案目錄
    const mockProject = path.join(sandbox, 'mock-project');
    fs.mkdirSync(mockProject);
    fs.mkdirSync(path.join(mockProject, '.git'), { recursive: true });

    // 在專案目錄下建立 questions.json
    const questionsJsonPath = path.join(mockProject, 'questions.json');
    fs.writeFileSync(questionsJsonPath, '{"test": true}', 'utf8');

    // 建立腳本存放目錄 mock-project/scripts
    const scriptDir = path.join(mockProject, 'scripts');
    fs.mkdirSync(scriptDir);

    // 複製待測腳本到 mock-project/scripts/
    const targetScript = path.join(scriptDir, 'configure-statusline.mjs');
    copyFileSync(configureScriptSrc, targetScript);
    copyFileSync(statuslineQuotaSrc, path.join(scriptDir, 'statusline-quota.mjs'));
    copyFileSync(fetchLocalQuotaSrc, path.join(scriptDir, 'fetch-local-quota.mjs'));

    const args = ['--lang', 'zh-tw', '--selected', '[]', '--order', '', '--workspace', mockProject];
    const env = {
      HOME: mockHome,
      USERPROFILE: mockHome
    };

    const result = await runScript(targetScript, args, env);
    console.log('Exit Code:', result.code);
    console.log('Stdout:', result.stdout);
    console.log('Stderr:', result.stderr);

    assert.strictEqual(result.code, 0, '腳本執行應該成功返回 0');
    assert.ok(
      result.stdout.includes('跳過刪除。此檔案是 Git 專案的一部分') || 
      result.stderr.includes('跳過刪除。此檔案是 Git 專案的一部分'),
      '輸出日誌應該說明跳過刪除 questions.json'
    );

    // 驗證 questions.json 依然存在且沒有被刪除
    assert.ok(fs.existsSync(questionsJsonPath), 'Git 工作區下的 questions.json 必須不被刪除');
    assert.strictEqual(
      fs.readFileSync(questionsJsonPath, 'utf8'),
      '{"test": true}',
      'questions.json 內容必須完整無缺'
    );

    console.log('✅ 測試情境 3 通過！');
  } finally {
    rmRfSync(sandbox);
  }
}

// ==========================================
// 測試情境 4：對抗性安全防禦測試
// ==========================================
async function testCase4SecuritySwallowDefense() {
  console.log('\n--- 執行測試情境 4：對抗性安全防禦測試 ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case4-'));
  
  try {
    const mockHome = path.join(sandbox, 'mock-home');
    fs.mkdirSync(mockHome);
    
    const runDir = path.join(sandbox, 'run');
    fs.mkdirSync(runDir, { recursive: true });
    
    // 在執行目錄下建立 questions.json 作為實體目錄
    const qPath = path.join(runDir, 'questions.json');
    fs.mkdirSync(qPath);
    
    // 根據平台建立能觸發非 ENOENT 例外的環境
    if (process.platform === 'win32') {
      // Windows 下建立超深目錄觸發 RangeError
      let current = qPath;
      for (let i = 0; i < 35; i++) {
        current = path.join(current, `sub_${i}`);
        fs.mkdirSync(current);
      }
    } else {
      // Unix 下建立權限不足的目錄觸發 EACCES
      const noAccessDir = path.join(qPath, 'no-access');
      fs.mkdirSync(noAccessDir);
      fs.chmodSync(noAccessDir, 0);
    }
    
    // 複製腳本
    const targetScript = path.join(runDir, 'configure-statusline.mjs');
    copyFileSync(configureScriptSrc, targetScript);
    copyFileSync(statuslineQuotaSrc, path.join(runDir, 'statusline-quota.mjs'));
    copyFileSync(fetchLocalQuotaSrc, path.join(runDir, 'fetch-local-quota.mjs'));
    
    const args = ['--lang', 'zh-tw', '--selected', '[]', '--order', '', '--workspace', sandbox];
    const env = {
      HOME: mockHome,
      USERPROFILE: mockHome
    };
    
    const result = await runScript(targetScript, args, env);
    console.log('Exit Code:', result.code);
    console.log('Stdout:', result.stdout);
    console.log('Stderr:', result.stderr);
    
    // 復原 Unix 權限以便清理沙盒
    if (process.platform !== 'win32') {
      try {
        const noAccessDir = path.join(qPath, 'no-access');
        fs.chmodSync(noAccessDir, 0o755);
      } catch (e) {}
    }
    
    // 驗證是否拋出非 ENOENT 的異常，並中斷移除
    const hasErrorLog = result.stdout.includes('移除 questions.json 失敗') || result.stderr.includes('移除 questions.json 失敗');
    assert.ok(hasErrorLog, '日誌中必須包含 "移除 questions.json 失敗" 的錯誤記錄');
    
    if (process.platform === 'win32') {
      assert.ok(
        result.stdout.includes('RangeError') || result.stderr.includes('RangeError'),
        '在 Windows 下必須拋出 RangeError 遞迴深度異常'
      );
    } else {
      assert.ok(
        result.stdout.includes('EACCES') || result.stderr.includes('EACCES') ||
        result.stdout.includes('RangeError') || result.stderr.includes('RangeError'),
        '在 Unix 下必須拋出 EACCES 權限異常或 RangeError 例外'
      );
    }
    
    // 驗證 questions.json 目錄依然完好，未被刪除
    assert.ok(fs.existsSync(qPath), '遭受安全異常時，必須停止刪除，questions.json 目錄應依然存在');
    
    console.log('✅ 測試情境 4 通過！');
  } finally {
    rmRfSync(sandbox);
  }
}

// ==========================================
// 測試情境 5：簡體中文 (zh-cn) 配置與大小寫歸一化測試
// ==========================================
async function testCase5SimplifiedChineseConfig() {
  console.log('\n--- 執行測試情境 5：簡體中文 (zh-cn) 配置與大小寫歸一化測試 ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case5-'));

  try {
    const mockHome = path.join(sandbox, 'mock-home');
    fs.mkdirSync(mockHome);

    const scriptDir = path.join(sandbox, 'run');
    fs.mkdirSync(scriptDir);
    const targetScript = path.join(scriptDir, 'configure-statusline.mjs');
    copyFileSync(configureScriptSrc, targetScript);
    copyFileSync(statuslineQuotaSrc, path.join(scriptDir, 'statusline-quota.mjs'));
    copyFileSync(fetchLocalQuotaSrc, path.join(scriptDir, 'fetch-local-quota.mjs'));

    const env = {
      HOME: mockHome,
      USERPROFILE: mockHome
    };

    // 1. 測試標準 zh-cn 參數
    const selected = '["当前使用的人工智能（AI）模型名称（model-name）","账号五小时可用额度百分比（quota）"]';
    const args1 = ['--lang', 'zh-cn', '--selected', selected, '--order', '1,2', '--workspace', sandbox];
    const res1 = await runScript(targetScript, args1, env);
    assert.strictEqual(res1.code, 0, 'zh-cn 配置腳本執行應該成功返回 0');

    const globalSettingsPath = path.join(mockHome, '.gemini', 'settings.json');
    const cliSettingsPath = path.join(mockHome, '.gemini', 'antigravity-cli', 'settings.json');

    const globalSettings1 = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    const cliSettings1 = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));

    assert.strictEqual(globalSettings1.ui.language, 'zh-cn', '全域 settings.ui.language 必須為 zh-cn');
    assert.strictEqual(cliSettings1.ui.language, 'zh-cn', 'CLI 專屬 settings.ui.language 必須為 zh-cn');
    assert.deepStrictEqual(globalSettings1.ui.footer.items, ['model-name', 'quota'], 'footer.items 指標識別碼必須正確提取');
    assert.strictEqual(globalSettings1.statusLine.enabled, true, 'statusLine.enabled 必須為 true');
    assert.strictEqual(globalSettings1.statusLine.type, 'command', 'statusLine.type 必須為 command');
    if (process.platform === 'win32') {
      assert.ok(globalSettings1.statusLine.command.startsWith('node '), 'Windows 平台必須使用 node 裸命令');
      assert.ok(globalSettings1.statusLine.command.startsWith('node "'), 'Windows 平台必須以 node " 開頭以雙引號保護腳本路徑');
      assert.ok(globalSettings1.statusLine.command.endsWith('.mjs"'), 'Windows 平台腳本路徑必須以雙引號結尾');
    } else {
      const expectedBin = process.execPath.includes(' ') ? `"${process.execPath}"` : process.execPath;
      assert.ok(globalSettings1.statusLine.command.startsWith(expectedBin), 'macOS / Linux 平台必須使用 process.execPath');
      assert.strictEqual(globalSettings1.statusLine.command.endsWith('.mjs'), true, '必須指向 .mjs 腳本');
    }

    // 2. 測試大小寫相容性：傳入大寫 zh-CN
    const args2 = ['--lang', 'zh-CN', '--selected', selected, '--order', '1,2', '--workspace', sandbox];
    const res2 = await runScript(targetScript, args2, env);
    assert.strictEqual(res2.code, 0, 'zh-CN 配置腳本執行應該成功返回 0');

    const globalSettings2 = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    assert.strictEqual(globalSettings2.ui.language, 'zh-cn', '大寫 zh-CN 必須自動歸一化為 zh-cn');

    // 3. 測試完整問卷選項標籤：傳入 "简体中文 (zh-cn)"
    const args3 = ['--lang', '简体中文 (zh-cn)', '--selected', selected, '--order', '1,2', '--workspace', sandbox];
    const res3 = await runScript(targetScript, args3, env);
    assert.strictEqual(res3.code, 0, '完整選項文字配置腳本執行應該成功返回 0');

    const globalSettings3 = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    assert.strictEqual(globalSettings3.ui.language, 'zh-cn', '問卷標籤 "简体中文 (zh-cn)" 必須自動歸一化為小寫代碼 zh-cn');

    // 4. 測試手動排序但未填 Write-in 之防禦退讓（避免清空狀態列）
    const args4 = ['--lang', 'zh-cn', '--selected', selected, '--order', '手动排序（请在下方“Write-in...”栏位中填写）', '--workspace', sandbox];
    const res4 = await runScript(targetScript, args4, env);
    assert.strictEqual(res4.code, 0, '未填 Write-in 配置腳本執行應該成功返回 0');

    const globalSettings4 = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    assert.deepStrictEqual(globalSettings4.ui.footer.items, ['model-name', 'quota'], '未填 Write-in 時必須防禦性安全退讓保留勾選項，禁止清空');

    console.log('✅ 測試情境 5 通過！');
  } finally {
    rmRfSync(sandbox);
  }
}

// ==========================================
// 測試情境 6：跨平台 Node.js 執行路徑與信任白名單相容性驗證
// ==========================================
async function testCase6CrossPlatformCommandAndTrustDefense() {
  console.log('\n--- 執行測試情境 6：跨平台 Node.js 執行路徑與信任白名單相容性驗證 ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case6-'));

  try {
    const mockHome = path.join(sandbox, 'mock-home with space');
    fs.mkdirSync(mockHome, { recursive: true });

    const scriptDir = path.join(sandbox, 'run');
    fs.mkdirSync(scriptDir, { recursive: true });
    const targetScript = path.join(scriptDir, 'configure-statusline.mjs');
    copyFileSync(configureScriptSrc, targetScript);
    copyFileSync(statuslineQuotaSrc, path.join(scriptDir, 'statusline-quota.mjs'));
    copyFileSync(fetchLocalQuotaSrc, path.join(scriptDir, 'fetch-local-quota.mjs'));

    const env = {
      HOME: mockHome,
      USERPROFILE: mockHome
    };

    const selected = '["model-name","quota"]';
    const args = ['--lang', 'zh-tw', '--selected', selected, '--order', '1,2', '--workspace', sandbox];
    const res = await runScript(targetScript, args, env);
    assert.strictEqual(res.code, 0, '配置腳本執行應該成功返回 0');

    const globalSettingsPath = path.join(mockHome, '.gemini', 'settings.json');
    const cliSettingsPath = path.join(mockHome, '.gemini', 'antigravity-cli', 'settings.json');
    const trustedHooksPath = path.join(mockHome, '.gemini', 'trusted_hooks.json');

    const globalSettings = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    const cliSettings = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));
    const trustedHooks = JSON.parse(fs.readFileSync(trustedHooksPath, 'utf8'));

    // 1. 驗證 statusLine 物件結構
    assert.strictEqual(globalSettings.statusLine.enabled, true, 'statusLine.enabled 必須為 true');
    assert.strictEqual(globalSettings.statusLine.type, 'command', 'statusLine.type 必須為 command');
    assert.strictEqual(cliSettings.statusLine.enabled, true, 'CLI 專屬層 statusLine.enabled 必須為 true');
    assert.strictEqual(cliSettings.statusLine.command, globalSettings.statusLine.command, '三層 statusLine.command 必須一致');

    const cmd = globalSettings.statusLine.command;
    if (process.platform === 'win32') {
      // Windows 必須以 node 裸命令開頭，並為含空格之路徑加上雙引號
      assert.ok(cmd.startsWith('node '), 'Windows 平台必須使用 node 裸命令以避免 cmd.exe 引號剝除與 bash 換行跳脫陷阱');
      assert.ok(cmd.includes('"'), '當路徑包含空格時，Windows 參數必須包含雙引號包裹');
    } else {
      // macOS / Linux 必須使用 process.execPath 絕對路徑以避免 NVM non-interactive shell 缺少 PATH (exit status 127)
      assert.ok(cmd.includes(process.execPath) || cmd.startsWith(process.execPath) || cmd.startsWith(`"${process.execPath}"`), 'macOS / Linux 必須使用 process.execPath 絕對路徑');
      assert.ok(cmd.includes('"'), '當路徑包含空格時，Unix 參數必須包含雙引號包裹');
    }

    // 2. 驗證 trusted_hooks.json 必須包含寫入 settings.json 的精確 command
    const exactTrustKey = `statusLine:${cmd}`;
    const allTrustEntries = [
      ...(trustedHooks[mockHome] || []),
      ...(trustedHooks['*'] || [])
    ];
    assert.ok(
      allTrustEntries.includes(exactTrustKey),
      `trusted_hooks.json 必須包含精確的信任字串: ${exactTrustKey}`
    );

    // 3. 驗證 trusted_hooks.json 包含歷史相容條目
    const hasLegacyOrPathEntry = allTrustEntries.some(e => e.includes('statusline-quota.mjs'));
    assert.ok(hasLegacyOrPathEntry, 'trusted_hooks.json 必須包含 statusline-quota.mjs 相關條目');

    console.log('✅ 測試情境 6 通過！');
  } finally {
    rmRfSync(sandbox);
  }
}

// ==========================================
// 測試情境 7：直接驗證 getStatusLineCommand 跨平台矩陣邏輯（Windows/macOS/Linux、空格/無空格/既有引號）
// ==========================================
async function testCase7DirectGetStatusLineCommandMatrix() {
  console.log('\n--- 執行測試情境 7：直接驗證 getStatusLineCommand 跨平台矩陣邏輯 ---');

  // 1. Windows (win32) 平台驗證
  // 1a. 無空格路徑：必須使用 node 裸命令且以雙引號包裹路徑（防範 Git Bash POSIX sh 反斜線剝除）
  const winCmd1 = getStatusLineCommand('C:\\Users\\andy\\.gemini\\hooks\\statusline-quota.mjs', 'win32');
  assert.strictEqual(
    winCmd1,
    'node "C:\\Users\\andy\\.gemini\\hooks\\statusline-quota.mjs"',
    'Windows 無空格路徑必須為 node 裸命令搭配雙引號'
  );

  // 1b. 含空格路徑：必須使用 node 裸命令且以雙引號包裹路徑（防範路徑空白被截斷）
  const winCmd2 = getStatusLineCommand('C:\\Users\\John Doe\\.gemini\\hooks\\statusline-quota.mjs', 'win32');
  assert.strictEqual(
    winCmd2,
    'node "C:\\Users\\John Doe\\.gemini\\hooks\\statusline-quota.mjs"',
    'Windows 含空格路徑必須為 node 裸命令搭配雙引號'
  );

  // 1c. 傳入已含雙引號之路徑：必須自動解除外層雙引號後標準化包裹，不可產生雙重引號 node ""...""
  const winCmd3 = getStatusLineCommand('"C:\\Users\\John Doe\\.gemini\\hooks\\statusline-quota.mjs"', 'win32');
  assert.strictEqual(
    winCmd3,
    'node "C:\\Users\\John Doe\\.gemini\\hooks\\statusline-quota.mjs"',
    'Windows 既有雙引號路徑必須正確規範化，不可產生雙重引號'
  );

  // 2. macOS (darwin) 平台驗證
  // 2a. Node 執行檔無空格、腳本無空格：直接以空格拼接
  const macCmd1 = getStatusLineCommand('/Users/andy/.gemini/hooks/statusline-quota.mjs', 'darwin', '/usr/local/bin/node');
  assert.strictEqual(
    macCmd1,
    '/usr/local/bin/node /Users/andy/.gemini/hooks/statusline-quota.mjs',
    'macOS 無空格環境直接以空格拼接'
  );

  // 2b. Node 執行檔無空格、腳本含空格：腳本加上雙引號
  const macCmd2 = getStatusLineCommand('/Users/John Doe/.gemini/hooks/statusline-quota.mjs', 'darwin', '/usr/local/bin/node');
  assert.strictEqual(
    macCmd2,
    '/usr/local/bin/node "/Users/John Doe/.gemini/hooks/statusline-quota.mjs"',
    'macOS 腳本含空格時必須加上雙引號'
  );

  // 2c. Node 執行檔含空格、腳本無空格：Node 執行檔加上雙引號
  const macCmd3 = getStatusLineCommand('/Users/andy/.gemini/hooks/statusline-quota.mjs', 'darwin', '/opt/home brew/bin/node');
  assert.strictEqual(
    macCmd3,
    '"/opt/home brew/bin/node" /Users/andy/.gemini/hooks/statusline-quota.mjs',
    'macOS Node 執行檔含空格時必須加上雙引號'
  );

  // 2d. Node 執行檔含空格、腳本含空格：兩者皆加上雙引號
  const macCmd4 = getStatusLineCommand('/Users/John Doe/.gemini/hooks/statusline-quota.mjs', 'darwin', '/opt/home brew/bin/node');
  assert.strictEqual(
    macCmd4,
    '"/opt/home brew/bin/node" "/Users/John Doe/.gemini/hooks/statusline-quota.mjs"',
    'macOS 兩者皆含空格時皆須加上雙引號'
  );

  // 2e. 既有雙引號傳入：不可雙重包裹
  const macCmd5 = getStatusLineCommand('"/Users/John Doe/.gemini/hooks/statusline-quota.mjs"', 'darwin', '/usr/local/bin/node');
  assert.strictEqual(
    macCmd5,
    '/usr/local/bin/node "/Users/John Doe/.gemini/hooks/statusline-quota.mjs"',
    'macOS 既有雙引號不可雙重包裹'
  );

  // 3. Linux 平台驗證
  const linuxCmd = getStatusLineCommand('/home/user with space/.gemini/hooks/statusline-quota.mjs', 'linux', '/usr/bin/node');
  assert.strictEqual(
    linuxCmd,
    '/usr/bin/node "/home/user with space/.gemini/hooks/statusline-quota.mjs"',
    'Linux 平台行為必須與 Unix 一致'
  );

  console.log('✅ 測試情境 7 通過！');
}

// ==========================================
// 執行所有測試
// ==========================================
async function runAllTests() {
  try {
    await testCase1SymlinkDefense();
    await testCase2GitProjectDefense();
    await testCase3QuestionsJsonDefense();
    await testCase4SecuritySwallowDefense();
    await testCase5SimplifiedChineseConfig();
    await testCase6CrossPlatformCommandAndTrustDefense();
    await testCase7DirectGetStatusLineCommandMatrix();
    console.log('\n🎉 所有跨平台整合測試皆已成功通過！');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 測試執行失敗:', error);
    process.exit(1);
  }
}

runAllTests();

