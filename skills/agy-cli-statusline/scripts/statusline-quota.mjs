import { promises as fs, realpathSync } from 'fs';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import path, { join, basename } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// ==========================================
// Constants & UI Styling
// ==========================================
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GRAY = "\x1b[90m";
const WHITE = "\x1b[38;2;255;255;255m";
const BLUE = "\x1b[38;2;87;202;255m";
const GREEN = "\x1b[38;2;92;219;109m";
const YELLOW = "\x1b[38;2;255;212;39m";
const RED = "\x1b[38;2;255;125;175m";

function getColorByPercentage(pct) {
  if (pct >= 75) return BLUE;
  if (pct >= 50) return GREEN;
  if (pct >= 25) return YELLOW;
  return RED;
}

function getColorByCount(n) {
  if (n === 0) return BLUE;
  if (n <= 2) return GREEN;
  if (n <= 4) return YELLOW;
  return RED;
}

function getModelColor(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('claude')) return "\x1b[38;2;221;80;19m";
  if (lower.includes('gemini')) return "\x1b[38;2;71;150;227m";
  if (lower.includes('gpt') || lower.includes('chatgpt')) return "\x1b[38;2;116;170;156m";
  return "";
}

function getVcsDirtyColor(dirty) { return dirty ? RED : GREEN; }
function getToolConfirmColor(pending) { return pending ? YELLOW : GREEN; }
function getAgentStateColor(state) {
  const s = (state || '').toLowerCase();
  if (s.includes('error') || s.includes('fail')) return RED;
  if (s.includes('busy') || s.includes('run') || s.includes('think')) return YELLOW;
  if (s.includes('idle') || s.includes('ready')) return GREEN;
  return BLUE;
}
function getSandboxColor(enabled, allowNet) {
  if (!enabled) return RED;
  return allowNet ? YELLOW : GREEN;
}

function getModeColor(mode) {
  const m = (mode || '').toLowerCase();
  if (m === 'plan') return GREEN;
  if (m === 'accept-edits') return YELLOW;
  if (m === 'default') return BLUE;
  return BLUE;
}

export function stripAnsi(str) {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

export function getDisplayWidth(str) {
  let width = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp === 0xFE0F || cp === 0xFE0E || cp === 0x200D || (cp >= 0x0300 && cp <= 0x036F)) continue;
    if (cp <= 0x7F) {
      width += 1;
    } else if (
      (cp >= 0x0080 && cp <= 0x024F) ||
      (cp >= 0x2500 && cp <= 0x259F) ||
      cp === 0x2713 || cp === 0x2714 || cp === 0x2717 || cp === 0x2718
    ) {
      width += 1;
    } else {
      width += 2;
    }
  }
  return width;
}

function formatTokens(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

function normalizeModelName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function safeGetCount(val) {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (Array.isArray(val)) return val.length;
  if (typeof val === 'string') {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function normalizeLanguage(lang) {
  if (!lang || typeof lang !== 'string') return 'zh-tw';
  let l = lang.toLowerCase().replace(/_/g, '-').trim();
  const parenMatch = l.match(/[\(（]([a-z0-9\-_]+)[\)）]/);
  if (parenMatch) {
    l = parenMatch[1].trim();
  }
  if (l === 'zh-cn' || l === 'cn' || l === 'zh-hans' || l === 'zh-sg' || l.startsWith('zh-cn') || l.startsWith('zh-hans') || l.includes('简体') || l.includes('簡體') || l.includes('simplified')) {
    return 'zh-cn';
  }
  if (l === 'zh-tw' || l === 'tw' || l === 'zh-hant' || l === 'zh-hk' || l === 'zh-mo' || l.startsWith('zh-tw') || l.startsWith('zh-hant') || l.includes('繁體') || l.includes('繁体') || l.includes('traditional')) {
    return 'zh-tw';
  }
  if (l === 'jp' || l === 'ja' || l === 'ja-jp' || l.startsWith('ja-') || l.includes('日本') || l.includes('japanese')) {
    return 'jp';
  }
  if (l === 'us' || l === 'en' || l === 'en-us' || l === 'en-gb' || l.startsWith('en-') || l.includes('english') || l.includes('英文')) {
    return 'us';
  }
  return l;
}

export function normalizeLabelStyle(style) {
  if (!style || typeof style !== 'string') return 'text';
  let s = style.toLowerCase().trim();
  const parenMatch = s.match(/[\(（]([a-z0-9\-_]+)[\)）]\s*$/);
  if (parenMatch) {
    s = parenMatch[1].trim();
  }
  if (s === 'emoji' || s === 'emojis' || s === 'icon' || s === 'icons' || s.includes('emoji') || s.includes('表情') || s.includes('圖示') || s.includes('图标') || s.includes('絵文字')) {
    return 'emoji';
  }
  return 'text';
}

export const EMOJI_MAP = {
  'model-name': '🤖',
  'quota': '🔋',
  'quota-bar': '🔋',
  'quota+bar': '🔋',
  'quota-reset-countdown': '⏳',
  'quota-reset-time': '🕒',
  'quota-weekly': '📅',
  'quota-weekly-bar': '📅',
  'quota-weekly+bar': '📅',
  'quota-weekly-countdown': '📆',
  'quota-weekly-reset-time': '⏰',
  'context-used': '🧠',
  'context-used-bar': '🧠',
  'context-used+bar': '🧠',
  'token-count': '🪙',
  'token-count-bar': '🪙',
  'token-count+bar': '🪙',
  'plan-tier': '💎',
  'account-email': '👤',
  'agent-state': '⚡',
  'tool-confirmation': '🔔',
  'pending-input': '📥',
  'background-tasks': '🔧',
  'subagents': '👥',
  'artifacts': '📄',
  'git-branch': '🌿',
  'vcs-dirty': '📝',
  'vcs-type': '🌱',
  'project-path': '📁',
  'project-full-path': '📂',
  'memory-usage': '💾',
  'sandbox-status': '🔒',
  'cli-version': '🚀',
  'conversation-id': '💬',
  'agent-profile': '🎭',
  'mode': '🧭'
};

// ==========================================
// System Information Retrieval
// ==========================================
const execAsync = promisify(exec);

function withTimeout(promise, ms, fallbackVal) {
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallbackVal), ms);
  });
  return Promise.race([
    promise.then((val) => {
      clearTimeout(timer);
      return val;
    }).catch(() => {
      clearTimeout(timer);
      return fallbackVal;
    }),
    timeoutPromise
  ]);
}

async function runCmdDetailedAsync(cmd, options = {}) {
  const defaultOpts = {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 500
  };
  try {
    const { stdout } = await execAsync(cmd, { ...defaultOpts, ...options });
    return { stdout: (stdout || '').trim(), ok: true, notFound: false };
  } catch (err) {
    const errMsg = `${err?.stderr || ''} ${err?.message || ''}`;
    const notFound =
      err?.code === 'ENOENT' ||
      err?.code === 127 ||
      /not found|not recognized|找不到|不是內部或外部命令|不是内部或外部命令/i.test(errMsg);
    return { stdout: (err?.stdout || '').trim(), ok: false, notFound };
  }
}

async function runCmdAsync(cmd, options = {}) {
  const res = await runCmdDetailedAsync(cmd, options);
  return res.ok ? res.stdout : '';
}

function getGitFallbackPaths() {
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
      'C:\\Program Files\\Git\\bin\\git.exe',
      '%USERPROFILE%\\AppData\\Local\\Programs\\Git\\cmd\\git.exe',
      '%USERPROFILE%\\scoop\\apps\\git\\current\\cmd\\git.exe'
    ].map(p => p.replace(/%USERPROFILE%/g, process.env.USERPROFILE || os.homedir()));
  }
  return [
    '/usr/local/bin/git',
    '/opt/homebrew/bin/git',
    '/usr/bin/git'
  ];
}

