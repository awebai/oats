/** Whether the OATS tmux server starts in a systemd scope of its own (awebai/oats#915).
 *  A server started by a process inside a systemd service lives in that service's cgroup and dies
 *  when the unit stops: the schedule tick's oneshot, or a Desktop run as a user service. On Linux,
 *  from inside a service, on the unified cgroup hierarchy, the server's start runs under
 *  `systemd-run --user --scope`: the server is then a sibling of the service, not part of it.
 *  Everything else starts the server as before. */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const HIERARCHY = "the cgroup hierarchy is not the unified one, so there is no unified cgroup path to judge";
/** The last component of an absolute cgroup path, when it names a systemd service. */
function serviceOf(path) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const last = path.split("/").pop();
  return last.endsWith(".service") ? last : null;
}

/** → { wrap: true, unit } (inside `unit`, start the server in its own scope), { wrap: false }, or
 *  { wrap: false, warn: { unit, reason } } (inside a service, known only from INVOCATION_ID, on a
 *  hierarchy this cannot judge). `cgroup` is the text of /proc/self/cgroup, null when unreadable. */
export function serverScopePlan({ platform, cgroup, invocationId }) {
  if (platform !== "linux" || typeof cgroup !== "string") return { wrap: false };
  const lines = cgroup.split("\n").filter(Boolean);
  if (lines.length === 1 && lines[0].startsWith("0::") && lines[0].slice(3).startsWith("/")) {
    const unit = serviceOf(lines[0].slice(3));
    return unit ? { wrap: true, unit } : { wrap: false };
  }
  if (!invocationId) return { wrap: false };
  // The service the systemd hierarchy names, when one does: a hybrid host's 0:: line, or v1's name=systemd.
  const named = lines.map((line) => /^(?:0::|\d+:name=systemd:)(\/.*)$/.exec(line)?.[1]).map(serviceOf).find(Boolean);
  return { wrap: false, warn: { unit: named || "a systemd service", reason: HIERARCHY } };
}

/** Where the creator runs → { platform, cgroup, invocationId }: `io`'s when it says, else for a test only
 *  OATS_TEST_CGROUP (the text of a /proc/self/cgroup, judged as Linux), else this process's own (null
 *  cgroup when it cannot be read, or off Linux). */
export function creatorPlacement(io) {
  const seam = process.env.OATS_TEST_CGROUP;
  const platform = io?.platform ?? (seam !== undefined ? "linux" : process.platform);
  let cgroup = io?.cgroup;
  if (cgroup === undefined) {
    if (seam !== undefined) cgroup = seam;
    else if (platform === "linux") { try { cgroup = readFileSync("/proc/self/cgroup", "utf8"); } catch { cgroup = null; } }
    else cgroup = null;
  }
  const invocationId = io && "invocationId" in io ? io.invocationId : process.env.INVOCATION_ID;
  return { platform, cgroup, invocationId };
}

/** The scope's name, one per start that starts the server: a prefix per server address (the socket
 *  when it is known, else `-L oats` under the TMUX_TMPDIR the tmux client resolves it in, tmux's
 *  default /tmp when unset) and a random part. A scope ends with its last process, which is not
 *  always the server (a pane's process can outlive it), so a later start never reuses its name. */
export function serverScopeUnit({ socket, env }) {
  const address = socket ? socket : `-L oats\0${env?.TMUX_TMPDIR || "/tmp"}`;
  return `oats-tmux-${createHash("sha256").update(address).digest("hex").slice(0, 12)}-${randomBytes(4).toString("hex")}`;
}

/** The answer's warning when the server was started inside a service after all. */
export function serverScopeWarning({ unit, reason }) {
  return `the OATS tmux server was started inside ${unit}: it ends when that unit stops; start the OATS tmux server from your own shell, or enable the user systemd bus (${reason})`;
}
