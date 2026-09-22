/** Fixed API2 event read transport. Full result/row projection belongs to the
 * owning server boundary; this private envelope never goes directly to IPC. */
import { execFile } from 'node:child_process';
import { parseEnvelope } from './cli-adapter.mjs';
import { record } from './renderer/readiness-contract.mjs';
import { eventsSupported, eventsTarget, eventsLimit, eventsFailure, EVENTS_DEFAULT_LIMIT } from './renderer/instance-events-contract.mjs';
const failure = code => ({ schemaVersion: 1, ok: false, error: eventsFailure(code).reason });
export const EVENTS_CLI_TIMEOUT = 15_000;
export const EVENTS_CLI_MAX_BUFFER = 4 * 1024 * 1024;
/** Admission and full DTO projection belong to the owning server boundary.
 * Defense here still fences the actual exec owner, paths, flags and budgets. */
export function cliInstanceEvents(cli, options = {}, io = {}) {
  if (!eventsSupported(cli)) return Promise.resolve(failure('E_EVENTS_UNAVAILABLE'));
  if (!record(options) || Object.keys(options).some(k => !['target', 'limit'].includes(k))) return Promise.resolve(failure('E_BAD_ARGS'));
  const target = eventsTarget(options.target);
  const limit = Object.hasOwn(options, 'limit') ? eventsLimit(options.limit) : EVENTS_DEFAULT_LIMIT;
  if (!target || limit === null) return Promise.resolve(failure('E_BAD_ARGS'));
  const argv = ['instance', 'events', target.selector.instance, '--dir', target.context, '--home', target.home, '--limit', String(limit), '--json'];
  const env = { ...(io.env ?? process.env) };
  for (const key of ['PI_AGENTS_ROOT', 'OATS_DEPLOYMENT', 'OATS_RESOLUTION']) delete env[key];
  return new Promise(resolve => {
    try {
      (io.exec ?? execFile)(cli.bin, argv, { cwd: target.context, env, shell: false, encoding: 'utf8', timeout: EVENTS_CLI_TIMEOUT, maxBuffer: EVENTS_CLI_MAX_BUFFER }, (err, stdout) => {
        if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve(failure('E_CLI_OUTPUT_LIMIT'));
        if (err?.killed) return resolve(failure('E_CLI_TIMEOUT'));
        if (typeof stdout !== 'string') return resolve(failure(err ? 'E_CLI_FAILED' : 'E_CLI_PROTOCOL'));
        if (Buffer.byteLength(stdout, 'utf8') > EVENTS_CLI_MAX_BUFFER) return resolve(failure('E_CLI_OUTPUT_LIMIT'));
        const doc = parseEnvelope(stdout);
        if (doc?.ok === false) return resolve(failure(doc.error?.code));
        if (err) return resolve(failure('E_CLI_FAILED'));
        // This is a PRIVATE transport envelope, not a renderer/public projection.
        resolve(doc?.ok === true && doc.result?.eventsApi === 2 ? doc : failure('E_CLI_PROTOCOL'));
      });
    } catch { resolve(failure('E_CLI_FAILED')); }
  });
}
