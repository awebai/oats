// A spawned home recorded as launched on a private tmux server, and that server: started, killed or
// left without its socket file, as a reboot or a crash leaves it. Real tmux, on sockets the test names;
// never the user's default server.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inheritedEnv, waitUntil } from "./host-fixture.mjs";

export const SESSION = "oats-agents";
// Every server a test started: { socket, pid }. endServers ends what is still alive by its own pid.
const servers = [];

// A server holds the environment of the client that started it: never the runner's session
// (host-fixture.mjs inheritedEnv), or the kernel would read the runner's display or pane from the
// server a home records.
export const tmuxOn = (socket, ...args) => execFileSync("tmux", ["-f", "/dev/null", "-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"], env: inheritedEnv() }).trim();
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export const windows = (socket) => tmuxOn(socket, "list-windows", "-t", `=${SESSION}`, "-F", "#{window_name}").split("\n").filter(Boolean);

function write(path, content, options) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, options);
}
/** Record `home` as launched in `SESSION:<instance>` on `socket`, in instance.json and in the
 *  independent session receipt (the spawn's retirement baseline), which is the kernel's authority. */
export function recordLaunch(home, instance, socket) {
  const endpoint = { session: SESSION, window: instance, socket };
  const metaPath = join(home, "instance.json");
  write(metaPath, JSON.stringify({ ...JSON.parse(readFileSync(metaPath, "utf8")), launched: true, tmux: endpoint }, null, 2) + "\n");
  const baselinePath = join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);
  write(baselinePath, JSON.stringify({ ...JSON.parse(readFileSync(baselinePath, "utf8")), runtime: { launched: true, tmux: endpoint } }, null, 2) + "\n", { mode: 0o600 });
}
/** Start a server on `socket` whose session holds a keeper window and the instance's window, which
 *  runs `command` (a shell command), in `cwd` when one is given. Returns the server's process id. */
export function startServer(socket, instance, { cwd, command = "sleep 600" } = {}) {
  mkdirSync(dirname(socket), { recursive: true });
  tmuxOn(socket, "new-session", "-d", "-s", SESSION, "-n", "keeper", "sleep 600");
  const pid = Number(tmuxOn(socket, "display-message", "-p", "#{pid}"));
  servers.push({ socket, pid });
  tmuxOn(socket, "new-window", "-d", "-t", `${SESSION}:`, "-n", instance, ...(cwd ? ["-c", cwd] : []), command);
  assert.ok(windows(socket).includes(instance), "the instance's window runs");
  return pid;
}
/** Kill the server on `socket` and wait until its process is gone, so that what a later tmux
 *  client reads is the lost server, never a server that is still exiting. */
export async function killServer(socket) {
  const { pid } = servers.find((s) => s.socket === socket);
  tmuxOn(socket, "kill-server");
  await waitUntil(() => !alive(pid), `the tmux server on ${socket} to exit`);
}
/** End every server a test started that is still running: through its socket, else by its pid. */
export function endServers() {
  for (const { socket, pid } of servers.splice(0)) {
    try { tmuxOn(socket, "kill-server"); } catch { /* gone, or its socket is */ }
    if (alive(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  }
}
