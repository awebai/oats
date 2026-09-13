// Split panes + hideable sidebar — shell wiring pins (keybindings-wiring
// house style: source-level assertions without booting Electron) plus the
// engine's default chords and shipped pane-selection behavior.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { runInNewContext } from "node:vm";
import { createSelectionOwnership, wirePaneSelection } from "../renderer/selection-ownership.mjs";
import { createTabChrome } from "../renderer/tab-a11y.mjs";
import { canActivateTab } from "../renderer/workspace-tabs.mjs";
import {
  DEFAULT_KEYMAP, TERMINAL_ALLOWLIST, parseChord, matchEvent, registerAction,
  setActiveContexts,
} from "../renderer/keybindings.mjs";
import {
  requestSplit, openTabInFocusedGroup,
} from "../renderer/split-layout.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(PKG, f), "utf8");

test("split + sidebar actions have parseable default chords; splits are terminal-allowlisted", () => {
  for (const id of ["sidebar.toggle", "split.vertical", "split.horizontal", "split.close"]) {
    assert.ok(DEFAULT_KEYMAP[id], `${id} has a default chord`);
    assert.ok(parseChord(DEFAULT_KEYMAP[id]), `${id} chord parses`);
  }
  for (const id of ["split.vertical", "split.horizontal", "split.close"]) {
    assert.ok(TERMINAL_ALLOWLIST.includes(id),
      `${id} must fire inside xterm on Linux/Windows (the active pane IS a terminal)`);
  }
  // sidebar.toggle (Mod+B) must NOT be allowlisted: on non-mac its chord is
  // Ctrl+B — the tmux prefix — which belongs to the attached program.
  assert.ok(!TERMINAL_ALLOWLIST.includes("sidebar.toggle"),
    "sidebar.toggle would shadow the tmux prefix (Ctrl+B) inside xterm");
});

test("non-mac Ctrl+B inside xterm resolves to NO desktop action (tmux prefix passes through)", (t) => {
  t.after(() => setActiveContexts(new Set()));
  const offs = [
    registerAction({ id: "sidebar.toggle", label: "sb", context: "global", run: () => {} }),
    registerAction({ id: "split.vertical", label: "v", context: "tabs", run: () => {} }),
  ];
  t.after(() => offs.forEach((off) => off()));
  setActiveContexts(new Set(["tabs"]));
  assert.equal(matchEvent(
    { key: "b", ctrlKey: true, shiftKey: false, metaKey: false, altKey: false, defaultPrevented: false },
    { isMac: false, insideTerminal: true, editableTarget: false },
  ), null, "Ctrl+B reaches tmux, not sidebar.toggle");
  // outside the terminal the binding works normally
  assert.equal(matchEvent(
    { key: "b", ctrlKey: true, shiftKey: false, metaKey: false, altKey: false, defaultPrevented: false },
    { isMac: false, insideTerminal: false, editableTarget: false },
  ), "sidebar.toggle");
  // and on mac, ⌘B inside xterm still fires (⌘-chord rule)
  assert.equal(matchEvent(
    { key: "b", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false },
    { isMac: true, insideTerminal: true, editableTarget: false },
  ), "sidebar.toggle");
});

test("shell registers the split and sidebar actions and exposes them in the palette", () => {
  const src = read("renderer/shell.mjs");
  for (const id of ["sidebar.toggle", "split.vertical", "split.horizontal", "split.close"]) {
    assert.match(src, new RegExp(`id: "${id.replace(".", "\\.")}"`), `action ${id} registered`);
    assert.match(src, new RegExp(`chordDetail\\("${id.replace(".", "\\.")}"\\)`), `palette shows ${id}'s chord`);
  }
  // splits arrange TERMINAL tabs on the tab layer
  assert.match(src, /id: "split\.vertical", label: [^\n]*context: "tabs"/, "split actions live in the tabs context");
});

test("splits are terminal-only, route through editor-group transitions, and restore per workspace", () => {
  const src = read("renderer/shell.mjs");
  assert.match(src, /if \(!t \|\| t\.kind !== "terminal"\) return; \/\/ splits are terminal-only/);
  // activation routes through the SAME tab path every open uses — identity
  // resolution and dedup are untouched (soul invariant): members focus
  // their group; NEW terminal tabs open into the FOCUSED group.
  assert.match(src, /\? focusTab\(split, id\)\.split/);
  assert.match(src, /: openTabInFocusedGroup\(split, id\)\.split/);
  assert.match(src, /const removed = removeSplitTab\(split, id\)/);
  assert.match(src, /onWorkspaceChange\(restoreWorkspaceTabs\)/);
  assert.match(src, /split = restored\.split/);
});

