// A host's default launch configuration per harness (0.32, feature launch-config-default): a configuration with
// `default: true` is this machine's baseline for its harness. A new launch that picks the harness without naming
// a configuration (a soul's or souls.launch preference, --harness, the host default) runs its executable, args,
// env and yolo; its model is the last fallback. A named configuration runs as declared, `--launch-config none`
// asks for the bare harness, and a recorded home keeps its recipe. The legacy `oats-claude-config` file is no
// longer read: one in reach of a new claude launch refuses it (E_CLAUDE_CONFIG_REMOVED).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { launchConfigsAt, NATIVE_DEFAULT_MODEL, resolveLaunchSelection } from "../lib/core.mjs";
import { launchOf, PREVIEW_FROM, REPORT_FROM } from "../packages/client/launch-contract.mjs";

const OPUS = { harness: "claude", model: "claude-opus-5-5" };
const LOCAL = "oats-local.yaml";
const decodes = (launch, from = REPORT_FROM) => assert.notEqual(launchOf(launch, from), undefined, `the Desktop refuses ${JSON.stringify(launch)}`);

test("selection: the harness default stands in for 'no configuration', below named configurations and --launch-config none", () => {
  const configs = {
    personal: { name: "personal", harness: "claude", args: ["--p"], env: { CLAUDE_CONFIG_DIR: "/cfg" }, model: "claude-sonnet-5", yolo: true, default: true, source: "/dep", shadows: [] },
    named: { name: "named", harness: "claude", args: [], env: {}, source: "/dep", shadows: [] },
  };
  const pick = (args) => { const r = resolveLaunchSelection({ launchConfigs: configs, ...args }); return [r.config?.name ?? null, r.config?.harnessDefault === true, r.harness, r.model, r.modelSource, r.configuredYolo ?? null]; };
  // A soul (or inline) preference: the default's recipe, the preference's model.
  assert.deepEqual(pick({ agent: {}, selection: { launchConfig: "none" }, preference: { ...OPUS, from: "soul" } }), ["personal", true, "claude", "claude-opus-5-5", "soul preference", true]);
  // A preference without a model: the default's model before the harness's own.
  assert.deepEqual(pick({ agent: {}, selection: { launchConfig: "none" }, preference: { harness: "claude", model: null, from: "local" } }), ["personal", true, "claude", "claude-sonnet-5", "launch-config personal", true]);
  // --harness claude names no configuration: the default applies.
  assert.deepEqual(pick({ agent: {}, selection: { harness: "claude" } }).slice(0, 4), ["personal", true, "claude", "claude-sonnet-5"]);
  // An explicit model wins; an explicit native default keeps the recipe but never borrows the default's model.
  assert.deepEqual(pick({ agent: {}, selection: { harness: "claude", model: "claude-haiku-4-5" } }).slice(0, 5), ["personal", true, "claude", "claude-haiku-4-5", "explicit"]);
  assert.deepEqual(pick({ agent: {}, selection: { harness: "claude", model: NATIVE_DEFAULT_MODEL } }).slice(0, 4), ["personal", true, "claude", ""]);
  // A named configuration runs as declared; the default never layers under it.
  assert.deepEqual(pick({ agent: {}, selection: { launchConfig: "named" } }).slice(0, 4), ["named", false, "claude", ""]);
  // --launch-config none (the flag, no preference) is the bare harness.
  assert.deepEqual(pick({ agent: {}, selection: { launchConfig: "none", harness: "claude" } }).slice(0, 2), [null, false]);
  // No default for pi: the host default is the bare harness, as before.
  assert.deepEqual(pick({ agent: {}, selection: {} }).slice(0, 3), [null, false, "pi"]);
  // A recorded home runs its recipe; a harness switch on it takes the new harness's default.
  const frozen = { harness: "pi", launchConfig: null, executable: "/usr/bin/pi", executableDeclared: null, args: [], env: {}, model: null };
  assert.deepEqual(pick({ agent: {}, frozen, selection: {} }).slice(0, 3), [null, false, "pi"]);
  assert.deepEqual(pick({ agent: {}, frozen, selection: { harness: "claude" } }).slice(0, 4), ["personal", true, "claude", "claude-sonnet-5"]);
  // A home recorded from the default keeps saying so across restarts.
  const recorded = { ...frozen, harness: "claude", launchConfig: "personal", launchConfigDefault: true };
  assert.deepEqual(pick({ agent: {}, frozen: recorded, selection: {} }).slice(0, 2), ["personal", true]);
});

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-launch-default-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const HEAD = "schemaVersion: 2\nworkspace: example.invalid/acme/workspace\n";
function write(p, c) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
function oats(args, cwd) {
  const env = { ...process.env, OATS_HOME_DIR: join(base, "oats-home") };
  for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete env[k];
  const r = spawnSync(process.execPath, [CLI, ...args, "--json"], { encoding: "utf8", env, cwd });
  return JSON.parse(r.stdout.trim());
}

