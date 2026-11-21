import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables
} from '@modelcontextprotocol/ext-apps';
import { groupRowWithAdjacentMerges, itemsToRows, rowsToItems } from './drag-rows.js';
import { getUiStrings } from './i18n.js';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.12.0';
const app = new App({ name: 'Statusline', version: APP_VERSION }, {});

const state = {
  snapshot: null,
  tab: 'monitor', // 'monitor' | 'prefs'
  editMode: false,
  editRows: [],
  editItemStyles: {},
  editLabelStyle: 'text',
  editTimeFormat: 'smart',
  editBarLength: 10,
  editLang: 'zh-tw',
  deployHooks: false,
  searchQuery: '',
  inFlight: false,
  refreshTimer: null,
  countdownTimer: null,
  dragState: null,
  toastTimer: null
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  let hasDeferredValue = false;
  let deferredValue;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'textContent') node.textContent = v;
    else if (k === 'checked') node.checked = Boolean(v);
    else if (k === 'value') {
      hasDeferredValue = true;
      deferredValue = v;
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== undefined && v !== null) {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined) continue;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  if (hasDeferredValue) {
    node.value = deferredValue;
  }
  return node;
}

function showToast(msg) {
  const old = document.getElementById('toast-box');
  if (old) old.remove();
  if (state.toastTimer) clearTimeout(state.toastTimer);
  const box = el('div', { id: 'toast-box', className: 'toast', textContent: msg });
  document.body.appendChild(box);
  state.toastTimer = setTimeout(() => box.remove(), 2600);
}

async function copyTextWithFallback(text, t) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      showToast(t.copied);
      return;
    }
  } catch (_) {}
  try {
    const ta = el('textarea', { value: text });
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) {
      showToast(t.copied);
      return;
    }
  } catch (_) {}
  const old = document.getElementById('copy-fallback-box');
  if (old) old.remove();
  const fallbackInput = el('input', {
    className: 'input-ctrl',
    value: text,
    readonly: 'readonly',
    style: 'width:100%;'
  });
  const bar = el('div', { id: 'copy-fallback-box', className: 'copy-fallback-bar' }, [
    el('div', { className: 'edit-row-header' }, [
      el('span', { textContent: t.copyFallbackHint }),
      el('button', {
        className: 'btn btn-sm',
        textContent: t.close,
        onClick: () => bar.remove()
      })
    ]),
    fallbackInput
  ]);
  document.body.appendChild(bar);
  fallbackInput.focus();
  fallbackInput.select();
}

function formatLiveCountdown(isoStr) {
  if (!isoStr) return '';
  const diffSec = Math.floor((new Date(isoStr).getTime() - Date.now()) / 1000);
  if (isNaN(diffSec) || diffSec <= 0) return 'now';
  const d = Math.floor(diffSec / 86400);
  const h = Math.floor((diffSec % 86400) / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getTierColor(pct) {
  if (pct >= 75) return 'var(--tier-blue)';
  if (pct >= 50) return 'var(--tier-green)';
  if (pct >= 25) return 'var(--tier-yellow)';
  return 'var(--tier-red)';
}

function mapAnsiColorToThemeVar(hexColor) {
  if (!hexColor) return '';
  const lower = String(hexColor).toLowerCase();
  if (lower === '#ffffff') return 'var(--fg-1)';
  if (lower === '#57caff') return 'var(--tier-blue-fg)';
  if (lower === '#5cdb6d') return 'var(--tier-green-fg)';
  if (lower === '#ffd427') return 'var(--tier-yellow-fg)';
  if (lower === '#ff7daf') return 'var(--tier-red-fg)';
  if (lower === '#6e7b8f') return 'var(--fg-3)';
  return hexColor;
}

function getCountdownIsoForKey(key, snap) {
  if (!snap?.quotas) return '';
  if (key === 'quota-reset-countdown') return snap.quotas.shortTerm?.resetTime || '';
  if (key === 'quota-weekly-countdown') return snap.quotas.weekly?.resetTime || '';
  if (key === 'quota-argon-countdown') return snap.quotas.argon?.resetTime || '';
  return '';
}

function renderColoredSegments(segments = [], countdownIso = '') {
  const frag = document.createDocumentFragment();
  let lastNonEmptySpan = null;
  for (const seg of segments) {
    const span = el('span', { textContent: seg.text });
    const mappedColor = mapAnsiColorToThemeVar(seg.color);
    if (mappedColor) span.style.color = mappedColor;
    if (seg.bold) span.style.fontWeight = '700';
    if (seg.text && seg.text.trim()) lastNonEmptySpan = span;
    frag.appendChild(span);
  }
  if (countdownIso && lastNonEmptySpan) {
    lastNonEmptySpan.setAttribute('data-countdown-iso', countdownIso);
  }
  return frag;
}

function computeDraftOrderExpressions(items = [], itemStyles = {}, labelStyle = 'text', metrics = []) {
  const indexMap = new Map(metrics.map((m, idx) => [m.id, idx + 1]));
  const idParts = [];
  const numParts = [];
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
    if (num) numParts.push(isEmoji ? `e${num}` : String(num));
  }
  return {
    idExpression: idParts.join(', '),
    numericExpression: numParts.join(', ')
  };
}

function syncEditDraftFromSnapshot(snap) {
  state.editRows = itemsToRows(snap.layout.items);
  state.editItemStyles = { ...(snap.layout.itemStyles || {}) };
  state.editLabelStyle = snap.layout.labelStyle || 'text';
  state.editTimeFormat = snap.layout.timeFormat || 'smart';
  state.editBarLength = snap.layout.barLength || 10;
  state.editLang = snap.layout.lang || 'zh-tw';
}

async function callToolSafe(name, args) {
  if (state.inFlight && name === 'statusline_dashboard') return null;
  if (name === 'statusline_dashboard') state.inFlight = true;
  try {
    const res = await app.callServerTool({ name, arguments: args });
    if (res?.isError) {
      const t = getUiStrings(state.editMode ? state.editLang : (state.snapshot?.layout?.lang || 'zh-tw'));
      const errMsg = res.content?.[0]?.text || t.saveErrorToast;
      showToast(errMsg);
      return null;
    }
    if (res?.structuredContent?.layout) {
      state.snapshot = res.structuredContent;
      if (!state.editMode) syncEditDraftFromSnapshot(state.snapshot);
      render();
    }
    return res;
  } catch (err) {
    showToast(err?.message || 'Tool call failed');
    return null;
  } finally {
    if (name === 'statusline_dashboard') state.inFlight = false;
  }
}

async function saveConfigAction(action, extra = {}) {
  const snap = state.snapshot;
  if (!snap?.uiSessionToken) return null;
  const layout = {
    lang: state.editLang,
    items: rowsToItems(state.editRows),
    itemStyles: state.editItemStyles,
    labelStyle: state.editLabelStyle,
    timeFormat: state.editTimeFormat,
    barLength: state.editBarLength
  };
  return callToolSafe('statusline_save_config', {
    uiSessionToken: snap.uiSessionToken,
    action,
    layout,
    panelPrefs: snap.panelPrefs,
    workspacePath: snap.session?.projectPath || '',
    ...extra
  });
}

function scheduleAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  const sec = state.snapshot?.panelPrefs?.autoRefreshSec || 0;
  if (sec > 0) {
    state.refreshTimer = setInterval(() => {
      if (document.hidden || state.editMode || state.inFlight) return;
      void callToolSafe('statusline_dashboard', {
        conversationId: state.snapshot?.session?.conversationId || ''
      });
    }, sec * 1000);
  }
}

