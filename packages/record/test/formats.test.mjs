// pi and Codex capture: fixtures mirror the real on-disk record shapes
// (verified against ~/.pi/agent/sessions and ~/.codex/sessions), captured
// end-to-end into streams, indexed, and dressed.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { RecordStore } from "../lib/store.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";
import { SESSION_FORMATS, extractPiText, extractCodexText } from "../lib/formats.mjs";
import { RecordIndex } from "../lib/index-db.mjs";
// Cross-package on purpose: the multi-format fixtures live here, and the
// dressed-briefing assertions prove the experimental layer reads every
// format. The dependency direction is test-only; core lib/bin never
// import from packages/experimental.
import { dress } from "../../experimental/lib/dress.mjs";

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "turn-record-formats-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(join(base, "record"), { owner: "mac" });
  return { base, store };
}

const PI_UUID = "019fc67c-9c46-73f3-b44a-cbb6c7b02457";
const PI_LINES = [
  { type: "session", version: "3", id: PI_UUID, timestamp: "2026-08-03T07:18:03.078Z", cwd: "/w" },
  { type: "model_change", id: "8ebfd618", timestamp: "2026-08-03T07:18:03.126Z", provider: "openai-codex" },
  {
    type: "message",
    timestamp: "2026-08-03T07:18:05.000Z",
    message: { role: "user", content: [{ type: "text", text: "migrate the identity registry" }] },
  },
  {
    type: "message",
    timestamp: "2026-08-03T07:18:09.000Z",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "planning the migration quietly", thinkingSignature: "{}" },
        { type: "text", text: "starting with the schema split" },
      ],
    },
  },
  {
    type: "message",
    timestamp: "2026-08-03T07:18:09.500Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call_x|fc_y",
          name: "read",
          arguments: "{'path': '/w/file.txt'}",
        },
      ],
    },
  },
  {
    type: "message",
    timestamp: "2026-08-03T07:18:10.000Z",
    message: { role: "toolResult", content: [{ type: "text", text: "tool noise not indexed" }] },
  },
];

const CODEX_UUID = "019ac984-519d-75c2-b2f0-a6611c4f063e";
const CODEX_LINES = [
  {
    timestamp: "2025-11-28T08:11:23.460Z",
    type: "session_meta",
    payload: { id: CODEX_UUID, timestamp: "2025-11-28T08:11:23.422Z", cwd: "/w" },
  },
  {
    timestamp: "2025-11-28T08:11:23.460Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "study the aweb access model" }],
    },
  },
  {
    timestamp: "2025-11-28T08:12:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "the access model has three verbs" }],
    },
  },
];

const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

test("pi sessions capture into <owner>~pi with pi:session threads", (t) => {
  const { base, store } = setup(t);
  const dir = join(base, "pi-sessions", "--w--");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `2026-08-03T07-18-03-078Z_${PI_UUID}.jsonl`), jsonl(PI_LINES));

  const r = captureSessions(store, { owner: "mac", roots: [join(base, "pi-sessions")], format: "pi" });
  assert.equal(r.appended, PI_LINES.length, "one turn per native record");
  const turns = store.readStream(`mac~pi.${PI_UUID}`);
  assert.equal(turns.length, PI_LINES.length);
  assert.ok(turns.every((x) => x.thread === `pi:session:${PI_UUID}` && x.provenance.source === "pi"));
  assert.equal(turns.at(-1).ts, "2026-08-03T07:18:10.000Z", "event timestamps preserved");
  // Native form: each body.line is the exact source record.
  assert.equal(turns.map((x) => x.body.line).join("\n") + "\n", jsonl(PI_LINES));

  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();
  assert.equal(index.search("identity registry").length, 1, "user text searchable");
  assert.equal(index.search("schema split").length, 1, "assistant text searchable");
  // Never strip anything model-visible: thinking and tool results are
  // indexed with roles, filterable but present.
  assert.equal(index.search("planning the migration quietly").length, 1, "thinking indexed");
  assert.equal(index.search("planning the migration quietly", { role: "thinking" }).length, 1);
  assert.equal(index.search("tool noise").length, 1, "tool_result indexed");
  assert.equal(index.search("tool noise", { role: "user" }).length, 0, "role filter works");

  const d = dress(store, { thread: `pi:session:${PI_UUID}`, budgetChars: 5000, log: false });
  assert.match(d.briefing, /migrate the identity registry/);
  assert.match(d.briefing, /schema split/);
});

