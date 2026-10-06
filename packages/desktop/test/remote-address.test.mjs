import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { canAddressRemote, serverLabel, rowReason, remoteHeadline, hostReason, remoteReason, unroutableReason, readingFrom,
  unaddressableSentence, codeLineNodes, kernelCode } from '../renderer/remote-address.mjs';
import { assertIsolatedDetail, MESSY, MESSY_LINE } from './helpers/detail-line.mjs';
import { canAddressRemote as serverCanAddressRemote, admitInstance } from '../server/instance-admission.mjs';

const remote = (extra = {}) => ({ instance: 'dev-a', agent: 'dev', home: '/srv/agents/dev/instances/dev-a', server: 'build',
  repoName: 'Build box', running: true, addressable: true, missingRemotely: false, savedRoute: false, ...extra });

test('canAddressRemote: a local row, or a remote row the kernel reports addressable; never savedRoute', () => {
  assert.equal(canAddressRemote({ instance: 'x', home: '/w/x' }), true);
  assert.equal(canAddressRemote(remote()), true);
  assert.equal(canAddressRemote(remote({ savedRoute: true, addressable: false })), false, 'a saved route does not make a row addressable');
  assert.equal(canAddressRemote(remote({ addressable: undefined })), false, 'absent is not true');
  assert.equal(canAddressRemote(remote({ addressable: 'true' })), false);
  assert.equal(canAddressRemote(null), false);
  assert.equal(serverCanAddressRemote, canAddressRemote, 'the server admits with the same predicate');
});

test('serverLabel: the registration label the roster reports, else the server id', () => {
  assert.equal(serverLabel(remote()), 'Build box');
  assert.equal(serverLabel(remote({ repoName: '' })), 'build');
});

test('rowReason: one function for the meta-line label and the full sentence, keyed by the reason', () => {
  const herdr = rowReason(remote({ running: null, runtimeState: 'unsupported', runtimeError: 'E_HERDR_REMOVED: Herdr is gone.' }));
  assert.deepEqual(herdr, { key: 'herdr', label: 'Herdr no longer supported', sentence: 'E_HERDR_REMOVED: Herdr is gone.' });
  const localHerdr = rowReason({ instance: 'h', home: '/w/h', running: null, sessionTarget: 'x' });
  assert.equal(localHerdr.label, 'Herdr no longer supported', 'a local Herdr row too');
  assert.deepEqual(rowReason(remote({ addressable: false, missingRemotely: true, running: null })), { key: 'missing',
    label: 'gone from Build box',
    sentence: 'dev-a is no longer on Build box. Remove it from this computer with: oats server forget build --instance dev-a' });
  assert.deepEqual(rowReason(remote({ addressable: false })), { key: 'unaddressable', label: 'not reachable on Build box',
    sentence: 'Build box did not report this instance as reachable.' });
  assert.deepEqual(rowReason(remote({ running: null, serverUnreached: true, runtimeError: 'ssh failed: timeout' })),
    { key: 'unreached', label: 'Build box not reached', sentence: 'ssh failed: timeout' });
  assert.deepEqual(rowReason(remote({ running: null })), { key: 'unknown', label: 'state unknown', sentence: 'dev-a: status unknown' });
  assert.equal(rowReason(remote()), null, 'a running addressable row has no reason');
  assert.equal(rowReason(remote({ running: false })), null);
  assert.equal(rowReason({ instance: 'x', home: '/w/x', running: null }).label, 'state unknown');
  // The server not being reached wins over a stale addressable fact from its last good read.
  assert.equal(rowReason(remote({ running: null, serverUnreached: true, addressable: false, missingRemotely: true })).key, 'unreached');
});

test('remoteHeadline: the host-refusal table, with the view\'s own sentence for every other code', () => {
  assert.equal(remoteHeadline('E_REMOTE_INCOMPATIBLE', 'Build box', 'x'), "Build box runs an OATS that can't do this yet.");
  assert.equal(remoteHeadline('E_SNAPSHOT_UNKNOWN', 'Build box', 'x'), "Build box doesn't list this instance any more.");
  for (const code of ['E_HOME_MISMATCH', 'E_AMBIGUOUS']) assert.equal(remoteHeadline(code, 'Build box', 'x'), 'Build box answered for a different instance. Nothing was changed.');
  for (const code of ['E_SSH', 'E_CLI_TIMEOUT']) assert.equal(remoteHeadline(code, 'Build box', 'x'), "Couldn't reach Build box.");
  assert.equal(remoteHeadline('E_REMOTE_ENVELOPE', 'Build box', 'The view says this.'), 'The view says this.', 'a host error, not transport');
  assert.equal(remoteHeadline('E_SESSION_UNKNOWN', 'Build box', 'Gone.'), 'Gone.');
});

