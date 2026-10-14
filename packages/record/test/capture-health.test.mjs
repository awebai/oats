import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess, { spawnSync } from "node:child_process";
import { syncBuiltinESMExports, createRequire } from "node:module";
import { readCurrentIssueBacklog, readIssueBacklog, supportsReadOnlySqlite } from "../lib/capture-issues.mjs";
import { readCaptureDatabase } from "../lib/capture-db-reader.mjs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { DerivedState } from "../lib/derived-state.mjs";
import { captureHealth, retrySetAside, writeCaptureStatus } from "../lib/capture-state.mjs";
import { RecordStore } from "../lib/store.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";

const bin = resolve(import.meta.dirname, "../bin/capture.mjs");
function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), "capture-health-")), root = join(base, "record");
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, root, cli: () => spawnSync(process.execPath, [bin, "--root", root, "--health", "--json"],
    { encoding: "utf8", env: { HOME: base, TMPDIR: base, PATH: process.env.PATH } }) };
}
const issue = n => ({ source: "cc", path: `/input/${String(n).padStart(4, "0")}`, line: n + 1, offset: n, reason: "captured-prefix-changed" });
function inventory(root) {
  const result = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else result[path] = { bytes: fs.readFileSync(path).toString("base64"), mtime: fs.statSync(path).mtimeMs };
    }
  }
  walk(root); return result;
}

for (const snapshot of [false, true]) test(`library refusal/resolution is current with ${snapshot ? "old" : "missing"} command snapshot`, t => {
  const f = fixture(t), store = new RecordStore(f.root, { owner: "fixture" }), path = join(f.base, "session.jsonl");
  const line = n => JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", n }) + "\n";
  const capture = () => captureSessions(store, { owner: "fixture", files: [path] });
  fs.writeFileSync(path, line(1)); capture();
  if (snapshot) writeCaptureStatus(f.root);
  const statusPath = join(f.root, "capture-status.json"), before = snapshot ? fs.readFileSync(statusPath, "utf8") : null;
  fs.writeFileSync(path, line(2));
  assert.equal(capture().complete, false);
  const failed = f.cli(); assert.equal(failed.status, 0, failed.stderr);
  assert.equal(JSON.parse(failed.stdout).backlog.setAsideCount, 1);
  assert.equal(JSON.parse(failed.stdout).lastRun, null);
  fs.writeFileSync(path, line(1)); retrySetAside(f.root); assert.equal(capture().complete, true);
  const recovered = captureHealth(f.root); assert.equal(recovered.status, "ok"); assert.equal(recovered.backlog.setAsideCount, 0);
  assert.equal(recovered.lastSuccess, null);
  if (snapshot) assert.equal(fs.readFileSync(statusPath, "utf8"), before);
  else assert.equal(fs.existsSync(statusPath), false);
});

test("current count/sample is capped at 100 without a command snapshot and health does not mutate files", t => {
  const f = fixture(t), state = new DerivedState(f.root);
  for (let n = 150; n >= 0; n--) state.set("set-aside", String(n), issue(n));
  state.close();
  const before = inventory(f.root), result = f.cli(); assert.equal(result.status, 0, result.stderr);
  const health = JSON.parse(result.stdout);
  assert.equal(health.backlog.setAsideCount, 151); assert.equal(health.backlog.setAside.length, 100);
  assert.equal(health.backlog.setAside[0].path, issue(0).path); assert.equal(health.backlog.truncated, true);
  assert.deepEqual(inventory(f.root), before);
});

test("missing current database cannot erase a known nonempty last command snapshot", t => {
  const f = fixture(t), state = new DerivedState(f.root); state.set("set-aside", "one", issue(0)); state.close();
  writeCaptureStatus(f.root); fs.unlinkSync(join(f.root, "index/capture.db"));
  const before = inventory(f.root), result = f.cli(); assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /missing.*capture.db|capture.db.*missing/i);
  assert.deepEqual(inventory(f.root), before);
});

for (const mutation of ["PRAGMA user_version = 999", "DROP TABLE state", "ALTER TABLE state RENAME COLUMN value TO unsupported"]) test(`unsupported capture database fails closed: ${mutation}`, t => {
  const f = fixture(t), state = new DerivedState(f.root); state.db.exec(mutation); state.close();
  const before = inventory(f.root), result = f.cli(); assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /schema|version/i); assert.deepEqual(inventory(f.root), before);
});

