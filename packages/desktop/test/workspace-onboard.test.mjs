// Onboarding (decision 9): a PICKED folder without oats-local.yaml becomes a
// deployment through the kernel's `oats onboard`, then the ordinary add.
// The renderer only ever holds a single-use offer token. Kernel documents are
// the captured F2 fixtures; no CLI, filesystem write, Electron or GUI runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createOnboardOffers, createOnboardExecutor, MAX_ONBOARD_OFFERS } from '../workspace-registry.mjs';
import { cliWorkspace, validWorkspaceRef } from '../workspace-cli.mjs';
import { onboardData } from '../deployment-data.mjs';
import { specProbe, specDocument, specExit } from './helpers/no-approval-spec.mjs';

// Captured 0.25.x documents read through the published no-approval spec until
// the 0.26.0 kernel branch is captured (helpers/no-approval-spec.mjs).
const fixture = name => specDocument(JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/f2/${name}.json`, import.meta.url), 'utf8')));
const exits = JSON.parse(readFileSync(new URL('./fixtures/workspace-v2/f2/provenance.json', import.meta.url), 'utf8')).files;
const dir = '/fixture/base/northwind-workspace';
const cli = { ...specProbe(fixture('version')), ok: true, bin: '/fixture/bin/oats' };
const replay = name => (_bin, _argv, _options, done) => { const exit = specExit(exits[name].exit); done(exit ? Object.assign(new Error('exit'), { code: exit }) : null, JSON.stringify(fixture(name))); };

function harness({ document = 'onboard-pending', deployment = () => false, realpath = p => p, add = async p => ({ ok: true, workspace: { id: p, path: p } }) } = {}) {
  let n = 0;
  const offers = createOnboardOffers({ token: () => `token-${++n}` });
  const runs = [], adds = [];
  const onboard = createOnboardExecutor({
    take: token => offers.take(token), offer: path => offers.offer(path),
    realpath, isDeployment: path => deployment(path),
    readCli: async () => cli,
    run: (state, options) => { runs.push(options); return cliWorkspace(state, options, { exec: replay(document) }); },
    project: onboardData, add: async path => { adds.push(path); return add(path); }, validRef: validWorkspaceRef,
  });
  return { offers, onboard, runs, adds };
}

test('offers are single-use, bound to one canonical path and bounded in number', () => {
  let n = 0;
  const offers = createOnboardOffers({ token: () => `t${++n}` });
  const token = offers.offer(dir);
  assert.equal(offers.take(token), dir); assert.equal(offers.take(token), null, 'single use');
  assert.equal(offers.offer('relative'), null);
  const tokens = Array.from({ length: MAX_ONBOARD_OFFERS + 2 }, (_, i) => offers.offer(`/p${i}`));
  assert.equal(offers.take(tokens[0]), null, 'the oldest offers expire');
  assert.equal(offers.take(tokens.at(-1)), `/p${MAX_ONBOARD_OFFERS + 1}`);
  assert.equal(offers.take(undefined), null);
});

test('success: the kernel onboards the offered folder with the operator ref, then the ordinary add registers it', async () => {
  const h = harness();
  const token = h.offers.offer(dir);
  const result = await h.onboard(token, '/fixture/base/fx/remotes/agents.git');
  assert.equal(result.ok, true); assert.equal(Object.hasOwn(result, 'pending'), false, 'nothing is ever pending approval');
  assert.deepEqual(h.runs, [{ action: 'onboard', dir, workspace: '/fixture/base/fx/remotes/agents.git' }]);
  assert.deepEqual(h.adds, [dir]);
  assert.equal(Object.hasOwn(result.onboard.sync, 'approvalNeeded'), false);
  assert.deepEqual(result.onboard.next.souls, ['campaign-writer', 'data-analyst', 'platform-engineer']);
  assert.equal(result.added.ok, true);
  assert.equal((await h.onboard(token, 'github.com/acme/agents')).code, 'offer-expired', 'the offer was consumed');
});

test('a kernel refusal is verbatim, adds nothing, and a folder left clean gets a fresh retry offer', async () => {
  const h = harness({ document: 'onboard-bad-ref' });
  const refused = await h.onboard(h.offers.offer(dir), 'not-a-ref');
  assert.equal(refused.ok, false); assert.equal(refused.code, 'E_REPO_REF');
  assert.equal(refused.reason, fixture('onboard-bad-ref').error.message);
  assert.deepEqual(h.adds, []);
  assert.ok(refused.retry, 'the same folder can be retried with a corrected ref');
  assert.equal(h.offers.take(refused.retry), dir);
  const rolled = harness({ document: 'onboard-unreadable' });
  const unreadable = await rolled.onboard(rolled.offers.offer(dir), '/fixture/base/fx/remotes/missing.git');
  assert.equal(unreadable.code, 'E_REMOTE_UNREADABLE'); assert.equal(unreadable.rolledBack, true);
  const kept = harness({ document: 'onboard-again', deployment: () => true });
  // The folder became a deployment meanwhile: refused before any CLI call, no retry.
  assert.equal((await kept.onboard(kept.offers.offer(dir), 'github.com/acme/agents')).code, 'E_ALREADY_ONBOARDED');
  assert.deepEqual(kept.runs, []);
});

test('the renderer cannot name a folder: bad refs, stale or moved offers and concurrent runs never dispatch', async () => {
  const h = harness();
  for (const ref of ['', '--help', ' spaced', 'a\nb', 'x'.repeat(3000), null]) {
    const token = h.offers.offer(dir);
    assert.equal((await h.onboard(token, ref)).code, 'bad-ref');
    assert.equal(h.offers.take(token), dir, 'a refused ref does not consume the offer');
  }
  assert.equal((await h.onboard('forged-token', 'github.com/acme/agents')).code, 'offer-expired');
  const moved = harness({ realpath: () => '/elsewhere' });
  assert.equal((await moved.onboard(moved.offers.offer(dir), 'github.com/acme/agents')).code, 'offer-expired');
  const gone = harness({ realpath: () => { throw new Error('ENOENT'); } });
  assert.equal((await gone.onboard(gone.offers.offer(dir), 'github.com/acme/agents')).code, 'not-found');
  let release;
  const slow = harness({ add: () => new Promise(done => { release = () => done({ ok: true, workspace: { id: dir } }); }) });
  const first = slow.onboard(slow.offers.offer(dir), 'github.com/acme/agents');
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal((await slow.onboard(slow.offers.offer(dir), 'github.com/acme/agents')).code, 'busy');
  release(); assert.equal((await first).ok, true);
  assert.equal(h.runs.length + moved.runs.length + gone.runs.length, 0);
});

test('an add failure after a successful onboarding is reported, never rolled back by the Desktop', async () => {
  const h = harness({ add: async () => ({ ok: false, code: 'foreign-server', reason: 'not owned' }) });
  const result = await h.onboard(h.offers.offer(dir), 'github.com/acme/agents');
  assert.equal(result.ok, true); assert.deepEqual(result.added, { ok: false, code: 'foreign-server', reason: 'not owned' });
});
