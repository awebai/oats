// A soul's facts in the shared home (packages/client/soul-facts.mjs): what the Desktop's soul inspector and soul
// grid say about a soul, as plain data a second client draws the same way. Each sentence is written out here as
// the Desktop shows it, so a change of wording fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { soulFacts, spawnRefusal, desktopFacts, cantSpawnLine, workText, launchProblemParts, LAUNCH_REFUSED_HERE, NO_DEFAULT_HARNESS, WORK_TEXT } from '../packages/client/soul-facts.mjs';
import { launchHarnessName } from '../packages/client/launch-view.mjs';
import { clientTerms } from '../packages/client/client-terms.mjs';

const TERMS = { name: 'the test client', self: 'this test client', selfInitial: 'This test client', update: 'Update the test client.', thisMachine: 'This machine' };
const terms = clientTerms(TERMS);
const FEATURES = ['launch-preference', 'desktop-facts'];
const cli = (features = FEATURES) => ({ ok: true, bin: '/usr/local/bin/oats', features });
const LAUNCH = { declared: { harness: 'claude', model: 'claude-opus-5-5' }, effective: { harness: 'pi', model: null, launchConfig: 'fast' },
  from: 'local-default', at: 'oats-local.yaml#/launch/default', problem: null };
const ROW = { name: 'dev', work: 'worktree', spawnable: false, problem: { code: 'E_SPAWN_REFUSED', message: 'No harness is installed here.' }, launch: LAUNCH };
const inspected = (soul = {}, launch) => ({ subject: { kind: 'soul' }, souls: [{ name: 'dev', ...soul }], ...(launch === undefined ? {} : { launch }) });

test('soulFacts requires the client\'s terms, also where no line names the client', () => {
  for (const value of [undefined, null, { ...TERMS }, { ...terms }]) {
    assert.throws(() => soulFacts(ROW, null, cli(), value), { name: 'TypeError', message: 'soulFacts: terms must be the object clientTerms() returned' });
  }
  assert.throws(() => soulFacts({ name: 'dev' }, null, cli([]), undefined), TypeError, 'a soul with nothing to say');
});

test('a launch: the harness card\'s rows, where it is set, and no problem', () => {
  const facts = soulFacts(ROW, null, cli(), terms);
  assert.equal(facts.launch, LAUNCH, 'the row\'s launch, as decoded');
  assert.deepEqual(facts.rows, [['Harness', 'Pi'], ['Model', "Pi's default model"], ['Launch configuration', 'fast'], ['Chosen by', "this computer's default for every soul"],
    ['The soul prefers', 'Claude Code · claude-opus-5-5']]);
  assert.deepEqual(facts.notes, ['Set in oats-local.yaml › launch › default, on this computer']);
  assert.equal(facts.problem, null);
  // The inspection's own launch wins over the row's; one that matches what the soul prefers has no "prefers" row,
  // and no configuration row without a configuration.
  const same = { declared: { harness: 'pi', model: 'x' }, effective: { harness: 'pi', model: 'x', launchConfig: null }, from: 'soul', at: null, problem: null };
  const own = soulFacts(ROW, inspected({}, same), cli(), terms);
  assert.equal(own.launch, same);
  assert.deepEqual(own.rows, [['Harness', 'Pi'], ['Model', 'x'], ['Chosen by', "the soul's preference"]]);
  assert.deepEqual(own.notes, [], 'no "Set in" without an `at`');
});

test('a launch problem in its parts: the client\'s line, the kernel\'s message and fix under its name, and the code; and without a fix', () => {
  const withFix = soulFacts({ ...ROW, launch: { ...LAUNCH, problem: { code: 'E_LAUNCH_HARNESS', message: 'Pi is not installed.', fix: 'Install pi, or choose a launch.' } } }, null, cli(), terms);
  assert.deepEqual(withFix.problem, { lead: LAUNCH_REFUSED_HERE, lines: ['OATS says: Pi is not installed.', 'Install pi, or choose a launch.'], code: 'E_LAUNCH_HARNESS' });
  assert.equal(LAUNCH_REFUSED_HERE, 'A spawn of this soul with no launch chosen would be refused here.');
  const noFix = soulFacts({ ...ROW, launch: { ...LAUNCH, problem: { code: 'E_LAUNCH_HARNESS', message: 'Pi is not installed.' } } }, null, cli(), terms);
  assert.deepEqual(noFix.problem, { lead: LAUNCH_REFUSED_HERE, lines: ['OATS says: Pi is not installed.'], code: 'E_LAUNCH_HARNESS' });
  assert.deepEqual(launchProblemParts({ code: 'E_X', message: 'm', fix: 'f' }, terms), { lead: LAUNCH_REFUSED_HERE, lines: ['OATS says: m', 'f'], code: 'E_X' });
  assert.throws(() => launchProblemParts({ code: 'E_X', message: 'm' }), TypeError, 'the kernel\'s lines need the terms');
});

