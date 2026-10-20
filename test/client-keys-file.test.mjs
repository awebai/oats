// keys.json of the shared home (packages/client/keys-file.mjs): the chord family both clients bind, read from the
// file's text with no fs, and the text the Desktop writes. Every way the file can fail is the default, Ctrl+Alt.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { KEYS_LIMIT, KEYS_WHY, keysPath, chordFamilyFrom, chordFamilyNote, keysWithFamily } from "../packages/client/keys-file.mjs";

test("keys.json sits beside tui.json: $OATS_HOME_DIR when set and not empty, else ~/.oats", () => {
  assert.equal(keysPath({}, "/home/u"), join("/home/u", ".oats", "config", "keys.json"));
  assert.equal(keysPath({ OATS_HOME_DIR: "" }, "/home/u"), join("/home/u", ".oats", "config", "keys.json"));
  assert.equal(keysPath({ OATS_HOME_DIR: "/srv/oats" }, "/home/u"), join("/srv/oats", "config", "keys.json"));
  assert.equal(keysPath(undefined, "/home/u"), join("/home/u", ".oats", "config", "keys.json"));
});

test("the file chooses a family only with a known chords value", () => {
  assert.deepEqual(chordFamilyFrom('{ "chords": "ctrl+shift" }'), { family: "ctrl+shift", why: null });
  assert.deepEqual(chordFamilyFrom('{ "chords": "ctrl+alt", "later": true }'), { family: "ctrl+alt", why: null });
  assert.ok(Object.isFrozen(chordFamilyFrom('{ "chords": "ctrl+shift" }')));
});

test("a missing file, an unreadable one, bad JSON, a missing key and an unknown value are all Ctrl+Alt", () => {
  const cases = [
    [[null], "missing"],
    [[undefined], "missing"],
    [[null, Object.assign(new Error("x"), { code: "ENOENT" })], "missing"],
    [[null, Object.assign(new Error("x"), { code: "ENOTDIR" })], "missing"],
    [[null, Object.assign(new Error("x"), { code: "EACCES" })], "unreadable"],
    [[null, new Error("no code")], "unreadable"],
    [[Buffer.from("{}")], "unreadable"],
    [["x".repeat(KEYS_LIMIT + 1)], "too-large"],
    [["{"], "not-json"],
    [[""], "not-json"],
    [["[]"], "not-object"],
    [['"ctrl+shift"'], "not-object"],
    [["null"], "not-object"],
    [["{}"], "no-chords"],
    [['{ "chords": "Ctrl+Shift" }'], "unknown-chords"],
    [['{ "chords": "ctrl+shift+alt" }'], "unknown-chords"],
    [['{ "chords": null }'], "unknown-chords"],
    [['{ "chords": ["ctrl+shift"] }'], "unknown-chords"],
  ];
  for (const [args, why] of cases) {
    assert.deepEqual(chordFamilyFrom(...args), { family: "ctrl+alt", why }, `${String(args[0]).slice(0, 30)} -> ${why}`);
  }
  // A read error wins over any text handed with it.
  assert.equal(chordFamilyFrom('{ "chords": "ctrl+shift" }', Object.assign(new Error("x"), { code: "EIO" })).why, "unreadable");
});

test("the note: why the file was not taken, and nothing when it was, or when there is none", () => {
  assert.equal(chordFamilyNote(chordFamilyFrom('{ "chords": "x" }')), "keys.json: unknown chords value, using Ctrl+Alt");
  assert.equal(chordFamilyNote(chordFamilyFrom("{")), "keys.json is not JSON, using Ctrl+Alt");
  assert.equal(chordFamilyNote(chordFamilyFrom(null, Object.assign(new Error("x"), { code: "EACCES" }))), "keys.json cannot be read, using Ctrl+Alt");
  assert.equal(chordFamilyNote(chordFamilyFrom('{ "chords": "ctrl+shift" }')), null);
  assert.equal(chordFamilyNote(chordFamilyFrom(null)), null, "no file is the default, with nothing to say");
  assert.equal(chordFamilyNote(null), null);
  assert.equal(chordFamilyNote({ family: "ctrl+alt", why: "__proto__" }), null);
  for (const why of Object.keys(KEYS_WHY)) assert.equal(typeof KEYS_WHY[why], "string");
});

test("the Desktop's write sets chords and keeps every other key, in its place", () => {
  assert.equal(keysWithFamily(null, "ctrl+shift"), '{\n  "chords": "ctrl+shift"\n}\n');
  assert.deepEqual(JSON.parse(keysWithFamily('{ "a": 1, "chords": "ctrl+alt", "b": { "c": [2] } }', "ctrl+shift")),
    { a: 1, chords: "ctrl+shift", b: { c: [2] } });
  assert.deepEqual(Object.keys(JSON.parse(keysWithFamily('{ "a": 1, "chords": "ctrl+alt", "b": 2 }', "ctrl+shift"))), ["a", "chords", "b"]);
  assert.deepEqual(JSON.parse(keysWithFamily('{ "a": 1 }', "ctrl+alt")), { a: 1, chords: "ctrl+alt" });
  // A file that is not a JSON object has no key to keep.
  for (const text of ["{", "[1]", "3", "x".repeat(KEYS_LIMIT + 1)]) assert.deepEqual(JSON.parse(keysWithFamily(text, "ctrl+shift")), { chords: "ctrl+shift" });
  // What it writes, it reads back.
  for (const family of ["ctrl+alt", "ctrl+shift"]) assert.deepEqual(chordFamilyFrom(keysWithFamily('{ "z": 0 }', family)), { family, why: null });
  assert.throws(() => keysWithFamily(null, "ctrl+meta"), /unknown chord family/);
  assert.throws(() => keysWithFamily(null, undefined), /unknown chord family/);
});
