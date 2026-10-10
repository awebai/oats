// Spec D contract pin: kernel PR K's REAL output, captured end to end (K @ e85ff4ec, 2026-10-03) on a
// live instance — `oats instance attention --message "e2e: needs input check"`, then `--clear` — with
// `oats status --json` and `oats instance events <instance> --json` read from the deployment each time.
// Trimmed for a public repository: the status documents keep only what deploymentStatusData needs for
// that one row (paths under /ws) and its `waitingOnYou` EXACTLY as K emitted it; the events documents
// keep K's `waiting` events, its claims and its integrity verbatim (count/returned/lastEvent recomputed
// for the kept rows), with paths under /ws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deploymentStatusData } from '../../client/deployment-data.mjs';
import { waitingClaim, waitingLabel } from '../../client/waiting-on-you.mjs';
import { eventsData } from '../renderer/instance-events-data.mjs';

const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/needs-input-k/${name}.json`, import.meta.url), 'utf8'));
const ME = 'oats-desktop-developer-needs-input', DEPLOYMENT = '/ws';
const CLAIM = { since: '2026-10-03T12:43:21.896Z', producer: 'agent', reason: 'attention', message: 'e2e: needs input check' };
// What Desktop liveness (server/liveness.mjs, tmux) merged over the row during the capture.
const live = { running: true, runtimeState: 'running' };
const row = doc => deploymentStatusData(doc, DEPLOYMENT).agents.flatMap(a => a.instances).find(i => i.instance === ME);
const target = (doc, events) => ({ workspace: 'oats', context: DEPLOYMENT, home: row(doc).home, incarnation: events.incarnation,
  selector: { instance: ME, agent: row(doc).agent, agentsRoot: `${DEPLOYMENT}/agents`, server: null } });

test('K status, claimed: the row carries exactly {since, producer, reason, message} and Desktop shows it', () => {
  const raw = fx('status-claimed').agents[0].instances[0].waitingOnYou;
  assert.deepEqual(Object.keys(raw).sort(), ['message', 'producer', 'reason', 'since'], 'the shape K emits');
  const status = row(fx('status-claimed'));
  assert.deepEqual(status.waitingOnYou, CLAIM, 'deploymentStatusData passes it validated');
  assert.equal(status.running, true); assert.equal(Object.hasOwn(status, 'runtimeState'), false, 'K reports no runtimeState here');
  const claim = waitingClaim({ ...status, ...live });
  assert.deepEqual(claim, CLAIM);
  assert.equal(waitingLabel(claim), 'Asked for your attention');
  assert.equal(waitingClaim({ ...status, running: false, runtimeState: 'shell' }), null, 'Desktop liveness still decides');
});

test('K status, cleared: null (unknown), and nothing is shown', () => {
  const status = row(fx('status-cleared'));
  assert.equal(status.waitingOnYou, null);
  assert.equal(waitingClaim({ ...status, ...live }), null);
});

test('K events, claimed: the read validates and carries the message on waitingOnYou and its claim', () => {
  const events = fx('events-claimed').result, data = eventsData(events, target(fx('status-claimed'), events), 200);
  assert.ok(data, 'eventsData accepts K’s document');
  assert.deepEqual(data.waitingOnYou, { producer: 'agent', since: CLAIM.since, reason: 'attention', message: CLAIM.message });
  assert.deepEqual(data.waitingClaims, [{ producer: 'agent', waiting: true, since: CLAIM.since, reason: 'attention', message: CLAIM.message }]);
});

test('K events, cleared: the read validates; the cleared claim keeps message null and waitingOnYou is null', () => {
  const events = fx('events-cleared').result, data = eventsData(events, target(fx('status-cleared'), events), 200);
  assert.ok(data, 'eventsData accepts K’s document');
  assert.equal(data.waitingOnYou, null);
  assert.deepEqual(data.waitingClaims, [{ producer: 'agent', waiting: false, since: '2026-10-03T12:43:36.503Z', reason: null, message: null }]);
});
