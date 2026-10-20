// Spec F, Part 3: a keymap that is sane on Linux (and Omarchy) as well as macOS.
// The rule: a default chord never takes a key a program inside the terminal reads. Every
// changed default resolves per platform; inside a terminal on Linux/Windows only the allowlisted
// actions fire (chords xterm sends nothing for, or a byte a plainer key still sends, and the named
// exceptions: test/terminal-xterm-bytes.test.mjs), and the program keeps Ctrl+W/K/\/P/B/I/F/O, F6,
// Alt+digit and Ctrl+PgUp/PgDn; on macOS only ⌘ chords (and Ctrl+Tab) fire there, so ⌃digits and F6
// stay the program's.
// Chords are dispatched as the REAL events a keyboard sends (the shifted character in `key`).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  CHORDS_READ, DEFAULT_KEYMAP, TERMINAL_ALLOWLIST, defaultBinding, getBinding, formatChord, isPlainChord,
  registerAction, setActiveContexts, resetAllBindings, setBinding, matchEvent, handleKeydown, findConflict, keymapConflicts,
} from "../renderer/keybindings.mjs";
import { terminalKeyDecision } from "../renderer/terminal-tab.mjs";
import { copyTerminalSelection } from "../renderer/terminal-clipboard.mjs";

const map = new Map();
globalThis.localStorage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };

const ev = (key, mods = {}) => ({
  key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; }, ...mods,
});
// What Linux/Windows sends for Ctrl(+Shift)(+Alt)+key: with Shift, `key` is the shifted character.
const linux = (key, mods = {}) => ev(key, { ctrlKey: true, ...mods });

// Every action the shell registers with a default, in its context (tabs actions live in "tabs", the
// sidebar's plain keys in "sidebar").
const IDS = Object.keys(DEFAULT_KEYMAP);
const contextOf = id => (/^(tabs|split)\./.test(id) ? "tabs" : /^sidebar\.key\./.test(id) ? "sidebar" : "global");
function registerAll(t) {
  resetAllBindings();
  const offs = IDS.map(id => registerAction({ id, label: id, context: contextOf(id), run: () => {} }));
  setActiveContexts(new Set(["tabs"]));
  t.after(() => { offs.forEach(off => off()); setActiveContexts(new Set()); resetAllBindings(); });
}

test("the shipped table: each changed default resolves per platform", () => {
  const table = {
    "app.palette": ["Mod+K", "Ctrl+Alt+K"],
    "app.quickOpenSouls": ["Mod+P", "Ctrl+Alt+P"],
    "app.workspaces": ["Mod+Alt+O", "Ctrl+Alt+O"],
    "app.chooseSoul": ["Mod+N", "Ctrl+Shift+N"],
    "roster.openPrevious": ["Mod+Alt+↑", "Alt+Shift+↑"], "roster.openNext": ["Mod+Alt+↓", "Alt+Shift+↓"],
    "terminal.zoom": ["Mod+Alt+Z", "Ctrl+Alt+Z"],
    "tabs.close": ["Mod+W", "Ctrl+Alt+W"],
    "tabs.next": ["Ctrl+Tab", "Ctrl+Tab"], "tabs.prev": ["Ctrl+Shift+Tab", "Ctrl+Shift+Tab"],
    "tabs.nextPage": ["Mod+Alt+→", "Alt+Shift+→"], "tabs.prevPage": ["Mod+Alt+←", "Alt+Shift+←"],
    "tabs.goto1": ["Mod+Alt+1", "Ctrl+Alt+1"], "tabs.goto9": ["Mod+Alt+9", "Ctrl+Alt+9"],
    "split.vertical": ["Mod+\\", "Ctrl+Alt+E"], "split.horizontal": ["Mod+Shift+\\", "Ctrl+Alt+Shift+E"],
    "split.close": ["Mod+Alt+W", "Ctrl+Shift+Alt+W"], "split.focusNextGroup": ["Mod+Alt+A", "Ctrl+Alt+A"],
    "stage.hierarchy": ["Mod+1", "Mod+1"], "stage.spawn": ["Mod+2", "Mod+2"], "stage.automations": ["Mod+3", "Mod+3"],
    "focus.nextRegion": ["F6", "F6"], "focus.prevRegion": ["Shift+F6", "Shift+F6"],
    "focus.leaveTerminal": ["Mod+Shift+F6", "Mod+Shift+F6"],
    "sidebar.toggle": ["Mod+B", "Ctrl+Shift+B"], "sidebar.focusFilter": ["Mod+F", "Ctrl+Alt+F"], "panel.toggle": ["Mod+I", "Ctrl+Shift+I"],
    "app.themeToggle": [null, null], "app.themePicker": ["Mod+Shift+Space", "Ctrl+Shift+Space"], "app.shortcuts": ["Mod+,", "Mod+,"],
    "terminal.fontBigger": ["Mod+=", "Mod+="], "terminal.fontSmaller": ["Mod+-", "Mod+-"], "terminal.fontReset": ["Mod+0", "Mod+0"],
    "terminal.copySelection": [null, "Ctrl+Shift+C"],
  };
  for (const [id, [mac, other]] of Object.entries(table)) {
    assert.equal(defaultBinding(id, true), mac, `${id} on macOS`);
    assert.equal(defaultBinding(id, false), other, `${id} on Linux/Windows`);
  }
  // Shown as each platform reads it (the shortcuts editor and the hints use getBinding + formatChord).
  assert.equal(formatChord(getBinding("app.palette", false), false), "Ctrl+Alt+K");
  assert.equal(formatChord(getBinding("app.quickOpenSouls", false), false), "Ctrl+Alt+P");
  assert.equal(formatChord(getBinding("app.quickOpenSouls", true), true), "⌘P");
  assert.equal(formatChord(getBinding("tabs.nextPage", false), false), "Alt+Shift+→");
  assert.equal(formatChord(getBinding("tabs.nextPage", true), true), "⌥⌘→");
  assert.equal(formatChord(getBinding("roster.openPrevious", true), true), "⌥⌘↑");
  assert.equal(formatChord(getBinding("split.horizontal", false), false), "Ctrl+Alt+Shift+E");
  assert.equal(formatChord(getBinding("tabs.goto3", false), false), "Ctrl+Alt+3");
  assert.equal(formatChord(getBinding("tabs.goto3", true), true), "⌥⌘3");
  assert.equal(formatChord(getBinding("focus.leaveTerminal", false), false), "Ctrl+Shift+F6");
  assert.equal(formatChord(getBinding("sidebar.toggle", false), false), "Ctrl+Shift+B");
  assert.equal(formatChord(getBinding("sidebar.toggle", true), true), "⌘B");
});

