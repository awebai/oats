/** Renderer feedback, not OS notifications or inferred activity. No timers, IO,
 * action callbacks or severity parsing; callers own their async completion. */
import { revealInScrollport } from './reveal-in-scrollport.mjs';
let centers = 0;
export const notificationCSS = `
.app-notifications { position:fixed; right:16px; bottom:42px; width:min(340px,calc(100vw - 32px)); max-height:calc(100vh - 58px); overflow-y:auto; box-sizing:border-box; padding:3px; z-index:80; pointer-events:none; }
.app-notifications ol { list-style:none; display:grid; gap:10px; margin:0; padding:0; }
.app-toast { display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border-radius:9px; background:var(--primary-bg); color:var(--primary-fg); box-shadow:var(--shadow-popover); pointer-events:auto; font:12.5px/1.5 var(--sans,system-ui); }
.app-toast-text { min-width:0; flex:1; max-height:160px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; }
.app-toast-dismiss { flex:none; min-width:26px; min-height:26px; border:1px solid var(--primary-fg); border-radius:5px; padding:0 4px; background:var(--primary-bg); color:var(--primary-fg); font:inherit; cursor:pointer; }
.app-toast :focus-visible { outline:2px solid var(--primary-fg); outline-offset:2px; }
`;
export function createNotificationCenter({ document: doc, generation = () => 0, subscribe = () => () => {},
  applyFocus = fn => fn(), onIntent = () => {}, fallbackFocus = () => null } = {}) {
  const namespace = `oats-notification-${++centers}`;
  const root = doc.createElement('section'); root.className = 'app-notifications'; root.setAttribute('aria-label', 'Notifications');
  const list = doc.createElement('ol'); list.setAttribute('aria-live', 'polite'); list.setAttribute('aria-relevant', 'additions'); list.setAttribute('aria-atomic', 'false');
  root.append(list); doc.body.append(root);
  let alive = true, scope = generation(), serial = 0, projecting = false, returnTo = null;
  const entries = [];
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
    entries.length = 0; list.replaceChildren(); returnTo = null; scope = generation();
  }
  function dismiss(entry) {
    const at = entries.indexOf(entry);
    if (!alive || at < 0 || scope !== generation() || !visible(entry.element)) return;
    const focused = entry.element.contains(doc.activeElement);
    entries.splice(at, 1); entry.element.remove();
    if (focused) focus(entries[at]?.dismiss || entries.at(-1)?.dismiss || (returnTo?.scope === scope && visible(returnTo.element) ? returnTo.element : fallbackFocus()));
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
  return {
    notify(message) {
      if (!alive || typeof message !== 'string' || !message.trim()) return false;
      if (scope !== generation()) clear();
      // Explicit dismissal, not an accessibility-hostile expiry clock. Capacity
      // eviction skips the focused card; reset/disposal still revoke old scopes.
      if (entries.length === 3) {
        const old = entries.find(entry => !entry.element.contains(doc.activeElement));
        if (!old) return false;
        entries.splice(entries.indexOf(old), 1); old.element.remove();
      }
      const element = doc.createElement('li'); element.className = 'app-toast';
      const text = doc.createElement('div'); text.className = 'app-toast-text'; text.id = `${namespace}-${++serial}`;
      text.textContent = message; text.tabIndex = 0;
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'app-toast-dismiss'; button.textContent = '×';
      button.setAttribute('aria-label', 'Dismiss notification'); button.setAttribute('aria-describedby', text.id);
      const record = { element, dismiss: button };
      button.addEventListener('click', () => dismiss(record));
      element.append(text, button); entries.push(record); list.append(element);
      // Arrival can change stack geometry, but never the focused element.
      revealInScrollport(root, doc.activeElement);
      return true;
    },
    clear() { if (alive) clear(); },
    dispose() {
      if (!alive) return; alive = false; unsubscribe?.(); clear(); root.remove();
      root.removeEventListener('pointerdown', entryIntent); root.removeEventListener('focusin', entryIntent);
    },
  };
}