export async function getGitBranch(lang, projectPath, execFn = runCmdDetailedAsync) {
  const normLang = normalizeLanguage(lang);
  const noVcStr = normLang === 'zh-tw' ? '無版本控制' : (normLang === 'zh-cn' ? '无版本控制' : (normLang === 'jp' ? 'バージョン管理なし' : 'No VC'));
  try {
    const opts = {
      cwd: projectPath || process.cwd()
    };
    const res = await execFn('git branch --show-current', opts);
    if (res.ok) {
      if (res.stdout) return res.stdout;
      const revRes = await execFn('git rev-parse --abbrev-ref HEAD', opts);
      return (revRes.ok && revRes.stdout) ? revRes.stdout : noVcStr;
    }

    if (res.notFound) {
      const paths = getGitFallbackPaths();
      for (const gitPath of paths) {
        try {
          await fs.access(gitPath);
          const fbRes = await execFn(`"${gitPath}" branch --show-current`, opts);
          if (fbRes.ok && fbRes.stdout) return fbRes.stdout;
          if (fbRes.ok) {
            const fbRev = await execFn(`"${gitPath}" rev-parse --abbrev-ref HEAD`, opts);
            return (fbRev.ok && fbRev.stdout) ? fbRev.stdout : noVcStr;
          }
          break;
        } catch (e) {}
      }
    }
    return noVcStr;
  } catch (e) {
    return noVcStr;
  }
}