test("nothing binds Super/Meta on Linux/Windows: Mod is Ctrl there", () => {
  for (const id of IDS) {
    const chord = defaultBinding(id, false);
    if (chord) assert.doesNotMatch(chord, /\b(Meta|Cmd|Super)\b/, id);
  }
});

test("the terminal allowlist is exactly the actions that must work in a terminal", () => {
  assert.deepEqual([...TERMINAL_ALLOWLIST].sort(), [
    "app.chooseSoul", "app.leader", "app.palette", "app.quickOpenSouls", "app.shortcuts", "app.themePicker", "app.workspaces", "focus.leaveTerminal",
    "panel.toggle", "roster.openNext", "roster.openPrevious", "sidebar.focusFilter", "sidebar.toggle",
    "split.close", "split.focusNextGroup", "split.horizontal", "split.vertical",
    "stage.automations", "stage.hierarchy", "stage.spawn",
    "tabs.close", "tabs.next", "tabs.nextPage", "tabs.prev", "tabs.prevPage",
    ...Array.from({ length: 9 }, (_, i) => `tabs.goto${i + 1}`),
    "terminal.copySelection", "terminal.fontBigger", "terminal.fontReset", "terminal.fontSmaller", "terminal.zoom",
  ].sort());
  // Every shared chord works in a terminal (CHORDS_READ): the leader's keys are reachable from every focus.
  for (const { id } of CHORDS_READ) assert.ok(TERMINAL_ALLOWLIST.includes(id), `${id} is allowlisted`);
  // No allowlisted default on Linux/Windows is a key a program reads: not a plain Ctrl+letter,
  // not a bare function key, not Alt+digit, not Ctrl+PgUp/PgDn.
  for (const id of TERMINAL_ALLOWLIST) {
    const chord = defaultBinding(id, false);
    assert.doesNotMatch(chord, /^(Mod|Ctrl)\+[A-Za-z\\]$|^(Shift\+)?F\d+$|^Alt\+\d$|^Ctrl\+Page(Up|Down)$/, `${id}: ${chord}`);
  }
});

