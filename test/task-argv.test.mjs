// The task text never travels in a launch's argv, where any local user can read it through the process list
// (awebai/oats#427): claude gets `@TASK.md` (Claude Code inlines the file), codex a fixed pointer to the file,
// pi `@TASK.md` as before. A home is created 0700 and TASK.md 0600. A command recorded with the earlier
// `"$(cat TASK.md)"` prompt starts with its harness's safe prompt, and is saved so.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CODEX_TASK_PROMPT, describeLaunchCommand, parseLaunchCommand, renderLaunchCommand, renderLaunchRecipe, withSafeTaskPrompt } from "../lib/core.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const hooks = () => ({ launch: {}, env: {}, contributions: [] });
const recipe = (harness) => ({ harness, executable: `/x/${harness}`, args: [], env: {}, model: null, hooks: hooks() });
const mode = (p) => statSync(p).mode & 0o777;

test("claude and codex launches name the task file; its text is never in argv", () => {
  assert.equal(CODEX_TASK_PROMPT, "Read TASK.md in this directory first: it is your briefing and your task.");
  for (const [harness, prompt] of [["claude", "@TASK.md"], ["codex", CODEX_TASK_PROMPT]]) {
    const cmd = renderLaunchRecipe(recipe(harness), { home: "/h", instance: "n" });
    assert.deepEqual(describeLaunchCommand(cmd).argv.slice(-2), ["--", prompt], harness);
    assert.doesNotMatch(cmd, /\$\(cat/, harness);
    assert.equal(renderLaunchCommand(parseLaunchCommand(cmd).tokens), cmd, `${harness} round-trips`);
  }
  assert.deepEqual(describeLaunchCommand(renderLaunchRecipe(recipe("pi"), { home: "/h", instance: "n" })).argv.slice(-1), ["@TASK.md"]);
});

test("a recorded \"$(cat TASK.md)\" prompt becomes the harness's safe prompt; anything else is left as it is", () => {
  const old = (bin) => `OATS_INSTANCE='n' OATS_INSTANCE_HOME='/h' '/x/${bin}' --model 'm' -- "$(cat TASK.md)"`;
  assert.equal(withSafeTaskPrompt(old("claude"), "claude"), `OATS_INSTANCE='n' OATS_INSTANCE_HOME='/h' '/x/claude' --model 'm' -- '@TASK.md'`);
  assert.equal(withSafeTaskPrompt(old("codex"), "codex"), `OATS_INSTANCE='n' OATS_INSTANCE_HOME='/h' '/x/codex' --model 'm' -- '${CODEX_TASK_PROMPT}'`);
  const current = renderLaunchRecipe(recipe("claude"), { home: "/h", instance: "n" });
  assert.equal(withSafeTaskPrompt(current, "claude"), current, "a current command is unchanged");
  const pi = renderLaunchRecipe(recipe("pi"), { home: "/h", instance: "n" });
  assert.equal(withSafeTaskPrompt(pi, "pi"), pi);
});

test("spawn: the home is 0700 and TASK.md 0600; the task text is in no launch argv", async (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  const task = "SECRET-TASK-TEXT-427: do the private thing";
  for (const harness of ["claude", "codex", "pi"]) {
    const r = await fx.spawn("dev", { purpose: harness, harness, task });
    const meta = JSON.parse(readFileSync(join(r.home, "instance.json"), "utf8"));
    assert.equal(mode(r.home), 0o700, `${harness} home`);
    assert.equal(mode(join(r.home, "TASK.md")), 0o600, `${harness} TASK.md`);
    assert.match(readFileSync(join(r.home, "TASK.md"), "utf8"), /SECRET-TASK-TEXT-427/);
    assert.doesNotMatch(meta.command, /SECRET-TASK-TEXT-427|\$\(cat/, harness);
  }
});

test("doctor names instance homes other users can read, with the exact chmod; it never changes them", async (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  const { home } = await fx.spawn("dev", { purpose: "a" });
  const problems = () => { const r = fx.cli(["doctor", "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout).problems ?? []; };
  assert.deepEqual(problems().filter((p) => p.code === "home-readable"), []);
  chmodSync(home, 0o755);
  const [p] = problems().filter((x) => x.code === "home-readable");
  assert.deepEqual(p.homes, [home]);
  assert.equal(p.fix, `chmod 700 '${home}'`);
  assert.equal(p.message, `1 instance home can be read by other users on this machine (it holds identity keys, TASK.md and transcripts); fix: chmod 700 '${home}'`);
  assert.equal(mode(home), 0o755, "doctor only reports");
});
