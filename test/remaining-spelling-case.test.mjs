// awebai/oats#789 (the remaining comparisons): on a case-insensitive filesystem (APFS, the macOS
// default) a path git, Claude or Codex reports, or one an operator wrote in oats-local.yaml, is
// compared with the caller's spelling of the same directory, or written for a tool that compares it
// with its own on-disk cwd. Both sides are compared, and what a tool compares is written, in the
// on-disk spelling (canonicalHomePath).
//
// Real git, real files and the kernel's own readers, on the shared fixture (its short base, and its
// environment for every child: test/helpers/host-fixture.mjs). Claude is a fake that prints `plugin
// list --json` (no test runs the real one); its answer is data, and the comparison is the kernel's.
// The deployment is realpath'd, so its on-disk spelling is the fixture's own: `deployment`.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HARNESS_PACKAGE_MANAGERS, canonicalDeploymentPath, describeLaunchCommand, renderLaunchRecipe } from "../lib/core.mjs";
import { effectiveLaunchPromptPolicy } from "../lib/launch-prompt-policy.mjs";
import { git, v2Deployment } from "./helpers/v2-deployment.mjs";

const fx = v2Deployment({ souls: { dev: {}, wt: { soul: { work: "worktree" } } } });
test.after(() => fx.cleanup());

/** Whether this filesystem folds letter case: `Probe` created, `probe` found. */
const caseInsensitive = (() => {
  const probe = join(fx.base, "Probe");
  mkdirSync(probe);
  try { return existsSync(join(fx.base, "probe")); } finally { rmSync(probe, { recursive: true, force: true }); }
})();
const FOLDS = caseInsensitive ? {} : { skip: "filesystem is case-sensitive: two spellings are two directories" };
/** The same path with one directory's letter case changed. */
const spelled = (p, from, to) => p.replace(`${fx.base}/${from}`, `${fx.base}/${to}`);

test("#789 item 1: a root inside a linked worktree, given in another spelling, still maps to the primary checkout", FOLDS, () => {
  // A deployment that is itself a repository, with a linked worktree beside it.
  const primary = join(fx.base, "primary"), linked = join(fx.base, "linked");
  mkdirSync(primary);
  git(primary, "init", "-q");
  writeFileSync(join(primary, "README"), "deployment\n");
  git(primary, "add", "README");
  git(primary, "commit", "-qm", "deployment");
  git(primary, "worktree", "add", "-q", "--detach", linked);
  const root = join(linked, "agents");
  assert.equal(canonicalDeploymentPath(root), join(primary, "agents"), "fixture premise: the linked root maps to the primary checkout");
  assert.equal(canonicalDeploymentPath(spelled(root, "linked", "LINKED")), join(primary, "agents"), "another spelling maps there too, never stays in the linked worktree");
  // The primary checkout itself is returned as given.
  assert.equal(canonicalDeploymentPath(spelled(join(primary, "agents"), "primary", "PRIMARY")), spelled(join(primary, "agents"), "primary", "PRIMARY"));
});

