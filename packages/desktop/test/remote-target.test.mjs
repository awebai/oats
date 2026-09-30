import test from "node:test";
import assert from "node:assert/strict";
import { prepareRemoteTerm, remoteTargetKey, createTerminalPrepareGate, remoteTerminalEnvironment } from "../remote-target.mjs";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { HERDR_REMOVED } from "../renderer/terminal-contract.mjs";
import { runTerminalCommand } from "../terminal-exec.mjs";

/** The real runner over an exec double that exits `code` after printing `stdout`, as the CLI does for a JSON refusal. */
const exiting = (code, stdout, calls = []) => (bin, args, opts) => runTerminalCommand(bin, args, opts, (_bin, argv, _opts, callback) => {
  calls.push(argv); const child = new EventEmitter();
  setImmediate(() => { callback(code ? Object.assign(new Error("Command failed"), { code }) : null, stdout, ""); child.emit("close", code); });
  return child;
});
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
test("remote viewer refuses a Herdr session with E_HERDR_REMOVED: an older kernel's live Herdr inspection and a 0.31 refusal", async () => {
  const kernelMessage = `E_HERDR_REMOVED: ${HERDR_REMOVED} Retire it (\`oats retire dev-task\`) and spawn a new instance; it opens in tmux.`;
  for (const [doc, message] of [
    [{ schemaVersion: 1, ok: true, result: { backend: "herdr", present: true, state: "shell", terminalId: "term_abc" } }, HERDR_REMOVED],
    [{ schemaVersion: 1, ok: false, error: { code: "E_HERDR_REMOVED", message: kernelMessage } }, kernelMessage],
  ]) {
    await assert.rejects(prepareRemoteTerm(cli, remote, { run: async () => ({ stdout: JSON.stringify(doc) }) }),
      error => error.code === "E_HERDR_REMOVED" && error.message === message);
  }
  const tmux = await prepareRemoteTerm(cli, remote, { run: async () => ({ stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { backend: "tmux", present: true } }) }) });
  assert.equal(tmux.args[1], "attach", "a remote tmux session still attaches");
});
test("a 0.31 kernel's E_HERDR_REMOVED refusal exits 1 and is still refused as E_HERDR_REMOVED; any other failure never attaches", async () => {
  const message = `E_HERDR_REMOVED: ${HERDR_REMOVED} Retire it (\`oats retire dev-task\`) and spawn a new instance; it opens in tmux.`;
  const calls = [];
  await assert.rejects(prepareRemoteTerm(cli, remote, { run: exiting(1, JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_HERDR_REMOVED", message } }), calls) }),
    error => error.code === "E_HERDR_REMOVED" && error.message === message);
  for (const [stdout, code] of [[JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_SSH", message: "unreachable" } }), "E_TERM_REMOTE_UNREACHABLE"],
    ["not json", "E_TERM_REMOTE_NO_ANSWER"], ["", "E_TERM_REMOTE_NO_ANSWER"]]) {
    await assert.rejects(prepareRemoteTerm(cli, remote, { run: exiting(1, stdout, calls) }), error => error.code === code, stdout);
  }
  assert.ok(calls.every(argv => argv[1] === "inspect"), "only inspection ran; nothing attached");
});
const captured = name => readFileSync(new URL(`./fixtures/remote-inspect/${name}.json`, import.meta.url), "utf8");
test("prepare failures carry codes from real captures: unreachable is transport, no envelope is no answer, not present is gone, a host refusal keeps its code", async () => {
  const calls = [];
  for (const [run, code] of [
    [exiting(1, captured("unreachable"), calls), "E_TERM_REMOTE_UNREACHABLE"],
    [exiting(255, "", calls), "E_TERM_REMOTE_NO_ANSWER"],
    [exiting(1, "", calls), "E_TERM_REMOTE_NO_ANSWER"],
    [exiting(0, captured("not-present"), calls), "E_TERM_REMOTE_GONE"],
    [exiting(1, captured("unknown-server"), calls), "E_SERVER_UNKNOWN"],
  ]) await assert.rejects(prepareRemoteTerm(cli, remote, { run }), error => error.code === code, code);
  assert.ok(calls.every(argv => argv[1] === "inspect"), "only inspection ran; nothing attached");
});
test("an inspection killed at its deadline is a timeout (a stalled link); a CLI that never started keeps its own error", async () => {
  const killed = async () => { throw Object.assign(new Error("Command failed"), { code: null, killed: true, signal: "SIGTERM", stdout: "" }); };
  await assert.rejects(prepareRemoteTerm(cli, remote, { run: killed }), error => error.code === "E_TERM_PREPARE_TIMEOUT");
  const missing = async () => { throw Object.assign(new Error("spawn /selected/oats ENOENT"), { code: "ENOENT" }); };
  await assert.rejects(prepareRemoteTerm(cli, remote, { run: missing }), error => error.code === "ENOENT");
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
