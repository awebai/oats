// spawn: compiling an outfit into a native pi session file — mapping
// fidelity, INDISTINGUISHABILITY (the dressed agent's session contains
// exactly what a lived session would contain, nothing else), chain
// integrity, the spawn note, determinism, and the shipped binary.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { RecordStore } from "../../record/lib/store.mjs";
import { captureSessions } from "../../record/lib/capture-cc.mjs";
import { segmentTurnCore } from "../../record/lib/segments.mjs";
import { outfitTurnCore } from "../../record/lib/tags.mjs";
import { assembleEntries, CompileError, compileOutfit, outfitChunks, piProjectDir } from "../lib/compile-pi.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "turn-record-spawn-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(join(base, "record"), { owner: "mac" });
  return { base, store };
}

const cc = (obj, ts) => JSON.stringify({ timestamp: ts, ...obj }) + "\n";

// A cc session exercising every mapping rule: text, thinking, a paired
// tool call, an unpaired tool call, and a system notice.
function seedCcSession(base, store) {
  const projects = join(base, "projects", "-p");
  mkdirSync(projects, { recursive: true });
  const lines =
    cc({ type: "user", message: { content: [{ type: "text", text: "please list the files" }] } }, "2026-03-01T10:00:00Z") +
    cc(
      {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "an ls will do", signature: "sig-from-another-provider" },
            { type: "text", text: "Listing now." },
            { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
          ],
        },
      },
      "2026-03-01T10:00:05Z",
    ) +
    cc(
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "a.txt\nb.txt" }] }] } },
      "2026-03-01T10:00:06Z",
    ) +
    cc({ type: "assistant", message: { content: [{ type: "text", text: "Two files: a.txt and b.txt." }] } }, "2026-03-01T10:00:10Z") +
    cc({ type: "system", content: "budget warning" }, "2026-03-01T10:00:11Z") +
    cc(
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "toolu_2", name: "Read", input: { file: "a.txt" } }] },
      },
      "2026-03-01T10:00:12Z",
    );
  writeFileSync(join(projects, "sess-A.jsonl"), lines);
  captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  return "cc:session:sess-A";
}

function freeze(store, thread, spans) {
  const members = spans.map(([start, end, established], i) =>
    store.appendCore(
      "mac~mind",
      segmentTurnCore({
        owner: "mac",
        thread,
        start: `line:${start}`,
        end: `line:${end}`,
        type: "implementation",
        established,
        outcome: "fruitful",
        ts: `2026-03-01T11:0${i}:00Z`,
      }),
    ).turn.id,
  );
  return store.appendCore(
    "mac~mind",
    outfitTurnCore({ owner: "mac", task: "carry the file work", members, ts: "2026-03-01T11:10:00Z" }),
  ).turn.id;
}