function startDrag(ev, payload) {
  ev.preventDefault();
  const handle = ev.currentTarget;
  if (handle && handle.setPointerCapture) {
    try { handle.setPointerCapture(ev.pointerId); } catch (_) {}
  }

  const ghost = el('div', { className: 'drag-ghost', textContent: payload.label });
  ghost.style.left = `${ev.clientX + 10}px`;
  ghost.style.top = `${ev.clientY + 10}px`;
  document.body.appendChild(ghost);
  state.dragState = { ...payload, ghost };

  const onMove = (moveEv) => {
    ghost.style.left = `${moveEv.clientX + 10}px`;
    ghost.style.top = `${moveEv.clientY + 10}px`;
    document.querySelectorAll('.drop-active').forEach(n => n.classList.remove('drop-active'));
    const hit = document.elementFromPoint(moveEv.clientX, moveEv.clientY);
    const zone = hit?.closest('[data-drop-kind]');
    if (zone) zone.classList.add('drop-active');
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    document.querySelectorAll('.drop-active').forEach(n => n.classList.remove('drop-active'));
    ghost.remove();
    state.dragState = null;
  };

  const onUp = (upEv) => {
    const hit = document.elementFromPoint(upEv.clientX, upEv.clientY);
    const zone = hit?.closest('[data-drop-kind]');
    cleanup();
    if (zone) {
      applyDrop(payload, zone);
    }
  };

  const onCancel = () => cleanup();

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
  window.addEventListener('pointercancel', onCancel, { once: true });
}

function applyDrop(payload, zone) {
  const kind = zone.getAttribute('data-drop-kind');
  const targetRow = parseInt(zone.getAttribute('data-row') || '0', 10);
  const targetCol = parseInt(zone.getAttribute('data-col') || '-1', 10);
  const rows = state.editRows.map(r => [...r]);
  const id = payload.id;
  let emptiedSrcRowIdx = -1;

  if (payload.from === 'row') {
    const srcRow = rows[payload.rowIdx];
    const hadItems = Boolean(srcRow && srcRow.length > 0);
    if (srcRow) srcRow.splice(payload.colIdx, 1);
    if (hadItems && srcRow && srcRow.length === 0) {
      emptiedSrcRowIdx = payload.rowIdx;
    }
  } else if (payload.from === 'drawer') {
    // 若已在其他列存在則先移除避免重複
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const idx = r.indexOf(id);
      if (idx !== -1) {
        r.splice(idx, 1);
        if (r.length === 0) emptiedSrcRowIdx = i;
      }
    }
  }

  if (kind === 'new-row') {
    rows.push([id]);
  } else if (kind === 'between-rows') {
    rows.splice(targetRow, 0, [id]);
    if (emptiedSrcRowIdx >= targetRow) emptiedSrcRowIdx++;
  } else if (kind === 'row' || kind === 'chip') {
    const dest = rows[targetRow] || (rows[targetRow] = []);
    if (targetCol >= 0 && targetCol <= dest.length) {
      dest.splice(targetCol, 0, id);
    } else {
      dest.push(id);
    }
  }

  if (emptiedSrcRowIdx >= 0 && rows[emptiedSrcRowIdx] && rows[emptiedSrcRowIdx].length === 0 && rows.length > 1) {
    rows.splice(emptiedSrcRowIdx, 1);
  }

  state.editRows = rows.length > 0 ? rows : [[]];
  render();
}