test('a kernel without launch-preference: no launch, the pre-0.30 rows of a soul that declares a harness', () => {
  const old = cli(['desktop-facts']);
  const facts = soulFacts(ROW, inspected({ harness: 'claude', model: 'claude-sonnet-5-5' }), old, terms);
  assert.equal(facts.launch, null, 'the row\'s launch is not read');
  assert.deepEqual(facts.rows, [['Default harness', 'Claude Code'], ['Default model', 'claude-sonnet-5-5']]);
  assert.deepEqual(facts.notes, []);
  assert.equal(facts.problem, null);
  // A legacy soul with a harness and no model: the harness alone. A pre-0.30 `runtime` is its harness.
  assert.deepEqual(soulFacts(ROW, inspected({ harness: 'codex' }), old, terms).rows, [['Default harness', 'Codex']]);
  assert.deepEqual(soulFacts(ROW, inspected({ runtime: 'pi', model: '' }), old, terms).rows, [['Default harness', 'Pi']]);
  // A soul with neither a launch nor a harness: no rows, the line that says so.
  for (const soul of [{}, { harness: '' }, { harness: null, model: 'x' }]) {
    const none = soulFacts(ROW, inspected(soul), old, terms);
    assert.deepEqual([none.rows, none.notes, none.problem], [[], [NO_DEFAULT_HARNESS], null], JSON.stringify(soul));
  }
  assert.equal(NO_DEFAULT_HARNESS, 'No default harness: you choose one when you launch it.');
  // Nothing inspected and no launch: the same.
  assert.deepEqual(soulFacts({ name: 'dev' }, null, old, terms).notes, [NO_DEFAULT_HARNESS]);
});

test('a kernel without desktop-facts: no refusal, whatever the row says; with it, the kernel\'s reason or the Desktop\'s own', () => {
  const without = soulFacts(ROW, null, cli(['launch-preference']), terms);
  assert.deepEqual([without.refusal, without.refusalLine], [null, null]);
  assert.equal(desktopFacts(cli(['launch-preference'])), false);
  const facts = soulFacts(ROW, null, cli(), terms);
  assert.equal(facts.refusal, 'No harness is installed here.');
  assert.equal(facts.refusalLine, "Can't spawn here · No harness is installed here.");
  assert.equal(spawnRefusal({ spawnable: false }, cli()), 'A spawn of this soul would be refused here.');
  assert.equal(spawnRefusal({ spawnable: false, problem: { message: '' } }, cli()), 'A spawn of this soul would be refused here.');
  assert.equal(spawnRefusal({ spawnable: true, problem: { message: 'x' } }, cli()), null);
  assert.equal(spawnRefusal(undefined, cli()), null);
  assert.equal(spawnRefusal({ spawnable: false }, undefined), null);
  assert.equal(cantSpawnLine('why'), "Can't spawn here · why");
  assert.equal(desktopFacts(cli()), true);
  assert.equal(desktopFacts(null), false);
});

test('where a soul works, in words: the three modes, any other as sent, none as null', () => {
  assert.deepEqual(Object.keys(WORK_TEXT).map(workText), ['works in its own worktree', 'works in the repo checkout', 'attaches to an owning instance']);
  assert.equal(workText('directory'), 'works in directory');
  for (const none of [undefined, null, '', 7]) assert.equal(workText(none), null);
  assert.equal(soulFacts(ROW, null, cli(), terms).work, 'works in its own worktree');
  assert.equal(soulFacts({ name: 'dev' }, null, cli(), terms).work, null);
  assert.equal(Object.isFrozen(WORK_TEXT), true);
});

test('the harness names are the three the inspector named before, and any other as sent', () => {
  const BEFORE = { pi: 'Pi', claude: 'Claude Code', codex: 'Codex' }; // soul-inspector.mjs HARNESS_NAMES at 643447e2
  for (const [value, name] of Object.entries(BEFORE)) assert.equal(launchHarnessName(value), name);
  for (const value of ['herdr', 'Pi', 'opencode']) assert.equal(launchHarnessName(value), value);
});

test('the facts are plain data: they survive a JSON round trip, and two calls share nothing', () => {
  const facts = soulFacts({ ...ROW, launch: { ...LAUNCH, problem: { code: 'E_X', message: 'm', fix: 'f' } } }, null, cli(), terms);
  assert.deepEqual(JSON.parse(JSON.stringify(facts)), facts);
  const again = soulFacts({ ...ROW, launch: { ...LAUNCH, problem: { code: 'E_X', message: 'm', fix: 'f' } } }, null, cli(), terms);
  assert.deepEqual(again, facts);
  assert.notEqual(again.rows, facts.rows);
  assert.notEqual(again.problem, facts.problem);
});
