import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { RecordStore } from "../lib/store.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { captureAwLogs } from "../lib/capture-aw.mjs";
import { DerivedState } from "../lib/derived-state.mjs";
import { captureHealth, resetSourceCursors, retrySetAside, writeCaptureStatus } from "../lib/capture-state.mjs";
import { acquireCaptureLock } from "../lib/capture-lock.mjs";

const bin = resolve(import.meta.dirname, "../bin/capture.mjs");
const line = n => JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", value: n, text: "x".repeat(150) }) + "\n";
function fixture(t) {
  const base = fs.mkdtempSync(join(tmpdir(), "capture-recovery-")), root = join(base, "record"), home = join(base, "home");
  const sources = join(home, ".claude", "projects", "project"); fs.mkdirSync(sources, { recursive: true });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(root, { owner: "fixture" });
  const path = join(sources, "session.jsonl");
  const capture = (options = {}) => captureSessions(store, { owner: "fixture", files: [path], ...options });
  const cli = (...args) => spawnSync(process.execPath, [bin, "--root", root, "--owner", "fixture", ...args], { encoding: "utf8", env: { HOME: home, PATH: process.env.PATH, TMPDIR: base } });
  return { base, root, home, path, store, capture, cli };
}

for (const format of ["cc", "pi", "codex"]) test(`${format}: equal moved identity resumes; a late conflicting prefix refuses all suffix appends`, t => {
  const f = fixture(t), original = Array.from({ length: 2500 }, (_, i) => line(i)).join("");
  fs.writeFileSync(f.path, original);
  assert.equal(f.capture({ format }).appended, 2500);
  fs.renameSync(f.path, f.path + ".old"); fs.writeFileSync(f.path, original);
  assert.equal(f.capture({ format }).appended, 0);
  const moved = join(f.base, "moved", "session.jsonl"); fs.mkdirSync(join(f.base, "moved")); fs.renameSync(f.path, moved);
  assert.equal(f.capture({ format, files: [moved] }).appended, 0);
  fs.renameSync(moved, f.path);
  const journal = f.store.journalPath(`fixture~${format}.session`), before = fs.readFileSync(journal);
  fs.writeFileSync(f.path, original.replace(line(2300), line("changed")) + line(2500));
  resetSourceCursors(f.root, "fixture", format);
  const result = f.capture({ format });
  assert.equal(result.complete, false); assert.equal(result.appended, 0);
  assert.equal(result.issues[0].line, 2301);
  assert.deepEqual(fs.readFileSync(journal), before);
  retrySetAside(f.root); // interruption after marking retains active warning
  writeCaptureStatus(f.root);
  assert.equal(captureHealth(f.root).backlog.setAsideCount, 1);
  assert.equal(f.capture({ format }).appended, 0);
  fs.writeFileSync(f.path, original + line(2500));
  assert.equal(f.capture({ format }).appended, 0, "restoration alone does not waive retry");
  retrySetAside(f.root);
  assert.equal(f.capture({ format }).appended, 1);
  assert.equal(f.store.readStream(`fixture~${format}.session`).length, 2501);
});

test("ignore removes missing/unreadable set-aside entries before any open; unignore revalidates", t => {
  const f = fixture(t); fs.writeFileSync(f.path, line(1)); f.capture();
  fs.writeFileSync(f.path, line(2)); f.capture();
  fs.writeFileSync(join(f.root, "ignore"), "session\n");
  fs.rmSync(f.path);
  const open = fs.openSync;
  fs.openSync = (p, ...args) => { assert.notEqual(p, f.path, "ignored source was opened"); return open(p, ...args); }; syncBuiltinESMExports();
  try { assert.equal(f.capture().ignored, 1); }
  finally { fs.openSync = open; syncBuiltinESMExports(); }
  writeCaptureStatus(f.root); assert.equal(captureHealth(f.root).status, "ok");
  fs.writeFileSync(f.path, line(2)); fs.writeFileSync(join(f.root, "ignore"), "");
  assert.equal(f.capture().complete, false);
});