test('hostReason / remoteReason: the kernel\'s code and message verbatim, bounded and validated at every hop', () => {
  const reason = hostReason({ code: 'E_REMOTE_INCOMPATIBLE', message: 'build runs 0.30.2: needs readinessApi 2' }, 'Build box', 'fallback');
  assert.deepEqual(reason, { code: 'E_REMOTE_INCOMPATIBLE', message: "Build box runs an OATS that can't do this yet.",
    detail: 'build runs 0.30.2: needs readinessApi 2', remote: true });
  assert.deepEqual(remoteReason(reason), reason, 'a relayed reason survives re-validation unchanged');
  assert.deepEqual(hostReason({ code: 'E_CLI_TIMEOUT' }, 'Build box', 'x'), { code: 'E_CLI_TIMEOUT', message: "Couldn't reach Build box.", detail: null, remote: true });
  assert.equal(hostReason({ code: 'lowercase', message: 'm' }, 'Build box', 'x'), null, 'only kernel-shaped codes');
  assert.equal(hostReason({ code: 'E_X', message: 'token=abc123' }, 'Build box', 'x').detail, '[Detail withheld]');
  assert.equal(hostReason({ code: 'E_X', message: 'line\u0007bell' }, 'Build box', 'x').detail, '[Detail withheld]');
  assert.equal(hostReason({ code: 'E_X', message: 'm'.repeat(5000) }, 'Build box', 'x').detail.length, 2048);
  for (const bad of [null, {}, { ...reason, remote: false }, { ...reason, code: 'bad' }, { ...reason, message: '' },
    { ...reason, extra: 1 }, { ...reason, detail: 3 }]) assert.equal(remoteReason(bad), null);
});

test('hostReason: the detail is one display line; remoteReason accepts a message and a detail only when each already is one', () => {
  const at = cp => String.fromCodePoint(cp), replaced = at(0xFFFD);
  const made = message => hostReason({ code: 'E_GIT_FAILED', message }, 'Build box', 'The view says this.');
  // Production: line breaks fold to a space, characters of the set are replaced, the unsafe is withheld whole.
  assert.equal(made('fatal: bad object HEAD\n\thint: fetch first\n').detail, 'fatal: bad object HEAD hint: fetch first');
  assert.equal(made(`first${at(0x2028)}second${at(0x2029)}third`).detail, 'first second third');
  for (const cp of [0x0085, 0x202A, 0x202E, 0x2066, 0x2069, 0x200B, 0x2060, 0xFEFF, 0xE0041]) assert.equal(made(`work${at(cp)}tree`).detail, `work${replaced}tree`, cp.toString(16));
  for (const unsafe of ['token=abc123', 'https://user:pw@host.example/x', `line one\n${at(0x202E)}password: hunter2`]) assert.equal(made(unsafe).detail, '[Detail withheld]', unsafe);
  assert.equal(made('\n \n').detail, null, 'nothing to show');
  assert.equal(made(`${'m '.repeat(3000)}`).detail.length, 2047, 'bounded after filtering, never ending on a space');
  // Ordinary international names pass both hops unchanged.
  for (const text of ['\u65E5\u672C\u8A9E\u306E\u30D5\u30A1\u30A4\u30EB', '\u0645\u0644\u0641 \u0627\u0644\u0639\u0645\u0644', '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645', '\u{1F469}\u200D\u{1F4BB}']) {
    const reason = made(text);
    assert.equal(reason.detail, text, JSON.stringify(text));
    assert.deepEqual(remoteReason({ ...reason, message: text }), { ...reason, message: text }, JSON.stringify(text));
  }
  // Revalidation: what production made survives unchanged (twice equals once); anything else is refused.
  for (const message of ['fatal: bad object HEAD\n\thint: fetch first\n', `work${at(0x202E)}tree`, 'token=abc123', 'm'.repeat(5000), '\n']) {
    const reason = made(message);
    assert.deepEqual(remoteReason(reason), reason, JSON.stringify(message.slice(0, 40)));
  }
  const good = made('fatal: bad object HEAD');
  for (const bad of ['two\nlines', 'a\tb', `a${at(0x2028)}b`, `a${at(0x2029)}b`, `a${at(0x0085)}b`, `a${at(0x202E)}b`, `a${at(0x2066)}b`, `a${at(0x200B)}b`, `a${at(0xFEFF)}b`,
    `a${at(0xE0041)}b`, ' leading', 'trailing ', 'two  spaces', 'token=abc123', 'm'.repeat(2049), '']) {
    assert.equal(remoteReason({ ...good, detail: bad }), null, `detail ${JSON.stringify(bad.slice(0, 40))}`);
    assert.equal(remoteReason({ ...good, message: bad }), null, `message ${JSON.stringify(bad.slice(0, 40))}`);
  }
  assert.deepEqual(remoteReason({ ...good, message: 'm'.repeat(512), detail: 'm'.repeat(2048) }), { ...good, message: 'm'.repeat(512), detail: 'm'.repeat(2048) });
  assert.equal(remoteReason({ ...good, message: 'm'.repeat(513) }), null, 'the message limit is unchanged');
});

