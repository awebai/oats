// RecordStore behavior: owner-only append, torn-tail tolerance and repair,
// dedupe, tombstones, objects, merge.

import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { finishTurn } from "../lib/canonical.mjs";
import { parseJournal, RecordStore, StoreError } from "../lib/store.mjs";

function tempStore(t, owner = "alice") {
  const root = mkdtempSync(join(tmpdir(), "turn-record-store-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return new RecordStore(root, { owner });
}

function noteCore(from, text) {
  return {
    v: 1,
    ts: "2026-02-22T10:00:00Z",
    from,
    kind: "note",
    body: { text },
    provenance: { source: "test", fidelity: "verbatim" },
  };
}

test("append requires ownership and a correct id", (t) => {
  const store = tempStore(t, "alice");
  const turn = finishTurn(noteCore("alice", "mine"));
  store.append("alice~notes", turn);
  assert.equal(store.readStream("alice~notes").length, 1);

  assert.throws(() => store.append("bob~notes", turn), /owner-only/);
  assert.throws(
    () => store.append("alice~notes", { ...turn, id: "t1:" + "0".repeat(64) }),
    /does not match/,
  );
  assert.throws(() => store.append("alice~notes", noteCore("alice", "no id")), StoreError);
});

test("torn tail is ignored by readers and repaired by the next append", (t) => {
  const store = tempStore(t, "alice");
  const a = finishTurn(noteCore("alice", "one"));
  store.append("alice~notes", a);
  const path = store.journalPath("alice~notes");

  appendFileSync(path, '{"v":1,"truncated'); // torn write
  assert.equal(store.readStream("alice~notes").length, 1, "torn tail ignored");

  const b = finishTurn(noteCore("alice", "two"));
  store.append("alice~notes", b);
  const turns = store.readStream("alice~notes");
  assert.deepEqual(
    turns.map((x) => x.id),
    [a.id, b.id],
    "repair removed the torn bytes, then appended",
  );
  assert.ok(!readFileSync(path, "utf8").includes("truncated"));
});

test("valid JSON without a trailing newline is still a torn tail", () => {
  const a = finishTurn(noteCore("alice", "one"));
  const { turns, torn } = parseJournal(JSON.stringify(a));
  assert.equal(turns.length, 0);
  assert.ok(torn);
});

test("interior corruption throws rather than silently dropping turns", (t) => {
  const store = tempStore(t, "alice");
  const path = store.journalPath("alice~notes");
  const a = finishTurn(noteCore("alice", "one"));
  store.append("alice~notes", a);
  writeFileSync(path, "not json\n" + readFileSync(path, "utf8"));
  assert.throws(() => store.readStream("alice~notes"), /corrupt interior/);
});

test("appendCore dedupes by content id", (t) => {
  const store = tempStore(t, "alice");
  const core = noteCore("alice", "same");
  const r1 = store.appendCore("alice~notes", core);
  const r2 = store.appendCore("alice~notes", core);
  assert.ok(r1.appended);
  assert.ok(!r2.appended);
  assert.equal(store.readStream("alice~notes").length, 1);
});

test("tombstones hide by author or record owner, not by strangers", (t) => {
  const store = tempStore(t, "owner");
  const target = finishTurn(noteCore("owner", "to delete"));
  store.append("owner~notes", target);
  const byAuthor = finishTurn({
    ...noteCore("owner", ""),
    kind: "tombstone",
    links: [{ rel: "tombstones", ref: target.id }],
  });
  store.append("owner~notes", byAuthor);
  assert.deepEqual([...store.hiddenIds()], [target.id]);

  // A stranger's tombstone (different from, not owner) must not hide.
  const store2 = tempStore(t, "mallory");
  const victim = finishTurn(noteCore("someone", "keep me"));
  const strangerCore = {
    ...noteCore("mallory", ""),
    kind: "tombstone",
    links: [{ rel: "tombstones", ref: victim.id }],
  };
  store2.append("mallory~notes", finishTurn(strangerCore));
  // Import the victim's stream as a foreign copy.
  store2.mergeStreamCopy("someone~notes", [victim]);
  const store2AsReader = new RecordStore(store2.root, { owner: "reader" });
  assert.equal(store2AsReader.hiddenIds().size, 0, "stranger tombstone has no effect");
});

test("blank lines in a journal are tolerated, not fatal", (t) => {
  const store = tempStore(t, "alice");
  const a = finishTurn(noteCore("alice", "one"));
  store.append("alice~notes", a);
  const path = store.journalPath("alice~notes");
  appendFileSync(path, "\n"); // stray extra newline
  assert.deepEqual(
    store.readStream("alice~notes").map((x) => x.id),
    [a.id],
  );
  const b = finishTurn(noteCore("alice", "two"));
  store.append("alice~notes", b); // self-heals, does not throw
  assert.equal(store.readStream("alice~notes").length, 2);

  // A journal that is only a newline reads as empty.
  const store2 = tempStore(t, "alice");
  mkdirSync(join(store2.streamsDir(), "alice~x"), { recursive: true });
  writeFileSync(store2.journalPath("alice~x"), "\n");
  assert.deepEqual(store2.readStream("alice~x"), []);
});

test("stream lock: fresh foreign lock blocks, stale lock is stolen", (t) => {
  const store = tempStore(t, "alice");
  store.lockTimeoutMs = 200; // keep the blocked case fast
  const turn = finishTurn(noteCore("alice", "locked"));
  const dir = join(store.streamsDir(), "alice~notes");
  mkdirSync(dir, { recursive: true });
  const lockPath = join(dir, ".lock");

  // Fresh lock held by "another process": append must time out, not write.
  writeFileSync(lockPath, "99999");
  assert.throws(() => store.append("alice~notes", turn), /timed out waiting for lock/);
  assert.deepEqual(store.readStream("alice~notes"), []);

  // Stale lock (older than lockStaleMs): stolen, append proceeds.
  const old = new Date(Date.now() - 60_000);
  utimesSync(lockPath, old, old);
  store.append("alice~notes", turn);
  assert.equal(store.readStream("alice~notes").length, 1);
});

test("torn-tail repair happens under the lock (no stale-offset truncation)", (t) => {
  // Regression shape for the reviewed race: a torn tail exists, one writer
  // repairs+appends, a second writer must see the *new* state, not its
  // pre-read offset. Single-process equivalent: two appends in sequence
  // against a torn tail both survive.
  const store = tempStore(t, "alice");
  const a = finishTurn(noteCore("alice", "first"));
  store.append("alice~notes", a);
  appendFileSync(store.journalPath("alice~notes"), '{"torn');
  const b = finishTurn(noteCore("alice", "second"));
  const c = finishTurn(noteCore("alice", "third"));
  store.append("alice~notes", b);
  store.append("alice~notes", c);
  assert.deepEqual(
    store.readStream("alice~notes").map((x) => x.id),
    [a.id, b.id, c.id],
  );
});

test("two real processes racing on a torn-tail journal lose nothing", (t) => {
  // The reviewed data-loss scenario: torn tail present, two owner-side
  // writers append concurrently. Under the stream lock both turns survive.
  const store = tempStore(t, "alice");
  const a = finishTurn(noteCore("alice", "base"));
  store.append("alice~notes", a);
  appendFileSync(store.journalPath("alice~notes"), '{"torn');

  const lib = new URL("../lib/", import.meta.url).href;
  const script = (text) => `
    import { RecordStore } from ${JSON.stringify(lib + "store.mjs")};
    import { finishTurn } from ${JSON.stringify(lib + "canonical.mjs")};
    const store = new RecordStore(${JSON.stringify(store.root)}, { owner: "alice" });
    const turn = finishTurn({ v: 1, ts: "2026-02-22T10:00:00Z", from: "alice", kind: "note",
      body: { text: ${JSON.stringify(text)} },
      provenance: { source: "test", fidelity: "verbatim" } });
    store.append("alice~notes", turn);
  `;
  const children = ["racer-one", "racer-two"].map((text) =>
    spawn(process.execPath, ["--input-type=module", "-e", script(text)], { stdio: "inherit" }),
  );
  return Promise.all(
    children.map(
      (child) =>
        new Promise((resolve, reject) => {
          child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
        }),
    ),
  ).then(() => {
    const texts = store
      .readStream("alice~notes")
      .map((x) => x.body.text)
      .sort();
    assert.deepEqual(texts, ["base", "racer-one", "racer-two"], "no turn was truncated away");
  });
});

test("objects: put is idempotent and content-addressed", (t) => {
  const store = tempStore(t);
  const ref = store.putObject(Buffer.from("hello"));
  assert.equal(ref, store.putObject(Buffer.from("hello")));
  assert.ok(store.hasObject(ref));
  assert.equal(store.getObject(ref).toString(), "hello");
  assert.throws(() => store.getObject("sha256:zz"), StoreError);
});

test("mergeStreamCopy extends by suffix and quarantines non-prefix", (t) => {
  const store = tempStore(t, "alice");
  const a = finishTurn(noteCore("bob", "one"));
  const b = finishTurn(noteCore("bob", "two"));
  const c = finishTurn(noteCore("bob", "three"));

  assert.equal(store.mergeStreamCopy("bob~notes", [a, b]).extended, 2);
  assert.equal(store.mergeStreamCopy("bob~notes", [a]).extended, 0, "shorter copy is stale");
  assert.equal(store.mergeStreamCopy("bob~notes", [a, b, c]).extended, 1);
  assert.deepEqual(
    store.readStream("bob~notes").map((x) => x.id),
    [a.id, b.id, c.id],
  );
  assert.throws(() => store.mergeStreamCopy("bob~notes", [a, c, b]), /quarantined/);
});
