import test from "node:test";
import assert from "node:assert/strict";
import { prepareRemoteTerm, remoteTargetKey, createTerminalPrepareGate, remoteTerminalEnvironment } from "../remote-target.mjs";
const cli = { bin: "/selected/oats", version: "0.22.2", remote: ["session"] };
const remote = { serverId: "build", instance: "dev-task", target: { oatsPath: "/untrusted" } };
test("remote viewer uses host-selected CLI and saved-route address only", async () => {
  const got = await prepareRemoteTerm(cli, remote, { run: async (bin, args) => {
    assert.equal(bin, "/selected/oats");
    assert.deepEqual(args, ["session", "inspect", "--server", "build", "--instance", "dev-task", "--json"]);
    return { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { present: true } }) };
  } });
  assert.deepEqual(got, { binary: "/selected/oats", args: ["session", "attach", "--server", "build", "--instance", "dev-task"] });
  assert.throws(() => remoteTargetKey({ serverId: "--host", instance: "x" }));
});
test("remote viewer refuses stale and failed preflight", async () => {
  for (const doc of [{ schemaVersion: 1, ok: true, result: { present: false } }, { schemaVersion: 1, ok: false, error: { message: "unreachable" } }]) {
    await assert.rejects(prepareRemoteTerm(cli, remote, { run: async () => ({ stdout: JSON.stringify(doc) }) }));
  }
});
test("remote viewer carries the selected home through preflight, attach and deduplication", async () => {
  const selected = { ...remote, home: "/remote/selected home" };
  const address = ["--server", "build", "--instance", "dev-task", "--home", selected.home];
  const got = await prepareRemoteTerm(cli, selected, { run: async (bin, args) => {
    assert.deepEqual(args, ["session", "inspect", ...address, "--json"]);
    return { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { present: true } }) };
  } });
  assert.deepEqual(got.args, ["session", "attach", ...address]);
  assert.notEqual(remoteTargetKey(selected), remoteTargetKey({ ...selected, home: "/remote/another home" }));
  assert.throws(() => remoteTargetKey({ ...selected, home: "relative" }), /invalid remote terminal home/);
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

test("remote viewer rejects old CLI before SSH and clears local nesting only", async () => {
  await assert.rejects(prepareRemoteTerm({ bin: "/old/oats", version: "0.22.1" }, remote, { run: () => assert.fail("must not launch old CLI") }), /does not support remote session; update the CLI/);
  const source = { PATH: "/bin", SSH_AUTH_SOCK: "/agent", TMUX: "/local,1,2", HERDR_SESSION: "local", HERDR_SOCKET_PATH: "/local" };
  assert.deepEqual(remoteTerminalEnvironment(source), { PATH: "/bin", SSH_AUTH_SOCK: "/agent" });
  assert.equal(source.TMUX, "/local,1,2");
});
