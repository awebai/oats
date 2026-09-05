/** Interactive host-local viewers. Closing a viewer leaves its agent alive. */
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { inspectSessionTarget } from "./session-input.mjs";

export function prepareSessionViewer(target, { exec = execFileSync } = {}) {
  if (!inspectSessionTarget(target, { exec }).present) throw new Error("session no longer exists");
  if (target.backend === "herdr") {
    const env = { ...process.env, HERDR_SOCKET_PATH: target.socket };
    delete env.HERDR_SESSION;
    return { binary: target.binary, args: ["terminal", "attach", target.terminalId], env, cleanup() {} };
  }
  // UTF-8 mode (-u) like the shared session helper: a service without a
  // UTF-8 locale (launchd) otherwise mangles tmux output.
  const run = (args) => exec("tmux", ["-u", "-S", target.socket, ...args], {
    encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const viewer = `oatsview-${process.pid}-${randomUUID().slice(0, 8)}`;
  const cleanup = () => { try { run(["kill-session", "-t", `=${viewer}`]); } catch { /* already detached/ended */ } };
  try {
    const placeholder = run(["new-session", "-d", "-s", viewer, "-P", "-F", "#{window_id}"]);
    if (!/^@\d+$/.test(placeholder)) throw new Error("tmux returned no viewer window id");
    run(["link-window", "-s", `=${target.session}:=${target.window}`, "-t", `=${viewer}:`]);
    run(["kill-window", "-t", placeholder]);
    // One linked window prevents a stale viewer from selecting a sibling agent
    // when this agent retires. Disable window navigation in the viewer only.
    for (const name of ["prefix", "prefix2"]) run(["set-option", "-t", viewer, name, "None"]);
    run(["set-option", "-t", viewer, "key-table", "oatsview-locked"]);
    run(["unbind-key", "-a", "-q", "-T", "oatsview-locked"]);
    run(["bind-key", "-T", "oatsview-locked", "WheelUpPane", "if-shell", "-F", "#{||:#{pane_in_mode},#{mouse_any_flag}}", "send-keys -M", "copy-mode -e; send-keys -M"]);
    run(["set-option", "-t", viewer, "mouse", "on"]);
    const env = { ...process.env }; delete env.TMUX;
    return { binary: "tmux", args: ["-u", "-S", target.socket, "attach-session", "-t", `=${viewer}`], env, cleanup };
  } catch (e) { cleanup(); throw e; }
}

export async function attachSessionTarget(target) {
  const viewer = prepareSessionViewer(target);
  let child;
  const stop = () => { viewer.cleanup(); child?.kill(); };
  const signals = ["SIGHUP", "SIGTERM", "SIGINT"];
  for (const sig of signals) process.on(sig, stop);
  try {
    return await new Promise((resolve, reject) => {
      child = spawn(viewer.binary, viewer.args, { env: viewer.env, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    for (const sig of signals) process.removeListener(sig, stop);
    viewer.cleanup();
  }
}