test("#789 item 1: spawn through another spelling of a linked worktree creates the home in the primary checkout", FOLDS, () => {
  // The fixture's deployment as a repository whose linked worktree is a second view of it.
  git(fx.dep, "init", "-q");
  git(fx.dep, "add", "oats-local.yaml");
  git(fx.dep, "commit", "-qm", "deployment");
  const linked = join(fx.base, "view");
  git(fx.dep, "worktree", "add", "-q", "--detach", linked);
  mkdirSync(join(linked, "agents")); // what an operator's view of the deployment has: its agents root
  // Fixture premise: through the worktree's own spelling, the home lands in the primary checkout.
  const premise = fx.cli(["spawn", "dev", "--name", "premise", "--no-launch", "--dir", linked, "--json"]);
  assert.equal(premise.status, 0, premise.stdout + premise.stderr);
  assert.equal(existsSync(join(fx.root, "dev", "instances", "premise")), true, premise.stdout);
  const r = fx.cli(["spawn", "dev", "--name", "placed", "--no-launch", "--dir", spelled(linked, "view", "VIEW"), "--json"]);
  const where = { primary: existsSync(join(fx.root, "dev", "instances", "placed")), linked: existsSync(join(linked, "agents", "dev", "instances", "placed")) };
  assert.equal(where.linked, false, `no home in the linked worktree: ${r.stdout}${r.stderr}`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(where.primary, true, "the home is in the primary checkout");
});

test("#789 item 2: retire through another spelling removes a clean extra tree and verifies it is gone", FOLDS, async () => {
  const path = process.env.PATH;
  process.env.PATH = fx.env.PATH;
  let home;
  try { home = (await fx.spawn("wt", { name: "removal", harness: "claude" })).home; } finally { process.env.PATH = path; }
  const extra = join(home, ".work-clean");
  git(fx.member, "worktree", "add", "-q", "-b", "clean-extra", extra);
  const r = fx.cli(["retire", "removal", "--dir", spelled(fx.dep, "deployment", "DEPLOYMENT"), "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [tree] = JSON.parse(r.stdout).extraWorktrees;
  assert.equal(tree?.outcome, "removed", r.stdout);
  assert.equal(git(fx.member, "worktree", "list", "--porcelain").includes(".work-clean"), false, "its registration is gone");
});

test("#789 item 3: consent recorded for a home under one spelling applies to it under another; an exact key decides; several case variants fail closed", FOLDS, () => {
  const home = join(fx.root, "dev", "instances", "consent");
  mkdirSync(home, { recursive: true });
  const upper = spelled(home, "deployment", "DEPLOYMENT"), title = spelled(home, "deployment", "Deployment");
  const policy = (homes) => ({ launchPromptAnswers: { homes } });
  const read = (homes, caller) => effectiveLaunchPromptPolicy(policy(homes), caller, "/x/oats-local.yaml");
  // (b) the single key naming this directory decides, and the source points at that key.
  const one = read({ [upper]: { awebDevelopmentChannel: true } }, home);
  assert.equal(one.awebDevelopmentChannel, true);
  assert.equal(one.consentSource, `/x/oats-local.yaml#/launchPromptAnswers/homes/${upper.replaceAll("~", "~0").replaceAll("/", "~1")}`);
  assert.equal(read({ [home]: { awebDevelopmentChannel: true } }, upper).awebDevelopmentChannel, true);
  // (a) an exact key decides, as before, whatever a case variant says.
  assert.equal(read({ [home]: { awebDevelopmentChannel: false }, [upper]: { awebDevelopmentChannel: true } }, home).awebDevelopmentChannel, false);
  // (c) several case-variant keys and no exact one: no consent, even when they agree.
  for (const values of [[true, false], [true, true]]) {
    const r = read({ [upper]: { awebDevelopmentChannel: values[0] }, [title]: { awebDevelopmentChannel: values[1] } }, home);
    assert.deepEqual(r, { awebDevelopmentChannel: false, consentSource: null }, JSON.stringify(values));
  }
  // Another directory's consent never applies.
  assert.equal(read({ [join(fx.root, "dev", "instances", "other")]: { awebDevelopmentChannel: true } }, home).awebDevelopmentChannel, false);
});

test("#789 item 4: the Codex trust written at launch names the home in its on-disk spelling", FOLDS, () => {
  const home = join(fx.root, "dev", "instances", "codex");
  mkdirSync(home, { recursive: true });
  const recipe = { harness: "codex", executable: "/opt/homebrew/bin/codex", args: [], env: {}, model: null, hooks: { launch: {}, env: {}, contributions: [] } };
  const argv = describeLaunchCommand(renderLaunchRecipe(recipe, { home: spelled(home, "deployment", "DEPLOYMENT"), instance: "n", trustHome: true })).argv;
  assert.equal(argv.find((a) => a.startsWith("projects=")), `projects={${JSON.stringify(home)}={trust_level="trusted"}}`);
});

test("#789 item 5: a Claude plugin installed for a project applies inside it through another spelling of the project", FOLDS, () => {
  const project = join(fx.base, "project");
  mkdirSync(join(project, "sub"), { recursive: true });
  const bin = join(fx.base, "fake-claude");
  writeFileSync(bin, `#!/bin/sh\n[ "$1 $2 $3" = "plugin list --json" ] || exit 9\nprintf '%s' '${JSON.stringify([{ id: "chan@acme", version: "1.0.0", scope: "project", enabled: true, projectPath: project, installPath: join(fx.base, "plugins", "chan") }])}'\n`);
  chmodSync(bin, 0o755);
  mkdirSync(join(fx.base, "plugins", "chan"), { recursive: true });
  const listed = (context) => HARNESS_PACKAGE_MANAGERS.claude.list(fx.env, { bin, context }).map((r) => r.source);
  assert.deepEqual(listed(join(project, "sub")), ["chan@acme"], "fixture premise: found inside the project");
  assert.deepEqual(listed(spelled(join(project, "sub"), "project", "PROJECT")), ["chan@acme"]);
  assert.deepEqual(listed(join(fx.base, "elsewhere")), [], "never outside it");
});
