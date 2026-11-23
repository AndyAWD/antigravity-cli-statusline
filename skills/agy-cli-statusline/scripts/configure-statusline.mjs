import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { HOOK_VERSION, PLUGIN_PACKAGE_NAME } from './lib/core/constants.mjs';
import {
  deployCliHooksFromPluginSync as coreDeployCliHooksSync,
  updateSingleSettingsAtomicSync
} from './lib/core/cli-deploy.mjs';
import {
  isDirectExecution as coreIsDirectExecution
} from './lib/core/fs-utils.mjs';
import {
  isInGitProject,
  safeCopySync,
  safeRemoveSync,
  cleanupLegacyWindowsShBridge
} from './lib/core/safe-cleanup.mjs';
import { normalizeLanguage, normalizeLabelStyle } from './lib/core/normalize.mjs';
import { getStatusLineCommand } from './lib/core/settings.mjs';
import { ALL_STANDARD_METRIC_IDS } from './lib/metrics/registry.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sourceDir = __dirname;

export {
  normalizeLabelStyle,
  cleanupLegacyWindowsShBridge,
  getStatusLineCommand,
  ALL_STANDARD_METRIC_IDS
};

// ==========================================
// 排序與樣式解析 (Order & Style Parsing)
// ==========================================

/**
 * 解析使用者輸入之排序字串與個別樣式前綴（e/t/純數字/識別碼/換行）。
 * @param {string} orderStr
 * @param {string[]} selectedIds
 * @returns {{ items: string[], itemStyles: Record<string, string> }}
 */
export function parseOrderAndStyles(orderStr, selectedIds) {
  let items = [];
  let itemStyles = {};
  const seen = new Set();
  const isDefaultOrder = !orderStr || orderStr.trim() === '' || orderStr.includes('(Recommended)') || orderStr.includes('略過') || orderStr.includes('跳过') || orderStr.toLowerCase().includes('skip') || orderStr.includes('スキップ');

  if (isDefaultOrder) {
    items = [...selectedIds];
    return { items, itemStyles };
  }

  // 1. 正規化全形字元、全形標點符號與空格，並剝除可能包覆陣列的外層方括號
  let s = orderStr
    .trim()
    .replace(/^\[\s*/, '')
    .replace(/\s*\]$/, '')
    .replace(/[\uFF01-\uFF5E]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .replace(/[\u3001，；;]/g, ',');

  // 2. 預處理換行
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 3. 切割主要區塊（以逗號或換行優先切割）
  const rawChunks = s.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);

  for (const chunk of rawChunks) {
    // 檢查此 chunk 是否包含完整選項括號或帶括號之識別碼，例如：
    // "1. 🤖 目前使用的人工智慧模型名稱（model-name）"
    // "e: 1. 🤖 目前使用的人工智慧模型名稱（model-name）"
    // "e: (quota)"
    const parenMatch = chunk.match(/[\(（]([a-z0-9\-_]+)[\)）]/i);
    if (parenMatch) {
      const candidateId = parenMatch[1].toLowerCase();
      const found = selectedIds.find(id => id.toLowerCase() === candidateId);
      if (found && !seen.has(found)) {
        seen.add(found);
        items.push(found);
        // 判定 chunk 開頭是否指定 emoji
        if (/^([eE][:_\-\s]|([eE]\d+[\.\s:]?))/i.test(chunk)) {
          itemStyles[found] = 'emoji';
        }
        continue;
      }
    }

    // 若非括號選項，正規化該 chunk 中的前綴空格
    const sub = chunk
      .replace(/\b([teTE])\s*[:_\-]\s*/g, '$1:')
      .replace(/\b([teTE])\s+(\d+)\b/g, '$1$2')
      .replace(/\b([teTE])\s+([a-zA-Z0-9\-_]+)\b/g, '$1:$2');

    // 切割為單一 token（支援純空格分隔，如 "2 1 3" 或 "e1 t2 e3"）
    const tokens = sub.split(/\s+/).map(x => x.trim()).filter(Boolean);

    for (let part of tokens) {
      // 剝除頭尾標點符號與方括號（如點號、逗號、冒號、方括號等，但保留中間的冒號/連字號）
      part = part.replace(/^[[.,:;]+|[\].,:;]+$/g, '');
      if (!part) continue;

      if (part.toLowerCase() === 'n' || part.toLowerCase() === 'newline') {
        items.push('n');
        continue;
      }

      let matchedId = null;
      let style = 'text';

      // A. 檢查具前綴之數字編號，例如 e1, t1, e:1, t:1, e-1, t_1 (大小寫不分)
      const prefixNumMatch = part.match(/^([teTE])[:_\-]?(\d+)$/);
      if (prefixNumMatch) {
        const prefix = prefixNumMatch[1].toLowerCase();
        const num = parseInt(prefixNumMatch[2], 10);
        if (num >= 1 && num <= selectedIds.length) {
          matchedId = selectedIds[num - 1];
          style = (prefix === 'e') ? 'emoji' : 'text';
        } else if (num >= 1 && num <= ALL_STANDARD_METRIC_IDS.length) {
          const standardCandidate = ALL_STANDARD_METRIC_IDS[num - 1];
          if (selectedIds.includes(standardCandidate)) {
            matchedId = standardCandidate;
            style = (prefix === 'e') ? 'emoji' : 'text';
          }
        }
      }

      // B. 檢查純數字編號，例如 1, 2
      if (!matchedId) {
        const pureNumMatch = part.match(/^(\d+)$/);
        if (pureNumMatch) {
          const num = parseInt(pureNumMatch[1], 10);
          if (num >= 1 && num <= selectedIds.length) {
            matchedId = selectedIds[num - 1];
            style = 'text';
          } else if (num >= 1 && num <= ALL_STANDARD_METRIC_IDS.length) {
            const standardCandidate = ALL_STANDARD_METRIC_IDS[num - 1];
            if (selectedIds.includes(standardCandidate)) {
              matchedId = standardCandidate;
              style = 'text';
            }
          }
        }
      }

      // C. 檢查具前綴之英文識別碼，例如 e:quota, t:quota, e-quota, t_quota (大小寫不分)
      if (!matchedId) {
        const prefixIdMatch = part.match(/^([teTE])[:_\-](.+)$/);
        if (prefixIdMatch) {
          const prefix = prefixIdMatch[1].toLowerCase();
          const candidateId = prefixIdMatch[2].toLowerCase().trim();
          const found = selectedIds.find(id => id.toLowerCase() === candidateId);
          if (found) {
            matchedId = found;
            style = (prefix === 'e') ? 'emoji' : 'text';
          }
        }
      }

      // D. 檢查純英文識別碼，例如 quota, model-name (大小寫不分)
      if (!matchedId) {
        const found = selectedIds.find(id => id.toLowerCase() === part.toLowerCase());
        if (found) {
          matchedId = found;
          style = 'text';
        }
      }

      if (matchedId && !seen.has(matchedId)) {
        seen.add(matchedId);
        items.push(matchedId);
        if (style === 'emoji') {
          itemStyles[matchedId] = 'emoji';
        }
      }
    }
  }

  // 防禦：若使用者點選「手動排序」但未在 Write-in 填入任何有效指標，避免清空狀態列
  if (items.length === 0) {
    items = [...selectedIds];
    itemStyles = {};
  }
  // 防禦：若 --selected 亦為空陣列，回退至核心標準指標，避免寫入空陣列清空狀態列
  if (items.length === 0) {
    items = ['model-name', 'quota', 'context-used', 'memory-usage'];
    itemStyles = {};
  }

  return { items, itemStyles };
}

