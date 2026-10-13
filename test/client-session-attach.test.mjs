// Opening an agent's terminal with the kernel's own viewer, as a second client asks for it
// (packages/client/session-attach.mjs, attach-exit.mjs): the viewer's arguments for this machine and
// for another, the two halves of the detach-key gate, the preflight with a key and with a caller's
// own `exec`, and the word for an attach's exit status.
//
// It imports packages/client only, so it runs on a root-only checkout with nothing installed. What
// the Desktop calls, and what a failed preflight says over real captures, is held by
// packages/desktop/test/remote-target.test.mjs. That `left` is the kernel's own status is held by
// test/client-attach-exit-kernel.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { prepareRemoteTerm, sessionAttachArgv, detachKeySupported, hostDetachKeySupported, preflightFailure, remoteTargetKey, DETACH_KEY_FEATURE } from "../packages/client/session-attach.mjs";
import { attachExit } from "../packages/client/attach-exit.mjs";

const HOME = "/srv/agents/dev/instances/dev-task", KEY = "C-\\";
const HERE = { home: HOME }, THERE = { serverId: "build", instance: "dev-task", home: HOME };
/** A CLI as the locator answers it: accepted, routing sessions, with these features. */
const cliWith = (...features) => ({ ok: true, bin: "/selected/oats", version: "0.51.0", remote: ["session"], features });
const KEYED = cliWith(DETACH_KEY_FEATURE), RELAYS = cliWith(DETACH_KEY_FEATURE, "server-probe-features"), PLAIN = cliWith("session-start");
const PRESENT = JSON.stringify({ schemaVersion: 1, ok: true, result: { present: true } });
/** An `execFile` double: records what it was started with, then ends as the CLI does, `stdout` printed and exit `code`. */
const execDouble = (code, stdout, seen) => (bin, args, options, callback) => {
  seen.push({ bin, args, options }); const child = new EventEmitter();
  setImmediate(() => { callback(code ? Object.assign(new Error("Command failed"), { code }) : null, stdout, ""); child.emit("close", code); });
  return child;
};

test("the viewer's arguments: this machine and another, without a key and with one, a new array each call", () => {
  assert.deepEqual(sessionAttachArgv(PLAIN, HERE), ["session", "attach", "--home", HOME]);
  assert.deepEqual(sessionAttachArgv(PLAIN, THERE), ["session", "attach", "--server", "build", "--home", HOME]);
  assert.deepEqual(sessionAttachArgv(KEYED, HERE, { detachKey: KEY }), ["session", "attach", "--home", HOME, "--detach-key", KEY]);
  assert.deepEqual(sessionAttachArgv(KEYED, THERE, { detachKey: KEY }), ["session", "attach", "--server", "build", "--home", HOME, "--detach-key", KEY]);
  // `undefined` is no key; so is an options bag that is not given.
  assert.deepEqual(sessionAttachArgv(KEYED, HERE, { detachKey: undefined }), sessionAttachArgv(KEYED, HERE));
  assert.deepEqual(sessionAttachArgv(KEYED, HERE, {}), sessionAttachArgv(KEYED, HERE));
  // Without a key the CLI is not asked anything: the arguments need no probe.
  assert.deepEqual(sessionAttachArgv(undefined, HERE), ["session", "attach", "--home", HOME]);
  for (const [target, options] of [[HERE, undefined], [THERE, undefined], [HERE, { detachKey: KEY }], [THERE, { detachKey: KEY }]]) {
    const first = sessionAttachArgv(KEYED, target, options);
    first.push("--changed");
    assert.equal(sessionAttachArgv(KEYED, target, options).includes("--changed"), false, "a caller that appends changes nothing else");
  }
});