test("Linux/Windows inside a terminal: the allowlisted chords fire from real (shifted) events", t => {
  registerAll(t);
  const inTerm = { isMac: false, insideTerminal: true };
  for (const [event, id] of [
    [linux("k", { altKey: true }), "app.palette"], [linux("p", { altKey: true }), "app.quickOpenSouls"],
    [linux("o", { altKey: true }), "app.workspaces"],
    [linux("N", { shiftKey: true }), "app.chooseSoul"],
    [linux("w", { altKey: true }), "tabs.close"], [linux("Tab"), "tabs.next"], [linux("Tab", { shiftKey: true }), "tabs.prev"],
    [linux("e", { altKey: true }), "split.vertical"], [linux("E", { altKey: true, shiftKey: true }), "split.horizontal"],
    [linux("W", { shiftKey: true, altKey: true }), "split.close"], [linux("a", { altKey: true }), "split.focusNextGroup"],
    [linux("z", { altKey: true }), "terminal.zoom"], [linux("1", { altKey: true }), "tabs.goto1"], [linux("9", { altKey: true }), "tabs.goto9"],
    // The Alt+Shift arrows (no Ctrl): the leader's ↑ / ↓ and the tab moves.
    [ev("ArrowUp", { altKey: true, shiftKey: true }), "roster.openPrevious"], [ev("ArrowDown", { altKey: true, shiftKey: true }), "roster.openNext"],
    [ev("ArrowLeft", { altKey: true, shiftKey: true }), "tabs.prevPage"], [ev("ArrowRight", { altKey: true, shiftKey: true }), "tabs.nextPage"],
    [linux("F6", { shiftKey: true }), "focus.leaveTerminal"], [linux("C", { shiftKey: true }), "terminal.copySelection"],
    // Allowlisted with this keymap: the moved defaults (e.key is the upper-case letter with Shift),
    // the stages (Ctrl+3 is ESC, which Esc still sends), the shortcuts editor and the zoom chords.
    [linux("B", { shiftKey: true }), "sidebar.toggle"], [linux("I", { shiftKey: true }), "panel.toggle"],
    [linux("f", { altKey: true }), "sidebar.focusFilter"],
    [linux("1"), "stage.hierarchy"], [linux("2"), "stage.spawn"], [linux("3"), "stage.automations"],
    [linux(","), "app.shortcuts"],
    [linux("="), "terminal.fontBigger"], [linux("-"), "terminal.fontSmaller"], [linux("0"), "terminal.fontReset"],
  ]) {
    assert.equal(matchEvent(event, inTerm), id, `${JSON.stringify({ key: event.key, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey })}`);
    const claimed = ev(event.key, event); handleKeydown(claimed, inTerm);
    assert.equal(claimed.defaultPrevented, true, `${id} is claimed before the pty`);
  }
});

test("Linux/Windows inside a terminal: Ctrl+W/K/\\/P/B, F6, Alt+digit and Ctrl+PgUp/PgDn reach the program (never preventDefault'ed)", t => {
  registerAll(t);
  const inTerm = { isMac: false, insideTerminal: true };
  const programKeys = [
    ...["w", "k", "\\", "p", "b", "n", "e", "o", "f", "i"].map(key => [`Ctrl+${key}`, linux(key)]),
    ["F6 (mc, htop, nano)", ev("F6")], ["Shift+F6", ev("F6", { shiftKey: true })],
    ["Alt+1 (readline numeric argument)", ev("1", { altKey: true })], ["Alt+9", ev("9", { altKey: true })],
    ["Ctrl+PgDn (vim, weechat)", linux("PageDown")], ["Ctrl+PgUp", linux("PageUp")],
  ];
  for (const [name, event] of programKeys) {
    assert.equal(matchEvent(event, inTerm), null, name);
    assert.equal(handleKeydown(event, inTerm), false); assert.equal(event.defaultPrevented, false, `${name} is the program's`);
  }
  // Outside the terminal F6 is the app's; Alt+digit and Ctrl+PgUp/PgDn are bound to nothing (go to tab
  // is Ctrl+Alt+digit, the second tab-cycling chords Alt+Shift+←/→).
  const out = { isMac: false, insideTerminal: false };
  assert.equal(matchEvent(ev("F6"), out), "focus.nextRegion");
  assert.equal(matchEvent(ev("3", { altKey: true }), out), null);
  assert.equal(matchEvent(linux("PageDown"), out), null);
  assert.equal(matchEvent(linux("3", { altKey: true }), out), "tabs.goto3");
  // Ctrl+Shift+\ (the shifted "|") is not claimed on Linux either.
  assert.equal(matchEvent(linux("|", { shiftKey: true }), inTerm), null);
  // Actions that are not allowlisted never fire inside, even on their own chord: Open file
  // (Ctrl+O, a view's registration default) and F6.
  t.after(registerAction({ id: "app.openFile", label: "Open file", context: "global", defaultChord: "Mod+O", run: () => {} }));
  for (const [event, id] of [
    [linux("o"), "app.openFile"], [ev("F6"), "focus.nextRegion"],
  ]) {
    assert.equal(matchEvent(event, inTerm), null, id);
    assert.equal(matchEvent(event, { isMac: false, insideTerminal: false }), id, `${id} still works outside the terminal`);
  }
  // The moved defaults left their plain chords to the program everywhere: Ctrl+B, Ctrl+I and
  // Ctrl+F run nothing on Linux/Windows, inside a terminal or out.
  for (const key of ["b", "i", "f"]) {
    assert.equal(matchEvent(linux(key), { isMac: false, insideTerminal: false }), null, `Ctrl+${key} outside`);
  }
  // Ctrl+Shift+= arrives as "+" with Shift held; KEY_ALIASES folds "+" into "=", and the Shift keeps it
  // from matching Ctrl+= (today's behaviour). Numpad plus (no Shift) is Ctrl+= and zooms, in a terminal too.
  assert.equal(matchEvent(linux("+", { shiftKey: true }), inTerm), null, "Ctrl+Shift+= is not the zoom chord");
  assert.equal(matchEvent(linux("+", { code: "NumpadAdd" }), inTerm), "terminal.fontBigger", "numpad Ctrl++ zooms");
});

