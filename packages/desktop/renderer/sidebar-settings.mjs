// The sidebar's settings menu (2026-10-23): the cog at the right end of the sidebar's bottom bar, after the sidebar
// toggle. It holds the theme, the font, the keyboard shortcuts and Resume lost sessions when Desktop opens, each an
// action of the keymap's registry (Connections
// stays in the palette, Settings: Connections…; Spawn instance is the bar's own button, before the cog). The menu is the
// instance actions' pattern (instance-actions.mjs): a native popover with role="menu", the trigger its invoker (a
// second click closes it), placed as that menu is (its right edge on the cog's, above it when there is no room
// below), ↓/↑ on the trigger open it on the first / last item, ↑/↓/Home/End move, Esc and Tab close it, Esc back
// on the cog. A `checked` item is a menuitemcheckbox: its state is aria-checked (what assistive technology reads), and a
// check mark (aria-hidden) in its icon column, in the item's own ink, shows it when on.
import { iconElement } from "./shell-icons.mjs";
import { joinPickerFocusReturn } from "./overlay-picker.mjs";
import { captureFocusReturn } from "./focus-return.mjs";

export const SETTINGS_LABEL = "Settings";
/** The menu's items, in order: what each says, the action it runs and its icon; `checked` marks an on/off item (no
 * icon: its column holds the check mark; no ellipsis: it opens nothing, it toggles). */
export const SETTINGS_ITEMS = Object.freeze([
  { action: "app.themePicker", label: "Theme…", icon: "theme" },
  { action: "app.fontPicker", label: "Font…", icon: "font" },
  { action: "app.shortcuts", label: "Keyboard shortcuts…", icon: "shortcuts" },
  { action: "app.resumeAtLaunch", label: "Resume lost sessions when Desktop opens", checked: true },
]);

/**
 * Wire the cog `trigger` to a menu of SETTINGS_ITEMS, appended after it. An item runs `run(action)` once the menu
 * has closed and the cog has its focus back, so a dialog it opens returns there. `shortcut(action)` is the chord
 * an item shows ("" for none); `refresh()` reads them again (the keymap changed).
 * `readChecked(action)` → Promise<boolean|null> is a checked item's state, read each time the menu opens (no copy is
 * kept): a boolean paints it; null, a rejection or an answer for an earlier opening (the menu closed or reopened
 * since; a latest-intent token) paints nothing, so aria-checked keeps its last painted value ("false" at first).
 */
export function createSettingsMenu(doc, trigger, { run, shortcut = () => "", readChecked = () => null }) {
  trigger.setAttribute("aria-haspopup", "menu"); trigger.setAttribute("aria-expanded", "false");
  trigger.replaceChildren(iconElement(doc, "cog"));
  const menu = doc.createElement("div"); menu.id = "sidebar-settings-menu"; menu.className = "ctx-instance-menu sidebar-settings-menu";
  menu.tabIndex = -1; menu.setAttribute("popover", "auto"); menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", SETTINGS_LABEL);
  trigger.setAttribute("aria-controls", menu.id);
  trigger.popoverTargetElement = menu;
  const items = SETTINGS_ITEMS.map(({ action, label, icon, checked }) => {
    const item = doc.createElement("button"); item.type = "button"; item.tabIndex = -1;
    item.setAttribute("role", checked ? "menuitemcheckbox" : "menuitem"); item.dataset.menuAction = action;
    if (checked) item.setAttribute("aria-checked", "false");
    const glyph = doc.createElement("span"); glyph.className = "ctx-menu-icon"; glyph.setAttribute("aria-hidden", "true");
    // The check mark keeps its column when off (hidden inside it), so the label never shifts into it.
    const mark = iconElement(doc, checked ? "check" : icon, { size: 15 });
    if (checked) mark.setAttribute("hidden", "");
    glyph.append(mark);
    const copy = doc.createElement("span"); copy.className = "sidebar-settings-label"; copy.textContent = label;
    const keys = doc.createElement("kbd");
    item.append(glyph, copy, keys);
    item.addEventListener("click", () => { close(true); run(action); });
    return item;
  });
  menu.append(...items);
  trigger.after(menu);
  const refresh = () => {
    for (const item of items) { const keys = item.querySelector("kbd"); keys.textContent = shortcut(item.dataset.menuAction) || ""; keys.hidden = !keys.textContent; }
  };
  const paintChecked = (item, on) => {
    item.setAttribute("aria-checked", String(on));
    item.querySelector(".ctx-menu-icon > svg")?.toggleAttribute("hidden", !on);
  };
  let reading = 0; // latest-intent token: an opening's reads paint only while it is the latest opening
  const readStates = () => {
    const token = ++reading;
    for (const item of items) {
      if (item.getAttribute("role") !== "menuitemcheckbox") continue;
      let answer;
      try { answer = Promise.resolve(readChecked(item.dataset.menuAction)); } catch { continue; }
      answer.then((on) => { if (token === reading && typeof on === "boolean") paintChecked(item, on); }, () => {});
    }
  };
  const isOpen = () => { try { return menu.matches(":popover-open"); } catch { return false; } };
  function close(restore = false) {
    try { menu.hidePopover(); } catch { /* already closed */ }
    if (restore) trigger.focus();
  }
  const position = () => {
    const anchor = trigger.getBoundingClientRect(), size = menu.getBoundingClientRect(), win = doc.defaultView;
    menu.style.left = `${Math.max(8, Math.min(anchor.right - size.width, win.innerWidth - size.width - 8))}px`;
    menu.style.top = `${Math.max(8, anchor.bottom + size.height + 8 <= win.innerHeight ? anchor.bottom + 4 : anchor.top - size.height - 4)}px`;
  };
  function open(last = false) {
    if (!isOpen()) menu.showPopover();
    position();
    items[last ? items.length - 1 : 0].focus();
  }
  // While it is open the menu joins the overlays' focus handoff (overlay-picker.mjs), as a dialog does: a dialog or
  // picker that opens over it (a chord: the palette, the shortcuts editor, the theme picker…) takes the cog as its
  // return target and closes the menu without moving focus. Any other move of focus out of it closes it the same way.
  let release = null;
  const leave = () => { release?.(); release = null; };
  menu.addEventListener("beforetoggle", (event) => {
    const expanded = event.newState === "open";
    trigger.setAttribute("aria-expanded", String(expanded));
    if (!expanded) { reading++; leave(); return; }
    if (doc.activeElement !== trigger) trigger.focus({ preventScroll: true });
    leave(); release = joinPickerFocusReturn(doc, { opener: captureFocusReturn(doc), dismiss: () => close(false) });
    refresh(); readStates();
    // A pointer opening can run before the popover is measurable: place it again before the next paint.
    doc.defaultView.requestAnimationFrame(() => { if (isOpen()) position(); });
  });
  // A click opens it through the invoker; focus then goes to the first item, as a key opening does.
  menu.addEventListener("toggle", (event) => {
    if (event.newState === "open" && !menu.contains(doc.activeElement)) { position(); items[0].focus(); }
  });
  doc.addEventListener("focusin", (event) => {
    if (isOpen() && !menu.contains(event.target) && event.target !== trigger) close(false);
  }, true);
  trigger.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault(); event.stopPropagation(); open(event.key === "ArrowUp");
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Tab") { close(true); return; }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault(); event.stopPropagation();
    const current = items.indexOf(doc.activeElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[index].focus();
  });
  return { menu, items, open, close, isOpen, refresh };
}
