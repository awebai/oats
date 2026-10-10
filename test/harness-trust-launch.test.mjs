// The codex launch recipe and the folder-trust warning (#341, #886): a kernel codex launch never
// stops at Codex's update prompt, trusts its new home only when the operator trusts the
// deployment root (or an ancestor) in the config.toml that launch reads, and a spawn whose
// harness configuration does not establish folder trust says so, naming that file. Each check
// reads the file of the launch's own env (host + launch configuration). The operator's harness
// configuration is never written.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CODEX_TASK_PROMPT, describeLaunchCommand, parseLaunchCommand, renderLaunchCommand, renderLaunchRecipe } from "../lib/core.mjs";
import YAML from "yaml";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const hooks = () => ({ launch: {}, env: {}, contributions: [] });
const codex = (extra = {}) => ({ harness: "codex", executable: "/opt/homebrew/bin/codex", args: [], env: {}, model: null, hooks: hooks(), ...extra });
const prompt = CODEX_TASK_PROMPT;
const trustArg = (home) => `projects={${JSON.stringify(home)}={trust_level="trusted"}}`;
/** The instance env a codex launch hands its tool commands (shell_environment_policy.set, #342). */
const setArgs = (pairs) => pairs.flatMap(([name, value]) => ["-c", `shell_environment_policy.set.${name}=${JSON.stringify(value)}`]);
const instanceEnv = (home) => setArgs([["OATS_INSTANCE", "n"], ["OATS_INSTANCE_HOME", home]]);

test("codex argv: the update prompt is always off; the home is trusted only under root trust or yolo", (t) => {
  const home = realpathSync(join(process.cwd()));
  const env = instanceEnv(home);
  for (const [extra, opts, argv] of [
    [{}, {}, ["--cd", home, "-c", "check_for_update_on_startup=false", ...env, "--", prompt]],
    [{}, { trustHome: false }, ["--cd", home, "-c", "check_for_update_on_startup=false", ...env, "--", prompt]],
    [{}, { trustHome: true }, ["--cd", home, "-c", "check_for_update_on_startup=false", "-c", trustArg(home), ...env, "--", prompt]],
    [{ yolo: true }, {}, ["--cd", home, "-c", "check_for_update_on_startup=false", "--yolo", "-c", trustArg(home), ...env, "--", prompt]],
    [{ yolo: true }, { trustHome: true }, ["--cd", home, "-c", "check_for_update_on_startup=false", "--yolo", "-c", trustArg(home), ...env, "--", prompt]],
    [{ model: "gpt-x" }, { trustHome: true }, ["--cd", home, "-c", "check_for_update_on_startup=false", "-c", trustArg(home), ...env, "--model", "gpt-x", "--", prompt]],
  ]) {
    const cmd = renderLaunchRecipe(codex(extra), { home, instance: "n", ...opts });
    assert.deepEqual(describeLaunchCommand(cmd).argv, argv, JSON.stringify([extra, opts]));
    assert.equal(renderLaunchCommand(parseLaunchCommand(cmd).tokens), cmd, "a shape the kernel re-renders");
  }
  // trustHome is codex's: claude and pi render as they did.
  for (const harness of ["claude", "pi"]) {
    const r = { ...codex(), harness, executable: `/x/${harness}` };
    assert.equal(renderLaunchRecipe(r, { home, instance: "n", trustHome: true }), renderLaunchRecipe(r, { home, instance: "n" }));
  }
});

