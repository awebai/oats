// The wardrobe layer: segment catalog (storage, search, latest-wins,
// dead-end exclusion), outfit freezing from explicit segments, and the
// creation mapping (spawn notes -> spawns table).

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { RecordStore } from "../lib/store.mjs";
import { RecordIndex } from "../lib/index-db.mjs";
import { finishTurn } from "../lib/canonical.mjs";
import { segmentTurnCore, spawnTurnCore, parseSpawn } from "../lib/segments.mjs";
import { outfitTurnCore, parseOutfit } from "../lib/tags.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "turn-record-wardrobe-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(join(base, "record"), { owner: "mac" });
  return { store };
}

function seg(store, { thread, start, end, type, outcome, established, lesson, ts, about = [] }) {
  const turn = finishTurn(
    segmentTurnCore({
      owner: "mac",
      thread,
      start: `line:${start}`,
      end: end ? `line:${end}` : null,
      type,
      about,
      established,
      outcome,
      lesson,
      ts,
      snapshot: "t1:" + "a".repeat(64),
    }),
  );
  store.append("mac~mind", turn);
  return turn;
}

test("segment catalog: filters, meaning search, latest-wins, dead-end exclusion", (t) => {
  const { store } = setup(t);
  const A = "cc:session:alpha";
  const B = "pi:session:beta";
  seg(store, { thread: A, start: 1, end: 40, type: "exploration", outcome: "fruitful", established: "mapped the aweb-oss identity registry and grant flows", about: ["aweb-oss"], ts: "2026-03-01T10:00:00Z" });
  seg(store, { thread: A, start: 40, end: 90, type: "implementation", outcome: "dead-end", established: "built the wrong widget adapter", lesson: "the adapter must speak protocol v2", ts: "2026-03-01T11:00:00Z" });
  seg(store, { thread: B, start: 1, end: 30, type: "design", outcome: "fruitful", established: "decided the deployment topology for the relay", ts: "2026-03-02T10:00:00Z" });
  // Revision of A's first segment: latest wins in the catalog.
  seg(store, { thread: A, start: 1, end: 45, type: "exploration", outcome: "fruitful", established: "REVISED: mapped identity registry incl. session grants", about: ["aweb-oss"], ts: "2026-03-01T12:00:00Z" });

  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();

  const all = index.segmentCatalog({});
  assert.equal(all.length, 2, "dead-end excluded by default; revision collapsed");
  assert.match(all.find((r) => r.thread === A).established, /REVISED/);

  assert.equal(index.segmentCatalog({ includeDead: true }).length, 3);
  assert.equal(index.segmentCatalog({ outcome: "dead-end" })[0].lesson, "the adapter must speak protocol v2");
  assert.equal(index.segmentCatalog({ thread: B }).length, 1);
  assert.equal(index.segmentCatalog({ type: "design" }).length, 1);
  assert.equal(index.segmentCatalog({ about: "aweb-oss" }).length, 1);

  // Meaning search over established text (role "segment" in FTS).
  const byMeaning = index.segmentCatalog({ q: "session grants" });
  assert.equal(byMeaning.length, 1);
  assert.equal(byMeaning[0].thread, A);

  // Incremental parity: update() after new segments matches rebuild().
  seg(store, { thread: B, start: 30, end: 60, type: "review", outcome: "fruitful", established: "review confirmed the relay topology", ts: "2026-03-02T11:00:00Z" });
  index.update();
  assert.equal(index.segmentCatalog({}).length, 3);
});

test("mixed-precision timestamps: catalog and segmentsFor agree on latest", async (t) => {
  const { store } = setup(t);
  const thread = "cc:session:mix";
  // ".500Z" sorts before "Z" as a string but is later in time — the shape
  // that broke dress ordering in an earlier round must not break here.
  seg(store, { thread, start: 1, end: 9, type: "design", outcome: "fruitful", established: "first judgment", ts: "2026-03-01T10:00:00Z" });
  seg(store, { thread, start: 1, end: 9, type: "design", outcome: "fruitful", established: "later judgment", ts: "2026-03-01T10:00:00.500Z" });
  const { segmentsFor } = await import("../lib/segments.mjs");
  const jsWinner = segmentsFor(store, thread)[0].established;
  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();
  const sqlWinner = index.segmentCatalog({ thread })[0].established;
  assert.equal(jsWinner, "later judgment");
  assert.equal(sqlWinner, jsWinner, "SQL latest-wins matches JS latest-wins");
});

