// The window of a scrolling pane: which of `count` rows a pane `height` rows tall shows. Pure
// arithmetic, shared by the store (which keeps `top`) and the views (which draw it), so the two
// can never disagree about what is on the screen.

/** `{ top, size, above, below }`: the first row shown, how many are shown, and how many are cut
 *  off on each side. When rows are cut off the pane's last row is given up to say so, hence
 *  `size` is one less than `height` then. `keep` is a row that must stay inside the window (the
 *  selection), or -1: `top` moves the least that keeps it there. */
export function windowOf({ top = 0, count, height, keep = -1 }) {
  if (height < 1 || count < 1) return { top: 0, size: 0, above: 0, below: Math.max(0, count) };
  if (count <= height) return { top: 0, size: count, above: 0, below: 0 };
  const size = Math.max(1, height - 1);
  let first = Math.min(Math.max(0, top), count - size);
  if (keep >= 0 && keep < count) {
    if (keep < first) first = keep;
    else if (keep >= first + size) first = keep - size + 1;
  }
  return { top: first, size, above: first, below: count - first - size };
}
