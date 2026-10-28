// The CLI's hot reads (awebai/oats#1630, lib/hot-reads.mjs) load only the modules they use: run over the
// Northwind fixture with a load hook, none of them loads core.mjs or the heavy modules beside it, on its
// answer's path or its refusals'. Absences only: what a read does load is free to change. A command that
// is not a hot read loads core.mjs as before, which also shows the hook sees what is loaded.
import test from "node:test";
import assert from "node:assert/strict";
import module from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { buildNorthwind } from "./fixtures/northwind/build.mjs";
import { privateTmuxTmpdir, removeTmuxTmpdir } from "./helpers/host-fixture.mjs";
import { inertHarnessPath } from "./helpers/runtime-stub.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const NO_HOOKS = typeof module.registerHooks !== "function" && "module.registerHooks is newer than this Node";
/** What no local hot read loads. */
const HEAVY = ["lib/core.mjs", "lib/schedule.mjs", "lib/triggers.mjs", "lib/materialize.mjs", "lib/instance-resolution.mjs", "lib/instance-lifecycle.mjs", "lib/servers.mjs"];
const YAML = "node_modules/yaml/";

let base, dep, env, home, instance, tmuxTmpdir, hook, loadedFile;
function loads(args) {
  writeFileSync(loadedFile, "");
  const r = spawnSync(process.execPath, ["--import", hook, CLI, ...args], { cwd: dep, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOT_READS_LOADED: loadedFile }, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: r.stdout + r.stderr, loaded: JSON.parse(readFileSync(loadedFile, "utf8") || "null") };
}
function assertAbsent(args, absent, status) {
  const r = loads(args);
  assert.equal(r.status, status, `oats ${args.join(" ")}: exit ${status}\n${r.out.slice(0, 2000)}`);
  assert.ok(Array.isArray(r.loaded) && r.loaded.length > 0, `oats ${args.join(" ")}: the hook recorded its modules`);
  // A module is a file's path ending; a package is its directory, any file below it.
  for (const m of absent) assert.deepEqual(r.loaded.filter((url) => (m.endsWith("/") ? url.includes(`/${m}`) : url.endsWith(`/${m}`))), [], `oats ${args.join(" ")} loads no ${m}`);
}

test.before(async () => {
  if (NO_HOOKS) return;
  base = mkdtempSync(join(tmpdir(), "oats-hot-reads-"));
  tmuxTmpdir = privateTmuxTmpdir();
  const fx = await buildNorthwind(join(base, "fx"));
  const catalogFile = join(base, "catalog.json");
  writeFileSync(catalogFile, JSON.stringify({ packages: fx.catalog }, null, 2));
  mkdirSync(join(base, "home"));
  dep = join(base, "northwind-workspace");
  mkdirSync(join(dep, "agents"), { recursive: true });
  writeFileSync(join(dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: ${fx.refs.agents}\n`);
  env = { ...process.env, PATH: inertHarnessPath(base), PI_AGENT_HOME: "", OATS_HOME: "", PI_AGENTS_ROOT: "", OATS_INSTANCE: "", OATS_INSTANCE_HOME: "",
    OATS_REMOTE_CACHE: join(base, "cache"), HOME: join(base, "home"), OATS_PACKAGE_CATALOG: catalogFile, OATS_TMUX_SESSION: `none-${process.pid}`, PI_AGENTS_TMUX_SESSION: `none-${process.pid}`, TMUX_TMPDIR: tmuxTmpdir };
  const run = (args) => { const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dep, encoding: "utf8", env }); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout); };
  run(["sync", "--json"]);
  home = run(["spawn", "release-manager", "--purpose", "rc", "--work", "directory", "--no-launch", "--provider", "oats.okf", "state-dir=/tmp/x", "--json"]).result.home;
  instance = basename(home);
  // Every file module the CLI loads, in the order it loads them, written at exit (a refusal exits too).
  hook = join(base, "loads.mjs");
  loadedFile = join(base, "loaded.json");
  writeFileSync(hook, [
    'import module from "node:module";',
    'import { writeFileSync } from "node:fs";',
    "const loaded = [];",
    'module.registerHooks({ load(url, context, nextLoad) { if (url.startsWith("file:")) loaded.push(url); return nextLoad(url, context); } });',
    'process.on("exit", () => writeFileSync(process.env.HOT_READS_LOADED, JSON.stringify(loaded)));',
  ].join("\n"));
});
test.after(() => { try { if (tmuxTmpdir) removeTmuxTmpdir(tmuxTmpdir); } finally { if (base) rmSync(base, { recursive: true, force: true }); } });

test("version and session inspect load neither core.mjs nor yaml nor the remote reads", { skip: NO_HOOKS, timeout: 300_000 }, () => {
  const absent = [...HEAVY, "lib/remote.mjs", YAML];
  for (const args of [["version"], ["version", "--json"], ["-v"], ["session", "inspect", "--home", home, "--json"], ["session", "inspect", "--home", home]]) assertAbsent(args, absent, 0);
  assertAbsent(["session", "inspect", "--json"], absent, 1);
});

test("status and workspace status load no core.mjs, in both modes, with and without --max-age", { skip: NO_HOOKS, timeout: 300_000 }, () => {
  for (const args of [["status", "--json"], ["status", "--json", "--max-age", "60"], ["status", "--max-age", "60"], ["status", "--verbose"], ["workspace", "status", "--json", "--max-age", "60"], ["workspace", "status"]]) assertAbsent(args, HEAVY, 0);
  for (const args of [["status", "--max-age", "x", "--json"], ["workspace", "status", "--dir", join(base, "home"), "--json"]]) assertAbsent(args, HEAVY, 1);
});

test("instance events and instance waiting clear load no core.mjs and no remote reads", { skip: NO_HOOKS, timeout: 300_000 }, () => {
  const absent = [...HEAVY, "lib/remote.mjs"];
  assertAbsent(["instance", "events", instance, "--json"], absent, 0);
  assertAbsent(["instance", "events", instance, "--limit", "3"], absent, 0);
  assertAbsent(["instance", "events", "no-such-instance", "--json"], absent, 1);
  assertAbsent(["instance", "waiting", "clear", "--producer", "hot-reads-test", "--home", home, "--json"], absent, 0);
  assertAbsent(["instance", "waiting", "clear", "--json"], absent, 1);
});

test("a status routed to a server loads no core.mjs", { skip: NO_HOOKS, timeout: 300_000 }, () => {
  assertAbsent(["status", "--server", "no-such-server", "--json"], ["lib/core.mjs"], 1);
  assertAbsent(["status", "--server", "no-such-server"], ["lib/core.mjs"], 1);
});

test("any other command, and a hot read given another flag, loads core.mjs as before", { skip: NO_HOOKS, timeout: 300_000 }, () => {
  for (const args of [["souls", "--json"], ["status", "--help"], ["instance", "waiting", "set", "--json"]]) {
    const r = loads(args);
    assert.ok(r.loaded.some((url) => url.endsWith("/lib/core.mjs")), `oats ${args.join(" ")} loads core.mjs`);
  }
});
