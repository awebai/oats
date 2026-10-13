// #982: the contract the Desktop's helper hangs its display filter on. A reason's `origin` is there exactly
// when its sentence is not the shared home's own, so a missing `origin` can never hide a text from outside.
// Held over generated rows, for every function whose reason the helper (renderer/speaker-line.mjs) is handed:
//
//   rowReason(row)                        remote-address.mjs: a roster row's title, the notice of a terminal
//                                         that cannot open, a Herdr row's reason
//   instanceActs(row).blocked             instance-acts.mjs: the actions trigger (`unaddressable`, `held`)
//   instanceActs(row).limited             the same module (`held`)
//   instanceActs(row).acts[].reason       Start's `unsupported-session`
//
// The rows come the way a client gets them: this computer's through the liveness collector's answers and
// `panelInstances`, another machine's through `remotePanel`, reached and not; then again with their mark
// removed or replaced, as no path of the shared home leaves them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rowReason, unaddressableSentence, serverLabel } from '../../client/remote-address.mjs';
import { instanceActs } from '../../client/instance-acts.mjs';
import { heldHome } from '../../client/instance-tree.mjs';
import { HERDR_STAND_IN, hasRuntimeError, knownOrigin, originLead } from '../../client/instance-presentation.mjs';
import { observeLiveness } from '../../client/liveness.mjs';
import { livenessInput, livenessAnswers, panelInstance, panelInstances, failedEntry } from '../../client/deployment-panel.mjs';
import { remotePanel, unavailableGroups } from '../../client/remote-roster.mjs';
import { parseEnvelope } from '../../client/cli-adapter.mjs';
import { keptFailure } from '../../client/deployment-facts.mjs';
import { displayLine, DETAIL_WITHHELD } from '../../client/display-text.mjs';
import { kernelRemoteRow, kernelRemoteGroup } from './helpers/kernel-remote-row.mjs';
import { reasonLine, rowReasonLine, runtimeErrorLine, speakerLine } from '../renderer/speaker-line.mjs';
import { projectActivePanel } from '../renderer/active-observation.mjs';
import { DESKTOP_TERMS } from '../renderer/desktop-terms.mjs';

const AT = '2026-10-11T12:00:00.000Z';
const SPEAKERS = ['kernel', 'terminal-probe', 'roster-read'];
// What a text from outside can hold: plain words, control characters, a credential's shape, a bidi override,
// the kernel's own Herdr reason, and the very bytes of this home's stand-in.
const HOSTILE = ['wipe \x1b[2J the screen', 'bell\u0007', 'token: abc123', 'https://op:hunter2@example.invalid/x.git'];
const TEXTS = ['the session did not answer', ...HOSTILE, 'safe‮txt.exe was read', `${HERDR_STAND_IN} (dev)`, HERDR_STAND_IN];
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
// A mark as it might arrive beside a row: none, each speaker, the word itself, and values that are nothing.
const MARKS = [undefined, ...SPEAKERS, 'unattributed', 'someone-else', 'wipe \x1b[2J', null, 7];
const marked = (mark) => (mark === undefined ? {} : { runtimeErrorOrigin: mark });

/** The error the installed CLI printed, as the adapter parses it: it carries the kernel's mark. */
const printed = (message) => parseEnvelope(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'E_SSH', message } })).error;

/** This computer's rows as a panel holds them: kernel rows, the collector's answers over a JSON trip, `panelInstances`. */
function localRows() {
  const out = [];
  const targets = [{}, { tmux: { session: 's', window: 'w' } }, { sessionTarget: 'herdr:pane-1' }];
  const kernel = [];
  for (const running of [true, false, null, undefined]) for (const runtimeState of [undefined, 'unsupported', 'unreachable']) for (const runtimeError of [undefined, '', ...TEXTS]) {
    for (const target of targets) for (const mark of MARKS.slice(0, 5)) {
      const name = `dev-${kernel.length}`;
      kernel.push({ instance: name, home: `/w/agents/dev/instances/${name}`, agentsRoot: '/w/agents', agent: 'dev',
        ...(running === undefined ? {} : { running }), ...(runtimeState ? { runtimeState } : {}), ...(runtimeError === undefined ? {} : { runtimeError }), ...target, ...marked(mark) });
    }
  }
  for (const text of ['no server running on the socket', ...HOSTILE, 'safe‮txt.exe']) {
    for (const verdict of [{ running: true, runtimeState: 'running' }, { running: false, runtimeState: 'stopped' }, { running: null, runtimeState: 'unreachable', runtimeError: text }]) {
      const answers = observeLiveness(livenessInput(kernel), { tmuxReader: row => ({ tmux: row.tmux, ...verdict }) });
      // The collector's answer as it prints it, and one that also claims a speaker for every text.
      out.push(...panelInstances(kernel, livenessAnswers(kernel, JSON.stringify(answers))));
      for (const claim of ['kernel', 'unattributed']) out.push(...panelInstances(kernel, livenessAnswers(kernel, JSON.stringify(answers.map(a => ({ ...a, runtimeErrorOrigin: claim }))))));
    }
  }
  // The collector failed, or printed something else.
  for (const stdout of [undefined, 'not json', '[]']) out.push(...panelInstances(kernel, livenessAnswers(kernel, stdout)));
  return out;
}

