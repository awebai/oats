// The machine's launch configurations (awebai/oats#1506): `$OATS_HOME_DIR/config/launch-configs.yaml`, else
// `~/.oats/config/launch-configs.yaml`, holds one key, `launch-configs:`, with the deployment block's schema.
// Every deployment on the machine reads it under its own oats-local.yaml: an entry of the same name in the
// deployment replaces the machine's whole (its `shadows` names the machine file), a deployment default for a
// harness wins over the machine's, and with no deployment in reach the machine's entries are what applies.
// A missing file is no machine layer; a broken one is an error naming it. Nothing in OATS writes it.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { v2Deployment, CLI } from "./helpers/v2-deployment.mjs";
import { launchConfigsAt } from "../lib/core.mjs";

const OPUS = { harness: "claude", model: "claude-opus-5-5" };
const FILE = "launch-configs.yaml";
const machineDir = (fx) => join(fx.env.OATS_HOME_DIR, "config");
const machineFile = (fx) => join(machineDir(fx), FILE);
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
const writeMachine = (fx, value) => write(machineFile(fx), typeof value === "string" ? value : YAML.stringify(value));
const ok = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); const j = r.json(); assert.equal(j.ok, true, `${what}: ${r.stdout}`); return j.result; };
const failed = (r, what) => { const j = r.json(); assert.equal(j.ok, false, `${what}: ${r.stdout}`); return j.error; };
function stubbedPath(t, fx) { const saved = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = saved; }); }
function fixture(t, local = {}) {
  const fx = v2Deployment({ name: "acme", souls: { dev: {}, writer: { soul: { launch: OPUS } } }, local });
  t.after(fx.cleanup); stubbedPath(t, fx);
  return fx;
}
const rows = (fx, cwd) => ok(fx.cli(["launch-config", "list", "--json"], cwd ? { cwd } : undefined), "list").configurations;
const byName = (list) => Object.fromEntries(list.map((r) => [r.name, r]));

test("a machine-only configuration: spawn --preview selects it, names the machine directory as its source, and the spawn records it", async (t) => {
  const fx = fixture(t);
  writeMachine(fx, { "launch-configs": { auto: { harness: "claude", args: ["--permission-mode", "auto"], default: true } } });
  const preview = ok(fx.cli(["spawn", "writer", "--preview", "--json"]), "preview");
  assert.deepEqual([preview.harness, preview.launchConfig, preview.launchConfigDefault, preview.launchConfigSource], ["claude", "auto", true, machineDir(fx)]);
  assert.ok(fx.cli(["spawn", "writer", "--preview"]).stdout.includes(`via launch configuration auto (this machine's claude default) from ${machineFile(fx)}`), "the text names the machine file");
  const listed = byName(rows(fx));
  assert.deepEqual([listed.auto.source, listed.auto.shadows, listed.auto.default], [machineDir(fx), [], true]);
  const { home } = await fx.spawn("writer", { instance: "writer-1" });
  const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  assert.deepEqual([meta.launch.launchConfig, meta.launch.launchConfigSource, meta.launch.args.includes("auto")], ["auto", machineDir(fx), true]);
  // The home runs what it recorded: a later edit of the machine file does not change its start.
  writeMachine(fx, { "launch-configs": { auto: { harness: "claude", args: ["--changed"], default: true } } });
  const recorded = ok(fx.cli(["launch-config", "preview", "--home", home, "--json"]), "recorded preview");
  assert.deepEqual([recorded.launchConfig, recorded.launchConfigSource, recorded.argv.includes("--changed")], ["auto", machineDir(fx), false]);
});

test("a deployment entry of the same name replaces the machine's whole, and its shadows names the machine file", async (t) => {
  const fx = fixture(t, { "launch-configs": { shared: { harness: "claude", args: ["--deployment"] } } });
  writeMachine(fx, { "launch-configs": { shared: { harness: "claude", args: ["--machine"], model: "claude-sonnet-5", yolo: true }, other: { harness: "codex" } } });
  const listed = byName(rows(fx));
  assert.deepEqual(Object.keys(listed).sort(), ["other", "shared"]);
  assert.deepEqual([listed.shared.source, listed.shared.shadows, listed.shared.args, listed.shared.model, listed.shared.yolo], [fx.dep, [machineFile(fx)], ["--deployment"], null, null], "no field of the machine entry survives");
  assert.deepEqual([listed.other.source, listed.other.shadows], [machineDir(fx), []]);
  const effective = await fx.inEnv(() => launchConfigsAt(fx.dep));
  assert.deepEqual([effective.shared.source, effective.shared.shadows, effective.shared.model], [fx.dep, [machineFile(fx)], undefined]);
});

