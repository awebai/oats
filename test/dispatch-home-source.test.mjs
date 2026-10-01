// Capability dispatch inside an instance home says which home it is, and what chose it: OATS_INSTANCE_HOME,
// OATS_HOME or the working directory (a PI_AGENT_HOME in the environment pins nothing). A `--soul` that names
// another soul than the home's is refused (E_HOME_MISMATCH), never silently ignored; the home's own soul, by
// any name a spawn accepts for it, is fine. A namespace the home does not have names the home.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const probeCap = {
  manifest: { command: "probe", commands: { go: "bin/go.mjs" } },
  files: { "bin/go.mjs": "console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { ran: true } }));\n" },
};

test("dispatch from an env- or cwd-chosen home: a disagreeing --soul is refused; a missing namespace names the home and what chose it", async (t) => {
  const fx = v2Deployment({
    souls: { withprobe: { soul: { capabilities: { "test.probe": { from: "here" } } } }, plain: {} },
    capabilities: { "test.probe": probeCap },
  });
  t.after(fx.cleanup);
  const { home } = await fx.spawn("plain", { instance: "plain-1" });
  const run = (args, env = {}, cwd = fx.dep) => { const r = fx.cli([...args, "--json"], { cwd, env }); return { status: r.status, doc: r.json(), stderr: r.stderr }; };

  for (const [name, env, cwd] of [
    ["OATS_INSTANCE_HOME", { OATS_INSTANCE_HOME: home }, fx.dep],
    ["OATS_HOME", { OATS_HOME: home }, fx.dep],
    ["the working directory", {}, home],
  ]) {
    // --soul for another soul: refused, naming the home, the soul it records and what chose it.
    let r = run(["probe", "go", "--soul", "withprobe"], env, cwd);
    assert.equal(r.status, 1, name);
    assert.equal(r.doc.error.code, "E_HOME_MISMATCH", `${name}: ${JSON.stringify(r.doc)}`);
    assert.equal(r.doc.error.message, `--soul withprobe is not the soul of the instance home ${home} (plain), which ${name} chose; to run "probe" as a spawn of withprobe would, run it outside the instance home with OATS_INSTANCE_HOME and OATS_HOME unset`);
    assert.deepEqual([r.doc.error.details.home, r.doc.error.details.soul, r.doc.error.details.chosenBy, r.doc.error.details.flag], [home, "plain", name, "--soul"]);
    // A bare --soul is a usage error, as it is outside a home.
    r = run(["probe", "go", "--soul"], env, cwd);
    assert.equal(r.doc.error.code, "E_BAD_ARGS", `${name}: ${JSON.stringify(r.doc)}`); assert.equal(r.doc.error.details.flag, "--soul");
    // Another member's soul of the same name is still another soul.
    r = run(["probe", "go", "--soul", "elsewhere/plain"], env, cwd);
    assert.equal(r.doc.error.code, "E_HOME_MISMATCH", `${name}: ${JSON.stringify(r.doc)}`);
    // No --soul, or the home's own soul by its bare or qualified name (as a spawn names it): the namespace
    // is not in this home, and the error says whose home it is.
    for (const soulArgs of [[], ["--soul", "plain"], ["--soul", "ws/plain"], ["--soul", `${fx.key}/plain`]]) {
      r = run(["probe", "go", ...soulArgs], env, cwd);
      assert.equal(r.status, 1, name);
      assert.equal(r.doc.error.code, "E_UNKNOWN_COMMAND", `${name}: ${JSON.stringify(r.doc)}`);
      assert.equal(r.doc.error.message, `oats probe: no capability of the instance home ${home} (soul plain), which ${name} chose, provides "probe"`);
      assert.deepEqual([r.doc.error.details.home, r.doc.error.details.chosenBy, r.doc.error.details.namespace], [home, name, "probe"]);
    }
  }
  // Outside any home, --soul resolves as a spawn would, the qualified form included; a PI_AGENT_HOME pins nothing.
  for (const [soul, env] of [["withprobe", {}], ["withprobe", { PI_AGENT_HOME: home }], ["ws/withprobe", {}]]) {
    const r = run(["probe", "go", "--soul", soul], env);
    assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
    assert.deepEqual(r.doc.result, { ran: true });
  }
  // inspect --home applies the same rule to its --soul.
  for (const soul of ["plain", "ws/plain"]) assert.equal(fx.cli(["inspect", "--home", home, "--soul", soul, "--json"]).json().ok, true, soul);
  const other = fx.cli(["inspect", "--home", home, "--soul", "withprobe", "--json"]).json();
  assert.equal(other.error.code, "E_HOME_MISMATCH");
});

test("homeSoulMatches: the home's soul by any name a spawn accepts, or its agent directory; never another soul", async () => {
  const { homeSoulMatches } = await import("../lib/instance-resolution.mjs");
  const member = { agent: "dev", workspace: { soul: { id: "x", repoKey: "github.com/acme/agents", commit: "c" } } };
  for (const name of ["dev", "agents/dev", "acme/agents/dev", "github.com/acme/agents/dev"]) assert.equal(homeSoulMatches(name, member), true, name);
  for (const name of ["other", "tools/dev", "github.com/acme/tools/dev", "acme.pkg/dev"]) assert.equal(homeSoulMatches(name, member), false, name);
  const pkg = { agent: "acme-pkg--keeper", workspace: { soul: { id: "y", repoKey: "pkg", commit: "c", name: "keeper", qualifiedName: "acme.pkg/keeper", package: { id: "acme.pkg" } } } };
  for (const name of ["keeper", "acme.pkg/keeper", "acme-pkg--keeper"]) assert.equal(homeSoulMatches(name, pkg), true, name);
  for (const name of ["other.pkg/keeper", "agents/keeper", "dev"]) assert.equal(homeSoulMatches(name, pkg), false, name);
});
