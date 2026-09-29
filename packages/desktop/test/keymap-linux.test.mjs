// Spec F, Part 3: a keymap that is sane on Linux (and Omarchy) as well as macOS.
// Every changed default resolves per platform; inside a terminal on Linux/Windows only the
// allowlisted actions fire, and the program keeps Ctrl+W / Ctrl+K / Ctrl+\ / Ctrl+P / Ctrl+B.
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
    "tabs.goto1": ["Ctrl+1", "Alt+1"], "tabs.goto9": ["Ctrl+9", "Alt+9"],
    "split.vertical": ["Mod+\\", "Ctrl+Shift+E"], "split.horizontal": ["Mod+Shift+\\", "Ctrl+Shift+O"],
    "split.close": ["Mod+Alt+W", "Ctrl+Shift+Alt+W"],
    "stage.hierarchy": ["Mod+1", "Mod+1"], "stage.spawn": ["Mod+2", "Mod+2"], "stage.automations": ["Mod+3", "Mod+3"],
    "focus.nextRegion": ["F6", "F6"], "focus.prevRegion": ["Shift+F6", "Shift+F6"],
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
  assert.equal(formatChord(getBinding("tabs.goto3", true), true), "⌃3");
});

test("nothing binds Super/Meta on Linux/Windows: Mod is Ctrl there", () => {
  for (const id of IDS) {
    const chord = defaultBinding(id, false);
    if (chord) assert.doesNotMatch(chord, /\b(Meta|Cmd|Super)\b/, id);
  }
});

test("the terminal allowlist is exactly the actions that must work in a terminal", () => {
  assert.deepEqual([...TERMINAL_ALLOWLIST].sort(), [
    "app.chooseSoul", "app.palette", "focus.nextRegion", "focus.prevRegion",
    "split.close", "split.horizontal", "split.vertical",
    "tabs.close", ...Array.from({ length: 9 }, (_, i) => `tabs.goto${i + 1}`), "tabs.next", "tabs.nextPage", "tabs.prev", "tabs.prevPage",
  ].sort());
  // No allowlisted default on Linux/Windows is a plain Ctrl+letter a program reads.
  for (const id of TERMINAL_ALLOWLIST) {
    const chord = defaultBinding(id, false);
    assert.doesNotMatch(chord, /^(Mod|Ctrl)\+[A-Za-z\\]$/, `${id}: ${chord}`);
  }
});

test("Linux/Windows inside a terminal: the allowlisted chords fire from real (shifted) events", t => {
  registerAll(t);
  const inTerm = { isMac: false, insideTerminal: true };
  for (const [event, id] of [
    [linux("P", { shiftKey: true }), "app.palette"], [linux("N", { shiftKey: true }), "app.chooseSoul"],
    [linux("W", { shiftKey: true }), "tabs.close"], [linux("Tab"), "tabs.next"], [linux("Tab", { shiftKey: true }), "tabs.prev"],
    [linux("PageDown"), "tabs.nextPage"], [linux("PageUp"), "tabs.prevPage"],
    [ev("1", { altKey: true }), "tabs.goto1"], [ev("9", { altKey: true }), "tabs.goto9"],
    [linux("E", { shiftKey: true }), "split.vertical"], [linux("O", { shiftKey: true }), "split.horizontal"],
    [linux("W", { shiftKey: true, altKey: true }), "split.close"],
    [ev("F6"), "focus.nextRegion"], [ev("F6", { shiftKey: true }), "focus.prevRegion"],
  ]) {
    assert.equal(matchEvent(event, inTerm), id, `${JSON.stringify({ key: event.key, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey })}`);
    const claimed = ev(event.key, event); handleKeydown(claimed, inTerm);
    assert.equal(claimed.defaultPrevented, true, `${id} is claimed before the pty`);
  }
});

