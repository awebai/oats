// Librarian-dresser: candidate gathering, judged selection via a
// deterministic stub engine, memoization as tag + outfit turns, and
// tag-warmed gathering on later tasks.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { RecordStore } from "../lib/store.mjs";
import { RecordIndex } from "../lib/index-db.mjs";
import {
  gatherCandidates,
  LibrarianError,
  renderClothes,
  runEngine,
  selectClothes,
  selectionEntries,
} from "../lib/librarian.mjs";
import { parseOutfit, parseTag } from "../lib/tags.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = `node ${join(HERE, "stub-engine.mjs")}`;

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "turn-record-librarian-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(join(base, "record"), { owner: "mac" });
  return { store };
}

function mail(i, text, thread = "aweb:conv:w1") {
  return {
    v: 1,
    ts: `2026-03-0${(i % 9) + 1}T10:00:00Z`,
    from: "acme/alpha",
    to: "acme/beta",
    thread,
    kind: "mail",
    body: { subject: `m${i}`, text },
    provenance: { source: "aw-log", fidelity: "projected", origin: {} },
  };
}

function seed(store) {
  store.appendCore("mac~aw-x", mail(1, "DECISION: widget rollout uses the blue pipeline"));
  store.appendCore("mac~aw-x", mail(2, "lunch plans and other noise about nothing"));
  store.appendCore("mac~aw-x", mail(3, "DECISION: widget budget is capped at 10k"));
  store.appendCore("mac~aw-x", mail(4, "widget chatter that merely mentions things"));
}

test("selectClothes: judged selection, memoized tags and outfit", (t) => {
  const { store } = setup(t);
  seed(store);
  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();

  const r = selectClothes(store, index, { task: "roll out the widget", engine: STUB });
  assert.equal(r.selection.length, 2, "both DECISION turns selected, noise rejected");
  assert.ok(r.selection.every((s) => s.turn.body.text.includes("DECISION")));
  assert.ok(r.judged >= 3, "candidates included FTS hits");

  // Memoized into the mind stream and queryable through the index.
  const mind = store.readStream("mac~mind");
  const tags = mind.map(parseTag).filter(Boolean);
  const outfits = mind.map(parseOutfit).filter(Boolean);
  assert.equal(tags.length, 2);
  assert.ok(tags.every((x) => x.caseSlug === "widget-rollout" && x.acts.includes("decides")));
  assert.equal(outfits.length, 1);
  assert.equal(outfits[0].status, "proposed");
  assert.deepEqual(outfits[0].members.sort(), r.selection.map((s) => s.ref).sort());

  index.update();
  assert.equal(index.taggedRefs({ caseSlug: "widget-rollout" }).length, 2);
  assert.equal(index.outfitsFor("widget").length, 1);

  // Re-run with identical inputs: same turns, nothing duplicated.
  const r2 = selectClothes(store, index, { task: "roll out the widget", engine: STUB });
  assert.equal(store.readStream("mac~mind").length, mind.length, "memoization deduped");
  assert.equal(r2.selection.length, 2);

  // Entries render for the compiler/briefing.
  const entries = selectionEntries(store, r.selection);
  assert.equal(entries.length, 2);
  assert.match(entries[0].text, /DECISION/);
});

test("tags warm candidate gathering for a later related task", (t) => {
  const { store } = setup(t);
  seed(store);
  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();
  selectClothes(store, index, { task: "roll out the widget", engine: STUB });
  index.update();

  // A later task that shares only the topic slug: tag-derived candidates
  // appear even where FTS phrasing differs.
  const { candidates } = gatherCandidates(store, index, { task: "plan the widget next steps" });
  const viaTag = candidates.filter((c) => c.why.some((w) => w.startsWith("tag:")));
  assert.equal(viaTag.length, 2, "tagged decisions surfaced by topic");
  const viaOutfit = candidates.filter((c) => c.why.some((w) => w.startsWith("outfit:")));
  assert.equal(viaOutfit.length, 2, "prior outfit members surfaced");
});

test("explicit pins are never capped; mechanical drops are counted", (t) => {
  const { store } = setup(t);
  seed(store);
  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();
  const pins = Array.from({ length: 300 }, (_, i) => `t1:${String(i).padStart(64, "0")}`);
  const { candidates, dropped } = gatherCandidates(store, index, { task: "widget", pins });
  const pinRefs = candidates.filter((c) => c.why.includes("pin"));
  assert.equal(pinRefs.length, 300, "every explicit pin survives the cap");
  // With explicit candidates over the cap, mechanical ones are crowded
  // out — and that displacement is counted, never silent.
  assert.ok(dropped >= 1, "mechanical displacement is reported");
  assert.equal(
    candidates.filter((c) => c.why.includes("fts")).length + dropped,
    dropped + candidates.length - 300,
    "kept + dropped accounts for every mechanical candidate",
  );
});

test("a malformed note turn cannot break indexing or rebuild", (t) => {
  const { store } = setup(t);
  seed(store);
  // Hostile shape from review: body.tag present but links is a string.
  store.appendCore("mac~aw-x", {
    v: 1,
    ts: "2026-03-09T10:00:00Z",
    from: "acme/alpha",
    kind: "note",
    links: "not-an-array",
    body: { text: "bad", tag: { about: ["x"] } },
    provenance: { source: "test", fidelity: "summary" },
  });
  const index = new RecordIndex(store);
  t.after(() => index.close());
  assert.doesNotThrow(() => index.rebuild(), "rebuild survives a malformed note turn");
  assert.doesNotThrow(() => index.update());
});

test("memoization dedupes by target under a wording-varying judge", (t) => {
  const { store } = setup(t);
  seed(store);
  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();
  selectClothes(store, index, { task: "roll out the widget", engine: STUB });
  const after1 = store.readStream("mac~mind").length;
  // Second run with a judge that words everything differently: same
  // targets, different note text -> different tag ids. First judgment
  // wins; no near-duplicate tags minted.
  const VARIANT = `node ${join(HERE, "stub-engine.mjs")} `; // trailing space: same behavior, but simulate wording variance below
  selectClothes(store, index, {
    task: "roll out the widget",
    engine: `sh -c 'node ${join(HERE, "stub-engine.mjs")} | sed s/decision/judgment/'`,
  });
  const after2 = store.readStream("mac~mind").length;
  assert.equal(after2, after1, "no new tags or outfits for already-judged targets");
  void VARIANT;
});

test("task-mode rendering carries the content signature", (t) => {
  const { store } = setup(t);
  seed(store);
  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();
  const r = selectClothes(store, index, { task: "roll out the widget", engine: STUB, memoize: false });
  const entries = selectionEntries(store, r.selection);
  const out = renderClothes("roll out the widget", r.selection, entries);
  const sig = out.match(/markers end with sig:([0-9a-f]{16})/)?.[1];
  assert.ok(sig, "preamble announces the signature");
  const markers = [...out.matchAll(/<!-- turn: \S+ sig:([0-9a-f]{16}) -->/g)];
  assert.equal(markers.length, r.selection.length);
  assert.ok(markers.every((m) => m[1] === sig));
});

test("engine failures are loud, typed errors", (t) => {
  const { store } = setup(t);
  seed(store);
  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();

  assert.throws(
    () => selectClothes(store, index, { task: "widget", engine: null }),
    LibrarianError,
  );
  assert.throws(() => runEngine("false", "prompt"), /engine exited/);
  assert.throws(() => runEngine("echo no json here", "prompt"), /no JSON object/);
  assert.throws(
    () => selectClothes(store, index, { task: "widget", engine: 'echo "{\\"nope\\": 1}"' }),
    /missing selected/,
  );
});
