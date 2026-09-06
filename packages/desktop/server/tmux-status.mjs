import { execFileSync } from "node:child_process";
import { basename } from "node:path";

const shells = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "login"]);

/** One read per socket, and at most one process snapshot per roster collection. */
export function createTmuxStatusReader({ exec = execFileSync } = {}) {
  const sockets = new Map();
  let processes;
  const run = (bin, args) => exec(bin, args, {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 4000, maxBuffer: 4 * 1024 * 1024,
  });
  function readSocket(socket) {
    if (!sockets.has(socket)) {
      try {
        const text = run("tmux", ["-u", ...(socket ? ["-S", socket] : []), "list-panes", "-a", "-F",
          "#{session_name}\t#{window_name}\t#{window_id}\t#{pane_dead}\t#{pane_current_command}\t#{pane_pid}"]);
        const panes = text.trim().split("\n").filter(Boolean).map((line) => {
          const [session, window, id, dead, command, pid] = line.split("\t");
          if (!session || !window || !/^@\d+$/.test(id) || !/^[01]$/.test(dead) || !/^\d+$/.test(pid)) throw new Error("Invalid tmux status response");
          return { session, window, id, dead: dead === "1", command, pid };
        });
        sockets.set(socket, { panes });
      } catch (e) {
        const absent = /no server running|error connecting.*No such file or directory/i.test(String(e.stderr || ""));
        sockets.set(socket, absent ? { panes: [] } : { error: e.message || "Cannot reach terminal server" });
      }
    }
    return sockets.get(socket);
  }
  function hasHarness(pid) {
    if (!processes) {
      processes = run("ps", ["-axo", "pid=,ppid=,comm="]).split("\n")
        .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
    }
    const descendants = new Set([pid]);
    for (let changed = true; changed;) {
      changed = false;
      for (const [, child, parent, name] of processes) {
        if (!descendants.has(parent) || descendants.has(child)) continue;
        descendants.add(child); changed = true;
        if (!shells.has(basename(name).replace(/^-/, ""))) return true;
      }
    }
    return false;
  }
  return (meta, defaultSession = "pi-agents") => {
    const tmux = { ...meta.tmux, session: meta.tmux?.session || defaultSession, window: meta.tmux?.window || meta.instance };
    const status = readSocket(tmux.socket || "");
    const unknown = (error) => ({ tmux, running: null, runtimeState: "unreachable", runtimeError: error });
    if (status.error) return unknown(status.error);
    const panes = status.panes.filter((p) => p.session === tmux.session && p.window === tmux.window);
    if (panes.length > 1) return unknown("Instance window has multiple panes; check its terminal before starting");
    const pane = panes[0];
    if (!pane || pane.dead) return { tmux, running: false, runtimeState: "stopped" };
    tmux.id = pane.id;
    try {
      const running = !shells.has(pane.command.replace(/^-/, "")) || hasHarness(pane.pid);
      return { tmux, running, runtimeState: running ? "running" : "shell" };
    } catch (e) { return unknown(e.message); }
  };
}
