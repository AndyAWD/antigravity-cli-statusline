import { groupAdjacentItems } from '../metrics/layout-utils.mjs';
import { ADJACENT_PAIRS } from '../metrics/registry.mjs';
import { GRAY, RESET, getDisplayWidth, stripAnsi } from './ansi.mjs';
import { registerRenderer } from './index.mjs';

/**
 * 將相鄰且樣式一致的「數值 + 長條圖」指標自動合併為單一複合鍵（如 quota+bar）；
 * 若樣式衝突（一為 text、一為 emoji）則維持拆分顯示。
 * @param {string[]} items
 * @param {object|string} [itemStyles=undefined]
 * @param {string} [defaultStyle='text']
 * @returns {string[]}
 */
export function preprocessAdjacentItems(items, itemStyles = undefined, defaultStyle = 'text') {
  if (!Array.isArray(items)) return [];
  if (typeof itemStyles === 'string') {
    defaultStyle = itemStyles;
    itemStyles = undefined;
  }
  return groupAdjacentItems(items, itemStyles, defaultStyle, ADJACENT_PAIRS, { strictR27: true }).map(g => g.key);
}

/**
 * 依終端寬度與換行設定將指標字典組裝並輸出至標準輸出（空白或無效設定時安全退回 ? for shortcuts 列）。
 * @param {string[]} footerItems
 * @param {Record<string, string>} activeDict
 * @param {number} termWidth
 * @param {string} [fallbackModel]
 * @param {object} [itemStyles=undefined]
 * @param {string} [defaultStyle='text']
 * @param {string[]} [extraLines=[]]
 * @returns {string[]}
 */
export function renderStatusLine(footerItems, activeDict, termWidth, fallbackModel, itemStyles = undefined, defaultStyle = 'text', extraLines = []) {
  const lines = [];
  let currentLine = '';
  const processedItems = preprocessAdjacentItems(footerItems || [], itemStyles, defaultStyle);

  for (let i = 0; i < processedItems.length; i++) {
    const item = processedItems[i];
    if (item === 'n' || item === 'newline') {
      if (currentLine !== '') {
        lines.push(currentLine);
        currentLine = '';
      } else {
        lines.push(' ');
      }
      continue;
    }

    const text = activeDict ? activeDict[item] : '';
    if (!text) continue;

    if (text.includes('\n')) {
      if (currentLine !== '') {
        lines.push(currentLine);
        currentLine = '';
      }
      for (const blockLine of text.split('\n')) {
        if (blockLine.length > 0) {
          lines.push(blockLine);
        }
      }
      continue;
    }

    const toAdd = currentLine === '' ? text : ` ${GRAY}│${RESET} ${text}`;
    const toAddPlain = stripAnsi(toAdd);
    const currentPlain = stripAnsi(currentLine);

    if (currentLine !== '' && getDisplayWidth(currentPlain) + getDisplayWidth(toAddPlain) > termWidth) {
      lines.push(currentLine);
      currentLine = text;
    } else {
      currentLine += (currentLine === '' ? text : ` ${GRAY}│${RESET} ${text}`);
    }
  }
  if (currentLine !== '') lines.push(currentLine);

  while (lines.length > 0 && stripAnsi(lines[0]).trim() === '') {
    lines.shift();
  }
  while (lines.length > 0 && stripAnsi(lines[lines.length - 1]).trim() === '') {
    lines.pop();
  }

  // 防禦：若渲染結果為空或全部為空白行（例如 footerItems 為空、僅有換行、或所有指標皆無內容），回退輸出退讓模式，絕不回傳空陣列或空白行
  let usedFallback = false;
  if (lines.length === 0 || lines.every(l => stripAnsi(l).trim() === '')) {
    usedFallback = true;
    lines.length = 0;
    const leftText = '? for shortcuts';
    const rawModel = activeDict?.['model-name'] ? stripAnsi(activeDict['model-name']).replace(/^(?:🤖\s*|[^:]+:\s*)/, '') : '';
    const rightText = fallbackModel || rawModel || 'Gemini 3.5 Flash (High)';
    const width = termWidth || 80;
    const spacesCount = Math.max(1, width - getDisplayWidth(leftText) - getDisplayWidth(rightText) - 1);
    const fallbackLine = `${leftText}${' '.repeat(spacesCount)}${rightText}`;
    lines.push(fallbackLine);
  }

  if (!usedFallback && Array.isArray(extraLines) && extraLines.length > 0) {
    for (const extra of extraLines) {
      if (typeof extra === 'string' && extra.length > 0) {
        lines.push(extra);
      }
    }
  }

  console.log(lines.join('\n'));
  return lines;
}

/**
 * 標準版狀態列渲染器（支援物件上下文參數或舊版位置參數呼叫）。
 * @param {object|string[]} [ctx={}]
 * @returns {string[]}
 */
export function standardRenderer(ctx = {}, ...rest) {
  if (Array.isArray(ctx)) {
    return renderStatusLine(ctx, ...rest);
  }
  const {
    footerItems = [],
    activeDict = {},
    termWidth,
    fallbackModel,
    itemStyles,
    defaultStyle = 'text',
    extraLines = []
  } = ctx || {};
  return renderStatusLine(footerItems, activeDict, termWidth, fallbackModel, itemStyles, defaultStyle, extraLines);
}

registerRenderer('standard', standardRenderer);