test("the viewer's arguments refuse a target they cannot name: a home on this machine by the remote home's rule, another machine as remoteTargetKey does", () => {
  for (const target of [{ home: "relative/dev-task" }, { home: "" }, { home: "/a\0b" }, {}, { home: 7 }, { home: null }, undefined, null]) {
    assert.throws(() => sessionAttachArgv(KEYED, target), (error) => error.message === "invalid session home" && error.code === undefined, JSON.stringify(target));
    assert.throws(() => sessionAttachArgv(KEYED, target, { detachKey: KEY }), /^Error: invalid session home$/, "also with a key");
  }
  // A target that names a server is another machine's, whatever the name is worth: it is never read as this machine's.
  for (const target of [{ serverId: "build", home: HOME }, { serverId: "-build", instance: "dev-task", home: HOME }, { serverId: "", instance: "dev-task", home: HOME },
    { serverId: null, instance: "dev-task", home: HOME }, { serverId: "build", instance: "dev-task", home: "relative" }, { serverId: "build", instance: "dev-task" }]) {
    let refusal;
    assert.throws(() => remoteTargetKey(target), (error) => { refusal = error.message; return true; });
    assert.match(refusal, /^invalid remote terminal (target|home)$/);
    assert.throws(() => sessionAttachArgv(KEYED, target), (error) => error.message === refusal, JSON.stringify(target));
  }
});

test("a detach key is a non-empty string, and is never sent to a CLI that does not take one", () => {
  for (const detachKey of ["", 7, null, false, ["C-\\"], {}]) {
    for (const target of [HERE, THERE]) assert.throws(() => sessionAttachArgv(KEYED, target, { detachKey }), TypeError, JSON.stringify(detachKey));
  }
  // The client holds no grammar of its own: any non-empty string goes to the kernel as it is.
  assert.deepEqual(sessionAttachArgv(KEYED, HERE, { detachKey: "not a key" }).slice(-2), ["--detach-key", "not a key"]);
  for (const cli of [PLAIN, undefined, {}, { ...KEYED, ok: false }, { ...KEYED, features: DETACH_KEY_FEATURE }]) {
    for (const target of [HERE, THERE]) {
      assert.throws(() => sessionAttachArgv(cli, target, { detachKey: KEY }), (error) => error.code === "unsupported-detach-key" && !(error instanceof TypeError), JSON.stringify(cli));
    }
  }
});

test("this machine's CLI takes the key: an accepted probe whose features is an array naming it", () => {
  assert.equal(DETACH_KEY_FEATURE, "session-attach-detach-key");
  assert.equal(detachKeySupported(KEYED), true);
  assert.equal(detachKeySupported(cliWith("session-start", DETACH_KEY_FEATURE, "retire-home")), true);
  for (const cli of [undefined, null, {}, PLAIN, cliWith(), { ...KEYED, features: DETACH_KEY_FEATURE }, { ...KEYED, features: null }, { ...KEYED, features: undefined },
    { ...KEYED, ok: false }, { ...KEYED, ok: undefined }, { ...KEYED, ok: 1 }, { ...KEYED, ok: "true" }, { features: [DETACH_KEY_FEATURE] }]) {
    assert.equal(detachKeySupported(cli), false, JSON.stringify(cli));
  }
});

test("the key for a row on another machine: this machine's CLI takes it and relays the hosts' lists, the group was read, and the host's own list names it", () => {
  const group = (probe) => ({ server: { id: "build" }, probe });
  const LISTS = group({ ok: true, features: ["session-start", DETACH_KEY_FEATURE] });
  const groups = [LISTS, group({ ok: false, features: [DETACH_KEY_FEATURE] }), group({ ok: true, features: null }), group({ ok: true }),
    group({ ok: true, features: DETACH_KEY_FEATURE }), group({ ok: true, features: [] }), group({ ok: true, features: ["session-start"] }),
    group({ ok: 1, features: [DETACH_KEY_FEATURE] }), group(undefined), group(null), undefined, null, {}];
  const clis = [RELAYS, KEYED, cliWith("server-probe-features"), PLAIN, { ...RELAYS, ok: false }, { ...RELAYS, features: `${DETACH_KEY_FEATURE} server-probe-features` }, undefined];
  // Only one combination is true.
  for (const cli of clis) for (const g of groups) assert.equal(hostDetachKeySupported(cli, g), cli === RELAYS && g === LISTS, JSON.stringify([cli, g]));
  // Every other condition true and `server-probe-features` missing: the group's list is not known to be the host's own.
  assert.equal(detachKeySupported(KEYED), true);
  assert.equal(hostDetachKeySupported(KEYED, LISTS), false);
  assert.equal(hostDetachKeySupported(RELAYS, LISTS), true);
});

