// The kernel read verbs over the Northwind fixture (real bare remotes, the real CLI) with the read
// session and the parsed cache: the cache never changes an answer (cold, warm, warm with --max-age,
// against a run that cannot cache at all), two processes filling it at once agree and leave it intact,
// no `git cat-file --batch` child outlives a command (success or failure), and local state — instances,
// oats-local.yaml, the lock — is read afresh on every command, --max-age or not.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildNorthwind, moveMember } from "./fixtures/northwind/build.mjs";
import { inertHarnessPath } from "./helpers/runtime-stub.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const REAL_GIT = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();

let base, fx, dep, env, home;
const cache = () => join(base, "cache");
function oats(args, { extraEnv = {} } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dep, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...env, ...extraEnv }, maxBuffer: 64 * 1024 * 1024 });
}
function oatsAsync(args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: dep, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
}
const json = (r) => { assert.equal(r.status, 0, `exit 0\n${r.stdout.slice(0, 2000)}\n${r.stderr.slice(0, 2000)}`); return JSON.parse(r.stdout); };
/** Per-run fields only: timestamps and the observation block. */
const normal = (doc) => JSON.parse(JSON.stringify(doc, (k, v) => (k === "observedAt" || k === "takenAt" || k === "observation" ? undefined : v)));
const clearStores = () => { rmSync(join(cache(), ".parsed"), { recursive: true, force: true }); rmSync(join(cache(), ".observed"), { recursive: true, force: true }); };
const VERBS = () => ({
  souls: ["souls", "--json"], capabilities: ["capabilities", "--json"], workspaceStatus: ["workspace", "status", "--json"], status: ["status", "--json"],
  inspectSoul: ["inspect", "--soul", "release-manager", "--json"], inspectHome: ["inspect", "--home", home, "--json"],
});

