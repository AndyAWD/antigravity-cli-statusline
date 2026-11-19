import { promises as fs } from 'fs';
import os from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

/**
 * 從標準輸入（stdin）讀取中繼資料字串（附帶 300 毫秒逾時保護）。
 * @param {number} [timeoutMs=300]
 * @returns {Promise<string>}
 */
export async function readStdin(timeoutMs = 300) {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * 依中繼資料候選欄位解析目前工作區專案目錄（支援 file:// URI 自動轉換）。
 * @param {object} [meta]
 * @returns {string}
 */
export function resolveProjectPath(meta) {
  const candidates = [
    meta?.project?.path,
    meta?.workspace?.project_dir,
    meta?.workspace?.current_dir,
    meta?.cwd
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      const cleaned = c.trim();
      if (cleaned.startsWith('file://')) {
        try {
          return fileURLToPath(cleaned);
        } catch (_) {}
      }
      return cleaned;
    }
  }
  return process.cwd();
}

/**
 * 非同步讀取並合併三層設定檔（全域 -> CLI 專屬 -> 專案層），並自動清除遺留干擾欄位。
 * @param {object} [meta]
 * @param {{ homeDir?: string }} [options]
 * @returns {Promise<object>}
 */
export async function getSettingsAsync(meta, options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const globalPath = join(homeDir, '.gemini', 'settings.json');
  const cliPath = join(homeDir, '.gemini', 'antigravity-cli', 'settings.json');
  const projectDir = resolveProjectPath(meta);
  const projectPath = join(projectDir, '.gemini', 'settings.json');
  let settings = {};

  try {
    const globalContent = await fs.readFile(globalPath, 'utf8');
    const parsed = JSON.parse(globalContent.replace(/^\uFEFF/, ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      settings = parsed;
    }
  } catch (_) {}

  try {
    const cliContent = await fs.readFile(cliPath, 'utf8');
    const cliSettings = JSON.parse(cliContent.replace(/^\uFEFF/, ''));
    if (cliSettings && typeof cliSettings === 'object' && !Array.isArray(cliSettings)) {
      settings = { ...settings, ...cliSettings };
      if (cliSettings.ui) {
        settings.ui = { ...settings.ui, ...cliSettings.ui };
        if (cliSettings.ui.footer) {
          settings.ui.footer = { ...settings.ui.footer, ...cliSettings.ui.footer };
        }
      }
    }
  } catch (_) {}

  try {
    const projContent = await fs.readFile(projectPath, 'utf8');
    const projSettings = JSON.parse(projContent.replace(/^\uFEFF/, ''));
    if (projSettings && typeof projSettings === 'object' && !Array.isArray(projSettings)) {
      settings = { ...settings, ...projSettings };
      if (projSettings.ui) {
        settings.ui = { ...settings.ui, ...projSettings.ui };
        if (projSettings.ui.footer) {
          settings.ui.footer = { ...settings.ui.footer, ...projSettings.ui.footer };
        }
      }
    }
  } catch (_) {}

  // 防禦：若設定檔中遺留測試主題（如 dino 或非標準屬性），主動清除以避免干擾
  if (settings?.ui?.footer?.theme) {
    delete settings.ui.footer.theme;
  }
  if (settings?.ui?.footer?.style) {
    delete settings.ui.footer.style;
  }
  if (settings?.ui?.labelStyle) {
    delete settings.ui.labelStyle;
  }

  return settings;
}

/**
 * 計算狀態列可用渲染寬度（優先取 meta.terminal_width，啟動預設值 80 時退回快取寬度）。
 * @param {object} [meta]
 * @param {object} [cachedAccount={}]
 * @returns {number}
 */
export function resolveTerminalWidth(meta, cachedAccount = {}) {
  const rawWidth = typeof meta?.terminal_width === 'number' ? meta.terminal_width : 0;
  if (rawWidth > 80) {
    return Math.max(40, rawWidth - 15);
  }
  if (cachedAccount?.terminalWidth && cachedAccount.terminalWidth > 80) {
    return Math.max(40, cachedAccount.terminalWidth - 15);
  }
  if (rawWidth > 0) {
    return Math.max(40, rawWidth - 15);
  }
  const fallbackCols = process.stdout?.columns || 135;
  return Math.max(40, fallbackCols - 15);
}

/**
 * 依作業系統產生最穩定的 statusLine.command 執行指令字串：
 * - Windows：不可含任何雙引號（避免 Go exec.Command("cmd", "/c", ...) 轉義為 \"）；
 *   無空格時為 `node <path>`，含空格時轉為 `node --import file:///... -e 0`。
 * - macOS / Linux：使用 Node.js 執行檔絕對路徑（process.execPath），含空格時以雙引號包覆。
 * @param {string} statuslineScriptPath
 * @param {string} [platform=process.platform]
 * @param {string} [execPath=process.execPath]
 * @returns {string}
 */
export function getStatusLineCommand(statuslineScriptPath, platform = process.platform, execPath = process.execPath) {
  const cleanPath = statuslineScriptPath.replace(/^"(.*)"$/, '$1');
  if (platform === 'win32') {
    if (cleanPath.includes(' ')) {
      const fileUrl = 'file:///' + cleanPath.replace(/\\/g, '/').replace(/^\//, '').replace(/ /g, '%20');
      return `node --import ${fileUrl} -e 0`;
    }
    return `node ${cleanPath}`;
  }
  const nodeBin = execPath.includes(' ') ? `"${execPath}"` : execPath;
  const scriptArg = cleanPath.includes(' ') ? `"${cleanPath}"` : cleanPath;
  return `${nodeBin} ${scriptArg}`;
}