test('a carriage return withholds the whole text, alone or before a line feed; a line feed or a tab alone is formatted: production and revalidation', () => {
  const made = message => hostReason({ code: 'E_GIT_FAILED', message }, 'Build box', 'The view says this.');
  const good = made('fatal: bad object HEAD');
  for (const withheld of ['one\rtwo', 'one\r\ntwo', '\r', 'one\r\n']) {
    assert.equal(made(withheld).detail, '[Detail withheld]', JSON.stringify(withheld));
    assert.deepEqual(remoteReason(made(withheld)), made(withheld), 'the marker is a display line');
    assert.equal(remoteReason({ ...good, detail: withheld }), null, `detail ${JSON.stringify(withheld)}`);
    assert.equal(remoteReason({ ...good, message: withheld }), null, `message ${JSON.stringify(withheld)}`);
  }
  for (const [formatted, line] of [['one\ntwo', 'one two'], ['one\n\ntwo\n', 'one two'], ['one\ttwo', 'one two'], ['\tone\t\ttwo\t', 'one two']]) {
    assert.equal(made(formatted).detail, line, JSON.stringify(formatted));
    assert.deepEqual(remoteReason(made(formatted)), made(formatted));
    assert.equal(remoteReason({ ...good, detail: formatted }), null, 'revalidation formats nothing: it refuses what is not already a line');
    assert.equal(remoteReason({ ...good, message: formatted }), null);
  }
});

test('a server label that is not a display line: the headline shows it as one, and the reason survives revalidation with its Details', () => {
  // A tab, two spaces and a character of the set.
  const label = 'Build\tbox  \u202Eone', shown = 'Build box \uFFFDone';
  const detail = 'ssh: connect to host build-host port 22: Connection refused';
  const reason = hostReason({ code: 'E_SSH', message: detail }, label, 'The view says this.');
  assert.deepEqual(reason, { code: 'E_SSH', message: `Couldn't reach ${shown}.`, detail, remote: true });
  assert.deepEqual(remoteReason(reason), reason, 'kept, with its Details');
  for (const code of ['E_REMOTE_INCOMPATIBLE', 'E_SNAPSHOT_UNKNOWN', 'E_HOME_MISMATCH', 'E_AMBIGUOUS', 'E_SSH', 'E_CLI_TIMEOUT']) {
    const made = hostReason({ code, message: detail }, label, 'The view says this.');
    assert.ok(made.message.includes(shown), code); assert.deepEqual(remoteReason(made), made, code);
  }
  assert.equal(unroutableReason(label).message, `This computer's OATS can't route this to ${shown}. Update OATS here.`);
  assert.deepEqual(remoteReason(unroutableReason(label)), unroutableReason(label));
  // The sentences an unaddressable row's refusal carries; the command keeps the server id as it is.
  const row = remote({ repoName: label, addressable: false });
  for (const sentence of [unaddressableSentence(row), unaddressableSentence({ ...row, addressable: undefined }), unaddressableSentence({ ...row, missingRemotely: true })]) {
    const refusal = { code: 'E_SNAPSHOT_UNKNOWN', message: sentence, detail: null, remote: true };
    assert.ok(sentence.includes(shown), sentence); assert.deepEqual(remoteReason(refusal), refusal);
  }
  assert.equal(unaddressableSentence({ ...row, missingRemotely: true }), `dev-a is no longer on ${shown}. Remove it from this computer with: oats server forget build --instance dev-a`);
  // Display only: the label a row is routed and compared by is the one the roster reports.
  assert.equal(serverLabel(row), label);
});

