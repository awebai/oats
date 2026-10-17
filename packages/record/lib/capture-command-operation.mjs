// Production owning operation, shared by the fixed entry and isolated fixture
// workers. Bootstrap supplies registration/root-lock/ended-predecessor proof.
import { CaptureWorkSession } from "./capture-work-session.mjs";
import { CaptureStop } from "./capture-budget.mjs";
import { captureCommandOptions, captureCommandSelection } from "./capture-command.mjs";
import { readCaptureStatus } from "./capture-status.mjs";

export function captureCommandOperation(start) {
  const options = captureCommandOptions(start.options);
  let session;
  const receipt = result => {
    if (result.continuation) return result;
    const status = readCaptureStatus(start.root);
    if (status?.lastRun?.id !== start.pass.runId || status.lastRun.outcome === "running")
      throw new Error("capture command has no finalized matching receipt");
    // This bounded private IPC projection is read while the supervisor still
    // holds the root lock. The parent does not write or reconstruct counters.
    return { ...result, receipt: { appended: status.lastRun.counts.turnsAppended, pending: status.backlog.pending } };
  };
  try {
    session = new CaptureWorkSession(start, { owner: options.owner, selection: captureCommandSelection(options),
      roots: options.plan, trigger: options.trigger, indexEnabled: options.indexEnabled,
      issues: { sources: options.plan.sources, retry: options.retrySetAside } });
    while (true) {
      const result = session.step();
      if (result.resetRequired) return receipt(session.yieldWorker({ resetRequired: true }));
      if (result.finalize) return receipt(session.finish({ reason: start.budget.sample() ?? "deadline" }));
      if (result.stopped) return receipt(session.yieldWorker());
      if (result.idle) return receipt(session.complete());
    }
  } catch (error) {
    if (error instanceof CaptureStop && session) return receipt(session.yieldWorker());
    // An operational exception leaves its admission and running receipt for a
    // registered replacement, which can continue independent healthy work.
    throw error;
  } finally { session?.close(); }
}
