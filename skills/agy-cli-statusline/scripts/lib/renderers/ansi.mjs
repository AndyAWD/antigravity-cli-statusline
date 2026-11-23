/**
 * ANSI 24-bit 終端色彩常數、指標分級配色邏輯與長條圖繪製輔助函式。
 */

export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const GRAY = '\x1b[90m';
export const WHITE = '\x1b[38;2;255;255;255m';
export const BLUE = '\x1b[38;2;87;202;255m';
export const GREEN = '\x1b[38;2;92;219;109m';
export const YELLOW = '\x1b[38;2;255;212;39m';
export const RED = '\x1b[38;2;255;125;175m';

export const ANSI_HEX_PALETTE = Object.freeze({
  white: '#ffffff',
  blue: '#57caff',
  green: '#5cdb6d',
  yellow: '#ffd427',
  red: '#ff7daf',
  gray: '#6e7b8f'
});

/**
 * 依剩餘百分比取得四階等級名稱（'blue' | 'green' | 'yellow' | 'red'），供 CLI 與 2.0 UI 共用。
 * @param {number} pct
 * @returns {'blue'|'green'|'yellow'|'red'}
 */
export function getPercentageTier(pct) {
  if (pct >= 75) return 'blue';
  if (pct >= 50) return 'green';
  if (pct >= 25) return 'yellow';
  return 'red';
}

const TIER_TO_ANSI = {
  blue: BLUE,
  green: GREEN,
  yellow: YELLOW,
  red: RED
};

/**
 * 依剩餘百分比取得四階 ANSI 顏色（>=75 藍、>=50 綠、>=25 黃、<25 紅）。
 * @param {number} pct
 * @returns {string}
 */
export function getColorByPercentage(pct) {
  return TIER_TO_ANSI[getPercentageTier(pct)];
}

/**
 * 依計數值取得四階 ANSI 顏色（0 藍、1-2 綠、3-4 黃、>=5 紅）。
 * @param {number} n
 * @returns {string}
 */
export function getColorByCount(n) {
  if (n === 0) return BLUE;
  if (n <= 2) return GREEN;
  if (n <= 4) return YELLOW;
  return RED;
}

/**
 * 依模型家族名稱取得專屬品牌配色。
 * @param {string} name
 * @returns {string}
 */
export function getModelColor(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('claude')) return '\x1b[38;2;221;80;19m';
  if (lower.includes('gemini')) return '\x1b[38;2;71;150;227m';
  if (lower.includes('gpt') || lower.includes('chatgpt')) return '\x1b[38;2;116;170;156m';
  return '';
}

/**
 * 依工作區版控是否有未提交變更取得顏色。
 * @param {boolean} dirty
 * @returns {string}
 */
export function getVcsDirtyColor(dirty) {
  return dirty ? RED : GREEN;
}

/**
 * 依是否有待回應的工具確認對話方塊取得顏色。
 * @param {boolean} pending
 * @returns {string}
 */
export function getToolConfirmColor(pending) {
  return pending ? YELLOW : GREEN;
}

/**
 * 依代理狀態取得對應顏色。
 * @param {string} state
 * @returns {string}
 */
export function getAgentStateColor(state) {
  const s = (state || '').toLowerCase();
  if (s.includes('error') || s.includes('fail')) return RED;
  if (s.includes('busy') || s.includes('run') || s.includes('think')) return YELLOW;
  if (s.includes('idle') || s.includes('ready')) return GREEN;
  return BLUE;
}

/**
 * 依沙盒啟用與聯網狀態取得對應顏色。
 * @param {boolean} enabled
 * @param {boolean} allowNet
 * @returns {string}
 */
export function getSandboxColor(enabled, allowNet) {
  if (!enabled) return RED;
  return allowNet ? YELLOW : GREEN;
}

/**
 * 依 CLI 運行模式取得對應顏色。
 * @param {string} mode
 * @returns {string}
 */
export function getModeColor(mode) {
  const m = (mode || '').toLowerCase();
  if (m === 'plan') return GREEN;
  if (m === 'accept-edits') return YELLOW;
  if (m === 'default') return BLUE;
  return BLUE;
}

/**
 * 依 Orchestrator 執行期模型角色取得徽章顏色。
 * @param {string} role
 * @returns {string}
 */
export function getActiveModelRoleColor(role) {
  const r = (role || '').toLowerCase();
  if (r === 'planner') return YELLOW;
  if (r === 'executor') return GREEN;
  if (r === 'pending') return GRAY;
  return BLUE;
}

/**
 * 移除字串中所有 ANSI 控制與著色序列。
 * @param {string} str
 * @returns {string}
 */
export function stripAnsi(str) {
  return String(str ?? '').replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

/**
 * 估算終端字元顯示寬度（區分 ASCII / Box Drawing 半形與東亞全形 / Emoji）。
 * @param {string} str
 * @returns {number}
 */
export function getDisplayWidth(str) {
  let width = 0;
  for (const ch of String(str ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f || cp === 0xfe0e || cp === 0x200d || (cp >= 0x0300 && cp <= 0x036f)) continue;
    if (cp <= 0x7f) {
      width += 1;
    } else if (
      (cp >= 0x0080 && cp <= 0x024f) ||
      (cp >= 0x2500 && cp <= 0x259f) ||
      cp === 0x2713 ||
      cp === 0x2714 ||
      cp === 0x2717 ||
      cp === 0x2718
    ) {
      width += 1;
    } else {
      width += 2;
    }
  }
  return width;
}

/**
 * 繪製容量進度長條圖（[████░░░░░░]），支援自動反轉用量配色與長度夾限 [1, 50]。
 * @param {number|string} pct
 * @param {number} [length=10]
 * @param {string} [color='']
 * @param {boolean} [inverted=false]
 * @returns {string}
 */
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
