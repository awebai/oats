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
  assert.deepEqual(created.notes.map(n => n.code), ["next-step"], "a declared, inactive oats.core names its activation step"); assert.equal(existsSync(join(f.context, '.agents/capabilities/installed')), false, 'declaration is not acquisition');
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

test('declared oats.core that is NOT active refuses spawn with the remedy (no hollow agent), create says the next step, and removing the declaration opts out', t => {
  // Second-operator finding (0.24.6): create declares oats.core, composition
  // suppresses the kernel skills, nothing activates the replacement, spawn
  // succeeded with an EMPTY skill set and no warning.
  const f = fixture(t), cli = f.run(['create', 'plain', '--work', 'directory', '--runtime', 'claude', '--json']);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr); const created = JSON.parse(cli.stdout);
  assert.deepEqual(created.declaredCapabilities, ['oats.core']);
  assert.ok(created.notes.some(n => n.code === 'next-step' && /oats use oats.core --soul plain/.test(n.message)), 'create names the activation step before spawn');
  const agent = findAgent(f.root, 'plain');
  assert.throws(() => planInstanceResources({ resolved: composeInstanceAgentsMd(created.soul, f.context, 'plain', 'directory', 'persistent').resolved, soulDir: created.soul, agent, contextDir: f.context }),
    e => e.code === 'E_REQUIREMENT_INACTIVE' && e.capabilities.join() === 'oats.core' && /oats use oats.core --soul plain/.test(e.remedy));
  writeFileSync(join(f.bin, 'claude'), `#!/bin/sh\nexit 98\n`, { mode: 0o700 });
  const refused = f.run(['spawn', 'plain', '--no-launch', '--json']);
  assert.equal(refused.status, 1); const envelope = JSON.parse(refused.stdout.trim().split('\n').pop());
  assert.equal(envelope.error.code, 'E_REQUIREMENT_INACTIVE', 'kept its own code, not E_SPAWN_FAILED');
  assert.deepEqual(envelope.error.details.capabilities, ['oats.core']); assert.match(envelope.error.details.remedy, /^oats use oats.core --soul plain/);
  assert.equal(existsSync(join(f.root, 'plain', 'instances')) && readdirSync(join(f.root, 'plain', 'instances')).length, 0, 'refusal happens before any home is created');
  // Opting out is removing the declaration: legacy kernel skills return.
  const file = join(created.soul, 'soul.yaml');
  writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter(l => !l.startsWith('requires:')).join('\n'));
  const spawned = spawnInstance(f.root, findAgent(f.root, 'plain'), { purpose: 'legacy', launch: false });
  assert.deepEqual(readdirSync(join(spawned.home, '.agents/skills')).sort(), ['oats', 'oats-config', 'oats-packages']);
  assert.match(readFileSync(join(spawned.home, 'AGENTS.md'), 'utf8'), /<!-- oats:kernel:oats /);
  retireInstance(f.root, spawned.instance);
});

// ---- K5: readiness quartet + enforced child-spawn policy ----
import { spawnInstance as spawnCore } from '../lib/core.mjs';
import { signatureOf, SIGNATURE_FAILURES } from '../lib/readiness.mjs';

