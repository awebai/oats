/** Dedicated History API3 read transport, not the schedule mutation adapter. */
import { execFile } from 'node:child_process';
import { parseEnvelope } from './cli-adapter.mjs';
import { absolute, record } from './renderer/readiness-contract.mjs';
import { scheduleReadRequest, scheduleReadSupported, scheduleReadFailure } from './renderer/schedule-read-contract.mjs';
export const SCHEDULE_READ_TIMEOUT = 30_000;
export const SCHEDULE_READ_MAX_BUFFER = 4 * 1024 * 1024;
const failure = (code, details) => ({ schemaVersion: 1, ok: false, error: scheduleReadFailure(code, null, details).reason });
/** Only server admission may supply context; syntax checks are not admission.
 * Returned success is PRIVATE transport data, never a renderer projection. */
export function cliScheduleRead(cli, options = {}, io = {}) {
  if (!scheduleReadSupported(cli)) return Promise.resolve(failure('E_SCHEDULE_READ_UNAVAILABLE'));
  if (!record(options) || Object.keys(options).some(k => !['action', 'id', 'context'].includes(k)) || !absolute(options.context)) return Promise.resolve(failure('E_BAD_ARGS'));
  const request = scheduleReadRequest({ action: options.action, ...(Object.hasOwn(options, 'id') ? { id: options.id } : {}) });
  if (!request) return Promise.resolve(failure('E_BAD_ARGS'));
  const context = options.context;
  const argv = ['schedule', request.action, ...(request.action === 'show' ? [request.id] : []), '--dir', context, '--json'];
  const env = { ...(io.env ?? process.env) };
  for (const key of ['PI_AGENTS_ROOT', 'OATS_DEPLOYMENT', 'OATS_RESOLUTION']) delete env[key];
  return new Promise(resolve => {
    try {
      (io.exec ?? execFile)(cli.bin, argv, { cwd: context, env, shell: false, encoding: 'utf8', timeout: SCHEDULE_READ_TIMEOUT, maxBuffer: SCHEDULE_READ_MAX_BUFFER }, (error, stdout) => {
        if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve(failure('E_CLI_OUTPUT_LIMIT'));
        if (error?.killed) return resolve(failure('E_CLI_TIMEOUT'));
        if (typeof stdout !== 'string') return resolve(failure(error ? 'E_CLI_FAILED' : 'E_CLI_PROTOCOL'));
        if (Buffer.byteLength(stdout, 'utf8') > SCHEDULE_READ_MAX_BUFFER) return resolve(failure('E_CLI_OUTPUT_LIMIT'));
        const doc = parseEnvelope(stdout);
        if (doc?.ok === false) return resolve(failure(doc.error?.code, doc.error?.details));
        if (error) return resolve(failure('E_CLI_FAILED'));
        // Check the unambiguous subject contract here. Full definitions/runs/
        // integrity projection belongs to the owning boundary, not this envelope.
        const result = doc?.result;
        const subject = request.action === 'show' ? result?.schedule : result;
        if (doc?.ok !== true || !record(result) || !record(subject) || subject.scope !== context
          || request.action === 'show' && subject.id !== request.id) return resolve(failure('E_CLI_PROTOCOL'));
        resolve(doc);
      });
    } catch { resolve(failure('E_CLI_FAILED')); }
  });
}
