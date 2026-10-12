import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { JSDOM } from 'jsdom';
import { memberLabel, servedIdentityText } from '../../client/deployment-facts.mjs';
import { deploymentUnavailableText, deploymentUnavailableParts, keptFailure } from '../../client/deployment-facts.mjs';
import { deploymentFailure } from '../../client/deployment-contract.mjs';
import { displayLine, DETAIL_WITHHELD, MAX_DISPLAY_LINE } from '../../client/display-text.mjs';
import { clientTerms } from '../../client/client-terms.mjs';
import { cliDeploymentRead } from '../../client/deployment-read-cli.mjs';
import { createDeploymentObserver } from '../../client/deployment-observer.mjs';
import { failedEntry, publicDeployment } from '../../client/deployment-panel.mjs';
import { panelData, viewModel } from '../../client/panel-views.mjs';
import { DESKTOP_TERMS } from '../renderer/desktop-terms.mjs';
import { deploymentNotes, lockNotes } from '../renderer/workspace-catalog.mjs';
import { deploymentStatusData, workspaceStatusData } from '../../client/deployment-data.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/${name}.json`, import.meta.url), 'utf8'));
const status = fixture('status'), header = fixture('workspace-status');
const context = dirname(status.root);
const instance = () => structuredClone(deploymentStatusData(status, context).agents[0].instances[0]);

test('captured roster facts render in the kernel\'s own terms', () => {
  const i = instance();
  assert.equal(servedIdentityText(i.identity), null, 'the captured Northwind instance has no served identity');
  assert.equal(memberLabel('local//x/fx/remotes/nw-tools.git'), 'nw-tools');
});

test('served identity from the exit-0 capture: absent key stays absent; local and grant rows are copied, keyed on provider presence', () => {
  const rows = Object.fromEntries(deploymentStatusData(fixture('status-identities'), context).agents[0].instances.map(i => [i.instance, i]));
  assert.equal(Object.hasOwn(rows['release-manager-cap'], 'identity'), false, 'no identity key is synthesized');
  assert.equal(servedIdentityText(rows['release-manager-cap'].identity), null);
  assert.deepEqual(rows['release-manager-local-id'].identity, { mode: 'local', alias: 'release-manager-local-id', team: 'engineering:example.org', address: null, resident: null, provider: 'example.chat' });
  assert.equal(servedIdentityText(rows['release-manager-local-id'].identity), 'alias release-manager-local-id on engineering:example.org');
  assert.deepEqual(rows['release-manager-grant-id'].identity.grant, { expiresAt: '2026-12-31T00:00:00Z' });
  assert.equal(servedIdentityText(rows['release-manager-grant-id'].identity), 'acts as example.org/release-manager via grant, expires 2026-12-31T00:00:00Z');
  const renamed = { ...rows['release-manager-local-id'].identity, provider: 'some.other.provider' };
  assert.equal(servedIdentityText(renamed), servedIdentityText(rows['release-manager-local-id'].identity), 'rendering never keys on a provider name');
});

test('served identity follows the documented layer contract; absent stays absent', () => {
  assert.equal(servedIdentityText({ mode: 'global', address: 'example.aweb.ai/coordinator', grant: { id: 'g', expiresAt: '2026-09-24T18:00:00Z' } }),
    'acts as example.aweb.ai/coordinator via grant, expires 2026-09-24T18:00:00Z');
  assert.equal(servedIdentityText({ mode: 'local', alias: 'dev-one', team: 'aweb:example' }), 'alias dev-one on aweb:example');
  for (const absent of [undefined, null, 'string']) assert.equal(servedIdentityText(absent), null);
});

test('lock notes and unavailable text use workspace status arrays and named features', () => {
  const h = workspaceStatusData(header, context);
  assert.deepEqual(lockNotes(h), [], 'a locked, approved, declared set needs no note');
  assert.deepEqual(lockNotes({ ...h, unsynced: ['a'], stale: ['b'] }).map(n => n.text),
    ['Declared but not locked: a. Sync to lock them.', 'Locked but no longer declared: b. Sync to drop them.']);
  assert.match(deploymentUnavailableText({ status: 'unavailable', reason: { code: 'E_DEPLOYMENT_FEATURE', feature: 'served-identity' } }, DESKTOP_TERMS), /does not advertise served-identity/);
  assert.equal(deploymentUnavailableText({ status: 'unavailable', reason: { code: 'E_X', message: 'kernel said' } }, DESKTOP_TERMS), 'E_X: kernel said');
  // The same reason marked as the kernel's own (#855, 3a) is attributed, and its message goes through the display filter.
  assert.equal(deploymentUnavailableText({ status: 'unavailable', reason: { code: 'E_X', message: 'kernel said', origin: 'kernel' } }, DESKTOP_TERMS), 'OATS answered with an error (E_X). It says: kernel said');
  assert.equal(deploymentUnavailableText({ status: 'observed' }, DESKTOP_TERMS), '');
});

