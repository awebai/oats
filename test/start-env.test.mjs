// The record of a start's launch environment (lib/start-env.mjs, #1559): what a resume checks a
// fromEnv value against. A keyed digest per source name, for one start, written whole; a key made
// once, 0600; the check reads only, and every way a record cannot speak for the start is unverified.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { START_ENV_FILE, START_ENV_KEY_FILE, checkStartEnv, fromEnvNames, launchEnvChangedMessage, recordStartEnv } from "../lib/start-env.mjs";

const scratch = (t) => { const d = mkdtempSync(join(tmpdir(), "oats-start-env-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const SECRET = "sentinel-0b8e-value";
const readRecord = (home) => JSON.parse(readFileSync(join(home, START_ENV_FILE), "utf8"));
const everything = (home) => readdirSync(home).map((n) => readFileSync(join(home, n))).reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0));

test("fromEnvNames: a recipe's reference sources, sorted, each once; literals are not references", () => {
  assert.deepEqual(fromEnvNames({ A: { fromEnv: "Z_SRC" }, B: "literal", C: { fromEnv: "A_SRC" }, D: { fromEnv: "Z_SRC" } }), ["A_SRC", "Z_SRC"]);
  assert.deepEqual(fromEnvNames(undefined), []);
});

test("the record: a 32-byte 0600 key made once, and for the start's id a digest per set name, never a value", (t) => {
  const home = scratch(t);
  assert.equal(recordStartEnv(home, "start-1", ["TOKEN", "UNSET"], { TOKEN: SECRET }), true);
  const key = statSync(join(home, START_ENV_KEY_FILE));
  assert.deepEqual([key.size, key.mode & 0o777], [32, 0o600]);
  const record = readRecord(home);
  assert.equal(record.startId, "start-1");
  assert.deepEqual(Object.keys(record.digests), ["TOKEN"], "an unset name has no digest");
  assert.match(record.digests.TOKEN, /^[0-9a-f]{64}$/);
  assert.equal(everything(home).includes(Buffer.from(SECRET)), false, "the value is in no file");
  // The next start keeps the key: the same value digests the same.
  const keyBytes = readFileSync(join(home, START_ENV_KEY_FILE));
  recordStartEnv(home, "start-2", ["TOKEN"], { TOKEN: SECRET });
  assert.deepEqual(readFileSync(join(home, START_ENV_KEY_FILE)), keyBytes);
  assert.deepEqual(readRecord(home), { startId: "start-2", digests: { TOKEN: record.digests.TOKEN } });
  // No reference: an empty record that still names its start.
  recordStartEnv(home, "start-3", [], {});
  assert.deepEqual(readRecord(home), { startId: "start-3", digests: {} });
  assert.deepEqual(readdirSync(home).sort(), [START_ENV_FILE, START_ENV_KEY_FILE], "no temporary file is left");
});

test("the check: the same values are ok; a changed, unset or one-sided name is changed, by name, sorted", (t) => {
  const home = scratch(t);
  recordStartEnv(home, "s", ["B", "A"], { A: "a", B: "b" });
  assert.deepEqual(checkStartEnv(home, "s", ["A", "B"], { A: "a", B: "b" }), { ok: true });
  assert.deepEqual(checkStartEnv(home, "s", ["A", "B"], { A: "a", B: "x" }), { changed: ["B"] });
  assert.deepEqual(checkStartEnv(home, "s", ["A", "B"], { B: "x" }), { changed: ["A", "B"] });
  assert.deepEqual(checkStartEnv(home, "s", ["A", "B", "C"], { A: "a", B: "b", C: "c" }), { changed: ["C"] }, "a reference the start did not record");
  assert.deepEqual(checkStartEnv(home, "s", ["A"], { A: "a", B: "b" }), { changed: ["B"] }, "a recorded name the launch no longer references");
  assert.equal(launchEnvChangedMessage(["B", "A"]), "this home's launch environment changed since its last start (A, B); nothing was started: start it yourself to use the new values");
});

test("the check is unverified, never a refusal, for no record, another start's, one that does not read, and a missing or short key; it never writes", (t) => {
  const home = scratch(t);
  const env = { A: "a" };
  assert.deepEqual(checkStartEnv(home, "s", ["A"], env), { unverified: true }, "no record");
  assert.deepEqual(readdirSync(home), [], "the check made no key");
  recordStartEnv(home, "s", ["A"], env);
  assert.deepEqual(checkStartEnv(home, "other", ["A"], env), { unverified: true }, "another start's");
  const good = readFileSync(join(home, START_ENV_FILE));
  for (const bad of ["{ not json", "null", JSON.stringify({ startId: "s" }), JSON.stringify({ startId: "s", digests: { A: "not-hex" } }), JSON.stringify({ startId: "s", digests: [] })]) {
    writeFileSync(join(home, START_ENV_FILE), bad);
    assert.deepEqual(checkStartEnv(home, "s", ["A"], env), { unverified: true }, bad);
  }
  writeFileSync(join(home, START_ENV_FILE), good);
  writeFileSync(join(home, START_ENV_KEY_FILE), Buffer.alloc(16));
  assert.deepEqual(checkStartEnv(home, "s", ["A"], env), { unverified: true }, "a short key");
  rmSync(join(home, START_ENV_KEY_FILE));
  assert.deepEqual(checkStartEnv(home, "s", ["A"], env), { unverified: true }, "no key");
  assert.equal(existsSync(join(home, START_ENV_KEY_FILE)), false, "the check made none");
});

test("a start with an unusable key replaces it and rewrites the record; the old record goes first, so none is ever read with another key", (t) => {
  const home = scratch(t);
  recordStartEnv(home, "s1", ["A"], { A: "a" });
  const old = readRecord(home);
  writeFileSync(join(home, START_ENV_KEY_FILE), "short");
  assert.equal(recordStartEnv(home, "s2", ["A"], { A: "a" }), true);
  assert.equal(statSync(join(home, START_ENV_KEY_FILE)).size, 32);
  assert.equal(readRecord(home).startId, "s2");
  assert.notEqual(readRecord(home).digests.A, old.digests.A, "a new key, a new digest");
  assert.deepEqual(checkStartEnv(home, "s2", ["A"], { A: "a" }), { ok: true });
});

test("a record that cannot be written fails nothing: the start goes on, no file claims its id, no temporary file is left", (t) => {
  const home = scratch(t);
  recordStartEnv(home, "s1", ["A"], { A: "a" });
  // The record's path is taken by a directory: the rename over it fails, as a full disk would.
  rmSync(join(home, START_ENV_FILE));
  mkdirSync(join(home, START_ENV_FILE));
  assert.equal(recordStartEnv(home, "s2", ["A"], { A: "a" }), false);
  assert.equal(statSync(join(home, START_ENV_FILE)).isDirectory(), true);
  assert.deepEqual(readdirSync(home).sort(), [START_ENV_FILE, START_ENV_KEY_FILE]);
  assert.deepEqual(checkStartEnv(home, "s2", ["A"], { A: "a" }), { unverified: true });
});

test("every valid source name is recorded as its own entry, `__proto__` included: its unchanged value checks ok", (t) => {
  const home = scratch(t);
  const env = Object.defineProperty({}, "__proto__", { value: "v", enumerable: true });
  assert.equal(recordStartEnv(home, "s", ["__proto__"], env), true);
  assert.deepEqual(Object.keys(readRecord(home).digests), ["__proto__"]);
  assert.deepEqual(checkStartEnv(home, "s", ["__proto__"], env), { ok: true });
  const other = Object.defineProperty({}, "__proto__", { value: "w", enumerable: true });
  assert.deepEqual(checkStartEnv(home, "s", ["__proto__"], other), { changed: ["__proto__"] });
});
