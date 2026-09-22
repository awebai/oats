/** Reveal only inside the owning vertical scrollport, never the document or
 * another editor/panel. Callers retain focus and lifetime ownership. */
export function revealInScrollport(container, element, header = null) {
  if (!container?.contains(element) || !container.clientHeight) return;
  const port = container.getBoundingClientRect(), item = element.getBoundingClientRect();
  const edge = port.top + container.clientTop, bottom = edge + container.clientHeight;
  const top = header ? Math.max(edge, header.getBoundingClientRect().bottom) : edge;
  if (![top, bottom, item.top, item.bottom].every(Number.isFinite) || bottom <= top) return;
  const delta = item.top < top || item.bottom - item.top > bottom - top ? item.top - top : item.bottom > bottom ? item.bottom - bottom : 0;
  if (delta) container.scrollTop = Math.max(0, container.scrollTop + delta);
}
