import test from "node:test";
import assert from "node:assert/strict";
import { prepareRemoteTerm, remoteTargetKey, createTerminalPrepareGate } from "../remote-target.mjs";
const remote = { serverId: "build", instance: "dev-task", target: { oatsPath: "/untrusted" } };
test("remote viewer uses host-selected CLI and saved-route address only", async () => {
  const got = await prepareRemoteTerm("/selected/oats", remote, { run: async (bin, args) => {
    assert.equal(bin, "/selected/oats");
    assert.deepEqual(args, ["session", "inspect", "--server", "build", "--instance", "dev-task", "--json"]);
    return { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { present: true } }) };
  } });
  assert.deepEqual(got, { binary: "/selected/oats", args: ["session", "attach", "--server", "build", "--instance", "dev-task"] });
  assert.throws(() => remoteTargetKey({ serverId: "--host", instance: "x" }));
});
test("remote viewer refuses stale and failed preflight", async () => {
  for (const doc of [{ schemaVersion: 1, ok: true, result: { present: false } }, { schemaVersion: 1, ok: false, error: { message: "unreachable" } }]) {
    await assert.rejects(prepareRemoteTerm("/selected/oats", remote, { run: async () => ({ stdout: JSON.stringify(doc) }) }));
  }
});
test("pending preflights deduplicate and share the active terminal resource cap", async () => {
  let finish, count = 0;
  const gate = createTerminalPrepareGate({ activeCount: () => 1 }, 2);
  const load = () => { count++; return new Promise(r => finish = r); };
  const a = gate.prepare("same", load), b = gate.prepare("same", load);
  await Promise.resolve();
  assert.equal(count, 1);
  assert.equal((await gate.prepare("other", load)).capped, true);
  finish({ binary: "oats" });
  assert.deepEqual(await a, await b);
  assert.equal(gate.pendingCount(), 0);
});