test('withheld instance rows and an unreachable workspace are reported with their names and codes', () => {
  const notes = deploymentNotes({ status: 'observed', workspaceStatus: workspaceStatusData(header, context),
    reachable: { reachable: false, code: 'E_REMOTE_UNREADABLE', message: 'network' },
    withheld: [{ agent: 'release-manager', instance: 'rm-evil', reason: 'home-outside-soul' }] }).map(n => n.text);
  assert.match(notes[0], /Workspace unreachable — module drift is not current\. E_REMOTE_UNREADABLE: network/);
  assert.match(notes[1], /1 instance row was withheld: .*\(rm-evil\)/);
});

test('the context panel instance page projects kernel drift as the "older build" chip, and the served identity, from the roster row', async () => {
  const dom = new JSDOM('<!doctype html><html><body><aside id="context-panel"></aside></body></html>', { url: 'http://localhost' });
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = dom.window.document; globalThis.window = dom.window;
  try {
    const { createContextPanel } = await import('../renderer/context-panel.mjs');
    const panel = createContextPanel(dom.window.document.getElementById('context-panel'), {});
    const row = { ...instance(), identity: { mode: 'local', alias: 'dev-one', team: 'aweb:example' } };
    panel.setContext({ workspace: { id: context }, instance: row, key: row.home });
    const field = id => dom.window.document.querySelector(`[data-context-field="${id}"]`).textContent;
    const chip = dom.window.document.querySelector('[data-context-drift]');
    assert.equal(chip.hidden, true, 'the captured row is current: no chip');
    assert.equal(field('identity'), 'alias dev-one on aweb:example');
    const drifted = { ...row, modules: row.modules.map((m, i) => i === 1 ? { ...m, status: 'missing', reason: 'capability-absent', current: null } : m) };
    panel.setContext({ workspace: { id: context }, instance: drifted, key: row.home });
    assert.equal(chip.hidden, false); assert.match(chip.title, new RegExp(`${drifted.modules[1].name} is no longer available \\(capability-absent\\)`));
    panel.setContext({ workspace: { id: context }, instance: instance(), key: row.home });
    assert.equal(field('identity'), 'Not reported', 'absent identity is never synthesized');
    panel.dispose?.();
  } finally { globalThis.document = previous.document; globalThis.window = previous.window; dom.window.close(); }
});

test('a Herdr-recorded row keeps only the recognisable part of its sessionTarget, with the kernel\'s unsupported reason', () => {
  const doc = structuredClone(status), row = doc.agents[0].instances[0];
  const reason = 'E_HERDR_REMOVED: Herdr is no longer supported by OATS (removed in 0.31.0); tmux is the only session backend.';
  Object.assign(row, { running: null, runtimeState: 'unsupported', runtimeError: reason,
    sessionTarget: { backend: 'herdr', binary: 'herdr', protocol: '20', socket: '/memory/herdr.sock', workspaceId: 'w1', paneId: 'w1:pA', terminalId: 'term_ABC' } });
  const served = deploymentStatusData(doc, context).agents[0].instances[0];
  assert.deepEqual(served.sessionTarget, { backend: 'herdr' }, 'no Herdr connection data is forwarded, and an old field never breaks the read');
  assert.deepEqual([served.running, served.runtimeState, served.runtimeError], [null, 'unsupported', reason]);
  row.sessionTarget = 'herdr';
  assert.throws(() => deploymentStatusData(doc, context), 'a non-record sessionTarget is still a malformed report');
});

/* ── Whose words the unavailable sentence carries (#855, 3a) ── */
const unavailable = (reason) => ({ status: 'unavailable', ...(reason === undefined ? {} : { reason }) });
const kernel = (code, message) => unavailable({ code, ...(message === undefined ? {} : { message }), origin: 'kernel' });
const parts = (deployment, terms = DESKTOP_TERMS) => deploymentUnavailableParts(deployment, terms);
const said = (deployment, terms = DESKTOP_TERMS) => deploymentUnavailableText(deployment, terms);
const READING = 'Reading the deployment through the installed OATS CLI…';
const FEATURE = 'The installed OATS CLI does not advertise served-identity, which the Desktop needs to show this deployment. Update OATS and retry.';