function renderMonitorView(root, snap, t) {
  const rows = state.editMode ? state.editRows : itemsToRows(snap.layout.items);
  const itemStyles = state.editMode ? state.editItemStyles : (snap.layout.itemStyles || {});
  const labelStyle = state.editMode ? state.editLabelStyle : (snap.layout.labelStyle || 'text');
  const density = snap.panelPrefs?.viewDensity || 'cards';

  if (snap.updateInfo?.updateAvailable) {
    const banner = el('div', { className: 'update-banner' }, [
      el('span', {
        textContent: `⚠️ ${t.updateBanner}: ${snap.updateInfo.installedTag} → ${snap.updateInfo.latestTag}`
      }),
      el('div', { className: 'topbar-group' }, [
        el('button', {
          className: 'btn btn-sm',
          textContent: t.copyCmd,
          onClick: () => copyTextWithFallback('agy plugin install https://github.com/AndyAWD/antigravity-cli-statusline', t)
        }),
        app.getHostCapabilities()?.openLinks
          ? el('button', {
              className: 'btn btn-sm',
              textContent: t.openRelease,
              onClick: () => app.openLink({ url: snap.updateInfo.releaseUrl })
            })
          : null
      ])
    ]);
    root.appendChild(banner);
  }

  const container = el('div', { className: 'rows-container' });

  if (state.editMode) {
    rows.forEach((row, rIdx) => {
      container.appendChild(el('div', {
        className: 'drop-slot-between',
        'data-drop-kind': 'between-rows',
        'data-row': String(rIdx),
        textContent: t.dropBetweenRows
      }));

      const rowBox = el('div', {
        className: 'edit-row-box',
        'data-drop-kind': 'row',
        'data-row': String(rIdx)
      });

      const header = el('div', { className: 'edit-row-header' }, [
        el('span', { textContent: t.rowLabel.replace('{n}', String(rIdx + 1)) }),
        el('div', { className: 'topbar-group' }, [
          rIdx > 0
            ? el('button', {
                className: 'btn btn-sm',
                textContent: `↑ ${t.moveUp}`,
                onClick: () => {
                  const copy = [...state.editRows];
                  [copy[rIdx - 1], copy[rIdx]] = [copy[rIdx], copy[rIdx - 1]];
                  state.editRows = copy;
                  render();
                }
              })
            : null,
          rIdx < rows.length - 1
            ? el('button', {
                className: 'btn btn-sm',
                textContent: `↓ ${t.moveDown}`,
                onClick: () => {
                  const copy = [...state.editRows];
                  [copy[rIdx], copy[rIdx + 1]] = [copy[rIdx + 1], copy[rIdx]];
                  state.editRows = copy;
                  render();
                }
              })
            : null,
          rIdx > 0
            ? el('button', {
                className: 'btn btn-sm',
                textContent: t.mergeUp,
                onClick: () => {
                  const copy = state.editRows.map(r => [...r]);
                  copy[rIdx - 1].push(...copy[rIdx]);
                  copy.splice(rIdx, 1);
                  state.editRows = copy;
                  render();
                }
              })
            : null,
          rows.length > 1
            ? el('button', {
                className: 'btn btn-sm',
                textContent: '×',
                title: t.removeRow,
                onClick: () => {
                  const copy = state.editRows.map(r => [...r]);
                  copy.splice(rIdx, 1);
                  state.editRows = copy.length ? copy : [[]];
                  render();
                }
              })
            : null
        ])
      ]);

      const chipsWrap = el('div', { className: 'edit-chips' });
      if (row.length === 0) {
        chipsWrap.appendChild(el('span', {
          className: 'metric-card-label',
          textContent: t.emptyRowHint
        }));
      } else {
        row.forEach((id, cIdx) => {
          const emoji = snap.registry.emojiMap[id] || '•';
          const effectiveStyle = state.editItemStyles[id] || state.editLabelStyle;
          const nextId = row[cIdx + 1];
          const isPaired = nextId && snap.registry.adjacentPairs.some(p =>
            ((id === p.val && nextId === p.bar) || (id === p.bar && nextId === p.val)) &&
            effectiveStyle === (state.editItemStyles[nextId] || state.editLabelStyle)
          );

          const renderedInfo = snap.renderedItems?.text?.[id];
          const metricDef = snap.registry.metrics.find(m => m.id === id);
          const shortTitle = renderedInfo?.label || metricDef?.descriptions?.[state.editLang] || id;
          const liveVal = renderedInfo?.valueText || renderedInfo?.plainText || '';

          const chip = el('div', {
            className: 'chip',
            'data-drop-kind': 'chip',
            'data-row': String(rIdx),
            'data-col': String(cIdx),
            title: id
          }, [
            el('span', {
              className: 'chip-handle',
              textContent: '⋮⋮',
              onPointerdown: (ev) => startDrag(ev, { from: 'row', id, rowIdx: rIdx, colIdx: cIdx, label: `${emoji} ${shortTitle}` })
            }),
            el('span', { textContent: `${emoji} ${shortTitle}` }),
            liveVal ? el('span', { className: 'chip-val-preview', textContent: liveVal }) : null,
            cIdx > 0
              ? el('button', {
                  className: 'btn btn-sm',
                  textContent: '←',
                  title: t.moveLeft,
                  onClick: () => {
                    const r = [...state.editRows[rIdx]];
                    [r[cIdx - 1], r[cIdx]] = [r[cIdx], r[cIdx - 1]];
                    state.editRows[rIdx] = r;
                    render();
                  }
                })
              : null,
            cIdx < row.length - 1
              ? el('button', {
                  className: 'btn btn-sm',
                  textContent: '→',
                  title: t.moveRight,
                  onClick: () => {
                    const r = [...state.editRows[rIdx]];
                    [r[cIdx], r[cIdx + 1]] = [r[cIdx + 1], r[cIdx]];
                    state.editRows[rIdx] = r;
                    render();
                  }
                })
              : null,
            el('button', {
              className: 'btn btn-sm',
              textContent: effectiveStyle === 'emoji' ? t.styleEmoji : t.styleText,
              onClick: () => {
                state.editItemStyles[id] = effectiveStyle === 'emoji' ? 'text' : 'emoji';
                render();
              }
            }),
            el('button', {
              className: 'btn btn-sm',
              textContent: '×',
              onClick: () => {
                state.editRows[rIdx].splice(cIdx, 1);
                if (state.editRows[rIdx].length === 0 && state.editRows.length > 1) {
                  state.editRows.splice(rIdx, 1);
                }
                render();
              }
            })
          ]);
          chipsWrap.appendChild(chip);
          if (isPaired) {
            chipsWrap.appendChild(el('span', { textContent: '🔗', title: 'Adjacent bar merge' }));
          }
        });
      }

      rowBox.appendChild(header);
      rowBox.appendChild(chipsWrap);
      container.appendChild(rowBox);
    });

    container.appendChild(el('div', {
      className: 'drop-new-row',
      'data-drop-kind': 'new-row',
      textContent: t.dropNewRow
    }));

    container.appendChild(el('div', { className: 'topbar-group' }, [
      el('button', {
        className: 'btn btn-sm',
        textContent: t.addEmptyRow,
        onClick: () => {
          state.editRows.push([]);
          render();
        }
      })
    ]));

    root.appendChild(container);
    renderEditorDrawer(root, snap, t);
    return;
  }

  // 監控態：完全依使用者分列與 n 換行渲染
  for (const row of rows) {
    if (row.length === 0) {
      const spacer = el('div');
      spacer.style.height = '6px';
      container.appendChild(spacer);
      continue;
    }

    const groups = groupRowWithAdjacentMerges(row, itemStyles, labelStyle, snap.registry.adjacentPairs);
    if (density === 'strip') {
      const strip = el('div', { className: 'strip-row' });
      groups.forEach((g, idx) => {
        if (idx > 0) strip.appendChild(el('span', { className: 'strip-sep', textContent: '│' }));
        const itemData = snap.renderedItems?.[g.style]?.[g.key] || snap.renderedItems?.text?.[g.key];
        if (itemData?.segments?.length) {
          strip.appendChild(renderColoredSegments(itemData.segments, getCountdownIsoForKey(g.key, snap)));
        }
      });
      container.appendChild(strip);
    } else {
      const rowGrid = el('div', { className: 'row-cards' });
      for (const g of groups) {
        const itemData = snap.renderedItems?.[g.style]?.[g.key] || snap.renderedItems?.text?.[g.key];
        if (!itemData || !itemData.plainText) continue;

        const card = el('div', { className: 'metric-card' });
        const hasSeparateLabel = Boolean(itemData.label && g.style !== 'emoji');
        if (hasSeparateLabel) {
          card.appendChild(el('div', { className: 'metric-card-label', textContent: itemData.label }));
        }
        const displaySegments = hasSeparateLabel && Array.isArray(itemData.valueSegments)
          ? itemData.valueSegments
          : itemData.segments;
        const valEl = el('div', { className: 'metric-card-val' }, [
          renderColoredSegments(displaySegments, getCountdownIsoForKey(g.key, snap))
        ]);
        card.appendChild(valEl);

        // 若為進度條相關指標，附上原生平滑進度條
        let barPct = null;
        if (g.key.startsWith('quota-weekly')) barPct = snap.quotas.weekly.remainingPct;
        else if (g.key.startsWith('quota-argon')) barPct = snap.quotas.argon.remainingPct;
        else if (g.key === 'quota' || g.key === 'quota-bar' || g.key === 'quota+bar') barPct = snap.quotas.shortTerm.remainingPct;
        else if (g.key.startsWith('context-used') || g.key.startsWith('token-count')) barPct = snap.context.usedPct;

        if (barPct !== null) {
          const fillPct = Math.max(0, Math.min(100, barPct));
          const isUsage = g.key.startsWith('context-used') || g.key.startsWith('token-count');
          const colorPct = isUsage ? (100 - fillPct) : fillPct;
          const fill = el('div', { className: 'progress-fill' });
          fill.style.width = `${fillPct}%`;
          fill.style.background = getTierColor(colorPct);
          card.appendChild(el('div', { className: 'progress-track' }, [fill]));
        }

        rowGrid.appendChild(card);
      }
      container.appendChild(rowGrid);
    }
  }

  root.appendChild(container);

  // 可收合 tokenBreakdown 明細抽屜（含視覺堆疊條與 usage 摘要）
  const hasBreakdown = Array.isArray(snap.context?.tokenBreakdown) && snap.context.tokenBreakdown.length > 0;
  const hasUsage = Boolean(snap.context?.usage);
  if (hasBreakdown || hasUsage) {
    const palette = ['#57caff', '#5cdb6d', '#ffd427', '#ff7daf', '#a78bfa', '#fb923c'];
    const totalRef = snap.context.effectiveCeiling > 0 ? snap.context.effectiveCeiling : Math.max(1, snap.context.totalInput);
    const stackedBar = hasBreakdown ? el('div', { className: 'stacked-bar' }) : null;
    if (stackedBar) {
      snap.context.tokenBreakdown.forEach((g, idx) => {
        const w = Math.max(0, Math.min(100, (g.numTokens / totalRef) * 100));
        if (w <= 0) return;
        const seg = el('div', {
          className: 'stacked-seg',
          title: `${g.name}: ${g.numTokens.toLocaleString()}`
        });
        seg.style.width = `${w}%`;
        seg.style.background = palette[idx % palette.length];
        stackedBar.appendChild(seg);
      });
    }

    const usageEl = hasUsage
      ? el('div', {
          className: 'usage-summary-row',
          textContent: `${t.usageSummary}: ${t.usageInput} ${snap.context.usage.inputTokens.toLocaleString()} · ${t.usageOutput} ${snap.context.usage.outputTokens.toLocaleString()} · ${t.usageThinking} ${snap.context.usage.thinkingOutputTokens.toLocaleString()} · ${t.usageCache} ${snap.context.usage.cacheReadTokens.toLocaleString()}`
        })
      : null;

    const details = el('details', { className: 'breakdown-card' }, [
      el('summary', { textContent: `${t.tokenBreakdownTitle} (${snap.context.totalInput.toLocaleString()} / ${snap.context.effectiveCeiling.toLocaleString()})` }),
      stackedBar,
      ...(snap.context.tokenBreakdown || []).map((g, idx) => {
        const pct = snap.context.effectiveCeiling > 0
          ? Math.min(100, (g.numTokens / snap.context.effectiveCeiling) * 100).toFixed(1)
          : '0.0';
        const dot = el('span', { className: 'breakdown-dot' });
        dot.style.background = palette[idx % palette.length];
        return el('div', { style: 'display:flex;justify-content:space-between;margin-top:4px;' }, [
          el('span', {}, [dot, g.name]),
          el('span', { textContent: `${g.numTokens.toLocaleString()} (${pct}%)` })
        ]);
      }),
      usageEl
    ]);
    root.appendChild(details);
  }
}

