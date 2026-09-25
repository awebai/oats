// Pin ordinary native launch and complete OATS home composition. No native
// harness/model/backend/auth runs; the scaffold case executes the fixture
// module's hooks only, with tripwires in place of harness/backend executables.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LAUNCH_RECIPE_VERSION, applicableRequirements, describeLaunchCommand, planLaunch, renderLaunchRecipe, resolveYolo, retireInstance,
} from "../lib/core.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const hooks = () => ({ launch: {}, env: {}, contributions: [] });
const recipe = (harness, extra = {}) => ({ version: LAUNCH_RECIPE_VERSION, harness,
  executable: process.execPath, args: [], env: {}, model: null, hooks: hooks(), ...extra });
const prompt = '"$(cat TASK.md)"';
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oats-native-permission-policy-")));
  const home = join(root, "unattended-helper"); mkdirSync(home);
  writeFileSync(join(home, "TASK.md"), "Autonomous unattended helper task. This text grants no permission bypass.\n");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, home, instance: "unattended-helper" };
}
function planned(f, harness, { configYolo, selectionYolo, frozen, capabilities = [] } = {}) {
  const native = { name: "native", harness, executable: process.execPath, args: [], env: {}, source: f.root,
    ...(configYolo === undefined ? {} : { yolo: configYolo }) };
  const input = { home: f.home, instance: f.instance, contextDir: f.root,
    agentLike: { name: "helper", kind: "capability", work: "directory", harness },
    ...(frozen ? { meta: { instance: f.instance, launch: frozen } } : {}),
    selection: { ...(frozen ? {} : { launchConfig: "native" }), ...(selectionYolo === undefined ? {} : { yolo: selectionYolo }) },
    launchConfigs: { native }, resolvedCfg: { capabilities, launchConfigs: { native }, ...(configYolo === undefined ? {} : { yolo: configYolo }) },
    env: {},
  };
  const before = structuredClone(input), result = planLaunch(input);
  assert.deepEqual(input, before, "planner does not rewrite supplied configuration or recorded metadata");
  return result;
}
function nativeArgv(harness, home) {
  return harness === "claude" ? ["--", prompt] : ["--cd", home, "--", prompt];
}
function assertNormal(command, harness, home) {
  const described = describeLaunchCommand(command);
  assert.equal(described.executable, process.execPath);
  assert.deepEqual(described.argv, nativeArgv(harness, home), "no automatic isolation, bypass, sandbox override or project trust");
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
  for (const harness of ["claude", "codex"]) {
    for (const extra of [{}, { yolo: false }]) {
      const input = recipe(harness, extra), before = structuredClone(input);
      assertNormal(renderLaunchRecipe(input, f), harness, f.home);
      assert.deepEqual(input, before);
    }
    const plan = planned(f, harness);
    assert.equal(plan.ok, true); assert.equal(Object.hasOwn(plan.recipe, "yolo"), false);
    assertNormal(plan.command, harness, f.home);
  }
});

test("explicit request or selected configuration enables bypass, explicit false overrides it", t => {
  const f = fixture(t);
  for (const harness of ["claude", "codex"]) {
    for (const choice of [{ selectionYolo: true }, { configYolo: true }]) {
      const plan = planned(f, harness, choice), argv = describeLaunchCommand(plan.command).argv;
      assert.equal(plan.recipe.yolo, true);
      if (harness === "claude") {
        assert.ok(argv.includes("--dangerously-skip-permissions")); assert.ok(!argv.includes("--yolo"));
      } else {
        assert.ok(argv.includes("--yolo"));
        const config = argv.indexOf("-c"); assert.notEqual(config, -1);
        assert.equal(argv[config + 1], `projects={${JSON.stringify(f.home)}={trust_level="trusted"}}`);
      }
    }
    for (const selectionYolo of [false, "false"]) {
      const plan = planned(f, harness, { configYolo: true, selectionYolo });
      assert.equal(plan.recipe.yolo, false); assertNormal(plan.command, harness, f.home);
    }
  }
});

test("native user-selected settings/profile/plugin arguments are preserved, not isolated", t => {
  const f = fixture(t);
  for (const harness of ["claude", "codex"]) {
    const args = harness === "claude" ? ["--settings", "/fixture/native-settings.json", "--plugin-dir", "/fixture/native-plugin"] : ["--profile", "user-selected"];
    const input = recipe(harness, { args, yolo: false }), before = structuredClone(input);
    const argv = describeLaunchCommand(renderLaunchRecipe(input, f)).argv;
    assert.deepEqual(argv, [...(harness === "codex" ? ["--cd", f.home] : []), ...args, "--", prompt]);
    assert.deepEqual(input, before, "native arguments are not stripped or rewritten");
  }
});