test('K5 readiness: quartet derived from inspect facts — installed/trusted/configured/enrolled with items and remedies; ready never inferred from an empty set; signature unknown without --verify-signatures', t => {
  const f = fixture(t), cap = join(f.context, '.agents/capabilities/owned/core');
  f.write(join(cap, 'oats.json'), { capability: 'oats.core', version: '1.0.0', description: 'Inert composition fixture', inject: 'inject.md', skills: ['skills'] });
  f.write(join(cap, 'inject.md'), 'CORE'); f.write(join(cap, 'skills/oats-operate/SKILL.md'), '# op\n');
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n  additive:\n    oats.core:\n      global: true\n');
  const created = f.run(['create', 'ready', '--work', 'directory', '--runtime', 'claude', '--json']); assert.equal(created.status, 0, created.stdout + created.stderr);
  const r = f.run(['readiness', '--soul', 'ready', '--json']); assert.equal(r.status, 0, r.stdout + r.stderr);
  const rd = JSON.parse(r.stdout).result;
  assert.equal(rd.readinessApi, 1); assert.deepEqual(rd.subject, { kind: 'soul', name: 'ready', selector: { kind: 'soul', soul: 'ready', agentsRoot: null, context: f.context } });
  assert.equal(rd.checks.installed.status, 'pass'); assert.equal(rd.checks.installed.items[0].subject, 'oats.core'); assert.equal(rd.checks.installed.items[0].producer, 'oats list');
  const trusted = rd.checks.trusted.items.find(i => i.subject === 'oats.core');
  assert.equal(trusted.status, 'not-applicable', 'a data-only capability (skills/inject, no commands/hooks/env) has nothing trust approves — whatever the lock records');
  assert.equal(trusted.signature.status, 'not-applicable', 'owned/path capability has no source commit to sign');
  assert.equal(rd.checks.configured.status, 'pass'); assert.equal(rd.checks.configured.items[0].subject, 'oats.core activation');
  assert.equal(rd.checks.enrolled.status, 'not-applicable'); assert.equal(rd.checks.enrolled.items[0].required, false); assert.match(rd.checks.enrolled.items[0].reason, /standalone/);
  assert.equal(rd.summary.ready, true); assert.ok(rd.summary.required > 0);
  assert.ok(rd.notes.some(n => /never inferred from an empty set/.test(n)));
  // Deactivate: configured fails with the exact remedy; ready is false.
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n');
  const r2 = JSON.parse(f.run(['readiness', '--soul', 'ready', '--json']).stdout).result;
  assert.equal(r2.checks.configured.status, 'fail'); assert.equal(r2.checks.configured.items[0].remedy, 'oats use oats.core --soul ready'); assert.equal(r2.summary.ready, false);
  // Scope-level (no soul): required = active capabilities; nothing active → installed rows optional, ready false (not vacuously true).
  const r3 = JSON.parse(f.run(['readiness', '--json']).stdout).result;
  assert.equal(r3.subject.kind, 'scope'); assert.equal(r3.summary.ready, false);
  // Policy view for the soul: default allowed, not yet enforced (no instance).
  const p = JSON.parse(f.run(['readiness', '--soul', 'ready', '--policy', '--json']).stdout).result.policy;
  assert.deepEqual(p.childSpawns, { allowed: true, enforced: false, origin: { kind: 'default', detail: 'no declaration: children allowed' } });
});

test('K5 policy: children.spawn declared false is recorded at spawn and ENFORCED by the spawn route for --parent / --relation child; --allow-child-spawns overrides with its origin; readiness --policy --home reports the enforced policy', t => {
  const f = fixture(t), cap = join(f.context, '.agents/capabilities/owned/core');
  f.write(join(cap, 'oats.json'), { capability: 'oats.core', version: '1.0.0', description: 'Inert', inject: 'inject.md', skills: ['skills'] });
  f.write(join(cap, 'inject.md'), 'CORE'); f.write(join(cap, 'skills/oats-operate/SKILL.md'), '# op\n');
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n  additive:\n    oats.core:\n      global: true\n');
  const created = createAgent(f.root, { name: 'boss', work: 'directory', runtime: 'claude' });
  const file = join(created.soul, 'soul.yaml'); writeFileSync(file, readFileSync(file, 'utf8') + 'children: {"spawn":false}\n');
  createAgent(f.root, { name: 'minion', work: 'directory', runtime: 'claude' });
  writeFileSync(join(f.bin, 'claude'), `#!/bin/sh\nexit 98\n`, { mode: 0o700 });
  const boss = spawnCore(f.root, findAgent(f.root, 'boss'), { purpose: 'p', launch: false });
  const bossMeta = JSON.parse(readFileSync(join(boss.home, 'instance.json'), 'utf8'));
  assert.deepEqual(bossMeta.policy.childSpawns, { allowed: false, origin: { kind: 'soul', detail: 'children.spawn: false in soul.yaml' } });
  // Route enforcement: a child of boss is refused, attributed to boss's policy; nothing spawned.
  assert.throws(() => spawnCore(f.root, findAgent(f.root, 'minion'), { purpose: 'kid', launch: false, parent: boss.instance }),
    e => e.code === 'E_CHILD_SPAWNS_DISABLED' && e.parent === boss.instance && e.policy.allowed === false && e.policy.origin.kind === 'soul');
  assert.throws(() => spawnCore(f.root, findAgent(f.root, 'minion'), { purpose: 'kid2', launch: false, relation: 'child', relativeTo: boss.instance }), e => e.code === 'E_CHILD_SPAWNS_DISABLED');
  assert.equal(readdirSync(join(f.root, 'minion', 'instances')).length, 0, 'refusal created no home');
  const cli = f.run(['spawn', 'minion', '--parent', boss.instance, '--no-launch', '--json']);
  assert.equal(cli.status, 1); const env = JSON.parse(cli.stdout.trim().split('\n').pop()); assert.equal(env.error.code, 'E_CHILD_SPAWNS_DISABLED'); assert.equal(env.error.details.parent, boss.instance);
  // Unrelated spawn of minion is fine; an operator override at spawn records its origin and the route honours it.
  const free = spawnCore(f.root, findAgent(f.root, 'minion'), { purpose: 'free', launch: false }); assert.ok(free.home);
  const boss2 = spawnCore(f.root, findAgent(f.root, 'boss'), { purpose: 'open', launch: false, allowChildSpawns: true });
  assert.deepEqual(JSON.parse(readFileSync(join(boss2.home, 'instance.json'), 'utf8')).policy.childSpawns, { allowed: true, origin: { kind: 'spawn-option', detail: '--allow-child-spawns' } });
  const kid = spawnCore(f.root, findAgent(f.root, 'minion'), { purpose: 'kid3', launch: false, parent: boss2.instance }); assert.equal(JSON.parse(readFileSync(join(kid.home, 'instance.json'), 'utf8')).parentInstance, boss2.instance);
  // readiness --policy --home reports the ENFORCED policy with origin.
  const pol = JSON.parse(f.run(['readiness', '--soul', 'boss', '--policy', '--home', boss.home, '--json']).stdout).result.policy;
  assert.deepEqual(pol.childSpawns, { allowed: false, enforced: true, origin: { kind: 'soul', detail: 'children.spawn: false in soul.yaml' } });
  for (const h of [boss.home, boss2.home, free.home, kid.home]) retireInstance(f.root, JSON.parse(readFileSync(join(h, 'instance.json'), 'utf8')).instance);
});