export async function getGitDirty(projectPath, execFn = runCmdDetailedAsync) {
  try {
    const opts = {
      cwd: projectPath || process.cwd()
    };
    const res = await execFn('git status --porcelain', opts);
    if (res.ok) {
      return res.stdout.length > 0;
    }

    if (res.notFound) {
      const paths = getGitFallbackPaths();
      for (const gitPath of paths) {
        try {
          await fs.access(gitPath);
          const fbRes = await execFn(`"${gitPath}" status --porcelain`, opts);
          return fbRes.ok ? fbRes.stdout.length > 0 : false;
        } catch (e) {}
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function getCliMemoryMB() {
  try {
    if (process.platform === 'win32') {
      try {
        const cmd = `powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'ProcessId = ${process.ppid}' | ForEach-Object { if ($_.Name -like '*agy*') { $_ } else { Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $_.ParentProcessId) } } | ForEach-Object { if ($_.Name -like '*agy*') { $_.WorkingSetSize } }"`;
        const output = await runCmdAsync(cmd);
        const memBytes = parseInt(output.trim(), 10);
        if (!isNaN(memBytes) && memBytes > 0) {
          return Math.round(memBytes / 1024 / 1024);
        }
      } catch (err) {}
      return Math.round(process.memoryUsage().rss / 1024 / 1024);
    } else {
      const output = await runCmdAsync(`ps -o rss= -p ${process.ppid}`);
      const memKb = parseInt(output.trim(), 10);
      if (!isNaN(memKb)) return Math.round(memKb / 1024);
    }
  } catch (e) {}
  try {
    return Math.round(process.memoryUsage().rss / 1024 / 1024);
  } catch (e) {
    return 0;
  }
}

// ==========================================
// Initialization & Config Reading
// ==========================================
async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    let timer = setTimeout(() => resolve(data), 300);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
  });
}

async function getSettingsAsync(meta) {
  const globalPath = join(os.homedir(), '.gemini', 'settings.json');
  const cliPath = join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
  const projectDir = (typeof meta?.project?.path === 'string' && meta.project.path)
    ? meta.project.path
    : process.cwd();
  const projectPath = join(projectDir, '.gemini', 'settings.json');
  let settings = {};

  try {
    const globalContent = await fs.readFile(globalPath, 'utf8');
    settings = JSON.parse(globalContent.replace(/^\uFEFF/, ''));
  } catch (e) {}

  try {
    const cliContent = await fs.readFile(cliPath, 'utf8');
    const cliSettings = JSON.parse(cliContent.replace(/^\uFEFF/, ''));
    settings = { ...settings, ...cliSettings };
    if (cliSettings.ui) {
      settings.ui = { ...settings.ui, ...cliSettings.ui };
      if (cliSettings.ui.footer) {
        settings.ui.footer = { ...settings.ui.footer, ...cliSettings.ui.footer };
      }
    }
  } catch (e) {}

  try {
    const projContent = await fs.readFile(projectPath, 'utf8');
    const projSettings = JSON.parse(projContent.replace(/^\uFEFF/, ''));
    settings = { ...settings, ...projSettings };
    if (projSettings.ui) {
      settings.ui = { ...settings.ui, ...projSettings.ui };
      if (projSettings.ui.footer) {
        settings.ui.footer = { ...settings.ui.footer, ...projSettings.ui.footer };
      }
    }
  } catch (e) {}

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

// ==========================================
// Business Logic Helpers
// ==========================================
export function formatResetTime(resetTimeStr) {
  try {
    const reset = new Date(resetTimeStr);
    const diffSeconds = Math.floor((reset.getTime() - Date.now()) / 1000);
    if (diffSeconds <= 0) return 'now';
    const minutes = Math.floor((diffSeconds + 59) / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remHours = hours % 24;
      return remHours ? `${days}d ${remHours}h` : `${days}d`;
    }
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
  } catch (e) {
    return '';
  }
}

export function formatSecondsToCountdown(totalSec) {
  if (totalSec <= 0) return 'now';
  const minutes = Math.floor((totalSec + 59) / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours ? `${days}d ${remHours}h` : `${days}d`;
  }
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

export function formatAbsoluteResetTime(resetTimeStr, formatMode = 'smart', now = new Date()) {
  if (!resetTimeStr) return '';
  const reset = new Date(resetTimeStr);
  if (isNaN(reset.getTime())) return '';

  const pad = (n) => String(n).padStart(2, '0');
  const year = reset.getFullYear();
  const month = pad(reset.getMonth() + 1);
  const day = pad(reset.getDate());
  const hours24 = pad(reset.getHours());
  const minutes = pad(reset.getMinutes());

  const fullDateTime = `${year}/${month}/${day} ${hours24}:${minutes}`;
  const time24 = `${hours24}:${minutes}`;

  const rawHours = reset.getHours();
  const period = rawHours >= 12 ? 'PM' : 'AM';
  const h12 = rawHours % 12 || 12;
  const time12 = `${pad(h12)}:${minutes} ${period}`;

  const mode = (formatMode || 'smart').toLowerCase().trim();

  if (mode === 'yyyy/mm/dd hh:mm' || mode === 'yyyy-mm-dd hh:mm' || mode === 'full') {
    return fullDateTime;
  }
  if (mode === '24h') {
    return time24;
  }
  if (mode === '12h') {
    return time12;
  }

  // 'smart' or 'auto' or default
  const nowDate = (now instanceof Date && !isNaN(now.getTime()))
    ? now
    : (now ? new Date(now) : new Date());
  const validNow = isNaN(nowDate.getTime()) ? new Date() : nowDate;
  const isSameDay = reset.getFullYear() === validNow.getFullYear() &&
                    reset.getMonth() === validNow.getMonth() &&
                    reset.getDate() === validNow.getDate();
  return isSameDay ? time24 : fullDateTime;
}

export function renderBarGraph(pct, length = 10, color = '', inverted = false) {
  const len = Math.min(50, Math.max(1, parseInt(length, 10) || 10));
  const numPct = typeof pct === 'number' ? pct : parseFloat(pct);
  const clamped = Math.max(0, Math.min(100, typeof numPct === 'number' && !isNaN(numPct) ? numPct : 0));
  let filled = Math.floor((clamped / 100) * len);
  if (clamped >= 100) filled = len;
  if (clamped <= 0) filled = 0;
  const empty = len - filled;
  const filledStr = '█'.repeat(filled);
  const emptyStr = '░'.repeat(empty);

  let appliedColor = color;
  if (!appliedColor && inverted) {
    appliedColor = getColorByPercentage(100 - clamped);
  }

  const filledColored = appliedColor ? `${appliedColor}${filledStr}${RESET}` : filledStr;
  return `[${filledColored}${emptyStr}]`;
}

export function parseMetaQuota(meta) {
  if (!meta?.quota || typeof meta.quota !== 'object') return null;
  const keys = Object.keys(meta.quota);
  if (keys.length === 0) return null;

  const shortTerm = {};
  const weekly = {};

  for (const key of keys) {
    const bucket = meta.quota[key];
    if (!bucket) continue;

    let fraction = 1;
    const remainingField = bucket.remaining_fraction !== undefined ? bucket.remaining_fraction : bucket.remainingFraction;
    if (remainingField !== undefined && remainingField !== null) {
      fraction = parseFloat(remainingField);
    } else if (bucket.reset_time || bucket.reset_in_seconds || bucket.resetTime) {
      fraction = 0;
    }

    const remainingNum = fraction > 1 ? fraction : fraction * 100;
    const remaining = Math.max(0, Math.min(100, remainingNum));

    const rawResetTime = bucket.reset_time || bucket.resetTime;
    const resetSec = bucket.reset_in_seconds !== undefined ? bucket.reset_in_seconds : bucket.resetInSeconds;
    const resetTime = rawResetTime || (resetSec !== undefined && resetSec !== null && !isNaN(resetSec)
      ? new Date(Date.now() + Number(resetSec) * 1000).toISOString()
      : undefined);

    let refreshesIn = '';
    if (resetSec !== undefined && resetSec !== null) {
      refreshesIn = formatSecondsToCountdown(resetSec);
    } else if (resetTime) {
      refreshesIn = formatResetTime(resetTime);
    }

    const entry = {
      remaining_percentage: remaining
    };
    if (resetTime) entry.reset_time = resetTime;
    if (refreshesIn) entry.refreshes_in = refreshesIn;

    if (key.endsWith('-weekly')) {
      const pool = key.replace(/-weekly$/, '');
      weekly[pool] = entry;
    } else {
      const pool = key.replace(/-(5h|3h|hourly|shortterm)$/, '');
      shortTerm[pool] = entry;
    }
  }

  if (Object.keys(shortTerm).length === 0 && Object.keys(weekly).length === 0) return null;
  return { shortTerm, weekly };
}

async function triggerQuotaUpdateIfNeededAsync(cacheInfo) {
  let needUpdate = true;
  if (cacheInfo && Date.now() - (cacheInfo.updatedAt || 0) < 30000) needUpdate = false;

  if (needUpdate) {
    try {
      const updaterScript = join(os.homedir(), '.gemini', 'antigravity-cli', 'hooks', 'fetch-local-quota.mjs');
      await fs.access(updaterScript);
      const proc = spawn('node', [updaterScript], {
        env: { ...process.env, DISABLE_QUOTA_HOOK: '1' },
        stdio: 'ignore',
        detached: true,
        windowsHide: true
      });
      proc.on('error', () => {});
      proc.unref();
    } catch (e) {}
  }
}

export function resolveModelQuota(fallbackModel, cache) {
  const normModel = normalizeModelName(fallbackModel);

  // 1. 優先使用 RetrieveUserQuotaSummary 解析出的短週期 (5h) 配額桶
  let pool = '';
  if (normModel.includes('gemini')) {
    pool = 'gemini';
  } else if (normModel.includes('claude') || normModel.includes('gpt')) {
    pool = '3p';
  }

  if (pool && cache && cache.shortTerm && cache.shortTerm[pool]) {
    return cache.shortTerm[pool];
  }

  if (cache && cache.shortTerm) {
    const pools = Object.keys(cache.shortTerm);
    if (pools.length > 0) {
      const matchedPool = pools.find(p => normModel.includes(p) || p.includes(normModel));
      if (matchedPool) return cache.shortTerm[matchedPool];
    }
  }

  // 2. 若無 shortTerm 桶，降級回 GetUserStatus 中的 cache.models
  let modelQuota = null;
  if (cache && cache.models) {
    // 2a. Exact match
    if (cache.models[normModel]) {
      modelQuota = cache.models[normModel];
    } else {
      // 2b. Substring match
      for (const k in cache.models) {
        if (normModel.includes(k) || k.includes(normModel)) {
          modelQuota = cache.models[k];
          break;
        }
      }
    }
    // 2c. Family match
    if (!modelQuota) {
      const families = ['claude', 'gemini', 'gpt'];
      const modelFamily = families.find(f => normModel.includes(f));
      if (modelFamily) {
        for (const k in cache.models) {
          if (k.includes(modelFamily)) {
            if (!modelQuota || cache.models[k].remaining_percentage < modelQuota.remaining_percentage) {
              modelQuota = cache.models[k];
            }
          }
        }
      }
    }
  }
  // 2d. Global minimum fallback
  if (!modelQuota && cache && cache.models) {
    const allKeys = Object.keys(cache.models);
    if (allKeys.length > 0) {
      modelQuota = allKeys.reduce((min, k) =>
        cache.models[k].remaining_percentage < min.remaining_percentage ? cache.models[k] : min
      , cache.models[allKeys[0]]);
    }
  }
  return modelQuota || { remaining_percentage: 100, refreshes_in: '' };
}

/**
 * Maps a model display name to its weekly quota pool ('gemini' | '3p') and weekly quota.
 * @param {string} fallbackModel - the fallback model display name
 * @param {object} cache - the local quota cache object
 * @returns {{remaining_percentage:number,reset_time?:string,refreshes_in?:string}}
 */
export function resolveWeeklyQuota(fallbackModel, cache) {
  const normModel = normalizeModelName(fallbackModel);
  let pool = '';
  if (normModel.includes('gemini')) {
    pool = 'gemini';
  } else if (normModel.includes('claude') || normModel.includes('gpt')) {
    pool = '3p';
  }

  if (pool && cache && cache.weekly && cache.weekly[pool]) {
    return cache.weekly[pool];
  }

  // A4 Fallback (lowest remaining_percentage among available weekly pools)
  if (cache && cache.weekly) {
    const pools = Object.keys(cache.weekly);
    if (pools.length > 0) {
      let minPool = pools[0];
      for (const p of pools) {
        if (cache.weekly[p].remaining_percentage < cache.weekly[minPool].remaining_percentage) {
          minPool = p;
        }
      }
      return cache.weekly[minPool];
    }
  }

  return { remaining_percentage: 100, refreshes_in: '' };
}

async function writeFileAndVerifyNoBOM(filePath, content) {
  await fs.writeFile(filePath, content, { encoding: 'utf8' });
  let buffer = await fs.readFile(filePath);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    buffer = buffer.slice(3);
    await fs.writeFile(filePath, buffer);
  }
}

async function calculateContextUsageAsync(meta, conversationId) {
  const contextWindow = meta.context_window || {};
  const ctxCachePath = join(os.homedir(), '.gemini', 'tmp', `ctx_${conversationId}.json`);
  
  let totalInput = contextWindow.total_input_tokens || 0;
  let totalOutput = contextWindow.total_output_tokens || 0;
  let usedPctNum = contextWindow.used_percentage || 0;
  let contextSize = contextWindow.context_window_size || 0;
  
  if (totalInput === 0 && totalOutput === 0) {
    try {
      const content = await fs.readFile(ctxCachePath, 'utf8');
      const cachedCtx = JSON.parse(content.replace(/^\uFEFF/, ''));
      totalInput = cachedCtx.total_input_tokens || 0;
      totalOutput = cachedCtx.total_output_tokens || 0;
      if (cachedCtx.used_percentage) usedPctNum = cachedCtx.used_percentage;
      if (cachedCtx.context_window_size) contextSize = cachedCtx.context_window_size;
    } catch (e) {}
  } else {
    try {
      await fs.mkdir(join(os.homedir(), '.gemini', 'tmp'), { recursive: true });
      await writeFileAndVerifyNoBOM(ctxCachePath, JSON.stringify({
        total_input_tokens: totalInput,
        total_output_tokens: totalOutput,
        used_percentage: usedPctNum,
        context_window_size: contextSize
      }));
    } catch (e) {}
  }
  
  if (!contextSize) contextSize = 1048576;
  if (contextSize > 0 && totalInput > 0 && !usedPctNum) {
    usedPctNum = (totalInput / contextSize) * 100;
  }
  
  return { totalInput, contextSize, usedPctNum };
}

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

async function manageAccountMetaCacheAsync(meta) {
  const accountMetaPath = join(os.homedir(), '.gemini', 'tmp', 'account_meta_cache.json');
  let cachedAccount = {};
  try {
    const content = await fs.readFile(accountMetaPath, 'utf8');
    cachedAccount = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch (e) {}
  
  const email = meta?.email || meta?.account?.email;
  const planTier = meta?.plan_tier || meta?.account?.plan_tier;
  const termWidth = (typeof meta?.terminal_width === 'number' && meta.terminal_width > 80) ? meta.terminal_width : 0;

  let updated = false;
  if (email && cachedAccount.email !== email) {
    cachedAccount.email = email;
    updated = true;
  }
  if (planTier && cachedAccount.planTier !== planTier) {
    cachedAccount.planTier = planTier;
    updated = true;
  }
  if (termWidth && cachedAccount.terminalWidth !== termWidth) {
    cachedAccount.terminalWidth = termWidth;
    updated = true;
  }

  if (updated) {
    try {
      await fs.mkdir(join(os.homedir(), '.gemini', 'tmp'), { recursive: true });
      await writeFileAndVerifyNoBOM(accountMetaPath, JSON.stringify(cachedAccount));
    } catch (e) {}
  }
  return cachedAccount;
}

async function getMetricValueAsync(meta, keys, countersCachePath, fallbackFn) {
  if (meta) {
    for (const key of keys) {
      if (meta[key] !== undefined && meta[key] !== null) {
        return safeGetCount(meta[key]);
      }
    }
  }

  let cacheCounters = null;
  if (countersCachePath) {
    try {
      const content = await fs.readFile(countersCachePath, 'utf8');
      cacheCounters = JSON.parse(content.replace(/^\uFEFF/, ''));
    } catch (e) {}
  }

  if (cacheCounters) {
    for (const key of keys) {
      if (cacheCounters[key] !== undefined && cacheCounters[key] !== null) {
        return safeGetCount(cacheCounters[key]);
      }
    }
  }

  return await fallbackFn();
}

export async function extractMetricsAsync(meta, lang, fallbackModel, cache, cachedAccount, quotaInfo, contextInfo, weeklyInfo = { remaining_percentage: 100, refreshes_in: '' }, options = {}) {
  const timeFormat = options?.timeFormat || 'smart';
  const barLength = options?.barLength || 10;
  const normLang = normalizeLanguage(lang);
  const unknownStr = (normLang === 'zh-tw' || normLang === 'zh-cn') ? '未知' : (normLang === 'jp' ? '不明' : 'Unknown');
  const noneStr = normLang === 'zh-tw' ? '無' : (normLang === 'zh-cn' ? '无' : (normLang === 'jp' ? 'なし' : 'N/A'));
  const noVcFallback = normLang === 'zh-tw' ? '無版本控制' : (normLang === 'zh-cn' ? '无版本控制' : (normLang === 'jp' ? 'バージョン管理なし' : 'No VC'));

  // Quota
  const quotaPct = quotaInfo.remaining_percentage;
  const quotaColor = getColorByPercentage(quotaPct);
  const quotaVal = `${Math.round(quotaPct)}%`;
  const countdownVal = quotaInfo.refreshes_in || noneStr;
  const formattedReset = quotaInfo.reset_time ? formatAbsoluteResetTime(quotaInfo.reset_time, timeFormat) : '';
  const quotaResetTimeVal = formattedReset || noneStr;
  const quotaBarVal = renderBarGraph(quotaPct, barLength, quotaColor);

  // Weekly Quota
  const weeklyPct = weeklyInfo.remaining_percentage;
  const weeklyQuotaColor = getColorByPercentage(weeklyPct);
  const weeklyQuotaVal = `${Math.round(weeklyPct)}%`;
  const weeklyCountdownVal = weeklyInfo.refreshes_in || noneStr;
  const formattedWeeklyReset = weeklyInfo.reset_time ? formatAbsoluteResetTime(weeklyInfo.reset_time, timeFormat) : '';
  const weeklyResetTimeVal = formattedWeeklyReset || noneStr;
  const weeklyQuotaBarVal = renderBarGraph(weeklyPct, barLength, weeklyQuotaColor);

  // Context
  const remainCtx = Math.max(0, 100 - contextInfo.usedPctNum);
  const contextColor = getColorByPercentage(remainCtx);
  const usedPct = `${contextInfo.usedPctNum.toFixed(1)}%`;
  const tokenCount = `${contextColor}${formatTokens(contextInfo.totalInput)}${RESET} / ${formatTokens(contextInfo.contextSize)}`;
  const contextBarVal = renderBarGraph(contextInfo.usedPctNum, barLength, contextColor);
  const tokenPct = contextInfo.contextSize > 0 ? (contextInfo.totalInput / contextInfo.contextSize) * 100 : contextInfo.usedPctNum;
  const tokenBarVal = renderBarGraph(tokenPct, barLength, contextColor);

  const projectPath = (typeof meta?.project?.path === 'string' && meta.project.path) ? meta.project.path : process.cwd();
  const projectName = basename(projectPath);
  const projectFullPath = projectPath;

  // Account
  const planTier = (cache && cache.planTier) ? cache.planTier : (meta?.plan_tier || meta?.account?.plan_tier || cachedAccount.planTier || unknownStr);
  const accountEmail = (cache && cache.email) ? cache.email : (meta?.email || meta?.account?.email || cachedAccount.email || unknownStr);

  // Agent State
  const agentState = meta?.agent_state || 'idle';
  const toolConfirmPending = !!meta?.tool_confirmation_pending;

  // Filter out inactive subagents before counting
  if (Array.isArray(meta?.subagents)) {
    meta.subagents = meta.subagents.filter(s => {
      if (typeof s === 'object' && s.status) {
        return s.status !== 'completed' && s.status !== 'stopped' && s.status !== 'error';
      }
      return true; // Keep if format is unknown
    });
  }

  const countersCachePath = join(os.homedir(), '.gemini', 'tmp', 'statusline_counters.json');

  // 併行執行非同步操作（含逾時保護避免系統休眠喚醒時被 CLI SIGKILL）
  const [
    gitBranch,
    vcsDirtyFlag,
    rssMem,
    pendingInputCount,
    backgroundTasksCount,
    subagentsCount,
    artifactsCount
  ] = await Promise.all([
    // 1. Git 分支
    (typeof meta?.vcs?.branch === 'string' && meta.vcs.branch)
      ? Promise.resolve(meta.vcs.branch)
      : withTimeout(getGitBranch(normLang, projectPath), 600, noVcFallback),

    // 2. Git Dirty
    (typeof meta?.vcs?.dirty === 'boolean')
      ? Promise.resolve(meta.vcs.dirty)
      : withTimeout(getGitDirty(projectPath), 600, false),

    // 3. Memory
    withTimeout(getCliMemoryMB(), 600, Math.round(process.memoryUsage().rss / 1024 / 1024)),

    // 4. Pending Input
    getMetricValueAsync(
      meta,
      ['pending_input_count', 'pending_input', 'pending_inputs'],
      countersCachePath,
      async () => {
        const pendingInputFilePath = join(os.homedir(), '.gemini', 'tmp', 'pending_input_count');
        try {
          const fileContent = (await fs.readFile(pendingInputFilePath, 'utf8')).trim();
          const parsed = Number(fileContent);
          return isNaN(parsed) ? 0 : parsed;
        } catch (e) {
          if (process.env.PENDING_INPUT_COUNT !== undefined) {
            const parsed = Number(process.env.PENDING_INPUT_COUNT);
            return isNaN(parsed) ? 0 : parsed;
          }
          return 0;
        }
      }
    ),

    // 5. Background Tasks
    getMetricValueAsync(
      meta,
      ['background_tasks', 'background_tasks_count', 'background_jobs'],
      countersCachePath,
      async () => {
        const bgTasksDir = join(os.homedir(), '.gemini', 'tmp', 'background-processes');
        try {
          const files = await fs.readdir(bgTasksDir);
          const stats = await Promise.all(
            files.map(async (file) => {
              if (file.startsWith('.')) return false;
              try {
                const stat = await fs.stat(join(bgTasksDir, file));
                return stat.isFile();
              } catch (e) {
                return false;
              }
            })
          );
          return stats.filter(Boolean).length;
        } catch (e) {
          return 0;
        }
      }
    ),

    // 6. Subagents
    getMetricValueAsync(
      meta,
      ['subagents', 'subagents_count', 'active_subagents'],
      countersCachePath,
      async () => {
        const agentsDir = join(projectPath, '.agents');
        try {
          const dirs = await fs.readdir(agentsDir);
          const now = Date.now();
          const results = await Promise.all(
            dirs.map(async (d) => {
              if (d.startsWith('.')) return 0;
              const dPath = join(agentsDir, d);
              try {
                const statD = await fs.stat(dPath);
                if (statD.isDirectory()) {
                  const progressPath = join(dPath, 'progress.md');
                  const statP = await fs.stat(progressPath);
                  if (now - statP.mtimeMs <= 300000) {
                    return 1;
                  }
                }
              } catch (e) {}
              return 0;
            })
          );
          return results.reduce((sum, val) => sum + val, 0);
        } catch (e) {
          return 0;
        }
      }
    ),

    // 7. Artifacts
    getMetricValueAsync(
      meta,
      ['artifacts', 'artifacts_count', 'artifact_count'],
      countersCachePath,
      async () => {
        const rawConvId = (typeof meta?.conversation_id === 'string' && meta.conversation_id)
          ? meta.conversation_id.replace(/\.\./g, '').replace(/\//g, '').replace(/\\/g, '')
          : '';
        if (rawConvId) {
          const brainDir = join(os.homedir(), '.gemini', 'antigravity-cli', 'brain', rawConvId);
          try {
            const files = await fs.readdir(brainDir);
            const metadataFiles = files.filter(f => f.endsWith('.metadata.json'));
            return metadataFiles.length;
          } catch (e) {
            return 0;
          }
        } else {
          return 0;
        }
      }
    )
  ]);

  const memUsage = `${rssMem}MB`;
  const vcsDirtyGlyph = vcsDirtyFlag ? '✗' : '✓';
  const vcsDirtyLabel = vcsDirtyFlag
    ? (normLang === 'zh-tw' ? '有變更' : (normLang === 'zh-cn' ? '有变更' : (normLang === 'jp' ? '変更あり' : 'dirty')))
    : (normLang === 'zh-tw' ? '乾淨' : (normLang === 'zh-cn' ? '干净' : (normLang === 'jp' ? 'クリーン' : 'clean')));
  const vcsType = meta?.vcs?.type || 'git';

  const sandboxEnabled = !!meta?.sandbox?.enabled;
  const sandboxAllowNet = !!meta?.sandbox?.allow_network;
  let sandboxStatusVal;
  if (!sandboxEnabled) {
    sandboxStatusVal = normLang === 'zh-tw' ? '關閉' : (normLang === 'zh-cn' ? '关闭' : (normLang === 'jp' ? 'オフ' : 'off'));
  } else if (sandboxAllowNet) {
    sandboxStatusVal = normLang === 'zh-tw' ? '啟用（聯網）' : (normLang === 'zh-cn' ? '启用（联网）' : (normLang === 'jp' ? 'オン（ネット）' : 'on (net)'));
  } else {
    sandboxStatusVal = normLang === 'zh-tw' ? '啟用（離線）' : (normLang === 'zh-cn' ? '启用（离线）' : (normLang === 'jp' ? 'オン（オフライン）' : 'on (no-net)'));
  }

  let agentProfileName = normLang === 'zh-tw' ? '預設' : (normLang === 'zh-cn' ? '默认' : (normLang === 'jp' ? 'デフォルト' : 'Default'));
  if (typeof meta?.agent === 'string') agentProfileName = meta.agent;
  else if (meta?.agent?.display_name) agentProfileName = meta.agent.display_name;
  else if (meta?.agent?.name) agentProfileName = meta.agent.name;
  else if (meta?.agent?.id) agentProfileName = meta.agent.id;
  else if (meta?.agent?.profile) agentProfileName = meta.agent.profile;

  const cliVersion = meta?.version ? `v${meta.version}` : unknownStr;
  const rawConvId = typeof meta?.conversation_id === 'string' ? meta.conversation_id : '';
  const conversationIdShort = rawConvId ? rawConvId.replace(/-/g, '').slice(0, 8) : unknownStr;
  let modeVal = (typeof meta?.cycle_mode === 'string' && meta.cycle_mode.trim())
    ? meta.cycle_mode.trim()
    : ((typeof meta?.mode === 'string' && meta.mode.trim()) ? meta.mode.trim() : 'default');
  if (modeVal.length > 0) {
    modeVal = modeVal.charAt(0).toUpperCase() + modeVal.slice(1);
  }
  const mode = modeVal;

  return {
    fallbackModel, quotaColor, quotaVal, contextColor, usedPct, memUsage, tokenCount,
    countdownVal, gitBranch, projectName, projectFullPath, planTier, accountEmail,
    agentState, toolConfirmPending, pendingInputCount, backgroundTasksCount, subagentsCount,
    artifactsCount, vcsDirtyFlag, vcsDirtyGlyph, vcsDirtyLabel, vcsType, sandboxEnabled,
    sandboxAllowNet, sandboxStatusVal, cliVersion, conversationIdShort, agentProfileName,
    weeklyQuotaColor, weeklyQuotaVal, weeklyCountdownVal, mode,
    quotaResetTimeVal, weeklyResetTimeVal, quotaBarVal, weeklyQuotaBarVal, contextBarVal, tokenBarVal
  };
}

export function buildI18nDict(lang, m, labelStyle = 'text', itemStyles = undefined) {
  if (typeof labelStyle === 'object' && labelStyle !== null && !Array.isArray(labelStyle)) {
    itemStyles = labelStyle;
    labelStyle = 'text';
  }
  const normGlobalStyle = normalizeLabelStyle(labelStyle);
  const dicts = {
    'zh-tw': {
      'model-name': `${WHITE}模型:${RESET} ${getModelColor(m.fallbackModel)}${BOLD}${m.fallbackModel}${RESET}`,
      'quota': `${WHITE}小時可用:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}脈絡用量:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}記憶體:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}權杖數:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}小時倒數:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'quota-reset-time': `${WHITE}小時重置:${RESET} ${BLUE}${BOLD}${m.quotaResetTimeVal}${RESET}`,
      'quota-bar': `${WHITE}小時可用:${RESET} ${m.quotaBarVal}`,
      'quota-weekly': `${WHITE}每週可用:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET}`,
      'quota-weekly-countdown': `${WHITE}每週倒數:${RESET} ${BLUE}${BOLD}${m.weeklyCountdownVal}${RESET}`,
      'quota-weekly-reset-time': `${WHITE}每週重置:${RESET} ${BLUE}${BOLD}${m.weeklyResetTimeVal}${RESET}`,
      'quota-weekly-bar': `${WHITE}每週可用:${RESET} ${m.weeklyQuotaBarVal}`,
      'context-used-bar': `${WHITE}脈絡用量:${RESET} ${m.contextBarVal}`,
      'token-count-bar': `${WHITE}權杖數:${RESET} ${m.tokenBarVal}`,
      'quota+bar': `${WHITE}小時可用:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET} ${m.quotaBarVal}`,
      'context-used+bar': `${WHITE}脈絡用量:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET} ${m.contextBarVal}`,
      'quota-weekly+bar': `${WHITE}每週可用:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET} ${m.weeklyQuotaBarVal}`,
      'token-count+bar': `${WHITE}權杖數:${RESET} ${m.tokenCount} ${m.tokenBarVal}`,
      'git-branch': `${WHITE}Git: ${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}專案: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `${WHITE}完整路徑: ${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}訂閱方案: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}帳號: ${BOLD}${m.accountEmail}${RESET}`,
      'agent-state': `${WHITE}代理狀態:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${m.agentState}${RESET}`,
      'tool-confirmation': `${WHITE}工具待確認:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? '在等你' : '都好了'}${RESET}`,
      'pending-input': `${WHITE}待處理輸入:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}背景任務:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}子代理:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}檔案數量: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}工作區狀態:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyGlyph} ${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}VCS類型: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}沙盒狀態:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `${WHITE}CLI版本: ${BOLD}${m.cliVersion}${RESET}`,
      'conversation-id': `${WHITE}對話ID: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `${WHITE}代理角色:${RESET} ${BLUE}${BOLD}${m.agentProfileName}${RESET}`,
      'mode': `${WHITE}模式:${RESET} ${getModeColor(m.mode)}${BOLD}${m.mode}${RESET}`
    },
    'zh-cn': {
      'model-name': `${WHITE}模型:${RESET} ${getModelColor(m.fallbackModel)}${BOLD}${m.fallbackModel}${RESET}`,
      'quota': `${WHITE}小时可用:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}上下文用量:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}内存:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}令牌数:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}小时倒计时:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'quota-reset-time': `${WHITE}小时重置:${RESET} ${BLUE}${BOLD}${m.quotaResetTimeVal}${RESET}`,
      'quota-bar': `${WHITE}小时可用:${RESET} ${m.quotaBarVal}`,
      'quota-weekly': `${WHITE}每周可用:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET}`,
      'quota-weekly-countdown': `${WHITE}每周倒计时:${RESET} ${BLUE}${BOLD}${m.weeklyCountdownVal}${RESET}`,
      'quota-weekly-reset-time': `${WHITE}每周重置:${RESET} ${BLUE}${BOLD}${m.weeklyResetTimeVal}${RESET}`,
      'quota-weekly-bar': `${WHITE}每周可用:${RESET} ${m.weeklyQuotaBarVal}`,
      'context-used-bar': `${WHITE}上下文用量:${RESET} ${m.contextBarVal}`,
      'token-count-bar': `${WHITE}令牌数:${RESET} ${m.tokenBarVal}`,
      'quota+bar': `${WHITE}小时可用:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET} ${m.quotaBarVal}`,
      'context-used+bar': `${WHITE}上下文用量:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET} ${m.contextBarVal}`,
      'quota-weekly+bar': `${WHITE}每周可用:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET} ${m.weeklyQuotaBarVal}`,
      'token-count+bar': `${WHITE}令牌数:${RESET} ${m.tokenCount} ${m.tokenBarVal}`,
      'git-branch': `${WHITE}Git: ${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}项目: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `${WHITE}完整路径: ${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}订阅计划: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}账号: ${BOLD}${m.accountEmail}${RESET}`,
      'agent-state': `${WHITE}代理状态:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${m.agentState}${RESET}`,
      'tool-confirmation': `${WHITE}工具待确认:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? '在等你' : '都好了'}${RESET}`,
      'pending-input': `${WHITE}待处理输入:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}后台任务:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}子代理:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}产出文件数: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}工作区状态:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyGlyph} ${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}VCS类型: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}沙箱状态:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `${WHITE}CLI版本: ${BOLD}${m.cliVersion}${RESET}`,
      'conversation-id': `${WHITE}对话ID: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `${WHITE}代理角色:${RESET} ${BLUE}${BOLD}${m.agentProfileName}${RESET}`,
      'mode': `${WHITE}模式:${RESET} ${getModeColor(m.mode)}${BOLD}${m.mode}${RESET}`
    },
    'us': {
      'model-name': `${WHITE}Model:${RESET} ${getModelColor(m.fallbackModel)}${BOLD}${m.fallbackModel}${RESET}`,
      'quota': `${WHITE}Hourly Available:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}Context Used:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}RAM:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}Tokens:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}Hourly Reset:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'quota-reset-time': `${WHITE}Hourly Reset Time:${RESET} ${BLUE}${BOLD}${m.quotaResetTimeVal}${RESET}`,
      'quota-bar': `${WHITE}Hourly Available:${RESET} ${m.quotaBarVal}`,
      'quota-weekly': `${WHITE}Weekly Available:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET}`,
      'quota-weekly-countdown': `${WHITE}Weekly Reset:${RESET} ${BLUE}${BOLD}${m.weeklyCountdownVal}${RESET}`,
      'quota-weekly-reset-time': `${WHITE}Weekly Reset Time:${RESET} ${BLUE}${BOLD}${m.weeklyResetTimeVal}${RESET}`,
      'quota-weekly-bar': `${WHITE}Weekly Available:${RESET} ${m.weeklyQuotaBarVal}`,
      'context-used-bar': `${WHITE}Context Used:${RESET} ${m.contextBarVal}`,
      'token-count-bar': `${WHITE}Tokens:${RESET} ${m.tokenBarVal}`,
      'quota+bar': `${WHITE}Hourly Available:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET} ${m.quotaBarVal}`,
      'context-used+bar': `${WHITE}Context Used:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET} ${m.contextBarVal}`,
      'quota-weekly+bar': `${WHITE}Weekly Available:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET} ${m.weeklyQuotaBarVal}`,
      'token-count+bar': `${WHITE}Tokens:${RESET} ${m.tokenCount} ${m.tokenBarVal}`,
      'git-branch': `${WHITE}Git: ${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}Project: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `${WHITE}Project Path: ${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}Plan: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}Account: ${BOLD}${m.accountEmail}${RESET}`,
      'agent-state': `${WHITE}Agent:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${m.agentState}${RESET}`,
      'tool-confirmation': `${WHITE}Awaiting You:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? 'waiting' : 'all clear'}${RESET}`,
      'pending-input': `${WHITE}Queue:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}BG:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}Subagents:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}Cumulative Outputs: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}Status:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyGlyph} ${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}VCS: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}Sandbox:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `${WHITE}CLI: ${BOLD}${m.cliVersion}${RESET}`,
      'conversation-id': `${WHITE}Conv: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `${WHITE}Profile:${RESET} ${BLUE}${BOLD}${m.agentProfileName}${RESET}`,
      'mode': `${WHITE}Mode:${RESET} ${getModeColor(m.mode)}${BOLD}${m.mode}${RESET}`
    },
    'jp': {
      'model-name': `${WHITE}モデル:${RESET} ${getModelColor(m.fallbackModel)}${BOLD}${m.fallbackModel}${RESET}`,
      'quota': `${WHITE}時間残量:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}コンテキスト使用:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}メモリ:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}トークン:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}時間リセット:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'quota-reset-time': `${WHITE}時間リセット時刻:${RESET} ${BLUE}${BOLD}${m.quotaResetTimeVal}${RESET}`,
      'quota-bar': `${WHITE}時間残量:${RESET} ${m.quotaBarVal}`,
      'quota-weekly': `${WHITE}週間残量:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET}`,
      'quota-weekly-countdown': `${WHITE}週間リセット:${RESET} ${BLUE}${BOLD}${m.weeklyCountdownVal}${RESET}`,
      'quota-weekly-reset-time': `${WHITE}週間リセット時刻:${RESET} ${BLUE}${BOLD}${m.weeklyResetTimeVal}${RESET}`,
      'quota-weekly-bar': `${WHITE}週間残量:${RESET} ${m.weeklyQuotaBarVal}`,
      'context-used-bar': `${WHITE}コンテキスト使用:${RESET} ${m.contextBarVal}`,
      'token-count-bar': `${WHITE}トークン:${RESET} ${m.tokenBarVal}`,
      'quota+bar': `${WHITE}時間残量:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET} ${m.quotaBarVal}`,
      'context-used+bar': `${WHITE}コンテキスト使用:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET} ${m.contextBarVal}`,
      'quota-weekly+bar': `${WHITE}週間残量:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET} ${m.weeklyQuotaBarVal}`,
      'token-count+bar': `${WHITE}トークン:${RESET} ${m.tokenCount} ${m.tokenBarVal}`,
      'git-branch': `${WHITE}Gitブランチ: ${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}プロジェクト: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `${WHITE}パス: ${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}プラン: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}アカウント: ${BOLD}${m.accountEmail}${RESET}`,
      'agent-state': `${WHITE}状態:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${m.agentState}${RESET}`,
      'tool-confirmation': `${WHITE}ご承認待ち:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? '待機中' : 'すべて完了'}${RESET}`,
      'pending-input': `${WHITE}入力キュー:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}BGタスク:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}サブ代理:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}成果物: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}作業領域:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyGlyph} ${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}VCS種別: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}サンドボックス:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `${WHITE}CLI版: ${BOLD}${m.cliVersion}${RESET}`,
      'conversation-id': `${WHITE}会話ID: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `${WHITE}プロファイル:${RESET} ${BLUE}${BOLD}${m.agentProfileName}${RESET}`,
      'mode': `${WHITE}モード:${RESET} ${getModeColor(m.mode)}${BOLD}${m.mode}${RESET}`
    }
  };
  const normLang = normalizeLanguage(lang);
  const baseDict = dicts[normLang] || dicts['zh-tw'];

  const emojiDict = {};
  for (const [key, val] of Object.entries(baseDict)) {
    const emoji = EMOJI_MAP[key];
    if (emoji && val.startsWith(WHITE)) {
      const afterWhite = val.slice(WHITE.length);
      const colonIdx = afterWhite.indexOf(':');
      if (colonIdx !== -1) {
        emojiDict[key] = `${WHITE}${emoji}${afterWhite.slice(colonIdx + 1)}`;
        continue;
      }
    }
    emojiDict[key] = val;
  }

  const hasItemStyles = itemStyles !== undefined && itemStyles !== null && typeof itemStyles === 'object' && !Array.isArray(itemStyles);

  if (!hasItemStyles && normGlobalStyle === 'emoji') {
    return emojiDict;
  }
  if (!hasItemStyles && normGlobalStyle === 'text') {
    return baseDict;
  }

  const resultDict = {};
  for (const key of Object.keys(baseDict)) {
    let effectiveStyle;
    if (itemStyles && itemStyles[key]) {
      effectiveStyle = normalizeLabelStyle(itemStyles[key]);
    } else if (key.includes('+')) {
      const pair = ADJACENT_PAIRS.find(p => p.merged === key);
      const valKey = pair ? pair.val : key.split('+')[0];
      const barKey = pair ? pair.bar : (key.split('+')[0] + '-bar');
      const valStyle = (itemStyles && itemStyles[valKey]) ? normalizeLabelStyle(itemStyles[valKey]) : (hasItemStyles ? 'text' : normGlobalStyle);
      const barStyle = (itemStyles && itemStyles[barKey]) ? normalizeLabelStyle(itemStyles[barKey]) : (hasItemStyles ? 'text' : normGlobalStyle);
      if (valStyle === barStyle) {
        effectiveStyle = valStyle;
      } else {
        effectiveStyle = 'text';
      }
    } else if (hasItemStyles) {
      effectiveStyle = 'text'; // 未設定者一律強制以文字為預設
    } else {
      effectiveStyle = normGlobalStyle;
    }

    resultDict[key] = (effectiveStyle === 'emoji') ? emojiDict[key] : baseDict[key];
  }

  return resultDict;
}

