import { PLUGIN_REPO_URL } from '../core/constants.mjs';
import { normalizeLabelStyle, normalizeLanguage } from '../core/normalize.mjs';
import { formatVersionTag } from '../core/semver.mjs';
import {
  BLUE,
  BOLD,
  GRAY,
  RED,
  RESET,
  WHITE,
  YELLOW,
  getActiveModelRoleColor,
  getAgentStateColor,
  getColorByCount,
  getModeColor,
  getModelColor,
  getSandboxColor,
  getToolConfirmColor,
  getVcsDirtyColor
} from '../renderers/ansi.mjs';
import { ADJACENT_PAIRS, EMOJI_MAP } from './registry.mjs';

/**
 * 將代理執行狀態代碼本地化為對應語系文字。
 * @param {string} state
 * @param {string} normLang
 * @returns {string}
 */
export function formatAgentState(state, normLang) {
  if (!state || typeof state !== 'string') return state;
  const key = state.trim().toLowerCase();
  const map = {
    'idle': { 'zh-tw': '閒置', 'zh-cn': '闲置', 'jp': '待機', 'us': 'idle' },
    'thinking': { 'zh-tw': '思考中', 'zh-cn': '思考中', 'jp': '思考中', 'us': 'thinking' },
    'working': { 'zh-tw': '執行中', 'zh-cn': '执行中', 'jp': '実行中', 'us': 'working' },
    'tool_use': { 'zh-tw': '呼叫工具', 'zh-cn': '调用工具', 'jp': 'ツール実行', 'us': 'tool_use' },
    'initializing': { 'zh-tw': '初始化', 'zh-cn': '初始化', 'jp': '初期化中', 'us': 'initializing' }
  };
  if (map[key] && map[key][normLang]) return map[key][normLang];
  return state;
}

/**
 * 格式化 Orchestrator 實際執行模型與規劃／工作角色徽章（非 Orchestrator 模式一律以紅色顯示關閉）。
 * @param {object} m
 * @param {string} normLang
 * @returns {string}
 */
export function formatActiveModelDisplay(m, normLang) {
  const modelName = typeof m?.activeModelName === 'string' ? m.activeModelName.trim() : '';
  const isOrchestrator = Boolean(m?.isOrchestrator) || Boolean(modelName);
  const role = typeof m?.activeModelRole === 'string' ? m.activeModelRole.trim().toLowerCase() : '';
  const labels = {
    'zh-tw': { prefix: '協調器:', planner: '[規劃]', executor: '[工作]', pending: '待命', off: '關閉' },
    'zh-cn': { prefix: '协调器:', planner: '[规划]', executor: '[工作]', pending: '待命', off: '关闭' },
    'us': { prefix: 'Orchestrator:', planner: '[Plan]', executor: '[Work]', pending: 'Pending', off: 'off' },
    'jp': { prefix: 'Orchestrator:', planner: '[計画]', executor: '[作業]', pending: '待機中', off: 'オフ' }
  };
  const t = labels[normLang] || labels['zh-tw'];

  if (!isOrchestrator) {
    return `${WHITE}${t.prefix}${RESET} ${RED}${BOLD}${t.off}${RESET}`;
  }

  if (!modelName) {
    return `${WHITE}${t.prefix}${RESET} ${GRAY}${BOLD}${t.pending}${RESET}`;
  }

  const modelColor = getModelColor(modelName);
  const modelPart = `${modelColor}${BOLD}${modelName}${RESET}`;
  if (role === 'planner' || role === 'executor') {
    const roleTag = t[role];
    const roleColor = getActiveModelRoleColor(role);
    return `${WHITE}${t.prefix}${RESET} ${roleColor}${BOLD}${roleTag}${RESET} ${modelPart}`;
  }

  return `${WHITE}${t.prefix}${RESET} ${modelPart}`;
}

/**
 * 依語系、全球標籤樣式及個別指標樣式覆寫產生所有狀態列指標的著色文案字典。
 * @param {string} lang
 * @param {object} m
 * @param {string|object} [labelStyle='text']
 * @param {object} [itemStyles=undefined]
 * @returns {Record<string, string>}
 */
