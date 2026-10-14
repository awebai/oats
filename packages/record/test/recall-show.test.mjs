import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RecordStore } from "../lib/store.mjs";
import { RecordIndex } from "../lib/index-db.mjs";

const RECALL = new URL("../bin/recall.mjs", import.meta.url).pathname;

function fixture(t, kind, claimant) {
  const base = mkdtempSync(join(tmpdir(), "recall-show-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "record"), home = join(base, "home");
  mkdirSync(home);
  // Storage ownership differs from the target author: this tests author
  // authority alone, without relying on recall resolving a record owner.
  const store = new RecordStore(root, { owner: "storage" });
  const thread = kind === "session" ? "cc:session:show" : "mail:show";
  const body = kind === "session"
    ? { line: JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "privatepayload" }] } }) }
    : { text: "privatepayload" };
  const { turn } = store.appendCore(kind === "session" ? "storage~cc.show" : "storage~mail", {
    v: 1, ts: "2026-01-01T00:00:00Z", from: "author", kind, thread, body,
    provenance: { source: kind === "session" ? "cc" : "aw" },
  });
  if (claimant) store.appendCore("storage~claims", {
    v: 1, ts: "2026-01-02T00:00:00Z", from: claimant, kind: "tombstone",
    body: { reason: "redacted" }, links: [{ rel: "tombstones", ref: turn.id }],
  });
  const index = new RecordIndex(store);
  try { index.rebuild(); } finally { index.close(); }
  const recall = (...args) => {
    // Assert application diagnostics independently of Node's SQLite warnings.
    const result = spawnSync(process.execPath, ["--no-warnings", RECALL, "--root", root, ...args], {
      encoding: "utf8", timeout: 10000,
      env: { PATH: process.env.PATH, HOME: home, TMPDIR: base, XDG_CACHE_HOME: join(base, "cache") },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return result;
  };
  return { turn, thread, recall };
}

for (const kind of ["session", "mail"]) {
  test(`--show hides an author-tombstoned ${kind} turn with a cross-stream claim`, (t) => {
    const { turn, thread, recall } = fixture(t, kind, "author");
    const shown = recall("--show", turn.id);
    assert.equal(shown.status, 1, "a hidden target must be refused");
    assert.equal(shown.stdout, "", "no hidden payload reaches stdout");
    assert.equal(shown.stderr.trim(), `turn ${turn.id} is tombstoned`);
    const direct = recall("--thread", thread, "--json");
    assert.equal(direct.status, 0, direct.stderr);
    assert.deepEqual(JSON.parse(direct.stdout).turns, []);
    const search = recall("privatepayload", "--json");
    assert.equal(search.status, 0, search.stderr);
    assert.deepEqual(JSON.parse(search.stdout), []);
  });

  for (const claimant of [null, "stranger"]) {
    test(`--show returns a ${kind} turn with ${claimant ? "an unauthorized claim" : "no claim"}`, (t) => {
      const { turn, recall } = fixture(t, kind, claimant);
      const shown = recall("--show", turn.id);
      assert.equal(shown.status, 0, shown.stderr);
      assert.deepEqual(JSON.parse(shown.stdout), turn);
    });
  }
}

test("--show keeps the missing-turn response", (t) => {
  const { recall } = fixture(t, "session", null);
  const missing = recall("--show", "t1:missing");
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.equal(missing.stderr.trim(), "no turn t1:missing");
});
