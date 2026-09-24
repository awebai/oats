/** Bounded fixed-argv native deployment reads. Private producer documents are
 * projected by the owning observer, never forwarded wholesale to a renderer. */
import { execFile } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { deploymentReadGate, deploymentFailure, deploymentRecord } from './renderer/deployment-contract.mjs';

export const DEPLOYMENT_READ_TIMEOUT = 30_000;
export const DEPLOYMENT_READ_MAX_BUFFER = 4 * 1024 * 1024;
const absolute = path => typeof path === 'string' && !path.includes('\0') && isAbsolute(path) && resolve(path) === path;

/** `status` is a raw object; `workspace status` is a schemaVersion:1 envelope.
 * Those are distinct native command contracts, not interchangeable generations. */
export function cliDeploymentRead(cli, options, io = {}) {
  const action = options?.action;
  const gate = deploymentReadGate(cli, action);
  if (gate) return Promise.resolve(gate);
  if (!absolute(cli.bin) || !deploymentRecord(options) || Object.keys(options).some(k => !['action', 'context'].includes(k))
    || !absolute(options.context)) return Promise.resolve(deploymentFailure('E_BAD_ARGS'));
  const context = options.context, bin = cli.bin;
  const argv = [...(action === 'status' ? ['status'] : ['workspace', 'status']), '--dir', context, '--json'];
  const env = { ...(io.env ?? process.env) };
  for (const key of ['PI_AGENTS_ROOT', 'PI_AGENT_HOME', 'PI_AGENT_INSTANCE', 'OATS_HOME', 'OATS_INSTANCE_HOME', 'OATS_INSTANCE', 'OATS_DEPLOYMENT', 'OATS_RESOLUTION']) delete env[key];
  return new Promise(done => {
    const fail = code => done(deploymentFailure(code));
    try {
      (io.exec ?? execFile)(bin, argv, { cwd: context, env, shell: false, encoding: 'utf8', timeout: DEPLOYMENT_READ_TIMEOUT, maxBuffer: DEPLOYMENT_READ_MAX_BUFFER }, (error, stdout) => {
        if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return fail('E_CLI_OUTPUT_LIMIT');
        if (error?.killed) return fail('E_CLI_TIMEOUT');
        if (typeof stdout !== 'string') return fail(error ? 'E_CLI_FAILED' : 'E_CLI_PROTOCOL');
        if (Buffer.byteLength(stdout, 'utf8') > DEPLOYMENT_READ_MAX_BUFFER) return fail('E_CLI_OUTPUT_LIMIT');
        let document;
        try { document = JSON.parse(stdout); } catch { return fail(error ? 'E_CLI_FAILED' : 'E_CLI_PROTOCOL'); }
        if (!deploymentRecord(document)) return fail('E_CLI_PROTOCOL');
        if (document.schemaVersion === 1 && document.ok === false) {
          const reason = document.error;
          if (!deploymentRecord(reason) || typeof reason.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(reason.code)
            || typeof reason.message !== 'string' || reason.message.length > 8192) return fail('E_CLI_PROTOCOL');
          // Only the bounded kernel error envelope, never stderr, argv, stacks,
          // details or an exec error's message. A refusal cannot become success.
          return done({ ok: false, reason: { code: reason.code, message: reason.message } });
        }
        if (error) return fail('E_CLI_FAILED');
        if (action === 'status') {
          if (Object.hasOwn(document, 'schemaVersion') || !absolute(document.root) || !Array.isArray(document.agents)) return fail('E_CLI_PROTOCOL');
        } else if (document.schemaVersion !== 1 || document.ok !== true || document.result?.workspaceStatusApi !== 1) return fail('E_CLI_PROTOCOL');
        done({ ok: true, document });
      });
    } catch { fail('E_CLI_FAILED'); }
  });
}
