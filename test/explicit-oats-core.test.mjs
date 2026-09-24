import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createAgent, upsertLocalAgent, findAgent, composeInstanceAgentsMd, planInstanceResources, spawnInstance, retireInstance, parseYamlNested } from '../lib/core.mjs';
import { inertRuntimePath } from './helpers/runtime-stub.mjs';
const CLI = fileURLToPath(new URL('../bin/oats.mjs', import.meta.url));
const SOURCE = 'git:https://catalog.invalid/operations.git@v1.2.3#distribution';
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'oats-explicit-core-'))), context = join(base, 'project'), root = join(context, 'agents');
  const user = join(base, 'user'), bin = join(base, 'bin'), catalog = join(base, 'catalog.json');
  for (const dir of [root, user, bin]) mkdirSync(dir, { recursive: true });
  const write = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
  write(catalog, { packages: { 'fixture.operations': { url: 'https://catalog.invalid/operations.git', ref: 'v1.2.3', path: 'distribution' } }, capabilities: { 'oats.core': 'fixture.operations' } });
  const env = { PATH: bin + ':' + inertRuntimePath(base), HOME: user, OATS_PACKAGE_CATALOG: catalog, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
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
    const f = fixture(t), skillNames = { 'oats.core': ['oats-operate', 'oats-souls'], 'oats.setup': ['oats-onboarding', 'oats-package-pins', 'oats-rebuild'] };
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
  // Phase B (CLI L1): the remedy names the v2 path (packages: + soul.yaml capabilities: from), not the removed `oats use`.
  assert.ok(created.notes.some(n => n.code === 'next-step' && /oats\.core/.test(n.message) && /workspace model v2/.test(n.message) && !/oats use/.test(n.message)), 'create names the activation step before spawn');
  const agent = findAgent(f.root, 'plain');
  assert.throws(() => planInstanceResources({ resolved: composeInstanceAgentsMd(created.soul, f.context, 'plain', 'directory', 'persistent').resolved, soulDir: created.soul, agent, contextDir: f.context }),
    // Phase C (M16): the remedy names the workspace-model path (oats-local.yaml + oats sync), never the removed `oats use` / `oats install`.
    e => e.code === 'E_REQUIREMENT_INACTIVE' && e.capabilities.join() === 'oats.core' && /add oats-local\.yaml \(workspace: <ref> or standalone: <ref>\) beside agents\/ and run oats sync/.test(e.remedy) && !/oats (use|install)\b/.test(e.remedy) && !/oats (use|install)\b/.test(e.message));
  writeFileSync(join(f.bin, 'claude'), `#!/bin/sh\nexit 98\n`, { mode: 0o700 });
  const refused = f.run(['spawn', 'plain', '--no-launch', '--json']);
  assert.equal(refused.status, 1); const envelope = JSON.parse(refused.stdout.trim().split('\n').pop());
  assert.equal(envelope.error.code, 'E_REQUIREMENT_INACTIVE', 'kept its own code, not E_SPAWN_FAILED');
  assert.deepEqual(envelope.error.details.capabilities, ['oats.core']); assert.match(envelope.error.details.remedy, /^add oats-local\.yaml \(workspace: <ref> or standalone: <ref>\) beside agents\/ and run oats sync$/);
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
import { signatureOf, SIGNATURE_FAILURES, verificationBudget } from '../lib/readiness.mjs';

test('K5 readiness: quartet derived from inspect facts — installed/trusted/configured/enrolled with items and remedies; ready never inferred from an empty set; signature unknown without --verify-signatures', t => {
  const f = fixture(t), cap = join(f.context, '.agents/capabilities/owned/core');
  f.write(join(cap, 'oats.json'), { capability: 'oats.core', version: '1.0.0', description: 'Inert composition fixture', inject: 'inject.md', skills: ['skills'] });
  f.write(join(cap, 'inject.md'), 'CORE'); f.write(join(cap, 'skills/oats-operate/SKILL.md'), '# op\n');
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n  additive:\n    oats.core:\n      global: true\n');
  const created = f.run(['create', 'ready', '--work', 'directory', '--runtime', 'claude', '--json']); assert.equal(created.status, 0, created.stdout + created.stderr);
  const r = f.run(['readiness', '--soul', 'ready', '--json']); assert.equal(r.status, 0, r.stdout + r.stderr);
  const rd = JSON.parse(r.stdout).result;
  assert.equal(rd.readinessApi, 1); assert.deepEqual(rd.subject, { kind: 'soul', name: 'ready', selector: { kind: 'soul', soul: 'ready', agentsRoot: null, dir: null } });
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
  assert.equal(pv.spawnPreviewApi, 2); assert.equal(pv.preview, true); assert.equal(pv.instance, 'wt-fix-login'); assert.equal(pv.branch, 'agents/wt-fix-login');
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
  assert.deepEqual(Object.keys(grouped.checks), ['installed', 'trusted', 'configured', 'enrolled']); assert.equal(grouped.checks.configured, 'fail'); assert.equal(grouped.ready, false); assert.equal(grouped.ownReady, false);
  assert.deepEqual(r.summary.subjectBlockers, [], 'no subject-level blocker here');
  // Selector echo: exactly what this read was made with.
  assert.deepEqual(r.subject.selector, { kind: 'soul', soul: 'ready', agentsRoot: f.root, dir: null }, 'arguments AS GIVEN, no realpath');
  assert.deepEqual(JSON.parse(f.run(['readiness', '--json']).stdout).result.subject.selector, { kind: 'scope', dir: null });
  assert.deepEqual(JSON.parse(f.run(['readiness', '--dir', f.context + '/.', '--json']).stdout).result.subject.selector, { kind: 'scope', dir: f.context + '/.' }, 'byte-exact echo of --dir');
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
  // Subject-level blocker: the capability's OWN quartet may pass while the subject is blocked by membership — a row never says ready then.
  { const rr = JSON.parse(f.run(['readiness', '--soul', 'ready', '--json']).stdout).result; f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n  additive:\n    oats.core:\n      global: true\n');
    const rb = JSON.parse(f.run(['readiness', '--soul', 'ready', '--json']).stdout).result; const g = rb.summary.byCapability.find(x => x.capability.id === 'oats.core');
    assert.equal(g.ownReady, true, JSON.stringify(g)); assert.equal(g.ready, false, 'blocked by the subject-level enrolled unknown'); assert.deepEqual(rb.summary.subjectBlockers.map(b => b.check), ['enrolled']); assert.equal(rb.summary.ready, false); void rr; }
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
  // One budget for the whole read: an exhausted shared budget refuses the next capability without a fetch.
  const spent = verificationBudget(1); const t0 = Date.now(); while (Date.now() - t0 < 3) { /* spin */ }
  assert.deepEqual(signatureOf({ url: 'https://127.0.0.1:9/none.git', commit: 'a'.repeat(40) }, { verify: true, budget: spent }), { status: 'unknown', signer: null, reason: 'the verification budget was exhausted', failure: { code: 'budget-exhausted' } });
  assert.ok(JSON.parse(f.run(['version', '--json']).stdout).features.includes('readiness-verify'));
});

test('K6b (spawnPreviewApi 2): a preview — success OR refusal — leaves the deployment byte-identical (no event, no daemon, no soul write); --agents-root binds the exact root with no fallback; decision.revision binds the apply via --expect-decision (drift → E_DECISION_STALE, nothing created); preflight is bounded and reported', t => {
  const f = fixture(t);
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n');
  spawnSync('git', ['init', '-q', '-b', 'main', f.context]); spawnSync('git', ['-C', f.context, '-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const git = (...a) => spawnSync('git', ['-C', f.context, ...a], { encoding: 'utf8' }).stdout.trim();
  createAgent(f.root, { name: 'wt', work: 'worktree', repo: f.context, runtime: 'claude', model: 'opus', oatsCore: false });
  createAgent(f.root, { name: 'boss', work: 'directory', runtime: 'claude', oatsCore: false });
  const bossSoul = join(f.root, 'boss', 'soul', 'soul.yaml'); writeFileSync(bossSoul, readFileSync(bossSoul, 'utf8') + 'children: {"spawn":false}\n');
  writeFileSync(join(f.bin, 'claude'), `#!/bin/sh\nexit 98\n`, { mode: 0o700 });
  writeFileSync(join(f.bin, 'herdr'), `#!/bin/sh\necho STARTED >> "${f.base}/herdr-started"; sleep 30\n`, { mode: 0o700 });
  const boss = spawnCore(f.root, findAgent(f.root, 'boss'), { purpose: 'p', launch: false });
  const treeHash = () => { const out = spawnSync('bash', ['-c', `cd "${f.context}" && find . -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256`], { encoding: 'utf8' }); return out.stdout.trim(); };
  f.write(join(f.context, 'ghost.agent.md'), '---\nname: ghost\n---\n# ghost\n'); // an importable def a non-preview spawn WOULD import
  const before = treeHash(), eventsBefore = existsSync(join(boss.home, '.oats-events.jsonl')) ? readFileSync(join(boss.home, '.oats-events.jsonl'), 'utf8') : '';
  // Success preview with the Herdr backend requested: no daemon started, backend reported as installed but not started.
  const ok = JSON.parse(f.run(['spawn', 'wt', '--purpose', 'a', '--preview', '--backend', 'herdr', '--agents-root', f.root, '--json']).stdout.trim().split('\n').pop()).result;
  assert.equal(ok.spawnPreviewApi, 2); assert.deepEqual(ok.subject, { soul: 'wt', agentsRoot: f.root, dir: null });
  assert.deepEqual(ok.backendStatus, { name: 'herdr', installed: true, started: false }); assert.equal(existsSync(join(f.base, 'herdr-started')), false, 'preview started no daemon');
  assert.match(ok.decision.revision, /^[a-f0-9]{24}$/); assert.equal(ok.decision.instance, 'wt-a'); assert.equal(ok.decision.base.oid, git('rev-parse', 'HEAD'));
  assert.equal(ok.preflight.status, 'complete'); assert.equal(ok.preflight.budgetMs, 20000);
  // Refusal preview (child of a parent that forbids children): typed refusal, NO event appended to the parent.
  const refused = JSON.parse(f.run(['spawn', 'wt', '--purpose', 'kid', '--preview', '--parent', boss.instance, '--json']).stdout.trim().split('\n').pop());
  assert.equal(refused.error.code, 'E_CHILD_SPAWNS_DISABLED');
  assert.equal(existsSync(join(boss.home, '.oats-events.jsonl')) ? readFileSync(join(boss.home, '.oats-events.jsonl'), 'utf8') : '', eventsBefore, 'a refusal preview appends no event');
  // Unknown soul in preview: never imports/creates; exact-root mismatch refuses.
  assert.equal(JSON.parse(f.run(['spawn', 'ghost', '--preview', '--json']).stdout.trim().split('\n').pop()).error.code, 'E_SOUL_UNKNOWN'); assert.equal(existsSync(join(f.root, 'ghost')), false, 'no soul written');
  assert.equal(JSON.parse(f.run(['spawn', 'wt', '--preview', '--agents-root', join(f.base, 'elsewhere'), '--json']).stdout.trim().split('\n').pop()).error.code, 'E_SOUL_UNKNOWN');
  assert.equal(JSON.parse(f.run(['spawn', 'wt', '--preview', '--instructions-file', bossSoul, '--json']).stdout.trim().split('\n').pop()).error.code, 'E_BAD_ARGS');
  assert.equal(treeHash(), before, 'deployment tree byte-identical after success + refusal + unknown-soul previews');
  assert.equal(readdirSync(join(f.root, 'wt', 'instances')).length, 0);
  // Apply bound to the decision: same decision → spawns; a moved base → E_DECISION_STALE with the fresh decision, nothing created.
  const stale = ok.decision.revision;
  spawnSync('git', ['-C', f.context, '-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'moved']);
  const drift = JSON.parse(f.run(['spawn', 'wt', '--purpose', 'a', '--expect-decision', stale, '--no-launch', '--json']).stdout.trim().split('\n').pop());
  assert.equal(drift.error.code, 'E_DECISION_STALE'); assert.equal(drift.error.details.decision.base.oid, git('rev-parse', 'HEAD')); assert.notEqual(drift.error.details.decision.revision, stale);
  assert.equal(readdirSync(join(f.root, 'wt', 'instances')).length, 0, 'stale decision created nothing'); assert.equal(git('branch', '--list', 'agents/wt-a'), '', 'and no branch');
  const fresh = JSON.parse(f.run(['spawn', 'wt', '--purpose', 'a', '--preview', '--json']).stdout.trim().split('\n').pop()).result.decision.revision;
  const applied = JSON.parse(f.run(['spawn', 'wt', '--purpose', 'a', '--expect-decision', fresh, '--no-launch', '--json']).stdout.trim().split('\n').pop());
  assert.equal(applied.ok, true, JSON.stringify(applied).slice(0, 300)); assert.equal(applied.result.instance, 'wt-a');
  // Name now taken: a re-used old decision is stale (the kernel would have auto-suffixed to wt-a-2 without the flag).
  const again = JSON.parse(f.run(['spawn', 'wt', '--purpose', 'a', '--expect-decision', fresh, '--no-launch', '--json']).stdout.trim().split('\n').pop());
  assert.equal(again.error.code, 'E_DECISION_STALE'); assert.equal(again.error.details.decision.instance, 'wt-a-2'); assert.deepEqual(readdirSync(join(f.root, 'wt', 'instances')).filter(n => !n.startsWith('.')), ['wt-a'], 'stale decision created no second home');
});

test('K6b preflight custody: a hanging `pi --list-models` probe cannot hang a preview — bounded by the shared budget, reported as preflight.status timeout, probe group killed', async t => {
  const f = fixture(t);
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n');
  spawnSync('git', ['init', '-q', '-b', 'main', f.context]); spawnSync('git', ['-C', f.context, '-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  // Two provider-qualified preferences force the pi catalog probe; the fake pi hangs forever.
  createAgent(f.root, { name: 'pp', work: 'worktree', repo: f.context, runtime: 'pi', model: 'openai/gpt-x, anthropic/claude-y', oatsCore: false });
  // The fake probe records its own pid and its forked child's, so custody is
  // checked on exactly this fixture's processes (never a machine-wide match that
  // a concurrent test file's probe could satisfy), and it never finishes.
  const pids = join(f.base, 'probe.pids');
  writeFileSync(join(f.bin, 'pi'), `#!/bin/sh\ncase "$1" in --list-models) echo $$ > '${pids}'; sleep 600 & echo $! >> '${pids}'; wait; echo finished > '${pids}.finished';; esac\nexit 0\n`, { mode: 0o700 });
  const out = spawnSync(process.execPath, [CLI, 'spawn', 'pp', '--preview', '--json'], { cwd: f.context, env: { ...process.env, PATH: f.bin + ':' + process.env.PATH, OATS_PREVIEW_PREFLIGHT_BUDGET_MS: '1500' }, encoding: 'utf8', timeout: 60000 });
  // The 60 s spawn timeout is only a safety net: the preview must return on its own (no signal).
  assert.equal(out.signal, null, `the preview was killed by the test's safety timeout: the hanging probe hung it (${out.stderr.slice(0, 400)})`);
  assert.ok(out.stdout.trim(), `no output (status ${out.status}): ${out.stderr.slice(0, 400)}`);
  const pv = JSON.parse(out.stdout.trim().split('\n').pop());
  assert.equal(pv.ok, true, out.stdout + out.stderr); assert.equal(pv.result.preflight.status, 'timeout'); assert.equal(pv.result.preflight.budgetMs, 1500);
  assert.equal(existsSync(pids + '.finished'), false, 'the preview returned while its probe was still hanging');
  const probe = readFileSync(pids, 'utf8').trim().split('\n').map(Number);
  assert.equal(probe.length, 2, `the probe started and forked its child: ${JSON.stringify(probe)}`);
  // SIGKILL delivery and reaping are asynchronous: wait, bounded, for this
  // group to be gone. A probe that was never killed sleeps 600 s and fails this.
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  const deadline = Date.now() + 10000;
  while (probe.some(alive) && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(probe.filter(alive), [], 'probe process group killed');
});

import { killGroup } from '../lib/process-group.mjs';
test('process-group: killGroup never signals pid 0 / negative / non-integer — a FAILED spawn (ENOENT → pid 0) must not SIGKILL the caller\'s own process group', () => {
  const calls = []; const real = process.kill; process.kill = (pid, sig) => { calls.push([pid, sig]); return true; };
  try {
    for (const bad of [{ pid: 0, error: { code: 'ENOENT' } }, { pid: -5 }, { pid: undefined }, { pid: NaN }, { pid: 1.5 }, {}, null, undefined, { pid: '123' }]) assert.equal(killGroup(bad), false, JSON.stringify(bad));
    assert.deepEqual(calls, [], 'no signal was sent for any failed-spawn shape');
    assert.equal(killGroup({ pid: 424242 }), true); assert.deepEqual(calls, [[-424242, 'SIGKILL'], [424242, 'SIGKILL']]);
  } finally { process.kill = real; }
  // The real path: a probe whose binary does not exist reports pid 0 and must not kill us.
  const r = spawnSync('/nonexistent/binary-' + process.pid, ['x'], { detached: true, timeout: 1000 });
  assert.equal(r.error?.code, 'ENOENT'); assert.equal(r.pid, 0); assert.equal(killGroup(r), false, 'and we are still alive to assert this');
});

test('process-group, end to end: signature verification with NO git on PATH reports fetch-failed and the calling process survives (was: process.kill(-0) on the caller\'s group)', () => {
  const emptyBin = mkdtempSync(join(tmpdir(), 'nobin-')); writeFileSync(join(emptyBin, 'node'), `#!/bin/sh\nexec "${process.execPath}" "$@"\n`, { mode: 0o700 });
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import { signatureOf } from ${JSON.stringify(new URL('../lib/readiness.mjs', import.meta.url).href)}; console.log(JSON.stringify(signatureOf({ url: 'https://example.invalid/x.git', commit: 'a'.repeat(40) }, { verify: true, budgetMs: 5000 })));`],
    { encoding: 'utf8', env: { PATH: emptyBin, HOME: emptyBin }, timeout: 30000 });
  assert.equal(child.signal, null, `the verifying process was signalled: ${child.signal} ${child.stderr}`); assert.equal(child.status, 0, child.stderr);
  const sig = JSON.parse(child.stdout.trim()); assert.equal(sig.status, 'unknown'); assert.equal(sig.failure.code, 'verifier-failed', JSON.stringify(sig));
  rmSync(emptyBin, { recursive: true, force: true });
});

test('K6c spawn idempotency: --expect-decision + --idempotency-key — a retry of the SAME confirmed decision replays the recorded home (found by key, never by name) instead of spawning twice; the same key for a different decision refuses E_IDEMPOTENCY_CONFLICT; a different key spawns anew', t => {
  const f = fixture(t);
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n');
  spawnSync('git', ['init', '-q', '-b', 'main', f.context]); spawnSync('git', ['-C', f.context, '-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  createAgent(f.root, { name: 'wt', work: 'worktree', repo: f.context, runtime: 'claude', model: 'opus', oatsCore: false });
  writeFileSync(join(f.bin, 'claude'), `#!/bin/sh\nexit 98\n`, { mode: 0o700 });
  const last = r => JSON.parse(r.stdout.trim().split('\n').pop());
  const rev = last(f.run(['spawn', 'wt', '--purpose', 'a', '--preview', '--json'])).result.decision.revision;
  const first = last(f.run(['spawn', 'wt', '--purpose', 'a', '--expect-decision', rev, '--idempotency-key', 'k-1', '--no-launch', '--json']));
  assert.equal(first.ok, true, JSON.stringify(first).slice(0, 300)); assert.equal(first.result.instance, 'wt-a'); assert.equal(first.result.replayed, false);
  const meta = JSON.parse(readFileSync(join(f.root, 'wt', 'instances', 'wt-a', 'instance.json'), 'utf8'));
  assert.equal(meta.spawnIdempotencyKey, 'k-1'); assert.equal(meta.decision.revision, rev);
  // The receipt echoes the FULL bound decision — the same shape the preview showed, effective included.
  const shown = last(f.run(['spawn', 'wt', '--purpose', 'a', '--preview', '--json'])).result.decision; // placement now differs (taken) but the SHAPE is what we check
  assert.deepEqual(Object.keys(first.result.decision).sort(), Object.keys(shown).sort()); assert.deepEqual(Object.keys(first.result.decision.effective).sort(), Object.keys(shown.effective).sort());
  assert.equal(first.result.decision.effective.model, 'opus'); assert.equal(first.result.decision.effective.work, 'worktree');
  // Lost response → retry with the same key: replay, nothing new.
  const again = last(f.run(['spawn', 'wt', '--purpose', 'a', '--expect-decision', rev, '--idempotency-key', 'k-1', '--no-launch', '--json']));
  assert.equal(again.ok, true, JSON.stringify(again).slice(0, 300)); assert.equal(again.result.replayed, true); assert.equal(again.result.instance, 'wt-a'); assert.equal(again.result.home, first.result.home);
  assert.deepEqual(readdirSync(join(f.root, 'wt', 'instances')).filter(n => !n.startsWith('.')), ['wt-a'], 'replay spawned nothing');
  assert.ok(JSON.parse(f.run(['instance', 'events', 'wt-a', '--json']).stdout).result.events.filter(e => e.kind === 'spawned').length === 1, 'one spawned event');
  // Same key, different decision (name now taken → fresh decision is wt-a-2): conflict, not a second spawn.
  const fresh = last(f.run(['spawn', 'wt', '--purpose', 'a', '--preview', '--json'])).result.decision.revision; assert.notEqual(fresh, rev);
  const conflict = last(f.run(['spawn', 'wt', '--purpose', 'a', '--expect-decision', fresh, '--idempotency-key', 'k-1', '--no-launch', '--json']));
  assert.equal(conflict.error.code, 'E_IDEMPOTENCY_CONFLICT'); assert.equal(conflict.error.details.instance, 'wt-a');
  assert.deepEqual(readdirSync(join(f.root, 'wt', 'instances')).filter(n => !n.startsWith('.')), ['wt-a']);
  // A different key with the fresh decision is a genuinely new confirmation: spawns wt-a-2.
  const second = last(f.run(['spawn', 'wt', '--purpose', 'a', '--expect-decision', fresh, '--idempotency-key', 'k-2', '--no-launch', '--json']));
  assert.equal(second.ok, true, JSON.stringify(second).slice(0, 300)); assert.equal(second.result.instance, 'wt-a-2');
  // Without --expect-decision the key is recorded but replay is not offered (no decision to bind to): documented legacy path.
  assert.ok(JSON.parse(f.run(['version', '--json']).stdout).features.includes('spawn-idempotency'));
  assert.equal(last(f.run(['spawn', 'wt', '--purpose', 'b', '--idempotency-key', 'bad key!', '--no-launch', '--json'])).error.code, 'E_BAD_ARGS');
});

test('K6d (spawn-apply-2): the decision binds EFFECTIVE launch facts (a changed inherited model drifts it); a stale apply with a Herdr backend starts no daemon; two concurrent applies of one decision create exactly one home (E_PLACEMENT_TAKEN for the loser)', async t => {
  const f = fixture(t);
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n');
  spawnSync('git', ['init', '-q', '-b', 'main', f.context]); spawnSync('git', ['-C', f.context, '-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const created = createAgent(f.root, { name: 'wt', work: 'worktree', repo: f.context, runtime: 'claude', model: 'opus', oatsCore: false });
  writeFileSync(join(f.bin, 'claude'), `#!/bin/sh\nexit 98\n`, { mode: 0o700 });
  writeFileSync(join(f.bin, 'herdr'), `#!/bin/sh\necho STARTED >> "${f.base}/herdr-started"; sleep 30\n`, { mode: 0o700 });
  const last = r => JSON.parse(r.stdout.trim().split('\n').pop());
  // A. effective facts are hashed: same placement, different inherited model → stale.
  const pv = last(f.run(['spawn', 'wt', '--purpose', 'a', '--preview', '--json'])).result;
  assert.equal(pv.decision.effective.model, 'opus'); assert.equal(pv.decision.effective.work, 'worktree'); assert.equal(pv.decision.effective.repo, f.context);
  const soulFile = join(created.soul, 'soul.yaml'); writeFileSync(soulFile, readFileSync(soulFile, 'utf8').replace('model: opus', 'model: haiku'));
  const drift = last(f.run(['spawn', 'wt', '--purpose', 'a', '--expect-decision', pv.decision.revision, '--no-launch', '--json']));
  assert.equal(drift.error.code, 'E_DECISION_STALE'); assert.equal(drift.error.details.decision.effective.model, 'haiku'); assert.equal(drift.error.details.decision.instance, 'wt-a', 'placement unchanged — only the effective model moved');
  assert.deepEqual(readdirSync(join(f.root, 'wt', 'instances')).filter(n => !n.startsWith('.')), []);
  // B. a stale LAUNCHING apply with backend herdr starts no daemon.
  const stale = last(f.run(['spawn', 'wt', '--purpose', 'a', '--backend', 'herdr', '--expect-decision', pv.decision.revision, '--json']));
  assert.equal(stale.error.code, 'E_DECISION_STALE'); assert.equal(existsSync(join(f.base, 'herdr-started')), false, 'stale apply started no backend');
  // C. two concurrent applies of ONE fresh decision → exactly one home; the loser refuses E_PLACEMENT_TAKEN having touched nothing.
  const fresh = last(f.run(['spawn', 'wt', '--purpose', 'a', '--preview', '--json'])).result.decision.revision;
  const { spawn } = await import('node:child_process');
  const run = () => new Promise(res => { const p = spawn(process.execPath, [CLI, 'spawn', 'wt', '--purpose', 'a', '--expect-decision', fresh, '--no-launch', '--json'], { cwd: f.context, env: process.env }); let out = '', err = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d); p.on('close', code => { let doc; try { doc = JSON.parse(out.trim().split('\n').pop()); } catch { doc = { ok: false, error: { code: 'UNPARSEABLE', raw: (out + err).slice(0, 400) } }; } res({ code, doc }); }); });
  const results = await Promise.all([run(), run(), run()]);
  const wins = results.filter(r => r.doc.ok), losses = results.filter(r => !r.doc.ok);
  assert.equal(wins.length, 1, JSON.stringify(results.map(r => r.doc.ok ? 'ok' : r.doc.error.code)));
  // A loser refuses with whichever pre-placement check it reaches first after the winner's
  // side effects landed: the exclusive mkdir (E_PLACEMENT_TAKEN), the bound decision
  // (E_DECISION_STALE), or — in worktree mode — the winner's freshly created branch
  // (E_BRANCH_EXISTS). All three are honest "nothing created" refusals.
  // All three applies bind ONE decision, so they plan the same branch by design:
  // the branch is not a per-run name to make unique, it is what they race for.
  assert.ok(losses.every(l => ['E_PLACEMENT_TAKEN', 'E_DECISION_STALE', 'E_BRANCH_EXISTS'].includes(l.doc.error.code)), JSON.stringify(losses.map(l => l.doc.error)));
  assert.deepEqual(readdirSync(join(f.root, 'wt', 'instances')).filter(n => !n.startsWith('.')), ['wt-a'], 'exactly one home');
  const git = (...a) => spawnSync('git', ['-C', f.context, ...a], { encoding: 'utf8' }).stdout.trim();
  assert.equal(git('for-each-ref', '--format=%(refname:short)', 'refs/heads/agents/'), 'agents/wt-a', 'the losers created no branch');
  assert.deepEqual(git('worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree ')).map(l => realpathSync(l.slice(9))), [f.context, join(f.root, 'wt', 'instances', 'wt-a', 'work')], 'and no worktree');
  assert.ok(JSON.parse(f.run(['version', '--json']).stdout).features.includes('spawn-apply-2'));
});

test('K6e replay custody: key recovery runs BEFORE placement/branch checks (an explicit-branch spawn replays instead of E_BRANCH_EXISTS); a home whose spawn did not complete replays E_SPAWN_INCOMPLETE, never success; wake outcome is recorded and returned on replay (saved:null when not recorded)', t => {
  const f = fixture(t);
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n');
  spawnSync('git', ['init', '-q', '-b', 'main', f.context]); spawnSync('git', ['-C', f.context, '-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  createAgent(f.root, { name: 'wt', work: 'worktree', repo: f.context, runtime: 'claude', model: 'opus', oatsCore: false });
  writeFileSync(join(f.bin, 'claude'), `#!/bin/sh\nexit 98\n`, { mode: 0o700 });
  const last = r => JSON.parse(r.stdout.trim().split('\n').pop());
  // Explicit branch: after the first spawn the branch EXISTS; the same-key retry must replay, not E_BRANCH_EXISTS.
  const rev = last(f.run(['spawn', 'wt', '--purpose', 'b', '--branch', 'feat/explicit', '--preview', '--json'])).result.decision.revision;
  const first = last(f.run(['spawn', 'wt', '--purpose', 'b', '--branch', 'feat/explicit', '--expect-decision', rev, '--idempotency-key', 'kb', '--wake-every', '10', '--wake-message', 'hello', '--no-launch', '--json']));
  assert.equal(first.ok, true, JSON.stringify(first).slice(0, 400)); assert.equal(first.result.branch, 'feat/explicit');
  const retry = last(f.run(['spawn', 'wt', '--purpose', 'b', '--branch', 'feat/explicit', '--expect-decision', rev, '--idempotency-key', 'kb', '--wake-every', '10', '--wake-message', 'hello', '--no-launch', '--json']));
  assert.equal(retry.ok, true, `explicit-branch retry must replay, got ${JSON.stringify(retry).slice(0, 300)}`); assert.equal(retry.result.replayed, true); assert.equal(retry.result.instance, 'wt-b');
  // Wake outcome travels with the replay.
  assert.equal(typeof retry.result.wake, 'object', JSON.stringify(retry.result).slice(0, 400)); assert.equal(retry.result.wake.requested, true, JSON.stringify({ first: first.result.wake, retry: retry.result.wake })); assert.ok([true, false].includes(retry.result.wake.saved), JSON.stringify(retry.result.wake));
  assert.deepEqual(first.result.wake?.requested, true);
  // Completion custody: a home written for a key but never completed → E_SPAWN_INCOMPLETE, not a replayed success, not a second spawn.
  const home = join(f.root, 'wt', 'instances', 'wt-b'); const m = JSON.parse(readFileSync(join(home, 'instance.json'), 'utf8'));
  assert.equal(m.spawnCompleted, true, 'a finished spawn is marked completed');
  m.spawnCompleted = false; delete m.wake; writeFileSync(join(home, 'instance.json'), JSON.stringify(m, null, 2));
  const inc = last(f.run(['spawn', 'wt', '--purpose', 'b', '--branch', 'feat/explicit', '--expect-decision', rev, '--idempotency-key', 'kb', '--no-launch', '--json']));
  assert.equal(inc.error.code, 'E_SPAWN_INCOMPLETE'); assert.equal(inc.error.details.home, home); assert.match(inc.error.message, /do not spawn again/);
  assert.deepEqual(readdirSync(join(f.root, 'wt', 'instances')).filter(n => !n.startsWith('.')), ['wt-b'], 'nothing else created');
  // Wake not recorded (crash in the interval): replay says saved:null, never true/false.
  m.spawnCompleted = true; writeFileSync(join(home, 'instance.json'), JSON.stringify(m, null, 2));
  const unrec = last(f.run(['spawn', 'wt', '--purpose', 'b', '--branch', 'feat/explicit', '--expect-decision', rev, '--idempotency-key', 'kb', '--no-launch', '--json']));
  assert.equal(unrec.result.replayed, true); assert.deepEqual(unrec.result.wake, { requested: null, saved: null, error: null });
  assert.ok(JSON.parse(f.run(['version', '--json']).stdout).features.includes('spawn-idempotency-2'));
});

test('K6f retention: a fresh keyed (decision-bound, idempotent) spawn with a wake retires CLEAN — the completion marker and wake record are kernel writes, not "changed instance-home bytes"', t => {
  const f = fixture(t);
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n');
  spawnSync('git', ['init', '-q', '-b', 'main', f.context]); spawnSync('git', ['-C', f.context, '-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  createAgent(f.root, { name: 'wt', work: 'worktree', repo: f.context, runtime: 'claude', model: 'opus', oatsCore: false });
  writeFileSync(join(f.bin, 'claude'), `#!/bin/sh\nexit 98\n`, { mode: 0o700 });
  const last = r => JSON.parse(r.stdout.trim().split('\n').pop());
  const rev = last(f.run(['spawn', 'wt', '--purpose', 'r', '--preview', '--json'])).result.decision.revision;
  const sp = last(f.run(['spawn', 'wt', '--purpose', 'r', '--expect-decision', rev, '--idempotency-key', 'kr', '--wake-every', '10', '--wake-message', 'hi', '--no-launch', '--json']));
  assert.equal(sp.ok, true, JSON.stringify(sp).slice(0, 300)); assert.equal(sp.result.wake.saved, true);
  const plan = JSON.parse(f.run(['retire', 'wt-r', '--plan', '--json']).stdout).result;
  const r = JSON.parse(f.run(['retire', 'wt-r', '--plan-revision', plan.planRevision, '--idempotency-key', 'ret-1', '--json']).stdout);
  assert.equal(r.retired, 'wt-r', JSON.stringify(r).slice(0, 400));
  assert.ok(!(r.workRecovery?.classes || []).includes('changed instance-home bytes'), `kernel writes must not read as user changes: ${JSON.stringify(r.workRecovery ?? r).slice(0, 400)}`);
  assert.equal(r.workRecovery ?? null, null, `a fresh, untouched home needs no work recovery: ${JSON.stringify(r.workRecovery ?? null)}`);
});

test('K6g retention authority: kernel post-spawn fields (spawnCompleted, wake) never read as changes, but authored home bytes written in the launch→completion interval are STILL recovered at retire — nothing but the kernel fields is ever re-blessed', t => {
  const f = fixture(t);
  f.write(join(f.context, 'oats-config.yaml'), 'capabilities:\n  layers:\n    knowledge: none\n    messaging: none\n    tasks: none\n');
  spawnSync('git', ['init', '-q', '-b', 'main', f.context]); spawnSync('git', ['-C', f.context, '-c', 'user.email=t@x', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init']);
  createAgent(f.root, { name: 'wt', work: 'worktree', repo: f.context, runtime: 'claude', model: 'opus', oatsCore: false });
  // The "runtime": tmux is faked so the launch writes an authored STATE.md into the home the moment it starts —
  // i.e. BEFORE the kernel's completion marker and the CLI's wake record are written.
  writeFileSync(join(f.bin, 'claude'), `#!/bin/sh\nexit 98\n`, { mode: 0o700 });
  const wins = join(f.base, 'tmux-wins'); writeFileSync(wins, '');
  const fakeTmux = (writeState) => `#!/bin/sh
case "$1" in
  display-message) echo /tmp/oats-k6g-fake.sock ;;
  new-window) prev=""; for a in "$@"; do case "$prev" in -n) echo "$a" >> ${wins};; -c) ${writeState ? `printf 'agent wrote this at launch\\n' > "$a/STATE.md"` : ':'};; esac; prev="$a"; done ;;
  list-windows) cat ${wins} ;;
  kill-window) : ;;
esac
exit 0
`;
  writeFileSync(join(f.bin, 'tmux'), fakeTmux(true), { mode: 0o700 });
  const last = r => JSON.parse(r.stdout.trim().split('\n').pop());
  const rev = last(f.run(['spawn', 'wt', '--purpose', 'g', '--preview', '--json'])).result.decision.revision;
  const sp = last(f.run(['spawn', 'wt', '--purpose', 'g', '--expect-decision', rev, '--idempotency-key', 'kg', '--wake-every', '10', '--wake-message', 'hi', '--backend', 'tmux', '--json']));
  assert.equal(sp.ok, true, JSON.stringify(sp).slice(0, 400));
  const home = join(f.root, 'wt', 'instances', 'wt-g');
  assert.equal(readFileSync(join(home, 'STATE.md'), 'utf8'), 'agent wrote this at launch\n', 'the launch wrote authored bytes into the home');
  const meta = JSON.parse(readFileSync(join(home, 'instance.json'), 'utf8')); assert.equal(meta.spawnCompleted, true); assert.equal(meta.wake?.saved, true, 'kernel fields were written AFTER the authored bytes');
  const plan = JSON.parse(f.run(['retire', 'wt-g', '--plan', '--json']).stdout).result;
  const r = JSON.parse(f.run(['retire', 'wt-g', '--plan-revision', plan.planRevision, '--idempotency-key', 'rg', '--json']).stdout);
  assert.equal(r.retired, 'wt-g', JSON.stringify(r).slice(0, 300));
  assert.ok(r.workRecovery, 'authored STATE.md must be recovered — the kernel fields must not have blessed it into the baseline');
  assert.ok(r.workRecovery.classes.includes('changed instance-home bytes'), JSON.stringify(r.workRecovery.classes));
  assert.equal(readFileSync(join(r.workRecovery.path, 'home', 'STATE.md'), 'utf8'), 'agent wrote this at launch\n', 'recovered bytes are the authored ones');
  // And the pure kernel-fields case still retires clean (K6f's original point).
  writeFileSync(join(f.bin, 'tmux'), fakeTmux(false), { mode: 0o700 });
  const rev2 = last(f.run(['spawn', 'wt', '--purpose', 'h', '--preview', '--json'])).result.decision.revision;
  assert.equal(last(f.run(['spawn', 'wt', '--purpose', 'h', '--expect-decision', rev2, '--idempotency-key', 'kh', '--wake-every', '10', '--wake-message', 'hi', '--backend', 'tmux', '--json'])).ok, true);
  const plan2 = JSON.parse(f.run(['retire', 'wt-h', '--plan', '--json']).stdout).result;
  const r2 = JSON.parse(f.run(['retire', 'wt-h', '--plan-revision', plan2.planRevision, '--idempotency-key', 'rh', '--json']).stdout);
  assert.equal(r2.workRecovery ?? null, null, `kernel fields alone: clean — ${JSON.stringify(r2.workRecovery ?? null)}`);
});

test('K6h fingerprint scope: kernel-field neutrality and receipt exclusions are OPT-IN for an instance home — in any other tree (work, recovery) an instance.json is the agent\'s bytes: changing only its spawnCompleted/wake keys CHANGES the fingerprint, and a .oats-events.jsonl is significant', async t => {
  const { fingerprintTree } = await import('../lib/core.mjs');
  const f = fixture(t);
  const tree = join(f.base, 'tree'); mkdirSync(tree);
  writeFileSync(join(tree, 'instance.json'), JSON.stringify({ spawnCompleted: false, wake: null, payload: 'v1' }));
  const a = fingerprintTree(tree);
  writeFileSync(join(tree, 'instance.json'), JSON.stringify({ spawnCompleted: true, wake: { saved: true }, payload: 'v1' }));
  const b = fingerprintTree(tree);
  assert.notEqual(a, b, 'work-tree instance.json: kernel-named keys are fully significant');
  assert.equal(fingerprintTree(tree, { instanceHome: true }), (() => { writeFileSync(join(tree, 'instance.json'), JSON.stringify({ spawnCompleted: false, wake: null, payload: 'v1' })); return fingerprintTree(tree, { instanceHome: true }); })(), 'instance home: the same two files fingerprint equal — only there');
  writeFileSync(join(tree, '.oats-events.jsonl'), 'x\n');
  assert.notEqual(fingerprintTree(tree), a, 'a receipt-named file in a work tree is agent bytes');
});
