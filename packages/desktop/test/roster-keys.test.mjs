// sidebar roster tree keyboard policy — pure, per house style.
import test from "node:test";
import assert from "node:assert/strict";
import { rosterKeyAction, rosterKeyDoes, moveTarget, rovingIndex } from "../renderer/roster-keys.mjs";
import { plainKeys } from "../../client/keymap.mjs";
import { registerAction, setBinding, resetAllBindings, setActiveContexts, setChordFamily, getBinding, handleKeydown } from "../renderer/keybindings.mjs";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { CHORD_FAMILIES } from "../../client/keymap.mjs";
import { pinPlatform } from "./helpers/platform.mjs";

test("arrows walk rows; Right expands a collapsed branch, else moves down", () => {
  assert.deepEqual(rosterKeyAction({ key: "ArrowDown" }), { type: "move", delta: 1 });
  assert.deepEqual(rosterKeyAction({ key: "ArrowUp" }), { type: "move", delta: -1 });
  assert.deepEqual(rosterKeyAction({ key: "ArrowRight" }, { hasChildren: true, collapsed: true }), { type: "expand" });
  assert.deepEqual(rosterKeyAction({ key: "ArrowRight" }, { hasChildren: true, collapsed: false }), { type: "move", delta: 1 });
  assert.deepEqual(rosterKeyAction({ key: "ArrowRight" }, { hasChildren: false }), { type: "move", delta: 1 });
});

test("Left collapses an open branch, else jumps to the parent row", () => {
  assert.deepEqual(rosterKeyAction({ key: "ArrowLeft" }, { hasChildren: true, collapsed: false }), { type: "collapse" });
  assert.deepEqual(rosterKeyAction({ key: "ArrowLeft" }, { hasChildren: true, collapsed: true }), { type: "parent" });
  assert.deepEqual(rosterKeyAction({ key: "ArrowLeft" }, { hasChildren: false }), { type: "parent" });
});

test("Home/End jump; unowned keys return null (Enter stays native)", () => {
  assert.deepEqual(rosterKeyAction({ key: "Home" }), { type: "move", to: "first" });
  assert.deepEqual(rosterKeyAction({ key: "End" }), { type: "move", to: "last" });
  assert.equal(rosterKeyAction({ key: "Enter" }), null);
  assert.equal(rosterKeyAction({ key: "a" }), null);
});

test("moveTarget clamps at the edges (no wrap) and handles empty lists", () => {
  assert.equal(moveTarget({ delta: 1 }, 2, 3), 2, "clamped at last");
  assert.equal(moveTarget({ delta: -1 }, 0, 3), 0, "clamped at first");
  assert.equal(moveTarget({ delta: 1 }, 0, 3), 1);
  assert.equal(moveTarget({ to: "first" }, 2, 3), 0);
  assert.equal(moveTarget({ to: "last" }, 0, 3), 2);
  assert.equal(moveTarget({ delta: 1 }, 0, 0), -1);
});

test("rovingIndex keeps exactly one tabbable row", () => {
  assert.equal(rovingIndex(3, 1), 1);
  assert.equal(rovingIndex(3, -1), 0, "no focus -> first row tabbable");
  assert.equal(rovingIndex(3, 7), 0, "stale focus index falls back to first");
  assert.equal(rovingIndex(0, 0), -1);
});

// The TUI's letters beside the arrows (packages/client/keymap.mjs PLAIN_KEYS: up, down, top, bottom,
// collapse, expand), read as the keyboard reports them: G is Shift+g.
test("k j g G h l do what the arrows, Home and End do; held with Ctrl, Alt or ⌘ they are not the tree's", () => {
  for (const [letter, arrow] of [["k", "ArrowUp"], ["j", "ArrowDown"], ["g", "Home"], ["G", "End"]]) {
    assert.deepEqual(rosterKeyAction({ key: letter }), rosterKeyAction({ key: arrow }), `${letter} is ${arrow}`);
  }
  for (const row of [{ hasChildren: true, collapsed: true }, { hasChildren: true, collapsed: false }, { hasChildren: false }]) {
    assert.deepEqual(rosterKeyAction({ key: "l" }, row), rosterKeyAction({ key: "ArrowRight" }, row));
    assert.deepEqual(rosterKeyAction({ key: "h" }, row), rosterKeyAction({ key: "ArrowLeft" }, row));
  }
  assert.equal(rosterKeyAction({ key: "K" }), null, "K is not k");
  for (const mods of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) assert.equal(rosterKeyAction({ key: "j", ...mods }), null);
  assert.deepEqual(rosterKeyAction({ key: "ArrowDown", shiftKey: true }), { type: "move", delta: 1 }, "the arrows as they always were");
  assert.deepEqual(rosterKeyAction({ key: "ArrowDown", ctrlKey: true }), { type: "move", delta: 1 });
  // With nothing bound in the keymap, every modifier on an arrow is still the tree's.
  for (const mods of [{ altKey: true, shiftKey: true }, { altKey: true }, { metaKey: true }]) {
    assert.deepEqual(rosterKeyAction({ key: "ArrowUp", ...mods }), { type: "move", delta: -1 }, JSON.stringify(mods));
  }
  // The letters are the shared table's, not a copy of it.
  for (const does of ["up", "down", "top", "bottom", "collapse", "expand", "page-up", "page-down"]) {
    for (const key of plainKeys(does)) {
      const named = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown" }[key] ?? key;
      assert.equal(rosterKeyDoes({ key: named }), does, `${key} → ${does}`);
    }
  }
});

