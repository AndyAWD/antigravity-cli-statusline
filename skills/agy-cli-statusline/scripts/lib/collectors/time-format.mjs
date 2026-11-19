/**
 * 時間區間倒數與絕對重置時刻格式化工具。
 */

/**
 * 將總秒數格式化為簡潔倒數字串（例如 'now'、'15m'、'2h 30m'、'3d 4h'）。
 * @param {number} totalSec
 * @returns {string}
 */
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

/**
 * 將 ISO 重置時間字串轉換為相對於現在的倒數字串；無效輸入回傳空字串。
 * @param {string} resetTimeStr
 * @param {number} [now=Date.now()]
 * @returns {string}
 */
export function formatResetTime(resetTimeStr, now = Date.now()) {
  try {
    if (!resetTimeStr || typeof resetTimeStr === 'boolean' || Array.isArray(resetTimeStr)) return '';
    const reset = new Date(resetTimeStr);
    const resetMs = reset.getTime();
    if (isNaN(resetMs)) return '';
    const nowMs = (typeof now === 'number' && !isNaN(now)) ? now : Date.now();
    const diffSeconds = Math.floor((resetMs - nowMs) / 1000);
    return formatSecondsToCountdown(diffSeconds);
  } catch (_) {
    return '';
  }
}

/**
 * 將重置時間格式化為絕對時刻字串（支援 'smart' / '24h' / '12h' / 'yyyy/mm/dd hh:mm' / 'full'）。
 * @param {string} resetTimeStr
 * @param {string} [formatMode='smart']
 * @param {Date|string|number} [now=new Date()]
 * @returns {string}
 */
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

  // 'smart'、'auto' 或預設模式：同日僅顯示 HH:mm，跨日則附完整日期
  const nowDate = (now instanceof Date && !isNaN(now.getTime()))
    ? now
    : (now ? new Date(now) : new Date());
  const validNow = isNaN(nowDate.getTime()) ? new Date() : nowDate;
  const isSameDay = reset.getFullYear() === validNow.getFullYear() &&
                    reset.getMonth() === validNow.getMonth() &&
                    reset.getDate() === validNow.getDate();
  return isSameDay ? time24 : fullDateTime;
}