test("reset CLI is atomic, source-scoped, reset-only, durable, and refuses a held lock", t => {
  const f = fixture(t); fs.writeFileSync(f.path, line(1)); f.capture();
  let state = new DerivedState(f.root);
  state.set("set-aside", "fixture~cc.session:" + f.path, { owner: "fixture", source: "cc", path: f.path, line: 1, offset: 0, reason: "captured-prefix-changed", retry: false });
  state.close();
  fs.appendFileSync(f.path, line(2));
  let result = f.cli("--reset-cursors", "--source", "aw", "--json");
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).sources, ["aw"]);
  assert.equal(f.store.readStream("fixture~cc.session").length, 1);
  state = new DerivedState(f.root);
  assert.ok(state.get("reset", "fixture:aw")); assert.equal(state.get("reset", "fixture:cc"), null);
  assert.equal([...state.entries("set-aside")][0].value.retry, false); state.close();
  const lock = acquireCaptureLock(f.root);
  try { assert.equal(f.cli("--reset-cursors", "--json").status, 1); assert.equal(f.cli("--retry-set-aside", "--json").status, 1); }
  finally { lock.release(); }
  assert.equal(f.cli("--reset-cursors", "--source", "no").status, 2);
  result = f.cli("--retry-set-aside", "--no-index", "--json");
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).appended, 1);
  assert.equal(f.store.readStream("fixture~cc.session").length, 2);
});

test("background aweb prefix edit outside the boundary requires reset and adds changed content once", t => {
  const f = fixture(t), logs = join(f.home, ".config", "aw", "logs"), path = join(logs, "account.jsonl"); fs.mkdirSync(logs, { recursive: true });
  const entry = n => JSON.stringify({ ts: "2026-01-01T00:00:00Z", dir: "recv", ch: "mail", msg_id: String(n), from: "a", to: "b", body: String(n).padEnd(200, "x") }) + "\n";
  const original = Array.from({ length: 100 }, (_, i) => entry(i)).join(""); fs.writeFileSync(path, original);
  captureAwLogs(f.store, { owner: "fixture", commLogDir: logs });
  fs.writeFileSync(path, original.replace(entry(0), entry("z")) + entry(100));
  assert.equal(captureAwLogs(f.store, { owner: "fixture", commLogDir: logs })[0].appended, 1);
  assert.equal(f.cli("--reset-cursors", "--source", "aw").status, 0);
  assert.equal(captureAwLogs(f.store, { owner: "fixture", commLogDir: logs })[0].appended, 1);
  assert.equal(captureAwLogs(f.store, { owner: "fixture", commLogDir: logs }).length, 0);
  assert.equal(f.store.readStream("fixture~aw").length, 102);
});

test("health never creates an absent root; status caps deterministic issue samples and makes no run claim", t => {
  const f = fixture(t);
  assert.equal(captureHealth(f.root).status, "ok"); assert.equal(fs.existsSync(f.root), false);
  const result = f.cli("--health", "--json"); assert.equal(result.status, 0); assert.equal(fs.existsSync(f.root), false);
  const state = new DerivedState(f.root);
  for (let i = 110; i >= 0; i--) state.set("set-aside", String(i), { source: "cc", path: `/fixture/${String(i).padStart(3, "0")}`, offset: i, line: i + 1, reason: "captured-prefix-changed" });
  state.close();
  const status = writeCaptureStatus(f.root);
  assert.equal(status.policy, null); assert.equal(status.lastSuccess, null); assert.equal(status.lastRun, null);
  const health = captureHealth(f.root);
  assert.equal(health.backlog.setAsideCount, 111); assert.equal(health.backlog.setAside.length, 100); assert.equal(health.backlog.truncated, true);
  assert.equal(health.backlog.setAside[0].path, "/fixture/000");
  assert.match(health.rows[0].message, /later turns.*will not be captured/);
  assert.equal(fs.statSync(join(f.root, "capture-status.json")).mode & 0o777, 0o600);
});

test("command status truthfully records pending unstamped input without inventing run evidence", t => {
  const f = fixture(t); fs.writeFileSync(f.path, '{"unstamped":true}\n');
  const result = f.cli("--no-index", "--quiet"); assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(fs.readFileSync(join(f.root, "capture-status.json")));
  assert.equal(status.backlog.pending, true); assert.equal(status.lastSuccess, null); assert.equal(status.policy, null);
});

test("ignored missing default root clears its set-aside warning on reconciliation", t => {
  const f = fixture(t); fs.writeFileSync(f.path, line(1)); f.capture();
  fs.writeFileSync(f.path, line(2)); assert.equal(f.capture().complete, false);
  fs.rmSync(join(f.home, ".claude"), { recursive: true }); fs.writeFileSync(join(f.root, "ignore"), "session\n");
  const result = f.cli("--no-index", "--quiet"); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(join(f.root, "capture-status.json"))).backlog.setAsideCount, 0);
});
