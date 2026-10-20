// sidebar roster tree keyboard policy — pure, per house style.
import test from "node:test";
import assert from "node:assert/strict";
import { rosterKeyAction, rosterKeyDoes, moveTarget, rovingIndex } from "../renderer/roster-keys.mjs";
import { plainKeys } from "../../client/keymap.mjs";
import { registerAction, setBinding, resetAllBindings } from "../renderer/keybindings.mjs";

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

// A named key the keymap binds is the keymap's on a row (keybindings.mjs keymapTakes), so the shared
// Alt+Shift+↑/↓ (roster.openPrevious / roster.openNext) open the terminal above / below from a row, and
// a rebind follows; an arrow chord bound to nothing (Alt+↑, Ctrl+↓) still moves, as it always did.
test("a row gives way to the keymap's arrow chords, and only to those", t => {
  resetAllBindings();
  const offs = ["roster.openPrevious", "roster.openNext", "tabs.prevPage", "tabs.nextPage"]
    .map(id => registerAction({ id, label: id, context: "global", run: () => {} }));
  t.after(() => { offs.forEach(off => off()); resetAllBindings(); });
  const row = { hasChildren: true, collapsed: false };
  for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
    assert.equal(rosterKeyAction({ key, altKey: true, shiftKey: true }, row), null, `Alt+Shift+${key} is the keymap's`);
  }
  assert.deepEqual(rosterKeyAction({ key: "ArrowUp", altKey: true }, row), { type: "move", delta: -1 }, "Alt+↑ is bound to nothing");
  assert.deepEqual(rosterKeyAction({ key: "ArrowDown", ctrlKey: true, shiftKey: true }, row), { type: "move", delta: 1 });
  setBinding("roster.openNext", "Ctrl+Shift+↓");
  assert.equal(rosterKeyAction({ key: "ArrowDown", ctrlKey: true, shiftKey: true }, row), null, "the rebind is the keymap's");
  assert.deepEqual(rosterKeyAction({ key: "ArrowDown", altKey: true, shiftKey: true }, row), { type: "move", delta: 1 }, "the old default is the tree's again");
});
