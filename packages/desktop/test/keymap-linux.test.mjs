// Spec F, Part 3: a keymap that is sane on Linux (and Omarchy) as well as macOS.
// The rule: a default chord never takes a key a program inside the terminal reads. Every
// changed default resolves per platform; inside a terminal on Linux/Windows only the allowlisted
// actions fire, and the program keeps Ctrl+W/K/\/P/B, F6, Alt+digit and Ctrl+PgUp/PgDn; on
// macOS only ⌘ chords (and Ctrl+Tab) fire there, so ⌃digits and F6 stay the program's.
// Chords are dispatched as the REAL events a keyboard sends (the shifted character in `key`).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  DEFAULT_KEYMAP, TERMINAL_ALLOWLIST, defaultBinding, getBinding, formatChord, isPlainChord,
  registerAction, setActiveContexts, resetAllBindings, setBinding, matchEvent, handleKeydown,
} from "../renderer/keybindings.mjs";

const map = new Map();
globalThis.localStorage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };

const ev = (key, mods = {}) => ({
  key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; }, ...mods,
});
// What Linux/Windows sends for Ctrl(+Shift)(+Alt)+key: with Shift, `key` is the shifted character.
const linux = (key, mods = {}) => ev(key, { ctrlKey: true, ...mods });

// Every action the shell registers with a default, in its context (tabs actions live in "tabs").
const IDS = Object.keys(DEFAULT_KEYMAP);
function registerAll(t) {
  resetAllBindings();
  const offs = IDS.map(id => registerAction({ id, label: id, context: /^(tabs|split)\./.test(id) ? "tabs" : "global", run: () => {} }));
  setActiveContexts(new Set(["tabs"]));
  t.after(() => { offs.forEach(off => off()); setActiveContexts(new Set()); resetAllBindings(); });
}

test("the shipped table: each changed default resolves per platform", () => {
  const table = {
    "app.palette": ["Mod+K", "Ctrl+Shift+P"],
    "app.quickOpenSouls": ["Mod+P", "Mod+P"],
    "app.chooseSoul": ["Mod+N", "Ctrl+Shift+N"],
    "tabs.close": ["Mod+W", "Ctrl+Shift+W"],
    "tabs.next": ["Ctrl+Tab", "Ctrl+Tab"], "tabs.prev": ["Ctrl+Shift+Tab", "Ctrl+Shift+Tab"],
    "tabs.nextPage": [null, "Ctrl+PageDown"], "tabs.prevPage": [null, "Ctrl+PageUp"],
    "tabs.goto1": ["Mod+Alt+1", "Alt+1"], "tabs.goto9": ["Mod+Alt+9", "Alt+9"],
    "split.vertical": ["Mod+\\", "Ctrl+Shift+E"], "split.horizontal": ["Mod+Shift+\\", "Ctrl+Shift+O"],
    "split.close": ["Mod+Alt+W", "Ctrl+Shift+Alt+W"],
    "stage.hierarchy": ["Mod+1", "Mod+1"], "stage.spawn": ["Mod+2", "Mod+2"], "stage.automations": ["Mod+3", "Mod+3"],
    "focus.nextRegion": ["F6", "F6"], "focus.prevRegion": ["Shift+F6", "Shift+F6"],
    "focus.leaveTerminal": ["Mod+Shift+F6", "Mod+Shift+F6"],
    "sidebar.toggle": ["Mod+B", "Mod+B"], "sidebar.focusFilter": ["Mod+F", "Mod+F"], "panel.toggle": ["Mod+Alt+B", "Mod+Alt+B"],
    "app.themeToggle": [null, null], "app.shortcuts": ["Mod+,", "Mod+,"],
    "terminal.fontBigger": ["Mod+=", "Mod+="], "terminal.fontSmaller": ["Mod+-", "Mod+-"], "terminal.fontReset": ["Mod+0", "Mod+0"],
  };
  for (const [id, [mac, other]] of Object.entries(table)) {
    assert.equal(defaultBinding(id, true), mac, `${id} on macOS`);
    assert.equal(defaultBinding(id, false), other, `${id} on Linux/Windows`);
  }
  // Shown as each platform reads it (the shortcuts editor and the hints use getBinding + formatChord).
  assert.equal(formatChord(getBinding("app.palette", false), false), "Ctrl+Shift+P");
  assert.equal(formatChord(getBinding("tabs.nextPage", false), false), "Ctrl+PgDn");
  assert.equal(formatChord(getBinding("tabs.goto3", true), true), "⌥⌘3");
  assert.equal(formatChord(getBinding("focus.leaveTerminal", false), false), "Ctrl+Shift+F6");
});