/** Another machine's rows as a panel holds them: `remotePanel` over groups reached and not reached. */
function remoteRows() {
  const hostRows = [];
  for (const running of [true, false, null]) for (const runtimeState of [null, 'unsupported']) for (const runtimeError of [undefined, '', 7, { message: 'x' }, ...TEXTS]) {
    for (const backend of ['tmux', 'herdr']) for (const [addressable, missingRemotely] of [[true, false], [false, false], [false, true], [undefined, false]]) for (const mark of MARKS) {
      hostRows.push(kernelRemoteRow(`dev-${hostRows.length}`, { running, runtimeState, backend, addressable, missingRemotely, ...(runtimeError === undefined ? {} : { runtimeError }), ...marked(mark) }));
    }
  }
  const reached = kernelRemoteGroup(hostRows);
  const groups = [reached];
  for (const text of TEXTS) {
    groups.push(...unavailableGroups([reached], printed(text)));                              // an error the installed CLI printed
    groups.push(...unavailableGroups([reached], { code: 'E_REMOTE_ROSTER', message: text })); // one the client wrote while reading
    groups.push(...unavailableGroups([reached], { code: 'E_SSH', message: text, runtimeErrorOrigin: 'kernel', origin: 'kernel' })); // a copy that claims to be the kernel's
  }
  groups.push({ ...reached, probe: { ok: false }, instances: hostRows.map(i => ({ ...i, running: null })) });   // not reached, no error at all
  return groups.flatMap(group => remotePanel(group, AT).instances);
}

/** Every reason the helper is handed for a row, each with the function it came from. */
function reasonsOf(row) {
  const acts = instanceActs(row);
  return [['rowReason', rowReason(row)], ['instanceActs.blocked', acts.blocked], ['instanceActs.limited', acts.limited],
    ...acts.acts.map(act => [`instanceActs.acts.${act.verb}`, act.reason])].filter(([, reason]) => reason !== null);
}

/** The sentences the shared home writes for a row: the only ones a reason without an `origin` may carry. */
function ownSentences(row) {
  const label = serverLabel(row), held = heldHome(row);
  return [HERDR_STAND_IN, `${label} was not reached.`, unaddressableSentence(row), `${row.instance}: status unknown`, ...(held ? [held.sentence(row.instance)] : [])];
}

