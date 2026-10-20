// keys.json, main side (chord-family.mjs): the chord family read from this user's file and written
// when the Shortcuts page asks, and the IPC that hands it to every window. The file system is real,
// in a temporary OATS_HOME_DIR each test makes and removes, and `home` names a directory that does
// not exist: the real ~/.oats is never read or written. Recording wraps of the real calls pin what
// is opened, read, written and renamed. No Electron.
import test from "node:test";
import assert from "node:assert/strict";
import * as realFs from "node:fs";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KEYS_LIMIT } from "../../client/keys-file.mjs";
import { CHORD_FAMILY_FS, createChordFamilySource, installChordFamilyHandlers, readChordFamily, readKeysBytes, writeChordFamily } from "../chord-family.mjs";

const NO_HOME = join("/", "nonexistent", "chord-family-test-home");

/** A temporary OATS_HOME_DIR, removed after the test; `file` is its config/keys.json. */
function home(t) {
  const dir = mkdtempSync(join(tmpdir(), "chord-family-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, "config"), file = join(config, "keys.json");
  return { dir, config, file, env: { OATS_HOME_DIR: dir }, write(text) { mkdirSync(config, { recursive: true }); writeFileSync(file, text); } };
}
/** The real fs calls chord-family.mjs makes, each recorded as [name, ...args] (a buffer as its length). */
function recording(overrides = {}) {
  const calls = [];
  const names = CHORD_FAMILY_FS;
  const fs = Object.fromEntries(names.map((name) => [name, (...args) => {
    calls.push([name, ...args.map((a) => (Buffer.isBuffer(a) ? `<${a.length} bytes>` : a))]);
    return (overrides[name] ?? realFs[name])(...args);
  }]));
  return { fs, calls };
}
const state = (family, why = null, note = null) => ({ family, why, note });

test("the path is config/keys.json in OATS_HOME_DIR, else in ~/.oats", () => {
  assert.equal(createChordFamilySource({ fs: realFs, env: { OATS_HOME_DIR: "/x/oats" }, home: NO_HOME }).path, "/x/oats/config/keys.json");
  assert.equal(createChordFamilySource({ fs: realFs, env: {}, home: "/home/u" }).path, "/home/u/.oats/config/keys.json");
  assert.equal(createChordFamilySource({ fs: realFs, env: { OATS_HOME_DIR: "" }, home: "/home/u" }).path, "/home/u/.oats/config/keys.json");
});

test("read: the family the file names, and every way it can fail is Ctrl+Alt, with the note the page shows", t => {
  const h = home(t);
  assert.deepEqual(readChordFamily(realFs, join(h.dir, "nowhere", "config", "keys.json")), state("ctrl+alt", "missing"), "no OATS_HOME_DIR yet");
  assert.deepEqual(readChordFamily(realFs, h.file), state("ctrl+alt", "missing"), "no file: the default, nothing to say");
  for (const [text, expected] of [
    ['{ "chords": "ctrl+shift" }', state("ctrl+shift")],
    ['{ "chords": "ctrl+alt", "later": { "key": 1 } }', state("ctrl+alt")],
    ["{ chords: ctrl+shift", state("ctrl+alt", "not-json", "keys.json is not JSON, using Ctrl+Alt")],
    ["", state("ctrl+alt", "not-json", "keys.json is not JSON, using Ctrl+Alt")],
    ['["ctrl+shift"]', state("ctrl+alt", "not-object", "keys.json is not an object, using Ctrl+Alt")],
    ["{}", state("ctrl+alt", "no-chords", "keys.json names no chords, using Ctrl+Alt")],
    ['{ "chords": "Ctrl+Shift" }', state("ctrl+alt", "unknown-chords", "keys.json: unknown chords value, using Ctrl+Alt")],
    ['{ "chords": "ctrl+meta" }', state("ctrl+alt", "unknown-chords", "keys.json: unknown chords value, using Ctrl+Alt")],
  ]) {
    h.write(text);
    const read = readChordFamily(realFs, h.file);
    assert.deepEqual(read, expected, text);
    assert.ok(Object.isFrozen(read));
  }
  // The bytes as the shared reader decodes them, the TUI's too (packages/tui/test/config.test.mjs has the same
  // two files): a byte-order mark is no text, and a byte that is not UTF-8 makes the file none.
  h.write(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{ "chords": "ctrl+shift" }')]));
  assert.deepEqual(readChordFamily(realFs, h.file), state("ctrl+shift"), "a byte-order mark");
  h.write(Buffer.concat([Buffer.from('{ "chords": "ctrl+shift", "x": "'), Buffer.from([0xc3]), Buffer.from('" }')]));
  assert.deepEqual(readChordFamily(realFs, h.file), state("ctrl+alt", "not-utf8", "keys.json is not UTF-8 text, using Ctrl+Alt"));
  // A directory where the file should be: a file that cannot be read.
  rmSync(h.file); mkdirSync(h.file);
  assert.deepEqual(readChordFamily(realFs, h.file), state("ctrl+alt", "unreadable", "keys.json cannot be read, using Ctrl+Alt"));
});

test("read: a file this user may not read is unreadable", { skip: process.getuid?.() === 0 && "root reads every file" }, t => {
  const h = home(t);
  h.write('{ "chords": "ctrl+shift" }');
  chmodSync(h.file, 0o000); // removed with its directory: a file's own mode does not stop that
  assert.deepEqual(readChordFamily(realFs, h.file), state("ctrl+alt", "unreadable", "keys.json cannot be read, using Ctrl+Alt"));
});

test("read: at most KEYS_LIMIT + 1 bytes; a longer file is too large, one at the limit is read", t => {
  const h = home(t);
  const json = '{ "chords": "ctrl+shift" }';
  h.write(json + " ".repeat(KEYS_LIMIT - json.length));
  assert.deepEqual(readChordFamily(realFs, h.file), state("ctrl+shift"), "exactly the limit");
  h.write(json + " ".repeat(1024 * 1024));
  const { fs, calls } = recording();
  assert.deepEqual(readChordFamily(fs, h.file), state("ctrl+alt", "too-large", "keys.json is too large, using Ctrl+Alt"));
  const asked = calls.filter(([name]) => name === "readSync").reduce((sum, [, , , , length]) => sum + length, 0);
  assert.ok(asked <= KEYS_LIMIT + 1, `asked for ${asked} bytes`);
  // A long multi-byte file is too large too, not "not UTF-8" because the read cut a character.
  h.write(`{ "chords": "ctrl+shift", "x": "${"é".repeat(KEYS_LIMIT)}" }`);
  assert.equal(readChordFamily(realFs, h.file).why, "too-large");
  assert.equal(readKeysBytes(realFs, h.file).bytes.length, KEYS_LIMIT + 1);
  // The opened file is checked and closed, never read past.
  assert.ok(calls.some(([name]) => name === "fstatSync") && calls.at(-1)[0] === "closeSync");
});

test("write: chords set, every other key kept in its place, atomically: a file of its own in the same directory, then renamed", t => {
  const h = home(t);
  h.write('{\n  "later": { "nested": [1, 2] },\n  "chords": "ctrl+alt",\n  "z": true\n}\n');
  const { fs, calls } = recording();
  writeChordFamily(fs, h.file, "ctrl+shift", { stamp: "test" });
  assert.deepEqual(JSON.parse(readFileSync(h.file, "utf8")), { later: { nested: [1, 2] }, chords: "ctrl+shift", z: true });
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(h.file, "utf8"))), ["later", "chords", "z"], "in their places");
  const own = join(h.config, ".keys.json.test.tmp");
  const writes = calls.filter(([name]) => ["openSync", "writeSync", "fsyncSync", "renameSync"].includes(name));
  // The old file is opened to read it; the new text goes to its own file only, which is renamed over it.
  const opens = calls.filter(([name]) => name === "openSync");
  assert.equal(opens[0][1], h.file, "the old file, read");
  assert.deepEqual(opens[1].slice(1), [own, "wx", 0o600], "its own file, made where nothing is, mode 0600");
  assert.equal(opens.length, 2, "keys.json itself is never opened to write");
  assert.deepEqual(writes.slice(1).map(([name]) => name), ["openSync", "writeSync", "fsyncSync", "renameSync"]);
  assert.deepEqual(calls.find(([name]) => name === "renameSync").slice(1), [own, h.file]);
  assert.deepEqual(readdirSync(h.config), ["keys.json"], "no temporary file is left");
  assert.equal(statSync(h.file).mode & 0o777, 0o600);
});

