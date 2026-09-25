import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { requireRemoteSupport } from "../packages/desktop/cli-locator.mjs";
import { harnessFlag } from "../packages/desktop/renderer/harness-names.mjs";

const source = readFileSync(new URL("../packages/desktop/server/oats-web.mjs", import.meta.url), "utf8");
const block = source.match(/\/\* OATSWEB_START_BEGIN[^]*?\*\/([^]*?)\/\* OATSWEB_START_END \*\//)?.[1];
assert.ok(block);
const invoke = new Function("inst", "cliState", "readBody", "harvestHome", "adapter", "locator", "dirname", "harnessFlag",
  `return (async () => { const hm = [null, "start"], req = {}, res = {}, ctxs = ["/local"];
   const send = (_, status, body) => ({ status, body });
   const refreshSnapshot = () => {}, refreshRemoteSnapshot = () => {};
   ${block} })();`);

test("start route passes only resolved home/model to CLI, with containment and feature gates", async () => {
  let call;
  const instance = { instance: "agent", home: "/trusted/agents/soul/instances/agent", agentsRoot: "/trusted/agents" };
  const cli = { ok: true, features: ["session-start", "session-restart", "launch-config"], bin: "/installed/oats" };
  const body = async () => ({ home: "/other/home", model: "opus", command: "ignored", server: "ignored" });
  const adapter = { cliStart: async (bin, args) => { call = { bin, args }; return { ok: true, result: { launched: true } }; } };
  const run = (i = instance, c = cli, contained = () => instance.home) => invoke(i, c, body, contained, adapter, { requireRemoteSupport }, dirname, harnessFlag);
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
  assert.equal((await run({ ...instance, server: "host", savedRoute: true }, { ...cli, remote: ["session-start"] })).status, 200);
  assert.equal(call.args.server, "host");
  assert.equal(call.args.workspaceDir, "/local");
  // A launch choice needs the launch-config feature; an old CLI is refused before the adapter is called.
  call = null;
  const choose = async () => ({ model: "opus", launchConfig: "personal" });
  assert.equal((await invoke(instance, { ...cli, features: ["session-start"] }, choose, () => instance.home, adapter, { requireRemoteSupport }, dirname, harnessFlag)).status, 409);
  assert.equal(call, null);
  assert.equal((await invoke(instance, cli, choose, () => instance.home, adapter, { requireRemoteSupport }, dirname, harnessFlag)).status, 200);
  assert.equal(call.args.launchConfig, "personal");
  // A harness choice travels in the kernel's own flag (feature harness: --harness; a released kernel: --runtime).
  const harness = async () => ({ harness: "claude" });
  for (const [features, flag] of [[cli.features, "--runtime"], [[...cli.features, "harness"], "--harness"]]) {
    await invoke(instance, { ...cli, features }, harness, () => instance.home, adapter, { requireRemoteSupport }, dirname, harnessFlag);
    assert.deepEqual([call.args.harness, call.args.harnessFlag], ["claude", flag]);
  }
});