test('the parts of the unavailable sentence, row by row, and the one line as those parts joined by a space', () => {
  const rows = [
    // [the deployment, headline, lead, sentence, the one line]
    [kernel('E_WORKSPACE_SCHEMA', 'the workspace file is not valid'), 'OATS answered with an error (E_WORKSPACE_SCHEMA).', 'It says:', 'the workspace file is not valid',
      'OATS answered with an error (E_WORKSPACE_SCHEMA). It says: the workspace file is not valid'],
    [kernel('E_REMOTE_UNREADABLE', 'fetch https://op:hunter2@example.com/x.git failed'), 'OATS answered with an error (E_REMOTE_UNREADABLE).', null, DETAIL_WITHHELD,
      'OATS answered with an error (E_REMOTE_UNREADABLE). [Detail withheld]'],
    [kernel('E_X', ''), 'OATS answered with an error (E_X).', null, null, 'OATS answered with an error (E_X).'],
    [kernel('E_X', ' \n\t '), 'OATS answered with an error (E_X).', null, null, 'OATS answered with an error (E_X).'],
    [kernel('E_X'), 'OATS answered with an error (E_X).', null, null, 'OATS answered with an error (E_X).'],
    [kernel('E_X', 7), 'OATS answered with an error (E_X).', null, null, 'OATS answered with an error (E_X).'],
    // A code with no `E_` that the reader admitted and marked reads the same way.
    [kernel('BAD_STATE', 'the kernel said this'), 'OATS answered with an error (BAD_STATE).', 'It says:', 'the kernel said this', 'OATS answered with an error (BAD_STATE). It says: the kernel said this'],
    // No origin: unchanged.
    [unavailable({ code: 'E_X', message: 'kernel said' }), 'E_X: kernel said', null, null, 'E_X: kernel said'],
    [unavailable({ message: 'only a message' }), 'only a message', null, null, 'only a message'],
    [unavailable({ code: 'E_X' }), 'The deployment could not be observed.', null, null, 'The deployment could not be observed.'],
    [unavailable({}), 'The deployment could not be observed.', null, null, 'The deployment could not be observed.'],
    [unavailable(), 'The deployment could not be observed.', null, null, 'The deployment could not be observed.'],
    // A missing feature: unchanged, and before any origin is read.
    [unavailable({ code: 'E_DEPLOYMENT_FEATURE', feature: 'served-identity' }), FEATURE, null, null, FEATURE],
    [unavailable({ code: 'E_DEPLOYMENT_FEATURE', feature: 'served-identity', message: 'm', origin: 'kernel' }), FEATURE, null, null, FEATURE],
    // No deployment, or pending: unchanged.
    [undefined, READING, null, null, READING], [null, READING, null, null, READING], [{ status: 'pending' }, READING, null, null, READING],
    [{ status: 'pending', reason: { code: 'E_X', message: 'm', origin: 'kernel' } }, READING, null, null, READING],
    // Observed: nothing to say.
    [{ status: 'observed' }, null, null, null, ''], [{ status: 'observed', reason: { code: 'E_X', message: 'm', origin: 'kernel' } }, null, null, null, ''],
  ];
  for (const [deployment, headline, lead, sentence, line] of rows) {
    assert.deepEqual(parts(deployment), { headline, lead, sentence }, JSON.stringify(deployment));
    assert.equal(said(deployment), line, JSON.stringify(deployment));
    assert.equal(said(deployment), [headline, lead, sentence].filter(part => part !== null).join(' '), 'the parts that are there, joined by one space');
    assert.deepEqual(Object.keys(parts(deployment)), ['headline', 'lead', 'sentence'], 'in the order they are shown');
  }
});