function renderDrawerCategories(catsContainer, snap, t) {
  catsContainer.innerHTML = '';
  const usedIds = new Set(rowsToItems(state.editRows).filter(x => x !== 'n'));
  const q = state.searchQuery.trim().toLowerCase();

  for (const cat of snap.registry.categories) {
    const catName = cat.locales?.[state.editLang]?.name || cat.locales?.us?.name || cat.id;
    const catMetrics = snap.registry.metrics.filter(m => {
      if (m.category !== cat.id) return false;
      if (!q) return true;
      const desc = (m.descriptions?.[state.editLang] || m.descriptions?.us || '').toLowerCase();
      return m.id.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
    });
    if (catMetrics.length === 0) continue;

    catsContainer.appendChild(el('div', { className: 'metric-card-label', textContent: catName }));
    const grid = el('div', { className: 'cat-grid' });
    for (const m of catMetrics) {
      const desc = m.descriptions?.[state.editLang] || m.descriptions?.us || m.id;
      const active = usedIds.has(m.id);
      const itemWrap = el('div', { className: `drawer-item ${active ? 'is-active' : ''}` }, [
        el('span', {
          className: 'chip-handle',
          textContent: '⋮⋮',
          title: t.dragHandleTip,
          onPointerdown: (ev) => {
            if (ev.button === 0) {
              startDrag(ev, { from: 'drawer', id: m.id, label: `${m.emoji} ${desc}` });
            }
          }
        }),
        el('button', {
          className: 'btn btn-sm',
          textContent: `${m.emoji} ${desc}`,
          title: m.id,
          onClick: () => {
            if (active) {
              const nextRows = [];
              for (const r of state.editRows) {
                const had = r.length > 0;
                const filtered = r.filter(x => x !== m.id);
                if (!had || filtered.length > 0) {
                  nextRows.push(filtered);
                }
              }
              state.editRows = nextRows.length > 0 ? nextRows : [[]];
            } else {
              if (state.editRows.length === 0) state.editRows.push([]);
              state.editRows[state.editRows.length - 1].push(m.id);
            }
            render();
          }
        })
      ]);
      grid.appendChild(itemWrap);
    }
    catsContainer.appendChild(grid);
  }
}

