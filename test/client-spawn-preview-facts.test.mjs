// A spawn preview's facts in the shared home (packages/client/spawn-preview-facts.mjs, #855 6b-2): what the
// Desktop's spawn dialog draws in its preview column, as plain data a second client draws its own way. Each
// sentence is written out here as the Desktop shows it, so a change of wording fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { previewFacts } from '../packages/client/spawn-preview-facts.mjs';

const CLI = { ok: true, bin: '/usr/local/bin/oats', features: ['launch-preference'] };
const PREVIEW = {
  subject: { dir: '/srv/acme' },
  home: '/srv/acme/agents/dev/instances/dev-api',
  work: 'worktree', branch: 'agents/dev-api', base: { ref: 'main' },
  harness: 'claude', model: 'claude-opus-5-5', modelSource: 'soul',
  launch: { declared: { harness: 'claude', model: 'claude-opus-5-5' }, effective: { harness: 'claude', model: 'claude-opus-5-5' }, from: 'soul', at: null, problem: null },
  defaultTeam: { label: 'eng' }, teams: [{ label: 'eng' }, { label: 'ops' }, { label: 'all' }],
  relation: 'child', decision: { effective: { relation: { anchor: { instance: 'lead-1' } } } },
  worktreeHooks: [{ capability: 'oats.node', required: true }, { capability: 'oats.cache' }],
  launchPromptAnswers: { awebDevelopmentChannel: true, consentSource: 'oats-local.yaml#/settings/oats.aweb' },
  warnings: ['oats.aweb: no channel here\nUse session delivery.'],
  modules: [
    { name: 'oats.okf', layer: 'knowledge', from: { kind: 'package', package: 'oats-okf', version: '2.1.0' }, composedFrom: 'soul' },
    { name: 'oats.aweb', layer: 'messaging', from: { kind: 'member', repoKey: 'github.com/acme/caps.git' }, composedFrom: 'workspace' },
    { name: 'zeta', layer: 'skills', from: { kind: 'member', repoKey: 'github.com/acme/zeta' } },
    { name: 'alpha', layer: 'skills', from: { kind: 'local' }, composedFrom: 'other' },
  ],
};

test('a full preview: identity, every fact in its order, the prompt note, the warnings as lines, the modules', () => {
  const shown = previewFacts(PREVIEW, { name: 'dev-api', runsOn: 'This machine', cli: CLI });
  assert.deepEqual(shown.identity, [
    { label: 'Name', text: 'dev-api' },
    { label: 'Home', text: 'agents/dev/instances/dev-api', title: '/srv/acme/agents/dev/instances/dev-api' },
  ]);
  assert.deepEqual(shown.facts.map(f => f.label), ['Works in', 'Harness', 'Team', 'Relationship', 'Setup', 'Runs on']);
  const [works, harness, team, relation, setup, runsOn] = shown.facts;
  assert.deepEqual(works.parts, [{ text: 'worktree · branch ' }, { text: 'agents/dev-api', mono: true }, { text: ' from main' }]);
  assert.deepEqual(harness, { label: 'Harness', harness: 'claude', parts: [{ text: 'Claude Code · claude-opus-5-5' }, { text: "the soul's preference", sub: true }] });
  assert.deepEqual(team.parts, [{ text: 'eng' }, { text: ' · default', muted: true }, { text: 'may also join ops, all', sub: true }]);
  assert.deepEqual(relation.parts, [{ text: 'child of lead-1' }]);
  assert.deepEqual(setup.parts, [{ text: 'oats.node (required), oats.cache' }, { text: 'Runs after the worktree is made. Can take several minutes.', sub: true }]);
  assert.deepEqual(runsOn.parts, [{ text: 'This machine' }]);
  assert.deepEqual(shown.prompts, [
    { label: 'Launch prompts', text: 'The launcher will answer the aweb development-channel confirmation for this home. This policy does not confirm readiness. A harness update can block the launch until its prompt fixtures are refreshed; no fallback key is sent.' },
    { label: 'Prompt consent source', text: 'oats-local.yaml#/settings/oats.aweb', mono: true },
  ]);
  assert.deepEqual(shown.warnings, [['oats.aweb: no channel here', 'Use session delivery.']]);
  assert.deepEqual(shown.modules, {
    core: [
      { layer: 'knowledge', label: 'Knowledge', module: { name: 'oats.okf', source: 'package oats-okf 2.1.0', why: 'Soul' } },
      { layer: 'messaging', label: 'Messaging', module: { name: 'oats.aweb', source: 'caps · latest', why: 'Workspace default' } },
      { layer: 'tasks', label: 'Tasks', module: null },
    ],
    caps: [{ name: 'alpha', source: 'local', why: '' }, { name: 'zeta', source: 'zeta · latest', why: '' }],
  });
});

