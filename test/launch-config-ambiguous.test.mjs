// An ambiguous launch configuration refuses a launch that is selected anew (E_LAUNCH_CONFIG_AMBIGUOUS): the
// resolved harness has more than one launch configuration here, none is its `default: true`, and the launch
// named none. Naming one (`--launch-config <name>`, `--launch-config none`, or a souls.launch string) decides
// it; an inline preference (souls.launch object, the soul's own `launch:`) and `--harness` alone do not.
// Whichever command asks (awebai/oats#999): a spawn, preview and apply alike; a start or restart that selects
// (test/launch-config-ambiguous-session.test.mjs, on real tmux); and `launch-config preview`, which plans as
// a start does. Listings carry it as the launch report's `problem`. One place refuses it, and every way out
// its sentence names is run here as written.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { tokensOf } from "./helpers/source-tokens.mjs";
import { launchOf, REPORT_FROM } from "../packages/client/launch-contract.mjs";

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

test("the message names at most 10 configurations, then how many more, and stays within the Desktop's 1024 characters", (t) => {
  const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`account-${String(i).padStart(2, "0")}-${"x".repeat(53)}`, { harness: "claude" }]));
  const fx = fixture(t, { "launch-configs": many });
  const names = Object.keys(many).sort();
  assert.ok(names.every((n) => n.length === 64), "names at the 64-character maximum: the worst case");
  const error = refused(fx.cli(["spawn", "writer", "--preview", "--json"]), "preview");
  assert.deepEqual(error.details.configurations, names, "details keep the full list");
  assert.ok(error.message.length < 1024, `${error.message.length} characters`);
  assert.ok(error.message.includes(`(${names.slice(0, 10).join(", ")}, and 15 more)`), error.message);
  assert.ok(!error.message.includes(names[10]));
  const souls = Object.fromEntries(ok(fx.cli(["souls", "--json"]), "souls").souls.map((s) => [s.name, s]));
  const { problem } = souls.writer.launch;
  assert.equal(problem.message, error.message, "the launch report's problem carries the same bounded message");
  assert.ok(problem.message.length < 1024);
  assert.notEqual(launchOf(souls.writer.launch, REPORT_FROM), undefined, "the Desktop decodes it");
});

const SET = "oats launch-config set";
const SET_CONFIG = "oats soul launch set <soul> --launch-config <name>";
const SET_DEFAULT_CONFIG = "oats soul launch set '*' --launch-config <name>";
const BARE = "--launch-config none --harness claude";
const FLAGS = `name one with --launch-config <name>, ask for the bare harness with ${BARE}`;
const MARK = `mark one default: true (${SET})`;
/** The sentence where --harness was given: no way through the soul, since a flag decides before any layer. */
const FIX_HARNESS = `${FLAGS}, or ${MARK}`;
const FIX_LAYER = `${FLAGS}, pin the soul to one (${SET_CONFIG}), or ${MARK}`;
const FIX_DEFAULT = `${FLAGS}, name one for every soul without an entry (${SET_DEFAULT_CONFIG}), pin the soul to one (${SET_CONFIG}), or ${MARK}`;
/** `oats launch-config set`, marking `work` the claude default. */
const markDefault = (fx) => { const file = join(fx.base, "work-default.json"); writeFileSync(file, JSON.stringify({ ...TWO.work, default: true })); return fx.cli(["launch-config", "set", "work", "--file", file, "--json"]); };
const words = (text, soul, name) => text.replace("<soul>", soul).replace("<name>", name).replace("'*'", "*").split(" ");

test("launch-config preview of an existing home plans as a start does: --harness alone is refused there too, with the way out in its message; the plain start, a named configuration and the bare harness are not", async (t) => {
  const fx = fixture(t);
  const { home } = await fx.spawn("writer", { instance: "writer-1", launchConfig: "personal" });
  const preview = (...flags) => fx.cli(["launch-config", "preview", "--home", home, ...flags, "--json"]);
  const plain = ok(preview(), "plain start");
  assert.deepEqual([plain.launchConfig, plain.selection.source], ["personal", "frozen"]);
  // --harness alone selects anew, also the harness the home already runs. The preview answers its failures
  // as { code, message }, with no details for any code: the way out is in the message.
  const error = refused(preview("--harness", "claude"), "--harness claude");
  assert.equal(error.message, `${LOCAL} declares 2 claude launch configurations (personal, work) and none is default: true, and this launch names none; ${FIX_HARNESS}`);
  assert.equal(error.details, undefined);
  // Each way the sentence names, as written.
  const named = ok(preview("--harness", "claude", "--launch-config", "work"), "--launch-config work");
  assert.deepEqual([named.harness, named.launchConfig], ["claude", "work"]);
  const bare = ok(preview(...BARE.split(" ")), BARE);
  assert.deepEqual([bare.harness, bare.launchConfig], ["claude", null]);
  assert.deepEqual([ok(preview("--launch-config", "none"), "--launch-config none").harness, ok(preview("--launch-config", "none"), "--launch-config none").launchConfig], ["claude", null]);
  // Another harness, with no configuration here, is not claude's ambiguity.
  assert.deepEqual([ok(preview("--harness", "pi"), "--harness pi").harness, ok(preview("--harness", "pi"), "--harness pi").launchConfig], ["pi", null]);
  ok(markDefault(fx), SET);
  const byDefault = ok(preview("--harness", "claude"), "--harness claude, with a default");
  assert.deepEqual([byDefault.harness, byDefault.launchConfig, byDefault.launchConfigDefault], ["claude", "work", true], "a start with --harness that is not refused gets what it got: the harness default");
});

