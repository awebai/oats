/** Keyboard-accessible lifecycle actions, independent of terminal liveness. */
import { instanceId } from "./instance-tree.mjs";
import { iconElement } from "./shell-icons.mjs";
/** Decorative menu icons (the Redesign's context menu), keyed by action. */
const MENU_ICONS = Object.freeze({ 'open-split': 'splitRight', 'open-pr': 'pullRequest', inspect: 'knowledge', start: 'start', restart: 'refresh', stop: 'stop', retire: 'remove' });

const pending = new Map(); // instance key -> controls replaced during an action

/** Preserve an open menu through the roster's periodic DOM rebuild. */
export function captureInstanceActionMenu(root) {
  const open = root.querySelector('[data-instance-menu-open="true"]');
  const key = open?.dataset.instanceMenu;
  const action = root.ownerDocument.activeElement?.dataset.action;
  return () => {
    if (!key) return;
    const menu = [...root.querySelectorAll("[data-instance-menu]")].find((m) => m.dataset.instanceMenu === key);
    menu?.openActionMenu(action);
  };
}

export function instanceActions(doc, instance, { invoke, openLifecycle, done = () => {}, report = () => {},
  scope = '', owner = () => true, extra = [], dispatch, onMenuState = () => {}, onFocusChange = () => {}, shortcut = () => '' }) {
  const key = JSON.stringify([scope, instanceId(instance), instance.createdAt ?? null]);
  const owns = () => { try { return owner(); } catch { return false; } };
  const visible = element => {
    if (!element?.isConnected) return false;
    for (let el = element; el; el = el.parentElement) {
      const style = doc.defaultView?.getComputedStyle(el);
      if (el.hidden || el.inert || el.hasAttribute('inert') || style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  };
  const wrapper = doc.createElement("span"); wrapper.className = "ctx-actions";
  const trigger = doc.createElement("button");
  trigger.type = "button"; trigger.className = "ctx-instance-actions"; trigger.append(iconElement(doc, "more"));
  trigger.dataset.treeInstance = key; trigger.dataset.treeControl = "actions";
  trigger.setAttribute("aria-label", `Actions for ${instance.instance}${instance.server ? ` on ${instance.server}` : ""}`);
  trigger.setAttribute("aria-haspopup", "menu"); trigger.setAttribute("aria-expanded", "false");
  const menu = doc.createElement("div"); menu.className = "ctx-instance-menu";
  menu.setAttribute("popover", "auto"); menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Actions for ${instance.instance}`);
  menu.dataset.instanceMenu = key;
  // Associate the invoker with the popover: clicking it again must close
  // the menu, rather than light-dismiss first and immediately reopen it.
  trigger.popoverTargetElement = menu;
  const items = [];
  const reasonFor = action => { const row = extra.find(item => item.action === action); return typeof row?.reason === 'function' ? row.reason() : row?.reason || ''; };
  const syncOptions = () => {
    for (const item of items) {
      const reason = reasonFor(item.dataset.action), note = item.querySelector('small');
      item.disabled = !!reason;
      if (note) { note.textContent = reason; note.hidden = !reason; }
      item.title = reason;
      item.autofocus = false;
    }
    const first = items.find(item => !item.disabled); if (first) first.autofocus = true;
  };
  const unrouted = !!instance.server && !instance.savedRoute;
  trigger.disabled = unrouted || pending.has(key);
  pending.get(key)?.push({ trigger, unrouted, owns });
  if (unrouted) trigger.title = "No saved route for this remote instance on this machine";
  const close = (restoreFocus = false) => {
    menu.hidePopover();
    if (restoreFocus && owns() && visible(trigger)) trigger.focus();
  };
  const position = () => {
    const anchor = trigger.getBoundingClientRect(), size = menu.getBoundingClientRect();
    const win = doc.defaultView;
    menu.style.left = `${Math.max(8, Math.min(anchor.right - size.width, win.innerWidth - size.width - 8))}px`;
    menu.style.top = `${Math.max(8, anchor.bottom + size.height + 8 <= win.innerHeight ? anchor.bottom + 4 : anchor.top - size.height - 4)}px`;
  };
  const open = (action) => {
    if (trigger.disabled || !visible(trigger) || !owns()) return;
    menu.showPopover(); position();
    (items.find((item) => item.dataset.action === action && !item.disabled) || items.find(item => !item.disabled))?.focus();
  };
  menu.openActionMenu = open;
  // Native popovers provide top-layer placement and outside-click dismissal.
  // Both native dismissal and explicit close update the trigger's state.
  menu.addEventListener("beforetoggle", (event) => {
    const expanded = event.newState === "open";
    if (expanded && (!owns() || trigger.disabled || !visible(trigger))) { event.preventDefault(); return; }
    if (expanded) syncOptions();
    menu.dataset.instanceMenuOpen = String(expanded);
    trigger.setAttribute("aria-expanded", String(expanded));
    for (const item of items) {
      const descriptor = extra.find(row => row.action === item.dataset.action);
      if (descriptor?.actionId) { const hint = item.querySelector('kbd'); hint.textContent = shortcut(descriptor.actionId) || ''; hint.hidden = !hint.textContent; }
    }
    onMenuState(expanded ? { element: menu, owns, run: execute } : null, menu);
    // A native pointer activation can run a microtask checkpoint before the
    // popover's default action makes it measurable. Position before the next
    // paint, when the open menu has its actual width (not a hidden width of 0).
    if (expanded) doc.defaultView.requestAnimationFrame(() => {
      if (owns() && menu.isConnected && menu.dataset.instanceMenuOpen === "true") position();
    });
  });
  trigger.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); open(event.key === "ArrowUp" ? "retire" : undefined);
  });
  menu.addEventListener('focusin', () => { if (menu.isConnected) onFocusChange(); });
  menu.addEventListener('focusout', () => doc.defaultView.queueMicrotask(() => { if (menu.isConnected) onFocusChange(); }));
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Tab") { close(true); return; }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const available = items.filter(item => !item.disabled);
    const current = available.indexOf(doc.activeElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + available.length) % available.length;
    available[index]?.focus();
  });
  const launchAction = instance.running === true ? [["restart", "Restart with…"]] : instance.running === false ? [["start", "Start…"]] : [];
  async function execute(action) {
    const item = items.find(row => row.dataset.action === action);
    if (!item || !owns() || !visible(trigger) || !item.isConnected || trigger.disabled || item.disabled || reasonFor(action) || pending.has(key)) return;
    close(true);
    if (action === 'stop' || action === 'retire') {
      if (typeof openLifecycle === 'function') openLifecycle(action, instance);
      else report('A plan-backed confirmation is required for Stop or Remove.');
      return; // never fall back to an unguarded invoke('retire')
    }
    const controls = [{ trigger, unrouted, owns }]; pending.set(key, controls); trigger.disabled = true;
    try { const result = await invoke(action, instance); if (owns()) done(result, action); }
    catch (error) { if (owns()) report(error.message, error.result); }
    finally {
      if (pending.get(key) === controls) {
        for (const control of controls) if (control.owns()) control.trigger.disabled = control.unrouted;
        pending.delete(key);
      }
    }
  }
  for (const descriptor of [...extra, ...[["inspect", "Knowledge & capabilities…"], ...launchAction, ['stop', 'Stop…'], ["retire", "Remove instance…"]].map(([action, label]) => ({ action, label }))]) {
    const { action, label, reason, actionId } = descriptor;
    const item = doc.createElement("button"); item.type = "button"; item.tabIndex = -1;
    item.setAttribute("role", "menuitem"); item.dataset.action = action;
    const glyph = doc.createElement('span'); glyph.className = 'ctx-menu-icon'; glyph.setAttribute('aria-hidden', 'true');
    if (Object.hasOwn(MENU_ICONS, action)) glyph.append(iconElement(doc, MENU_ICONS[action], { size: 15 }));
    if (action === 'stop') item.classList.add('ctx-menu-lifecycle'); // separator before the lifecycle group
    const copy = doc.createElement('span'); copy.textContent = label; item.append(glyph, copy);
    if (actionId) { const hint = doc.createElement('kbd'); hint.dataset.shortcut = actionId; hint.textContent = shortcut(actionId) || ''; hint.hidden = !hint.textContent; item.append(hint); }
    if (reason !== undefined) { const note = doc.createElement('small'); item.append(note); }
    item.addEventListener('click', () => {
      if (!owns() || !item.isConnected || item.disabled || trigger.disabled) return;
      if (actionId && typeof dispatch === 'function') dispatch(actionId); else void execute(action);
    });
    items.push(item); menu.append(item);
  }
  syncOptions();
  wrapper.append(trigger, menu);
  return wrapper;
}
