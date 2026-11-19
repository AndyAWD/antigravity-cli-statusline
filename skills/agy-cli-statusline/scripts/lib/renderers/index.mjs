/**
 * 狀態列渲染器註冊表（Renderer Registry）。
 * 提供模組化註冊、查詢與列舉擴充介面（例如 standard、dino 等自訂風格渲染器）。
 */

const rendererRegistry = new Map();

/**
 * 註冊具名渲染器函式。
 * @param {string} name
 * @param {Function} rendererFn
 * @returns {Function}
 */
export function registerRenderer(name, rendererFn) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new TypeError('Renderer name must be a non-empty string');
  }
  if (typeof rendererFn !== 'function') {
    throw new TypeError('Renderer must be a function');
  }
  const key = name.trim().toLowerCase();
  rendererRegistry.set(key, rendererFn);
  return rendererFn;
}

/**
 * 依名稱取得已註冊的渲染器函式（未指定或空字串時預設查詢 'standard'）。
 * @param {string} [name='standard']
 * @returns {Function|null}
 */
export function getRenderer(name = 'standard') {
  const key = (typeof name === 'string' && name.trim()) ? name.trim().toLowerCase() : 'standard';
  return rendererRegistry.get(key) || null;
}

/**
 * 列出目前所有已註冊的渲染器名稱清單。
 * @returns {string[]}
 */
export function listRenderers() {
  return Array.from(rendererRegistry.keys());
}
