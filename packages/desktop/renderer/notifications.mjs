/** Renderer feedback, not OS notifications or inferred activity. Actions are
 * explicit inert descriptors with owned renderer callbacks, never commands.
 *
 * notify(message, options) → a handle { dismiss(), shown } when posted, false when refused.
 * options (all optional):
 *   descriptor + activate  the Open action (an inert open-instance descriptor, spawnOpenDescriptor);
 *   buttons  [{ label, ariaLabel?, activate(owns) }]  more owned callbacks, same ownership as Open;
 *   detail   technical text behind a "Details" disclosure;
 *   sticky   never evicted by capacity (the 3-entry bound holds non-sticky entries only);
 *   onDismiss  called once when the operator dismisses it with its × (never on clear, eviction or dispose);
 *   group + groupLabel(n)  more than 3 sticky entries of one group collapse into one grouped entry
 *            that expands to its members, so the center stays bounded. */
import { spawnOpenDescriptor } from './instance-action-target.mjs';
import { revealInScrollport } from './reveal-in-scrollport.mjs';
import { iconElement } from './shell-icons.mjs';
let centers = 0;
export const notificationCSS = `
.app-notifications { position:fixed; right:16px; bottom:42px; width:min(340px,calc(100vw - 32px)); max-height:calc(100vh - 58px); overflow-y:auto; box-sizing:border-box; padding:3px; z-index:80; pointer-events:none; }
.app-notifications ol { list-style:none; display:grid; gap:10px; margin:0; padding:0; }
.app-toast { display:flex; flex-wrap:wrap; align-items:flex-start; gap:10px; padding:10px 12px; border-radius:9px; background:var(--primary-bg); color:var(--primary-fg); box-shadow:var(--shadow-popover); pointer-events:auto; font:12.5px/1.5 var(--sans,system-ui); }
.app-toast-text { min-width:0; flex:1; max-height:160px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; }
.app-toast-dismiss { flex:none; min-width:26px; min-height:26px; border:1px solid var(--primary-fg); border-radius:5px; padding:0 4px; background:var(--primary-bg); color:var(--primary-fg); font:inherit; cursor:pointer; }
.app-toast-open, .app-toast-action { flex:none; padding:4px 6px; border:1px solid var(--primary-fg); border-radius:5px; background:var(--primary-bg); color:var(--primary-fg); font:inherit; cursor:pointer; }
.app-toast-open:disabled, .app-toast-action:disabled { cursor:default; }
/* A second line under the message: owned action buttons, then the Details text (same inverted pair). */
.app-toast-actions { flex-basis:100%; display:flex; flex-wrap:wrap; gap:6px; }
.app-toast-detail { flex-basis:100%; margin:0; max-height:120px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font-size:11.5px; color:var(--primary-fg); }
.app-toast-detail[hidden], .app-toast-group-list[hidden] { display:none; }
/* A grouped entry: its members inline when expanded, each framed in the toast's own ink. */
.app-toast-group-list { flex-basis:100%; list-style:none; display:grid; gap:8px; margin:0; padding:0; }
.app-toast-group-list .app-toast { box-shadow:none; border:1px solid var(--primary-fg); }
.app-toast-action-status { display:block; font-size:11px; }
/* Keyboard focus in the toast's own inverted palette (control rule 2): a button inverts its pair, so the
   text stays on an AA surface, and the 1px --primary-fg edge sits 1px outside it, on the toast's
   --primary-bg (inset it would lie on the inverted --primary-fg fill, 1:1). */
.app-toast :focus-visible { outline:1px solid var(--primary-fg); outline-offset:1px; }
.app-toast button:focus-visible { background:var(--primary-fg); color:var(--primary-bg); }
`;
export function createNotificationCenter({ document: doc, generation = () => 0, subscribe = () => () => {},
  applyFocus = fn => fn(), onIntent = () => {}, fallbackFocus = () => null,
  workspace = () => '', connectionGeneration = () => 0, subscribeConnections = () => () => {} } = {}) {
  const namespace = `oats-notification-${++centers}`;
  const root = doc.createElement('section'); root.className = 'app-notifications'; root.setAttribute('aria-label', 'Notifications');
  const list = doc.createElement('ol'); list.setAttribute('aria-live', 'polite'); list.setAttribute('aria-relevant', 'additions'); list.setAttribute('aria-atomic', 'false');
  root.append(list); doc.body.append(root);
  let alive = true, scope = generation(), serial = 0, actionSerial = 0, projecting = false, returnTo = null;
  const entries = [];
  // Grouped sticky entries: group name → { element, label, toggle, list, expanded }.
  const groups = new Map();
  const GROUP_AT = 3;
  const visible = el => {
    if (!el?.isConnected || el.disabled) return false;
    for (let node = el; node; node = node.parentElement) {
      const css = doc.defaultView?.getComputedStyle(node);
      if (node.hidden || node.inert || css?.display === 'none' || css?.visibility === 'hidden') return false;
    }
    return true;
  };
  const focus = el => {
    if (!visible(el)) return;
    projecting = true;
    try { applyFocus(() => el.focus({ preventScroll: true })); } finally { projecting = false; }
    revealInScrollport(root, el);
  };
  function clear() {
    actionSerial++; for (const entry of entries) entry.gone = true;
    entries.length = 0; groups.clear(); list.replaceChildren(); returnTo = null; scope = generation();
  }
  /** Keep `parent`'s children in `order`, moving only what must move (a moved node loses focus). */
  function reconcile(parent, order) {
    for (const child of [...parent.children]) if (!order.includes(child)) child.remove();
    let at = parent.firstElementChild;
    for (const el of order) { if (el === at) at = at.nextElementSibling; else parent.insertBefore(el, at); }
  }
  function groupFor(name, labelOf) {
    let g = groups.get(name);
    if (g) return g;
    const element = doc.createElement('li'); element.className = 'app-toast app-toast-group';
    const label = doc.createElement('div'); label.className = 'app-toast-text'; label.id = `${namespace}-${++serial}`; label.tabIndex = 0;
    const toggle = doc.createElement('button'); toggle.type = 'button'; toggle.className = 'app-toast-action app-toast-group-toggle';
    const members = doc.createElement('ol'); members.className = 'app-toast-group-list'; members.id = `${namespace}-${++serial}`; members.hidden = true;
    toggle.setAttribute('aria-controls', members.id); toggle.setAttribute('aria-describedby', label.id);
    g = { element, label, toggle, list: members, expanded: false, labelOf };
    const paint = () => { toggle.textContent = g.expanded ? 'Hide' : 'Show'; toggle.setAttribute('aria-expanded', String(g.expanded)); members.hidden = !g.expanded; };
    toggle.addEventListener('click', () => { if (!alive || groups.get(name) !== g || !visible(toggle)) return; g.expanded = !g.expanded; paint(); });
    paint(); element.append(label, toggle, members); groups.set(name, g);
    return g;
  }
  /** Place every entry: in arrival order, a group of more than GROUP_AT sticky entries as one grouped
   * entry where its first member was. Focus inside a moved card is put back; inside a card that a
   * collapsed group now hides, it moves to that group's toggle. */
  function layout() {
    const focused = root.contains(doc.activeElement) ? doc.activeElement : null;
    const counts = new Map();
    for (const e of entries) if (e.sticky && e.group) counts.set(e.group, (counts.get(e.group) || 0) + 1);
    const order = [], members = new Map();
    for (const e of entries) {
      if (!(e.sticky && e.group && counts.get(e.group) > GROUP_AT)) { order.push(e.element); continue; }
      const g = groupFor(e.group, e.groupLabel);
      if (!members.has(e.group)) { members.set(e.group, []); order.push(g.element); }
      members.get(e.group).push(e.element);
    }
    for (const [name, g] of groups) if (!members.has(name)) { g.element.remove(); groups.delete(name); }
    for (const [name, items] of members) {
      const g = groups.get(name), text = (() => { try { return String(g.labelOf?.(items.length) ?? ''); } catch { return ''; } })();
      g.label.textContent = text.trim() || `${items.length} notifications`;
      reconcile(g.list, items);
    }
    reconcile(list, order);
    if (focused && doc.activeElement !== focused) {
      const g = [...groups.values()].find(x => x.list.contains(focused));
      focus(visible(focused) ? focused : g?.toggle);
    }
  }
  /** The next visible dismiss control after a removal at `at`, else the last one before it. */
  const nextDismiss = at => [...entries.slice(at), ...entries.slice(0, at).reverse()].map(e => e.dismiss).find(visible)
    || [...groups.values()].map(g => g.toggle).find(visible);
  function dismiss(entry) {
    const at = entries.indexOf(entry);
    if (!alive || at < 0 || scope !== generation() || !visible(entry.element)) return;
    const focused = entry.element.contains(doc.activeElement);
    entries.splice(at, 1); entry.gone = true; entry.element.remove(); layout();
    if (focused) focus(nextDismiss(at) || (returnTo?.scope === scope && visible(returnTo.element) ? returnTo.element : fallbackFocus()));
    if (!entries.length) returnTo = null;
    try { entry.onDismiss?.(); } catch { /* the operator's dismissal stands */ }
  }
  /** A caller's own removal (its handle): no onDismiss, no focus projection unless focus was inside. */
  function withdraw(entry) {
    const at = entries.indexOf(entry);
    if (at < 0) return;
    const focused = entry.element.contains(doc.activeElement);
    entries.splice(at, 1); entry.gone = true; entry.element.remove(); layout();
    if (focused) focus(nextDismiss(at) || fallbackFocus());
    if (!entries.length) returnTo = null;
  }
  const entryIntent = event => {
    if (!alive || projecting || scope !== generation() || !visible(event.target)) return;
    if (event.type === 'focusin' && !root.contains(event.relatedTarget)) returnTo = {
      element: event.relatedTarget === doc.body || event.relatedTarget === doc.documentElement ? null : event.relatedTarget, scope,
    };
    onIntent(event);
  };
  root.addEventListener('pointerdown', entryIntent); root.addEventListener('focusin', entryIntent);
  const unsubscribe = subscribe(() => { if (alive) clear(); });
  const offConnection = subscribeConnections(() => { if (alive) clear(); });
  return {
    notify(message, action = null) {
      if (!alive || typeof message !== 'string' || !message.trim()) return false;
      if (scope !== generation()) clear();
      const sticky = action?.sticky === true;
      // Explicit dismissal, not an accessibility-hostile expiry clock. Capacity
      // eviction skips the focused card and sticky cards; reset/disposal still revoke old scopes.
      const transient = entries.filter(entry => !entry.sticky);
      if (!sticky && transient.length === 3) {
        const old = transient.find(entry => !entry.element.contains(doc.activeElement));
        if (!old) return false;
        entries.splice(entries.indexOf(old), 1); old.gone = true; old.element.remove();
      }
      const element = doc.createElement('li'); element.className = 'app-toast';
      const text = doc.createElement('div'); text.className = 'app-toast-text'; text.id = `${namespace}-${++serial}`;
      text.textContent = message; text.tabIndex = 0;
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'app-toast-dismiss'; button.append(iconElement(doc, 'close', { size: 14 }));
      button.setAttribute('aria-label', 'Dismiss notification'); button.setAttribute('aria-describedby', text.id);
      const record = { element, dismiss: button, sticky, gone: false,
        group: sticky && typeof action?.group === 'string' && action.group ? action.group : null,
        groupLabel: typeof action?.groupLabel === 'function' ? action.groupLabel : null,
        onDismiss: typeof action?.onDismiss === 'function' ? action.onDismiss : null };
      button.addEventListener('click', () => dismiss(record));
      element.append(text);
      const descriptor = typeof action?.activate === 'function' ? spawnOpenDescriptor(action.descriptor) : null;
      if (descriptor && descriptor.target.workspace === workspace() && descriptor.connectionEpoch === connectionGeneration()) {
        const open = doc.createElement('button'); open.type = 'button'; open.className = 'app-toast-open'; open.textContent = 'Open';
        open.setAttribute('aria-label', `Open ${descriptor.target.instance}`);
        const feedback = doc.createElement('span'); feedback.className = 'app-toast-action-status'; feedback.setAttribute('role', 'status');
        const birthScope = scope, activate = action.activate;
        const eligible = () => alive && scope === birthScope && scope === generation() && entries.includes(record) && visible(element)
          && descriptor.target.workspace === workspace() && descriptor.connectionEpoch === connectionGeneration();
        open.addEventListener('click', async () => {
          if (open.disabled || !eligible()) return;
          const token = ++actionSerial;
          const owns = () => token === actionSerial && eligible();
          open.disabled = true; feedback.textContent = '';
          try { await activate(structuredClone(descriptor), owns); }
          catch { if (owns()) feedback.textContent = 'Could not open this instance. Use its current roster entry.'; }
          finally { if (owns()) open.disabled = false; }
        });
        text.append(feedback); element.append(open);
      }
      element.append(button);
      // Owned action buttons (never commands), ruled like Open: the entry's birth scope, still listed and visible.
      const buttons = Array.isArray(action?.buttons) ? action.buttons.filter(b => b && typeof b.activate === 'function' && typeof b.label === 'string' && b.label.trim()) : [];
      const detail = typeof action?.detail === 'string' && action.detail.trim() ? action.detail : null;
      if (buttons.length || detail) {
        const row = doc.createElement('div'); row.className = 'app-toast-actions';
        let feedback = null;
        const birthScope = scope;
        const eligible = () => alive && scope === birthScope && scope === generation() && entries.includes(record) && visible(element);
        for (const spec of buttons) {
          const b = doc.createElement('button'); b.type = 'button'; b.className = 'app-toast-action'; b.textContent = spec.label;
          if (typeof spec.ariaLabel === 'string' && spec.ariaLabel.trim()) b.setAttribute('aria-label', spec.ariaLabel);
          const activate = spec.activate;
          b.addEventListener('click', async () => {
            if (b.disabled || !eligible()) return;
            const token = ++actionSerial;
            const owns = () => token === actionSerial && eligible();
            b.disabled = true; if (feedback) feedback.textContent = '';
            try { await activate(owns); }
            catch {
              if (!owns()) return;
              if (!feedback) { feedback = doc.createElement('span'); feedback.className = 'app-toast-action-status'; feedback.setAttribute('role', 'status'); text.append(feedback); }
              feedback.textContent = `${spec.label} did not complete. Try again.`;
            } finally { if (owns()) b.disabled = false; }
          });
          row.append(b);
        }
        if (detail) {
          const panel = doc.createElement('pre'); panel.className = 'app-toast-detail'; panel.id = `${namespace}-${++serial}`; panel.hidden = true; panel.textContent = detail;
          const toggle = doc.createElement('button'); toggle.type = 'button'; toggle.className = 'app-toast-action app-toast-details';
          toggle.setAttribute('aria-controls', panel.id); toggle.setAttribute('aria-describedby', text.id);
          const paint = () => { toggle.textContent = panel.hidden ? 'Details' : 'Hide details'; toggle.setAttribute('aria-expanded', String(!panel.hidden)); };
          toggle.addEventListener('click', () => { if (!eligible()) return; panel.hidden = !panel.hidden; paint(); });
          paint(); row.append(toggle); element.append(row, panel);
        } else element.append(row);
      }
      entries.push(record); layout();
      // Arrival can change stack geometry, but never the focused element.
      revealInScrollport(root, doc.activeElement);
      return {
        dismiss() { if (alive) withdraw(record); },
        get shown() { return alive && !record.gone && entries.includes(record); },
      };
    },
    clear() { if (alive) clear(); },
    dispose() {
      if (!alive) return; alive = false; unsubscribe?.(); offConnection?.(); clear(); root.remove();
      root.removeEventListener('pointerdown', entryIntent); root.removeEventListener('focusin', entryIntent);
    },
  };
}