test("an outfit compiles into a well-formed pi v3 session", (t) => {
  const { base, store } = setup(t);
  const thread = seedCcSession(base, store);
  // Segment 1: lines [1,6) — paired tool call plus a system notice that
  // must NOT survive into the dress. Segment 2: line 6 — a tool call
  // whose result never arrives (dropped). Half-open spans.
  const outfitId = freeze(store, thread, [
    [1, 6, "listing established the two files"],
    [6, 7, "started reading a.txt"],
  ]);

  const r = compileOutfit(store, {
    outfit: outfitId,
    owner: "mac",
    cwd: base,
    sessionDir: join(base, "pi-sessions"),
    sessionId: "11111111-2222-4333-8444-555555555555",
    now: "2026-03-01T12:00:00.000Z",
  });
  assert.equal(r.agentThread, "pi:session:11111111-2222-4333-8444-555555555555");
  assert.equal(r.segments, 2);
  assert.match(r.command, /^pi --session /);

  const entries = readFileSync(r.path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const [header, ...rest] = entries;
  assert.equal(header.type, "session");
  assert.equal(header.version, 3);
  assert.equal(header.id, r.sessionId);

  // Chain integrity: 8-hex ids, first parentId null, each parent = previous.
  let prev = null;
  for (const e of rest) {
    assert.match(e.id, /^[0-9a-f]{8}$/);
    assert.equal(e.parentId, prev, `entry ${e.id} chains to its predecessor`);
    prev = e.id;
  }

  const messages = rest.filter((e) => e.type === "message").map((e) => e.message);

  // INDISTINGUISHABILITY: nothing announces the dress. No custom
  // messages, no markers, no bracketed folds, no harness bookkeeping,
  // no thinking, no foreign signatures.
  assert.equal(rest.filter((e) => e.type === "custom_message").length, 0, "no injected entries at all");
  const whole = readFileSync(r.path, "utf8");
  assert.ok(!whole.includes("dressed context"), "no segment markers");
  assert.ok(!whole.includes("[thinking]"), "no thinking folds");
  assert.ok(!whole.includes("[tool call"), "no folded calls");
  assert.ok(!whole.includes("budget warning"), "no harness bookkeeping");
  assert.ok(!whole.includes("an ls will do"), "thinking dropped entirely");
  assert.ok(!whole.includes("sig-from-another-provider"), "foreign signatures never replayed");

  // Roles in order: user, assistant (text + paired call), toolResult,
  // assistant. Segment 2's assistant had ONLY an unpaired call: absent.
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content[0].text, "please list the files");

  const asst1 = messages[1];
  assert.equal(asst1.role, "assistant");
  assert.equal(asst1.stopReason, "toolUse");
  assert.deepEqual(asst1.content.map((p) => p.type), ["text", "toolCall"]);
  assert.equal(asst1.content[0].text, "Listing now.");
  assert.deepEqual(asst1.content[1], { type: "toolCall", id: "toolu_1", name: "Bash", arguments: { command: "ls" } });

  const result = messages[2];
  assert.equal(result.role, "toolResult");
  assert.equal(result.toolCallId, "toolu_1");
  assert.equal(result.toolName, "Bash");
  assert.equal(result.content[0].text, "a.txt\nb.txt");
  assert.equal(result.isError, false);

  // Segment 2's tool call has no result in the segment: dropped whole.
  assert.ok(!messages.some((m) => m.content?.some?.((p) => p.type === "toolCall" && p.id === "toolu_2")));
  assert.equal(messages.at(-1).content[0].text, "Two files: a.txt and b.txt.", "the last message is real conversation");

  // The spawn note maps the agent to the outfit at birth.
  assert.ok(r.spawn, "spawn note recorded");
  assert.equal(r.spawn.body.spawn.agent, r.agentThread);
  assert.equal(r.spawn.body.spawn.outfit, outfitId);
  assert.equal(r.spawn.body.spawn.harness, "pi");
  assert.equal(r.spawn.body.spawn.task, "carry the file work");

  // Determinism: same outfit, session id, and stamp -> identical bytes.
  const again = compileOutfit(store, {
    outfit: outfitId,
    owner: "mac",
    cwd: base,
    sessionDir: join(base, "pi-sessions-2"),
    sessionId: r.sessionId,
    now: "2026-03-01T12:00:00.000Z",
    log: false,
  });
  assert.equal(readFileSync(again.path, "utf8"), readFileSync(r.path, "utf8"));
});

test("a tombstoned event stays redacted in the dress", (t) => {
  const { base, store } = setup(t);
  const thread = seedCcSession(base, store);
  const outfitId = freeze(store, thread, [[1, 5, "the listing"]]);
  const secret = store
    .readStream("mac~cc.sess-A")
    .find((x) => x.body.line.includes("a.txt\nb.txt") === false && x.body.line.includes("please list"));
  store.appendCore("mac~aw-test", {
    v: 1,
    ts: "2026-03-01T11:30:00Z",
    from: "mac",
    kind: "tombstone",
    links: [{ rel: "tombstones", ref: secret.id }],
    body: { reason: "redacted" },
    provenance: { source: "test", fidelity: "projected" },
  });
  const { chunks } = outfitChunks(store, outfitId);
  const all = JSON.stringify(chunks);
  assert.ok(!all.includes("please list the files"), "tombstoned event absent from the dress");
  assert.ok(all.includes("Two files"), "other events intact");
});

