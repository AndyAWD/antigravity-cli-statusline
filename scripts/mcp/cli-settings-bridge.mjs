import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deployCliHooksFromPluginSync,
  isPathWithinOrEqual,
  updateSingleSettingsAtomicSync
} from '../../skills/agy-cli-statusline/scripts/lib/core/cli-deploy.mjs';
import {
  normalizeLabelStyle,
  normalizeLanguage
} from '../../skills/agy-cli-statusline/scripts/lib/core/normalize.mjs';
import { getStatusLineCommand } from '../../skills/agy-cli-statusline/scripts/lib/core/settings.mjs';
import { formatOrderExpressions } from '../../skills/agy-cli-statusline/scripts/lib/metrics/layout-utils.mjs';
import {
  ALL_STANDARD_METRIC_IDS,
  SUPPORTED_LOCALES
} from '../../skills/agy-cli-statusline/scripts/lib/metrics/registry.mjs';

export { formatOrderExpressions };

const STANDARD_ID_SET = new Set(ALL_STANDARD_METRIC_IDS);
const VALID_TIME_FORMATS = new Set(['smart', 'auto', 'full', 'yyyy/MM/dd HH:mm', '24h', '12h']);

/**
 * 嚴格驗證並正規化前端傳入的狀態列排版設定。
 * @param {object} raw
 */
export function validateCliLayoutInput(raw = {}) {
  const langNorm = normalizeLanguage(raw.lang || 'zh-tw');
  const lang = SUPPORTED_LOCALES.includes(langNorm) ? langNorm : 'zh-tw';
  const labelStyle = normalizeLabelStyle(raw.labelStyle || 'text');

  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  const items = [];
  const seenMetrics = new Set();
  for (const item of rawItems) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed === 'n' || trimmed === 'newline') {
      items.push('n');
      continue;
    }
    if (STANDARD_ID_SET.has(trimmed) && !seenMetrics.has(trimmed)) {
      seenMetrics.add(trimmed);
      items.push(trimmed);
    }
  }
  if (items.filter(x => x !== 'n').length === 0) {
    items.push('model-name', 'quota', 'context-used', 'memory-usage');
  }

  const itemStyles = {};
  if (raw.itemStyles && typeof raw.itemStyles === 'object' && !Array.isArray(raw.itemStyles)) {
    for (const [k, v] of Object.entries(raw.itemStyles)) {
      if (!STANDARD_ID_SET.has(k)) continue;
      const st = normalizeLabelStyle(v);
      if (st === 'emoji' || st === 'text') {
        itemStyles[k] = st;
      }
    }
  }

  const rawTf = typeof raw.timeFormat === 'string' ? raw.timeFormat.trim() : 'smart';
  const timeFormat = VALID_TIME_FORMATS.has(rawTf) ? rawTf : 'smart';

  const parsedBar = parseInt(raw.barLength, 10);
  const barLength = (!isNaN(parsedBar) && parsedBar >= 1 && parsedBar <= 50) ? parsedBar : 10;

  return { lang, items, itemStyles, labelStyle, timeFormat, barLength };
}

/**
 * 尋找系統獨立 Node.js 執行檔（排除 Electron / .app / Antigravity 內嵌執行檔）。
 */
export function resolveSafeSystemNodeExecPath(platform = process.platform, execPath = process.execPath) {
  if (platform === 'win32') return execPath;
  const isEmbedded = (p) => {
    const lower = String(p || '').toLowerCase();
    return lower.includes('.app/') || lower.includes('electron') || lower.includes('antigravity');
  };
  const candidates = [
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node'
  ];
  if (execPath && !isEmbedded(execPath)) {
    candidates.unshift(execPath);
  }
  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        return cand;
      }
    } catch (_) {}
  }
  return execPath;
}

/**
 * 原子安全寫入三層 CLI settings.json（僅鎖定白名單目標路徑），並可選同步部署 CLI 掛鉤。
 */
export function saveCliSettingsAtomicSync({
  homeDir = os.homedir(),
  pluginRootDir,
  workspacePath = '',
  knownWorkspaces = null,
  config,
  deployHooks = false,
  updateStatusLine = deployHooks
}) {
  const validated = validateCliLayoutInput(config);
  let safeCommand = '';
  let hooksDir = '';

  if (deployHooks) {
    const srcScriptsDir = path.join(pluginRootDir, 'skills', 'agy-cli-statusline', 'scripts');
    hooksDir = deployCliHooksFromPluginSync({
      homeDir,
      srcScriptsDir,
      pluginRootDir
    });
    if (updateStatusLine) {
      const statuslineScript = path.join(hooksDir, 'statusline-quota.mjs');
      const safeNode = resolveSafeSystemNodeExecPath();
      safeCommand = getStatusLineCommand(statuslineScript, process.platform, safeNode);
    }
  }

  const targets = [
    path.join(homeDir, '.gemini', 'settings.json'),
    path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json')
  ];

  const geminiRoot = path.join(homeDir, '.gemini');
  const normalizedKnown = Array.isArray(knownWorkspaces)
    ? new Set(knownWorkspaces.filter(w => typeof w === 'string' && w.trim()).map(w => path.resolve(w)))
    : null;
  const isWorkspaceAllowed = !normalizedKnown || normalizedKnown.has(path.resolve(workspacePath || ''));

  if (
    workspacePath &&
    typeof workspacePath === 'string' &&
    isWorkspaceAllowed &&
    !isPathWithinOrEqual(workspacePath, pluginRootDir) &&
    !isPathWithinOrEqual(workspacePath, geminiRoot)
  ) {
    const projGeminiDir = path.join(workspacePath, '.gemini');
    const projSettingsPath = path.join(projGeminiDir, 'settings.json');
    if (fs.existsSync(projGeminiDir) || fs.existsSync(projSettingsPath)) {
      targets.push(projSettingsPath);
    }
  }

  const results = targets.map(t => updateSingleSettingsAtomicSync(t, validated, {
    statusLineCommand: safeCommand,
    updateStatusLine: Boolean(deployHooks && updateStatusLine && safeCommand),
    preserveExistingStatuslineCommand: true,
    useR27StyleNormalization: true
  }));
  return {
    config: validated,
    deployHooks,
    hooksDir,
    results,
    orderExpressions: formatOrderExpressions(validated.items, validated.itemStyles, validated.labelStyle)
  };
}
