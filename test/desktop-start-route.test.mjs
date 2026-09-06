import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { requireRemoteSupport } from "../packages/desktop/cli-locator.mjs";

const source = readFileSync(new URL("../packages/desktop/server/oats-web.mjs", import.meta.url), "utf8");
const block = source.match(/\/\* OATSWEB_START_BEGIN[^]*?\*\/([^]*?)\/\* OATSWEB_START_END \*\//)?.[1];
assert.ok(block);
const invoke = new Function("inst", "cliState", "readBody", "harvestHome", "adapter", "locator", "dirname",
  `return (async () => { const hm = [null, "start"], req = {}, res = {}, ctxs = ["/local"];
   const send = (_, status, body) => ({ status, body });
   const refreshSnapshot = () => {}, refreshRemoteSnapshot = () => {};
   ${block} })();`);

test("start route passes only resolved home/model to CLI, with containment and feature gates", async () => {
  let call;
  const instance = { instance: "agent", home: "/trusted/agents/soul/instances/agent", agentsRoot: "/trusted/agents" };
  const cli = { ok: true, features: ["session-start"], bin: "/installed/oats" };
  const body = async () => ({ home: "/other/home", model: "opus", command: "ignored", server: "ignored" });
  const adapter = { cliStart: async (bin, args) => { call = { bin, args }; return { ok: true, result: { launched: true } }; } };
  const run = (i = instance, c = cli, contained = () => instance.home) => invoke(i, c, body, contained, adapter, { requireRemoteSupport }, dirname);
  assert.equal((await run()).status, 200);
  assert.deepEqual(call.args, { home: instance.home, model: "opus", workspaceDir: "/trusted", server: undefined });
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
});
