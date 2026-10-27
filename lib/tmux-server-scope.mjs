/** Where the OATS tmux server and the agents' harnesses run on a systemd host (awebai/oats#915).
 *  systemd-oomd ends a whole cgroup under memory pressure, and a unit's stop ends its cgroup: a
 *  server started inside a unit of the user manager (the schedule tick's oneshot, a Desktop run as a
 *  user service, a client launched from a desktop session in its `app-*.scope`) would share that
 *  unit's fate. On Linux, on the unified cgroup hierarchy, from inside a service, or a scope of the
 *  user manager, the server's start runs under `systemd-run --user --scope`: the server is then a
 *  sibling of that unit, not part of it. Each agent's harness, wherever the server runs, is launched
 *  in a scope of its own too (agentScope), so that such a kill ends one agent and never the server
 *  or the others. Everything else starts as before. */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalHomePath } from "./real-path.mjs";
import { systemTool } from "./system-tools.mjs";

const HIERARCHY = "the cgroup hierarchy is not the unified one, so there is no unified cgroup path to judge";
/** The last component of an absolute cgroup path, when it names a systemd service. */
function serviceOf(path) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const last = path.split("/").pop();
  return last.endsWith(".service") ? last : null;
}
/** The user manager's own unit, as a cgroup path component. */
const USER_MANAGER = /^user@\d+\.service$/;
/** The unit a unified cgroup path's last component names, when a server started there is to leave
 *  it: a service, system or user (as #915 began), or a scope under the user manager (a desktop
 *  application's or a terminal's `app-*.scope`, an agent's `oats-agent-*.scope`, the manager's own
 *  `init.scope`). A login session's `session-N.scope` sits beside the user manager, not in it: not one. */
function unitOf(path) {
  const service = serviceOf(path);
  if (service || typeof path !== "string" || !path.startsWith("/")) return service;
  const parts = path.split("/"), last = parts.pop();
  return last.endsWith(".scope") && parts.some((part) => USER_MANAGER.test(part)) ? last : null;
}

/** → { wrap: true, unit } (inside `unit`, start the server in its own scope: unitOf), { wrap: false },
 *  or { wrap: false, warn: { unit, reason } } (inside a service, known only from INVOCATION_ID, on a
 *  hierarchy this cannot judge). `cgroup` is the text of /proc/self/cgroup, null when unreadable. */
