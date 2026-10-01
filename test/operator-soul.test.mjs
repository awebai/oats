// An operator capability command naming --soul runs with OATS_SOUL: the soul's source at the resolved
// commit, read as a spawn preview reads it (the per-commit cache a spawn left, else a temporary fetch that
// is removed when the command ends). It never runs with OATS_SOUL unset (awebai/oats#423: okf's
// harvest-status read an unset OATS_SOUL as "harvest off").
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const probeCap = {
  manifest: { command: "probe", commands: { go: "bin/go.mjs" } },
  files: { "bin/go.mjs": `import { existsSync, readFileSync } from "node:fs";
const soul = process.env.OATS_SOUL ?? null;
const yaml = soul && existsSync(soul + "/soul.yaml") ? readFileSync(soul + "/soul.yaml", "utf8") : null;
console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: { soul, named: yaml ? /^name: withprobe$/m.test(yaml) : null } }));
` },
};

test("operator dispatch with --soul passes OATS_SOUL at the resolved commit, whether or not a spawn fetched it", async (t) => {
  const fx = v2Deployment({ souls: { withprobe: { soul: { capabilities: { "test.probe": { from: "here" } } } } }, capabilities: { "test.probe": probeCap } });
  t.after(fx.cleanup);
  const run = () => { const r = fx.cli(["probe", "go", "--soul", "withprobe", "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result; };
  const souls = join(fx.root, "withprobe", "souls");

  // No spawn yet: the soul is read into a temporary directory for the command, then removed.
  let r = run();
  assert.equal(typeof r.soul, "string", "OATS_SOUL is set");
  assert.equal(r.named, true, "it is the soul's own source");
  assert.equal(existsSync(r.soul), false, "the temporary copy is gone once the command ends");
  assert.equal(existsSync(souls), false, "an operator command never writes the agents root's soul cache");

  // After a spawn fetched the soul at that commit, the per-commit copy is used as it is.
  await fx.spawn("withprobe", { instance: "withprobe-1" });
  const [commitDir] = readdirSync(souls);
  r = run();
  assert.equal(r.soul, realpathSync(join(souls, commitDir)));
  assert.equal(r.named, true);
  assert.equal(existsSync(r.soul), true);
});
