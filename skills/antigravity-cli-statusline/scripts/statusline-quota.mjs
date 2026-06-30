import { promises as fs } from 'fs';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { join, basename } from 'path';
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

function stripAnsi(str) {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

function getDisplayWidth(str) {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    width += str.charCodeAt(i) > 0x7F ? 2 : 1;
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

// ==========================================
// System Information Retrieval
// ==========================================
const execAsync = promisify(exec);

async function runCmdAsync(cmd, options = {}) {
  const defaultOpts = {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 1000
  };
  try {
    const { stdout } = await execAsync(cmd, { ...defaultOpts, ...options });
    return (stdout || '').trim();
  } catch (err) {
    return '';
  }
}

async function getGitBranch(lang, projectPath) {
  try {
    const opts = {
      cwd: projectPath || process.cwd()
    };
    let branch = '';
    try {
      branch = await runCmdAsync('git branch --show-current', opts);
      if (!branch) {
        branch = await runCmdAsync('git rev-parse --abbrev-ref HEAD', opts);
      }
    } catch (e) {}

    if (!branch) {
      if (process.platform === 'win32') {
        const paths = [
          'C:\\Program Files\\Git\\cmd\\git.exe',
          'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
          'C:\\Program Files\\Git\\bin\\git.exe',
          '%USERPROFILE%\\AppData\\Local\\Programs\\Git\\cmd\\git.exe',
          '%USERPROFILE%\\scoop\\apps\\git\\current\\cmd\\git.exe'
        ].map(p => p.replace(/%USERPROFILE%/g, process.env.USERPROFILE || os.homedir()));
        for (const gitPath of paths) {
          try {
            await fs.access(gitPath);
            branch = await runCmdAsync(`"${gitPath}" branch --show-current`, opts);
            if (!branch) {
              branch = await runCmdAsync(`"${gitPath}" rev-parse --abbrev-ref HEAD`, opts);
            }
            if (branch) break;
          } catch (e) {}
        }
      } else {
        const paths = [
          '/usr/local/bin/git',
          '/opt/homebrew/bin/git',
          '/usr/bin/git'
        ];
        for (const gitPath of paths) {
          try {
            await fs.access(gitPath);
            branch = await runCmdAsync(`"${gitPath}" branch --show-current`, opts);
            if (!branch) {
              branch = await runCmdAsync(`"${gitPath}" rev-parse --abbrev-ref HEAD`, opts);
            }
            if (branch) break;
          } catch (e) {}
        }
      }
    }
    return branch || (lang === 'zh-tw' ? '無版本控制' : (lang === 'jp' ? 'バージョン管理なし' : 'No VC'));
  } catch (e) {
    return lang === 'zh-tw' ? '無版本控制' : (lang === 'jp' ? 'バージョン管理なし' : 'No VC');
  }
}

async function getGitDirty(projectPath) {
  try {
    const opts = {
      cwd: projectPath || process.cwd()
    };
    let out = '';
    try {
      out = await runCmdAsync('git status --porcelain', opts);
    } catch (err) {}

    if (!out) {
      if (process.platform === 'win32') {
        const paths = [
          'C:\\Program Files\\Git\\cmd\\git.exe',
          'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
          'C:\\Program Files\\Git\\bin\\git.exe',
          '%USERPROFILE%\\AppData\\Local\\Programs\\Git\\cmd\\git.exe',
          '%USERPROFILE%\\scoop\\apps\\git\\current\\cmd\\git.exe'
        ].map(p => p.replace(/%USERPROFILE%/g, process.env.USERPROFILE || os.homedir()));
        for (const gitPath of paths) {
          try {
            await fs.access(gitPath);
            out = await runCmdAsync(`"${gitPath}" status --porcelain`, opts);
            if (out) break;
          } catch (e) {}
        }
      } else {
        const paths = [
          '/usr/local/bin/git',
          '/opt/homebrew/bin/git',
          '/usr/bin/git'
        ];
        for (const gitPath of paths) {
          try {
            await fs.access(gitPath);
            out = await runCmdAsync(`"${gitPath}" status --porcelain`, opts);
            if (out) break;
          } catch (e) {}
        }
      }
    }
    return out.trim().length > 0;
  } catch (e) {
    return false;
  }
}

async function getCliMemoryMB() {
  try {
    if (process.platform === 'win32') {
      try {
        const cmd = `powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId = ${process.ppid}').WorkingSetSize"`;
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
    let timer = setTimeout(() => resolve(data), 50);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => { clearTimeout(timer); resolve(data); });
  });
}

async function getSettingsAsync() {
  const globalPath = join(os.homedir(), '.gemini', 'settings.json');
  const projectPath = join(process.cwd(), '.gemini', 'settings.json');
  let settings = {};
  try {
    const globalContent = await fs.readFile(globalPath, 'utf8');
    settings = JSON.parse(globalContent.replace(/^\uFEFF/, ''));
  } catch (e) {}
  try {
    const projContent = await fs.readFile(projectPath, 'utf8');
    const projSettings = JSON.parse(projContent.replace(/^\uFEFF/, ''));
    settings = { ...settings, ...projSettings };
    if (projSettings.ui) {
      settings.ui = { ...settings.ui, ...projSettings.ui };
      if (projSettings.ui.footer) settings.ui.footer = { ...settings.ui.footer, ...projSettings.ui.footer };
    }
  } catch (e) {}
  return settings;
}

// ==========================================
// Business Logic Helpers
// ==========================================
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

function resolveModelQuota(fallbackModel, cache) {
  const normModel = normalizeModelName(fallbackModel);
  let modelQuota = null;
  if (cache && cache.models) {
    // 1. Exact match
    if (cache.models[normModel]) {
      modelQuota = cache.models[normModel];
    } else {
      // 2. Substring match
      for (const k in cache.models) {
        if (normModel.includes(k) || k.includes(normModel)) {
          modelQuota = cache.models[k];
          break;
        }
      }
    }
    // 3. Family match
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
  // 4. Global minimum fallback
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
function resolveWeeklyQuota(fallbackModel, cache) {
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

async function manageAccountMetaCacheAsync(meta) {
  const accountMetaPath = join(os.homedir(), '.gemini', 'tmp', 'account_meta_cache.json');
  let cachedAccount = {};
  try {
    const content = await fs.readFile(accountMetaPath, 'utf8');
    cachedAccount = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch (e) {}
  
  if (meta && meta.account && (meta.account.email || meta.account.plan_tier)) {
    if (meta.account.email) cachedAccount.email = meta.account.email;
    if (meta.account.plan_tier) cachedAccount.planTier = meta.account.plan_tier;
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

async function extractMetricsAsync(meta, lang, fallbackModel, cache, cachedAccount, quotaInfo, contextInfo, weeklyInfo = { remaining_percentage: 100, refreshes_in: '' }) {
  const unknownStr = lang === 'zh-tw' ? '未知' : (lang === 'jp' ? '不明' : 'Unknown');
  const noneStr = lang === 'zh-tw' ? '無' : (lang === 'jp' ? 'なし' : 'N/A');

  // Quota
  const quotaPct = quotaInfo.remaining_percentage;
  const quotaColor = getColorByPercentage(quotaPct);
  const quotaVal = `${Math.round(quotaPct)}%`;
  const countdownVal = quotaInfo.refreshes_in || noneStr;

  // Weekly Quota
  const weeklyPct = weeklyInfo.remaining_percentage;
  const weeklyQuotaColor = getColorByPercentage(weeklyPct);
  const weeklyQuotaVal = `${Math.round(weeklyPct)}%`;
  const weeklyCountdownVal = weeklyInfo.refreshes_in || noneStr;

  // Context
  const remainCtx = Math.max(0, 100 - contextInfo.usedPctNum);
  const contextColor = getColorByPercentage(remainCtx);
  const usedPct = `${contextInfo.usedPctNum.toFixed(1)}%`;
  const tokenCount = `${contextColor}${formatTokens(contextInfo.totalInput)}${RESET} / ${formatTokens(contextInfo.contextSize)}`;

  const projectPath = (typeof meta?.project?.path === 'string' && meta.project.path) ? meta.project.path : process.cwd();
  const projectName = basename(projectPath);
  const projectFullPath = projectPath;

  // Account
  const planTier = (cache && cache.planTier) ? cache.planTier : (meta?.account?.plan_tier || cachedAccount.planTier || unknownStr);
  const accountEmail = (cache && cache.email) ? cache.email : (meta?.account?.email || cachedAccount.email || unknownStr);

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

  // 併行執行非同步操作
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
      : getGitBranch(lang, projectPath),

    // 2. Git Dirty
    (typeof meta?.vcs?.dirty === 'boolean')
      ? Promise.resolve(meta.vcs.dirty)
      : getGitDirty(projectPath),

    // 3. Memory
    getCliMemoryMB(),

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
    ? (lang === 'zh-tw' ? '有變更' : (lang === 'jp' ? '変更あり' : 'dirty'))
    : (lang === 'zh-tw' ? '乾淨' : (lang === 'jp' ? 'クリーン' : 'clean'));
  const vcsType = meta?.vcs?.type || 'git';

  const sandboxEnabled = !!meta?.sandbox?.enabled;
  const sandboxAllowNet = !!meta?.sandbox?.allow_network;
  let sandboxStatusVal;
  if (!sandboxEnabled) {
    sandboxStatusVal = lang === 'zh-tw' ? '關閉' : (lang === 'jp' ? 'オフ' : 'off');
  } else if (sandboxAllowNet) {
    sandboxStatusVal = lang === 'zh-tw' ? '啟用（聯網）' : (lang === 'jp' ? 'オン（ネット）' : 'on (net)');
  } else {
    sandboxStatusVal = lang === 'zh-tw' ? '啟用（離線）' : (lang === 'jp' ? 'オン（オフライン）' : 'on (no-net)');
  }

  let agentProfileName = lang === 'zh-tw' ? '預設' : (lang === 'jp' ? 'デフォルト' : 'Default');
  if (typeof meta?.agent === 'string') agentProfileName = meta.agent;
  else if (meta?.agent?.display_name) agentProfileName = meta.agent.display_name;
  else if (meta?.agent?.name) agentProfileName = meta.agent.name;
  else if (meta?.agent?.id) agentProfileName = meta.agent.id;
  else if (meta?.agent?.profile) agentProfileName = meta.agent.profile;

  const cliVersion = meta?.version ? `v${meta.version}` : unknownStr;
  const rawConvId = typeof meta?.conversation_id === 'string' ? meta.conversation_id : '';
  const conversationIdShort = rawConvId ? rawConvId.replace(/-/g, '').slice(0, 8) : unknownStr;

  return {
    fallbackModel, quotaColor, quotaVal, contextColor, usedPct, memUsage, tokenCount,
    countdownVal, gitBranch, projectName, projectFullPath, planTier, accountEmail,
    agentState, toolConfirmPending, pendingInputCount, backgroundTasksCount, subagentsCount,
    artifactsCount, vcsDirtyFlag, vcsDirtyGlyph, vcsDirtyLabel, vcsType, sandboxEnabled,
    sandboxAllowNet, sandboxStatusVal, cliVersion, conversationIdShort, agentProfileName,
    weeklyQuotaColor, weeklyQuotaVal, weeklyCountdownVal
  };
}

function buildI18nDict(lang, m) {
  const dicts = {
    'zh-tw': {
      'model-name': `${WHITE}目前使用的人工智慧（AI）模型名稱:${RESET} ${getModelColor(m.fallbackModel)}${BOLD}${m.fallbackModel}${RESET}`,
      'quota': `${WHITE}帳號真實應用程式介面（API）可用額度:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}目前對話已消耗的上下文（Context）比例:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}命令列介面（CLI）行程所消耗的隨機存取記憶體（RAM）記憶體量:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}目前工作階段（Session）消耗的精確權杖（Token）數量:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}應用程式介面（API）重置時間倒數:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'quota-weekly': `${WHITE}帳號每週應用程式介面（API）可用額度:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET}`,
      'quota-weekly-countdown': `${WHITE}每週應用程式介面（API）重置時間倒數:${RESET} ${BLUE}${BOLD}${m.weeklyCountdownVal}${RESET}`,
      'git-branch': `${WHITE}目前工作區專案的 Git 分支: ${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}目前工作區專案短路徑: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `${WHITE}目前工作區專案完整路徑: ${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}目前訂閱方案等級（Plan Tier）: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}帳號電子郵件（Account Email）: ${BOLD}${m.accountEmail}${RESET}`,
      'agent-state': `${WHITE}代理當前狀態（Agent State）:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${m.agentState}${RESET}`,
      'tool-confirmation': `${WHITE}是否有等你回應的工具確認對話方塊（Dialog Box）:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? '在等你' : '都好了'}${RESET}`,
      'pending-input': `${WHITE}佇列中待處理的使用者輸入數:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}進行中的背景任務數:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}活躍子代理數:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}本次對話人工智慧（AI）累計產出的工件（Artifacts）/ 檔案數: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}工作區是否有未提交變更（dirty / clean）:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyGlyph} ${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}版本控制類型（git / jj / fig）: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}沙盒模式狀態（off / on (net) / on (no-net)）:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `${WHITE}Antigravity 命令列介面（CLI）版本號: ${BOLD}${m.cliVersion}${RESET}`,
      'conversation-id': `${WHITE}目前對話識別碼（ID）（前 8 碼，用於除錯）: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `${WHITE}使用中代理:${RESET} ${BLUE}${BOLD}${m.agentProfileName}${RESET}`
    },
    'us': {
      'model-name': `${WHITE}Model:${RESET} ${getModelColor(m.fallbackModel)}${BOLD}${m.fallbackModel}${RESET}`,
      'quota': `${WHITE}API Available:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}Context:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}RAM:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}Tokens:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}API Reset in:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'quota-weekly': `${WHITE}Weekly API Available:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET}`,
      'quota-weekly-countdown': `${WHITE}Weekly API Reset in:${RESET} ${BLUE}${BOLD}${m.weeklyCountdownVal}${RESET}`,
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
      'agent-profile': `${WHITE}Profile:${RESET} ${BLUE}${BOLD}${m.agentProfileName}${RESET}`
    },
    'jp': {
      'model-name': `${WHITE}モデル:${RESET} ${getModelColor(m.fallbackModel)}${BOLD}${m.fallbackModel}${RESET}`,
      'quota': `${WHITE}API 利用可能枠:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}コンテキスト:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}メモリ:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}トークン数:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}API リセットまで:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'quota-weekly': `${WHITE}週間 API 利用可能枠:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET}`,
      'quota-weekly-countdown': `${WHITE}週間 API リセットまで:${RESET} ${BLUE}${BOLD}${m.weeklyCountdownVal}${RESET}`,
      'git-branch': `${WHITE}Gitブランチ: ${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}プロジェクト: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `${WHITE}プロジェクトパス: ${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}プラン: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}アカウント: ${BOLD}${m.accountEmail}${RESET}`,
      'agent-state': `${WHITE}エージェント状態:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${m.agentState}${RESET}`,
      'tool-confirmation': `${WHITE}ご承認待ち:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? '待機中' : 'すべて完了'}${RESET}`,
      'pending-input': `${WHITE}入力キュー:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}バックグラウンドタスク:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}サブエージェント:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}累計成果物: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}作業領域:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyGlyph} ${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}VCS種別: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}サンドボックス:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `${WHITE}CLIバージョン: ${BOLD}${m.cliVersion}${RESET}`,
      'conversation-id': `${WHITE}会話 ID: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `${WHITE}エージェントプロファイル:${RESET} ${BLUE}${BOLD}${m.agentProfileName}${RESET}`
    }
  };
  return dicts[lang] || dicts['zh-tw'];
}

function renderStatusLine(footerItems, activeDict, termWidth) {
  const lines = [];
  let currentLine = '';
  
  for (let i = 0; i < footerItems.length; i++) {
    const item = footerItems[i];
    if (item === 'n' || item === 'newline') {
      if (currentLine !== '') {
        lines.push(currentLine);
        currentLine = '';
      } else {
        lines.push(' ');
      }
      continue;
    }

    const text = activeDict[item];
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
  console.log(lines.join('\n'));
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

    const settings = await getSettingsAsync();
    const termWidth = Math.max(40, (meta?.terminal_width || process.stdout.columns || 80) - 15);
    
    let fallbackModel = 'Gemini 3.5 Flash (High)';
    if (meta?.model?.display_name) fallbackModel = meta.model.display_name;
    else if (meta?.model?.id) fallbackModel = meta.model.id;
    
    // 退讓模式
    if (!settings?.ui?.footer?.items) {
      const leftText = '? for shortcuts';
      const rightText = fallbackModel;
      const spacesCount = Math.max(1, termWidth - getDisplayWidth(leftText) - getDisplayWidth(rightText) - 1);
      console.log(`${leftText}${' '.repeat(spacesCount)}${rightText}`);
      process.exit(0);
    }
    
    const lang = settings?.ui?.language || 'zh-tw';
    const footerItems = settings.ui.footer.items;
    let conversationId = 'default';
    if (typeof meta?.conversation_id === 'string' && meta.conversation_id) {
      conversationId = meta.conversation_id.replace(/\.\./g, '').replace(/\//g, '').replace(/\\/g, '');
    }
    
    // 讀取快取並觸發更新
    const cachePath = join(os.homedir(), '.gemini', 'tmp', 'real_quota_cache.json');
    let cache = null;
    try {
      const cacheContent = await fs.readFile(cachePath, 'utf8');
      cache = JSON.parse(cacheContent.replace(/^\uFEFF/, ''));
    } catch (e) {}
    await triggerQuotaUpdateIfNeededAsync(cache);

    // 解析核心資料
    const quotaInfo = resolveModelQuota(fallbackModel, cache);
    const weeklyInfo = resolveWeeklyQuota(fallbackModel, cache);
    const contextInfo = await calculateContextUsageAsync(meta, conversationId);
    const cachedAccount = await manageAccountMetaCacheAsync(meta);

    // 格式化指標並繪製
    const metrics = await extractMetricsAsync(meta, lang, fallbackModel, cache, cachedAccount, quotaInfo, contextInfo, weeklyInfo);
    const activeDict = buildI18nDict(lang, metrics);
    renderStatusLine(footerItems, activeDict, termWidth);

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

main();