test.before(async () => {
  base = mkdtempSync(join(tmpdir(), "oats-read-cache-"));
  if (/[\s@]/.test(base)) throw new Error(`tmpdir ${base} contains whitespace or @`);
  fx = await buildNorthwind(join(base, "fx"));
  const catalogFile = join(base, "catalog.json");
  writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }, null, 2));
  mkdirSync(join(base, "home"));
  dep = join(base, "northwind-workspace");
  mkdirSync(join(dep, "agents"), { recursive: true });
  writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.agents}\n`);
  env = { ...process.env, PATH: inertHarnessPath(base), PI_AGENT_HOME: "", OATS_HOME: "", PI_AGENTS_ROOT: "", OATS_INSTANCE: "", OATS_INSTANCE_HOME: "",
    OATS_REMOTE_CACHE: cache(), HOME: join(base, "home"), OATS_PACKAGE_CATALOG: catalogFile, OATS_TMUX_SESSION: `none-${process.pid}`, PI_AGENTS_TMUX_SESSION: `none-${process.pid}` };
  json(oats(["sync", "--json"]));
  const spawned = json(oats(["spawn", "release-manager", "--purpose", "rc", "--work", "directory", "--no-launch", "--provider", "oats.okf", "state-dir=/tmp/x", "--json"]));
  home = spawned.result.home;
});
test.after(() => { if (base) { try { chmodSync(cache(), 0o755); } catch {} rmSync(base, { recursive: true, force: true }); } });

test("the cache never changes an answer: cold, warm and warm --max-age 60 equal a run that cannot cache at all (unwritable cache root)", { timeout: 300_000 }, () => {
  clearStores();
  // No cache: the root is read-only, so neither .parsed nor .observed can exist — and every command still succeeds.
  chmodSync(cache(), 0o555);
  const baseline = {};
  try { for (const [name, args] of Object.entries(VERBS())) baseline[name] = json(oats(args)); }
  finally { chmodSync(cache(), 0o755); }
  assert.equal(existsSync(join(cache(), ".parsed")), false);
  for (const [name, args] of Object.entries(VERBS())) {
    clearStores();
    const cold = json(oats(args)), warm = json(oats(args)), aged = json(oats([...args, "--max-age", "60"]));
    assert.deepStrictEqual(normal(cold), normal(baseline[name]), `${name}: cold`);
    assert.deepStrictEqual(normal(warm), normal(baseline[name]), `${name}: warm`);
    assert.deepStrictEqual(normal(aged), normal(baseline[name]), `${name}: warm --max-age 60`);
    const observation = (d) => d.observation ?? d.result?.observation;
    assert.equal(observation(cold), undefined, `${name}: no observation without --max-age`);
    assert.equal(observation(warm), undefined);
    assert.equal(observation(aged).reused, true, `${name}: the heads were reused`);
  }
  assert.ok(readdirSync(join(cache(), ".parsed")).length === 1, "one fingerprint directory");
});

test("two processes filling an empty cache at once: both answers are right and every entry parses afterwards", { timeout: 120_000 }, async () => {
  clearStores();
  const reference = normal(json(oats(["souls", "--json"])));
  clearStores();
  const [a, b] = await Promise.all([oatsAsync(["souls", "--json"]), oatsAsync(["souls", "--json"])]);
  assert.deepStrictEqual(normal(json(a)), reference);
  assert.deepStrictEqual(normal(json(b)), reference);
  const dir = join(cache(), ".parsed");
  const files = readdirSync(dir).flatMap((fp) => readdirSync(join(dir, fp)).map((f) => join(dir, fp, f)));
  assert.ok(files.length > 5);
  for (const f of files) {
    assert.ok(!f.endsWith(".tmp"), `no temp file left: ${f}`);
    assert.equal(JSON.parse(readFileSync(f, "utf8")).v, 1, f);
  }
  for (const f of readdirSync(join(cache(), ".observed"))) JSON.parse(readFileSync(join(cache(), ".observed", f), "utf8"));
});

test("no git cat-file --batch child outlives the command — after success and after a refusal mid-command", { timeout: 120_000 }, async () => {
  const shim = join(base, "shim");
  mkdirSync(shim, { recursive: true });
  const pids = join(base, "batch-pids");
  // A batch child that does not end at stdin EOF (a hung git, or one mid lazy fetch): the shim outlives its
  // git, so only the kernel's group kill can end it — on the success path and after a refusal alike.
  writeFileSync(join(shim, "git"), `#!/bin/bash\nfor a in "$@"; do [ "$a" = "--batch" ] && { echo $$ >> "${pids}"; "${REAL_GIT}" "$@"; exec sleep 60 </dev/null >/dev/null 2>&1; }; done\nexec "${REAL_GIT}" "$@"\n`, { mode: 0o755 });
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  // A refusal exits through process.exit: the exit hook group-kills the batch children, but the process
  // is gone before it can reap them, so the system reaps them a moment later. Killed and not yet reaped
  // is not alive: wait (bounded) for that, and name the state of any pid still there at the deadline.
  const survivors = async (started) => {
    const deadline = Date.now() + 2000;
    while (started.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    return started.filter(alive).map((pid) => `${pid} (${spawnSync("ps", ["-o", "stat=,command=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim() || "gone"})`);
  };
  for (const args of [["souls", "--json"], ["inspect", "--soul", "no-such-soul", "--json"]]) {
    writeFileSync(pids, "");
    clearStores(); // cold: the reads go through the batch
    const r = oats(args, { extraEnv: { PATH: `${shim}:${env.PATH}` } });
    const started = readFileSync(pids, "utf8").split("\n").filter(Boolean).map(Number);
    assert.ok(started.length > 0, `${args[0]}: batch readers were used`);
    if (args[1] === "--soul") assert.equal(JSON.parse(r.stdout).error.code, "E_SOUL_UNKNOWN");
    assert.deepEqual(await survivors(started), [], `${args.join(" ")}: every batch child is gone when the command has exited`);
  }
});

