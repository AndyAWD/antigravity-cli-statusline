import fs from 'fs';
import path from 'path';
import assert from 'assert';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getStatusLineCommand, parseOrderAndStyles } from './configure-statusline.mjs';

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
      assert.ok(!globalSettings1.statusLine.command.includes('"'), 'Windows 平台絕對禁止包含雙引號（防止 Go exec.Command("cmd", "/c", command) 將引號轉義為 \\" 導致模組載入失敗）');
      const cmdExec1 = spawnSync('cmd', ['/c', globalSettings1.statusLine.command], {
        input: JSON.stringify({ model: { display_name: 'CmdTestModel' } }),
        encoding: 'utf8',
        env: { ...process.env, HOME: mockHome, USERPROFILE: mockHome }
      });
      assert.strictEqual(cmdExec1.status, 0, `Windows cmd /c 執行狀態列指令必須成功返回 0 (stderr: ${cmdExec1.stderr})`);
      assert.ok(cmdExec1.stdout.includes('CmdTestModel'), 'Windows cmd /c 執行狀態列指令必須正常輸出模型名稱');
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

    // 5. 測試 --selected 為空陣列時防禦退讓至核心標準指標（避免寫入空陣列清空狀態列）
    const args5 = ['--lang', 'zh-cn', '--selected', '[]', '--order', '1,2', '--workspace', sandbox];
    const res5 = await runScript(targetScript, args5, env);
    assert.strictEqual(res5.code, 0, '空 --selected 配置腳本執行應該成功返回 0');

    const globalSettings5 = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    assert.deepStrictEqual(globalSettings5.ui.footer.items, ['model-name', 'quota', 'context-used', 'memory-usage'], '空 selected 必須安全退讓至預設核心指標，禁止寫入空陣列');

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
      // Windows 在路徑包含空格時必須以 node --import file:///... -e 0 執行，且絕對不包含雙引號
      assert.ok(cmd.startsWith('node --import file:///'), '當路徑包含空格時，Windows 必須使用 node --import file:///... -e 0');
      assert.ok(cmd.endsWith('.mjs -e 0'), '當路徑包含空格時，Windows 指令必須以 .mjs -e 0 結尾');
      assert.ok(cmd.includes('%20'), '當路徑包含空格時，file:/// URL 必須將空格編碼為 %20');
      assert.ok(!cmd.includes('"'), 'Windows 平台絕對禁止包含雙引號（防止 Go exec.Command("cmd", "/c", command) 將引號轉義為 \\" 導致模組載入失敗）');

      const cmdExec = spawnSync('cmd', ['/c', cmd], {
        input: JSON.stringify({ model: { display_name: 'SpacePathModel' } }),
        encoding: 'utf8',
        env: { ...process.env, HOME: mockHome, USERPROFILE: mockHome }
      });
      assert.strictEqual(cmdExec.status, 0, `Windows cmd /c 執行含空格路徑狀態列指令必須成功返回 0 (stderr: ${cmdExec.stderr})`);
      assert.ok(cmdExec.stdout.includes('SpacePathModel'), 'Windows cmd /c 執行含空格路徑狀態列指令必須正常輸出模型名稱');
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
  // 1a. 無空格路徑：必須使用 node 裸命令且「不含雙引號」（防範 Go exec.Command("cmd", "/c", command) 將雙引號轉義為 \" 造成 Node.js 模組載入失敗）
  const winCmd1 = getStatusLineCommand('C:\\Users\\andy\\.gemini\\hooks\\statusline-quota.mjs', 'win32');
  assert.strictEqual(
    winCmd1,
    'node C:\\Users\\andy\\.gemini\\hooks\\statusline-quota.mjs',
    'Windows 無空格路徑必須為無雙引號的 node 裸命令'
  );

  // 1b. 含空格路徑：必須使用 node --import file:///... -e 0（同時無雙引號且無未編碼空格，完美相容 cmd /c 與 sh.exe -c）
  const winCmd2 = getStatusLineCommand('C:\\Users\\John Doe\\.gemini\\hooks\\statusline-quota.mjs', 'win32');
  assert.strictEqual(
    winCmd2,
    'node --import file:///C:/Users/John%20Doe/.gemini/hooks/statusline-quota.mjs -e 0',
    'Windows 含空格路徑必須轉換為無雙引號的 node --import file:///... -e 0'
  );

  // 1c. 傳入已含雙引號之路徑：必須自動剝除外層雙引號後依規則產生無雙引號指令
  const winCmd3 = getStatusLineCommand('"C:\\Users\\John Doe\\.gemini\\hooks\\statusline-quota.mjs"', 'win32');
  assert.strictEqual(
    winCmd3,
    'node --import file:///C:/Users/John%20Doe/.gemini/hooks/statusline-quota.mjs -e 0',
    'Windows 既有雙引號含空格路徑必須正確剝除引號並轉為 file:/// URL'
  );
  const winCmd4 = getStatusLineCommand('"C:\\Users\\andy\\.gemini\\hooks\\statusline-quota.mjs"', 'win32');
  assert.strictEqual(
    winCmd4,
    'node C:\\Users\\andy\\.gemini\\hooks\\statusline-quota.mjs',
    'Windows 既有雙引號無空格路徑必須正確剝除雙引號'
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
// 測試情境 8：驗證 questions.json 新增指標識別碼解析與配置整合
// ==========================================
async function testCase8QuestionsJsonMetricIds() {
  console.log('\n--- 執行測試情境 8：驗證 questions.json 新增指標識別碼解析與配置整合 ---');
  const questionsPath = path.join(originalScriptsDir, '..', 'resources', 'questions.json');
  assert.ok(fs.existsSync(questionsPath), 'resources/questions.json 必須存在');

  const questionsData = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));
  const languages = ['zh-tw', 'zh-cn', 'us', 'jp'];
  const expectedNewIds = [
    'quota-reset-time',
    'quota-weekly-reset-time',
    'quota-bar',
    'quota-weekly-bar',
    'context-used-bar',
    'token-count-bar',
    'quota-argon',
    'quota-argon-bar',
    'quota-argon-countdown',
    'quota-argon-reset-time'
  ];

  for (const lang of languages) {
    const langData = questionsData[lang];
    assert.ok(langData, `${lang} 語系資料必須存在`);
    assert.ok(Array.isArray(langData.options), `${lang}.options 必須為陣列`);
    assert.strictEqual(langData.options.length, 36, `${lang}.options 必須包含全部 36 個指標選項`);

    const extractedIds = langData.options.map(item => {
      const match = item.match(/[\(（]([^）\)]+)[\)）]$/);
      return match ? match[1] : item;
    });

    const uniqueIds = new Set(extractedIds);
    assert.strictEqual(uniqueIds.size, 36, `${lang} 的所有指標識別碼必須不重複`);

    for (const newId of expectedNewIds) {
      assert.ok(uniqueIds.has(newId), `${lang} 必須包含新指標 ID: "${newId}"`);
    }
  }

  // 測試透過 configure-statusline.mjs 配置新指標
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case8-'));
  try {
    const selected = JSON.stringify([
      "五小時重置時間（quota-reset-time）",
      "五小時可用額度長條圖（quota-bar）",
      "每週重置時間（quota-weekly-reset-time）",
      "每週可用額度長條圖（quota-weekly-bar）",
      "脈絡用量長條圖（context-used-bar）",
      "權杖數長條圖（token-count-bar）"
    ]);

    const args = ['--lang', 'zh-tw', '--selected', selected, '--order', '1,2,3,4,5,6', '--workspace', sandbox, '--time-format', 'smart', '--bar-length', '12'];
    const env = { HOME: sandbox, USERPROFILE: sandbox };
    const result = await runScript(configureScriptSrc, args, env);
    assert.strictEqual(result.code, 0, '配置腳本必須成功執行');

    const cliSettingsPath = path.join(sandbox, '.gemini', 'antigravity-cli', 'settings.json');
    assert.ok(fs.existsSync(cliSettingsPath), 'CLI 專屬設定檔必須產生');
    const cliSettings = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));

    const expectedOrderedIds = [
      'quota-reset-time',
      'quota-bar',
      'quota-weekly-reset-time',
      'quota-weekly-bar',
      'context-used-bar',
      'token-count-bar'
    ];

    assert.deepStrictEqual(
      cliSettings.ui.footer.items,
      expectedOrderedIds,
      '設定檔中的 footer.items 必須正確解析為新指標的英文識別碼'
    );
    assert.strictEqual(cliSettings.ui.footer.timeFormat, 'smart', '設定檔中的 footer.timeFormat 必須正確寫入');
    assert.strictEqual(cliSettings.ui.footer.barLength, 12, '設定檔中的 footer.barLength 必須正確寫入');
    assert.strictEqual(cliSettings.ui.footer.labelStyle, 'text', '未傳入 --style 時預設應寫入 labelStyle: "text"');
  } finally {
    rmRfSync(sandbox);
  }

  console.log('✅ 測試情境 8 通過！');
}

