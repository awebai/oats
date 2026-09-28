// Soul launch preferences in the views (feature launch-preference, OATS 0.30; docs/desktop-cli-api.md
// "Launch preferences", oats feat/030-launch-preference @76cd1843; decoders in #287). Consumer-first:
// the kernel does not emit `launch` yet, so each Launch here is DERIVED (marked) from the contract's
// example onto the REAL 0.30 captures (fixtures/team-model-v2). Recapture when the kernel lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSoulInspector } from '../renderer/soul-inspector.mjs';
import { setWorkspace, currentWorkspace } from '../renderer/views/common.mjs';
import { refreshCli, resetCliStateForTests } from '../renderer/views/cli-status.mjs';
import { LAUNCH_FROM, launchFromText, launchModelText, declaredText, launchAtText, shownLaunch } from '../renderer/launch-view.mjs';
import { launchHint } from '../renderer/spawn-dialog.mjs';
import { spawnProblem } from '../renderer/spawn-messages.mjs';
import { previewData } from '../renderer/spawn-preview-contract.mjs';
import { target } from './helpers/spawn-preview-fixture.mjs';

const v2 = name => JSON.parse(readFileSync(new URL(`./fixtures/team-model-v2/${name}.json`, import.meta.url), 'utf8'));
const version = v2('version');
const FEATURED = { ...version, features: [...version.features, 'launch-preference'] };
const agentsRoot = '/fixture/base/northwind-workspace/agents';
const tick = () => new Promise(r => setTimeout(r, 0));
// DERIVED: the contract's example, a machine override of the soul's declared preference.
const OVERRIDE = () => ({ declared: { harness: 'claude', model: 'claude-opus-5-5' }, effective: { harness: 'codex', model: null, launchConfig: null },
  from: 'local', at: 'oats-local.yaml#/souls/launch/oats.engineering~1code-reviewer', problem: null });
const SOUL_PREF = () => ({ declared: { harness: 'claude', model: 'claude-opus-5-5' }, effective: { harness: 'claude', model: 'claude-opus-5-5', launchConfig: null },
  from: 'soul', at: 'local//fixture/base/fx/remotes/agents.git:souls/release-manager/soul.yaml#/launch', problem: null });
const MISSING = () => ({ ...SOUL_PREF(), problem: { code: 'E_HARNESS_UNAVAILABLE', message: 'harness claude is not installed on this machine',
  fix: 'install claude, or override it on this machine in oats-local.yaml souls.launch' } });

async function inspector(t, launch, { layout, cli = FEATURED, agentLaunch } = {}) {
  await refreshCli({ api: async () => ({ ...cli, ok: true, bin: '/fixture/bin/oats' }) });
  const previous = currentWorkspace(); setWorkspace('/team');
  const inspected = { ...v2('inspect-soul').result, ...(launch ? { launch } : {}) };
  const dom = new JSDOM('<body><main><aside hidden></aside></main></body>'), el = dom.window.document.querySelector('aside');
  const view = createSoulInspector(el, { ...(layout ? { layout } : {}), ctx: { api: async (url) => url.startsWith('/api/workspace-soul-teams')
    ? { status: 'ok', soulTeams: { soul: 'release-manager', teams: [], defaultTeam: null, at: null } } : structuredClone(inspected) } });
  t.after(() => { view.dispose(); dom.window.close(); setWorkspace(previous); resetCliStateForTests(); });
  await view.show({ agent: { name: 'release-manager', agentsRoot, key: 'release-manager', ...(agentLaunch ? { launch: agentLaunch } : {}) }, selector: { soul: 'release-manager', agentsRoot } });
  for (let i = 0; i < 4; i++) await tick();
  const facts = () => Object.fromEntries([...el.querySelectorAll('.inspector-launch dt')].map(dt => [dt.textContent, dt.nextElementSibling.textContent]));
  return { el, facts };
}

