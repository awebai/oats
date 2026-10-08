import test from "node:test";
import assert from "node:assert/strict";
import { instanceId, terminalKey, findRosterInstance, resolveLinkId, clusterInstances } from "../renderer/instance-tree.mjs";
import { instanceApiPath } from "../renderer/views/common.mjs";

const local = { instance: "dev-one", home: "/work/agents/dev/instances/dev-one", agentsRoot: "/work/agents" };
const first = { ...local, server: "first" };
const second = { ...local, server: "second" };
const roster = [local, first, second];

test("identical paths on different servers retain distinct rows and terminals", () => {
  assert.equal(new Set(roster.map(instanceId)).size, 3);
  assert.equal(new Set(roster.map((i) => terminalKey("team", i))).size, 3);
  assert.equal(clusterInstances(roster).flatMap((c) => c.instances).length, 3);
  for (const ref of roster) assert.equal(findRosterInstance(roster, { ...ref }), ref);
  assert.equal(findRosterInstance(roster, local.instance), null);
  assert.equal(findRosterInstance([first], local), null, "local path must not resolve remotely");
  assert.equal(findRosterInstance(roster, { ...first, server: "missing" }), null);
});

test("relations never connect agents on different servers", () => {
  const from = { instance: "child", server: "first", agentsRoot: local.agentsRoot };
  assert.equal(resolveLinkId(from, local.instance, new Map([[local.instance, roster]])), instanceId(first));
  assert.equal(resolveLinkId(from, local.instance, new Map([[local.instance, [second]]])), null);
});

test("remote instance API references preserve the server and canonical home", () => {
  const url = new URL(instanceApiPath("start", first), "http://localhost");
  assert.equal(url.searchParams.get("server"), "first");
  assert.equal(url.searchParams.get("home"), first.home);
  assert.equal(new URL(instanceApiPath("start", local), url).searchParams.has("server"), false);
});

test("the same absolute home on two servers stays two instances for every routed read, plan and terminal", async () => {
  const { admitInstance } = await import("../server/instance-admission.mjs");
  const { lifecycleArgv } = await import("../lifecycle-cli.mjs");
  const { cliReadiness } = await import("../readiness-cli.mjs");
  const { cliInstanceEvents } = await import("../instance-events-cli.mjs");
  const { cliInstanceGit } = await import("../cli-adapter.mjs");
  const { remoteTargetKey } = await import("../remote-target.mjs");
  const home = "/work/agents/dev/instances/dev-one", cwd = "/Users/me/work";
  const cli = { ok: true, bin: "/installed/oats", eventsApi: 2, features: ["instance-events-2"],
    remote: ["readiness", "instance-events", "instance-git", "lifecycle-plans"] };
  const argvs = { one: [], two: [] };
  for (const server of ["one", "two"]) {
    const workspace = { id: `remote:${server}:1`, name: server, scope: "/work", remote: true, server };
    const rows = ["one", "two"].map(s => ({ instance: "dev-one", agent: "dev", agentsRoot: "/work/agents", home, server: s, addressable: true }));
    const selector = { instance: "dev-one", agent: "dev", agentsRoot: "/work/agents", server };
    for (const operation of ["readiness", "instance-events", "instance-git", "lifecycle-plans"]) {
      const admitted = admitInstance(selector, { workspace, instances: rows.filter(r => r.server === server), cli, operation, localCwd: cwd });
      assert.equal(admitted.target.server, server); assert.equal(admitted.remote.server, server);
    }
    // Across servers: never admitted from the other server's panel.
    assert.equal(admitInstance(selector, { workspace, instances: rows.filter(r => r.server !== server), cli, operation: "readiness", localCwd: cwd }).code, "E_SESSION_UNKNOWN");
    const exec = (_bin, argv, _opts, done) => { argvs[server].push(argv); done(null, "{}"); };
    await cliReadiness(cli.bin, { target: { workspace: workspace.id, context: "/work", observedAs: "instance", home,
      selector: { kind: "instance", ...selector } }, route: { server, cwd } }, { exec, env: {} });
    await cliInstanceEvents(cli, { target: { workspace: workspace.id, context: "/work", selector, home, incarnation: null }, route: { server, cwd } }, { exec, env: {} });
    await cliInstanceGit(cli.bin, { action: "git", instance: "dev-one", home, context: cwd, server }, { exec });
    argvs[server].push(lifecycleArgv({ operation: "stop", phase: "plan", instance: "dev-one", home, context: cwd, server, choices: { recursive: true } }));
  }
  for (const server of ["one", "two"]) {
    assert.equal(argvs[server].length, 4);
    for (const argv of argvs[server]) {
      assert.equal(argv[argv.indexOf("--server") + 1], server); assert.equal(argv[argv.indexOf("--home") + 1], home);
      assert.equal(argv.includes("--instance"), false); assert.equal(argv.includes("--dir"), false);
    }
  }
  assert.notEqual(remoteTargetKey({ serverId: "one", instance: "dev-one", home }), remoteTargetKey({ serverId: "two", instance: "dev-one", home }));
});