export const ADJACENT_PAIRS = [
  { val: 'quota', bar: 'quota-bar', merged: 'quota+bar' },
  { val: 'context-used', bar: 'context-used-bar', merged: 'context-used+bar' },
  { val: 'quota-weekly', bar: 'quota-weekly-bar', merged: 'quota-weekly+bar' },
  { val: 'token-count', bar: 'token-count-bar', merged: 'token-count+bar' }
];

export function preprocessAdjacentItems(items, itemStyles = undefined, defaultStyle = 'text') {
  if (!Array.isArray(items)) return [];
  if (typeof itemStyles === 'string') {
    defaultStyle = itemStyles;
    itemStyles = undefined;
  }
  const pairs = ADJACENT_PAIRS;

  const hasItemStyles = itemStyles !== undefined && itemStyles !== null && typeof itemStyles === 'object' && !Array.isArray(itemStyles);
  function getItemEffectiveStyle(item) {
    if (itemStyles && itemStyles[item]) {
      return normalizeLabelStyle(itemStyles[item]);
    }
    if (hasItemStyles) {
      return 'text'; // 未設定者一律強制以文字為預設
    }
    return normalizeLabelStyle(defaultStyle || 'text');
  }

  const result = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    const next = items[i + 1];

    if (next) {
      const match = pairs.find(p =>
        (cur === p.val && next === p.bar) || (cur === p.bar && next === p.val)
      );
      if (match) {
        const curStyle = getItemEffectiveStyle(cur);
        const nextStyle = getItemEffectiveStyle(next);
        if (curStyle === nextStyle) {
          result.push(match.merged);
          i++;
          continue;
        }
        // 若樣式衝突（一為 text、一為 emoji）則不合併，拆開為兩個獨立區塊顯示
      }
    }
    result.push(cur);
  }
  return result;
}

