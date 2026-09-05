export function runtimeState(instance) {
  return instance.running === true ? "running" : instance.running === false ? "stopped" : "unknown";
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