/** The contract, for one row. `settled`: the row is as the shared home left it (its mark is the shared home's). */
function holds(row, settled, counts) {
  for (const [from, reason] of reasonsOf(row)) {
    const at = `${from}: ${JSON.stringify(row)}`;
    if (!Object.hasOwn(reason, 'origin')) {
      counts.own++;
      assert.equal(typeof reason.sentence, 'string', at);
      assert.ok(ownSentences(row).includes(reason.sentence), `a sentence with no origin is one the shared home wrote: ${at}`);
      // No reason without an origin carries the row's text. The one exception is the Herdr stand-in: this home's
      // own sentence, also where a panel's row holds its bytes as `runtimeError`.
      if (reason.sentence === row.runtimeError) { counts.standIn++; assert.equal(reason.sentence, HERDR_STAND_IN, at); assert.equal(knownOrigin(row.runtimeErrorOrigin), false, at); }
      assert.equal(reasonLine(reason), reason.sentence, `shown as written: ${at}`);
      continue;
    }
    counts.quoted++;
    assert.equal(reason.sentence, row.runtimeError, `a sentence with an origin is the row's own text: ${at}`);
    const speaker = hasRuntimeError(row) && knownOrigin(row.runtimeErrorOrigin) ? row.runtimeErrorOrigin : 'unattributed';
    assert.equal(reason.origin, speaker, at);
    if (reason.origin === 'unattributed') counts.unattributed++;
    // After the shared home every text has a speaker: only a text that is not a string is left unattributed.
    if (settled && typeof reason.sentence === 'string') assert.ok(SPEAKERS.includes(reason.origin), `the shared home names a speaker for every text it lets through: ${at}`);
    // The Desktop shows it filtered: one display line, under its speaker's words only when there is a line to introduce.
    const shown = reasonLine(reason), line = displayLine(reason.sentence);
    assert.equal(shown, speakerLine(reason.origin, reason.sentence), at);
    if (shown !== null) assert.doesNotMatch(shown, CONTROL, at);
    if (line === null || line === DETAIL_WITHHELD) assert.equal(shown, line, `nothing, or withheld alone, never under a speaker's name: ${at}`);
    else assert.equal(shown, [originLead(reason.origin, DESKTOP_TERMS), line].filter(Boolean).join(' '), at);
  }
}

test('over generated rows, a reason without an origin never carries the row\'s text: rowReason, and instanceActs\' unaddressable, held and unsupported-session reasons', () => {
  const counts = { rows: 0, own: 0, quoted: 0, unattributed: 0, standIn: 0 };
  const settled = [...localRows(), ...remoteRows()];
  for (const row of settled) {
    counts.rows++; holds(row, true, counts);
    // A row of the shared home never carries a mark that is not one of the three, and never one beside no text.
    if (Object.hasOwn(row, 'runtimeErrorOrigin')) { assert.ok(SPEAKERS.includes(row.runtimeErrorOrigin), JSON.stringify(row)); assert.ok(hasRuntimeError(row), JSON.stringify(row)); }
  }
  // The same rows with their mark removed or replaced (no path of the shared home leaves them so), and held homes:
  // the contract does not rest on the mark having survived.
  for (const row of settled.filter((_, n) => n % 7 === 0)) {
    const { runtimeErrorOrigin: _mark, ...bare } = row;
    for (const mark of MARKS) { counts.rows++; holds({ ...bare, ...marked(mark) }, false, counts); }
    for (const hold of [{ spawnInProgress: true }, { rollbackIncomplete: true }, { retirePending: true }]) { counts.rows++; holds({ ...row, ...hold }, true, counts); }
  }
  // Every kind of reason was reached, so the loop held something.
  for (const [kind, n] of Object.entries(counts)) assert.ok(n > 100, `${kind}: ${n}`);
});

test('a row of another machine that arrives with its mark removed, or with one that is none of the three, and a hostile text: the shared home decides its speaker, and the Desktop shows it filtered', () => {
  const panelRow = (group) => remotePanel(group, AT).instances[0];
  for (const mark of [undefined, 'someone-else', 'unattributed', 'wipe \x1b[2J', null]) {
    const at = JSON.stringify(mark ?? 'no mark');
    const host = (runtimeError) => kernelRemoteRow('dev-a', { running: null, runtimeError, ...marked(mark) });
    // Reached: the host's text, relayed by this computer's OATS.
    const control = panelRow(kernelRemoteGroup([host('wipe \x1b[2J the screen')]));
    assert.equal(control.runtimeErrorOrigin, 'kernel', at); assert.equal(rowReason(control).origin, 'kernel', at);
    assert.equal(rowReasonLine(rowReason(control)), DETAIL_WITHHELD, `withheld alone, no "OATS says:" in front: ${at}`);
    assert.equal(runtimeErrorLine(control), DETAIL_WITHHELD, at);
    const bidi = panelRow(kernelRemoteGroup([host('safe‮txt.exe was read')]));
    assert.equal(rowReason(bidi).origin, 'kernel', at);
    assert.equal(rowReasonLine(rowReason(bidi)), 'OATS says: safe�txt.exe was read', `the filtered line, with the lead the shared home decided: ${at}`);
    // Not reached, by an error the client wrote while reading the roster: the client's own speaker, the same filter.
    for (const addressable of [true, false]) {
      const down = (message) => panelRow(unavailableGroups([kernelRemoteGroup([kernelRemoteRow('dev-a', { addressable, ...marked(mark) })])], { code: 'E_REMOTE_ROSTER', message })[0]);
      assert.equal(rowReason(down('bell\u0007')).origin, 'roster-read', at);
      assert.equal(rowReasonLine(rowReason(down('bell\u0007'))), DETAIL_WITHHELD, at);
      assert.equal(rowReasonLine(rowReason(down('safe‮txt.exe'))), "Desktop's read of other machines says: safe�txt.exe", at);
      // The actions trigger shows the same reason when the row offers nothing.
      if (!addressable) assert.equal(reasonLine(instanceActs(down('safe‮txt.exe')).blocked), "Desktop's read of other machines says: safe�txt.exe", at);
    }
  }
});

