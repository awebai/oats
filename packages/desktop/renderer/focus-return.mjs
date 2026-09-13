// A dialog's return target is a logical control, not only a DOM node. Roster
// polling replaces nodes; keep its existing composite identity without ever
// interpolating data into a selector or retaining a picker as an opener.
export function captureFocusReturn(doc) {
  const original = doc.activeElement;
  const id = original?.id;
  const treeInstance = original?.dataset?.treeInstance;
  const treeControl = original?.dataset?.treeControl;
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
  const resolve = () => {
    if (eligible(original)) return original;
    if (id) { const replacement = doc.getElementById(id); if (eligible(replacement)) return replacement; }
    if (treeInstance && treeControl) {
      const replacement = [...doc.querySelectorAll('[data-tree-instance][data-tree-control]')]
        .find(el => el.dataset.treeInstance === treeInstance && el.dataset.treeControl === treeControl && eligible(el));
      if (replacement) return replacement;
    }
    for (const parentId of ancestors) {
      const replacement = [...(doc.getElementById(parentId)?.querySelectorAll('input, button, [tabindex="0"]') || [])].find(eligible);
      if (replacement) return replacement;
    }
    return null;
  };
  return { resolve, restore: () => { const target = resolve(); target?.focus?.(); return target === doc.activeElement; } };
}
