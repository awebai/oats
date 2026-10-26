// The app's one resizer, `.split-resizer`: the handles between editor groups (updateSplitHandle) and the
// sidebar's right edge (sidebar-width.mjs) share its element, its drag and its keys.
//
// Resize adjacent editor groups without moving their terminals or attaching
// another viewer. Notify the model as well as updating DOM styles so sizes
// survive covering the split or switching workspaces.
const ON_RESIZE = Symbol("on-resize");

/** A focusable separator with the resizer's class: `orientation` is the layout it divides ("row": side by side,
 * so the handle is vertical and drags across). */
export function createResizeHandle(doc, { label, orientation }) {
  const handle = doc.createElement('div');
  handle.className = 'split-resizer'; handle.tabIndex = 0;
  handle.setAttribute('role', 'separator'); handle.setAttribute('aria-label', label);
  handle.dataset.orientation = orientation;
  handle.setAttribute('aria-orientation', orientation === 'row' ? 'vertical' : 'horizontal');
  return handle;
}

/**
 * Drag with pointer capture, the keys and a double-click reset, on a resizer handle.
 * `measure()` answers the handle's state now, or null when there is nothing to resize:
 *   { value, min, max, step, big?, reset, scale, row }  value in the handle's own units; scale converts a
 *   pointer move in px to them; big is Shift's step (default step); row: the pointer's x moves it, else y.
 * `resize(m, value)` applies a value, clamping it itself. ←/→ (↑/↓ across a column) step, Home and End go to
 * min and max, Enter and a double-click to reset.
 * @param {object} [opts]
 * @param {(fn: () => void) => void} [opts.frame]  schedules a drag's writes (requestAnimationFrame
 *        throttles them to frames); synchronous by default. The last one is written when the drag ends.
 * @param {() => void} [opts.onDragStart]
 * @param {() => void} [opts.onDragEnd]
 * @param {(m) => void} [opts.reset]  Enter's and the double-click's reset; by default resize(m, m.reset)
 * @param {() => void} [opts.onStep]  after a key's or a double-click's change
 */
export function wireResizer(handle, { measure, resize, reset = m => resize(m, m.reset), frame = fn => fn(), onDragStart = () => {}, onDragEnd = () => {}, onStep = () => {} }) {
  let drag = null, pending = null, scheduled = false;
  const flush = () => {
    if (!drag || pending === null) return;
    const value = pending; pending = null; resize(drag.m, value);
  };
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const m = measure(); if (!m) return;
    e.preventDefault(); handle.focus();
    drag = { m, start: m.row ? e.clientX : e.clientY, pointerId: e.pointerId };
    handle.setPointerCapture(e.pointerId);
    onDragStart();
  });
  handle.addEventListener('pointermove', e => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    pending = drag.m.value + ((drag.m.row ? e.clientX : e.clientY) - drag.start) * drag.m.scale;
    if (!scheduled) { scheduled = true; frame(() => { scheduled = false; flush(); }); }
  });
  const stop = () => { if (!drag) return; flush(); drag = null; onDragEnd(); };
  handle.addEventListener('pointerup', stop); handle.addEventListener('pointercancel', stop); handle.addEventListener('lostpointercapture', stop);
  handle.addEventListener('keydown', e => {
    const m = measure(); if (!m) return;
    const previous = m.row ? 'ArrowLeft' : 'ArrowUp', next = m.row ? 'ArrowRight' : 'ArrowDown';
    // Enter resets, the keyboard twin of the double-click (spec F).
    if (![previous, next, 'Home', 'End', 'Enter'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    const step = e.shiftKey ? m.big ?? m.step : m.step;
    if (e.key === 'Enter') reset(m);
    else resize(m, e.key === 'Home' ? m.min : e.key === 'End' ? m.max : m.value + (e.key === next ? step : -step));
    onStep();
  });
  handle.addEventListener('dblclick', () => { const m = measure(); if (m) { reset(m); onStep(); } });
}

export function updateSplitHandle(host, cell, orientation, hasNext, onResize) {
  let handle = cell.querySelector(':scope > .split-resizer');
  if (!hasNext) { handle?.remove(); return; }
  if (!handle) {
    handle = createResizeHandle(cell.ownerDocument, { label: 'Resize terminal groups', orientation });
    handle.setAttribute('aria-valuemin', '10'); handle.setAttribute('aria-valuemax', '90');
    cell.append(handle);
    const measure = () => {
      const next = cell.nextElementSibling;
      if (!next?.classList.contains('group-cell')) return null;
      const row = host.classList.contains('split-row');
      const a = cell.getBoundingClientRect(), b = next.getBoundingClientRect();
      const size = row ? a.width + b.width : a.height + b.height;
      if (!size) return null;
      return { next, row, size, value: (row ? a.width : a.height) / size, scale: 1 / size,
        min: .1, max: .9, step: .05, reset: .5,
        weight: (Number(cell.style.flexGrow) || 1) + (Number(next.style.flexGrow) || 1) };
    };
    const resize = (m, value) => {
      if (!host.contains(cell) || cell.nextElementSibling !== m.next) return;
      const ratio = Math.max(.1, Math.min(.9, value));
      cell.style.flexGrow = String(m.weight * ratio); m.next.style.flexGrow = String(m.weight * (1 - ratio));
      handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      handle[ON_RESIZE]?.([
        { id: Number(cell.dataset.group), weight: m.weight * ratio },
        { id: Number(m.next.dataset.group), weight: m.weight * (1 - ratio) },
      ]);
    };
    wireResizer(handle, { measure, resize });
  }
  handle[ON_RESIZE] = onResize;
  handle.dataset.orientation = orientation;
  handle.setAttribute('aria-orientation', orientation === 'row' ? 'vertical' : 'horizontal');
  const next = cell.nextElementSibling;
  const left = Number(cell.style.flexGrow) || 1, right = Number(next?.style.flexGrow) || 1;
  handle.setAttribute('aria-valuenow', String(Math.round(100 * left / (left + right))));
}
