import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { acquireCaptureLock, captureLockPath, shellQuote } from "../lib/capture-lock.mjs";
import { RecordStore } from "../lib/store.mjs";
import { RecordIndex } from "../lib/index-db.mjs";

const CAPTURE = resolve(new URL("../bin/capture.mjs", import.meta.url).pathname);
const LOCK_LIB = resolve(new URL("../lib/capture-lock.mjs", import.meta.url).pathname);

test("capture lock: any existing lock refuses (live, dead, same pid, record-less); release removes only its own; nothing is ever stolen", () => {
  const root = join(mkdtempSync(join(tmpdir(), "capture-lock-")), "o'dd $(echo x) `w` dir");
  try {
    const a = acquireCaptureLock(root);
    assert.ok(a.release);
    assert.equal(JSON.parse(readFileSync(join(captureLockPath(root), "owner.json"), "utf8")).pid, process.pid);
    const again = acquireCaptureLock(root);
    assert.equal(again.held?.pid, process.pid); assert.equal(again.held.liveness, "alive");
    a.release(); assert.equal(existsSync(captureLockPath(root)), false);
    // Live holder (a sleeping child): refused with "let it finish".
    const child = spawn("sleep", ["30"]);
    try {
      mkdirSync(captureLockPath(root)); writeFileSync(join(captureLockPath(root), "owner.json"), JSON.stringify({ pid: child.pid, startedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }));
      const h = acquireCaptureLock(root);
      assert.equal(h.held?.pid, child.pid); assert.equal(h.held.liveness, "alive"); assert.match(h.held.recovery, /let it finish/);
    } finally { child.kill(); }
    // Dead holder: STILL refused, with the actionable recovery (never stolen).
    writeFileSync(join(captureLockPath(root), "owner.json"), JSON.stringify({ pid: 999999999, startedAt: new Date().toISOString() }));
    const d = acquireCaptureLock(root);
    assert.equal(d.release, undefined, "a dead holder's lock is not stolen");
    assert.equal(d.held.liveness, "dead"); assert.match(d.held.recovery, /ps -p 999999999/);
    assert.ok(d.held.recovery.includes(`rm -r -- ${shellQuote(captureLockPath(root))}`), d.held.recovery);
    // The displayed removal is shell-safe for this hostile path: it removes exactly the lock and executes nothing.
    const cmd = d.held.recovery.slice(d.held.recovery.indexOf("rm -r -- "), d.held.recovery.indexOf("  and rerun"));
    const sh = spawnSync("sh", ["-c", cmd], { encoding: "utf8" });
    assert.equal(sh.status, 0, sh.stderr); assert.equal(existsSync(captureLockPath(root)), false, "the pasted command removed the lock");
    assert.equal(existsSync(root), true);
    mkdirSync(captureLockPath(root)); writeFileSync(join(captureLockPath(root), "owner.json"), JSON.stringify({ pid: 999999999, startedAt: new Date().toISOString() }));
    assert.equal(existsSync(captureLockPath(root)), true);
    // Record-less lock (initializing or killed before writing): refused, unknown liveness.
    rmSync(captureLockPath(root), { recursive: true, force: true }); mkdirSync(captureLockPath(root));
    const u = acquireCaptureLock(root); assert.equal(u.release, undefined); assert.equal(u.held.liveness, "unknown"); assert.match(u.held.recovery, /not written its owner record.*stop capture triggers.*pgrep -f capture\.mjs.*rm -r -- /);
    // release removes only a lock this pid owns.
    rmSync(captureLockPath(root), { recursive: true, force: true });
    const e = acquireCaptureLock(root);
    writeFileSync(join(captureLockPath(root), "owner.json"), JSON.stringify({ pid: 424242, startedAt: new Date().toISOString() }));
    e.release(); assert.equal(existsSync(captureLockPath(root)), true, "another holder's lock is left alone");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("capture lock: concurrent child processes never hold the lock at the same time", () => {
  const root = mkdtempSync(join(tmpdir(), "capture-lock-conc-"));
  const script = `
    import { acquireCaptureLock } from ${JSON.stringify(LOCK_LIB)};
    import { appendFileSync } from "node:fs";
    const root = process.argv[2], log = process.argv[3];
    let got;
    for (let i = 0; i < 4000 && !got; i++) { const l = acquireCaptureLock(root); if (l.release) got = l; else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2); }
    if (!got) { console.error("never acquired"); process.exit(2); }
    const start = Date.now(); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); const end = Date.now();
    appendFileSync(log, JSON.stringify({ pid: process.pid, start, end }) + "\\n");
    got.release();
  `;
  const scriptPath = join(root, "contender.mjs"); writeFileSync(scriptPath, script);
  const log = join(root, "holds.log");
  const kids = Array.from({ length: 6 }, () => spawn(process.execPath, [scriptPath, root, log], { stdio: ["ignore", "ignore", "pipe"] }));
  return Promise.all(kids.map((k) => new Promise((res) => k.on("exit", (code) => res(code))))).then((codes) => {
    assert.deepEqual(codes, [0, 0, 0, 0, 0, 0]);
    const holds = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).sort((x, y) => x.start - y.start);
    assert.equal(holds.length, 6);
    for (let i = 1; i < holds.length; i++) assert.ok(holds[i].start >= holds[i - 1].end, `hold ${i} overlapped hold ${i - 1}`);
    assert.equal(existsSync(captureLockPath(root)), false);
  }).finally(() => rmSync(root, { recursive: true, force: true }));
});

test("capture CLI: a locked root (live holder) skips quietly; an interrupted owner's lock skips with the recovery on stderr; neither touches the index", () => {
  const root = mkdtempSync(join(tmpdir(), "capture-lock-cli-"));
  const child = spawn("sleep", ["30"]);
  try {
    const home = join(root, "home"); mkdirSync(join(home, ".claude", "projects"), { recursive: true });
    const env = { ...process.env, HOME: home, TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: "tester" };
    mkdirSync(captureLockPath(root)); writeFileSync(join(captureLockPath(root), "owner.json"), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }));
    let r = spawnSync(process.execPath, [CAPTURE, "--sessions-only"], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /another pass holds .*let it finish/);
    // Interrupted owner (dead pid): the pass still skips, and the operator gets the exact recovery on stderr.
    writeFileSync(join(captureLockPath(root), "owner.json"), JSON.stringify({ pid: 999999999, startedAt: new Date().toISOString() }));
    r = spawnSync(process.execPath, [CAPTURE, "--sessions-only"], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stderr, /now dead.*ps -p 999999999.*rm -r -- '.*\.capture\.lock'.*rerun/);
    assert.equal(existsSync(join(root, "index")), false, "no index was created by a skipped pass");
    assert.equal(existsSync(captureLockPath(root)), true, "the lock was not removed by the tool");
    // Operator recovery, then a pass runs.
    rmSync(captureLockPath(root), { recursive: true, force: true });
    r = spawnSync(process.execPath, [CAPTURE, "--sessions-only"], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr + r.stdout); assert.doesNotMatch(r.stdout + r.stderr, /another pass holds/);
    assert.equal(existsSync(captureLockPath(root)), false, "a finished pass released its lock");
  } finally { child.kill(); rmSync(root, { recursive: true, force: true }); }
});