test("codex rollouts capture into <owner>~codex from nested date dirs", (t) => {
  const { base, store } = setup(t);
  const dir = join(base, "codex-sessions", "2025", "11", "28");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `rollout-2025-11-28T09-11-23-${CODEX_UUID}.jsonl`), jsonl(CODEX_LINES));

  const r = captureSessions(store, {
    owner: "mac",
    roots: [join(base, "codex-sessions")],
    format: "codex",
  });
  assert.equal(r.appended, CODEX_LINES.length, "one turn per native record");
  const turns = store.readStream(`mac~codex.${CODEX_UUID}`);
  assert.equal(turns.length, CODEX_LINES.length);
  assert.ok(turns.every((x) => x.thread === `codex:session:${CODEX_UUID}` && x.provenance.source === "codex"));

  const index = new RecordIndex(store);
  t.after(() => index.close());
  index.rebuild();
  assert.equal(index.search("access model").length, 2, "both roles searchable");

  const d = dress(store, { thread: `codex:session:${CODEX_UUID}`, budgetChars: 5000, log: false });
  assert.match(d.briefing, /three verbs/);
});

test("session ids parse from real filename shapes", () => {
  assert.equal(
    SESSION_FORMATS.pi.sessionId(`/x/2026-08-03T07-18-03-078Z_${PI_UUID}.jsonl`),
    PI_UUID,
  );
  assert.equal(
    SESSION_FORMATS.codex.sessionId(`/x/rollout-2025-11-28T09-11-23-${CODEX_UUID}.jsonl`),
    CODEX_UUID,
  );
  assert.equal(SESSION_FORMATS.cc.sessionId("/x/abcd-ef.jsonl"), "abcd-ef");
});

test("extractors surface the full conversation with roles", () => {
  const pi = extractPiText(Buffer.from(jsonl(PI_LINES)));
  assert.deepEqual(
    pi.map((d) => [d.role, d.text]),
    [
      ["user", "migrate the identity registry"],
      ["thinking", "planning the migration quietly"],
      ["assistant", "starting with the schema split"],
      ["tool_use", "read {'path': '/w/file.txt'}"],
      ["tool_result", "tool noise not indexed"],
    ],
    "nothing model-visible is stripped; pi toolCall normalizes to tool_use",
  );
  const cx = extractCodexText(Buffer.from(jsonl(CODEX_LINES)));
  assert.deepEqual(
    cx.map((d) => d.role),
    ["user", "assistant"],
  );
});

test("binary payloads index as placeholders; unknown parts are capped", async () => {
  const { extractCcText } = await import("../lib/formats.mjs");
  const doc64 = "A".repeat(400000);
  const line = JSON.stringify({
    type: "user",
    timestamp: "2026-02-22T10:00:00Z",
    message: {
      content: [
        { type: "document", source: { media_type: "application/pdf", data: doc64 } },
        { type: "mystery_part", payload: { deep: "x".repeat(10000) } },
      ],
    },
  });
  const docs = extractCcText(Buffer.from(line + "\n"));
  assert.equal(docs.length, 2);
  assert.match(docs[0].text, /^\[document: application\/pdf, 400000 base64 chars/);
  assert.ok(docs[0].text.length < 200, "placeholder, not payload");
  assert.equal(docs[1].role, "mystery_part");
  assert.ok(docs[1].text.length < 2100, "fallback capped");
  assert.match(docs[1].text, /full content in session blob/);
});