test("PageUp/PageDown move by the rows that fit the list, clamped", () => {
  assert.deepEqual(rosterKeyAction({ key: "PageDown" }), { type: "move", page: 1 });
  assert.deepEqual(rosterKeyAction({ key: "PageUp" }), { type: "move", page: -1 });
  assert.equal(moveTarget({ page: 1 }, 2, 30, 8), 10);
  assert.equal(moveTarget({ page: -1 }, 10, 30, 8), 2);
  assert.equal(moveTarget({ page: 1 }, 25, 30, 8), 29, "clamped at last");
  assert.equal(moveTarget({ page: -1 }, 3, 30, 8), 0, "clamped at first");
  assert.equal(moveTarget({ page: 1 }, 0, 30, 0), 1, "a list too short for one row still moves one");
  assert.equal(moveTarget({ delta: 1 }, 0, 30, 8), 1, "an arrow is still one row");
});

// A named key the keymap binds is the keymap's on a row (keybindings.mjs keymapTakes): the live keymap, never a
// fixed list, so each chord family's arrow chords do their own work from a row, and a rebind follows; an arrow chord
// bound to nothing (Ctrl+Shift+↓) still moves, as it always did. The actions are the shell's, with its contexts:
// the instance and workspace steps are global; the tab and group moves are the tab layer's (`tabs`).
const ARROW_ACTIONS = [["roster.openPrevious", "global"], ["roster.openNext", "global"], ["workspace.previous", "global"],
  ["workspace.next", "global"], ["tabs.prevPage", "tabs"], ["tabs.nextPage", "tabs"], ["split.focusPrevGroup", "tabs"], ["split.focusNextGroup", "tabs"]];
const ARROWS = { "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight" };
const press = (chord) => {
  const parts = chord.split("+"), key = ARROWS[parts.at(-1)];
  return key ? { key, altKey: parts.includes("Alt"), shiftKey: parts.includes("Shift"), ctrlKey: parts.includes("Ctrl") } : null;
};
function shellArrowActions(t, run = () => {}) {
  pinPlatform(t); // the Linux and Windows keymap (not the Mac's)
  resetAllBindings();
  const offs = ARROW_ACTIONS.map(([id, context]) => registerAction({ id, label: id, context, run: () => run(id) }));
  setActiveContexts(["tabs"]); // the tab layer is shown
  t.after(() => { offs.forEach(off => off()); setActiveContexts([]); setChordFamily("alt"); resetAllBindings(); });
}

