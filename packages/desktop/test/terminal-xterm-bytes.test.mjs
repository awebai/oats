// The terminal rule's guard: on Linux/Windows a chord fires in a terminal only when xterm sends
// nothing for it, or when what it sends is a byte the program still gets from a plainer key
// (docs/desktop-keyboard.md, principle 2). Each terminal-allowlisted action's Linux default is
// pressed in a real xterm.js Terminal, the installed @xterm/xterm the renderer loads
// (index.html's script tag), and what xterm sends (onData) is pinned exactly. An xterm upgrade
// that starts sending something for one of them, or a new allowlisted action whose chord sends
// data without a row in SENDS, fails here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { JSDOM, VirtualConsole } from "jsdom";
import { TERMINAL_ALLOWLIST, defaultBinding, parseChord } from "../renderer/keybindings.mjs";
import { terminalOptions } from "../renderer/terminal-tab.mjs";

const XTERM = readFileSync(createRequire(import.meta.url).resolve("@xterm/xterm"), "utf8");

// The allowlisted defaults that send something, each with the plainer key that sends the same.
// focus.leaveTerminal has none: it is the one deliberate exception, the way out of a terminal.
const SENDS = {
  "stage.automations": { data: "\x1b", plainer: "Escape" },
  "tabs.next": { data: "\t", plainer: "Tab" },
  "tabs.prev": { data: "\x1b[Z", plainer: "Shift+Tab" },
  "split.close": { data: "\x1b\x17", plainer: "Ctrl+Alt+W" },
  "focus.leaveTerminal": { data: "\x1b[17;6~", plainer: null },
};

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
      ",": [",", "Comma", 188], "=": ["=", "Equal", 187], "-": ["-", "Minus", 189],
      tab: ["Tab", "Tab", 9], space: [" ", "Space", 32], escape: ["Escape", "Escape", 27],
    }[c.key];
    assert.ok(named, `no keydown description for ${chordString}: add its key here`);
    [key, code, keyCode] = named;
  }
  return { key, code, keyCode, ctrlKey: c.mod || c.ctrl, shiftKey: c.shift, altKey: c.alt, metaKey: false };
}

function xtermTerminal(t) {
  const virtualConsole = new VirtualConsole(); // jsdom has no canvas: xterm's measuring falls back, quietly
  const dom = new JSDOM(`<div id="host"></div>`, { runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  t.after(() => dom.window.close());
  const { window } = dom;
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
  return (init) => {
    sent = [];
    textarea.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    return sent.join("");
  };
}

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
    assert.equal(press(keydownInit(plainer)), data, `${id}: ${plainer} sends the same`);
  }
  assert.equal(SENDS["focus.leaveTerminal"].plainer, null, "the one deliberate exception");
});
