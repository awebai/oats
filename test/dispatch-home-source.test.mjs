// Capability dispatch inside an instance home says which home it is, and what chose it: OATS_INSTANCE_HOME,
// OATS_HOME or the working directory (PI_AGENT_HOME is no longer an identity name, and pins nothing). A `--soul` that disagrees with that home
// is refused (E_HOME_MISMATCH), never silently ignored; a namespace the home does not have names the home.
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
    // No --soul (or the home's own): the namespace is not in this home, and the error says whose home it is.
    for (const soulArgs of [[], ["--soul", "plain"]]) {
      r = run(["probe", "go", ...soulArgs], env, cwd);
      assert.equal(r.status, 1, name);
      assert.equal(r.doc.error.code, "E_UNKNOWN_COMMAND", `${name}: ${JSON.stringify(r.doc)}`);
      assert.equal(r.doc.error.message, `oats probe: no capability of the instance home ${home} (soul plain), which ${name} chose, provides "probe"`);
      assert.deepEqual([r.doc.error.details.home, r.doc.error.details.chosenBy, r.doc.error.details.namespace], [home, name, "probe"]);
    }
  }
  // Outside any home, --soul resolves as a spawn would; a leftover PI_AGENT_HOME (an older kernel's alias) pins nothing.
  for (const env of [{}, { PI_AGENT_HOME: home }]) {
    const r = run(["probe", "go", "--soul", "withprobe"], env);
    assert.equal(r.status, 0, JSON.stringify(r.doc) + r.stderr);
    assert.deepEqual(r.doc.result, { ran: true });
  }
});