test("Pi-only requirements do not become Claude/Codex activation requirements", t => {
  const f = fixture(t);
  const capabilities = [{ id: "fixture.pi", settings: {}, manifest: { requires: [{ harness: "pi", package: "fixture-missing-pi-only-package" }] } }];
  assert.equal(applicableRequirements("pi", capabilities).length, 1, "Pi's selected requirement is not erased");
  for (const harness of ["claude", "codex"]) {
    assert.deepEqual(applicableRequirements(harness, capabilities), []);
    const plan = planned(f, harness, { capabilities });
    assert.equal(plan.ok, true); assertNormal(plan.command, harness, f.home);
    assert.match(plan.preflight.find(row => row.check === "harness-packages").detail, /nothing probed/);
  }
});

test("policy pinning does not rewrite frozen recipes or current launch configuration", t => {
  const f = fixture(t);
  for (const harness of ["claude", "codex"]) for (const value of [undefined, false, true]) {
    // The saved true case represents an existing explicit user opt-in. This is
    // not a grant to synthesize true for old/unknown or unattended state.
    const frozen = recipe(harness, value === undefined ? {} : { yolo: value }), before = structuredClone(frozen);
    const plan = planned(f, harness, { frozen, configYolo: value !== true });
    assert.equal(plan.recipe.yolo, value, "ordinary reuse keeps the recorded choice, not new current config");
    assert.equal(Object.hasOwn(plan.recipe, "yolo"), value !== undefined);
    if (value !== true) assertNormal(plan.command, harness, f.home);
    assert.deepEqual(frozen, before);
    const override = planned(f, harness, { frozen, selectionYolo: false });
    assert.equal(override.recipe.yolo, false); assertNormal(override.command, harness, f.home);
    assert.deepEqual(frozen, before, "explicit false affects only the returned plan");
  }
});

