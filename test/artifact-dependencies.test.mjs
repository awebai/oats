import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MODULES = ["capability-artifacts.mjs", "artifact-tree.mjs", "capability-provenance.mjs", "errors.mjs"];
const CORE = new URL("../lib/core.mjs", import.meta.url).href;
const RETENTION = new URL("../lib/capability-artifacts.mjs", import.meta.url).href;
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-artifact-foundation-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  for (const dir of ["user", "bin", "state"]) mkdirSync(join(base, dir));
  symlinkSync(process.execPath, join(base, "bin/node"));
  // No ambient identity, credentials, config, runtime, Git, or scheduler.
  const env = { HOME: join(base, "user"), OATS_HOME_DIR: join(base, "state"), PATH: join(base, "bin") };
  return { base, env };
}
function run(f, script, flags = []) {
  return execFileSync(process.execPath, [...flags, "--input-type=module", "-e", script], {
    cwd: f.base, env: f.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

test("actual ESM dependency graph is acyclic, including the future core -> retention edge", (t) => {
  const f = fixture(t);
  const result = run(f, `
    import assert from 'node:assert/strict';
    import { SourceTextModule } from 'node:vm';
    import { readFileSync } from 'node:fs';
    const core = ${JSON.stringify(CORE)}, retention = ${JSON.stringify(RETENTION)};
    const graph = new Map();
    function visit(file) {
      if (graph.has(file)) return;
      // Parse real module declarations (imports AND re-exports), not grep.
      const specs = new SourceTextModule(readFileSync(new URL(file), 'utf8')).dependencySpecifiers;
      for (const spec of specs) {
        if (spec.startsWith('.') || spec.startsWith('node:')) continue;
        // The captured consumer now reaches the approved strict YAML decoder.
        // External packages are outside this repo's ESM graph; allow only that
        // declared edge, not arbitrary new dependencies or retention imports.
        assert.equal(spec, 'yaml');
        assert.equal(file, new URL('./config-data.mjs', core).href);
        const pkg = JSON.parse(readFileSync(new URL('../package.json', core), 'utf8'));
        assert.equal(pkg.dependencies.yaml, '2.9.1');
      }
      const deps = specs.filter(s => s.startsWith('.')).map(s => new URL(s, file).href);
      graph.set(file, deps);
      for (const dep of deps) visit(dep);
    }
    visit(core); visit(retention);
    function acyclic() {
      const active = new Set(), done = new Set();
      function walk(file, path = []) {
        assert.ok(!active.has(file), 'dependency cycle: ' + [...path, file].join(' -> '));
        if (done.has(file)) return;
        active.add(file);
        for (const dep of graph.get(file)) walk(dep, [...path, file]);
        active.delete(file); done.add(file);
      }
      for (const file of graph.keys()) walk(file);
    }
    acyclic();
    const closure = new Set();
    function collect(file) {
      if (closure.has(file)) return;
      closure.add(file);
      for (const dep of graph.get(file)) collect(dep);
    }
    collect(retention);
    assert.equal(closure.has(core), false, 'no transitive retention -> core dependency');
    const expected = ${JSON.stringify(MODULES)}.map(name => new URL(name, retention).href);
    assert.deepEqual([...closure].sort(), expected.sort(), 'retention has only narrow leaf/data dependencies');
    const errors = new URL('./errors.mjs', retention).href;
    for (const name of ['artifact-tree.mjs', 'capability-provenance.mjs']) {
      assert.deepEqual(graph.get(new URL(name, retention).href), [errors]);
    }
    assert.deepEqual(graph.get(errors), []);
    // Prove core can consume retention without a cycle, not merely that it
    // doesn't consume it yet. No production core dependency is introduced.
    graph.get(core).push(retention);
    acyclic();
    // Negative control: the exact old retention -> core path MUST fail.
    graph.get(retention).push(core);
    assert.throws(acyclic, /dependency cycle:/);
    console.log('acyclic with future core edge; old back-edge detected');
  `, ["--experimental-vm-modules"]);
  assert.equal(result, "acyclic with future core edge; old back-edge detected");
});

test("retention imports and verifies in isolation without core, package metadata or runtime modules", (t) => {
  const f = fixture(t);
  for (const name of MODULES) copyFileSync(new URL(`../lib/${name}`, import.meta.url), join(f.base, name));
  const result = run(f, `
    import assert from 'node:assert/strict';
    import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
    import { capabilityArtifactIntegrity } from './artifact-tree.mjs';
    import { retainCapabilityArtifact, verifyRetainedCapability } from './capability-artifacts.mjs';
    const cap = 'example.leaf', pkg = 'example.package';
    mkdirSync('source'); mkdirSync('scope');
    writeFileSync('source/payload', 'isolated bytes');
    const packageRow = { source: 'git:https://example.invalid/package.git@v1', commit: 'a'.repeat(40), path: '.', version: '1.0.0', integrity: 'sha256-' + 'b'.repeat(64), dependencies: [] };
    const row = { package: pkg, version: '1.0.0', path: 'leaf', trusted: false };
    writeFileSync('source/.oats-installation.json', JSON.stringify({ schemaVersion: 1, capability: cap, version: row.version, package: pkg, packageVersion: packageRow.version, source: packageRow.source, commit: packageRow.commit, packagePath: packageRow.path, capabilityPath: row.path }));
    row.integrity = capabilityArtifactIntegrity('source');
    const lock = { packages: { [pkg]: packageRow }, capabilities: { [cap]: row } };
    const receipt = retainCapabilityArtifact('scope', 'source', cap, lock);
    assert.equal(receipt.status, 'retained');
    assert.equal(retainCapabilityArtifact('scope', 'source', cap, lock).status, 'kept');
    rmSync('source', { recursive: true });
    assert.equal(verifyRetainedCapability('scope', cap, lock).dir, receipt.dir);
    assert.equal(readFileSync(receipt.dir + '/payload', 'utf8'), 'isolated bytes');
    assert.equal(readdirSync('.').includes('core.mjs'), false);
    assert.equal(readdirSync('.').includes('package.json'), false);
    console.log('isolated retain/reuse/verify passed');
  `);
  assert.equal(result, "isolated retain/reuse/verify passed");
});

test("changed core scaffold-only probe composes copied resources and retires normally without native backends", (t) => {
  const f = fixture(t);
  const runtime = join(f.base, "bin/pi");
  // Preflight can discover this file but nothing may execute it.
  writeFileSync(runtime, `#!/bin/sh\necho invoked > '${f.base}/runtime-invoked'\nexit 98\n`);
  chmodSync(runtime, 0o755);
  const result = run(f, `
    import assert from 'node:assert/strict';
    import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { findAgent, spawnInstance, retireInstance } from ${JSON.stringify(CORE)};
    const context = join(process.cwd(), 'scope'), root = join(context, 'agents');
    const soul = join(root, 'probe', 'soul'), skill = join(soul, 'skills', 'leaf-skill');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(context, 'oats-config.yaml'), 'capabilities:\\n  layers:\\n    knowledge: none\\n    messaging: none\\n    tasks: none\\n');
    writeFileSync(join(soul, 'soul.yaml'), 'name: probe\\nwork: directory\\nruntime: pi\\n');
    writeFileSync(join(soul, 'AGENTS.md'), '# Artifact leaf probe\\n');
    symlinkSync('AGENTS.md', join(soul, 'CLAUDE.md'));
    writeFileSync(join(skill, 'SKILL.md'), '---\\nname: leaf-skill\\ndescription: Hermetic leaf probe.\\n---\\n# Leaf skill\\n');
    writeFileSync(join(skill, 'payload.bin'), Buffer.from([0, 255, 10]));
    chmodSync(join(skill, 'payload.bin'), 0o751);
    symlinkSync('payload.bin', join(skill, 'alias'));
    const spawned = spawnInstance(root, findAgent(root, 'probe'), { purpose: 'leaf', launch: false });
    assert.equal(spawned.launched, false);
    assert.equal(spawned.work, 'directory');
    assert.equal(lstatSync(join(spawned.home, 'work')).isDirectory(), true);
    assert.equal(lstatSync(join(spawned.home, 'work')).isSymbolicLink(), false);
    assert.equal(readlinkSync(join(spawned.home, 'CLAUDE.md')), 'AGENTS.md');
    assert.equal(readlinkSync(join(spawned.home, '.claude/skills')), '../.agents/skills');
    assert.match(readFileSync(join(spawned.home, 'AGENTS.md'), 'utf8'), /Artifact leaf probe/);
    const copied = join(spawned.home, '.agents/skills/leaf-skill');
    assert.deepEqual(readFileSync(join(copied, 'payload.bin')), Buffer.from([0, 255, 10]));
    assert.equal(lstatSync(join(copied, 'payload.bin')).mode & 0o7777, 0o751);
    assert.equal(readlinkSync(join(copied, 'alias')), 'payload.bin');
    assert.equal(JSON.parse(readFileSync(join(spawned.home, 'instance.json'))).launched, false);
    // Exercise copyTreeSafe's retirement caller too: normal verified recovery,
    // not force, keep-dir or manual removal of the scaffold.
    writeFileSync(join(spawned.home, 'work/result.bin'), Buffer.from([4, 0, 255]));
    chmodSync(join(spawned.home, 'work/result.bin'), 0o751);
    symlinkSync('result.bin', join(spawned.home, 'work/alias'));
    const retired = retireInstance(root, spawned.instance);
    assert.equal(existsSync(spawned.home), false);
    assert.equal(retired.worktreeRemoved, false);
    assert.equal(retired.branchDeleted, false);
    const recovered = join(retired.workRecovery.path, 'work');
    assert.deepEqual(readFileSync(join(recovered, 'result.bin')), Buffer.from([4, 0, 255]));
    assert.equal(lstatSync(join(recovered, 'result.bin')).mode & 0o7777, 0o751);
    assert.equal(readlinkSync(join(recovered, 'alias')), 'result.bin');
    assert.equal(existsSync('runtime-invoked'), false);
    console.log('scaffold inspected; normal retirement and recovery verified; no backend launched');
  `);
  assert.equal(result, "scaffold inspected; normal retirement and recovery verified; no backend launched");
});
