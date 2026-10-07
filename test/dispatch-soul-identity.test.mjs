// A dispatched capability command gets its soul's name and stable identity (OATS_AGENT, OATS_SOUL_ID)
// exactly as that soul's lifecycle hooks get them, through a home and through an operator dispatch
// (--soul or the default soul), and never an ambient value from its caller (awebai/oats#688). OATS_SOUL
// on an operator dispatch is a per-commit or temporary copy, so a provider keys on OATS_SOUL_ID
// instead (awebai/oats-okf#54: harvest pinned the temporary path and the next run failed E_OWNER).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { packageRepo } from "./helpers/package-repo.mjs";

const SEEN = `{ agent: process.env.OATS_AGENT ?? null, id: process.env.OATS_SOUL_ID ?? null, soul: process.env.OATS_SOUL ?? null }`;
const probeCap = {
  manifest: { command: "probe", commands: { go: "bin/go.mjs" }, hooks: { spawn: "hooks/spawn.mjs" } },
  files: {
    "bin/go.mjs": `console.log(JSON.stringify({ schemaVersion: 1, ok: true, result: ${SEEN} }));\n`,
    // The spawn hook records what it was given, beside the home it scaffolds.
    "hooks/spawn.mjs": { mode: 0o755, text: `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
writeFileSync(join(process.env.OATS_INSTANCE_HOME, "probe-hook.json"), JSON.stringify(${SEEN}));
` },
  },
};
// A soul without the namespace sorts first, so the default soul is chosen by the namespace, not by name.
const fixture = (t) => {
  const fx = v2Deployment({ souls: { aplain: {}, withprobe: { soul: { capabilities: { "test.probe": { from: "here" } } } } }, capabilities: { "test.probe": probeCap } });
  t.after(fx.cleanup);
  return fx;
};
const AMBIENT = { OATS_AGENT: "coordinator", OATS_SOUL_ID: "local/elsewhere#coordinator", OATS_SOUL: "/nowhere/coordinator" };
const seen = (fx, args, opts) => {
  const r = fx.cli(["probe", "go", ...args, "--json"], opts);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.json().result;
};

test("operator dispatch, with --soul and with the default soul, gets the soul's name and stable id, not its copy's path", (t) => {
  const fx = fixture(t);
  const id = `${fx.key}#withprobe`;
  const explicit = [seen(fx, ["--soul", "withprobe"]), seen(fx, ["--soul", "withprobe"])];
  const byDefault = seen(fx, []);
  for (const r of [...explicit, byDefault]) {
    assert.equal(r.agent, "withprobe");
    assert.equal(r.id, id, "the prepared entry's id: <repoKey>#<name>");
  }
  // Without a spawn each run reads the soul into its own temporary copy: the path moves, the id does not.
  assert.notEqual(explicit[0].soul, explicit[1].soul, "OATS_SOUL is a per-run temporary copy");
});

test("one soul gives one OATS_AGENT and OATS_SOUL_ID through its spawn hook, its home's dispatch and an operator dispatch", async (t) => {
  const fx = fixture(t);
  await fx.spawn("withprobe", { instance: "withprobe-1" });
  const home = join(fx.root, "withprobe", "instances", "withprobe-1");
  const hook = JSON.parse(readFileSync(join(home, "probe-hook.json"), "utf8"));
  const recorded = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  assert.deepEqual({ agent: hook.agent, id: hook.id }, { agent: "withprobe", id: `${fx.key}#withprobe` });
  assert.equal(recorded.workspace.soul.id, hook.id, "the id spawn recorded is the one its hook got");

  const inHome = seen(fx, [], { cwd: home, env: { OATS_INSTANCE_HOME: home } });
  const operator = seen(fx, ["--soul", "withprobe"]);
  const byDefault = seen(fx, []);
  for (const [path, r] of Object.entries({ inHome, operator, byDefault })) {
    assert.deepEqual({ agent: r.agent, id: r.id }, { agent: hook.agent, id: hook.id }, `${path}: what the hook got`);
  }
  assert.equal(inHome.soul, hook.soul, "home dispatch: the home's recorded soul directory, as before");
});