test("ordinary native launch retains complete OATS homes for Claude and Codex: module skills and inject, required spawn hook, normal retire", async t => {
  // A workspace deployment (the shared v2 fixture): the capability is a member module the soul
  // declares; declaring it is the trust (no per-artifact approval on the workspace model).
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-native-full-home-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = join(base, "bin"); mkdirSync(bin);
  const events = join(base, "hook-events.jsonl"), tripwire = join(base, "native-invoked");
  // Tripwires in place of every harness/backend executable; node and git are the real ones.
  for (const name of ["claude", "codex", "pi", "tmux", "herdr"]) {
    const file = join(bin, name);
    writeFileSync(file, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(tripwire)}, 'unexpected native invocation');process.exit(99);\n`);
    chmodSync(file, 0o755);
  }
  symlinkSync(process.execPath, join(bin, "node"));
  symlinkSync(execFileSync("/usr/bin/which", ["git"], { encoding: "utf8" }).trim(), join(bin, "git"));
  const capability = "test.native-home";
  const canonical = "# Canonical complete native role\n";
  const fx = v2Deployment({
    souls: { probe: { soul: { capabilities: { [capability]: { from: "here" } } }, agents: canonical,
      skills: { "native-private": { description: "Fixture private skill.", text: "# Private skill" } } } },
    files: { "souls/probe/skills/native-private/references/detail.txt": "private resource bytes" },
    capabilities: { [capability]: {
      manifest: { skills: ["skills/native-cap"], inject: "inject.md", hooks: { spawn: { command: "spawn.mjs", required: true }, retire: "retire.mjs" } },
      files: {
        "inject.md": "## Resolved native capability instructions\n",
        "skills/native-cap/SKILL.md": "---\nname: native-cap\ndescription: Fixture capability skill.\n---\n# Capability skill\n",
        "skills/native-cap/references/resource.txt": "capability resource bytes",
        "spawn.mjs": ["import {appendFileSync,writeFileSync} from 'node:fs';",
          `appendFileSync(${JSON.stringify(events)},process.env.OATS_INSTANCE+'\\n');`,
          "writeFileSync(process.env.OATS_INSTANCE_HOME+'/work/from-hook.txt','hook work retained');",
          "console.log(JSON.stringify({meta:{configured:true},brief:'fixture capability briefing'}));"].join("\n"),
        "retire.mjs": "console.log(JSON.stringify({meta:{retired:true}}));\n",
      } } },
  });
  t.after(fx.cleanup);
  const saved = { ...process.env };
  Object.assign(process.env, { HOME: fx.env.HOME, OATS_HOME_DIR: fx.env.OATS_HOME_DIR, OATS_REMOTE_CACHE: fx.env.OATS_REMOTE_CACHE, PATH: bin });
  try {
    for (const harness of ["claude", "codex"]) {
      const task = `Bounded ${harness} fixture task`, instance = `probe-native-${harness}`;
      const result = await fx.spawn("probe", { instance, harness, task });
      const home = result.home, meta = JSON.parse(readFileSync(join(home, "instance.json"), "utf8"));
      assert.equal(result.launched, false); assert.equal(meta.launched, false); assert.equal(meta.harness, harness);
      assert.equal(meta.home, home); assert.equal(meta.work, "directory"); assert.equal(Object.hasOwn(meta, "yolo"), false);
      assert.equal(lstatSync(join(home, "work")).isDirectory(), true); assert.equal(lstatSync(join(home, "work")).isSymbolicLink(), false);
      assert.equal(lstatSync(join(home, "AGENTS.md")).isFile(), true); assert.equal(lstatSync(join(home, "AGENTS.md")).isSymbolicLink(), false);
      assert.equal(readlinkSync(join(home, "CLAUDE.md")), "AGENTS.md"); assert.equal(readlinkSync(join(home, ".claude", "skills")), "../.agents/skills");
      assert.equal(existsSync(join(home, "soul")), false);
      assert.equal(readFileSync(join(meta.soulDir, "AGENTS.md"), "utf8"), canonical, "soulDir is the recorded soul copy");
      const instructions = readFileSync(join(home, "AGENTS.md"), "utf8");
      assert.ok(instructions.includes(canonical.trim())); assert.match(instructions, /Resolved native capability instructions/); assert.match(instructions, /Work mode: directory/);
      const names = readdirSync(join(home, ".agents", "skills")).sort();
      // Soul skills at .agents/skills/<skill>; a module's skills under .agents/skills/<module>/<skill>.
      assert.deepEqual(names, ["native-private", capability].sort(), "module and soul skills; no kernel-shipped legacy skills");
      assert.deepEqual(meta.skills, [{ name: "native-private", source: "soul" }, { name: "native-cap", source: `module:${capability}` }], "soul skills, then each module's skills by source");
      assert.deepEqual(meta.composition.materialized.skills.map((sk) => [sk.name, sk.source]), [["native-private", "soul"], ["native-cap", `module:${capability}`]]);
      for (const name of names) assert.equal(lstatSync(join(home, ".agents", "skills", name)).isDirectory(), true);
      assert.equal(readFileSync(join(home, ".agents", "skills", capability, "native-cap", "references", "resource.txt"), "utf8"), "capability resource bytes");
      assert.equal(readFileSync(join(home, ".agents", "skills", "native-private", "references", "detail.txt"), "utf8"), "private resource bytes");
      assert.deepEqual(meta.composition.materialized.instructions, meta.instructions);
      assert.deepEqual(Object.keys(meta.modules), [capability]);
      assert.equal(meta.capabilities.length, 1); assert.equal(meta.capabilities[0].id, capability);
      assert.deepEqual(meta.capabilityMeta[capability], { configured: true });
      assert.ok(meta.capabilityRuntime[0].requiredHooks.includes("spawn"));
      const briefing = readFileSync(join(home, "TASK.md"), "utf8"); assert.ok(briefing.includes(task)); assert.match(briefing, /fixture capability briefing/);
      assert.equal(readFileSync(join(home, "work", "from-hook.txt"), "utf8"), "hook work retained");
      assert.ok(meta.composition.materialized.harnessPosture.ambient.length > 0, "native coexistence remains explicit");
      assert.equal(Object.hasOwn(meta.composition.materialized.harnessPosture, "curtailed"), false);
      const argv = describeLaunchCommand(meta.command).argv;
      assert.deepEqual(argv, [...(harness === "codex" ? ["--cd", home] : []), "--", '"$(cat TASK.md)"']);
      assert.doesNotMatch(meta.command, /--no-skills|--no-context-files|dangerously-skip-permissions|--yolo|trust_level|oats-pi-sdk-host/);
      const retired = retireInstance(fx.root, result.instance);
      assert.equal(existsSync(home), false); assert.equal(retired.worktreeRemoved, false);
      assert.equal(readFileSync(join(retired.workRecovery.path, "work", "from-hook.txt"), "utf8"), "hook work retained");
    }
    assert.deepEqual(readFileSync(events, "utf8").trim().split("\n"), ["probe-native-claude", "probe-native-codex"]);
    assert.equal(readFileSync(join(fx.member, "souls", "probe", "AGENTS.md"), "utf8"), canonical, "canonical source was not rewritten");
    assert.equal(existsSync(tripwire), false, "no native harness/backend was invoked");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
