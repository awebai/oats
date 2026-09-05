/** Host-local terminal transport. Delivery policy belongs to the caller. */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { inspectHerdr, inputHerdr, herdrCommand } from "./herdr.mjs";

const shells = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "login"]);
function tmux(target, args, { exec = execFileSync, input } = {}) {
  // launchd does not supply a UTF-8 locale. In that environment tmux replaces
  // the tab delimiters in list-panes output with underscores unless forced.
  return exec("tmux", ["-u", "-S", target.socket, ...args], {
    encoding: "utf8", input, timeout: 10000, maxBuffer: 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
export function inspectSessionTarget(target, io) {
  if (target.backend === "herdr") {
    const s = inspectHerdr(target, io);
    let state = s.present ? s.status : "stopped";
    if (s.present && !s.agent) {
      const processes = herdrCommand(target, ["pane", "process-info", "--pane", target.paneId], io).process_info?.foreground_processes;
      if (!Array.isArray(processes)) throw new Error("Herdr returned no process information");
      if (!processes.length || processes.every((p) => shells.has(p.name))) state = "shell";
    }
    return { backend: "herdr", present: s.present, state, terminalId: target.terminalId };
  }
  let rows;
  try {
    rows = tmux(target, ["list-panes", "-t", `=${target.session}:=${target.window}`, "-F", "#{pane_id}\t#{pane_dead}\t#{pane_current_command}\t#{pane_pid}"], io).trim().split("\n").filter(Boolean);
  } catch (e) {
    // A missing window on a reachable server is absence. A lost socket is not.
    if (/can't find (window|session)/i.test(String(e.stderr || ""))) return { backend: "tmux", present: false, state: "stopped" };
    throw e;
  }
  if (!rows.length) return { backend: "tmux", present: false, state: "stopped" };
  if (rows.length !== 1) throw new Error("session window has multiple panes; choose an unsplit agent window");
  const [paneId, dead, command, panePid] = rows[0].split("\t");
  if (!/^%\d+$/.test(paneId) || !["0", "1"].includes(dead)) throw new Error("invalid tmux pane response");
  let state = dead === "1" ? "stopped" : "unknown";
  if (dead === "0" && shells.has(command)) {
    // macOS tmux can report the wrapper shell while the harness is its child.
    // Only a shell with no non-shell descendants is a fallback prompt.
    if (!/^\d+$/.test(panePid)) throw new Error("tmux returned no pane process id");
    const output = (io?.exec || execFileSync)("ps", ["-axo", "pid=,ppid=,comm="], {
      encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
    const processes = output.split("\n").map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean);
    const descendants = new Set([panePid]);
    let active = false;
    for (let changed = true; changed;) {
      changed = false;
      for (const [, pid, parent, name] of processes) {
        if (descendants.has(parent) && !descendants.has(pid)) {
          descendants.add(pid); changed = true;
          if (!shells.has(basename(name).replace(/^-/, ""))) active = true;
        }
      }
    }
    state = active ? "unknown" : "shell";
  }
  return { backend: "tmux", present: dead === "0", state, paneId };
}
export function inputSessionTarget(target, text, io) {
  const state = inspectSessionTarget(target, io);
  if (!state.present || state.state === "shell") throw new Error(`cannot submit input: session is ${state.state}`);
  if (target.backend === "herdr") inputHerdr(target, text, io);
  else {
    // Bracketed paste preserves multiline input as one user message. No text
    // is evaluated by a shell or interpreted as tmux key names.
    const buffer = `oats-${randomUUID()}`;
    try {
      tmux(target, ["load-buffer", "-b", buffer, "-"], { ...io, input: text });
      tmux(target, ["paste-buffer", "-p", "-b", buffer, "-t", state.paneId], io);
      tmux(target, ["send-keys", "-t", state.paneId, "Enter"], io);
    } finally {
      try { tmux(target, ["delete-buffer", "-b", buffer], io); } catch { /* already consumed or disconnected */ }
    }
  }
  return { ...state, submitted: true };
}
