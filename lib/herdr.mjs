/** Herdr 0.8.x host-local session backend. SSH belongs to the CLI router. */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const HERDR_PROTOCOL = 20;
const quote = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function herdrSocket(session = "oats") {
  if (!/^[a-zA-Z0-9_-]+$/.test(session)) throw new Error("invalid Herdr session name");
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "herdr", "sessions", session, "herdr.sock");
}

export function herdrCommand(target, args, { timeout = 10000, exec = execFileSync } = {}) {
  const env = { ...process.env, HERDR_SOCKET_PATH: target.socket };
  delete env.HERDR_SESSION;
  const output = exec(target.binary || "herdr", args, { env, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  // Some successful terminal mutations have no output; reads below require
  // their documented result shape independently.
  if (!output.trim()) return {};
  const response = JSON.parse(output);
  if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code });
  if (!response.result) throw new Error("Herdr returned no result");
  return response.result;
}

export function herdrSnapshot(target, io) {
  const snapshot = herdrCommand(target, ["api", "snapshot"], io).snapshot;
  if (snapshot?.protocol !== HERDR_PROTOCOL || !Array.isArray(snapshot.panes)) {
    throw new Error(`unsupported Herdr protocol ${snapshot?.protocol}; OATS requires ${HERDR_PROTOCOL}`);
  }
  return snapshot;
}

export function ensureHerdr({ binary = "herdr", socket, session = "oats" } = {}) {
  const target = { backend: "herdr", binary, socket: resolve(socket || herdrSocket(session)), protocol: HERDR_PROTOCOL };
  try { herdrSnapshot(target); return target; }
  catch (e) {
    // An explicit socket belongs to an operator-managed server. Never start a
    // different server when it cannot be inspected or is incompatible.
    if (socket || existsSync(target.socket)) throw e;
  }
  mkdirSync(dirname(target.socket), { recursive: true });
  const env = { ...process.env };
  delete env.HERDR_SESSION; delete env.HERDR_SOCKET_PATH;
  const child = spawn(binary, ["--session", session, "server"], { detached: true, stdio: "ignore", env });
  child.on("error", () => {});
  child.unref();
  let error;
  for (let i = 0; i < 30; i++) {
    pause(100);
    try { herdrSnapshot(target); return target; } catch (e) { error = e; }
  }
  throw new Error(`Herdr did not start: ${error?.message || "no socket"}`);
}

export function allocateHerdr(target, { home, instance }, io) {
  const result = herdrCommand(target, ["workspace", "create", "--cwd", home, "--label", instance, "--no-focus"], io);
  const pane = result.root_pane;
  if (!pane?.pane_id || !pane?.terminal_id || !pane?.workspace_id) throw new Error("Herdr allocation returned no session identity");
  return { ...target, workspaceId: pane.workspace_id, paneId: pane.pane_id, terminalId: pane.terminal_id };
}

export function inspectHerdr(target, io) {
  const snapshot = herdrSnapshot(target, io);
  const pane = snapshot.panes.find((p) => p.pane_id === target.paneId && p.terminal_id === target.terminalId);
  const agent = pane && snapshot.agents?.find((a) => a.terminal_id === target.terminalId);
  return { present: !!pane, pane, agent, status: agent?.agent_status || "unknown" };
}

export function launchHerdr(target, command, io) {
  if (!inspectHerdr(target, io).present) throw new Error("Herdr launch pane disappeared");
  // This is the allocated shell's one launch command. Exec avoids a fallback
  // shell that could accidentally consume a subsequent agent notification.
  herdrCommand(target, ["pane", "run", target.paneId, `exec /bin/sh -c ${quote(command)}`], io);
}

export function stopHerdr(target, io) {
  if (!inspectHerdr(target, io).present) return;
  try { herdrCommand(target, ["pane", "close", target.paneId], io); } catch { /* inspect the effect even if the pane exited concurrently */ }
  if (inspectHerdr(target, io).present) throw new Error(`Herdr pane ${target.paneId} is still present`);
}

export function inputHerdr(target, text, io) {
  if (!inspectHerdr(target, io).present) throw new Error("Herdr session stopped or was replaced");
  herdrCommand(target, ["pane", "run", target.paneId, text], io);
}

export function validHerdrTarget(value) {
  return value?.backend === "herdr" && value.protocol === HERDR_PROTOCOL
    && [value.socket, value.binary, value.workspaceId, value.paneId, value.terminalId].every((v) => typeof v === "string" && v.length > 0)
    && value.socket === resolve(value.socket);
}
