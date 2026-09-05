// Desktop's read/attach-only Herdr adapter. Lifecycle belongs to installed oats.
import { isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
export function herdrTargetKey(target) {
  if (target?.backend !== "herdr" || target.protocol !== 20
    || typeof target.socket !== "string" || !isAbsolute(target.socket)
    || typeof target.paneId !== "string" || !/^w\d+:p\d+$/.test(target.paneId)
    || typeof target.terminalId !== "string" || !/^term_[a-zA-Z0-9]+$/.test(target.terminalId)) {
    throw new Error("invalid Herdr terminal target");
  }
  return JSON.stringify(["herdr", target.socket, target.terminalId]);
}
export function herdrEnvironment(target) {
  const env = { ...process.env, HERDR_SOCKET_PATH: target.socket };
  delete env.HERDR_SESSION;
  return env;
}
export function readHerdrTarget(target, exec = execFileSync) {
  herdrTargetKey(target);
  // Executable selection is host-owned. A renderer or instance.json cannot
  // nominate an arbitrary binary for the privileged Desktop process to run.
  const response = JSON.parse(exec("herdr", ["api", "snapshot"], {
    env: herdrEnvironment(target), encoding: "utf8", timeout: 4000, maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }));
  const snapshot = response.result?.snapshot;
  if (snapshot?.protocol !== 20 || !Array.isArray(snapshot.panes)) throw new Error("Herdr snapshot unavailable or incompatible");
  const pane = snapshot.panes.find((p) => p.pane_id === target.paneId && p.terminal_id === target.terminalId);
  return { present: !!pane, status: snapshot.agents?.find((a) => a.terminal_id === target.terminalId)?.agent_status || "unknown" };
}
export function openHerdrTerm({ sessionTarget, cols, rows }, { inspect = readHerdrTarget, spawnPty }) {
  if (!inspect(sessionTarget).present) throw new Error("Herdr terminal no longer exists");
  const pty = spawnPty(["terminal", "attach", sessionTarget.terminalId], cols, rows, herdrEnvironment(sessionTarget));
  // Closing the local PTY detaches this viewer. Never stop the remote terminal.
  return { pty, killViewer: () => {} };
}