test("validation: default is a boolean, and one per harness in oats-local.yaml, refused with both names — never moved", () => {
  const dep = join(base, "validate");
  write(join(dep, LOCAL), `${HEAD}launch-configs:\n  a:\n    harness: claude\n    default: true\n  b:\n    harness: pi\n    default: true\n  c:\n    harness: claude\n    default: false\n`);
  const configs = launchConfigsAt(dep);
  assert.deepEqual([configs.a.default, configs.b.default, configs.c.default], [true, true, undefined], "one default per harness; false is the absence");
  write(join(dep, LOCAL), `${HEAD}launch-configs:\n  a:\n    harness: claude\n    default: true\n  c:\n    harness: claude\n    default: true\n`);
  assert.throws(() => launchConfigsAt(dep), (e) => e.code === "E_LAUNCH_CONFIG_INVALID" && /"a" and "c"/.test(e.message) && e.details.harness === "claude" && e.details.configurations.join() === "a,c");
  write(join(dep, LOCAL), `${HEAD}launch-configs:\n  a:\n    harness: claude\n    default: "yes"\n`);
  assert.throws(() => launchConfigsAt(dep), (e) => ["E_LAUNCH_CONFIG_INVALID", "E_WORKSPACE_SCHEMA"].includes(e.code) && /default/.test(e.message));
});

test("launch-config set writes default: true back, list shows it, and a second default for a harness is refused before a byte changes", () => {
  const dep = join(base, "cli");
  write(join(dep, LOCAL), HEAD);
  const def = join(base, "def.json");
  writeFileSync(def, JSON.stringify({ harness: "claude", env: { CLAUDE_CONFIG_DIR: "/home/me/.claude-personal" }, default: true }));
  assert.equal(oats(["launch-config", "set", "personal", "--file", def], dep).ok, true);
  assert.match(readFileSync(join(dep, LOCAL), "utf8"), /personal:\n {4}harness: claude\n {4}env:\n {6}CLAUDE_CONFIG_DIR: [^\n]+\n {4}default: true\n/);
  writeFileSync(def, JSON.stringify({ harness: "pi", default: false }));
  assert.equal(oats(["launch-config", "set", "plain", "--file", def], dep).ok, true);
  assert.doesNotMatch(readFileSync(join(dep, LOCAL), "utf8"), /default: false/, "false is written as the absence");
  const rows = oats(["launch-config", "list"], dep).result.configurations;
  assert.deepEqual(rows.map((r) => [r.name, r.default]), [["personal", true], ["plain", false]]);
  assert.deepEqual(rows[0].env, { CLAUDE_CONFIG_DIR: { redacted: true } }, "values never leave the file");
  const before = readFileSync(join(dep, LOCAL), "utf8");
  writeFileSync(def, JSON.stringify({ harness: "claude", default: true }));
  const second = oats(["launch-config", "set", "work", "--file", def], dep);
  assert.equal(second.ok, false);
  assert.equal(second.error.code, "E_LAUNCH_CONFIG_INVALID");
  assert.deepEqual(second.error.details, { harness: "claude", configurations: ["personal", "work"] });
  assert.equal(readFileSync(join(dep, LOCAL), "utf8"), before, "nothing was written");
  const version = JSON.parse(spawnSync(process.execPath, [CLI, "version", "--json"], { encoding: "utf8" }).stdout);
  assert.ok((version.features ?? version.result?.features).includes("launch-config-default"));
});

