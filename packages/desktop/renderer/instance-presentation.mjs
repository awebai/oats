import { HERDR_REMOVED } from "./terminal-contract.mjs";

export function runtimeState(instance) {
  return instance.running === true ? "running" : instance.running === false ? "stopped" : "unknown";
}

/** Why a kernel-reported row has no usable session, or null. A Herdr-recorded
 * instance cannot open, start or restart; it can still retire. A 0.31 kernel
 * reports it as runtimeState "unsupported" with its E_HERDR_REMOVED text; an
 * older kernel only records a sessionTarget (local) or a herdr backend
 * (remote), and its runtimeError is a Herdr probe's, so the stem stands in. */
export function unsupportedSession(instance) {
  const stem = `E_HERDR_REMOVED: ${HERDR_REMOVED}`;
  if (instance?.runtimeState === "unsupported") return typeof instance.runtimeError === "string" && instance.runtimeError ? instance.runtimeError : stem;
  return (instance?.sessionTarget !== undefined && instance?.sessionTarget !== null) || instance?.backend === "herdr" ? stem : null;
}

export function runtimeCounts(instances) {
  const counts = { running: 0, stopped: 0, unknown: 0 };
  for (const instance of instances) counts[runtimeState(instance)]++;
  return counts;
}

export function retirementSummary(result) {
  if (!result) return "";
  const lines = [...(result.warnings || [])];
  if (result.deferred) lines.push(`Retirement scheduled${result.resultPath ? `; outcome: ${result.resultPath}` : ""}`);
  const recoveries = result.workRecoveries?.length ? result.workRecoveries : result.workRecovery ? [result.workRecovery] : [];
  for (const recovery of recoveries) {
    lines.push(`Preserved${result.server ? ` on ${result.server}` : ""}: ${recovery.path}`);
    if (recovery.classes?.length) lines.push(recovery.classes.join(", "));
    if (recovery.repoCopy?.copied === false) lines.push(recovery.repoCopy.reason);
  }
  return lines.join("\n");
}
