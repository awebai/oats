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
import { CODEX_LINES, CODEX_UUID, PI_LINES, PI_UUID } from "./format-fixtures.mjs";

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
  const run = (args, extraEnv = env, cwd = undefined) => {
    const r = spawnSync(process.execPath, [CAPTURE, ...args], { encoding: "utf8", env: extraEnv, ...(cwd ? { cwd } : {}) });
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
  // A pi file passed as cc: its session record carries a top-level cwd, but no cc transcript ever holds
  // another format's session header, so the whole file is judged and refused.
  const pi = join(f.archive, `2026-08-03T07-18-03-078Z_${PI_UUID}.jsonl`);
  writeFileSync(pi, PI_LINES.map((l) => JSON.stringify({ ...l, ...(l.type === "message" ? { cwd: f.home } : {}) })).join("\n") + "\n");
  r = f.run(["--file", pi, "--format", "cc", "--home", f.home, "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  j = r.json();
  assert.equal(j.code, "E_FORMAT");
  assert.match(j.error, /pi session header; pass --format pi/);
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

test("a relative --file is resolved before the ignore check: a path rule excludes it as it excludes the absolute path", (t) => {
  const f = fixture(t);
  mkdirSync(f.root, { recursive: true });
  writeFileSync(join(f.root, "ignore"), `${f.archive}/**\n`);
  const r = f.run(["--file", "archive/s1.jsonl", "--format", "cc", "--home", f.home, "--json"], f.env, f.base);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const j = r.json();
  assert.equal(j.code, "E_IGNORED");
  assert.equal(j.file, f.file, "the receipt names the absolute path");
  assert.equal(f.run(["--status"]).stdout.includes("~"), false, "nothing written");
});

test("with a header, the --home outcomes: a torn tail or invalid UTF-8 is incomplete, no timestamp is held; exit 0, complete false", (t) => {
  const f = fixture(t);
  const header = ccLine(f.home, "x", "user", "first", "2026-09-05T10:00:00Z");
  const cases = [
    ["torn.jsonl", Buffer.from(header + '{"type":"user","cwd":"' + f.home + '"'), "incomplete", "torn-tail"],
    ["utf8.jsonl", Buffer.concat([Buffer.from(header), Buffer.from([0xff, 0xfe, 0x0a])]), "incomplete", "invalid-utf8"],
    ["nostamp.jsonl", Buffer.from(JSON.stringify({ type: "user", cwd: f.home }) + "\n"), "held", "unstamped"],
  ];
  for (const [name, bytes, status, reason] of cases) {
    const path = join(f.archive, name); writeFileSync(path, bytes);
    const r = f.run(["--file", path, "--format", "cc", "--home", f.home, "--json"]);
    assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
    const j = r.json();
    assert.equal(j.status, status, name); assert.equal(j.complete, false, name);
    assert.ok(j.issues?.some((i) => i.reason === reason), `${name}: ${JSON.stringify(j.issues)}`);
    if (status === "held") { assert.equal(j.turns, 0); assert.equal(j.firstTurnId, null); }
    else assert.equal(j.turns, 1, name);
  }
});

test("pi and codex files are captured as their format, in the streams their names give", (t) => {
  const f = fixture(t);
  const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  const pi = join(f.archive, `2026-08-03T07-18-03-078Z_${PI_UUID}.jsonl`); writeFileSync(pi, jsonl(PI_LINES));
  const codex = join(f.archive, `rollout-2025-11-28T08-11-23-${CODEX_UUID}.jsonl`); writeFileSync(codex, jsonl(CODEX_LINES));
  for (const [path, format, lines] of [[pi, "pi", PI_LINES], [codex, "codex", CODEX_LINES]]) {
    const r = f.run(["--file", path, "--format", format, "--home", f.home, "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const j = r.json();
    assert.equal(j.status, "complete", format);
    assert.equal(j.stream, `mac~${format}.${format === "pi" ? PI_UUID : CODEX_UUID}`);
    assert.equal(j.thread, `${format}:session:${format === "pi" ? PI_UUID : CODEX_UUID}`);
    assert.equal(j.turns, lines.length);
    assert.equal(j.sha256, sha256(path));
  }
});

test("an archived COPY of a live-captured session appends 0; the copy grown by one line appends 1", (t) => {
  const f = fixture(t);
  const proj = join(f.fakeHome, ".claude", "projects", "-dev-1");
  mkdirSync(proj, { recursive: true });
  const live = join(proj, "s1.jsonl");
  writeFileSync(live, readFileSync(f.file));
  const viaHome = JSON.parse(execFileSync(process.execPath, [CAPTURE, "--current-roots", "--home", f.home, "--quiet"], { encoding: "utf8", env: f.env })).sessions[0];
  // f.file is a copy at another path: same name, same bytes.
  let j = f.run(["--file", f.file, "--format", "cc", "--home", f.home, "--json"]).json();
  assert.equal(j.appended, 0, JSON.stringify(j));
  assert.equal(j.firstTurnId, viaHome.firstTurnId);
  assert.equal(j.lastTurnId, viaHome.lastTurnId);
  writeFileSync(f.file, Buffer.concat([readFileSync(f.file), Buffer.from(ccLine(f.home, "s1", "user", "third", "2026-09-05T10:00:02Z"))]));
  j = f.run(["--file", f.file, "--format", "cc", "--home", f.home, "--json"]).json();
  assert.equal(j.appended, 1, JSON.stringify(j));
  assert.equal(j.turns, 3);
  assert.equal(j.firstTurnId, viaHome.firstTurnId);
});
