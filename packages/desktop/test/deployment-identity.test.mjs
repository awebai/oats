// The identity read of a listed deployment (packages/client/deployment-identity.mjs `cliDeploymentIdentity`):
// its `waiting`, whether any instance needs input, from the rows the observer's projections make of the
// status document (deployment-data.mjs `deploymentStatusData`, deployment-panel.mjs `rosterRows`) through
// the one gate a row's claim passes (waiting-on-you.mjs `waitingClaim`); null without feature waiting-on-you.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cliDeploymentIdentity, waitingReadable } from '../../client/deployment-identity.mjs';
import { DEPLOYMENT_FEATURES } from '../../client/deployment-contract.mjs';

const P = '/Users/op/Agents/oats';
const CLI = Object.freeze({ ok: true, bin: '/fixture/bin/oats', workspaceApi: 2, features: [...DEPLOYMENT_FEATURES, 'workspace-identity', 'waiting-on-you'] });
const WITHOUT = Object.freeze({ ...CLI, features: CLI.features.filter((f) => f !== 'waiting-on-you') });
const CLAIM = { since: '2026-10-11T11:00:00.000Z', producer: 'agent', reason: 'question' };
const row = (name, extra = {}) => ({ instance: name, home: `${P}/agents/dev/instances/${name}`, running: true, ...extra });
const statusOf = (rows, root = `${P}/agents`) => ({ root, agents: [{ name: 'dev', dir: `${P}/agents/dev`, instances: rows }],
  workspace: { reachable: true } });
/** An exec that prints `document` for `oats status --dir P --json`, and records what it was asked. */
const printing = (document, seen = []) => ({ exec(bin, argv, options, callback) { seen.push(argv); callback(null, JSON.stringify(document)); } });
const read = (rows, cli = CLI) => cliDeploymentIdentity(cli, P, {}, printing(statusOf(rows)));

test('waiting: true when one running row has a claim, false when none has; the workspace object is as before', async () => {
  const seen = [];
  const answer = await cliDeploymentIdentity(CLI, P, { maxAge: 300 }, printing(statusOf([row('idle'), row('asks', { waitingOnYou: CLAIM })]), seen));
  assert.deepEqual(answer, { ok: true, workspace: { reachable: true }, waiting: true });
  assert.deepEqual(seen, [['status', '--dir', P, '--json']], 'the one status read');
  assert.deepEqual(await read([row('idle'), row('also-idle', { waitingOnYou: null })]), { ok: true, workspace: { reachable: true }, waiting: false });
  assert.deepEqual(await read([]), { ok: true, workspace: { reachable: true }, waiting: false }, 'no instances: nobody waits');
  // A claim that is not one (no valid `since` or `producer`) is no claim.
  assert.equal((await read([row('bad', { waitingOnYou: { since: 'yesterday', producer: 'x' } })])).waiting, false);
});

test('a row whose claim no row may show never counts: a shell, a stopped or an unreachable session', async () => {
  for (const extra of [{ runtimeState: 'shell' }, { running: false }, { running: null, runtimeState: 'unreachable', runtimeError: 'tmux is gone' },
    { running: null }, { runtimeState: 'unsupported' }]) {
    assert.equal((await read([row('dev-a', { waitingOnYou: CLAIM, ...extra })])).waiting, false, JSON.stringify(extra));
  }
  assert.equal((await read([row('dev-a', { waitingOnYou: CLAIM, runtimeState: 'running' })])).waiting, true, 'running, reported so');
});

test('without feature waiting-on-you: waiting is null, unknown, whatever the rows carry', async () => {
  assert.equal(waitingReadable(CLI), true);
  for (const cli of [WITHOUT, { ...CLI, features: undefined }, null]) assert.equal(waitingReadable(cli), false);
  assert.deepEqual(await read([row('asks', { waitingOnYou: CLAIM })], WITHOUT), { ok: true, workspace: { reachable: true }, waiting: null });
  assert.equal((await read([], WITHOUT)).waiting, null);
});

test('a failed read stays a failure, with no waiting: the caller reads it as null', async () => {
  const failed = await cliDeploymentIdentity(CLI, P, {}, { exec(_b, _a, _o, callback) { callback({ code: 1 }, ''); } });
  assert.deepEqual([failed.ok, failed.reason.code, Object.hasOwn(failed, 'waiting')], [false, 'E_CLI_FAILED', false]);
  const foreign = await cliDeploymentIdentity(CLI, P, {}, printing(statusOf([row('asks', { waitingOnYou: CLAIM })], '/elsewhere/agents')));
  assert.deepEqual([foreign.ok, foreign.reason.code, Object.hasOwn(foreign, 'waiting')], [false, 'E_DEPLOYMENT_SCOPE', false]);
  const thrown = await cliDeploymentIdentity(CLI, P, {}, { exec() { throw new Error('spawn failed'); } });
  assert.equal(thrown.ok, false);
});
