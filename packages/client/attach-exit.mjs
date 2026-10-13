/** What an attach's exit status says, as a word. A client compares no number: the kernel's table is
 * read here and nowhere else (docs/execution-targets.md, "Exit status"; docs/servers.md, "Run there",
 * for the routed form).
 *
 *   attachExit(status, { keyed, routed }) -> "left" | "ended" | "failed" | "link" | "unknown"
 *
 *   left     20, for an attach given a detach key: left by the key. The agent keeps running.
 *   ended    0: the viewer ended without the key. It says nothing of the agent.
 *   failed   1: a refusal, or tmux failing under the viewer. Routed: also a refusal on this side,
 *            and an ssh that could not be run here.
 *   link     255, for a routed attach: ssh's own failure, before the viewer or under it.
 *   unknown  anything else: 20 without a key, 255 on this machine, any other number, null (the
 *            child was ended by a signal), any value that is not a number.
 *
 * `status` is the child's exit status as Node reports it. `keyed`: the attach was started with
 * `--detach-key`. `routed`: it was started with `--server`. Each counts only when it is `true`.
 * No sentence is here: the words a person reads are each client's. This module imports nothing, so
 * a page can load it. */
export function attachExit(status, options) {
  if (status === 20 && options?.keyed === true) return "left";
  if (status === 0) return "ended";
  if (status === 1) return "failed";
  if (status === 255 && options?.routed === true) return "link";
  return "unknown";
}
