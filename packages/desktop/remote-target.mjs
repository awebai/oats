// Remote terminal addressing is an installed-CLI operation, never a renderer
// supplied SSH command, executable path, socket or server registration.
import { requireRemoteSupport } from "./cli-locator.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export function remoteTargetKey(remote) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(remote?.serverId || "")
    || !/^[a-z0-9][a-z0-9-]*$/.test(remote?.instance || "")) throw new Error("invalid remote terminal target");
  if (remote.home !== undefined && (typeof remote.home !== "string" || !remote.home.startsWith("/") || remote.home.includes("\0"))) throw new Error("invalid remote terminal home");
  return JSON.stringify(["remote", remote.serverId, remote.instance, ...(remote.home ? [remote.home] : [])]);
}
export async function prepareRemoteTerm(cli, remote, { run = exec } = {}) {
  requireRemoteSupport(cli, "session");
  const bin = cli.bin;
  remoteTargetKey(remote);
  const address = ["--server", remote.serverId, "--instance", remote.instance, ...(remote.home ? ["--home", remote.home] : [])];
  const { stdout } = await run(bin, ["session", "inspect", ...address, "--json"], {
    encoding: "utf8", timeout: 20000, maxBuffer: 1024 * 1024,
  });
  const envelope = JSON.parse(stdout);
  if (envelope.schemaVersion !== 1 || envelope.ok !== true) throw new Error(envelope.error?.message || "remote session inspection failed");
  if (!envelope.result?.present) throw new Error("remote terminal no longer exists");
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
