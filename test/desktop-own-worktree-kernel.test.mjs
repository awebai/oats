// `facts.ownWorktree` on the REAL kernel, read the way the Desktop reads it (awebai/oats#1071, the reader
// of #988; docs/desktop-cli-api.md § "Retire"). A scratch deployment (the repository's own minimal one,
// test/helpers/v2-deployment.mjs) has four homes, made as the kernel's own test of the fact makes them
// (test/retire-plan-own-worktree.test.mjs):
//
//   an instance with its own tree at work/;
//   a link at work/ under a record that says `worktree` (#973);
//   a record that says `worktree` with nothing at work/ (#1019);
//   an attached instance over a tree on another branch, with uncommitted work in it.
//
// Each one's retire plan is read twice: by `lifecyclePlan` with the kernel's own feature list (its
// `oats version --json`), then by the function every reader asks, `ownWorktreeOf`; and through the Desktop
// server's lifecycle boundary over the same exec owner that builds the argv (packages/client
// lifecycle-cli.mjs), then by the reader the renderer uses. The kernel's raw fact is asserted as well, so
// the test means something on its own. The boundary's refusal to delete a tree that is not the instance's
// is asserted beside the commands it ran: a refused confirmation runs none.
//
// Every assertion is on a value the client reads (`facts.ownWorktree`, `facts.workMode`,
// `facts.work.observed`) or on what the client's readers make of the plan. No kernel text (a note, a
// message, a reason's wording) is compared with anything: a kernel change of words does not reach this file.
//
// Everything happens in mkdtemp directories with HOME, the remote cache, tmux and the harnesses isolated by
// the helper: never the operator's deployment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cliLifecycle } from '../packages/client/lifecycle-cli.mjs';
import { lifecyclePlan, lifecycleChoicesApplicable, lifecycleReason, ownWorktreeOf, OWN_WORKTREE_FEATURE } from '../packages/client/lifecycle-contract.mjs';
import { createLifecycleBoundary } from '../packages/desktop/server/instance-lifecycle.mjs';
import { DESKTOP_TERMS } from '../packages/desktop/renderer/desktop-terms.mjs';
import { v2Deployment, CLI } from './helpers/v2-deployment.mjs';

const KEEP = { discardWorktree: false }, DISCARD = { discardWorktree: true };

/** The scratch deployment, and what the cases do in it. */
function deployment(t) {
  const fx = v2Deployment({ souls: { dev: { soul: { work: 'worktree' } } }, t });
  // An in-process spawn looks for the harness's executable on this process's PATH, with `launch: false`
  // too: the fixture's PATH has the inert harnesses, a bare runner's has none.
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: fx.env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const answered = argv => { const r = fx.cli(argv); try { return r.json(); } catch { assert.fail(`no envelope: ${r.stdout}${r.stderr}`); } };
  /** The kernel's own retire plan, as its CLI prints it. */
  const plan = name => { const e = answered(['retire', name, '--plan', '--json']); assert.equal(e.ok, true, JSON.stringify(e.error)); return e.result; };
  /** An instance attached to `owner`'s work/: a home that was given a link. */
  const attached = (owner, purpose) => {
    const e = answered(['spawn', 'dev', '--work', 'attached', '--work-dir', join(owner.home, 'work'), '--repo', fx.member, '--purpose', purpose, '--no-launch', '--json']);
    assert.equal(e.ok, true, JSON.stringify(e.error)); return e.result;
  };
  const record = (home, change) => { const path = join(home, 'instance.json'), meta = JSON.parse(readFileSync(path, 'utf8')); change(meta); writeFileSync(path, `${JSON.stringify(meta, null, 2)}\n`); };
  const version = JSON.parse(fx.cli(['version', '--json']).stdout);
  // The Desktop's side: the CLI record of this kernel, a roster of the homes, and the boundary over the real CLI.
  const commands = [];
  const exec = (bin, argv, options, callback) => { commands.push(argv); return execFile(bin, argv, { ...options, env: fx.env }, callback); };
  const service = createLifecycleBoundary({ invoke: (bin, args) => cliLifecycle(bin, args, { exec }) });
  const roster = [];
  const context = (features = version.features) => ({ cli: { ok: true, bin: CLI, version: version.version, lifecycleApi: version.lifecycleApi, features: [...features] },
    workspace: { id: 'scratch', scope: fx.dep }, instances: roster.map(row => ({ ...row })) });
  const row = inst => { const entry = { instance: inst.instance, agent: 'dev', agentsRoot: fx.root, home: inst.home }; roster.push(entry); return entry; };
  const selector = entry => ({ instance: entry.instance, agent: entry.agent, agentsRoot: entry.agentsRoot, server: null });
  return { fx, git, plan, attached, record, version, commands, service, context, row, selector };
}

