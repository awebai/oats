// Leased terminal lifecycle. Setup is inside start/onReady and must settle before
// disposal. A close request disables use immediately, but UI teardown/key release
// is permitted only by a confirmed close (not a timeout or transport failure).
import { terminalHandle, terminalSameHandle, terminalFailure, terminalSuccess } from './terminal-contract.mjs';

export function createTermLifecycle(io, onError = () => {}) {
  let held = null, closing = false, started = false, settled = false, disposed = false;
  let disposeUi = null, closeFlight = null, earlyClose = null, settleSignal;
  const settledP = new Promise(resolve => { settleSignal = resolve; });
  const detached = () => terminalSuccess('closed');
  async function detach() {
    const h = held;
    if (!h) return detached();
    try {
      const result = await io.closePty(h);
      if (!held) return detached(); // a matching confirmed exit arrived meanwhile
      if (result?.terminalApi === 2 && result.ok && result.status === 'closed' && terminalSameHandle(result.handle, h)) {
        if (terminalSameHandle(held, h)) held = null;
        return result;
      }
      return terminalFailure('E_TERM_CLOSE_PENDING');
    } catch (error) { onError(error); return held ? terminalFailure('E_TERM_CLOSE_PENDING') : detached(); }
  }
  return {
    async start(onReady, onOpenError) {
      if (started) return; started = true;
      try {
        held = terminalHandle(await io.open());
        if (!held) throw terminalFailure('E_TERM_OPEN_FAILED');
        if (closing) earlyClose = await detach();
        else await onReady(held);
      } catch (error) { if (!closing) onOpenError(error); }
      finally { settled = true; settleSignal(); }
    },
    close(ui) {
      closing = true; disposeUi = ui || disposeUi;
      if (!started) { started = true; settled = true; settleSignal(); } // failed mount before start: never acquire later
      if (closeFlight) return closeFlight;
      closeFlight = (async () => {
        if (!settled) await settledP;
        const result = earlyClose || await detach(); earlyClose = null;
        if (result.ok && result.status === 'closed' && !disposed) {
          disposed = true;
          try { disposeUi?.(); } catch (error) { onError(error); }
        }
        return result;
      })().finally(() => { closeFlight = null; });
      return closeFlight;
    },
    ptyId: () => held, // historical accessor name; value is always an immutable handle
    closing: () => closing,
    forget(h) { if (terminalSameHandle(held, h)) held = null; },
  };
}
