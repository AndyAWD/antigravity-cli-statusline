import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { spawn, execSync } from 'child_process';
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
function getGitBranch(lang, projectPath) {
  try {
    const opts = {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      cwd: projectPath || process.cwd(),
      timeout: 1000
    };
    let branch = '';
    try {
      try {
        branch = execSync('git branch --show-current', opts).trim();
      } catch (e) {}
      if (!branch) {
        branch = execSync('git rev-parse --abbrev-ref HEAD', opts).trim();
      }
    } catch (err) {
      if (process.platform === 'win32') {
        const paths = [
          'C:\\Program Files\\Git\\cmd\\git.exe',
          'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
          'C:\\Program Files\\Git\\bin\\git.exe'
        ];
        for (const gitPath of paths) {
          if (existsSync(gitPath)) {
            try {
              try {
                branch = execSync(`"${gitPath}" branch --show-current`, opts).trim();
              } catch (e) {}
              if (!branch) {
                branch = execSync(`"${gitPath}" rev-parse --abbrev-ref HEAD`, opts).trim();
              }
              if (branch) break;
            } catch (e) {}
          }
        }
      } else {
        const paths = [
          '/usr/local/bin/git',
          '/opt/homebrew/bin/git',
          '/usr/bin/git'
        ];
        for (const gitPath of paths) {
          if (existsSync(gitPath)) {
            try {
              try {
                branch = execSync(`"${gitPath}" branch --show-current`, opts).trim();
              } catch (e) {}
              if (!branch) {
                branch = execSync(`"${gitPath}" rev-parse --abbrev-ref HEAD`, opts).trim();
              }
              if (branch) break;
            } catch (e) {}
          }
        }
      }
    }
    return branch || (lang === 'zh-tw' ? '無版本控制' : (lang === 'jp' ? 'バージョン管理なし' : 'No VC'));
  } catch (e) {
    return lang === 'zh-tw' ? '無版本控制' : (lang === 'jp' ? 'バージョン管理なし' : 'No VC');
  }
}

function getGitDirty(projectPath) {
  try {
    const opts = {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      cwd: projectPath || process.cwd(),
      timeout: 1000
    };
    let out = '';
    try {
      out = execSync('git status --porcelain', opts);
    } catch (err) {
      if (process.platform === 'win32') {
        const paths = [
          'C:\\Program Files\\Git\\cmd\\git.exe',
          'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
          'C:\\Program Files\\Git\\bin\\git.exe'
        ];
        for (const gitPath of paths) {
          if (existsSync(gitPath)) {
            try {
              out = execSync(`"${gitPath}" status --porcelain`, opts);
              break;
            } catch (e) {}
          }
        }
      } else {
        const paths = [
          '/usr/local/bin/git',
          '/opt/homebrew/bin/git',
          '/usr/bin/git'
        ];
        for (const gitPath of paths) {
          if (existsSync(gitPath)) {
            try {
              out = execSync(`"${gitPath}" status --porcelain`, opts);
              break;
            } catch (e) {}
          }
        }
      }
    }
    return out.trim().length > 0;
  } catch (e) {
    return false;
  }
}

function getCliMemoryMB() {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`powershell -NoProfile -Command "(Get-Process -Name 'agy' -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet -Sum).Sum"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 1000 });
      const totalBytes = parseInt(output.trim(), 10);
      if (!isNaN(totalBytes)) {
        return Math.round(totalBytes / 1024 / 1024);
      }
    } else {
      const output = execSync(`ps -o rss= -p ${process.ppid}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 1000 });
      const memKb = parseInt(output.trim(), 10);
      if (!isNaN(memKb)) return Math.round(memKb / 1024);
    }
  } catch (e) {}
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
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

