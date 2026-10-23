/** A terminal window in the person's desktop session, opened from an agent's shell: `oats tui
 *  --open` and `oats session attach --open` (docs/tui.md, "Open it from an agent";
 *  awebai/oats#1483). The window runs the plain command. Whether a window appeared is never
 *  observed: the answer is that one was requested. */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shellWord } from "./shell-word.mjs";
import { unitPathEntries } from "./stable-node.mjs";
import { systemTool } from "./system-tools.mjs";

const KERNEL_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "oats.mjs");
/** What systemd-run carries from this process to the window: the display, and nothing else. The
 *  unit runs in the user's service manager, whose environment is the desktop session's. */
const SYSTEMD_RUN = ["--user", "--collect", "--quiet", "-p", "KillMode=process", "-E", "DISPLAY", "-E", "WAYLAND_DISPLAY", "-E", "XAUTHORITY"];

/** The command a person types: each word by the kernel's one quoting rule (lib/shell-word.mjs). */
export function plainCommand(argv) { return argv.map(shellWord).join(" "); }

/** The text the window's shell runs: the plain command under `env`, with `dirs` ahead of the
 *  window's own PATH. A window may load no shell startup file, and `env` reads the same in any
 *  login shell, fish's included. */
export function windowCommand(argv, { dirs }) {
  const path = [...new Set(dirs)].map(shellWord).join(":");
  return `env PATH=${path}:"$PATH" ${plainCommand(argv)}`;
}

/** An E_OPEN_UNAVAILABLE: no window was asked for, or the launcher refused. */
function unavailable(why, tried, details = {}) {
  return Object.assign(new Error(why), { code: "E_OPEN_UNAVAILABLE", details: { tried, ...details } });
}

/** How to open a window running `text` on `platform`, with `find(name)` the absolute path of a
 *  tool or null: `{ via, file, args }`, `via` naming what opens the window. macOS asks Terminal
 *  through osascript. Linux needs systemd-run, so the window is the desktop session's and not a
 *  child of the agent, then xdg-terminal-exec, else x-terminal-emulator -e. */
export function terminalLaunch(text, { platform, find }) {
  if (platform === "darwin") {
    const osascript = find("osascript");
    if (!osascript) throw unavailable("no osascript to ask Terminal for a window", ["osascript"]);
    const script = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return { via: "osascript", file: osascript, args: ["-e", `tell application "Terminal" to do script "${script}"`] };
  }
  if (platform === "linux") {
    const systemdRun = find("systemd-run");
    if (!systemdRun) throw unavailable("no systemd-run to start a window in the desktop session", ["systemd-run"]);
    const terminals = [["xdg-terminal-exec"], ["x-terminal-emulator", "-e"]];
    for (const [name, ...flags] of terminals) {
      const terminal = find(name);
      if (terminal) return { via: name, file: systemdRun, args: [...SYSTEMD_RUN, terminal, ...flags, "/bin/sh", "-c", text] };
    }
    throw unavailable("systemd-run is here, but no terminal to open: neither xdg-terminal-exec nor x-terminal-emulator",["systemd-run", ...terminals.map(([name]) => name)]);
  }
  throw unavailable(`no way to open a terminal window on ${platform}`, []);
}

/** A tool on `envPath`, as an absolute path, or null. */
export function onPath(name, envPath = process.env.PATH) {
  const dirs = String(envPath ?? "").split(":").filter((dir) => isAbsolute(dir));
  return systemTool(name, { dirs }).file ?? null;
}

function realpathOrNull(p) { try { return realpathSync(p); } catch { return null; } }
/** The directory of the `oats` on `envPath` that is this kernel, or null: an instance home's
 *  `.oats/bin` is passed over (lib/stable-node.mjs unitPathEntries), as it is the agent's. */
export function oatsDirectory({ envPath = process.env.PATH, kernelBin = KERNEL_BIN, instanceHome = process.env.OATS_INSTANCE_HOME } = {}) {
  const kernel = realpathOrNull(kernelBin);
  if (!kernel) return null;
  return unitPathEntries(envPath, { instanceHome }).find((dir) => realpathOrNull(join(dir, "oats")) === kernel) ?? null;
}

/** Open a window running `argv` (`["oats", …]`) and answer `{ opened: "requested", via, command }`,
 *  `command` the plain one. With no `oats` of this kernel on PATH, the window runs this kernel's
 *  bin by its path. The launcher runs in this process's environment; the window's command gets
 *  only the PATH written into it. A launcher that is missing or fails is E_OPEN_UNAVAILABLE, its
 *  message ending with the command to run by hand (`details.command`). */
export function openTerminalWindow(argv, { platform = process.platform, find = (name) => onPath(name), exec = execFileSync, node = process.execPath, kernelBin = KERNEL_BIN, oatsDir } = {}) {
  if (oatsDir === undefined) oatsDir = oatsDirectory({ kernelBin });
  const words = oatsDir ? argv : [kernelBin, ...argv.slice(1)];
  const command = plainCommand(words);
  const byHand = (e) => { e.message = `${e.message}; run it in a terminal yourself: ${command}`; e.details.command = command; return e; };
  let launch;
  try { launch = terminalLaunch(windowCommand(words, { dirs: [dirname(node), ...(oatsDir ? [oatsDir] : [])] }), { platform, find }); }
  catch (e) { throw e.code === "E_OPEN_UNAVAILABLE" ? byHand(e) : e; }
  try { exec(launch.file, launch.args, { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) {
    const said = String(e.stderr ?? "").trim() || e.message;
    throw byHand(unavailable(`${launch.file} failed: ${said}`, launch.via === "osascript" ? ["osascript"] : ["systemd-run", launch.via]));
  }
  return { opened: "requested", via: launch.via, command };
}
