// The reader: windowed sequential segmentation with open-segment
// continuity, revision (latest wins), wrong-track marking, and resume
// from the last closed annotation.

import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { RecordStore } from "../../record/lib/store.mjs";
import { captureSessions } from "../../record/lib/capture-cc.mjs";
import { readThread, readerEntries, ReaderError } from "../lib/reader.mjs";
import { segmentsFor, segmentTurnCore } from "../../record/lib/segments.mjs";
import { finishTurn } from "../../record/lib/canonical.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = `node ${join(HERE, "reader-stub-engine.mjs")}`;

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "turn-record-reader-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(join(base, "record"), { owner: "mac" });
  return { base, store };
}

const line = (type, text, ts) =>
  JSON.stringify({ type, timestamp: ts, message: { content: [{ type: "text", text }] } }) + "\n";

function seedSession(base, store, texts) {
  const projects = join(base, "projects", "-p");
  mkdirSync(projects, { recursive: true });
  const body = texts
    .map((t, i) => line(i % 2 === 0 ? "user" : "assistant", t, `2026-02-22T10:${String(i).padStart(2, "0")}:00Z`))
    .join("");
  writeFileSync(join(projects, "story.jsonl"), body);
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  return "cc:session:story";
}

test("a tombstoned session event is hidden from the reader, not just search", (t) => {
  const { base, store } = setup(t);
  const thread = seedSession(base, store, ["fine text", "LEAKED-SECRET-VALUE", "more fine text"]);
  const before = readerEntries(store, thread);
  const leaked = before.find((e) => e.text.includes("LEAKED-SECRET-VALUE"));
  assert.ok(leaked, "precondition: the secret line is an entry");

  // Redact the one event: tombstone by the record owner (v1 authority).
  store.appendCore("mac~aw-test", {
    v: 1,
    ts: "2026-02-23T00:00:00Z",
    from: "mac",
    kind: "tombstone",
    links: [{ rel: "tombstones", ref: leaked.turnId }],
    body: { reason: "leaked secret" },
    provenance: { source: "test", fidelity: "projected" },
  });
  const after = readerEntries(store, thread);
  assert.ok(
    after.every((e) => !e.text.includes("LEAKED-SECRET-VALUE")),
    "per-line redaction must hold on the reader path, not only in the index",
  );
  assert.equal(after.length, before.length - 1, "only the tombstoned event disappears");

  // A stranger's tombstone has no authority and hides nothing.
  store.appendCore("mac~aw-test", {
    v: 1,
    ts: "2026-02-23T00:01:00Z",
    from: "mallory",
    kind: "tombstone",
    links: [{ rel: "tombstones", ref: after[0].turnId }],
    body: { reason: "hostile" },
    provenance: { source: "test", fidelity: "projected" },
  });
  assert.equal(readerEntries(store, thread).length, after.length);
});

test("reader segments a session across windows with continuity", (t) => {
  const { base, store } = setup(t);
  const thread = seedSession(base, store, [
    "PHASE:exploration:read the repos and learned the layout",
    "reading files".repeat(50),
    "more reading".repeat(50),
    "PHASE:design:argued and blessed the architecture",
    "discussing".repeat(50),
    "PHASE:implementation:built the capture tool WRONG! it was reverted",
    "coding".repeat(50),
    "PHASE:implementation:rebuilt capture correctly",
    "final work".repeat(50),
  ]);

  // Small windows force multiple engine calls with carried open segments.
  const r = readThread(store, { thread, engine: STUB, windowChars: 1500 });
  assert.ok(r.windows >= 2, `expected multiple windows, got ${r.windows}`);

  const map = segmentsFor(store, thread);
  const types = map.map((s) => [s.start, s.type, s.outcome]);
  assert.equal(map.length, 4, `four segments, got ${JSON.stringify(types)}`);
  assert.equal(map[0].type, "exploration");
  assert.equal(map[0].outcome, "fruitful");
  assert.equal(map[1].type, "design");
  assert.equal(map[2].type, "implementation", "activity type survives wrongness");
  assert.equal(map[2].outcome, "dead-end");
  assert.equal(map[2].lesson, "the stub lesson", "dead ends carry their lesson");
  assert.equal(map[3].type, "implementation");
  assert.equal(map[3].outcome, "ongoing", "last segment still open at end of thread");
  // Half-open spans: adjacent segments meet at equality.
  for (let i = 1; i < map.length; i++) {
    assert.equal(map[i - 1].end, map[i].start, "adjacent segments share the boundary");
  }
});