test('the kernel form needs both the mark and a code the reader admits; any other origin, or the mark with another code, reads as none', () => {
  const plain = 'E_X: kernel said';
  for (const origin of ['desktop', 'client', 'Kernel', 'kernel ', true, 1, null, undefined, ['kernel'], { kernel: true }]) {
    assert.equal(said(unavailable({ code: 'E_X', message: 'kernel said', origin })), plain, JSON.stringify(origin));
    assert.deepEqual(parts(unavailable({ code: 'E_X', message: 'kernel said', origin })), { headline: plain, lead: null, sentence: null }, JSON.stringify(origin));
  }
  for (const code of ['e_x', 'E-X', '1X', '', 'E X', 'E_' + 'A'.repeat(63), undefined, null, 7]) {
    const reason = { code, message: 'kernel said', origin: 'kernel' };
    const expected = typeof code === 'string' && code ? `${code}: kernel said` : 'kernel said';
    assert.deepEqual(parts(unavailable(reason)), { headline: expected, lead: null, sentence: null }, String(code));
  }
  // The mark is read on the reason, nowhere else.
  assert.equal(said({ status: 'unavailable', origin: 'kernel', reason: { code: 'E_X', message: 'kernel said' } }), plain);
});

test('the kernel\'s message is shown through the display filter only: one line, whole or withheld, never cut by its words', () => {
  const sentence = (message) => parts(kernel('E_X', message)).sentence;
  // A control character is replaced, not dropped; line breaks and tabs become one space.
  assert.equal(sentence('first line\nsecond\tline'), 'first line second line');
  assert.equal(sentence('bell\u0085here'), 'bell\uFFFDhere');
  for (const control of ['\u0000', '\u0007', '\u001b[31mred', '\u007f']) assert.deepEqual(parts(kernel('E_X', `a${control}b`)), { headline: 'OATS answered with an error (E_X).', lead: null, sentence: DETAIL_WITHHELD }, JSON.stringify(control));
  // A credential shape withholds the whole message, and it is not introduced.
  for (const secret of ['token=abcdef0123456789', 'Authorization: Bearer abc', 'https://user:pw@host/repo.git', 'ghp_' + 'a'.repeat(36), 'password = hunter2']) {
    const p = parts(kernel('E_X', `the read failed with ${secret} in it`));
    assert.deepEqual(p, { headline: 'OATS answered with an error (E_X).', lead: null, sentence: DETAIL_WITHHELD }, secret);
    assert.doesNotMatch(said(kernel('E_X', `the read failed with ${secret} in it`)), /abcdef|Bearer|user:pw|ghp_|hunter2/);
  }
  // 8192 characters, the most the reader admits: bounded by the filter, not by a rule of this sentence.
  const long = 'word '.repeat(1638) + 'ab';
  assert.equal(long.length, 8192);
  assert.equal(sentence(long), displayLine(long));
  assert.ok(sentence(long).length <= MAX_DISPLAY_LINE && sentence(long).startsWith('word word word'));
  assert.equal(said(kernel('E_X', long)), `OATS answered with an error (E_X). It says: ${displayLine(long)}`);
  // It is not parsed or matched: a message that spells the sentence's own words, a code or a feature is only text.
  for (const message of ['It says: nothing', 'E_OTHER: another code', 'OATS answered with an error (E_Y).', 'does not advertise served-identity', '{"code":"E_Z"}']) {
    assert.deepEqual(parts(kernel('E_X', message)), { headline: 'OATS answered with an error (E_X).', lead: 'It says:', sentence: message }, message);
  }
  // A kernel message that is the withheld marker itself is not introduced either.
  assert.deepEqual(parts(kernel('E_X', DETAIL_WITHHELD)), { headline: 'OATS answered with an error (E_X).', lead: null, sentence: DETAIL_WITHHELD });
  // What the filter passes is a display line: filtering it again changes nothing.
  for (const message of ['plain', 'a\nb', 'bell\u0085here', long]) assert.equal(displayLine(sentence(message)), sentence(message));
});

