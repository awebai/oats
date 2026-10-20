// keybindings wiring — the shell installs ONE engine keydown listener and
// every mouse affordance is registered as a rebindable action. Source-level
// assertions in the shell-nav.test.mjs house style: they pin the wiring
// without booting Electron.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(PKG, f), "utf8");

test("shell installs exactly one window keydown listener: the engine's handleKeydown", () => {
  const src = read("renderer/shell.mjs");
  const listeners = [...src.matchAll(/window\.addEventListener\("keydown"/g)];
  assert.equal(listeners.length, 1, "ONE window keydown listener (contract)");
  // engine addendum: handleKeydown itself skips defaultPrevented events,
  // so the shell listener is a bare delegation.
  assert.match(src, /window\.addEventListener\("keydown", \(e\) => handleKeydown\(e\)\)/);
  assert.ok(!/isPaletteShortcut\(/.test(src), "ad-hoc palette shortcut check replaced by the engine");
});

test("shell registers global + tabs actions covered by the engine's DEFAULT_KEYMAP", () => {
  const src = read("renderer/shell.mjs");
  for (const id of [
    "app.palette", "app.shortcuts", "app.themeToggle", "app.workspaces", "sidebar.focusFilter",
    "terminal.fontBigger", "terminal.fontSmaller", "terminal.fontReset",
    "tabs.next", "tabs.prev", "tabs.close",
  ]) assert.match(src, new RegExp(`id: "${id.replace(".", "\\.")}"`), `action ${id} registered`);
  assert.match(src, /NAV\.forEach\(\(v\) => registerAction\(/, "stage actions derive from the nav manifest");
  assert.match(src, /setActiveContexts/, "shell drives active contexts");
});

test("hierarchy and spawn views register rebindable view-local actions and dispose them", () => {
  const hier = read("renderer/views/hierarchy.mjs");
  for (const id of ["hier.fit", "hier.terminal", "hier.brain", "hier.spawn", "hier.popover", "hier.zoomIn", "hier.zoomOut"]) {
    assert.match(hier, new RegExp(`id: "${id.replace(".", "\\.")}", defaultChord:`), `hierarchy action ${id} declared`);
  }
  assert.match(hier, /context: "view:hierarchy"/, "hierarchy actions use a never-activated view context (editor-visible, window-dispatch-ineligible — review afd2114)");
  assert.match(hier, /run: guarded\(a\.run\)|context: "view:hierarchy"/, "outside keypresses cannot be swallowed");
  assert.match(hier, /s\.disposers = s\.viewActions\.map/, "hierarchy keeps action disposers");
  assert.match(hier, /\(s\.disposers \|\| \[\]\)\.forEach/, "hierarchy disposes actions on teardown");
  assert.match(hier, /resolveViewKey\(e, s\.viewActions\)/, "canvas keys resolve through the engine keymap (rebindable)");

  const spawn = read("renderer/views/spawn.mjs");
  for (const id of ["spawn.filter", "spawn.brain"]) {
    assert.match(spawn, new RegExp(`id: "${id.replace(".", "\\.")}"`), `spawn action ${id}`);
  }
  assert.match(spawn, /context: "view:spawn"/, "spawn actions use the never-activated view context");
  assert.match(spawn, /resolveViewKey\(/, "spawn keys resolve through the engine keymap");
  assert.match(spawn, /\(state\.disposers \|\| \[\]\)\.forEach/, "spawn disposes actions on unmount");
});

test("palette rows and data-action tooltips carry live chord labels", () => {
  const shell = read("renderer/shell.mjs");
  assert.match(shell, /detail: chordDetail\(/, "palette commands show the current chord");
  assert.match(shell, /onKeymapChange\(\(\) => applyChordTitles\(\)\)/, "tooltips live-update on rebinding");
  const palette = read("renderer/palette.mjs");
  assert.match(palette, /typeof c\.detail === "function" \? c\.detail\(\)/, "palette re-evaluates chord details per render");
});

test("view-local defaults are first-class engine bindings (registerAction defaultChord)", () => {
  // engine addendum 3: dynamic view actions carry their default in the
  // registration; getBinding folds override ?? DEFAULT_KEYMAP ?? defaultChord,
  // so the editor shows real defaults and Backspace-unbind kills the key.
  const hier = read("renderer/views/hierarchy.mjs");
  const expected = {
    "hier.fit": "F", "hier.terminal": "T", "hier.brain": "B", "hier.spawn": "S",
    "hier.popover": "O", "hier.zoomIn": "=", "hier.zoomOut": "-",
  };
  for (const [id, chord] of Object.entries(expected)) {
    assert.match(hier, new RegExp(`id: "${id.replace(".", "\\.")}", defaultChord: "${chord === "=" ? "=" : chord}"`),
      `${id} registers defaultChord ${chord}`);
  }
  assert.match(hier, /registerAction\(\{\n?\s*id: a\.id,.*defaultChord: a\.defaultChord,?\n?\s*\}\)/s,
    "hierarchy passes defaultChord through registerAction");
  const spawn = read("renderer/views/spawn.mjs");
  assert.match(spawn, /id: "spawn\.filter", label:.*defaultChord: "\/"/, "spawn.filter default '/'");
  assert.match(spawn, /id: "spawn\.brain", label:.*defaultChord: "B"/, "spawn.brain default B");
});

test("the leader is wired as one rebindable global action, inert under a modal, with its hint and footer button", () => {
  const src = read("renderer/shell.mjs");
  assert.match(src, /registerAction\(\{ id: "app\.leader", label: "Leader: the commands that follow one key", context: "global", when: \(\) => !modalOpen\(\),/);
  assert.match(src, /const leader = createLeader\(\{ win: window, isMac, modalOpen,/);
  assert.match(src, /onSettle: \(does, origin\) => \{ const why = notApplicable\(does\); if \(why\) sayInHint\(why\); else leaderDispatch\.run\(does, origin\); \}/);
  assert.match(src, /createLeaderHint\(\{ doc: document, host: document\.getElementById\("main"\), before: document\.getElementById\("show-panel"\) \}\)/);
  assert.match(src, /registerAction\(\{ id: "split\.focusNextGroup", label: "Focus the next editor group", context: "tabs",/);
  // The footer's button starts it, toggles off on a second click, and names the live chord.
  assert.match(src, /leaderButton\?\.addEventListener\("click", \(\) => \{ if \(!modalOpen\(\)\) leader\.toggle\(\{ opener: leaderButton,/);
  assert.match(src, /const chord = getBinding\("app\.leader", isMac\);\n    const name = chord \? `Commands: \$\{formatChord\(chord, isMac\)\}, then one key`/);
  const html = read("renderer/index.html");
  const foot = html.slice(html.indexOf('<div id="nav-foot">'));
  assert.ok(foot.indexOf('id="sidebar-leader"') < foot.indexOf('id="sidebar-spawn"'), "the leader's hint is the footer's first control");
  assert.match(foot, /<kbd class="shortcut-hint" data-shortcut="app\.leader" aria-hidden="true" hidden><\/kbd><span aria-hidden="true">commands<\/span>/);
  // A terminal's interception goes through matchEvent, which a let-through event (the leader twice) passes.
  assert.match(read("renderer/keybindings.mjs"), /if \(e\.defaultPrevented \|\| letThroughEvents\.has\(e\)\) return null;/);
});

// The views whose arrow keys are their own give way to the keymap where it binds the chord (the
// shared Alt+Shift+↑/↓, ⌘⌥↑/↓, or a rebind), never by modifier: an unbound Alt+↑ or ⌘↑ stays theirs.
// Behaviour: test/roster-keys, spawn-grid-keys and instance-actions; the overview canvas here.
test("the overview canvas, the Souls grid, the roster tree and the actions trigger ask keymapTakes", () => {
  assert.match(read("renderer/views/hierarchy.mjs"), /if \(!\["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"\]\.includes\(e\.key\) \|\| keymapTakes\(e\)\) return;\n  e\.preventDefault\(\);/);
  assert.match(read("renderer/views/spawn.mjs"), /\["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"\]\.includes\(e\.key\) && keymapTakes\(e\)\) return;/);
  assert.match(read("renderer/roster-keys.mjs"), /if \(named && keymapTakes\(event\)\) return null;/);
  assert.match(read("renderer/instance-actions.mjs"), /if \(!\["ArrowDown", "ArrowUp"\]\.includes\(event\.key\) \|\| keymapTakes\(event\)\) return;/);
  for (const file of ["renderer/views/hierarchy.mjs", "renderer/views/spawn.mjs", "renderer/roster-keys.mjs", "renderer/instance-actions.mjs"]) {
    assert.doesNotMatch(read(file), /(?:e|event)\.altKey \|\| (?:e|event)\.metaKey\)\) return/, `${file}: no modifier guess`);
  }
});
