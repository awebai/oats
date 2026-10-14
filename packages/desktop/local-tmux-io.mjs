import { isAbsolute } from "node:path";
import { cliEnvironment } from "../client/cli-environment.mjs";

export function tmuxSocketArgs(socket) {
  if (socket === undefined || socket === null || socket === "") return ["-u"];
  if (typeof socket !== "string" || !isAbsolute(socket) || socket.includes("\0")) throw new Error("Invalid tmux socket path");
  return ["-u", "-S", socket];
}

/** Whether `tmux -V` output names a tmux with client features (`-T`, tmux 3.2 and later; OATS
 * supports 3.0). Anything that is not `tmux X.Y[suffix]` (`tmux next-3.6`, `tmux master`, an
 * empty or failed probe) has none. */
export function tmuxHasClientFeatures(version) {
  const match = /^tmux (\d+)\.(\d+)/.exec(typeof version === "string" ? version.trim() : "");
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  return major > 3 || (major === 3 && minor >= 2);
}

/** Every viewer operation, including cleanup and PTY attach, uses the saved socket, and gets the
 * user's environment (cli-environment.mjs), computed from `env` when the program starts: one of
 * these calls can be the one that creates the tmux server. The viewer attaches with the `sync`
 * client feature where this tmux has client features (asked once, at the first attach), so tmux
 * wraps each redraw in synchronized output (renderer/terminal-sync.mjs, #1193). */
export function localTmuxIo(socket, { execFileSync, spawnPty, env = process.env }) {
  const prefix = tmuxSocketArgs(socket);
  const run = (args, output = false) => execFileSync("tmux", [...prefix, ...args], {
    encoding: "utf8", stdio: output ? ["ignore", "pipe", "pipe"] : "ignore", timeout: 4000, env: cliEnvironment(env),
  });
  let features;
  const clientFeatures = () => {
    if (features === undefined) {
      try { features = tmuxHasClientFeatures(run(["-V"], true)); } catch { features = false; }
    }
    return features;
  };
  return {
    preflight: (target) => run(["list-panes", "-t", target]),
    tmux: (args) => run(args),
    tmuxOut: (args) => run(args, true).trim(),
    spawnPty: (target, cols, rows) => {
      const viewerEnv = cliEnvironment(env); delete viewerEnv.TMUX;
      return spawnPty("tmux", [...prefix, ...(clientFeatures() ? ["-T", "sync"] : []), "attach-session", "-t", target], {
        name: "xterm-256color", cols, rows, cwd: env.HOME, env: viewerEnv,
      });
    },
  };
}
