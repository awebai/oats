// `--max-age <seconds>` (feature observe-max-age; docs/desktop-cli-api.md "Observation reuse") over the
// Northwind fixture and the real CLI: which forms take it (one allow-list at dispatch, every other form
// refused with an exact E_BAD_ARGS message before anything is read or written), the values it takes, the
// `observation` block it adds (absent without the flag; `--max-age 0` is live; the OLDEST head used
// wins), the boundary, and the feature/help surface.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildNorthwind } from "./fixtures/northwind/build.mjs";
import { inertHarnessPath } from "./helpers/runtime-stub.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const READS = "status, workspace status, souls, capabilities, inspect --soul|--home, and the read forms of teams and soul teams";
const refusedBy = (form) => `--max-age is not accepted by \`oats ${form}\`: only the read verbs reuse observations (${READS})`;

let base, fx, dep, env, home;
const cache = () => join(base, "cache");
const observed = () => join(cache(), ".observed");
function oats(args, { cwd = dep } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env, maxBuffer: 64 * 1024 * 1024 });
}
const json = (r) => { assert.equal(r.status, 0, `exit 0\n${r.stdout.slice(0, 2000)}\n${r.stderr.slice(0, 2000)}`); return JSON.parse(r.stdout); };
const observationOf = (doc) => doc.observation ?? doc.result?.observation;
const records = () => readdirSync(observed()).map((f) => ({ file: join(observed(), f), ...JSON.parse(readFileSync(join(observed(), f), "utf8")) }));
const recordFor = (key) => { const r = records().find((x) => x.key === key && x.args.length === 1 && x.args[0] === "HEAD"); assert.ok(r, `a HEAD record for ${key}`); return r; };
const setObservedAt = (rec, iso) => { const { file, ...body } = rec; writeFileSync(file, JSON.stringify({ ...body, observedAt: iso })); };
const ago = (ms) => new Date(Date.now() - ms).toISOString();

test.before(async () => {
  base = mkdtempSync(join(tmpdir(), "oats-max-age-"));
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
  home = json(oats(["spawn", "release-manager", "--purpose", "rc", "--work", "directory", "--no-launch", "--provider", "oats.okf", "state-dir=/tmp/x", "--json"])).result.home;
});
test.after(() => { if (base) rmSync(base, { recursive: true, force: true }); });

test("the read verbs take --max-age and add observation { observedAt, reused }; without the flag the key is absent", { timeout: 300_000 }, () => {
  const forms = { status: ["status"], workspaceStatus: ["workspace", "status"], souls: ["souls"], capabilities: ["capabilities"], inspectSoul: ["inspect", "--soul", "release-manager"],
    inspectHome: ["inspect", "--home", home], teams: ["teams"], soulTeams: ["soul", "teams", "release-manager"] };
  for (const [name, args] of Object.entries(forms)) {
    const plain = json(oats([...args, "--json"]));
    assert.equal(observationOf(plain), undefined, `${name}: no observation without --max-age`);
    assert.ok(!JSON.stringify(plain).includes('"reused"'), `${name}: nothing else added`);
    const aged = json(oats([...args, "--max-age", "60", "--json"]));
    const obs = observationOf(aged);
    assert.deepEqual(Object.keys(obs), ["observedAt", "reused"], name);
    assert.ok(!Number.isNaN(Date.parse(obs.observedAt)) && typeof obs.reused === "boolean", name);
    // The inline spelling is the same flag.
    assert.ok(observationOf(json(oats([...args, "--max-age=60", "--json"]))), `${name}: --max-age=60`);
  }
  // status carries it at the top level (its document has no result envelope), right after agents.
  const keys = Object.keys(json(oats(["status", "--max-age", "60", "--json"])));
  assert.equal(keys[keys.indexOf("agents") + 1], "observation");
});