export function renderStatusLine(footerItems, activeDict, termWidth, fallbackModel, itemStyles = undefined, defaultStyle = 'text') {
  const lines = [];
  let currentLine = '';
  const processedItems = preprocessAdjacentItems(footerItems || [], itemStyles, defaultStyle);
  
  for (let i = 0; i < processedItems.length; i++) {
    const item = processedItems[i];
    if (item === 'n' || item === 'newline') {
      if (currentLine !== '') {
        lines.push(currentLine);
        currentLine = '';
      } else {
        lines.push(' ');
      }
      continue;
    }

    const text = activeDict ? activeDict[item] : '';
    if (!text) continue;

    const toAdd = currentLine === '' ? text : ` ${GRAY}│${RESET} ${text}`;
    const toAddPlain = stripAnsi(toAdd);
    const currentPlain = stripAnsi(currentLine);
    
    if (currentLine !== '' && getDisplayWidth(currentPlain) + getDisplayWidth(toAddPlain) > termWidth) {
      lines.push(currentLine);
      currentLine = text;
    } else {
      currentLine += (currentLine === '' ? text : ` ${GRAY}│${RESET} ${text}`);
    }
  }
  if (currentLine !== '') lines.push(currentLine);

  // 防禦：若渲染結果為空或全部為空白行（例如 footerItems 為空、僅有換行、或所有指標皆無內容），回退輸出退讓模式，絕不回傳空陣列或空白行
  if (lines.length === 0 || lines.every(l => stripAnsi(l).trim() === '')) {
    lines.length = 0;
    const leftText = '? for shortcuts';
    const rawModel = activeDict?.['model-name'] ? stripAnsi(activeDict['model-name']).replace(/^(?:🤖\s*|[^:]+:\s*)/, '') : '';
    const rightText = fallbackModel || rawModel || 'Gemini 3.5 Flash (High)';
    const width = termWidth || 80;
    const spacesCount = Math.max(1, width - getDisplayWidth(leftText) - getDisplayWidth(rightText) - 1);
    const fallbackLine = `${leftText}${' '.repeat(spacesCount)}${rightText}`;
    lines.push(fallbackLine);
  }

  console.log(lines.join('\n'));
  return lines;
}

