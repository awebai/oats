// A dialog's return target is a logical control, not only a DOM node. Roster
// polling replaces nodes; keep its existing composite identity without ever
// interpolating data into a selector or retaining a picker as an opener.
export function captureFocusReturn(doc) {
  const original = doc.activeElement;
  const id = original?.id;
  const treeInstance = original?.dataset?.treeInstance;
  const treeControl = original?.dataset?.treeControl;
  // A roster row's tools (Start…, the actions menu) are shown only while their row has focus:
  // when one of them can't take focus back, its row can (spec F audit).
  const rowInstance = original?.closest?.('.ctx-tree-row')?.querySelector?.('.ctx-inst')?.dataset?.treeInstance;
  const ancestors = [];
  for (let node = original?.parentElement; node; node = node.parentElement) {
    if (node.id && !node.closest('.palette-overlay')) ancestors.push(node.id);
  }
  const eligible = el => {
    if (!el?.isConnected || el.disabled || el.closest('.palette-overlay')) return false;
    for (let node = el; node; node = node.parentElement) {
      if (node.hidden) return false;
      const style = doc.defaultView?.getComputedStyle(node);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  };
  /** `exact`: only the opener itself or a replacement with its identity (id, tree control, its row), never a
   * control found through an ancestor: a caller with a better fallback of its own (a retired row's successor)
   * tries this first. */
  const resolve = ({ exact = false } = {}) => {
    if (eligible(original)) return original;
    if (id) { const replacement = doc.getElementById(id); if (eligible(replacement)) return replacement; }
    if (treeInstance && treeControl) {
      const replacement = [...doc.querySelectorAll('[data-tree-instance][data-tree-control]')]
        .find(el => el.dataset.treeInstance === treeInstance && el.dataset.treeControl === treeControl && eligible(el));
      if (replacement) return replacement;
    }
    if (rowInstance) {
      const row = [...doc.querySelectorAll('.ctx-inst[data-tree-instance]')].find(el => el.dataset.treeInstance === rowInstance && eligible(el));
      if (row) return row;
    }
    if (exact) return null;
    for (const parentId of ancestors) {
      const replacement = [...(doc.getElementById(parentId)?.querySelectorAll('input, button, [tabindex="0"]') || [])].find(eligible);
      if (replacement) return replacement;
    }
    return null;
  };
  const restoreTo = target => { target?.focus?.(); return !!target && target === doc.activeElement; };
  return { resolve, restore: () => restoreTo(resolve()), restoreExact: () => restoreTo(resolve({ exact: true })) };
}

/** The row to take focus when `order[at]` has left the roster: the first one after it that is still in
 * `rows` (matched by `data-tree-instance`), else the nearest before it; null when none is. */
export function successorRow(rows, order, at) {
  if (!(at >= 0)) return null;
  const near = [...order.slice(at + 1), ...order.slice(0, at).reverse()];
  return near.map(id => rows.find(r => r.dataset.treeInstance === id)).find(Boolean) ?? null;
}
