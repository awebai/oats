// One jiminy per followed life: naming, per-life mind streams, the
// deterministic memory session, the birth note, and attribution of
// segment judgments to the jiminy rather than the machine owner.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { RecordStore } from "../lib/store.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { readThread, ReaderError } from "../lib/reader.mjs";
import { segmentsFor } from "../lib/segments.mjs";
import {
  followTurnCore,
  jiminyNameFor,
  jiminySessionId,
  mindStreamFor,
  parseFollow,
  principalOf,
} from "../lib/jiminy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = `node ${join(HERE, "reader-stub-engine.mjs")}`;

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "turn-record-jiminy-"));
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
    .map((t, i) => line(i % 2 === 0 ? "user" : "assistant", t, `2026-05-01T10:${String(i).padStart(2, "0")}:00Z`))
    .join("");
  writeFileSync(join(projects, "life.jsonl"), body);
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  return "cc:session:life";
}

test("identity is deterministic in the principal", () => {
  assert.equal(principalOf("cc:session:abcd1234-x"), "abcd1234-x");
  assert.equal(principalOf("aweb:conv:c1"), null, "mail threads have no jiminy");
  assert.equal(jiminyNameFor("cc:session:abcd1234-xyz"), "jiminy-abcd1234");
  assert.equal(mindStreamFor("mac", "cc:session:abcd1234"), "mac~mind.abcd1234");
  assert.equal(mindStreamFor("mac", "aweb:conv:c1"), "mac~mind", "owner-level fallback");

  const s1 = jiminySessionId("cc:session:abcd1234");
  assert.equal(s1, jiminySessionId("cc:session:abcd1234"), "same life, same memory");
  assert.notEqual(s1, jiminySessionId("cc:session:other"));
  assert.match(s1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/, "uuid-shaped");
});

test("judgments carry the jiminy's name in the life's own stream; born once", (t) => {
  const { base, store } = setup(t);
  const thread = seedSession(base, store, [
    "PHASE:exploration:learned the layout",
    "reading ".repeat(60),
  ]);
  readThread(store, { thread, engine: STUB, windowChars: 100000 });

  const streamId = mindStreamFor("mac", thread);
  const turns = store.readStream(streamId);
  assert.ok(turns.length >= 2, "birth note + at least one segment note");

  const birth = turns.map(parseFollow).filter(Boolean);
  assert.equal(birth.length, 1, "exactly one birth note");
  assert.equal(birth[0].jiminy, "jiminy-life");
  assert.equal(birth[0].follows, thread);
  assert.equal(birth[0].agent, `pi:session:${jiminySessionId(thread)}`, "memory session recorded at birth");

  const segs = segmentsFor(store, thread);
  assert.ok(segs.length >= 1, "segments found via per-life stream");
  const note = turns.find((x) => x.body?.segment);
  assert.equal(note.from, "jiminy-life", "judgment attributed to the jiminy");

  // The life grows; a second wake extends without a second birth.
  const file = join(base, "projects", "-p", "life.jsonl");
  writeFileSync(
    file,
    ["PHASE:exploration:learned the layout", "reading ".repeat(60), "PHASE:design:decided things", "arguing ".repeat(60)]
      .map((txt, i) => line(i % 2 === 0 ? "user" : "assistant", txt, `2026-05-01T10:${String(i).padStart(2, "0")}:00Z`))
      .join(""),
  );
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  readThread(store, { thread, engine: STUB, windowChars: 100000 });
  const after = store.readStream(streamId).map(parseFollow).filter(Boolean);
  assert.equal(after.length, 1, "born once, not per wake");
});

test("an engine template's {session} resolves to the jiminy's memory", (t) => {
  const { base, store } = setup(t);
  const thread = seedSession(base, store, ["hello there", "content ".repeat(60)]);
  const engine = `node ${join(HERE, "jiminy-stub-engine.mjs")} {session}`;
  readThread(store, { thread, engine, windowChars: 100000 });
  const segs = segmentsFor(store, thread);
  assert.equal(segs.length, 1);
  assert.ok(
    segs[0].established.includes(jiminySessionId(thread)),
    "the engine ran with this jiminy's deterministic session id",
  );
});

test("a {session} template on a jiminy-less thread fails loudly", (t) => {
  const { store } = setup(t);
  store.appendCore("mac~aw-test", {
    v: 1,
    ts: "2026-05-01T10:00:00Z",
    from: "acme/alpha",
    thread: "aweb:conv:c9",
    kind: "mail",
    body: { subject: "s", text: "hello" },
    provenance: { source: "aw-log", fidelity: "projected", origin: {} },
  });
  assert.throws(
    () => readThread(store, { thread: "aweb:conv:c9", engine: "true {session}" }),
    ReaderError,
  );
});

test("followTurnCore round-trips through parseFollow", () => {
  const core = followTurnCore({
    jiminy: "jiminy-abc",
    principalThread: "cc:session:abc-def",
    ts: "2026-05-01T10:00:00Z",
  });
  assert.equal(core.from, "jiminy-abc");
  const parsed = parseFollow({ ...core, id: "t1:x" });
  assert.equal(parsed.follows, "cc:session:abc-def");
  assert.equal(parsed.harness, "pi");
});
