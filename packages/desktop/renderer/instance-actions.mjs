/** Keyboard-accessible lifecycle actions, independent of terminal liveness. */
import { instanceId } from "./instance-tree.mjs";

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

export function instanceActions(doc, instance, { invoke, confirmRetire, done, report }) {
  const key = instanceId(instance);
  const wrapper = doc.createElement("span"); wrapper.className = "ctx-actions";
  const trigger = doc.createElement("button");
  trigger.type = "button"; trigger.className = "ctx-instance-actions"; trigger.textContent = "⋯";
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
  const unrouted = !!instance.server && !instance.savedRoute;
  trigger.disabled = unrouted || pending.has(key);
  pending.get(key)?.push({ trigger, unrouted });
  if (unrouted) trigger.title = "No saved route for this remote instance on this machine";
  const close = (restoreFocus = false) => {
    menu.hidePopover();
    if (restoreFocus && trigger.isConnected) trigger.focus();
  };
  const position = () => {
    const anchor = trigger.getBoundingClientRect(), size = menu.getBoundingClientRect();
    const win = doc.defaultView;
    menu.style.left = `${Math.max(8, Math.min(anchor.right - size.width, win.innerWidth - size.width - 8))}px`;
    menu.style.top = `${Math.max(8, anchor.bottom + size.height + 8 <= win.innerHeight ? anchor.bottom + 4 : anchor.top - size.height - 4)}px`;
  };
  const open = (action) => {
    if (trigger.disabled || !trigger.isConnected) return;
    menu.showPopover(); position();
    (items.find((item) => item.dataset.action === action) || items[0]).focus();
  };
  menu.openActionMenu = open;
  // Native popovers provide top-layer placement and outside-click dismissal.
  // Both native dismissal and explicit close update the trigger's state.
  menu.addEventListener("beforetoggle", (event) => {
    const expanded = event.newState === "open";
    menu.dataset.instanceMenuOpen = String(expanded);
    trigger.setAttribute("aria-expanded", String(expanded));
    if (expanded) queueMicrotask(() => { if (menu.isConnected && menu.dataset.instanceMenuOpen === "true") position(); });
  });
  trigger.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); open(event.key === "ArrowUp" ? "retire" : "inspect");
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Tab") { close(true); return; }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const current = items.indexOf(doc.activeElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[index].focus();
  });
  for (const [action, label] of [["inspect", "Knowledge & capabilities…"], ["retire", "Retire instance"]]) {
    const item = doc.createElement("button"); item.type = "button"; item.tabIndex = -1;
    if (action === "inspect") item.autofocus = true;
    item.setAttribute("role", "menuitem"); item.dataset.action = action; item.textContent = label;
    item.addEventListener("click", async () => {
      if (trigger.disabled || pending.has(key)) return;
      close(true);
      if (action === "retire" && !confirmRetire(instance)) return;
      pending.set(key, [{ trigger, unrouted }]); trigger.disabled = true;
      try { const result = await invoke(action, instance); done(result, action); }
      catch (error) { report(error.message, error.result); }
      finally {
        for (const control of pending.get(key) || []) control.trigger.disabled = control.unrouted;
        pending.delete(key);
      }
    });
    items.push(item); menu.append(item);
  }
  wrapper.append(trigger, menu);
  return wrapper;
}
