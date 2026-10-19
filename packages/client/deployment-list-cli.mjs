/** This computer's deployments list, through the kernel (awebai/oats#1390): the four `oats deployments`
 * verbs a client runs, fixed argv, bounded output, the instance environment scrubbed. The answers are
 * read by deployment-list.mjs; only the kernel's JSON crosses back, and a refusal is its code and message.
 *   list    → `oats deployments --json`                                  (cwd /)
 *   add     → `oats deployments add <path> --via <client> --json`         (cwd <path>)
 *   remove  → `oats deployments remove <path> --json`                     (cwd /)
 *   import  → `oats deployments import --from <client> <path>… --json`    (cwd /; no path is a valid call;
 *             each path absolute as the client saved it, which the kernel canonicalizes)
 * Each needs the probe's `deployments-list` feature: without it nothing runs, and nothing falls back to
 * looking at the disk. `/` is the working directory of the verbs that name no deployment, so a client
 * started inside one never has it resolved by the kernel on the way. */
import { execFile } from 'node:child_process';
import { cliEnvironment } from './cli-environment.mjs';
import { withoutInstanceVariables } from './kernel-environment.mjs';
import { absolutePath, deploymentsListSupported, listedPath, readDeploymentAdd, readDeploymentImport, readDeploymentList, readDeploymentRemove } from './deployment-list.mjs';

/** The kernel waits up to 3 s for the list's lock; the rest is a node start and a small file. */
export const DEPLOYMENT_LIST_TIMEOUT = 15_000;
/** The list file is at most 1 MiB; its answer adds a name and a state per row. */
export const DEPLOYMENT_LIST_MAX_BUFFER = 4 * 1024 * 1024;
/** The most paths one import names: an argv bound, far above any saved set. A longer import is refused
 * whole, never cut: the caller keeps what it would import. */
export const DEPLOYMENT_IMPORT_MAX = 2000;
/** The clients the kernel takes in `--via` and `--from`. */
const CLIENTS = ['desktop', 'tui'];

const messages = Object.freeze({
  E_CLI_UNAVAILABLE: 'Choose a compatible installed OATS CLI first.',
  E_DEPLOYMENTS_FEATURE: "This oats can't list this computer's deployments. Update oats.",
  E_BAD_ARGS: "The request to this computer's deployments list was not valid.",
  E_CLI_FAILED: "The installed OATS CLI could not change or read this computer's deployments list.",
  E_CLI_PROTOCOL: "The installed OATS CLI returned an invalid answer about this computer's deployments.",
  E_CLI_TIMEOUT: "The installed OATS CLI did not answer about this computer's deployments in time.",
  E_CLI_OUTPUT_LIMIT: "The installed OATS CLI's answer about this computer's deployments was too large.",
});
export const DEPLOYMENT_LIST_FAILURE_CODES = Object.freeze(Object.keys(messages));
const failure = (code) => ({ ok: false, reason: { code, message: messages[code] } });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The argv and working directory of one verb, or null for a request that could not be one. */
export function deploymentListArgv(options) {
  if (!record(options)) return null;
  const keys = Object.keys(options), only = (...allowed) => keys.every((key) => allowed.includes(key));
  switch (options.action) {
    case 'list': return only('action') ? { argv: ['deployments', '--json'], cwd: '/' } : null;
    case 'add':
      if (!only('action', 'path', 'via') || !listedPath(options.path) || !CLIENTS.includes(options.via)) return null;
      return { argv: ['deployments', 'add', options.path, '--via', options.via, '--json'], cwd: options.path };
    case 'remove':
      if (!only('action', 'path') || !listedPath(options.path)) return null;
      return { argv: ['deployments', 'remove', options.path, '--json'], cwd: '/' };
    case 'import':
      if (!only('action', 'from', 'paths') || !CLIENTS.includes(options.from) || !Array.isArray(options.paths)
        || options.paths.length > DEPLOYMENT_IMPORT_MAX || !options.paths.every(absolutePath)) return null;
      return { argv: ['deployments', 'import', '--from', options.from, ...options.paths, '--json'], cwd: '/' };
    default: return null;
  }
}

const READERS = { list: readDeploymentList, add: readDeploymentAdd, remove: readDeploymentRemove, import: readDeploymentImport };

/**
 * Run one verb. `cli` is the client's accepted probe (`{ ok, bin, features }`); `io.exec` its own `execFile`
 * (cli-adapter.mjs `runJson` says what it must keep).
 * @returns {Promise<{ ok: true, value: object } | { ok: false, reason: { code: string, message: string } }>}
 *   `value` is what deployment-list.mjs reads from the answer (the list's `{ ok: true, rows }`, the add's `{ path, added }`, …).
 */
export function cliDeploymentList(cli, options, io = {}) {
  if (cli?.ok !== true || typeof cli.bin !== 'string' || !cli.bin.startsWith('/')) return Promise.resolve(failure('E_CLI_UNAVAILABLE'));
  if (!deploymentsListSupported(cli)) return Promise.resolve(failure('E_DEPLOYMENTS_FEATURE'));
  const plan = deploymentListArgv(options);
  if (!plan) return Promise.resolve(failure('E_BAD_ARGS'));
  const env = withoutInstanceVariables(cliEnvironment(io.env ?? process.env));
  return new Promise((done) => {
    const fail = (code) => done(failure(code));
    try {
      (io.exec ?? execFile)(cli.bin, plan.argv, { cwd: plan.cwd, env, shell: false, encoding: 'utf8', timeout: DEPLOYMENT_LIST_TIMEOUT, maxBuffer: DEPLOYMENT_LIST_MAX_BUFFER }, (error, stdout) => {
        if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return fail('E_CLI_OUTPUT_LIMIT');
        if (error?.killed) return fail('E_CLI_TIMEOUT');
        if (typeof stdout !== 'string') return fail(error ? 'E_CLI_FAILED' : 'E_CLI_PROTOCOL');
        let document;
        try { document = JSON.parse(stdout); } catch { return fail(error ? 'E_CLI_FAILED' : 'E_CLI_PROTOCOL'); }
        if (!record(document) || document.schemaVersion !== 1 || typeof document.ok !== 'boolean') return fail('E_CLI_PROTOCOL');
        if (document.ok === false) {
          const reason = document.error;
          if (!record(reason) || typeof reason.code !== 'string' || !/^E_[A-Z0-9_]{1,62}$/.test(reason.code)
            || typeof reason.message !== 'string' || !reason.message || reason.message.length > 8192) return fail('E_CLI_PROTOCOL');
          // A refusal is a nonzero exit; a success exit cannot carry one.
          return error ? done({ ok: false, reason: { code: reason.code, message: reason.message } }) : fail('E_CLI_PROTOCOL');
        }
        if (error) return fail('E_CLI_FAILED'); // success is exit 0 only
        const value = READERS[options.action](document.result);
        if (!value || value.ok === false) return fail('E_CLI_PROTOCOL');
        done({ ok: true, value });
      });
    } catch { fail('E_CLI_FAILED'); }
  });
}
