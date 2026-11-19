/**
 * 標準化語系、標籤樣式、模型名稱、對話識別碼與計數數值之共用函式。
 */

/**
 * 將各式語系代碼、別名或問卷選項字串標準化為內部語系鍵值（zh-tw / zh-cn / us / jp）。
 * @param {string} lang
 * @returns {string}
 */
export function normalizeLanguage(lang) {
  if (!lang || typeof lang !== 'string') return 'zh-tw';
  let l = lang.toLowerCase().replace(/_/g, '-').trim();
  const parenMatch = l.match(/[\(（]([a-z0-9\-_]+)[\)）]/);
  if (parenMatch) {
    l = parenMatch[1].trim();
  }
  if (
    l === 'zh-cn' ||
    l === 'cn' ||
    l === 'zh-hans' ||
    l === 'zh-sg' ||
    l.startsWith('zh-cn') ||
    l.startsWith('zh-hans') ||
    l.includes('简体') ||
    l.includes('簡體') ||
    l.includes('simplified')
  ) {
    return 'zh-cn';
  }
  if (
    l === 'zh-tw' ||
    l === 'tw' ||
    l === 'zh-hant' ||
    l === 'zh-hk' ||
    l === 'zh-mo' ||
    l.startsWith('zh-tw') ||
    l.startsWith('zh-hant') ||
    l.includes('繁體') ||
    l.includes('繁体') ||
    l.includes('traditional')
  ) {
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

/**
 * 將標籤樣式別名或問卷選項字串標準化為 'text' 或 'emoji'。
 * @param {string} style
 * @returns {'text'|'emoji'}
 */
export function normalizeLabelStyle(style) {
  if (!style || typeof style !== 'string') return 'text';
  let s = style.toLowerCase().trim();
  const parenMatch = s.match(/[\(（]([a-z0-9\-_]+)[\)）]\s*$/);
  if (parenMatch) {
    s = parenMatch[1].trim();
  }
  if (
    s === 'emoji' ||
    s === 'emojis' ||
    s === 'icon' ||
    s === 'icons' ||
    s.includes('emoji') ||
    s.includes('表情') ||
    s.includes('圖示') ||
    s.includes('图标') ||
    s.includes('絵文字')
  ) {
    return 'emoji';
  }
  return 'text';
}

/**
 * 標準化模型名稱作為索引鍵（移除非英數字元並轉小寫）。
 * @param {string} name
 * @returns {string}
 */
export function normalizeModelName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * 清理對話識別碼以防止路徑穿越字元（..、/、\）。
 * @param {string} id
 * @returns {string}
 */
export function sanitizeConversationId(id) {
  if (typeof id !== 'string' || !id.trim()) return '';
  return id.trim().replace(/\.\./g, '').replace(/\//g, '').replace(/\\/g, '');
}

/**
 * 安全解析計數欄位（支援數字、陣列長度與數字字串）。
 * @param {unknown} val
 * @returns {number}
 */
export function safeGetCount(val) {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (Array.isArray(val)) return val.length;
  if (typeof val === 'string') {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * 將權杖數量格式化為易讀字串（例如 12500 -> '12.5k'、1500000 -> '1.5M'）。
 * @param {number} num
 * @returns {string}
 */
export function formatTokens(num) {
  if (!num) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}