test("nothing binds Super/Meta on Linux/Windows: Mod is Ctrl there", () => {
  for (const id of IDS) {
    const chord = defaultBinding(id, false);
    if (chord) assert.doesNotMatch(chord, /\b(Meta|Cmd|Super)\b/, id);
  }
});

test("the terminal allowlist is exactly the actions that must work in a terminal", () => {
  assert.deepEqual([...TERMINAL_ALLOWLIST].sort(), [
    "app.chooseSoul", "app.palette", "focus.leaveTerminal",
    "split.close", "split.horizontal", "split.vertical",
    "tabs.close", "tabs.next", "tabs.prev",
  ].sort());
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
    [linux("P", { shiftKey: true }), "app.palette"], [linux("N", { shiftKey: true }), "app.chooseSoul"],
    [linux("W", { shiftKey: true }), "tabs.close"], [linux("Tab"), "tabs.next"], [linux("Tab", { shiftKey: true }), "tabs.prev"],
    [linux("E", { shiftKey: true }), "split.vertical"], [linux("O", { shiftKey: true }), "split.horizontal"],
    [linux("W", { shiftKey: true, altKey: true }), "split.close"],
    [linux("F6", { shiftKey: true }), "focus.leaveTerminal"],
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
    ...["w", "k", "\\", "p", "b", "n", "e", "o", "f"].map(key => [`Ctrl+${key}`, linux(key)]),
    ["F6 (mc, htop, nano)", ev("F6")], ["Shift+F6", ev("F6", { shiftKey: true })],
    ["Alt+1 (readline numeric argument)", ev("1", { altKey: true })], ["Alt+9", ev("9", { altKey: true })],
    ["Ctrl+PgDn (vim, weechat)", linux("PageDown")], ["Ctrl+PgUp", linux("PageUp")],
  ];
  for (const [name, event] of programKeys) {
    assert.equal(matchEvent(event, inTerm), null, name);
    assert.equal(handleKeydown(event, inTerm), false); assert.equal(event.defaultPrevented, false, `${name} is the program's`);
  }
  // Outside the terminal the same keys are the app's.
  const out = { isMac: false, insideTerminal: false };
  assert.equal(matchEvent(ev("F6"), out), "focus.nextRegion");
  assert.equal(matchEvent(ev("3", { altKey: true }), out), "tabs.goto3");
  assert.equal(matchEvent(linux("PageDown"), out), "tabs.nextPage");
  // Ctrl+Shift+\ (the shifted "|") is not claimed on Linux either.
  assert.equal(matchEvent(linux("|", { shiftKey: true }), inTerm), null);
  // Actions that are not allowlisted never fire inside, even on their own chord.
  for (const [event, id] of [[linux("p"), "app.quickOpenSouls"], [linux("b"), "sidebar.toggle"], [linux("1"), "stage.hierarchy"], [linux("b", { altKey: true }), "panel.toggle"]]) {
    assert.equal(matchEvent(event, inTerm), null, id);
    assert.equal(matchEvent(event, { isMac: false, insideTerminal: false }), id, `${id} still works outside the terminal`);
  }
});

test("Linux/Windows outside a terminal: the old plain chords no longer run the changed actions", t => {
  registerAll(t);
  const out = { isMac: false, insideTerminal: false };
  assert.equal(matchEvent(linux("k"), out), null, "Ctrl+K was the palette");
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
    [ev("k", { metaKey: true }), "app.palette"], [ev("w", { metaKey: true }), "tabs.close"],
    [ev("|", { metaKey: true, shiftKey: true }), "split.horizontal"], [ev("\\", { metaKey: true }), "split.vertical"],
    [ev("3", { metaKey: true, altKey: true }), "tabs.goto3"], [ev("Tab", { ctrlKey: true }), "tabs.next"],
    [ev("F6", { metaKey: true, shiftKey: true }), "focus.leaveTerminal"], [ev("3", { metaKey: true }), "stage.automations"],
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
  for (const id of ["tabs.nextPage", "tabs.prevPage", "focus.nextRegion", "focus.prevRegion", "focus.leaveTerminal"]) assert.match(src, new RegExp(`id: "${id.replace(".", "\\.")}"`), id);
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
