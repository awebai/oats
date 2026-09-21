/** Shell-owned contextual surface. No IO, instance lookup, or lifecycle actions. */
export const contextPanelCSS = `
#context-panel.context-panel { display:flex; flex:0 0 340px; width:340px; min-width:0; min-height:0; flex-direction:column; box-sizing:border-box; overflow:hidden; border-left:1px solid var(--border); background:var(--surface); color:var(--fg); font:13px/1.45 -apple-system,"Segoe UI",system-ui,sans-serif; }
#context-panel.context-panel[hidden], #context-panel [hidden] { display:none !important; }
#context-panel.context-panel.is-collapsed { flex-basis:34px; width:34px; }
#context-panel .context-panel-header { display:flex; align-items:center; flex:none; height:48px; box-sizing:border-box; border-bottom:1px solid var(--border); padding:0 6px; gap:4px; }
#context-panel .context-panel-tabs { display:flex; flex:1; min-width:0; height:100%; align-items:center; gap:2px; }
#context-panel .context-panel-control { font:inherit; color:var(--muted); background:var(--surface); border:0; border-radius:4px; cursor:pointer; padding:6px; }
#context-panel .context-panel-tab { font-size:12px; white-space:nowrap; min-height:32px; }
#context-panel .context-panel-tab[aria-selected="true"] { color:var(--accent); background:var(--sel); }
#context-panel .context-panel-control:hover { background:var(--surface-2); color:var(--fg); }
#context-panel .context-panel-control:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
#context-panel .context-panel-rail { display:flex; flex-direction:column; align-items:center; flex:1; min-height:0; }
#context-panel .context-panel-expand { width:32px; min-height:48px; padding:0; }
#context-panel .context-panel-generic, #context-panel .context-panel-stages { display:flex; flex:1; min-height:0; min-width:0; flex-direction:column; overflow:hidden; }
#context-panel .context-panel-page { flex:1; min-height:0; overflow:auto; padding:16px; box-sizing:border-box; overflow-wrap:anywhere; }
#context-panel .context-panel-page h2 { font-size:14px; margin:0 0 12px; }
#context-panel .context-panel-note { color:var(--muted); }
#context-panel .context-panel-facts { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.6fr); gap:10px; margin:0; }
#context-panel .context-panel-facts dt { color:var(--muted); }
#context-panel .context-panel-facts dd { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
#context-panel .context-panel-stage.oats-view { display:flex; flex:1; flex-direction:column; width:100%; min-width:0; min-height:0; overflow:auto; background:var(--surface); }
#context-panel .context-panel-stage > * { max-width:100%; box-sizing:border-box; }
`;

const noop = () => {};
const inertLease = () => ({ setPresent: noop, isVisible: () => false, collapse: noop, dispose: noop });
const inertPanel = () => ({
  setContext: noop, attach: inertLease, release: noop, toggle: noop, setCollapsed: noop,
  setFocusMode: noop, toggleFocusMode: noop, isFocusMode: () => false, dispose: noop,
});
const reported = value => typeof value === 'string' && value.length ? value
  : typeof value === 'number' && Number.isFinite(value) ? String(value)
    : typeof value === 'boolean' ? String(value) : 'Not reported';

/**
 * setContext is the ONLY foreground selector; attach never selects an owner.
 * workspace and key are exact, opaque identities supplied by the shell.
 * An attached slot starts present. setPresent only changes that slot's presence,
 * never the current context or the user's collapse preference.
 *
 * Leases are bound to the workspace generation in which attach was called.
 * Workspace changes clear presence synchronously, retaining the real DOM. To
 * reuse a retained stage on a later visit, attach(owner, sameElement) renews its
 * lease without rebuilding it. Old callbacks (including A → B → A completions)
 * cannot revive presence or dispose the renewed lease. Callers must guard their
 * own asynchronous content writes; this module owns visibility, not their forms.
 */