test('`sentence` is the only part that can carry words the client did not write', () => {
  const WORDS = 'ZQX-words-of-the-kernel';
  // Marked: the message is in `sentence` and in no other part, whatever the code; the headline is fixed words and the code.
  for (const code of ['E_X', 'BAD_STATE', 'E_REMOTE_UNREADABLE', 'E_CLI_FAILED']) {
    const p = parts(kernel(code, `${WORDS} and more`));
    assert.equal(p.sentence, `${WORDS} and more`);
    assert.equal(p.headline, `OATS answered with an error (${code}).`); assert.equal(p.lead, 'It says:');
    assert.doesNotMatch(`${p.headline} ${p.lead}`, /ZQX/);
  }
  // Nothing else of a marked reason is shown: not its cause, not a field the kernel might add.
  const extra = parts({ status: 'unavailable', reason: { code: 'E_X', message: 'm', origin: 'kernel', cause: { reason: WORDS, host: WORDS }, details: { [WORDS]: WORDS }, hint: WORDS } });
  assert.doesNotMatch(JSON.stringify(extra), /ZQX/);
  // Every other row has no `sentence` at all: its headline is the client's own sentence. For a reason without the mark that
  // rests on who makes one: the reader's own failures, each a fixed sentence of deployment-contract.mjs.
  for (const code of ['E_CLI_UNAVAILABLE', 'E_BAD_ARGS', 'E_CLI_FAILED', 'E_CLI_PROTOCOL', 'E_CLI_TIMEOUT', 'E_CLI_OUTPUT_LIMIT', 'E_DEPLOYMENT_SCOPE', 'E_DEPLOYMENT_STALE', 'E_DEPLOYMENT_BUSY']) {
    const { reason } = deploymentFailure(code);
    assert.deepEqual(parts(unavailable(reason)), { headline: `${code}: ${reason.message}`, lead: null, sentence: null }, code);
  }
  assert.deepEqual(parts(unavailable(deploymentFailure('E_DEPLOYMENT_FEATURE', 'served-identity').reason)), { headline: FEATURE, lead: null, sentence: null });
  for (const deployment of [undefined, { status: 'pending' }, { status: 'observed' }, unavailable()]) assert.equal(parts(deployment).sentence, null);
});

test('the parts are a fresh object at every call, the deployment given is not changed, and both functions need the client\'s terms', () => {
  const frozen = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(frozen); } return value; };
  for (const deployment of [kernel('E_X', 'kernel said'), unavailable({ code: 'E_X', message: 'm' }), { status: 'pending' }, { status: 'observed' }, undefined]) {
    const first = parts(frozen(deployment)), second = parts(deployment);
    assert.notEqual(first, second, 'never a shared object');
    assert.deepEqual(first, second);
    first.headline = 'changed by a caller'; first.sentence = 'and this';
    assert.deepEqual(parts(deployment), second, 'a caller that changes its parts changes no one else\'s');
  }
  // The terms are the client's: the feature sentence names the client that needs it, and nothing else differs.
  const TUI = clientTerms({ name: 'oats tui', self: 'oats tui', selfInitial: 'oats tui', update: 'OATS', thisMachine: 'This machine' });
  assert.match(parts(unavailable({ code: 'E_DEPLOYMENT_FEATURE', feature: 'served-identity' }), TUI).headline, /which the oats tui needs to show this deployment/);
  assert.deepEqual(parts(kernel('E_X', 'kernel said'), TUI), parts(kernel('E_X', 'kernel said')));
  for (const notTerms of [undefined, null, { name: 'OATS Desktop' }]) {
    assert.throws(() => deploymentUnavailableParts(kernel('E_X', 'm'), notTerms), { name: 'TypeError', message: 'deploymentUnavailableParts: terms must be the object clientTerms() returned' });
    assert.throws(() => deploymentUnavailableText(kernel('E_X', 'm'), notTerms), { name: 'TypeError', message: 'deploymentUnavailableText: terms must be the object clientTerms() returned' });
  }
});