test('K6 preview: spawn --preview decides instance/home/branch/base/runtime/model/policy and creates NOTHING; --base selects the worktree start point; --model @native-default is explicit; E_BRANCH_EXISTS / E_BASE_UNKNOWN before any side effect; apply agrees with the preview', t => {
  const f = fixture(t);
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n');
  const git = (...a) => spawnSync('git', ['-C', f.context, ...a], { encoding: 'utf8' }).stdout.trim();
  spawnSync('git', ['init', '-q', '-b', 'main', f.context]); spawnSync('git', ['-C', f.context, '-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  spawnSync('git', ['-C', f.context, 'branch', 'release']); spawnSync('git', ['-C', f.context, '-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'second']);
  const head = git('rev-parse', 'HEAD'), release = git('rev-parse', 'release');
  const created = createAgent(f.root, { name: 'wt', work: 'worktree', repo: f.context, runtime: 'claude', model: 'opus', oatsCore: false });
  writeFileSync(join(f.bin, 'claude'), `#!/bin/sh\nexit 98\n`, { mode: 0o700 });
  const p = f.run(['spawn', 'wt', '--purpose', 'fix-login', '--preview', '--json']); assert.equal(p.status, 0, p.stdout + p.stderr);
  const pv = JSON.parse(p.stdout.trim().split('\n').pop()).result;
  assert.equal(pv.spawnPreviewApi, 1); assert.equal(pv.preview, true); assert.equal(pv.instance, 'wt-fix-login'); assert.equal(pv.branch, 'agents/wt-fix-login');
  assert.deepEqual(pv.base, { ref: 'HEAD', oid: head }); assert.equal(pv.worktree, join(f.root, 'wt', 'instances', 'wt-fix-login', 'work'));
  assert.equal(pv.runtime, 'claude'); assert.equal(pv.model, 'opus'); assert.equal(pv.policy.childSpawns.allowed, true);
  assert.equal(readdirSync(join(f.root, 'wt', 'instances')).length, 0, 'preview created no home');
  assert.equal(git('branch', '--list', 'agents/wt-fix-login'), '', 'preview created no branch');
  const nd = JSON.parse(f.run(['spawn', 'wt', '--preview', '--base', 'release', '--model', '@native-default', '--json']).stdout.trim().split('\n').pop()).result;
  assert.deepEqual(nd.base, { ref: 'release', oid: release }); assert.equal(nd.model, null); assert.equal(nd.modelSource, 'native default (explicit)');
  const inherit = JSON.parse(f.run(['spawn', 'wt', '--preview', '--json']).stdout.trim().split('\n').pop()).result;
  assert.equal(inherit.model, 'opus', 'omitting --model still inherits the soul preference; only @native-default forces the runtime default');
  assert.equal(JSON.parse(f.run(['spawn', 'wt', '--preview', '--base', 'nope', '--json']).stdout.trim().split('\n').pop()).error.code, 'E_BASE_UNKNOWN');
  spawnSync('git', ['-C', f.context, 'branch', 'agents/wt-taken']);
  assert.equal(JSON.parse(f.run(['spawn', 'wt', '--purpose', 'taken', '--preview', '--json']).stdout.trim().split('\n').pop()).error.code, 'E_BRANCH_EXISTS');
  // Apply with the same inputs agrees with the preview: branch created FROM the chosen base.
  const applied = spawnCore(f.root, findAgent(f.root, 'wt'), { purpose: 'fix-login', launch: false, baseRef: 'release', repo: f.context });
  assert.equal(applied.instance, pv.instance); assert.equal(applied.branch, pv.branch);
  assert.equal(spawnSync('git', ['-C', applied.home + '/work', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(), release, 'worktree starts at the selected base');
  retireInstance(f.root, applied.instance, { discardWorktree: true });
});

test('K7 events: spawn writes spawned (+launched when launching); a refused child spawn writes child-spawn-refused on the PARENT; oats instance events reads them', t => {
  const f = fixture(t), cap = join(f.context, '.agents/capabilities/owned/core');
  f.write(join(cap, 'oats.json'), { capability: 'oats.core', version: '1.0.0', description: 'Inert', inject: 'inject.md', skills: ['skills'] });
  f.write(join(cap, 'inject.md'), 'CORE'); f.write(join(cap, 'skills/oats-operate/SKILL.md'), '# op\n');
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n  additive:\n    oats.core:\n      global: true\n');
  const created = createAgent(f.root, { name: 'evboss', work: 'directory', runtime: 'claude' });
  writeFileSync(join(created.soul, 'soul.yaml'), readFileSync(join(created.soul, 'soul.yaml'), 'utf8') + 'children: {"spawn":false}\n');
  createAgent(f.root, { name: 'evkid', work: 'directory', runtime: 'claude' });
  writeFileSync(join(f.bin, 'claude'), `#!/bin/sh\nexit 98\n`, { mode: 0o700 });
  const boss = spawnCore(f.root, findAgent(f.root, 'evboss'), { purpose: 'p', launch: false });
  assert.throws(() => spawnCore(f.root, findAgent(f.root, 'evkid'), { purpose: 'k', launch: false, parent: boss.instance }), e => e.code === 'E_CHILD_SPAWNS_DISABLED');
  const r = f.run(['instance', 'events', boss.instance, '--json']); assert.equal(r.status, 0, r.stdout + r.stderr);
  const ev = JSON.parse(r.stdout.trim().split('\n').pop()).result;
  assert.deepEqual(ev.events.map(e => e.kind), ['spawned', 'child-spawn-refused']);
  assert.equal(ev.events[0].data.launched, false); assert.equal(ev.events[1].data.policy.allowed, false); assert.match(ev.events[1].data.child, /^evkid-k/);
  assert.equal(ev.waitingOnYou, null);
  retireInstance(f.root, boss.instance);
});

test('K5 pins (slice 5): configured is EFFECTIVE activation not declaration; data-only capability trust is not-applicable however the lock reads; typed capability/origin + byCapability; selector echo; unreadable member document is unknown; captured home refuses; signature failure is a closed code, never stderr', t => {
  const f = fixture(t), cap = join(f.context, '.agents/capabilities/owned/core');
  f.write(join(cap, 'oats.json'), { capability: 'oats.core', version: '1.0.0', description: 'Inert composition fixture', inject: 'inject.md', skills: ['skills'] });
  f.write(join(cap, 'inject.md'), 'CORE'); f.write(join(cap, 'skills/oats-operate/SKILL.md'), '# op\n');
  // Declared FOR this soul but explicitly disabled: a declaration is not activation.
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n  additive:\n    oats.core:\n      souls:\n        ready: {enabled: false}\n');
  const created = f.run(['create', 'ready', '--work', 'directory', '--runtime', 'claude', '--json']); assert.equal(created.status, 0, created.stdout + created.stderr);
  const r = JSON.parse(f.run(['readiness', '--soul', 'ready', '--agents-root', f.root, '--json']).stdout).result;
  const act = r.checks.configured.items.find(i => i.subject === 'oats.core activation');
  assert.equal(act.status, 'fail', 'declared-but-disabled is a FAIL, not pass'); assert.match(act.reason, /declared for soul ready but disabled/);
  assert.equal(r.summary.ready, false);
  // Typed linkage on every item + the same items grouped per capability.
  for (const check of Object.values(r.checks)) for (const i of check.items) if (i.subject.startsWith('oats.core')) { assert.equal(i.capability.id, 'oats.core'); assert.ok(['requires', 'declares', 'default', 'inventory'].includes(i.origin.kind)); }
  assert.equal(act.origin.kind, 'requires'); assert.equal(act.origin.target, 'soul:ready');
  const grouped = r.summary.byCapability.find(g => g.capability.id === 'oats.core');
  assert.deepEqual(Object.keys(grouped.checks), ['installed', 'trusted', 'configured', 'enrolled']); assert.equal(grouped.checks.configured, 'fail'); assert.equal(grouped.ready, false);
  // Selector echo: exactly what this read was made with.
  assert.deepEqual(r.subject.selector, { kind: 'soul', soul: 'ready', agentsRoot: f.root, context: f.context });
  assert.deepEqual(JSON.parse(f.run(['readiness', '--json']).stdout).result.subject.selector, { kind: 'scope', context: f.context });
  // Data-only capability: no commands/hooks/env → trust NOT-APPLICABLE, whatever the lock says; a hook makes it applicable.
  const tr = r.checks.trusted.items.find(i => i.subject === 'oats.core');
  assert.equal(tr.status, 'not-applicable'); assert.equal(tr.reason, 'no executable surface'); assert.equal(tr.remedy, null);
  f.write(join(cap, 'oats.json'), { capability: 'oats.core', version: '1.0.0', description: 'now executable', inject: 'inject.md', skills: ['skills'], hooks: { spawn: 'hook.sh' } }); f.write(join(cap, 'hook.sh'), '#!/bin/sh\necho {}\n');
  const tr2 = JSON.parse(f.run(['readiness', '--soul', 'ready', '--json']).stdout).result.checks.trusted.items.find(i => i.subject === 'oats.core');
  assert.notEqual(tr2.status, 'not-applicable', 'a hook is an executable surface');
  // Unreadable member document → enrolled UNKNOWN with the file, never not-applicable.
  for (const bad of ['workspace: [this: is: not: valid\n  yaml', 'workspace: nope\n']) {
    f.write(join(f.context, 'oats.yaml'), bad);
    const en = JSON.parse(f.run(['readiness', '--soul', 'ready', '--json']).stdout).result.checks.enrolled.items[0];
    assert.equal(en.status, 'unknown', bad); assert.match(en.reason, /unreadable/); assert.equal(en.evidence.file, join(f.context, 'oats.yaml')); assert.equal(en.required, true);
  }
  rmSync(join(f.context, 'oats.yaml')); mkdirSync(join(f.context, 'oats.yaml')); // a directory: cannot be read at all
  assert.equal(JSON.parse(f.run(['readiness', '--soul', 'ready', '--json']).stdout).result.checks.enrolled.items[0].status, 'unknown');
  rmSync(join(f.context, 'oats.yaml'), { recursive: true });
  // Captured home refuses before any current-config interpretation.
  const cHome = join(f.root, 'ready', 'instances', 'ready-cap'); f.write(join(cHome, 'instance.json'), { instance: 'ready-cap', agent: 'ready', home: cHome, executionBinding: { deployment: f.context, resolution: { id: 'sha256-' + 'a'.repeat(64) } } });
  const cap1 = f.run(['readiness', '--home', cHome, '--json']); assert.equal(cap1.status, 1);
  const err = JSON.parse(cap1.stdout.trim().split('\n').pop()).error; assert.equal(err.code, 'E_UNSUPPORTED_MODE'); assert.equal(err.details.captured, true);
  // Signature verification: closed failure code, no stderr; transport allowlist; feature advertised.
  const sig = signatureOf({ url: 'file:///nowhere', commit: 'a'.repeat(40) }, { verify: true });
  assert.deepEqual(sig, { status: 'unknown', signer: null, reason: 'source transport is not https or ssh; not fetched', failure: { code: 'transport-not-allowed' } });
  const dead = signatureOf({ url: 'https://127.0.0.1:9/none.git', commit: 'a'.repeat(40) }, { verify: true, budgetMs: 4000 });
  assert.equal(dead.status, 'unknown'); assert.ok(['fetch-failed', 'fetch-timeout', 'budget-exhausted'].includes(dead.failure.code), JSON.stringify(dead));
  assert.doesNotMatch(dead.reason, /fatal:|127\.0\.0\.1|Could not read|unable to access/, 'no stderr in the reason'); assert.equal(dead.reason, 'the source could not be fetched'); assert.ok(SIGNATURE_FAILURES.includes(dead.failure.code));
  assert.equal(readdirSync(tmpdir()).filter(n => n.startsWith('oats-sig-')).length, 0, 'scratch repository removed');
  assert.ok(JSON.parse(f.run(['version', '--json']).stdout).features.includes('readiness-verify'));
});
