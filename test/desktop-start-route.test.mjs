import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { requireRemoteSupport } from "../packages/client/cli-locator.mjs";
import { harnessFlag } from "../packages/client/harness-names.mjs";
import { canAddressRemote, unaddressableSentence } from "../packages/client/remote-address.mjs";
import { retainedSpawnDetails } from "../packages/client/launch-prompt-outcome.mjs";

const source = readFileSync(new URL("../packages/desktop/server/oats-web.mjs", import.meta.url), "utf8");
const block = source.match(/\/\* OATSWEB_START_BEGIN[^]*?\*\/([^]*?)\/\* OATSWEB_START_END \*\//)?.[1];
assert.ok(block);
const invoke = new Function("inst", "cliState", "readBody", "verifiedLocalHome", "adapter", "locator", "dirname", "harnessFlag", "canAddressRemote", "unaddressableSentence",
  `return (async () => { const hm = [null, "start"], req = {}, res = {}, ctxs = ["/local"];
   const send = (_, status, body) => ({ status, body });
   const observeMutation = () => {}, refreshRemoteSnapshot = () => {}, url = { searchParams: new URLSearchParams("ws=/local") };
   ${block} })();`);

test("start route passes only resolved home/model to CLI, with containment and feature gates", async () => {
  let call;
  const instance = { instance: "agent", home: "/trusted/agents/soul/instances/agent", agentsRoot: "/trusted/agents" };
  const cli = { ok: true, features: ["session-start", "session-restart", "launch-config"], bin: "/installed/oats" };
  const body = async () => ({ home: "/other/home", model: "opus", command: "ignored", server: "ignored" });
  const adapter = { cliStart: async (bin, args) => { call = { bin, args }; return { ok: true, result: { launched: true } }; } };
  const run = (i = instance, c = cli, contained = () => instance.home) => invoke(i, c, body, contained, adapter, { requireRemoteSupport }, dirname, harnessFlag, canAddressRemote, unaddressableSentence);
  assert.equal((await run()).status, 200);
  // The route passes the launch choices it received (none here) and whether this is a restart; nothing from the body's home/command/server.
  assert.deepEqual(call.args, { home: instance.home, model: "opus", launchConfig: undefined, harness: undefined, harnessFlag: "--runtime", yolo: undefined, restart: false, workspaceDir: "/trusted", server: undefined });
  call = null;
  assert.equal((await run(instance, { ...cli, features: [] })).status, 409);
  assert.equal(call, null);
  assert.equal((await run(instance, cli, () => null)).status, 409);
  assert.equal(call, null);
  assert.equal((await run({ ...instance, server: "host", savedRoute: false })).status, 409);
  assert.equal(call, null);
  assert.equal((await run({ ...instance, server: "host", savedRoute: true }, { ...cli, remote: ["session-start"] })).status, 200,
    "a saved-route row from a local OATS before 0.31 (no addressable fact) starts as before");
  assert.equal(call.args.server, "host");
  // 0.31: the kernel's addressable fact decides, saved route or not.
  call = null;
  assert.equal((await run({ ...instance, server: "host", savedRoute: false, addressable: true }, { ...cli, remote: ["session-start"] })).status, 200, "a foreign row starts");
  assert.equal(call.args.server, "host");
  assert.equal(call.args.workspaceDir, "/local");
  call = null;
  assert.equal((await run({ ...instance, server: "host", savedRoute: true, addressable: false }, { ...cli, remote: ["session-start"] })).status, 409);
  assert.equal(call, null);
  // A launch choice needs the launch-config feature; an old CLI is refused before the adapter is called.
  call = null;
  const choose = async () => ({ model: "opus", launchConfig: "personal" });
  assert.equal((await invoke(instance, { ...cli, features: ["session-start"] }, choose, () => instance.home, adapter, { requireRemoteSupport }, dirname, harnessFlag, canAddressRemote, unaddressableSentence)).status, 409);
  assert.equal(call, null);
  assert.equal((await invoke(instance, cli, choose, () => instance.home, adapter, { requireRemoteSupport }, dirname, harnessFlag, canAddressRemote, unaddressableSentence)).status, 200);
  assert.equal(call.args.launchConfig, "personal");
  // A harness choice travels in the kernel's own flag (feature harness: --harness; a released kernel: --runtime).
  const harness = async () => ({ harness: "claude" });
  for (const [features, flag] of [[cli.features, "--runtime"], [[...cli.features, "harness"], "--harness"]]) {
    await invoke(instance, { ...cli, features }, harness, () => instance.home, adapter, { requireRemoteSupport }, dirname, harnessFlag, canAddressRemote, unaddressableSentence);
    assert.deepEqual([call.args.harness, call.args.harnessFlag], ["claude", flag]);
  }
});

// OATS 0.52.0 (awebai/oats#917): a start that stops at a launch prompt answers E_SPAWN_INCOMPLETE with the
// retained outcome in its details, as a spawn does. The details are hand-written from the documented shape at
// kernel head 881ecc1f (lib/core.mjs `retainedPromptError`, docs/desktop-cli-api.md "Launch prompt results").
const invokeRetained = new Function("inst", "cliState", "readBody", "verifiedLocalHome", "adapter", "locator", "dirname", "harnessFlag", "canAddressRemote", "unaddressableSentence", "retainedSpawnDetails", "action",
  `return (async () => { const hm = [null, action], req = {}, res = {}, ctxs = ["/local"];
   const send = (_, status, body) => ({ status, body });
   const observeMutation = () => {}, refreshRemoteSnapshot = () => {}, url = { searchParams: new URLSearchParams("ws=/local") };
   ${block} })();`);
const kept = { instance: "agent", home: "/trusted/agents/soul/instances/agent", agentsRoot: "/trusted/agents" };
const differed = { nearest: "aweb-dev-channel-confirmation-1", firstDifference: { index: 0, expected: "WARNING: Loading development channels --", found: "Do you trust the files in this folder?" } };
const details = (extra = {}) => ({ retained: true, unconfirmed: true, instance: kept.instance, home: kept.home, launched: "unknown",
  target: { backend: "tmux", socket: "/tmp/fixture.sock", session: "agents", window: "agent", windowId: "@2", paneId: "%2", pid: 1234 }, parentLineageCommitted: false,
  launchPrompts: { status: "blocked", answers: [], reason: "blocked: unexpected prompt", receipt: [{ ok: true, results: [{ path: "/trusted/agents/soul/instances/agent/.oats-events.jsonl", ok: true }] }], differed }, ...extra });
const message = `blocked: unexpected prompt; home and pane retained: inspect ${kept.home}, then use oats session start --home '${kept.home}'.`;
const refused = (error) => (inst = kept, action = "start") => invokeRetained(inst, { ok: true, features: ["session-start", "session-restart"], remote: ["session-start", "session-restart"], bin: "/installed/oats" },
  async () => ({}), () => kept.home, { cliStart: async () => ({ schemaVersion: 1, ok: false, error }) }, { requireRemoteSupport }, dirname, harnessFlag, canAddressRemote, unaddressableSentence, retainedSpawnDetails, action);

test("start route: E_SPAWN_INCOMPLETE with a retained outcome adds `incomplete`, decoded; error and code stay", async () => {
  for (const action of ["start", "restart"]) {
    const out = await refused({ code: "E_SPAWN_INCOMPLETE", message, details: details() })(kept, action);
    assert.equal(out.status, 409);
    assert.deepEqual(Object.keys(out.body), ["error", "code", "incomplete"]);
    assert.equal(out.body.error, message); assert.equal(out.body.code, "E_SPAWN_INCOMPLETE");
    assert.deepEqual(out.body.incomplete, retainedSpawnDetails(details()));
    // Decoded: the flat difference, each side a display line; nothing the reader does not list.
    assert.deepEqual(out.body.incomplete.launchPrompts.differed, { nearest: differed.nearest, index: 0, expected: differed.firstDifference.expected, found: differed.firstDifference.found });
    assert.equal(Object.hasOwn(out.body.incomplete, "retained"), false);
  }
});
test("start route: a routed host's relayed outcome is read the same", async () => {
  const host = { ...kept, server: "host", addressable: true };
  const out = await refused({ code: "E_SPAWN_INCOMPLETE", message, details: details() })(host);
  assert.equal(out.status, 409); assert.deepEqual(out.body.incomplete, retainedSpawnDetails(details()));
});
test("start route: every other failure, and an outcome that does not decode, answers as before", async () => {
  const plain = (error) => ({ status: error.code === "E_BAD_ARGS" ? 400 : 409, body: { error: error.message, code: error.code } });
  for (const error of [
    { code: "E_SPAWN_INCOMPLETE", message },                                                    // no details
    { code: "E_SPAWN_INCOMPLETE", message, details: null },
    { code: "E_SPAWN_INCOMPLETE", message, details: "retained" },
    { code: "E_SPAWN_INCOMPLETE", message, details: details({ home: "relative/home" }) },      // malformed details
    { code: "E_SPAWN_INCOMPLETE", message, details: details({ launched: true }) },
    { code: "E_SPAWN_INCOMPLETE", message, details: { instance: kept.instance, home: kept.home, launched: "unknown" } }, // no launchPrompts
    { code: "E_SPAWN_INCOMPLETE", message, details: details({ instance: "another-agent" }) },   // not the instance this route resolved
    { code: "E_HARNESS_UNAVAILABLE", message: "claude is not installed", details: details() },   // another code never carries it
    { code: "E_BAD_ARGS", message: "bad", details: details() },
    { code: "E_CLI_TIMEOUT", message: "oats did not answer within 60s" },
  ]) assert.deepEqual(await refused(error)(), plain(error), JSON.stringify(error).slice(0, 90));
  // A malformed outcome inside decodable details is still a retained home: inspection-only, never dropped.
  const odd = await refused({ code: "E_SPAWN_INCOMPLETE", message, details: details({ launchPrompts: { status: "completed" } }) })();
  assert.deepEqual(odd.body.incomplete.launchPrompts, { status: "unknown", answers: [], reason: "Launch requires inspection", receipt: [] });
});