function renderEditorDrawer(root, snap, t) {
  const drawer = el('div', { className: 'drawer-box' });
  drawer.appendChild(el('div', { className: 'metric-card-val', textContent: t.drawerTitle }));

  const catsContainer = el('div', { id: 'drawer-categories' });

  const controls = el('div', { className: 'topbar-group' }, [
    el('input', {
      className: 'input-ctrl',
      placeholder: t.searchPlaceholder,
      value: state.searchQuery,
      onInput: (e) => {
        state.searchQuery = e.target.value;
        renderDrawerCategories(catsContainer, snap, t);
      }
    }),
    el('span', { className: 'metric-card-label', textContent: t.presetsLabel }),
    el('button', {
      className: 'btn btn-sm',
      textContent: t.presetCore,
      onClick: () => {
        state.editRows = [
          ['model-name', 'quota', 'quota-bar', 'quota-reset-countdown'],
          ['context-used', 'context-used-bar', 'token-count'],
          ['git-branch', 'vcs-dirty', 'agent-state']
        ];
        render();
      }
    }),
    el('button', {
      className: 'btn btn-sm',
      textContent: t.presetFull,
      onClick: () => {
        const all = snap.registry.metrics.map(m => m.id);
        state.editRows = [all.slice(0, 8), all.slice(8, 18), all.slice(18, 28), all.slice(28)];
        render();
      }
    })
  ]);
  drawer.appendChild(controls);
  renderDrawerCategories(catsContainer, snap, t);
  drawer.appendChild(catsContainer);

  // 進階參數與舊版排序匯入/匯出
  const importInput = el('input', {
    className: 'input-ctrl',
    placeholder: t.importPlaceholder,
    style: 'flex:1;min-width:180px;'
  });

  const advRow = el('div', { className: 'topbar-group' }, [
    el('label', { className: 'metric-card-label', textContent: t.defaultStyleLabel }),
    el('select', {
      className: 'select-ctrl',
      value: state.editLabelStyle,
      onChange: (e) => { state.editLabelStyle = e.target.value; render(); }
    }, [
      el('option', { value: 'text', textContent: t.styleText }),
      el('option', { value: 'emoji', textContent: t.styleEmoji })
    ]),
    el('label', { className: 'metric-card-label', textContent: t.timeFormatLabel }),
    el('select', {
      className: 'select-ctrl',
      value: state.editTimeFormat,
      onChange: (e) => { state.editTimeFormat = e.target.value; }
    }, ['smart', 'full', '24h', '12h'].map(tf => el('option', { value: tf, textContent: tf }))),
    el('label', { className: 'metric-card-label', textContent: t.barLengthLabel }),
    el('input', {
      className: 'input-ctrl',
      type: 'number',
      min: '1',
      max: '50',
      style: 'width:64px;',
      value: String(state.editBarLength),
      onChange: (e) => { state.editBarLength = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 10)); }
    }),
    el('button', {
      className: 'btn btn-sm',
      textContent: t.resetFromCli,
      onClick: async () => {
        const res = await saveConfigAction('reset-from-cli');
        if (!res?.structuredContent?.ok) return;
        state.editMode = false;
        await callToolSafe('statusline_dashboard', { conversationId: snap.session?.conversationId || '', forceRefresh: true });
      }
    })
  ]);
  drawer.appendChild(advRow);

  const impExpRow = el('div', { className: 'topbar-group' }, [
    importInput,
    el('button', {
      className: 'btn btn-sm',
      textContent: t.importBtn,
      onClick: async () => {
        const res = await saveConfigAction('parse-order-expression', { orderExpression: importInput.value });
        const parsed = res?.structuredContent?.parsed;
        if (parsed?.items?.length) {
          state.editRows = itemsToRows(parsed.items);
          state.editItemStyles = { ...(parsed.itemStyles || {}) };
          render();
        }
      }
    }),
    el('button', {
      className: 'btn btn-sm',
      textContent: t.copyIdExpr,
      onClick: () => {
        const expr = computeDraftOrderExpressions(rowsToItems(state.editRows), state.editItemStyles, state.editLabelStyle, snap.registry.metrics);
        copyTextWithFallback(expr.idExpression, t);
      }
    }),
    el('button', {
      className: 'btn btn-sm',
      textContent: t.copyNumExpr,
      onClick: () => {
        const expr = computeDraftOrderExpressions(rowsToItems(state.editRows), state.editItemStyles, state.editLabelStyle, snap.registry.metrics);
        copyTextWithFallback(expr.numericExpression, t);
      }
    })
  ]);
  drawer.appendChild(impExpRow);
  root.appendChild(drawer);

  // 底部固定雙按鈕儲存列
  const saveBar = el('div', { className: 'sticky-save-bar' }, [
    el('label', { className: 'topbar-group', style: 'font-size:12px;' }, [
      el('input', {
        type: 'checkbox',
        checked: state.deployHooks,
        onChange: (e) => { state.deployHooks = e.target.checked; }
      }),
      el('span', { textContent: t.deployHooksCheck })
    ]),
    el('div', { className: 'topbar-group' }, [
      el('button', {
        className: 'btn',
        textContent: t.cancel,
        onClick: () => {
          state.editMode = false;
          syncEditDraftFromSnapshot(snap);
          render();
        }
      }),
      el('button', {
        className: 'btn',
        textContent: t.savePanelOnly,
        onClick: async () => {
          const res = await saveConfigAction('save-panel');
          if (!res?.structuredContent?.ok) return;
          state.editMode = false;
          showToast(t.savedPanelToast);
          await callToolSafe('statusline_dashboard', { conversationId: snap.session?.conversationId || '', forceRefresh: true });
        }
      }),
      el('button', {
        className: 'btn btn-primary',
        textContent: t.saveBoth,
        onClick: async () => {
          const res = await saveConfigAction('save-both', { deployHooks: state.deployHooks });
          if (!res?.structuredContent?.ok) return;
          state.editMode = false;
          const partial = res.structuredContent.cliSyncResult?.results?.some(r => !r.updated);
          showToast(partial ? t.cliSyncPartialWarn : t.savedBothToast);
          await callToolSafe('statusline_dashboard', { conversationId: snap.session?.conversationId || '', forceRefresh: true });
        }
      })
    ])
  ]);
  root.appendChild(saveBar);
}

