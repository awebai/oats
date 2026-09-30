// Remote terminal addressing is an installed-CLI operation, never a renderer
// supplied SSH command, executable path, socket or server registration.
import { requireRemoteSupport } from "./cli-locator.mjs";
import { runTerminalCommand } from './terminal-exec.mjs';
import { HERDR_REMOVED } from './renderer/terminal-contract.mjs';

const coded = (code, message) => Object.assign(new Error(message), { code });
const herdrRemoved = message => coded('E_HERDR_REMOVED', message);
const unreachable = () => coded('E_TERM_REMOTE_UNREACHABLE', 'the remote server could not be reached');
/** The CLI's JSON envelope, or null when it printed none. */
function envelopeOf(stdout) {
  let envelope;
  try { envelope = JSON.parse(stdout); } catch { return null; }
  return envelope?.schemaVersion === 1 && typeof envelope.ok === 'boolean' ? envelope : null;
}
/** A refusal envelope as a coded error. The CLI reports ssh's own failure as E_SSH (a transport
 * failure); a 0.31 kernel's E_HERDR_REMOVED keeps its message; any other refusal keeps the host's code. */
function refusal(envelope) {
  const { code, message } = envelope.error || {};
  if (code === 'E_SSH') return unreachable();
  if (code === 'E_HERDR_REMOVED') return herdrRemoved(typeof message === 'string' && message ? message : HERDR_REMOVED);
  return coded(typeof code === 'string' && code ? code : 'E_TERM_OPEN_FAILED', message || 'remote session inspection failed');
}

export function remoteTargetKey(remote) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(remote?.serverId || "")
    || !/^[a-z0-9][a-z0-9-]*$/.test(remote?.instance || "")) throw new Error("invalid remote terminal target");
  if (remote.home !== undefined && (typeof remote.home !== "string" || !remote.home.startsWith("/") || remote.home.includes("\0"))) throw new Error("invalid remote terminal home");
  return JSON.stringify(["remote", remote.serverId, remote.instance, ...(remote.home ? [remote.home] : [])]);
}
export async function prepareRemoteTerm(cli, remote, { run = runTerminalCommand, signal, current = () => true } = {}) {
  const check = () => { if (signal?.aborted || !current()) throw Object.assign(new Error('Terminal context changed'), { code: 'E_TERM_CONTEXT_CHANGED' }); };
  check();
  requireRemoteSupport(cli, "session");
  const bin = cli.bin;
  remoteTargetKey(remote);
  const address = ["--server", remote.serverId, "--instance", remote.instance, ...(remote.home ? ["--home", remote.home] : [])];
  check(); // actual execution owner, not only IPC admission
  let stdout;
  try {
    ({ stdout } = await run(bin, ["session", "inspect", ...address, "--json"], {
      encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024, shell: false, ...(signal ? { signal } : {}),
    }));
  } catch (error) {
    check();
    const envelope = typeof error?.stdout === 'string' ? envelopeOf(error.stdout) : null;
    if (envelope && !envelope.ok) throw refusal(envelope);
    // Killed by execFile at the deadline: a stalled link outlives ssh's keepalives (about 45 s),
    // so it is a timeout. A CLI that ended without a refusal, by a nonzero exit (255 included) or
    // a signal of its own, gave no answer: ssh's own failures arrive as E_SSH, so this is more
    // likely the local CLI. A CLI that never started keeps its own error.
    if (error?.killed) throw coded('E_TERM_PREPARE_TIMEOUT', 'remote session inspection timed out');
    if (Number.isInteger(error?.code) || error?.signal) throw coded('E_TERM_REMOTE_NO_ANSWER', 'the local oats gave no answer');
    throw error;
  }
  check();
  const envelope = envelopeOf(stdout);
  if (!envelope) throw new Error("remote session inspection answered no envelope");
  if (!envelope.ok) throw refusal(envelope);
  // A 0.31 kernel refuses a Herdr-recorded instance; an older one still reports its live Herdr
  // session. Neither is attached: the refusal keeps its code so the broker reports it.
  if (envelope.result?.backend === 'herdr') throw herdrRemoved(HERDR_REMOVED);
  if (envelope.result?.present !== true) throw coded('E_TERM_REMOTE_GONE', "remote terminal no longer exists");
  return { binary: bin, args: ["session", "attach", ...address] };
}

/** Bound asynchronous preflights as well as PTYs; duplicate requests share work. */
export function createTerminalPrepareGate(registry, max) {
  const pending = new Map();
  return {
    async prepare(key, load) {
      if (pending.has(key)) return pending.get(key);
      if (registry.activeCount() + pending.size >= max) return { capped: true, active: registry.activeCount(), max };
      const work = Promise.resolve().then(load);
      pending.set(key, work);
      try { return await work; } finally { pending.delete(key); }
    },
    pendingCount() { return pending.size; },
  };
}

// Preserve the operator's SSH agent and PATH, but not local terminal nesting.
export function remoteTerminalEnvironment(source = process.env) {
  const env = { ...source };
  delete env.TMUX;
  delete env.HERDR_SESSION;
  delete env.HERDR_SOCKET_PATH;
  return env;
}