export function buildI18nDict(lang, m, labelStyle = 'text', itemStyles = undefined) {
  if (typeof labelStyle === 'object' && labelStyle !== null && !Array.isArray(labelStyle)) {
    itemStyles = labelStyle;
    labelStyle = 'text';
  }
  const normGlobalStyle = normalizeLabelStyle(labelStyle);
  const normLang = normalizeLanguage(lang);
  const unknownStr = (normLang === 'zh-tw' || normLang === 'zh-cn') ? '未知' : (normLang === 'jp' ? '不明' : 'Unknown');
  const cliVersionVal = m.cliVersion || unknownStr;
  const appVersionVal = m.appVersion || unknownStr;
  const pluginVersionVal = m.pluginVersion || unknownStr;
  const pluginUpdateCurrentTag = m.pluginUpdateCurrentTag || m.pluginVersion || '';
  const pluginUpdateLatestTag = m.pluginUpdateLatestTag || m.pluginLatestVersion || '';
  const hasPluginUpdate = Boolean(m.pluginUpdateAvailable && pluginUpdateLatestTag);
  const pluginUpdateLines = hasPluginUpdate
    ? formatPluginUpdateNoticeLines(normLang, pluginUpdateCurrentTag, pluginUpdateLatestTag)
    : [];
  const pluginUpdateText = pluginUpdateLines.join('\n');
  const localizedAgentState = formatAgentState(m.agentState, normLang);
  const argonColor = m.argonQuotaColor ?? BLUE;
  const argonVal = m.argonQuotaVal ?? '100%';
  const argonCountdown = m.argonCountdownVal ?? (normLang === 'zh-tw' ? '無' : (normLang === 'zh-cn' ? '无' : (normLang === 'jp' ? 'なし' : 'N/A')));
  const argonResetTime = m.argonResetTimeVal ?? (normLang === 'zh-tw' ? '無' : (normLang === 'zh-cn' ? '无' : (normLang === 'jp' ? 'なし' : 'N/A')));
  const argonBar = m.argonQuotaBarVal ?? '[██████████]';
  const activeModelText = formatActiveModelDisplay(m, normLang);
  const dicts = {
    'zh-tw': {
      'model-name': `${WHITE}模型:${RESET} ${getModelColor(m.fallbackModel)}${BOLD}${m.fallbackModel}${RESET}`,
      'active-model': activeModelText,
      'quota': `${WHITE}五小時可用:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}脈絡用量:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}記憶體:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}權杖數:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}五小時倒數:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'quota-reset-time': `${WHITE}五小時重置:${RESET} ${BLUE}${BOLD}${m.quotaResetTimeVal}${RESET}`,
      'quota-bar': `${WHITE}五小時可用:${RESET} ${m.quotaBarVal}`,
      'quota-weekly': `${WHITE}七日內可用:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET}`,
      'quota-weekly-countdown': `${WHITE}七日內倒數:${RESET} ${BLUE}${BOLD}${m.weeklyCountdownVal}${RESET}`,
      'quota-weekly-reset-time': `${WHITE}七日內重置:${RESET} ${BLUE}${BOLD}${m.weeklyResetTimeVal}${RESET}`,
      'quota-weekly-bar': `${WHITE}七日內可用:${RESET} ${m.weeklyQuotaBarVal}`,
      'quota-argon': `${WHITE}Argon 可用:${RESET} ${argonColor}${BOLD}${argonVal}${RESET}`,
      'quota-argon-countdown': `${WHITE}Argon 倒數:${RESET} ${BLUE}${BOLD}${argonCountdown}${RESET}`,
      'quota-argon-reset-time': `${WHITE}Argon 重置:${RESET} ${BLUE}${BOLD}${argonResetTime}${RESET}`,
      'quota-argon-bar': `${WHITE}Argon 可用:${RESET} ${argonBar}`,
      'quota-argon+bar': `${WHITE}Argon 可用:${RESET} ${argonColor}${BOLD}${argonVal}${RESET} ${argonBar}`,
      'context-used-bar': `${WHITE}脈絡用量:${RESET} ${m.contextBarVal}`,
      'token-count-bar': `${WHITE}權杖數:${RESET} ${m.tokenBarVal}`,
      'quota+bar': `${WHITE}五小時可用:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET} ${m.quotaBarVal}`,
      'context-used+bar': `${WHITE}脈絡用量:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET} ${m.contextBarVal}`,
      'quota-weekly+bar': `${WHITE}七日內可用:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET} ${m.weeklyQuotaBarVal}`,
      'token-count+bar': `${WHITE}權杖數:${RESET} ${m.tokenCount} ${m.tokenBarVal}`,
      'git-branch': `${WHITE}分支: ${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}專案: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `${WHITE}完整路徑: ${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}訂閱方案: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}帳號: ${BOLD}${m.accountEmail}${RESET}`,
      'agent-state': `${WHITE}代理狀態:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${localizedAgentState}${RESET}`,
      'tool-confirmation': `${WHITE}工具待確認:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? '待確認' : '無'}${RESET}`,
      'pending-input': `${WHITE}待處理輸入:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}背景任務:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}子代理:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}產出檔案: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}版控狀態:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}版控類型: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}沙盒狀態:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `${WHITE}Agy CLI 版本: ${BOLD}${cliVersionVal}${RESET}`,
      'app-version': `${WHITE}Agy 2.0 版本: ${BOLD}${appVersionVal}${RESET}`,
      'plugin-version': `${WHITE}狀態列版本: ${BOLD}${pluginVersionVal}${RESET}`,
      'plugin-update': pluginUpdateText,
      'conversation-id': `${WHITE}對話編號: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `${WHITE}代理角色:${RESET} ${BLUE}${BOLD}${m.agentProfileName}${RESET}`,
      'mode': `${WHITE}模式:${RESET} ${getModeColor(m.mode)}${BOLD}${m.mode}${RESET}`
    },
    'zh-cn': {
      'model-name': `${WHITE}模型:${RESET} ${getModelColor(m.fallbackModel)}${BOLD}${m.fallbackModel}${RESET}`,
      'active-model': activeModelText,
      'quota': `${WHITE}五小时可用:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}上下文用量:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}内存:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}令牌数:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}五小时倒数:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'quota-reset-time': `${WHITE}五小时重置:${RESET} ${BLUE}${BOLD}${m.quotaResetTimeVal}${RESET}`,
      'quota-bar': `${WHITE}五小时可用:${RESET} ${m.quotaBarVal}`,
      'quota-weekly': `${WHITE}七日内可用:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET}`,
      'quota-weekly-countdown': `${WHITE}七日内倒数:${RESET} ${BLUE}${BOLD}${m.weeklyCountdownVal}${RESET}`,
      'quota-weekly-reset-time': `${WHITE}七日内重置:${RESET} ${BLUE}${BOLD}${m.weeklyResetTimeVal}${RESET}`,
      'quota-weekly-bar': `${WHITE}七日内可用:${RESET} ${m.weeklyQuotaBarVal}`,
      'quota-argon': `${WHITE}Argon 可用:${RESET} ${argonColor}${BOLD}${argonVal}${RESET}`,
      'quota-argon-countdown': `${WHITE}Argon 倒数:${RESET} ${BLUE}${BOLD}${argonCountdown}${RESET}`,
      'quota-argon-reset-time': `${WHITE}Argon 重置:${RESET} ${BLUE}${BOLD}${argonResetTime}${RESET}`,
      'quota-argon-bar': `${WHITE}Argon 可用:${RESET} ${argonBar}`,
      'quota-argon+bar': `${WHITE}Argon 可用:${RESET} ${argonColor}${BOLD}${argonVal}${RESET} ${argonBar}`,
      'context-used-bar': `${WHITE}上下文用量:${RESET} ${m.contextBarVal}`,
      'token-count-bar': `${WHITE}令牌数:${RESET} ${m.tokenBarVal}`,
      'quota+bar': `${WHITE}五小时可用:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET} ${m.quotaBarVal}`,
      'context-used+bar': `${WHITE}上下文用量:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET} ${m.contextBarVal}`,
      'quota-weekly+bar': `${WHITE}七日内可用:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET} ${m.weeklyQuotaBarVal}`,
      'token-count+bar': `${WHITE}令牌数:${RESET} ${m.tokenCount} ${m.tokenBarVal}`,
      'git-branch': `${WHITE}分支: ${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}项目: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `${WHITE}完整路径: ${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}订阅计划: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}账号: ${BOLD}${m.accountEmail}${RESET}`,
      'agent-state': `${WHITE}代理状态:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${localizedAgentState}${RESET}`,
      'tool-confirmation': `${WHITE}工具待确认:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? '待确认' : '无'}${RESET}`,
      'pending-input': `${WHITE}待处理输入:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}后台任务:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}子代理:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}产出文件: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}版控状态:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}版控类型: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}沙箱状态:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `${WHITE}Agy CLI 版本: ${BOLD}${cliVersionVal}${RESET}`,
      'app-version': `${WHITE}Agy 2.0 版本: ${BOLD}${appVersionVal}${RESET}`,
      'plugin-version': `${WHITE}状态栏版本: ${BOLD}${pluginVersionVal}${RESET}`,
      'plugin-update': pluginUpdateText,
      'conversation-id': `${WHITE}对话编号: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `${WHITE}代理角色:${RESET} ${BLUE}${BOLD}${m.agentProfileName}${RESET}`,
      'mode': `${WHITE}模式:${RESET} ${getModeColor(m.mode)}${BOLD}${m.mode}${RESET}`
    },
    'us': {
      'model-name': `${WHITE}Model:${RESET} ${getModelColor(m.fallbackModel)}${BOLD}${m.fallbackModel}${RESET}`,
      'active-model': activeModelText,
      'quota': `${WHITE}5-hr Available:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}Context Used:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}RAM:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}Tokens:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}5-hr Reset:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'quota-reset-time': `${WHITE}5-hr Reset Time:${RESET} ${BLUE}${BOLD}${m.quotaResetTimeVal}${RESET}`,
      'quota-bar': `${WHITE}5-hr Available:${RESET} ${m.quotaBarVal}`,
      'quota-weekly': `${WHITE}7-day Available:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET}`,
      'quota-weekly-countdown': `${WHITE}7-day Reset:${RESET} ${BLUE}${BOLD}${m.weeklyCountdownVal}${RESET}`,
      'quota-weekly-reset-time': `${WHITE}7-day Reset Time:${RESET} ${BLUE}${BOLD}${m.weeklyResetTimeVal}${RESET}`,
      'quota-weekly-bar': `${WHITE}7-day Available:${RESET} ${m.weeklyQuotaBarVal}`,
      'quota-argon': `${WHITE}Argon Available:${RESET} ${argonColor}${BOLD}${argonVal}${RESET}`,
      'quota-argon-countdown': `${WHITE}Argon Reset:${RESET} ${BLUE}${BOLD}${argonCountdown}${RESET}`,
      'quota-argon-reset-time': `${WHITE}Argon Reset Time:${RESET} ${BLUE}${BOLD}${argonResetTime}${RESET}`,
      'quota-argon-bar': `${WHITE}Argon Available:${RESET} ${argonBar}`,
      'quota-argon+bar': `${WHITE}Argon Available:${RESET} ${argonColor}${BOLD}${argonVal}${RESET} ${argonBar}`,
      'context-used-bar': `${WHITE}Context Used:${RESET} ${m.contextBarVal}`,
      'token-count-bar': `${WHITE}Tokens:${RESET} ${m.tokenBarVal}`,
      'quota+bar': `${WHITE}5-hr Available:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET} ${m.quotaBarVal}`,
      'context-used+bar': `${WHITE}Context Used:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET} ${m.contextBarVal}`,
      'quota-weekly+bar': `${WHITE}7-day Available:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET} ${m.weeklyQuotaBarVal}`,
      'token-count+bar': `${WHITE}Tokens:${RESET} ${m.tokenCount} ${m.tokenBarVal}`,
      'git-branch': `${WHITE}Branch: ${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}Project: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `${WHITE}Project Path: ${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}Plan: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}Account: ${BOLD}${m.accountEmail}${RESET}`,
      'agent-state': `${WHITE}Agent:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${localizedAgentState}${RESET}`,
      'tool-confirmation': `${WHITE}Awaiting You:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? 'pending' : 'none'}${RESET}`,
      'pending-input': `${WHITE}Queue:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}BG:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}Subagents:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}Outputs: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}VCS Status:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}VCS: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}Sandbox:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `${WHITE}Agy CLI Version: ${BOLD}${cliVersionVal}${RESET}`,
      'app-version': `${WHITE}Agy 2.0 Version: ${BOLD}${appVersionVal}${RESET}`,
      'plugin-version': `${WHITE}Statusline Version: ${BOLD}${pluginVersionVal}${RESET}`,
      'plugin-update': pluginUpdateText,
      'conversation-id': `${WHITE}Conv: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `${WHITE}Profile:${RESET} ${BLUE}${BOLD}${m.agentProfileName}${RESET}`,
      'mode': `${WHITE}Mode:${RESET} ${getModeColor(m.mode)}${BOLD}${m.mode}${RESET}`
    },
    'jp': {
      'model-name': `${WHITE}モデル:${RESET} ${getModelColor(m.fallbackModel)}${BOLD}${m.fallbackModel}${RESET}`,
      'active-model': activeModelText,
      'quota': `${WHITE}五時間残量:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET}`,
      'context-used': `${WHITE}コンテキスト使用:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET}`,
      'memory-usage': `${WHITE}メモリ:${RESET} ${BLUE}${BOLD}${m.memUsage}${RESET}`,
      'token-count': `${WHITE}トークン:${RESET} ${m.tokenCount}`,
      'quota-reset-countdown': `${WHITE}五時間リセット:${RESET} ${BLUE}${BOLD}${m.countdownVal}${RESET}`,
      'quota-reset-time': `${WHITE}五時間リセット時刻:${RESET} ${BLUE}${BOLD}${m.quotaResetTimeVal}${RESET}`,
      'quota-bar': `${WHITE}五時間残量:${RESET} ${m.quotaBarVal}`,
      'quota-weekly': `${WHITE}七日間残量:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET}`,
      'quota-weekly-countdown': `${WHITE}七日間リセット:${RESET} ${BLUE}${BOLD}${m.weeklyCountdownVal}${RESET}`,
      'quota-weekly-reset-time': `${WHITE}七日間リセット時刻:${RESET} ${BLUE}${BOLD}${m.weeklyResetTimeVal}${RESET}`,
      'quota-weekly-bar': `${WHITE}七日間残量:${RESET} ${m.weeklyQuotaBarVal}`,
      'quota-argon': `${WHITE}Argon 残量:${RESET} ${argonColor}${BOLD}${argonVal}${RESET}`,
      'quota-argon-countdown': `${WHITE}Argon リセット:${RESET} ${BLUE}${BOLD}${argonCountdown}${RESET}`,
      'quota-argon-reset-time': `${WHITE}Argon リセット時刻:${RESET} ${BLUE}${BOLD}${argonResetTime}${RESET}`,
      'quota-argon-bar': `${WHITE}Argon 残量:${RESET} ${argonBar}`,
      'quota-argon+bar': `${WHITE}Argon 残量:${RESET} ${argonColor}${BOLD}${argonVal}${RESET} ${argonBar}`,
      'context-used-bar': `${WHITE}コンテキスト使用:${RESET} ${m.contextBarVal}`,
      'token-count-bar': `${WHITE}トークン:${RESET} ${m.tokenBarVal}`,
      'quota+bar': `${WHITE}五時間残量:${RESET} ${m.quotaColor}${BOLD}${m.quotaVal}${RESET} ${m.quotaBarVal}`,
      'context-used+bar': `${WHITE}コンテキスト使用:${RESET} ${m.contextColor}${BOLD}${m.usedPct}${RESET} ${m.contextBarVal}`,
      'quota-weekly+bar': `${WHITE}七日間残量:${RESET} ${m.weeklyQuotaColor}${BOLD}${m.weeklyQuotaVal}${RESET} ${m.weeklyQuotaBarVal}`,
      'token-count+bar': `${WHITE}トークン:${RESET} ${m.tokenCount} ${m.tokenBarVal}`,
      'git-branch': `${WHITE}ブランチ: ${BOLD}${m.gitBranch}${RESET}`,
      'project-path': `${WHITE}プロジェクト: ${BOLD}${m.projectName}${RESET}`,
      'project-full-path': `${WHITE}パス: ${BOLD}${m.projectFullPath}${RESET}`,
      'plan-tier': `${WHITE}プラン: ${BOLD}${m.planTier}${RESET}`,
      'account-email': `${WHITE}アカウント: ${BOLD}${m.accountEmail}${RESET}`,
      'agent-state': `${WHITE}状態:${RESET} ${getAgentStateColor(m.agentState)}${BOLD}${localizedAgentState}${RESET}`,
      'tool-confirmation': `${WHITE}ご承認待ち:${RESET} ${getToolConfirmColor(m.toolConfirmPending)}${BOLD}${m.toolConfirmPending ? '承認待ち' : 'なし'}${RESET}`,
      'pending-input': `${WHITE}入力キュー:${RESET} ${getColorByCount(m.pendingInputCount)}${BOLD}${m.pendingInputCount}${RESET}`,
      'background-tasks': `${WHITE}BGタスク:${RESET} ${getColorByCount(m.backgroundTasksCount)}${BOLD}${m.backgroundTasksCount}${RESET}`,
      'subagents': `${WHITE}サブ代理:${RESET} ${getColorByCount(m.subagentsCount)}${BOLD}${m.subagentsCount}${RESET}`,
      'artifacts': `${WHITE}成果物: ${BOLD}${m.artifactsCount}${RESET}`,
      'vcs-dirty': `${WHITE}版管理状態:${RESET} ${getVcsDirtyColor(m.vcsDirtyFlag)}${BOLD}${m.vcsDirtyLabel}${RESET}`,
      'vcs-type': `${WHITE}版管理種別: ${BOLD}${m.vcsType}${RESET}`,
      'sandbox-status': `${WHITE}サンドボックス:${RESET} ${getSandboxColor(m.sandboxEnabled, m.sandboxAllowNet)}${BOLD}${m.sandboxStatusVal}${RESET}`,
      'cli-version': `${WHITE}Agy CLI バージョン: ${BOLD}${cliVersionVal}${RESET}`,
      'app-version': `${WHITE}Agy 2.0 バージョン: ${BOLD}${appVersionVal}${RESET}`,
      'plugin-version': `${WHITE}ステータスライン版: ${BOLD}${pluginVersionVal}${RESET}`,
      'plugin-update': pluginUpdateText,
      'conversation-id': `${WHITE}会話番号: ${BOLD}${m.conversationIdShort}${RESET}`,
      'agent-profile': `${WHITE}プロファイル:${RESET} ${BLUE}${BOLD}${m.agentProfileName}${RESET}`,
      'mode': `${WHITE}モード:${RESET} ${getModeColor(m.mode)}${BOLD}${m.mode}${RESET}`
    }
  };
  const baseDict = dicts[normLang] || dicts['zh-tw'];

  const emojiDict = {};
  for (const [key, val] of Object.entries(baseDict)) {
    if (key === 'plugin-update') {
      if (pluginUpdateLines.length >= 2) {
        const cur = formatVersionTag(pluginUpdateCurrentTag) || String(pluginUpdateCurrentTag || '');
        const lat = formatVersionTag(pluginUpdateLatestTag) || String(pluginUpdateLatestTag || '');
        emojiDict[key] = [
          `${YELLOW}${BOLD}${EMOJI_MAP['plugin-update']} ${cur} → ${lat}${RESET}`,
          pluginUpdateLines[1]
        ].join('\n');
      } else {
        emojiDict[key] = '';
      }
      continue;
    }
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

/**
 * 產生狀態列底部兩行外掛更新提示訊息（依 4 語系格式化並套用 ANSI 色彩）。
 * @param {string} lang
 * @param {string} currentTag
 * @param {string} latestTag
 * @returns {string[]}
 */
export function formatPluginUpdateNoticeLines(lang, currentTag, latestTag) {
  const normLang = normalizeLanguage(lang);
  const cur = formatVersionTag(currentTag) || String(currentTag || '');
  const lat = formatVersionTag(latestTag) || String(latestTag || '');
  let msg;
  if (normLang === 'zh-cn') {
    msg = `⚠️ 状态栏有新版本可用（当前 ${cur} → 最新 ${lat}），请执行以下命令更新：`;
  } else if (normLang === 'us') {
    msg = `⚠️ Statusline update available (current ${cur} → latest ${lat}). Run to update:`;
  } else if (normLang === 'jp') {
    msg = `⚠️ ステータスラインの新バージョンが利用可能です（現在 ${cur} → 最新 ${lat}）。以下のコマンドで更新してください：`;
  } else {
    msg = `⚠️ 狀態列有新版本可用（目前 ${cur} → 最新 ${lat}），請執行以下指令更新：`;
  }
  return [
    `${YELLOW}${BOLD}${msg}${RESET}`,
    `${BLUE}${BOLD}agy plugin install ${PLUGIN_REPO_URL}${RESET}`
  ];
}
