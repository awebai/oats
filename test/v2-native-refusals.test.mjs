// The 0.26.0 workspace-model-only contracts that replaced the config chain
// (lead decisions c3 / c3-q): a 0.25 oats-config.yaml inside a deployment is a
// typed migration error, an attached instance takes its repository from the
// work tree's owner, a schedule needs a deployment, and a capability command
// gets the same team/workspace facts from a home as from the deployment.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { loadLocal } from "../lib/workspace.mjs";
import { spawnInstanceAsync } from "../lib/core.mjs";

const envelope = (r) => { const doc = JSON.parse(r.stdout.trim()); assert.equal(r.stdout.trim(), JSON.stringify(doc), "one envelope on stdout"); return doc; };
const LEGACY = "capabilities:\n  layers:\n    knowledge: none\n";

test("a 0.25 oats-config.yaml inside the deployment is E_CONFIG_BROKEN naming the migration; above the deployment it is not ours", (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  // At the deployment itself.
  writeFileSync(join(fx.dep, "oats-config.yaml"), LEGACY);
  let r = fx.cli(["spawn", "dev", "--preview", "--json"]);
  assert.notEqual(r.status, 0);
  let doc = envelope(r);
  assert.equal(doc.error.code, "E_CONFIG_BROKEN", doc.error.message);
  assert.equal(doc.error.details.reason, "legacy-config");
  assert.deepEqual(doc.error.details.files, [join(fx.dep, "oats-config.yaml")]);
  for (const where of ["oats-local.yaml", "oats-workspace.yaml", "soul.yaml"]) assert.ok(doc.error.message.includes(where), `the migration names ${where}`);
  // Between the invocation directory and the deployment.
  const sub = join(fx.dep, "jobs", "nightly"); mkdirSync(sub, { recursive: true });
  writeFileSync(join(fx.dep, "jobs", "oats-config.yaml"), LEGACY);
  assert.throws(() => loadLocal(sub), (e) => e.code === "E_CONFIG_BROKEN" && e.details.reason === "legacy-config"
    && e.details.files.length === 2 && e.details.deployment === fx.dep);
  // Above the deployment: some other scope's file, never read, never refused.
  rmSync(join(fx.dep, "oats-config.yaml")); rmSync(join(fx.dep, "jobs", "oats-config.yaml"));
  writeFileSync(join(fx.base, "oats-config.yaml"), LEGACY);
  assert.equal(loadLocal(sub).path, join(fx.dep, "oats-local.yaml"));
  r = fx.cli(["spawn", "dev", "--preview", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // No deployment at all, a legacy file in reach: E_LOCAL_MISSING says what the file is.
  const bare = realpathSync(mkdtempSync(join(tmpdir(), "oats-legacy-only-")));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  writeFileSync(join(bare, "oats-config.yaml"), LEGACY);
  assert.throws(() => loadLocal(bare), (e) => e.code === "E_LOCAL_MISSING" && /0\.25 deployment's configuration/.test(e.message) && e.details.legacy?.[0] === join(bare, "oats-config.yaml"));
});

test("with a 0.25 oats-config.yaml in the deployment, every command a Desktop or operator runs there answers the typed legacy-config refusal, never a stack", async (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const { home } = await fx.spawn("dev", { instance: "dev-legacy" });
  writeFileSync(join(fx.dep, "oats-config.yaml"), LEGACY);
  const noHome = { OATS_INSTANCE_HOME: "", PI_AGENT_HOME: "", OATS_HOME: "" };
  const commands = [
    ["status"], ["doctor"], ["doctor", "--soul", "dev"], ["workspace", "status"], ["souls"], ["capabilities"], ["packages"], ["sync"],
    ["spawn", "dev", "--preview"], ["inspect", "--soul", "dev"], ["readiness", "--soul", "dev"],
    ["launch-config", "list"], ["launch-config", "preview", "--soul", "dev"], ["launch-config", "preview", "--home", home],
    ["schedule", "list"], ["schedule", "run", "nightly"], ["schedule", "tick"],
    ["session", "start", "--home", home], ["session", "restart", "--home", home], ["retire", "dev-legacy"],
  ];
  for (const argv of commands) {
    const what = argv.join(" ");
    const json = fx.cli([...argv, "--json"], { env: noHome });
    assert.notEqual(json.status, 0, what);
    assert.doesNotMatch(json.stderr, /\n\s+at /, `${what}: no stack trace`);
    const doc = envelope(json);
    assert.equal(doc.error.code, "E_CONFIG_BROKEN", `${what}: ${doc.error.message}`);
    assert.equal(doc.error.details?.reason, "legacy-config", `${what}: details.reason`);
    assert.ok(doc.error.message.includes(join(fx.dep, "oats-config.yaml")), `${what}: names the file`);
    // Human mode: one `oats: …` line, no stack.
    const human = fx.cli(argv, { env: noHome });
    assert.notEqual(human.status, 0, what);
    assert.match(human.stderr, /^oats: .*oats-config\.yaml is no longer read/, `${what}: human line`);
    assert.doesNotMatch(human.stderr, /\n\s+at /, `${what}: no stack trace (human)`);
  }
  // Nothing was retired or started: the home is still there.
  assert.ok(existsSync(join(home, "instance.json")));
});

test("an attached instance takes its repository from the work tree owner's record, and refuses when there is none", async (t) => {
  const fx = v2Deployment({ souls: { dev: { soul: { work: "worktree" } }, helper: {} } }); t.after(fx.cleanup);
  // No --repo: exactly what `oats spawn helper --work attached --work-dir <owner>/work` hands the kernel.
  const attach = (instance, workDir) => fx.inEnv(async () => {
    const { prepared, agent } = await fx.prepare("helper");
    return spawnInstanceAsync(fx.root, agent, { launch: false, prepared, instance, work: "attached", workDir });
  });
  const owner = await fx.spawn("dev", { instance: "dev-owner", repo: fx.member });
  const ownerRepo = JSON.parse(readFileSync(join(owner.home, "instance.json"), "utf8")).repo;
  assert.ok(ownerRepo, "the owner records its repository");
  const attached = await attach("helper-attached", join(owner.home, "work"));
  assert.equal(JSON.parse(readFileSync(join(attached.home, "instance.json"), "utf8")).repo, ownerRepo);
  // An owner that records no repository: nothing to derive, so the spawn names --repo.
  const bare = await fx.spawn("dev", { instance: "dev-bare-owner", repo: fx.member });
  const metaFile = join(bare.home, "instance.json");
  const { repo: _dropped, ...norepo } = JSON.parse(readFileSync(metaFile, "utf8"));
  writeFileSync(metaFile, JSON.stringify(norepo));
  await assert.rejects(attach("helper-orphan", join(bare.home, "work")),
    (e) => e.code === "E_BAD_ARGS" && /pass --repo \(the work tree's owner records none\)/.test(e.message));
});

test("oats schedule outside a deployment is E_LOCAL_MISSING, whatever ambient root is set", (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const bare = realpathSync(mkdtempSync(join(tmpdir(), "oats-schedule-none-")));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  const r = fx.cli(["schedule", "list", "--json"], { cwd: bare, env: { PI_AGENTS_ROOT: fx.root, OATS_ROOT: fx.root } });
  assert.notEqual(r.status, 0);
  assert.equal(envelope(r).error.code, "E_LOCAL_MISSING");
  // …and from the deployment it answers.
  const ok = fx.cli(["schedule", "list", "--json"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

test("a capability command gets the same team and workspace facts from a home as from the deployment", async (t) => {
  const probe = "console.log(JSON.stringify({schemaVersion:1,ok:true,result:Object.fromEntries(Object.entries(process.env).filter(([k])=>/^OATS_(TEAM|WORKSPACE)_/.test(k)))}))\n";
  const fx = v2Deployment({
    name: "northwind",
    souls: { dev: { soul: { capabilities: { "acme.env": { from: "here" } } } } },
    capabilities: { "acme.env": { manifest: { command: "envprobe", commands: { show: "show.mjs" } }, files: { "show.mjs": probe } } },
  });
  t.after(fx.cleanup);
  const expected = { OATS_TEAM_NAME: "", OATS_TEAM_ID: "", OATS_TEAM_SCOPE: fx.dep, OATS_TEAM_LABEL: "global", OATS_WORKSPACE_NAME: "northwind", OATS_WORKSPACE_KEY: fx.key };
  const noHome = { OATS_INSTANCE_HOME: "", PI_AGENT_HOME: "", OATS_HOME: "", OATS_TEAM_NAME: "ambient", OATS_WORKSPACE_NAME: "ambient" };
  const fromDeployment = fx.cli(["envprobe", "show", "--soul", "dev", "--json"], { env: noHome });
  assert.equal(fromDeployment.status, 0, fromDeployment.stdout + fromDeployment.stderr);
  assert.deepEqual(envelope(fromDeployment).result, expected);
  const spawned = await fx.spawn("dev", { instance: "dev-env" });
  const inHome = fx.cli(["envprobe", "show", "--json"], { cwd: spawned.home, env: { ...noHome, OATS_INSTANCE_HOME: spawned.home } });
  assert.equal(inHome.status, 0, inHome.stdout + inHome.stderr);
  assert.deepEqual(envelope(inHome).result, expected);
});