test('"unattributed" is only ever written by rowReason, on a reason: never read from a row or an answer, never on a row, never as a kept failure\'s speaker', () => {
  // A row of another machine that arrives with the word as its mark: the key is set by the table, or deleted.
  const host = (extra) => kernelRemoteRow('dev-a', { runtimeErrorOrigin: 'unattributed', ...extra });
  const reached = remotePanel(kernelRemoteGroup([host({ running: null, runtimeError: 'no session' }), host({ running: true }), host({ running: null, backend: 'herdr' })]), AT).instances;
  assert.deepEqual(reached.map(row => row.runtimeErrorOrigin), ['kernel', undefined, undefined]);
  assert.deepEqual(reached.map(row => Object.hasOwn(row, 'runtimeErrorOrigin')), [true, false, false]);
  const down = remotePanel(unavailableGroups([kernelRemoteGroup([host({})])], { code: 'E_REMOTE_ROSTER', message: 'the read did not answer', runtimeErrorOrigin: 'unattributed' })[0], AT).instances[0];
  assert.equal(down.runtimeErrorOrigin, 'roster-read');
  // The collector's output claiming it: the row's key is what the shared home decided.
  const kernel = [{ instance: 'dev-a', home: '/w/agents/dev/instances/dev-a', agentsRoot: '/w/agents', running: true, tmux: { session: 's', window: 'w' }, runtimeErrorOrigin: 'unattributed' }];
  const [probed] = panelInstances(kernel, livenessAnswers(kernel, JSON.stringify([{ running: null, runtimeState: 'unreachable', runtimeError: 'no server', runtimeErrorOrigin: 'unattributed' }])));
  assert.equal(probed.runtimeErrorOrigin, 'terminal-probe');
  // `panelInstance` and the overview's projection never pass it on a row.
  const row = { instance: 'dev-a', home: '/w/agents/dev/instances/dev-a', agentsRoot: '/w/agents', running: null, runtimeError: 'no session', runtimeErrorOrigin: 'unattributed' };
  assert.equal(Object.hasOwn(panelInstance(row), 'runtimeErrorOrigin'), false);
  const projected = projectActivePanel({ instances: [row], workspace: { id: '/w' } }).instances[0];
  assert.equal(projected.runtimeError, 'no session'); assert.equal(Object.hasOwn(projected, 'runtimeErrorOrigin'), false);
  // On such a row the reason is unattributed because rowReason wrote it, not because the row said so.
  assert.equal(rowReason(projected).origin, 'unattributed'); assert.equal(rowReason({ ...row, runtimeErrorOrigin: 'kernel' }).origin, 'kernel');
  // Never a kept failure's speaker: not written, and not read as one.
  const held = { deployment: { status: 'observed' }, instances: [], generatedAt: AT };
  for (const origin of ['unattributed', 'roster-read']) {
    assert.equal(Object.hasOwn(failedEntry(held, { code: 'E_REMOTE_UNREADABLE', message: 'm', origin }, AT), 'errorOrigin'), false, origin);
    assert.equal(Object.hasOwn(failedEntry({ ...held, error: 'old', errorOrigin: origin }, { code: 'E_REMOTE_UNREADABLE', message: 'm' }, AT), 'errorOrigin'), false, origin);
    assert.deepEqual(keptFailure({ error: 'm', errorOrigin: origin }), { message: 'm', origin: null }, origin);
  }
  // It names nobody.
  assert.equal(originLead('unattributed', DESKTOP_TERMS), null); assert.equal(knownOrigin('unattributed'), false);
  assert.equal(speakerLine('unattributed', 'no session'), 'no session');
});
