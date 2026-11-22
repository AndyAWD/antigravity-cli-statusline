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

/**
 * 在二維分列陣列中移動或插入單一狀態區塊（純函式，回傳新陣列）。
 * @param {string[][]} rows
 * @param {{ from: 'row' | 'drawer', id: string, rowIdx?: number, colIdx?: number }} payload
 * @param {{ kind: 'chip' | 'row' | 'between-rows' | 'new-row', rowIdx?: number, colIdx?: number, position?: 'before' | 'after' }} dropTarget
 * @returns {string[][]}
 */
export function moveBlockInRows(rows = [[]], payload, dropTarget) {
  const copy = (Array.isArray(rows) ? rows : [[]]).map(r => (Array.isArray(r) ? [...r] : []));
  if (copy.length === 0) copy.push([]);

  const id = payload?.id;
  if (typeof id !== 'string' || !id || !dropTarget?.kind) {
    return copy;
  }

  const rawInsertCol = dropTarget.kind === 'chip'
    ? (dropTarget.position === 'after' ? (dropTarget.colIdx ?? 0) + 1 : (dropTarget.colIdx ?? 0))
    : -1;
  let insertCol = rawInsertCol;
  let emptiedSrcRowIdx = -1;

  if (payload.from === 'row') {
    const srcRow = copy[payload.rowIdx];
    const hadItems = Boolean(srcRow && srcRow.length > 0);
    if (srcRow && typeof payload.colIdx === 'number' && payload.colIdx >= 0 && payload.colIdx < srcRow.length) {
      srcRow.splice(payload.colIdx, 1);
      if (hadItems && srcRow.length === 0) {
        emptiedSrcRowIdx = payload.rowIdx;
      }
      if (dropTarget.kind === 'chip' && payload.rowIdx === dropTarget.rowIdx && payload.colIdx < rawInsertCol) {
        insertCol = Math.max(0, rawInsertCol - 1);
      }
    }
  } else if (payload.from === 'drawer') {
    for (let i = 0; i < copy.length; i++) {
      const r = copy[i];
      let idx = r.indexOf(id);
      while (idx !== -1) {
        const hadItems = r.length > 0;
        r.splice(idx, 1);
        if (hadItems && r.length === 0) {
          emptiedSrcRowIdx = i;
        }
        if (dropTarget.kind === 'chip' && i === dropTarget.rowIdx && idx < insertCol) {
          insertCol = Math.max(0, insertCol - 1);
        }
        idx = r.indexOf(id);
      }
    }
  }

  if (dropTarget.kind === 'new-row') {
    copy.push([id]);
  } else if (dropTarget.kind === 'between-rows') {
    const insertRowIdx = Math.max(0, Math.min(copy.length, Number(dropTarget.rowIdx) || 0));
    copy.splice(insertRowIdx, 0, [id]);
    if (emptiedSrcRowIdx >= insertRowIdx) {
      emptiedSrcRowIdx++;
    }
  } else if (dropTarget.kind === 'row' || dropTarget.kind === 'chip') {
    const targetRowIdx = Math.max(0, Math.min(copy.length - 1, Number(dropTarget.rowIdx) || 0));
    const dest = copy[targetRowIdx] || (copy[targetRowIdx] = []);
    if (dropTarget.kind === 'chip') {
      const clampedCol = Math.max(0, Math.min(dest.length, insertCol));
      dest.splice(clampedCol, 0, id);
    } else {
      dest.push(id);
    }
  }

  if (emptiedSrcRowIdx >= 0 && copy[emptiedSrcRowIdx] && copy[emptiedSrcRowIdx].length === 0 && copy.length > 1) {
    copy.splice(emptiedSrcRowIdx, 1);
  }

  return copy.length > 0 ? copy : [[]];
}

/**
 * 在二維分列陣列中移動整列順序（純函式，回傳新陣列）。
 * @param {string[][]} rows
 * @param {number} srcRowIdx
 * @param {number} insertRowIdx
 * @returns {string[][]}
 */
export function moveRowInRows(rows = [[]], srcRowIdx, insertRowIdx) {
  const copy = (Array.isArray(rows) ? rows : [[]]).map(r => (Array.isArray(r) ? [...r] : []));
  if (copy.length === 0) return [[]];
  if (
    typeof srcRowIdx !== 'number' ||
    typeof insertRowIdx !== 'number' ||
    Number.isNaN(srcRowIdx) ||
    Number.isNaN(insertRowIdx) ||
    srcRowIdx < 0 ||
    srcRowIdx >= copy.length
  ) {
    return copy;
  }

  const clampedInsert = Math.max(0, Math.min(copy.length, insertRowIdx));
  if (clampedInsert === srcRowIdx || clampedInsert === srcRowIdx + 1) {
    return copy;
  }

  const [moved] = copy.splice(srcRowIdx, 1);
  const adjusted = srcRowIdx < clampedInsert ? clampedInsert - 1 : clampedInsert;
  copy.splice(adjusted, 0, moved);
  return copy.length > 0 ? copy : [[]];
}

/**
 * 比較兩個二維分列陣列內容是否完全相同。
 * @param {string[][]} a
 * @param {string[][]} b
 * @returns {boolean}
 */
export function rowsEqual(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i];
    const rb = b[i];
    if (!Array.isArray(ra) || !Array.isArray(rb) || ra.length !== rb.length) return false;
    for (let j = 0; j < ra.length; j++) {
      if (ra[j] !== rb[j]) return false;
    }
  }
  return true;
}

/**
 * 判斷 MCP 工具回傳之 structuredContent 是否為完整的儀表板快照（排除 save-panel / save-both 僅含 layout 之儲存回應）。
 * @param {unknown} payload
 * @returns {boolean}
 */
export function isDashboardSnapshot(payload) {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    payload.layout &&
    payload.registry &&
    Array.isArray(payload.registry.metrics) &&
    payload.renderedItems
  );
}
