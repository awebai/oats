// Derived index: rebuildable, searches mail + session text together,
// hides tombstoned turns, dedupes session snapshots to the latest.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { finishTurn } from "../lib/canonical.mjs";
import { RecordStore } from "../lib/store.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { dropIndex, extractSessionText, RecordIndex } from "../lib/index-db.mjs";

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "turn-record-index-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(join(base, "record"), { owner: "mac" });
  return { base, store };
}

function mailCore(text, subject = "s") {
  return {
    v: 1,
    ts: "2026-02-22T10:00:00Z",
    from: "acme/alpha",
    to: "acme/beta",
    thread: "aweb:conv:c1",
    kind: "mail",
    body: { subject, text },
    provenance: { source: "aw-log", fidelity: "projected", origin: {} },
  };
}

function sessionLine(type, text, ts) {
  return (
    JSON.stringify({ type, timestamp: ts, message: { content: [{ type: "text", text }] } }) + "\n"
  );
}

test("search finds decisions across mail and sessions with provenance", (t) => {
  const { base, store } = setup(t);
  store.appendCore("mac~aw-test", mailCore("we decided to use sqlite for the index"));
  store.appendCore("mac~aw-test", { ...mailCore("unrelated chatter"), ts: "2026-02-22T11:00:00Z" });

  const projects = join(base, "projects", "-p");
  mkdirSync(projects, { recursive: true });
  writeFileSync(
    join(projects, "sess-1.jsonl"),
    sessionLine("user", "should we use sqlite or a flat file?", "2026-02-22T09:00:00Z") +
      sessionLine("assistant", "sqlite: the index is derived and rebuildable", "2026-02-22T09:00:10Z"),
  );
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });

  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();

  const hits = index.search("sqlite");
  assert.equal(hits.length, 3, "mail hit + two session event hits");
  const kinds = new Set(hits.map((h) => h.kind));
  assert.deepEqual([...kinds].sort(), ["mail", "session"]);
  const sessionHit = hits.find((h) => h.kind === "session");
  assert.match(sessionHit.loc, /^line:\d+$/, "session hits carry the event line");

  assert.equal(index.search("sqlite", { kind: "mail" }).length, 1);
  assert.equal(index.search("nonexistentterm").length, 0);
});

test("only the latest session snapshot is searchable; the store keeps all", (t) => {
  const { base, store } = setup(t);
  const projects = join(base, "projects", "-p");
  mkdirSync(projects, { recursive: true });
  const file = join(projects, "sess-2.jsonl");
  writeFileSync(file, sessionLine("user", "alpha bravo", "2026-02-22T09:00:00Z"));
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  appendFileSync(file, sessionLine("user", "charlie delta", "2026-02-22T09:05:00Z"));
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  assert.equal(store.readStream("mac~cc").length, 2, "both snapshots in the store");

  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();
  assert.equal(index.counts().superseded, 1);
  const hits = index.search("bravo");
  assert.equal(hits.length, 1, "old snapshot text found once, via the latest snapshot");
  assert.equal(index.search("charlie").length, 1);
});

test("tombstoned turns disappear from search", (t) => {
  const { store } = setup(t);
  const { turn } = store.appendCore("mac~aw-test", mailCore("ephemeral secret"));
  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();
  assert.equal(index.search("ephemeral").length, 1);

  store.appendCore("mac~aw-test", {
    v: 1,
    ts: "2026-02-22T12:00:00Z",
    from: turn.from,
    kind: "tombstone",
    links: [{ rel: "tombstones", ref: turn.id }],
    body: { reason: "requested" },
    provenance: { source: "test", fidelity: "projected" },
  });
  index.rebuild();
  assert.equal(index.search("ephemeral").length, 0);
  assert.equal(index.counts().hidden, 1);
});