test('a server label with nothing to show, or a withheld one, reads "the server": a headline is always a sentence', () => {
  for (const none of ['', ' \n\t ', null, undefined, 'token=abc123']) {
    const name = JSON.stringify(none);
    assert.equal(remoteHeadline('E_SSH', none, 'fallback'), "Couldn't reach the server.", name);
    assert.equal(remoteHeadline('E_SNAPSHOT_UNKNOWN', none, 'fallback'), "The server doesn't list this instance any more.", name);
    assert.equal(remoteHeadline('E_REMOTE_INCOMPATIBLE', none, 'fallback'), "The server runs an OATS that can't do this yet.", name);
    assert.equal(unroutableReason(none).message, "This computer's OATS can't route this to the server. Update OATS here.", name);
    const reason = hostReason({ code: 'E_SSH', message: 'ssh failed' }, none, 'fallback');
    assert.deepEqual(remoteReason(reason), reason, name);
  }
  assert.equal(unaddressableSentence({ instance: 'dev-a', server: 'build', repoName: ' \n ', addressable: false }), 'The server did not report this instance as reachable.');
});

test('codeLineNodes: the code and the colon are text; the detail is alone in its <bdi>, as text', t => {
  const dom = new JSDOM('<!doctype html><p></p>'), doc = dom.window.document, line = doc.querySelector('p');
  t.after(() => dom.window.close());
  const show = reason => { line.replaceChildren(...codeLineNodes(doc, reason)); return line; };
  assertIsolatedDetail(show(hostReason({ code: 'E_GIT_FAILED', message: MESSY }, 'Build box', 'fallback')), { before: 'E_GIT_FAILED: ', detail: MESSY_LINE });
  // Markup in a detail is text.
  const markup = '<b>bold</b> <img src=x> &amp;';
  assertIsolatedDetail(show({ code: 'E_GIT_FAILED', detail: markup }), { before: 'E_GIT_FAILED: ', detail: markup });
  assert.equal(line.querySelector('b, img'), null);
  assertIsolatedDetail(show({ code: 'E_GIT_FAILED', detail: '[Detail withheld]' }), { before: 'E_GIT_FAILED: ', detail: '[Detail withheld]' });
  // No detail, or one that is not already a display line: the code alone, no <bdi>.
  for (const detail of [null, undefined, '', 3, 'two\nlines', 'a\tb', 'two  spaces', ' leading', `a${String.fromCodePoint(0x202E)}b`, 'token=abc123', 'm'.repeat(2049)]) {
    assert.equal(show({ code: 'E_GIT_FAILED', detail }).textContent, 'E_GIT_FAILED', JSON.stringify(String(detail).slice(0, 20)));
    assert.equal(line.querySelector('bdi'), null);
  }
  // A view's own code (not a kernel one) is still its Details line; no code, no line.
  assert.equal(show({ code: 'cli-unavailable' }).textContent, 'cli-unavailable');
  for (const none of [null, undefined, {}, { code: '' }, { code: 3, detail: 'kept out' }, { detail: 'kept out' }]) assert.deepEqual(codeLineNodes(doc, none), []);
});

test('kernelCode: the shape of a kernel code, nothing else', () => {
  for (const code of ['E_SSH', 'E_GIT_FAILED', 'E_A1_B', `E_${'A'.repeat(64)}`]) assert.equal(kernelCode(code), true, code);
  for (const code of ['', 'E_', 'e_ssh', 'cli-unavailable', 'unsupported-remote-operation', 'E_SSH ', 'E_SSH\n', `E_${'A'.repeat(65)}`, 3, null, undefined]) assert.equal(kernelCode(code), false, String(code));
});

