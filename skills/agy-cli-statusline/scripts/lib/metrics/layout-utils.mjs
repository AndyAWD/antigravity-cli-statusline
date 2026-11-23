import { normalizeLabelStyle } from '../core/normalize.mjs';
import { ADJACENT_PAIRS, ALL_STANDARD_METRIC_IDS } from './registry.mjs';

/**
 * 計算單一指標的有效顯示樣式（支援嚴格 CLI R27 語意或寬鬆預設退讓）。
 * @param {string} item
 * @param {object|undefined|null} itemStyles
 * @param {string} [defaultStyle='text']
 * @param {boolean} [strictR27=true]
 * @returns {'text'|'emoji'}
 */
export function resolveItemEffectiveStyle(item, itemStyles, defaultStyle = 'text', strictR27 = true) {
  if (itemStyles && typeof itemStyles === 'object' && !Array.isArray(itemStyles)) {
    if (itemStyles[item]) {
      return normalizeLabelStyle(itemStyles[item]);
    }
    if (strictR27) {
      return 'text';
    }
  }
  return normalizeLabelStyle(defaultStyle || 'text');
}

/**
 * 將相鄰且樣式一致的「數值 + 長條圖」指標合併為單一複合群組；樣式衝突則拆分顯示。
 * 供 CLI（standard.mjs）與 Antigravity 2.0（drag-rows.js）共用。
 * @param {string[]} items
 * @param {object|undefined|null} [itemStyles]
 * @param {string} [defaultStyle='text']
 * @param {Array<{ val: string, bar: string, merged: string }>} [adjacentPairs=ADJACENT_PAIRS]
 * @param {{ strictR27?: boolean }} [options={}]
 * @returns {Array<{ key: string, ids: string[], style: 'text'|'emoji', merged: boolean }>}
 */
export function groupAdjacentItems(
  items = [],
  itemStyles = undefined,
  defaultStyle = 'text',
  adjacentPairs = ADJACENT_PAIRS,
  options = {}
) {
  if (!Array.isArray(items)) return [];
  const pairs = Array.isArray(adjacentPairs) && adjacentPairs.length > 0 ? adjacentPairs : ADJACENT_PAIRS;
  const strictR27 = options?.strictR27 !== false;

  const groups = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    const next = items[i + 1];
    const curStyle = resolveItemEffectiveStyle(cur, itemStyles, defaultStyle, strictR27);

    if (next) {
      const match = pairs.find(p =>
        (cur === p.val && next === p.bar) || (cur === p.bar && next === p.val)
      );
      if (match) {
        const nextStyle = resolveItemEffectiveStyle(next, itemStyles, defaultStyle, strictR27);
        if (curStyle === nextStyle) {
          groups.push({
            key: match.merged,
            ids: [cur, next],
            style: curStyle,
            merged: true
          });
          i++;
          continue;
        }
      }
    }

    groups.push({
      key: cur,
      ids: [cur],
      style: curStyle,
      merged: false
    });
  }
  return groups;
}

/**
 * 產生人類可讀之排序語法（英文識別碼版與序號版）。
 * 供 MCP 後端（cli-settings-bridge.mjs）與 Antigravity 2.0 前端（main.js）共用。
 * @param {string[]} [items=[]]
 * @param {Record<string, string>} [itemStyles={}]
 * @param {string} [labelStyle='text']
 * @param {string[]} [metricIds=ALL_STANDARD_METRIC_IDS]
 * @returns {{ idExpression: string, numericExpression: string }}
 */
export function formatOrderExpressions(
  items = [],
  itemStyles = {},
  labelStyle = 'text',
  metricIds = ALL_STANDARD_METRIC_IDS
) {
  const idParts = [];
  const numParts = [];
  const ids = Array.isArray(metricIds) && metricIds.length > 0 ? metricIds : ALL_STANDARD_METRIC_IDS;
  const indexMap = new Map(ids.map((id, idx) => [id, idx + 1]));

  for (const item of items) {
    if (item === 'n') {
      idParts.push('n');
      numParts.push('n');
      continue;
    }
    const effective = (itemStyles && itemStyles[item]) ? itemStyles[item] : labelStyle;
    const isEmoji = effective === 'emoji';
    idParts.push(isEmoji ? `e:${item}` : item);
    const num = indexMap.get(item);
    if (num) {
      numParts.push(isEmoji ? `e${num}` : String(num));
    }
  }
  return {
    idExpression: idParts.join(', '),
    numericExpression: numParts.join(', ')
  };
}