test("reader resumes from the last closed annotation when the thread grows", (t) => {
  const { base, store } = setup(t);
  const thread = seedSession(base, store, [
    "PHASE:exploration:learned things",
    "filler".repeat(30),
    "PHASE:design:decided things",
    "filler".repeat(30),
  ]);
  const r1 = readThread(store, { thread, engine: STUB, windowChars: 100000 });
  const map1 = segmentsFor(store, thread);
  assert.equal(map1.length, 2);
  assert.equal(map1[0].outcome, "fruitful");
  assert.equal(map1[1].outcome, "ongoing", "trailing segment open");
  void r1;

  // The working agent progresses: new events land, capture appends them.
  const file = join(base, "projects", "-p", "story.jsonl");
  const line2 = (type, text, i) =>
    JSON.stringify({
      type,
      timestamp: `2026-02-22T11:${String(i).padStart(2, "0")}:00Z`,
      message: { content: [{ type: "text", text }] },
    }) + "\n";
  appendFileSync(file, line2("user", "PHASE:review:reviewed and fixed findings", 0));
  appendFileSync(file, line2("assistant", "fixing".repeat(30), 1));
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });

  const r2 = readThread(store, { thread, engine: STUB, windowChars: 100000 });
  const map2 = segmentsFor(store, thread);
  assert.equal(map2.length, 3, "catch-up added the new segment");
  assert.equal(map2[2].type, "review");
  assert.equal(map2[0].established, map1[0].established, "closed history untouched");
  void r2;
});

test("revision wins: a later note for the same (thread,start) replaces", (t) => {
  const { store } = setup(t);
  const thread = "cc:session:x";
  const mk = (established, outcome, ts) =>
    finishTurn(
      segmentTurnCore({
        owner: "mac",
        thread,
        start: "line:1",
        end: "line:9",
        type: "implementation",
        established,
        outcome,
        ts,
      }),
    );
  store.append("mac~mind", mk("first judgment", "fruitful", "2026-02-22T10:00:00Z"));
  store.append("mac~mind", mk("revised: actually a dead end", "dead-end", "2026-02-22T11:00:00Z"));
  const map = segmentsFor(store, thread);
  assert.equal(map.length, 1);
  assert.equal(map[0].outcome, "dead-end");
  assert.match(map[0].established, /revised/);
});

test("reader fails loudly on an empty verdict for a substantial window", (t) => {
  const { base, store } = setup(t);
  const thread = seedSession(base, store, ["no markers here", "just chatter", "more", "and more", "even more"]);
  assert.throws(
    () => readThread(store, { thread, engine: `sh -c 'echo {\\"segments\\": []}'` }),
    ReaderError,
  );
});

test("hostile refs are rejected and cannot corrupt resume", (t) => {
  const { base, store } = setup(t);
  const thread = seedSession(base, store, [
    "PHASE:exploration:learned things",
    "filler".repeat(30),
    "PHASE:design:decided things",
    "filler".repeat(30),
  ]);
  // Engine fabricates refs outside the thread and an end before start.
  const hostile = `node ${join(HERE, "hostile-stub-engine.mjs")}`;
  assert.throws(
    () => readThread(store, { thread, engine: hostile }),
    ReaderError,
    "all-garbage verdict is loud, not silently accepted",
  );
  assert.equal(segmentsFor(store, thread).length, 0, "nothing persisted");

  // A good read afterwards starts from the beginning, uncorrupted.
  const r = readThread(store, { thread, engine: STUB, windowChars: 100000 });
  assert.equal(segmentsFor(store, thread).length, 2);
  assert.ok(r.windows >= 1);
});

test("revision resolves even when timestamps are empty", (t) => {
  const { store } = setup(t);
  const thread = "cc:session:nots";
  const mk = (established, outcome) =>
    finishTurn(
      segmentTurnCore({
        owner: "mac",
        thread,
        start: "line:1",
        end: "line:5",
        type: "implementation",
        established,
        outcome,
        ts: "",
      }),
    );
  const first = mk("first judgment", "fruitful");
  const second = mk("revised judgment", "dead-end");
  store.append("mac~mind", first);
  store.append("mac~mind", second);
  const map = segmentsFor(store, thread);
  assert.equal(map.length, 1);
  // Equal (empty) timestamps: deterministic tie-break by turn id, never a
  // silent stuck-on-first from NaN comparisons.
  const winner = [first, second].sort((a, b) => (a.id > b.id ? -1 : 1))[0];
  assert.equal(map[0].established, winner.body.segment.established);
});

test("readerEntries carries full-fidelity roles and timestamps", (t) => {
  const { base, store } = setup(t);
  const projects = join(base, "projects", "-p");
  mkdirSync(projects, { recursive: true });
  writeFileSync(
    join(projects, "tools.jsonl"),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-02-22T10:00:00Z",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "ls" } },
          { type: "text", text: "listing" },
        ],
      },
    }) + "\n",
  );
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  const entries = readerEntries(store, "cc:session:tools");
  assert.deepEqual(
    entries.map((e) => e.role),
    ["tool_use", "assistant"],
    "tool activity visible to the reader",
  );
  assert.equal(entries[0].ts, "2026-02-22T10:00:00Z", "per-event timestamps present");
});
