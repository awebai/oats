// Pin ordinary native launch behavior. No harness/model/backend/plugin/auth
// process is executed; planner checks only an explicitly selected local binary.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LAUNCH_RECIPE_VERSION, applicableRequirements, describeLaunchCommand, planLaunch, renderLaunchRecipe, resolveYolo,
} from "../lib/core.mjs";

const hooks = () => ({ launch: {}, env: {}, contributions: [] });
const recipe = (runtime, extra = {}) => ({ version: LAUNCH_RECIPE_VERSION, runtime,
  executable: process.execPath, args: [], env: {}, model: null, hooks: hooks(), ...extra });
const prompt = '"$(cat TASK.md)"';
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oats-native-permission-policy-")));
  const home = join(root, "unattended-helper"); mkdirSync(home);
  writeFileSync(join(home, "TASK.md"), "Autonomous unattended helper task. This text grants no permission bypass.\n");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, home, instance: "unattended-helper" };
}
function planned(f, runtime, { configYolo, selectionYolo, frozen, capabilities = [] } = {}) {
  const native = { name: "native", runtime, executable: process.execPath, args: [], env: {}, source: f.root,
    ...(configYolo === undefined ? {} : { yolo: configYolo }) };
  const input = { home: f.home, instance: f.instance, contextDir: f.root,
    agentLike: { name: "helper", kind: "capability", work: "directory", runtime },
    ...(frozen ? { meta: { instance: f.instance, launch: frozen } } : {}),
    selection: { ...(frozen ? {} : { launchConfig: "native" }), ...(selectionYolo === undefined ? {} : { yolo: selectionYolo }) },
    launchConfigs: { native }, resolvedCfg: { capabilities, launchConfigs: { native }, ...(configYolo === undefined ? {} : { yolo: configYolo }) },
    env: {},
  };
  const before = structuredClone(input), result = planLaunch(input);
  assert.deepEqual(input, before, "planner does not rewrite supplied configuration or recorded metadata");
  return result;
}
function nativeArgv(runtime, home) {
  return runtime === "claude" ? ["--", prompt] : ["--cd", home, "--", prompt];
}
function assertNormal(command, runtime, home) {
  const described = describeLaunchCommand(command);
  assert.equal(described.executable, process.execPath);
  assert.deepEqual(described.argv, nativeArgv(runtime, home), "no automatic isolation, bypass, sandbox override or project trust");
  assert.deepEqual(described.environment.map(row => row.name), ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME"],
    "no manufactured native profile/auth/settings environment");
  assert.doesNotMatch(command, /oats-pi-sdk-host|--sdk-root|--no-skills|--no-context-files|--no-prompt-templates|--append-system-prompt/);
}

test("native permission choice is explicit: undefined remains absent, false is not truthy", () => {
  assert.equal(resolveYolo(undefined), undefined);
  assert.equal(resolveYolo(false), false); assert.equal(resolveYolo("false"), false);
  assert.equal(resolveYolo(true), true); assert.equal(resolveYolo("true"), true);
  for (const invalid of [null, 0, 1, "auto", "unattended"]) assert.throws(() => resolveYolo(invalid), /true or false/);
});

test("Claude/Codex render ordinary native commands without implicit Pi or permission bypass", t => {
  const f = fixture(t);
  for (const runtime of ["claude", "codex"]) {
    for (const extra of [{}, { yolo: false }]) {
      const input = recipe(runtime, extra), before = structuredClone(input);
      assertNormal(renderLaunchRecipe(input, f), runtime, f.home);
      assert.deepEqual(input, before);
    }
    const plan = planned(f, runtime);
    assert.equal(plan.ok, true); assert.equal(Object.hasOwn(plan.recipe, "yolo"), false);
    assertNormal(plan.command, runtime, f.home);
  }
});

test("explicit request or selected configuration enables bypass, explicit false overrides it", t => {
  const f = fixture(t);
  for (const runtime of ["claude", "codex"]) {
    for (const choice of [{ selectionYolo: true }, { configYolo: true }]) {
      const plan = planned(f, runtime, choice), argv = describeLaunchCommand(plan.command).argv;
      assert.equal(plan.recipe.yolo, true);
      if (runtime === "claude") {
        assert.ok(argv.includes("--dangerously-skip-permissions")); assert.ok(!argv.includes("--yolo"));
      } else {
        assert.ok(argv.includes("--yolo"));
        const config = argv.indexOf("-c"); assert.notEqual(config, -1);
        assert.equal(argv[config + 1], `projects={${JSON.stringify(f.home)}={trust_level="trusted"}}`);
      }
    }
    for (const selectionYolo of [false, "false"]) {
      const plan = planned(f, runtime, { configYolo: true, selectionYolo });
      assert.equal(plan.recipe.yolo, false); assertNormal(plan.command, runtime, f.home);
    }
  }
});

test("native user-selected settings/profile/plugin arguments are preserved, not isolated", t => {
  const f = fixture(t);
  for (const runtime of ["claude", "codex"]) {
    const args = runtime === "claude" ? ["--settings", "/fixture/native-settings.json", "--plugin-dir", "/fixture/native-plugin"] : ["--profile", "user-selected"];
    const input = recipe(runtime, { args, yolo: false }), before = structuredClone(input);
    const argv = describeLaunchCommand(renderLaunchRecipe(input, f)).argv;
    assert.deepEqual(argv, [...(runtime === "codex" ? ["--cd", f.home] : []), ...args, "--", prompt]);
    assert.deepEqual(input, before, "native arguments are not stripped or rewritten");
  }
});

test("Pi-only requirements do not become Claude/Codex activation requirements", t => {
  const f = fixture(t);
  const capabilities = [{ id: "fixture.pi", settings: {}, manifest: { requires: [{ runtime: "pi", package: "fixture-missing-pi-only-package" }] } }];
  assert.equal(applicableRequirements("pi", capabilities).length, 1, "Pi's selected requirement is not erased");
  for (const runtime of ["claude", "codex"]) {
    assert.deepEqual(applicableRequirements(runtime, capabilities), []);
    const plan = planned(f, runtime, { capabilities });
    assert.equal(plan.ok, true); assertNormal(plan.command, runtime, f.home);
    assert.match(plan.preflight.find(row => row.check === "runtime-packages").detail, /nothing probed/);
  }
});

test("policy pinning does not rewrite frozen recipes or current launch configuration", t => {
  const f = fixture(t);
  for (const runtime of ["claude", "codex"]) for (const value of [undefined, false, true]) {
    // The saved true case represents an existing explicit user opt-in. This is
    // not a grant to synthesize true for old/unknown or unattended state.
    const frozen = recipe(runtime, value === undefined ? {} : { yolo: value }), before = structuredClone(frozen);
    const plan = planned(f, runtime, { frozen, configYolo: value !== true });
    assert.equal(plan.recipe.yolo, value, "ordinary reuse keeps the recorded choice, not new current config");
    assert.equal(Object.hasOwn(plan.recipe, "yolo"), value !== undefined);
    if (value !== true) assertNormal(plan.command, runtime, f.home);
    assert.deepEqual(frozen, before);
    const override = planned(f, runtime, { frozen, selectionYolo: false });
    assert.equal(override.recipe.yolo, false); assertNormal(override.command, runtime, f.home);
    assert.deepEqual(frozen, before, "explicit false affects only the returned plan");
  }
});
