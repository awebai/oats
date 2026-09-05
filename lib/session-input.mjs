/** Host-local terminal transport. Delivery policy belongs to the caller. */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { inspectHerdr, inputHerdr, herdrCommand } from "./herdr.mjs";

const shells = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "login"]);
function tmux(target, args, { exec = execFileSync, input } = {}) {
  return exec("tmux", ["-S", target.socket, ...args], {
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
    rows = tmux(target, ["list-panes", "-t", `=${target.session}:=${target.window}`, "-F", "#{pane_id}\t#{pane_dead}\t#{pane_current_command}"], io).trim().split("\n").filter(Boolean);
  } catch (e) {
    // A missing window on a reachable server is absence. A lost socket is not.
    if (/can't find (window|session)/i.test(String(e.stderr || ""))) return { backend: "tmux", present: false, state: "stopped" };
    throw e;
  }
  if (!rows.length) return { backend: "tmux", present: false, state: "stopped" };
  if (rows.length !== 1) throw new Error("session window has multiple panes; choose an unsplit agent window");
  const [paneId, dead, command] = rows[0].split("\t");
  if (!/^%\d+$/.test(paneId) || !["0", "1"].includes(dead)) throw new Error("invalid tmux pane response");
  return { backend: "tmux", present: dead === "0", state: dead === "1" ? "stopped" : shells.has(command) ? "shell" : "unknown", paneId };
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