function getSettings() {
  const globalPath = join(os.homedir(), '.gemini', 'settings.json');
  const projectPath = join(process.cwd(), '.gemini', 'settings.json');
  let settings = {};
  try { if (existsSync(globalPath)) settings = JSON.parse(readFileSync(globalPath, 'utf8')); } catch (e) {}
  try {
    if (existsSync(projectPath)) {
      const projSettings = JSON.parse(readFileSync(projectPath, 'utf8'));
      settings = { ...settings, ...projSettings };
      if (projSettings.ui) {
        settings.ui = { ...settings.ui, ...projSettings.ui };
        if (projSettings.ui.footer) settings.ui.footer = { ...settings.ui.footer, ...projSettings.ui.footer };
      }
    }
  } catch (e) {}
  return settings;
}

// ==========================================
// Business Logic Helpers
// ==========================================
function triggerQuotaUpdateIfNeeded(cacheInfo) {
  let needUpdate = true;
  if (cacheInfo && Date.now() - (cacheInfo.updatedAt || 0) < 30000) needUpdate = false;

  if (needUpdate) {
    try {
      const updaterScript = join(os.homedir(), '.gemini', 'antigravity-cli', 'hooks', 'fetch-local-quota.mjs');
      if (existsSync(updaterScript)) {
        spawn('node', [updaterScript], {
          env: { ...process.env, DISABLE_QUOTA_HOOK: '1' },
          stdio: 'ignore',
          detached: true,
          windowsHide: true
        }).unref();
      }
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

function calculateContextUsage(meta, conversationId) {
  const contextWindow = meta.context_window || {};
  const ctxCachePath = join(os.homedir(), '.gemini', 'tmp', `ctx_${conversationId}.json`);
  
  let totalInput = contextWindow.total_input_tokens || 0;
  let totalOutput = contextWindow.total_output_tokens || 0;
  let usedPctNum = contextWindow.used_percentage || 0;
  let contextSize = contextWindow.context_window_size || 0;
  
  if (totalInput === 0 && totalOutput === 0) {
    try {
      if (existsSync(ctxCachePath)) {
        const cachedCtx = JSON.parse(readFileSync(ctxCachePath, 'utf8'));
        totalInput = cachedCtx.total_input_tokens || 0;
        totalOutput = cachedCtx.total_output_tokens || 0;
        if (cachedCtx.used_percentage) usedPctNum = cachedCtx.used_percentage;
        if (cachedCtx.context_window_size) contextSize = cachedCtx.context_window_size;
      }
    } catch (e) {}
  } else {
    try {
      mkdirSync(join(os.homedir(), '.gemini', 'tmp'), { recursive: true });
      writeFileSync(ctxCachePath, JSON.stringify({
        total_input_tokens: totalInput,
        total_output_tokens: totalOutput,
        used_percentage: usedPctNum,
        context_window_size: contextSize
      }), { encoding: 'utf8' });
    } catch (e) {}
  }
  
  if (!contextSize) contextSize = 1048576;
  if (contextSize > 0 && totalInput > 0 && !usedPctNum) {
    usedPctNum = (totalInput / contextSize) * 100;
  }
  
  return { totalInput, contextSize, usedPctNum };
}

function manageAccountMetaCache(meta) {
  const accountMetaPath = join(os.homedir(), '.gemini', 'tmp', 'account_meta_cache.json');
  let cachedAccount = {};
  try { if (existsSync(accountMetaPath)) cachedAccount = JSON.parse(readFileSync(accountMetaPath, 'utf8')); } catch (e) {}
  
  if (meta && meta.account && (meta.account.email || meta.account.plan_tier || meta.account.ai_credits)) {
    if (meta.account.email) cachedAccount.email = meta.account.email;
    if (meta.account.plan_tier) cachedAccount.planTier = meta.account.plan_tier;
    if (meta.account.ai_credits) cachedAccount.aiCredits = meta.account.ai_credits;
    try { writeFileSync(accountMetaPath, JSON.stringify(cachedAccount), { encoding: 'utf8' }); } catch (e) {}
  }
  return cachedAccount;
}

function getMetricValue(meta, keys, countersCachePath, fallbackFn) {
  if (meta) {
    for (const key of keys) {
      if (meta[key] !== undefined && meta[key] !== null) {
        return safeGetCount(meta[key]);
      }
    }
  }

  let cacheCounters = null;
  if (countersCachePath && existsSync(countersCachePath)) {
    try {
      cacheCounters = JSON.parse(readFileSync(countersCachePath, 'utf8'));
    } catch (e) {}
  }

  if (cacheCounters) {
    for (const key of keys) {
      if (cacheCounters[key] !== undefined && cacheCounters[key] !== null) {
        return safeGetCount(cacheCounters[key]);
      }
    }
  }

  return fallbackFn();
}

function extractMetrics(meta, lang, fallbackModel, cache, cachedAccount, quotaInfo, contextInfo) {
  const unknownStr = lang === 'zh-tw' ? '未知' : (lang === 'jp' ? '不明' : 'Unknown');
  const noneStr = lang === 'zh-tw' ? '無' : (lang === 'jp' ? 'なし' : 'N/A');

  // Quota
  const quotaPct = quotaInfo.remaining_percentage;
  const quotaColor = getColorByPercentage(quotaPct);
  const quotaVal = `${Math.round(quotaPct)}%`;
  const countdownVal = quotaInfo.refreshes_in || noneStr;

  // Context
  const remainCtx = Math.max(0, 100 - contextInfo.usedPctNum);
  const contextColor = getColorByPercentage(remainCtx);
  const usedPct = `${contextInfo.usedPctNum.toFixed(1)}%`;
  const tokenCount = `${contextColor}${formatTokens(contextInfo.totalInput)}${RESET} / ${formatTokens(contextInfo.contextSize)}`;

  // System & Environment
  const rssMem = getCliMemoryMB();
  const memUsage = `${rssMem}MB`;
  const projectPath = (typeof meta?.project?.path === 'string' && meta.project.path) ? meta.project.path : process.cwd();
  const projectName = basename(projectPath);
  const projectFullPath = projectPath;
  let gitBranch;
  if (typeof meta?.vcs?.branch === 'string' && meta.vcs.branch) {
    gitBranch = meta.vcs.branch;
  } else {
    gitBranch = getGitBranch(lang, projectPath);
  }

  // Account
  const planTier = (cache && cache.planTier) ? cache.planTier : (meta?.account?.plan_tier || cachedAccount.planTier || unknownStr);
  const accountEmail = (cache && cache.email) ? cache.email : (meta?.account?.email || cachedAccount.email || unknownStr);
  const aiCredits = (cache && cache.aiCredits) ? cache.aiCredits : (meta?.account?.ai_credits || cachedAccount.aiCredits || noneStr);

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

  // 1. pending-input
  const pendingInputCount = getMetricValue(
    meta,
    ['pending_input_count', 'pending_input', 'pending_inputs'],
    countersCachePath,
    () => {
      const pendingInputFilePath = join(os.homedir(), '.gemini', 'tmp', 'pending_input_count');
      if (existsSync(pendingInputFilePath)) {
        try {
          const fileContent = readFileSync(pendingInputFilePath, 'utf8').trim();
          const parsed = Number(fileContent);
          return isNaN(parsed) ? 0 : parsed;
        } catch (e) {
          return 0;
        }
      } else if (process.env.PENDING_INPUT_COUNT !== undefined) {
        const parsed = Number(process.env.PENDING_INPUT_COUNT);
        return isNaN(parsed) ? 0 : parsed;
      } else {
        return 0;
      }
    }
  );

  // 2. background-tasks
  const backgroundTasksCount = getMetricValue(
    meta,
    ['background_tasks', 'background_tasks_count', 'background_jobs'],
    countersCachePath,
    () => {
      const bgTasksDir = join(os.homedir(), '.gemini', 'tmp', 'background-processes');
      if (existsSync(bgTasksDir)) {
        try {
          const files = readdirSync(bgTasksDir);
          let count = 0;
          for (const file of files) {
            if (file.startsWith('.')) continue;
            try {
              const stat = statSync(join(bgTasksDir, file));
              if (stat.isFile()) {
                count++;
              }
            } catch (e) {}
          }
          return count;
        } catch (e) {
          return 0;
        }
      } else {
        return 0;
      }
    }
  );

  // 3. subagents
  const subagentsCount = getMetricValue(
    meta,
    ['subagents', 'subagents_count', 'active_subagents'],
    countersCachePath,
    () => {
      const agentsDir = join(projectPath, '.agents');
      if (existsSync(agentsDir)) {
        try {
          const dirs = readdirSync(agentsDir);
          let count = 0;
          const now = Date.now();
          for (const d of dirs) {
            if (d.startsWith('.')) continue;
            const dPath = join(agentsDir, d);
            try {
              const statD = statSync(dPath);
              if (statD.isDirectory()) {
                const progressPath = join(dPath, 'progress.md');
                if (existsSync(progressPath)) {
                  const statP = statSync(progressPath);
                  if (now - statP.mtimeMs <= 300000) {
                    count++;
                  }
                }
              }
            } catch (e) {}
          }
          return count;
        } catch (e) {
          return 0;
        }
      } else {
        return 0;
      }
    }
  );

  // 4. artifacts
  const artifactsCount = getMetricValue(
    meta,
    ['artifacts', 'artifacts_count', 'artifact_count'],
    countersCachePath,
    () => {
      const rawConvId = (typeof meta?.conversation_id === 'string' && meta.conversation_id)
        ? meta.conversation_id.replace(/\.\./g, '').replace(/\//g, '').replace(/\\/g, '')
        : '';
      if (rawConvId) {
        const brainDir = join(os.homedir(), '.gemini', 'antigravity-cli', 'brain', rawConvId);
        if (existsSync(brainDir)) {
          try {
            const files = readdirSync(brainDir);
            const metadataFiles = files.filter(f => f.endsWith('.metadata.json'));
            return metadataFiles.length;
          } catch (e) {
            return 0;
          }
        } else {
          return 0;
        }
      } else {
        return 0;
      }
    }
  );

  let agentProfileName = lang === 'zh-tw' ? '預設' : (lang === 'jp' ? 'デフォルト' : 'Default');
  if (typeof meta?.agent === 'string') agentProfileName = meta.agent;
  else if (meta?.agent?.display_name) agentProfileName = meta.agent.display_name;
  else if (meta?.agent?.name) agentProfileName = meta.agent.name;
  else if (meta?.agent?.id) agentProfileName = meta.agent.id;
  else if (meta?.agent?.profile) agentProfileName = meta.agent.profile;

  // VCS & Sandbox
  let vcsDirtyFlag;
  if (typeof meta?.vcs?.dirty === 'boolean') {
    vcsDirtyFlag = meta.vcs.dirty;
  } else {
    vcsDirtyFlag = getGitDirty(projectPath);
  }
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

  // CLI
  const cliVersion = meta?.version ? `v${meta.version}` : unknownStr;
  const rawConvId = typeof meta?.conversation_id === 'string' ? meta.conversation_id : '';
  const conversationIdShort = rawConvId ? rawConvId.replace(/-/g, '').slice(0, 8) : unknownStr;

  return {
    fallbackModel, quotaColor, quotaVal, contextColor, usedPct, memUsage, tokenCount,
    countdownVal, gitBranch, projectName, projectFullPath, planTier, accountEmail, aiCredits,
    agentState, toolConfirmPending, pendingInputCount, backgroundTasksCount, subagentsCount,
    artifactsCount, vcsDirtyFlag, vcsDirtyGlyph, vcsDirtyLabel, vcsType, sandboxEnabled,
    sandboxAllowNet, sandboxStatusVal, cliVersion, conversationIdShort, agentProfileName
  };
}

function buildI18nDict(lang, m) {
  const dicts = {
    'zh-tw': {
      'model-name': `${WHITE}模型:${RESET} ${getModelColor(m.fallbackModel)}${BOLD}${m.fallbackModel}${RESET}`,
      'quota': `${WHITE}API 可用額度:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}Context:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}記憶體:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}Token:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}API 重置倒數:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'git-branch': `${WHITE}Git 分支: ${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}專案: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `${WHITE}專案路徑: ${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}帳號等級: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}帳號: ${BOLD}${m.accountEmail}${RESET}`,
      'ai-credits': `${WHITE}AI 點數:${RESET} ${BLUE}${BOLD}${m.aiCredits}${RESET}`,
      'agent-state': `${WHITE}代理狀態:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${m.agentState}${RESET}`,
      'tool-confirmation': `${WHITE}等你同意:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? '在等你' : '都好了'}${RESET}`,
      'pending-input': `${WHITE}輸入佇列:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}背景任務:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}子代理:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}累計產出: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}工作區:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyGlyph} ${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}版控類型: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}沙盒:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `${WHITE}CLI 版本: ${BOLD}${m.cliVersion}${RESET}`,
      'conversation-id': `${WHITE}對話 ID: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `${WHITE}使用中代理:${RESET} ${BLUE}${BOLD}${m.agentProfileName}${RESET}`
    },
    'us': {
      'model-name': `${WHITE}Model:${RESET} ${getModelColor(m.fallbackModel)}${BOLD}${m.fallbackModel}${RESET}`,
      'quota': `${WHITE}API Available:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}Context:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}RAM:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}Tokens:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}API Reset in:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'git-branch': `${WHITE}Git: ${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}Project: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `${WHITE}Project Path: ${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}Plan: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}Account: ${BOLD}${m.accountEmail}${RESET}`,
      'ai-credits': `${WHITE}AI Credits:${RESET} ${BLUE}${BOLD}${m.aiCredits}${RESET}`,
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
      'git-branch': `${WHITE}Gitブランチ: ${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}プロジェクト: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `${WHITE}プロジェクトパス: ${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}プラン: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}アカウント: ${BOLD}${m.accountEmail}${RESET}`,
      'ai-credits': `${WHITE}AI クレジット:${RESET} ${BLUE}${BOLD}${m.aiCredits}${RESET}`,
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
    try { if (stdinStr.trim()) meta = JSON.parse(stdinStr); } catch (e) {}

    const settings = getSettings();
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
    try { if (existsSync(cachePath)) cache = JSON.parse(readFileSync(cachePath, 'utf8')); } catch (e) {}
    triggerQuotaUpdateIfNeeded(cache);

    // 解析核心資料
    const quotaInfo = resolveModelQuota(fallbackModel, cache);
    const contextInfo = calculateContextUsage(meta, conversationId);
    const cachedAccount = manageAccountMetaCache(meta);

    // 格式化指標並繪製
    const metrics = extractMetrics(meta, lang, fallbackModel, cache, cachedAccount, quotaInfo, contextInfo);
    const activeDict = buildI18nDict(lang, metrics);
    renderStatusLine(footerItems, activeDict, termWidth);

  } catch (err) {
    try {
      const projectLogDir = join(process.cwd(), '.gemini');
      if (existsSync(projectLogDir)) {
        writeFileSync(join(projectLogDir, 'hook_error.log'), `[${new Date().toISOString()}] ${err.stack || err.message}\\n`, { encoding: 'utf8', flag: 'a' });
      }
    } catch (e) {}
    
    let fallbackModel = 'Gemini 3.5 Flash (High)';
    if (meta?.model?.display_name) fallbackModel = meta.model.display_name;
    else if (meta?.model?.id) fallbackModel = meta.model.id;
    console.log(`? for shortcuts | ${fallbackModel}`);
  }
  process.exit(0);
}

main();