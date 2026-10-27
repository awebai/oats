// The sidebar's settings menu (sidebar-settings.mjs): the cog at the right end of the sidebar's foot, after the
// sidebar toggle, and its menu (Theme…, Font…, Keyboard shortcuts…; Connections stays in the palette). Its items, their
// order, words, actions and chords; the menu button's ARIA; the keys (↓/↑ on the cog, ↑/↓/Home/End in the menu,
// Esc and Tab); choosing an item; its placement. The shell wires it in shell.mjs (shell-nav.test.mjs runs that wiring).
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createSettingsMenu, SETTINGS_ITEMS, SETTINGS_LABEL } from "../renderer/sidebar-settings.mjs";
import { takePickerFocusReturn } from "../renderer/overlay-picker.mjs";

// jsdom has no top-layer API: model a popover's open state, its beforetoggle (synchronous) and toggle events, :popover-open,
// and an invoker's click (a button's popoverTargetElement toggles it). The toggle event is queued, as the HTML spec
// queues it, and coalesced: a toggle still pending when the state changes again is replaced by one from its old
// state to the new one (an open closed before its toggle ran fires closed → closed). Native light-dismiss and
// placement in the top layer are Chromium's, not this test's claim.
function rig(t, { shortcut } = {}) {
  const dom = new JSDOM(`<!doctype html><body><aside id="sidebar"><div id="nav-foot" role="group" aria-label="Sidebar tools">
    <button id="sidebar-toggle" class="side-icon-button icon-button" type="button" data-action="sidebar.toggle">S</button>
    <button id="sidebar-settings" class="side-icon-button sidebar-settings icon-button" type="button" aria-label="Settings" title="Settings"></button>
    </div></aside></body>`, { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const win = dom.window, doc = win.document, shown = new WeakSet(), pending = new WeakMap();
  const fire = (el, type, oldState, newState) => {
    const e = new win.Event(type); Object.defineProperty(e, "oldState", { value: oldState }); Object.defineProperty(e, "newState", { value: newState });
    el.dispatchEvent(e);
  };
  const queueToggle = (el, oldState, newState) => {
    const before = pending.get(el);
    if (before) { win.clearTimeout(before.timer); oldState = before.oldState; }
    pending.set(el, { oldState, timer: win.setTimeout(() => { pending.delete(el); fire(el, "toggle", oldState, newState); }, 0) });
  };
  win.HTMLElement.prototype.showPopover = function () {
    if (shown.has(this)) return;
    fire(this, "beforetoggle", "closed", "open"); shown.add(this); queueToggle(this, "closed", "open");
  };
  win.HTMLElement.prototype.hidePopover = function () {
    if (!shown.has(this)) return;
    fire(this, "beforetoggle", "open", "closed"); shown.delete(this); queueToggle(this, "open", "closed");
  };
  const matches = win.Element.prototype.matches;
  win.Element.prototype.matches = function (selector) { return selector === ":popover-open" ? shown.has(this) : matches.call(this, selector); };
  const click = win.HTMLButtonElement.prototype.click;
  win.HTMLButtonElement.prototype.click = function () {
    click.call(this);
    const target = this.popoverTargetElement;
    if (target) shown.has(target) ? target.hidePopover() : target.showPopover();
  };
  const trigger = doc.getElementById("sidebar-settings"), ran = [];
  let onRun = () => {};
  const settings = createSettingsMenu(doc, trigger, { run: (action) => { ran.push(action); onRun(action); }, ...(shortcut ? { shortcut } : {}) });
  const key = (el, init) => {
    const e = new win.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    el.dispatchEvent(e); return e;
  };
  const tick = () => new Promise((resolve) => win.setTimeout(resolve, 0));
  return { win, doc, trigger, settings, menu: settings.menu, items: settings.items, ran, key, tick, isShown: () => shown.has(settings.menu),
    onRun: (fn) => { onRun = fn; }, label: (item) => item.querySelector(".sidebar-settings-label").textContent };
}

test("the items, in order: Theme…, Font…, Keyboard shortcuts…, each its keymap action and its icon; no Connections, no Hide sidebar", (t) => {
  assert.equal(SETTINGS_LABEL, "Settings");
  assert.ok(Object.isFrozen(SETTINGS_ITEMS), "a fixed list");
  assert.deepEqual(SETTINGS_ITEMS.map(({ action, label, icon }) => [action, label, icon]), [
    ["app.themePicker", "Theme…", "theme"], ["app.fontPicker", "Font…", "font"], ["app.shortcuts", "Keyboard shortcuts…", "shortcuts"],
  ]);
  // Connections stays in the palette (Settings: Connections…), and the sidebar toggle is the foot's own button.
  assert.ok(!SETTINGS_ITEMS.some(({ action }) => action === "app.connections" || action === "sidebar.toggle"));
  const r = rig(t);
  assert.deepEqual(r.items.map((item) => [item.dataset.menuAction, r.label(item)]), SETTINGS_ITEMS.map(({ action, label }) => [action, label]));
  assert.deepEqual([...r.menu.children], r.items, "the menu holds the items alone, in that order");
  for (const item of r.items) {
    assert.equal(item.tagName, "BUTTON"); assert.equal(item.type, "button");
    // The icon, the words, then the chord.
    assert.deepEqual([...item.children].map((el) => el.className || el.localName), ["ctx-menu-icon", "sidebar-settings-label", "kbd"]);
    const glyph = item.querySelector(".ctx-menu-icon");
    assert.equal(glyph.getAttribute("aria-hidden"), "true", "the icon is decoration");
    const svg = glyph.querySelector("svg.shell-icon");
    assert.ok(svg, `${item.dataset.menuAction}: an icon`); assert.equal(svg.getAttribute("width"), "15");
  }
  // The cog's own icon is the settings cog (shell-icons cog: Lucide "settings"), decorative: its name is "Settings".
  assert.equal(r.trigger.children.length, 1);
  assert.equal(r.trigger.firstElementChild.getAttribute("aria-hidden"), "true");
  assert.equal(r.trigger.getAttribute("aria-label"), "Settings");
});

test("ARIA: a menu button over a native popover menu, aria-expanded following it", async (t) => {
  const r = rig(t);
  assert.equal(r.trigger.getAttribute("aria-haspopup"), "menu");
  assert.equal(r.trigger.getAttribute("aria-expanded"), "false");
  assert.equal(r.menu.id, "sidebar-settings-menu");
  assert.equal(r.trigger.getAttribute("aria-controls"), r.menu.id);
  assert.equal(r.trigger.popoverTargetElement, r.menu, "the cog is the popover's invoker: a second click closes it");
  assert.equal(r.trigger.nextElementSibling, r.menu, "the menu right after the cog");
  assert.equal(r.menu.nextElementSibling, null, "last in the foot");
  assert.equal(r.trigger.previousElementSibling, r.doc.getElementById("sidebar-toggle"), "the cog after the sidebar toggle");
  assert.equal(r.menu.getAttribute("popover"), "auto");
  assert.equal(r.menu.getAttribute("role"), "menu");
  assert.equal(r.menu.getAttribute("aria-label"), "Settings");
  assert.equal(r.menu.tabIndex, -1);
  assert.ok(r.menu.classList.contains("ctx-instance-menu") && r.menu.classList.contains("sidebar-settings-menu"), "the instance row's context menu style");
  for (const item of r.items) {
    assert.equal(item.getAttribute("role"), "menuitem");
    assert.equal(item.tabIndex, -1, "the arrows move between items, not Tab");
  }
  r.trigger.click();
  assert.equal(r.isShown(), true); assert.equal(r.settings.isOpen(), true);
  assert.equal(r.trigger.getAttribute("aria-expanded"), "true");
  await r.tick();
  assert.equal(r.doc.activeElement, r.items[0], "a click opening: focus on the first item, as a key opening does");
  r.trigger.click();
  assert.equal(r.isShown(), false); assert.equal(r.trigger.getAttribute("aria-expanded"), "false", "a second click closes it");
  assert.deepEqual(r.ran, [], "opening and closing run nothing");
});

test("↓ on the cog opens the menu on its first item, ↑ on its last; a modified arrow does nothing", (t) => {
  const r = rig(t);
  r.trigger.focus();
  for (const mod of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) {
    const e = r.key(r.trigger, { key: "ArrowDown", [mod]: true });
    assert.equal(r.isShown(), false, `${mod}+↓: not opened`); assert.equal(e.defaultPrevented, false);
  }
  assert.equal(r.key(r.trigger, { key: "Enter" }).defaultPrevented, false, "Enter is the button's own (a click)");
  const down = r.key(r.trigger, { key: "ArrowDown" });
  assert.equal(down.defaultPrevented, true);
  assert.equal(r.isShown(), true); assert.equal(r.trigger.getAttribute("aria-expanded"), "true");
  assert.equal(r.doc.activeElement, r.items[0], "↓: the first item");
  r.key(r.doc.activeElement, { key: "Escape" });
  assert.equal(r.isShown(), false);
  const up = r.key(r.trigger, { key: "ArrowUp" });
  assert.equal(up.defaultPrevented, true);
  assert.equal(r.isShown(), true);
  assert.equal(r.doc.activeElement, r.items.at(-1), "↑: the last item");
});

test("↓/↑ move through the items and wrap; Home and End go to the first and last", (t) => {
  const r = rig(t);
  r.trigger.focus(); r.key(r.trigger, { key: "ArrowDown" });
  const at = () => r.items.indexOf(r.doc.activeElement);
  const press = (key, init = {}) => r.key(r.doc.activeElement, { key, ...init });
  assert.equal(r.items.length, 3);
  const visited = [];
  for (let i = 0; i < 4; i++) { assert.equal(press("ArrowDown").defaultPrevented, true); visited.push(at()); }
  assert.deepEqual(visited, [1, 2, 0, 1], "↓ to the end, then back to the first");
  const back = [];
  for (let i = 0; i < 4; i++) { press("ArrowUp"); back.push(at()); }
  assert.deepEqual(back, [0, 2, 1, 0], "↑ wraps from the first to the last");
  press("End"); assert.equal(at(), 2);
  press("End"); assert.equal(at(), 2, "End stays on the last");
  press("Home"); assert.equal(at(), 0);
  press("Home"); assert.equal(at(), 0, "Home stays on the first");
  press("ArrowDown");
  assert.equal(press("ArrowDown", { shiftKey: true }).defaultPrevented, false, "a modified arrow is not the menu's"); assert.equal(at(), 1);
  assert.equal(press("x").defaultPrevented, false, "a letter is not the menu's"); assert.equal(at(), 1);
  assert.equal(r.isShown(), true, "moving never closes it");
  assert.deepEqual(r.ran, [], "nor runs anything");
});

test("the menu's keys stay in the menu: a document listener never sees an arrow, Home, End or Esc there", (t) => {
  const r = rig(t), seen = [];
  r.doc.addEventListener("keydown", (e) => seen.push(e.key));
  r.trigger.focus(); r.key(r.trigger, { key: "ArrowDown" });
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape"]) r.key(r.doc.activeElement, { key });
  assert.deepEqual(seen, [], "the shell's keymap does not act on them too");
});

test("Esc closes the menu and returns focus to the cog", (t) => {
  const r = rig(t);
  r.trigger.focus(); r.key(r.trigger, { key: "ArrowDown" });
  r.key(r.doc.activeElement, { key: "ArrowDown" });
  assert.equal(r.doc.activeElement, r.items[1]);
  const esc = r.key(r.doc.activeElement, { key: "Escape" });
  assert.equal(esc.defaultPrevented, true);
  assert.equal(r.isShown(), false); assert.equal(r.trigger.getAttribute("aria-expanded"), "false");
  assert.equal(r.doc.activeElement, r.trigger, "back on the cog, never <body>");
  assert.deepEqual(r.ran, []);
});

test("Tab closes the menu and leaves the Tab to the browser, from the cog", (t) => {
  const r = rig(t);
  r.trigger.focus(); r.key(r.trigger, { key: "ArrowUp" });
  assert.equal(r.isShown(), true);
  const tab = r.key(r.doc.activeElement, { key: "Tab" });
  assert.equal(r.isShown(), false, "closed"); assert.equal(r.trigger.getAttribute("aria-expanded"), "false");
  assert.equal(tab.defaultPrevented, false, "the Tab still moves focus on");
  assert.equal(r.doc.activeElement, r.trigger, "from the cog, so it lands after it, not after a closed item");
  r.trigger.focus(); r.key(r.trigger, { key: "ArrowDown" });
  r.key(r.doc.activeElement, { key: "Tab", shiftKey: true });
  assert.equal(r.isShown(), false, "Shift+Tab too");
  assert.deepEqual(r.ran, []);
});

test("choosing an item runs its action once, after the menu has closed and the cog has its focus back", async (t) => {
  const r = rig(t);
  const states = [];
  r.onRun((action) => states.push({ action, open: r.isShown(), expanded: r.trigger.getAttribute("aria-expanded"), focus: r.doc.activeElement }));
  for (const [i, item] of r.items.entries()) {
    r.trigger.focus(); r.key(r.trigger, { key: "ArrowDown" });
    for (let step = 0; step < i; step++) r.key(r.doc.activeElement, { key: "ArrowDown" });
    assert.equal(r.doc.activeElement, item);
    item.click(); // Enter and Space on a button are its click
    await r.tick();
    assert.equal(r.isShown(), false, `${item.dataset.menuAction}: closed`);
    assert.equal(r.doc.activeElement, r.trigger, `${item.dataset.menuAction}: the cog has focus`);
  }
  assert.deepEqual(r.ran, SETTINGS_ITEMS.map(({ action }) => action), "each action once, in order");
  for (const state of states) {
    assert.deepEqual([state.open, state.expanded, state.focus], [false, "false", r.trigger],
      `${state.action}: closed and on the cog when it runs, so a dialog it opens returns to the cog`);
  }
  // A pointer choice, with the menu opened by a click, is the same.
  r.ran.length = 0; r.trigger.click(); await r.tick();
  r.items.at(-1).click(); await r.tick();
  assert.deepEqual(r.ran, ["app.shortcuts"]); assert.equal(r.doc.activeElement, r.trigger);
});

test("refresh() shows each item's chord and hides an empty one; opening refreshes", (t) => {
  let chords = { "app.themePicker": "Ctrl+Shift+Space", "app.shortcuts": "Ctrl+," };
  const r = rig(t, { shortcut: (action) => chords[action] ?? "" });
  const shown = () => r.items.map((item) => { const keys = item.querySelector("kbd"); return keys.hidden ? null : keys.textContent; });
  const raw = () => r.items.map((item) => item.querySelector("kbd").textContent);
  assert.deepEqual(raw(), ["", "", ""], "nothing read before the first refresh or opening");
  r.settings.refresh();
  assert.deepEqual(shown(), ["Ctrl+Shift+Space", null, "Ctrl+,"], "Font… has no default chord");
  chords = { ...chords, "app.themePicker": "Ctrl+Alt+T", "app.fontPicker": "Ctrl+Alt+F12", "app.shortcuts": null };
  r.settings.refresh();
  assert.deepEqual(shown(), ["Ctrl+Alt+T", "Ctrl+Alt+F12", null], "a rebind or a chord given follows; an unbound one hides");
  assert.equal(r.items[2].querySelector("kbd").textContent, "", "an unbound chord leaves no text behind");
  chords = { ...chords, "app.shortcuts": "Ctrl+Alt+K" };
  r.trigger.focus(); r.key(r.trigger, { key: "ArrowDown" });
  assert.deepEqual(shown(), ["Ctrl+Alt+T", "Ctrl+Alt+F12", "Ctrl+Alt+K"], "opening reads them again");
  assert.deepEqual(r.items.map(r.label), SETTINGS_ITEMS.map(({ label }) => label), "the words never carry the chord");
});

test("with no shortcut reader, every chord is hidden", (t) => {
  const r = rig(t);
  r.settings.refresh();
  assert.deepEqual(r.items.map((item) => item.querySelector("kbd").hidden), [true, true, true]);
});

// Its right edge on the cog's, inside the window's 8px margin; under the cog when it fits, else above it (the cog is
// at the sidebar's foot: above, as a rule). The shared .ctx-instance-menu popovers (a workspace row's, an instance
// row's context menu) keep the same margin and the same under-else-above rule, from the pointer or the row instead.
test("placed by the cog: its right edge on the cog's, above the cog when there is no room below", (t) => {
  const r = rig(t);
  const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  r.menu.getBoundingClientRect = () => box(0, 0, 220, 80);
  Object.defineProperty(r.win, "innerWidth", { value: 1200, configurable: true });
  Object.defineProperty(r.win, "innerHeight", { value: 800, configurable: true });
  // The foot's cog in a sidebar 264px wide (any width will do): 24px wide, its right edge 13px in from the sidebar's (250px), near the bottom.
  r.trigger.getBoundingClientRect = () => box(226, 768, 24, 24);
  r.trigger.focus(); r.key(r.trigger, { key: "ArrowDown" });
  assert.deepEqual([r.menu.style.left, r.menu.style.top], ["30px", "684px"], "right edges aligned (250 - 220), 4px above the cog");
  r.key(r.doc.activeElement, { key: "Escape" });
  r.trigger.getBoundingClientRect = () => box(226, 100, 24, 24);
  r.key(r.trigger, { key: "ArrowDown" });
  assert.deepEqual([r.menu.style.left, r.menu.style.top], ["30px", "128px"], "under it, 4px below, when it fits");
  r.key(r.doc.activeElement, { key: "Escape" });
  r.trigger.getBoundingClientRect = () => box(100, 768, 24, 24);
  r.key(r.trigger, { key: "ArrowDown" });
  assert.equal(r.menu.style.left, "8px", "never past the window's left 8px margin");
  r.key(r.doc.activeElement, { key: "Escape" });
  Object.defineProperty(r.win, "innerWidth", { value: 240, configurable: true });
  r.trigger.getBoundingClientRect = () => box(226, 768, 24, 24);
  r.key(r.trigger, { key: "ArrowDown" });
  assert.equal(r.menu.style.left, "12px", "nor past its right one (240 - 220 - 8)");
  r.key(r.doc.activeElement, { key: "Escape" });
  Object.defineProperty(r.win, "innerHeight", { value: 60, configurable: true });
  r.trigger.getBoundingClientRect = () => box(226, 30, 24, 24);
  r.key(r.trigger, { key: "ArrowDown" });
  assert.equal(r.menu.style.top, "8px", "never above the window's top 8px margin");
});

// Another overlay opened by its chord while the menu is open (the palette, the shortcuts editor, the theme picker:
// each takes the handoff through takePickerFocusReturn before it mounts) closes the menu without moving focus, and
// takes the cog as its return target, never the menu's item (review: the menu stayed above the editor's scrim).
test("an overlay opened over the open menu closes it through the handoff and returns to the cog", async (t) => {
  const r = rig(t);
  r.trigger.focus(); r.trigger.click(); await r.tick();
  assert.equal(r.isShown(), true); assert.equal(r.doc.activeElement, r.items[0]);
  const opener = takePickerFocusReturn(r.doc);
  assert.equal(r.isShown(), false, "closed by the overlay that took over");
  assert.equal(r.trigger.getAttribute("aria-expanded"), "false");
  assert.equal(r.doc.activeElement, r.items[0], "the handoff moves no focus: the overlay does");
  r.doc.body.focus();
  assert.equal(opener.restore(), true); assert.equal(r.doc.activeElement, r.trigger, "the overlay's return target is the cog");
  // Closed, the menu has left the handoff: the next overlay captures whatever has focus then.
  r.items[1].tabIndex = 0; r.doc.getElementById("sidebar-toggle").focus();
  const later = takePickerFocusReturn(r.doc); r.doc.body.focus();
  assert.equal(later.restore(), true); assert.equal(r.doc.activeElement, r.doc.getElementById("sidebar-toggle"));
});

test("focus moving anywhere else (a dialog that skips the handoff) closes the menu without taking focus back", async (t) => {
  const r = rig(t);
  r.trigger.click(); await r.tick();
  assert.equal(r.isShown(), true);
  const other = r.doc.getElementById("sidebar-toggle"); other.focus();
  assert.equal(r.isShown(), false); assert.equal(r.doc.activeElement, other);
  // Moving within the menu, or back to the cog, keeps it open.
  r.trigger.click(); await r.tick();
  r.key(r.items[0], { key: "ArrowDown" }); assert.equal(r.isShown(), true); assert.equal(r.doc.activeElement, r.items[1]);
  r.trigger.focus(); assert.equal(r.isShown(), true);
});
