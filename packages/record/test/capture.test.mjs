// Capture behavior: sessions (idempotence, growth, unparseable lines) and
// aw client logs (projection, determinism, torn tails).

import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { RecordStore } from "../lib/store.mjs";
import { captureSessions, listSessionFiles, scanTranscript } from "../lib/capture-cc.mjs";
import { captureCommLog, captureInteractionLog } from "../lib/capture-aw.mjs";
import { projectCommLogEntry, unprojectCommLogEntry } from "../lib/project-aweb.mjs";

function setup(t) {
  const base = mkdtempSync(join(tmpdir(), "turn-record-capture-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const store = new RecordStore(join(base, "record"), { owner: "mac" });
  return { base, store };
}

function sessionEvent(type, text, ts) {
  return JSON.stringify({
    type,
    timestamp: ts,
    message: { content: [{ type: "text", text }] },
    sessionId: "s1",
  });
}

test("session capture: idempotent, snapshots growth, keeps unknown lines", (t) => {
  const { base, store } = setup(t);
  const projects = join(base, "projects", "-my-project");
  mkdirSync(projects, { recursive: true });
  const file = join(projects, "aaaa-bbbb.jsonl");
  writeFileSync(
    file,
    sessionEvent("user", "hello", "2026-02-22T10:00:00Z") +
      "\n" +
      "this line is not json but must be preserved\n" +
      sessionEvent("assistant", "hi there", "2026-02-22T10:00:05Z") +
      "\n",
  );

  const roots = [join(base, "projects")];
  const r1 = captureSessions(store, { owner: "mac", roots });
  assert.equal(r1.appended, 1);
  const r2 = captureSessions(store, { owner: "mac", roots });
  assert.equal(r2.appended, 0, "unchanged session is a no-op");

  // Growth produces exactly one new snapshot turn on the same thread.
  appendFileSync(file, sessionEvent("user", "more", "2026-02-22T10:01:00Z") + "\n");
  const r3 = captureSessions(store, { owner: "mac", roots });
  assert.equal(r3.appended, 1);

  const turns = store.readStream("mac~cc");
  assert.equal(turns.length, 2);
  assert.ok(turns.every((x) => x.thread === "cc:session:aaaa-bbbb"));
  assert.equal(turns[0].body.events, 3, "unparseable line counted and kept");
  assert.equal(turns[1].body.events, 4);

  // The blob is verbatim: the non-JSON line survives byte-for-byte.
  const blob = store.getObject(turns[0].body.ref).toString();
  assert.ok(blob.includes("this line is not json but must be preserved"));

  // Turn core is a pure function of bytes: ts comes from the transcript.
  assert.equal(turns[0].ts, "2026-02-22T10:00:05Z");
  assert.equal(turns[1].ts, "2026-02-22T10:01:00Z");
});

test("session capture skips empty and never-timestamped files", (t) => {
  const { base, store } = setup(t);
  const projects = join(base, "projects", "-p");
  mkdirSync(projects, { recursive: true });
  writeFileSync(join(projects, "empty.jsonl"), "");
  writeFileSync(join(projects, "no-ts.jsonl"), '{"type":"mode","mode":"normal"}\n');
  const r = captureSessions(store, { owner: "mac", roots: [join(base, "projects")] });
  assert.equal(r.appended, 0);
  assert.equal(r.skippedNoTs, 1);
});

test("listSessionFiles ignores stray files at the project level", (t) => {
  const { base } = setup(t);
  const root = join(base, "projects");
  mkdirSync(join(root, "-p"), { recursive: true });
  writeFileSync(join(root, "stray.txt"), "x");
  writeFileSync(join(root, "-p", "a.jsonl"), "");
  assert.deepEqual(listSessionFiles([root]), [join(root, "-p", "a.jsonl")]);
});

test("scanTranscript finds the last timestamp across unparseable noise", () => {
  const { ts, events } = scanTranscript(
    Buffer.from('{"timestamp":"2026-01-01T00:00:00Z"}\ngarbage\n{"other":1}\n'),
  );
  assert.equal(ts, "2026-01-01T00:00:00Z");
  assert.equal(events, 3);
});

test("comm-log capture: projection round-trips and dedupes", (t) => {
  const { base, store } = setup(t);
  const entries = [
    {
      ts: "2026-02-22T10:00:00Z",
      dir: "send",
      ch: "mail",
      msg_id: "m1",
      conversation_id: "c1",
      from: "acme/alpha",
      to: "acme/beta",
      subject: "hi",
      body: "first",
    },
    {
      ts: "2026-02-22T10:01:00Z",
      dir: "recv",
      ch: "chat",
      msg_id: "m2",
      session_id: "c2",
      from: "acme/beta",
      to: "acme/alpha",
      body: "pong",
      from_did: "did:key:zTest",
      signature: "sig",
      verification: "verified",
      some_future_field: {"nested": true},
    },
  ];
  const path = join(base, "acme-alpha.jsonl");
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  appendFileSync(path, '{"ts":"2026-'); // torn tail while client writes

  const r1 = captureCommLog(store, { owner: "mac", path });
  assert.equal(r1.appended, 2);
  assert.equal(r1.skipped, 0, "torn tail is not an error");
  const r2 = captureCommLog(store, { owner: "mac", path });
  assert.equal(r2.appended, 0, "re-capture is a no-op");

  const turns = store.readStream(r1.stream);
  assert.equal(turns[0].kind, "mail");
  assert.equal(turns[0].thread, "aweb:conv:c1");
  assert.equal(turns[1].kind, "chat");
  assert.equal(turns[1].thread, "aweb:conv:c2");

  // Losslessness including unknown future fields.
  for (let i = 0; i < entries.length; i++) {
    assert.deepEqual(unprojectCommLogEntry(turns[i]), entries[i], `entry ${i}`);
  }
});

test("comm-log entries without to/body project and round-trip (real-log shape)", () => {
  // Both shapes occur in real ~/.config/aw/logs files.
  const noTo = {
    ts: "2026-05-19T13:47:31Z",
    dir: "recv",
    ch: "chat",
    from: "aweb.ai/iris",
    body: "inbound chat path green",
    from_stable_id: "did:aw:odxD9Eeedc1xmJWi7E1J94dv1W5",
  };
  const noBody = { ts: "2026-05-20T09:00:00Z", dir: "send", ch: "mail", to: "acme/beta" };
  for (const entry of [noTo, noBody]) {
    const turn = projectCommLogEntry(entry, { selfName: "acme-alpha" });
    assert.deepEqual(unprojectCommLogEntry(turn), entry);
  }
});

test("float-valued fields are captured as strings and restored on round-trip", () => {
  const entry = {
    ts: "2026-02-22T10:00:00Z",
    dir: "send",
    ch: "chat",
    to: "acme/beta",
    body: "hold on",
    wait_seconds: 2.5,
    metrics: { latency_ms: 12.75, hops: [1, 2.5], "a/b~c": 0.5 },
  };
  const turn = projectCommLogEntry(entry, { selfName: "acme-alpha" });
  // The canonical core holds no floats...
  assert.equal(turn.provenance.origin.wait_seconds, "2.5");
  assert.equal(turn.provenance.origin.metrics.hops[1], "2.5");
  assert.equal(turn.provenance.origin.metrics.hops[0], 1, "integers stay numbers");
  // ...and unprojection restores them exactly.
  assert.deepEqual(unprojectCommLogEntry(turn), entry);
});

test("source fields named like projection markers survive round-trip", () => {
  // Markers live under the reserved "~" origin key, so a real field named
  // log/account/float_paths cannot collide with bookkeeping.
  const entry = {
    ts: "2026-02-22T10:00:00Z",
    dir: "send",
    ch: "mail",
    to: "acme/beta",
    body: "tricky",
    log: "customer-log-field",
    account: "customer-account-field",
    float_paths: "customer-float-field",
  };
  const turn = projectCommLogEntry(entry, { selfName: "acme-alpha" });
  assert.deepEqual(unprojectCommLogEntry(turn), entry);
});

test("comm-log projection is deterministic across machines", () => {
  const entry = {
    ts: "2026-02-22T10:00:00Z",
    dir: "send",
    ch: "mail",
    to: "acme/beta",
    body: "no from, no ids",
  };
  const a = projectCommLogEntry(entry, { selfName: "acme-alpha" });
  const b = projectCommLogEntry(entry, { selfName: "acme-alpha" });
  assert.equal(a.id, b.id);
  assert.equal(a.from, "acme-alpha", "sender defaults to the account");
  assert.equal(a.thread, undefined, "no conversation, no thread");
  assert.deepEqual(unprojectCommLogEntry(a), entry, "from_omitted round-trips");
});

test("interaction-log capture projects mail_out/mail_in kinds", (t) => {
  const { base, store } = setup(t);
  const path = join(base, "interaction-log.jsonl");
  writeFileSync(
    path,
    JSON.stringify({
      ts: "2026-04-18T12:31:04Z",
      kind: "mail_out",
      message_id: "m1",
      to: "kate",
      subject: "handoff",
      text: "the epic",
    }) + "\n",
  );
  const r = captureInteractionLog(store, {
    owner: "mac",
    path,
    selfName: "jack",
    workspace: "awebai",
  });
  assert.equal(r.appended, 1);
  const [turn] = store.readStream(r.stream);
  assert.equal(turn.kind, "mail");
  assert.equal(turn.from, "jack");
  assert.equal(turn.to, "kate");
  assert.equal(turn.provenance.origin["~"].dir, "send");
  assert.equal(turn.provenance.origin.message_id, "m1");
});
