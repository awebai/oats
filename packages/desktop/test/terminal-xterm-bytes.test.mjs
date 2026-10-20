// The terminal rule's guard: on Linux/Windows a chord fires in a terminal only when xterm sends
// nothing for it, or when what it sends is a byte the program still gets from a plainer key
// (docs/desktop-keyboard.md, principle 2). Each terminal-allowlisted action's Linux default is
// pressed in a real xterm.js Terminal, the installed @xterm/xterm the renderer loads
// (index.html's script tag), and what xterm sends (onData) is pinned exactly. An xterm upgrade
// that starts sending something for one of them, or a new allowlisted action whose chord sends
// data without a row in SENDS, fails here.
// Windows' AltGr is Ctrl+Alt: a layout's character on a Ctrl+Alt chord (Spanish €, @, #; Polish ą, ę,
// ó, ż) arrives as that character, matches no chord and reaches the program whole; the end of this
// file pins it through the shell's own key path, under xterm's Windows evaluation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { JSDOM, VirtualConsole } from "jsdom";
import {
  DEFAULT_KEYMAP, TERMINAL_ALLOWLIST, defaultBinding, parseChord,
  registerAction, setActiveContexts, resetAllBindings, matchEvent, handleKeydown,
} from "../renderer/keybindings.mjs";
import { terminalOptions, terminalKeyDecision } from "../renderer/terminal-tab.mjs";

const XTERM = readFileSync(createRequire(import.meta.url).resolve("@xterm/xterm"), "utf8");

// The allowlisted defaults that send something, each with the plainer key (or keys, one after the
// other: "Escape, then o") that sends the same. app.leader is the TUI's leader: Alt+O sends ESC o,
// which the program still gets from Esc, then o (and the leader pressed twice gives it exactly that).
// The shared Ctrl+Alt chords send ESC and the Ctrl+letter byte (with Shift too: Ctrl+Alt+Shift+E is
// ESC Ctrl+E), or ESC and the digit, as Alt+digit does. The named exceptions have none (plainer: null):
// focus.leaveTerminal, the way out of a terminal, and the Alt+Shift arrows (CSI 1;4 A–D), the shared
// previous / next instance and tab moves, which no agent or readline binds.
const ctrlAlt = (letter) => ({ data: `\x1b${String.fromCharCode(letter.charCodeAt(0) - 64)}`, plainer: `Escape, then Ctrl+${letter}` });
const SENDS = {
  "app.leader": { data: "\x1bo", plainer: "Escape, then o" },
  "app.palette": ctrlAlt("K"),
  "app.quickOpenSouls": ctrlAlt("P"),
  "app.workspaces": ctrlAlt("O"),
  "roster.openPrevious": { data: "\x1b[1;4A", plainer: null },
  "roster.openNext": { data: "\x1b[1;4B", plainer: null },
  "terminal.focusMode": ctrlAlt("Z"),
  "stage.automations": { data: "\x1b", plainer: "Escape" },
  "tabs.next": { data: "\t", plainer: "Tab" },
  "tabs.prev": { data: "\x1b[Z", plainer: "Shift+Tab" },
  "tabs.nextPage": { data: "\x1b[1;4C", plainer: null },
  "tabs.prevPage": { data: "\x1b[1;4D", plainer: null },
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`tabs.goto${i + 1}`, { data: `\x1b${i + 1}`, plainer: `Alt+${i + 1}` }])),
  "tabs.close": ctrlAlt("W"),
  "split.vertical": ctrlAlt("E"),
  "split.horizontal": ctrlAlt("E"),
  "split.close": ctrlAlt("W"),
  "split.focusNextGroup": ctrlAlt("A"),
  "sidebar.focusFilter": ctrlAlt("F"),
  "instance.edit": ctrlAlt("R"),
  "focus.leaveTerminal": { data: "\x1b[17;6~", plainer: null },
};
// The named exceptions of the terminal rule, exactly (docs/desktop-keyboard.md, principle 2).
const EXCEPTIONS = ["focus.leaveTerminal", "roster.openNext", "roster.openPrevious", "tabs.nextPage", "tabs.prevPage"];