test("codex argv hands tool commands the env the launch prefix sets: the instance, the capabilities' env, literal configuration env; never a reference", () => {
  const home = "/tmp/it's home";
  const recipe = codex({ env: { LIT: "v \"q\" \\ $HOME", KEY: { fromEnv: "SRC" } }, hooks: { launch: { codex: "--flag" }, env: { AWEB_IDENTITY_HOME: "/h/.aw", AWEB_DELIVERY: "session" }, contributions: [] } });
  const cmd = renderLaunchRecipe(recipe, { home, instance: "n" });
  const tail = ["--flag", "--", prompt];
  const expected = [...instanceEnv(home), ...setArgs([["AWEB_DELIVERY", "session"], ["AWEB_IDENTITY_HOME", "/h/.aw"], ["LIT", "v \"q\" \\ $HOME"]])];
  assert.deepEqual(describeLaunchCommand(cmd).argv, ["--cd", home, "-c", "check_for_update_on_startup=false", ...expected, ...tail]);
  assert.ok(!cmd.includes("shell_environment_policy.set.KEY"), "a reference's value stays out of argv");
  assert.equal(renderLaunchCommand(parseLaunchCommand(cmd).tokens), cmd);
  // A redacted render redacts these values exactly as it does the prefix.
  const redacted = describeLaunchCommand(renderLaunchRecipe(recipe, { home, instance: "n", redact: true })).argv;
  assert.deepEqual(redacted, ["--cd", home, "-c", "check_for_update_on_startup=false", ...instanceEnv(home), ...setArgs([["AWEB_DELIVERY", "<redacted>"], ["AWEB_IDENTITY_HOME", "<redacted>"], ["LIT", "<redacted>"]]), ...tail]);
});

