// The follower: waking the reader per capture batch — baseline semantics,
// growth threshold, retry on failure, owner scoping, catch-up, and the
// shipped binary running one live follow pass end to end.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { RecordStore } from "../lib/store.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { followPass, sessionThreadOf } from "../lib/follow.mjs";
import { segmentsFor } from "../lib/segments.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

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