test('the kernel\'s retire plans, read by the Desktop: the fact where the kernel lists the feature, whatever the record says; the record for a kernel that does not', async t => {
  const d = deployment(t), features = d.version.features;
  assert.ok(Array.isArray(features) && features.includes(OWN_WORKTREE_FEATURE), `this kernel lists ${OWN_WORKTREE_FEATURE}: ${JSON.stringify(features)}`);

  const owner = await d.fx.spawn('dev', { instance: 'dev-owner' });
  const linked = d.attached(owner, 'linked'); d.record(linked.home, meta => { meta.work = 'worktree'; });
  const gone = await d.fx.spawn('dev', { instance: 'dev-gone' }); d.git(d.fx.member, 'worktree', 'remove', '--force', join(gone.home, 'work'));
  const kid = d.attached(owner, 'kid');
  // The owner's tree moves to another branch and gets uncommitted work: the attached instances observe it through their links.
  d.git(join(owner.home, 'work'), 'checkout', '-q', '-b', 'elsewhere'); writeFileSync(join(owner.home, 'work', 'left.txt'), 'not committed\n');

  /** Each home: what the kernel says, what the record says, and whether work/ is observed. */
  const HOMES = [
    ['its own tree', owner, { own: true, mode: 'worktree', observed: true }],
    ['a link under a worktree record', linked, { own: false, mode: 'worktree', observed: true }],
    ['a worktree record, nothing at work/', gone, { own: true, mode: 'worktree', observed: false }],
    ['an attached instance over a tree on another branch', kid, { own: false, mode: 'attached', observed: true }],
  ];
  for (const [name, inst, expected] of HOMES) {
    const entry = d.row(inst), target = { ...entry, workspace: 'scratch', server: null };
    // The kernel's own answer.
    const raw = d.plan(inst.instance);
    assert.equal(raw.facts.ownWorktree, expected.own, `${name}: the kernel's fact`);
    assert.equal(raw.facts.workMode, expected.mode, `${name}: the record's value`);
    assert.equal(raw.facts.work.observed, expected.observed, `${name}: whether work/ is observed`);

    // Read by lifecyclePlan with the kernel's own feature list, then by the function.
    const read = lifecyclePlan(raw, target, 'retire', KEEP, { features });
    assert.ok(read, `${name}: the reader accepts the kernel's plan`);
    assert.equal(read.facts.ownWorktree, expected.own, name);
    assert.deepEqual(ownWorktreeOf(read), { own: expected.own, from: 'fact' }, name);
    assert.equal(lifecycleChoicesApplicable(read, DISCARD), expected.own, `${name}: whether the worktree can be deleted`);
    // The same plan with a key the reader must refuse: this kernel lists the word, so the key is required.
    const { ownWorktree: _dropped, ...withoutKey } = raw.facts;
    assert.equal(lifecyclePlan({ ...raw, facts: withoutKey }, target, 'retire', KEEP, { features }), null, `${name}: listed, and the key missing`);
    // Read as from a kernel that does not list the word: the key is not read, and the record answers.
    const older = lifecyclePlan(raw, target, 'retire', KEEP, { features: features.filter(f => f !== OWN_WORKTREE_FEATURE) });
    assert.equal(Object.hasOwn(older.facts, 'ownWorktree'), false, `${name}: not listed, not read`);
    assert.deepEqual(ownWorktreeOf(older), { own: expected.mode === 'worktree', from: 'record' }, name);

    // Through the Desktop's boundary, over the real CLI: the server's reply, then the renderer's reader.
    const ctx = d.context(), before = d.commands.length;
    const reply = await d.service({ action: 'plan', operation: 'retire', selector: d.selector(entry), options: DISCARD }, () => ctx);
    assert.equal(reply.status, 'plan', `${name}: ${JSON.stringify(reply.reason)}`);
    assert.deepEqual(d.commands.slice(before), [['retire', inst.instance, '--plan', '--home', inst.home, '--dir', d.fx.dep, '--json']], name);
    const shown = lifecyclePlan(reply.plan, reply.target, 'retire', DISCARD);
    assert.deepEqual(shown, reply.plan, `${name}: the renderer reads the server's projection as it is`);
    assert.deepEqual(ownWorktreeOf(shown), { own: expected.own, from: 'fact' }, name);
    // The same home through a Desktop whose CLI record does not list the word: by the record, as before.
    const olderCtx = d.context(features.filter(f => f !== OWN_WORKTREE_FEATURE));
    const olderReply = await d.service({ action: 'plan', operation: 'retire', selector: d.selector(entry), options: KEEP }, () => olderCtx);
    assert.equal(olderReply.status, 'plan', name);
    assert.deepEqual(ownWorktreeOf(olderReply.plan), { own: expected.mode === 'worktree', from: 'record' }, name);

    // A confirmation that asks to delete a tree that is not the instance's is refused before any command.
    if (!expected.own) {
      const ran = d.commands.length;
      const refused = await d.service({ action: 'apply', planRef: reply.planRef }, () => ctx);
      assert.deepEqual(refused.reason, lifecycleReason('E_OPTION_UNAVAILABLE', DESKTOP_TERMS), name);
      assert.equal(d.commands.length, ran, `${name}: the refused confirmation ran no command`);
    }
  }
  // What the fact is for: under a record that says `worktree`, the link reads as the instance's own tree by the
  // record alone, and what the plan observes through it is another instance's tree, with its uncommitted work.
  const link = lifecyclePlan(d.plan(linked.instance), { instance: linked.instance, home: linked.home }, 'retire', KEEP, { features });
  assert.deepEqual(ownWorktreeOf(link), { own: false, from: 'fact' });
  assert.equal(link.facts.work.observed, true);
  assert.ok(link.facts.work.changed + link.facts.work.untracked > 0, 'fixture premise: the tree the link leads to has uncommitted work');
  // Nothing was retired: the four homes are still there for the kernel to plan.
  for (const [name, inst] of HOMES) assert.equal(d.plan(inst.instance).instance, inst.instance, name);
});

