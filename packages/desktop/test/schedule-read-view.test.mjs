import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSchedulesView } from '../renderer/views/schedules.mjs';
import { setWorkspace } from '../renderer/views/common.mjs';
import { scheduleReadData } from '../renderer/schedule-read-data.mjs';
import { cli as fixtureCli, entry, data, run, deferred, tick } from './helpers/schedule-read-fixture.mjs';
function setup({ read, mutate, roster, jobs, initialCli = fixtureCli } = {}) {
  const dom = new JSDOM('<body><aside id="outside" tabindex="0"></aside><main></main></body>', { pretendToBeVisual: true });
  const doc = dom.window.document, el = doc.querySelector('main'), calls = [], cliListeners = new Set(), connections = new Set();
  let cli = structuredClone(initialCli), connection = 1;
  setWorkspace('ws');
  function response(ws, input, rows = jobs ?? [entry({ agent: `dev-${ws}` })]) {
    const scope = `/inert/${ws}`;
    const normalized = rows.map(s => ({ ...s, scope }));
    const raw = input.action === 'show' ? { schedule: normalized.find(s => s.id === input.id) } : { ...data(normalized), scope };
    return { scheduleReadViewApi: 1, status: 'available', workspace: ws, scope, reason: null, data: scheduleReadData(raw, scope, input) };
  }
  const ctx = { connectionGeneration: () => connection, subscribeConnections: cb => { connections.add(cb); return () => connections.delete(cb); }, api: async (path, opts) => {
    const url = new URL(path, 'http://inert'), ws = url.searchParams.get('ws'), body = opts?.body ? JSON.parse(opts.body) : null; calls.push({ path: url.pathname, ws, body, method: opts?.method });
    if (url.pathname === '/api/workspace-schedules') return read ? read(ws, body, () => response(ws, body)) : response(ws, body);
    if (url.pathname === '/api/schedules') return mutate ? mutate(ws, body) : { run: { outcome: 'ended' } };
    if (url.pathname === '/api/agents') return roster ? roster(ws) : { agents: [{ name: `dev-${ws}`, agentsRoot: '/inert/ws/agents', repo: '/inert/ws', work: 'worktree' }] };
    if (url.pathname === '/api/panel') return { instances: [{ instance: 'dev-1', home: '/inert/ws/agents/dev/instances/dev-1' }] };
    assert.fail(path);
  } };
  const view = createSchedulesView(el, ctx, { cli: () => cli, subscribeCli: cb => { cliListeners.add(cb); return () => cliListeners.delete(cb); } });
  return { dom, doc, el, calls, view, response, writes: () => calls.filter(c => c.path === '/api/schedules'),
    setCli(value, notify = true) { cli = value; if (notify) for (const cb of cliListeners) cb(); },
    reconnect() { connection++; for (const cb of connections) cb(); },
    cleanup() { view.dispose(); dom.window.close(); } };
}
const button = (s, label) => [...s.el.querySelectorAll('button')].find(b => b.textContent === label);
const submit = s => s.el.querySelector('form').dispatchEvent(new s.dom.window.Event('submit', { cancelable: true }));
test('one view-entry POST, explicit refresh, no automatic command/timer or transcript/session authority', async () => {
  const s = setup();
  try {
    await tick(); assert.equal(s.calls.length, 1); assert.equal(s.calls[0].path, '/api/workspace-schedules'); assert.deepEqual(s.calls[0].body, { action: 'list' });
    assert.equal(s.el.querySelectorAll('table tbody tr').length, 1); assert.equal(s.el.querySelectorAll('.schedule-run').length, 1);
    assert.match(s.el.textContent, /Run ended/); assert.match(s.el.textContent, /provenance, not a transcript/);
    assert.doesNotMatch(s.el.querySelector('.schedule-run').textContent, /Full draft|success/);
    assert.equal(s.el.querySelector('.schedule-run a'), null); assert.equal(s.el.querySelector('.schedule-run button'), null);
    await tick(); assert.equal(s.calls.length, 1); await s.view.refresh(); assert.equal(s.calls.length, 2); assert.equal(s.writes().length, 0);
  } finally { s.cleanup(); }
});
test('unknown/old read mode never dispatches; first positive CLI observation permits only the owned entry read', async () => {
  const s = setup({ initialCli: null });
  try {
    await tick(); assert.equal(s.calls.length, 0); assert.equal(button(s, 'New schedule').disabled, true);
    s.setCli(fixtureCli); await tick(); assert.equal(s.calls.length, 1);
    s.setCli({ ...fixtureCli, scheduleHistoryApi: 2 }); await s.view.refresh(); assert.equal(s.calls.length, 1); assert.equal(button(s, 'New schedule').disabled, true);
  } finally { s.cleanup(); }
});
test('remote refusal remains explicit and never falls back to a local read or mutation', async () => {
  const s = setup({ read: () => ({ scheduleReadViewApi: 1, status: 'unavailable', workspace: null, scope: null, data: null, reason: { code: 'unsupported-remote-operation', message: 'PRIVATE' } }) });
  try { await tick(); assert.match(s.el.textContent, /unsupported on remote workspaces; no local substitution/); assert.doesNotMatch(s.el.textContent, /PRIVATE/); assert.equal(s.calls.length, 1); assert.equal(button(s, 'New schedule').disabled, true); }
  finally { s.cleanup(); }
});
test('stable unchanged rows preserve text range, focused native menu, scroll and disclosure on refresh', async () => {
  const s = setup();
  try {
    await tick(); const row = s.el.querySelector('tbody tr'), title = row.querySelector('strong'), menu = row.querySelector('details'), summary = menu.querySelector('summary');
    const history = s.el.querySelector('.schedule-run'), detail = history.querySelector('details'); menu.open = true; detail.open = true; summary.focus();
    const range = s.doc.createRange(); range.selectNodeContents(title); s.dom.window.getSelection().addRange(range); const text = s.dom.window.getSelection().toString(); s.el.scrollTop = 90;
    await s.view.refresh(); assert.equal(s.el.querySelector('tbody tr'), row); assert.equal(s.el.querySelector('.schedule-run'), history);
    assert.equal(s.doc.activeElement, summary); assert.equal(s.dom.window.getSelection().toString(), text); assert.equal(menu.open, true); assert.equal(detail.open, true); assert.equal(s.el.scrollTop, 90);
  } finally { s.cleanup(); }
});
test('edit uses a fresh SHOW; exact task/CRLF, purpose/model/false-yolo and nested wake survive cron-only save', async () => {
  const original = entry({ agent: 'dev-ws', model: '', task: '  token=PRIVATE\r\n$(literal)  ', wake: { cron: '0 9 * * *', tz: 'UTC', message: '  Wake\r\nbytes  ' } });
  const s = setup({ jobs: [original] });
  try {
    await tick(); assert.doesNotMatch(s.el.textContent, /PRIVATE/); button(s, 'Edit').click(); await tick();
    assert.equal(s.calls.filter(c => c.body?.action === 'show').length, 1); const form = s.el.querySelector('form'); assert.equal(form.hidden, false);
    form.elements.cron.value = '0 10 * * *'; submit(s); await tick();
    const body = s.writes()[0].body; assert.equal(body.operation, 'update'); assert.equal(body.spec.task, original.task); assert.equal(body.spec.purpose, original.purpose); assert.equal(body.spec.model, ''); assert.equal(body.spec.yolo, false); assert.deepEqual(body.spec.wake, original.wake);
  } finally { s.cleanup(); }
});
test('editing a nested wake cron alone retains the unchanged literal wake message bytes', async () => {
  const original = entry({ agent: 'dev-ws', wake: { cron: '0 9 * * *', tz: 'UTC', message: '  Keep\r\nthese bytes  ' } });
  const s = setup({ jobs: [original] });
  try { await tick(); button(s, 'Edit').click(); await tick(); s.el.querySelector('.fwake-cron').value = '0 10 * * *'; submit(s); await tick(); assert.deepEqual(s.writes()[0].body.spec.wake, { ...original.wake, cron: '0 10 * * *' }); }
  finally { s.cleanup(); }
});
test('captured Edit is unavailable with exact policy reason; read support alone never enables mutation', async () => {
  const s = setup({ jobs: [entry({ definitionVersion: 2, execution: { PRIVATE: 'secret' } })] });
  try {
    await tick(); assert.equal(button(s, 'Edit').disabled, true); assert.match(s.el.textContent, /this schedule carries an execution policy the editor cannot preserve; edit via CLI/);
    button(s, 'Edit').click(); assert.equal(s.calls.length, 1);
    s.setCli({ ...fixtureCli, scheduleApi: undefined, features: ['schedule-read-2'] }); await s.view.refresh(); button(s, 'Run now').click(); assert.equal(s.writes().length, 0); assert.equal(button(s, 'New schedule').disabled, true);
  } finally { s.cleanup(); }
});
for (const reject of [false, true]) test(`late list ${reject ? 'rejection' : 'success'} cannot replace a newer explicit refresh`, async () => {
  let gate = null; const s = setup({ read: (_ws, _body, normal) => gate ? gate.promise : normal() });
  try {
    await tick(); gate = deferred(); const old = s.view.refresh(), saved = gate; gate = null; await s.view.refresh();
    if (reject) saved.reject(Error('PRIVATE')); else saved.resolve(s.response('ws', { action: 'list' }, [entry({ agent: 'OLD' })]));
    await old; assert.doesNotMatch(s.el.textContent, /OLD|PRIVATE|could not complete/); assert.equal(button(s, 'New schedule').disabled, false);
  } finally { s.cleanup(); }
});
for (const reject of [false, true]) test(`unsignaled CLI replacement revokes late ${reject ? 'rejection' : 'success'} and mutation authority`, async () => {
  let g = null; const s = setup({ read: (_ws, _body, normal) => g ? g.promise : normal() });
  try {
    await tick(); g = deferred(); const pending = s.view.refresh(); s.setCli({ ...fixtureCli, bin: '/changed/oats' }, false);
    if (reject) g.reject(Error('PRIVATE')); else g.resolve(s.response('ws', { action: 'list' }, [entry({ agent: 'OLD' })]));
    await pending; button(s, 'New schedule').click(); assert.equal(s.el.querySelector('form').hidden, true); assert.doesNotMatch(s.el.textContent, /OLD|PRIVATE|could not complete/);
  } finally { s.cleanup(); }
});
for (const reject of [false, true]) for (const change of ['workspace', 'connection', 'CLI', 'hide-show', 'dispose']) test(`${change} revokes late read ${reject ? 'rejection' : 'success'}`, async () => {
  let gate = null; const s = setup({ read: (_ws, _body, normal) => gate ? gate.promise : normal() });
  let disposed = false;
  try {
    await tick(); gate = deferred(); const old = s.view.refresh(), saved = gate; gate = null;
    if (change === 'workspace') setWorkspace('other');
    if (change === 'connection') s.reconnect();
    if (change === 'CLI') s.setCli({ ...fixtureCli, bin: '/other/oats' });
    if (change === 'hide-show') { s.el.hidden = true; s.el.hidden = false; }
    if (change === 'dispose') { s.view.dispose(); disposed = true; }
    await tick(); if (reject) saved.reject(Error('PRIVATE')); else saved.resolve(s.response('ws', { action: 'list' }, [entry({ agent: 'OLD' })]));
    await old; assert.doesNotMatch(s.el.textContent, /OLD|PRIVATE/);
    if (change === 'workspace') assert.match(s.el.textContent, /dev-other/);
    if (['CLI', 'hide-show', 'connection'].includes(change)) assert.equal(button(s, 'New schedule').disabled, true);
  } finally { if (!disposed) s.cleanup(); else s.dom.window.close(); }
});
for (const reject of [false, true]) test(`old SHOW ${reject ? 'rejection' : 'success'} cannot overwrite a newer form intent`, async () => {
  const g = deferred(); const s = setup({ read: (_ws, input, normal) => input.action === 'show' ? g.promise : normal() });
  try {
    await tick(); button(s, 'Edit').click(); button(s, 'New schedule').click(); await tick();
    const form = s.el.querySelector('form'); form.elements.task.value = 'Newest draft';
    if (reject) g.reject(Error('PRIVATE')); else g.resolve(s.response('ws', { action: 'show', id: 'nightly' }));
    await tick(); assert.equal(form.elements.task.value, 'Newest draft'); assert.equal(form.elements.id.disabled, false); assert.doesNotMatch(s.el.textContent, /PRIVATE/);
  } finally { s.cleanup(); }
});
for (const reject of [false, true]) test(`old form roster ${reject ? 'rejection' : 'success'} cannot rewrite a cancelled/new form`, async () => {
  let gate = deferred(); const s = setup({ roster: () => gate ? gate.promise : { agents: [] } });
  try {
    await tick(); button(s, 'New schedule').click(); const saved = gate; button(s, 'Cancel').click(); gate = null; button(s, 'New schedule').click(); await tick();
    const form = s.el.querySelector('form'); form.elements.task.value = 'Newest';
    if (reject) saved.reject(Error('PRIVATE')); else saved.resolve({ agents: [{ name: 'OLD', agentsRoot: '/other/agents' }] });
    await tick(); assert.equal(form.elements.task.value, 'Newest'); assert.doesNotMatch(s.el.textContent, /OLD|PRIVATE|Could not read targets/);
  } finally { s.cleanup(); }
});
for (const reject of [false, true]) test(`old workspace mutation ${reject ? 'failure' : 'success'} cannot clear, error or re-enable a new pending form`, async () => {
  const gates = []; const s = setup({ mutate: () => { const g = deferred(); gates.push(g); return g.promise; } });
  try {
    await tick(); button(s, 'New schedule').click(); await tick(); const form = s.el.querySelector('form'); form.elements.id.value = 'first'; form.elements.task.value = 'First'; submit(s);
    setWorkspace('other'); await tick(); button(s, 'New schedule').click(); await tick(); form.elements.id.value = 'second'; form.elements.task.value = 'Second'; submit(s);
    assert.equal(gates.length, 2); if (reject) gates[0].reject(Error('PRIVATE')); else gates[0].resolve({}); await tick();
    assert.equal(form.hidden, false); assert.equal(form.elements.task.value, 'Second'); assert.equal(button(s, 'Save schedule').disabled, true); assert.doesNotMatch(s.el.textContent, /PRIVATE/);
    gates[1].resolve({}); await tick(); assert.equal(form.hidden, true);
  } finally { for (const g of gates) g.resolve({}); s.cleanup(); }
});
for (const known of [false, true]) test(`refresh cannot save across ${known ? 'reported definition replacement' : 'unknown definition identity'}`, async () => {
  const stamp = '2026-01-01T00:00:00.000Z';
  const jobs = [entry({ agent: 'dev-ws', ...(known ? { createdAt: stamp, updatedAt: stamp } : {}) })], s = setup({ jobs });
  try {
    await tick(); button(s, 'Edit').click(); await tick(); const form = s.el.querySelector('form'); form.elements.task.value = 'Keep draft';
    if (known) jobs[0] = { ...jobs[0], updatedAt: '2026-01-02T00:00:00.000Z' };
    await s.view.refresh(); assert.equal(form.elements.task.value, 'Keep draft'); assert.equal(button(s, 'Save schedule').disabled, true);
    submit(s); assert.equal(s.writes().length, 0); assert.match(s.el.textContent, /Definition observation changed or cannot be matched/);
  } finally { s.cleanup(); }
});
test('unchanged reported definition stamps retain editable draft across a history-only refresh', async () => {
  const stamp = '2026-01-01T00:00:00.000Z', jobs = [entry({ agent: 'dev-ws', createdAt: stamp, updatedAt: stamp })], s = setup({ jobs });
  try { await tick(); button(s, 'Edit').click(); await tick(); const form = s.el.querySelector('form'); form.elements.task.value = 'Keep'; jobs[0].recentRuns[0].hasError = true; await s.view.refresh(); assert.equal(button(s, 'Save schedule').disabled, false); assert.equal(form.elements.task.value, 'Keep'); }
  finally { s.cleanup(); }
});
for (const reject of [false, true]) test(`list intent revokes an older SHOW ${reject ? 'failure' : 'success'}`, async () => {
  const g = deferred(), s = setup({ read: (_ws, body, normal) => body.action === 'show' ? g.promise : normal() });
  try { await tick(); button(s, 'Edit').click(); await s.view.refresh(); if (reject) g.reject(Error('PRIVATE')); else g.resolve(s.response('ws', { action: 'show', id: 'nightly' })); await tick(); assert.equal(s.el.querySelector('form').hidden, true); assert.doesNotMatch(s.el.textContent, /PRIVATE/); }
  finally { s.cleanup(); }
});
test('detached same-ID controls cannot mutate a new workspace; delete remains two explicit clicks', async () => {
  const s = setup();
  try {
    await tick(); const old = button(s, 'Run now'); setWorkspace('other'); await tick(); old.click(); assert.equal(s.writes().length, 0);
    button(s, 'Delete').click(); assert.equal(s.writes().length, 0); button(s, 'Confirm deletion').click(); await tick(); assert.equal(s.writes().length, 1); assert.equal(s.writes()[0].ws, 'other'); assert.equal(s.writes()[0].body.operation, 'remove');
  } finally { s.cleanup(); }
});
test('failed refresh retains rows with stale status and cannot enable actions or replace an unsaved draft', async () => {
  let fail = false; const s = setup({ read: (_ws, _input, normal) => { if (fail) throw Error('PRIVATE'); return normal(); } });
  try {
    await tick(); button(s, 'New schedule').click(); await tick(); const form = s.el.querySelector('form'); form.elements.task.value = 'Keep'; const row = s.el.querySelector('tbody tr'); fail = true;
    await s.view.refresh(); assert.equal(s.el.querySelector('tbody tr'), row); assert.equal(form.elements.task.value, 'Keep'); assert.equal(button(s, 'Save schedule').disabled, true); assert.match(s.el.textContent, /Last observation retained/); assert.doesNotMatch(s.el.textContent, /PRIVATE/);
  } finally { s.cleanup(); }
});
test('corrupt/legacy/truncated rows and invalid times never fabricate results, durations or transcript actions', async () => {
  const legacy = run({ runId: null, legacy: true, settled: null, transitions: null }); delete legacy.recordedAt;
  const runs = [legacy, { runId: null, legacy: true, corrupt: true }, run({ startedAt: 'not-a-date' }), ...Array.from({ length: 47 }, () => run())];
  const s = setup({ jobs: [entry({ history: { status: 'ok', stored: 61, truncated: true }, recentRuns: runs })] });
  try {
    await tick(); assert.equal(s.el.querySelectorAll('.schedule-run').length, 50); assert.match(s.el.textContent, /Incomplete observation|Legacy record|Corrupt run/); assert.doesNotMatch(s.el.textContent, /Invalid Date|NaN|PRIVATE/);
    assert.match(s.el.textContent, /Sources: definitions: ok/);
  } finally { s.cleanup(); }
});