// ==========================================
// Main Entry
// ==========================================
async function main() {
  if (process.env.DISABLE_QUOTA_HOOK) process.exit(0);
  let meta = {};

  try {
    const stdinStr = await readStdin();
    try { if (stdinStr.trim()) meta = JSON.parse(stdinStr.replace(/^\uFEFF/, '')); } catch (e) {}

    const [settings, cachedAccount] = await Promise.all([
      getSettingsAsync(meta),
      manageAccountMetaCacheAsync(meta)
    ]);
    const termWidth = resolveTerminalWidth(meta, cachedAccount);
    
    let fallbackModel = 'Gemini 3.5 Flash (High)';
    if (meta?.model?.display_name) fallbackModel = meta.model.display_name;
    else if (meta?.model?.id) fallbackModel = meta.model.id;
    
    // 退讓模式
    if (!settings?.ui?.footer?.items || !Array.isArray(settings.ui.footer.items) || settings.ui.footer.items.length === 0) {
      const leftText = '? for shortcuts';
      const rightText = fallbackModel;
      const spacesCount = Math.max(1, termWidth - getDisplayWidth(leftText) - getDisplayWidth(rightText) - 1);
      console.log(`${leftText}${' '.repeat(spacesCount)}${rightText}`);
      process.exit(0);
    }
    
    const lang = normalizeLanguage(settings?.ui?.language || 'zh-tw');
    const footerItems = settings.ui.footer.items;
    let conversationId = 'default';
    if (typeof meta?.conversation_id === 'string' && meta.conversation_id) {
      conversationId = meta.conversation_id.replace(/\.\./g, '').replace(/\//g, '').replace(/\\/g, '');
    }
    
    // 讀取快取並優先整合 Antigravity CLI 原生 meta.quota
    const cachePath = join(os.homedir(), '.gemini', 'tmp', 'real_quota_cache.json');
    let cache = null;
    try {
      const cacheContent = await fs.readFile(cachePath, 'utf8');
      cache = JSON.parse(cacheContent.replace(/^\uFEFF/, ''));
    } catch (e) {}

    const metaQuota = parseMetaQuota(meta);
    if (metaQuota) {
      if (!cache) cache = {};
      cache.shortTerm = { ...(cache.shortTerm || {}), ...metaQuota.shortTerm };
      cache.weekly = { ...(cache.weekly || {}), ...metaQuota.weekly };
      const planTier = meta?.plan_tier || meta?.account?.plan_tier;
      const email = meta?.email || meta?.account?.email;
      if (planTier) cache.planTier = planTier;
      if (email) cache.email = email;
      cache.updatedAt = Date.now();
      try {
        await fs.mkdir(join(os.homedir(), '.gemini', 'tmp'), { recursive: true });
        await writeFileAndVerifyNoBOM(cachePath, JSON.stringify(cache, null, 2));
      } catch (_) {}
    } else {
      await triggerQuotaUpdateIfNeededAsync(cache);
    }

    // 解析核心資料
    const quotaInfo = resolveModelQuota(fallbackModel, cache);
    const weeklyInfo = resolveWeeklyQuota(fallbackModel, cache);
    const contextInfo = await calculateContextUsageAsync(meta, conversationId);

    const timeFormat = settings?.ui?.footer?.timeFormat || settings?.ui?.timeFormat || 'smart';
    const barLength = settings?.ui?.footer?.barLength || settings?.ui?.barLength || 10;
    const labelStyle = normalizeLabelStyle(settings?.ui?.footer?.labelStyle || settings?.ui?.footer?.style || settings?.ui?.labelStyle || 'text');
    const rawItemStyles = settings?.ui?.footer?.itemStyles;

    // 格式化指標並繪製
    const metrics = await extractMetricsAsync(meta, lang, fallbackModel, cache, cachedAccount, quotaInfo, contextInfo, weeklyInfo, { timeFormat, barLength });
    const activeDict = buildI18nDict(lang, metrics, labelStyle, rawItemStyles);
    renderStatusLine(footerItems, activeDict, termWidth, fallbackModel, rawItemStyles, labelStyle);

  } catch (err) {
    try {
      const projectLogDir = join(process.cwd(), '.gemini');
      await fs.access(projectLogDir);
      await fs.writeFile(join(projectLogDir, 'hook_error.log'), `[${new Date().toISOString()}] ${err.stack || err.message}\n`, { encoding: 'utf8', flag: 'a' });
    } catch (e) {}
    
    let fallbackModel = 'Gemini 3.5 Flash (High)';
    if (meta?.model?.display_name) fallbackModel = meta.model.display_name;
    else if (meta?.model?.id) fallbackModel = meta.model.id;
    console.log(`? for shortcuts | ${fallbackModel}`);
  }
  process.exit(0);
}

function isDirectExecution() {
  if (!process.argv[1]) return true;
  try {
    const scriptPath = process.argv[1].replace(/^"(.*)"$/, '$1');
    const metaPath = fileURLToPath(import.meta.url);
    if (path.resolve(scriptPath).toLowerCase() === path.resolve(metaPath).toLowerCase()) {
      return true;
    }
    try {
      if (realpathSync(scriptPath).toLowerCase() === realpathSync(metaPath).toLowerCase()) {
        return true;
      }
    } catch (_) {}
    return false;
  } catch (e) {
    return false;
  }
}

if (isDirectExecution()) {
  main();
}