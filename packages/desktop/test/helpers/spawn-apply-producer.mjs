// Kernel apply outcomes (test/fixtures/workspace-v2/f3) replayed through the
// real adapter → broker → view. No executable, process or filesystem access:
// exec returns the captured stdout. The preview each apply was bound to is the
// captured preview for the same purpose.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSpawnApplyBoundary } from '../../server/spawn-apply.mjs';
import { cliSpawnApply } from '../../spawn-apply-cli.mjs';
import { spawnApplyView } from '../../renderer/spawn-apply-contract.mjs';
import { cli, kernel, DEPLOYMENT, ROOT } from './spawn-preview-fixture.mjs';
const provenance = JSON.parse(readFileSync(new URL('../fixtures/workspace-v2/f3/provenance.json', import.meta.url), 'utf8'));
export const APPLY_CASES = {
  'apply-bound': { preview: 'preview-worktree-purpose', choices: { purpose: 'api-v2' } },
  'apply-replayed': { preview: 'preview-worktree-purpose', choices: { purpose: 'api-v2' }, lostFirst: true },
  'apply-stale': { preview: 'preview-worktree-purpose', choices: { purpose: 'api-v2' } },
  'apply-idempotency-conflict': { preview: 'preview-other', choices: { purpose: 'docs' } },
  'apply-concurrent-a': { preview: 'preview-race', choices: { purpose: 'race' } },
  'apply-concurrent-b': { preview: 'preview-race', choices: { purpose: 'race' } },
  // spawn-name: an exact name, and the same name taken since an earlier preview
  'apply-name': { preview: 'preview-name', choices: { name: 'api-gateway' } },
  'apply-name-taken': { preview: 'preview-name-early', choices: { name: 'api-gateway' } },
};
export async function replayKernelApply(name) {
  const { preview: previewName, choices, lostFirst } = APPLY_CASES[name];
  const raw = kernel(name), preview = kernel(previewName).result;
  const selector = { soul: 'release-manager', agentsRoot: ROOT }, target = { workspace: 'northwind', context: DEPLOYMENT, selector };
  const c = { workspace: { id: 'northwind', scope: DEPLOYMENT }, cli, agents: [{ name: 'release-manager', agentsRoot: ROOT, work: 'worktree' }], instances: [] };
  let ids = 0, commands = 0, directories = 0, removed = 0;
  const keys = [], argvs = [];
  const broker = createSpawnApplyBoundary({ mint: () => (++ids).toString(16).padStart(64, '0'), read: request => {
    assert.deepEqual(Object.keys(request).sort(), ['action', 'choices', 'selector']); return { status: 'available', data: preview };
  }, invoke: (cliState, args) => {
    keys.push(args.key);
    return cliSpawnApply(cliState, args, { env: {}, tmpdir: () => '/inert/tmp', mkdtempSync: p => `${p}${++directories}`,
      openSync: (_file, flags, mode) => { assert.equal(flags, 'wx'); assert.equal(mode, 0o600); return directories; },
      writeSync: (_fd, text) => Buffer.byteLength(text), closeSync: () => {}, rmSync: () => { removed++; },
      exec: (_bin, argv, options, done) => {
        commands++; argvs.push(argv); assert.equal(options.shell, false); assert.equal(options.cwd, DEPLOYMENT);
        if (lostFirst && commands === 1) done({ killed: true }, ''); // the first outcome is lost; the retry replays
        else done(raw.ok ? null : { code: 1 }, JSON.stringify(raw));
      } });
  } });
  const prepared = await broker({ action: 'prepare', selector, choices, task: 'inert fixture task' }, () => c);
  assert.equal(prepared.status, 'prepared'); assert.equal(commands, 0);
  let view = await broker({ action: 'apply', spawnRef: prepared.spawnRef }, () => c);
  if (lostFirst) {
    assert.equal(view.status, 'unknown');
    assert.equal((await broker({ action: 'result', spawnRef: prepared.spawnRef }, () => c)).status, 'unknown'); assert.equal(commands, 1);
    view = await broker({ action: 'apply', spawnRef: prepared.spawnRef }, () => c); assert.equal(keys[0], keys[1], 'the retry uses the same key');
  }
  // The Desktop's apply argv carries the same decision flags the kernel was captured with.
  const captured = provenance.files[name].argv, argv = argvs.at(-1);
  const value = (list, flag) => list[list.indexOf(flag) + 1];
  const nameFlag = choices.name ? '--name' : '--purpose';
  assert.equal(argv.includes(choices.name ? '--purpose' : '--name'), false, 'exactly one naming flag');
  for (const flag of ['--dir', '--agents-root', nameFlag]) assert.equal(value(argv, flag), value(captured, flag).replaceAll('<base>', '/fixture/base'), flag);
  assert.equal(value(argv, '--expect-decision'), value(captured, '--expect-decision'));
  assert.ok(argv.includes('--idempotency-key') && argv.includes('--task-file')); assert.equal(argv.includes('--preview'), false);
  assert.equal(removed, directories);
  const projected = spawnApplyView(view, { workspace: target.workspace, ref: prepared.spawnRef, selector });
  assert.ok(projected); assert.deepEqual(projected, view);
  const before = commands; await broker({ action: 'result', spawnRef: prepared.spawnRef }, () => c); assert.equal(commands, before, 'reading a result never re-runs');
  return { raw, view, commands };
}
