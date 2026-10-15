import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalPrepareGate, remoteTerminalEnvironment } from "../remote-target.mjs";
import { prepareRemoteTerm, remoteTargetKey, preflightFailure } from "../../client/session-attach.mjs";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { HERDR_REMOVED, terminalFailure, terminalMessage } from "../../client/terminal-contract.mjs";
import { runTerminalCommand } from "../../client/terminal-exec.mjs";

/** The real runner over an exec double that exits `code` after printing `stdout`, as the CLI does for a JSON refusal. */
const exiting = (code, stdout, calls = []) => (bin, args, opts) => runTerminalCommand(bin, args, opts, (_bin, argv, _opts, callback) => {
  calls.push(argv); const child = new EventEmitter();
  setImmediate(() => { callback(code ? Object.assign(new Error("Command failed"), { code }) : null, stdout, ""); child.emit("close", code); });
  return child;
});
const cli = { bin: "/selected/oats", version: "0.22.2", remote: ["session"] };
const home = "/srv/agents/dev/instances/dev-task";
const remote = { serverId: "build", instance: "dev-task", home, target: { oatsPath: "/untrusted" } };
test("remote viewer uses the host-selected CLI and addresses the instance by server and home only, never a bare name", async () => {
  const got = await prepareRemoteTerm(cli, remote, { run: async (bin, args) => {
    assert.equal(bin, "/selected/oats");
    assert.deepEqual(args, ["session", "inspect", "--server", "build", "--home", home, "--json"]);
    return { stdout: JSON.stringify({ schemaVersion: 1, ok: true, result: { present: true } }) };
  } });
  assert.deepEqual(got, { binary: "/selected/oats", args: ["session", "attach", "--server", "build", "--home", home] });
  assert.throws(() => remoteTargetKey({ serverId: "--host", instance: "x", home }));
});
test("a remote terminal target without an absolute home is refused at admission, before any process", async () => {
  for (const bad of [{ serverId: "build", instance: "dev-task" }, { serverId: "build", instance: "dev-task", home: "relative/dev-task" },
    { serverId: "build", instance: "dev-task", home: "" }, { serverId: "build", instance: "dev-task", home: "/a\0b" }]) {
    assert.throws(() => remoteTargetKey(bad), /invalid remote terminal/);
    await assert.rejects(prepareRemoteTerm(cli, bad, { run: assert.fail }), /invalid remote terminal/);
  }
});
test("the dedup key is the server and the home: same-named instances differ by home, the same home on two servers never merges", () => {
  assert.equal(remoteTargetKey(remote), JSON.stringify(["remote", "build", home]));
  assert.notEqual(remoteTargetKey(remote), remoteTargetKey({ ...remote, home: "/srv/agents/qa/instances/dev-task" }));
  assert.notEqual(remoteTargetKey(remote), remoteTargetKey({ ...remote, serverId: "other" }));
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
test("prepare failures carry codes from real captures: unreachable is transport, ssh that never started is no ssh, no envelope is no answer, not present is gone, a host refusal keeps its code", async () => {
  const calls = [];
  for (const [run, code] of [
    [exiting(1, captured("unreachable"), calls), "E_TERM_REMOTE_UNREACHABLE"],
    [exiting(255, "", calls), "E_TERM_REMOTE_NO_ANSWER"],
    [exiting(1, "", calls), "E_TERM_REMOTE_NO_ANSWER"],
    [exiting(0, captured("not-present"), calls), "E_TERM_REMOTE_GONE"],
    [exiting(1, captured("unknown-server"), calls), "E_SERVER_UNKNOWN"],
    [exiting(1, captured("no-ssh"), calls), "E_TERM_REMOTE_NO_SSH"],
  ]) await assert.rejects(prepareRemoteTerm(cli, remote, { run }), error => error.code === code, code);
  assert.ok(calls.every(argv => argv[1] === "inspect"), "only inspection ran; nothing attached");
});
test("an inspection killed at its deadline is a timeout (a stalled link); one that died by a signal gave no answer; a CLI that never started keeps its own error", async () => {
  const killed = async () => { throw Object.assign(new Error("Command failed"), { code: null, killed: true, signal: "SIGTERM", stdout: "" }); };
  await assert.rejects(prepareRemoteTerm(cli, remote, { run: killed }), error => error.code === "E_TERM_PREPARE_TIMEOUT");
  for (const signal of ["SIGABRT", "SIGSEGV"]) {
    const crashed = async () => { throw Object.assign(new Error("Command failed"), { code: null, killed: false, signal, stdout: "" }); };
    await assert.rejects(prepareRemoteTerm(cli, remote, { run: crashed }), error => error.code === "E_TERM_REMOTE_NO_ANSWER", `a local CLI that died by ${signal} gave no answer`);
  }
  const missing = async () => { throw Object.assign(new Error("spawn /selected/oats ENOENT"), { code: "ENOENT" }); };
  await assert.rejects(prepareRemoteTerm(cli, remote, { run: missing }), error => error.code === "ENOENT");
});
test("remote viewer carries the selected home through preflight, attach and deduplication", async () => {
  const selected = { ...remote, home: "/remote/selected home" };
  const address = ["--server", "build", "--home", selected.home];
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

test("only an E_SSH whose details say ssh never started is no ssh; any other E_SSH stays a retried transport failure", async () => {
  const envelope = details => JSON.stringify({ schemaVersion: 1, ok: false, error: { code: "E_SSH", message: "ssh to build failed", ...(details === undefined ? {} : { details }) } });
  for (const [details, code] of [[{ sshStarted: false }, "E_TERM_REMOTE_NO_SSH"], [undefined, "E_TERM_REMOTE_UNREACHABLE"],
    [{ sshStarted: true }, "E_TERM_REMOTE_UNREACHABLE"], [{}, "E_TERM_REMOTE_UNREACHABLE"], [{ sshStarted: "false" }, "E_TERM_REMOTE_UNREACHABLE"]]) {
    await assert.rejects(prepareRemoteTerm(cli, remote, { run: exiting(1, envelope(details), []) }), error => error.code === code, JSON.stringify(details));
  }
});

/* ── preflightFailure: what a failed preflight says to a client that shows more than the Desktop's
 *    sentence. The Desktop does not call it; it reads the errors the tests above hold. ── */
const SERVER = "Build box", GENERAL = terminalFailure("E_TERM_OPEN_FAILED").message;
const thrownBy = (run, options = {}) => prepareRemoteTerm(cli, remote, { run, ...options }).then(() => assert.fail("the preflight must fail"), error => error);
const refusing = error => exiting(1, JSON.stringify({ schemaVersion: 1, ok: false, error }));

test("preflightFailure over the preflight's own outcomes: the table's code, its sentence naming the server where it has a place for one, and nothing of the kernel's", async () => {
  const killed = async () => { throw Object.assign(new Error("Command failed"), { code: null, killed: true, signal: "SIGTERM", stdout: "" }); };
  const kernelMessage = `E_HERDR_REMOVED: ${HERDR_REMOVED} Retire it (\`oats retire dev-task\`) and spawn a new instance; it opens in tmux.`;
  const outcomes = [
    [await thrownBy(exiting(1, captured("unreachable"))), "E_TERM_REMOTE_UNREACHABLE", true],
    [await thrownBy(exiting(1, captured("no-ssh"))), "E_TERM_REMOTE_NO_SSH", true],
    [await thrownBy(exiting(0, captured("not-present"))), "E_TERM_REMOTE_GONE", true],
    [await thrownBy(exiting(255, "")), "E_TERM_REMOTE_NO_ANSWER", true],
    [await thrownBy(killed), "E_TERM_PREPARE_TIMEOUT", false],
    [await thrownBy(refusing({ code: "E_HERDR_REMOVED", message: kernelMessage, details: { fix: "retire it" } })), "E_HERDR_REMOVED", false],
    [await thrownBy(assert.fail, { current: () => false }), "E_TERM_CONTEXT_CHANGED", false],
  ];
  for (const [error, code, named] of outcomes) {
    assert.equal(error.code, code);
    const failure = preflightFailure(error, SERVER);
    assert.deepEqual(failure, { code, sentence: terminalMessage(code, SERVER), said: null }, code);
    assert.equal(failure.sentence.includes(SERVER), named, `${code}: ${failure.sentence}`);
    if (!named) assert.equal(failure.sentence, terminalFailure(code).message, code);
    // With no label the sentence is the table's static one, the Desktop's as it is.
    assert.equal(preflightFailure(error).sentence, terminalFailure(code).message, code);
  }
});

test("preflightFailure over a host's refusal the table has no sentence for: the general sentence, and what the host said as it came", async () => {
  // A real capture: an id with no registration. The expected texts are read from the capture.
  const answered = JSON.parse(captured("unknown-server")).error;
  const error = await thrownBy(exiting(1, captured("unknown-server")));
  assert.equal(error.code, answered.code);
  assert.deepEqual(preflightFailure(error, SERVER), { code: "E_TERM_OPEN_FAILED", sentence: GENERAL, said: { code: answered.code, message: answered.message, fix: null } });
  assert.equal(GENERAL, terminalMessage(answered.code, SERVER), "the Desktop's sentence for it, unchanged");
  // The answer is the caller's own copy: changing it changes nothing a later read answers.
  preflightFailure(error, SERVER).said.message = "changed";
  assert.equal(preflightFailure(error, SERVER).said.message, answered.message);
  // Also for a refusal the CLI printed with exit 0, and one a caller's own runner returned.
  const printed = await thrownBy(async () => ({ stdout: captured("unknown-server") }));
  assert.deepEqual(preflightFailure(printed, SERVER).said, { code: answered.code, message: answered.message, fix: null });
});

test("preflightFailure's said holds the envelope's own strings, each null where it gave none, and is null when all three are", async () => {
  const CODE = "E_HOST_SAYS_NO", MESSAGE = "the host refused this", FIX = "ask its owner, then try again";
  for (const [answered, said] of [
    [{ code: CODE, message: MESSAGE, details: { fix: FIX } }, { code: CODE, message: MESSAGE, fix: FIX }],
    [{ code: CODE, message: MESSAGE, details: { feature: "something" } }, { code: CODE, message: MESSAGE, fix: null }],
    [{ code: CODE, message: MESSAGE, details: { fix: 7 } }, { code: CODE, message: MESSAGE, fix: null }],
    [{ code: CODE, message: MESSAGE, details: { fix: [FIX] } }, { code: CODE, message: MESSAGE, fix: null }],
    [{ code: CODE, message: MESSAGE, details: FIX }, { code: CODE, message: MESSAGE, fix: null }],
    [{ code: CODE, message: MESSAGE, details: null }, { code: CODE, message: MESSAGE, fix: null }],
    [{ code: CODE, message: 7 }, { code: CODE, message: null, fix: null }],
    [{ code: CODE, message: { text: MESSAGE } }, { code: CODE, message: null, fix: null }],
    [{ code: CODE }, { code: CODE, message: null, fix: null }],
    [{ message: MESSAGE }, { code: null, message: MESSAGE, fix: null }],
    [{ code: 7, message: MESSAGE }, { code: null, message: MESSAGE, fix: null }],
    [{ details: { fix: FIX } }, { code: null, message: null, fix: FIX }],
    [{ code: "E_TERM_OPEN_FAILED", message: MESSAGE }, { code: "E_TERM_OPEN_FAILED", message: MESSAGE, fix: null }],
    [{}, null], [{ details: {} }, null], [{ code: 7, message: null, details: { fix: false } }, null], [undefined, null],
  ]) {
    const error = await thrownBy(refusing(answered));
    assert.deepEqual(preflightFailure(error, SERVER), { code: "E_TERM_OPEN_FAILED", sentence: GENERAL, said }, JSON.stringify(answered));
  }
  // A refusal that gave no code and no message is still thrown as it always was.
  const bare = await thrownBy(refusing({}));
  assert.equal(bare.code, "E_TERM_OPEN_FAILED");
  assert.equal(bare.message, "remote session inspection failed");
});

test("preflightFailure keeps what the kernel said only where the table has no sentence of its own, and only for a refusal the preflight read", async () => {
  const MESSAGE = "the host refused this", FIX = "ask its owner";
  // A refusal kept as it came whose code the table knows: the table's sentence, and nothing beside it.
  for (const code of ["E_TERM_REMOTE_GONE", "E_TERM_BUSY", "E_TERM_CAP"]) {
    const error = await thrownBy(refusing({ code, message: MESSAGE, details: { fix: FIX } }));
    assert.equal(error.code, code);
    assert.equal(error.message, MESSAGE);
    assert.deepEqual(preflightFailure(error, SERVER), { code, sentence: terminalMessage(code, SERVER), said: null }, code);
  }
  // A CLI that did not start: Node's own code is a string and its message holds a path. Never shown.
  const missing = await thrownBy(async () => { throw Object.assign(new Error("spawn /selected/oats ENOENT"), { code: "ENOENT" }); });
  assert.equal(missing.code, "ENOENT");
  assert.deepEqual(preflightFailure(missing, SERVER), { code: "E_TERM_OPEN_FAILED", sentence: GENERAL, said: null });
  // An error made by hand with a real refusal's code and message is not one the preflight read.
  const real = await thrownBy(refusing({ code: "E_HOST_SAYS_NO", message: MESSAGE, details: { fix: FIX } }));
  assert.deepEqual(preflightFailure(real, SERVER).said, { code: "E_HOST_SAYS_NO", message: MESSAGE, fix: FIX });
  const forged = Object.assign(new Error(real.message), { code: real.code, details: { fix: FIX } });
  assert.deepEqual(preflightFailure(forged, SERVER), { code: "E_TERM_OPEN_FAILED", sentence: GENERAL, said: null });
  assert.deepEqual(preflightFailure({ ...real }, SERVER).said, null, "nor is a copy of one");
  // No envelope, an invalid target, a CLI without remote support, and what is no error at all.
  const others = [await thrownBy(async () => ({ stdout: "not json" })),
    await prepareRemoteTerm(cli, { serverId: "build", instance: "dev-task" }, { run: assert.fail }).catch(error => error),
    await prepareRemoteTerm({ bin: "/old/oats", version: "0.22.1" }, remote, { run: assert.fail }).catch(error => error),
    undefined, null, "E_TERM_REMOTE_GONE", 7, {}, { code: "E_HOST_SAYS_NO", message: MESSAGE }];
  for (const error of others) assert.deepEqual(preflightFailure(error, SERVER), { code: "E_TERM_OPEN_FAILED", sentence: GENERAL, said: null }, String(error));
});

test("a refusal is thrown with the properties it always had: what it said is kept under the module's own symbol, not enumerable", async () => {
  for (const answered of [{ code: "E_HOST_SAYS_NO", message: "the host refused this", details: { fix: "ask its owner" } }, JSON.parse(captured("unknown-server")).error, {}]) {
    const error = await thrownBy(refusing(answered));
    assert.deepEqual(Object.keys(error), ["code"]);
    assert.deepEqual(Reflect.ownKeys(error).filter(key => typeof key === "string").sort(), ["code", "message", "stack"]);
    // The kept refusal (session-attach.mjs, #1242): one symbol, not registered and not enumerable, so no name reaches it.
    const symbols = Object.getOwnPropertySymbols(error);
    assert.equal(symbols.length, 1);
    assert.equal(Symbol.keyFor(symbols[0]), undefined);
    assert.equal(Object.getOwnPropertyDescriptor(error, symbols[0]).enumerable, false);
    for (const key of ["said", "fix", "details", "kernel"]) assert.equal(key in error, false, key);
    assert.equal(Object.getPrototypeOf(error), Error.prototype);
  }
});