test("write: a missing config/ is made, mode 0700, and the file is { chords }", t => {
  const h = home(t);
  writeChordFamily(realFs, h.file, "ctrl+shift");
  assert.equal(statSync(h.config).mode & 0o777, 0o700);
  assert.equal(readFileSync(h.file, "utf8"), '{\n  "chords": "ctrl+shift"\n}\n');
  assert.deepEqual(readChordFamily(realFs, h.file), state("ctrl+shift"));
});

test("write: a file whose keys cannot all be kept is refused, and left as it was", t => {
  const h = home(t);
  for (const [bytes, why] of [["not json", "not-json"], ["[1, 2]", "not-object"], [Buffer.from([0x7b, 0xff, 0x7d]), "not-utf8"],
    [`{ "chords": "ctrl+alt", "pad": "${"x".repeat(KEYS_LIMIT)}" }`, "too-large"]]) {
    h.write(bytes);
    const before = readFileSync(h.file);
    assert.throws(() => writeChordFamily(realFs, h.file, "ctrl+shift"), (error) => error.code === "E_KEYS_UNWRITABLE" && error.why === why, why);
    assert.deepEqual(readFileSync(h.file), before, `${why}: untouched`);
    assert.deepEqual(readdirSync(h.config), ["keys.json"], `${why}: no file of its own left`);
  }
  // A file that fits when read but not once indented is written on one line, every key kept, and read back.
  const later = Array(3000).fill(0);
  h.write(JSON.stringify({ chords: "ctrl+alt", later }));
  writeChordFamily(realFs, h.file, "ctrl+shift");
  assert.deepEqual(JSON.parse(readFileSync(h.file, "utf8")), { chords: "ctrl+shift", later });
  assert.deepEqual(readChordFamily(realFs, h.file), state("ctrl+shift"));
});

