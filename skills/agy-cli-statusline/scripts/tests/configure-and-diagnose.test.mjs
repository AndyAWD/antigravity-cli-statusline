import fs from 'fs';
import path from 'path';
import assert from 'assert';
import os from 'os';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  getStatusLineCommand,
  parseOrderAndStyles,
  cleanupLegacyWindowsShBridge,
  isDirectExecution as configureIsDirectExecution
} from '../configure-statusline.mjs';
import {
  checkPluginHookSync,
  isDirectExecution as diagnoseIsDirectExecution
} from '../diagnose-statusline.mjs';
import { isDirectExecution, listMjsFilesRecursiveSync } from '../lib/core/fs-utils.mjs';
import { compareSemver } from '../lib/core/semver.mjs';
import { runScript, rmRfSync, copyScriptsWithLib } from './helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 原始腳本的路徑（tests/ 的上一層即 scripts/）
const originalScriptsDir = path.resolve(__dirname, '..');
const configureScriptSrc = path.join(originalScriptsDir, 'configure-statusline.mjs');
const statuslineQuotaSrc = path.join(originalScriptsDir, 'statusline-quota.mjs');
const fetchLocalQuotaSrc = path.join(originalScriptsDir, 'fetch-local-quota.mjs');
const diagnoseScriptSrc = path.join(originalScriptsDir, 'diagnose-statusline.mjs');

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
    // 連同 lib/ 一併複製，讓薄入口的 ./lib/... 相對匯入可解析
    copyScriptsWithLib(originalScriptsDir, runDir);

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
    // 連同 lib/ 一併複製，讓薄入口的 ./lib/... 相對匯入可解析
    copyScriptsWithLib(originalScriptsDir, runDir);

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
    // 連同 lib/ 一併複製，讓薄入口的 ./lib/... 相對匯入可解析
    copyScriptsWithLib(originalScriptsDir, scriptDir);

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
    // 連同 lib/ 一併複製，讓薄入口的 ./lib/... 相對匯入可解析
    copyScriptsWithLib(originalScriptsDir, runDir);
    
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
    // 連同 lib/ 一併複製，讓薄入口的 ./lib/... 相對匯入可解析
    copyScriptsWithLib(originalScriptsDir, scriptDir);

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
    // 連同 lib/ 一併複製，讓薄入口的 ./lib/... 相對匯入可解析
    copyScriptsWithLib(originalScriptsDir, scriptDir);

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

    const globalSettings = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    const cliSettings = JSON.parse(fs.readFileSync(cliSettingsPath, 'utf8'));

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

    // 2. 驗證掛鉤腳本已正確部署至目標路徑
    const deployedHookPath = path.join(mockHome, '.gemini', 'antigravity-cli', 'hooks', 'statusline-quota.mjs');
    assert.ok(fs.existsSync(deployedHookPath), 'statusline-quota.mjs 必須部署至 hooks 目錄');

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

  // 1b. 含空格路徑：必須使用 node --import file:///... -e 0（同時無雙引號且無未編碼空格，完美相容 cmd /c）
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
    'quota-argon-reset-time',
    'plugin-version',
    'plugin-update'
  ];

  for (const lang of languages) {
    const langData = questionsData[lang];
    assert.ok(langData, `${lang} 語系資料必須存在`);
    assert.ok(Array.isArray(langData.options), `${lang}.options 必須為陣列`);
    assert.strictEqual(langData.options.length, 38, `${lang}.options 必須包含全部 38 個指標選項`);

    const extractedIds = langData.options.map(item => {
      const match = item.match(/[\(（]([^）\)]+)[\)）]$/);
      return match ? match[1] : item;
    });

    const uniqueIds = new Set(extractedIds);
    assert.strictEqual(uniqueIds.size, 38, `${lang} 的所有指標識別碼必須不重複`);

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
      "權杖數長條圖（token-count-bar）",
      "狀態列版本號（plugin-version）",
      "狀態列新版本更新提醒（plugin-update）"
    ]);

    const args = ['--lang', 'zh-tw', '--selected', selected, '--order', '1,2,3,4,5,6,7,8', '--workspace', sandbox, '--time-format', 'smart', '--bar-length', '12'];
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
      'token-count-bar',
      'plugin-version',
      'plugin-update'
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
    { id: 'system-and-tasks', count: 11 }
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
    assert.strictEqual(totalOptions, 38, `${lang} 分類中的指標總和必須剛好為 38 項`);
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

  // 7. 全域 1-38 指標序號回退（當 selectedIds 僅為子集，使用者輸入全域序號 25 代表 git-branch、37 代表 plugin-version、38 代表 plugin-update，且未勾選之 36 不可誤入）
  const subsetIds = ['model-name', 'git-branch', 'plugin-version', 'plugin-update']; // length = 4, git-branch 在 38 項中為第 25 項、plugin-version 為第 37 項、plugin-update 為第 38 項
  const resGlobalFallback = parseOrderAndStyles('1, e25, 36, e37, e38', subsetIds);
  assert.deepStrictEqual(resGlobalFallback.items, ['model-name', 'git-branch', 'plugin-version', 'plugin-update']);
  assert.deepStrictEqual(resGlobalFallback.itemStyles, {
    'git-branch': 'emoji',
    'plugin-version': 'emoji',
    'plugin-update': 'emoji'
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

  // 12. 外層被方括號包覆之陣列格式輸入（例如使用者直接貼上完整陣列）
  const bracketInput = '[e:model-name,e:quota,n,git-branch]';
  const resBracket = parseOrderAndStyles(bracketInput, testIds);
  assert.deepStrictEqual(resBracket.items, ['model-name', 'quota', 'n', 'git-branch']);
  assert.deepStrictEqual(resBracket.itemStyles, { 'model-name': 'emoji', 'quota': 'emoji' });

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
// 測試情境 13：保護損壞或非標準 JSON 設定檔不被空物件覆寫（防洗白防禦）與舊腳本清理
// ==========================================
async function testCase13NonDestructiveConfigAndLegacyCleanup() {
  console.log('\n--- 執行測試情境 13：保護損壞或非標準 JSON 設定檔不被空物件覆寫與舊腳本清理 ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case13-'));

  try {
    const cliSettingsPath = path.join(sandbox, '.gemini', 'antigravity-cli', 'settings.json');
    const globalSettingsPath = path.join(sandbox, '.gemini', 'settings.json');
    const legacyHooksDir = path.join(sandbox, '.gemini', 'hooks');
    fs.mkdirSync(path.dirname(cliSettingsPath), { recursive: true });
    fs.mkdirSync(legacyHooksDir, { recursive: true });

    // 1. 建立損壞的 CLI settings.json（含使用者自訂權限字串）與合法的 global settings.json（含既有屬性）
    const corruptedCliContent = '{\n  "permissions": { "allow": ["command(git status)"] },\n  // user comment causing JSON.parse error\n}';
    fs.writeFileSync(cliSettingsPath, corruptedCliContent, 'utf8');

    const validGlobalContent = {
      allowNonWorkspaceAccess: true,
      colorScheme: 'tokyo night',
      statusLine: {
        padding: 1,
        stack_with_default: true
      }
    };
    fs.writeFileSync(globalSettingsPath, JSON.stringify(validGlobalContent, null, 2), 'utf8');

    // 2. 建立舊版遺留腳本與使用者自訂的其他掛鉤腳本
    const legacyQuotaHook = path.join(legacyHooksDir, 'statusline-quota.mjs');
    const legacyFetchHook = path.join(legacyHooksDir, 'fetch-local-quota.mjs');
    const userCustomHook = path.join(legacyHooksDir, 'my-custom-hook.mjs');
    fs.writeFileSync(legacyQuotaHook, '// legacy', 'utf8');
    fs.writeFileSync(legacyFetchHook, '// legacy', 'utf8');
    fs.writeFileSync(userCustomHook, '// user custom hook', 'utf8');

    const selected = JSON.stringify(['model-name', 'quota']);
    const args = ['--lang', 'zh-tw', '--selected', selected, '--order', '1,2', '--workspace', sandbox];
    const env = { HOME: sandbox, USERPROFILE: sandbox };
    const res = await runScript(configureScriptSrc, args, env);
    assert.strictEqual(res.code, 0, '當單一設定檔損壞時，腳本仍應優雅完成而不崩潰');

    // 驗證損壞的 CLI 設定檔未被空物件洗白覆蓋
    const afterCliContent = fs.readFileSync(cliSettingsPath, 'utf8');
    assert.strictEqual(afterCliContent, corruptedCliContent, '損壞的設定檔內容必須原封不動保留，絕不可被洗白覆蓋');

    // 驗證合法的 Global 設定檔保留了所有既有屬性（allowNonWorkspaceAccess, colorScheme, statusLine.padding, stack_with_default）
    const afterGlobal = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    assert.strictEqual(afterGlobal.allowNonWorkspaceAccess, true, '既有 allowNonWorkspaceAccess 必須保留');
    assert.strictEqual(afterGlobal.colorScheme, 'tokyo night', '既有 colorScheme 必須保留');
    assert.strictEqual(afterGlobal.statusLine.padding, 1, '既有 statusLine.padding 必須保留');
    assert.strictEqual(afterGlobal.statusLine.stack_with_default, true, '既有 statusLine.stack_with_default 必須保留');
    assert.strictEqual(afterGlobal.statusLine.enabled, true, 'statusLine.enabled 必須設為 true');

    // 驗證舊版遺留腳本已自動清理，且使用者自己的 my-custom-hook.mjs 完好保留
    assert.strictEqual(fs.existsSync(legacyQuotaHook), false, '舊版 ~/.gemini/hooks/statusline-quota.mjs 應被自動清理');
    assert.strictEqual(fs.existsSync(legacyFetchHook), false, '舊版 ~/.gemini/hooks/fetch-local-quota.mjs 應被自動清理');
    assert.strictEqual(fs.existsSync(userCustomHook), true, '使用者自訂的 ~/.gemini/hooks/my-custom-hook.mjs 必須完好保留');

    console.log('✅ 測試情境 13 通過！');
  } finally {
    rmRfSync(sandbox);
  }
}

// ==========================================
// 測試情境 14：Windows 不再編譯 sh.exe 且安全清理舊版微型 sh.exe 橋接器（Issue #8）
// ==========================================
async function testCase14LegacyWindowsShBridgeRemoval() {
  console.log('\n--- 執行測試情境 14：Windows 不再編譯 sh.exe 且安全清理舊版微型 sh.exe 橋接器 ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case14-'));

  try {
    const localAppData = path.join(sandbox, 'LocalAppData');
    const agyBinDir = path.join(localAppData, 'agy', 'bin');
    const legacyShPath = path.join(agyBinDir, 'sh.exe');
    fs.mkdirSync(agyBinDir, { recursive: true });

    // 1. 模擬舊版 sh_hidden.cs 編譯之 4,608 位元組 sh.exe：非 Windows 不觸動，Windows 會安全清理
    fs.writeFileSync(legacyShPath, Buffer.alloc(4608, 0));
    assert.strictEqual(cleanupLegacyWindowsShBridge(localAppData, 'darwin'), false, '非 Windows 平台不可清理');
    assert.strictEqual(fs.existsSync(legacyShPath), true, '非 Windows 平台必須保留檔案');
    assert.strictEqual(cleanupLegacyWindowsShBridge(localAppData, 'win32'), true, 'Windows 平台必須移除舊版 4,608 bytes sh.exe');
    assert.strictEqual(fs.existsSync(legacyShPath), false, '舊版微型 sh.exe 應已被移除');

    // 2. 防誤刪保護：大於 16,384 位元組的真實 sh.exe（如 Git / MSYS2）與符號連結必須保留
    fs.writeFileSync(legacyShPath, Buffer.alloc(20000, 1));
    assert.strictEqual(cleanupLegacyWindowsShBridge(localAppData, 'win32'), false, '大於 16,384 bytes 的真實 sh.exe 不可刪除');
    assert.strictEqual(fs.existsSync(legacyShPath), true, '真實 sh.exe 必須完好保留');
    fs.unlinkSync(legacyShPath);

    const realTargetPath = path.join(sandbox, 'real-sh.exe');
    fs.writeFileSync(realTargetPath, Buffer.alloc(1024, 2));
    try {
      fs.symlinkSync(realTargetPath, legacyShPath, 'file');
      assert.strictEqual(cleanupLegacyWindowsShBridge(localAppData, 'win32'), false, '符號連結類型的 sh.exe 不可刪除');
      assert.strictEqual(fs.lstatSync(legacyShPath).isSymbolicLink(), true, '符號連結必須完好保留');
      fs.unlinkSync(legacyShPath);
    } catch (_) {
      // Windows 無建立符號連結權限時略過符號連結分支
    }

    // 3. 端對端執行 configure-statusline.mjs：不應輸出任何 sh.exe 編譯失敗警告或重新建立 sh.exe
    const mockHome = path.join(sandbox, 'home');
    fs.mkdirSync(mockHome, { recursive: true });
    const fakeBin = path.join(sandbox, 'fake-bin');
    fs.mkdirSync(fakeBin, { recursive: true });
    const res = await runScript(
      configureScriptSrc,
      ['--lang', 'zh-tw', '--selected', '["model-name"]', '--order', '1', '--workspace', sandbox],
      { HOME: mockHome, USERPROFILE: mockHome, LOCALAPPDATA: localAppData, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}` }
    );
    assert.strictEqual(res.code, 0, `configure-statusline.mjs 應成功退出，stderr: ${res.stderr}`);
    assert.ok(!res.stdout.includes('sh.exe 編譯') && !res.stderr.includes('sh.exe'), '設定過程不應嘗試編譯 sh.exe');
    assert.strictEqual(fs.existsSync(legacyShPath), false, '設定過程不得再建立 sh.exe');

    console.log('✅ 測試情境 14 通過！');
  } finally {
    rmRfSync(sandbox);
  }
}

// ==========================================
// 測試情境 15：驗證 .hook-version.json 寫入與 diagnose-statusline 外掛／掛鉤同步檢查
// ==========================================
async function testCase15HookVersionAndPluginHookSync() {
  console.log('\n--- 執行測試情境 15：驗證 .hook-version.json 寫入與 diagnose-statusline 外掛／掛鉤同步檢查 ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case15-'));
  const sha256 = (str) => createHash('sha256').update(str, 'utf8').digest('hex');

  try {
    // 1. 驗證執行 configure-statusline.mjs 後自動寫入 .hook-version.json（不含 UTF-8 BOM）
    const mockHome = path.join(sandbox, 'home');
    const workspace = path.join(sandbox, 'ws');
    fs.mkdirSync(mockHome, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });

    const res1 = await runScript(
      configureScriptSrc,
      ['--lang', 'zh-tw', '--selected', '["model-name","plugin-version"]', '--order', '1,2', '--workspace', workspace],
      { HOME: mockHome, USERPROFILE: mockHome }
    );
    assert.strictEqual(res1.code, 0, `configure-statusline.mjs 必須成功執行，stderr: ${res1.stderr}`);

    const hooksDir = path.join(mockHome, '.gemini', 'antigravity-cli', 'hooks');
    const hookMetaPath = path.join(hooksDir, '.hook-version.json');
    assert.ok(fs.existsSync(hookMetaPath), '必須寫入 hooks/.hook-version.json');
    const rawMeta = fs.readFileSync(hookMetaPath);
    assert.ok(!(rawMeta[0] === 0xEF && rawMeta[1] === 0xBB && rawMeta[2] === 0xBF), '.hook-version.json 不可含有 UTF-8 BOM');

    const hookMeta = JSON.parse(rawMeta.toString('utf8'));
    const repoPluginMeta = JSON.parse(fs.readFileSync(path.resolve(originalScriptsDir, '..', '..', '..', 'plugin.json'), 'utf8'));
    const expectedRepoVersion = repoPluginMeta.version.replace(/^v/i, '');
    assert.strictEqual(hookMeta.pluginVersion, expectedRepoVersion, 'pluginVersion 必須記錄專案清單版本');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(hookMeta.syncedAt), 'syncedAt 必須為合法 ISO 時間字串');

    const deployedMain = fs.readFileSync(path.join(hooksDir, 'statusline-quota.mjs'), 'utf8');
    const deployedFetch = fs.readFileSync(path.join(hooksDir, 'fetch-local-quota.mjs'), 'utf8');
    assert.strictEqual(hookMeta.files['statusline-quota.mjs'], sha256(deployedMain), 'statusline-quota.mjs 雜湊必須相符');
    assert.strictEqual(hookMeta.files['fetch-local-quota.mjs'], sha256(deployedFetch), 'fetch-local-quota.mjs 雜湊必須相符');

    // 2. 驗證無 plugin.json 的獨立腳本複本仍可透過 HOOK_VERSION 回退記錄正確版號
    const standaloneHome = path.join(sandbox, 'standalone-home');
    const standaloneSkillDir = path.join(sandbox, 'standalone-skill');
    const standaloneScriptsDir = path.join(standaloneSkillDir, 'scripts');
    const standaloneResDir = path.join(standaloneSkillDir, 'resources');
    fs.mkdirSync(standaloneHome, { recursive: true });
    fs.mkdirSync(standaloneScriptsDir, { recursive: true });
    fs.mkdirSync(standaloneResDir, { recursive: true });
    copyScriptsWithLib(originalScriptsDir, standaloneScriptsDir);
    fs.copyFileSync(path.join(originalScriptsDir, '..', 'resources', 'questions.json'), path.join(standaloneResDir, 'questions.json'));

    const resStandalone = await runScript(
      path.join(standaloneScriptsDir, 'configure-statusline.mjs'),
      ['--lang', 'us', '--selected', '["model-name","plugin-version"]', '--order', '1,2', '--workspace', workspace],
      { HOME: standaloneHome, USERPROFILE: standaloneHome }
    );
    assert.strictEqual(resStandalone.code, 0, `獨立目錄執行 configure-statusline.mjs 必須成功，stderr: ${resStandalone.stderr}`);
    const standaloneMeta = JSON.parse(fs.readFileSync(path.join(standaloneHome, '.gemini', 'antigravity-cli', 'hooks', '.hook-version.json'), 'utf8'));
    assert.strictEqual(standaloneMeta.pluginVersion, expectedRepoVersion, '缺少 plugin.json 時必須從 HOOK_VERSION 取得版號');

    // 2b. 若獨立腳本上三層目錄存在其他非本專案之 package.json，不可誤讀其版本號
    fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ name: 'other-unrelated-project', version: '9.9.9' }), 'utf8');
    const resStandaloneWithUnrelatedPkg = await runScript(
      path.join(standaloneScriptsDir, 'configure-statusline.mjs'),
      ['--lang', 'us', '--selected', '["model-name","plugin-version"]', '--order', '1,2', '--workspace', workspace],
      { HOME: standaloneHome, USERPROFILE: standaloneHome }
    );
    assert.strictEqual(resStandaloneWithUnrelatedPkg.code, 0);
    const standaloneMeta2 = JSON.parse(fs.readFileSync(path.join(standaloneHome, '.gemini', 'antigravity-cli', 'hooks', '.hook-version.json'), 'utf8'));
    assert.strictEqual(standaloneMeta2.pluginVersion, expectedRepoVersion, '不可誤讀無關專案之 package.json 版本號');
    fs.unlinkSync(path.join(sandbox, 'package.json'));

    // 3. 驗證 checkPluginHookSync 各種狀態分支
    const syncBase = path.join(sandbox, 'sync-test');
    const fakePluginDir = path.join(syncBase, 'installed-plugin');
    const fakePluginScripts = path.join(fakePluginDir, 'skills', 'agy-cli-statusline', 'scripts');
    const fakeHooksDir = path.join(syncBase, 'hooks');
    const missingPluginDir = path.join(syncBase, 'no-plugin');
    fs.mkdirSync(fakePluginScripts, { recursive: true });
    fs.mkdirSync(fakeHooksDir, { recursive: true });
    fs.mkdirSync(missingPluginDir, { recursive: true });

    // (a) hook_missing
    let r = checkPluginHookSync({
      home: syncBase,
      hooksDir: fakeHooksDir,
      installedPluginDir: fakePluginDir,
      currentPluginDir: missingPluginDir
    });
    assert.strictEqual(r.status, 'hook_missing', '缺少掛鉤腳本時應回報 hook_missing');

    // (b) plugin_not_found（掛鉤存在，但兩處皆無合法外掛清單，且無關專案之 package.json 必須略過）
    fs.copyFileSync(statuslineQuotaSrc, path.join(fakePluginScripts, 'statusline-quota.mjs'));
    fs.copyFileSync(fetchLocalQuotaSrc, path.join(fakePluginScripts, 'fetch-local-quota.mjs'));
    fs.copyFileSync(statuslineQuotaSrc, path.join(fakeHooksDir, 'statusline-quota.mjs'));
    fs.copyFileSync(fetchLocalQuotaSrc, path.join(fakeHooksDir, 'fetch-local-quota.mjs'));
    fs.writeFileSync(path.join(fakePluginDir, 'package.json'), JSON.stringify({ name: 'other-package', version: '9.9.9' }), 'utf8');
    r = checkPluginHookSync({
      home: syncBase,
      hooksDir: fakeHooksDir,
      installedPluginDir: fakePluginDir,
      currentPluginDir: missingPluginDir
    });
    assert.strictEqual(r.status, 'plugin_not_found', '找不到外掛清單且僅有無關 package.json 時應回報 plugin_not_found');
    fs.unlinkSync(path.join(fakePluginDir, 'package.json'));

    // (c) in_sync
    fs.writeFileSync(path.join(fakePluginDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: expectedRepoVersion }), 'utf8');
    fs.writeFileSync(hookMetaPath.replace(hooksDir, fakeHooksDir), JSON.stringify({ pluginVersion: expectedRepoVersion, syncedAt: '2026-11-18T00:00:00Z' }), 'utf8');
    r = checkPluginHookSync({
      home: syncBase,
      hooksDir: fakeHooksDir,
      installedPluginDir: fakePluginDir,
      currentPluginDir: missingPluginDir
    });
    assert.strictEqual(r.status, 'in_sync', '外掛與掛鉤版本與內容一致時應回報 in_sync');
    assert.deepStrictEqual(r.fileDiffs, [], 'in_sync 時 fileDiffs 應為空');

    // (d) version_mismatch（外掛已透過 agy plugin install 升至較新版本，但掛鉤仍為目前版本）
    const [majV, minV] = expectedRepoVersion.split('.').map(Number);
    const higherVersion = `${majV}.${minV + 1}.0`;
    fs.writeFileSync(path.join(fakePluginDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: higherVersion }), 'utf8');
    r = checkPluginHookSync({
      home: syncBase,
      hooksDir: fakeHooksDir,
      installedPluginDir: fakePluginDir,
      currentPluginDir: missingPluginDir
    });
    assert.strictEqual(r.status, 'version_mismatch', '外掛版本領先掛鉤時應回報 version_mismatch');
    assert.strictEqual(r.pluginVersion, higherVersion);
    assert.strictEqual(r.hookVersion, expectedRepoVersion);

    // (e) content_mismatch（版號皆為較新版本，但掛鉤腳本內容未更新）
    fs.writeFileSync(path.join(fakeHooksDir, '.hook-version.json'), JSON.stringify({ pluginVersion: higherVersion }), 'utf8');
    fs.appendFileSync(path.join(fakeHooksDir, 'statusline-quota.mjs'), '\n// modified\n', 'utf8');
    r = checkPluginHookSync({
      home: syncBase,
      hooksDir: fakeHooksDir,
      installedPluginDir: fakePluginDir,
      currentPluginDir: missingPluginDir
    });
    assert.strictEqual(r.status, 'content_mismatch', '版號相同但腳本雜湊不同時應回報 content_mismatch');
    assert.ok(r.fileDiffs.some(d => d.file === 'statusline-quota.mjs' && d.reason === 'content_differs'));

    // (f) legacy_mismatch（無 .hook-version.json 且無 HOOK_VERSION 的早期掛鉤）
    fs.unlinkSync(path.join(fakeHooksDir, '.hook-version.json'));
    const strippedHook = deployedMain
      .replace(/export\s+const\s+HOOK_VERSION[^\r\n]*/, '// legacy script without HOOK_VERSION')
      .replace(/\bHOOK_VERSION\b\s*,?/g, '')
      + '\n// legacy script without HOOK_VERSION\n';
    fs.writeFileSync(path.join(fakeHooksDir, 'statusline-quota.mjs'), strippedHook, 'utf8');
    r = checkPluginHookSync({
      home: syncBase,
      hooksDir: fakeHooksDir,
      installedPluginDir: fakePluginDir,
      currentPluginDir: missingPluginDir
    });
    assert.strictEqual(r.status, 'legacy_mismatch', '舊版無中繼資料且腳本不同時應回報 legacy_mismatch');

    // (g) 自動探索 Marketplace 數字安裝目錄與標準目錄並存時的最高版本優先原則
    const autoHome = path.join(sandbox, 'auto-discover-home');
    const autoNumericDir = path.join(autoHome, '.gemini', 'config', 'plugins', '-1870732469773246571');
    const autoHooksDir = path.join(autoHome, '.gemini', 'antigravity-cli', 'hooks');
    fs.mkdirSync(path.join(autoNumericDir, 'skills', 'agy-cli-statusline', 'scripts'), { recursive: true });
    fs.mkdirSync(autoHooksDir, { recursive: true });
    fs.copyFileSync(statuslineQuotaSrc, path.join(autoNumericDir, 'skills', 'agy-cli-statusline', 'scripts', 'statusline-quota.mjs'));
    fs.copyFileSync(fetchLocalQuotaSrc, path.join(autoNumericDir, 'skills', 'agy-cli-statusline', 'scripts', 'fetch-local-quota.mjs'));
    fs.copyFileSync(statuslineQuotaSrc, path.join(autoHooksDir, 'statusline-quota.mjs'));
    fs.copyFileSync(fetchLocalQuotaSrc, path.join(autoHooksDir, 'fetch-local-quota.mjs'));
    fs.writeFileSync(path.join(autoNumericDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: '1.11.0' }), 'utf8');
    fs.writeFileSync(path.join(autoHooksDir, '.hook-version.json'), JSON.stringify({ pluginVersion: '1.11.0' }), 'utf8');

    r = checkPluginHookSync({
      home: autoHome,
      hooksDir: autoHooksDir,
      currentPluginDir: missingPluginDir
    });
    assert.strictEqual(r.status, 'in_sync', '應能自動偵測 Marketplace 數字安裝目錄');
    assert.strictEqual(r.pluginVersion, '1.11.0');

    const autoStandardDir = path.join(autoHome, '.gemini', 'config', 'plugins', 'antigravity-cli-statusline');
    fs.mkdirSync(path.join(autoStandardDir, 'skills', 'agy-cli-statusline', 'scripts'), { recursive: true });
    fs.copyFileSync(statuslineQuotaSrc, path.join(autoStandardDir, 'skills', 'agy-cli-statusline', 'scripts', 'statusline-quota.mjs'));
    fs.copyFileSync(fetchLocalQuotaSrc, path.join(autoStandardDir, 'skills', 'agy-cli-statusline', 'scripts', 'fetch-local-quota.mjs'));
    fs.writeFileSync(path.join(autoStandardDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: '1.12.0' }), 'utf8');

    r = checkPluginHookSync({
      home: autoHome,
      hooksDir: autoHooksDir,
      currentPluginDir: missingPluginDir
    });
    assert.strictEqual(r.status, 'version_mismatch', '標準目錄版號較高時不應被舊版 Marketplace 數字目錄遮蔽');
    assert.strictEqual(r.pluginVersion, '1.12.0');

    console.log('✅ 測試情境 15 通過！');
  } finally {
    rmRfSync(sandbox);
  }
}

// ==========================================
// 測試情境 16：遞迴部署 hooks/lib/**/*.mjs（無 BOM）、清理過時 .mjs 與 .hook-version.json 雜湊
// ==========================================
async function testCase16RecursiveHookLibDeployment() {
  console.log('\n--- 執行測試情境 16：遞迴部署 hooks/lib/、過時檔案清理與 .hook-version.json 雜湊 ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case16-'));
  const sha256 = (str) => createHash('sha256').update(str, 'utf8').digest('hex');
  const hasBom = (buf) => buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;

  try {
    const mockHome = path.join(sandbox, 'home');
    const workspace = path.join(sandbox, 'ws');
    fs.mkdirSync(mockHome, { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    const hooksDir = path.join(mockHome, '.gemini', 'antigravity-cli', 'hooks');
    const hooksLibDir = path.join(hooksDir, 'lib');

    // (a) 預先放入過時 .mjs（根目錄、巢狀）與非 .mjs 使用者檔案；過時 .mjs 應被清除、其他檔案應保留
    fs.mkdirSync(path.join(hooksLibDir, 'core'), { recursive: true });
    fs.mkdirSync(path.join(hooksLibDir, 'obsolete-dir'), { recursive: true });
    fs.writeFileSync(path.join(hooksLibDir, 'stale-root.mjs'), 'export const stale = 1;\n', 'utf8');
    fs.writeFileSync(path.join(hooksLibDir, 'core', 'stale-nested.mjs'), 'export const stale = 2;\n', 'utf8');
    fs.writeFileSync(path.join(hooksLibDir, 'obsolete-dir', 'stale-deep.mjs'), 'export const stale = 3;\n', 'utf8');
    fs.writeFileSync(path.join(hooksLibDir, 'user-notes.txt'), 'keep me', 'utf8');

    // (b) 外部目錄中的檔案：透過符號連結指向 hooks/lib/ 外部，絕不可被清理
    const outsideDir = path.join(sandbox, 'outside');
    fs.mkdirSync(outsideDir, { recursive: true });
    const outsideVictim = path.join(outsideDir, 'victim.mjs');
    const outsideFileTarget = path.join(outsideDir, 'victim-file-target.mjs');
    fs.writeFileSync(outsideVictim, 'export const victim = true;\n', 'utf8');
    fs.writeFileSync(outsideFileTarget, 'export const victimFile = true;\n', 'utf8');
    let symlinksSupported = true;
    try {
      fs.symlinkSync(outsideDir, path.join(hooksLibDir, 'escape-dir'), process.platform === 'win32' ? 'junction' : 'dir');
      fs.symlinkSync(outsideFileTarget, path.join(hooksLibDir, 'escape-file.mjs'), 'file');
    } catch (e) {
      symlinksSupported = false;
      console.log(`  ⚠️ 無法建立符號連結 (${e.code})，略過符號連結安全子項目。`);
    }

    const res = await runScript(
      configureScriptSrc,
      ['--lang', 'zh-tw', '--selected', '["model-name"]', '--order', '1', '--workspace', workspace],
      { HOME: mockHome, USERPROFILE: mockHome }
    );
    assert.strictEqual(res.code, 0, `configure-statusline.mjs 必須成功執行，stderr: ${res.stderr}`);

    // 1. 來源 scripts/lib/**/*.mjs 全數遞迴部署至 hooks/lib/，內容一致且無 BOM
    const srcLibDir = path.join(originalScriptsDir, 'lib');
    const srcLibFiles = listMjsFilesRecursiveSync(srcLibDir);
    assert.ok(srcLibFiles.length > 0, '來源 scripts/lib/ 必須至少含有一個 .mjs 模組');
    assert.ok(srcLibFiles.some(f => f.includes('/')), '來源 lib/ 必須包含巢狀子目錄模組（例如 core/constants.mjs）');
    for (const rel of srcLibFiles) {
      const dst = path.join(hooksLibDir, ...rel.split('/'));
      assert.ok(fs.existsSync(dst), `hooks/lib/${rel} 必須已部署`);
      const dstBuf = fs.readFileSync(dst);
      assert.ok(!hasBom(dstBuf), `hooks/lib/${rel} 不可含 UTF-8 BOM`);
      assert.strictEqual(
        dstBuf.toString('utf8'),
        fs.readFileSync(path.join(srcLibDir, ...rel.split('/')), 'utf8').replace(/^\uFEFF/, ''),
        `hooks/lib/${rel} 內容必須與來源一致`
      );
    }
    for (const entry of ['statusline-quota.mjs', 'fetch-local-quota.mjs']) {
      assert.ok(!hasBom(fs.readFileSync(path.join(hooksDir, entry))), `${entry} 不可含 UTF-8 BOM`);
    }

    // 2. 過時 .mjs 已清除；非 .mjs 檔案保留
    assert.ok(!fs.existsSync(path.join(hooksLibDir, 'stale-root.mjs')), 'hooks/lib/ 根目錄的過時 .mjs 必須被清除');
    assert.ok(!fs.existsSync(path.join(hooksLibDir, 'core', 'stale-nested.mjs')), 'hooks/lib/core/ 內的過時 .mjs 必須被清除');
    assert.ok(!fs.existsSync(path.join(hooksLibDir, 'obsolete-dir', 'stale-deep.mjs')), 'hooks/lib/obsolete-dir/ 內的過時 .mjs 必須被清除');
    assert.strictEqual(fs.readFileSync(path.join(hooksLibDir, 'user-notes.txt'), 'utf8'), 'keep me', '非 .mjs 的使用者檔案不可被刪除');

    // 3. 符號連結 / 超出 hooks/lib/ 範圍的路徑不可使外部檔案被刪除
    assert.ok(fs.existsSync(outsideVictim), '符號連結目錄所指向的外部 victim.mjs 不可被刪除');
    assert.strictEqual(fs.readFileSync(outsideVictim, 'utf8'), 'export const victim = true;\n');
    assert.ok(fs.existsSync(outsideFileTarget), '符號連結 .mjs 檔案所指向的外部目標不可被刪除');
    assert.strictEqual(fs.readFileSync(outsideFileTarget, 'utf8'), 'export const victimFile = true;\n');
    if (symlinksSupported) {
      assert.ok(fs.existsSync(path.join(outsideDir)), '外部目錄必須完好');
    }

    // 4. .hook-version.json 記錄入口腳本與所有 lib/... 檔案之雜湊（不含 BOM）
    const hookMetaPath = path.join(hooksDir, '.hook-version.json');
    const rawMeta = fs.readFileSync(hookMetaPath);
    assert.ok(!hasBom(rawMeta), '.hook-version.json 不可含 UTF-8 BOM');
    const hookMeta = JSON.parse(rawMeta.toString('utf8'));
    assert.strictEqual(hookMeta.files['statusline-quota.mjs'], sha256(fs.readFileSync(path.join(hooksDir, 'statusline-quota.mjs'), 'utf8')));
    assert.strictEqual(hookMeta.files['fetch-local-quota.mjs'], sha256(fs.readFileSync(path.join(hooksDir, 'fetch-local-quota.mjs'), 'utf8')));
    for (const rel of srcLibFiles) {
      const key = `lib/${rel}`;
      assert.ok(hookMeta.files[key], `.hook-version.json 必須記錄 ${key}`);
      assert.strictEqual(hookMeta.files[key], sha256(fs.readFileSync(path.join(hooksLibDir, ...rel.split('/')), 'utf8')), `${key} 雜湊必須相符`);
    }
    assert.ok(!hookMeta.files['lib/stale-root.mjs'], '已清除的過時檔案不可出現在雜湊記錄中');
    assert.strictEqual(
      Object.keys(hookMeta.files).filter(k => k.startsWith('lib/')).length,
      srcLibFiles.length,
      '.hook-version.json 的 lib/ 記錄數量必須等於來源 lib/ 模組數量'
    );

    // 5. 部署後的 hooks/ 可獨立執行（./lib/... 相對匯入可解析），且診斷為 in_sync
    const syncAfterDeploy = checkPluginHookSync({
      home: mockHome,
      hooksDir,
      installedPluginDir: path.resolve(originalScriptsDir, '..', '..', '..'),
      currentPluginDir: path.join(sandbox, 'no-plugin')
    });
    assert.strictEqual(syncAfterDeploy.status, 'in_sync', `部署後應為 in_sync，實際: ${syncAfterDeploy.status} ${JSON.stringify(syncAfterDeploy.fileDiffs)}`);
    const deployedRun = await runScript(path.join(hooksDir, 'statusline-quota.mjs'), [], { HOME: mockHome, USERPROFILE: mockHome }, { cwd: mockHome });
    assert.strictEqual(deployedRun.code, 0, `已部署的 hooks/statusline-quota.mjs 必須可獨立執行，stderr: ${deployedRun.stderr}`);

    console.log('✅ 測試情境 16 通過！');
  } finally {
    rmRfSync(sandbox);
  }
}

// ==========================================
// 測試情境 17：Bug #3 isDirectExecution（win32 磁碟機代號大小寫、外層引號）與 diagnose CLI 直接執行
// ==========================================
async function testCase17IsDirectExecutionAndDiagnoseCli() {
  console.log('\n--- 執行測試情境 17：isDirectExecution 跨平台判斷與 diagnose-statusline CLI 直接執行 ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case17-'));

  try {
    // 1. 純函式：win32 磁碟機代號大小寫差異
    const metaUrl = 'file:///C:/Users/Dev/Repo/skills/agy-cli-statusline/scripts/diagnose-statusline.mjs';
    const metaPath = fileURLToPath(metaUrl);
    assert.strictEqual(isDirectExecution(metaUrl, { argv1: metaPath, platform: 'win32' }), true, '完全相同路徑應判定為直接執行');
    assert.strictEqual(isDirectExecution(metaUrl, { argv1: metaPath.toLowerCase(), platform: 'win32' }), true, 'win32 磁碟機代號與路徑大小寫不同仍應判定為直接執行');
    assert.strictEqual(isDirectExecution(metaUrl, { argv1: metaPath.toUpperCase(), platform: 'win32' }), true, 'win32 全大寫路徑仍應判定為直接執行');
    assert.strictEqual(isDirectExecution(metaUrl, { argv1: metaPath.toLowerCase(), platform: 'linux' }), false, 'linux 為區分大小寫的檔案系統，大小寫不同不得視為直接執行');

    // 2. 純函式：外層雙引號包覆（Windows 命令列常見）
    assert.strictEqual(isDirectExecution(metaUrl, { argv1: `"${metaPath}"`, platform: 'win32' }), true, '外層雙引號應被剝除後比對');
    assert.strictEqual(isDirectExecution(metaUrl, { argv1: `"${metaPath.toLowerCase()}"`, platform: 'win32' }), true, '外層雙引號加大小寫差異仍應判定為直接執行');
    assert.strictEqual(isDirectExecution(metaUrl, { argv1: `"${metaPath}"`, platform: 'linux' }), true, '外層雙引號在非 win32 平台同樣應剝除');

    // 3. 純函式：不同檔案與空 argv1
    assert.strictEqual(isDirectExecution(metaUrl, { argv1: path.join(path.dirname(metaPath), 'other.mjs'), platform: 'win32' }), false, '不同檔案不得判定為直接執行');
    assert.strictEqual(isDirectExecution(metaUrl, { argv1: '', platform: 'win32' }), false, '空 argv1 預設不得視為直接執行');
    assert.strictEqual(isDirectExecution(metaUrl, { argv1: '', platform: 'win32', treatEmptyArgv1AsDirect: true }), true, 'treatEmptyArgv1AsDirect 為 true 時空 argv1 視為直接執行');
    assert.strictEqual(isDirectExecution(metaUrl, { argv1: null, platform: 'linux', treatEmptyArgv1AsDirect: true }), true);
    assert.strictEqual(isDirectExecution(metaUrl, { argv1: '""', platform: 'win32' }), false);

    // 4. 真實檔案：以符號連結路徑呼叫時，realpath 比對應判定為直接執行
    const realFile = path.join(sandbox, 'real-entry.mjs');
    fs.writeFileSync(realFile, 'export {};\n', 'utf8');
    const realUrl = pathToFileURL(realFile).href;
    const linkFile = path.join(sandbox, 'link-entry.mjs');
    try {
      fs.symlinkSync(realFile, linkFile, 'file');
      assert.strictEqual(isDirectExecution(realUrl, { argv1: linkFile }), true, '透過符號連結呼叫應判定為直接執行');
    } catch (e) {
      if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
      console.log(`  ⚠️ 無法建立符號連結 (${e.code})，略過符號連結子項目。`);
    }

    // 5. 兩個入口腳本的 isDirectExecution 包裝：被 import 時（argv1 為測試檔）不得視為直接執行
    assert.strictEqual(configureIsDirectExecution(), false, '被 import 時 configure-statusline.mjs 不得自動執行 main');
    assert.strictEqual(diagnoseIsDirectExecution(), false, '被 import 時 diagnose-statusline.mjs 不得自動執行 main');
    assert.strictEqual(diagnoseIsDirectExecution({ argv1: diagnoseScriptSrc }), true, 'argv1 指向 diagnose-statusline.mjs 時應為直接執行');
    assert.strictEqual(diagnoseIsDirectExecution({ argv1: `"${diagnoseScriptSrc}"` }), true, '外層雙引號的 argv1 應為直接執行');
    assert.strictEqual(configureIsDirectExecution({ argv1: configureScriptSrc }), true);

    // 6. diagnose-statusline.mjs 直接以 CLI 執行必須輸出診斷內容（不得靜默結束）
    const diagHome = path.join(sandbox, 'diag-home');
    const diagWs = path.join(sandbox, 'diag-ws');
    fs.mkdirSync(diagHome, { recursive: true });
    fs.mkdirSync(diagWs, { recursive: true });
    const diagRun = await runScript(diagnoseScriptSrc, [], { HOME: diagHome, USERPROFILE: diagHome }, { cwd: diagWs });
    assert.strictEqual(diagRun.code, 0, `diagnose-statusline.mjs 直接執行應成功結束，stderr: ${diagRun.stderr}`);
    assert.ok(diagRun.stdout.includes('外掛與掛鉤版本同步檢查'), `diagnose-statusline.mjs 直接執行必須輸出同步檢查區段，實際輸出: ${diagRun.stdout.slice(0, 200)}`);
    assert.ok(diagRun.stdout.includes('診斷結論'), 'diagnose-statusline.mjs 直接執行必須輸出診斷結論');

    // 7. 複製到沙箱（連同 lib/）後直接執行亦必須有輸出
    const copiedDir = path.join(sandbox, 'copied-scripts');
    copyScriptsWithLib(originalScriptsDir, copiedDir);
    const copiedRun = await runScript(path.join(copiedDir, 'diagnose-statusline.mjs'), [], { HOME: diagHome, USERPROFILE: diagHome }, { cwd: diagWs });
    assert.strictEqual(copiedRun.code, 0, `複製後的 diagnose-statusline.mjs 應成功結束，stderr: ${copiedRun.stderr}`);
    assert.ok(copiedRun.stdout.includes('外掛與掛鉤版本同步檢查'), '複製後的 diagnose-statusline.mjs 直接執行必須輸出同步檢查區段');

    // 8. 以符號連結呼叫 diagnose-statusline.mjs 亦必須有輸出
    const diagLink = path.join(sandbox, 'diagnose-link.mjs');
    try {
      fs.symlinkSync(diagnoseScriptSrc, diagLink, 'file');
      const linkRun = await runScript(diagLink, [], { HOME: diagHome, USERPROFILE: diagHome }, { cwd: diagWs });
      assert.strictEqual(linkRun.code, 0);
      assert.ok(linkRun.stdout.includes('外掛與掛鉤版本同步檢查'), '透過符號連結直接執行 diagnose-statusline.mjs 必須輸出同步檢查區段');
    } catch (e) {
      if (e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
      console.log(`  ⚠️ 無法建立符號連結 (${e.code})，略過符號連結 CLI 子項目。`);
    }

    // 9. 被其他程式 import 時 diagnose-statusline.mjs 不得有輸出副作用
    const importProbe = path.join(sandbox, 'import-probe.mjs');
    fs.writeFileSync(importProbe, `import ${JSON.stringify(pathToFileURL(diagnoseScriptSrc).href)};\nconsole.log('IMPORT_DONE');\n`, 'utf8');
    const importRun = await runScript(importProbe, [], { HOME: diagHome, USERPROFILE: diagHome }, { cwd: diagWs });
    assert.strictEqual(importRun.code, 0);
    assert.strictEqual(importRun.stdout.trim(), 'IMPORT_DONE', 'import diagnose-statusline.mjs 不得觸發 main() 輸出');

    console.log('✅ 測試情境 17 通過！');
  } finally {
    rmRfSync(sandbox);
  }
}

// ==========================================
// 測試情境 18：Audit #5 checkPluginHookSync（工作區外掛、完整 SemVer 先行版本、lib 差異、無 lib 精簡夾具零誤報）
// ==========================================
async function testCase18CheckPluginHookSyncAudit5() {
  console.log('\n--- 執行測試情境 18：Audit #5 checkPluginHookSync 工作區外掛／SemVer／lib 差異 ---');
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-test-case18-'));
  const sha256 = (str) => createHash('sha256').update(str, 'utf8').digest('hex');
  const PLUGIN_NAME = 'antigravity-cli-statusline';

  const writePluginDir = (pluginDir, version, scriptFiles = {}) => {
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({ name: PLUGIN_NAME, version }), 'utf8');
    const scriptsDir = path.join(pluginDir, 'skills', 'agy-cli-statusline', 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    for (const [rel, content] of Object.entries(scriptFiles)) {
      const dst = path.join(scriptsDir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, content, 'utf8');
    }
  };
  const writeHooksDir = (hooksDir, files, meta) => {
    fs.mkdirSync(hooksDir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const dst = path.join(hooksDir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, content, 'utf8');
    }
    if (meta) {
      fs.writeFileSync(path.join(hooksDir, '.hook-version.json'), JSON.stringify(meta), 'utf8');
    }
  };
  const baseEntryFiles = {
    'statusline-quota.mjs': '// entry main\nexport const HOOK_VERSION_PLACEHOLDER = 1;\n',
    'fetch-local-quota.mjs': '// entry fetch\n'
  };
  const libFiles = {
    'lib/core/constants.mjs': 'export const A = 1;\n',
    'lib/util/helper.mjs': 'export const B = 2;\n'
  };

  try {
    // ---- 1. SemVer 完整先行版本比較 ----
    assert.ok(compareSemver('1.12.0-beta.2', '1.12.0-beta.1') > 0, '1.12.0-beta.2 必須大於 1.12.0-beta.1');
    assert.ok(compareSemver('1.12.0-beta.1', '1.12.0-beta.2') < 0);
    assert.ok(compareSemver('1.12.0-beta.1', '1.12.0') < 0, '先行版本 1.12.0-beta.1 必須小於正式版 1.12.0');
    assert.ok(compareSemver('1.12.0', '1.12.0-beta.2') > 0);
    assert.strictEqual(compareSemver('1.12.0-beta.2', '1.12.0-beta.2'), 0);

    const missingPluginDir = path.join(sandbox, 'no-plugin');
    fs.mkdirSync(missingPluginDir, { recursive: true });

    // ---- 2. 工作區 .agents/plugins/antigravity-cli-statusline 偵測 ----
    const wsHome = path.join(sandbox, 'ws-home');
    const wsDir = path.join(sandbox, 'workspace-a');
    const wsPluginDir = path.join(wsDir, '.agents', 'plugins', PLUGIN_NAME);
    const wsHooksDir = path.join(wsHome, '.gemini', 'antigravity-cli', 'hooks');
    fs.mkdirSync(wsHome, { recursive: true });
    writePluginDir(wsPluginDir, '1.12.0', baseEntryFiles);
    writeHooksDir(wsHooksDir, baseEntryFiles, { pluginVersion: '1.11.0', syncedAt: '2026-11-18T00:00:00Z' });

    let r = checkPluginHookSync({ home: wsHome, hooksDir: wsHooksDir, workspacePath: wsDir, currentPluginDir: missingPluginDir });
    assert.strictEqual(r.pluginVersion, '1.12.0', '必須偵測到工作區 .agents/plugins 下的外掛版本');
    assert.strictEqual(r.status, 'version_mismatch', '工作區外掛較新時應回報 version_mismatch');
    assert.strictEqual(r.hookVersion, '1.11.0');

    // 未提供工作區路徑時（改指向無關目錄）不得誤抓到該外掛
    r = checkPluginHookSync({ home: wsHome, hooksDir: wsHooksDir, workspacePath: path.join(sandbox, 'unrelated-workspace'), currentPluginDir: missingPluginDir });
    assert.strictEqual(r.status, 'plugin_not_found', '無關工作區與家目錄皆無外掛時應回報 plugin_not_found');

    // 工作區版號與掛鉤版號相同 → in_sync
    fs.writeFileSync(path.join(wsHooksDir, '.hook-version.json'), JSON.stringify({ pluginVersion: '1.12.0' }), 'utf8');
    r = checkPluginHookSync({ home: wsHome, hooksDir: wsHooksDir, workspacePath: wsDir, currentPluginDir: missingPluginDir });
    assert.strictEqual(r.status, 'in_sync');

    // ---- 3. 先行版本於 checkPluginHookSync 的狀態判斷 ----
    const preHome = path.join(sandbox, 'pre-home');
    const prePluginDir = path.join(preHome, '.gemini', 'config', 'plugins', PLUGIN_NAME);
    const preHooksDir = path.join(preHome, '.gemini', 'antigravity-cli', 'hooks');
    writePluginDir(prePluginDir, '1.12.0-beta.2', baseEntryFiles);
    writeHooksDir(preHooksDir, baseEntryFiles, { pluginVersion: '1.12.0-beta.1' });
    const preOpts = { home: preHome, hooksDir: preHooksDir, workspacePath: path.join(sandbox, 'unrelated-workspace'), currentPluginDir: missingPluginDir };

    r = checkPluginHookSync(preOpts);
    assert.strictEqual(r.pluginVersion, '1.12.0-beta.2');
    assert.strictEqual(r.status, 'version_mismatch', '掛鉤 1.12.0-beta.1 落後外掛 1.12.0-beta.2 時應回報 version_mismatch');

    fs.writeFileSync(path.join(preHooksDir, '.hook-version.json'), JSON.stringify({ pluginVersion: '1.12.0-beta.2' }), 'utf8');
    assert.strictEqual(checkPluginHookSync(preOpts).status, 'in_sync', '先行版本完全相同時應為 in_sync');

    fs.writeFileSync(path.join(preHooksDir, '.hook-version.json'), JSON.stringify({ pluginVersion: '1.12.0' }), 'utf8');
    assert.strictEqual(checkPluginHookSync(preOpts).status, 'version_mismatch', '掛鉤為正式版 1.12.0、外掛為 1.12.0-beta.2 時應視為不一致');

    // 自動探索：同時存在 beta.1（標準目錄）與 beta.2（~/.agents/plugins）時，應選用完整 SemVer 較高者
    const agentsPluginDir = path.join(preHome, '.agents', 'plugins', PLUGIN_NAME);
    writePluginDir(prePluginDir, '1.12.0-beta.1', baseEntryFiles);
    writePluginDir(agentsPluginDir, '1.12.0-beta.2', baseEntryFiles);
    fs.writeFileSync(path.join(preHooksDir, '.hook-version.json'), JSON.stringify({ pluginVersion: '1.12.0-beta.2' }), 'utf8');
    r = checkPluginHookSync(preOpts);
    assert.strictEqual(r.pluginVersion, '1.12.0-beta.2', '自動探索必須以完整 SemVer（含先行版本）選出最高版本');
    assert.strictEqual(r.status, 'in_sync');

    // 正式版 1.12.0 應高於同目錄的 1.12.0-beta.2
    writePluginDir(prePluginDir, '1.12.0', baseEntryFiles);
    r = checkPluginHookSync(preOpts);
    assert.strictEqual(r.pluginVersion, '1.12.0', '正式版 1.12.0 必須勝過 1.12.0-beta.2');
    assert.strictEqual(r.status, 'version_mismatch');

    // ---- 4. hooks/lib/*.mjs 缺漏／被修改 ----
    const libHome = path.join(sandbox, 'lib-home');
    const libPluginDir = path.join(sandbox, 'lib-plugin');
    const libHooksDir = path.join(libHome, '.gemini', 'antigravity-cli', 'hooks');
    const allFiles = { ...baseEntryFiles, ...libFiles };
    writePluginDir(libPluginDir, '1.12.0', allFiles);
    writeHooksDir(libHooksDir, allFiles, {
      pluginVersion: '1.12.0',
      files: Object.fromEntries(Object.entries(allFiles).map(([k, v]) => [k, sha256(v)]))
    });
    const libOpts = { home: libHome, hooksDir: libHooksDir, installedPluginDir: libPluginDir, currentPluginDir: missingPluginDir };

    r = checkPluginHookSync(libOpts);
    assert.strictEqual(r.status, 'in_sync', `含 lib/ 且完全一致時應為 in_sync，實際: ${r.status} ${JSON.stringify(r.fileDiffs)}`);
    assert.deepStrictEqual(r.fileDiffs, []);

    // (a) 刪除 hooks/lib/util/helper.mjs → content_mismatch + missing_in_hooks
    fs.unlinkSync(path.join(libHooksDir, 'lib', 'util', 'helper.mjs'));
    r = checkPluginHookSync(libOpts);
    assert.strictEqual(r.status, 'content_mismatch', 'hooks/lib 缺漏模組且版號相同時應回報 content_mismatch');
    assert.ok(r.fileDiffs.some(d => d.file === 'lib/util/helper.mjs' && d.reason === 'missing_in_hooks'), `必須標示 lib/util/helper.mjs missing_in_hooks，實際: ${JSON.stringify(r.fileDiffs)}`);

    // (b) 還原後修改 hooks/lib/core/constants.mjs → content_differs
    fs.writeFileSync(path.join(libHooksDir, 'lib', 'util', 'helper.mjs'), libFiles['lib/util/helper.mjs'], 'utf8');
    assert.strictEqual(checkPluginHookSync(libOpts).status, 'in_sync', '還原後應回到 in_sync');
    fs.appendFileSync(path.join(libHooksDir, 'lib', 'core', 'constants.mjs'), '// tampered\n', 'utf8');
    r = checkPluginHookSync(libOpts);
    assert.strictEqual(r.status, 'content_mismatch');
    assert.ok(r.fileDiffs.some(d => d.file === 'lib/core/constants.mjs' && d.reason === 'content_differs'), `必須標示 lib/core/constants.mjs content_differs，實際: ${JSON.stringify(r.fileDiffs)}`);
    assert.strictEqual(r.fileDiffs.length, 1, '僅被修改的檔案應被列為差異');

    // (c) 舊版掛鉤（無 .hook-version.json、入口腳本無 HOOK_VERSION）+ lib 缺漏 → legacy_mismatch
    fs.unlinkSync(path.join(libHooksDir, '.hook-version.json'));
    fs.unlinkSync(path.join(libHooksDir, 'lib', 'util', 'helper.mjs'));
    r = checkPluginHookSync(libOpts);
    assert.strictEqual(r.status, 'legacy_mismatch', '舊版無中繼資料且 lib 缺漏時應回報 legacy_mismatch');
    assert.ok(r.fileDiffs.some(d => d.file === 'lib/util/helper.mjs'));

    // (d) .hook-version.json 已記錄但實際已被刪除的 lib 檔案，即使外掛來源沒有 lib/ 也要標示
    const metaOnlyHome = path.join(sandbox, 'meta-only-home');
    const metaOnlyPlugin = path.join(sandbox, 'meta-only-plugin');
    const metaOnlyHooks = path.join(metaOnlyHome, '.gemini', 'antigravity-cli', 'hooks');
    writePluginDir(metaOnlyPlugin, '1.12.0', baseEntryFiles);
    writeHooksDir(metaOnlyHooks, baseEntryFiles, {
      pluginVersion: '1.12.0',
      files: { 'lib/gone.mjs': sha256('export const gone = 1;\n') }
    });
    r = checkPluginHookSync({ home: metaOnlyHome, hooksDir: metaOnlyHooks, installedPluginDir: metaOnlyPlugin, currentPluginDir: missingPluginDir });
    assert.strictEqual(r.status, 'content_mismatch');
    assert.ok(r.fileDiffs.some(d => d.file === 'lib/gone.mjs' && d.reason === 'missing_in_hooks'));

    // ---- 5. 無 lib/ 的精簡外掛夾具：零誤報 ----
    const minHome = path.join(sandbox, 'min-home');
    const minPlugin = path.join(sandbox, 'min-plugin');
    const minHooks = path.join(minHome, '.gemini', 'antigravity-cli', 'hooks');
    writePluginDir(minPlugin, '1.12.0', baseEntryFiles);
    writeHooksDir(minHooks, baseEntryFiles, { pluginVersion: '1.12.0' });
    r = checkPluginHookSync({ home: minHome, hooksDir: minHooks, installedPluginDir: minPlugin, currentPluginDir: missingPluginDir });
    assert.strictEqual(r.status, 'in_sync', '精簡外掛夾具（無 lib/）不得產生誤報');
    assert.deepStrictEqual(r.fileDiffs, [], '精簡外掛夾具的 fileDiffs 必須為空');

    // 精簡外掛夾具 + 掛鉤端已有額外 lib/ 檔案 → 仍為 in_sync（不以掛鉤端額外檔案作為差異）
    fs.mkdirSync(path.join(minHooks, 'lib', 'core'), { recursive: true });
    fs.writeFileSync(path.join(minHooks, 'lib', 'core', 'constants.mjs'), 'export const EXTRA = 1;\n', 'utf8');
    r = checkPluginHookSync({ home: minHome, hooksDir: minHooks, installedPluginDir: minPlugin, currentPluginDir: missingPluginDir });
    assert.strictEqual(r.status, 'in_sync');
    assert.deepStrictEqual(r.fileDiffs, []);

    // 精簡外掛夾具 + 空的 hooks/lib/ 目錄（無 .mjs）→ 仍為 in_sync
    const emptyLibHome = path.join(sandbox, 'empty-lib-home');
    const emptyLibHooks = path.join(emptyLibHome, '.gemini', 'antigravity-cli', 'hooks');
    writeHooksDir(emptyLibHooks, baseEntryFiles, { pluginVersion: '1.12.0' });
    fs.mkdirSync(path.join(emptyLibHooks, 'lib'), { recursive: true });
    r = checkPluginHookSync({ home: emptyLibHome, hooksDir: emptyLibHooks, installedPluginDir: minPlugin, currentPluginDir: missingPluginDir });
    assert.strictEqual(r.status, 'in_sync');
    assert.deepStrictEqual(r.fileDiffs, []);

    console.log('✅ 測試情境 18 通過！');
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
    await testCase13NonDestructiveConfigAndLegacyCleanup();
    await testCase14LegacyWindowsShBridgeRemoval();
    await testCase15HookVersionAndPluginHookSync();
    await testCase16RecursiveHookLibDeployment();
    await testCase17IsDirectExecutionAndDiagnoseCli();
    await testCase18CheckPluginHookSyncAudit5();
    console.log('\n🎉 所有跨平台整合測試皆已成功通過！');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 測試執行失敗:', error);
    process.exit(1);
  }
}

runAllTests();
