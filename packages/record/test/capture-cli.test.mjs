// The capture BINARY's argument handling — the one surface the rest of the
// suite never touches, because it tests library functions directly.
//
// This matters more than a usual CLI test: parsing in capture.mjs falls
// through to pass(), a write. An unknown flag that was merely ignored ran a
// full reconciliation pass under a hostname-derived owner and forked the whole
// record into a second owner namespace. Every test here asserts the same
// property from a different angle — a run that was not understood writes
// NOTHING.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const BIN = new URL("../bin/capture.mjs", import.meta.url).pathname;

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "turn-record-cli-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return join(base, "record");
}

// A session transcript the capture pass would find and store, so "nothing was
// written" is a real claim about a run that had something to write.
function seedSession(home) {
  const project = join(home, ".claude", "projects", "-tmp-proj");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, "s1.jsonl"),
    JSON.stringify({
      type: "user",
      timestamp: "2026-08-25T10:00:00.000Z",
      message: { content: [{ type: "text", text: "hello" }] },
      sessionId: "s1",
    }) + "\n",
  );
}

function run(root, argv, { home, env } = {}) {
  // TURN_RECORD_OWNER must be ABSENT, not empty: the fallback chain is `??`,
  // so an empty string counts as a value and would set an empty owner.
  const childEnv = { ...process.env, ...env, ...(home ? { HOME: home } : {}) };
  if (!env || !("TURN_RECORD_OWNER" in env)) delete childEnv.TURN_RECORD_OWNER;
  return spawnSync(process.execPath, [BIN, "--root", root, ...argv], {
    encoding: "utf8",
    env: childEnv,
  });
}

function streamsIn(root) {
  const dir = join(root, "streams");
  return existsSync(dir) ? readdirSync(dir) : [];
}

test("an unknown flag is a usage error, and nothing is captured", (t) => {
  const root = setup(t);
  const home = mkdtempSync(join(tmpdir(), "turn-record-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  seedSession(home);

  const r = run(root, ["--help-me-please"], { home });

  assert.equal(r.status, 2, "unknown flag must exit 2");
  assert.match(r.stderr, /unknown flag --help-me-please/);
  assert.match(r.stderr, /capture --status/, "usage is printed with the error");
  // The point of the whole change: the write never happened.
  assert.deepEqual(streamsIn(root), [], "a misunderstood run writes no streams");
});

test("--help prints usage, exits 0, and captures nothing", (t) => {
  const root = setup(t);
  const home = mkdtempSync(join(tmpdir(), "turn-record-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  seedSession(home);

  const r = run(root, ["--help"], { home });

  assert.equal(r.status, 0);
  assert.match(r.stdout, /capture --sessions-only/);
  assert.match(r.stdout, /--owner <name>/, "help documents the owner flag");
  assert.deepEqual(streamsIn(root), [], "--help is not a capture pass");
});

test("a positional argument is a usage error: `capture status` is not `--status`", (t) => {
  const root = setup(t);
  const home = mkdtempSync(join(tmpdir(), "turn-record-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  seedSession(home);

  const r = run(root, ["status"], { home });

  assert.equal(r.status, 2, "a missing pair of dashes must not become a write");
  assert.match(r.stderr, /unexpected argument "status"/);
  assert.deepEqual(streamsIn(root), []);
});

test("a value flag with no value is a usage error, not a swallowed next flag", (t) => {
  const root = setup(t);
  const r = run(root, ["--owner"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--owner needs a value/);
  assert.deepEqual(streamsIn(root), []);
});

test("known flags still work: --status on an empty record reports and exits 0", (t) => {
  const root = setup(t);
  const r = run(root, ["--status", "--owner", "altair"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /owner: altair/);
});

test("a hostname-derived owner that is a stranger to the record warns, but still captures", (t) => {
  const root = setup(t);
  const home = mkdtempSync(join(tmpdir(), "turn-record-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  seedSession(home);

  // First: establish the record under an explicit owner.
  const first = run(root, ["--owner", "altair", "--sessions-only", "--no-index"], { home });
  assert.equal(first.status, 0, first.stderr);
  assert.ok(
    streamsIn(root).some((s) => s.startsWith("altair~")),
    "the explicit owner captured",
  );

  // Then: no --owner, so the owner falls back to the hostname — a stranger here.
  const second = run(root, ["--sessions-only", "--no-index"], { home });

  assert.equal(second.status, 0, "the guard warns; it must never block capture");
  assert.match(second.stderr, /writing as owner/);
  assert.match(second.stderr, /"altair"/, "the warning names the owner already in the record");
  assert.match(second.stderr, /--owner|TURN_RECORD_OWNER/, "and says how to fix it");
});

test("an explicit owner is never second-guessed, even when it is new to the record", (t) => {
  const root = setup(t);
  const home = mkdtempSync(join(tmpdir(), "turn-record-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  seedSession(home);

  const first = run(root, ["--owner", "altair", "--sessions-only", "--no-index"], { home });
  assert.equal(first.status, 0, first.stderr);

  // Deliberately adding a second owner is a legitimate act (multi-machine
  // capture): asked for explicitly, it passes without a warning.
  const second = run(root, ["--owner", "bertha", "--sessions-only", "--no-index"], { home });
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stderr, /writing as owner/);
});

test("a fresh record under a hostname owner is silent: first run on a new machine", (t) => {
  const root = setup(t);
  const home = mkdtempSync(join(tmpdir(), "turn-record-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  seedSession(home);

  const r = run(root, ["--sessions-only", "--no-index"], { home });

  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /writing as owner/, "no other owner exists to be a stranger to");
});
