// The ONE minimal workspace-model deployment for tests that spawn, schedule, retire
// or read a deployment (lead decision c3-1). Northwind (test/fixtures/northwind) is
// the realistic multi-repo company; this is the smallest real thing:
//
//   <base>/remotes/ws.git   one bare repo that is BOTH the workspace host and its only
//                           member: oats-workspace.yaml (members: [itself]),
//                           oats-membership.yaml, souls/<name>/, capabilities/<id>/
//   <base>/deployment/      oats-local.yaml → the host; agents/; ws/ (the member clone
//                           a `work: worktree|checkout` soul works in, by convention)
//
// Spawns go through the real kernel path, exactly as bin/oats.mjs does it:
// prepareInstance (discovery over the local remote) → ensureWorkspaceSoul →
// spawnInstanceAsync. No network, no packages, no catalog, never bare `oats setup`;
// HOME, the remote cache, tmux and the harnesses are isolated. tmux: a session name that does not
// exist, and a private TMUX_TMPDIR, so the server the kernel selects by name (`tmux -L oats`) is the
// fixture's own, never the operator's. Inside a session environment (isolateSessionEnvironment, which
// must be installed first) that environment's TMUX_TMPDIR is used, so both name one `oats` server.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { devNull } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { inertHarnessDir } from "./runtime-stub.mjs";
import { applyFixtureRules, assertNoFixtureProcesses, fixtureBase, fixtureEnv, fixtureRules, isolatedTmuxTmpdir, noLoginShell, privateTmuxTmpdir, removeTmuxTmpdir } from "./host-fixture.mjs";

export const CLI = resolve(new URL("../../bin/oats.mjs", import.meta.url).pathname);
const IDENTITY = ["TMUX", "TMUX_PANE", "OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "OATS_AGENT", "OATS_SOUL", "OATS_SOUL_ID", "OATS_ROOT", "OATS_CONTEXT", "OATS_WORKSPACE",
  "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"];
const DATE = "2026-09-25T09:00:00Z";

function gitEnv() {
  return { PATH: process.env.PATH, HOME: process.env.HOME, LANG: "C", LC_ALL: "C", GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid", GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE };
}
export function git(cwd, ...args) {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", "-c", "gc.auto=0", "-c", "maintenance.auto=false",
    "-c", `core.excludesFile=${devNull}`, "-c", `core.attributesFile=${devNull}`, ...args], { cwd, env: gitEnv(), encoding: "utf8" }).trim();
}

/** spec: { "<relpath>": string | { json } | { yaml } | { text, mode } | { symlink } } */
function writeTree(root, spec) {
  for (const rel of Object.keys(spec).sort()) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    const e = spec[rel];
    if (e === null) { rmSync(abs, { recursive: true, force: true }); continue; }
    if (typeof e === "string") writeFileSync(abs, e);
    else if (e.symlink !== undefined) { rmSync(abs, { force: true }); symlinkSync(e.symlink, abs); }
    else if (e.json !== undefined) writeFileSync(abs, JSON.stringify(e.json, null, 2) + "\n");
    else if (e.yaml !== undefined) writeFileSync(abs, YAML.stringify(e.yaml, { lineWidth: 0 }));
    else { writeFileSync(abs, e.text); if (e.mode) chmodSync(abs, e.mode); }
  }
}

/** A soul as member-repository files: souls/<name>/{soul.yaml, AGENTS.md, CLAUDE.md → AGENTS.md, skills/}.
 *  soul.yaml takes the v2 fields only (docs/soul.schema.json): harness, model and
 *  yolo are spawn flags or a launch configuration, never soul fields. */
export function soulFiles(name, { soul = {}, agents = `# ${name}\n`, skills = {} } = {}) {
  const prefix = `souls/${name}`;
  const spec = {
    [`${prefix}/soul.yaml`]: { yaml: { schemaVersion: 2, name, description: `${name} fixture soul.`, work: "directory", ...soul } },
    [`${prefix}/AGENTS.md`]: agents,
    [`${prefix}/CLAUDE.md`]: { symlink: "AGENTS.md" },
  };
  for (const [skill, body] of Object.entries(skills)) spec[`${prefix}/skills/${skill}/SKILL.md`] = `---\nname: ${skill}\ndescription: ${body.description ?? skill}\n---\n\n${body.text ?? ""}\n`;
  return spec;
}
/** A member capability: capabilities/<id>/oats.json + files. */
export function capabilityFiles(id, manifest = {}, files = {}) {
  const spec = { [`capabilities/${id}/oats.json`]: { json: { capability: id, version: "0.0.0-workspace", description: `${id} fixture capability.`, compatibility: { oats: ">=0.24.0" }, ...manifest } } };
  for (const [rel, body] of Object.entries(files)) spec[`capabilities/${id}/${rel}`] = body;
  return spec;
}

