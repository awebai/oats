// dress reads every capture format: pi and Codex sessions captured by core
// produce dressable threads. Shares the core fixtures (experimental
// importing core is the allowed direction); the capture/index assertions
// for the same fixtures live in packages/record/test/formats.test.mjs.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { RecordStore } from "../../record/lib/store.mjs";
import { captureSessions } from "../../record/lib/capture-cc.mjs";
import {
  PI_UUID,
  PI_LINES,
  CODEX_UUID,
  CODEX_LINES,
  jsonl,
} from "../../record/test/format-fixtures.mjs";
import { dress } from "../lib/dress.mjs";

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "turn-record-dress-formats-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(join(base, "record"), { owner: "mac" });
  return { base, store };
}

test("dress composes a briefing from a captured pi session", (t) => {
  const { base, store } = setup(t);
  const dir = join(base, "pi-sessions", "--w--");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `2026-08-03T07-18-03-078Z_${PI_UUID}.jsonl`), jsonl(PI_LINES));
  captureSessions(store, { owner: "mac", roots: [join(base, "pi-sessions")], format: "pi" });

  const d = dress(store, { thread: `pi:session:${PI_UUID}`, budgetChars: 5000, log: false });
  assert.match(d.briefing, /migrate the identity registry/);
  assert.match(d.briefing, /schema split/);
});

test("dress composes a briefing from a captured codex rollout", (t) => {
  const { base, store } = setup(t);
  const dir = join(base, "codex-sessions", "2025", "11", "28");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `rollout-2025-11-28T09-11-23-${CODEX_UUID}.jsonl`), jsonl(CODEX_LINES));
  captureSessions(store, { owner: "mac", roots: [join(base, "codex-sessions")], format: "codex" });

  const d = dress(store, { thread: `codex:session:${CODEX_UUID}`, budgetChars: 5000, log: false });
  assert.match(d.briefing, /three verbs/);
});