// What a keyboard reports for a chord's key (KeyboardEvent key/code/keyCode): a description
// of the keydown, not of what xterm does with it.
function keydownInit(chordString) {
  const c = parseChord(chordString);
  assert.ok(c, chordString);
  let key, code, keyCode;
  if (/^[a-z]$/.test(c.key)) {
    key = c.shift ? c.key.toUpperCase() : c.key; code = `Key${c.key.toUpperCase()}`; keyCode = c.key.toUpperCase().charCodeAt(0);
  } else if (/^\d$/.test(c.key)) {
    key = c.key; code = `Digit${c.key}`; keyCode = 48 + Number(c.key);
  } else if (/^f\d{1,2}$/.test(c.key)) {
    key = c.key.toUpperCase(); code = key; keyCode = 111 + Number(c.key.slice(1));
  } else {
    const named = {
      ",": [",", "Comma", 188], "=": ["=", "Equal", 187], "-": ["-", "Minus", 189], "\\": ["\\", "Backslash", 220],
      tab: ["Tab", "Tab", 9], space: [" ", "Space", 32], escape: ["Escape", "Escape", 27],
      arrowup: ["ArrowUp", "ArrowUp", 38], arrowdown: ["ArrowDown", "ArrowDown", 40],
      arrowleft: ["ArrowLeft", "ArrowLeft", 37], arrowright: ["ArrowRight", "ArrowRight", 39],
    }[c.key];
    assert.ok(named, `no keydown description for ${chordString}: add its key here`);
    [key, code, keyCode] = named;
  }
  return { key, code, keyCode, ctrlKey: c.mod || c.ctrl, shiftKey: c.shift, altKey: c.alt, metaKey: false };
}