// ==========================================
// 清理與部署步驟輔助函式 (Cleanup & Deployment Helpers)
// ==========================================

/**
 * 備份並安全移除舊版全域技能目錄（~/.gemini/skills/antigravity-cli-statusline）。
 * @param {string} homeDir
 */
function cleanupLegacyGlobalSkillDir(homeDir) {
  const oldGlobalSkillDir = path.join(homeDir, '.gemini', 'skills', PLUGIN_PACKAGE_NAME);
  const oldGlobalSkillBak = path.join(homeDir, '.gemini', 'skills', `${PLUGIN_PACKAGE_NAME}.bak`);

  let oldDirExists = false;
  try {
    fs.lstatSync(oldGlobalSkillDir);
    oldDirExists = true;
  } catch (_) {}

  if (!oldDirExists) return;

  console.log(`[Clean Up] 偵測到舊的全域技能目錄: ${oldGlobalSkillDir}`);
  try {
    // 安全移除既有的備份目錄/連結
    safeRemoveSync(oldGlobalSkillBak);

    console.log(`[Clean Up] 正在備份至: ${oldGlobalSkillBak}`);
    try {
      // 優先嘗試不可分割的重新命名（Rename）操作
      fs.renameSync(oldGlobalSkillDir, oldGlobalSkillBak);
    } catch (_) {
      // 若跨磁碟分區或其他限制導致 rename 失敗，則執行安全複製與安全刪除
      safeCopySync(oldGlobalSkillDir, oldGlobalSkillBak);
      safeRemoveSync(oldGlobalSkillDir);
    }
    console.log('[Clean Up] 舊的全域技能目錄已安全備份並移除。');
  } catch (err) {
    console.error('[Clean Up] 備份/移除舊的全域技能目錄失敗:', err);
    if (err.message && err.message.includes('[Security Violation]')) {
      process.exit(1);
    }
  }
}

