// A capability command from a deployment without --soul (awebai/oats#517
// interface §6, feature operator-default-soul): it resolves as the first soul
// of the deployment, by name, that is not disabled here and whose resolution
// provides the namespace. An explicit --soul still wins.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fakeBin } from "./helpers/fake-ssh.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const acme = { "acme.tool": { manifest: { command: "acme", commands: { show: "bin/show.mjs" } }, files: {
  "bin/show.mjs": "import { readFileSync } from 'node:fs';\nconst soul = /^name: (\\S+)$/m.exec(readFileSync(process.env.OATS_SOUL + '/soul.yaml', 'utf8'))[1];\nconsole.log(JSON.stringify({ soul, argv: process.argv.slice(2) }));\n",
} } };
const withAcme = { soul: { capabilities: { "acme.tool": { from: "here" } } } };
// alpha sorts first but lacks the namespace; beta provides it but is disabled here; gamma is the first that serves.
const fx = v2Deployment({ capabilities: acme, souls: { alpha: {}, beta: withAcme, gamma: withAcme, zeta: withAcme }, local: { souls: { disabled: ["beta"] } } });
test.after(() => fx.cleanup());
const ran = (r) => JSON.parse(r.stdout.trim().split("\n").pop());

test("no --soul: the first providing soul by name, skipping one that lacks the namespace and one disabled here", () => {
  const r = fx.cli(["acme", "show", "--flag", "x"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(ran(r).soul, "gamma", "dispatched as gamma");
  assert.deepEqual(ran(r).argv, ["--flag", "x"]);
  assert.match(r.stderr, /oats acme: no --soul given; running as soul [\w.-]+\/gamma, the first soul of this deployment that provides "acme"/);
  // --json: the provider's stdout is untouched; the note stays on stderr.
  const j = fx.cli(["acme", "show", "--json"]);
  assert.equal(j.status, 0, j.stderr);
  assert.equal(ran(j).soul, "gamma");
  assert.match(j.stderr, /running as soul [\w.-]+\/gamma,/);
});

test("an explicit --soul is unchanged", () => {
  const r = fx.cli(["acme", "show", "--soul", "zeta"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(ran(r).soul, "zeta");
  assert.equal(r.stderr.includes("no --soul given"), false);
  const bare = fx.cli(["acme", "show", "--soul", "--json"]);
  assert.equal(bare.json().error.code, "E_BAD_ARGS");
});

test("no soul provides the namespace: E_BAD_ARGS naming the namespace and the flag", () => {
  const r = fx.cli(["nope", "do", "--json"]);
  assert.equal(r.status, 1);
  const { error } = r.json();
  assert.equal(error.code, "E_BAD_ARGS");
  assert.equal(error.message, `no soul of this deployment provides the nope namespace; pass --soul <name>`);
  assert.equal(error.details.namespace, "nope");
});

test("routed without --soul: the host resolves its own first providing soul", () => {
  const base = mkdtempSync("/tmp/oats-ods-");
  try {
    const { bin } = fakeBin(base);
    const env = { ...process.env, PATH: bin, OATS_HOME_DIR: join(base, "oats-home"), HOME: join(base, "home"), OATS_REMOTE_CACHE: join(base, "cache") };
    for (const k of Object.keys(env)) if (/^(OATS_INSTANCE|OATS_HOME$|PI_AGENT)/.test(k)) delete env[k];
    mkdirSync(env.HOME, { recursive: true }); mkdirSync(env.OATS_HOME_DIR, { recursive: true });
    writeFileSync(join(env.OATS_HOME_DIR, "servers.json"), JSON.stringify({ servers: { box: { sshHost: "box-host", workspace: fx.dep, oatsPath: CLI } } }));
    const r = spawnSync(process.execPath, [CLI, "acme", "show", "--server", "box"], { env, cwd: env.HOME, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(ran(r).soul, "gamma");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