test('unroutableReason: this machine cannot route the operation (no remote entry)', () => {
  assert.deepEqual(unroutableReason('Build box'), { code: 'unsupported-remote-operation',
    message: "This computer's OATS can't route this to Build box. Update OATS here.", detail: null, remote: true });
  assert.deepEqual(remoteReason(unroutableReason('Build box')), unroutableReason('Build box'));
});

test('readingFrom: the in-flight text of a remote read', () => {
  assert.equal(readingFrom('Build box'), 'Reading from Build box…');
});

const agentsRoot = '/srv/agents';
const row = (extra = {}) => ({ instance: 'dev-a', agent: 'dev', agentsRoot, home: `${agentsRoot}/dev/instances/dev-a`, server: 'build',
  addressable: true, missingRemotely: false, savedRoute: false, running: true, ...extra });
const remoteWs = { id: 'remote:build:3f2a', name: 'Build box', scope: '/srv', remote: true, server: 'build' };
const probe = { ok: true, bin: '/usr/local/bin/oats', remote: ['readiness', 'instance-events', 'instance-git', 'lifecycle-plans'] };
const sel = (extra = {}) => ({ instance: 'dev-a', agent: 'dev', agentsRoot, server: 'build', ...extra });
const admit = (selector, context = {}) => admitInstance(selector, { workspace: remoteWs, instances: [row()], cli: probe,
  operation: 'readiness', localCwd: '/Users/me/work', ...context });

test('admission: a local row keeps the workspace as its context', () => {
  const ws = { id: '/w', name: 'w', scope: '/w' };
  const local = { instance: 'x', agent: 'dev', agentsRoot: '/w/agents', home: '/w/agents/dev/instances/x' };
  const admitted = admitInstance({ instance: 'x', agent: 'dev', agentsRoot: '/w/agents' }, { workspace: ws, instances: [local], cli: probe });
  assert.deepEqual(admitted, { target: { workspace: '/w', instance: 'x', agent: 'dev', agentsRoot: '/w/agents', home: local.home, server: null },
    context: '/w', bin: probe.bin });
});

test('admission: an addressable remote row is admitted by its server and home, run from this machine\'s cwd', () => {
  assert.deepEqual(admit(sel()), { target: { workspace: remoteWs.id, instance: 'dev-a', agent: 'dev', agentsRoot, home: row().home, server: 'build' },
    context: '/Users/me/work', bin: probe.bin, remote: { server: 'build', label: 'Build box' } });
  // Two same-named instances under different souls: each is admitted by its own home.
  const twins = [row(), row({ agent: 'qa', home: `${agentsRoot}/qa/instances/dev-a` })];
  assert.equal(admit(sel({ agent: 'qa' }), { instances: twins }).target.home, `${agentsRoot}/qa/instances/dev-a`);
  assert.equal(admit(sel(), { instances: twins }).target.home, row().home);
  // Opening is disabled for an unknown runtime, but reads and plans still go: the host tells the truth.
  assert.equal(admit(sel(), { instances: [row({ running: null })] }).target.home, row().home);
});

test('admission: a remote row the kernel does not report addressable is refused with its reason', () => {
  const missing = admit(sel(), { instances: [row({ addressable: false, missingRemotely: true })] });
  assert.equal(missing.code, 'E_SNAPSHOT_UNKNOWN');
  assert.equal(missing.reason.message, 'dev-a is no longer on Build box. Remove it from this computer with: oats server forget build --instance dev-a');
  const other = admit(sel(), { instances: [row({ addressable: null })] });
  assert.equal(other.reason.message, 'Build box did not report this instance as reachable.');
  assert.equal(admit(sel(), { instances: [row({ addressable: false, savedRoute: true })] }).code, 'E_SNAPSHOT_UNKNOWN', 'a saved route does not override a 0.31 kernel\'s answer');
});

test('admission: no remote entry on this machine for the operation refuses before anything is sent', () => {
  for (const cli of [{ ...probe, remote: ['session'] }, { ...probe, remote: undefined }]) {
    const refused = admit(sel(), { cli });
    assert.equal(refused.code, 'unsupported-remote-operation');
    assert.equal(refused.reason.message, "This computer's OATS can't route this to Build box. Update OATS here.");
  }
  assert.equal(admit(sel(), { operation: undefined }).code, 'unsupported-remote-operation', 'an operation that never named its entry is not routed');
});