/**
 * 安全清理舊版遺留於外掛與腳本目錄的冗餘 questions.json。
 * @param {string} homeDir
 */
function cleanupRedundantQuestionsJson(homeDir) {
  const redundantQuestionsPaths = [
    path.join(__dirname, 'questions.json'),
    path.join(__dirname, '..', 'questions.json'),
    path.join(homeDir, '.gemini', 'config', 'plugins', PLUGIN_PACKAGE_NAME, 'skills', PLUGIN_PACKAGE_NAME, 'questions.json'),
    path.join(homeDir, '.gemini', 'config', 'plugins', PLUGIN_PACKAGE_NAME, 'skills', 'agy-cli-statusline', 'questions.json')
  ];

  for (const qPath of redundantQuestionsPaths) {
    let qExists = false;
    try {
      fs.lstatSync(qPath);
      qExists = true;
    } catch (_) {}

    if (!qExists) continue;

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

/**
 * 解析設定腳本 CLI 參數並產出標準化設定結構。
 * @param {string[]} argv
 */
function parseCliConfiguration(argv) {
  let lang = 'zh-tw';
  let selectedStr = '[]';
  let orderStr = '';
  let workspacePath = '';
  let timeFormat = '';
  let barLength = 0;
  let labelStyle = '';
  let itemStylesStr = '';

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--lang' && argv[i + 1]) {
      lang = argv[i + 1];
      i++;
    } else if (argv[i] === '--selected' && argv[i + 1]) {
      selectedStr = argv[i + 1];
      i++;
    } else if (argv[i] === '--order' && argv[i + 1]) {
      orderStr = argv[i + 1];
      i++;
    } else if (argv[i] === '--workspace' && argv[i + 1]) {
      workspacePath = argv[i + 1];
      i++;
    } else if (argv[i] === '--time-format' && argv[i + 1]) {
      timeFormat = argv[i + 1];
      i++;
    } else if (argv[i] === '--bar-length' && argv[i + 1]) {
      barLength = parseInt(argv[i + 1], 10);
      i++;
    } else if ((argv[i] === '--style' || argv[i] === '--label-style') && argv[i + 1]) {
      labelStyle = argv[i + 1];
      i++;
    } else if (argv[i] === '--item-styles' && argv[i + 1]) {
      itemStylesStr = argv[i + 1];
      i++;
    }
  }

  lang = normalizeLanguage(lang);
  if (labelStyle) {
    labelStyle = normalizeLabelStyle(labelStyle);
  }

  let selectedList = [];
  try {
    selectedList = JSON.parse(selectedStr.replace(/^\uFEFF/, ''));
  } catch (e) {
    console.error('解析 --selected JSON 字串失敗：', e);
  }

  // 提取英文識別碼
  const selectedIds = selectedList.map(item => {
    if (typeof item !== 'string') return item;
    const match = item.match(/[\(（]([^）\)]+)[\)）]\s*$/);
    return match ? match[1].trim() : item.trim();
  });

  const parsed = parseOrderAndStyles(orderStr, selectedIds);
  const items = parsed.items;
  let itemStyles = parsed.itemStyles;

  if (itemStylesStr) {
    try {
      const customStyles = JSON.parse(itemStylesStr.replace(/^\uFEFF/, ''));
      if (typeof customStyles === 'object' && customStyles !== null && !Array.isArray(customStyles)) {
        itemStyles = { ...itemStyles, ...customStyles };
      }
    } catch (e) {
      console.error('解析 --item-styles JSON 字串失敗：', e);
    }
  }

  console.log('已解析的參數：');
  console.log(`- 語言：${lang}`);
  if (labelStyle) console.log(`- 標籤樣式：${labelStyle}`);
  console.log(`- 已選項目：${selectedStr}`);
  console.log(`- 排序順序：${orderStr}`);
  console.log('- 指標清單：', items);
  console.log('- 個別樣式 (itemStyles)：', itemStyles);
  console.log(`- 工作區：${workspacePath}`);
  if (timeFormat) console.log(`- 時間格式：${timeFormat}`);
  if (barLength) console.log(`- 長條圖長度：${barLength}`);

  return { lang, items, itemStyles, workspacePath, timeFormat, barLength, labelStyle };
}

/**
 * 部署狀態列掛鉤主程式、遞迴 lib/ 模組與 .hook-version.json 中繼資料。
 * @param {string} homeDir
 * @returns {string} hooksDir
 */