function renderPrefsView(root, snap, t) {
  const prefsBox = el('div', { className: 'drawer-box' }, [
    el('div', { className: 'metric-card-val', textContent: t.prefsTitle }),
    el('label', { className: 'topbar-group' }, [
      el('input', {
        type: 'checkbox',
        checked: snap.panelPrefs.maskEmail,
        onChange: async (e) => {
          snap.panelPrefs.maskEmail = e.target.checked;
          await saveConfigAction('save-prefs');
          await callToolSafe('statusline_dashboard', { conversationId: snap.session?.conversationId || '' });
        }
      }),
      el('span', { textContent: t.maskEmailLabel })
    ]),
    el('div', { className: 'topbar-group' }, [
      el('span', { textContent: t.autoRefresh }),
      el('select', {
        className: 'select-ctrl',
        value: String(snap.panelPrefs.autoRefreshSec),
        onChange: async (e) => {
          snap.panelPrefs.autoRefreshSec = Number(e.target.value);
          await saveConfigAction('save-prefs');
          scheduleAutoRefresh();
          render();
        }
      }, [
        el('option', { value: '0', textContent: t.off }),
        el('option', { value: '5', textContent: '5s' }),
        el('option', { value: '15', textContent: '15s' }),
        el('option', { value: '30', textContent: '30s' })
      ]),
      el('button', {
        className: 'btn btn-sm',
        textContent: t.checkUpdateNow,
        onClick: () => callToolSafe('statusline_dashboard', {
          conversationId: snap.session?.conversationId || '',
          checkUpdate: true,
          forceRefresh: true
        })
      })
    ])
  ]);
  root.appendChild(prefsBox);

  const diagBox = el('div', { className: 'drawer-box' }, [
    el('div', { className: 'metric-card-val', textContent: t.diagTitle }),
    el('div', {
      textContent: `${t.diagLsStatus}: ${snap.telemetryStatus.lsConnected ? t.diagLsLive : `${t.diagLsFallback} (${snap.telemetryStatus.source})`}`
    }),
    el('div', {
      textContent: `${t.diagHookStatus}: ${snap.session.lastHookEvent || 'None'} ${snap.session.lastHookAt ? `@ ${snap.session.lastHookAt}` : ''}`
    }),
    el('div', {
      textContent: `${t.diagCliSync}: ${snap.hookSync.status} (Plugin v${snap.hookSync.pluginVersion || '?'} / Hook v${snap.hookSync.hookVersion || '?'})`
    })
  ]);
  root.appendChild(diagBox);
}

