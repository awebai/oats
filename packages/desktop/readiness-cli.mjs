/** Offline K5 only. No verification, remediation, fallback or kernel import. */
import { execFile } from 'node:child_process';
import { parseEnvelope } from './cli-adapter.mjs';
import { absolute, readinessFailure, readinessTarget } from './renderer/readiness-contract.mjs';
const error = code => ({ schemaVersion: 1, ok: false, error: readinessFailure(code).reason });
export async function cliReadiness(bin, { target } = {}, io = {}) {
  const t = readinessTarget(target);
  if (!absolute(bin) || !t) return error('E_BAD_ARGS');
  const s = t.selector, argv = ['readiness'];
  if (s.kind === 'instance') argv.push('--home', t.home, '--soul', s.agent, '--agents-root', s.agentsRoot);
  else {
    argv.push('--dir', t.context);
    if (s.kind === 'soul') argv.push('--soul', s.soul, '--agents-root', s.agentsRoot);
  }
  argv.push('--policy', '--json');
  const env = { ...(io.env ?? process.env) };
  for (const key of ['PI_AGENTS_ROOT', 'OATS_DEPLOYMENT', 'OATS_RESOLUTION']) delete env[key];
  return new Promise(resolve => {
    try {
      (io.exec ?? execFile)(bin, argv, { cwd: t.context, env, encoding: 'utf8', shell: false,
        timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve(error('E_CLI_OUTPUT_LIMIT'));
        if (err?.killed) return resolve(error('E_CLI_TIMEOUT'));
        const doc = parseEnvelope(stdout);
        if (doc?.ok === false) return resolve(error(doc.error?.code));
        if (err) return resolve(error('E_CLI_FAILED'));
        resolve(doc?.ok === true ? doc : error('E_CLI_PROTOCOL'));
      });
    } catch { resolve(error('E_CLI_FAILED')); }
  });
}
