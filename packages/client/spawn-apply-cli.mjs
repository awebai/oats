/** Private K6e transport. Only the server broker supplies an admitted immutable intent.
 * started is conservative dispatch evidence, NOT a creation/rollback receipt.
 * The broker must qualify a success receipt before exposing it or handing off. */
import { retainedSpawnDetails } from './launch-prompt-outcome.mjs';
import { execFile } from 'node:child_process';
import { parseEnvelope, writeTaskFile } from './cli-adapter.mjs';
import { absolute, record, previewTarget, choiceArgv } from './spawn-preview-contract.mjs';
import { spawnDecision } from './spawn-decision.mjs';
import { spawnApplySupported, spawnApplyChoicesSupported, spawnPrepareInput, spawnReference, spawnApplyReason, spawnApplyDeadline,
  SPAWN_APPLY_MS, ROLLED_BACK_CODES } from './spawn-apply-contract.mjs';
const failure = (code, started = false) => ({ started, envelope: { schemaVersion: 1, ok: false, error: spawnApplyReason(code) } });
const named = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(v);
const worktreeEvent = cli => Array.isArray(cli?.features) && cli.features.includes('worktree-event');
/** After our deadline's SIGTERM, a worktree-event kernel rolls the spawn back and prints its envelope;
 * a CLI still running this long after it is killed (SIGKILL) and its outcome is unknown. */