test('the words: every from, a null model, where it is set, and the soul\'s own preference only when it differs', () => {
  assert.deepEqual({ ...LAUNCH_FROM }, { flag: 'chosen for this spawn', local: 'set for this soul on this computer', 'local-default': "this computer's default for every soul",
    soul: "the soul's preference", host: 'no preference set: the host default', recorded: 'recorded when it was spawned' });
  assert.equal(launchFromText('later'), 'from: later', 'an unknown from is said as sent');
  assert.equal(launchModelText({ harness: 'codex', model: null }), "Codex's default model");
  assert.equal(launchAtText(OVERRIDE().at), 'Set in oats-local.yaml › souls › launch › oats.engineering/code-reviewer, on this computer', 'JSON pointer unescaped');
  assert.equal(launchAtText('package:oats.engineering:souls/code-reviewer/soul.yaml#/launch'), 'Set in souls/code-reviewer/soul.yaml › launch, in the oats.engineering package');
  assert.equal(launchAtText(null), null, 'a flag or the host default: nowhere to point');
  assert.equal(declaredText(OVERRIDE()), 'The soul prefers Claude Code · claude-opus-5-5; this computer runs Codex.');
  assert.equal(declaredText({ ...SOUL_PREF(), effective: { harness: 'claude', model: 'claude-sonnet-5', launchConfig: null } }),
    'The soul prefers Claude Code · claude-opus-5-5; this computer runs Claude Code with claude-sonnet-5.');
  assert.equal(declaredText(SOUL_PREF()), null, 'the same: said once');
  assert.equal(declaredText({ ...OVERRIDE(), declared: null }), null, 'none declared: nothing to compare');
  assert.equal(shownLaunch(SOUL_PREF(), version), null, 'gated on the feature');
});

test('side panel: Harness shows the effective harness and model, what chose them, where, and the soul\'s own preference when overridden', async t => {
  const u = await inspector(t, OVERRIDE());
  assert.deepEqual(u.facts(), { Harness: 'Codex', Model: "Codex's default model", 'Chosen by': 'set for this soul on this computer', 'The soul prefers': 'Claude Code · claude-opus-5-5' });
  assert.equal(u.el.querySelector('.inspector-launch .launch-at').textContent, 'Set in oats-local.yaml › souls › launch › oats.engineering/code-reviewer, on this computer');
  assert.doesNotMatch(u.el.textContent, /No default harness|Default harness/);
  const same = await inspector(t, { ...SOUL_PREF(), effective: { ...SOUL_PREF().effective, launchConfig: 'opus' } });
  assert.deepEqual(same.facts(), { Harness: 'Claude Code', Model: 'claude-opus-5-5', 'Launch configuration': 'opus', 'Chosen by': "the soul's preference" });
  // The roster row's launch when the inspection has none (the same kernel report).
  const fromRow = await inspector(t, null, { agentLaunch: SOUL_PREF() });
  assert.equal(fromRow.facts().Harness, 'Claude Code');
});

test('side panel: a missing harness is said in the kernel\'s words (message and fix), the code behind Details', async t => {
  const u = await inspector(t, MISSING());
  const box = u.el.querySelector('.inspector-launch .launch-problem');
  assert.equal(box.getAttribute('role'), 'note');
  assert.equal(box.querySelector('.launch-problem-message').textContent, 'harness claude is not installed on this machine');
  assert.equal(box.querySelector('.launch-problem-fix').textContent, 'install claude, or override it on this machine in oats-local.yaml souls.launch');
  assert.equal(box.querySelector('details p').textContent, 'E_HARNESS_UNAVAILABLE');
  assert.equal(u.facts().Harness, 'Claude Code', 'the soul still lists its launch');
});

test('without the feature: no launch is read; a kernel before 0.30 keeps its own words', async t => {
  const u = await inspector(t, null, { cli: version, agentLaunch: OVERRIDE() });
  assert.equal(u.el.querySelector('.inspector-launch'), null);
  assert.match(u.el.textContent, /No default harness: you choose one when you launch it\./);
});

