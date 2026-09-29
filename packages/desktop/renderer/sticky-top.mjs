/* Workspace sticky tops (spec G). A tab's top-level controls (Capabilities' section pills and
   search, the Teams page head) carry .ws-sticky and pin to the top of their scroller with
   position:sticky (discoveryCSS). Chromium insets a sticky box by the scroller's padding, so the
   block pins at top: -padding (flush with the scrollport, nothing shows above it) and keeps its own
   inner padding. Two facts need JS and nothing else:
   - .is-stuck, only while content has scrolled under the block: its 1px --border bottom edge (the
     border is always there, transparent at rest, so the block never changes height);
   - --ws-sticky-h on the scroller: the pinned block's height, which the jump and focus targets use
     as scroll-margin-top so a section head or a focused row never lands under the block.
   A block already outside its scroller (the Souls bar, the tab row) only needs the edge: see
   trackScrolledEdge. */

/** The visible sticky block of `scroller` (the first .ws-sticky that is rendered), or null. */
function stickyBlock(scroller) {
  for (const el of scroller.querySelectorAll('.ws-sticky')) if (!el.closest('[hidden]')) return el;
  return null;
}

/** Keep the sticky block's edge and the scroller's --ws-sticky-h in step with scrolling, resizes and
 * re-renders (call sync() after a render). */
export function trackStickyTop(scroller) {
  let last = null;
  const sync = () => {
    const block = stickyBlock(scroller);
    for (const other of scroller.querySelectorAll('.ws-sticky.is-stuck')) if (other !== block) other.classList.remove('is-stuck');
    if (!block) return;
    // Pinned = the block sits at the scrollport's top edge although the scroller has moved.
    const top = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top - (scroller.clientTop || 0);
    block.classList.toggle('is-stuck', scroller.scrollTop > 0 && top <= 0.5);
    const height = `${Math.round(block.getBoundingClientRect().height)}px`;
    if (height !== '0px' && height !== last) { last = height; scroller.style.setProperty('--ws-sticky-h', height); }
  };
  scroller.addEventListener('scroll', sync, { passive: true });
  const view = scroller.ownerDocument.defaultView;
  const resize = view?.ResizeObserver ? new view.ResizeObserver(sync) : null;
  resize?.observe(scroller);
  return {
    sync() { sync(); const block = stickyBlock(scroller); if (block && resize) resize.observe(block); },
    dispose() { scroller.removeEventListener('scroll', sync); resize?.disconnect(); },
  };
}

/** A scroller whose pinned header sits outside it: .is-scrolled (its top edge) while scrolled. */
export function trackScrolledEdge(scroller) {
  const sync = () => scroller.classList.toggle('is-scrolled', scroller.scrollTop > 0);
  scroller.addEventListener('scroll', sync, { passive: true });
  sync();
  return { sync, dispose() { scroller.removeEventListener('scroll', sync); } };
}
