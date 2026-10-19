// Production owning operation, shared by the fixed entry and isolated fixture
// workers. Bootstrap supplies registration/root-lock/ended-predecessor proof.
import { createHash } from "node:crypto";
import { readCaptureRoots, captureRootDirectory } from "./capture-roots.mjs";
import { CaptureWorkSession } from "./capture-work-session.mjs";
import { CaptureStop } from "./capture-budget.mjs";
import { captureCommandOptions, captureCommandSelection } from "./capture-command.mjs";
import { readCaptureStatus } from "./capture-status.mjs";

export function captureCommandOperation(start) {
  const options = captureCommandOptions(start.options);
  // Only this admitted worker reads inventory. Keep the caller's environment
  // and closed default-root transport unchanged; the root lock freezes updates.
  const inventory = options.plan.sources.some(source => source !== 'aw') ?
    readCaptureRoots(start.root, { inspectRoots: false, sources: options.plan.sources, check: () => start.budget.check() }) :
    { roots: [], rows: [], fingerprint: 'native-sources-excluded' };
  const registered = [], facts = [];
  for (const root of inventory.roots.filter(root => options.plan.sources.includes(root.source))) {
    let stat;
    try { stat = captureRootDirectory(root.path, { check: () => start.budget.check() }); }
    catch (error) { if (error instanceof CaptureStop) throw error; stat = undefined; }
    facts.push([root, stat === null ? 'absent' : stat ? [String(stat.dev), String(stat.ino)] : 'unavailable']);
    registered.push(root);
  }
  const selection = createHash('sha256').update(JSON.stringify([captureCommandSelection(options), inventory.fingerprint, facts])).digest('hex');
  let session, coverageFailure = inventory.rows.length > 0;
  const receipt = result => {
    if (result.continuation) return result;
    const status = readCaptureStatus(start.root);
    if (status?.lastRun?.id !== start.pass.runId || status.lastRun.outcome === "running")
      throw new Error("capture command has no finalized matching receipt");
    // This bounded private IPC projection is read while the supervisor still
    // holds the root lock. The parent does not write or reconstruct counters.
    const otherFailure = ['capture-run-failure', 'capture-index-reset-failure', 'capture-cleanup-failure']
      .some(kind => session.state.get(kind, 'last')?.runId === start.pass.runId);
    const discoveryFailure = session.state.get('capture-discovery-failure', 'last');
    const coverageOnly = result.outcome === 'failed' && result.reason === 'io' && !start.pass.failure && start.pass.previous?.outcome !== 'failed' &&
      (coverageFailure || discoveryFailure?.runId === start.pass.runId && discoveryFailure.registered === true) &&
      !otherFailure && (!discoveryFailure || discoveryFailure.runId !== start.pass.runId || discoveryFailure.registered === true) &&
      status.lastRun.counts.inputsFailed === 0;
    return { ...result, ...(coverageOnly ? { rootCoverageOnly: true } : {}), receipt: { appended: status.lastRun.counts.turnsAppended, pending: status.backlog.pending } };
  };
  try {
    session = new CaptureWorkSession(start, { owner: options.owner, selection,
      roots: options.plan, registeredRoots: registered, rootCoverageIncomplete: coverageFailure, trigger: options.trigger, indexEnabled: options.indexEnabled,
      issues: { sources: options.plan.sources, retry: options.retrySetAside } });
    while (true) {
      let result;
      try { result = session.step(); }
      catch (error) {
        if (error.code !== 'E_CAPTURE_ROOTS_COVERAGE') throw error;
        coverageFailure = true;
        continue;
      }
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