test('the mark travels with the reason: from the reader through the observer, the entry and the panel to the sentence a view shows', async () => {
  const probe = fixture('version'), cli = { ...probe, ok: true, bin: '/fixture/bin/oats' };
  const refused = (error) => (_bin, _args, _options, callback) => callback({ code: 1 }, JSON.stringify({ schemaVersion: 1, ok: false, error }));
  const observed = async (exec) => {
    const state = { deployment: context, revision: 1, cli };
    const observer = createDeploymentObserver({ getContext: id => (id === context ? state : null), read: (c, options) => cliDeploymentRead(c, options, { exec, env: {} }) });
    return observer.observe(context);
  };
  const held = (entry) => ({ ctxs: [context], snapshot: { byWs: new Map([[context, entry]]) }, remoteGroups: [], remembered: { get: () => null, note: () => null, all: () => [] },
    rosterAnswered: true, rosterFailure: null, cli: { ...cli, features: ['workspace-identity'] }, observing: new Set(), remoteCollecting: false, home: '/Users/op', at: '2026-10-11T12:00:00.000Z' });
  // The kernel refuses: the reader marks it, and the observer hands on the reader's answer, each waiter its own copy.
  const result = await observed(refused({ code: 'E_WORKSPACE_SCHEMA', message: 'the workspace file is not valid', details: { path: '/private' } }));
  assert.deepEqual(result, { ok: false, reason: { code: 'E_WORKSPACE_SCHEMA', message: 'the workspace file is not valid', origin: 'kernel' } });
  // The entry of an unavailable deployment holds the reason whole, and the panel serves it as it is.
  const entry = failedEntry(undefined, result.reason, '2026-10-11T12:00:00.000Z');
  assert.equal(entry.deployment.reason, result.reason);
  assert.equal(publicDeployment(entry.deployment), entry.deployment);
  const panel = JSON.parse(JSON.stringify(panelData(held(entry), context, DESKTOP_TERMS)));   // as /api/panel sends it
  assert.deepEqual(panel.deployment, { status: 'unavailable', reason: { code: 'E_WORKSPACE_SCHEMA', message: 'the workspace file is not valid', origin: 'kernel' } });
  // Every caller reads the same sentence from it: the page from the panel's deployment, the views for the deployment's reason.
  const sentence = 'OATS answered with an error (E_WORKSPACE_SCHEMA). It says: the workspace file is not valid';
  assert.equal(deploymentUnavailableText(panel.deployment, DESKTOP_TERMS), sentence);
  assert.equal(viewModel(held(entry), DESKTOP_TERMS).infos.get(context).reason, sentence);
  assert.deepEqual([panel.deployments[0].reason, panel.deployments[0].short], [sentence, 'Not observed']);
  assert.deepEqual([panel.workspaces[0].unattached, panel.workspaces[0].reason, panel.workspaces[0].short], [true, sentence, 'Not observed'], 'and the choice the switcher lists apart');
  // The reader's own failure travels the same path without a mark, and reads as before.
  const failed = await observed((_bin, _args, _options, callback) => callback({ killed: true }, ''));
  assert.deepEqual(failed, deploymentFailure('E_CLI_TIMEOUT'));
  const own = failedEntry(undefined, failed.reason, '2026-10-11T12:00:00.000Z');
  assert.equal(viewModel(held(own), DESKTOP_TERMS).infos.get(context).reason, 'E_CLI_TIMEOUT: The deployment observation exceeded its time limit.');
  // Not this sentence's: an unreadable remote that keeps its last observation keeps the kernel's message beside it, as it came.
  const kept = failedEntry({ deployment: { status: 'observed', root: `${context}/agents`, workspace: { name: 'northwind' }, workspaceStatus: {}, reachable: null, withheld: [], souls: [] }, instances: [], generatedAt: 'g' },
    { code: 'E_REMOTE_UNREADABLE', message: 'the remote cache is locked', origin: 'kernel', cause: { reason: 'cache' } }, '2026-10-11T12:00:00.000Z');
  assert.deepEqual([kept.deployment.status, kept.error, kept.errorCause], ['observed', 'the remote cache is locked', { code: 'E_REMOTE_UNREADABLE', reason: 'cache' }]);
  assert.equal(Object.hasOwn(kept.deployment, 'reason'), false);
});

