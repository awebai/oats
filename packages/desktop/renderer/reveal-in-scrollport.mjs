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

/** The horizontal counterpart for a tab strip: scroll only `strip` (its
 * scrollLeft) so `element` is fully inside it, by the smallest move, and the
 * element's start when it is wider than the strip. The strip's own
 * scroll-padding (left/right) is honoured, so a sticky control pinned to an
 * edge never covers what is revealed. Never element.scrollIntoView: Chromium
 * would also scroll every scrollable ancestor, overflow:hidden ones included,
 * shifting the whole workbench. */
export function revealInStrip(strip, element) {
  if (!strip?.contains(element) || !strip.clientWidth) return;
  const style = strip.ownerDocument?.defaultView?.getComputedStyle?.(strip);
  const inset = side => Math.max(0, parseFloat(style?.[side]) || 0);
  const edge = strip.getBoundingClientRect().left + strip.clientLeft;
  const left = edge + inset("scrollPaddingLeft"), right = edge + strip.clientWidth - inset("scrollPaddingRight");
  const item = element.getBoundingClientRect();
  if (![left, right, item.left, item.right].every(Number.isFinite)) return;
  const delta = item.left < left || item.right - item.left > right - left ? item.left - left : item.right > right ? item.right - right : 0;
  if (delta) strip.scrollLeft = Math.max(0, strip.scrollLeft + delta);
}