/**
 * Build a deployment. Options:
 *   souls         { <name>: { soul: {soul.yaml fields}, agents, skills } }   (default: one `dev` soul, work: directory)
 *   capabilities  { <id>: { manifest, files } }                                member capabilities of the one repo
 *   capabilityDirs { <dir name>: <abs source dir> }   copied whole to capabilities/<dir name>/ (e.g. the real mirrors/oats-okf)
 *   workspace     extra oats-workspace.yaml keys, merged over the base (defaults: messaging/tasks/knowledge none)
 *   local         extra oats-local.yaml keys (launch-configs, settings, clones…)
 *   files         any other repo files
 *   t             the test context: the fixture registers t.after(fx.cleanup) at creation, so a test that
 *                 fails, rejects or times out still removes its base (awebai/oats#830)
 * → { base, dep, root, repo, key, ref, member, env, remoteOptions, inEnv, prepare, spawn, cli, commit, beforeCleanup, cleanup }
 * In-process kernel calls a test makes itself (session start, retire…) go through
 * fx.inEnv(() => …) so they never see the operator's environment.
 */
export function v2Deployment({ souls = { dev: {} }, capabilities = {}, capabilityDirs = {}, workspace = {}, local = {}, files = {}, name = "fixture", t } = {}) {
  const base = fixtureBase("oats-v2-");
  if (/[\s@]/.test(base)) throw new Error(`tmpdir ${base} contains whitespace or @ (repo keys embed it)`);
  const bare = join(base, "remotes", "ws.git");
  const ref = pathToFileURL(bare).href;
  const key = `local/${bare}`;
  const dep = join(base, "deployment");
  const root = join(dep, "agents");
  const member = join(dep, "ws");
  const home = join(base, "home");
  for (const d of [bare, root, home]) mkdirSync(d, { recursive: true });
  git(bare, "init", "-q", "--bare");
  // Served like GitHub: partial fetches (lib/remote.mjs fetches a commit's small blobs, then what a read needs).
  git(bare, "config", "uploadpack.allowFilter", "true");
  git(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  // No background git in a fixture repository (awebai/oats#451): a commit or fetch otherwise daemonizes
  // `git maintenance run --auto` (Git >= 2.47), which can still be repacking into the deployment while a
  // test's cleanup removes it. Repository config, so every git run in it, a test's or the kernel's, obeys.
  const quiet = (repo) => git(repo, "config", "maintenance.auto", "false");
  quiet(bare);

  const { defaults: extraDefaults, ...extraWorkspace } = workspace;
  const spec = {
    "oats-workspace.yaml": { yaml: { schemaVersion: 2, name, members: [ref], teams: { global: { description: "Fixture team" } },
      defaults: { knowledge: "none", messaging: "none", tasks: "none", ...(extraDefaults || {}) }, ...extraWorkspace } },
    "oats-membership.yaml": { yaml: { schemaVersion: 2, workspace: ref } },
    ...files,
  };
  for (const [soul, def] of Object.entries(souls)) Object.assign(spec, soulFiles(soul, def));
  for (const [id, def] of Object.entries(capabilities)) Object.assign(spec, capabilityFiles(id, def.manifest, def.files));
  const seed = join(base, "seed");
  git(base, "clone", "-q", bare, seed);
  quiet(seed);
  writeTree(seed, spec);
  for (const [dirName, src] of Object.entries(capabilityDirs)) cpSync(src, join(seed, "capabilities", dirName), { recursive: true, verbatimSymlinks: true });
  git(seed, "add", "-A"); git(seed, "commit", "-qm", "fixture workspace"); git(seed, "push", "-q", "origin", "HEAD:main");
  git(base, "clone", "-q", bare, member);
  quiet(member);

  writeFileSync(join(dep, "oats-local.yaml"), YAML.stringify({ schemaVersion: 2, workspace: ref, ...local }, { lineWidth: 0 }));
  const bin = inertHarnessDir(base);
  const cache = join(base, "cache");
  const ownTmuxTmpdir = isolatedTmuxTmpdir() ? null : privateTmuxTmpdir();
  // The fixture's rules (host-fixture.mjs fixtureEnv: HOME, XDG, git, no proxies, the scheduler
  // stubs), its inert harnesses first on PATH.
  const rules = fixtureRules(base, { home });
  const env = fixtureEnv(base, { rules, extra: { OATS_HOME_DIR: join(base, "oats-home"), OATS_REMOTE_CACHE: cache,
    OATS_TMUX_SESSION: `none-${process.pid}`, PI_AGENTS_TMUX_SESSION: `none-${process.pid}`, TMUX_TMPDIR: ownTmuxTmpdir ?? isolatedTmuxTmpdir(),
    // Never the operator's login shell (host-fixture.mjs isolateSessionEnvironment says why).
    OATS_TEST_LOGIN_SHELL: process.env.OATS_TEST_LOGIN_SHELL ?? noLoginShell(base) } });
  env.PATH = `${bin}:${env.PATH}`;
  for (const k of IDENTITY) delete env[k];
  const remoteOptions = { cacheDir: cache };

  const fx = { base, dep, root, repo: bare, key, ref, member, env, remoteOptions };
  /** Commit a change to the member (spec as above; null deletes) and fast-forward the member clone. */
  fx.commit = (change, message = "fixture change") => {
    writeTree(seed, change);
    git(seed, "add", "-A"); git(seed, "commit", "-qm", message, "--allow-empty"); git(seed, "push", "-q", "origin", "HEAD:main");
    git(member, "pull", "-q", "--ff-only", "origin", "main");
    return git(seed, "rev-parse", "HEAD");
  };
  /** Run `fn` with the fixture's isolation forced onto process.env, restored afterwards:
   *  HOME, the remote cache, a tmux session that does not exist, the private TMUX_TMPDIR, a login
   *  shell that cannot run (unless the test set its own), and no
   *  ambient instance identity or TMUX. Everything else the test set (its own PATH with fakes, switches)
   *  is kept. Every in-process kernel call goes through here, so a test can never reach
   *  the operator's own tmux server or deployment. */
  const fixtureProcessEnv = () => {
    const next = applyFixtureRules({ ...process.env }, rules);
    for (const k of ["HOME", "OATS_HOME_DIR", "OATS_REMOTE_CACHE", "OATS_TMUX_SESSION", "PI_AGENTS_TMUX_SESSION", "TMUX_TMPDIR"]) next[k] = env[k];
    next.OATS_TEST_LOGIN_SHELL ??= env.OATS_TEST_LOGIN_SHELL;
    for (const k of IDENTITY) delete next[k];
    return next;
  };
  fx.inEnv = async (fn) => {
    const saved = process.env;
    process.env = fixtureProcessEnv();
    try { return await fn(); } finally { process.env = saved; }
  };
  /** What bin/oats.mjs hands spawnInstanceAsync for a soul: the prepared resolution and the fetched soul. */
  fx.prepare = (soul, opts) => fx.inEnv(() => prepareIn(soul, opts));
  const prepareIn = async (soul, { providers = {} } = {}) => {
    const { prepareInstance, ensureWorkspaceSoul, toCapabilityRows, modulesPreview } = await import("../../lib/instance-resolution.mjs");
    const { findAgent } = await import("../../lib/core.mjs");
    const prepared = await prepareInstance(dep, soul, { spawn: { providers }, remoteOptions });
    await ensureWorkspaceSoul(prepared, root);
    prepared.capabilityRows = [];
    prepared.preview = modulesPreview(prepared.resolution, root, soul);
    prepared.toCapabilityRows = toCapabilityRows;
    return { prepared, agent: findAgent(root, soul) };
  };
  /** An in-process spawn the way `oats spawn` does it (no launch unless asked). */
  fx.spawn = (soul, opts = {}) => fx.inEnv(async () => {
    const { spawnInstanceAsync } = await import("../../lib/core.mjs");
    const { providers, ...rest } = opts;
    const { prepared, agent } = await prepareIn(soul, { providers });
    const work = rest.work || agent.work || "directory";
    const repo = rest.repo ?? (work === "directory" ? dep : member);
    return spawnInstanceAsync(root, agent, { launch: false, ...rest, prepared, repo });
  });
  /** The real CLI in the deployment, isolated; `json()` parses the one envelope. */
  fx.cli = (args, { cwd = dep, env: extra = {} } = {}) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: { ...env, ...extra }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    return { ...r, json: () => JSON.parse(r.stdout.trim().split("\n").pop()) };
  };
  /** What the test ends itself before the leftover check: a process it left running on purpose (a
   *  group the kernel must not signal). Its own t.after would run after the fixture's, too late:
   *  node:test runs t.after hooks in the order they were added. */
  const before = [];
  let cleaned = false;
  fx.beforeCleanup = (fn) => {
    if (cleaned) throw new Error(`the fixture ${base} is already cleaned up: a function registered now would never run`);
    before.push(fn);
  };
  /** Runs the beforeCleanup functions in order, kills the fixture's own `oats` server, checks that no
   *  process it started still works in the base (host-fixture.mjs assertNoFixtureProcesses), removes
   *  the base whatever the check found, then throws the first error: a beforeCleanup function's, then
   *  the check's, naming what was left. Only the first call does this; a later one returns quietly. */
  fx.cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    const errors = [];
    for (const fn of before) { try { fn(); } catch (e) { errors.push(e); } }
    // Its own `oats` server, if a test launched on real tmux: killed by socket, never by name.
    if (ownTmuxTmpdir) removeTmuxTmpdir(ownTmuxTmpdir);
    const saved = process.env;
    process.env = fixtureProcessEnv(); // as fx.inEnv: the check may be what first loads the kernel
    try { assertNoFixtureProcesses(base); } catch (e) { errors.push(e); } finally { process.env = saved; }
    rmSync(base, { recursive: true, force: true });
    if (errors.length) throw errors[0];
  };
  t?.after(() => fx.cleanup());
  return fx;
}