test("write: a file that is there and cannot be read is refused: what it holds is not known, so nothing is written", { skip: process.getuid?.() === 0 && "root reads every file" }, t => {
  const h = home(t);
  h.write('{ "chords": "ctrl+alt", "later": 1 }');
  chmodSync(h.file, 0o000);
  assert.throws(() => writeChordFamily(realFs, h.file, "ctrl+shift"), (error) => error.code === "EACCES");
  chmodSync(h.file, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(h.file, "utf8")), { chords: "ctrl+alt", later: 1 }, "untouched");
  assert.deepEqual(readdirSync(h.config), ["keys.json"]);
});

test("write: a keys.json that is a symbolic link is written where it leads, and the link stays", t => {
  const h = home(t);
  const real = join(h.dir, "dotfiles", "keys.json");
  mkdirSync(join(h.dir, "dotfiles"));
  writeFileSync(real, '{ "kept": 1, "chords": "ctrl+alt" }');
  mkdirSync(h.config);
  symlinkSync(real, h.file);
  writeChordFamily(realFs, h.file, "ctrl+shift", { stamp: "link" });
  assert.equal(lstatSync(h.file).isSymbolicLink(), true, "the link is still a link");
  assert.deepEqual(JSON.parse(readFileSync(real, "utf8")), { kept: 1, chords: "ctrl+shift" });
  assert.deepEqual(readChordFamily(realFs, h.file), state("ctrl+shift"));
  assert.deepEqual(readdirSync(join(h.dir, "dotfiles")), ["keys.json"], "no temporary file is left beside the target");
  // A link to nothing: the write makes the file it names.
  const dangling = join(h.dir, "elsewhere.json");
  rmSync(h.file);
  symlinkSync(dangling, h.file);
  writeChordFamily(realFs, h.file, "ctrl+alt", { stamp: "dangling" });
  assert.equal(lstatSync(h.file).isSymbolicLink(), true);
  assert.deepEqual(JSON.parse(readFileSync(dangling, "utf8")), { chords: "ctrl+alt" });
});

test("write: a family that is not one of the two is refused before anything is touched", t => {
  const h = home(t);
  for (const family of ["ctrl+meta", "Ctrl+Shift", "", null, undefined, 1, { chords: "ctrl+shift" }]) {
    const { fs, calls } = recording();
    assert.throws(() => writeChordFamily(fs, h.file, family), TypeError, String(family));
    assert.deepEqual(calls, [], `${String(family)}: nothing read, made or written`);
  }
  assert.equal(realFs.existsSync(h.config), false);
});

test("write: a step that fails leaves keys.json as it was and no file of its own behind", t => {
  const h = home(t);
  const before = '{ "chords": "ctrl+alt", "kept": 1 }';
  h.write(before);
  const failing = (code) => () => { throw Object.assign(new Error(code), { code }); };
  for (const step of ["renameSync", "writeSync", "fsyncSync"]) {
    const { fs } = recording({ [step]: failing("EIO") });
    assert.throws(() => writeChordFamily(fs, h.file, "ctrl+shift", { stamp: step }), /EIO/, step);
    assert.equal(readFileSync(h.file, "utf8"), before, `${step}: keys.json is untouched`);
    assert.deepEqual(readdirSync(h.config), ["keys.json"], `${step}: its own file is removed`);
  }
});