test("the preflight with a key: the inspect never carries it, the viewer's arguments end with it, and they are not shared between calls", async () => {
  const inspected = [];
  const run = async (bin, args) => { inspected.push(args); return { stdout: PRESENT }; };
  const first = await prepareRemoteTerm(RELAYS, THERE, { run, detachKey: KEY });
  assert.deepEqual(first, { binary: "/selected/oats", args: ["session", "attach", "--server", "build", "--home", HOME, "--detach-key", KEY] });
  assert.deepEqual(inspected, [["session", "inspect", "--server", "build", "--home", HOME, "--json"]]);
  first.args.push("--changed");
  const second = await prepareRemoteTerm(RELAYS, THERE, { run, detachKey: KEY });
  assert.deepEqual(second.args, ["session", "attach", "--server", "build", "--home", HOME, "--detach-key", KEY]);
  // Without a key: the same inspect, and the viewer's arguments as they always were.
  assert.deepEqual(await prepareRemoteTerm(PLAIN, THERE, { run }), { binary: "/selected/oats", args: ["session", "attach", "--server", "build", "--home", HOME] });
  assert.deepEqual(inspected[2], inspected[0]);
});

test("a key that cannot be used starts no process: an unsupporting CLI, a key that is not a string", async () => {
  const run = () => assert.fail("no process may start");
  for (const cli of [PLAIN, { ...KEYED, features: DETACH_KEY_FEATURE }, { ...KEYED, ok: false }]) {
    await assert.rejects(prepareRemoteTerm(cli, THERE, { run, detachKey: KEY }), (error) => error.code === "unsupported-detach-key", JSON.stringify(cli));
  }
  for (const detachKey of ["", 7, null]) await assert.rejects(prepareRemoteTerm(KEYED, THERE, { run, detachKey }), TypeError, JSON.stringify(detachKey));
  // The checks that stood before it still come first: a CLI that routes no session, a target that names no machine.
  await assert.rejects(prepareRemoteTerm({ ...KEYED, remote: [] }, THERE, { run, detachKey: KEY }), (error) => error.code === "unsupported-remote-operation");
  await assert.rejects(prepareRemoteTerm(KEYED, HERE, { run, detachKey: KEY }), /^Error: invalid remote terminal target$/);
  // An unsupported key is said like any other failed preflight: the general sentence, and nothing of the kernel's.
  const error = await prepareRemoteTerm(PLAIN, THERE, { run, detachKey: KEY }).catch((thrown) => thrown);
  assert.deepEqual(preflightFailure(error, "Build box"), { code: "E_TERM_OPEN_FAILED", sentence: "Could not attach to the requested terminal.", said: null });
});