test("update() is incremental and agrees with rebuild()", (t) => {
  const { base, store } = setup(t);
  store.appendCore("mac~aw-test", mailCore("the first decision"));
  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.update();
  assert.equal(index.search("decision").length, 1);

  // New turns after the first pass: update() sees only the delta.
  store.appendCore("mac~aw-test", { ...mailCore("a second decision"), ts: "2026-02-22T11:00:00Z" });
  const projects = join(base, "projects", "-p");
  mkdirSync(projects, { recursive: true });
  const file = join(projects, "sess-3.jsonl");
  writeFileSync(file, sessionLine("user", "echo foxtrot", "2026-02-22T09:00:00Z"));
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  index.update();
  assert.equal(index.search("decision").length, 2);
  assert.equal(index.search("foxtrot").length, 1);

  // Snapshot growth handled incrementally: old snapshot superseded.
  appendFileSync(file, sessionLine("user", "golf hotel", "2026-02-22T09:05:00Z"));
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  index.update();
  assert.equal(index.counts().superseded, 1);
  assert.equal(index.search("foxtrot").length, 1, "old text reachable via latest snapshot only");

  // Tombstone arriving after its target, applied incrementally.
  const target = store.readStream("mac~aw-test")[0];
  store.appendCore("mac~aw-test", {
    v: 1,
    ts: "2026-02-22T12:00:00Z",
    from: target.from,
    kind: "tombstone",
    links: [{ rel: "tombstones", ref: target.id }],
    body: {},
    provenance: { source: "test", fidelity: "projected" },
  });
  index.update();
  assert.equal(index.search("decision").length, 1);

  // The incremental state must equal a from-scratch rebuild.
  const incremental = index.counts();
  index.rebuild();
  assert.deepEqual(index.counts(), incremental);
});

test("index is disposable: drop and rebuild reproduces the same counts", (t) => {
  const { store } = setup(t);
  store.appendCore("mac~aw-test", mailCore("one"));
  store.appendCore("mac~aw-test", { ...mailCore("two"), ts: "2026-02-22T11:00:00Z" });
  let index = new RecordIndex(store);
  index.rebuild();
  const before = index.counts();
  index.close();

  dropIndex(store);
  index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();
  assert.deepEqual(index.counts(), before);
});

test("malformed FTS queries do not crash search and fall back to literals", (t) => {
  const { store } = setup(t);
  store.appendCore("mac~aw-test", mailCore("deploy:prod went fine and then some"));
  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();

  // Raw FTS syntax errors: colon, trailing AND, unbalanced quote, NEAR(.
  for (const q of ["deploy:prod", "fine AND", 'a "b', "NEAR(", "-x", "*"]) {
    assert.doesNotThrow(() => index.search(q), q);
  }
  // The quoted fallback still finds the literal text.
  assert.equal(index.search("deploy:prod").length, 1);
  assert.equal(index.search("fine AND").length, 1);
  assert.deepEqual(index.search('"""'), []);
});

test("duplicate ids across streams attribute to the alphabetically first stream", (t) => {
  const { store } = setup(t);
  const core = mailCore("same turn in two streams");
  // Arrival order deliberately reversed from alphabetical.
  store.appendCore("mac~zzz", core);
  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.update();
  store.appendCore("mac~aaa", core);
  index.update();
  const row = index.db.prepare("SELECT stream FROM turns").get();
  assert.equal(row.stream, "mac~aaa", "matches RecordStore.readAll attribution");
});

test("extractSessionText takes user/assistant text and skips the rest", () => {
  const bytes = Buffer.from(
    sessionLine("user", "question", "t") +
      '{"type":"file-history-snapshot","snapshot":{}}\n' +
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}\n' +
      sessionLine("assistant", "answer", "t") +
      '{"type":"user","message":{"content":"plain string content"}}\n',
  );
  const docs = extractSessionText(bytes);
  assert.deepEqual(
    docs.map((d) => d.text),
    ["question", "answer", "plain string content"],
  );
  assert.deepEqual(
    docs.map((d) => d.role),
    ["user", "assistant", "user"],
  );
});
