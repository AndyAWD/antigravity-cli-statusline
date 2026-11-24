import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables
} from '@modelcontextprotocol/ext-apps';
import { formatResetTime } from '../../skills/agy-cli-statusline/scripts/lib/collectors/time-format.mjs';
import { formatOrderExpressions } from '../../skills/agy-cli-statusline/scripts/lib/metrics/layout-utils.mjs';
import { ANSI_HEX_PALETTE, getPercentageTier } from '../../skills/agy-cli-statusline/scripts/lib/renderers/ansi.mjs';
import {
  groupRowWithAdjacentMerges,
  isDashboardSnapshot,
  itemsToRows,
  moveBlockInRows,
  moveRowInRows,
  rowsEqual,
  rowsToItems
} from './drag-rows.js';
import { getUiStrings } from './i18n.js';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '2.1.1';
const app = new App({ name: 'Statusline', version: APP_VERSION }, {});
const MAX_UNDO_HISTORY = 30;

const state = {
  snapshot: null,
  pinnedConversationId: '',
  tab: 'monitor', // 'monitor' | 'prefs'
  editMode: false,
  editRows: [],
  editItemStyles: {},
  editLabelStyle: 'text',
  editTimeFormat: 'smart',
  editBarLength: 10,
  editLang: 'zh-tw',
  editHistory: [],
  suppressNextClick: false,
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

const TIER_CSS_VARS = {
  blue: 'var(--tier-blue)',
  green: 'var(--tier-green)',
  yellow: 'var(--tier-yellow)',
  red: 'var(--tier-red)'
};

const HEX_TO_THEME_VAR = {
  [ANSI_HEX_PALETTE.white]: 'var(--fg-1)',
  [ANSI_HEX_PALETTE.blue]: 'var(--tier-blue-fg)',
  [ANSI_HEX_PALETTE.green]: 'var(--tier-green-fg)',
  [ANSI_HEX_PALETTE.yellow]: 'var(--tier-yellow-fg)',
  [ANSI_HEX_PALETTE.red]: 'var(--tier-red-fg)',
  [ANSI_HEX_PALETTE.gray]: 'var(--fg-3)'
};

function getTierColor(pct) {
  return TIER_CSS_VARS[getPercentageTier(pct)];
}

function mapAnsiColorToThemeVar(hexColor) {
  if (!hexColor) return '';
  return HEX_TO_THEME_VAR[String(hexColor).toLowerCase()] || hexColor;
}

function getCountdownIsoForKey(key, snap) {
  if (!snap?.quotas) return '';
  if (key === 'quota-reset-countdown') return snap.quotas.shortTerm?.resetTime || '';
  if (key === 'quota-weekly-countdown') return snap.quotas.weekly?.resetTime || '';
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
    const syncedText = formatResetTime(countdownIso);
    if (syncedText) lastNonEmptySpan.textContent = syncedText;
  }
  return frag;
}

function cloneEditSnapshot() {
  return {
    editRows: state.editRows.map(r => [...r]),
    editItemStyles: { ...state.editItemStyles },
    editLabelStyle: state.editLabelStyle,
    editLang: state.editLang
  };
}

function pushEditUndoSnapshot() {
  state.editHistory.push(cloneEditSnapshot());
  if (state.editHistory.length > MAX_UNDO_HISTORY) {
    state.editHistory.shift();
  }
}

function undoEdit() {
  if (!state.editMode || state.editHistory.length === 0) return;
  const prev = state.editHistory.pop();
  state.editRows = prev.editRows;
  state.editItemStyles = prev.editItemStyles;
  state.editLabelStyle = prev.editLabelStyle;
  if (prev.editLang) state.editLang = prev.editLang;
  render();
}

function syncEditDraftFromSnapshot(snap) {
  state.editRows = itemsToRows(snap.layout.items);
  state.editItemStyles = { ...(snap.layout.itemStyles || {}) };
  state.editLabelStyle = snap.layout.labelStyle || 'text';
  state.editTimeFormat = snap.layout.timeFormat || 'smart';
  state.editBarLength = snap.layout.barLength || 10;
  state.editLang = snap.layout.lang || 'zh-tw';
  state.editHistory = [];
}

