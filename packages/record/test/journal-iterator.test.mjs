import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RecordStore, parseJournal, StoreError } from "../lib/store.mjs";

function fixture(t, text) {
  const root = mkdtempSync(join(tmpdir(), "record-iterator-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new RecordStore(root, { owner: "test" });
  const path = store.journalPath("test~aw");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return store;
}

test("journal iterator preserves multiline, Unicode, blank-line and torn-tail semantics across chunks", (t) => {
  const text = '\n' + JSON.stringify({ text: "😀".repeat(40000) }) + '\n \r\n' +
    JSON.stringify({ text: "second" }) + '\n' + JSON.stringify({ text: "uncommitted tail" });
  const store = fixture(t, text);
  assert.deepEqual([...store.iterateStream("test~aw")], parseJournal(text).turns);
  assert.deepEqual([...store.iterateStream("test~missing")], []);
});

test("journal iterator is lazy and reports the byte offset of interior corruption", (t) => {
  const first = JSON.stringify({ text: "é".repeat(40000) }) + '\n\n';
  const store = fixture(t, first + 'broken\n' + JSON.stringify({ text: "after" }) + '\n');
  const iter = store.iterateStream("test~aw");
  assert.equal(iter.next().value.text.length, 40000, "the first turn is available before reading the corrupt line");
  assert.throws(() => iter.next(), (e) => e instanceof StoreError &&
    e.message === `corrupt interior journal line at byte ${Buffer.byteLength(first)}`);
});

test("journal iterator ignores an invalid final fragment but rejects a newline-terminated null", (t) => {
  const store = fixture(t, '{"ok":true}\nnot finished');
  assert.deepEqual([...store.iterateStream("test~aw")], [{ ok: true }]);
  writeFileSync(store.journalPath("test~aw"), '{"ok":true}\nnull\n');
  assert.throws(() => [...store.iterateStream("test~aw")], StoreError);
});
