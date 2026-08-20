// The follower: waking the reader per capture batch — baseline semantics,
// growth threshold, retry on failure, owner scoping, catch-up, and the
// shipped binary running one live follow pass end to end.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { RecordStore } from "../lib/store.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { followPass, sessionThreadOf } from "../lib/follow.mjs";
import { readThread } from "../lib/reader.mjs";
import { parseFarewell, parseFollow } from "../lib/jiminy.mjs";
import { segmentsFor } from "../lib/segments.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = `node ${join(HERE, "reader-stub-engine.mjs")}`;

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "turn-record-follow-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(join(base, "record"), { owner: "mac" });
  return { base, store };
}

const line = (type, text, ts) =>
  JSON.stringify({ type, timestamp: ts, message: { content: [{ type: "text", text }] } }) + "\n";

function seed(base, store, name, texts) {
  const projects = join(base, "projects", "-p");
  mkdirSync(projects, { recursive: true });
  const body = texts
    .map((t, i) => line(i % 2 === 0 ? "user" : "assistant", t, `2026-04-01T10:${String(i).padStart(2, "0")}:00Z`))
    .join("");
  writeFileSync(join(projects, `${name}.jsonl`), body);
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  return join(projects, `${name}.jsonl`);
}

test("sessionThreadOf scopes to the owner's session streams", () => {
  assert.equal(sessionThreadOf("mac~cc.abc-def", "mac"), "cc:session:abc-def");
  assert.equal(sessionThreadOf("mac~pi.019f", "mac"), "pi:session:019f");
  assert.equal(sessionThreadOf("other~cc.abc", "mac"), null, "other owners are not followed here");
  assert.equal(sessionThreadOf("mac~aw", "mac"), null, "non-session streams are not threads");
  assert.equal(sessionThreadOf("mac~mind", "mac"), null);
});

test("follow: baseline first, wake on growth, retry after failure", (t) => {
  const { base, store } = setup(t);
  const file = seed(base, store, "live", ["hello", "world ".repeat(50)]);

  const state = new Map();
  const runs = [];
  let fail = false;
  const run = (thread) => {
    if (fail) throw new Error("engine down");
    runs.push(thread);
    return { segments: 1 };
  };

  // First pass baselines: existing content is not backlog to the follower.
  const r1 = followPass(store, { owner: "mac", state, minNewBytes: 100, run });
  assert.equal(r1.ran.length, 0, "baseline pass wakes nothing");
  assert.ok(r1.scanned >= 1);

  // Small growth below the threshold: still quiet.
  appendFileSync(file, line("user", "tiny", "2026-04-01T11:00:00Z"));
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  const r2 = followPass(store, { owner: "mac", state, minNewBytes: 100000, run });
  assert.equal(r2.ran.length, 0, "growth below threshold does not wake");

  // Real growth: the reader wakes for exactly this thread.
  appendFileSync(file, line("assistant", "substance ".repeat(200), "2026-04-01T11:01:00Z"));
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  const r3 = followPass(store, { owner: "mac", state, minNewBytes: 100, run });
  assert.deepEqual(r3.ran.map((x) => x.thread), ["cc:session:live"]);
  assert.deepEqual(runs, ["cc:session:live"]);

  // Quiet journal: no re-run.
  const r4 = followPass(store, { owner: "mac", state, minNewBytes: 100, run });
  assert.equal(r4.ran.length, 0, "no growth, no wake");

  // A failing run leaves state untouched, so the next pass retries.
  appendFileSync(file, line("user", "more ".repeat(200), "2026-04-01T11:02:00Z"));
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  fail = true;
  const r5 = followPass(store, { owner: "mac", state, minNewBytes: 100, run });
  assert.equal(r5.failed.length, 1);
  assert.match(r5.failed[0].error, /engine down/);
  fail = false;
  const r6 = followPass(store, { owner: "mac", state, minNewBytes: 100, run });
  assert.deepEqual(r6.ran.map((x) => x.thread), ["cc:session:live"], "failed wake retried");
});

test("catch-up reads backlog present at startup", (t) => {
  const { base, store } = setup(t);
  seed(base, store, "backlog", ["old content ".repeat(100)]);
  const state = new Map();
  const runs = [];
  const r = followPass(store, {
    owner: "mac",
    state,
    minNewBytes: 100,
    catchUp: true,
    run: (thread) => (runs.push(thread), { segments: 1 }),
  });
  assert.deepEqual(runs, ["cc:session:backlog"]);
  assert.equal(r.ran.length, 1);
});