export function serverScopePlan({ platform, cgroup, invocationId }) {
  if (platform !== "linux" || typeof cgroup !== "string") return { wrap: false };
  const lines = cgroup.split("\n").filter(Boolean);
  if (lines.length === 1 && lines[0].startsWith("0::") && lines[0].slice(3).startsWith("/")) {
    const unit = unitOf(lines[0].slice(3));
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

// ---- the agent's scope ------------------------------------------------------------------------------

/** Whether a creator judged at `placement` (creatorPlacement) launches agents' harnesses in scopes of
 *  their own: Linux, on the unified hierarchy, whatever unit the creator is in or not in (the harness
 *  is the server's child, wherever the server is). */
export function agentScopeHost({ platform, cgroup }) {
  if (platform !== "linux" || typeof cgroup !== "string") return false;
  const lines = cgroup.split("\n").filter(Boolean);
  return lines.length === 1 && lines[0].startsWith("0::/");
}

/** An agent's scope name, one per launch: a prefix per home (the first 12 hex of the sha256 of its
 *  canonical path) and a random part. A scope ends with its last process, so a later launch of the
 *  same home never reuses its name (as serverScopeUnit). */
export function agentScopeUnit({ home }) {
  return `oats-agent-${createHash("sha256").update(canonicalHomePath(home)).digest("hex").slice(0, 12)}-${randomBytes(4).toString("hex")}`;
}

/** The names `systemd-run --user` finds the user manager by: the session bus, else the runtime
 *  directory's bus and the manager's private socket. The probe runs with the pane's values of these
 *  and no others. */
export const SCOPE_ENV_NAMES = Object.freeze(["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]);
const PROBE_TIMEOUT_MS = 5000;
const PROBE_ARGS = Object.freeze(["--user", "--scope", "--collect", "--quiet", "--"]);
/** The real probe: a scope around the system's `true`, run with `env` → { ok: true } | { reason }. */
function runScopeProbe({ systemdRun, trueFile, env }) {
  try {
    execFileSync(systemdRun, [...PROBE_ARGS, trueFile], { env, timeout: PROBE_TIMEOUT_MS, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
    return { ok: true };
  } catch (e) {
    if (e?.code === "ETIMEDOUT" || (e?.signal && e?.status == null)) return { reason: `it did not answer within ${PROBE_TIMEOUT_MS / 1000} s` };
    return { reason: String(e?.stderr ?? "").trim().split("\n")[0] || (Number.isInteger(e?.status) ? `exit ${e.status}` : String(e?.message || "failed")) };
  }
}
/** The probes' answers, per probe (the real one, or a test's io.scopeProbe), per systemd-run and the
 *  pane's SCOPE_ENV_NAMES: one probe per kernel process for each, so a sweep of many starts probes once. */
const probed = new WeakMap();
function probeOnce(probe, { systemdRun, trueFile, env }) {
  let answers = probed.get(probe);
  if (!answers) probed.set(probe, answers = new Map());
  const key = JSON.stringify([systemdRun, ...SCOPE_ENV_NAMES.map((name) => env[name] ?? null)]);
  if (!answers.has(key)) answers.set(key, probe({ systemdRun, trueFile, env: { ...env } }));
  return answers.get(key);
}

/**
 * Whether this launch's harness runs in a scope of its own → { wrapper: { systemdRun, env } } (the
 * system's systemd-run and env, absolute: agentScopeArgv), { warning } (it runs in the server's cgroup,
 * and why), or {} (a host where nothing changes: off Linux, a cgroup hierarchy other than the unified
 * one, nothing said). `paneEnv()` gives the pane's SCOPE_ENV_NAMES as { env } (a name it does not set
 * is not in `env`) or { reason } (they cannot be read); it is called only on a host that wraps.
 * The probe is the guard: the launch is wrapped only once `systemd-run --user --scope` has started a
 * scope with the pane's own environment. `io` is a test's: its placement (creatorPlacement), its
 * system directories (io.systemToolDirs) and its probe (io.scopeProbe, given what the real probe is
 * given). An `io` without a scopeProbe judges no scope at all: its tmux is a test's, and the host's
 * user manager is never reached unless a test opts in.
 */
export function agentScope({ io, paneEnv }) {
  if (!agentScopeHost(creatorPlacement(io))) return {};
  const probe = io ? io.scopeProbe : runScopeProbe;
  if (!probe) return {};
  const unscoped = (reason) => ({ warning: agentScopeWarning(reason) });
  const where = io?.systemToolDirs ? { dirs: io.systemToolDirs } : {};
  const systemdRun = systemTool("systemd-run", where), clean = systemTool("env", where), trueFile = systemTool("true", where);
  const missing = systemdRun.reason ?? clean.reason ?? trueFile.reason;
  if (missing) return unscoped(missing);
  const pane = paneEnv();
  if (pane.reason) return unscoped(pane.reason);
  const answer = probeOnce(probe, { systemdRun: systemdRun.file, trueFile: trueFile.file, env: pane.env });
  if (!answer?.ok) return unscoped(`\`systemd-run --user --scope\` could not start a scope in the pane's environment: ${answer?.reason || "the probe failed"}`);
  return { wrapper: { systemdRun: systemdRun.file, env: clean.file } };
}

/** The words before the harness's own `/bin/sh -c` that run it in a scope named `unit` (agentScopeUnit):
 *  systemd-run execs the system's env, which execs what follows with INVOCATION_ID removed (the
 *  scope's own, which systemd-run exports to what it runs, as for the server). The process keeps its
 *  pid through each exec, so the harness stays the pane's direct child and its exit status is the
 *  pane shell's to read. */
export function agentScopeArgv({ systemdRun, env }, unit) {
  return [systemdRun, "--user", "--scope", "--collect", "--quiet", "--unit", unit, "--", env, "-u", "INVOCATION_ID"];
}

/** The answer's warning when the harness runs in the server's cgroup. */
export function agentScopeWarning(reason) {
  return `the agent's harness runs in the OATS tmux server's cgroup, not a scope of its own: ${reason}`;
}
