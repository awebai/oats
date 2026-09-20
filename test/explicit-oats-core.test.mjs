import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createAgent, upsertLocalAgent, findAgent, composeInstanceAgentsMd, planInstanceResources, spawnInstance, retireInstance, parseYamlNested } from '../lib/core.mjs';
const CLI = fileURLToPath(new URL('../bin/oats.mjs', import.meta.url));
const SOURCE = 'git:https://catalog.invalid/operations.git@v1.2.3#distribution';
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'oats-explicit-core-'))), context = join(base, 'project'), root = join(context, 'agents');
  const user = join(base, 'user'), bin = join(base, 'bin'), catalog = join(base, 'catalog.json');
  for (const dir of [root, user, bin]) mkdirSync(dir, { recursive: true });
  const write = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  write(catalog, { packages: { 'fixture.operations': { url: 'https://catalog.invalid/operations.git', ref: 'v1.2.3', path: 'distribution' } }, capabilities: { 'oats.core': 'fixture.operations' } });
  const env = { PATH: bin + ':' + process.env.PATH, HOME: user, OATS_PACKAGE_CATALOG: catalog, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const prior = { ...process.env };
  for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, prior); rmSync(base, { recursive: true, force: true }); });
  const run = args => spawnSync(process.execPath, [CLI, ...args], { cwd: context, env, encoding: 'utf8', timeout: 15000 });
  const definition = soul => parseYamlNested(readFileSync(join(soul, 'soul.yaml'), 'utf8'));
  return { base, context, root, bin, catalog, write, run, definition };
}

test('creation writes the actual official alias/source and local updates preserve explicit requirements or removal', t => {
  const f = fixture(t), cli = f.run(['create', 'example', '--work', 'directory', '--json']);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  const created = JSON.parse(cli.stdout), soul = created.soul;
  assert.equal(f.definition(soul).requires.capabilities['oats.core'].source, SOURCE);
  assert.equal(created.notes, undefined); assert.equal(existsSync(join(f.context, '.agents/capabilities/installed')), false, 'declaration is not acquisition');
  const local = upsertLocalAgent(f.root, { name: 'scratch', instructions: '# scratch', work: 'directory', runtime: 'claude' });
  const file = join(local._dir, 'soul/soul.yaml');
  assert.equal(f.definition(dirname(file)).requires.capabilities['oats.core'].source, SOURCE);
  f.write(file, readFileSync(file, 'utf8').replace(/^requires:.*\n/m, 'requires: {capabilities: {example.extra: {source: "repo:extra"}}}\n'));
  upsertLocalAgent(f.root, { name: 'scratch', instructions: '# updated' });
  assert.deepEqual(f.definition(dirname(file)).requires, { capabilities: { 'example.extra': { source: 'repo:extra' } } }, 'update must not re-add removed default or erase other requirements');
});

test('creation opt-out omits the dependency and missing official publication returns a configuration note, not an invented source', t => {
  const f = fixture(t), opted = f.run(['create', 'unaware', '--no-oats-core', '--work', 'directory', '--json']);
  assert.equal(opted.status, 0, opted.stderr);
  assert.equal(f.definition(JSON.parse(opted.stdout).soul).requires, undefined); assert.equal(JSON.parse(opted.stdout).notes, undefined);
  f.write(f.catalog, { packages: {} });
  const missing = f.run(['create', 'waiting', '--work', 'directory', '--json']);
  assert.equal(missing.status, 0, missing.stderr);
  const result = JSON.parse(missing.stdout);
  assert.equal(result.notes[0].code, 'needs-configuration'); assert.equal(f.definition(result.soul).requires, undefined);
  const text = f.run(['create', 'waiting-text', '--work', 'directory']);
  assert.equal(text.status, 0); assert.match(text.stderr, /needs-configuration.*oats.core/);
  assert.match(f.run(['create', '--help']).stdout, /--no-oats-core/);
});

test('declared oats.core replaces legacy operational injection and skills through preflight and actual scaffold, not boundary briefings', t => {
  const f = fixture(t), cap = join(f.context, '.agents/capabilities/owned/core');
  f.write(join(cap, 'oats.json'), { capability: 'oats.core', version: '1.0.0', description: 'Inert composition fixture', inject: 'inject.md', skills: ['skills'] });
  f.write(join(cap, 'inject.md'), 'CAPABILITY-OPERATIONS-ONCE');
  f.write(join(cap, 'skills/oats-operate/SKILL.md'), '# Inert operate skill\n');
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n  additive:\n    oats.core:\n      global: true\n');
  const created = createAgent(f.root, { name: 'operator', work: 'directory', runtime: 'claude' });
  const bytes = readFileSync(join(created.soul, 'soul.yaml'), 'utf8'), agent = findAgent(f.root, 'operator');
  const composed = composeInstanceAgentsMd(created.soul, f.context, 'operator', 'directory', 'persistent');
  assert.equal(composed.oatsCoreDeclared, true); assert.equal(composed.blocks.some(b => b.source === 'kernel:oats'), false);
  assert.equal(composed.blocks.filter(b => b.source === 'capability:oats.core').length, 1);
  assert.equal(composed.blocks.some(b => b.source === 'kernel:instance-boundary'), true);
  assert.equal(composed.blocks.some(b => b.source === 'work-mode:directory'), true);
  const plan = planInstanceResources({ resolved: composed.resolved, soulDir: created.soul, agent, contextDir: f.context, composition: composed });
  assert.equal(plan.some(r => r.source === 'kernel' && r.type === 'skill-tree'), false);
  const tripwire = join(f.base, 'runtime-invoked');
  writeFileSync(join(f.bin, 'claude'), `#!/bin/sh\necho invoked > '${tripwire}'\nexit 98\n`, { mode: 0o700 });
  const spawned = spawnInstance(f.root, agent, { purpose: 'probe', launch: false });
  assert.deepEqual(readdirSync(join(spawned.home, '.agents/skills')), ['oats-operate']);
  assert.equal(readFileSync(join(spawned.home, 'AGENTS.md'), 'utf8').split('CAPABILITY-OPERATIONS-ONCE').length - 1, 1);
  retireInstance(f.root, spawned.instance); assert.equal(existsSync(spawned.home), false); assert.equal(existsSync(tripwire), false);
  assert.equal(readFileSync(join(created.soul, 'soul.yaml'), 'utf8'), bytes, 'composition never inserts a requirement');
});

