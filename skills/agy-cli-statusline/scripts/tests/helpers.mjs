// 測試共用沙箱輔助函式：所有 scripts/tests/*.test.mjs 皆從此處取得 sandbox、子程序執行與 ANSI 工具。
// 路徑深度：tests/ -> scripts/ 為 `../`，tests/ -> 專案根目錄為 `../../../..`。
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** scripts/ 目錄（entry scripts 與 lib/ 所在位置） */
export const SCRIPTS_DIR = path.resolve(__dirname, '..');
/** skill 目錄（skills/agy-cli-statusline） */
export const SKILL_DIR = path.resolve(__dirname, '..', '..');
/** 專案根目錄 */
export const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

export const SCRIPT_PATH = path.join(SCRIPTS_DIR, 'statusline-quota.mjs');
export const FETCH_SCRIPT_PATH = path.join(SCRIPTS_DIR, 'fetch-local-quota.mjs');
export const CONFIGURE_SCRIPT_PATH = path.join(SCRIPTS_DIR, 'configure-statusline.mjs');
export const DIAGNOSE_SCRIPT_PATH = path.join(SCRIPTS_DIR, 'diagnose-statusline.mjs');

export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const BLUE = '\x1b[38;2;87;202;255m';
export const GREEN = '\x1b[38;2;92;219;109m';
export const YELLOW = '\x1b[38;2;255;212;39m';
export const RED = '\x1b[38;2;255;125;175m';
export const WHITE = '\x1b[38;2;255;255;255m';
export const BLUE_BOLD = `${BLUE}${BOLD}`;
export const GREEN_BOLD = `${GREEN}${BOLD}`;

/** 與 lib/renderers/ansi.mjs 獨立的 ANSI 去除函式，避免測試依賴被測模組本身 */
export function stripAnsi(str) {
  return String(str).replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

export function escapeRegex(string) {
  return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

export function getColorByCount(n) {
  if (n === 0) return BLUE;
  if (n <= 2) return GREEN;
  if (n <= 4) return YELLOW;
  return RED;
}

/**
 * 以重新導向的 HOME 與專案目錄執行 statusline 腳本。
 * @param {object|string} stdinData - 寫入 stdin 的 Meta payload
 * @param {string} homeDir - 隔離用的暫存 HOME
 * @param {string} [scriptPath] - 腳本路徑（預設為 statusline-quota.mjs）
 * @param {object} [extraEnv] - 額外環境變數
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function runStatusline(stdinData, homeDir, scriptPath = SCRIPT_PATH, extraEnv = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir, STATUSLINE_QUOTA_WAIT_MS: '800' };
    delete env.DISABLE_QUOTA_HOOK;            // explicit unset — Finding #1
    delete env.ANTIGRAVITY_LS_ADDRESS;        // prevent test isolation leak from parent agent shell
    delete env.ANTIGRAVITY_CSRF_TOKEN;
    Object.assign(env, extraEnv);
    const child = spawn('node', [scriptPath], {
      env,
      cwd: homeDir,                            // project settings resolve under temp home — Finding #2
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.stdin.write(typeof stdinData === 'string' ? stdinData : JSON.stringify(stdinData));
    child.stdin.end();
  });
}

/**
 * 建立含模擬快取與設定的隔離 HOME。
 * @param {object} cache - real_quota_cache.json 內容
 * @param {object} settings - settings.json 內容
 * @returns {string} 暫存 HOME 路徑
 */
export function makeTempHome(cache, settings) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-weekly-'));
  fs.mkdirSync(path.join(home, '.gemini', 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(home, '.gemini', 'tmp', 'real_quota_cache.json'), JSON.stringify(cache), 'utf8');
  fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), JSON.stringify(settings), 'utf8');
  return home;
}

/** os.homedir() 在 Windows 讀 USERPROFILE，其餘平台讀 HOME，因此兩者皆覆寫 */
export async function withHomeEnv(home, fn) {
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return await fn();
  } finally {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
  }
}

/**
 * 以 node 子程序執行任意腳本。
 * @param {string} scriptPath
 * @param {string[]} args
 * @param {object} env - 覆蓋用環境變數
 * @param {object} [options] - { cwd }
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function runScript(scriptPath, args = [], env = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: { ...process.env, ...env },
      ...(options.cwd ? { cwd: options.cwd } : {}),
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (err) => reject(err));
  });
}

/** 遞迴刪除資料夾（無第三方依賴；符號連結只移除連結本身） */
export function rmRfSync(dirPath) {
  let stats;
  try {
    stats = fs.lstatSync(dirPath);
  } catch (err) {
    if (err.code === 'ENOENT') return;
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
      rmRfSync(path.join(dirPath, file));
    });
    fs.rmdirSync(dirPath);
  } else {
    fs.unlinkSync(dirPath);
  }
}

/** 複製檔案並確保目的地父目錄存在 */
export function copyFileEnsureDirSync(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/** 遞迴複製目錄（含子目錄），僅複製一般檔案 */
export function copyDirRecursiveSync(srcDir, dstDir, filter = () => true) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursiveSync(srcPath, dstPath, filter);
    } else if (entry.isFile() && filter(srcPath)) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

/**
 * 將 scripts/ 下的頂層 .mjs entry scripts 與 lib/ 目錄遞迴複製到沙箱，
 * 讓複製後的 entry script 之 `./lib/...` 相對匯入可正常解析。
 * @param {string} srcScriptsDir - 來源 scripts 目錄
 * @param {string} dstScriptsDir - 目的 scripts 目錄（自動建立）
 */
export function copyScriptsWithLib(srcScriptsDir, dstScriptsDir) {
  fs.mkdirSync(dstScriptsDir, { recursive: true });
  for (const entry of fs.readdirSync(srcScriptsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) {
      fs.copyFileSync(path.join(srcScriptsDir, entry.name), path.join(dstScriptsDir, entry.name));
    }
  }
  const srcLib = path.join(srcScriptsDir, 'lib');
  if (fs.existsSync(srcLib)) {
    copyDirRecursiveSync(srcLib, path.join(dstScriptsDir, 'lib'), (p) => p.endsWith('.mjs'));
  }
}
