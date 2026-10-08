// awebai/oats#816: the shared fixture's host isolation. A suite that builds a deployment gets a short
// base, names and paths sized from that base, an explicit environment for every child it starts, and
// a check that no process it started still works in the base when it is cleaned up. These pin the
// helpers themselves; every suite on v2Deployment exercises them in use.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, sep } from "node:path";
import { FS_LIMITS, assertNoFixtureProcesses, fixtureBase, fixtureEnv, nameOfLength, pathOfLength } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const bases = [];
const base = (prefix) => { const b = fixtureBase(prefix); bases.push(b); return b; };
test.after(() => { for (const b of bases) rmSync(b, { recursive: true, force: true }); });

test("#816 fixtureBase: under a long TMPDIR the base is a short /tmp directory, realpath'd once", () => {
  const long = realpathSync(mkdtempSync(join(tmpdir(), "oats-a-temporary-directory-longer-than-twenty-")));
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = long;
  try {
    assert.ok(tmpdir().length > 20, "fixture premise: the TMPDIR is long");
    const b = base("oats-x-");
    assert.equal(dirname(b), realpathSync("/tmp"));
    assert.match(basename(b), /^oats-x-/);
    assert.equal(realpathSync(b), b, "the base is its own realpath");
  } finally {
    if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    rmSync(long, { recursive: true, force: true });
  }
});

test("#816 fixtureBase: under a short TMPDIR the base is in it", () => {
  const short = realpathSync(mkdtempSync("/tmp/o")); // /private/tmp/oXXXXXX on macOS: 19 characters
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = short;
  try {
    assert.ok(tmpdir().length <= 20, `fixture premise: ${tmpdir()} is short`);
    assert.equal(dirname(base("oats-y-")), short);
  } finally {
    if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    rmSync(short, { recursive: true, force: true });
  }
});

test("#816 nameOfLength: the requested length, capped below NAME_MAX and below what the base leaves of PATH_MAX", () => {
  const b = base("oats-n-");
  assert.equal(nameOfLength(b, 40).length, 40);
  const capped = nameOfLength(b, 10_000);
  assert.ok(capped.length < FS_LIMITS.name && capped.length > FS_LIMITS.name - 32, `${capped.length}`);
  assert.doesNotMatch(capped, /[/\0]/);
  // A name that long is creatable under the base: the cap is the filesystem's, with room to spare.
  mkdirSync(join(b, capped));
  // Measured from the base: a base close to PATH_MAX leaves less.
  const deep = "/" + "d".repeat(FS_LIMITS.path - 100);
  assert.ok(nameOfLength(deep, 10_000).length < 100);
});

test("#816 pathOfLength: an absolute path under the base of the requested total length, every segment within NAME_MAX, capped below PATH_MAX", () => {
  const b = base("oats-p-");
  const p = pathOfLength(b, b.length + 600);
  assert.equal(p.length, b.length + 600);
  assert.ok(p.startsWith(`${b}${sep}`));
  for (const segment of p.slice(b.length + 1).split(sep)) assert.ok(segment.length > 0 && segment.length < FS_LIMITS.name - 16, `${segment.length}`);
  const capped = pathOfLength(b, 100_000);
  assert.ok(capped.length < FS_LIMITS.path && capped.length > FS_LIMITS.path - 64, `${capped.length}`);
  mkdirSync(capped, { recursive: true });
  assert.throws(() => pathOfLength(b, b.length), /longer than the base/);
});