for (const declared of [['oats.setup'], ['oats.core', 'oats.setup']]) {
  test(`declared ${declared.join(' + ')} suppresses ambient legacy skills without overrides or duplicate names`, t => {
    const f = fixture(t), skillNames = { 'oats.core': ['oats-operate', 'oats-souls'], 'oats.setup': ['oats-config', 'oats-packages', 'oats-workspace-setup'] };
    for (const id of declared) {
      const cap = join(f.context, '.agents/capabilities/owned', id);
      f.write(join(cap, 'oats.json'), { capability: id, version: '1.0.0', description: 'Inert resource fixture', skills: ['skills'], ...(id === 'oats.core' ? { inject: 'inject.md' } : {}) });
      if (id === 'oats.core') f.write(join(cap, 'inject.md'), 'DECLARED-CORE-OPERATIONS');
      for (const name of skillNames[id]) f.write(join(cap, 'skills', name, 'SKILL.md'), `# ${name}\nOwned by ${id}, not kernel.\n`);
    }
    f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n  additive:\n' + declared.map(id => `    ${id}:\n      global: true\n`).join(''));
    const created = createAgent(f.root, { name: 'configured', work: 'directory', runtime: 'claude', oatsCore: false });
    const file = join(created.soul, 'soul.yaml');
    f.write(file, readFileSync(file, 'utf8') + `requires: ${JSON.stringify({ capabilities: Object.fromEntries(declared.map(id => [id, { source: 'repo:oats-package' }])) })}\n`);
    const agent = findAgent(f.root, 'configured'), composition = composeInstanceAgentsMd(created.soul, f.context, 'configured', 'directory', 'persistent');
    assert.equal(composition.blocks.some(b => b.source === 'kernel:oats'), false);
    assert.equal(composition.blocks.filter(b => b.source === 'capability:oats.core').length, declared.includes('oats.core') ? 1 : 0);
    assert.ok(composition.blocks.some(b => b.source === 'kernel:instance-boundary'));
    assert.ok(composition.blocks.some(b => b.source === 'work-mode:directory'));
    const resources = planInstanceResources({ resolved: composition.resolved, soulDir: created.soul, agent, contextDir: f.context, composition });
    assert.equal(resources.some(r => r.source === 'kernel' && r.type === 'skill-tree'), false);
    const tripwire = join(f.base, 'runtime-invoked');
    writeFileSync(join(f.bin, 'claude'), `#!/bin/sh\necho invoked > '${tripwire}'\nexit 98\n`, { mode: 0o700 });
    const spawned = spawnInstance(f.root, agent, { purpose: 'setup-probe', launch: false });
    assert.deepEqual(readdirSync(join(spawned.home, '.agents/skills')).sort(), declared.flatMap(id => skillNames[id]).sort());
    for (const name of skillNames['oats.setup']) assert.match(readFileSync(join(spawned.home, '.agents/skills', name, 'SKILL.md'), 'utf8'), /Owned by oats.setup, not kernel/);
    assert.doesNotMatch(readFileSync(join(spawned.home, 'AGENTS.md'), 'utf8'), /<!-- oats:kernel:oats /);
    retireInstance(f.root, spawned.instance); assert.equal(existsSync(spawned.home), false); assert.equal(existsSync(tripwire), false);
  });
}

test('doctor reports absent oats.core informationally and preserves legacy composition for the transition', t => {
  const f = fixture(t), created = createAgent(f.root, { name: 'legacy', work: 'directory', oatsCore: false });
  const before = readFileSync(join(created.soul, 'soul.yaml'), 'utf8'), message = 'soul legacy has no oats.core capability; kernel-shipped operational skills are deprecated';
  const text = f.run(['doctor', f.context, '--soul', 'legacy']); assert.equal(text.status, 0, text.stderr); assert.ok(text.stdout.includes(message));
  const json = f.run(['doctor', f.context, '--soul', 'legacy', '--json']); assert.equal(json.status, 0, json.stderr);
  const result = JSON.parse(json.stdout); assert.deepEqual(result.information, [message]);
  assert.ok(result.instructionBlocks.some(b => b.source === 'kernel:oats'));
  const composition = composeInstanceAgentsMd(created.soul, f.context, 'legacy', 'directory', 'persistent');
  const resources = planInstanceResources({ resolved: composition.resolved, soulDir: created.soul, agent: findAgent(f.root, 'legacy'), contextDir: f.context, composition });
  assert.deepEqual(resources.filter(r => r.source === 'kernel' && r.type === 'skill-tree').map(r => r.declared), ['oats', 'oats-config', 'oats-packages']);
  assert.equal(readFileSync(join(created.soul, 'soul.yaml'), 'utf8'), before);
});
