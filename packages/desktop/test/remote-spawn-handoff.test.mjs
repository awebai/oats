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
  let status = "";
  const fields = { server: "host", task: "task", purpose: "one", status: text => { status = text; } };
  try {
    const result = await doSpawn(s, fields);
    assert.deepEqual(result, { created: true });
    assert.equal(submitted.serverId, "host");
    assert.deepEqual(opens, outcome === "visible" ? [ref] : []);
    if (outcome === "missing") assert.match(notices[0], /runtime is not visible/);
    else assert.deepEqual(notices, []);
    assert.equal(currentWorkspace(), switched ? "another" : outcome === "routeConflict" ? "local" : "remote:host-key");
    if (outcome === "routeConflict") assert.match(status, /already has a saved route.*\/remote\/home/);
  } finally { setWorkspace(previous); }
});

test("an execution-server spawn whose wake schedule was not saved still reports created (the dialog then refuses a second spawn)", async () => {
  await refreshCli({ api: async () => ({ ok: true, version: "0.25.7", bin: "/oats", remote: ["spawn", "schedule"] }) });
  const previous = currentWorkspace(); setWorkspace("local");
  let calls = 0, status = "", error = false, problem = null;
  const wake = { cron: "*/15 * * * *", tz: "UTC", message: "Check pending work", enabled: true };
  const s = { alive: true, spawnOp: 0, selAgent: { name: "dev", agentsRoot: "/local/agents" }, ctx: {
    api: async (path, opts) => {
      assert.equal(path, "/api/spawn"); calls++;
      const body = JSON.parse(opts.body); assert.deepEqual(body.wake, wake); assert.equal(body.serverId, "host");
      return { instance: "dev-one", home: "/remote/home", launched: true, wakeScheduleError: { code: "E_DISK", message: "Disk full" } };
    }, openTerminal: () => assert.fail("partial failure needs acknowledgement"),
  } };
  try {
    const outcome = await doSpawn(s, { server: "host", task: "task", purpose: "one", wake, status: (text, err, p) => { status = text; error = !!err; problem = p; } });
    assert.deepEqual(outcome, { created: true }); assert.equal(calls, 1); assert.equal(error, true);
    assert.match(status, /^Created dev-one, but its wake schedule was not saved\. Add it from Schedules\.$/);
    assert.equal(problem.detail, "E_DISK · Disk full", "the host's reason waits behind Details");
    assert.equal(await doSpawn(s, { task: "x", status: () => {} }), undefined, "no server: doSpawn never spawns locally");
    assert.equal(calls, 1);
  } finally { setWorkspace(previous); }
});