async function callToolSafe(name, args) {
  if (state.inFlight && name === 'statusline_dashboard' && !args?.forceRefresh) return null;
  if (name === 'statusline_dashboard') state.inFlight = true;
  try {
    const res = await app.callServerTool({ name, arguments: args });
    if (res?.isError) {
      const t = getUiStrings(state.editMode ? state.editLang : (state.snapshot?.layout?.lang || 'zh-tw'));
      const errMsg = res.content?.[0]?.text || t.saveErrorToast;
      showToast(errMsg);
      return null;
    }
    if (name === 'statusline_dashboard' && isDashboardSnapshot(res?.structuredContent)) {
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

function getDashboardArgs(extra = {}) {
  return state.pinnedConversationId
    ? { conversationId: state.pinnedConversationId, ...extra }
    : { ...extra };
}

function scheduleAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  const sec = state.snapshot?.panelPrefs?.autoRefreshSec || 0;
  if (sec > 0) {
    state.refreshTimer = setInterval(() => {
      if (document.hidden || state.editMode || state.inFlight) return;
      void callToolSafe('statusline_dashboard', getDashboardArgs());
    }, sec * 1000);
  }
}

function clearDropVisuals() {
  document.querySelectorAll('.drop-active, .drop-before, .drop-after').forEach((n) => {
    n.classList.remove('drop-active', 'drop-before', 'drop-after');
  });
}

function startDrag(ev, payload) {
  if (ev.button !== 0) return;

  const captureEl = ev.currentTarget;
  const pointerId = ev.pointerId;
  const startX = ev.clientX;
  const startY = ev.clientY;
  let lastClientX = startX;
  let lastClientY = startY;
  let draggingStarted = false;
  let ghost = null;
  let currentDropTarget = null;
  let scrollRafId = null;
  const containerEl = document.querySelector('.rows-container');

  const isEffectiveBlockDrop = (candidate) => !rowsEqual(moveBlockInRows(state.editRows, payload, candidate), state.editRows);

  const updateHitTarget = (clientX, clientY) => {
    clearDropVisuals();
    currentDropTarget = null;

    const hit = document.elementFromPoint(clientX, clientY);
    if (!hit) return;

    if (payload.dragKind === 'block') {
      const chipEl = hit.closest('[data-drop-kind="chip"]');
      if (chipEl) {
        if (payload.sourceEl && chipEl === payload.sourceEl) return;
        const rowIdx = parseInt(chipEl.getAttribute('data-row') || '0', 10);
        const colIdx = parseInt(chipEl.getAttribute('data-col') || '0', 10);
        const rect = chipEl.getBoundingClientRect();
        const position = clientX < (rect.left + rect.width / 2) ? 'before' : 'after';
        const candidate = { kind: 'chip', rowIdx, colIdx, position };
        if (isEffectiveBlockDrop(candidate)) {
          chipEl.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
          currentDropTarget = candidate;
        }
        return;
      }

      const betweenEl = hit.closest('[data-drop-kind="between-rows"]:not(.drop-slot-between-tail):not(.drop-slot-noop)');
      if (betweenEl) {
        const candidate = {
          kind: 'between-rows',
          rowIdx: parseInt(betweenEl.getAttribute('data-row') || '0', 10)
        };
        if (isEffectiveBlockDrop(candidate)) {
          betweenEl.classList.add('drop-active');
          currentDropTarget = candidate;
        }
        return;
      }

      const newRowEl = hit.closest('[data-drop-kind="new-row"]');
      if (newRowEl) {
        const candidate = { kind: 'new-row' };
        if (isEffectiveBlockDrop(candidate)) {
          newRowEl.classList.add('drop-active');
          currentDropTarget = candidate;
        }
        return;
      }

      const rowEl = hit.closest('[data-drop-kind="row"]');
      if (rowEl) {
        const candidate = {
          kind: 'row',
          rowIdx: parseInt(rowEl.getAttribute('data-row') || '0', 10)
        };
        if (isEffectiveBlockDrop(candidate)) {
          rowEl.classList.add('drop-active');
          currentDropTarget = candidate;
        }
      }
      return;
    }

    if (payload.dragKind === 'row') {
      let insertRowIdx = null;
      const betweenEl = hit.closest('[data-drop-kind="between-rows"]');
      if (betweenEl) {
        insertRowIdx = parseInt(betweenEl.getAttribute('data-row') || '0', 10);
      } else {
        const rowEl = hit.closest('[data-drop-kind="row"]');
        if (rowEl) {
          const rIdx = parseInt(rowEl.getAttribute('data-row') || '0', 10);
          const rect = rowEl.getBoundingClientRect();
          insertRowIdx = clientY < (rect.top + rect.height / 2) ? rIdx : rIdx + 1;
        }
      }

      if (
        insertRowIdx !== null &&
        insertRowIdx !== payload.rowIdx &&
        insertRowIdx !== payload.rowIdx + 1
      ) {
        const targetSlot = document.querySelector(
          `[data-drop-kind="between-rows"][data-row="${insertRowIdx}"]`
        );
        if (targetSlot) targetSlot.classList.add('drop-active');
        currentDropTarget = { kind: 'row-slot', insertRowIdx };
      }
    }
  };

  const tickAutoScroll = () => {
    if (!draggingStarted) return;
    const EDGE_THRESHOLD = 56;
    const SCROLL_SPEED = 10;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    let deltaY = 0;

    if (lastClientY < EDGE_THRESHOLD) {
      const ratio = Math.max(0.2, (EDGE_THRESHOLD - lastClientY) / EDGE_THRESHOLD);
      deltaY = -Math.ceil(SCROLL_SPEED * ratio);
    } else if (vh > 0 && lastClientY > vh - EDGE_THRESHOLD) {
      const ratio = Math.max(0.2, (lastClientY - (vh - EDGE_THRESHOLD)) / EDGE_THRESHOLD);
      deltaY = Math.ceil(SCROLL_SPEED * ratio);
    }

    if (deltaY !== 0) {
      window.scrollBy(0, deltaY);
      updateHitTarget(lastClientX, lastClientY);
    }
    scrollRafId = window.requestAnimationFrame(tickAutoScroll);
  };

  const beginDragSession = (moveEv) => {
    draggingStarted = true;
    window.getSelection?.()?.removeAllRanges?.();
    if (captureEl && captureEl.setPointerCapture) {
      try { captureEl.setPointerCapture(pointerId); } catch (_) {}
    }

    if (
      payload.dragKind === 'row' ||
      (payload.dragKind === 'block' && payload.from === 'row' && (state.editRows[payload.rowIdx]?.length || 0) <= 1)
    ) {
      document.querySelector(
        `[data-drop-kind="between-rows"][data-row="${payload.rowIdx}"]`
      )?.classList.add('drop-slot-noop');
      document.querySelector(
        `[data-drop-kind="between-rows"][data-row="${payload.rowIdx + 1}"]`
      )?.classList.add('drop-slot-noop');
    }

    ghost = el('div', { className: 'drag-ghost', textContent: payload.label });
    ghost.style.left = `${moveEv.clientX + 12}px`;
    ghost.style.top = `${moveEv.clientY + 12}px`;
    document.body.appendChild(ghost);

    payload.sourceEl?.classList.add(payload.dragKind === 'row' ? 'row-dragging' : 'chip-dragging');
    containerEl?.classList.add(payload.dragKind === 'row' ? 'is-dragging-row' : 'is-dragging-block');
    state.dragState = { ...payload, ghost };
    scrollRafId = window.requestAnimationFrame(tickAutoScroll);
  };

  const onMove = (moveEv) => {
    lastClientX = moveEv.clientX;
    lastClientY = moveEv.clientY;

    if (!draggingStarted) {
      if (Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) < 4) {
        return;
      }
      beginDragSession(moveEv);
    }

    if (ghost) {
      ghost.style.left = `${moveEv.clientX + 12}px`;
      ghost.style.top = `${moveEv.clientY + 12}px`;
    }
    updateHitTarget(moveEv.clientX, moveEv.clientY);
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('keydown', onKeyDown);
    if (captureEl && captureEl.releasePointerCapture) {
      try {
        if (!captureEl.hasPointerCapture || captureEl.hasPointerCapture(pointerId)) {
          captureEl.releasePointerCapture(pointerId);
        }
      } catch (_) {}
    }
    if (scrollRafId !== null) {
      window.cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }
    clearDropVisuals();
    document.querySelectorAll('.drop-slot-noop').forEach((n) => n.classList.remove('drop-slot-noop'));
    payload.sourceEl?.classList.remove('chip-dragging', 'row-dragging');
    containerEl?.classList.remove('is-dragging-block', 'is-dragging-row');
    if (ghost) ghost.remove();
    state.dragState = null;
  };

  const onUp = (upEv) => {
    const wasDragging = draggingStarted;
    if (wasDragging) {
      updateHitTarget(upEv.clientX, upEv.clientY);
    }
    const dropToApply = currentDropTarget;
    cleanup();

    if (wasDragging) {
      state.suppressNextClick = true;
      setTimeout(() => { state.suppressNextClick = false; }, 50);
      if (dropToApply) {
        applyDrop(payload, dropToApply);
      }
    }
  };

  const onCancel = () => cleanup();
  const onBlur = () => cleanup();
  const onKeyDown = (kEv) => {
    if (kEv.key === 'Escape') cleanup();
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp, { once: true });
  window.addEventListener('pointercancel', onCancel, { once: true });
  window.addEventListener('blur', onBlur, { once: true });
  window.addEventListener('keydown', onKeyDown);
}

function applyDrop(payload, dropTarget) {
  let nextRows;
  if (payload.dragKind === 'row' && dropTarget.kind === 'row-slot') {
    nextRows = moveRowInRows(state.editRows, payload.rowIdx, dropTarget.insertRowIdx);
  } else if (payload.dragKind === 'block') {
    nextRows = moveBlockInRows(state.editRows, payload, dropTarget);
  } else {
    return;
  }

  if (rowsEqual(nextRows, state.editRows)) return;
  pushEditUndoSnapshot();
  state.editRows = nextRows;
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

  const container = el('div', {
    className: state.editMode ? 'rows-container is-edit-mode' : 'rows-container'
  });

  if (state.editMode) {
    container.appendChild(el('div', { className: 'edit-guide-bar' }, [
      el('span', { className: 'edit-guide-text', textContent: t.editGuide }),
      el('button', {
        className: 'btn btn-sm',
        textContent: `↶ ${t.undo}`,
        disabled: state.editHistory.length === 0 ? 'disabled' : null,
        onClick: () => undoEdit()
      })
    ]));

    rows.forEach((row, rIdx) => {
      container.appendChild(el('div', {
        className: 'drop-slot-between',
        'data-drop-kind': 'between-rows',
        'data-row': String(rIdx)
      }, [
        el('span', { className: 'drop-label-block', textContent: t.dropBetweenRows }),
        el('span', { className: 'drop-label-row', textContent: t.dropRowHere })
      ]));

      const rowBox = el('div', {
        className: 'edit-row-box',
        'data-drop-kind': 'row',
        'data-row': String(rIdx)
      });

      const rowDragHandle = el('div', {
        className: 'edit-row-drag-handle',
        title: t.dragRowTip,
        onPointerdown: (ev) => {
          if (ev.button !== 0) return;
          if (ev.target?.closest?.('button, input, select, textarea, a, label')) return;
          startDrag(ev, {
            dragKind: 'row',
            rowIdx: rIdx,
            sourceEl: rowBox,
            label: t.rowLabel.replace('{n}', String(rIdx + 1))
          });
        }
      }, [
        el('span', { className: 'chip-handle', textContent: '⋮⋮' }),
        el('span', { className: 'edit-row-title', textContent: t.rowLabel.replace('{n}', String(rIdx + 1)) }),
        el('span', { className: 'edit-row-count', textContent: t.rowItemCount.replace('{count}', String(row.length)) })
      ]);

      const header = el('div', { className: 'edit-row-header' }, [
        rowDragHandle,
        el('div', { className: 'topbar-group' }, [
          rIdx > 0
            ? el('button', {
                className: 'btn btn-sm',
                textContent: t.mergeUp,
                onClick: () => {
                  pushEditUndoSnapshot();
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
                className: 'chip-remove-btn',
                textContent: '×',
                title: t.removeRow,
                onClick: () => {
                  pushEditUndoSnapshot();
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
          const isBarMetric = snap.registry.adjacentPairs.some(p => p.bar === id);
          const sameLangAsSnap = state.editLang === snap.layout?.lang;
          let shortTitle;
          if (sameLangAsSnap && renderedInfo?.label) {
            shortTitle = isBarMetric ? `${renderedInfo.label} ${t.barSuffix}` : renderedInfo.label;
          } else {
            shortTitle = metricDef?.descriptions?.[state.editLang] || metricDef?.descriptions?.us || id;
          }
          const liveVal = renderedInfo?.valueText || renderedInfo?.plainText || '';

          const chip = el('div', {
            className: 'chip',
            'data-drop-kind': 'chip',
            'data-row': String(rIdx),
            'data-col': String(cIdx),
            title: liveVal ? `${id} · ${liveVal}` : id
          });

          chip.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            if (ev.target?.closest?.('button, input, select, textarea, a, label')) return;
            startDrag(ev, {
              dragKind: 'block',
              from: 'row',
              id,
              rowIdx: rIdx,
              colIdx: cIdx,
              sourceEl: chip,
              label: `${emoji} ${shortTitle}`
            });
          });

          chip.appendChild(el('span', { className: 'chip-handle', textContent: '⋮⋮' }));
          chip.appendChild(el('span', { className: 'chip-title', textContent: `${emoji} ${shortTitle}` }));
          chip.appendChild(el('span', { className: 'style-seg' }, [
            el('button', {
              className: `style-seg-btn ${effectiveStyle === 'text' ? 'is-active' : ''}`,
              textContent: t.styleTextShort,
              title: t.styleSwitchToText,
              onClick: () => {
                if (effectiveStyle === 'text') return;
                pushEditUndoSnapshot();
                state.editItemStyles[id] = 'text';
                render();
              }
            }),
            el('button', {
              className: `style-seg-btn ${effectiveStyle === 'emoji' ? 'is-active' : ''}`,
              textContent: '😊',
              title: t.styleSwitchToEmoji,
              onClick: () => {
                if (effectiveStyle === 'emoji') return;
                pushEditUndoSnapshot();
                state.editItemStyles[id] = 'emoji';
                render();
              }
            })
          ]));
          chip.appendChild(el('button', {
            className: 'chip-remove-btn',
            textContent: '×',
            title: t.removeBlock,
            onClick: () => {
              pushEditUndoSnapshot();
              state.editRows[rIdx].splice(cIdx, 1);
              if (state.editRows[rIdx].length === 0 && state.editRows.length > 1) {
                state.editRows.splice(rIdx, 1);
              }
              render();
            }
          }));

          chipsWrap.appendChild(chip);
          if (isPaired) {
            chipsWrap.appendChild(el('span', {
              className: 'chip-merge-link',
              textContent: '🔗',
              title: t.mergePairTip
            }));
          }
        });
      }

      rowBox.appendChild(header);
      rowBox.appendChild(chipsWrap);
      container.appendChild(rowBox);
    });

    container.appendChild(el('div', {
      className: 'drop-slot-between drop-slot-between-tail',
      'data-drop-kind': 'between-rows',
      'data-row': String(rows.length)
    }, [
      el('span', { className: 'drop-label-row', textContent: t.dropRowHere })
    ]));

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
          pushEditUndoSnapshot();
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
      const stripFlow = el('div', { className: 'strip-flow' });
      for (const g of groups) {
        const itemData = snap.renderedItems?.[g.style]?.[g.key] || snap.renderedItems?.text?.[g.key];
        if (!itemData?.segments?.length || !itemData.plainText) continue;
        const isMultiline = itemData.plainText.includes('\n');
        const contentEl = el('span', { className: 'strip-item-content' }, [
          renderColoredSegments(itemData.segments, getCountdownIsoForKey(g.key, snap))
        ]);
        const itemEl = el('span', {
          className: isMultiline ? 'strip-item strip-item-multiline' : 'strip-item'
        }, [contentEl]);
        stripFlow.appendChild(itemEl);
      }
      if (stripFlow.childNodes.length > 0) {
        const strip = el('div', { className: 'strip-row' }, [
          el('div', { className: 'strip-flow-clip' }, [stripFlow])
        ]);
        container.appendChild(strip);
      }
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
        else if (g.key === 'quota' || g.key === 'quota-bar' || g.key === 'quota+bar') barPct = snap.quotas.shortTerm.remainingPct;
        else if (g.key.startsWith('context-used')) barPct = snap.context.usedPct;
        else if (g.key.startsWith('token-count')) barPct = snap.context.tokenPct ?? snap.context.usedPct;

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
      const toggleMetric = () => {
        pushEditUndoSnapshot();
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
      };

      const itemWrap = el('div', {
        className: `drawer-item ${active ? 'is-active' : ''}`,
        role: 'button',
        tabindex: '0',
        title: `${m.id} · ${t.dragHandleTip}`,
        onPointerdown: (ev) => {
          if (ev.button !== 0) return;
          startDrag(ev, {
            dragKind: 'block',
            from: 'drawer',
            id: m.id,
            sourceEl: itemWrap,
            label: `${m.emoji} ${desc}`
          });
        },
        onClick: () => {
          if (state.suppressNextClick) {
            state.suppressNextClick = false;
            return;
          }
          toggleMetric();
        },
        onKeydown: (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            toggleMetric();
          }
        }
      }, [
        el('span', { className: 'chip-handle', textContent: '⋮⋮' }),
        el('span', { className: 'drawer-item-label', textContent: `${m.emoji} ${desc}` }),
        el('span', { className: 'drawer-item-badge', textContent: active ? '✓' : '＋' })
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
        pushEditUndoSnapshot();
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
        pushEditUndoSnapshot();
        const all = snap.registry.metrics.map(m => m.id);
        state.editRows = [all.slice(0, 8), all.slice(8, 18), all.slice(18, 28), all.slice(28)];
        render();
      }
    })
  ]);
  drawer.appendChild(controls);
  renderDrawerCategories(catsContainer, snap, t);
  drawer.appendChild(catsContainer);

  // 進階參數與舊版排序匯入/匯出（預設收合以保持排版聚焦）
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
      onChange: (e) => {
        pushEditUndoSnapshot();
        state.editLabelStyle = e.target.value;
        render();
      }
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
        state.editHistory = [];
        const dashRes = await callToolSafe('statusline_dashboard', getDashboardArgs({ forceRefresh: true }));
        if (!dashRes) render();
      }
    })
  ]);

  const impExpRow = el('div', { className: 'topbar-group' }, [
    importInput,
    el('button', {
      className: 'btn btn-sm',
      textContent: t.importBtn,
      onClick: async () => {
        const res = await saveConfigAction('parse-order-expression', { orderExpression: importInput.value });
        const parsed = res?.structuredContent?.parsed;
        if (parsed?.items?.length) {
          pushEditUndoSnapshot();
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
        const expr = formatOrderExpressions(rowsToItems(state.editRows), state.editItemStyles, state.editLabelStyle, snap.registry.metrics.map(m => m.id));
        copyTextWithFallback(expr.idExpression, t);
      }
    }),
    el('button', {
      className: 'btn btn-sm',
      textContent: t.copyNumExpr,
      onClick: () => {
        const expr = formatOrderExpressions(rowsToItems(state.editRows), state.editItemStyles, state.editLabelStyle, snap.registry.metrics.map(m => m.id));
        copyTextWithFallback(expr.numericExpression, t);
      }
    })
  ]);

  const advDetails = el('details', { className: 'adv-details' }, [
    el('summary', { textContent: t.advancedSectionTitle }),
    advRow,
    impExpRow
  ]);
  drawer.appendChild(advDetails);
  root.appendChild(drawer);

  // 底部固定雙按鈕儲存列（偵測到過舊 CLI 掛鉤時顯示自動更新提示，無需手動勾選）
  const hookSync = snap.hookSync;
  let hookHintText = '';
  if (hookSync?.needsAutoUpdate) {
    const targetVer = hookSync.pluginVersion || APP_VERSION;
    if (hookSync.hookVersion && hookSync.hookVersion !== targetVer) {
      hookHintText = t.autoUpdateHooksHint
        .replace('{from}', hookSync.hookVersion)
        .replace('{to}', targetVer);
    } else {
      hookHintText = t.autoUpdateHooksHintNoPrev.replace('{to}', targetVer);
    }
  }

  const saveBar = el('div', { className: 'sticky-save-bar' }, [
    hookHintText
      ? el('span', { className: 'hook-auto-hint', textContent: `🔄 ${hookHintText}` })
      : null,
    el('div', { className: 'topbar-group save-bar-actions' }, [
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
          state.editHistory = [];
          showToast(t.savedPanelToast);
          const dashRes = await callToolSafe('statusline_dashboard', getDashboardArgs({ forceRefresh: true }));
          if (!dashRes) render();
        }
      }),
      el('button', {
        className: 'btn btn-primary',
        textContent: t.saveBoth,
        onClick: async () => {
          const res = await saveConfigAction('save-both');
          if (!res?.structuredContent?.ok) return;
          state.editMode = false;
          state.editHistory = [];
          const syncRes = res.structuredContent.cliSyncResult;
          const partial = syncRes?.results?.some(r => !r.updated);
          const toastMsg = partial
            ? t.cliSyncPartialWarn
            : (syncRes?.hooksAutoUpdated ? t.savedBothAndHooksToast : t.savedBothToast);
          showToast(toastMsg);
          const dashRes = await callToolSafe('statusline_dashboard', getDashboardArgs({ forceRefresh: true }));
          if (!dashRes) render();
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
          await callToolSafe('statusline_dashboard', getDashboardArgs());
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
        onClick: () => callToolSafe('statusline_dashboard', getDashboardArgs({
          checkUpdate: true,
          forceRefresh: true
        }))
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
      const nextLang = e.target.value;
      if (!state.editMode) {
        state.editLang = nextLang;
        await saveConfigAction('save-panel');
        await callToolSafe('statusline_dashboard', getDashboardArgs({ forceRefresh: true }));
      } else {
        if (nextLang !== state.editLang) {
          pushEditUndoSnapshot();
          state.editLang = nextLang;
        }
        render();
      }
    }
  }, (snap.registry.supportedLocales || ['zh-tw', 'zh-cn', 'us', 'jp']).map(code =>
    el('option', { value: code, textContent: localeLabels[code] || code })
  ));

  const activeConvId = snap.session?.conversationId || '';
  const autoOptionLabel = activeConvId
    ? `${t.autoFollowSession} (${activeConvId.slice(0, 8)})`
    : t.autoFollowSession;
  const sessionList = snap.sessions || [];
  const hasPinnedInList = !state.pinnedConversationId || sessionList.some(s => s.conversationId === state.pinnedConversationId);
  const effectiveSelectValue = hasPinnedInList ? (state.pinnedConversationId || '') : '';
  const sessionSelect = el('select', {
    className: 'select-ctrl',
    value: effectiveSelectValue,
    onChange: (e) => {
      state.pinnedConversationId = e.target.value || '';
      void callToolSafe('statusline_dashboard', getDashboardArgs({ forceRefresh: true }));
    }
  }, [
    el('option', { value: '', textContent: autoOptionLabel }),
    ...sessionList.map(s =>
      el('option', {
        value: s.conversationId,
        textContent: `${s.conversationId.slice(0, 8)} (${s.modelName || s.agentState || 'session'})`
      })
    )
  ]);

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
      state.tab === 'monitor' && !state.editMode
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
        ? (state.editMode
            ? el('span', { className: 'edit-mode-pill', textContent: `✏️ ${t.editingBadge}` })
            : el('button', {
                className: 'btn btn-sm',
                textContent: `✏️ ${t.editLayout}`,
                onClick: () => {
                  state.editMode = true;
                  syncEditDraftFromSnapshot(snap);
                  render();
                }
              }))
        : null,
      el('button', {
        className: 'btn btn-sm',
        textContent: `🔄 ${t.refresh}`,
        onClick: () => callToolSafe('statusline_dashboard', getDashboardArgs({ forceRefresh: true }))
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
  const updateCountdowns = () => {
    if (document.hidden || state.editMode) return;
    document.querySelectorAll('[data-countdown-iso]').forEach((node) => {
      const iso = node.getAttribute('data-countdown-iso');
      if (iso) {
        const text = formatResetTime(iso);
        if (text) node.textContent = text;
      }
    });
  };
  state.countdownTimer = setInterval(updateCountdowns, 1000);
  if (typeof document !== 'undefined' && !state._visibilityBound) {
    state._visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !state.editMode) {
        updateCountdowns();
        if (!state.inFlight && (state.snapshot?.panelPrefs?.autoRefreshSec || 0) > 0) {
          void callToolSafe('statusline_dashboard', getDashboardArgs());
        }
      }
    });
  }
}

// 嚴格依循官方生命週期：先註冊全部 handler 再 connect()
app.ontoolinput = () => {};
app.ontoolresult = (result) => {
  if (isDashboardSnapshot(result?.structuredContent)) {
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

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (ev) => {
    if (!state.editMode || state.tab !== 'monitor') return;
    const tag = ev.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && String(ev.key || '').toLowerCase() === 'z') {
      if (state.editHistory.length > 0) {
        ev.preventDefault();
        undoEdit();
      }
    }
  });
}

render();
void boot();