test("sidebar toggle is class-driven and persisted like other shell prefs", () => {
  const src = read("renderer/shell.mjs");
  assert.match(src, /const SIDEBAR_HIDDEN_KEY = "oats-desktop-sidebar-hidden"/);
  assert.match(src, /classList\.toggle\("sidebar-hidden", on\)/);
  assert.match(src, /localStorage\.getItem\(SIDEBAR_HIDDEN_KEY\) === "1"/, "restored at startup");
  const css = read("renderer/shell.css");
  assert.match(css, /#app\.sidebar-hidden #sidebar \{ display: none; \}/);
});

test("split CSS turns group cells into flex cells in both orientations", () => {
  const css = read("renderer/shell.css");
  assert.match(css, /#tabhost\.split-row \{ display: flex; flex-direction: row; \}/);
  assert.match(css, /#tabhost\.split-col \{ display: flex; flex-direction: column; \}/);
  // split cells leave absolute positioning so flex can size them; xterm's
  // FitAddon then refits via each tab's ResizeObserver
  assert.match(css, /\.tab-pane\.split-cell \{ position: relative; inset: auto; flex: 1 1 0; min-width: 0; min-height: 0; \}/);
  assert.match(css, /\.group-cell \{ display: flex; flex-direction: column; flex: 1 1 0/);
});

test("split default chords match REAL key events — Shift+\\ arrives as event.key '|'", (t) => {
  t.after(() => setActiveContexts(new Set()));
  const offs = [
    registerAction({ id: "split.vertical", label: "v", context: "tabs", run: () => {} }),
    registerAction({ id: "split.horizontal", label: "h", context: "tabs", run: () => {} }),
  ];
  t.after(() => offs.forEach((off) => off()));
  setActiveContexts(new Set(["tabs"]));
  // mac: physical Cmd+Shift+\ — the browser reports the SHIFTED character
  assert.equal(matchEvent(
    { key: "|", metaKey: true, shiftKey: true, ctrlKey: false, altKey: false, defaultPrevented: false },
    { isMac: true, insideTerminal: false, editableTarget: false },
  ), "split.horizontal");
  assert.equal(matchEvent(
    { key: "\\", metaKey: true, shiftKey: false, ctrlKey: false, altKey: false, defaultPrevented: false },
    { isMac: true, insideTerminal: false, editableTarget: false },
  ), "split.vertical");
  // non-mac inside xterm: allowlisted, Ctrl plays Mod
  assert.equal(matchEvent(
    { key: "|", ctrlKey: true, shiftKey: true, metaKey: false, altKey: false, defaultPrevented: false },
    { isMac: false, insideTerminal: true, editableTarget: false },
  ), "split.horizontal");
});

test("pane-selection disposer removes pointer and focus entry listeners", () => {
  const dom = new JSDOM(`<div id="pane"><input></div>`);
  try {
    const pane = dom.window.document.getElementById("pane");
    let selected = 0;
    const off = wirePaneSelection(pane, {
      isVisible: () => true, isApplyingFocus: () => false, select: () => selected++,
    });
    pane.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
    pane.querySelector("input").focus();
    assert.equal(selected, 2);
    off();
    pane.querySelector("input").blur();
    pane.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
    pane.querySelector("input").focus();
    assert.equal(selected, 2);
  } finally { dom.window.close(); }
});

test("closing the active split member activates the model-chosen successor, not the newest tab", () => {
  const src = read("renderer/shell.mjs");
  assert.match(src, /const splitSuccessor = activeTab === id \? removed\.successor : null/,
    "successor comes from the model's removeSplitTab (adjacent in the group, else neighbor group's active)");
  assert.match(src, /if \(splitSuccessor != null && tabs\.has\(splitSuccessor\)\) \{\n\s*activateTab\(splitSuccessor\)/,
    "split successor wins over fallbackTabForContext");
});

test("shipped addTab wires visible pane entry through selectTab, without treating programmatic focus as user intent", () => {
  const dom = new JSDOM(`<div id="bar"></div><div id="host"></div>`);
  try {
    const { document } = dom.window;
    const c = {
      document, navigator: { platform: "MacIntel" }, tabs: new Map(), nextTabId: 1,
      activeTab: null, tabLayerVisible: true,
      currentWorkspace: () => "A", workspaceGeneration: () => 0,
      tabbar: document.getElementById("bar"), tabhost: document.getElementById("host"),
      createTabChrome, canActivateTab, wirePaneSelection,
      onTabKeydown() {}, closeTab() {},
      // Projection is covered in selection-ownership.test.mjs. Keep two
      // panes visible here (a split) and record the real selection boundary.
      activateTab(id) { c.activeTab = id; c.tabs.get(id).paneEl.hidden = false; return true; },
    };
    c.tabOpenIntents = createSelectionOwnership(c);
    const src = read("renderer/shell.mjs");
    const functions = ["addTab", "selectTab"].map(name => {
      const match = src.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
      assert.ok(match, `exercise shipped ${name}`); return match[0];
    });
    const { addTab } = runInNewContext(`${functions.join("\n")}\n({ addTab });`, c);
    const a = addTab({ title: "a", workspace: "A" });
    const b = addTab({ title: "b", workspace: "A" });
    const inputA = document.createElement("input"), inputB = document.createElement("input");
    a.paneEl.append(inputA); b.paneEl.append(inputB);
    const pointer = pane => pane.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true }));
    let older = c.tabOpenIntents.begin();
    pointer(a.paneEl);
    assert.equal(c.activeTab, a.id); assert.equal(older(), false, "pane entry uses explicit selection");
    older = c.tabOpenIntents.begin(); inputB.focus();
    assert.equal(c.activeTab, b.id); assert.equal(older(), false, "native keyboard focus selects its visible pane");
    older = c.tabOpenIntents.begin(); pointer(b.paneEl);
    assert.equal(older(), false, "already-selected pane still supersedes an older open");

    older = c.tabOpenIntents.begin();
    c.tabOpenIntents.applyFocus(() => inputA.focus());
    assert.equal(c.activeTab, b.id); assert.equal(older(), true, "programmatic focus must not mint another selection ticket");
    inputA.blur(); inputA.focus();
    assert.equal(c.activeTab, a.id); assert.equal(older(), false, "later actual focus is not suppressed");

    for (const guard of ["layer", "pane", "workspace"]) {
      c.tabLayerVisible = guard !== "layer";
      b.paneEl.hidden = guard === "pane";
      c.tabs.get(b.id).workspace = guard === "workspace" ? "B" : "A";
      older = c.tabOpenIntents.begin();
      inputB.blur(); pointer(b.paneEl); inputB.focus();
      assert.equal(c.activeTab, a.id, `${guard}: hidden/foreign pane cannot select`);
      assert.equal(older(), true, `${guard}: ignored events must not cancel the live intent`);
    }
  } finally { dom.window.close(); }
});

test("activateTab keeps single-selection a11y per surface: one aria-selected per tablist", () => {
  const src = read("renderer/shell.mjs");
  assert.match(src, /t\.triggerEl\.setAttribute\("aria-selected", String\(on\)\)/);
  assert.match(src, /t\.paneEl\.classList\.toggle\("active", on\)/,
    "shown group-active panes stay .active so their ResizeObservers refit");
});

test("splitPane → activateTab → open terminal fills the NEW group (review ddbbe3b blocker)", () => {
  // Reproduce the shell's REAL sequence with the model transitions the
  // wiring pins bind it to: splitPane runs requestSplit (focuses the new
  // empty group) and then re-renders via activateTab with keepGroupFocus —
  // which must NOT route through focusTab, or group focus snaps back to the
  // source member and the next terminal opens in the ORIGINAL group,
  // leaving the empty group unreachable.
  const src = read("renderer/shell.mjs");
  assert.match(src, /activateTab\(activeTab, \{ keepGroupFocus: true \}\)/,
    "splitPane re-renders without moving group focus");
  assert.match(src, /split && !keepGroupFocus\) \{/,
    "activateTab honors keepGroupFocus before focusTab/openTabInFocusedGroup");
  // model-level replay of the full sequence
  let split = requestSplit(null, "row", [1, 2], 1).split;
  const newGroup = split.focusedGroup;
  // splitPane's re-render: activateTab(activeTab, { keepGroupFocus: true })
  // skips the member transition entirely — group focus stays on the new group
  assert.equal(split.focusedGroup, newGroup);
  // the next terminal the user opens (roster/palette/quick-open → addTab →
  // activateTab without keepGroupFocus → openTabInFocusedGroup)
  split = openTabInFocusedGroup(split, 3).split;
  const g2 = split.groups.find((g) => g.id === newGroup);
  assert.deepEqual(g2.tabs, [3], "the new terminal fills the freshly created group");
  assert.equal(g2.activeTab, 3);
  // and a subsequent split from that member repeats the pattern
  const again = requestSplit(split, "row", null, null).split;
  assert.equal(again.groups.length, 3);
  assert.equal(again.focusedGroup, again.groups[2].id, "the newest group is focused again");
  const filled = openTabInFocusedGroup(again, 4).split;
  assert.deepEqual(filled.groups[2].tabs, [4]);
});
