// Every provider surface gets one stable soul identity (awebai/oats#707): a readiness binding check and
// a layer operation get OATS_AGENT and OATS_SOUL_ID with the values the soul's hooks and dispatched
// commands get (#688), from a home and for a soul (--soul), and never an ambient one. Before, a --soul
// check of a package soul got OATS_AGENT `keeper` (its hooks get `acme-pkg--keeper`) and no OATS_SOUL_ID.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { packageRepo } from "./helpers/package-repo.mjs";

const SEEN = `{ agent: process.env.OATS_AGENT ?? null, id: process.env.OATS_SOUL_ID ?? null }`;
// A locked package messaging provider: its binding check records what it got and answers ready; its
// command (dispatched, and as the `messaging:peek` operation) answers what it got; its spawn hook
// records what it got in the home.
const pkgFiles = {
  "capabilities/acme.msg/oats.json": { capability: "acme.msg", version: "1.0.0", description: "stub messaging provider", compatibility: { oats: ">=0.24.0" }, layer: "messaging",
    command: "probe", commands: { go: "bin/go.mjs", "binding-check": "bin/check.mjs" }, binding: { version: 1, normalize: "binding-check", bind: "binding-check", check: "binding-check" },
    hooks: { spawn: "hooks/spawn.mjs" }, operations: { peek: { kind: "action", command: "go", context: "scope" } } },
  "capabilities/acme.msg/bin/go.mjs": `console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: ${SEEN} }));\n`,
  "capabilities/acme.msg/bin/check.mjs": `import { appendFileSync, readFileSync } from "node:fs";
readFileSync(0, "utf8");
appendFileSync(process.env.FX_CHECK_RECORD, JSON.stringify(${SEEN}) + "\\n");
process.stdout.write(JSON.stringify({ schemaVersion: 1, phase: "check", slot: "messaging", capability: "acme.msg", ok: true, result: { status: "ready", problems: [] } }) + "\\n");
`,
  "capabilities/acme.msg/hooks/spawn.mjs": `import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.env.OATS_INSTANCE_HOME, "probe-hook.json"), JSON.stringify(${SEEN}));
`,
};
const AMBIENT = { OATS_AGENT: "coordinator", OATS_SOUL_ID: "local/elsewhere#coordinator" };

function fixture(t) {
  const pkg = packageRepo({
    manifest: { capabilities: ["capabilities/acme-tool", "capabilities/acme.msg"] }, files: pkgFiles,
    souls: { keeper: { soul: { capabilities: { "acme-tool": { from: "here" }, "acme.msg": { from: "here" } } } } },
  });
  t.after(pkg.cleanup);
  const fx = v2Deployment({ name: "acme", workspace: { packages: { "acme.pkg": `${pkg.ref}@v1.0.0` }, defaults: { messaging: { "acme.msg": { from: "package" } } } } });
  t.after(fx.cleanup);
  const record = join(fx.base, "check.jsonl");
  fx.run = (args, { cwd = fx.dep, env = {} } = {}) => {
    const r = fx.cli([...args, "--json"], { cwd, env: { ...AMBIENT, FX_CHECK_RECORD: record, ...env } });
    assert.equal(r.status, 0, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
    const d = r.json(); assert.equal(d.ok, true, r.stdout); return d.result;
  };
  fx.checked = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1);
  fx.run(["sync"]);
  return fx;
}
const pair = (r) => ({ agent: r.agent, id: r.id });

for (const [soul, qualified, agent, id] of [
  ["dev", "dev", "dev", (fx) => `${fx.key}#dev`],
  ["keeper", "acme.pkg/keeper", "acme-pkg--keeper", () => "package:acme.pkg#keeper"],
]) {
  test(`one id across surfaces for ${soul}: hook, dispatched command, readiness check and operation, from its home and as --soul`, (t) => {
    const fx = fixture(t);
    const home = fx.run(["spawn", qualified, "--purpose", "p", "--no-launch"]).home;
    const hook = pair(JSON.parse(readFileSync(join(home, "probe-hook.json"), "utf8")));
    assert.deepEqual(hook, { agent, id: id(fx) }, "what the spawn hook got");

    const inHome = { cwd: home, env: { OATS_INSTANCE_HOME: home } };
    const surfaces = {};
    const readiness = (args) => { const doc = fx.run(["readiness", ...args]); assert.equal(doc.checks.providers.items.find((i) => i.subject === "acme.msg")?.status, "pass", `readiness ${args.join(" ")}: ${JSON.stringify(doc.checks)}`); return fx.checked(); };
    surfaces["readiness --soul"] = readiness(["--soul", qualified]);
    surfaces["readiness --home"] = readiness(["--home", home]);
    surfaces["operation --soul"] = fx.run(["operation", "run", "messaging:peek", "--soul", qualified]).result;
    surfaces["command --soul"] = fx.run(["probe", "go", "--soul", qualified]);
    surfaces["command in home"] = fx.run(["probe", "go"], inHome);
    for (const [surface, r] of Object.entries(surfaces)) assert.deepEqual(pair(r), hook, `${surface}: what the hook got, not the ambient identity`);
  });
}
