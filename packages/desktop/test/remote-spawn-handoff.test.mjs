import test from "node:test";
import assert from "node:assert/strict";
import { doSpawn } from "../renderer/views/spawn.mjs";
import { currentWorkspace, setWorkspace } from "../renderer/views/common.mjs";
import { refreshCli } from "../renderer/views/cli-status.mjs";

for (const outcome of ["visible", "switched", "missing", "routeConflict"]) test(`remote spawn handoff: ${outcome}`, async () => {
  const switched = outcome === "switched";
  await refreshCli({ api: async () => ({ ok: true, version: "0.22.3", bin: "/oats", remote: ["roster"] }) });
  const previous = currentWorkspace(); setWorkspace("local");
  const ref = { instance: "dev-one", home: "/remote/home", server: "host" };
  const opens = [], notices = []; let submitted;
  const s = { alive: true, spawnOp: 0, selAgent: { name: "dev", agentsRoot: "/local/agents" },
    waitOpts: { tries: 1, delayMs: 0, sleep: async () => {} },
    ctx: {
      api: async (path, opts) => {
        if (path === "/api/spawn") { submitted = JSON.parse(opts.body); return { ...ref, workspaceId: "remote:host-key", launched: true, ...(outcome === "routeConflict" ? { routeConflict: { existingHome: "/other/home" } } : {}) }; }
        assert.equal(path, "/api/panel?ws=remote%3Ahost-key");
        if (switched) setWorkspace("another");
        return { instances: outcome === "missing" ? [] : [{ ...ref, savedRoute: true, running: true }] };
      },
      openTerminal: (instance) => opens.push(instance),
      notify: (message) => notices.push(message),
    },
  };
  const ui = { btn: {}, status: { classList: { add() {}, remove() {} } }, task: () => "task", purpose: () => "one", server: () => "host", clear() {} };
  try {
    await doSpawn(s, ui);
    assert.equal(submitted.serverId, "host");
    assert.deepEqual(opens, outcome === "visible" ? [ref] : []);
    if (outcome === "missing") assert.match(notices[0], /runtime is not visible/);
    else assert.deepEqual(notices, []);
    assert.equal(currentWorkspace(), switched ? "another" : outcome === "routeConflict" ? "local" : "remote:host-key");
    if (outcome === "routeConflict") assert.match(ui.status.textContent, /already has a saved route.*\/remote\/home/);
  } finally { setWorkspace(previous); }
});