// ==========================================
// 測試情境 9：驗證標籤顯示樣式（--style text / emoji）與 questions.json style_options
// ==========================================
async function testCase9LabelStyleConfig() {
  console.log('\n--- 執行測試情境 9：驗證標籤顯示樣式（--style text / emoji）與 questions.json style_options ---');
  const questionsPath = path.join(originalScriptsDir, '..', 'resources', 'questions.json');
  const questionsData = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));

  for (const lang of ['zh-tw', 'zh-cn', 'us', 'jp']) {
    const langData = questionsData[lang];
    assert.ok(typeof langData.style_question === 'string' && langData.style_question.length > 0, `${lang}.style_question 必須為非空字串`);
    assert.ok(Array.isArray(langData.style_options) && langData.style_options.length === 2, `${lang}.style_options 必須包含 2 個選項`);
  }

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case9-'));
  try {
    const selected = JSON.stringify([
      "🤖 目前使用的人工智慧（AI）模型名稱（model-name）",
      "🔋 帳號五小時可用額度百分比（quota）"
    ]);

    // 1. 傳入完整問卷選項字串（含 emoji 識別碼）
    const argsEmoji = [
      '--lang', 'zh-tw',
      '--style', 'Emoji 圖示（例如：🤖 Gemini 3.1 Pro）（emoji）',
      '--selected', selected,
      '--order', '1,2',
      '--workspace', sandbox
    ];
    const env = { HOME: sandbox, USERPROFILE: sandbox };
    const resEmoji = await runScript(configureScriptSrc, argsEmoji, env);
    assert.strictEqual(resEmoji.code, 0, '傳入 --style emoji 選項時配置腳本必須成功執行');

    const cliSettingsPath = path.join(sandbox, '.gemini', 'antigravity-cli', 'settings.json');
    const globalSettingsPath = path.join(sandbox, '.gemini', 'settings.json');
    const cliSettings1 = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));
    const globalSettings1 = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));

    assert.strictEqual(cliSettings1.ui.footer.labelStyle, 'emoji', 'CLI 設定檔必須寫入 labelStyle: "emoji"');
    assert.strictEqual(globalSettings1.ui.footer.labelStyle, 'emoji', '全域設定檔必須同步寫入 labelStyle: "emoji"');
    assert.deepStrictEqual(cliSettings1.ui.footer.items, ['model-name', 'quota']);

    // 2. 傳入文字標籤選項切換回 text
    const argsText = [
      '--lang', 'zh-tw',
      '--style', '文字標籤（例如：模型: Gemini 3.1 Pro）（text）',
      '--selected', selected,
      '--order', '1,2',
      '--workspace', sandbox
    ];
    const resText = await runScript(configureScriptSrc, argsText, env);
    assert.strictEqual(resText.code, 0, '傳入 --style text 選項時配置腳本必須成功執行');

    const cliSettings2 = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));
    assert.strictEqual(cliSettings2.ui.footer.labelStyle, 'text', 'CLI 設定檔必須更新為 labelStyle: "text"');

    // 3. 若未提供 --style，且原先無 labelStyle 時，預設回退為 text
    const sandbox2 = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case9-default-'));
    try {
      const argsNoStyle = [
        '--lang', 'zh-tw',
        '--selected', selected,
        '--order', '1,2',
        '--workspace', sandbox2
      ];
      const env2 = { HOME: sandbox2, USERPROFILE: sandbox2 };
      const resNoStyle = await runScript(configureScriptSrc, argsNoStyle, env2);
      assert.strictEqual(resNoStyle.code, 0, '未傳入 --style 時配置腳本必須成功執行');
      const cliSettings3 = JSON.parse(fs.readFileSync(path.join(sandbox2, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8'));
      assert.strictEqual(cliSettings3.ui.footer.labelStyle, 'text', '未傳入 --style 時預設寫入 labelStyle: "text"');
    } finally {
      rmRfSync(sandbox2);
    }
  } finally {
    rmRfSync(sandbox);
  }

  console.log('✅ 測試情境 9 通過！');
}

// ==========================================
// 測試情境 10：五大分類頁籤結構、無冗餘雙括號與排序前綴單元測試
// ==========================================
async function testCase10FiveCategoryTabsAndParenthesisDefense() {
  console.log('\n--- 執行測試情境 10：五大分類頁籤結構、無冗餘雙括號與排序前綴單元測試 ---');
  const questionsPath = path.join(originalScriptsDir, '..', 'resources', 'questions.json');
  const questionsData = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));

  const expectedCategories = [
    { id: 'model-and-agent', count: 4 },
    { id: 'quota-and-billing', count: 14 },
    { id: 'context-and-tokens', count: 4 },
    { id: 'workspace-and-vcs', count: 5 },
    { id: 'system-and-tasks', count: 9 }
  ];

  for (const lang of ['zh-tw', 'zh-cn', 'us', 'jp']) {
    const langData = questionsData[lang];
    assert.ok(Array.isArray(langData.categories), `${lang}.categories 必須為陣列`);
    assert.strictEqual(langData.categories.length, 5, `${lang}.categories 必須剛好包含 5 個分類頁籤`);

    let totalOptions = 0;
    const catOptionsFlat = [];
    for (let i = 0; i < expectedCategories.length; i++) {
      const cat = langData.categories[i];
      assert.strictEqual(cat.id, expectedCategories[i].id, `${lang} 分類 ${i} ID 必須為 ${expectedCategories[i].id}`);
      assert.ok(typeof cat.name === 'string' && cat.name.length > 0, `${lang} 分類 ${cat.id} name 必須為非空字串`);
      assert.ok(typeof cat.question === 'string' && cat.question.length > 0, `${lang} 分類 ${cat.id} question 必須為非空字串`);
      assert.ok(Array.isArray(cat.options), `${lang} 分類 ${cat.id} options 必須為陣列`);
      assert.strictEqual(cat.options.length, expectedCategories[i].count, `${lang} 分類 ${cat.id} 必須包含 ${expectedCategories[i].count} 項指標`);
      totalOptions += cat.options.length;
      catOptionsFlat.push(...cat.options);
    }
    assert.strictEqual(totalOptions, 36, `${lang} 分類中的指標總和必須剛好為 36 項`);
    assert.deepStrictEqual(catOptionsFlat, langData.options, `${lang} 平坦 options 必須與 5 大分類彙整選項完全一致`);

    // 驗證雙括號清理需求：各選項中僅允許末尾唯一的英文識別碼括號，不得含有額外說明括號
    for (const opt of langData.options) {
      const openParens = (opt.match(/[\(（]/g) || []).length;
      const closeParens = (opt.match(/[\)）]/g) || []).length;
      assert.strictEqual(openParens, 1, `${lang} 選項不可含有多重括號: "${opt}"`);
      assert.strictEqual(closeParens, 1, `${lang} 選項不可含有多重括號: "${opt}"`);
      assert.ok(opt.match(/[\(（][a-z0-9\-_]+[\)）]$/), `${lang} 選項末尾必須為英文識別碼括號: "${opt}"`);
      // 確保特定冗餘詞已移除
      assert.ok(!opt.includes('（Context）') && !opt.includes('(Context)'), `${lang} 不得包含 (Context) 括號說明: "${opt}"`);
      assert.ok(!opt.includes('(git / jj / fig)') && !opt.includes('（git / jj / fig）'), `${lang} 不得包含 (git / jj / fig) 括號說明: "${opt}"`);
      assert.ok(!opt.includes('（AI）') && !opt.includes('(AI)'), `${lang} 不得包含 (AI) 括號說明: "${opt}"`);
      assert.ok(!opt.includes('（Agent State）'), `${lang} 不得包含 (Agent State) 括號說明: "${opt}"`);
    }
  }

  // 驗證 parseOrderAndStyles 單元邏輯
  const testIds = ['model-name', 'quota', 'context-used', 'git-branch', 'memory-usage'];
  
  // 1. 預設/略過排序：全部為 text，itemStyles 為空物件
  const resSkip = parseOrderAndStyles('略過，使用原勾選順序啟用全部指標（預設文字樣式）', testIds);
  assert.deepStrictEqual(resSkip.items, testIds);
  assert.deepStrictEqual(resSkip.itemStyles, {});
  assert.deepStrictEqual(parseOrderAndStyles('(Recommended) 略過', testIds).items, testIds);
  assert.deepStrictEqual(parseOrderAndStyles('Skip', testIds).items, testIds);
  assert.deepStrictEqual(parseOrderAndStyles('スキップ', testIds).items, testIds);

  // 2. 混合前綴（純數字=text、t前綴=text、e前綴=emoji、英文ID前綴、換行）
  const resMixed = parseOrderAndStyles('e1, 2, t3, e:git-branch, n, e:memory-usage', testIds);
  assert.deepStrictEqual(resMixed.items, ['model-name', 'quota', 'context-used', 'git-branch', 'n', 'memory-usage']);
  assert.deepStrictEqual(resMixed.itemStyles, {
    'model-name': 'emoji',
    'git-branch': 'emoji',
    'memory-usage': 'emoji'
  });

  // 3. 大小寫相容性與無空格前綴
  const resCase = parseOrderAndStyles('E1, T2, E:CONTEXT-USED', testIds);
  assert.deepStrictEqual(resCase.items, ['model-name', 'quota', 'context-used']);
  assert.deepStrictEqual(resCase.itemStyles, {
    'model-name': 'emoji',
    'context-used': 'emoji'
  });

  // 4. 空格前綴相容性（e: quota, e: 1, e 1, e quota, t: quota, t 1, t quota）
  const resSpaces = parseOrderAndStyles('e: quota, 1, e: git-branch', testIds);
  assert.deepStrictEqual(resSpaces.items, ['quota', 'model-name', 'git-branch']);
  assert.deepStrictEqual(resSpaces.itemStyles, {
    'quota': 'emoji',
    'git-branch': 'emoji'
  });

  const resSpacePrefixNum = parseOrderAndStyles('e 1, t 2, e: 3', testIds);
  assert.deepStrictEqual(resSpacePrefixNum.items, ['model-name', 'quota', 'context-used']);
  assert.deepStrictEqual(resSpacePrefixNum.itemStyles, {
    'model-name': 'emoji',
    'context-used': 'emoji'
  });

  // 5. 全形字元、全形標點符號與頓號（１，２，３ / ｅ：ｑｕｏｔａ / ３、２、１）
  const resFullWidthDigits = parseOrderAndStyles('３，２，１', testIds);
  assert.deepStrictEqual(resFullWidthDigits.items, ['context-used', 'quota', 'model-name']);
  assert.deepStrictEqual(resFullWidthDigits.itemStyles, {});

  const resFullWidthEmoji = parseOrderAndStyles('ｅ：ｑｕｏｔａ，１，ｅ：ｇｉｔ－ｂｒａｎｃｈ', testIds);
  assert.deepStrictEqual(resFullWidthEmoji.items, ['quota', 'model-name', 'git-branch']);
  assert.deepStrictEqual(resFullWidthEmoji.itemStyles, {
    'quota': 'emoji',
    'git-branch': 'emoji'
  });

  const resIdeographicComma = parseOrderAndStyles('1、2、3', testIds);
  assert.deepStrictEqual(resIdeographicComma.items, ['model-name', 'quota', 'context-used']);

  // 6. 純空格分隔（無逗號，如 2 1 3 或 e1 t2 e3）
  const resSpaceList = parseOrderAndStyles('2 1 3', testIds);
  assert.deepStrictEqual(resSpaceList.items, ['quota', 'model-name', 'context-used']);

  const resSpaceListEmoji = parseOrderAndStyles('e1 t2 e3', testIds);
  assert.deepStrictEqual(resSpaceListEmoji.items, ['model-name', 'quota', 'context-used']);
  assert.deepStrictEqual(resSpaceListEmoji.itemStyles, {
    'model-name': 'emoji',
    'context-used': 'emoji'
  });

  // 7. 全域 1-36 指標序號回退（當 selectedIds 僅為子集，使用者輸入全域序號 25 代表 git-branch）
  const subsetIds = ['model-name', 'git-branch']; // length = 2, git-branch 在 36 項中為第 25 項
  const resGlobalFallback = parseOrderAndStyles('1, e25', subsetIds);
  assert.deepStrictEqual(resGlobalFallback.items, ['model-name', 'git-branch']);
  assert.deepStrictEqual(resGlobalFallback.itemStyles, {
    'git-branch': 'emoji'
  });

  // 8. 貼上帶點號或完整選項文字的強健性（包含多行貼上、帶前綴貼上、尾隨標點）
  const resDotted = parseOrderAndStyles('1., e2.', testIds);
  assert.deepStrictEqual(resDotted.items, ['model-name', 'quota']);
  assert.deepStrictEqual(resDotted.itemStyles, { 'quota': 'emoji' });

  const resColonDotted = parseOrderAndStyles('e:1. e:2. e:3.', testIds);
  assert.deepStrictEqual(resColonDotted.items, ['model-name', 'quota', 'context-used']);
  assert.deepStrictEqual(resColonDotted.itemStyles, {
    'model-name': 'emoji',
    'quota': 'emoji',
    'context-used': 'emoji'
  });

  const resHyphenDotted = parseOrderAndStyles('e-1. e-2.', testIds);
  assert.deepStrictEqual(resHyphenDotted.items, ['model-name', 'quota']);
  assert.deepStrictEqual(resHyphenDotted.itemStyles, {
    'model-name': 'emoji',
    'quota': 'emoji'
  });

  const resPastedText = parseOrderAndStyles('2. 🔋 帳號五小時可用額度百分比（quota）', testIds);
  assert.deepStrictEqual(resPastedText.items, ['quota']);

  // 9. 貼上帶前綴之多行或逗號完整選項文字
  const multilinePasted = `e: 1. 🤖 目前使用的人工智慧模型名稱（model-name）\n2. 🔋 帳號五小時可用額度百分比（quota）`;
  const resMultilinePasted = parseOrderAndStyles(multilinePasted, testIds);
  assert.deepStrictEqual(resMultilinePasted.items, ['model-name', 'quota']);
  assert.deepStrictEqual(resMultilinePasted.itemStyles, { 'model-name': 'emoji' });

  const commaPastedWithPrefix = 'e1. 🤖 目前使用的人工智慧模型名稱（model-name）, 2. 🔋 帳號五小時可用額度百分比（quota）';
  const resCommaPasted = parseOrderAndStyles(commaPastedWithPrefix, testIds);
  assert.deepStrictEqual(resCommaPasted.items, ['model-name', 'quota']);
  assert.deepStrictEqual(resCommaPasted.itemStyles, { 'model-name': 'emoji' });

  // 10. 英文標識符帶尾隨標點與無效標識符容錯
  const resTrailingDotsOnIds = parseOrderAndStyles('e:quota. e:model-name.', testIds);
  assert.deepStrictEqual(resTrailingDotsOnIds.items, ['quota', 'model-name']);
  assert.deepStrictEqual(resTrailingDotsOnIds.itemStyles, {
    'quota': 'emoji',
    'model-name': 'emoji'
  });

  const resInvalidIdFallback = parseOrderAndStyles('e:non-existent, e:quota', testIds);
  assert.deepStrictEqual(resInvalidIdFallback.items, ['quota']);
  assert.deepStrictEqual(resInvalidIdFallback.itemStyles, { 'quota': 'emoji' });

  // 11. 跨分類部分勾選（例如分類 2、3、5 完全未勾選，僅勾選分類 1 與 4 之項目）
  const sparseSelected = ['model-name', 'git-branch']; // 僅 2 項，排序時依序為 1 與 2
  const resSparse = parseOrderAndStyles('e1, 2', sparseSelected);
  assert.deepStrictEqual(resSparse.items, ['model-name', 'git-branch']);
  assert.deepStrictEqual(resSparse.itemStyles, { 'model-name': 'emoji' });

  console.log('✅ 測試情境 10 通過！');
}