export function createContextPanel({
  document: suppliedDocument, root: suppliedRoot, onIntent = noop,
  applyFocus = callback => callback(), onFocusModeChange = noop,
} = {}) {
  const document = suppliedDocument ?? suppliedRoot?.ownerDocument ?? globalThis.document;
  const root = suppliedRoot ?? document?.getElementById('context-panel');
  if (!document || !root) return inertPanel();

  let disposed = false, focusMode = false, applyingFocus = false, epoch = 0;
  let context = { workspace: null, owner: null, instance: null, key: null };
  const preferences = new Map(); // Only chrome preferences, never selection.
  const slots = new Map();
  const app = document.getElementById('app');
  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const control = (className, text, label, click) => {
    const el = node('button', `context-panel-control ${className}`, text);
    el.type = 'button'; el.setAttribute('aria-label', label); el.title = label;
    el.addEventListener('click', click);
    return el;
  };
  const pref = () => {
    if (!preferences.has(context.workspace)) preferences.set(context.workspace, { collapsed: false, tab: 'instance' });
    return preferences.get(context.workspace);
  };
  const visible = el => {
    if (!el?.isConnected || el.disabled) return false;
    for (let current = el; current; current = current.parentElement) {
      if (current.hidden || current.inert) return false;
      const style = document.defaultView?.getComputedStyle(current);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  };
  const focus = el => {
    if (!visible(el)) return;
    const previous = applyingFocus; applyingFocus = true;
    try { applyFocus(() => el.focus({ preventScroll: true })); }
    finally { applyingFocus = previous; }
  };
  const rail = node('div', 'context-panel-rail');
  const expand = control('context-panel-expand', '‹', 'Expand context panel', () => setCollapsed(false));
  expand.setAttribute('aria-expanded', 'false'); expand.setAttribute('aria-controls', 'context-panel');
  rail.append(expand);
  const generic = node('div', 'context-panel-generic');
  const header = node('div', 'context-panel-header');
  const tablist = node('div', 'context-panel-tabs');
  tablist.setAttribute('role', 'tablist'); tablist.setAttribute('aria-label', 'Instance context');
  const collapse = control('context-panel-collapse', '›', 'Collapse context panel', () => setCollapsed(true));
  collapse.setAttribute('aria-expanded', 'true'); collapse.setAttribute('aria-controls', 'context-panel');
  header.append(tablist, collapse); generic.append(header);
  const tabs = new Map(), pages = new Map();
  for (const [id, label] of [['instance', 'Instance'], ['git', 'Git & GitHub'], ['soul', 'Soul']]) {
    const tab = control('context-panel-tab', label, label, () => selectTab(id));
    tab.id = `context-panel-tab-${id}`; tab.dataset.contextTab = id;
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `context-panel-page-${id}`);
    tab.addEventListener('keydown', event => {
      const ids = [...tabs.keys()], index = ids.indexOf(id);
      const next = event.key === 'ArrowRight' ? (index + 1) % ids.length
        : event.key === 'ArrowLeft' ? (index + ids.length - 1) % ids.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : null;
      if (next === null || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault(); selectTab(ids[next]); focus(tabs.get(ids[next]));
    });
    tabs.set(id, tab); tablist.append(tab);
    const page = node('section', 'context-panel-page');
    page.id = `context-panel-page-${id}`; page.dataset.contextPage = id;
    page.setAttribute('role', 'tabpanel'); page.setAttribute('aria-labelledby', tab.id); page.tabIndex = 0;
    pages.set(id, page); generic.append(page);
  }
  const fields = new Map();
  function facts(pageId, entries) {
    const dl = node('dl', 'context-panel-facts');
    for (const [id, label] of entries) {
      const value = node('dd', null, 'Not reported'); value.dataset.contextField = id;
      fields.set(id, value); dl.append(node('dt', null, label), value);
    }
    pages.get(pageId).append(dl);
  }
  pages.get('instance').append(node('h2', null, 'Reported instance'));
  facts('instance', [['instance', 'Instance'], ['running', 'Session'], ['runtime', 'Runtime'], ['model', 'Model'],
    ['home', 'Home'], ['work', 'Work mode'], ['repo', 'Repository'], ['createdAt', 'Created'],
    ['parentInstance', 'Parent'], ['siblingInstance', 'Sibling'], ['team', 'Team']]);
  pages.get('soul').append(node('h2', null, 'Reported soul'), node('p', 'context-panel-note',
    'Metadata reported by this instance. Soul defaults, instructions, and capability configuration are not inspected or changed here.'));
  facts('soul', [['agent', 'Soul'], ['description', 'Description'], ['agentsRoot', 'Agents root']]);
  pages.get('git').append(node('h2', null, 'Git & GitHub'), node('p', 'context-panel-note',
    'Integration unavailable. Exact-instance Git inspection is pending the K1 contract. GitHub integration is not connected. No changes, diffs, pull requests, or checks are reported here.'));
  const stages = node('div', 'context-panel-stages');
  root.classList.add('context-panel');
  if (!root.hasAttribute('aria-label')) root.setAttribute('aria-label', 'Context panel');
  root.append(rail, generic, stages);

  const currentSlot = () => context.owner == null ? null : slots.get(context.owner);
  const slotPresent = slot => !!slot && slot.epoch === epoch && slot.present;
  const hasGeneric = () => context.owner == null && (context.instance != null || context.key != null);
  const hasContent = () => context.owner != null ? slotPresent(currentSlot()) : hasGeneric();
  function render() {
    const present = !disposed && hasContent(), collapsed = pref().collapsed;
    const expanded = present && !focusMode && !collapsed;
    root.hidden = !present || focusMode;
    root.classList.toggle('is-collapsed', collapsed);
    rail.hidden = !present || !collapsed || focusMode;
    generic.hidden = !expanded || !hasGeneric();
    stages.hidden = !expanded || context.owner == null;
    for (const slot of slots.values()) slot.wrapper.hidden = !expanded || slot !== currentSlot() || !slotPresent(slot);
    for (const [id, tab] of tabs) {
      const selected = pref().tab === id;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      pages.get(id).hidden = !selected;
    }
    const toggle = document.getElementById('panel-toggle');
    if (toggle) {
      toggle.disabled = !present || focusMode;
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-controls', 'context-panel');
    }
    const mode = document.getElementById('focus-mode-toggle');
    if (mode) {
      mode.setAttribute('aria-pressed', String(focusMode));
      const text = focusMode ? 'Exit focus mode' : 'Focus mode';
      if (mode.textContent !== text) mode.textContent = text;
      mode.setAttribute('aria-label', text);
    }
  }
  // Restore only when this projection hides/removes the focused container.
  // Never focus a newly selected instance or form during background polling.
  function project(change, changed = noop) {
    if (disposed) return;
    const active = document.activeElement;
    const inside = root.contains(active);
    const inSidebar = document.getElementById('sidebar')?.contains(active)
      || document.getElementById('sidebar-restore')?.contains(active);
    const wasFocusMode = focusMode;
    change(); render(); changed();
    if ((inside && !visible(active)) || (inSidebar && !wasFocusMode && focusMode)) {
      focus(visible(expand) ? expand : document.getElementById('focus-mode-toggle'));
    }
  }
  function projectMetadata() {
    const instance = context.instance ?? {};
    for (const [id, el] of fields) {
      const value = id === 'running' ? instance.running === true ? 'Running'
        : instance.running === false ? 'Stopped' : 'Not reported' : reported(instance[id]);
      if (el.textContent !== value) el.textContent = value;
    }
  }
  function selectTab(id) {
    if (!tabs.has(id)) return;
    project(() => { pref().tab = id; });
  }
  function setCollapsed(value) { project(() => { pref().collapsed = !!value; }); }
  function setFocusMode(value) {
    const next = !!value;
    if (disposed || next === focusMode) return;
    project(() => { focusMode = next; app?.classList.toggle('focus-mode', next); }, () => onFocusModeChange(next));
  }
  const entry = event => {
    if (!disposed && !applyingFocus && !root.hidden && visible(event.target)) onIntent(event);
  };
  root.addEventListener('pointerdown', entry); root.addEventListener('focusin', entry);
  render();
  return {
    setContext({ workspace = null, owner = null, instance = null, key = null } = {}) {
      project(() => {
        if (workspace !== context.workspace) {
          epoch++;
          for (const slot of slots.values()) slot.present = false;
        }
        context = { workspace, owner, instance, key };
        projectMetadata();
      });
    },
    attach(owner, element) {
      if (disposed || owner == null || !element || element.nodeType !== 1 || element === root || element.contains(root)) return inertLease();
      let slot;
      project(() => {
        // The same DOM cannot have two live owners. Moving it invalidates the
        // former lease just as replacing the element for one owner does.
        for (const [other, existing] of slots) {
          if (other !== owner && existing.element === element) { existing.wrapper.remove(); slots.delete(other); }
        }
        const previous = slots.get(owner);
        const wrapper = previous?.wrapper ?? node('div', 'context-panel-stage oats-view');
        if (previous?.element !== element) wrapper.replaceChildren(element);
        if (!wrapper.parentNode) stages.append(wrapper);
        slot = { element, wrapper, epoch, present: true };
        slots.set(owner, slot);
      });
      const owns = () => !disposed && slots.get(owner) === slot;
      const current = () => owns() && slot.epoch === epoch;
      return {
        setPresent(value) { if (current()) project(() => { slot.present = !!value; }); },
        isVisible: () => current() && currentSlot() === slot && slot.present && !root.hidden && !pref().collapsed,
        collapse() { if (current() && currentSlot() === slot && slot.present) setCollapsed(true); },
        dispose() {
          if (owns()) project(() => { slots.delete(owner); slot.wrapper.remove(); });
        },
      };
    },
    release(owner) {
      const slot = slots.get(owner);
      if (slot) project(() => { slots.delete(owner); slot.wrapper.remove(); });
    },
    toggle() { if (!disposed && hasContent() && !focusMode) setCollapsed(!pref().collapsed); },
    setCollapsed,
    setFocusMode,
    toggleFocusMode() { setFocusMode(!focusMode); },
    isFocusMode: () => focusMode,
    dispose() {
      if (disposed) return;
      project(() => {
        const changed = focusMode;
        focusMode = false; app?.classList.remove('focus-mode');
        for (const slot of slots.values()) slot.wrapper.remove();
        slots.clear(); context = { workspace: null, owner: null, instance: null, key: null };
        rail.remove(); generic.remove(); stages.remove();
        if (changed) onFocusModeChange(false);
      });
      disposed = true; preferences.clear();
      root.removeEventListener('pointerdown', entry); root.removeEventListener('focusin', entry);
    },
  };
}
