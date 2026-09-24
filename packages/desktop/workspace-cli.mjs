/** Workspace model v2 verbs the Desktop drives: fixed argv, bounded output,
 * scrubbed instance environment. Only the kernel's JSON crosses back; a
 * refusal is its bounded error envelope (code + message, plus onboarding's
 * rolledBack flag), never stderr, argv, stacks or details objects.
 *   capabilities → `oats capabilities --dir D --json`        (capabilitiesApi 1)
 *   souls        → `oats souls --dir D --json`               (soulsApi 1, the spawn catalog)
 *   sync         → `oats sync --dir D --json`                (syncApi 1)
 *   onboard      → `oats onboard DIR --workspace REF --json` (onboardApi 2)
 * There is no package approval (packages-no-approval): declaring a package
 * is the trust decision, so every success exits 0. */
import { execFile } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';

export const WORKSPACE_READ_TIMEOUT = 60_000;
export const WORKSPACE_WRITE_TIMEOUT = 300_000; // discovery reads every member remote
export const WORKSPACE_MAX_BUFFER = 4 * 1024 * 1024;
export const WORKSPACE_ACTIONS = Object.freeze(['capabilities', 'souls', 'sync', 'onboard']);
/** The kernel line this Desktop drives: workspace model v2 without package approval. */
export const WORKSPACE_FEATURES = Object.freeze(['workspace-v2', 'packages-no-approval']);
const SCRUB = ['PI_AGENTS_ROOT', 'PI_AGENT_HOME', 'PI_AGENT_INSTANCE', 'OATS_HOME', 'OATS_INSTANCE_HOME', 'OATS_INSTANCE', 'OATS_DEPLOYMENT', 'OATS_RESOLUTION'];
const absolute = path => typeof path === 'string' && !path.includes('\0') && isAbsolute(path) && resolve(path) === path;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/** A repository reference is the kernel's to parse (E_REPO_REF); the Desktop
 * only refuses what could not be one argv value: empty, huge, control
 * characters or an option-looking token. */
export const validWorkspaceRef = ref => typeof ref === 'string' && ref.length > 0 && ref.length <= 2048
  && ref.trim() === ref && !/[\u0000-\u001f\u007f]/.test(ref) && !ref.startsWith('-');

export function workspaceFailure(code, message) {
  const messages = {
    E_CLI_UNAVAILABLE: 'Choose a compatible installed OATS CLI first.',
    E_WORKSPACE_FEATURE: 'The installed OATS CLI is older than this Desktop (it does not advertise workspace-v2 and packages-no-approval). Update OATS and retry.',
    E_BAD_ARGS: 'The workspace request was not valid.',
    E_CLI_FAILED: 'The installed OATS CLI could not complete this workspace command.',
    E_CLI_PROTOCOL: 'The installed OATS CLI returned an invalid workspace result.',
    E_CLI_TIMEOUT: 'The workspace command exceeded its time limit.',
    E_CLI_OUTPUT_LIMIT: 'The workspace command exceeded its size limit.',
  };
  const known = Object.hasOwn(messages, code) ? code : 'E_CLI_FAILED';
  return { ok: false, reason: { code: known, message: message || messages[known] } };
}

/** Probe facts only (version --json): the API integer and the feature. */
export function workspaceGate(cli) {
  if (cli?.ok !== true || !absolute(cli.bin)) return workspaceFailure('E_CLI_UNAVAILABLE');
  if (cli.workspaceApi !== 2 || !Array.isArray(cli.features) || !WORKSPACE_FEATURES.every(name => cli.features.includes(name))) return workspaceFailure('E_WORKSPACE_FEATURE');
  return null;
}

export function workspaceArgv(options) {
  if (!record(options) || !WORKSPACE_ACTIONS.includes(options.action)) return null;
  const { action } = options;
  const allowed = { capabilities: ['action', 'context'], souls: ['action', 'context'], sync: ['action', 'context'], onboard: ['action', 'dir', 'workspace'] }[action];
  if (Object.keys(options).some(key => !allowed.includes(key))) return null;
  if (action === 'onboard') {
    if (!absolute(options.dir) || !validWorkspaceRef(options.workspace)) return null;
    return { argv: ['onboard', options.dir, '--workspace', options.workspace, '--json'], cwd: options.dir, timeout: WORKSPACE_WRITE_TIMEOUT };
  }
  if (!absolute(options.context)) return null;
  if (action === 'capabilities' || action === 'souls') return { argv: [action, '--dir', options.context, '--json'], cwd: options.context, timeout: WORKSPACE_READ_TIMEOUT };
  return { argv: ['sync', '--dir', options.context, '--json'], cwd: options.context, timeout: WORKSPACE_WRITE_TIMEOUT };
}

export function cliWorkspace(cli, options, io = {}) {
  const gate = workspaceGate(cli);
  if (gate) return Promise.resolve(gate);
  const plan = workspaceArgv(options);
  if (!plan) return Promise.resolve(workspaceFailure('E_BAD_ARGS'));
  const env = { ...(io.env ?? process.env) };
  for (const key of SCRUB) delete env[key];
  return new Promise(done => {
    const fail = code => done(workspaceFailure(code));
    try {
      (io.exec ?? execFile)(cli.bin, plan.argv, { cwd: plan.cwd, env, shell: false, encoding: 'utf8', timeout: plan.timeout, maxBuffer: WORKSPACE_MAX_BUFFER }, (error, stdout) => {
        if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return fail('E_CLI_OUTPUT_LIMIT');
        if (error?.killed) return fail('E_CLI_TIMEOUT');
        if (typeof stdout !== 'string') return fail(error ? 'E_CLI_FAILED' : 'E_CLI_PROTOCOL');
        if (Buffer.byteLength(stdout, 'utf8') > WORKSPACE_MAX_BUFFER) return fail('E_CLI_OUTPUT_LIMIT');
        let document;
        try { document = JSON.parse(stdout); } catch { return fail(error ? 'E_CLI_FAILED' : 'E_CLI_PROTOCOL'); }
        if (!record(document) || document.schemaVersion !== 1 || typeof document.ok !== 'boolean') return fail('E_CLI_PROTOCOL');
        if (document.ok === false) {
          const reason = document.error;
          if (!record(reason) || typeof reason.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(reason.code)
            || typeof reason.message !== 'string' || reason.message.length > 8192) return fail('E_CLI_PROTOCOL');
          // A refusal cannot become success, and a success exit cannot carry one.
          if (!error) return fail('E_CLI_PROTOCOL');
          const out = { code: reason.code, message: reason.message };
          if (options.action === 'onboard' && reason.details?.rolledBack === true) out.rolledBack = true;
          return done({ ok: false, reason: out });
        }
        if (error) return fail('E_CLI_FAILED'); // success is exit 0 only
        done({ ok: true, document });
      });
    } catch { fail('E_CLI_FAILED'); }
  });
}