test('admission: a server/home mismatch, another group, or a local/remote crossing never resolves', () => {
  assert.equal(admit(sel({ server: 'other' })).code, 'E_SESSION_UNKNOWN', 'another server id');
  assert.equal(admit(sel({ server: null })).code, 'E_SESSION_UNKNOWN', 'a local selector in a remote workspace');
  assert.equal(admit(sel(), { instances: [row({ home: '/elsewhere/dev-b' })] }).code, 'E_HOME_MISMATCH');
  // The same server id, another group (route target): that group's rows are not this workspace's.
  const otherGroup = { ...remoteWs, id: 'remote:build:9c1d' };
  assert.equal(admit(sel(), { workspace: otherGroup, instances: [] }).code, 'E_SESSION_UNKNOWN');
  // A remote row in a local workspace's panel, and a remote workspace naming another server.
  const localWs = { id: '/w', name: 'w', scope: '/w' };
  assert.equal(admit(sel(), { workspace: localWs }).code, 'E_SESSION_UNKNOWN');
  assert.equal(admit(sel(), { workspace: { ...remoteWs, server: 'other' } }).code, 'E_SESSION_UNKNOWN');
  assert.equal(admit(sel(), { localCwd: 'relative' }).code, 'E_WORKSPACE_UNKNOWN');
});

test('a local OATS before 0.31 reports no addressable fact: a saved-route row keeps working as before, and a row without one says why accurately', () => {
  const older = remote({ addressable: undefined });
  assert.equal(canAddressRemote({ ...older, savedRoute: true }), true, 'spawned from here: routed by its saved route, as before 0.31');
  assert.equal(canAddressRemote({ ...older, savedRoute: false }), false);
  assert.equal(canAddressRemote(remote({ addressable: false, savedRoute: true })), false, 'a 0.31 kernel\'s explicit answer wins over the saved route');
  assert.equal(canAddressRemote(remote({ addressable: null, savedRoute: true })), false, 'only an absent fact falls back');
  assert.equal(rowReason({ ...older, savedRoute: false }).sentence,
    "This computer's OATS does not report whether Build box can reach this instance. Update OATS here.");
});

test('incompatibleSentence, relayedFailure, remoteInspectBlock (#675): the panel reads of a remote instance', async () => {
  const { incompatibleSentence, relayedFailure, remoteInspectBlock } = await import('../renderer/remote-address.mjs');
  assert.equal(incompatibleSentence('Build box', 'soul'),
    "Build box runs an OATS that can't show this instance's soul here (it needs the operations feature). Update OATS on Build box.");
  assert.equal(incompatibleSentence('', 'teams'),
    "The server runs an OATS that can't show this instance's teams here (it needs the operations feature). Update OATS on the server.");
  const plain = new Error('bridge down');
  assert.equal(relayedFailure(plain, 'Build box', 'soul'), plain, 'no relayed reason: the error as it came');
  const reason = { code: 'E_REMOTE_INCOMPATIBLE', message: "Build box runs an OATS that can't do this yet.", detail: 'needs operations', remote: true };
  const shown = relayedFailure(Object.assign(new Error('raw'), { reason }), 'Build box', 'soul');
  assert.deepEqual([shown.message, shown.code, shown.detail], [incompatibleSentence('Build box', 'soul'), 'E_REMOTE_INCOMPATIBLE', 'needs operations']);
  assert.equal(relayedFailure(Object.assign(new Error('raw'), { reason }), 'Build box').message, reason.message, 'without `what`: the relayed headline');
  const ssh = relayedFailure(Object.assign(new Error('raw'), { reason: { code: 'E_SSH', message: "Couldn't reach Build box.", detail: null, remote: true } }), 'Build box', 'soul');
  assert.deepEqual([ssh.message, ssh.code, ssh.detail], ["Couldn't reach Build box.", 'E_SSH', null]);
  const cli = { remote: ['operations'] };
  assert.equal(remoteInspectBlock({ instance: 'x', home: '/w/x' }, {}), null, 'a local row is never blocked');
  assert.equal(remoteInspectBlock(remote(), cli), null);
  assert.equal(remoteInspectBlock(remote({ addressable: false }), cli).message, 'Build box did not report this instance as reachable.');
  const unroutable = remoteInspectBlock(remote(), { remote: ['roster'] });
  assert.deepEqual([unroutable.message, unroutable.code], [unroutableReason('Build box').message, 'unsupported-remote-operation']);
});
