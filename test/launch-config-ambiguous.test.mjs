// An ambiguous launch configuration refuses a spawn (E_LAUNCH_CONFIG_AMBIGUOUS): the resolved harness has more
// than one launch configuration here, none is its `default: true`, and the spawn named none. Naming one
// (`--launch-config <name>`, `--launch-config none`, or a souls.launch string) decides it; an inline preference
// (souls.launch object, the soul's own `launch:`) and `--harness` alone do not. Preview and apply refuse alike,
// listings carry it as the launch report's `problem`, and a start or restart of an existing home is unaffected.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { launchOf, REPORT_FROM } from "../packages/desktop/renderer/launch-contract.mjs";

const OPUS = { harness: "claude", model: "claude-opus-5-5" };
const LOCAL = "oats-local.yaml";
const TWO = { personal: { harness: "claude", env: { CLAUDE_CONFIG_DIR: "/home/me/.claude-personal" } }, work: { harness: "claude", env: { CLAUDE_CONFIG_DIR: "/home/me/.claude-work" } } };
const ok = (r, what) => { assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`); const j = r.json(); assert.equal(j.ok, true, `${what}: ${r.stdout}`); return j.result; };
function stubbedPath(t, fx) { const saved = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = saved; }); }
function fixture(t, local = {}) {
  const fx = v2Deployment({ name: "acme", souls: { dev: {}, writer: { soul: { launch: OPUS } } }, local: { "launch-configs": TWO, ...local } });
  t.after(fx.cleanup); stubbedPath(t, fx);
  return fx;
}
function setLocal(fx, edit) { const p = join(fx.dep, LOCAL); const v = YAML.parse(readFileSync(p, "utf8")); edit(v); writeFileSync(p, YAML.stringify(v)); }
const refused = (r, what) => {
  const j = r.json();
  assert.equal(j.ok, false, `${what}: ${r.stdout}`);
  assert.equal(j.error.code, "E_LAUNCH_CONFIG_AMBIGUOUS", `${what}: ${r.stdout}`);
  return j.error;
};

test("refused in preview and apply, naming the harness, its configurations and the fix", async (t) => {
  const fx = fixture(t);
  const error = refused(fx.cli(["spawn", "writer", "--preview", "--json"]), "preview");
  assert.equal(error.details.harness, "claude");
  assert.deepEqual(error.details.configurations, ["personal", "work"]);
  assert.match(error.message, /claude/);
  assert.match(error.message, /personal, work/);
  assert.match(error.details.fix, /--launch-config <name>/);
  assert.match(error.details.fix, /default: true/);
  // --harness alone names no configuration.
  refused(fx.cli(["spawn", "dev", "--harness", "claude", "--preview", "--json"]), "--harness claude");
  await assert.rejects(fx.spawn("writer", { instance: "writer-1" }), (e) => e.code === "E_LAUNCH_CONFIG_AMBIGUOUS" && e.details.configurations.join() === "personal,work");
  assert.equal(existsSync(join(fx.dep, "agents", "writer", "instances", "writer-1")), false, "the refused apply created no home");
});

test("an inline souls.launch preference does not name a configuration", (t) => {
  const fx = fixture(t, { souls: { launch: { dev: { harness: "claude" } } } });
  refused(fx.cli(["spawn", "dev", "--preview", "--json"]), "inline preference");
});

test("each named form passes: --launch-config <name>, --launch-config none, a souls.launch string", (t) => {
  const fx = fixture(t);
  const named = ok(fx.cli(["spawn", "writer", "--launch-config", "work", "--preview", "--json"]), "--launch-config work");
  assert.deepEqual([named.harness, named.launchConfig], ["claude", "work"]);
  const bare = ok(fx.cli(["spawn", "writer", "--launch-config", "none", "--harness", "claude", "--preview", "--json"]), "--launch-config none");
  assert.deepEqual([bare.harness, bare.launchConfig], ["claude", null]);
  setLocal(fx, (v) => { v.souls = { ...(v.souls || {}), launch: { writer: "personal" } }; });
  const local = ok(fx.cli(["spawn", "writer", "--preview", "--json"]), "souls.launch string");
  assert.deepEqual([local.harness, local.launchConfig], ["claude", "personal"]);
});

test("a single configuration for the harness, a default, or another harness passes", (t) => {
  const fx = fixture(t);
  // pi has no configuration here: the soul whose launch is pi is not affected by claude's ambiguity.
  assert.equal(ok(fx.cli(["spawn", "dev", "--preview", "--json"]), "pi").harness, "pi");
  setLocal(fx, (v) => { v["launch-configs"].work.default = true; });
  const withDefault = ok(fx.cli(["spawn", "writer", "--preview", "--json"]), "default");
  assert.deepEqual([withDefault.launchConfig, withDefault.launchConfigDefault], ["work", true]);
  setLocal(fx, (v) => { delete v["launch-configs"].work; });
  const single = ok(fx.cli(["spawn", "writer", "--preview", "--json"]), "single");
  assert.deepEqual([single.harness, single.launchConfig], ["claude", null], "one configuration without a default is not chosen, nor refused");
});

test("listings carry the refusal as the launch report's problem", (t) => {
  const fx = fixture(t);
  const souls = Object.fromEntries(ok(fx.cli(["souls", "--json"]), "souls").souls.map((s) => [s.name, s]));
  const { problem, effective } = souls.writer.launch;
  assert.equal(problem.code, "E_LAUNCH_CONFIG_AMBIGUOUS");
  assert.match(problem.message, /personal, work/);
  assert.match(problem.fix, /--launch-config <name>/);
  assert.deepEqual(effective, { harness: "claude", model: "claude-opus-5-5", launchConfig: null });
  assert.notEqual(launchOf(souls.writer.launch, REPORT_FROM), undefined, "the Desktop decodes it");
  assert.equal(souls.dev.launch.problem, null);
  const inspected = ok(fx.cli(["inspect", "--soul", "writer", "--json"]), "inspect --soul");
  assert.equal(inspected.launch.problem.code, "E_LAUNCH_CONFIG_AMBIGUOUS");
});

test("a start or restart of an existing home is unaffected, --harness and --reselect-launch included", async (t) => {
  const fx = fixture(t);
  const { home } = await fx.spawn("writer", { instance: "writer-1", launchConfig: "personal" });
  setLocal(fx, (v) => { v.souls = { launch: { writer: { harness: "claude" } } }; });
  const plain = ok(fx.cli(["launch-config", "preview", "--home", home, "--json"]), "plain start");
  assert.equal(plain.launchConfig, "personal");
  const harness = ok(fx.cli(["launch-config", "preview", "--home", home, "--harness", "claude", "--json"]), "--harness claude");
  assert.equal(harness.harness, "claude");
  const reselect = ok(fx.cli(["launch-config", "preview", "--home", home, "--reselect-launch", "--json"]), "--reselect-launch");
  assert.equal(reselect.harness, "claude");
});