test("Linux/Windows outside a terminal: the old plain chords no longer run the changed actions", t => {
  registerAll(t);
  const out = { isMac: false, insideTerminal: false };
  assert.equal(matchEvent(linux("k"), out), null, "Ctrl+K was the palette");
  assert.equal(matchEvent(linux("p"), out), null, "Ctrl+P was Quick Open");
  assert.equal(matchEvent(linux("w"), out), null, "Ctrl+W was close tab");
  assert.equal(matchEvent(linux("\\"), out), null, "Ctrl+\\ was split right");
  assert.equal(matchEvent(linux("n"), out), null, "Ctrl+N was spawn instance");
  assert.equal(matchEvent(linux("T", { shiftKey: true }), out), null, "the theme cycle has no default");
  assert.equal(matchEvent(linux("3"), out), "stage.automations");
});

test("macOS inside a terminal: ⌘ chords fire (they never reach the pty), plus Ctrl+Tab; ⌃digits and F6 are the program's", t => {
  registerAll(t);
  const inTerm = { isMac: true, insideTerminal: true };
  for (const [event, id] of [
    [ev("b", { metaKey: true }), "sidebar.toggle"], [ev("i", { metaKey: true }), "panel.toggle"], [ev("f", { metaKey: true }), "sidebar.focusFilter"],
    [ev("k", { metaKey: true }), "app.palette"], [ev("p", { metaKey: true }), "app.quickOpenSouls"], [ev("w", { metaKey: true }), "tabs.close"],
    [ev("|", { metaKey: true, shiftKey: true }), "split.horizontal"], [ev("\\", { metaKey: true }), "split.vertical"],
    [ev("3", { metaKey: true, altKey: true }), "tabs.goto3"], [ev("Tab", { ctrlKey: true }), "tabs.next"],
    [ev("F6", { metaKey: true, shiftKey: true }), "focus.leaveTerminal"], [ev("3", { metaKey: true }), "stage.automations"],
    // The shared ⌘⌥ rows: the leader's ↑ ↓ z, the tab moves, the workspace switcher and the next group.
    [ev("ArrowUp", { metaKey: true, altKey: true }), "roster.openPrevious"], [ev("ArrowDown", { metaKey: true, altKey: true }), "roster.openNext"],
    [ev("ArrowLeft", { metaKey: true, altKey: true }), "tabs.prevPage"], [ev("ArrowRight", { metaKey: true, altKey: true }), "tabs.nextPage"],
    [ev("o", { metaKey: true, altKey: true }), "app.workspaces"], [ev("z", { metaKey: true, altKey: true }), "terminal.zoom"],
    [ev("a", { metaKey: true, altKey: true }), "split.focusNextGroup"],
  ]) assert.equal(matchEvent(event, inTerm), id, id);
  // ⌃3 is ESC, ⌃4–⌃7 FS/GS/RS/US, ⌃8 DEL, ⌃6 vim's alternate file; F6 is mc's/htop's/nano's.
  for (const [name, event] of [["⌃3", ev("3", { ctrlKey: true })], ["⌃6", ev("6", { ctrlKey: true })], ["F6", ev("F6")], ["⇧F6", ev("F6", { shiftKey: true })]]) {
    assert.equal(matchEvent(event, inTerm), null, name);
    assert.equal(handleKeydown(event, inTerm), false); assert.equal(event.defaultPrevented, false, `${name} reaches the pty`);
  }
  assert.equal(matchEvent(ev("F6"), { isMac: true, insideTerminal: false }), "focus.nextRegion", "F6 cycles outside a terminal");
  // The one structural exemption follows the action AND its shape: a rebind to a Ctrl letter stays the program's.
  setBinding("tabs.next", "Ctrl+G");
  assert.equal(matchEvent(ev("g", { ctrlKey: true }), inTerm), null);
  assert.equal(matchEvent(ev("g", { ctrlKey: true }), { isMac: true, insideTerminal: false }), "tabs.next");
  setBinding("tabs.goto1", "Ctrl+1");
  assert.equal(matchEvent(ev("1", { ctrlKey: true }), inTerm), null, "a ⌃digit rebind never fires in a terminal");
});

test("a stored override survives the new defaults and wins on every platform", t => {
  registerAll(t);
  setBinding("app.palette", "Ctrl+K");
  assert.equal(getBinding("app.palette", false), "Ctrl+K");
  // The palette's terminal reach follows the action id, so the user's choice keeps working there.
  assert.equal(matchEvent(linux("k"), { isMac: false, insideTerminal: true }), "app.palette");
  setBinding("app.themeToggle", "Mod+Shift+T");
  assert.equal(matchEvent(linux("T", { shiftKey: true }), { isMac: false, insideTerminal: false }), "app.themeToggle");
});

