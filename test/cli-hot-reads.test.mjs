// The CLI's hot reads (awebai/oats#1630, lib/hot-reads.mjs) load only the modules they use: run over the
// Northwind fixture with a load hook, none of them loads core.mjs or the heavy modules beside it, on its
// answer's path or its refusals'. Absences only: what a read does load is free to change. A command that
// is not a hot read loads core.mjs as before, which also shows the hook sees what is loaded. And a name a
// hot read does not list is a tripwire: taking it is free, and its first use throws a defect naming it. The warm
// reader (`oats reader --stdio`) is a hot-read form too: until its hello it loads the reads' own closure and bin's
// dispatch, no heavy module; its row also checks that the reads did load, so its record reaches the hello.
import test from "node:test";
import assert from "node:assert/strict";
import module from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { buildNorthwind } from "./fixtures/northwind/build.mjs";
import { privateTmuxTmpdir, removeTmuxTmpdir } from "./helpers/host-fixture.mjs";
import { inertHarnessPath } from "./helpers/runtime-stub.mjs";
import { HotReadUnlisted, hotImport, hotLeaves, hotRead, standIn } from "../lib/hot-reads.mjs";
import { isDefect } from "../lib/errors.mjs";

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

test("the warm reader loads no core.mjs: its hello comes after the reads' own closure, bin's dispatch only besides", { skip: NO_HOOKS, timeout: 300_000 }, async (t) => {
  // As a client starts it: the hello read, then stdin closed, which ends it (exit 0). The hook writes at that exit, so
  // what it records is everything the reader loaded until its hello, and nothing it loads on a request.
  writeFileSync(loadedFile, "");
  const child = spawn(process.execPath, ["--import", hook, CLI, "reader", "--stdio"], { cwd: dep, env: { ...env, HOT_READS_LOADED: loadedFile }, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stderr.setEncoding("utf8").on("data", (d) => { err += d; });
  const exited = new Promise((done) => child.on("exit", (code) => done(code)));
  // A failed assertion or a cancelled test leaves no reader behind: its stdin closed, then killed if still running.
  t.after(async () => {
    child.stdin.destroy();
    if (child.exitCode === null && child.signalCode === null) {
      const gone = await Promise.race([exited.then(() => true), new Promise((done) => setTimeout(done, 5000, false))]);
      if (!gone) child.kill("SIGKILL");
    }
  });
  const hello = await new Promise((done, fail) => {
    child.stdout.setEncoding("utf8").on("data", (d) => { out += d; if (out.includes("\n")) done(JSON.parse(out.slice(0, out.indexOf("\n")))); });
    child.on("exit", () => fail(new Error(`the reader exited before its hello\n${err}`)));
  });
  assert.equal(hello.readerApi, 1, JSON.stringify(hello));
  child.stdin.end();
  assert.equal(await exited, 0, err);
  const loaded = JSON.parse(readFileSync(loadedFile, "utf8"));
  for (const m of ["lib/roster-read.mjs", "lib/workspace-read.mjs"]) assert.ok(loaded.some((url) => url.endsWith(`/${m}`)), `the reader loaded ${m} before its hello`);
  for (const m of HEAVY) assert.deepEqual(loaded.filter((url) => url.endsWith(`/${m}`)), [], `oats reader --stdio loads no ${m}`);
  // Bare `oats reader` is the same form: its usage refusal loads none of them either.
  assertAbsent(["reader"], HEAVY, 1);
});

test("any other command, and a hot read given another flag, loads core.mjs as before", { skip: NO_HOOKS, timeout: 300_000 }, () => {
  for (const args of [["souls", "--json"], ["status", "--help"], ["instance", "waiting", "set", "--json"], ["reader", "--stdio", "--json"]]) {
    const r = loads(args);
    assert.ok(r.loaded.some((url) => url.endsWith("/lib/core.mjs")), `oats ${args.join(" ")} loads core.mjs`);
  }
});

test("help is never a hot read: -h or --help as a flag's value, spaced or inline, prints the command's usage in both modes", { skip: NO_HOOKS, timeout: 300_000 }, () => {
  const forms = [["session", "inspect", "--home", "-h"], ["session", "inspect", "--home=-h"], ["status", "--dir", "-h"], ["status", "--dir=-h"], ["status", "--dir", "--help"], ["workspace", "status", "--dir=-h"],
    ["instance", "events", "x", "--since", "-h"], ["instance", "waiting", "clear", "--producer", "-h"], ["instance", "waiting", "clear", "--producer=-h"]];
  for (const form of forms) {
    assert.equal(hotRead(form), null, form.join(" "));
    const json = loads([...form, "--json"]);
    assert.equal(json.status, 0, `oats ${form.join(" ")} --json: exit 0\n${json.out.slice(0, 2000)}`);
    const doc = JSON.parse(json.out);
    assert.equal(doc.ok, true); assert.equal(doc.result.command, form[0]); assert.ok(Array.isArray(doc.result.usage) && doc.result.usage.length > 0, form.join(" "));
    const text = loads(form);
    assert.equal(text.status, 0, `oats ${form.join(" ")}: exit 0\n${text.out.slice(0, 2000)}`);
    assert.match(text.out, /^Usage:\n  oats /, form.join(" "));
  }
});

test("a hot read's listed names are its leaves' own; anything else is a tripwire that throws on use", async () => {
  const read = hotRead(["version", "--json"]);
  assert.equal(read.form, "version");
  assert.deepEqual(hotLeaves(read, "core"), ["version"]);
  assert.deepEqual(hotLeaves(read, "workspace"), []);
  assert.deepEqual(hotLeaves(read, "yaml"), []);
  assert.equal(hotRead(["version", "--help"]), null, "a flag the form does not take is no hot read");
  const version = await import("../lib/version.mjs");
  // As bin/oats.mjs takes them: the line awaited, its names destructured. Neither touches a tripwire.
  const { OATS_VERSION, listInstances } = await Promise.resolve(standIn(read, "core", [version]));
  assert.equal(OATS_VERSION, version.OATS_VERSION);
  const { loadLocal } = await Promise.resolve(standIn(read, "workspace", []));
  const message = (name, line) => `oats version is a hot read, and it used ${name} of ${line}, which lib/hot-reads.mjs does not list for it: list the module that defines ${name} under that line in the read's entry in lib/hot-reads.mjs`;
  for (const [use, name, line] of [
    [() => listInstances("/x"), "listInstances", "lib/core.mjs"],
    [() => new listInstances(), "listInstances", "lib/core.mjs"],
    [() => `${loadLocal}`, "loadLocal", "lib/workspace.mjs"],
    [() => loadLocal.length, "loadLocal", "lib/workspace.mjs"],
    [() => "x" in loadLocal, "loadLocal", "lib/workspace.mjs"],
    [() => Object.keys(loadLocal), "loadLocal", "lib/workspace.mjs"],
  ]) {
    assert.throws(use, (e) => e instanceof HotReadUnlisted && e.name === "HotReadUnlisted" && e.message === message(name, line) && isDefect(e), String(use));
  }
  // A namespace taken whole (remoteModule, A): its own names live, any other a tripwire.
  const ns = standIn(read, "core", [version]);
  assert.equal(ns.PKG_ROOT, version.PKG_ROOT);
  assert.throws(() => ns.ensureRoot("/x"), HotReadUnlisted);
});

test("every leaf a hot read lists loads, and bin names each import line by the one literal it imports", async () => {
  const forms = [["version"], ["session", "inspect"], ["status"], ["status", "--server", "s"], ["workspace", "status"], ["instance", "events", "x"], ["instance", "waiting", "clear"], ["reader", "--stdio"]];
  for (const argv of forms) {
    const read = hotRead(argv);
    assert.ok(read, argv.join(" "));
    for (const name of Object.keys(read.lines)) assert.ok(Object.keys(await hotImport(read, name)).length > 0 || hotLeaves(read, name).length === 0, `${read.form}: ${name}`);
  }
  // `kernelImport("<name>", () => import("<specifier>"))`: the hot path reads the name, the full path the literal.
  const lines = [...readFileSync(CLI, "utf8").matchAll(/await kernelImport\("([^"]+)", \(\) => import\("([^"]+)"\)\)/g)];
  assert.ok(lines.length > 30, "bin's import lines were read");
  for (const [, name, specifier] of lines) assert.equal(specifier, name === "yaml" ? "yaml" : `../lib/${name}.mjs`, `kernelImport("${name}")`);
  assert.doesNotMatch(readFileSync(CLI, "utf8"), /kernelImport\((?!"[^"]+", \(\) => import\("[^"]+"\)\))/, "every kernelImport call has that one shape");
});