test("--max-age values: whole seconds 0–86400, each refusal exact (E_BAD_ARGS), before anything is read", () => {
  for (const [argv, message] of [
    [["--max-age"], "--max-age needs a value: whole seconds from 0 to 86400"],
    [["--max-age", "--json"], "--max-age needs a value: whole seconds from 0 to 86400"],
    [["--max-age="], "--max-age= needs a value"],
    [["--max-age", "-1"], '--max-age takes whole seconds from 0 to 86400, got "-1"'],
    [["--max-age", "1.5"], '--max-age takes whole seconds from 0 to 86400, got "1.5"'],
    [["--max-age", "abc"], '--max-age takes whole seconds from 0 to 86400, got "abc"'],
    [["--max-age", "86401"], '--max-age takes whole seconds from 0 to 86400, got "86401"'],
    [["--max-age", "123456"], '--max-age takes whole seconds from 0 to 86400, got "123456"'],
  ]) {
    const r = oats(["souls", ...argv, "--json"], { cwd: base });
    assert.equal(r.status, 1, argv.join(" "));
    assert.deepEqual(JSON.parse(r.stdout).error, { code: "E_BAD_ARGS", message }, argv.join(" "));
  }
  for (const ok of ["0", "86400", "00060"]) assert.ok(observationOf(json(oats(["souls", "--max-age", ok, "--json"]))), ok);
});

test("structural refusal: every other command, every edit form and --server refuse --max-age with the exact message, changing nothing", { timeout: 120_000 }, () => {
  const localBefore = readFileSync(join(dep, "oats-local.yaml"), "utf8"), lockBefore = readFileSync(join(dep, "oats-lock.json"), "utf8");
  const instancesBefore = readdirSync(join(dep, "agents")).sort();
  const cases = [
    [["sync"], refusedBy("sync")],
    [["spawn", "release-manager", "--preview"], refusedBy("spawn")],
    [["spawn", "release-manager", "--purpose", "x", "--no-launch"], refusedBy("spawn")],
    [["retire", "release-manager-rc"], refusedBy("retire")],
    [["onboard", fx.refs.agents], refusedBy("onboard")],
    [["package", "add", "oats.okf"], refusedBy("package add")],
    [["update"], refusedBy("update")],
    [["readiness", "--soul", "release-manager"], refusedBy("readiness")],
    [["operation", "run", "x", "--soul", "release-manager"], refusedBy("operation run")],
    [["teams", "add", "desk", "--team", "local:desk.example"], refusedBy("teams add")],
    [["teams", "remove", "desk"], refusedBy("teams remove")],
    [["teams", "default", "desk"], refusedBy("teams default")],
    [["soul", "teams", "release-manager", "--add", "desk"], refusedBy("soul teams --add")],
    [["soul", "teams", "release-manager", "--remove", "desk"], refusedBy("soul teams --remove")],
    [["soul", "teams", "release-manager", "--default", "desk"], refusedBy("soul teams --default")],
    [["soul", "teams", "release-manager", "--clear-default"], refusedBy("soul teams --clear-default")],
    [["workspace", "validate"], refusedBy("workspace validate")],
    [["doctor"], refusedBy("doctor")],
    [["status", "--server", "http://127.0.0.1:9"], "--max-age cannot be combined with --server: observation reuse is local to this machine"],
    [["inspect", "--soul", "release-manager", "--server", "http://127.0.0.1:9"], "--max-age cannot be combined with --server: observation reuse is local to this machine"],
  ];
  for (const [argv, message] of cases) {
    for (const flagArgs of [["--max-age", "60"], ["--max-age", "nope"]]) {
      const r = oats([...argv, ...flagArgs, "--json"]);
      assert.equal(r.status, 1, `${argv.join(" ")}: ${r.stdout}${r.stderr}`);
      assert.deepEqual(JSON.parse(r.stdout).error, { code: "E_BAD_ARGS", message }, `${argv.join(" ")} ${flagArgs.join(" ")}`);
    }
  }
  // Text mode refuses the same way.
  const text = oats(["sync", "--max-age", "60"]);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /--max-age is not accepted by `oats sync`/);
  assert.equal(readFileSync(join(dep, "oats-local.yaml"), "utf8"), localBefore);
  assert.equal(readFileSync(join(dep, "oats-lock.json"), "utf8"), lockBefore);
  assert.deepEqual(readdirSync(join(dep, "agents")).sort(), instancesBefore);
});

test("--max-age 0 is live: nothing reused, observedAt from this run, and the run records what it observed", { timeout: 120_000 }, () => {
  json(oats(["souls", "--json"])); // a record exists…
  const started = Date.now() - 1000;
  const doc = json(oats(["souls", "--max-age", "0", "--json"]));
  assert.equal(doc.result.observation.reused, false);
  assert.ok(Date.parse(doc.result.observation.observedAt) >= started, "…but it is not used");
  assert.ok(Date.parse(recordFor(fx.keys.agents).observedAt) >= started, "the live observation was recorded");
});