function fixture(local = {}) {
  return v2Deployment({
    name: "acme",
    souls: { dev: {}, writer: { soul: { launch: OPUS } } },
    local: { "launch-configs": { personal: { harness: "claude", env: { CLAUDE_CONFIG_DIR: "/home/me/.claude-personal" }, yolo: true, default: true } }, ...local },
  });
}
const ok = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); const j = r.json(); assert.equal(j.ok, true, `${what}: ${r.stdout}`); return j.result; };
function stubbedPath(t, fx) { const saved = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = saved; }); }

test("spawn --preview, souls, the record and inspect say when a launch comes from the harness default — yolo included", async (t) => {
  const fx = fixture(); t.after(fx.cleanup); stubbedPath(t, fx);
  const preview = ok(fx.cli(["spawn", "writer", "--preview", "--json"]), "preview");
  assert.deepEqual([preview.harness, preview.model, preview.launchConfig, preview.launchConfigDefault, preview.yolo], ["claude", "claude-opus-5-5", "personal", true, true]);
  assert.deepEqual(preview.launch.effective, { harness: "claude", model: "claude-opus-5-5", launchConfig: "personal" });
  assert.equal(preview.launch.from, "soul", "the layer that chose the harness still decides `from`");
  decodes(preview.launch, PREVIEW_FROM);
  const human = fx.cli(["spawn", "writer", "--preview"]);
  assert.match(human.stdout, /via launch configuration personal \(this machine's claude default\) YOLO/);
  const souls = Object.fromEntries(ok(fx.cli(["souls", "--json"]), "souls").souls.map((s) => [s.name, s]));
  assert.deepEqual(souls.writer.launch.effective, { harness: "claude", model: "claude-opus-5-5", launchConfig: "personal" });
  decodes(souls.writer.launch);
  // pi has no default: unchanged.
  assert.deepEqual(souls.dev.launch.effective, { harness: "pi", model: null, launchConfig: null });
  const pi = ok(fx.cli(["spawn", "dev", "--preview", "--json"]), "pi preview");
  assert.deepEqual([pi.launchConfig, pi.launchConfigDefault], [null, false]);
  // --launch-config none: the bare harness.
  const bare = ok(fx.cli(["spawn", "writer", "--launch-config", "none", "--harness", "claude", "--preview", "--json"]), "bare");
  assert.deepEqual([bare.launchConfig, bare.launchConfigDefault, bare.yolo ?? null], [null, false, null]);

  const { home } = await fx.spawn("writer", { instance: "writer-1" });
  const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  assert.deepEqual([meta.launch.launchConfig, meta.launch.launchConfigDefault, meta.launch.yolo, Object.keys(meta.launch.env)], ["personal", true, true, ["CLAUDE_CONFIG_DIR"]]);
  assert.match(meta.command, /CLAUDE_CONFIG_DIR=/);
  const inspected = ok(fx.cli(["inspect", "--home", home, "--json"]), "inspect");
  assert.deepEqual([inspected.instance.launchConfig, inspected.instance.launchConfigDefault], ["personal", true]);
  decodes(inspected.launch, [...PREVIEW_FROM, "recorded"]);
});

test("oats-claude-config is no longer read: one in reach refuses a new claude launch, naming the file and what to declare", (t) => {
  const fx = v2Deployment({ name: "acme", souls: { dev: {}, writer: { soul: { launch: OPUS } } } }); t.after(fx.cleanup);
  writeFileSync(join(fx.dep, "oats-claude-config"), "# personal account\nclaude-personal\n");
  const r = fx.cli(["spawn", "writer", "--preview", "--json"]).json();
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "E_CLAUDE_CONFIG_REMOVED");
  assert.match(r.error.message, /no longer read \(OATS 0\.32\).*harness: claude, executable: claude-personal, default: true.*then delete/);
  assert.equal(r.error.details.file, join(fx.dep, "oats-claude-config"));
  // A listing carries it as the soul's problem; pi is unaffected.
  const souls = Object.fromEntries(ok(fx.cli(["souls", "--json"]), "souls").souls.map((s) => [s.name, s]));
  assert.equal(souls.writer.launch.problem.code, "E_CLAUDE_CONFIG_REMOVED");
  decodes(souls.writer.launch);
  assert.equal(ok(fx.cli(["spawn", "dev", "--preview", "--json"]), "pi").harness, "pi");
  // A declared claude default does not make the stale file acceptable: it still has to go.
  const p = join(fx.dep, LOCAL); const v = YAML.parse(readFileSync(p, "utf8"));
  v["launch-configs"] = { personal: { harness: "claude", default: true } }; writeFileSync(p, YAML.stringify(v));
  assert.equal(fx.cli(["spawn", "writer", "--preview", "--json"]).json().error?.code, "E_CLAUDE_CONFIG_REMOVED");
});

test("a recorded home: preview round-trips the default; its yolo never follows into a bare or other-harness launch; the old file does not break it", async (t) => {
  const fx = v2Deployment({ name: "acme", souls: { dev: {}, writer: { soul: { launch: OPUS } } },
    local: { "launch-configs": { pidef: { harness: "pi", yolo: true, default: true }, personal: { harness: "claude", default: true } } } });
  t.after(fx.cleanup); stubbedPath(t, fx);
  const { home } = await fx.spawn("dev", { instance: "dev-1" });
  const meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
  assert.deepEqual([meta.harness, meta.launch.launchConfig, meta.launch.launchConfigDefault, meta.launch.yolo], ["pi", "pidef", true, true]);
  const recorded = ok(fx.cli(["launch-config", "preview", "--home", home, "--json"]), "preview recorded");
  assert.deepEqual([recorded.launchConfig, recorded.launchConfigDefault, recorded.yolo], ["pidef", true, true], "a plain start runs the recorded default");
  const bare = ok(fx.cli(["launch-config", "preview", "--home", home, "--launch-config", "none", "--json"]), "preview none");
  assert.deepEqual([bare.launchConfig, bare.launchConfigDefault, bare.yolo ?? null], [null, false, null], "the bare harness is not yolo because the default was");
  const claude = ok(fx.cli(["launch-config", "preview", "--home", home, "--harness", "claude", "--json"]), "preview --harness claude");
  assert.deepEqual([claude.harness, claude.launchConfig, claude.launchConfigDefault, claude.yolo ?? null], ["claude", "personal", true, null], "another harness takes its own default, not pi's yolo");
  // A home recorded before the file was refused keeps running what it recorded.
  const { home: wHome } = await fx.spawn("writer", { instance: "writer-1" });
  writeFileSync(join(fx.dep, "oats-claude-config"), "claude-personal\n");
  assert.equal(ok(fx.cli(["launch-config", "preview", "--home", wHome, "--json"]), "frozen claude").ok, true);
});

test("souls.launch naming none asks for the bare harness in listings as in a spawn", (t) => {
  const fx = fixture({ souls: { launch: { writer: "none" } }, "launch-configs": { pidef: { harness: "pi", model: "pi-model-x", default: true } } }); t.after(fx.cleanup);
  const souls = Object.fromEntries(ok(fx.cli(["souls", "--json"]), "souls").souls.map((s) => [s.name, s]));
  const preview = ok(fx.cli(["spawn", "writer", "--preview", "--json"]), "preview");
  assert.deepEqual([souls.writer.launch.effective.harness, souls.writer.launch.effective.launchConfig, souls.writer.launch.effective.model], [preview.harness, preview.launchConfig, null]);
  assert.deepEqual([preview.harness, preview.launchConfig, preview.launchConfigDefault], ["pi", null, false]);
});