test("never-installed health leaves its absent root absent", t => {
  const f = fixture(t), result = f.cli(); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "ok"); assert.equal(fs.existsSync(f.root), false);
});

for (const active of [false, true]) test(`WAL database is refused before health can create sidecars (active=${active})`, t => {
  const f = fixture(t), state = new DerivedState(f.root);
  state.db.exec("PRAGMA journal_mode = WAL"); state.set("set-aside", "one", issue(0));
  if (!active) state.close();
  try {
    const before = inventory(f.root), result = f.cli(); assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /WAL/); assert.deepEqual(inventory(f.root), before);
  } finally { if (active) state.close(); }
});

test("read-only database needs no file writes and a busy reader fails within its bounded wait", t => {
  const f = fixture(t), state = new DerivedState(f.root); state.set("set-aside", "one", issue(0)); state.close();
  const dbPath = join(f.root, "index/capture.db"); fs.chmodSync(dbPath, 0o400);
  try {
    const before = inventory(f.root), result = f.cli(); assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).backlog.setAsideCount, 1); assert.deepEqual(inventory(f.root), before);
  } finally { fs.chmodSync(dbPath, 0o600); }
  const writer = new DerivedState(f.root);
  const before = inventory(f.root);
  writer.db.exec("BEGIN EXCLUSIVE");
  try {
    const started = performance.now(), result = f.cli(); assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).error, /locked|busy/);
    assert.ok(performance.now() - started < 5000);
    assert.throws(() => captureHealth(f.root), /locked|busy/);
    const contender = spawnSync(process.execPath, ["--input-type=module", "-e", `import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(${JSON.stringify(dbPath)});db.exec('PRAGMA busy_timeout=50; BEGIN EXCLUSIVE');db.exec('ROLLBACK');db.close();`], { env: { HOME: f.base }, encoding: "utf8" });
    assert.notEqual(contender.status, 0, "health released the caller's SQLite lock");
    assert.match(contender.stderr, /locked|busy/);
  } finally { writer.db.exec("ROLLBACK"); writer.close(); }
  assert.equal(captureHealth(f.root).backlog.setAsideCount, 1);
  assert.deepEqual(inventory(f.root), before);
});

test("count and sample share a read transaction when another writer changes active entries", async t => {
  const { DatabaseSync } = await import("node:sqlite");
  const f = fixture(t), writer = new DerivedState(f.root); writer.set("set-aside", "one", issue(0));
  const reader = new DatabaseSync(join(f.root, "index/capture.db"), { readOnly: true });
  const prepare = DatabaseSync.prototype.prepare;
  let inserted = false;
  DatabaseSync.prototype.prepare = function(sql, ...args) {
    const statement = prepare.call(this, sql, ...args);
    if (this !== writer.db && sql.includes("count(*) AS n FROM state WHERE kind = 'set-aside'")) {
      const get = statement.get.bind(statement);
      statement.get = (...params) => {
        const result = get(...params);
        writer.db.exec("BEGIN IMMEDIATE"); writer.set("set-aside", "two", issue(1)); inserted = true;
        return result;
      };
    }
    return statement;
  };
  try {
    const backlog = readIssueBacklog(reader, { validate: true }); assert.equal(inserted, true);
    assert.equal(backlog.setAsideCount, 1); assert.equal(backlog.setAside.length, 1);
    assert.equal(captureHealth(f.root).backlog.setAsideCount, 1);
  } finally {
    DatabaseSync.prototype.prepare = prepare;
    if (inserted) writer.db.exec("COMMIT"); reader.close(); writer.close();
  }
  assert.equal(captureHealth(f.root).backlog.setAsideCount, 2);
});