test("death by staleness: one final wake, a farewell, then rest — until revival", (t) => {
  const { base, store } = setup(t);
  const file = seed(base, store, "mortal", [
    "PHASE:exploration:learned things",
    "filler ".repeat(60),
  ]);
  // Born: the reader has followed this life.
  readThread(store, { thread: "cc:session:mortal", engine: STUB, windowChars: 100000 });
  const mindStream = "mac~mind.mortal";
  assert.ok(store.readStream(mindStream).some((x) => parseFollow(x)), "precondition: born");

  // The principal goes quiet: backdate the journal's mtime past the
  // staleness horizon.
  const journal = store.journalPath("mac~cc.mortal");
  const old = new Date(Date.now() - 48 * 3600 * 1000);
  utimesSync(journal, old, old);

  const state = new Map();
  const calls = [];
  const run = (thread, streamId, opts) => (calls.push({ thread, opts }), { segments: 0 });
  const r1 = followPass(store, { owner: "mac", state, minNewBytes: 1000000, run });
  assert.equal(r1.died.length, 1, "one death");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.final, true, "the last wake is marked final");
  const farewells = store.readStream(mindStream).map(parseFarewell).filter(Boolean);
  assert.equal(farewells.length, 1, "one farewell note");
  assert.equal(farewells[0].reason, "stale");

  // Mourned once: the next pass does not disturb the dead.
  const r2 = followPass(store, { owner: "mac", state, minNewBytes: 1000000, run });
  assert.equal(r2.died.length, 0);
  assert.equal(calls.length, 1, "no second final wake");

  // Revival: the principal speaks again; growth wakes the jiminy normally.
  appendFileSync(file, line("user", "back from the dead ".repeat(50), "2026-04-03T10:00:00Z"));
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  const r3 = followPass(store, { owner: "mac", state, minNewBytes: 100, run });
  assert.equal(r3.ran.length, 1, "growth after the farewell revives");
  assert.equal(calls[1].opts.final, false);
});

test("never-followed stale sessions do not die; --stale-hours 0 disables death", (t) => {
  const { base, store } = setup(t);
  seed(base, store, "unread", ["quiet content ".repeat(50)]);
  const journal = store.journalPath("mac~cc.unread");
  const old = new Date(Date.now() - 48 * 3600 * 1000);
  utimesSync(journal, old, old);

  const state = new Map();
  const run = () => {
    throw new Error("must not wake");
  };
  const r = followPass(store, { owner: "mac", state, minNewBytes: 100, run });
  assert.equal(r.died.length, 0, "unborn jiminies cannot die");
  assert.equal(r.failed.length, 0, "and are not woken at all");

  // Even a BORN one is immortal with staleness disabled.
  readThread(store, { thread: "cc:session:unread", engine: STUB, windowChars: 100000 });
  utimesSync(journal, old, old);
  const r2 = followPass(store, { owner: "mac", state: new Map(), minNewBytes: 1000000, staleAfterMs: 0, run });
  assert.equal(r2.died.length, 0);
});

test("the shipped binary runs one follow pass with a stub engine", (t) => {
  const { base, store } = setup(t);
  seed(base, store, "s1", [
    "PHASE:exploration:learned the shape of things",
    "filler ".repeat(400),
  ]);
  // The stub engine used by reader tests: deterministic segments from
  // PHASE markers. --catch-up makes the startup backlog readable; --once
  // exits after the first pass so the test needs no daemon-killing.
  const stub = `node ${join(HERE, "reader-stub-engine.mjs")}`;
  const r = spawnSync(
    process.execPath,
    [join(HERE, "..", "bin", "turn-record.mjs"), "mind", "--follow", "--once", "--catch-up",
      "--min-new-bytes", "100", "--engine", stub],
    { env: { ...process.env, TURN_RECORD_ROOT: store.root, TURN_RECORD_OWNER: "mac" }, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /read cc:session:s1/, "follow pass read the backlog thread");
  const map = segmentsFor(store, "cc:session:s1");
  assert.ok(map.length >= 1, "segment notes landed in the record");
});