test("Linux/Windows inside a terminal: Ctrl+W / Ctrl+K / Ctrl+\\ / Ctrl+P / Ctrl+B reach the program (never preventDefault'ed)", t => {
  registerAll(t);
  const inTerm = { isMac: false, insideTerminal: true };
  for (const key of ["w", "k", "\\", "p", "b", "n", "e", "o", "f"]) {
    const event = linux(key);
    assert.equal(matchEvent(event, inTerm), null, `Ctrl+${key}`);
    assert.equal(handleKeydown(event, inTerm), false); assert.equal(event.defaultPrevented, false, `Ctrl+${key} is the program's`);
  }
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

test("macOS keeps ⌘ chords (they never reach the pty) plus ⌃1–⌃9, Ctrl+Tab and F6 inside a terminal", t => {
  registerAll(t);
  const inTerm = { isMac: true, insideTerminal: true };
  for (const [event, id] of [
    [ev("k", { metaKey: true }), "app.palette"], [ev("w", { metaKey: true }), "tabs.close"],
    [ev("|", { metaKey: true, shiftKey: true }), "split.horizontal"], [ev("\\", { metaKey: true }), "split.vertical"],
    [ev("3", { ctrlKey: true }), "tabs.goto3"], [ev("Tab", { ctrlKey: true }), "tabs.next"],
    [ev("F6"), "focus.nextRegion"], [ev("F6", { shiftKey: true }), "focus.prevRegion"], [ev("3", { metaKey: true }), "stage.automations"],
  ]) assert.equal(matchEvent(event, inTerm), id, id);
  // The structural exemptions follow the action AND its shape: a rebind to a Ctrl letter stays the program's.
  setBinding("tabs.goto1", "Ctrl+G");
  assert.equal(matchEvent(ev("g", { ctrlKey: true }), inTerm), null);
  assert.equal(matchEvent(ev("g", { ctrlKey: true }), { isMac: true, insideTerminal: false }), "tabs.goto1");
  setBinding("focus.nextRegion", "Ctrl+J");
  assert.equal(matchEvent(ev("j", { ctrlKey: true }), inTerm), null);
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
  for (const id of ["tabs.nextPage", "tabs.prevPage", "focus.nextRegion", "focus.prevRegion"]) assert.match(src, new RegExp(`id: "${id.replace(".", "\\.")}"`), id);
  assert.match(src, /id: `tabs\.goto\$\{n\}`/, "go to tab 1–9");
  assert.match(src, /NAV\.forEach\(\(v\) => registerAction\(\{\n  id: `stage\.\$\{v\.name\}`/, "stage.automations comes from the nav manifest");
});

test("F6 / Shift+F6 fire from a real terminal textarea and a text field (function keys never type)", t => {
  registerAll(t);
  const dom = new JSDOM(`<div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div><input class="ctx-filter"><textarea class="ftask"></textarea>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  // Found on the rig: the editable-field guard dropped F6 in xterm's input textarea, so the
  // pty got it. These are real targets: matchEvent derives insideTerminal and editable from them.
  for (const target of [doc.querySelector(".xterm-helper-textarea"), doc.querySelector(".ctx-filter"), doc.querySelector(".ftask")]) {
    for (const isMac of [true, false]) {
      assert.equal(matchEvent(ev("F6", { target }), { isMac }), "focus.nextRegion", `${target.className} mac=${isMac}`);
      assert.equal(matchEvent(ev("F6", { target, shiftKey: true }), { isMac }), "focus.prevRegion", `${target.className} mac=${isMac}`);
    }
  }
  assert.equal(isPlainChord("F6"), false); assert.equal(isPlainChord("Shift+F12"), false);
  // Keys that type stay the field's: a plain-letter binding never fires while typing.
  setBinding("sidebar.toggle", "B");
  assert.equal(isPlainChord("B"), true);
  assert.equal(matchEvent(ev("b", { target: doc.querySelector(".ctx-filter") }), { isMac: false }), null);
  assert.equal(matchEvent(ev("b", { target: doc.querySelector(".xterm-helper-textarea") }), { isMac: true }), null);
});