test('no name: the kernel numbers it; no runsOn: no Runs on; a home outside the deployment: its last three segments', () => {
  const shown = previewFacts({ ...PREVIEW, home: '/elsewhere/a/b/c/d' }, { cli: CLI });
  assert.deepEqual(shown.identity, [{ label: 'Name', text: 'numbered by the kernel', muted: true }, { label: 'Home', text: '…/b/c/d', title: '/elsewhere/a/b/c/d' }]);
  assert.ok(!shown.facts.some(f => f.label === 'Runs on'));
});

test('an older kernel: no launch feature, no defaultTeam, no worktreeHooks, no modules, no prompt policy, no warnings', () => {
  const old = { subject: { dir: '/srv/acme' }, home: '/srv/acme/agents/dev/instances/dev-3', work: 'checkout', harness: 'pi', model: null,
    modelSource: 'host default', launch: PREVIEW.launch, team: 'eng', relation: 'sibling' };
  const shown = previewFacts(old, { name: null, runsOn: null, cli: { ok: true, features: [] } });
  assert.deepEqual(shown.facts, [
    { label: 'Works in', parts: [{ text: 'shared checkout' }] },
    // Without launch-preference the preview's launch is not read: the kernel's modelSource, verbatim.
    { label: 'Harness', harness: 'pi', parts: [{ text: 'Pi · default model' }, { text: 'host default', sub: true }] },
    // A 0.29 kernel: the primary team label alone.
    { label: 'Team', parts: [{ text: 'eng' }] },
    { label: 'Relationship', parts: [{ text: 'sibling of' }] },
  ]);
  assert.equal(shown.prompts, null);
  assert.deepEqual(shown.warnings, []);
  assert.equal(shown.modules, null, 'no placeholder for modules the preview does not carry');
});

test('a resolved team of none, an unknown work mode and relation verbatim, a policy that answers nothing', () => {
  const shown = previewFacts({ work: 'elsewhere', defaultTeam: null, teams: [], relation: 'cousin',
    launchPromptAnswers: { awebDevelopmentChannel: false } }, { cli: CLI });
  assert.deepEqual(shown.identity, [{ label: 'Name', text: 'numbered by the kernel', muted: true }], 'no home: no Home');
  assert.deepEqual(shown.facts, [
    { label: 'Works in', parts: [{ text: 'elsewhere' }] },
    { label: 'Team', parts: [{ text: 'none', muted: true }] },
    { label: 'Relationship', parts: [{ text: 'cousin' }] },
  ]);
  assert.deepEqual(shown.prompts, [{ label: 'Launch prompts', text: 'None. The launcher will not answer prompts for this home. This policy does not confirm readiness.' }]);
  // An empty modules list: every core slot empty, no other capabilities.
  assert.deepEqual(previewFacts({ modules: [] }).modules, { core: [
    { layer: 'knowledge', label: 'Knowledge', module: null }, { layer: 'messaging', label: 'Messaging', module: null }, { layer: 'tasks', label: 'Tasks', module: null }], caps: [] });
});

test('no preview at all: the name alone; a worktree spawn without a branch says its mode', () => {
  assert.deepEqual(previewFacts(null), { identity: [{ label: 'Name', text: 'numbered by the kernel', muted: true }], facts: [], prompts: null, warnings: [], modules: null });
  assert.deepEqual(previewFacts({ work: 'worktree' }).facts, [{ label: 'Works in', parts: [{ text: 'own worktree' }] }]);
});

test('a hook capability with control characters is withheld, not drawn', () => {
  const setup = previewFacts({ worktreeHooks: [{ capability: 'evil\u001b[2J' }] }).facts[0];
  assert.equal(setup.label, 'Setup');
  assert.notEqual(setup.parts[0].text, 'evil\u001b[2J');
  assert.ok(!/\u001b/.test(setup.parts[0].text));
});