test("an ambient OATS_AGENT, OATS_SOUL_ID or OATS_SOUL from the caller never reaches the command", async (t) => {
  const fx = fixture(t);
  await fx.spawn("withprobe", { instance: "withprobe-1" });
  const home = join(fx.root, "withprobe", "instances", "withprobe-1");
  const id = `${fx.key}#withprobe`;
  const runs = {
    inHome: seen(fx, [], { cwd: home, env: { ...AMBIENT, OATS_INSTANCE_HOME: home } }),
    operator: seen(fx, ["--soul", "withprobe"], { env: AMBIENT }),
    byDefault: seen(fx, [], { env: AMBIENT }),
  };
  for (const [path, r] of Object.entries(runs)) {
    assert.equal(r.agent, "withprobe", `${path}: OATS_AGENT is this command's soul`);
    assert.equal(r.id, id, `${path}: OATS_SOUL_ID is this command's soul`);
    assert.notEqual(r.soul, AMBIENT.OATS_SOUL, `${path}: OATS_SOUL is this command's soul`);
  }
});

// The package ships the probe capability beside its own acme-tool; its keeper soul takes both.
const probePackage = () => packageRepo({
    manifest: { capabilities: ["capabilities/acme-tool", "capabilities/probe"] },
    files: {
      "capabilities/probe/oats.json": { capability: "acme.probe", version: "1.0.0", description: "probe", compatibility: { oats: ">=0.24.0" }, ...probeCap.manifest },
      "capabilities/probe/bin/go.mjs": probeCap.files["bin/go.mjs"],
      "capabilities/probe/hooks/spawn.mjs": probeCap.files["hooks/spawn.mjs"].text,
    },
    souls: { keeper: { soul: { capabilities: { "acme-tool": { from: "here" }, "acme.probe": { from: "here" } } } } },
});
const withPackage = (t, souls = { dev: {} }) => {
  const pkg = probePackage();
  t.after(pkg.cleanup);
  const fx = v2Deployment({ name: "acme", souls, capabilities: { "test.probe": probeCap }, workspace: { packages: { "acme.pkg": `${pkg.ref}@v1.0.0` } } });
  t.after(fx.cleanup);
  return fx;
};

test("a package soul's dispatched commands get its agents-root name and its package id, as its hook does", (t) => {
  const fx = withPackage(t);
  { const s = fx.cli(["sync", "--json"]); assert.equal(s.status, 0, s.stdout + s.stderr); }
  const spawned = fx.cli(["spawn", "acme.pkg/keeper", "--purpose", "p", "--no-launch", "--json"]);
  assert.equal(spawned.status, 0, spawned.stdout + spawned.stderr);
  const home = spawned.json().result.home;
  const hook = JSON.parse(readFileSync(join(home, "probe-hook.json"), "utf8"));
  assert.deepEqual({ agent: hook.agent, id: hook.id }, { agent: "acme-pkg--keeper", id: "package:acme.pkg#keeper" });
  const runs = {
    inHome: seen(fx, [], { cwd: home, env: { ...AMBIENT, OATS_INSTANCE_HOME: home } }),
    operator: seen(fx, ["--soul", "acme.pkg/keeper"], { env: AMBIENT }),
    byDefault: seen(fx, [], { env: AMBIENT }),
  };
  for (const [path, r] of Object.entries(runs)) assert.deepEqual({ agent: r.agent, id: r.id }, { agent: hook.agent, id: hook.id }, `${path}: what the hook got`);
});

test("souls of one name from different sources keep different ids: a member soul and a package soul named keeper", (t) => {
  const fx = withPackage(t, { keeper: { soul: { capabilities: { "test.probe": { from: "here" } } } } });
  { const s = fx.cli(["sync", "--json"]); assert.equal(s.status, 0, s.stdout + s.stderr); }
  const member = seen(fx, ["--soul", "ws/keeper"]);
  const packaged = seen(fx, ["--soul", "acme.pkg/keeper"]);
  assert.deepEqual({ agent: member.agent, id: member.id }, { agent: "keeper", id: `${fx.key}#keeper` });
  assert.deepEqual({ agent: packaged.agent, id: packaged.id }, { agent: "acme-pkg--keeper", id: "package:acme.pkg#keeper" });
});
