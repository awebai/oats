// Leased terminal lifecycle. Setup is inside start/onReady and must settle before
// disposal. A close request disables use immediately, but UI teardown/key release
// is permitted only by a confirmed close (not a timeout or transport failure).
// reopen acquires a further lease for the same target once the previous one is
// forgotten (its cleanup confirmed); it never runs after a close request.
import { terminalHandle, terminalSameHandle, terminalFailure, terminalSuccess } from '../../client/terminal-contract.mjs';

export function createTermLifecycle(io, onError = () => {}) {
  let held = null, closing = false, started = false, flight = null, disposed = false;
  let disposeUi = null, closeFlight = null, earlyClose = null;
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
  async function acquire(onReady, onOpenError) {
    let settle;
    flight = new Promise(resolve => { settle = resolve; });
    try {
      held = terminalHandle(await io.open());
      if (!held) throw terminalFailure('E_TERM_OPEN_FAILED');
      if (closing) earlyClose = await detach();
      else await onReady(held);
    } catch (error) { if (!closing) onOpenError(error); }
    finally { flight = null; settle(); }
  }
  return {
    async start(onReady, onOpenError) {
      if (started) return; started = true;
      await acquire(onReady, onOpenError);
    },
    /** Resolves true when an acquisition ran, false when a lease is held or a close was requested. */
    async reopen(onReady, onOpenError) {
      while (flight) await flight;
      if (!started || closing || held) return false;
      await acquire(onReady, onOpenError);
      return true;
    },
    close(ui) {
      closing = true; disposeUi = ui || disposeUi;
      if (!started) started = true; // failed mount before start: never acquire later
      if (closeFlight) return closeFlight;
      closeFlight = (async () => {
        while (flight) await flight;
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
