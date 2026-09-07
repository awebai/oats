// Resize adjacent editor groups without moving their terminals or attaching
// another viewer. Group DOM nodes retain their sizes across focus changes.
export function updateSplitHandle(host, cell, orientation, hasNext) {
  let handle = cell.querySelector(':scope > .split-resizer');
  if (!hasNext) { handle?.remove(); return; }
  if (!handle) {
    handle = cell.ownerDocument.createElement('div');
    handle.className = 'split-resizer'; handle.tabIndex = 0;
    handle.setAttribute('role', 'separator'); handle.setAttribute('aria-label', 'Resize terminal groups');
    handle.setAttribute('aria-valuemin', '10'); handle.setAttribute('aria-valuemax', '90');
    cell.append(handle);
    let drag;
    const measure = () => {
      const next = cell.nextElementSibling;
      if (!next?.classList.contains('group-cell')) return null;
      const row = host.classList.contains('split-row');
      const a = cell.getBoundingClientRect(), b = next.getBoundingClientRect();
      const size = row ? a.width + b.width : a.height + b.height;
      if (!size) return null;
      return { next, row, size, initial: (row ? a.width : a.height) / size,
        weight: (Number(cell.style.flexGrow) || 1) + (Number(next.style.flexGrow) || 1) };
    };
    const resize = (m, value) => {
      const ratio = Math.max(.1, Math.min(.9, value));
      cell.style.flexGrow = String(m.weight * ratio); m.next.style.flexGrow = String(m.weight * (1 - ratio));
      handle.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    };
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const m = measure(); if (!m) return;
      e.preventDefault(); handle.focus();
      drag = { ...m, start: m.row ? e.clientX : e.clientY, pointerId: e.pointerId };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
      if (!drag || drag.pointerId !== e.pointerId) return;
      resize(drag, drag.initial + ((drag.row ? e.clientX : e.clientY) - drag.start) / drag.size);
    });
    const stop = () => { drag = null; };
    handle.addEventListener('pointerup', stop); handle.addEventListener('pointercancel', stop); handle.addEventListener('lostpointercapture', stop);
    handle.addEventListener('keydown', e => {
      const m = measure(); if (!m) return;
      const previous = m.row ? 'ArrowLeft' : 'ArrowUp', next = m.row ? 'ArrowRight' : 'ArrowDown';
      if (![previous, next, 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      resize(m, e.key === 'Home' ? .1 : e.key === 'End' ? .9 : m.initial + (e.key === next ? .05 : -.05));
    });
    handle.addEventListener('dblclick', () => { const m = measure(); if (m) resize(m, .5); });
  }
  handle.dataset.orientation = orientation;
  handle.setAttribute('aria-orientation', orientation === 'row' ? 'vertical' : 'horizontal');
  const next = cell.nextElementSibling;
  const left = Number(cell.style.flexGrow) || 1, right = Number(next?.style.flexGrow) || 1;
  handle.setAttribute('aria-valuenow', String(Math.round(100 * left / (left + right))));
}