test("shell wiring: the new actions are registered, rebindable and discoverable", () => {
  const src = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
  for (const id of ["tabs.nextPage", "tabs.prevPage", "focus.nextRegion", "focus.prevRegion", "focus.leaveTerminal", "terminal.copySelection"]) assert.match(src, new RegExp(`id: "${id.replace(".", "\\.")}"`), id);
  assert.match(src, /id: `tabs\.goto\$\{n\}`/, "go to tab 1–9");
  assert.match(src, /NAV\.forEach\(\(v\) => registerAction\(\{\n  id: `stage\.\$\{v\.name\}`/, "stage.automations comes from the nav manifest");
});

test("real targets: F6 cycles from text fields; in xterm's textarea F6 is the program's and Mod+Shift+F6 leaves", t => {
  registerAll(t);
  const dom = new JSDOM(`<div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div><input class="ctx-filter"><textarea class="ftask"></textarea>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  // Real targets: matchEvent derives insideTerminal and editable from them (function keys never
  // type, so the editable-field guard does not drop F6 in a text field).
  const term = doc.querySelector(".xterm-helper-textarea");
  for (const target of [doc.querySelector(".ctx-filter"), doc.querySelector(".ftask")]) {
    for (const isMac of [true, false]) {
      assert.equal(matchEvent(ev("F6", { target }), { isMac }), "focus.nextRegion", `${target.className} mac=${isMac}`);
      assert.equal(matchEvent(ev("F6", { target, shiftKey: true }), { isMac }), "focus.prevRegion", `${target.className} mac=${isMac}`);
    }
  }
  for (const isMac of [true, false]) {
    const f6 = ev("F6", { target: term });
    assert.equal(matchEvent(f6, { isMac }), null, `F6 in a terminal is the program's (mac=${isMac})`);
    assert.equal(handleKeydown(f6, { isMac }), false); assert.equal(f6.defaultPrevented, false);
    const leave = ev("F6", { target: term, shiftKey: true, ...(isMac ? { metaKey: true } : { ctrlKey: true }) });
    assert.equal(matchEvent(leave, { isMac }), "focus.leaveTerminal", `Mod+Shift+F6 leaves (mac=${isMac})`);
  }
  assert.equal(isPlainChord("F6"), false); assert.equal(isPlainChord("Shift+F12"), false);
  // Keys that type stay the field's: a plain-letter binding never fires while typing.
  setBinding("sidebar.toggle", "B");
  assert.equal(isPlainChord("B"), true);
  assert.equal(matchEvent(ev("b", { target: doc.querySelector(".ctx-filter") }), { isMac: false }), null);
  assert.equal(matchEvent(ev("b", { target: doc.querySelector(".xterm-helper-textarea") }), { isMac: true }), null);
});

// The theme picker's chord, dispatched as the real keydown: Space reports key " " (KEY_ALIASES → "space").
const space = (mods = {}) => ev(" ", { code: "Space", ...mods });
test("theme picker: Ctrl+Shift+Space on Linux/Windows, ⇧⌘Space on macOS, from the real Space event", t => {
  registerAll(t);
  assert.equal(formatChord(getBinding("app.themePicker", false), false), "Ctrl+Shift+Space");
  assert.equal(formatChord(getBinding("app.themePicker", true), true), "⇧⌘Space");
  assert.ok(TERMINAL_ALLOWLIST.includes("app.themePicker"));
  for (const insideTerminal of [false, true]) {
    const linuxOpts = { isMac: false, insideTerminal }, macOpts = { isMac: true, insideTerminal };
    assert.equal(matchEvent(space({ ctrlKey: true, shiftKey: true }), linuxOpts), "app.themePicker", `Linux, terminal=${insideTerminal}`);
    // Linux ignores metaKey (chordFromEvent): where the window manager lets Super+Ctrl+Shift+Space through, it opens the picker too.
    assert.equal(matchEvent(space({ ctrlKey: true, shiftKey: true, metaKey: true }), linuxOpts), "app.themePicker", `Linux + Super, terminal=${insideTerminal}`);
    assert.equal(matchEvent(space({ metaKey: true, shiftKey: true }), macOpts), "app.themePicker", `macOS, terminal=${insideTerminal}`);
    const claimed = space({ ctrlKey: true, shiftKey: true }); handleKeydown(claimed, linuxOpts);
    assert.equal(claimed.defaultPrevented, true, "claimed before the pty");
    // Plain Ctrl+Space (NUL: set-mark in emacs, completion in shells and editors) is never the app's.
    const nul = space({ ctrlKey: true });
    for (const opts of [linuxOpts, macOpts]) assert.equal(matchEvent(nul, opts), null, `Ctrl+Space, mac=${opts.isMac}`);
    assert.equal(handleKeydown(nul, linuxOpts), false); assert.equal(nul.defaultPrevented, false);
    // Not the other platform's chord: ⌃⇧Space on macOS (⌃ in a terminal is the program's), ⌘ alone elsewhere.
    assert.equal(matchEvent(space({ ctrlKey: true, shiftKey: true }), macOpts), null);
    assert.equal(matchEvent(space({ metaKey: true, ctrlKey: true, shiftKey: true }), macOpts), null, "⌃⇧⌘Space is not the macOS chord");
  }
  // In a text field (the roster filter, the spawn form): a modified chord is not typing, so the engine's
  // editable-field guard (plain chords only) lets it fire there.
  const dom = new JSDOM(`<input class="ctx-filter"><textarea class="ftask"></textarea><div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div>`);
  t.after(() => dom.window.close());
  for (const target of dom.window.document.querySelectorAll("input, textarea")) {
    assert.equal(matchEvent(space({ target, ctrlKey: true, shiftKey: true }), { isMac: false }), "app.themePicker", target.className);
    assert.equal(matchEvent(space({ target, metaKey: true, shiftKey: true }), { isMac: true }), "app.themePicker", target.className);
  }
});

test("theme picker: no other default shares either chord", t => {
  registerAll(t);
  for (const isMac of [false, true]) {
    const chord = getBinding("app.themePicker", isMac);
    assert.equal(findConflict(chord, "global", "app.themePicker", isMac), null, `mac=${isMac}: ${chord}`);
    for (const id of IDS) if (id !== "app.themePicker") assert.notEqual(getBinding(id, isMac), chord, id);
    assert.deepEqual(keymapConflicts(isMac), [], `mac=${isMac}`);
  }
  // A user who bound the chord to another action keeps it; the existing warning names the clash.
  setBinding("app.shortcuts", "Ctrl+Shift+Space");
  assert.equal(getBinding("app.shortcuts", false), "Ctrl+Shift+Space");
  assert.deepEqual(keymapConflicts(false).map(c => c.actions.map(a => a.id).sort()), [["app.shortcuts", "app.themePicker"]]);
});

// #1217: the palette took Ctrl+Shift+K and Quick Open Ctrl+Shift+P. A stored binding on either chord
// is kept, and the shortcuts editor's warning names the clash (the release note promises it).
test("palette and Quick Open chords: a stored binding on either is kept and named as a clash", t => {
  registerAll(t);
  assert.deepEqual(keymapConflicts(false), [], "the defaults clash with nothing");
  setBinding("sidebar.toggle", "Ctrl+Shift+K");
  assert.deepEqual(keymapConflicts(false).map(c => c.actions.map(a => a.id).sort()), [["app.palette", "sidebar.toggle"]]);
  resetAllBindings();
  setBinding("app.palette", "Ctrl+Shift+P"); // the palette's chord until #1217, set by hand
  assert.equal(getBinding("app.palette", false), "Ctrl+Shift+P");
  assert.deepEqual(keymapConflicts(false).map(c => c.actions.map(a => a.id).sort()), [["app.palette", "app.quickOpenSouls"]]);
});

// #672: Ctrl+Shift+C copies the terminal's selection on Linux/Windows. The terminal's key path is the
// shell's: terminal-tab.mjs's custom key handler runs terminalKeyDecision with the shell's interceptKey,
// and a handled key writes only the decision's byte. Ctrl+C stays the program's interrupt.
function terminalKeyPath(t, selection) {
  resetAllBindings();
  const pty = [], clipboard = [];
  const term = { hasSelection: () => selection !== "", getSelection: () => selection };
  const offs = IDS.map(id => registerAction({ id, label: id, context: contextOf(id),
    run: id === "terminal.copySelection" ? () => copyTerminalSelection(term, text => { clipboard.push(text); }) : () => {} }));
  setActiveContexts(new Set(["tabs"]));
  t.after(() => { offs.forEach(off => off()); setActiveContexts(new Set()); resetAllBindings(); });
  const opts = { isMac: false, insideTerminal: true };
  const interceptKey = (e) => {
    if (!matchEvent(e, opts)) return false;
    if (e.type === "keydown") handleKeydown(e, opts);
    return true;
  };
  // What xterm sends when the custom handler lets a key through (Keyboard.ts: Ctrl+letter only with Shift up).
  const xtermBytes = (e) => (e.ctrlKey && !e.shiftKey && !e.altKey && /^[a-z]$/i.test(e.key) ? String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64)
    : e.key === "Enter" ? "\r" : e.key.length === 1 && !e.ctrlKey ? e.key : "");
  const press = (e) => {
    const { handled, byte } = terminalKeyDecision(e, interceptKey);
    if (!handled) pty.push(xtermBytes(e));
    else if (byte !== null) pty.push(byte);
    return { handled, prevented: e.defaultPrevented };
  };
  return { press, pty, clipboard };
}
const keydown = (key, mods = {}) => ev(key, { type: "keydown", ...mods });

test("Linux/Windows: Ctrl+Shift+C with nothing selected sends nothing to the pty and copies nothing", t => {
  const { press, pty, clipboard } = terminalKeyPath(t, "");
  assert.deepEqual(press(keydown("C", { ctrlKey: true, shiftKey: true })), { handled: true, prevented: true });
  assert.equal(press(ev("C", { type: "keyup", ctrlKey: true, shiftKey: true })).handled, true, "every phase is claimed");
  assert.deepEqual(pty, [], "no byte reaches the program");
  assert.deepEqual(clipboard, []);
});

test("Linux/Windows: Ctrl+Shift+C copies exactly the selection, and still sends nothing", async t => {
  const { press, pty, clipboard } = terminalKeyPath(t, "  line one\nline two");
  press(keydown("C", { ctrlKey: true, shiftKey: true }));
  await new Promise(r => setImmediate(r));
  assert.deepEqual(clipboard, ["  line one\nline two"]);
  assert.deepEqual(pty, []);
});

test("Linux/Windows: Ctrl+C is still the interrupt, selection or not; plain keys and Shift+Enter are unchanged", t => {
  for (const selection of ["", "selected"]) {
    const { press, pty, clipboard } = terminalKeyPath(t, selection);
    assert.deepEqual(press(keydown("c", { ctrlKey: true })), { handled: false, prevented: false });
    press(keydown("a"));
    press(keydown("Enter", { shiftKey: true }));
    press(keydown("Enter"));
    assert.equal(pty[0], "\x03", "ETX reaches the program");
    assert.equal(pty[1], "a");
    assert.equal(pty[2], "\n", "Shift+Enter keeps its own byte (a newline in the agent's draft)");
    assert.equal(pty[3], "\r");
    assert.deepEqual(clipboard, []);
  }
});

test("macOS: the copy action has no chord, so ⌘C stays the menu's Copy and ⌃⇧C the program's", t => {
  registerAll(t);
  assert.equal(getBinding("terminal.copySelection", true), null);
  assert.equal(matchEvent(ev("c", { metaKey: true }), { isMac: true, insideTerminal: true }), null);
  assert.equal(matchEvent(ev("C", { ctrlKey: true, shiftKey: true }), { isMac: true, insideTerminal: true }), null);
});

// The leader (docs/desktop-keyboard.md, "The leader"): the TUI's, from every focus. On Linux/Windows
// Alt+O is allowlisted (it sends ESC o, which Esc then o still sends: terminal-xterm-bytes); on macOS
// Ctrl+\ fires in a terminal by name and shape, a named exception to principle 3.
test("the leader: Alt+O fires app.leader inside a terminal on Linux/Windows, and claims it", t => {
  registerAll(t);
  assert.equal(defaultBinding("app.leader", false), "Alt+O");
  assert.equal(defaultBinding("app.leader", true), "Ctrl+\\");
  for (const insideTerminal of [true, false]) {
    const opts = { isMac: false, insideTerminal };
    const alt = ev("o", { altKey: true });
    assert.equal(matchEvent(alt, opts), "app.leader", `terminal=${insideTerminal}`);
    handleKeydown(alt, opts);
    assert.equal(alt.defaultPrevented, true);
  }
  // From an editable field too: it is not a plain chord.
  const dom = new JSDOM(`<input class="ctx-filter">`);
  t.after(() => dom.window.close());
  assert.equal(matchEvent(ev("o", { altKey: true, target: dom.window.document.querySelector("input") }), { isMac: false }), "app.leader");
  // Alt+Shift+O and plain o are not the leader.
  assert.equal(matchEvent(ev("O", { altKey: true, shiftKey: true }), { isMac: false, insideTerminal: true }), null);
  assert.equal(formatChord(getBinding("app.leader", false), false), "Alt+O");
  assert.equal(formatChord(getBinding("app.leader", true), true), "⌃\\");
});

test("the leader on macOS: Ctrl+\\ fires inside a terminal; a rebind to another ⌃ chord does not, to ⌘ does", t => {
  registerAll(t);
  const inTerm = { isMac: true, insideTerminal: true };
  const ctrlBackslash = ev("\\", { ctrlKey: true });
  assert.equal(matchEvent(ctrlBackslash, inTerm), "app.leader");
  handleKeydown(ctrlBackslash, inTerm);
  assert.equal(ctrlBackslash.defaultPrevented, true, "claimed before the pty");
  assert.equal(matchEvent(ev("|", { ctrlKey: true, shiftKey: true }), inTerm), null, "⌃⇧\\ is not the leader's shape");
  setBinding("app.leader", "Ctrl+J");
  assert.equal(matchEvent(ev("j", { ctrlKey: true }), inTerm), null, "another ⌃ chord stays the program's");
  assert.equal(matchEvent(ev("j", { ctrlKey: true }), { isMac: true, insideTerminal: false }), "app.leader", "and is the leader outside");
  setBinding("app.leader", "Mod+J");
  assert.equal(matchEvent(ev("j", { metaKey: true }), inTerm), "app.leader", "a ⌘ rebind fires by the ⌘ rule");
  resetAllBindings();
  // On Linux/Windows a terminal is the program's for Ctrl+\ (SIGQUIT): the leader is Alt+O there.
  assert.equal(matchEvent(ev("\\", { ctrlKey: true }), { isMac: false, insideTerminal: true }), null);
});

test("the leader is inert under a shown modal: the chord goes where it goes today", t => {
  resetAllBindings();
  let modal = false;
  const off = registerAction({ id: "app.leader", label: "Leader", context: "global", when: () => !modal, run: () => {} });
  t.after(() => { off(); resetAllBindings(); });
  assert.equal(matchEvent(ev("o", { altKey: true }), { isMac: false, insideTerminal: true }), "app.leader");
  modal = true;
  const alt = ev("o", { altKey: true });
  assert.equal(matchEvent(alt, { isMac: false, insideTerminal: true }), null);
  assert.equal(handleKeydown(alt, { isMac: false, insideTerminal: true }), false);
  assert.equal(alt.defaultPrevented, false, "the program gets it");
});

test("the leader's, the sidebar's and the shared chords clash with no other default", t => {
  registerAll(t);
  for (const isMac of [false, true]) assert.deepEqual(keymapConflicts(isMac), [], `mac=${isMac}`);
  for (const isMac of [false, true]) for (const id of ["app.leader", ...CHORDS_READ.map(({ id }) => id), ...IDS.filter(id => id.startsWith("sidebar.key."))]) {
    const chord = getBinding(id, isMac);
    assert.ok(chord || id.startsWith("sidebar.key."), `${id} has a chord, mac=${isMac}`);
    if (chord) assert.equal(findConflict(chord, contextOf(id), id, isMac), null, `${id} (${chord}) mac=${isMac}`);
  }
  assert.equal(getBinding("split.focusNextGroup", false), "Ctrl+Alt+A", "the leader's Tab, as the shared group-next");
});

// Desktop text fields (the roster filter, the spawn dialog's fields, the palette's input): no default
// takes a key a field edits with, on either platform, so a field keeps every one of them; the shared
// chords are not such keys, and fire from a field as from anywhere (they type nothing).
test("text fields keep their own keys: no default takes an editing key, and the shared chords fire from a field", t => {
  registerAll(t);
  const dom = new JSDOM(`<input class="ctx-filter"><textarea class="ftask"></textarea>`);
  t.after(() => dom.window.close());
  const fields = [...dom.window.document.querySelectorAll("input, textarea")];
  const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  const editing = {
    // Linux/Windows: select, word moves and word selection, line ends, delete a word, undo/redo, clipboard.
    false: [
      ...arrows.flatMap(key => [ev(key), ev(key, { shiftKey: true }), linux(key), linux(key, { shiftKey: true })]),
      ...["Home", "End"].flatMap(key => [ev(key), ev(key, { shiftKey: true }), linux(key), linux(key, { shiftKey: true })]),
      linux("Backspace"), linux("Delete"), ...["a", "c", "v", "x", "z", "y"].map(key => linux(key)), linux("Z", { shiftKey: true }), linux("V", { shiftKey: true }),
    ],
    // macOS: ⌘ and ⌥ arrows (line and word moves), with ⇧ to select; ⌘/⌥ Backspace; the Emacs ⌃ keys; undo/redo, clipboard.
    true: [
      ...arrows.flatMap(key => [ev(key), ev(key, { shiftKey: true }), ev(key, { metaKey: true }), ev(key, { metaKey: true, shiftKey: true }),
        ev(key, { altKey: true }), ev(key, { altKey: true, shiftKey: true })]),
      ev("Backspace", { metaKey: true }), ev("Backspace", { altKey: true }),
      ...["a", "e", "k", "d", "h", "f", "b", "n", "p"].map(key => ev(key, { ctrlKey: true })),
      ...["a", "c", "v", "x", "z"].map(key => ev(key, { metaKey: true })), ev("z", { metaKey: true, shiftKey: true }),
    ],
  };
  for (const isMac of [false, true]) {
    for (const target of fields) for (const e of editing[isMac]) {
      const keyed = ev(e.key, { ...e, target });
      assert.equal(matchEvent(keyed, { isMac }), null, `${JSON.stringify({ key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey })} mac=${isMac}: ${target.className}'s`);
      assert.equal(handleKeydown(keyed, { isMac }), false); assert.equal(keyed.defaultPrevented, false);
    }
  }
  // The shared chords, pressed in a field: each is the Desktop's (Linux/Windows and macOS).
  for (const target of fields) {
    for (const [e, id] of [
      [linux("k", { altKey: true }), "app.palette"], [linux("1", { altKey: true }), "tabs.goto1"], [linux("E", { altKey: true, shiftKey: true }), "split.horizontal"],
      [ev("ArrowUp", { altKey: true, shiftKey: true }), "roster.openPrevious"], [ev("ArrowRight", { altKey: true, shiftKey: true }), "tabs.nextPage"],
    ]) assert.equal(matchEvent(ev(e.key, { ...e, target }), { isMac: false }), id, `${id} from ${target.className}`);
    for (const [e, id] of [
      [ev("k", { metaKey: true }), "app.palette"], [ev("ArrowDown", { metaKey: true, altKey: true }), "roster.openNext"],
      [ev("ArrowLeft", { metaKey: true, altKey: true }), "tabs.prevPage"], [ev("z", { metaKey: true, altKey: true }), "terminal.zoom"],
    ]) assert.equal(matchEvent(ev(e.key, { ...e, target }), { isMac: true }), id, `${id} from ${target.className} on macOS`);
  }
});