/* ── #982, the fix forward: the reader's own reason goes through the display filter too ── */
test("the reader's own reason through the filter: each of its fixed sentences reads byte for byte as written, and anything else of that shape is one line or withheld whole", () => {
  const parts = deployment => deploymentUnavailableParts(deployment, DESKTOP_TERMS);
  const unavailable = reason => ({ status: 'unavailable', reason });
  // Every code the reader can answer (deployment-contract.mjs `deploymentFailure`), the missing feature in both of its forms.
  const CODES = ['E_CLI_UNAVAILABLE', 'E_DEPLOYMENT_FEATURE', 'E_BAD_ARGS', 'E_CLI_FAILED', 'E_CLI_PROTOCOL', 'E_CLI_TIMEOUT', 'E_CLI_OUTPUT_LIMIT', 'E_DEPLOYMENT_SCOPE', 'E_DEPLOYMENT_STALE', 'E_DEPLOYMENT_BUSY'];
  const source = readFileSync(new URL('../../client/deployment-contract.mjs', import.meta.url), 'utf8');
  const table = source.slice(source.indexOf('export function deploymentFailure'), source.indexOf('const known = Object.hasOwn(messages, code)'));
  assert.deepEqual([...table.matchAll(/^\s{4}(E_[A-Z_]+):/gm)].map(found => found[1]), CODES, 'the list here is every code of the table');
  for (const code of CODES) {
    const { reason } = deploymentFailure(code);
    assert.equal(reason.code, code);
    const line = `${code}: ${reason.message}`;   // the base's expression, as it was shown
    assert.deepEqual(parts(unavailable(reason)), { headline: line, lead: null, sentence: null }, code);
    assert.equal(deploymentUnavailableText(unavailable(reason), DESKTOP_TERMS), line, code);
    assert.equal(displayLine(line), line, `${code}: the filter changes no byte of it`);
  }
  // A hand-made reason with no mark: the whole line at once, never under the kernel's name.
  for (const [reason, shown] of [
    [{ code: 'E_X', message: 'wipe \x1b[2J the screen' }, DETAIL_WITHHELD],
    [{ code: 'E_X', message: 'bell\u0007' }, DETAIL_WITHHELD],
    [{ message: 'red \u009B31m alert' }, 'red \uFFFD31m alert'],
    [{ code: 'E_X', message: 'fetch https://op:hunter2@example.com/x.git failed' }, DETAIL_WITHHELD],
    [{ code: 'wipe \x1b[2J', message: 'a message' }, DETAIL_WITHHELD],
    [{ code: 'E_X', message: 'first\nsecond\tthird' }, 'E_X: first second third'],
    [{ code: 'E_X', message: 'safe\u202Etxt.exe was read' }, 'E_X: safe\uFFFDtxt.exe was read'],
    [{ code: 'E_X', message: '<b>bold</b>' }, 'E_X: <b>bold</b>'],
    // Nothing to show: the client's own sentence, as before for a reason without a message.
    [{ message: ' \n\t ' }, 'The deployment could not be observed.'],
    [{ code: 'E_X' }, 'The deployment could not be observed.'], [{}, 'The deployment could not be observed.'],
  ]) {
    assert.deepEqual(parts(unavailable(reason)), { headline: shown, lead: null, sentence: null }, JSON.stringify(reason));
    assert.doesNotMatch(parts(unavailable(reason)).headline, /[\u0000-\u001f\u007f-\u009f\u202e]/, JSON.stringify(reason));
  }
});

/* ── #982: a kept failure, and who made its message ── */
test('keptFailure: `error` is a string exactly when a failure is kept, whatever it holds; the speaker is the one value failedEntry writes', () => {
  // The fact does not depend on the text.
  for (const error of ['the cache is locked', '', '   ', '\n', 'bell\u0007', 'token: abc123']) {
    assert.deepEqual(keptFailure({ error }), { message: error, origin: null }, JSON.stringify(error));
    assert.deepEqual(keptFailure({ error, errorOrigin: 'kernel' }), { message: error, origin: 'kernel' }, JSON.stringify(error));
  }
  for (const error of [undefined, null, 0, 7, false, true, {}, ['x']]) assert.equal(keptFailure({ error, errorOrigin: 'kernel' }), null, JSON.stringify(error));
  for (const held of [undefined, null, 'error', 7, []]) assert.equal(keptFailure(held), null, JSON.stringify(held));
  // Any value but the one reads as no speaker, never as the kernel.
  for (const errorOrigin of [undefined, null, '', 'Kernel', 'kernel ', 'terminal-probe', 'roster-read', true, 1, {}, ['kernel']]) {
    assert.deepEqual(keptFailure({ error: 'm', errorOrigin }), { message: 'm', origin: null }, JSON.stringify(errorOrigin));
  }
  // Nothing given is changed, and each call makes its own answer.
  const held = Object.freeze({ error: 'm', errorOrigin: 'kernel' });
  assert.notEqual(keptFailure(held), keptFailure(held));
});

