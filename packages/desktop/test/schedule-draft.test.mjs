import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleDraft } from '../renderer/schedule-read-data.mjs';

// The local schedule editor's draft (moved from schedule-read-data.test.mjs when the old
// Schedules read path left, §3b): exact stored inputs, never an invented default or a
// stripped execution policy.
const entry = (extra = {}) => ({ id: 'nightly', scope: '/inert/ws', scheduleApi: 2, scheduleHistoryApi: 3, kind: 'spawn', agent: 'dev', agentsRoot: '/inert/ws/agents', repo: '/inert/ws',
  task: '  Full draft\r\nbytes  ', purpose: 'review', runtime: 'pi', model: 'model', backend: 'tmux', yolo: false, wake: { cron: '0 9 * * *', tz: 'UTC', message: '  Wake\r\nbytes  ' },
  cron: '0 9 * * *', tz: 'UTC', enabled: true, running: false, executionStatus: { kind: 'legacy' }, nextRun: '2026-02-02T09:00:00.000Z', lastRun: null,
  history: { status: 'ok', stored: 0, truncated: false }, recentRuns: [], ...extra });

test('a stored spawn definition drafts byte for byte', () => {
  assert.deepEqual(scheduleDraft(entry()), { id: 'nightly', kind: 'spawn', cron: '0 9 * * *', tz: 'UTC', enabled: true, agent: 'dev', agentsRoot: '/inert/ws/agents',
    task: '  Full draft\r\nbytes  ', repo: '/inert/ws', model: 'model', backend: 'tmux', purpose: 'review', harness: 'pi', yolo: false,
    wake: { cron: '0 9 * * *', tz: 'UTC', message: '  Wake\r\nbytes  ' } });
});

for (const key of ['definitionVersion', 'recurrencePolicy', 'execution', 'preparation', 'executionBinding', 'responsibleHuman']) test(`${key} blocks an editable draft even when null`, () => {
  assert.equal(scheduleDraft(entry({ [key]: null })), null);
});

test('unpreservable inputs and the command kind get no invented default or stripped policy', () => {
  for (const v of [entry({ tz: undefined }), entry({ kind: 'command', argv: ['oats', 'status'] }), entry({ backend: 'future' }), entry({ runtime: 'future' }),
    entry({ wake: { cron: '* * * * *', tz: 'UTC', message: 'wake', enabled: false } }), entry({ name: 'nightly', origin: { kind: 'local' } })]) assert.equal(scheduleDraft(v), null);
});