test("spawn: codex trusts the new home only under a trusted root; claude and codex warn when the home is not covered; the operator's config is never written", async (t) => {
  // This machine prefers codex for dev: a readiness read of the soul reports codex's trust.
  const fx = v2Deployment({ local: { souls: { launch: { dev: { harness: "codex" } } } } }); t.after(fx.cleanup);
  // The in-process spawns resolve the harness on this process's PATH: the fixture's inert claude and codex
  // come first, so the test never depends on the host having either installed.
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  const userHome = fx.env.HOME, dep = realpathSync(fx.dep);
  const codexConfig = join(userHome, ".codex", "config.toml"), claudeConfig = join(userHome, ".claude.json");
  const spawn = async (purpose, harness) => { const r = await fx.spawn("dev", { purpose, harness }); return { r, meta: JSON.parse(readFileSync(join(r.home, "instance.json"), "utf8")) }; };
  const codexWarning = `codex folder trust is not established in ${codexConfig}: oats harness trust --dir ${dep}`;
  const claudeWarning = `claude folder trust is not established in ${claudeConfig}: oats harness trust --dir ${dep}`;

  // No trust anywhere: no override, and the spawn says trust is not established.
  let { r, meta } = await spawn("c1", "codex");
  assert.doesNotMatch(meta.command, /trust_level/);
  assert.match(meta.command, /-c check_for_update_on_startup=false/);
  assert.ok(r.warnings?.includes(codexWarning), JSON.stringify(r.warnings));
  ({ r } = await spawn("k1", "claude"));
  assert.ok(r.warnings?.includes(claudeWarning), JSON.stringify(r.warnings));

  // readiness says the same, as a configured item that does not block ready.
  const trustItems = (args) => { const r = fx.cli(["readiness", ...args, "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result.checks.configured.items.filter((i) => i.code === "harness-trust"); };
  const h1 = join(fx.root, "dev", "instances", "dev-c1"), k1 = join(fx.root, "dev", "instances", "dev-k1");
  for (const [args, warning, harness] of [[["--home", h1], codexWarning, "codex"], [["--home", k1], claudeWarning, "claude"], [["--soul", "dev"], codexWarning, "codex"]]) {
    const [i, ...rest] = trustItems(args);
    assert.deepEqual(rest, [], JSON.stringify(args));
    assert.deepEqual([i.subject, i.status, i.required, i.producer, i.reason, i.harness, i.file, i.deployment], ["launch", "fail", false, "harness folder trust", warning, harness, harness === "codex" ? codexConfig : claudeConfig, dep], JSON.stringify(args));
  }

  // The operator trusts the deployment root once.
  mkdirSync(join(userHome, ".codex"));
  writeFileSync(codexConfig, `[projects."${dep}"]\ntrust_level = "trusted"\n`);
  writeFileSync(claudeConfig, JSON.stringify({ projects: { [dep]: { hasTrustDialogAccepted: true } } }));
  const before = [readFileSync(codexConfig, "utf8"), statSync(codexConfig).mtimeMs, readFileSync(claudeConfig, "utf8"), statSync(claudeConfig).mtimeMs];
  ({ r, meta } = await spawn("c2", "codex"));
  assert.ok(meta.command.includes(`-c '${trustArg(realpathSync(r.home))}'`), meta.command);
  assert.equal((r.warnings || []).filter((w) => /folder trust/.test(w)).length, 0, JSON.stringify(r.warnings));
  ({ r } = await spawn("k2", "claude"));
  assert.equal((r.warnings || []).filter((w) => /folder trust/.test(w)).length, 0, JSON.stringify(r.warnings));
  assert.deepEqual([readFileSync(codexConfig, "utf8"), statSync(codexConfig).mtimeMs, readFileSync(claudeConfig, "utf8"), statSync(claudeConfig).mtimeMs], before, "read, never written");

  // Established trust is a passing item naming the file read.
  for (const [args, file, harness] of [[["--home", h1], codexConfig, "codex"], [["--home", k1], claudeConfig, "claude"], [["--soul", "dev"], codexConfig, "codex"]]) {
    const [i, ...rest] = trustItems(args);
    assert.deepEqual(rest, [], JSON.stringify(args));
    assert.deepEqual([i.status, i.required, i.reason, i.harness, i.file, i.deployment], ["pass", false, null, harness, file, dep], JSON.stringify(args));
  }

  // A start re-plans from the home: the override follows the root's trust now.
  let p = fx.cli(["launch-config", "preview", "--home", h1, "--json"]);
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(p.json().result.argv.includes(trustArg(realpathSync(h1))), JSON.stringify(p.json().result.argv));
  rmSync(codexConfig);
  p = fx.cli(["launch-config", "preview", "--home", h1, "--json"]);
  assert.ok(!p.json().result.argv.some((a) => /trust_level/.test(a)), JSON.stringify(p.json().result.argv));
});

test("readiness of a soul whose launch configuration is yolo: the codex launch trusts its home, so no harness-trust warning", (t) => {
  const fx = v2Deployment({ local: { "launch-configs": { cxyolo: { harness: "codex", yolo: true }, cxplain: { harness: "codex" } }, souls: { launch: { dev: "cxyolo", other: "cxplain" } } }, souls: { dev: {}, other: {} } });
  t.after(fx.cleanup);
  const trustItems = (soul) => { const r = fx.cli(["readiness", "--soul", soul, "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr); return r.json().result.checks.configured.items.filter((i) => i.code === "harness-trust"); };
  assert.deepEqual(trustItems("dev").map((i) => i.status), ["pass"]);
  assert.deepEqual(trustItems("other").map((i) => i.status), ["fail"], "the same codex launch without yolo has no trust established");
});

test("a launch configuration's CODEX_HOME is the file its trust is read from: it drives trustHome at spawn and at start, and readiness names it", async (t) => {
  const fx = v2Deployment({ local: { "launch-configs": { cxwork: { harness: "codex" } }, souls: { launch: { dev: "cxwork" } } } }); t.after(fx.cleanup);
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  const dep = realpathSync(fx.dep), work = join(fx.base, "codex-work"), workConfig = join(work, "config.toml");
  const ambient = join(fx.env.HOME, ".codex"), ambientConfig = join(ambient, "config.toml");
  mkdirSync(work); mkdirSync(ambient, { recursive: true });
  const localPath = join(fx.dep, "oats-local.yaml"), local = YAML.parse(readFileSync(localPath, "utf8"));
  local["launch-configs"].cxwork.env = { CODEX_HOME: work };
  writeFileSync(localPath, YAML.stringify(local));
  // The ambient file trusts the root, the launch's own does not: the launch is not trusted.
  writeFileSync(ambientConfig, `[projects."${dep}"]\ntrust_level = "trusted"\n`);
  let r = await fx.spawn("dev", { purpose: "a" });
  let meta = JSON.parse(readFileSync(join(r.home, "instance.json"), "utf8"));
  assert.doesNotMatch(meta.command, /trust_level/);
  assert.ok(r.warnings?.includes(`codex folder trust is not established in ${workConfig}: oats harness trust --dir ${dep}`), JSON.stringify(r.warnings));
  const items = (args) => { const out = fx.cli(["readiness", ...args, "--json"]); assert.equal(out.status, 0, out.stdout + out.stderr); return out.json().result.checks.configured.items.filter((i) => i.code === "harness-trust"); };
  assert.deepEqual(items(["--soul", "dev"]).map((i) => [i.status, i.file]), [["fail", workConfig]]);
  assert.deepEqual(items(["--home", r.home]).map((i) => [i.status, i.file]), [["fail", workConfig]]);
  // The launch's own file trusts the root: the override follows, at spawn and at start.
  writeFileSync(workConfig, `[projects."${dep}"]\ntrust_level = "trusted"\n`);
  rmSync(ambientConfig);
  r = await fx.spawn("dev", { purpose: "b" });
  meta = JSON.parse(readFileSync(join(r.home, "instance.json"), "utf8"));
  assert.ok(meta.command.includes(`-c '${trustArg(realpathSync(r.home))}'`), meta.command);
  assert.equal((r.warnings || []).filter((w) => /folder trust/.test(w)).length, 0, JSON.stringify(r.warnings));
  const p = fx.cli(["launch-config", "preview", "--home", r.home, "--json"]);
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(p.json().result.argv.includes(trustArg(realpathSync(r.home))), JSON.stringify(p.json().result.argv));
  assert.deepEqual(items(["--soul", "dev"]).map((i) => [i.status, i.file]), [["pass", workConfig]]);
  assert.deepEqual(items(["--home", r.home]).map((i) => [i.status, i.file]), [["pass", workConfig]]);
});

test("readiness reads a claude launch configuration's CLAUDE_CONFIG_DIR reference from the host env; an unset reference is named", (t) => {
  const fx = v2Deployment({ local: { "launch-configs": { work: { harness: "claude", env: { CLAUDE_CONFIG_DIR: { fromEnv: "WORK_CLAUDE" } } } }, souls: { launch: { dev: "work" } } } }); t.after(fx.cleanup);
  const dep = realpathSync(fx.dep), work = join(fx.base, "claude-work"), workConfig = join(work, ".claude.json");
  mkdirSync(work);
  const items = (extra) => { const out = fx.cli(["readiness", "--soul", "dev", "--json"], { env: extra }); assert.equal(out.status, 0, out.stdout + out.stderr); return out.json().result.checks.configured.items.filter((i) => i.code === "harness-trust"); };
  // The ambient file trusts the root; the launch does not read it.
  writeFileSync(join(fx.env.HOME, ".claude.json"), JSON.stringify({ projects: { [dep]: { hasTrustDialogAccepted: true } } }));
  assert.deepEqual(items({ WORK_CLAUDE: work }).map((i) => [i.status, i.reason]), [["fail", `claude folder trust is not established in ${workConfig}: oats harness trust --dir ${dep}`]]);
  writeFileSync(workConfig, JSON.stringify({ projects: { [dep]: { hasTrustDialogAccepted: true } } }));
  assert.deepEqual(items({ WORK_CLAUDE: work }).map((i) => [i.status, i.file]), [["pass", workConfig]]);
  assert.deepEqual(items({}).map((i) => [i.status, i.reason]), [["fail", "claude folder trust is not established: launch configuration work: CLAUDE_CONFIG_DIR references WORK_CLAUDE, not set on this host"]]);
});
