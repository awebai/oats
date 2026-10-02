import { fixtureEnv } from "./fixture-env.mjs";
// capture --file: one archived session file, attributed by the operator to an instance home, captured as
// --home capture would capture it (feature capture-file). The receipt binds to the bytes captured.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acquireCaptureLock } from "../lib/capture-lock.mjs";

const CAPTURE = new URL("../bin/capture.mjs", import.meta.url).pathname;

function ccLine(cwd, sessionId, role, text, ts) {
  return JSON.stringify({ type: role, cwd, sessionId, timestamp: ts, message: { role, content: [{ type: "text", text }] } }) + "\n";
}

/** An instance home, an archived cc session of it outside any session root, and a record root. */
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "turn-record-file-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const fakeHome = join(base, "user");
  const home = join(base, "ws", "agents", "dev", "instances", "dev-1");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "instance.json"), JSON.stringify({ agent: "dev", instance: "dev-1", home }));
  const archive = join(base, "archive");
  mkdirSync(archive, { recursive: true });
  const file = join(archive, "s1.jsonl");
  writeFileSync(file, ccLine(home, "s1", "user", "first", "2026-09-05T10:00:00Z") + ccLine(home, "s1", "assistant", "second", "2026-09-05T10:00:01Z"));
  const root = join(base, "record");
  const env = { ...fixtureEnv(), HOME: fakeHome, TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: "mac" };
  const run = (args, extraEnv = env) => {
    const r = spawnSync(process.execPath, [CAPTURE, ...args], { encoding: "utf8", env: extraEnv });
    return { ...r, json: () => JSON.parse(r.stdout) };
  };
  return { base, fakeHome, home, archive, file, root, env, run };
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