test("the kept failure's mark travels: from the reader through the observer and failedEntry to the panel's key and the deployment's reason", async () => {
  const probe = fixture('version'), cli = { ...probe, ok: true, bin: '/fixture/bin/oats' }, AT = '2026-10-11T12:00:00.000Z';
  const refused = (error) => (_bin, _args, _options, callback) => callback({ code: 1 }, JSON.stringify({ schemaVersion: 1, ok: false, error }));
  const read = async (exec) => {
    const state = { deployment: context, revision: 1, cli };
    return createDeploymentObserver({ getContext: id => (id === context ? state : null), read: (c, options) => cliDeploymentRead(c, options, { exec, env: {} }) }).observe(context);
  };
  const held = (entry) => ({ ctxs: [context], snapshot: { byWs: new Map([[context, entry]]) }, remoteGroups: [], remembered: { get: () => null, note: () => null, all: () => [] },
    rosterAnswered: true, rosterFailure: null, cli: { ...cli, features: ['workspace-identity'] }, observing: new Set(), remoteCollecting: false, home: '/Users/op', at: AT });
  const observedEntry = { deployment: { status: 'observed', root: `${context}/agents`, workspace: { name: 'northwind' }, workspaceStatus: {}, reachable: null, withheld: [], souls: [] },
    instances: [{ instance: 'dev-a', running: true }], generatedAt: 'g', observedAt: 'o' };
  const served = (entry) => JSON.parse(JSON.stringify(panelData(held(entry), context, DESKTOP_TERMS)));   // as /api/panel sends it
  const OWN = "This deployment's last read failed. It shows what was last observed.";
  // The kernel could not read the workspace remote. Whatever else its error carried, the reader's mark is the reader's own.
  const result = await read(refused({ code: 'E_REMOTE_UNREADABLE', message: 'the remote cache is locked', origin: 'roster-read', errorOrigin: 'nobody', details: { reason: 'cache' } }));
  assert.equal(result.reason.origin, 'kernel'); assert.equal(Object.hasOwn(result.reason, 'errorOrigin'), false);
  const kept = failedEntry(observedEntry, result.reason, AT);
  assert.deepEqual([kept.error, kept.errorOrigin, kept.deployment.status], ['the remote cache is locked', 'kernel', 'observed']);
  const panel = served(kept);
  assert.deepEqual([panel.error, panel.errorOrigin], ['the remote cache is locked', 'kernel']);
  assert.deepEqual([panel.deployments[0].stale, panel.deployments[0].reason, panel.deployments[0].short], [true, `${OWN} OATS says: the remote cache is locked`, 'Last read failed']);
  assert.equal(Object.hasOwn(panel.deployments[0], 'errorOrigin'), false, 'a deployment\'s entry carries the sentence, not the mark');
  assert.equal(panel.instances.length, 1, 'the last observation is still served');
  // A kernel that failed with no words has still failed: stale, the client's own sentence, and the panel's `error` a string.
  for (const message of ['', '   ', undefined]) {
    const silent = await read(refused({ code: 'E_REMOTE_UNREADABLE', ...(message === undefined ? {} : { message }), details: { reason: 'cache' } }));
    if (silent.reason.code !== 'E_REMOTE_UNREADABLE') continue; // the reader's contract refuses an envelope without a message: not this case
    const quiet = served(failedEntry(observedEntry, silent.reason, AT));
    assert.equal(typeof quiet.error, 'string', JSON.stringify(message));
    assert.deepEqual([quiet.deployments[0].stale, quiet.deployments[0].reason], [true, OWN], JSON.stringify(message));
    assert.equal(viewModel(held(failedEntry(observedEntry, silent.reason, AT)), DESKTOP_TERMS).infos.get(context).live, false);
  }
  // A message the filter withholds: stale all the same, and never introduced by the speaker's words.
  const hostile = await read(refused({ code: 'E_REMOTE_UNREADABLE', message: 'wipe \x1b[2J the screen', details: { reason: 'cache' } }));
  const withheld = served(failedEntry(observedEntry, hostile.reason, AT));
  assert.deepEqual([withheld.deployments[0].stale, withheld.deployments[0].reason, withheld.errorOrigin], [true, `${OWN} [Detail withheld]`, 'kernel']);
  // A hand-made reason with no mark: no key, and the words a client always showed, with the message filtered.
  const unmarked = served(failedEntry(observedEntry, { code: 'E_REMOTE_UNREADABLE', message: 'the remote cache is locked' }, AT));
  assert.equal(Object.hasOwn(unmarked, 'errorOrigin'), false);
  assert.equal(unmarked.deployments[0].reason, "This deployment's last read failed: the remote cache is locked. It shows what was last observed.");
  assert.equal(served(failedEntry(observedEntry, { code: 'E_REMOTE_UNREADABLE', message: 'bell\u0007' }, AT)).deployments[0].reason,
    "This deployment's last read failed: [Detail withheld]. It shows what was last observed.");
  // An entry that is not observed is never a kept failure, whatever keys it carries.
  const forged = served({ deployment: { status: 'unavailable', reason: { code: 'E_CLI_FAILED', message: 'boom' } }, instances: [], generatedAt: 'g', error: '', errorOrigin: 'kernel' });
  assert.deepEqual([forged.deployments[0].stale, forged.deployments[0].reason], [undefined, 'E_CLI_FAILED: boom']);
});