test("out-of-order and duplicate tool pairs are dropped, never dangle", () => {
  const opts = { sessionId: "22222222-3333-4444-8555-666666666666", cwd: "/x", now: "2026-03-01T12:00:00.000Z" };

  // A result BEFORE its call: neither side replays natively.
  const early = assembleEntries(
    [{
      items: [
        { kind: "tool_result", callId: "c1", name: "bash", text: "out", isError: false },
        { kind: "assistant", parts: [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }] },
      ],
    }],
    opts,
  );
  const earlyMsgs = early.filter((e) => e.type === "message").map((e) => e.message);
  assert.ok(!earlyMsgs.some((m) => m.role === "toolResult"), "no native result");
  assert.ok(
    !earlyMsgs.some((m) => m.content?.some?.((p) => p.type === "toolCall")),
    "a call whose result already passed never replays natively (it would dangle)",
  );
  assert.equal(early.filter((e) => e.type === "custom_message").length, 0, "and nothing announces the drop");

  // Duplicate call ids: only the first occurrence pairs with the result.
  const dup = assembleEntries(
    [{
      items: [
        { kind: "assistant", parts: [{ type: "toolCall", id: "d1", name: "bash", arguments: { n: 1 } }] },
        { kind: "assistant", parts: [{ type: "toolCall", id: "d1", name: "bash", arguments: { n: 2 } }] },
        { kind: "tool_result", callId: "d1", name: "bash", text: "out", isError: false },
      ],
    }],
    opts,
  );
  const dupMsgs = dup.filter((e) => e.type === "message").map((e) => e.message);
  const nativeCalls = dupMsgs.flatMap((m) => m.content ?? []).filter((p) => p.type === "toolCall");
  assert.equal(nativeCalls.length, 1, "exactly one native call");
  assert.deepEqual(nativeCalls[0].arguments, { n: 1 }, "the FIRST occurrence");
  assert.equal(dupMsgs.filter((m) => m.role === "toolResult").length, 1, "exactly one native result");

  // Two results for one call: the first pairs, the second orphans.
  const twice = assembleEntries(
    [{
      items: [
        { kind: "assistant", parts: [{ type: "toolCall", id: "t1", name: "bash", arguments: {} }] },
        { kind: "tool_result", callId: "t1", name: "bash", text: "first", isError: false },
        { kind: "tool_result", callId: "t1", name: "bash", text: "second", isError: false },
      ],
    }],
    opts,
  );
  const twiceMsgs = twice.filter((e) => e.type === "message").map((e) => e.message);
  assert.equal(twiceMsgs.filter((m) => m.role === "toolResult").length, 1);
  assert.ok(!JSON.stringify(twice).includes("second"), "the surplus result is dropped, never announced");
});

test("diverging owner streams for one session fail loudly", (t) => {
  const { base, store } = setup(t);
  const thread = seedCcSession(base, store);
  const outfitId = freeze(store, thread, [[1, 3, "the listing"]]);
  // A second owner claims the same session but with different bytes at
  // line 1 — corruption or tampering, never a silent pick.
  const other = new RecordStore(store.root, { owner: "otherbox" });
  const evil = store.readStream("mac~cc.sess-A")[0];
  other.appendCore("otherbox~cc.sess-A", {
    v: 1,
    ts: evil.ts,
    from: "otherbox",
    thread: evil.thread,
    kind: "session",
    body: { line: '{"type":"user","message":{"content":[{"type":"text","text":"TAMPERED"}]}}' },
    provenance: { source: "cc", fidelity: "verbatim", origin: { session_id: "sess-A", line: 1 } },
  });
  assert.throws(() => outfitChunks(store, outfitId), /diverge at line 1/);
});

test("pi session path follows pi's directory convention", () => {
  assert.equal(piProjectDir("/Users/x/proj"), "--Users-x-proj--");
});

test("an outfit with nothing replayable refuses to spawn", (t) => {
  // A segment that spans only harness bookkeeping and an unpaired tool
  // call compiles to zero conversation. Writing a header-only session
  // with a spawn note would assert clothes the agent does not wear.
  const { base, store } = setup(t);
  const thread = seedCcSession(base, store);
  const outfitId = freeze(store, thread, [[5, 7, "looked busy, left nothing replayable"]]);
  const mindBefore = store.readStream("mac~mind").length;
  assert.throws(
    () => compileOutfit(store, { outfit: outfitId, owner: "mac", cwd: base, sessionDir: join(base, "pi-sessions") }),
    /compiles to no conversation/,
  );
  assert.equal(store.readStream("mac~mind").length, mindBefore, "no spawn note recorded");
  assert.ok(!existsSync(join(base, "pi-sessions")), "no session file written");
});

test("unknown outfit fails loudly", (t) => {
  const { store } = setup(t);
  assert.throws(
    () => compileOutfit(store, { outfit: "t1:" + "0".repeat(64), owner: "mac" }),
    CompileError,
  );
});

test("the shipped binary compiles a dry run end to end", (t) => {
  const { base, store } = setup(t);
  const thread = seedCcSession(base, store);
  const outfitId = freeze(store, thread, [[1, 5, "the listing"]]);
  void thread;
  const out = execFileSync(
    process.execPath,
    [join(HERE, "..", "..", "..", "bin", "oats.mjs"), "experimental", "spawn", "--outfit", outfitId, "--dry-run", "--cwd", base],
    { env: { ...process.env, TURN_RECORD_ROOT: store.root, TURN_RECORD_OWNER: "mac" }, encoding: "utf8" },
  );
  assert.match(out, /^pi --session .*\.jsonl\n$/);
});