test("the default: a deployment default wins for its harness; the machine's applies when the deployment declares none for that harness", (t) => {
  const fx = fixture(t);
  const preview = () => ok(fx.cli(["spawn", "writer", "--preview", "--json"]), "preview");
  writeMachine(fx, { "launch-configs": { machine: { harness: "claude", default: true } } });
  assert.deepEqual([preview().launchConfig, preview().launchConfigDefault], ["machine", true], "only the machine declares one");
  // The deployment declares a codex default: the machine's claude default still applies.
  const local = YAML.parse(readFileSync(join(fx.dep, "oats-local.yaml"), "utf8"));
  writeFileSync(join(fx.dep, "oats-local.yaml"), YAML.stringify({ ...local, "launch-configs": { codex: { harness: "codex", default: true } } }));
  assert.deepEqual([preview().launchConfig, preview().launchConfigDefault], ["machine", true], "defaults are per harness");
  // The deployment declares a claude default: it wins, and the machine entry is listed without its default.
  writeFileSync(join(fx.dep, "oats-local.yaml"), YAML.stringify({ ...local, "launch-configs": { mine: { harness: "claude", default: true } } }));
  assert.deepEqual([preview().launchConfig, preview().launchConfigSource], ["mine", fx.dep]);
  const listed = byName(rows(fx));
  assert.deepEqual([listed.mine.default, listed.machine.default, listed.machine.source], [true, false, machineDir(fx)]);
  // Two defaults for one harness within the machine file are refused, naming it.
  writeMachine(fx, { "launch-configs": { a: { harness: "pi", default: true }, b: { harness: "pi", default: true } } });
  const e = failed(fx.cli(["launch-config", "list", "--json"]), "two machine defaults");
  assert.equal(e.code, "E_LAUNCH_CONFIG_INVALID");
  assert.ok(e.message.includes(machineFile(fx)), e.message);
});

test("a broken machine file is an error naming it, for listings, previews and spawns; doctor reports it without failing", (t) => {
  const fx = fixture(t);
  for (const [what, text] of [
    ["not YAML", "launch-configs: [\n"],
    ["a bad entry", YAML.stringify({ "launch-configs": { bad: { harness: "emacs" } } })],
    ["an empty document", ""],
    ["no launch-configs", YAML.stringify({ "launch-configs-typo": {} })],
    ["another top-level key", YAML.stringify({ "launch-configs": {}, schemaVersion: 2 })],
  ]) {
    writeMachine(fx, text);
    for (const args of [["launch-config", "list", "--json"], ["spawn", "writer", "--preview", "--json"]]) {
      const e = failed(fx.cli(args), `${what}: ${args.join(" ")}`);
      assert.ok(e.message.includes(machineFile(fx)), `${what}, ${args[0]}: ${e.message}`);
    }
    const doctor = fx.cli(["doctor", "--json"]);
    assert.equal(doctor.status, 0, `${what}: doctor ${doctor.stdout}${doctor.stderr}`);
    const report = JSON.parse(doctor.stdout).machineLaunchConfigs;
    assert.deepEqual([report.file, report.present, report.ok], [machineFile(fx), true, false], what);
    assert.ok(report.error.includes(machineFile(fx)), report.error);
  }
  const another = failed(fx.cli(["launch-config", "list", "--json"]), "another key");
  assert.match(another.message, /schemaVersion/, "the unknown key is named");
});