test("tombstoned spawn notes vanish from the spawns table, both orders", (t) => {
  const { store } = setup(t);
  const spawn = finishTurn(
    spawnTurnCore({ owner: "mac", agentThread: "pi:session:x", outfit: "t1:" + "b".repeat(64), ts: "2026-03-03T09:00:00Z" }),
  );
  store.append("mac~mind", spawn);
  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();
  assert.equal(index.spawnsFor({ agent: "pi:session:x" }).length, 1);

  // Tombstone arrives later: purge on application.
  store.appendCore("mac~mind", {
    v: 1,
    ts: "2026-03-03T10:00:00Z",
    from: "mac",
    kind: "tombstone",
    links: [{ rel: "tombstones", ref: spawn.id }],
    body: { reason: "retracted" },
    provenance: { source: "mind", fidelity: "projected" },
  });
  index.update();
  assert.equal(index.spawnsFor({ agent: "pi:session:x" }).length, 0, "tombstone-later purges");
  // And from-scratch (hidden at arrival): rebuild agrees.
  index.rebuild();
  assert.equal(index.spawnsFor({ agent: "pi:session:x" }).length, 0, "rebuild agrees");
});

test("an old-schema index self-heals by wipe-and-rebuild", async (t) => {
  const { store } = setup(t);
  seg(store, { thread: "cc:session:x", start: 1, end: 5, type: "design", outcome: "fruitful", established: "a decision", ts: "2026-03-01T10:00:00Z" });
  // Hand-build a pre-versioning index with an 11-column segments table.
  const { mkdirSync } = await import("node:fs");
  const { DatabaseSync } = await import("node:sqlite");
  mkdirSync(join(store.root, "index"), { recursive: true });
  const old = new DatabaseSync(join(store.root, "index", "turns.db"));
  old.exec("CREATE TABLE turns (id TEXT PRIMARY KEY, ts TEXT, from_name TEXT, to_name TEXT, thread TEXT, kind TEXT, source TEXT, fidelity TEXT, stream TEXT, events INTEGER, hidden INTEGER, superseded INTEGER)");
  old.exec("CREATE TABLE segments (note_id TEXT PRIMARY KEY, thread TEXT, start_n INTEGER, end_n INTEGER, type TEXT, outcome TEXT, about TEXT, established TEXT, lesson TEXT, snapshot TEXT, ts TEXT)");
  old.close();

  const index = new RecordIndex(store); // must wipe, not crash
  t.after(() => index.close());
  index.rebuild();
  assert.equal(index.segmentCatalog({}).length, 1, "rebuilt cleanly on the new schema");
  assert.equal(index.db.prepare("PRAGMA user_version").get().user_version, 1);
});

test("dress --segment works through the actual binary", (t) => {
  const { store } = setup(t);
  const s1 = seg(store, { thread: "cc:session:alpha", start: 1, end: 40, type: "exploration", outcome: "fruitful", established: "context A", ts: "2026-03-01T10:00:00Z" });
  const out = execFileSync(
    process.execPath,
    [join(HERE, "..", "bin", "dress.mjs"), "--root", store.root, "--owner", "mac", "--segment", s1.id, "--task", "wear context A"],
    { encoding: "utf8" },
  ).trim();
  assert.match(out, /^t1:[0-9a-f]{64}$/, "prints the outfit id");
  const outfitTurn = store.readAll().get(out)?.turn;
  assert.ok(outfitTurn, "outfit persisted");
  assert.deepEqual(parseOutfit(outfitTurn).members, [s1.id]);
});

test("outfit from explicit segments + spawn note = creation mapping", (t) => {
  const { store } = setup(t);
  const s1 = seg(store, { thread: "cc:session:alpha", start: 1, end: 40, type: "exploration", outcome: "fruitful", established: "context A", ts: "2026-03-01T10:00:00Z" });
  const s2 = seg(store, { thread: "cc:session:alpha", start: 40, end: 90, type: "design", outcome: "fruitful", established: "decision B", ts: "2026-03-01T11:00:00Z" });

  const outfit = finishTurn(
    outfitTurnCore({ owner: "mac", task: "continue the alpha work", members: [s1.id, s2.id], status: "proposed", ts: s2.ts }),
  );
  store.append("mac~mind", outfit);
  assert.deepEqual(parseOutfit(outfit).members, [s1.id, s2.id], "outfit members are segment note ids");

  // The creation mapping, written at birth: agent id -> outfit -> segments.
  const agentThread = "pi:session:00000000-1111-4222-8333-444444444444";
  const spawn = finishTurn(
    spawnTurnCore({
      owner: "mac",
      agentThread,
      outfit: outfit.id,
      task: "continue the alpha work",
      harness: "pi",
      grant: "grant:abc123",
      ts: "2026-03-03T09:00:00Z",
    }),
  );
  store.append("mac~mind", spawn);
  assert.equal(parseSpawn(spawn).agent, agentThread);

  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();

  // Quality-assessment joins: agent -> outfit -> exact segments worn.
  const found = index.spawnsFor({ agent: agentThread });
  assert.equal(found.length, 1);
  assert.equal(found[0].outfit_id, outfit.id);
  assert.equal(found[0].harness, "pi");
  assert.equal(found[0].grant_ref, "grant:abc123");
  const worn = index.db.prepare("SELECT members FROM outfits WHERE outfit_id = ?").get(outfit.id);
  assert.deepEqual(JSON.parse(worn.members), [s1.id, s2.id]);
  // And the reverse: where has this outfit been worn?
  assert.equal(index.spawnsFor({ outfit: outfit.id })[0].agent_thread, agentThread);
});
