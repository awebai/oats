import test from "node:test";
import assert from "node:assert/strict";
import { doSpawn } from "../renderer/views/spawn.mjs";
import { currentWorkspace, setWorkspace } from "../renderer/views/common.mjs";
import { refreshCli } from "../renderer/views/cli-status.mjs";

for (const switched of [false, true]) test(`remote spawn handoff ${switched ? "respects a later workspace switch" : "opens the saved instance in its server workspace"}`, async () => {
  await refreshCli({ api: async () => ({ ok: true, version: "0.22.3", bin: "/oats", remote: ["roster"] }) });
  const previous = currentWorkspace(); setWorkspace("local");
  const ref = { instance: "dev-one", home: "/remote/home", server: "host" };
  const opens = []; let submitted;
  const s = { alive: true, spawnOp: 0, selAgent: { name: "dev", agentsRoot: "/local/agents" },
    waitOpts: { tries: 1, delayMs: 0, sleep: async () => {} },
    ctx: {
      api: async (path, opts) => {
        if (path === "/api/spawn") { submitted = JSON.parse(opts.body); return { ...ref, workspaceId: "remote:host-key", launched: true }; }
        assert.equal(path, "/api/panel?ws=remote%3Ahost-key");
        if (switched) setWorkspace("another");
        return { instances: [{ ...ref, savedRoute: true, running: true }] };
      },
      openTerminal: (instance) => opens.push(instance),
    },
  };
  const ui = { btn: {}, status: { classList: { add() {}, remove() {} } }, task: () => "task", purpose: () => "one", server: () => "host", clear() {} };
  try {
    await doSpawn(s, ui);
    assert.equal(submitted.serverId, "host");
    assert.deepEqual(opens, switched ? [] : [ref]);
    assert.equal(currentWorkspace(), switched ? "another" : "remote:host-key");
  } finally { setWorkspace(previous); }
});
