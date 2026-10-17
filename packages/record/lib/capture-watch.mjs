// Foreground notification scheduling only. A queued event never authorizes
// capture, selects roots or certifies progress; each pass owns those decisions.
export function captureWatchQueue(run, { onError = error => console.error(error), delay = 2000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null, active = null, pending = false, closed = false;
  const drain = async () => {
    while (pending && !closed) {
      pending = false;
      try { await run(); } catch (error) {
        // A broken diagnostic sink must not strand the queue or turn a timer
        // callback into an unhandled rejection. It supplies no run evidence.
        try { onError(error); } catch { /* best-effort diagnostics */ }
      }
    }
  };
  const ready = () => {
    timer = null;
    if (closed) return;
    pending = true;
    if (!active) active = drain().finally(() => { active = null; });
  };
  return {
    schedule() {
      if (closed) return;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(ready, delay);
    },
    // Do not abandon an admitted child. Its supervisor handles signals and
    // reaps it; closing only cancels future notification-driven passes.
    close() { closed = true; pending = false; if (timer !== null) clearTimer(timer); timer = null; },
    async settled() { await active; },
  };
}
