// The palette's "Instance: name and colour…" (shell.mjs), activated through the real palette: the palette closes
// before its command runs and leaves focus nowhere (overlay-picker.mjs activate: the command owns it), so the entry
// first hands focus back where the palette was opened (takePickerFocusReturn), as "Workspaces: show only the current
// workspace" does. With no target the hint line says why and focus is on that control again, never <body>; with a
// target the name and colour dialog opens, and closing it returns there. The shipped entry, openInstanceEdit and
// sayInHint run here as shell.mjs has them, over the real palette, leader hint and dialog.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { JSDOM } from "jsdom";
import { createPalette } from "../renderer/palette.mjs";
import { takePickerFocusReturn } from "../renderer/overlay-picker.mjs";
import { createLeaderHint } from "../renderer/leader-hint.mjs";
import { createInstanceColorDialog } from "../renderer/instance-color-dialog.mjs";

const shell = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
const entrySource = shell.match(/^ {4}\{ label: "Instance: name and colour…"[^]*?\} \},$/m)?.[0];
const openInstanceEditSource = shell.match(/^function openInstanceEdit\([^]*?\n\}/m)?.[0];
const sayInHintSource = shell.match(/^function sayInHint\([^]*?\n\}/m)?.[0];
const row = { instance: "dev-1", home: "/fixture/team/agents/dev/instances/dev-1" };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function rig(t, entry = entrySource) {
  const dom = new JSDOM(`<!doctype html><body><aside id="sidebar"><div id="sidebar-bar"><button id="sidebar-spawn" type="button">Spawn instance</button></div></aside>
    <main id="main"><button id="show-panel" type="button">Show instance panel</button></main></body>`, { pretendToBeVisual: true });
  const doc = dom.window.document;
  const leaderHint = createLeaderHint({ doc, host: doc.getElementById("main"), before: doc.getElementById("show-panel") });
  const dialog = createInstanceColorDialog({ doc, request: async () => ({ status: "ok", instance: "dev-1", check: true }) });
  const closed = [];
  const context = {
    document: doc, setTimeout, takePickerFocusReturn, leaderHint, instanceColorDialog: dialog, paletteTargetId: null,
    chordDetail: () => () => "",
    rosterInstance: id => (id === "dev-1" ? row : null), heldHome: () => null, heldLine: () => "",
    connections: { close: () => closed.push("connections") }, shortcutsEditor: { close: () => closed.push("shortcuts") },
    lifecycleDialog: { close: () => closed.push("lifecycle") }, forgetDialog: { close: () => closed.push("forget") },
  };
  const command = runInNewContext(`${sayInHintSource}\n${openInstanceEditSource}\n[${entry}][0]`, context);
  const palette = createPalette({ loadInstances: async () => [], openTerminal() {}, commands: [command], doc });
  t.after(() => { palette.close(); dialog.dispose(); dom.window.close(); });
  /** Open the palette from `opener` (the leader's target then: `target`), and activate the entry by Enter. */
  const viaPalette = async (opener, target) => {
    opener.focus();
    context.paletteTargetId = target; // app.palette records leaderTargetId(document.activeElement) as it opens
    await palette.open();
    const input = doc.querySelector(".palette-input");
    input.value = ">name and colour"; input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
  };
  const hintLine = () => doc.querySelector("#leader-hint .leader-hint-line")?.textContent ?? null;
  return { dom, doc, viaPalette, hintLine, closed, control: doc.getElementById("sidebar-spawn") };
}

test("the shipped entry hands focus back before it opens anything", () => {
  assert.ok(entrySource && openInstanceEditSource && sayInHintSource, "the shipped entry, openInstanceEdit and sayInHint");
  assert.match(entrySource, /run: \(\) => \{ takePickerFocusReturn\(document\)\?\.restore\(\); openInstanceEdit\(paletteTargetId\); \}/);
});

test("with no target: the hint line says why and focus is on the control the palette was opened from, never <body>", async t => {
  const r = rig(t);
  await r.viaPalette(r.control, null);
  assert.equal(r.doc.querySelector(".palette-input"), null, "the palette closed");
  assert.equal(r.hintLine(), "No instance is focused or selected.");
  assert.equal(r.doc.activeElement, r.control, "the opener again");
  assert.notEqual(r.doc.activeElement, r.doc.body);
  assert.equal(r.doc.querySelector("[role=dialog]"), null, "no dialog opens");
  assert.deepEqual(r.closed, [], "nothing else is closed for a refusal");
});

test("without the hand-back (the line before this fix) the same refusal leaves focus on <body>", async t => {
  const before = entrySource.replace("takePickerFocusReturn(document)?.restore(); ", "");
  assert.notEqual(before, entrySource);
  const r = rig(t, before);
  await r.viaPalette(r.control, null);
  assert.equal(r.hintLine(), "No instance is focused or selected.");
  assert.equal(r.doc.activeElement, r.doc.body, "what the fix repairs");
});

test("with a target: the name and colour dialog opens for it; Esc returns focus to the control", async t => {
  const r = rig(t);
  await r.viaPalette(r.control, "dev-1");
  const dialog = r.doc.querySelector("[role=dialog]");
  assert.ok(dialog, "the dialog opened");
  assert.equal(r.doc.querySelector(".instance-color-name").textContent, "dev-1");
  assert.ok(dialog.contains(r.doc.activeElement), "focus in the dialog");
  assert.equal(r.hintLine(), null, "nothing said");
  assert.deepEqual(r.closed, ["connections", "shortcuts", "lifecycle", "forget"], "the other dialogs close first");
  r.doc.activeElement.dispatchEvent(new r.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(r.doc.querySelector("[role=dialog]"), null, "closed");
  assert.equal(r.doc.activeElement, r.control, "back where the palette was opened");
});