test("the member prefetch (Addendum 3): souls and soul teams observe each head once; teams and inspect --home observe the host only", { timeout: 120_000 }, () => {
  const shim = join(base, "shim-ls");
  mkdirSync(shim, { recursive: true });
  const log = join(base, "ls-remote.log");
  writeFileSync(join(shim, "git"), `#!/bin/bash\n[ "$1" = "ls-remote" ] && echo "$3" >> "${log}"\nexec "${REAL_GIT}" "$@"\n`, { mode: 0o755 });
  const lsRemotes = (args) => {
    writeFileSync(log, "");
    json(oats(args, { extraEnv: { PATH: `${shim}:${env.PATH}` } }));
    return readFileSync(log, "utf8").split("\n").filter(Boolean);
  };
  json(oats(["souls", "--json"])); // the host's record and its workspace entry: the prefetch's source
  const souls = lsRemotes(["souls", "--json"]);
  assert.equal(new Set(souls).size, souls.length, `each head once: ${souls.join(", ")}`);
  assert.equal(souls.length, 5, "the host (also a member) and the four other members");
  // `soul teams <soul>` discovers the whole workspace to find the soul (as it did before the prefetch).
  assert.deepEqual(lsRemotes(["soul", "teams", "release-manager", "--json"]).sort(), [...souls].sort(), "soul teams: each head once");
  for (const args of [["teams", "--json"], ["inspect", "--home", home, "--json"]]) {
    assert.deepEqual(lsRemotes(args), [fx.refs.agents], `${args.slice(0, 2).join(" ")}: the host only, no member prefetch`);
  }
});

test("invalidation: instances, oats-local.yaml and the lock are read afresh — --max-age 60 reflects a retire, a teams edit and a rewritten lock at once", { timeout: 300_000 }, () => {
  const aged = (args) => json(oats([...args, "--max-age", "60"]));
  // An instance spawned now, then retired: status --max-age 60 shows each state immediately.
  const spawned = json(oats(["spawn", "platform-engineer", "--purpose", "tmp", "--work", "directory", "--no-launch", "--json"]));
  const instances = (doc) => doc.agents.flatMap((a) => a.instances.map((i) => i.instance));
  assert.ok(instances(aged(["status", "--json"])).includes(spawned.result.instance));
  json(oats(["retire", spawned.result.instance, "--json"]));
  assert.ok(!instances(aged(["status", "--json"])).includes(spawned.result.instance), "the retire shows on the next --max-age read");
  // A teams edit in oats-local.yaml (what Desktop does through `oats teams` / `oats soul teams`).
  const teamsOf = (doc) => doc.result.souls.find((s) => s.name === "release-manager").teams.map((t) => t.label);
  assert.ok(!teamsOf(aged(["souls", "--json"])).includes("desk"));
  json(oats(["teams", "add", "desk", "--team", "local:desk.example", "--json"]));
  json(oats(["soul", "teams", "release-manager", "--add", "desk", "--json"]));
  assert.ok(teamsOf(aged(["souls", "--json"])).includes("desk"), "the teams edit shows on the next --max-age read");
  // A sync that rewrites the lock (here: without oats.okf).
  const lockFile = join(dep, "oats-lock.json");
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  const before = aged(["workspace", "status", "--json"]).result;
  assert.ok(before.packages.some((p) => p.id === "oats.okf"));
  delete lock.packages["oats.okf"];
  writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n");
  const after = aged(["workspace", "status", "--json"]).result;
  assert.ok(!after.packages.some((p) => p.id === "oats.okf") && after.unsynced.includes("oats.okf"), "the rewritten lock shows on the next --max-age read");
  assert.ok(!aged(["capabilities", "--json"]).result.capabilities.some((c) => c.kind === "package" && c.package === "oats.okf"));
  json(oats(["sync", "--json"]));
});

test("invalidation: a member commit that moves is read at its new commit (a live observation, or --max-age 0)", { timeout: 300_000 }, async () => {
  const soulsOf = (doc) => doc.result.souls.filter((s) => s.repoKey === fx.keys.platform).map((s) => [s.name, s.commit]);
  const before = soulsOf(json(oats(["souls", "--json"])));
  const moved = await moveMember(fx, "platform", async (_work, { writeTree }) => writeTree({ "souls/platform-sre/soul.yaml": { yaml: { schemaVersion: 2, name: "platform-sre", description: "SRE.", work: "directory" } }, "souls/platform-sre/AGENTS.md": "# sre\n" }));
  for (const args of [["souls", "--json"], ["souls", "--json", "--max-age", "0"]]) {
    const now = soulsOf(json(oats(args)));
    assert.ok(now.every(([, c]) => c === moved.commit), `${args.join(" ")}: every platform soul at the new commit`);
    assert.ok(now.some(([n]) => n === "platform-sre"));
    assert.notDeepEqual(now, before);
  }
});
