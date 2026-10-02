// Settings → Terminal (spec F, the operator's 2026-10-02 decision): the default
// terminal size is 15px and every reset lands there; a stepper in Settings
// changes the size live, clamped to 9–28 and persisted, on the same store as
// ⌘= / ⌘- / ⌘0 and the palette, so the keys and the control always agree.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { createTerminalSettings } from "../renderer/settings-terminal.mjs";
import { createConnections } from "../renderer/connections.mjs";

const read = name => readFileSync(new URL(`../renderer/${name}`, import.meta.url), "utf8");
const themeSource = read("theme.mjs"), shell = read("shell.mjs");

/** The shipped theme module over a jsdom document and a real-shaped storage. */
function rig(t, stored = {}) {
  const dom = new JSDOM('<!doctype html><body><button id="opener">Settings</button></body>', { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const style = doc.createElement("style"); style.textContent = read("theme.css"); doc.head.append(style);
  const context = {
    document: doc, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    window: { matchMedia: () => ({ matches: false, addEventListener() {} }) },
    localStorage: { getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = String(value); }, removeItem: key => { delete stored[key]; } },
  };
  const theme = runInNewContext(`${themeSource.replace(/\bexport /g, "")}
({ terminalTypography, setTerminalFontSize, resetTerminalFontSize, resetTerminalTypography, onTerminalTypographyChange, TERMINAL_FONT_SIZE })`, context);
  // The section's default store, composed from this theme instance (the same four calls).
  const store = { read: () => theme.terminalTypography().fontSize, set: theme.setTerminalFontSize,
    reset: theme.resetTerminalFontSize, subscribe: theme.onTerminalTypographyChange };
  const section = createTerminalSettings({ doc, store, chords: { bigger: "⌘=", smaller: "⌘-", reset: "⌘0" } });
  doc.body.append(section.element);
  const q = selector => section.element.querySelector(selector);
  const ui = {
    input: q("input"), smaller: q('button[aria-label="Decrease font size"]'), bigger: q('button[aria-label="Increase font size"]'),
    reset: [...section.element.querySelectorAll("button")].find(b => b.textContent.startsWith("Reset")),
  };
  const type = value => { ui.input.value = value; ui.input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); };
  // The shell's ⌘= and ⌘- actions, verbatim from shell.mjs (asserted below).
  const keys = { bigger: () => theme.setTerminalFontSize(theme.terminalTypography().fontSize + 1),
    smaller: () => theme.setTerminalFontSize(theme.terminalTypography().fontSize - 1) };
  return { dom, doc, theme, stored, section, ui, type, keys };
}
const SIZE = "oats.desktop.terminal.fontSize";

test("the default terminal size is 15px, and every reset (⌘0, the palette, Settings) lands on 15", t => {
  const r = rig(t, { [SIZE]: "20", "oats.desktop.terminal.fontFamily": "Menlo" });
  assert.equal(r.theme.TERMINAL_FONT_SIZE, 15);
  assert.equal(r.dom.window.getComputedStyle(r.doc.documentElement).getPropertyValue("--term-font-size").trim(), "15px");
  assert.equal(r.ui.input.value, "20", "a stored user size wins over the default");
  r.ui.reset.click();
  assert.equal(r.theme.terminalTypography().fontSize, 15); assert.equal(r.stored[SIZE], undefined, "reset stores nothing");
  assert.equal(r.stored["oats.desktop.terminal.fontFamily"], "Menlo", "Settings resets the size only; the family is the palette's");
  assert.equal(r.ui.input.value, "15");
  assert.equal(r.ui.reset.textContent, "Reset to default (15)");
  r.theme.setTerminalFontSize(22); r.theme.resetTerminalTypography(); // ⌘0 and "Terminal: reset typography"
  assert.equal(r.theme.terminalTypography().fontSize, 15);
  assert.equal(r.ui.input.value, "15");
  assert.equal(shell.match(/run: \(\) => resetTerminalTypography\(\) \}/g)?.length, 2, "both shell resets use the forgetting reset");
});

