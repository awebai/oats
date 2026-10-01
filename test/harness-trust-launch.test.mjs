// The codex launch recipe and the folder-trust warning (#341): a kernel codex launch never
// stops at Codex's update prompt, trusts its new home only when the operator trusts the
// deployment root (or an ancestor) in config.toml, and a spawn whose harness will stop at its
// folder-trust prompt says so. The operator's harness configuration is never written.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describeLaunchCommand, parseLaunchCommand, renderLaunchCommand, renderLaunchRecipe } from "../lib/core.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const hooks = () => ({ launch: {}, env: {}, contributions: [] });
const codex = (extra = {}) => ({ harness: "codex", executable: "/opt/homebrew/bin/codex", args: [], env: {}, model: null, hooks: hooks(), ...extra });
const prompt = '"$(cat TASK.md)"';
const trustArg = (home) => `projects={${JSON.stringify(home)}={trust_level="trusted"}}`;

test("codex argv: the update prompt is always off; the home is trusted only under root trust or yolo", (t) => {
  const home = realpathSync(join(process.cwd()));
  for (const [extra, opts, argv] of [
    [{}, {}, ["--cd", home, "-c", "check_for_update_on_startup=false", "--", prompt]],
    [{}, { trustHome: false }, ["--cd", home, "-c", "check_for_update_on_startup=false", "--", prompt]],
    [{}, { trustHome: true }, ["--cd", home, "-c", "check_for_update_on_startup=false", "-c", trustArg(home), "--", prompt]],
    [{ yolo: true }, {}, ["--cd", home, "-c", "check_for_update_on_startup=false", "--yolo", "-c", trustArg(home), "--", prompt]],
    [{ yolo: true }, { trustHome: true }, ["--cd", home, "-c", "check_for_update_on_startup=false", "--yolo", "-c", trustArg(home), "--", prompt]],
    [{ model: "gpt-x" }, { trustHome: true }, ["--cd", home, "-c", "check_for_update_on_startup=false", "-c", trustArg(home), "--model", "gpt-x", "--", prompt]],
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

test("spawn: codex trusts the new home only under a trusted root; claude and codex warn when the home is not covered; the operator's config is never written", async (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const userHome = fx.env.HOME, dep = realpathSync(fx.dep);
  const codexConfig = join(userHome, ".codex", "config.toml"), claudeConfig = join(userHome, ".claude.json");
  const spawn = async (purpose, harness) => { const r = await fx.spawn("dev", { purpose, harness }); return { r, meta: JSON.parse(readFileSync(join(r.home, "instance.json"), "utf8")) }; };
  const codexWarning = `the codex session will stop at its folder-trust prompt: trust ${dep} once (run \`codex\` in ${dep} and choose "Trust and continue"; OATS then trusts each new home under it at launch)`;
  const claudeWarning = `the claude session will stop at its folder-trust prompt: trust ${dep} once (run \`claude\` in ${dep} and accept its folder-trust prompt; one entry covers every instance home under it)`;

  // No trust anywhere: no override, and the spawn says the session will stop.
  let { r, meta } = await spawn("c1", "codex");
  assert.doesNotMatch(meta.command, /trust_level/);
  assert.match(meta.command, /-c check_for_update_on_startup=false/);
  assert.ok(r.warnings?.includes(codexWarning), JSON.stringify(r.warnings));
  ({ r } = await spawn("k1", "claude"));
  assert.ok(r.warnings?.includes(claudeWarning), JSON.stringify(r.warnings));

  // The operator trusts the deployment root once.
  mkdirSync(join(userHome, ".codex"));
  writeFileSync(codexConfig, `[projects."${dep}"]\ntrust_level = "trusted"\n`);
  writeFileSync(claudeConfig, JSON.stringify({ projects: { [dep]: { hasTrustDialogAccepted: true } } }));
  const before = [readFileSync(codexConfig, "utf8"), statSync(codexConfig).mtimeMs, readFileSync(claudeConfig, "utf8"), statSync(claudeConfig).mtimeMs];
  ({ r, meta } = await spawn("c2", "codex"));
  assert.ok(meta.command.includes(`-c '${trustArg(realpathSync(r.home))}'`), meta.command);
  assert.equal((r.warnings || []).filter((w) => /folder-trust/.test(w)).length, 0, JSON.stringify(r.warnings));
  ({ r } = await spawn("k2", "claude"));
  assert.equal((r.warnings || []).filter((w) => /folder-trust/.test(w)).length, 0, JSON.stringify(r.warnings));
  assert.deepEqual([readFileSync(codexConfig, "utf8"), statSync(codexConfig).mtimeMs, readFileSync(claudeConfig, "utf8"), statSync(claudeConfig).mtimeMs], before, "read, never written");

  // A start re-plans from the home: the override follows the root's trust now.
  const h1 = join(fx.root, "dev", "instances", "dev-c1");
  let p = fx.cli(["launch-config", "preview", "--home", h1, "--json"]);
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(p.json().result.argv.includes(trustArg(realpathSync(h1))), JSON.stringify(p.json().result.argv));
  rmSync(codexConfig);
  p = fx.cli(["launch-config", "preview", "--home", h1, "--json"]);
  assert.ok(!p.json().result.argv.some((a) => /trust_level/.test(a)), JSON.stringify(p.json().result.argv));
});
