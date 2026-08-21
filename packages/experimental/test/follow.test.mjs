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

import { RecordStore } from "../../record/lib/store.mjs";
import { captureSessions } from "../../record/lib/capture-cc.mjs";
import { followPass, sessionThreadOf } from "../lib/follow.mjs";
import { readThread } from "../lib/reader.mjs";
import { followTurnCore, parseFarewell, parseFollow } from "../lib/jiminy.mjs";
import { segmentsFor } from "../../record/lib/segments.mjs";

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

  // A failing run backs off: no retry at the same size (that burned 551
  // engine calls in the first live run), retry on the next growth.
  appendFileSync(file, line("user", "more ".repeat(200), "2026-04-01T11:02:00Z"));
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  fail = true;
  const r5 = followPass(store, { owner: "mac", state, minNewBytes: 100, run });
  assert.equal(r5.failed.length, 1);
  assert.match(r5.failed[0].error, /engine down/);
  fail = false;
  const r6 = followPass(store, { owner: "mac", state, minNewBytes: 100, run });
  assert.equal(r6.ran.length, 0, "no retry without new growth");
  assert.equal(r6.failed.length, 0, "and no repeated engine call either");
  appendFileSync(file, line("user", "growth ".repeat(200), "2026-04-01T11:03:00Z"));
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  const r7 = followPass(store, { owner: "mac", state, minNewBytes: 100, run });
  assert.deepEqual(r7.ran.map((x) => x.thread), ["cc:session:live"], "growth retries the failed wake");
});

test("consciousness does not watch consciousness: memory sessions are never followed", (t) => {
  const { base, store } = setup(t);
  // A working life and, recorded in a mind stream, the birth note naming
  // a memory session. Then that memory session itself appears as a
  // captured pi session and grows past every threshold.
  seed(base, store, "worker", ["real work ".repeat(100)]);
  const memoryId = "8468c508-b045-4dd3-83be-a15a8b76fa07";
  store.appendCore(
    "mac~mind.worker",
    followTurnCore({
      jiminy: "jiminy-worker",
      principalThread: "cc:session:worker",
      ts: "2026-04-01T10:00:00Z",
    }),
  );
  // followTurnCore derives the memory id; write a second, explicit birth
  // naming OUR memoryId so the test controls the value under test.
  store.appendCore("mac~mind.other", {
    v: 1,
    ts: "2026-04-01T10:01:00Z",
    from: "jiminy-other",
    kind: "note",
    links: [{ rel: "follows", ref: "cc:session:other" }],
    body: {
      text: "born",
      follow: { agent: `pi:session:${memoryId}`, follows: "cc:session:other", harness: "pi" },
    },
    provenance: { source: "mind", fidelity: "projected", origin: {} },
  });
  const projects = join(base, "pi-sessions", "-x-");
  mkdirSync(projects, { recursive: true });
  writeFileSync(
    join(projects, `2026-04-01T10-00-00-000Z_${memoryId}.jsonl`),
    JSON.stringify({ type: "session", version: 3, id: memoryId, timestamp: "2026-04-01T10:00:00.000Z", cwd: "/x" }) +
      "\n" +
      JSON.stringify({
        type: "message", id: "aaaa0001", parentId: null, timestamp: "2026-04-01T10:00:01.000Z",
        message: { role: "user", content: [{ type: "text", text: "window ".repeat(500) }], timestamp: 1780000000000 },
      }) + "\n",
  );
  captureSessions(store, { owner: "mac", roots: [join(base, "pi-sessions")], format: "pi" });
  assert.ok(store.readStream(`mac~pi.${memoryId}`).length > 0, "precondition: the memory is captured");

  const run = (thread) => {
    if (thread === `pi:session:${memoryId}`) throw new Error("followed a jiminy's mind");
    return { segments: 0 };
  };
  const r = followPass(store, { owner: "mac", state: new Map(), minNewBytes: 10, catchUp: true, run });
  assert.ok(r.skippedMinds >= 1, "the memory session was skipped");
  assert.ok(!r.failed.some((f) => /jiminy's mind/.test(f.error)), "never woken");
  assert.ok(r.ran.some((x) => x.thread === "cc:session:worker"), "real lives still followed");
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
    [join(HERE, "..", "..", "..", "bin", "oats.mjs"), "experimental", "mind", "--follow", "--once", "--catch-up",
      "--min-new-bytes", "100", "--engine", stub],
    { env: { ...process.env, TURN_RECORD_ROOT: store.root, TURN_RECORD_OWNER: "mac" }, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /read cc:session:s1/, "follow pass read the backlog thread");
  const map = segmentsFor(store, "cc:session:s1");
  assert.ok(map.length >= 1, "segment notes landed in the record");
});
