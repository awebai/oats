// The sidebar's plain keys (docs/desktop-keyboard.md, "Sidebar keys"): the TUI's keys of the list
// (packages/client/keymap.mjs PLAIN_KEYS), one rebindable action each in the `sidebar` context. The
// context is the shell's (shell.mjs updateActiveContexts, run here as shipped, on the shipped index.html):
// live while focus is in the sidebar, off inside a popup there; the engine's own guard keeps them
// out of an editable field. Each default is pressed as the real keydown, shifted ones included.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import {
  SIDEBAR_KEYS, registerAction, resetAllBindings, setActiveContexts, matchEvent, parseChord, getBinding, setBinding,
} from "../renderer/keybindings.mjs";

let contexts = new Set();

const map = new Map();
globalThis.localStorage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };

const shell = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
const html = readFileSync(new URL("../renderer/index.html", import.meta.url), "utf8");

// The keydown a keyboard sends for a default: Shift+X arrives as "X", Shift+\ as "|", Shift+/ as "?".
const SHIFTED = { "|": "\\", "?": "/" };
function keydownFor(win, chord) {
  const c = parseChord(chord);
  const shifted = c.shift || Object.hasOwn(SHIFTED, c.key);
  const key = /^[a-z]$/.test(c.key) && c.shift ? c.key.toUpperCase() : c.key;
  return new win.KeyboardEvent("keydown", { key, shiftKey: shifted, bubbles: true, cancelable: true });
}

function rig(t) {
  resetAllBindings();
  const dom = new JSDOM(html);
  const win = dom.window, doc = win.document;
  const source = shell.match(/function updateActiveContexts\([^]*?\n\}/)?.[0];
  assert.ok(source, "exercise the shipped updateActiveContexts");
  const c = { document: doc, tabLayerVisible: false, stage: null, activeInstanceMenu: null,
    setActiveContexts: set => { contexts = new Set(set); setActiveContexts(set); } };
  const updateActiveContexts = runInNewContext(`${source}; updateActiveContexts;`, c);
  const sidebarKeysLive = () => { updateActiveContexts(); return contexts.has("sidebar"); };
  // What the shell draws there: a roster row, a nav button, an instance's open actions menu; and in
  // the main area a terminal's input.
  const row = doc.createElement("button"); row.className = "ctx-inst"; row.dataset.treeInstance = "a"; row.tabIndex = 0;
  doc.querySelector(".ctx-list").append(row);
  const nav = doc.createElement("button"); nav.className = "nav-item"; doc.getElementById("nav").append(nav);
  const menu = doc.createElement("div"); menu.setAttribute("role", "menu");
  const item = doc.createElement("button"); item.setAttribute("role", "menuitem"); menu.append(item);
  doc.querySelector(".ctx-list").append(menu);
  const xterm = doc.createElement("div"); xterm.className = "xterm";
  const textarea = doc.createElement("textarea"); textarea.className = "xterm-helper-textarea"; xterm.append(textarea);
  doc.getElementById("main").append(xterm);
  const ran = [];
  const offs = SIDEBAR_KEYS.map(({ id }) => registerAction({ id, label: id, context: "sidebar", run: () => ran.push(id) }));
  t.after(() => { offs.forEach(off => off()); setActiveContexts(new Set()); resetAllBindings(); win.close(); });
  /** Focus `el`, set the contexts as the shell does on focus, press `chord` there: the action matched. */
  const pressAt = (el, chord) => {
    el.focus();
    updateActiveContexts(); // as the shell does on every focusin
    const e = keydownFor(win, chord);
    Object.defineProperty(e, "target", { value: el });
    return matchEvent(e, { isMac: false });
  };
  return { win, doc, row, nav, item, textarea, pressAt, ran, sidebarKeysLive,
    filter: doc.querySelector(".ctx-filter"), footer: doc.getElementById("sidebar-spawn"), main: doc.getElementById("show-panel") };
}

test("each sidebar key fires on a roster row, a nav button and a footer control, by its real (shifted) keydown", t => {
  const r = rig(t);
  for (const { id } of SIDEBAR_KEYS) {
    const chord = getBinding(id, false);
    assert.ok(chord, `${id} has a default`);
    for (const [where, el] of [["row", r.row], ["nav", r.nav], ["footer", r.footer]]) {
      assert.equal(r.pressAt(el, chord), id, `${id} (${chord}) on the ${where}`);
    }
  }
});

test("never in the roster filter, never in an open menu, never with focus in main or a terminal", t => {
  const r = rig(t);
  r.main.hidden = false;
  for (const { id } of SIDEBAR_KEYS) {
    const chord = getBinding(id, false);
    assert.equal(r.pressAt(r.filter, chord), null, `${id}: the filter types it`);
    assert.equal(r.pressAt(r.item, chord), null, `${id}: an instance's actions menu is its own`);
    assert.equal(r.pressAt(r.textarea, chord), null, `${id}: the terminal's`);
    assert.equal(r.pressAt(r.main, chord), null, `${id}: the main area's`);
  }
  r.row.focus();
  assert.equal(r.sidebarKeysLive(), true);
  r.textarea.focus();
  assert.equal(r.sidebarKeysLive(), false);
});

test("letters keep their case: n spawns, Shift+N spawns another; X is Shift+x, x is nothing", t => {
  const r = rig(t);
  assert.equal(r.pressAt(r.row, "N"), "sidebar.key.spawn");
  assert.equal(r.pressAt(r.row, "Shift+N"), "sidebar.key.spawnAnother");
  assert.equal(r.pressAt(r.row, "Shift+X"), "sidebar.key.stop");
  assert.equal(r.pressAt(r.row, "X"), null, "a lower-case x is one slip away: not Stop");
  assert.equal(r.pressAt(r.row, "\\"), null, "a plain \\ is not |");
});

test("rebindable and unbindable in the editor's terms", t => {
  const r = rig(t);
  setBinding("sidebar.key.refresh", "Shift+F");
  assert.equal(r.pressAt(r.row, "Shift+F"), "sidebar.key.refresh");
  assert.equal(r.pressAt(r.row, "R"), null);
  setBinding("sidebar.key.workspaces", null);
  assert.equal(r.pressAt(r.row, "W"), null, "unbound");
});

test("shell wiring: the sidebar context follows focus; the keys run the leader's `does`", () => {
  assert.match(shell, /document\.addEventListener\("focusin", \(\) => updateActiveContexts\(\)\);/);
  assert.match(shell, /for \(const \{ id, does \} of SIDEBAR_KEYS\) \{\n  registerAction\(\{ id, label: leaderLabel\(does, actionLabel\), context: "sidebar",/);
  assert.match(shell, /leaderDispatch\.run\(does, \{ targetId: leaderTargetId\(/);
});
