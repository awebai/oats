// Private worker bootstrap. Reconciliation is supplied by the owning entry;
// this handshake never captures or writes status on behalf of the operation.
import { randomBytes } from "node:crypto";
import { CaptureBudget, CaptureStop } from "./capture-budget.mjs";
import { readCaptureLockOwner } from "./capture-lock.mjs";
import { captureMonotonicMs, captureWorkerMessage, validWorkerResult } from "./capture-supervisor.mjs";

export async function runCaptureWorker(operation) {
  if (!process.send || !process.connected) throw new Error("capture worker requires its supervisor");
  const nonce = randomBytes(16).toString("hex"), parentPid = process.ppid;
  const start = await new Promise((resolve, reject) => {
    const disconnected = () => { cleanup(); reject(new Error("capture supervisor disconnected before start")); };
    const receive = message => {
      cleanup();
      if (message?.type !== "start" || message.workerNonce !== nonce || message.parent?.pid !== parentPid ||
          typeof message.root !== "string" || !Number.isFinite(message.drainAt) ||
          !Number.isFinite(message.finalizeAt) || !Number.isFinite(message.hardAt) ||
          message.drainAt > message.finalizeAt || message.finalizeAt > message.hardAt) {
        reject(new Error("invalid capture worker start")); return;
      }
      resolve(message);
    };
    const cleanup = () => { process.off("message", receive); process.off("disconnect", disconnected); };
    process.once("message", receive); process.once("disconnect", disconnected);
    process.send({ type: "ready", pid: process.pid, nonce, startedAt: new Date().toISOString() }, error => {
      if (error) { cleanup(); reject(new Error("capture worker could not announce readiness")); }
    });
  });
  const alive = () => {
    if (!process.connected || process.ppid !== parentPid) return false;
    const owner = readCaptureLockOwner(start.root);
    return owner?.pid === parentPid && owner.nonce === start.parent.nonce &&
      owner.worker?.pid === process.pid && owner.worker.nonce === nonce;
  };
  // Publication must already be durable before the first operation, including
  // its first status write. A callback must check again between bounded units.
  if (!alive()) throw new Error("capture worker lock publication is missing");
  const budget = new CaptureBudget({ policy: start.policy, clock: captureMonotonicMs,
    drainAt: start.drainAt, supervisorAlive: alive });
  let result;
  try {
    result = await operation({ ...start, budget });
    if (!validWorkerResult(result)) throw new Error("invalid capture worker result");
  } catch (error) {
    // The operation owns failure receipts. Bootstrap never invents completed
    // progress or rewrites a receipt after an exception.
    const reason = error instanceof CaptureStop ? error.reason : budget.reason === "interrupted" ? "interrupted" : "io";
    // An operational failure (status persistence among them) names its cause
    // to the supervising command only; the run receipt keeps its fixed message.
    result = { outcome: "failed", reason, ...(reason === "io" ? { message: captureWorkerMessage(error) } : {}) };
  }
  if (process.connected) {
    await new Promise(resolve => process.send({ type: "result", result }, () => resolve()));
    process.disconnect();
  }
  process.exitCode = result.outcome === "failed" ? 1 : 0;
  return result;
}