test("each way out a spawn's refusal names, run as written after it, lets the same spawn go on: where the soul, a souls.launch entry, \"*\" and --harness chose the harness", (t) => {
  const fx = fixture(t);
  const local = join(fx.dep, LOCAL);
  const cases = [
    { soul: "writer", flags: [], launch: null, fix: FIX_LAYER, ways: ["--launch-config <name>", BARE, SET_CONFIG, SET] },
    { soul: "dev", flags: [], launch: { dev: { harness: "claude" } }, fix: FIX_LAYER, ways: ["--launch-config <name>", BARE, SET_CONFIG, SET] },
    { soul: "dev", flags: [], launch: { "*": { harness: "claude" } }, fix: FIX_DEFAULT, ways: ["--launch-config <name>", BARE, SET_DEFAULT_CONFIG, SET_CONFIG, SET] },
    { soul: "dev", flags: ["--harness", "claude"], launch: null, fix: FIX_HARNESS, ways: ["--launch-config <name>", BARE, SET] },
  ];
  let n = 0;
  for (const c of cases) {
    setLocal(fx, (v) => { v["launch-configs"] = structuredClone(TWO); if (c.launch) v.souls = { launch: c.launch }; else delete v.souls; });
    const state = readFileSync(local, "utf8");
    const what = `spawn ${c.soul} ${c.flags.join(" ")} (${JSON.stringify(c.launch)})`;
    const spawn = (flags, ...more) => fx.cli(["spawn", c.soul, ...flags, ...more, "--json"]);
    const error = refused(spawn(c.flags, "--preview"), what);
    assert.equal(error.details.fix, c.fix, what);
    assert.ok(error.message.endsWith(`; ${c.fix}`), what);
    // The ways are the commands and flags the sentence holds, in its order; a way it does not name is not run.
    const mentioned = [SET_DEFAULT_CONFIG, SET_CONFIG, SET].filter((text) => c.fix.includes(text));
    assert.deepEqual(["--launch-config <name>", BARE, ...mentioned], c.ways, what);
    for (const way of c.ways) {
      writeFileSync(local, state);
      refused(spawn(c.flags, "--preview"), `${what}, before ${way}`);
      const step = `${what}, after: ${way}`;
      let flags = c.flags, expected;
      if (way.startsWith("--")) {
        // A flag joins the refused command; the bare harness carries its own --harness.
        flags = way === BARE ? [...c.flags.filter((f, i) => f !== "--harness" && c.flags[i - 1] !== "--harness"), ...BARE.split(" ")] : [...c.flags, ...words(way, c.soul, "work")];
        expected = ["claude", way === BARE ? null : "work", false];
      } else if (way === SET) {
        ok(markDefault(fx), step);
        expected = ["claude", "work", true];
      } else {
        ok(fx.cli([...words(way, c.soul, "work").slice(1), "--json"]), step);
        expected = ["claude", "work", false];
      }
      const previewed = ok(spawn(flags, "--preview"), `${step}: preview`);
      assert.deepEqual([previewed.harness, previewed.launchConfig, previewed.launchConfigDefault === true], expected, step);
      const applied = ok(spawn(flags, "--no-launch", "--name", `way-${n += 1}`), `${step}: apply`);
      const meta = JSON.parse(readFileSync(join(applied.home, "instance.json"), "utf8"));
      assert.deepEqual([meta.harness, meta.launch.launchConfig, meta.launch.launchConfigDefault === true], expected, step);
    }
  }
});

test("one place refuses it: outside the constructor, the kernel calls launchConfigAmbiguous twice, and only resolveLaunchSelection throws what it returns (launchReportFor reports it)", () => {
  const root = new URL("..", import.meta.url).pathname;
  const files = [join(root, "bin", "oats.mjs"), ...readdirSync(join(root, "lib")).filter((name) => name.endsWith(".mjs")).map((name) => join(root, "lib", name))];
  const calls = [];
  for (const file of files) {
    const T = tokensOf(readFileSync(file, "utf8"));
    let fn = null;
    T.forEach((token, i) => {
      // The exported function a token stands in.
      if (token.v === "function" && T[i - 1]?.v === "export" && T[i + 1]?.t === "id") fn = T[i + 1].v;
      if (token.t === "id" && token.v === "launchConfigAmbiguous" && T[i + 1]?.v === "(" && T[i - 1]?.v !== "function") calls.push({ file: file.slice(root.length), fn, at: i, T });
    });
  }
  assert.deepEqual(calls.map((c) => `${c.file} ${c.fn}`).sort(), ["lib/core.mjs launchReportFor", "lib/core.mjs resolveLaunchSelection"]);
  // What each does with the answer, up to the end of its function: `const ambiguous = …; if (ambiguous) throw|return …`.
  const after = (c) => { const out = []; for (let i = c.at; i < c.T.length && !(c.T[i].v === "export" && c.T[i + 1]?.v === "function"); i++) out.push(c.T[i].v); return out.join(" "); };
  const byFn = Object.fromEntries(calls.map((c) => [c.fn, after(c)]));
  assert.match(byFn.resolveLaunchSelection, /^launchConfigAmbiguous \(.*?\) ; if \( ambiguous \) throw ambiguous ;/s);
  assert.match(byFn.launchReportFor, /^launchConfigAmbiguous \(.*?\) ; if \( ambiguous \) return report \(/s);
  assert.ok(!byFn.launchReportFor.includes("throw ambiguous"), "the report never throws it");
  // And no caller holds a switch for it any more.
  for (const file of files) assert.ok(!readFileSync(file, "utf8").includes("refuseAmbiguous"), file);
});
