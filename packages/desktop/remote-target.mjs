// What is the Desktop's alone around a remote terminal: the gate that bounds its preflights with
// its PTYs, and the environment of its PTY. The preflight, its runner and the attach arguments are
// the shared home's (../client/session-attach.mjs, ../client/terminal-exec.mjs).
import { cliEnvironment } from '../client/cli-environment.mjs';

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

// Preserve the operator's SSH agent and PATH, but not local terminal nesting,
// nor what the Desktop and its packaging added (cli-environment.mjs).
export function remoteTerminalEnvironment(source = process.env) {
  const env = cliEnvironment(source);
  delete env.TMUX;
  delete env.HERDR_SESSION;
  delete env.HERDR_SOCKET_PATH;
  return env;
}