test("capture --install-hint recommends append-only hook passes", () => {
  const r = spawnSync(process.execPath, [CAPTURE, "--install-hint"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--sessions-only --no-index --quiet/);
  assert.match(r.stdout, /One pass runs per record root at a time/);
});

test("an append-only hook pass (--no-index) is indexed by the next plain pass even though that pass appends nothing", () => {
  const base = mkdtempSync(join(tmpdir(), "capture-append-only-"));
  try {
    const root = join(base, "record"), home = join(base, "home");
    const project = join(home, ".claude", "projects", "-tmp-proj"); mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "s1.jsonl"), JSON.stringify({ type: "user", timestamp: "2026-08-25T10:00:00.000Z", message: { content: [{ type: "text", text: "the rare word zebrafish" }] }, sessionId: "s1" }) + "\n");
    const env = { ...process.env, HOME: home, TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: "tester" };
    let r = spawnSync(process.execPath, [CAPTURE, "--sessions-only", "--no-index", "--quiet"], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const searchable = () => { const i = new RecordIndex(new RecordStore(root, { owner: "tester" })); try { return i.search("zebrafish").length; } finally { i.close(); } };
    assert.equal(searchable(), 0, "the append-only pass indexed nothing");
    r = spawnSync(process.execPath, [CAPTURE, "--sessions-only"], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /0 new turns/); assert.match(r.stdout, /index: updated/);
    assert.equal(searchable(), 1, "the earlier appended turn is searchable after the plain pass");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
