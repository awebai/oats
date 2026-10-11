/** Fixed-argv installed-CLI K3 adapter. No kernel import, fallback or raw errors. */
import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { parseEnvelope, parseRetireEnvelope } from './cli-adapter.mjs';
import { object, lifecycleOptions, planRevision } from './lifecycle-contract.mjs';
const absolute = v => typeof v === 'string' && isAbsolute(v) && !v.includes('\0');
const key = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const failure = code => ({ schemaVersion: 1, ok: false, error: { code } });
const serverId = v => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v);
/** Remote reads and plans: ssh's ConnectTimeout (15 s) plus the command. */
export const REMOTE_READ_TIMEOUT = 45_000;
/** A routed command (`server`) is addressed by `--server S --home H` and never carries `--dir`:
 * the kernel sends the registered workspace. `context` is then only this machine's cwd. */
export function lifecycleArgv(options) {
  if (!object(options) || Object.keys(options).some(k => !['operation', 'phase', 'instance', 'home', 'context', 'server', 'choices', 'revision', 'key'].includes(k))) return null;
  const o = options, choices = lifecycleOptions(o.operation, o.choices);
  if (!choices || !['plan', 'apply'].includes(o.phase) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(o.instance || '')
    || !absolute(o.home) || !absolute(o.context) || (Object.hasOwn(o, 'server') && !serverId(o.server))) return null;
  if (o.phase === 'plan' ? Object.hasOwn(o, 'revision') || Object.hasOwn(o, 'key') : !planRevision(o.revision) || !key(o.key)) return null;
  const args = o.operation === 'stop' ? ['instance', 'stop', o.instance] : ['retire', o.instance];
  if (o.phase === 'plan') args.push('--plan');
  else {
    if (o.operation === 'stop') args.push('--apply');
    args.push('--plan-revision', o.revision, '--idempotency-key', o.key);
    if (o.operation === 'retire' && choices.discardWorktree) args.push('--discard-worktree');
  }
  args.push('--home', o.home, ...(o.server ? ['--server', o.server] : ['--dir', o.context]));
  if (o.operation === 'stop' && !choices.recursive) args.push('--no-recursive');
  args.push('--json'); return args;
}
export function cliLifecycle(bin, options, { exec = execFile, timeout } = {}) {
  const argv = lifecycleArgv(options);
  if (!absolute(bin) || !argv) return Promise.resolve(failure('E_BAD_ARGS'));
  const apply = options.phase === 'apply', limit = apply ? 600_000 : options.server ? REMOTE_READ_TIMEOUT : 30_000;
  return new Promise(resolve => {
    try {
      exec(bin, argv, { cwd: options.context, encoding: 'utf8', shell: false,
        timeout: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, limit) : limit,
        maxBuffer: (apply ? 4 : 1) * 1024 * 1024 }, (error, stdout) => {
        if (error?.killed) return resolve(failure('E_CLI_TIMEOUT'));
        if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve(failure('E_CLI_OUTPUT_LIMIT'));
        const value = apply && options.operation === 'retire' ? parseRetireEnvelope(stdout) : parseEnvelope(stdout);
        if (!value) return resolve(failure('E_CLI_PROTOCOL'));
        if (error && value.ok !== false) return resolve(failure('E_CLI_FAILED'));
        // Only internal consumers see result/details. They validate/project all
        // data against their admitted target. An error envelope's message is kept, for a
        // local command and a routed one: the boundary shows it only through the display
        // filter, as the refusal's detail. Stderr and the process error never leave here.
        if (value.ok) resolve({ schemaVersion: 1, ok: true, result: value.result });
        else resolve({ schemaVersion: 1, ok: false, ...(value.result ? { result: value.result } : {}),
          error: { code: value.error?.code, message: value.error?.message, details: value.error?.details } });
      });
    } catch { resolve(failure('E_CLI_FAILED')); }
  });
}