// ==========================================
// 測試情境 11：驗證 configure-statusline.mjs 個別樣式寫入 settings.json (ui.footer.itemStyles)
// ==========================================
async function testCase11ItemStylesPrefixAndConfig() {
  console.log('\n--- 執行測試情境 11：驗證個別樣式寫入 settings.json (ui.footer.itemStyles) ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case11-'));

  try {
    const selected = JSON.stringify([
      "🤖 目前使用的人工智慧模型名稱（model-name）",
      "🔋 帳號五小時可用額度百分比（quota）",
      "🔀 目前工作區專案的 Git 分支（git-branch）"
    ]);

    // 1. 執行帶有 emoji 前綴 (e1, 2, e:git-branch) 的排序
    const args1 = [
      '--lang', 'zh-tw',
      '--selected', selected,
      '--order', 'e1, 2, e:git-branch',
      '--workspace', sandbox
    ];
    const env = { HOME: sandbox, USERPROFILE: sandbox };
    const res1 = await runScript(configureScriptSrc, args1, env);
    assert.strictEqual(res1.code, 0, '配置腳本執行必須返回 0');

    const cliSettingsPath = path.join(sandbox, '.gemini', 'antigravity-cli', 'settings.json');
    const globalSettingsPath = path.join(sandbox, '.gemini', 'settings.json');
    assert.ok(fs.existsSync(cliSettingsPath), 'CLI 專屬設定檔必須產生');

    const cliSettings1 = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));
    const globalSettings1 = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));

    assert.deepStrictEqual(cliSettings1.ui.footer.items, ['model-name', 'quota', 'git-branch'], 'footer.items 必須保持乾淨英文識別碼');
    assert.deepStrictEqual(cliSettings1.ui.footer.itemStyles, {
      'model-name': 'emoji',
      'git-branch': 'emoji'
    }, 'footer.itemStyles 必須記錄個別 emoji 覆寫，未設定之 quota 強制為預設文字樣式');
    assert.deepStrictEqual(globalSettings1.ui.footer.itemStyles, cliSettings1.ui.footer.itemStyles, '全域與 CLI 專屬設定檔之 itemStyles 必須同步');

    // 2. 測試略過排序：itemStyles 必須為空物件
    const args2 = [
      '--lang', 'zh-tw',
      '--selected', selected,
      '--order', '略過，使用原勾選順序啟用全部指標（預設文字樣式）',
      '--workspace', sandbox
    ];
    const res2 = await runScript(configureScriptSrc, args2, env);
    assert.strictEqual(res2.code, 0, '略過排序配置腳本執行必須返回 0');

    const cliSettings2 = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));
    assert.deepStrictEqual(cliSettings2.ui.footer.items, ['model-name', 'quota', 'git-branch']);
    assert.deepStrictEqual(cliSettings2.ui.footer.itemStyles, {}, '略過排序時 itemStyles 必須為空物件');

    // 3. 測試全形字元與帶空格前綴之 E2E 執行：'ｅ：ｑｕｏｔａ， 1 ， e: git-branch'
    const args3 = [
      '--lang', 'zh-tw',
      '--selected', selected,
      '--order', 'ｅ：ｑｕｏｔａ， 1 ， e: git-branch',
      '--workspace', sandbox
    ];
    const res3 = await runScript(configureScriptSrc, args3, env);
    assert.strictEqual(res3.code, 0, '全形字元排序配置腳本執行必須返回 0');

    const cliSettings3 = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));
    assert.deepStrictEqual(cliSettings3.ui.footer.items, ['quota', 'model-name', 'git-branch']);
    assert.deepStrictEqual(cliSettings3.ui.footer.itemStyles, {
      'quota': 'emoji',
      'git-branch': 'emoji'
    }, '全形字元與空格前綴必須正確解析寫入 itemStyles');

    console.log('✅ 測試情境 11 通過！');
  } finally {
    rmRfSync(sandbox);
  }
}

