import { isAbsolute } from "node:path";

export function tmuxSocketArgs(socket) {
  if (socket === undefined || socket === null || socket === "") return ["-u"];
  if (typeof socket !== "string" || !isAbsolute(socket) || socket.includes("\0")) throw new Error("Invalid tmux socket path");
  return ["-u", "-S", socket];
}

/** Every viewer operation, including cleanup and PTY attach, uses the saved socket. */
export function localTmuxIo(socket, { execFileSync, spawnPty, env = process.env }) {
  const prefix = tmuxSocketArgs(socket);
  const run = (args, output = false) => execFileSync("tmux", [...prefix, ...args], {
    encoding: "utf8", stdio: output ? ["ignore", "pipe", "pipe"] : "ignore", timeout: 4000,
  });
  return {
    preflight: (target) => run(["list-panes", "-t", target]),
    tmux: (args) => run(args),
    tmuxOut: (args) => run(args, true).trim(),
    spawnPty: (target, cols, rows) => {
      const viewerEnv = { ...env }; delete viewerEnv.TMUX;
      return spawnPty("tmux", [...prefix, "attach-session", "-t", target], {
        name: "xterm-256color", cols, rows, cwd: env.HOME, env: viewerEnv,
      });
    },
  };
}
