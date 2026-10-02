// Schedules in a view of several deployments (#482, review round 1): the open form's add/update go to
// the form's deployment (the view's primary, read when the form opened); a list-level action (remove,
// reconcile, host install) goes to the view on screen, never to a deployment a previous form read in
// another view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSchedulesView } from '../renderer/views/schedules.mjs';
import { setWorkspace, currentWorkspace } from '../renderer/views/common.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const schedule = { id: 'review', name: 'review', qualifiedId: 'local/review', kind: 'wake', enabled: true, cron: '0 9 * * *', tz: 'UTC',
  home: '/a/agents/dev/instances/dev-1', message: 'Hi', origin: { kind: 'local', path: 'local' }, owner: null, runsOn: null, runsHere: true,
  reason: null, enabledHere: true, soul: null, teams: [], nextDue: null };

function mount(t) {
  const dom = new JSDOM('<body><main></main></body>', { pretendToBeVisual: true }); t.after(() => dom.window.close());
  const el = dom.window.document.querySelector('main'), calls = [];
  const primaryOf = (view) => (view === 'ws:a' ? '/a' : '/b');
  const ctx = { api: async (path, opts) => {
    calls.push({ path, body: opts?.body && JSON.parse(opts.body) });
    if (path.startsWith('/api/automations')) return { automationsViewApi: 1, status: 'ok', kind: 'schedule', action: 'list', reason: null,
      result: { scheduleApi: 2, host: { name: 'test' }, snapshot: null, scheduler: { installed: true, active: true, registered: true }, schedules: [schedule] } };
    if (path.startsWith('/api/agents')) return { agents: [] };
    if (path.startsWith('/api/panel')) return { workspace: { id: currentWorkspace(), primary: primaryOf(currentWorkspace()) },
      instances: [{ instance: 'dev-1', home: `${primaryOf(currentWorkspace())}/agents/dev/instances/dev-1`, deployment: { id: primaryOf(currentWorkspace()) } }] };
    if (path.startsWith('/api/schedules')) return { removed: true };
    throw new Error(path);
  } };
  const prev = currentWorkspace(); t.after(() => setWorkspace(prev));
  setWorkspace('ws:a');
  const view = createSchedulesView(el, ctx, { cli: () => ({ ok: true, scheduleApi: 2, automationsApi: 1, features: ['schedule', 'automations'] }), subscribeCli: () => () => {} });
  t.after(() => view.dispose());
  const sent = () => calls.filter((c) => c.path.startsWith('/api/schedules')).map((c) => [new URL(c.path, 'http://x').searchParams.get('ws'), c.body.operation]);
  return { el, sent };
}

test('a delete from the list goes to the view on screen, not to a deployment an earlier form read in another view', async (t) => {
  const { el, sent } = mount(t);
  await tick(); await tick();
  el.querySelector('.schedule-new').click(); await tick(); await tick();
  el.querySelector('.schedule-cancel').click();
  setWorkspace('ws:b'); await tick(); await tick();
  el.querySelector('.auto-row[data-id="local/review"] button[data-verb=remove]').click();
  el.querySelector('.schedule-delete-confirm').click(); await tick();
  assert.deepEqual(sent(), [['ws:b', 'remove']]);
});

test('the open form adds to its own deployment (the home it lists is that deployment\'s)', async (t) => {
  const { el, sent } = mount(t);
  await tick(); await tick();
  el.querySelector('.schedule-new').click(); await tick(); await tick();
  const form = el.querySelector('form');
  form.querySelector('[name=id]').value = 'nightly';
  form.querySelector('[name=kind]').value = 'wake'; form.querySelector('[name=kind]').dispatchEvent(new form.ownerDocument.defaultView.Event('change'));
  form.querySelector('[name=task]').value = 'Hello';
  form.dispatchEvent(new form.ownerDocument.defaultView.Event('submit', { cancelable: true })); await tick();
  assert.deepEqual(sent(), [['/a', 'add']]);
});
