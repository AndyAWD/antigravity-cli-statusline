import { promises as fs } from 'fs';
import { basename, join } from 'path';
import os from 'os';
import { DEFAULT_COMPACTION_THRESHOLD } from '../core/constants.mjs';
import { readJsonSafeAsync } from '../core/fs-utils.mjs';
import { formatTokens, normalizeLanguage, safeGetCount, sanitizeConversationId } from '../core/normalize.mjs';
import { resolveInstalledPluginVersionAsync } from '../core/plugin-manifest.mjs';
import { runCmdDetailedAsync, withTimeout } from '../core/process-utils.mjs';
import { resolveProjectPath } from '../core/settings.mjs';
import { RESET, getColorByPercentage, renderBarGraph } from '../renderers/ansi.mjs';
import { resolveArgonQuota } from './quota.mjs';
import { formatAbsoluteResetTime } from './time-format.mjs';

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

function runGitAsync(execFn, gitBin, args, projectPath) {
  const cwd = (typeof projectPath === 'string' && projectPath) ? projectPath : process.cwd();
  const display = gitBin === 'git' ? 'git' : `"${gitBin}"`;
  return execFn(`${display} ${args.join(' ')}`, { cwd, execFile: gitBin, execArgs: args });
}

/**
 * 探測目前工作區專案的 Git 分支名稱，失敗或非 Git 專案時依語系回傳無版本控制文案。
 * @param {string} lang
 * @param {string} [projectPath]
 * @param {Function} [execFn=runCmdDetailedAsync]
 * @returns {Promise<string>}
 */
