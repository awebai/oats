// keys.json of the shared home (packages/client/keys-file.mjs): the chord family both clients bind, read from the
// file's text with no fs, and the text the Desktop writes. Every way the file can fail is the default, Alt; a family
// the file names stays, Ctrl+Alt included.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { KEYS_LIMIT, KEYS_WHY, KeysUnwritable, keysPath, chordFamilyFrom, chordFamilyNote, keysWithFamily } from "../packages/client/keys-file.mjs";

test("keys.json sits beside tui.json: $OATS_HOME_DIR when set and not empty, else ~/.oats", () => {
  assert.equal(keysPath({}, "/home/u"), join("/home/u", ".oats", "config", "keys.json"));
  assert.equal(keysPath({ OATS_HOME_DIR: "" }, "/home/u"), join("/home/u", ".oats", "config", "keys.json"));
  assert.equal(keysPath({ OATS_HOME_DIR: "/srv/oats" }, "/home/u"), join("/srv/oats", "config", "keys.json"));
  assert.equal(keysPath(undefined, "/home/u"), join("/home/u", ".oats", "config", "keys.json"));
});

test("the file chooses a family only with a known chords value", () => {
  assert.deepEqual(chordFamilyFrom('{ "chords": "ctrl+shift" }'), { family: "ctrl+shift", why: null });
  assert.deepEqual(chordFamilyFrom('{ "chords": "ctrl+alt", "later": true }'), { family: "ctrl+alt", why: null }, "a chosen Ctrl+Alt stays, now that Alt is the default");
  assert.deepEqual(chordFamilyFrom('{ "chords": "alt" }'), { family: "alt", why: null });
  assert.ok(Object.isFrozen(chordFamilyFrom('{ "chords": "ctrl+shift" }')));
});

test("a missing file, an unreadable one, bad JSON, a missing key and an unknown value are all the default, Alt", () => {
  const cases = [
    [[null], "missing"],
    [[undefined], "missing"],
    [[null, Object.assign(new Error("x"), { code: "ENOENT" })], "missing"],
    [[null, Object.assign(new Error("x"), { code: "ENOTDIR" })], "missing"],
    [[null, Object.assign(new Error("x"), { code: "EACCES" })], "unreadable"],
    [[null, new Error("no code")], "unreadable"],
    [[42], "unreadable"],
    [[Buffer.alloc(KEYS_LIMIT + 1, 0x20)], "too-large"],
    [[Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])], "not-utf8"],
    [[Buffer.from("{}")], "no-chords"],
    [["x".repeat(KEYS_LIMIT + 1)], "too-large"],
    [["{"], "not-json"],
    [[""], "not-json"],
    [["[]"], "not-object"],
    [['"ctrl+shift"'], "not-object"],
    [["null"], "not-object"],
    [["{}"], "no-chords"],
    [['{ "chords": "Ctrl+Shift" }'], "unknown-chords"],
    [['{ "chords": "ctrl+shift+alt" }'], "unknown-chords"],
    [['{ "chords": "Alt" }'], "unknown-chords"],
    [['{ "chords": null }'], "unknown-chords"],
    [['{ "chords": ["ctrl+shift"] }'], "unknown-chords"],
  ];
  for (const [args, why] of cases) {
    assert.deepEqual(chordFamilyFrom(...args), { family: "alt", why }, `${String(args[0]).slice(0, 30)} -> ${why}`);
  }
  // A read error wins over any text handed with it.
  assert.equal(chordFamilyFrom('{ "chords": "ctrl+shift" }', Object.assign(new Error("x"), { code: "EIO" })).why, "unreadable");
});

