import test from "node:test";
import assert from "node:assert/strict";
import { verifyPiDispatchRef } from "../lib/captured-pi-host.mjs";

// Association-only unit regression. No SDK/service/model/backend/record effects;
// production still performs the mandatory started-v2/root/input/target checks.
test("PH1: original live Pi attempt survives same-ID retry/adoption only with its exact pending association", () => {
  const incarnationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const intent = { schemaVersion: 1, incarnationId, executionId: "original-execution", attempt: 1 };
  const nativeRecordId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const target = { backend: "tmux", socket: "/owned/socket", session: "owned", window: "worker" };
  const pending = { id: intent.executionId, capturedIntent: { ...intent }, nativeRecordId,
    runtime: "pi", model: "provider/model", target, launch: { retained: "unchanged" } };
  const admitted = { executionId: intent.executionId, capability: null, action: { kind: "session", name: "start" },
    attempt: 1, state: "running", inputIntegrity: { format: "oats.json.v1", value: `sha256-${"a".repeat(64)}` },
    receipt: { id: intent.executionId, target: { ...target }, nativeRecordId, unconfirmed: true } };
  const row = { incarnationId, intents: [admitted] };
  const original = JSON.stringify({ intent, pending });
  assert.equal(verifyPiDispatchRef(row, intent, pending, pending.model), admitted);
  admitted.state = "unconfirmed";
  assert.equal(verifyPiDispatchRef(row, intent, pending, pending.model), admitted);

  // The existing admission function increments the SAME execution's attempt,
  // briefly sets admitted, then begin/adoption completes without redispatch.
  admitted.attempt++;
  for (const state of ["admitted", "running", "completed"]) {
    admitted.state = state;
    assert.equal(verifyPiDispatchRef(row, intent, pending, pending.model), admitted, state);
  }
  admitted.receipt = { target: { ...target }, nativeRecordId, reused: "adopted" };
  assert.equal(verifyPiDispatchRef(row, intent, pending, pending.model), admitted);
  assert.equal(JSON.stringify({ intent, pending }), original, "never rewrite the original process/pending ref or mint another identity");

  const base = { row, intent, pending, model: pending.model };
  const mutations = [
    f => { f.intent.attempt = 3; f.pending.capturedIntent.attempt = 3; }, // newer than index
    f => { f.intent.attempt = 2; }, // process cannot borrow reconciliation ref
    f => { f.pending.capturedIntent.attempt = 2; },
    f => { f.pending.capturedIntent.executionId = "foreign"; },
    f => { f.pending.capturedIntent.incarnationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; },
    f => { f.pending.id = "foreign"; },
    f => { f.row.incarnationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; },
    f => { f.row.intents[0].executionId = "foreign"; },
    f => { f.row.intents[0].attempt = 0; },
    f => { f.row.intents[0].capability = "foreign.owner"; },
    f => { f.row.intents[0].action.kind = "hook"; },
    f => { f.row.intents[0].action.name = "retire"; },
    f => { f.row.intents[0].state = "blocked"; },
    f => { f.row.intents[0].attempt = 1; f.row.intents[0].state = "admitted"; }, // never began original dispatch
    f => { f.pending.nativeRecordId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; },
    f => { f.pending.nativeRecordId = "../not-an-id"; },
    f => { f.pending.target.socket = "/foreign/socket"; },
    f => { f.row.intents[0].receipt.target.window = "foreign"; },
    f => { f.row.intents[0].receipt.nativeRecordId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; },
    f => { f.row.intents[0].receipt.id = "foreign"; },
    f => { f.pending.runtime = "claude"; },
    f => { f.pending.model = "foreign/model"; },
  ];
  for (const [i, mutate] of mutations.entries()) {
    const f = structuredClone(base); mutate(f);
    assert.throws(() => verifyPiDispatchRef(f.row, f.intent, f.pending, f.model), { code: "E_PI_HOST_CUSTODY" }, `refusal ${i}`);
  }
});