test("oldest wins: one head reused (its recorded time) and one observed live → observation is the reused, older time with reused: true", { timeout: 120_000 }, () => {
  json(oats(["workspace", "status", "--json"]));
  const old = ago(30_000);
  setObservedAt(recordFor(fx.keys.agents), old);       // the host: fresh enough for 60 s
  setObservedAt(recordFor(fx.keys.platform), ago(600_000)); // a member: expired, observed live
  const started = Date.now() - 1000;
  const doc = json(oats(["workspace", "status", "--max-age", "60", "--json"]));
  assert.deepEqual(doc.result.observation, { observedAt: old, reused: true });
  assert.equal(doc.result.workspace.observedAt, old, "the workspace's own observedAt is the recorded time");
  assert.ok(Date.parse(recordFor(fx.keys.platform).observedAt) >= started, "the expired member was observed live and recorded");
  assert.equal(recordFor(fx.keys.agents).observedAt, old, "a reused record is not rewritten");
});

test("the boundary: a head recorded 61 s ago is observed again under --max-age 60, one recorded 30 s ago is reused", { timeout: 120_000 }, () => {
  json(oats(["souls", "--json"]));
  const every = (iso) => { for (const r of records()) setObservedAt(r, iso); };
  every(ago(61_000));
  const started = Date.now() - 1000;
  const stale = json(oats(["souls", "--max-age", "60", "--json"])).result.observation;
  assert.equal(stale.reused, false);
  assert.ok(Date.parse(stale.observedAt) >= started);
  const at = ago(30_000);
  every(at);
  assert.deepEqual(json(oats(["souls", "--max-age", "60", "--json"])).result.observation, { observedAt: at, reused: true });
  // A record from the future (clock skew beyond 5 s) is never trusted.
  every(new Date(Date.now() + 3_600_000).toISOString());
  assert.equal(json(oats(["souls", "--max-age", "60", "--json"])).result.observation.reused, false);
});

test("the observation store names no url: records carry a sha256 url digest, never the fetch url", () => {
  json(oats(["souls", "--json"]));
  // A local remote's ref is its path, which is also its fetch url.
  assert.equal(recordFor(fx.keys.agents).urlDigest, createHash("sha256").update(fx.refs.agents).digest("hex"));
  for (const r of records()) {
    assert.deepEqual(Object.keys(r).filter((k) => k !== "file"), ["v", "key", "args", "urlDigest", "commit", "ref", "observedAt"]);
    assert.ok(!readFileSync(r.file, "utf8").includes("file://"), `${r.file} carries no url`);
  }
});

/** Help as a consumer reads it: through a pipe (the full ~20 KB, not the first 8 KB). */
function helpText(args) {
  const r = oats(args, { cwd: base });
  assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

test("feature and help surface: observe-max-age in `oats version --json` features; `oats --help` and each read verb's help name the flag", () => {
  assert.ok(json(oats(["version", "--json"], { cwd: base })).features.includes("observe-max-age"));
  for (const top of [["--help"], ["help"], []]) {
    const text = helpText(top);
    assert.match(text, /Observation reuse \(feature observe-max-age\):\n  --max-age <seconds> /, `oats ${top.join(" ")} through a pipe`);
    assert.match(text, /\nLayers: .*\n$/, `oats ${top.join(" ")}: the usage's last line arrives`);
  }
  for (const [command, verb] of [["status", "status"], ["workspace", "workspace status"], ["souls", "souls"], ["capabilities", "capabilities"], ["inspect", "inspect"], ["teams", "teams"], ["soul", "soul teams"]]) {
    const lines = helpText([command, "--help"]).split("\n");
    const at = lines.findIndex((l) => l.startsWith(`  oats ${verb} `));
    assert.ok(at >= 0, `oats ${command} --help: the \`oats ${verb}\` usage`);
    const end = lines.findIndex((l, i) => i > at && !/^ {6}/.test(l));
    assert.ok(lines.slice(at, end).some((l) => l.includes("[--max-age <s>]")), `oats ${command} --help names [--max-age <s>] for oats ${verb}`);
  }
});