function render() {
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = '';

  const snap = state.snapshot;
  if (!snap) {
    root.appendChild(el('div', { className: 'metric-card-label', textContent: getUiStrings('zh-tw').loading }));
    return;
  }

  const activeLang = state.editMode ? state.editLang : snap.layout.lang;
  const t = getUiStrings(activeLang);

  // 頂部工具列
  const localeLabels = { 'zh-tw': '繁體中文', 'zh-cn': '简体中文', 'us': 'English', 'jp': '日本語' };
  const langSelect = el('select', {
    className: 'select-ctrl',
    value: activeLang,
    onChange: async (e) => {
      state.editLang = e.target.value;
      if (!state.editMode) {
        await saveConfigAction('save-panel');
        await callToolSafe('statusline_dashboard', { conversationId: snap.session?.conversationId || '', forceRefresh: true });
      } else {
        render();
      }
    }
  }, (snap.registry.supportedLocales || ['zh-tw', 'zh-cn', 'us', 'jp']).map(code =>
    el('option', { value: code, textContent: localeLabels[code] || code })
  ));

  const sessionSelect = el('select', {
    className: 'select-ctrl',
    value: snap.session?.conversationId || '',
    onChange: (e) => callToolSafe('statusline_dashboard', { conversationId: e.target.value, forceRefresh: true })
  }, (snap.sessions || []).map(s =>
    el('option', {
      value: s.conversationId,
      textContent: `${s.conversationId.slice(0, 8)} (${s.modelName || s.agentState || 'session'})`
    })
  ));

  const topbar = el('header', { className: 'topbar' }, [
    el('div', { className: 'topbar-group' }, [
      el('button', {
        className: `btn btn-sm ${state.tab === 'monitor' ? 'btn-active' : ''}`,
        textContent: t.tabMonitor,
        onClick: () => { state.tab = 'monitor'; render(); }
      }),
      el('button', {
        className: `btn btn-sm ${state.tab === 'prefs' ? 'btn-active' : ''}`,
        textContent: t.tabPrefs,
        onClick: () => { state.tab = 'prefs'; render(); }
      }),
      snap.sessions?.length ? sessionSelect : null
    ]),
    el('div', { className: 'topbar-group' }, [
      langSelect,
      state.tab === 'monitor'
        ? el('button', {
            className: 'btn btn-sm',
            textContent: snap.panelPrefs?.viewDensity === 'strip' ? t.densityCards : t.densityStrip,
            onClick: async () => {
              snap.panelPrefs.viewDensity = snap.panelPrefs.viewDensity === 'strip' ? 'cards' : 'strip';
              await saveConfigAction('save-prefs');
              render();
            }
          })
        : null,
      state.tab === 'monitor'
        ? el('button', {
            className: `btn btn-sm ${state.editMode ? 'btn-active' : ''}`,
            textContent: state.editMode ? t.doneEdit : `✏️ ${t.editLayout}`,
            onClick: () => {
              state.editMode = !state.editMode;
              if (state.editMode) syncEditDraftFromSnapshot(snap);
              render();
            }
          })
        : null,
      el('button', {
        className: 'btn btn-sm',
        textContent: `🔄 ${t.refresh}`,
        onClick: () => callToolSafe('statusline_dashboard', { conversationId: snap.session?.conversationId || '', forceRefresh: true })
      })
    ])
  ]);
  root.appendChild(topbar);

  if (state.tab === 'monitor') {
    renderMonitorView(root, snap, t);
  } else {
    renderPrefsView(root, snap, t);
  }
}