test("#816 fixtureEnv: HOME and XDG under the base, git without host config, no proxies or harness marker, the scheduler stubs ahead of the host PATH", () => {
  const b = base("oats-e-");
  const saved = { ...process.env };
  Object.assign(process.env, { HTTPS_PROXY: "http://proxy.invalid", http_proxy: "http://proxy.invalid", ALL_PROXY: "x", no_proxy: "x", CLAUDECODE: "1",
    GIT_CONFIG_PARAMETERS: "'credential.helper'='osxkeychain'", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "store", GIT_ASKPASS: "/bin/echo" });
  let env;
  try { env = fixtureEnv(b, { extra: { OATS_X: "1" } }); } finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
  assert.equal(env.HOME, join(b, "home"));
  for (const k of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) assert.ok(env[k].startsWith(`${env.HOME}${sep}`), k);
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  for (const k of ["HTTPS_PROXY", "http_proxy", "ALL_PROXY", "no_proxy", "CLAUDECODE", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_ASKPASS"]) assert.equal(k in env, false, k);
  assert.equal(env.OATS_X, "1", "extra is applied");
  const [first, ...rest] = env.PATH.split(delimiter);
  assert.equal(first, join(b, "fixture-bin"));
  assert.equal(rest.join(delimiter), process.env.PATH, "then the host PATH");
  // git reads no host configuration: no credential helper, whatever the host's git config says.
  const helper = spawnSync("git", ["config", "--get", "credential.helper"], { env, encoding: "utf8" });
  assert.equal(helper.stdout, "");
  // The host's service manager is never asked: the fixture's launchctl and systemctl answer "not loaded".
  for (const [tool, args] of [["launchctl", ["print", "gui/501/ai.oats.schedule"]], ["systemctl", ["--user", "is-active", "oats-schedule.timer"]]]) {
    const r = spawnSync(tool, args, { env, encoding: "utf8" });
    assert.equal(r.status, 3, tool);
    assert.equal(r.stdout.trim(), "inactive", tool);
  }
});

test("#816 assertNoFixtureProcesses: fails naming a process left working in the base, passes once it is gone", async () => {
  const b = base("oats-l-");
  mkdirSync(join(b, "work"));
  assertNoFixtureProcesses(b);
  // Not this process's child: the scan, as the kernel's own, leaves out its caller and its children.
  const pid = Number(execFileSync("sh", ["-c", `(cd "$1" && exec sleep 600) >/dev/null 2>&1 & echo $!`, "sh", join(b, "work")], { encoding: "utf8" }).trim());
  try {
    assert.throws(() => assertNoFixtureProcesses(b, { settleMs: 200 }), (e) => e.message.includes(`pid ${pid} sleep`) && e.message.includes(b));
  } finally { process.kill(pid, "SIGKILL"); }
  assertNoFixtureProcesses(b);
});

test("#816 assertNoFixtureProcesses: works whatever PATH the test gives the kernel, one without lsof included", () => {
  const b = base("oats-q-");
  const pid = Number(execFileSync("sh", ["-c", `(cd "$1" && exec sleep 600) >/dev/null 2>&1 & echo $!`, "sh", b], { encoding: "utf8" }).trim());
  const saved = process.env.PATH;
  process.env.PATH = join(b, "no-tools");
  try {
    // A settle long enough that the check waits between scans at least once, on any host.
    assert.throws(() => assertNoFixtureProcesses(b, { settleMs: 5000 }), (e) => e.message.includes(`pid ${pid} sleep`));
  } finally { process.env.PATH = saved; process.kill(pid, "SIGKILL"); }
});

test("#816 v2Deployment: an in-process call creates nothing, before or after cleanup, and leaves the scheduler stubs as they are", async () => {
  const fx = v2Deployment();
  try {
    const stub = join(fx.base, "fixture-bin", "launchctl");
    const before = statSync(stub).mtimeMs;
    await fx.inEnv(() => {});
    assert.equal(statSync(stub).mtimeMs, before, "the stub is not rewritten");
  } finally { fx.cleanup(); }
  await fx.inEnv(() => {});
  assert.equal(existsSync(fx.base), false, "nothing is recreated under a removed base");
});

test("#816 v2Deployment: its base, its children's environment and its in-process calls follow the fixture rules, and its cleanup checks for leftover processes", async () => {
  const fx = v2Deployment();
  let leftover;
  try {
    assert.ok(fx.base.length < 40, fx.base);
    assert.equal(fx.env.GIT_CONFIG_GLOBAL, "/dev/null");
    assert.equal(fx.env.PATH.split(delimiter)[1], join(fx.base, "fixture-bin"), "its inert harnesses, then the stubs");
    const saved = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = "http://proxy.invalid";
    try {
      const seen = await fx.inEnv(() => ({ proxy: process.env.HTTPS_PROXY, global: process.env.GIT_CONFIG_GLOBAL, first: process.env.PATH.split(delimiter)[0] }));
      assert.deepEqual(seen, { proxy: undefined, global: "/dev/null", first: join(fx.base, "fixture-bin") });
      assert.equal(process.env.HTTPS_PROXY, "http://proxy.invalid", "restored afterwards");
    } finally { if (saved === undefined) delete process.env.HTTPS_PROXY; else process.env.HTTPS_PROXY = saved; }
    leftover = Number(execFileSync("sh", ["-c", `(cd "$1" && exec sleep 600) >/dev/null 2>&1 & echo $!`, "sh", fx.dep], { encoding: "utf8" }).trim());
    assert.throws(() => fx.cleanup(), (e) => e.message.includes(`pid ${leftover} sleep`));
    assert.equal(existsSync(fx.base), false, "the base is removed even when the check fails");
  } finally {
    if (leftover) { try { process.kill(leftover, "SIGKILL"); } catch { /* gone */ } }
    rmSync(fx.base, { recursive: true, force: true });
  }
});
