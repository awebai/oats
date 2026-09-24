/** Private K6e transport. Only the server broker supplies an admitted immutable intent.
 * started is conservative dispatch evidence, NOT a creation/rollback receipt.
 * The broker must qualify a success receipt before exposing it or handing off. */
import { execFile } from 'node:child_process';
import { parseEnvelope, writeTaskFile } from './cli-adapter.mjs';
import { absolute, record, previewTarget, choiceArgv } from './renderer/spawn-preview-contract.mjs';
import { spawnDecision } from './renderer/spawn-decision.mjs';
import { spawnApplySupported, spawnApplyChoicesSupported, spawnPrepareInput, spawnReference, spawnApplyReason } from './renderer/spawn-apply-contract.mjs';
const failure = (code, started = false) => ({ started, envelope: { schemaVersion: 1, ok: false, error: spawnApplyReason(code) } });
const named = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(v);
function refusal(doc) {
  const error = spawnApplyReason(doc.error?.code);
  let details;
  if (error.code === 'E_DECISION_STALE') {
    const decision = spawnDecision(doc.error?.details?.decision, { effectiveRequired: true });
    if (!decision) return failure('E_CLI_PROTOCOL', true);
    details = { decision };
  } else if (['E_IDEMPOTENCY_CONFLICT', 'E_PLACEMENT_TAKEN', 'E_INSTANCE_NAME_TAKEN', 'E_SPAWN_INCOMPLETE'].includes(error.code)) {
    const d = doc.error?.details;
    if (!record(d) || !named(d.instance) || !absolute(d.home)
      || error.code === 'E_SPAWN_INCOMPLETE' && ![false, 'unknown'].includes(d.launched)) return failure('E_CLI_PROTOCOL', true);
    details = { instance: d.instance, home: d.home, ...(error.code === 'E_SPAWN_INCOMPLETE' ? { launched: d.launched } : {}) };
  }
  return { started: true, envelope: { schemaVersion: 1, ok: false, error: { ...error, ...(details ? { details } : {}) } } };
}
export async function cliSpawnApply(cli, options = {}, io = {}) {
  // Repeat the complete positive mode fence here, before even creating inputs.
  if (!spawnApplySupported(cli)) return failure('E_APPLY_UNAVAILABLE');
  if (!record(options) || Object.keys(options).some(k => !['target', 'choices', 'task', 'wake', 'decision', 'key'].includes(k))) return failure('E_BAD_ARGS');
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
    const argv = ['spawn', target.selector.soul, '--dir', target.context, '--agents-root', target.selector.agentsRoot, ...choiceArgv(choices)];
    argv.push('--expect-decision', decision.revision, '--idempotency-key', options.key, '--task-file', taskFile.file);
    if (wakeFile) argv.push('--wake-file', wakeFile.file);
    argv.push('--json');
    const env = { ...(io.env ?? process.env) };
    for (const k of ['PI_AGENTS_ROOT', 'OATS_DEPLOYMENT', 'OATS_RESOLUTION', 'OATS_PREVIEW_PREFLIGHT_BUDGET_MS']) delete env[k];
    // File construction is synchronous; repeat immediately at the process owner
    // too, so even a re-entrant injected dependency cannot downgrade the mode.
    if (!spawnApplySupported(cli)) return failure('E_APPLY_UNAVAILABLE');
    if (!spawnApplyChoicesSupported(cli, choices, !!input.wake)) return failure('E_UNSUPPORTED_OPTION');
    return await new Promise(resolve => {
      try {
        started = true;
        (io.exec ?? execFile)(cli.bin, argv, { cwd: target.context, env, shell: false, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
          if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || typeof stdout === 'string' && Buffer.byteLength(stdout) > 4 * 1024 * 1024) return resolve(failure('E_CLI_OUTPUT_LIMIT', true));
          if (err?.killed) return resolve(failure('E_CLI_TIMEOUT', true));
          const doc = typeof stdout === 'string' ? parseEnvelope(stdout) : null;
          if (doc?.ok === false) return resolve(refusal(doc));
          if (err) return resolve(failure('E_CLI_FAILED', true));
          resolve(doc?.ok === true ? { started: true, envelope: doc } : failure('E_CLI_PROTOCOL', true));
        });
      } catch { resolve(failure('E_CLI_FAILED', true)); }
    });
  } catch { return failure(started ? 'E_CLI_FAILED' : 'E_INPUT_PREPARATION', started); }
  finally { wakeFile?.cleanup(); taskFile?.cleanup(); }
}
