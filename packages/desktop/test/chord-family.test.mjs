// The chord family in the page (renderer/chord-family.mjs): main's answer taken as the window starts
// and checked again, its pushes followed, the Shortcuts page's choice written through it, and each
// state applied to the keymap engine at once. A fake bridge stands for main. The shell awaits the
// answer before it listens to its first key: pinned on its source.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_CHORD_STATE, chordFamilyState, createChordFamily } from "../renderer/chord-family.mjs";
import { activeChordFamily, getBinding, setChordFamily } from "../renderer/keybindings.mjs";

/** A bridge that answers `answer`, pushes on demand, and writes as told. */
function fakeDesk({ answer = { family: "alt", why: "missing", note: null }, fail = false } = {}) {
  const pushes = new Set(), writes = [];
  return {
    writes, pushes,
    push: (state) => { for (const fn of [...pushes]) fn(state); },
    chordFamily: async () => (typeof answer === "function" ? answer() : answer),
    setChordFamily: async (family) => { writes.push(family); if (fail) throw new Error("EACCES"); return { family, why: null, note: null }; },
    onChordFamilyChanged: (fn) => { pushes.add(fn); return () => pushes.delete(fn); },
  };
}

test("what main sends is checked again: an unknown family is the default, and the note is a short line or nothing", () => {
  assert.deepEqual(DEFAULT_CHORD_STATE, { family: "alt", note: null });
  assert.deepEqual(chordFamilyState({ family: "ctrl+shift", why: null, note: null }), { family: "ctrl+shift", note: null });
  assert.deepEqual(chordFamilyState({ family: "ctrl+alt", why: null, note: null }), { family: "ctrl+alt", note: null }, "Ctrl+Alt, chosen, stays");
  assert.deepEqual(chordFamilyState({ family: "alt", note: "keys.json is not JSON, using Alt" }), { family: "alt", note: "keys.json is not JSON, using Alt" });
  for (const value of [null, undefined, "ctrl+shift", {}, { family: "Ctrl+Shift" }, { family: "Alt" }, { family: ["ctrl+shift"] }]) {
    assert.deepEqual(chordFamilyState(value), DEFAULT_CHORD_STATE, JSON.stringify(value));
  }
  for (const note of [1, "", "   ", "x".repeat(201), { text: "x" }]) assert.equal(chordFamilyState({ family: "alt", note }).note, null, JSON.stringify(note));
  assert.ok(Object.isFrozen(chordFamilyState({ family: "ctrl+shift" })));
});

test("start: main's answer is applied before start resolves; without a bridge, or an answer, the family is the default", async t => {
  t.after(() => setChordFamily("alt"));
  const applied = [];
  const desk = fakeDesk({ answer: { family: "ctrl+shift", why: null, note: null } });
  const family = createChordFamily({ desk, apply: (f) => applied.push(f) });
  assert.equal(family.start(), family.start(), "asked once");
  assert.deepEqual(await family.start(), { family: "ctrl+shift", note: null });
  assert.deepEqual(applied, ["ctrl+shift"]);
  for (const bare of [undefined, null, {}, { chordFamily: async () => { throw new Error("no handler"); } }, { chordFamily: async () => ({ family: "nope" }) }]) {
    const seen = [];
    const f = createChordFamily({ desk: bare, apply: (x) => seen.push(x) });
    assert.deepEqual(await f.start(), DEFAULT_CHORD_STATE);
    assert.deepEqual(seen, [], "the default is already bound: nothing to apply");
  }
  // With the engine: every reader follows the answer.
  const engine = createChordFamily({ desk: fakeDesk({ answer: { family: "ctrl+shift" } }), apply: setChordFamily });
  await engine.start();
  assert.equal(activeChordFamily(), "ctrl+shift");
  assert.equal(getBinding("app.workspaces", false), "Ctrl+Shift+S");
  const ctrlAlt = createChordFamily({ desk: fakeDesk({ answer: { family: "ctrl+alt", why: null, note: null } }), apply: setChordFamily });
  await ctrlAlt.start();
  assert.equal(activeChordFamily(), "ctrl+alt");
  assert.equal(getBinding("app.workspaces", false), "Ctrl+Alt+O");
});

test("pushes: another window's choice or a hand edit is applied at once, and listeners hear family and note changes", async t => {
  const applied = [], heard = [];
  const desk = fakeDesk();
  const family = createChordFamily({ desk, apply: (f) => applied.push(f) });
  await family.start();
  const off = family.onChange((s) => heard.push(s));
  desk.push({ family: "ctrl+shift", why: null, note: null });
  assert.deepEqual(family.current(), { family: "ctrl+shift", note: null });
  desk.push({ family: "ctrl+shift", why: null, note: null });
  desk.push({ family: "ctrl+alt", why: null, note: null });
  desk.push({ family: "alt", why: "unknown-chords", note: "keys.json: unknown chords value, using Alt" });
  assert.deepEqual(applied, ["ctrl+shift", "ctrl+alt", "alt"]);
  assert.deepEqual(heard.map((s) => [s.family, s.note]), [["ctrl+shift", null], ["ctrl+alt", null], ["alt", "keys.json: unknown chords value, using Alt"]]);
  off();
  family.dispose();
  desk.push({ family: "ctrl+shift" });
  assert.equal(family.current().family, "alt", "disposed: main's pushes no longer reach it");
  assert.equal(desk.pushes.size, 0);
});

test("set: written through main, the answer applied; a failed write, or no bridge, changes nothing", async t => {
  const applied = [];
  const desk = fakeDesk();
  const family = createChordFamily({ desk, apply: (f) => applied.push(f) });
  await family.start();
  assert.deepEqual(await family.set("ctrl+shift"), { family: "ctrl+shift", note: null });
  assert.deepEqual(await family.set("ctrl+alt"), { family: "ctrl+alt", note: null });
  assert.deepEqual(desk.writes, ["ctrl+shift", "ctrl+alt"]);
  assert.deepEqual(applied, ["ctrl+shift", "ctrl+alt"]);
  const failing = createChordFamily({ desk: fakeDesk({ fail: true }), apply: (f) => applied.push(f) });
  await failing.start();
  await assert.rejects(failing.set("ctrl+shift"), /EACCES/);
  assert.deepEqual(failing.current(), DEFAULT_CHORD_STATE);
  await assert.rejects(createChordFamily({ desk: {} }).set("ctrl+shift"), /cannot write keys\.json/);
  assert.deepEqual(applied, ["ctrl+shift", "ctrl+alt"]);
});

test("the shell has the family before it listens to its first key, and hands it to the Shortcuts page", () => {
  const shell = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
  const made = shell.indexOf("const chordFamily = createChordFamily({ desk, apply: setChordFamily });");
  const started = shell.indexOf("const chordFamilyRead = chordFamily.start();");
  const awaited = shell.indexOf("await chordFamilyRead;");
  const listens = shell.indexOf('window.addEventListener("keydown", (e) => handleKeydown(e));');
  assert.ok(made > 0 && made < started && started < awaited, "made, asked, then awaited");
  assert.ok(awaited < listens, "awaited before the one keydown listener");
  assert.ok(awaited < shell.indexOf("createTerminalTab("), "and before any terminal's key path");
  assert.ok(shell.indexOf("await startWindow()") < awaited && started < shell.indexOf("await startWindow()"), "asked beside the window's start");
  assert.match(shell, /createKeybindingsEditor\(\{ doc: document, isMac, chordFamily \}\)/);
});
