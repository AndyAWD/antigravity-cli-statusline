/**
 * SemVer 語意化版本解析與比較工具（支援先行版本號 prerelease 比較）。
 */

/**
 * 將版本字串標準化為不含前導 v 與建置中繼資料（+build）的 SemVer 字串。
 * @param {string} versionStr
 * @returns {string}
 */
export function normalizeSemver(versionStr) {
  if (typeof versionStr !== 'string') return '';
  const trimmed = versionStr.trim().replace(/^v/i, '');
  const match = trimmed.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return '';
  return match[4] ? `${match[1]}.${match[2]}.${match[3]}-${match[4]}` : `${match[1]}.${match[2]}.${match[3]}`;
}

/**
 * 格式化版本顯示標籤（統一補上小寫 v 前綴）。
 * @param {string} versionStr
 * @returns {string}
 */
export function formatVersionTag(versionStr) {
  const norm = normalizeSemver(versionStr);
  if (norm) return `v${norm}`;
  if (typeof versionStr === 'string' && versionStr.trim()) {
    const t = versionStr.trim();
    return /^v/i.test(t) ? `v${t.slice(1)}` : `v${t}`;
  }
  return '';
}

/**
 * 依 SemVer 2.0.0 規範比較兩個版本（包含主版本、次版本、修訂號與 prerelease 識別元）。
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1|null} 若任一版本無法解析為 SemVer 則回傳 null。
 */
export function compareSemver(a, b) {
  const normA = normalizeSemver(a);
  const normB = normalizeSemver(b);
  if (!normA || !normB) return null;
  const [coreA, preA] = normA.split('-');
  const [coreB, preB] = normB.split('-');
  const partsA = coreA.split('.').map(Number);
  const partsB = coreB.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] < partsB[i]) return -1;
    if (partsA[i] > partsB[i]) return 1;
  }
  if (!preA && !preB) return 0;
  if (!preA && preB) return 1;
  if (preA && !preB) return -1;
  const idsA = preA.split('.');
  const idsB = preB.split('.');
  const len = Math.max(idsA.length, idsB.length);
  for (let i = 0; i < len; i++) {
    if (i >= idsA.length) return -1;
    if (i >= idsB.length) return 1;
    const isNumA = /^\d+$/.test(idsA[i]);
    const isNumB = /^\d+$/.test(idsB[i]);
    if (isNumA && isNumB) {
      const nA = Number(idsA[i]);
      const nB = Number(idsB[i]);
      if (nA < nB) return -1;
      if (nA > nB) return 1;
    } else if (isNumA !== isNumB) {
      return isNumA ? -1 : 1;
    } else {
      if (idsA[i] < idsB[i]) return -1;
      if (idsA[i] > idsB[i]) return 1;
    }
  }
  return 0;
}

/**
 * 判斷已安裝版本是否落後於最新版本。
 * @param {string} installedVersion
 * @param {string} latestVersion
 * @returns {boolean}
 */
export function isVersionBehind(installedVersion, latestVersion) {
  return compareSemver(installedVersion, latestVersion) === -1;
}