test("runtime feature boundaries are qualified before SQLite loads or opens", t => {
  const f = fixture(t), state = new DerivedState(f.root); state.close();
  for (const [version, supported] of [["22.5.0", false], ["22.11.9", false], ["22.12.0", true], ["22.13.0", true], ["23.0.0", false], ["23.1.9", false], ["23.2.0", true], ["24.0.0", true]]) {
    assert.equal(supportsReadOnlySqlite(version), supported, version);
  }
  const descriptor = Object.getOwnPropertyDescriptor(process.versions, "node");
  const Module = createRequire(import.meta.url)("node:module"), load = Module._load;
  let loads = 0;
  Module._load = function(name, ...args) { if (name === "node:sqlite") { loads++; throw new Error("unexpected SQLite load"); } return load.call(this, name, ...args); };
  try {
    for (const version of ["22.11.0", "23.1.0"]) {
      Object.defineProperty(process.versions, "node", { ...descriptor, value: version });
      assert.throws(() => readCurrentIssueBacklog(f.root), /newer Node/);
      assert.throws(() => readCaptureDatabase(join(f.root, "index/capture.db")), /newer Node/);
    }
    Object.defineProperty(process.versions, "node", descriptor);
    assert.throws(() => readCaptureDatabase(join(f.root, "index/capture.db")), /read-only SQLite is unavailable/);
    assert.equal(loads, 1, "unsupported versions must not load SQLite");
    assert.equal(readCurrentIssueBacklog(join(f.base, "absent")), null);
  } finally { Object.defineProperty(process.versions, "node", descriptor); Module._load = load; }
});

test("WAL preflight refuses before loading SQLite and preserves sidecars", t => {
  const f = fixture(t), state = new DerivedState(f.root); state.db.exec("PRAGMA journal_mode=WAL"); state.close();
  const before = inventory(f.root), Module = createRequire(import.meta.url)("node:module"), load = Module._load;
  Module._load = function(name, ...args) { assert.notEqual(name, "node:sqlite", "WAL path loaded SQLite"); return load.call(this, name, ...args); };
  try { assert.throws(() => readCaptureDatabase(join(f.root, "index/capture.db")), /WAL/); }
  finally { Module._load = load; }
  assert.deepEqual(inventory(f.root), before);
});

for (const failure of ["timeout", "signal", "overflow", "malformed", "spawn"]) test(`owned health child ${failure} fails closed and is reaped`, t => {
  const f = fixture(t), state = new DerivedState(f.root); state.close();
  const original = childProcess.spawnSync;
  let child;
  childProcess.spawnSync = (command, args, options) => {
    assert.equal(command, process.execPath); assert.ok(Object.keys(options.env).every(key => ["HOME", "TMPDIR", "XDG_CACHE_HOME"].includes(key)));
    assert.equal(options.env.HOME, process.env.HOME);
    assert.equal(options.shell, undefined); assert.ok(options.timeout > 0); assert.ok(options.maxBuffer <= 1024 * 1024);
    const source = failure === "timeout" ? "setInterval(()=>{},1000)" : failure === "signal" ? "process.kill(process.pid,'SIGTERM')" : failure === "overflow" ? "process.stdout.write('x'.repeat(2*1024*1024))" : "console.log('{}')";
    child = original(failure === "spawn" ? join(f.base, "missing-node") : command,
      ["-e", source], { ...options, timeout: failure === "timeout" ? 300 : 5000 });
    return child;
  }; syncBuiltinESMExports();
  try { assert.throws(() => captureHealth(f.root), /Cannot read current capture issues/); }
  finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  if (failure === "timeout") assert.equal(child.error?.code, "ETIMEDOUT");
  if (failure === "signal") assert.equal(child.signal, "SIGTERM");
  if (failure === "overflow") assert.equal(child.error?.code, "ENOBUFS");
  if (failure === "malformed") assert.equal(child.status, 0);
  if (failure === "spawn") assert.equal(child.error?.code, "ENOENT");
  if (child.pid) assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
});


test("a hot rollback journal requires recovery and health leaves it untouched", t => {
  const f = fixture(t), state = new DerivedState(f.root); state.set("set-aside", "one", issue(0)); state.close();
  const path = join(f.root, "index/capture.db");
  const crash = spawnSync(process.execPath, ["--input-type=module", "-e", `import {DatabaseSync} from 'node:sqlite';
    const db=new DatabaseSync(${JSON.stringify(path)});db.exec('PRAGMA cache_size=1; BEGIN IMMEDIATE');
    const put=db.prepare('INSERT INTO state VALUES (?,?,?)');
    for(let n=0;n<256;n++)put.run('fixture',String(n),'x'.repeat(16384));
    process.kill(process.pid,'SIGKILL');`], { env: { HOME: f.base }, encoding: "utf8" });
  assert.equal(crash.signal, "SIGKILL"); assert.ok(fs.statSync(path + "-journal").size > 512);
  const before = inventory(f.root), result = f.cli(); assert.equal(result.status, 1, result.stdout);
  assert.match(JSON.parse(result.stdout).error, /read.?only|recovery|locked/i);
  assert.deepEqual(inventory(f.root), before);
});