test('soul page: the harness fact carries the model and what chose it; below, the soul\'s own preference, where it is set, and a problem', async t => {
  const u = await inspector(t, OVERRIDE(), { layout: 'page' });
  const fact = u.el.querySelector('[data-fact="harness"]');
  assert.equal(fact.querySelector('.strong').textContent, 'Codex');
  assert.equal(fact.querySelector('.muted').textContent, "Codex's default model · set for this soul on this computer");
  assert.ok(fact.querySelector('.runtime-badge'), 'the harness mark');
  const notes = u.el.querySelector('[data-launch-notes]');
  assert.equal(notes.querySelector('.launch-declared').textContent, 'The soul prefers Claude Code · claude-opus-5-5; this computer runs Codex.');
  assert.match(notes.querySelector('.launch-at').textContent, /^Set in oats-local\.yaml › souls › launch › oats\.engineering\/code-reviewer/);
  const pref = await inspector(t, { ...SOUL_PREF(), effective: { ...SOUL_PREF().effective, launchConfig: 'opus' } }, { layout: 'page' });
  assert.equal(pref.el.querySelector('[data-fact="harness"] .muted').textContent, "claude-opus-5-5 · launch configuration opus · the soul's preference");
  assert.equal(pref.el.querySelector('.launch-declared'), null, 'no difference, nothing more');
  const missing = await inspector(t, MISSING(), { layout: 'page' });
  assert.equal(missing.el.querySelector('[data-launch-notes] .launch-problem-fix').textContent, MISSING().problem.fix);
  const host = await inspector(t, { declared: null, effective: { harness: 'pi', model: null, launchConfig: null }, from: 'host', at: null, problem: null }, { layout: 'page' });
  assert.equal(host.el.querySelector('[data-fact="harness"] .muted').textContent, "Pi's default model · no preference set: the host default");
  assert.equal(host.el.querySelector('[data-launch-notes]'), null, 'nothing to add');
});

test('spawn dialog: the run hint says what this spawn runs and what chose it (derived on the real 0.30 preview); the soul\'s preference when a flag overrides it', () => {
  const real = v2('preview').result;
  const withLaunch = (from, declared = null) => previewData({ ...structuredClone(real), launch: { declared, effective: { harness: real.harness, model: real.model, launchConfig: real.launchConfig }, from, at: null, problem: null } }, target);
  const model = real.model ?? `${{ pi: 'Pi', claude: 'Claude Code', codex: 'Codex' }[real.harness]}'s default model`;
  const name = { pi: 'Pi', claude: 'Claude Code', codex: 'Codex' }[real.harness];
  assert.equal(launchHint(withLaunch('host'), FEATURED), `Launches ${name} with ${model} · no preference set: the host default.`);
  const other = real.harness === 'codex' ? { harness: 'claude', model: 'claude-opus-5-5' } : { harness: 'codex', model: null };
  assert.match(launchHint(withLaunch('flag', other), FEATURED), new RegExp(`· chosen for this spawn\\. The soul prefers ${other.harness === 'codex' ? "Codex · Codex's default model" : 'Claude Code · claude-opus-5-5'}\\.$`));
  assert.equal(launchHint(withLaunch('host'), version), null, 'no feature: the dialog keeps its own words');
  assert.equal(launchHint(previewData(structuredClone(real), target), FEATURED), null, 'no launch reported');
});

test('spawn dialog: a missing harness is said as the kernel words it, with its fix; the code and message stay behind Details', () => {
  const p = spawnProblem({ code: 'E_HARNESS_UNAVAILABLE', message: 'harness codex is not installed on this machine.', details: { fix: 'install codex, or choose another --harness / --launch-config' } });
  assert.equal(p.text, 'harness codex is not installed on this machine: install codex, or choose another --harness / --launch-config');
  assert.equal(p.detail, 'E_HARNESS_UNAVAILABLE · harness codex is not installed on this machine.');
  assert.equal(spawnProblem({ code: 'E_HARNESS_UNAVAILABLE', message: 'harness codex is not installed' }).text, 'harness codex is not installed', 'no fix sent: the message alone');
  assert.equal(spawnProblem({ code: 'E_HARNESS_UNAVAILABLE' }).text, 'The harness this soul would run isn’t installed on this machine. Install it, or pick another harness above.');
});
