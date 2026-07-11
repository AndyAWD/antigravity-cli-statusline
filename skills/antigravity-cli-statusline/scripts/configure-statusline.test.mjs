import fs from 'fs';
import path from 'path';
import assert from 'assert';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

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
    const bakStats = fs.lstatSync(oldSkillBak);
    assert.ok(bakStats.isSymbolicLink(), '備份路徑必須是一個符號連結');

    const linkTarget = fs.readlinkSync(oldSkillBak);
    assert.strictEqual(
      path.resolve(path.dirname(oldSkillBak), linkTarget),
      path.resolve(externalDir),
      '備份的符號連結目標必須指向原始外部實體目錄'
    );

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
// 執行所有測試
// ==========================================
async function runAllTests() {
  try {
    await testCase1SymlinkDefense();
    await testCase2GitProjectDefense();
    await testCase3QuestionsJsonDefense();
    console.log('\n🎉 所有跨平台整合測試皆已成功通過！');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 測試執行失敗:', error);
    process.exit(1);
  }
}

runAllTests();