function startLocalCountdownTicker() {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(() => {
    if (document.hidden || state.editMode) return;
    document.querySelectorAll('[data-countdown-iso]').forEach((node) => {
      const iso = node.getAttribute('data-countdown-iso');
      if (iso) {
        const text = formatLiveCountdown(iso);
        if (text) node.textContent = text;
      }
    });
  }, 1000);
}

// 嚴格依循官方生命週期：先註冊全部 handler 再 connect()
app.ontoolinput = () => {};
app.ontoolresult = (result) => {
  if (result?.structuredContent?.layout) {
    state.snapshot = result.structuredContent;
    if (!state.editMode) syncEditDraftFromSnapshot(state.snapshot);
    scheduleAutoRefresh();
    render();
  }
};
app.ontoolcancelled = () => {};
app.onhostcontextchanged = (ctx) => {
  if (ctx?.theme) {
    applyDocumentTheme(ctx.theme);
    document.documentElement.dataset.theme = ctx.theme;
  }
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
};

async function boot() {
  try {
    await app.connect();
    const ctx = app.getHostContext();
    if (ctx?.theme) {
      applyDocumentTheme(ctx.theme);
      document.documentElement.dataset.theme = ctx.theme;
    }
    if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
    startLocalCountdownTicker();
    if (!state.snapshot) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 150);
        const check = () => {
          if (state.snapshot) {
            clearTimeout(timer);
            resolve();
          }
        };
        app.addEventListener?.('toolresult', check, { once: true });
      });
    }
    if (!state.snapshot) {
      await callToolSafe('statusline_dashboard', { hostLocale: ctx?.locale || '' });
      scheduleAutoRefresh();
    }
  } catch (err) {
    const root = document.getElementById('app');
    if (root) {
      root.textContent = `Statusline App failed to connect: ${err?.message || 'unknown error'}`;
    }
  }
}

render();
void boot();