test("capture --file binds the receipt to the bytes: thread, turn-id boundaries, turns, ignored, sha256", (t) => {
  const f = fixture(t);
  const r = f.run(["--file", f.file, "--format", "cc", "--home", f.home, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const j = r.json();
  assert.equal(j.status, "complete");
  assert.equal(j.complete, true);
  assert.equal(j.home, f.home);
  assert.equal(j.owner, "mac");
  assert.equal(j.thread, "cc:session:s1");
  assert.equal(j.stream, "mac~cc.s1");
  assert.equal(j.turns, 2);
  assert.equal(j.appended, 2);
  assert.equal(j.ignored, 0);
  assert.equal(j.sha256, sha256(f.file), "the sha256 of the file as captured");
  assert.match(j.firstTurnId, /\S/);
  assert.notEqual(j.firstTurnId, j.lastTurnId);
});

test("capture --file is idempotent: the same file and owner again appends 0, with the same receipt", (t) => {
  const f = fixture(t);
  const args = ["--file", f.file, "--format", "cc", "--home", f.home, "--json"];
  const first = f.run(args).json();
  const again = f.run(args);
  assert.equal(again.status, 0, again.stderr);
  const j = again.json();
  assert.equal(j.appended, 0);
  assert.equal(j.complete, true);
  for (const k of ["thread", "stream", "turns", "firstTurnId", "lastTurnId", "sha256"]) assert.equal(j[k], first[k], k);
});

test("--home capture, then --file of the same session with the same owner, appends 0: one stream identity", (t) => {
  const f = fixture(t);
  const proj = join(f.fakeHome, ".claude", "projects", "-dev-1");
  mkdirSync(proj, { recursive: true });
  const live = join(proj, "s1.jsonl");
  writeFileSync(live, readFileSync(f.file));
  const viaHome = JSON.parse(execFileSync(process.execPath, [CAPTURE, "--current-roots", "--home", f.home, "--quiet"], { encoding: "utf8", env: f.env }));
  assert.equal(viaHome.appended, 2);
  const r = f.run(["--file", live, "--format", "cc", "--home", f.home, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const j = r.json();
  assert.equal(j.appended, 0);
  assert.equal(j.stream, viaHome.sessions[0].stream);
  assert.equal(j.firstTurnId, viaHome.sessions[0].firstTurnId);
  assert.equal(j.lastTurnId, viaHome.sessions[0].lastTurnId);
});

test("usage: the owner, an instance home and a known format are required; one --file, no other mode; exit 2, E_USAGE", (t) => {
  const f = fixture(t);
  const { TURN_RECORD_OWNER, ...noOwner } = f.env;
  const notInstance = join(f.base, "plain"); mkdirSync(notInstance);
  const cases = [
    [["--file", f.file, "--format", "cc", "--json"], f.env, /--home/],
    [["--file", f.file, "--format", "cc", "--home", notInstance, "--json"], f.env, /instance home/],
    [["--file", f.file, "--format", "cc", "--home", join(f.base, "absent"), "--json"], f.env, /instance home/],
    [["--file", f.file, "--format", "cc", "--home", f.home, "--json"], noOwner, /--owner|TURN_RECORD_OWNER/],
    [["--file", f.file, "--home", f.home, "--json"], f.env, /--format/],
    [["--file", f.file, "--format", "claude", "--home", f.home, "--json"], f.env, /cc, pi or codex/],
    [["--file", f.file, "--file", f.file, "--format", "cc", "--home", f.home, "--json"], f.env, /one --file/],
    [["--file", f.file, "--format", "cc", "--home", f.home, "--current-roots", "--json"], f.env, /--current-roots/],
    [["--file", f.file, "--format", "cc", "--home", f.home, "--watch", "--json"], f.env, /--watch/],
    [["--format", "cc", "--home", f.home, "--json"], f.env, /--format needs --file/],
  ];
  for (const [args, env, message] of cases) {
    const r = f.run(args, env);
    assert.equal(r.status, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    const j = r.json();
    assert.equal(j.status, "failed"); assert.equal(j.complete, false); assert.equal(j.code, "E_USAGE");
    assert.match(j.error, message, args.join(" "));
  }
  // Nothing was written: no owner fallback, no operator stream.
  assert.equal(f.run(["--status"]).stdout.includes("~"), false);
});

test("only one regular file is read: a directory, a FIFO and a symlink are refused, exit 1", (t) => {
  const f = fixture(t);
  const fifo = join(f.base, "pipe.jsonl"); execFileSync("mkfifo", [fifo]);
  const link = join(f.base, "link.jsonl"); symlinkSync(f.file, link);
  for (const path of [f.archive, fifo, link]) {
    const r = f.run(["--file", path, "--format", "cc", "--home", f.home, "--json"]);
    assert.equal(r.status, 1, `${path}: ${r.stdout}${r.stderr}`);
    const j = r.json();
    assert.equal(j.code, "E_NOT_REGULAR_FILE", path);
    assert.equal(j.complete, false);
  }
  const missing = f.run(["--file", join(f.base, "nope.jsonl"), "--format", "cc", "--home", f.home, "--json"]);
  assert.equal(missing.status, 1);
  assert.equal(missing.json().code, "E_FILE_UNREADABLE");
});

test("a file with no turns is E_NO_TURNS, never a 0-turn success", (t) => {
  const f = fixture(t);
  for (const [name, bytes] of [["empty.jsonl", ""], ["blank.jsonl", "\n\n"]]) {
    const path = join(f.archive, name); writeFileSync(path, bytes);
    const r = f.run(["--file", path, "--format", "cc", "--home", f.home, "--json"]);
    assert.equal(r.status, 1, name);
    const j = r.json();
    assert.equal(j.code, "E_NO_TURNS", name);
    assert.equal(j.complete, false);
  }
});

test("without --json, one line of text", (t) => {
  const f = fixture(t);
  const r = f.run(["--file", f.file, "--format", "cc", "--home", f.home]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split("\n").length, 1, r.stdout);
  assert.match(r.stdout, /^capture --file: complete, 2 turns \(2 new\) in mac~cc\.s1, sha256 [0-9a-f]{64}$/m);
});

test("a held lock skips the pass: exit 0, complete false", (t) => {
  const f = fixture(t);
  mkdirSync(f.root, { recursive: true });
  const lock = acquireCaptureLock(f.root);
  t.after(() => lock.release?.());
  assert.ok(lock.release);
  const r = f.run(["--file", f.file, "--format", "cc", "--home", f.home, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const j = r.json();
  assert.equal(j.status, "skipped");
  assert.equal(j.complete, false);
});

test("a file without the stated format's session header is E_FORMAT, and the message names the format it does carry", (t) => {
  const f = fixture(t);
  const codex = join(f.archive, "rollout-2025-11-28T08-11-23-019ac984-519d-75c2-b2f0-a6611c4f063e.jsonl");
  writeFileSync(codex, JSON.stringify({ timestamp: "2025-11-28T08:11:23.460Z", type: "session_meta", payload: { id: "019ac984-519d-75c2-b2f0-a6611c4f063e", cwd: f.home } }) + "\n");
  let r = f.run(["--file", codex, "--format", "pi", "--home", f.home, "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  let j = r.json();
  assert.equal(j.code, "E_FORMAT"); assert.equal(j.complete, false);
  assert.match(j.error, /codex session_meta header; pass --format codex/);
  const prose = join(f.archive, "notes.jsonl");
  writeFileSync(prose, "not a session\n");
  r = f.run(["--file", prose, "--format", "cc", "--home", f.home, "--json"]);
  assert.equal(r.status, 1);
  j = r.json();
  assert.equal(j.code, "E_FORMAT");
  assert.doesNotMatch(j.error, /pass --format/);
  assert.equal(f.run(["--status"]).stdout.includes("~"), false, "nothing was written");
});

test("an ignored file is refused with E_IGNORED: never opened, nothing written", (t) => {
  const f = fixture(t);
  mkdirSync(f.root, { recursive: true });
  writeFileSync(join(f.root, "ignore"), "s1\n");
  const r = f.run(["--file", f.file, "--format", "cc", "--home", f.home, "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const j = r.json();
  assert.equal(j.code, "E_IGNORED"); assert.equal(j.complete, false); assert.equal(j.file, f.file);
  assert.match(j.error, /ignore rule.*nothing was read/);
  assert.equal(f.run(["--status"]).stdout.includes("~"), false, "no stream");
});
