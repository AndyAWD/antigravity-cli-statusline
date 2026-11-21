/**
 * 分列式視覺畫布（Row-Based Canvas）轉換與相鄰長條圖合併輔助模組。
 * 與 CLI 端 items ('n' 換行分隔) 100% 無損雙向對應。
 */

/**
 * 將一維 items（含 'n'）轉換為二維列陣列 rows。
 * @param {string[]} items
 * @returns {string[][]}
 */
export function itemsToRows(items = []) {
  const rows = [[]];
  for (const item of items) {
    if (item === 'n' || item === 'newline') {
      rows.push([]);
    } else if (typeof item === 'string' && item) {
      rows[rows.length - 1].push(item);
    }
  }
  return rows;
}

/**
 * 將二維列陣列 rows 無損轉回一維 items（列間以 'n' 串接）。
 * @param {string[][]} rows
 * @returns {string[]}
 */
export function rowsToItems(rows = []) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) out.push('n');
    for (const id of rows[i] || []) {
      if (typeof id === 'string' && id && id !== 'n') {
        out.push(id);
      }
    }
  }
  return out;
}

/**
 * 計算單一列內之相鄰長條圖合併項目（供監控態合併顯示與編輯態 🔗 標記）。
 */
export function groupRowWithAdjacentMerges(row = [], itemStyles = {}, defaultStyle = 'text', adjacentPairs = []) {
  const getStyle = (id) => {
    if (itemStyles && itemStyles[id]) return itemStyles[id];
    return defaultStyle === 'emoji' ? 'emoji' : 'text';
  };

  const groups = [];
  for (let i = 0; i < row.length; i++) {
    const cur = row[i];
    const next = row[i + 1];
    if (next) {
      const pair = adjacentPairs.find(p =>
        (cur === p.val && next === p.bar) || (cur === p.bar && next === p.val)
      );
      if (pair && getStyle(cur) === getStyle(next)) {
        groups.push({
          key: pair.merged,
          ids: [cur, next],
          style: getStyle(cur),
          merged: true
        });
        i++;
        continue;
      }
    }
    groups.push({
      key: cur,
      ids: [cur],
      style: getStyle(cur),
      merged: false
    });
  }
  return groups;
}