function deployHookScripts(homeDir) {
  const hooksDir = path.join(homeDir, '.gemini', 'antigravity-cli', 'hooks');
  console.log(`正在部署掛鉤腳本至 ${hooksDir}...`);

  const statuslineQuotaSrcPath = path.join(sourceDir, 'statusline-quota.mjs');
  const fetchLocalQuotaSrcPath = path.join(sourceDir, 'fetch-local-quota.mjs');
  if (!fs.existsSync(statuslineQuotaSrcPath) || !fs.existsSync(fetchLocalQuotaSrcPath)) {
    console.error('在以下目錄找不到掛鉤腳本來源：', sourceDir);
    process.exit(1);
  }

  const pluginRootDir = path.resolve(sourceDir, '..', '..', '..');
  coreDeployCliHooksSync({
    homeDir,
    srcScriptsDir: sourceDir,
    pluginRootDir,
    fallbackPluginVersion: HOOK_VERSION,
    onWarn: (msg) => console.warn(msg)
  });

  console.log('掛鉤腳本部署成功。');
  return hooksDir;
}

/**
 * 清理舊版遺留於 ~/.gemini/hooks/ 的同名腳本（保留其他使用者檔案）。
 * @param {string} homeDir
 */
function cleanupLegacyHooksDir(homeDir) {
  const legacyHooksDir = path.join(homeDir, '.gemini', 'hooks');
  for (const legacyFile of ['statusline-quota.mjs', 'fetch-local-quota.mjs']) {
    const legacyPath = path.join(legacyHooksDir, legacyFile);
    try {
      if (fs.existsSync(legacyPath) && !isInGitProject(legacyPath)) {
        fs.unlinkSync(legacyPath);
        console.log(`[Clean Up] 已自動清理舊版遺留腳本: ${legacyPath}`);
      }
    } catch (_) {}
  }
}

/**
 * 安全更新單一 settings.json（防禦 BOM 與損壞設定檔，保留既有欄位）。
 * @param {string} settingsPath
 * @param {object} config
 * @param {string} statusLineCommand
 */
function updateSettingsFile(settingsPath, config, statusLineCommand) {
  console.log(`正在更新設定檔：${settingsPath}`);
  try {
    updateSingleSettingsAtomicSync(settingsPath, config, {
      statusLineCommand,
      updateStatusLine: true,
      preserveExistingStatuslineCommand: false,
      useR27StyleNormalization: false
    });
  } catch (err) {
    console.warn(`更新設定檔 ${settingsPath} 時略過（${err.message}）。可於 CLI 輸入 /statusline ${statusLineCommand} 手動套用。`);
  }
}

// ==========================================
// 主執行流程 (Main Execution)
// ==========================================

export function main() {
  const homeDir = os.homedir();

  cleanupLegacyGlobalSkillDir(homeDir);
  cleanupRedundantQuestionsJson(homeDir);

  // 1 & 2. 解析命令列參數、排序與個別樣式規則
  const config = parseCliConfiguration(process.argv);

  // 3. 部署掛鉤（Hook）腳本與模組
  const hooksDir = deployHookScripts(homeDir);

  // 4. 三層 settings.json 寫入與防禦位元組順序記號（BOM）鐵則
  const statuslineQuotaMjsPath = path.join(hooksDir, 'statusline-quota.mjs');
  const statusLineCommand = getStatusLineCommand(statuslineQuotaMjsPath);

  cleanupLegacyHooksDir(homeDir);

  // 寫入全域與 CLI 專屬 settings.json
  const globalSettingsPath = path.join(homeDir, '.gemini', 'settings.json');
  const cliSettingsPath = path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json');

  updateSettingsFile(globalSettingsPath, config, statusLineCommand);
  updateSettingsFile(cliSettingsPath, config, statusLineCommand);

  // 寫入專案層 settings.json（如果符合條件）
  if (config.workspacePath) {
    const projectGeminiDir = path.join(config.workspacePath, '.gemini');
    const projectSettingsPath = path.join(projectGeminiDir, 'settings.json');
    if (fs.existsSync(projectGeminiDir) || fs.existsSync(projectSettingsPath)) {
      updateSettingsFile(projectSettingsPath, config, statusLineCommand);
    }
  }

  console.log(`狀態列執行指令：/statusline ${statusLineCommand}`);

  // 6. 移除舊版 Windows sh.exe 相容橋接器（agy v1.3.5+ 已改用 cmd /c 原生執行，停止編譯未簽署 sh.exe 以避免 Symantec 誤報）
  cleanupLegacyWindowsShBridge(process.env.LOCALAPPDATA);

  console.log('設定成功完成！');
}

export function isDirectExecution(options = {}) {
  return coreIsDirectExecution(import.meta.url, { treatEmptyArgv1AsDirect: false, ...options });
}

if (isDirectExecution()) {
  main();
}