test("a row gives way to every arrow chord of the keymap's family, and only to those", t => {
  shellArrowActions(t);
  const row = { hasChildren: true, collapsed: false };
  // The Alt family (the default): Alt+↑/↓ the workspaces, Alt+Shift+↑/↓ the instances, Alt+←/→ the tabs and
  // Alt+Shift+←/→ the editor groups (#1491: a row once took Alt+Shift+← as collapse).
  for (const [chord, id] of [["Alt+↑", "workspace.previous"], ["Alt+↓", "workspace.next"], ["Alt+Shift+↑", "roster.openPrevious"],
    ["Alt+Shift+↓", "roster.openNext"], ["Alt+←", "tabs.prevPage"], ["Alt+→", "tabs.nextPage"],
    ["Alt+Shift+←", "split.focusPrevGroup"], ["Alt+Shift+→", "split.focusNextGroup"]]) {
    assert.equal(getBinding(id, false), chord, id);
    assert.equal(rosterKeyAction(press(chord), row), null, `${chord} is ${id}'s`);
  }
  // Every family: what it binds to an arrow is the keymap's on a row; the arrow chords it leaves free are the tree's.
  // The Ctrl+Alt and Ctrl+Shift families bind four: the Alt+Shift arrows (the instances and the tabs); their
  // groups are Ctrl+Alt+A, and they have no workspace move (#1491 B1), so Alt+↑/↓ are the tree's there.
  for (const family of CHORD_FAMILIES) {
    setChordFamily(family);
    const bound = new Set(ARROW_ACTIONS.map(([id]) => getBinding(id, false)).filter(chord => chord && press(chord)));
    assert.equal(bound.size, family === "alt" ? 8 : 4, `${family}: its arrow chords`);
    for (const chord of bound) assert.equal(rosterKeyAction(press(chord), row), null, `${family}: ${chord}`);
    for (const chord of ["Ctrl+Shift+↓", "Ctrl+↑", "Alt+Shift+←", "Alt+←", "Alt+↑", "Alt+↓"].filter(chord => !bound.has(chord))) {
      assert.notEqual(rosterKeyAction(press(chord), row), null, `${family}: ${chord} is bound to nothing: the tree's`);
    }
  }
  setChordFamily("alt");
  assert.deepEqual(rosterKeyAction({ key: "ArrowDown", ctrlKey: true, shiftKey: true }, row), { type: "move", delta: 1 }, "Ctrl+Shift+↓ is bound to nothing");
  setBinding("roster.openNext", "Ctrl+Shift+↓");
  assert.equal(rosterKeyAction({ key: "ArrowDown", ctrlKey: true, shiftKey: true }, row), null, "the rebind is the keymap's");
  assert.deepEqual(rosterKeyAction({ key: "ArrowDown", altKey: true, shiftKey: true }, row), { type: "move", delta: 1 }, "the old default is the tree's again");
});

test("with no tab layer (a page shown), the tab and group moves are not live: a row keeps those arrows for the tree", t => {
  shellArrowActions(t);
  setActiveContexts([]);
  const row = { hasChildren: true, collapsed: false };
  assert.deepEqual(rosterKeyAction(press("Alt+Shift+←"), row), { type: "collapse" });
  assert.deepEqual(rosterKeyAction(press("Alt+→"), { hasChildren: true, collapsed: true }), { type: "expand" });
  assert.equal(rosterKeyAction(press("Alt+↓"), row), null, "the workspace step is global: still the keymap's");
});

// End to end, as the shell wires it: the shipped row handler (shell.mjs onRosterRowKey) on a focused row, and the one
// window keydown listener (handleKeydown). A chord the row gives way to bubbles, unconsumed, and its action runs.
test("Alt+Shift+← on a focused roster row moves to the previous editor group, and the row does not collapse", t => {
  const ran = [];
  shellArrowActions(t, id => ran.push(id));
  const source = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
  const handler = source.match(/function onRosterRowKey\(e\) \{[^]*?\n\}/)[0];
  const tree = [];
  const { onRosterRowKey } = runInNewContext(`${handler}\n({ onRosterRowKey })`, {
    rosterKeyAction, tabOpenIntents: { invalidate: () => tree.push("invalidate") },
    // Anything past the policy is the tree's own work: recorded, never expected here.
    expandRow: () => tree.push("expand"), collapseRow: () => tree.push("collapse"), toggleRosterNode: () => tree.push("toggle"),
  });
  const dom = new JSDOM(`<!doctype html><button data-roster-children="1" data-roster-collapsed="0">row</button>`);
  t.after(() => dom.window.close());
  const row = dom.window.document.querySelector("button");
  row.addEventListener("keydown", onRosterRowKey);
  dom.window.document.addEventListener("keydown", e => handleKeydown(e, { isMac: false }));
  row.focus();
  for (const [key, id] of [["ArrowLeft", "split.focusPrevGroup"], ["ArrowRight", "split.focusNextGroup"]]) {
    const event = new dom.window.KeyboardEvent("keydown", { key, altKey: true, shiftKey: true, bubbles: true, cancelable: true });
    row.dispatchEvent(event);
    assert.equal(ran.at(-1), id, `Alt+Shift+${key}: the group move ran`);
    assert.equal(event.defaultPrevented, true, "the keymap consumed it");
  }
  assert.deepEqual(tree, [], "the tree did nothing");
});
