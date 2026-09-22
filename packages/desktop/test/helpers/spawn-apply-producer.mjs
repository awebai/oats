// Recorded producer bytes through real consumer layers; no executable/process or
// target filesystem access. Confirmation inputs are explicit SYNTHETIC fixtures
// from recorded decisions, not a claim of independent native preview/apply proof.
import assert from 'node:assert/strict';
import { dirname, basename } from 'node:path';
import { createSpawnApplyBoundary } from '../../server/spawn-apply.mjs';
import { cliSpawnApply } from '../../spawn-apply-cli.mjs';
import { spawnApplyView } from '../../renderer/spawn-apply-contract.mjs';
export async function replayProducerEnvelope(fixtures, name) {
  const raw = fixtures[name], successes = Object.values(fixtures).filter(v => v.ok && v.result?.decision?.effective);
  const home = raw.result?.home ?? raw.error?.details?.home;
  const prior = successes.find(v => v.result.home === home) || successes[0];
  const observedDecision = raw.result?.decision?.effective ? raw.result.decision : raw.error?.details?.decision?.effective ? raw.error.details.decision : prior.result.decision;
  const decision = structuredClone(observedDecision);
  if (raw.error?.code === 'E_DECISION_STALE') decision.revision = '0'.repeat(24); // synthetic prior opaque revision, never recompute producer data
  const soul = basename(dirname(dirname(decision.home))), root = dirname(dirname(dirname(decision.home))), context = dirname(root);
  const target = { workspace: 'producer-fixture', context, selector: { soul, agentsRoot: root } }, e = decision.effective;
  assert.equal(e.relation, null, 'this stored corpus has unrelated synthetic selectors');
  const preview = { spawnPreviewApi: 2, preview: true, subject: { ...target.selector, dir: context }, decision,
    agent: soul, instance: decision.instance, home: decision.home, branch: decision.branch, base: decision.base,
    repo: e.repo, work: e.work, worktree: e.work === 'worktree' ? `${decision.home}/work` : null,
    runtime: e.runtime, model: e.model, modelSource: 'synthetic confirmation from recorded decision', launchConfig: e.launchConfig, yolo: e.yolo,
    backend: e.backend, backendStatus: { name: e.backend, installed: true, started: false }, preflight: { status: 'complete', budgetMs: 20000, elapsedMs: 0 },
    relation: null, parentInstance: null, policy: { childSpawns: { allowed: e.childSpawns, origin: { kind: 'fixture', detail: null } } }, capabilities: [], skills: [] };
  const wakeRequested = raw.ok && (raw.result.wake?.requested === true || raw.result.wake?.requested === null); // choose requested=true for unknown-wake coverage, not an inference about original argv
  const cli = { ok: true, bin: '/inert/oats', spawnPreviewApi: 2, spawnApplyApi: 1,
    features: ['spawn-preview-2', 'spawn-apply-2', 'spawn-idempotency-2', 'schedule'] };
  const c = { workspace: { id: target.workspace, scope: context }, cli, agents: [{ name: soul, agentsRoot: root, work: e.work }], instances: [] };
  let ids = 0, commands = 0, directories = 0, removed = 0;
  const keys = [], argvs = [];
  const broker = createSpawnApplyBoundary({ mint: () => (++ids).toString(16).padStart(64, '0'), read: request => {
    assert.deepEqual(Object.keys(request).sort(), ['action', 'choices', 'selector']); return { status: 'available', data: preview };
  }, invoke: (cli, args) => {
    keys.push(args.key);
    return cliSpawnApply(cli, args, { env: {}, tmpdir: () => '/inert/tmp', mkdtempSync: p => `${p}${++directories}`,
      openSync: (_file, flags, mode) => { assert.equal(flags, 'wx'); assert.equal(mode, 0o600); return directories; },
      writeSync: (_fd, text) => Buffer.byteLength(text), closeSync: () => {}, rmSync: () => { removed++; },
      exec: (_bin, argv, options, done) => {
        commands++; argvs.push(argv); assert.equal(options.shell, false); assert.equal(options.cwd, context);
        assert.ok(argv.includes('--expect-decision')); assert.ok(argv.includes('--idempotency-key')); assert.ok(argv.includes('--agents-root'));
        assert.equal(argv.includes('--preview'), false); assert.equal(argv.includes('--no-launch'), false);
        if (raw.result?.replayed && commands === 1) done({ killed: true }, ''); // synthetic lost first outcome
        else done(raw.ok ? null : { code: 1 }, JSON.stringify(raw));
      } });
  } });
  const prepared = await broker({ action: 'prepare', selector: target.selector, choices: {}, task: 'inert fixture task',
    ...(wakeRequested ? { wake: { cron: '* * * * *', tz: 'UTC', message: 'inert fixture wake' } } : {}) }, () => c);
  assert.equal(prepared.status, 'prepared'); assert.equal(commands, 0);
  let view = await broker({ action: 'apply', spawnRef: prepared.spawnRef }, () => c);
  if (raw.result?.replayed) {
    assert.equal(view.status, 'unknown');
    assert.equal((await broker({ action: 'result', spawnRef: prepared.spawnRef }, () => c)).status, 'unknown'); assert.equal(commands, 1);
    view = await broker({ action: 'apply', spawnRef: prepared.spawnRef }, () => c); assert.equal(keys[0], keys[1]);
    for (const flag of ['--expect-decision', '--idempotency-key']) assert.equal(argvs[0][argvs[0].indexOf(flag) + 1], argvs[1][argvs[1].indexOf(flag) + 1]);
  }
  assert.equal(removed, directories);
  const projected = spawnApplyView(view, { workspace: target.workspace, ref: prepared.spawnRef, selector: target.selector });
  assert.ok(projected); assert.deepEqual(projected, view);
  if (raw.ok) {
    assert.equal(view.status, wakeRequested && raw.result.wake.saved !== true ? 'partial' : 'complete');
    assert.deepEqual(view.receipt.decision, raw.result.decision); assert.equal(view.receipt.replayed, raw.result.replayed);
    assert.equal(view.receipt.launched, false, 'stored samples are no-launch, never native session acceptance');
  } else if (raw.error.code === 'E_DECISION_STALE' && !raw.error.details.decision.effective) {
    assert.equal(view.status, 'unknown'); assert.equal(view.reason.code, 'E_OUTCOME_UNKNOWN'); // historical incomplete DTO refused, not repaired
  } else {
    assert.equal(view.reason.code, raw.error.code); assert.equal(view.status, raw.error.code === 'E_SPAWN_INCOMPLETE' ? 'incomplete' : 'stale');
  }
  const before = commands; await broker({ action: 'result', spawnRef: prepared.spawnRef }, () => c); assert.equal(commands, before);
  return { name, status: view.status, code: view.reason?.code ?? null, replayed: view.receipt?.replayed ?? null,
    wake: view.receipt?.wake ?? null, invocations: commands, privateDirectories: directories, cleaned: removed };
}