test("a caller's own exec, with no run: the inspect goes through it, and a refusal it prints is read from the rejection", async () => {
  const seen = [];
  const got = await prepareRemoteTerm(KEYED, THERE, { exec: execDouble(0, PRESENT, seen), detachKey: KEY });
  assert.deepEqual(got.args.slice(-2), ["--detach-key", KEY]);
  assert.deepEqual(seen, [{ bin: "/selected/oats", args: ["session", "inspect", "--server", "build", "--home", HOME, "--json"],
    options: { encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024, shell: false } }]);
  // The CLI prints its refusal and exits 1: the default runner keeps the output on the rejection, whatever started the child.
  const refusal = { code: "E_HOST_SAYS_NO", message: "the host refused this" };
  const error = await prepareRemoteTerm(KEYED, THERE, { exec: execDouble(1, JSON.stringify({ schemaVersion: 1, ok: false, error: refusal }), seen) }).catch((thrown) => thrown);
  assert.equal(error.code, refusal.code);
  assert.equal(error.message, refusal.message);
  assert.deepEqual(preflightFailure(error, "Build box").said, { ...refusal, fix: null });
  // A child that ended with no envelope gave no answer, as with the default exec.
  await assert.rejects(prepareRemoteTerm(KEYED, THERE, { exec: execDouble(1, "", seen) }), (thrown) => thrown.code === "E_TERM_REMOTE_NO_ANSWER");
  assert.equal(seen.length, 3);
  assert.ok(seen.every(({ args }) => args[1] === "inspect"), "only inspection ran");
  // The caller's signal reaches its exec with the other options.
  const { signal } = new AbortController();
  await prepareRemoteTerm(KEYED, THERE, { exec: execDouble(0, PRESENT, seen), signal });
  assert.equal(seen[3].options.signal, signal);
});

test("a caller that passes run owns the whole run: its exec is not used", async () => {
  let ran = 0;
  const got = await prepareRemoteTerm(KEYED, THERE, { run: async () => { ran += 1; return { stdout: PRESENT }; }, exec: () => assert.fail("exec must not be used beside run") });
  assert.equal(ran, 1);
  assert.deepEqual(got.args, ["session", "attach", "--server", "build", "--home", HOME]);
});

test("an attach's exit status as a word: the kernel's table, read once", () => {
  assert.equal(attachExit(20, { keyed: true }), "left");
  assert.equal(attachExit(20, { keyed: true, routed: true }), "left");
  assert.equal(attachExit(255, { routed: true }), "link");
  assert.equal(attachExit(255, { keyed: true, routed: true }), "link");
  // 0 and 1 say the same with a key and without, on this machine and through another.
  for (const options of [undefined, {}, { keyed: true }, { routed: true }, { keyed: true, routed: true }, { keyed: false, routed: false }]) {
    assert.equal(attachExit(0, options), "ended", JSON.stringify(options));
    assert.equal(attachExit(1, options), "failed", JSON.stringify(options));
  }
  // 20 is the key's only for an attach that was given one, and 255 is ssh's only for a routed one: `true`, not truthy.
  for (const keyed of [undefined, false, 1, "true", null]) {
    assert.equal(attachExit(20, { keyed }), "unknown", `keyed ${String(keyed)}`);
    assert.equal(attachExit(20, { keyed, routed: true }), "unknown", `keyed ${String(keyed)}, routed`);
  }
  for (const routed of [undefined, false, 1, "true", null]) {
    assert.equal(attachExit(255, { routed }), "unknown", `routed ${String(routed)}`);
    assert.equal(attachExit(255, { routed, keyed: true }), "unknown", `routed ${String(routed)}, keyed`);
  }
  assert.equal(attachExit(20), "unknown");
  assert.equal(attachExit(255), "unknown");
  // Any other number, a child ended by a signal (null), and any value that is not a number.
  for (const status of [null, undefined, "20", "0", "1", "255", NaN, 131, -1, 2, 19, 21, 254, 256, 20.5, true, false, {}, [20]]) {
    for (const options of [undefined, { keyed: true, routed: true }]) assert.equal(attachExit(status, options), "unknown", `${String(status)} ${JSON.stringify(options)}`);
  }
  // Every answer is one of the five words.
  for (const status of [0, 1, 20, 255, 7, null]) assert.ok(["left", "ended", "failed", "link", "unknown"].includes(attachExit(status, { keyed: true, routed: true })));
});