function xtermTerminal(t, { platform = null, keyHandler = null } = {}) {
  const virtualConsole = new VirtualConsole(); // jsdom has no canvas: xterm's measuring falls back, quietly
  const dom = new JSDOM(`<div id="host"></div>`, { runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  t.after(() => dom.window.close());
  const { window } = dom;
  // xterm reads navigator.platform once, as its bundle loads: set before it, it evaluates keys as there.
  if (platform) Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
  // xterm watches the device pixel ratio through matchMedia, which jsdom lacks.
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  window.eval(XTERM); // the UMD bundle defines window.Terminal, as the renderer's script tag does
  // navigator.platform is empty in jsdom, so xterm evaluates keys as on Linux (neither macOS nor Windows).
  const term = new window.Terminal(terminalOptions({ fontSize: 15, fontFamily: "monospace", fontWeight: "normal", theme: {} }));
  term.open(window.document.getElementById("host"));
  t.after(() => term.dispose());
  const textarea = window.document.querySelector(".xterm-helper-textarea");
  assert.ok(textarea, "xterm opened");
  let sent = [];
  term.onData(data => sent.push(data));
  // The shell's key path in front of xterm (terminal-tab.mjs attaches the same handler), when given.
  if (keyHandler) term.attachCustomKeyEventHandler(keyHandler);
  const press = (init) => {
    sent = [];
    textarea.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    return sent.join("");
  };
  /** Events one after the other ([type, init]: keydown, keypress), on xterm's textarea: what xterm sends
   * for all of them, and the events dispatched. */
  press.sequence = (events) => {
    sent = [];
    const dispatched = events.map(([type, init]) => {
      const e = new window.KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
      textarea.dispatchEvent(e);
      return e;
    });
    return { data: sent.join(""), events: dispatched };
  };
  press.isMac = /Mac/.test(window.navigator.platform);
  press.isWindows = /Win/.test(window.navigator.platform);
  press.textarea = textarea;
  press.window = window;
  return press;
}

/** Two chords that are one key on Linux/Windows, where Mod is Ctrl. */
function sameLinuxChord(a, b) {
  const [x, y] = [parseChord(a), parseChord(b)];
  return !!x && !!y && x.key === y.key && (x.mod || x.ctrl) === (y.mod || y.ctrl) && x.alt === y.alt && x.shift === y.shift;
}

/** A plainer key, or keys pressed one after the other ("Escape, then o"): what they send together. */
const pressPlainer = (press, plainer) => plainer.split(", then ").map(chord => press(keydownInit(chord))).join("");

test("the harness sees what xterm sends: Ctrl+B is the tmux prefix byte", t => {
  const press = xtermTerminal(t);
  assert.equal(press(keydownInit("Ctrl+B")), "\x02");
  assert.equal(press(keydownInit("Ctrl+P")), "\x10");
});

test("every terminal-allowlisted Linux default sends nothing, or exactly its SENDS row", t => {
  const press = xtermTerminal(t);
  for (const id of TERMINAL_ALLOWLIST) {
    const chord = defaultBinding(id, false);
    assert.ok(chord, `${id} has a Linux/Windows default`);
    assert.equal(press(keydownInit(chord)), SENDS[id]?.data ?? "", `${id} (${chord})`);
  }
  for (const id of Object.keys(SENDS)) assert.ok(TERMINAL_ALLOWLIST.includes(id), `${id}'s row is for an allowlisted action`);
});

test("each byte an allowlisted default takes is one the program still gets from a plainer key", t => {
  const press = xtermTerminal(t);
  for (const [id, { data, plainer }] of Object.entries(SENDS)) {
    if (!plainer) continue;
    assert.equal(pressPlainer(press, plainer), data, `${id}: ${plainer} sends the same`);
    // A plainer key is one no default takes in a terminal: the program still gets it there.
    for (const chord of plainer.split(", then ")) {
      const taker = TERMINAL_ALLOWLIST.find(other => sameLinuxChord(defaultBinding(other, false), chord));
      assert.equal(taker, undefined, `${id}: its plainer ${chord} is ${taker}'s in a terminal`);
    }
  }
  assert.deepEqual(Object.keys(SENDS).filter(id => SENDS[id].plainer === null).sort(), EXCEPTIONS, "the named exceptions, and no other");
});

test("the Alt+Shift arrows, a named exception: no plainer arrow sends their sequence", t => {
  const press = xtermTerminal(t);
  for (const [id, arrow] of [["roster.openPrevious", "↑"], ["roster.openNext", "↓"], ["tabs.prevPage", "←"], ["tabs.nextPage", "→"]]) {
    assert.equal(defaultBinding(id, false), `Alt+Shift+${arrow}`, id);
    for (const plainer of [arrow, `Shift+${arrow}`, `Alt+${arrow}`, `Ctrl+${arrow}`, `Ctrl+Shift+${arrow}`, `Ctrl+Alt+${arrow}`]) {
      assert.notEqual(press(keydownInit(plainer)), SENDS[id].data, `${plainer} does not send ${id}'s sequence`);
    }
  }
});

// The leader on macOS is Ctrl+\ (keymap.mjs LEADER.mac), which fires in a terminal by name (principle
// 3's exception). Pressed twice, its second press is the program's: what xterm sends for it, 0x1c (FS,
// SIGQUIT's byte), pinned here under xterm's own macOS evaluation (navigator.platform set before load).
test("macOS: Ctrl+\\, the leader, is the byte 0x1c in xterm, which the leader pressed twice gives the program", t => {
  const press = xtermTerminal(t, { platform: "MacIntel" });
  assert.equal(press.isMac, true, "xterm loaded under the macOS platform");
  assert.equal(defaultBinding("app.leader", true), "Ctrl+\\");
  assert.equal(press(keydownInit(defaultBinding("app.leader", true))), "\x1c");
  // Under the Linux evaluation the same key sends the same byte.
  assert.equal(xtermTerminal(t)(keydownInit("Ctrl+\\")), "\x1c");
});

// ---------------------------------------------------------------- AltGr (Windows)

// On Windows, Ctrl+Alt IS AltGr: Chromium reports the layout's character in `key` (the physical key in
// `code`, ctrlKey and altKey both true), then a keypress with the character, which is what xterm sends
// (its keydown passes Ctrl+Alt+key over as a third-level shift on Windows, and its keypress handler
// sends the character; an input event alone sends nothing). The engine matches on `key`
// (chordFromEvent), so such a key matches no chord, in a terminal or in a text field, and the program
// gets the character. Where the layout types nothing on the chord, `key` is the plain letter and the
// shared chord is the Desktop's (Spanish Ctrl+Alt+K, the palette).
const ALTGR = {
  Spanish: [["e", "€"], ["1", "|"], ["2", "@"], ["3", "#"]],
  Polish: [["a", "ą"], ["e", "ę"], ["o", "ó"], ["z", "ż"]],
};
const physical = (k) => (/^\d$/.test(k) ? { code: `Digit${k}`, keyCode: 48 + Number(k) } : { code: `Key${k.toUpperCase()}`, keyCode: k.toUpperCase().charCodeAt(0) });
/** The events Chromium on Windows gives for AltGr (Ctrl+Alt) and physical key `k` typing `char`. */
const altGrEvents = (k, char) => [
  ["keydown", { key: char, ...physical(k), ctrlKey: true, altKey: true, modifierAltGraph: true }],
  ["keypress", { key: char, code: physical(k).code, charCode: char.codePointAt(0), keyCode: char.codePointAt(0), which: char.codePointAt(0), ctrlKey: true, altKey: true, modifierAltGraph: true }],
];

/** Every default action registered, in the shell's contexts with the tab layer on (localStorage-less:
 * the shipped defaults). */
function registerDefaults(t) {
  resetAllBindings();
  const contextOf = id => (/^(tabs|split)\./.test(id) ? "tabs" : /^sidebar\.key\./.test(id) ? "sidebar" : "global");
  const ran = [];
  const offs = Object.keys(DEFAULT_KEYMAP).map(id => registerAction({ id, label: id, context: contextOf(id), run: () => ran.push(id) }));
  setActiveContexts(new Set(["tabs"]));
  t.after(() => { offs.forEach(off => off()); setActiveContexts(new Set()); resetAllBindings(); });
  return ran;
}
/** The shell's interceptKey (shell.mjs) behind terminal-tab.mjs's custom key handler, on Windows. */
const windowsKeyPath = (event) => {
  const interceptKey = (ev) => {
    if (!matchEvent(ev, { isMac: false, insideTerminal: true })) return false;
    if (ev.type === "keydown") handleKeydown(ev, { isMac: false, insideTerminal: true });
    return true;
  };
  return !terminalKeyDecision(event, interceptKey).handled;
};

test("Windows AltGr: a layout's character on a Ctrl+Alt chord matches no chord and reaches the program", t => {
  const ran = registerDefaults(t);
  const press = xtermTerminal(t, { platform: "Win32", keyHandler: windowsKeyPath });
  assert.equal(press.isWindows, true, "xterm loaded under the Windows platform");
  const dom = new JSDOM(`<input class="ctx-filter"><textarea class="ftask"></textarea>`);
  t.after(() => dom.window.close());
  const fields = [...dom.window.document.querySelectorAll("input, textarea")];
  for (const [layout, keys] of Object.entries(ALTGR)) for (const [k, char] of keys) {
    const name = `${layout} Ctrl+Alt+${k.toUpperCase()} (${char})`;
    const [[, down]] = altGrEvents(k, char);
    // The engine: nothing matches, in a terminal or in a text field, so nothing is prevented.
    assert.equal(matchEvent({ ...down }, { isMac: false, insideTerminal: true }), null, `${name} in a terminal`);
    for (const target of fields) {
      const e = { ...down, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      assert.equal(matchEvent(e, { isMac: false }), null, `${name} in ${target.className}`);
      assert.equal(handleKeydown(e, { isMac: false }), false); assert.equal(e.defaultPrevented, false, `${name}: ${target.className} types it`);
    }
    // xterm, behind the shell's key path: exactly the character.
    const { data, events } = press.sequence(altGrEvents(k, char));
    assert.equal(data, char, `${name} reaches the program`);
    assert.equal(events[0].defaultPrevented, false, `${name}: the keydown is not claimed`);
  }
  assert.deepEqual(ran, [], "no action ran");
  // A plain Ctrl+Alt+E keydown (no AltGr character) is split right: the layouts' own key is the only
  // thing between the two.
  assert.equal(matchEvent({ key: "e", code: "KeyE", ctrlKey: true, altKey: true }, { isMac: false, insideTerminal: true }), "split.vertical");
});

test("Windows: where AltGr types nothing, the shared Ctrl+Alt chords are the Desktop's, in a terminal and in a text field", t => {
  const ran = registerDefaults(t);
  const press = xtermTerminal(t, { platform: "Win32", keyHandler: windowsKeyPath });
  const dom = new JSDOM(`<input class="ctx-filter">`);
  t.after(() => dom.window.close());
  const input = dom.window.document.querySelector("input");
  // Spanish and Polish type nothing on K, P, W, F; Spanish nothing on O, Z, A either.
  for (const [layout, k, id] of [
    ["Spanish", "k", "app.palette"], ["Spanish", "p", "app.quickOpenSouls"], ["Spanish", "w", "tabs.close"], ["Spanish", "f", "sidebar.focusFilter"],
    ["Spanish", "o", "app.workspaces"], ["Spanish", "z", "terminal.focusMode"], ["Spanish", "a", "split.focusNextGroup"], ["Spanish", "9", "tabs.goto9"],
    ["Polish", "k", "app.palette"], ["Polish", "p", "app.quickOpenSouls"], ["Polish", "w", "tabs.close"], ["Polish", "f", "sidebar.focusFilter"],
  ]) {
    const name = `${layout} Ctrl+Alt+${k.toUpperCase()}`;
    const down = { key: k, ...physical(k), ctrlKey: true, altKey: true };
    assert.equal(matchEvent({ ...down, target: input }, { isMac: false }), id, `${name} in a text field`);
    ran.length = 0;
    const { data, events } = press.sequence([["keydown", down]]);
    assert.deepEqual(ran, [id], `${name} runs ${id} in a terminal`);
    assert.equal(data, "", `${name} sends the program nothing`);
    assert.equal(events[0].defaultPrevented, true, `${name} is claimed`);
  }
});
