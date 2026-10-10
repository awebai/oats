/** Offline K5 only. No verification, remediation, fallback or kernel import. */
import { execFile } from 'node:child_process';
import { parseEnvelope } from '../client/cli-adapter.mjs';
import { absolute, readinessFailure, readinessTarget } from '../client/readiness-contract.mjs';
const error = code => ({ schemaVersion: 1, ok: false, error: readinessFailure(code).reason });
/** Remote reads: ssh's ConnectTimeout (15 s) plus the command. */
export const REMOTE_READINESS_TIMEOUT = 45_000;
/** `route`: `{server, cwd}` for a remote instance, sent as `--server S --home H` from this machine's cwd.
 * Its agents root is the row's own on the host (admission matched it), never a local path. */
export async function cliReadiness(bin, { target, route } = {}, io = {}) {
  const t = readinessTarget(target);
  if (!absolute(bin) || !t) return error('E_BAD_ARGS');
  const s = t.selector, argv = ['readiness'];
  if (route !== undefined && (s.kind !== 'instance' || s.server !== route?.server || !absolute(route?.cwd))) return error('E_BAD_ARGS');
  if (route === undefined && s.server) return error('E_BAD_ARGS');
  // The subject is an instance (--home) or a soul (--soul), never a scope (readinessApi 2).
  if (route) argv.push('--server', route.server);
  if (s.kind === 'instance') argv.push('--home', t.home, '--soul', s.agent, '--agents-root', s.agentsRoot);
  else argv.push('--dir', t.context, '--soul', s.soul, '--agents-root', s.agentsRoot);
  argv.push('--policy', '--json');
  const env = { ...(io.env ?? process.env) };
  for (const key of ['PI_AGENTS_ROOT', 'OATS_DEPLOYMENT', 'OATS_RESOLUTION']) delete env[key];
  return new Promise(resolve => {
    try {
      (io.exec ?? execFile)(bin, argv, { cwd: route ? route.cwd : t.context, env, encoding: 'utf8', shell: false,
        timeout: route ? REMOTE_READINESS_TIMEOUT : 15_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve(error('E_CLI_OUTPUT_LIMIT'));
        if (err?.killed) return resolve(error('E_CLI_TIMEOUT'));
        const doc = parseEnvelope(stdout);
        // A host's refusal keeps its own code and message (the boundary bounds and shows them).
        if (doc?.ok === false && route) return resolve({ schemaVersion: 1, ok: false, error: { code: doc.error?.code, message: doc.error?.message } });
        if (doc?.ok === false) return resolve(error(doc.error?.code));
        if (err) return resolve(error('E_CLI_FAILED'));
        resolve(doc?.ok === true ? doc : error('E_CLI_PROTOCOL'));
      });
    } catch { resolve(error('E_CLI_FAILED')); }
  });
}
