// Package-owned offline diagnosis. No writable DB/store, lock acquisition,
// manager, repair or capture; warnings never publish new run evidence.
import { homedir, hostname, platform as hostPlatform } from "node:os";
import { join } from "node:path";
import { readCaptureStatus } from "./capture-status.mjs";
import { readCurrentIssueBacklog } from "./capture-issues.mjs";
import { emptyFailureBacklog } from "./capture-failures.mjs";
import { captureInstallation } from "./capture-health-installation.mjs";
import { holderLiveness, readCaptureLockOwner, shellQuote } from "./capture-lock.mjs";

export const SET_ASIDE_REMEDY = "Restore the captured prefix and run turn-record capture --retry-set-aside; or add the source to <root>/ignore (later turns from that session will not be captured). Retry revalidates; it never authorizes a changed prefix.";
const emptyBacklog = () => ({ pending: false, setAsideCount: 0, setAside: [], truncated: false, ...emptyFailureBacklog() });
const noHistory = () => ({ lastRun: null, lastSuccess: null, lastFailure: null, lastProgressAt: null, backlog: emptyBacklog() });
const time = value => typeof value === "string" ? Date.parse(value) : NaN;

function deadExecution(root, run, host, liveness, now) {
  // A receipt has no host field. Never signal-probe its PID without matching
  // local registration. Both owner and worker must be dead: a live supervisor
  // can still replace a child and finish this same pass. Reused/unknown PIDs
  // and changed/foreign/hostless lock records supply no death evidence.
  const owner = readCaptureLockOwner(root), worker = owner?.worker;
  if (owner?.host !== host || worker?.host !== host || worker.pid !== run.pid ||
      !Number.isInteger(owner.pid) || owner.pid <= 0 || owner.pid === worker.pid ||
      typeof owner.nonce !== "string" || !owner.nonce || typeof worker.nonce !== "string" || !worker.nonce ||
      !(time(owner.startedAt) <= time(run.startedAt)) || !(time(worker.startedAt) >= time(owner.startedAt)) ||
      !(time(worker.startedAt) <= now)) return false;
  if (liveness(owner.pid) !== "dead" || liveness(worker.pid) !== "dead") return false;
  return JSON.stringify(readCaptureLockOwner(root)) === JSON.stringify(owner) &&
    JSON.stringify(readCaptureStatus(root, { now })?.lastRun) === JSON.stringify(run);
}

// Optional caller/clock/liveness context is for isolated readers and fixtures;
// no CLI option selects an alternate reader, executable or resource policy.
export function captureHealth(root, { home = homedir(), platform = hostPlatform(), now = Date.now(),
  host = hostname(), liveness = holderLiveness } = {}) {
  const began = performance.now();
  const check = () => { if (performance.now() - began > 15000) throw new Error("capture health reader deadline exceeded"); };
  let installation;
  try { installation = captureInstallation(root, { home, platform, check }); }
  catch (error) { throw new Error(`Capture installation evidence is unknown: ${error.message}`, { cause: error }); }
  const rows = [], path = join(root, "capture-status.json");
  let status = noHistory();
  const result = backlog => ({ schemaVersion: 1, status: rows.length ? "warning" : "ok", rows,
    lastRun: status.lastRun, lastSuccess: status.lastSuccess, lastFailure: status.lastFailure, backlog });
  if (!installation.installed) { check(); return result(emptyBacklog()); }

  const setup = `Run turn-record setup --root ${shellQuote(root)} with your existing --owner to inspect and refresh installation.`;
  try {
    const saved = readCaptureStatus(root, { now });
    if (saved) status = saved;
    else rows.push({ code: "capture-status-missing", message: `Capture status is missing at ${path}. ${setup}` });
  } catch (error) { rows.push({ code: "capture-status-invalid", message: `Cannot read capture status at ${path}: ${error.message}. ${setup}` }); }
  check();
  let backlog;
  try {
    backlog = readCurrentIssueBacklog(root);
    if (!backlog && (status.backlog.setAsideCount || status.backlog.failedCount))
      throw new Error("capture.db is missing but the last command reported active capture issues");
  } catch (error) { throw new Error(`Cannot read current capture issues at ${join(root, "index", "capture.db")}: ${error.message}`, { cause: error }); }
  check(); backlog ??= emptyBacklog();
  if (backlog.setAsideCount) rows.push({ code: "capture-input-set-aside", message:
    `${backlog.setAsideCount} capture inputs set aside. ${SET_ASIDE_REMEDY.replace("<root>", root)}` });

  const failures = [];
  if (backlog.failedCount) failures.push(`${backlog.failedCount} capture stream units failed. Deferred retries remain unresolved; offsets name unit starts, not exact failing frames.`);
  const successAt = time(status.lastSuccess?.finishedAt);
  const failure = status.lastFailure;
  if (failure && (!status.lastSuccess || time(failure.finishedAt) > successAt))
    failures.push(`Last recorded failure ${failure.finishedAt} (${failure.reason}) is newer than any recorded success.`);
  const run = status.lastRun;
  if (run?.outcome === "failed" && (!status.lastSuccess || time(run.finishedAt) > successAt) && run.id !== failure?.id)
    failures.push(`Last run ${run.id} failed at ${run.finishedAt} (${run.reason}).`);
  if (run?.outcome === "running") {
    if (now - time(run.startedAt) > status.policy.deadlineSeconds * 1000)
      failures.push(`Run ${run.id} has no final receipt after its ${status.policy.deadlineSeconds}s deadline. This does not identify why execution stopped or prove that it stopped.`);
    else if (deadExecution(root, run, host, liveness, now))
      failures.push(`Run ${run.id} is unfinished and its matching local registered supervisor and worker are no longer alive.`);
  }
  if (failures.length) rows.push({ code: "capture-pass-failed", message:
    `${failures.join(" ")} Inspect turn-record capture --health --json and the retained receipt; counters are durably confirmed accounting, not all physical writes. A sleeping or off-host execution can leave old observations; no process is killed or lock reclaimed by health.` });
  if (!status.lastSuccess || now - successAt > 3600 * 1000) rows.push({ code: "capture-success-stale", message:
    `Last successful capture: ${status.lastSuccess?.finishedAt ?? "none recorded"}; last committed progress: ${status.lastProgressAt ?? "none recorded"}. No success within 3600s. This may reflect a sleeping machine or off-host execution; recent progress is not full success. ${setup}` });
  if (installation.legacy) rows.push({ code: "capture-setup-required", message:
    `An owned legacy continuous-watch definition remains. ${setup} Definition files do not prove manager registration or enabled scheduling; health invokes no manager.` });
  check(); return result(backlog);
}
