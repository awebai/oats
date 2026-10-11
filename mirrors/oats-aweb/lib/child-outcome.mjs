/** How a child process ended, from execFileSync's error: its exit status, a
 *  timeout, or the error code or signal of a child that never exited (where
 *  the status is null). Never its output, so it may be reported for any
 *  command, including one that handles credentials. */
export function childOutcome(error, timeoutMs) {
  if (error?.status != null) return `failed (exit ${error.status})`;
  if (error?.code === 'ETIMEDOUT') return `timed out after ${Math.round(timeoutMs / 1000)} s`;
  return `failed: ${error?.code || error?.signal || 'no exit status'}`;
}