export const SIGTERM_GRACE_MS = 20000;
function refusal(doc, cli) {
  // worktree-event: the three rolled-back codes keep the kernel's own message (it names the
  // capability and its log), and whether its compensation was confirmed.
  const rolledBack = worktreeEvent(cli) && ROLLED_BACK_CODES.includes(doc.error?.code);
  const error = spawnApplyReason(doc.error?.code, rolledBack ? doc.error?.message : undefined);
  let details;
  if (rolledBack) {
    if (doc.error?.details?.unconfirmed === true) details = { unconfirmed: true };
  } else if (error.code === 'E_DECISION_STALE') {
    const decision = spawnDecision(doc.error?.details?.decision, { effectiveRequired: true });
    if (!decision) return failure('E_CLI_PROTOCOL', true);
    details = { decision };
  } else if (error.code === 'E_SPAWN_INCOMPLETE') {
    details = retainedSpawnDetails(doc.error?.details);
    if (!details) return failure('E_CLI_PROTOCOL', true);
  } else if (['E_IDEMPOTENCY_CONFLICT', 'E_PLACEMENT_TAKEN', 'E_INSTANCE_NAME_TAKEN'].includes(error.code)) {
    const d = doc.error?.details;
    if (!record(d) || !named(d.instance) || !absolute(d.home)) return failure('E_CLI_PROTOCOL', true);
    details = { instance: d.instance, home: d.home };
  }
  return { started: true, envelope: { schemaVersion: 1, ok: false, error: { ...error, ...(details ? { details } : {}) } } };
}
export async function cliSpawnApply(cli, options = {}, io = {}) {
  // Repeat the complete positive mode fence here, before even creating inputs.
  if (!spawnApplySupported(cli)) return failure('E_APPLY_UNAVAILABLE');
  if (!record(options) || Object.keys(options).some(k => !['target', 'choices', 'task', 'wake', 'decision', 'key', 'deadlineMs'].includes(k))) return failure('E_BAD_ARGS');
  // The broker derives the deadline from the confirmed preview (spawnApplyDeadlineMs); 60 s without one.
  const timeout = options.deadlineMs ?? SPAWN_APPLY_MS;
  if (!spawnApplyDeadline(timeout)) return failure('E_BAD_ARGS');
  const target = previewTarget(options.target), decision = spawnDecision(options.decision, { effectiveRequired: true });
  const input = spawnPrepareInput({ action: 'prepare', selector: target?.selector, choices: options.choices, task: options.task,
    ...(Object.hasOwn(options, 'wake') ? { wake: options.wake } : {}) });
  if (!target || !decision || !input || !spawnReference(options.key) || decision.effective.work === 'attached') return failure('E_BAD_ARGS');
  if (!spawnApplyChoicesSupported(cli, input.choices, !!input.wake)) return failure('E_UNSUPPORTED_OPTION');
  let taskFile, wakeFile, started = false;
  try {
    taskFile = writeTaskFile(input.task, io);
    if (input.wake) wakeFile = writeTaskFile(JSON.stringify(input.wake), io);
    const choices = input.choices;
    const argv = ['spawn', target.selector.soul, '--dir', target.context, '--agents-root', target.selector.agentsRoot, ...choiceArgv(choices, cli)];
    argv.push('--expect-decision', decision.revision, '--idempotency-key', options.key, '--task-file', taskFile.file);
    if (wakeFile) argv.push('--wake-file', wakeFile.file);
    argv.push('--json');
    const env = { ...(io.env ?? process.env) };
    for (const k of ['PI_AGENTS_ROOT', 'OATS_DEPLOYMENT', 'OATS_RESOLUTION', 'OATS_PREVIEW_PREFLIGHT_BUDGET_MS']) delete env[k];
    // File construction is synchronous; repeat immediately at the process owner
    // too, so even a re-entrant injected dependency cannot downgrade the mode.
    if (!spawnApplySupported(cli)) return failure('E_APPLY_UNAVAILABLE');
    if (!spawnApplyChoicesSupported(cli, choices, !!input.wake)) return failure('E_UNSUPPORTED_OPTION');
    // worktree-event: the deadline is ours, not execFile's. execFile's own timeout destroys the child's
    // output before it signals it, which would lose the envelope a kernel prints after our SIGTERM
    // (E_INTERRUPTED, once its rollback is done). So: SIGTERM at the deadline with the output still read,
    // and SIGKILL only if the CLI is still running SIGTERM_GRACE_MS later. Older kernels keep execFile's.
    const own = worktreeEvent(cli), timer = io.timer ?? ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
    const limit = io.timeoutMs ?? timeout, grace = io.graceMs ?? SIGTERM_GRACE_MS;
    return await new Promise(resolve => {
      let expired = false, settled = false, cancelDeadline = () => {}, cancelGrace = () => {};
      try {
        started = true;
        const child = (io.exec ?? execFile)(cli.bin, argv, { cwd: target.context, env, shell: false, encoding: 'utf8', ...(own ? {} : { timeout: limit }), maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
          settled = true; cancelDeadline(); cancelGrace();
          if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || typeof stdout === 'string' && Buffer.byteLength(stdout) > 4 * 1024 * 1024) return resolve(failure('E_CLI_OUTPUT_LIMIT', true));
          if (err?.killed && !own) return resolve(failure('E_CLI_TIMEOUT', true));
          const doc = typeof stdout === 'string' ? parseEnvelope(stdout) : null;
          // Killed by our deadline: a complete envelope on stdout is the outcome (failure or success,
          // which the broker still qualifies). Only without one is it unknown.
          if (expired || err?.killed) {
            if (!doc) return resolve(failure('E_CLI_TIMEOUT', true));
            return resolve(doc.ok === false ? refusal(doc, cli) : { started: true, envelope: doc });
          }
          if (doc?.ok === false) return resolve(refusal(doc, cli));
          if (err) return resolve(failure('E_CLI_FAILED', true));
          resolve(doc?.ok === true ? { started: true, envelope: doc } : failure('E_CLI_PROTOCOL', true));
        });
        if (own && !settled) cancelDeadline = timer(() => {
          expired = true;
          try { child?.kill('SIGTERM'); } catch { /* already gone */ }
          cancelGrace = timer(() => {
            try { child?.stdout?.destroy(); child?.stderr?.destroy(); child?.kill('SIGKILL'); } catch { /* already gone */ }
          }, grace);
        }, limit);
      } catch { cancelDeadline(); cancelGrace(); resolve(failure('E_CLI_FAILED', true)); }
    });
  } catch { return failure(started ? 'E_CLI_FAILED' : 'E_INPUT_PREPARATION', started); }
  finally { wakeFile?.cleanup(); taskFile?.cleanup(); }
}
