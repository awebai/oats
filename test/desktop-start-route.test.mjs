import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { requireRemoteSupport } from "../packages/client/cli-locator.mjs";
import { harnessFlag } from "../packages/client/harness-names.mjs";
import { canAddressRemote, unaddressableSentence } from "../packages/client/remote-address.mjs";
import { retainedSpawnDetails } from "../packages/client/launch-prompt-outcome.mjs";
import { startInstance } from "../packages/client/session-start.mjs";
import { DETAIL_WITHHELD } from "../packages/client/display-text.mjs";
import { DESKTOP_TERMS } from "../packages/desktop/renderer/desktop-terms.mjs";

const source = readFileSync(new URL("../packages/desktop/server/oats-web.mjs", import.meta.url), "utf8");
const block = source.match(/\/\* OATSWEB_START_BEGIN[^]*?\*\/([^]*?)\/\* OATSWEB_START_END \*\//)?.[1];
assert.ok(block);
/** The route's slice as a function of `params`, with the start rule it decides through (session-start.mjs) and the
 * Desktop's terms, as the server imports them. */
const routeFunction = (params, body) => new Function("startInstance", "DESKTOP_TERMS", `return function (${params.join(", ")}) { ${body} };`)(startInstance, DESKTOP_TERMS);
const invoke = routeFunction(["inst", "cliState", "readBody", "verifiedLocalHome", "adapter", "locator", "dirname", "harnessFlag", "canAddressRemote", "unaddressableSentence"], `return (async () => { const hm = [null, "start"], req = {}, res = {}, ctxs = ["/local"];
   const send = (_, status, body) => ({ status, body });
   const observeMutation = () => {}, refreshRemoteSnapshot = () => {}, url = { searchParams: new URLSearchParams("ws=/local") }, deployments = () => [], held = () => null;
   ${block} })();`);

test("start route passes only resolved home/model to CLI, with containment and feature gates", async () => {
  let call;
  const instance = { instance: "agent", home: "/trusted/agents/soul/instances/agent", agentsRoot: "/trusted/agents", running: false };
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
const invokeRetained = routeFunction(["inst", "cliState", "readBody", "verifiedLocalHome", "adapter", "locator", "dirname", "harnessFlag", "canAddressRemote", "unaddressableSentence", "retainedSpawnDetails", "action"], `return (async () => { const hm = [null, action], req = {}, res = {}, ctxs = ["/local"];
   const send = (_, status, body) => ({ status, body });
   const observeMutation = () => {}, refreshRemoteSnapshot = () => {}, url = { searchParams: new URLSearchParams("ws=/local") }, deployments = () => [], held = () => null;
   ${block} })();`);
const kept = { instance: "agent", home: "/trusted/agents/soul/instances/agent", agentsRoot: "/trusted/agents", running: false };
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

// A start whose wait ended (packages/client/cli-adapter.mjs cliStart answers E_START_UNCONFIRMED, the code alone):
// the route answers it in the Desktop's own words, never as a message of the kernel's.
const invokeUnconfirmed = routeFunction(["inst", "cliState", "readBody", "verifiedLocalHome", "adapter", "locator", "dirname", "harnessFlag", "canAddressRemote", "unaddressableSentence", "retainedSpawnDetails", "START_UNCONFIRMED"], `return (async () => { const hm = [null, "restart"], req = {}, res = {}, ctxs = ["/local"];
   const send = (_, status, body) => ({ status, body });
   const observeMutation = () => {}, refreshRemoteSnapshot = () => {}, url = { searchParams: new URLSearchParams("ws=/local") }, deployments = () => [], held = () => null;
   ${block} })();`);

test("start route: a start whose wait ended answers the Desktop's sentence for E_START_UNCONFIRMED", async () => {
  const { START_UNCONFIRMED } = await import("../packages/desktop/renderer/start-unconfirmed.mjs");
  const inst = { instance: "agent", home: "/trusted/agents/soul/instances/agent", agentsRoot: "/trusted/agents", running: false };
  const cli = { ok: true, features: ["session-start", "session-restart"], bin: "/installed/oats" };
  const reply = await invokeUnconfirmed(inst, cli, async () => ({}), () => inst.home, { cliStart: async () => ({ schemaVersion: 1, ok: false, error: { code: "E_START_UNCONFIRMED" } }) },
    { requireRemoteSupport }, dirname, harnessFlag, canAddressRemote, unaddressableSentence, retainedSpawnDetails, START_UNCONFIRMED);
  assert.deepEqual(reply, { status: 409, body: { error: "OATS didn't confirm the start. It may still be running: check the roster before you start it again.", code: "E_START_UNCONFIRMED" } });
});

// 5a-2: the kernel's two codes for a start that started nothing are answered as the kernel words them, through the
// display filter. The messages are the kernel's own (lib/core.mjs startInstanceSession); the rule's sentences for
// them (session-start.mjs) are for a client that words by code, not for this route.
test("start route: E_SESSION_START_BUSY and E_SESSION_RUNNING answer the kernel's message, unchanged", async () => {
  const home = "/trusted/agents/soul/instances/agent";
  for (const error of [
    { code: "E_SESSION_START_BUSY", message: `another start of agent is in progress (${home}/.oats-start.lock); if no start is running, remove that directory and retry` },
    { code: "E_SESSION_START_BUSY", message: "agent is still starting; refresh its status before retrying" },
    { code: "E_SESSION_RUNNING", message: "agent is already running; nothing was started; the requested model, launch configuration, harness or yolo was not applied: use session restart" },
    { code: "E_SESSION_RUNNING", message: "tmux window agents:agent appeared on /tmp/fixture.sock during the start; nothing was started" },
  ]) for (const action of ["start", "restart"]) assert.deepEqual(await refused(error)(kept, action), { status: 409, body: { error: error.message, code: error.code } }, `${action} ${error.message}`);
  // A message the display filter withholds is withheld here too: the route answers the filter's line.
  const odd = await refused({ code: "E_SESSION_RUNNING", message: "agent\u001b[2J is running" })();
  assert.deepEqual(odd.body, { error: DETAIL_WITHHELD, code: "E_SESSION_RUNNING" });
});

// #1666: a start refused for another lifecycle command carries the rule's sentence for the dialog, beside the
// kernel's message; a kernel without lifecycle-claim-start answers as before. A server's row reads by its host's
// list, from the roster group of the deployment the request names.
const invokeGrouped = routeFunction(["inst", "cliState", "readBody", "verifiedLocalHome", "adapter", "locator", "dirname", "harnessFlag", "canAddressRemote", "unaddressableSentence", "retainedSpawnDetails", "deployments", "action"], `return (async () => { const hm = [null, action], req = {}, res = {}, ctxs = ["/local"];
   const send = (_, status, body) => ({ status, body });
   const observeMutation = () => {}, refreshRemoteSnapshot = () => {}, url = { searchParams: new URLSearchParams("ws=/local") }, held = () => null;
   ${block} })();`);
test("start route: a start refused at the home's lifecycle claim carries the rule's sentence where the answering kernel holds the claim", async () => {
  const error = { code: "E_LIFECYCLE_BUSY", message: "a stop of agent is already running", details: { holder: "running", action: "stop" } };
  const features = ["session-start", "session-restart", "server-probe-features"];
  const route = (inst, cli, listed = [], action = "start") => invokeGrouped(inst, cli, async () => ({}), () => inst.home, { cliStart: async () => ({ schemaVersion: 1, ok: false, error }) },
    { requireRemoteSupport }, dirname, harnessFlag, canAddressRemote, unaddressableSentence, retainedSpawnDetails, () => listed, action);
  const local = { ok: true, bin: "/installed/oats", features: [...features, "lifecycle-claim-stop", "lifecycle-claim-start"] };
  assert.deepEqual(await route(kept, local), { status: 409, body: { error: error.message, code: error.code, startedNothing: "Another OATS command is running on this instance. Nothing was started. Wait for it to finish, then try again." } });
  assert.equal((await route({ ...kept, running: true }, local, [], "restart")).body.startedNothing, "Another OATS command is running on this instance. Nothing was stopped or started. Wait for it to finish, then try again.");
  assert.deepEqual(await route(kept, { ...local, features }), { status: 409, body: { error: error.message, code: error.code } }, "a kernel without the feature");
  // A server's row: the host's list, through the group of the deployment `ws` names, never another's.
  const onHost = { ...kept, server: "host", addressable: true }, remote = { ...local, features, remote: ["session-start"] };
  const group = (list) => ({ probe: { ok: true, features: list } });
  assert.equal((await route(onHost, remote, [{ id: "/local", group: group(["lifecycle-claim-stop", "lifecycle-claim-start"]) }])).body.startedNothing, "Another OATS command is running on this instance. Nothing was started. Wait for it to finish, then try again.");
  assert.equal((await route(onHost, remote, [{ id: "/elsewhere", group: group(["lifecycle-claim-stop", "lifecycle-claim-start"]) }])).body.startedNothing, undefined);
});

// 5a-2: the route decides through the start rule's gate as the dialog does, so its first three rules hold here too:
// a row the roster holds as running is not started again, and a row whose state is not known stopped is not
// started at all. Nothing is called, and the answer is the rule's sentence (never the row's runtime error).
test("start route: a running row, or one whose state is not known, is refused before the CLI is called; a restart of a running row goes on", async () => {
  let called = 0;
  const cli = { ok: true, features: ["session-start", "session-restart", "launch-config"], remote: ["session-start", "session-restart", "launch-config"], bin: "/installed/oats" };
  const start = (inst, action = "start", body = {}) => invokeRetained(inst, cli, async () => body, () => inst.home,
    { cliStart: async () => { called += 1; return { ok: true, result: { launched: true } }; } }, { requireRemoteSupport }, dirname, harnessFlag, canAddressRemote, unaddressableSentence, retainedSpawnDetails, action);
  assert.deepEqual(await start({ ...kept, running: true }), { status: 409, body: { error: "This instance is already running.", code: "already-running" } });
  const unknown = { status: 409, body: { error: "Could not verify whether this instance is running. Refresh its status before starting.", code: "state-unknown" } };
  for (const row of [{ ...kept, running: null }, { ...kept, running: undefined }, { ...kept, running: null, runtimeError: "tmux: no server on the socket" }])
    for (const action of ["start", "restart"]) assert.deepEqual(await start(row, action), unknown, `${action} ${JSON.stringify(row.running)}`);
  assert.equal(called, 0);
  assert.equal((await start({ ...kept, running: true }, "restart")).status, 200);
  assert.equal(called, 1);
  // The rule's words for an old CLI (rules 5-7), on a server's row as on this computer's.
  const old = (features, remote) => invokeRetained({ ...kept, server: "host", addressable: true }, { ...cli, features, remote }, async () => ({ launchConfig: "none" }), () => kept.home,
    { cliStart: async () => { called += 1; return { ok: true, result: {} }; } }, { requireRemoteSupport }, dirname, harnessFlag, canAddressRemote, unaddressableSentence, retainedSpawnDetails, "start");
  assert.deepEqual((await old(cli.features, [])).body, { error: "Update the OATS CLI to enable starting instances on a server.", code: "unsupported-remote-operation" });
  assert.deepEqual((await old(cli.features, ["session-start"])).body, { error: "Update OATS to change the launch configuration.", code: "unsupported-start-option" });
  assert.equal(called, 1);
});