test("source: get reads now, set writes and reads back, and every window hears a change once", t => {
  const h = home(t);
  const sent = [];
  const source = createChordFamilySource({ fs: realFs, env: h.env, home: NO_HOME, send: (s) => sent.push(s) });
  assert.equal(source.path, h.file);
  source.refresh();
  assert.deepEqual(sent, [], "nothing read yet, nothing to refresh");
  assert.deepEqual(source.get(), state("ctrl+alt", "missing"));
  assert.deepEqual(sent, [], "the first read is the first window's answer, not a change");
  assert.deepEqual(source.set("ctrl+shift"), state("ctrl+shift"));
  assert.deepEqual(sent, [state("ctrl+shift")], "every window hears it");
  assert.deepEqual(source.set("ctrl+shift"), state("ctrl+shift"));
  assert.equal(sent.length, 1, "the same family again is no change");
  // A hand edit: the next window's get, or the next app focus, takes it, and every window hears it.
  h.write('{ "chords": "nope" }');
  source.refresh();
  assert.deepEqual(sent.at(-1), state("ctrl+alt", "unknown-chords", "keys.json: unknown chords value, using Ctrl+Alt"));
  h.write('{ "chords": "ctrl+shift" }');
  assert.deepEqual(source.get(), state("ctrl+shift"));
  assert.equal(sent.length, 3);
  assert.throws(() => source.set("ctrl+meta"), TypeError);
  assert.equal(sent.length, 3);
  // A window that closes while it is told must not stop the next read.
  const throwing = createChordFamilySource({ fs: realFs, env: h.env, home: NO_HOME, send: () => { throw new Error("closed"); } });
  throwing.get();
  assert.deepEqual(throwing.set("ctrl+alt"), state("ctrl+alt"));
});

test("IPC: chord-family:get and chord-family:set answer the app's own renderer only, and set refuses an unknown family", async t => {
  const h = home(t);
  const handlers = new Map();
  const ipc = { handle: (channel, fn) => handlers.set(channel, fn) };
  const trusted = { senderFrame: { url: "trusted" } };
  const guard = (event) => { if (event.senderFrame?.url !== "trusted") throw new Error("forbidden: untrusted frame"); };
  installChordFamilyHandlers({ ipc, guard, source: createChordFamilySource({ fs: realFs, env: h.env, home: NO_HOME }) });
  assert.deepEqual([...handlers.keys()], ["chord-family:get", "chord-family:set"]);
  const call = async (channel, event, ...args) => handlers.get(channel)(event, ...args);
  assert.deepEqual(await call("chord-family:get", trusted), state("ctrl+alt", "missing"));
  await assert.rejects(call("chord-family:get", { senderFrame: { url: "https://elsewhere" } }), /forbidden/);
  await assert.rejects(call("chord-family:set", { senderFrame: { url: "https://elsewhere" } }, "ctrl+shift"), /forbidden/);
  assert.equal(realFs.existsSync(h.file), false, "a foreign frame writes nothing");
  await assert.rejects(call("chord-family:set", trusted, "ctrl+meta"), TypeError);
  assert.deepEqual(await call("chord-family:set", trusted, "ctrl+shift"), state("ctrl+shift"));
  assert.deepEqual(JSON.parse(readFileSync(h.file, "utf8")), { chords: "ctrl+shift" });
  // Only plain state crosses: no path, no file content.
  assert.deepEqual(Object.keys(await call("chord-family:get", trusted)).sort(), ["family", "note", "why"]);
});

test("main wires it: the source on keys.json, the handlers behind the frame guard, every window told, a re-read at app focus", () => {
  const main = readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
  assert.match(main, /import \{ createChordFamilySource, installChordFamilyHandlers \} from "\.\/chord-family\.mjs";/);
  assert.match(main, /createChordFamilySource\(\{[^]*?env: process\.env, home: homedir\(\)[^]*?webContents\.send\("chord-family:changed", state\)/);
  assert.match(main, /installChordFamilyHandlers\(\{ ipc: ipcMain, guard, source: chordFamily \}\);/);
  // The fs main hands over has every call the module makes (a missing lstatSync once read as no file).
  const given = /createChordFamilySource\(\{\s*fs: \{([^}]*)\}/.exec(main)[1].split(",").map((name) => name.trim()).filter(Boolean);
  assert.deepEqual([...given].sort(), [...CHORD_FAMILY_FS].sort());
  const imported = /import \{([^}]*)\} from "node:fs";/.exec(main)[1].split(",").map((name) => name.trim());
  for (const name of CHORD_FAMILY_FS) assert.ok(imported.includes(name), `main imports ${name}`);
  assert.throws(() => createChordFamilySource({ fs: { openSync: realFs.openSync }, env: {}, home: NO_HOME }), /fs lacks fstatSync/);
  assert.match(main, /app\.on\("browser-window-focus", \(\) => chordFamily\.refresh\(\)\);/);
  const preload = readFileSync(new URL("../preload.cjs", import.meta.url), "utf8");
  for (const line of ['chordFamily: () => ipcRenderer.invoke("chord-family:get")', 'setChordFamily: (family) => ipcRenderer.invoke("chord-family:set", family)', 'ipcRenderer.on("chord-family:changed", fn)']) {
    assert.ok(preload.includes(line), line);
  }
});
