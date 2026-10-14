// What the Start dialog's "No launch configuration" does on the REAL kernel (awebai/oats#1079). The dialog
// sends the word `none` (packages/client/launch-contract.mjs `LAUNCH_CONFIG_NONE`), alone or beside a
// harness, and tells a person it "runs the harness itself, with no configuration's executable, arguments
// or environment". This file holds that on the kernel's own planner (lib/core.mjs `planLaunch`, the one a
// start and `oats launch-config preview` share), for a home that recorded a configuration, on a host that
// also declares a default configuration for that harness.
// Every assertion is on a value of the plan; no kernel text is read. This file reads lib/ and edits nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planLaunch } from "../lib/core.mjs";
import { LAUNCH_CONFIG_NONE } from "../packages/client/launch-contract.mjs";

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-start-bare-harness-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
// The planner looks a harness's own binary up on this process's PATH: stand-ins go first, so a host without
// the real harnesses plans like one with them.
const binDir = join(base, "bin"); mkdirSync(binDir);
for (const name of ["claude", "codex"]) { writeFileSync(join(binDir, name), "#!/bin/sh\nexit 0\n"); chmodSync(join(binDir, name), 0o755); }
process.env.PATH = `${binDir}:${process.env.PATH}`;
const wrapper = join(base, "recorded-wrapper"); writeFileSync(wrapper, "#!/bin/sh\nexit 0\n"); chmodSync(wrapper, 0o755);
const other = join(base, "default-wrapper"); writeFileSync(other, "#!/bin/sh\nexit 0\n"); chmodSync(other, 0o755);

const home = join(base, "home"); mkdirSync(home);
/** What the home recorded at its last launch: the configuration `recorded`, as it then was. */
const RECORDED = { version: 2, harness: "claude", launchConfig: "recorded", launchConfigSource: base, executable: wrapper, executableDeclared: wrapper,
  executableResolvedFrom: "launch-config", args: ["--recorded-argument"], env: { RECORDED_NAME: "recorded-value" }, hooks: { launch: {}, env: {}, contributions: [] },
  model: null, yolo: false, prompt: { kind: "task-file", file: "TASK.md" } };
const meta = { instance: "seat", agent: "dev", home, harness: "claude", launch: RECORDED };
/** What the host declares now: the recorded configuration still, and a DEFAULT one for the same harness. */
const DECLARED = {
  recorded: { name: "recorded", harness: "claude", source: base, executable: wrapper, args: ["--recorded-argument"], env: { RECORDED_NAME: "recorded-value" } },
  usual: { name: "usual", harness: "claude", source: base, executable: other, args: ["--default-argument"], env: { DEFAULT_NAME: "default-value" }, default: true },
};
const plan = selection => planLaunch({ home, meta, contextDir: base, agentLike: { harness: "claude" }, selection, launchConfigs: DECLARED, env: {}, preview: true });
/** The parts of a plan the dialog's line speaks of. */
const shape = p => ({ harness: p.recipe.harness, launchConfig: p.recipe.launchConfig, executable: p.recipe.executable, declared: p.recipe.executableDeclared,
  args: p.recipe.args, env: p.recipe.env, fromDefault: p.recipe.launchConfigDefault === true });

test("the word alone, on a home that recorded a configuration: the recorded harness, with no configuration's executable, arguments or environment", () => {
  assert.equal(LAUNCH_CONFIG_NONE, "none");
  const bare = plan({ launchConfig: LAUNCH_CONFIG_NONE });
  assert.deepEqual(shape(bare), { harness: "claude", launchConfig: null, executable: join(binDir, "claude"), declared: null, args: [], env: {}, fromDefault: false });
  assert.equal(bare.config, null, "no configuration was selected, the host's default for the harness included");
  assert.equal(bare.ok, true);

  // The contrast that makes the choice a choice: what the same home plans without the word.
  const kept = plan({});
  assert.deepEqual(shape(kept), { harness: "claude", launchConfig: "recorded", executable: wrapper, declared: wrapper, args: ["--recorded-argument"], env: { RECORDED_NAME: "recorded-value" }, fromDefault: false },
    "an ordinary start runs what was recorded");
  const harnessOnly = plan({ harness: "claude" });
  assert.deepEqual(shape(harnessOnly), { harness: "claude", launchConfig: "usual", executable: other, declared: other, args: ["--default-argument"], env: { DEFAULT_NAME: "default-value" }, fromDefault: true },
    "the harness alone takes the host's default configuration for it, which is not the bare harness");
});

test("the word beside a harness: that harness, bare, whatever the home recorded and the host declares", () => {
  const same = plan({ launchConfig: LAUNCH_CONFIG_NONE, harness: "claude" });
  assert.deepEqual(shape(same), { harness: "claude", launchConfig: null, executable: join(binDir, "claude"), declared: null, args: [], env: {}, fromDefault: false });
  const another = plan({ launchConfig: LAUNCH_CONFIG_NONE, harness: "codex" });
  assert.deepEqual(shape(another), { harness: "codex", launchConfig: null, executable: join(binDir, "codex"), declared: null, args: [], env: {}, fromDefault: false });
});