test("the stepper changes the size live, clamps to 9–28 and persists; its bounds stay focusable", t => {
  const r = rig(t);
  const heard = [];
  r.theme.onTerminalTypographyChange(value => heard.push(value.fontSize)); // what every open terminal listens to
  r.ui.bigger.click(); r.ui.bigger.click();
  assert.equal(r.ui.input.value, "17"); assert.equal(r.stored[SIZE], "17"); assert.deepEqual(heard, [16, 17]);
  r.ui.smaller.click();
  assert.equal(r.stored[SIZE], "16");
  r.type("40");
  assert.equal(r.ui.input.value, "28", "a typed value above the range reads back as what applies");
  assert.equal(r.stored[SIZE], "28"); assert.equal(r.ui.bigger.getAttribute("aria-disabled"), "true");
  r.ui.bigger.click(); assert.equal(r.stored[SIZE], "28", "no step past the top");
  assert.equal(r.ui.bigger.disabled, false, "aria-disabled, not disabled: a focused button keeps focus at the bound");
  r.type("3");
  assert.equal(r.ui.input.value, "9"); assert.equal(r.stored[SIZE], "9");
  assert.equal(r.ui.smaller.getAttribute("aria-disabled"), "true"); assert.equal(r.ui.bigger.getAttribute("aria-disabled"), "false");
  r.ui.smaller.click(); assert.equal(r.stored[SIZE], "9");
  r.type("12.6"); assert.equal(r.stored[SIZE], "13", "whole pixels");
  for (const junk of ["", "abc", "  "]) { r.type(junk); assert.equal(r.ui.input.value, "13", `"${junk}" restores the size, never applies`); }
  assert.equal(r.stored[SIZE], "13");
  // Enter commits too; plain typing does not (no "1" on the way to "12").
  r.ui.input.value = "1"; r.ui.input.dispatchEvent(new r.dom.window.Event("input", { bubbles: true }));
  assert.equal(r.stored[SIZE], "13", "no commit per keystroke");
  r.ui.input.value = "12"; r.ui.input.dispatchEvent(new r.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(r.stored[SIZE], "12");
});

test("⌘= / ⌘- and the stepper agree: either one moves the other", t => {
  const r = rig(t);
  r.keys.bigger(); r.keys.bigger();
  assert.equal(r.ui.input.value, "17", "⌘= updates the open control");
  r.ui.smaller.click();
  assert.equal(r.theme.terminalTypography().fontSize, 16, "the stepper is what ⌘= reads next");
  r.keys.bigger();
  assert.equal(r.ui.input.value, "17");
  r.keys.smaller();
  assert.equal(r.ui.input.value, "16");
  // The keys are the shell's registered actions (and the palette's commands).
  assert.match(shell, /id: "terminal\.fontBigger"[^\n]*run: \(\) => setTerminalFontSize\(terminalTypography\(\)\.fontSize \+ 1\)/);
  assert.match(shell, /id: "terminal\.fontSmaller"[^\n]*run: \(\) => setTerminalFontSize\(terminalTypography\(\)\.fontSize - 1\)/);
  r.section.dispose();
  r.keys.bigger();
  assert.equal(r.ui.input.value, "16", "a closed section no longer listens");
});

test("the section is labelled and keyboard-operable, built from the Settings components", t => {
  const r = rig(t);
  const el = r.section.element;
  assert.equal(el.getAttribute("aria-labelledby"), "settings-terminal-title");
  assert.equal(r.doc.getElementById("settings-terminal-title").textContent, "Terminal");
  assert.equal(r.ui.input.type, "number"); assert.deepEqual([r.ui.input.min, r.ui.input.max, r.ui.input.step], ["9", "28", "1"]);
  assert.equal(r.doc.querySelector(`label[for="${r.ui.input.id}"]`).textContent, "Font size", "the field's label");
  assert.match(r.doc.getElementById(r.ui.input.getAttribute("aria-describedby")).textContent, /every open terminal, from 9 to 28px\. ⌘= \/ ⌘- \/ ⌘0 change it too\./);
  assert.ok([r.ui.smaller, r.ui.bigger, r.ui.reset].every(b => b.type === "button" && b.tabIndex >= 0));
  assert.ok(el.querySelector(".forge-card") && el.querySelector(".forge-actions") && el.querySelector(".forge-hint"), "the dialog's own card, actions and hint");
  assert.match(read("settings-terminal.mjs"), /read: \(\) => terminalTypography\(\)\.fontSize, set: setTerminalFontSize, reset: resetTerminalFontSize,\s+subscribe: onTerminalTypographyChange,/,
    "the shipped default store is the composition the tests use");
});

test("Settings mounts Terminal after Connections, traps Tab through its field, and disposes it on close; the button is titled Settings", async t => {
  const dom = new JSDOM('<!doctype html><body><button id="opener">Settings</button></body>', { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  let size = 15, disposed = 0;
  const listeners = new Set();
  const store = { read: () => size, set: v => { size = v; for (const fn of listeners) fn({ fontSize: v }); }, reset: () => store.set(15),
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); disposed++; }; } };
  const view = createConnections({ doc, desk: {}, terminalFactory: assert.fail,
    request: async () => ({ forgeApi: 1, status: "not-connected", host: "github.com", login: null, hostRef: "d".repeat(64), connectionRef: "f".repeat(64), hosts: [{ host: "github.com", hostRef: "d".repeat(64) }] }),
    sections: [() => createTerminalSettings({ doc, store })] });
  t.after(() => view.dispose());
  doc.getElementById("opener").focus();
  view.open(); await new Promise(resolve => setImmediate(resolve));
  const dialog = doc.querySelector('[role="dialog"]');
  assert.deepEqual([...dialog.querySelectorAll(":scope > h3, :scope > section > h3")].map(h => h.textContent), ["Connections", "GitHub", "Terminal"], "Terminal follows the Connections section (its GitHub card)");
  const controls = [...dialog.querySelectorAll("button,select,input")].filter(el => !el.hidden);
  const last = controls.at(-1);
  assert.equal(last.textContent, "Reset to default (15)");
  last.focus();
  last.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  assert.equal(doc.activeElement, controls[0], "Tab wraps inside the dialog");
  const field = dialog.querySelector('input[type="number"]');
  assert.ok(controls.includes(field), "the size field is part of the trap");
  view.close();
  assert.equal(disposed, 1, "closing Settings drops the section's subscription");
  assert.equal(doc.querySelector('[role="dialog"]'), null);
  const html = read("index.html");
  assert.match(html, /id="sidebar-settings"[^>]*\n?\s*title="Settings" aria-label="Settings"/);
  assert.match(shell, /sections: \[\(\) => createTerminalSettings\(\{ doc: document, chords: \{/);
  assert.match(shell, /connectionsCSS \+ settingsTerminalCSS/);
});
