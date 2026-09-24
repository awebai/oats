// Pin ordinary native launch and complete OATS home composition. No native
// harness/model/backend/auth runs; the scaffold case executes approved fixture
// hooks only, with tripwires in place of runtime/backend executables.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

test("ordinary native launch retains complete approved OATS homes for Claude and Codex", t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-native-full-home-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = join(base, "bin"), user = join(base, "user"), state = join(base, "state");
  for (const dir of [bin, user, state]) mkdirSync(dir);
  symlinkSync(process.execPath, join(bin, "node"));
  const tripwire = join(base, "native-invoked");
  for (const name of ["claude", "codex", "pi", "tmux", "herdr"]) {
    const file = join(bin, name);
    writeFileSync(file, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(tripwire)}, 'unexpected native invocation');process.exit(99);\n`);
    chmodSync(file, 0o755);
  }
  const core = new URL("../lib/core.mjs", import.meta.url).href;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import {existsSync,lstatSync,mkdirSync,readFileSync,readlinkSync,readdirSync,symlinkSync,writeFileSync} from 'node:fs';
    import {dirname,join} from 'node:path';
    import {acquirePackage,approveCapability,capabilityTrust,describeLaunchCommand,findAgent,retireInstance,spawnInstance} from ${JSON.stringify(core)};
    const base=process.cwd(),context=join(base,'context'),root=join(context,'agents'),soul=join(root,'probe','soul');
    const write=(file,body)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body);};
    const capability='fixture.native-home',source=join(base,'fixture-package'),cap=join(source,'cap');
    const events=join(base,'hook-events.jsonl'),tripwire=join(base,'native-invoked');
    const canonical='# Canonical complete native role\\n';
    write(join(soul,'soul.yaml'),'name: probe\\nwork: directory\\n');
    write(join(soul,'AGENTS.md'),canonical);symlinkSync('AGENTS.md',join(soul,'CLAUDE.md'));
    write(join(soul,'skills','native-private','SKILL.md'),'---\\nname: native-private\\ndescription: Fixture private skill.\\n---\\n# Private skill\\n');
    write(join(soul,'skills','native-private','references','detail.txt'),'private resource bytes');
    write(join(source,'oats-package.json'),JSON.stringify({package:'fixture.native-home-package',version:'1.0.0',description:'Owned test payload',compatibility:{oats:'>=0.1.0'},capabilities:['cap']}));
    write(join(cap,'oats.json'),JSON.stringify({capability,version:'1.0.0',description:'Controlled complete-home capability',compatibility:{oats:'>=0.1.0'},skills:['skills/native-cap'],inject:'inject.md',hooks:{spawn:{command:'spawn.mjs',required:true},retire:'retire.mjs'}}));
    write(join(cap,'inject.md'),'## Resolved native capability instructions\\n');
    write(join(cap,'skills','native-cap','SKILL.md'),'---\\nname: native-cap\\ndescription: Fixture capability skill.\\n---\\n# Capability skill\\n');
    write(join(cap,'skills','native-cap','references','resource.txt'),'capability resource bytes');
    write(join(cap,'spawn.mjs'),[
      "import {appendFileSync,writeFileSync} from 'node:fs';",
      "appendFileSync("+JSON.stringify(events)+",process.env.OATS_INSTANCE+'\\\\n');",
      "writeFileSync(process.env.OATS_INSTANCE_HOME+'/work/from-hook.txt','hook work retained');",
      "console.log(JSON.stringify({meta:{configured:true},brief:'fixture capability briefing'}));"
    ].join('\\n'));
    write(join(cap,'retire.mjs'),'console.log(JSON.stringify({meta:{retired:true}}));\\n');
    write(join(context,'oats-config.yaml'),'capabilities:\\n  layers:\\n    knowledge: none\\n    messaging: none\\n    tasks: none\\n  additive:\\n    fixture.native-home:\\n      from: installed\\n      global: true\\n');
    acquirePackage(context,source); // real local fixture acquisition; no fabricated lock/metadata
    const agent=findAgent(root,'probe');
    assert.equal(capabilityTrust(context,capability).trusted,false);
    for(const runtime of ['claude','codex']) {
      const instance='probe-unapproved-'+runtime;
      assert.throws(()=>spawnInstance(root,agent,{instance,runtime,launch:false}),{code:'E_REQUIRED_HOOK_UNTRUSTED'});
      assert.equal(existsSync(join(root,'probe','instances',instance)),false,'approval refusal precedes home publication');
    }
    assert.equal(existsSync(events),false,'unapproved capability hook did not run');
    approveCapability(context,capability);
    assert.equal(capabilityTrust(context,capability).trusted,true);
    for(const runtime of ['claude','codex']) {
      const task='Bounded '+runtime+' fixture task',instance='probe-native-'+runtime;
      const result=spawnInstance(root,agent,{instance,runtime,launch:false,task});
      const home=result.home,meta=JSON.parse(readFileSync(join(home,'instance.json'),'utf8'));
      assert.equal(result.launched,false);assert.equal(meta.launched,false);assert.equal(meta.runtime,runtime);
      assert.equal(meta.home,home);assert.equal(meta.work,'directory');assert.equal(Object.hasOwn(meta,'yolo'),false);
      assert.equal(lstatSync(join(home,'work')).isDirectory(),true);assert.equal(lstatSync(join(home,'work')).isSymbolicLink(),false);
      assert.equal(lstatSync(join(home,'AGENTS.md')).isFile(),true);assert.equal(lstatSync(join(home,'AGENTS.md')).isSymbolicLink(),false);
      assert.equal(readlinkSync(join(home,'CLAUDE.md')),'AGENTS.md');assert.equal(readlinkSync(join(home,'.claude','skills')),'../.agents/skills');
      assert.equal(existsSync(join(home,'soul')),false);assert.equal(meta.soulDir,soul);
      const instructions=readFileSync(join(home,'AGENTS.md'),'utf8');
      assert.ok(instructions.includes(canonical.trim()));assert.match(instructions,/Resolved native capability instructions/);assert.match(instructions,/Work mode: directory/);
      const names=readdirSync(join(home,'.agents','skills')).sort();
      assert.deepEqual(names,['native-cap','native-private','oats','oats-config','oats-packages']);
      assert.deepEqual(meta.skills.map(s=>s.name).sort(),names);
      assert.deepEqual(meta.composition.materialized.skills.map(s=>s.name).sort(),names);
      for(const name of names)assert.equal(lstatSync(join(home,'.agents','skills',name)).isDirectory(),true);
      assert.equal(readFileSync(join(home,'.agents','skills','native-cap','references','resource.txt'),'utf8'),'capability resource bytes');
      assert.equal(readFileSync(join(home,'.agents','skills','native-private','references','detail.txt'),'utf8'),'private resource bytes');
      assert.ok(meta.composition.expected.some(row=>row.type==='skill-tree'&&row.source===capability));
      assert.ok(meta.composition.expected.some(row=>row.type==='instruction-block'&&row.source==='capability:'+capability));
      assert.deepEqual(meta.composition.materialized.instructions,meta.instructions);
      assert.equal(meta.capabilities.length,1);assert.equal(meta.capabilities[0].id,capability);assert.equal(meta.capabilities[0].trusted,true);
      assert.deepEqual(meta.capabilityMeta[capability],{configured:true});
      assert.equal(meta.capabilityRuntime[0].trust.trusted,true);assert.ok(meta.capabilityRuntime[0].requiredHooks.includes('spawn'));
      const briefing=readFileSync(join(home,'TASK.md'),'utf8');assert.ok(briefing.includes(task));assert.match(briefing,/fixture capability briefing/);
      assert.equal(readFileSync(join(home,'work','from-hook.txt'),'utf8'),'hook work retained');
      assert.ok(meta.composition.materialized.runtimePosture.ambient.length>0,'native coexistence remains explicit');
      assert.equal(Object.hasOwn(meta.composition.materialized.runtimePosture,'curtailed'),false);
      const argv=describeLaunchCommand(meta.command).argv;
      assert.deepEqual(argv,[...(runtime==='codex'?['--cd',home]:[]),'--','"$(cat TASK.md)"']);
      assert.doesNotMatch(meta.command,/--no-skills|--no-context-files|dangerously-skip-permissions|--yolo|trust_level|oats-pi-sdk-host/);
      const retired=retireInstance(root,result.instance);
      assert.equal(existsSync(home),false);assert.equal(retired.worktreeRemoved,false);
      assert.equal(readFileSync(join(retired.workRecovery.path,'work','from-hook.txt'),'utf8'),'hook work retained');
    }
    assert.deepEqual(readFileSync(events,'utf8').trim().split('\\n'),['probe-native-claude','probe-native-codex']);
    assert.equal(readFileSync(join(soul,'AGENTS.md'),'utf8'),canonical,'canonical source was not rewritten');
    assert.equal(existsSync(tripwire),false,'no native runtime/backend was invoked');
    console.log('complete homes, approval refusal, approved hooks and normal retirement verified for both native runtimes');
  `], { cwd: base, encoding: "utf8", timeout: 30_000,
    env: { HOME: user, OATS_HOME_DIR: state, PATH: bin }, stdio: ["ignore", "pipe", "pipe"] });
  assert.match(output, /complete homes, approval refusal, approved hooks and normal retirement verified/);
});
