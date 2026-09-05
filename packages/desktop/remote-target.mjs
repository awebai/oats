// Remote terminal addressing is an installed-CLI operation, never a renderer
// supplied SSH command, executable path, socket or server registration.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export function remoteTargetKey(remote) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(remote?.serverId || "")
    || !/^[a-z0-9][a-z0-9-]*$/.test(remote?.instance || "")) throw new Error("invalid remote terminal target");
  return JSON.stringify(["remote", remote.serverId, remote.instance]);
}
export async function prepareRemoteTerm(bin, remote, { run = exec } = {}) {
  remoteTargetKey(remote);
  const address = ["--server", remote.serverId, "--instance", remote.instance];
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
