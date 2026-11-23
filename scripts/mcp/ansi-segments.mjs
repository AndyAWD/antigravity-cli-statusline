/**
 * 將 24-bit / 標準 ANSI 控制碼字串解析為結構化著色片段，供 Antigravity 2.0 前端直接渲染。
 * 與 skills/agy-cli-statusline/scripts/lib/metrics/i18n.mjs 單一真實來源完全同步。
 */

const ANSI_RE = /\x1b\[([0-9;]*)m/g;

/**
 * 解析單一 ANSI 著色字串為 { plainText, segments }。
 * @param {string} input
 * @returns {{ plainText: string, segments: Array<{ text: string, color?: string, bold?: boolean }> }}
 */
export function parseAnsiToSegments(input) {
  const str = String(input ?? '');
  const segments = [];
  let plainText = '';
  let lastIdx = 0;
  let color = '';
  let bold = false;

  const pushChunk = (text) => {
    if (!text) return;
    plainText += text;
    const prev = segments[segments.length - 1];
    if (prev && (prev.color || '') === color && Boolean(prev.bold) === bold) {
      prev.text += text;
      return;
    }
    const seg = { text };
    if (color) seg.color = color;
    if (bold) seg.bold = true;
    segments.push(seg);
  };

  ANSI_RE.lastIndex = 0;
  let match;
  while ((match = ANSI_RE.exec(str)) !== null) {
    if (match.index > lastIdx) {
      pushChunk(str.slice(lastIdx, match.index));
    }
    lastIdx = match.index + match[0].length;
    const codes = match[1].split(';').map(s => parseInt(s, 10));
    for (let i = 0; i < codes.length; i++) {
      const c = isNaN(codes[i]) ? 0 : codes[i];
      if (c === 0) {
        color = '';
        bold = false;
      } else if (c === 1) {
        bold = true;
      } else if (c === 22) {
        bold = false;
      } else if (c === 39) {
        color = '';
      } else if (c === 90) {
        color = '#6e7b8f';
      } else if (c === 38 && codes[i + 1] === 2 && i + 4 < codes.length) {
        const r = Math.max(0, Math.min(255, codes[i + 2] || 0));
        const g = Math.max(0, Math.min(255, codes[i + 3] || 0));
        const b = Math.max(0, Math.min(255, codes[i + 4] || 0));
        color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        i += 4;
      }
    }
  }

  if (lastIdx < str.length) {
    pushChunk(str.slice(lastIdx));
  }

  return { plainText, segments };
}

/**
 * 將已解析的單一指標拆分為標籤前綴與數值段，方便卡片流排版。
 * @param {string} ansiStr
 * @returns {{ plainText: string, label: string, valueText: string, segments: Array<{ text: string, color?: string, bold?: boolean }>, valueSegments: Array<{ text: string, color?: string, bold?: boolean }> }}
 */
export function parseMetricRenderPayload(ansiStr) {
  const { plainText, segments } = parseAnsiToSegments(ansiStr);
  const colonIdx = plainText.indexOf(':');
  let label = '';
  let valueText = plainText;
  let valueSegments = segments;
  if (colonIdx > 0 && colonIdx < 24) {
    label = plainText.slice(0, colonIdx).trim();
    valueText = plainText.slice(colonIdx + 1).trim();

    let remainingSkip = colonIdx + 1;
    const sliced = [];
    let trimmingLeading = true;
    for (const seg of segments) {
      let txt = seg.text;
      if (remainingSkip > 0) {
        if (txt.length <= remainingSkip) {
          remainingSkip -= txt.length;
          continue;
        }
        txt = txt.slice(remainingSkip);
        remainingSkip = 0;
      }
      if (trimmingLeading) {
        txt = txt.replace(/^\s+/, '');
        if (!txt) continue;
        trimmingLeading = false;
      }
      const nextSeg = { text: txt };
      if (seg.color) nextSeg.color = seg.color;
      if (seg.bold) nextSeg.bold = true;
      sliced.push(nextSeg);
    }
    valueSegments = sliced.length > 0 ? sliced : [{ text: valueText }];
  }
  return { plainText, label, valueText, segments, valueSegments };
}
