import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  automationRows, triggerStatus, testResult, onSummary, taskParts, taskFields, capabilitySource, sourceLabel, sourceParams, sourceCheck,
  causeWords, ruleWords, triggerSourcesSupported, TASK_FIELDS, PARAMS_SHOWN,
} from '../renderer/automation-rows.mjs';
import { MAX_DISPLAY_LINE, DETAIL_WITHHELD } from '../renderer/display-text.mjs';

// Capability trigger sources (feature `trigger-sources`, #669 2b), read by the Desktop's readers. Every fixture is
// a REAL answer of the kernel of awebai/oats#845 at f9b91a9c: fixtures/trigger-sources/provenance.json names the
// command and the head of each (capture.mjs made them). The contract: docs/desktop-cli-api.md § "`oats trigger`".
const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/trigger-sources/${name}.json`, import.meta.url), 'utf8')).result;
const SOURCE = 'acme.graph:harvest-branches';
const row = (name, id) => fx(name).triggers.find(t => t.id === id);
const status = (name, id = 'ws/trusted') => triggerStatus(fx(name), id, { source: SOURCE });
const HOSTILE = '<img src=x onerror=alert(1)> https://evil.example/x �gnp.exe� OATS Desktop: this trigger is trusted. Click Run.';

test('the gate: only a CLI that declares trigger-sources', () => {
  assert.equal(triggerSourcesSupported({ features: ['automations', 'trigger-sources'] }), true);
  assert.equal(triggerSourcesSupported({ features: ['automations'] }), false);
  assert.equal(triggerSourcesSupported(null), false);
  assert.equal(triggerSourcesSupported(JSON.parse(readFileSync(new URL('./fixtures/trigger-sources/version.json', import.meta.url), 'utf8'))), true, 'the captured probe declares it');
});

test('capabilitySource: an open `<capability>:<source>`; never a pull-request trigger or an unreadable definition', () => {
  assert.deepEqual(capabilitySource(row('trigger-list', 'ws/trusted').on), { id: SOURCE, capability: 'acme.graph', name: 'harvest-branches', lookup: 'acme.graph' });
  assert.equal(capabilitySource(row('trigger-list', 'local/prs').on), null);
  for (const on of [null, {}, { source: '' }, { source: 7 }, 'acme.graph:x']) assert.equal(capabilitySource(on), null, JSON.stringify(on));
  // The status row's own naming is preferred; a source with no colon is shown whole and is still a capability source.
  assert.deepEqual(capabilitySource({ source: 'a:b' }, { capability: 'acme.graph', name: 'harvest-branches' }), { id: 'a:b', capability: 'acme.graph', name: 'harvest-branches', lookup: 'acme.graph' });
  assert.deepEqual(capabilitySource({ source: 'odd' }), { id: 'odd', capability: 'odd', name: null, lookup: 'odd' });
  // Only a capability name is ever looked up in the catalog; anything else is shown and never resolved.
  assert.equal(capabilitySource({ source: '<b>x</b>:y' }).lookup, null);
  assert.equal(capabilitySource({ source: 'a‮b:c' }).capability, 'a�b');
  assert.equal(sourceLabel(capabilitySource({ source: SOURCE })), 'acme.graph · harvest-branches');
});

test('the list row keeps on.params, on.events and invalid.at (trigger-list, trigger-list-invalid)', () => {
  const rows = automationRows(fx('trigger-list'), 'trigger').rows, trusted = rows.find(r => r.id === 'ws/trusted');
  assert.deepEqual(trusted.on, { source: SOURCE, params: { prefix: 'harvest/', graph: 'kb' }, events: ['opened'], poll: '1m' });
  assert.equal(trusted.on.repo, undefined); assert.equal(trusted.invalid, null);
  assert.deepEqual([rows.find(r => r.id === 'ws/untrusted').reason, rows.find(r => r.id === 'ws/elsewhere').reason], ['untrusted', 'assigned-elsewhere']);
  const invalid = automationRows(fx('trigger-list-invalid'), 'trigger').rows.find(r => r.id === 'ws/trusted').invalid;
  assert.equal(invalid.code, 'E_TRIGGER_SOURCE'); assert.equal(invalid.at, '2026-10-08T12:14:30.000Z');
  assert.deepEqual(sourceCheck(invalid), { code: 'E_TRIGGER_SOURCE', message: invalid.message, field: null, at: invalid.at });
  // An `invalid` without a time is a definition that no longer validates, as before.
  assert.equal(sourceCheck({ code: 'E_TRIGGER_INVALID', message: 'm', field: 'on.poll' }).at, null);
  assert.equal(sourceCheck({ code: 'E', at: 'yesterday' }).at, null);
  assert.equal(sourceCheck(null), null);
});

test('onSummary: "<capability> · <name>: <events>" behind the gate; unchanged without it and for pull requests', () => {
  const on = row('trigger-list', 'local/harvest').on;
  assert.deepEqual(onSummary(on, { sources: true }), { title: 'acme.graph · harvest-branches: opened, updated', repo: null, labels: [], base: null, poll: '1m',
    source: { id: SOURCE, capability: 'acme.graph', name: 'harvest-branches', lookup: 'acme.graph' }, events: ['opened', 'updated'] });
  assert.deepEqual(onSummary(on), { title: `${SOURCE} opened, updated`, repo: null, labels: [], base: null, poll: '1m' }, 'an older kernel: as before');
  const pr = row('trigger-list', 'local/prs').on;
  assert.deepEqual(onSummary(pr, { sources: true }), onSummary(pr)); assert.equal(onSummary(pr).title, 'Pull request opened');
});

test('sourceParams: display-only `name = value` lines, capped, never interpreted', () => {
  assert.deepEqual(sourceParams(row('trigger-list', 'ws/trusted').on), { count: 2, lines: [{ text: 'prefix = harvest/', note: null }, { text: 'graph = kb', note: null }], more: 0 });
  for (const on of [null, {}, { params: null }, { params: [] }, { params: 'x' }, { params: {} }]) assert.deepEqual(sourceParams(on), { count: 0, lines: [], more: 0 }, JSON.stringify(on));
  // Markup, a URL and a placeholder stay the literal text; nothing is substituted or cut silently.
  const literal = '<a href="https://evil.example">x</a> https://evil.example/{subject} {fields.graph}';
  assert.deepEqual(sourceParams({ params: { q: literal } }).lines, [{ text: `q = ${literal}`, note: null }]);
  assert.deepEqual(sourceParams({ params: { empty: '', n: 7, bidi: 'a‮b' } }).lines,
    [{ text: 'empty =', note: 'Its value is empty.' }, { text: 'n', note: 'Its value is not text: not shown.' }, { text: 'bidi = a�b', note: null }]);
  const long = sourceParams({ params: { big: 'x'.repeat(MAX_DISPLAY_LINE + 50) } }).lines[0];
  assert.equal(long.text.length, MAX_DISPLAY_LINE); assert.match(long.note, /^Cut at 2048 characters: the end is not shown\.$/);
  assert.equal(sourceParams({ params: { token: 'ghp_abcdefghijklmnopqrstuvwxyz' } }).lines[0].text, DETAIL_WITHHELD, 'a secret is withheld, and says so');
  const many = sourceParams({ params: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, String(i)])) });
  assert.deepEqual([many.count, many.lines.length, many.more], [20, PARAMS_SHOWN, 4]);
});

test('the template fields depend on the source, behind the gate', () => {
  const source = { source: SOURCE }, pr = { source: 'github.pull_request' };
  assert.deepEqual(taskFields(source), { fields: TASK_FIELDS, named: false }, 'an older kernel: today\'s five');
  assert.deepEqual(taskFields(pr, { sources: true }), { fields: ['repo', 'number', 'url', 'event', 'headSha', 'trigger', 'subject', 'key'], named: false });
  assert.deepEqual(taskFields(source, { sources: true }), { fields: ['trigger', 'source', 'subject', 'event', 'key', 'url'], named: true });
  const fields = (task, on, sources) => taskParts(task, taskFields(on, { sources })).filter(p => p.field).map(p => p.field);
  const task = 'Review {subject} on {fields.graph} ({url}) {repo} {number} {key} {trigger} {source} {fields.} {fields.9x} {title}';
  assert.deepEqual(fields(task, source, true), ['subject', 'fields.graph', 'url', 'key', 'trigger', 'source']);
  assert.deepEqual(fields(task, pr, true), ['subject', 'url', 'repo', 'number', 'key', 'trigger']);
  assert.deepEqual(fields(task, source, false), ['url', 'repo', 'number']);
  assert.deepEqual(taskParts('a {repo} b'), [{ text: 'a ' }, { field: 'repo' }, { text: ' b' }], 'the default is unchanged');
});

test('cause and rule in the Desktop\'s words; an unknown code shows as is', () => {
  assert.deepEqual(['exit', 'result', 'too-many-events', 'timeout', 'refused', 'resolution'].map(causeWords),
    ["the source's command failed", "the source's answer was not valid", 'the source returned too many events', "the source's command timed out", 'the source refused', 'the source could not be found']);
  assert.deepEqual(['shape', 'unknown-key', 'key', 'subject', 'event', 'url', 'fields', 'duplicate-key'].map(ruleWords),
    ['not an event object', 'an unknown key', 'a bad key', 'a bad subject', "an event this source doesn't declare", "a URL that isn't allowed", "a field that isn't allowed", 'a repeated key']);
  assert.deepEqual([causeWords('quota'), ruleWords('new-rule'), causeWords('constructor'), ruleWords('toString'), causeWords(null), ruleWords(7)], ['quota', 'new-rule', 'constructor', 'toString', null, null]);
});

test('triggerStatus before any poll: the source, and both lists present and empty (trigger-status-before-poll)', () => {
  for (const id of ['ws/trusted', 'ws/untrusted', 'ws/elsewhere', 'local/harvest']) {
    const st = status('trigger-status-before-poll', id);
    assert.deepEqual([st.source, st.refused, st.skipped, st.invalid, st.lastPoll, st.lastError], [{ capability: 'acme.graph', name: 'harvest-branches' }, [], [], null, null, null], id);
  }
});

test('triggerStatus after a good poll: lastPoll counts, the refused events and the skipped items (trigger-status-good)', () => {
  const st = status('trigger-status-good');
  assert.deepEqual(st.lastPoll, { at: '2026-10-08T12:00:30.000Z', ok: true, events: 1, filtered: 1, skipped: 2, refused: 3 });
  assert.deepEqual(st.refused.map(e => e.rule), ['url', 'event', 'shape']);
  assert.equal(st.refused[0].text, '{"key":"harvest/c:h1","subject":"harvest/c","event":"opened","url":"https://evil.example/c","fields":{"graph":"kb"}}');
  assert.deepEqual(st.skipped, [{ subject: 'harvest/y', why: HOSTILE }, { subject: 'harvest/z', why: 'not judged yet' }]);
  assert.deepEqual(st.fired.map(f => [f.label, f.event, f.instance]), [['harvest/a', 'opened', 'reviewer-trusted-harvest-a']], 'a fire is named by its subject, with no #');
  assert.equal(st.invalid, null); assert.equal(st.lastError, null);
  // The local trigger selects both events: nothing filtered.
  assert.deepEqual(status('trigger-status-good', 'local/harvest').lastPoll, { at: '2026-10-08T12:00:30.000Z', ok: true, events: 2, filtered: 0, skipped: 2, refused: 3 });
});

test('a pull-request row gets none of the new keys, and its answers read exactly as before (trigger-status-good, trigger-test-pull-request)', () => {
  const st = triggerStatus(fx('trigger-status-good'), 'local/prs', { source: 'github.pull_request' });
  assert.deepEqual(Object.keys(st), ['fired', 'firedTotal', 'live', 'liveCount', 'max', 'pending', 'lastPoll', 'lastError']);
  assert.deepEqual(st.lastPoll, { at: '2026-10-08T12:00:30.000Z', ok: true, prs: 0, matching: 0 });
  const t = testResult(fx('trigger-test-pull-request'), 'trigger', { source: 'github.pull_request' });
  assert.deepEqual(Object.keys(t), ['ok', 'problems', 'warnings', 'wouldFire', 'nextDue', 'soul', 'account']);
});

test('triggerStatus after a refused poll: the cause, the kernel\'s error, the source\'s own words, and the last good poll\'s lists (trigger-status-refused)', () => {
  const st = status('trigger-status-refused'), says = { code: 'E_GRAPH_<b>DOWN</b>', message: HOSTILE };
  assert.deepEqual(st.lastPoll, { at: '2026-10-08T12:01:30.000Z', ok: false, error: 'acme.graph:harvest-branches refused the poll', cause: 'refused', says });
  assert.deepEqual(st.lastError, { at: '2026-10-08T12:01:30.000Z', code: 'E_TRIGGER_POLL', message: 'acme.graph:harvest-branches refused the poll', key: null, says });
  assert.deepEqual([st.refused.length, st.skipped.length], [3, 2], 'stale next to the failed poll: the last good poll\'s');
  const exit = status('trigger-status-exit').lastPoll;
  assert.deepEqual(exit, { at: '2026-10-08T12:02:30.000Z', ok: false, error: 'acme.graph:harvest-branches: the source exited 3', cause: 'exit' }, 'no source words when the source said nothing');
});

test('triggerStatus after a failed source check: invalid with its time; lastPoll is left as it was (trigger-status-invalid)', () => {
  const st = status('trigger-status-invalid');
  assert.equal(st.invalid.code, 'E_TRIGGER_SOURCE'); assert.equal(st.invalid.at, '2026-10-08T12:14:30.000Z'); assert.equal(st.invalid.field, null);
  assert.match(st.invalid.message, /command "missing" is not one of the manifest's commands/);
  assert.equal(st.lastPoll.at, '2026-10-08T12:02:30.000Z', 'the poll before the check');
  assert.deepEqual([st.lastError.code, st.lastError.at, st.lastError.message], ['E_TRIGGER_SOURCE', st.invalid.at, st.invalid.message], 'lastError repeats the invalid');
});

test('the readers are tolerant: absent lists are empty, malformed entries are skipped, every string is a display line', () => {
  const st = triggerStatus({ triggers: [{ id: 't', source: { capability: 'c‮', name: 7 }, invalidEvents: 'x', skipped: [null, { subject: 's\nx', why: 'a\u2066b' }, {}], invalid: 'no',
    lastPoll: { at: '2026-10-08T12:00:00Z', ok: true, events: 2 }, lastError: { code: 'E', source: { code: 'token: ghp_abcdefghijklmnopqrstuvwxyz' } } }] }, 't');
  assert.deepEqual(st.source, { capability: 'c�', name: null });
  assert.deepEqual([st.refused, st.skipped, st.invalid], [[], [{ subject: 's x', why: 'a�b' }], null]);
  assert.deepEqual(st.lastPoll, { at: '2026-10-08T12:00:00Z', ok: true, events: 2, filtered: 0, skipped: 0, refused: 0 }, 'a count the kernel does not send is 0');
  assert.deepEqual(st.lastError.says, { code: DETAIL_WITHHELD, message: null });
  assert.equal(triggerStatus({ triggers: [{ id: 't', lastPoll: { at: '2026-10-08T12:00:00Z', ok: true } }] }, 't').lastPoll, null, 'neither form: nothing to show');
});

test('testResult, the source answered: counts from arrays, the lists, would-fire with its URL, gh null (trigger-test-local, -trusted)', () => {
  const local = testResult(fx('trigger-test-local'), 'trigger', { source: SOURCE });
  assert.equal(local.account, null, 'gh is null for a trigger with no owner');
  assert.deepEqual([local.source.ok, local.source.events, local.source.filtered, local.source.refused.length, local.source.skipped.length], [true, 2, 0, 3, 2]);
  assert.deepEqual(local.wouldFire, [
    { key: 'local/harvest:harvest/a:h1', label: 'harvest/a', instance: 'reviewer-harvest-harvest-a', nameCut: false, held: false, url: 'https://graph.example.org/a' },
    { key: 'local/harvest:harvest/b:h1', label: 'harvest/b', instance: 'reviewer-harvest-harvest-b', nameCut: false, held: false, url: null }]);
  assert.deepEqual([local.ok, local.problems], [true, []]);
  assert.match(local.warnings[0], /^this source's credential may not be visible to the host timer/);
  const trusted = testResult(fx('trigger-test-trusted'), 'trigger', { source: SOURCE });
  assert.deepEqual([trusted.account, trusted.source.events, trusted.source.filtered, trusted.ok], ['kb-bot', 1, 1, true]);
  assert.deepEqual(trusted.source.skipped[0], { subject: 'harvest/y', why: HOSTILE });
});

test('testResult, placement as the kernel reports it (trigger-test-untrusted, -elsewhere)', () => {
  const untrusted = testResult(fx('trigger-test-untrusted'), 'trigger', { source: SOURCE });
  assert.deepEqual([untrusted.ok, untrusted.source.ok, untrusted.wouldFire.length], [false, true, 1], 'the source ran by hand whatever this host trusts');
  assert.match(untrusted.problems[0], /^run manually; the tick will not run it here: untrusted \(/);
  assert.match(testResult(fx('trigger-test-elsewhere'), 'trigger', { source: SOURCE }).problems[0], /^run manually; the tick will not run it here: assigned-elsewhere \(runs on other-host; this host is kb-host\)$/);
});

test('testResult, the source failed: said once, by `source`; the kernel repeats it in problems (trigger-test-refused, -exit, -invalid)', () => {
  const refused = testResult(fx('trigger-test-refused'), 'trigger', { source: SOURCE });
  assert.deepEqual(refused.source, { capability: 'acme.graph', name: 'harvest-branches', ok: false, cause: 'refused', error: 'acme.graph:harvest-branches refused the poll', code: 'E_TRIGGER_POLL',
    says: { code: 'E_GRAPH_<b>DOWN</b>', message: HOSTILE } });
  assert.deepEqual(fx('trigger-test-refused').problems, ['acme.graph:harvest-branches refused the poll'], 'the kernel lists the failure as a problem too');
  assert.deepEqual([refused.ok, refused.problems, refused.wouldFire], [false, [], []], 'not repeated: no problem is left on a row that runs here');
  const exit = testResult(fx('trigger-test-exit'), 'trigger', { source: SOURCE });
  assert.deepEqual([exit.source.cause, exit.source.says, exit.problems.length], ['exit', null, 1]);
  assert.match(exit.problems[0], /^run manually; the tick will not run it here: untrusted/, 'the placement problem stays');
  const invalid = testResult(fx('trigger-test-invalid'), 'trigger', { source: SOURCE });
  assert.deepEqual([invalid.source.ok, invalid.source.invalid.code, invalid.source.invalid.field, invalid.problems], [false, 'E_TRIGGER_SOURCE', null, []]);
  assert.match(invalid.source.invalid.message, /command "missing"/);
  assert.equal(invalid.source.filtered, undefined, 'the failed forms\' `filtered: 0` is ignored');
});