test('the fresh plan of a stale guarded apply carries the fact, and the boundary reads it by the same rule', async t => {
  const d = deployment(t);
  const owner = await d.fx.spawn('dev', { instance: 'dev-owner' });
  const kid = d.attached(owner, 'kid');
  for (const [inst, own] of [[owner, true], [kid, false]]) {
    const entry = d.row(inst), ctx = d.context();
    const reply = await d.service({ action: 'plan', operation: 'retire', selector: d.selector(entry), options: KEEP }, () => ctx);
    assert.equal(reply.status, 'plan', JSON.stringify(reply.reason));
    // Something changes between the plan and the confirmation: the owner's tree gets uncommitted work, which every plan over it observes.
    writeFileSync(join(owner.home, 'work', `since-${inst.instance}.txt`), 'written after the plan was shown\n');
    const stale = await d.service({ action: 'apply', planRef: reply.planRef }, () => ctx);
    assert.equal(stale.status, 'stale', `${inst.instance}: ${JSON.stringify(stale.reason)} ${JSON.stringify(stale.cause)}`);
    assert.deepEqual(ownWorktreeOf(lifecyclePlan(stale.plan, stale.target, 'retire', KEEP)), { own, from: 'fact' }, inst.instance);
    assert.equal(d.plan(inst.instance).instance, inst.instance, 'nothing was retired');
  }
});