test("doctor reports the machine file: its path, its entries and that it is valid, or that there is none", (t) => {
  const fx = fixture(t);
  const report = () => { const r = fx.cli(["doctor", "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout).machineLaunchConfigs; };
  assert.deepEqual(report(), { file: machineFile(fx), present: false, ok: true, configurations: [] });
  writeMachine(fx, { "launch-configs": { b: { harness: "codex" }, a: { harness: "claude" } } });
  assert.deepEqual(report(), { file: machineFile(fx), present: true, ok: true, configurations: ["a", "b"] });
  const human = fx.cli(["doctor"]);
  assert.ok(human.stdout.includes(machineFile(fx)), human.stdout);
});

test("OATS_HOME_DIR decides where the machine file is", (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-machine-lc-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const saved = process.env.OATS_HOME_DIR;
  t.after(() => { if (saved === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = saved; });
  for (const name of ["one", "two"]) write(join(base, name, "config", FILE), YAML.stringify({ "launch-configs": { [name]: { harness: "pi" } } }));
  const empty = join(base, "nowhere"); mkdirSync(empty);
  process.env.OATS_HOME_DIR = join(base, "one");
  assert.deepEqual(Object.keys(launchConfigsAt(empty)), ["one"], "no deployment in reach: the machine layer alone");
  assert.equal(launchConfigsAt(empty).one.source, join(base, "one", "config"));
  process.env.OATS_HOME_DIR = join(base, "two");
  assert.deepEqual(Object.keys(launchConfigsAt(empty)), ["two"]);
  process.env.OATS_HOME_DIR = join(base, "three");
  assert.deepEqual(Object.keys(launchConfigsAt(empty)), [], "a missing file is no machine layer");
});

test("a relative executable of a machine entry resolves against the machine file's directory", (t) => {
  const fx = fixture(t);
  const wrapper = join(machineDir(fx), "bin", "claude-auto");
  write(wrapper, "#!/bin/sh\nexit 0\n"); chmodSync(wrapper, 0o755);
  writeMachine(fx, { "launch-configs": { auto: { harness: "claude", executable: "bin/claude-auto", default: true } } });
  const preview = ok(fx.cli(["spawn", "writer", "--preview", "--json"]), "preview");
  assert.equal(preview.executable, wrapper);
});

test("with no deployment in reach, listings show the machine's entries; launch-config writes only ever touch the deployment", (t) => {
  const fx = fixture(t);
  writeMachine(fx, { "launch-configs": { auto: { harness: "claude" } } });
  const outside = mkdtempSync(join(fx.base, "outside-"));
  assert.deepEqual(rows(fx, outside).map((r) => [r.name, r.source]), [["auto", machineDir(fx)]]);
  const before = readFileSync(machineFile(fx), "utf8");
  const machineOnly = failed(fx.cli(["launch-config", "remove", "auto", "--json"]), "remove a machine entry");
  assert.equal(machineOnly.code, "E_LAUNCH_CONFIG_UNKNOWN");
  assert.ok(machineOnly.message.includes(`it is this machine's, in ${machineFile(fx)}, which OATS never writes`), machineOnly.message);
  assert.equal(readFileSync(machineFile(fx), "utf8"), before);
  const def =join(fx.base, "def.json"); writeFileSync(def, JSON.stringify({ harness: "claude", args: ["--mine"] }));
  ok(fx.cli(["launch-config", "set", "auto", "--file", def, "--json"]), "set");
  assert.equal(readFileSync(machineFile(fx), "utf8"), before, "the machine file is never written");
  assert.deepEqual(YAML.parse(readFileSync(join(fx.dep, "oats-local.yaml"), "utf8"))["launch-configs"].auto.args, ["--mine"]);
  assert.deepEqual(byName(rows(fx)).auto.shadows, [machineFile(fx)]);
  ok(fx.cli(["launch-config", "remove", "auto", "--json"]), "remove");
  assert.equal(readFileSync(machineFile(fx), "utf8"), before);
  assert.deepEqual(byName(rows(fx)).auto.source, machineDir(fx), "removing the deployment's entry uncovers the machine's");
  const outsideSet = fx.cli(["launch-config", "set", "x", "--file", def, "--json"], { cwd: outside }).json();
  assert.equal(outsideSet.error?.code, "E_LOCAL_MISSING", "no deployment: nothing to write, the machine file least of all");
});

test("the CLI takes the machine file from OATS_HOME_DIR in its environment", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-machine-cli-")));
  try {
    write(join(base, "oats-home", "config", FILE), YAML.stringify({ "launch-configs": { auto: { harness: "claude" } } }));
    const r = spawnSync(process.execPath, [CLI, "launch-config", "list", "--json"], { cwd: base, encoding: "utf8", env: { PATH: process.env.PATH, HOME: base, OATS_HOME_DIR: join(base, "oats-home") } });
    assert.deepEqual(JSON.parse(r.stdout).result.configurations.map((c) => c.name), ["auto"], r.stdout + r.stderr);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