test("the file's bytes: UTF-8, a byte-order mark ignored, the same family whoever read them", () => {
  const shift = { family: "ctrl+shift", why: null };
  assert.deepEqual(chordFamilyFrom(Buffer.from('{ "chords": "ctrl+shift" }')), shift);
  assert.deepEqual(chordFamilyFrom(new Uint8Array(Buffer.from('{ "chords": "ctrl+shift" }'))), shift, "a Uint8Array as a Buffer");
  assert.deepEqual(chordFamilyFrom(Buffer.from('\uFEFF{ "chords": "ctrl+shift" }')), shift, "a byte-order mark is not text");
  assert.deepEqual(chordFamilyFrom('\uFEFF{ "chords": "ctrl+shift" }'), shift, "nor in text already decoded");
  // A byte that is not UTF-8 makes the whole file no text, even inside a value nobody reads.
  const bad = Buffer.concat([Buffer.from('{ "chords": "ctrl+shift", "x": "'), Buffer.from([0xc3]), Buffer.from('" }')]);
  assert.deepEqual(chordFamilyFrom(bad), { family: "alt", why: "not-utf8" });
  // The limit is in bytes: KEYS_LIMIT two-byte characters are over it.
  assert.equal(chordFamilyFrom(Buffer.from(`{ "x": "${"é".repeat(KEYS_LIMIT / 2)}" }`)).why, "too-large");
  assert.equal(chordFamilyFrom(`{ "x": "${"é".repeat(KEYS_LIMIT / 2)}" }`).why, "too-large");
  assert.deepEqual(chordFamilyFrom(Buffer.alloc(KEYS_LIMIT, 0x20)), { family: "alt", why: "not-json" }, "at the limit it is read");
});

test("the note: why the file was not taken, and nothing when it was, or when there is none", () => {
  assert.equal(chordFamilyNote(chordFamilyFrom('{ "chords": "x" }')), "keys.json: unknown chords value, using Alt");
  assert.equal(chordFamilyNote(chordFamilyFrom("{")), "keys.json is not JSON, using Alt");
  assert.equal(chordFamilyNote(chordFamilyFrom(null, Object.assign(new Error("x"), { code: "EACCES" }))), "keys.json cannot be read, using Alt");
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
  assert.deepEqual(JSON.parse(keysWithFamily(Buffer.from('\uFEFF{ "a": 1 }'), "ctrl+shift")), { a: 1, chords: "ctrl+shift" }, "bytes, a mark dropped");
  // What it writes, it reads back.
  for (const family of ["alt", "ctrl+alt", "ctrl+shift"]) assert.deepEqual(chordFamilyFrom(keysWithFamily('{ "z": 0 }', family)), { family, why: null });
  assert.throws(() => keysWithFamily(null, "ctrl+meta"), /unknown chord family/);
  assert.throws(() => keysWithFamily("{", "ctrl+meta"), TypeError, "the family is checked first");
  assert.throws(() => keysWithFamily(null, undefined), /unknown chord family/);
});

test("the write never loses a key: a file it cannot read as an object, or that would not fit, is refused", () => {
  const refused = (bytes, why) => assert.throws(() => keysWithFamily(bytes, "ctrl+shift"),
    (error) => error instanceof KeysUnwritable && error.code === "E_KEYS_UNWRITABLE" && error.why === why, why);
  refused("{", "not-json");
  refused(Buffer.from("[1]"), "not-object");
  refused("3", "not-object");
  refused("null", "not-object");
  refused(Buffer.from([0x7b, 0xff, 0x7d]), "not-utf8");
  refused(Buffer.alloc(KEYS_LIMIT + 1, 0x20), "too-large");
  // An object that fits when read but not once indented is written on one line, and reads back.
  const compact = JSON.stringify({ chords: "ctrl+alt", later: Array(3000).fill(0) });
  assert.ok(compact.length <= KEYS_LIMIT && JSON.stringify(JSON.parse(compact), null, 2).length > KEYS_LIMIT, "the case is the one meant");
  const written = keysWithFamily(Buffer.from(compact), "ctrl+shift");
  assert.ok(Buffer.byteLength(written) <= KEYS_LIMIT);
  assert.equal(written.includes("\n  "), false, "on one line");
  assert.deepEqual(JSON.parse(written), { chords: "ctrl+shift", later: Array(3000).fill(0) });
  assert.deepEqual(chordFamilyFrom(Buffer.from(written)), { family: "ctrl+shift", why: null }, "what it writes, it reads back");
  // One that does not fit even on one line is refused.
  const frame = JSON.stringify({ chords: "ctrl+alt", pad: "" }).length;
  const full = JSON.stringify({ chords: "ctrl+alt", pad: "x".repeat(KEYS_LIMIT - 1 - frame) });
  assert.equal(full.length, KEYS_LIMIT - 1, "it is read, and ctrl+shift is two bytes longer");
  refused(Buffer.from(full), "too-large");
});