export async function getGitBranch(lang, projectPath, execFn = runCmdDetailedAsync) {
  const normLang = normalizeLanguage(lang);
  const noVcStr = normLang === 'zh-tw' ? '無版本控制' : (normLang === 'zh-cn' ? '无版本控制' : (normLang === 'jp' ? 'バージョン管理なし' : 'No VC'));
  try {
    const res = await runGitAsync(execFn, 'git', ['branch', '--show-current'], projectPath);
    if (res.ok) {
      if (res.stdout) return res.stdout;
      const revRes = await runGitAsync(execFn, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
      return (revRes.ok && revRes.stdout) ? revRes.stdout : noVcStr;
    }

    if (res.notFound) {
      const paths = getGitFallbackPaths();
      for (const gitPath of paths) {
        try {
          await fs.access(gitPath);
          const fbRes = await runGitAsync(execFn, gitPath, ['branch', '--show-current'], projectPath);
          if (fbRes.ok && fbRes.stdout) return fbRes.stdout;
          if (fbRes.ok) {
            const fbRev = await runGitAsync(execFn, gitPath, ['rev-parse', '--abbrev-ref', 'HEAD'], projectPath);
            return (fbRev.ok && fbRev.stdout) ? fbRev.stdout : noVcStr;
          }
          break;
        } catch (_) {}
      }
    }
    return noVcStr;
  } catch (_) {
    return noVcStr;
  }
}

/**
 * 探測目前工作區是否有未提交的 Git 變更。
 * @param {string} [projectPath]
 * @param {Function} [execFn=runCmdDetailedAsync]
 * @returns {Promise<boolean>}
 */
export async function getGitDirty(projectPath, execFn = runCmdDetailedAsync) {
  try {
    const res = await runGitAsync(execFn, 'git', ['status', '--porcelain'], projectPath);
    if (res.ok) {
      return res.stdout.length > 0;
    }

    if (res.notFound) {
      const paths = getGitFallbackPaths();
      for (const gitPath of paths) {
        try {
          await fs.access(gitPath);
          const fbRes = await runGitAsync(execFn, gitPath, ['status', '--porcelain'], projectPath);
          return fbRes.ok ? fbRes.stdout.length > 0 : false;
        } catch (_) {}
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * 探測父代 Antigravity CLI 行程所佔用的記憶體用量（單位：MB）。
 * @param {Function} [execFn=runCmdDetailedAsync]
 * @returns {Promise<number>}
 */
export async function getCliMemoryMB(execFn = runCmdDetailedAsync) {
  try {
    if (process.platform === 'win32') {
      try {
        const script = `Get-CimInstance Win32_Process -Filter 'ProcessId = ${process.ppid}' | ForEach-Object { if ($_.Name -like '*agy*') { $_ } else { Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $_.ParentProcessId) } } | ForEach-Object { if ($_.Name -like '*agy*') { $_.WorkingSetSize } }`;
        const execArgs = ['-NoProfile', '-Command', script];
        const res = await execFn(`powershell.exe -NoProfile -Command "${script}"`, { execFile: 'powershell.exe', execArgs });
        const output = res?.ok ? (res.stdout || '') : '';
        const memBytes = parseInt(output.trim(), 10);
        if (!isNaN(memBytes) && memBytes > 0) {
          return Math.round(memBytes / 1024 / 1024);
        }
      } catch (_) {}
      return Math.round(process.memoryUsage().rss / 1024 / 1024);
    } else {
      const execArgs = ['-o', 'rss=', '-p', String(process.ppid)];
      const res = await execFn(`ps ${execArgs.join(' ')}`, { execFile: 'ps', execArgs });
      const output = res?.ok ? (res.stdout || '') : '';
      const memKb = parseInt(output.trim(), 10);
      if (!isNaN(memKb)) return Math.round(memKb / 1024);
    }
  } catch (_) {}
  try {
    return Math.round(process.memoryUsage().rss / 1024 / 1024);
  } catch (_) {
    return 0;
  }
}

/**
 * 依三層優先序解析計數型指標：meta 原生欄位 -> 計數器快取檔 -> 檔案系統退讓探測。
 * @param {object} meta
 * @param {string[]} keys
 * @param {string} countersCachePath
 * @param {Function} fallbackFn
 * @returns {Promise<number>}
 */
export async function getMetricValueAsync(meta, keys, countersCachePath, fallbackFn) {
  if (meta) {
    for (const key of keys) {
      if (meta[key] !== undefined && meta[key] !== null) {
        return safeGetCount(meta[key]);
      }
    }
  }

  let cacheCounters = null;
  if (countersCachePath) {
    cacheCounters = await readJsonSafeAsync(countersCachePath);
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

/**
 * 彙整與探測所有狀態列指標，依 footerItems 門控非必要子行程與檔案系統探測。
 * 當 options.skipPluginVersionResolve !== true 且未傳入 options.pluginVersion 時，會自行解析外掛版本號。
 * @param {object} meta
 * @param {string} lang
 * @param {string} fallbackModel
 * @param {object|null} cache
 * @param {object} cachedAccount
 * @param {object} quotaInfo
 * @param {object} contextInfo
 * @param {object} [weeklyInfo]
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
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

  // Argon Quota
  const resolvedArgon = options?.argonInfo || resolveArgonQuota(cache);
  const argonPct = resolvedArgon.remaining_percentage ?? 100;
  const argonQuotaColor = getColorByPercentage(argonPct);
  const argonQuotaVal = `${Math.round(argonPct)}%`;
  const argonCountdownVal = resolvedArgon.refreshes_in || noneStr;
  const formattedArgonReset = resolvedArgon.reset_time ? formatAbsoluteResetTime(resolvedArgon.reset_time, timeFormat) : '';
  const argonResetTimeVal = formattedArgonReset || noneStr;
  const argonQuotaBarVal = renderBarGraph(argonPct, barLength, argonQuotaColor);

  // Context
  const remainCtx = Math.max(0, 100 - contextInfo.usedPctNum);
  const contextColor = getColorByPercentage(remainCtx);
  const usedPct = `${contextInfo.usedPctNum.toFixed(1)}%`;
  const contextBarVal = renderBarGraph(contextInfo.usedPctNum, barLength, contextColor);

  const effectiveTokenMax = (contextInfo.effectiveTokenCeiling && contextInfo.effectiveTokenCeiling > 0)
    ? contextInfo.effectiveTokenCeiling
    : (contextInfo.contextSize && contextInfo.contextSize > 0
        ? Math.min(contextInfo.contextSize, DEFAULT_COMPACTION_THRESHOLD)
        : DEFAULT_COMPACTION_THRESHOLD);
  const rawTokenPct = effectiveTokenMax > 0 ? (contextInfo.totalInput / effectiveTokenMax) * 100 : contextInfo.usedPctNum;
  const tokenPct = Math.min(100, Math.max(0, rawTokenPct));
  const remainTokenPct = Math.max(0, 100 - tokenPct);
  const tokenColor = getColorByPercentage(remainTokenPct); // 獨立顏色計算！
  const tokenCount = `${tokenColor}${formatTokens(contextInfo.totalInput)}${RESET} / ${formatTokens(effectiveTokenMax)}`;
  const tokenBarVal = renderBarGraph(tokenPct, barLength, tokenColor);

  const projectPath = resolveProjectPath(meta);
  const projectName = basename(projectPath);
  const projectFullPath = projectPath;

  // Account
  const planTier = (cache && cache.planTier) ? cache.planTier : (meta?.plan_tier || meta?.account?.plan_tier || cachedAccount.planTier || unknownStr);
  const accountEmail = (cache && cache.email) ? cache.email : (meta?.email || meta?.account?.email || cachedAccount.email || unknownStr);

  // Agent State
  const agentState = meta?.agent_state || 'idle';
  const toolConfirmPending = !!meta?.tool_confirmation_pending;

  const countersCachePath = join(os.homedir(), '.gemini', 'tmp', 'statusline_counters.json');
  const rawFooterItems = options?.footerItems;
  const enabledFooterItems = rawFooterItems === undefined || rawFooterItems === null
    ? null
    : (rawFooterItems instanceof Set
        ? rawFooterItems
        : new Set(Array.isArray(rawFooterItems) ? rawFooterItems : []));
  const hasFooterItem = (item) => enabledFooterItems === null || enabledFooterItems.has(item);
  const execFn = typeof options?.execFn === 'function' ? options.execFn : runCmdDetailedAsync;

  // 僅計算活躍子代理，於複製物件上過濾以保持呼叫端 meta 不變
  const subagentsMeta = (hasFooterItem('subagents') && Array.isArray(meta?.subagents))
    ? {
        ...meta,
        subagents: meta.subagents.filter(s => {
          if (s !== null && typeof s === 'object' && s.status) {
            return s.status !== 'completed' && s.status !== 'stopped' && s.status !== 'error';
          }
          return s !== null && s !== undefined;
        })
      }
    : meta;

  // 併行執行非同步探測（含逾時保護避免系統休眠喚醒時被 CLI SIGKILL）
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
    !hasFooterItem('git-branch')
      ? Promise.resolve(noVcFallback)
      : ((typeof meta?.vcs?.branch === 'string' && meta.vcs.branch)
          ? Promise.resolve(meta.vcs.branch)
          : withTimeout(getGitBranch(normLang, projectPath, execFn), 600, noVcFallback)),

    // 2. Git Dirty
    !hasFooterItem('vcs-dirty')
      ? Promise.resolve(false)
      : ((typeof meta?.vcs?.dirty === 'boolean')
          ? Promise.resolve(meta.vcs.dirty)
          : withTimeout(getGitDirty(projectPath, execFn), 600, false)),

    // 3. 記憶體用量
    !hasFooterItem('memory-usage')
      ? Promise.resolve(0)
      : withTimeout(getCliMemoryMB(execFn), 600, Math.round(process.memoryUsage().rss / 1024 / 1024)),

    // 4. 待處理輸入
    !hasFooterItem('pending-input')
      ? Promise.resolve(0)
      : getMetricValueAsync(
          meta,
          ['pending_input_count', 'pending_input', 'pending_inputs'],
          countersCachePath,
          async () => {
            const pendingInputFilePath = join(os.homedir(), '.gemini', 'tmp', 'pending_input_count');
            try {
              const fileContent = (await fs.readFile(pendingInputFilePath, 'utf8')).trim();
              const parsed = Number(fileContent);
              return isNaN(parsed) ? 0 : parsed;
            } catch (_) {
              if (process.env.PENDING_INPUT_COUNT !== undefined) {
                const parsed = Number(process.env.PENDING_INPUT_COUNT);
                return isNaN(parsed) ? 0 : parsed;
              }
              return 0;
            }
          }
        ),

    // 5. 背景任務數
    !hasFooterItem('background-tasks')
      ? Promise.resolve(0)
      : getMetricValueAsync(
          meta,
          ['background_tasks', 'background_tasks_count', 'task_count', 'background_jobs'],
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
                  } catch (_) {
                    return false;
                  }
                })
              );
              return stats.filter(Boolean).length;
            } catch (_) {
              return 0;
            }
          }
        ),

    // 6. 活躍子代理數
    !hasFooterItem('subagents')
      ? Promise.resolve(0)
      : getMetricValueAsync(
          subagentsMeta,
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
                  } catch (_) {}
                  return 0;
                })
              );
              return results.reduce((sum, val) => sum + val, 0);
            } catch (_) {
              return 0;
            }
          }
        ),

    // 7. 產出檔案數
    !hasFooterItem('artifacts')
      ? Promise.resolve(0)
      : getMetricValueAsync(
          meta,
          ['artifacts', 'artifacts_count', 'artifact_count'],
          countersCachePath,
          async () => {
            const rawConvId = sanitizeConversationId(meta?.conversation_id);
            if (rawConvId) {
              const brainDir = join(os.homedir(), '.gemini', 'antigravity-cli', 'brain', rawConvId);
              try {
                const files = await fs.readdir(brainDir);
                const metadataFiles = files.filter(f => f.endsWith('.metadata.json'));
                return metadataFiles.length;
              } catch (_) {
                return 0;
              }
            }
            return 0;
          }
        )
  ]);

  const memUsage = `${rssMem}MB`;
  const vcsDirtyGlyph = '';
  const vcsDirtyLabel = vcsDirtyFlag
    ? (normLang === 'zh-tw' ? '未提交' : (normLang === 'zh-cn' ? '未提交' : (normLang === 'jp' ? '未コミット' : 'uncommitted')))
    : (normLang === 'zh-tw' ? '無變更' : (normLang === 'zh-cn' ? '无变更' : (normLang === 'jp' ? '変更なし' : 'no changes')));
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

  let agentProfileName = 'Default';
  if (typeof meta?.agent === 'string') agentProfileName = meta.agent;
  else if (meta?.agent?.display_name) agentProfileName = meta.agent.display_name;
  else if (meta?.agent?.name) agentProfileName = meta.agent.name;
  else if (meta?.agent?.id) agentProfileName = meta.agent.id;
  else if (meta?.agent?.profile) agentProfileName = meta.agent.profile;

  const rawCliVersion = typeof meta?.version === 'string' ? meta.version.trim().replace(/^v/i, '') : (meta?.version ? String(meta.version) : '');
  const cliVersion = rawCliVersion ? `v${rawCliVersion}` : unknownStr;
  let pluginVersion = options?.pluginVersion || '';
  if (!pluginVersion && hasFooterItem('plugin-version') && options?.skipPluginVersionResolve !== true) {
    const resolvedPlugin = await resolveInstalledPluginVersionAsync(options);
    pluginVersion = resolvedPlugin.tag || unknownStr;
  }
  if (!pluginVersion) {
    pluginVersion = unknownStr;
  }
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
    sandboxAllowNet, sandboxStatusVal, cliVersion, pluginVersion, conversationIdShort, agentProfileName,
    weeklyQuotaColor, weeklyQuotaVal, weeklyCountdownVal, mode,
    quotaResetTimeVal, weeklyResetTimeVal, quotaBarVal, weeklyQuotaBarVal, contextBarVal, tokenBarVal,
    argonQuotaColor, argonQuotaVal, argonCountdownVal, argonResetTimeVal, argonQuotaBarVal,
    tokenColor,
    quotaPct, weeklyPct, argonPct, usedPctNum: contextInfo.usedPctNum,
    totalInput: contextInfo.totalInput, effectiveTokenMax, rssMem
  };
}