// ==========================================
// 測試情境 12：驗證純數字或略過排序且舊 labelStyle 為 emoji 時，覆寫重置為 text
// ==========================================
async function testCase12PureNumbersOverwritesResidualEmojiStyle() {
  console.log('\n--- 執行測試情境 12：驗證純數字與略過排序時覆寫舊有 labelStyle 為 text ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case12-'));

  try {
    const cliSettingsPath = path.join(sandbox, '.gemini', 'antigravity-cli', 'settings.json');
    const globalSettingsPath = path.join(sandbox, '.gemini', 'settings.json');
    const projectGeminiDir = path.join(sandbox, '.gemini');
    const projectSettingsPath = path.join(projectGeminiDir, 'settings.json');
    fs.mkdirSync(path.dirname(cliSettingsPath), { recursive: true });

    // 預先寫入舊有 "labelStyle": "emoji" 設定，並包含遺留 style 屬性
    const oldConfig = {
      ui: {
        language: 'zh-tw',
        footer: {
          labelStyle: 'emoji',
          style: 'emoji',
          items: ['model-name', 'quota'],
          itemStyles: { 'model-name': 'emoji' }
        }
      }
    };
    fs.writeFileSync(cliSettingsPath, JSON.stringify(oldConfig, null, 2), 'utf8');
    fs.writeFileSync(globalSettingsPath, JSON.stringify(oldConfig, null, 2), 'utf8');
    fs.writeFileSync(projectSettingsPath, JSON.stringify(oldConfig, null, 2), 'utf8');

    const selected = JSON.stringify([
      "🤖 目前使用的人工智慧模型名稱（model-name）",
      "🔋 帳號五小時可用額度百分比（quota）",
      "🔀 目前工作區專案的 Git 分支（git-branch）"
    ]);

    // 1. 使用者在步驟 4 輸入純數字排序（未傳入 --style）
    const args1 = [
      '--lang', 'zh-tw',
      '--selected', selected,
      '--order', '2, 1, 3',
      '--workspace', sandbox
    ];
    const env = { HOME: sandbox, USERPROFILE: sandbox };
    const res1 = await runScript(configureScriptSrc, args1, env);
    assert.strictEqual(res1.code, 0, '配置腳本執行必須返回 0');

    const cliSettings1 = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));
    const globalSettings1 = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    const projectSettings1 = JSON.parse(fs.readFileSync(projectSettingsPath, 'utf8'));

    assert.strictEqual(cliSettings1.ui.footer.labelStyle, 'text', '未傳入 --style 時，舊有 labelStyle: emoji 必須被重置覆寫為 text');
    assert.strictEqual(globalSettings1.ui.footer.labelStyle, 'text', '全域設定檔的 labelStyle 亦必須被重置為 text');
    assert.strictEqual(projectSettings1.ui.footer.labelStyle, 'text', '專案設定檔的 labelStyle 亦必須被重置為 text');
    assert.strictEqual(cliSettings1.ui.footer.style, undefined, '舊有遺留 style 屬性必須被清除');
    assert.deepStrictEqual(cliSettings1.ui.footer.itemStyles, {}, '純數字排序時 itemStyles 必須為空物件 {}');
    assert.deepStrictEqual(cliSettings1.ui.footer.items, ['quota', 'model-name', 'git-branch']);

    // 2. 測試預先存在 labelStyle: emoji 時，使用者選擇「略過排序」亦必須重置為 text
    fs.writeFileSync(cliSettingsPath, JSON.stringify(oldConfig, null, 2), 'utf8');
    fs.writeFileSync(globalSettingsPath, JSON.stringify(oldConfig, null, 2), 'utf8');
    fs.writeFileSync(projectSettingsPath, JSON.stringify(oldConfig, null, 2), 'utf8');

    const args2 = [
      '--lang', 'zh-tw',
      '--selected', selected,
      '--order', '略過，使用原勾選順序啟用全部指標（預設文字樣式）',
      '--workspace', sandbox
    ];
    const res2 = await runScript(configureScriptSrc, args2, env);
    assert.strictEqual(res2.code, 0, '略過排序配置腳本執行必須返回 0');

    const cliSettings2 = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));
    const globalSettings2 = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    const projectSettings2 = JSON.parse(fs.readFileSync(projectSettingsPath, 'utf8'));

    assert.strictEqual(cliSettings2.ui.footer.labelStyle, 'text', '略過排序且未指定 --style 時，labelStyle 必須重置為 text');
    assert.strictEqual(globalSettings2.ui.footer.labelStyle, 'text', '全域略過排序且未指定 --style 時，labelStyle 必須重置為 text');
    assert.strictEqual(projectSettings2.ui.footer.labelStyle, 'text', '專案略過排序且未指定 --style 時，labelStyle 必須重置為 text');
    assert.deepStrictEqual(cliSettings2.ui.footer.itemStyles, {}, '略過排序時 itemStyles 必須為空物件');

    console.log('✅ 測試情境 12 通過！');
  } finally {
    rmRfSync(sandbox);
  }
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
    await testCase8QuestionsJsonMetricIds();
    await testCase9LabelStyleConfig();
    await testCase10FiveCategoryTabsAndParenthesisDefense();
    await testCase11ItemStylesPrefixAndConfig();
    await testCase12PureNumbersOverwritesResidualEmojiStyle();
    console.log('\n🎉 所有跨平台整合測試皆已成功通過！');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 測試執行失敗:', error);
    process.exit(1);
  }
}

runAllTests();

