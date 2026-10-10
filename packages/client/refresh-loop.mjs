/** The deployment refresh loop: one observation cycle at a time, the next one
 * scheduled an interval AFTER the previous completed (never back to back, so
 * a slow kernel is never asked twice at once), backing off while the window
 * is blurred. A request during a run schedules exactly one follow-up, never
 * a queue: a mutation's result must be observed, and one requester asking
 * `live` is enough to make that follow-up live. */
export const REFRESH_FOCUSED_MS = 5000, REFRESH_BLURRED_MS = 30000;

export function createRefreshLoop({ run, focusedMs = REFRESH_FOCUSED_MS, blurredMs = REFRESH_BLURRED_MS, timers = { setTimeout, clearTimeout }, now = () => Date.now() } = {}) {
  let focused = true, active = false, timer = null, inflight = null, followUp = null, completedAt = null;
  function clear() { if (timer !== null) { timers.clearTimeout(timer); timer = null; } }
  function arm(ms) {
    clear();
    timer = timers.setTimeout(() => { timer = null; void execute(false); }, Math.max(0, ms));
    if (typeof timer?.unref === 'function') timer.unref(); // the loop never keeps the process alive on its own
  }
  function execute(live) {
    clear();
    inflight = Promise.resolve().then(() => run({ live })).catch(() => {}).then(() => {
      inflight = null; completedAt = now();
      if (followUp) {
        // The follow-up runs regardless of stop(): its requesters await an observation.
        const { live: again, waiters } = followUp; followUp = null;
        const promise = execute(again); for (const resolve of waiters) resolve(promise);
      } else if (active) arm(focused ? focusedMs : blurredMs);
    });
    return inflight;
  }
  return {
    start() { active = true; return execute(false); },
    /** Observe now (or right after the current run) and resolve once that observation completed. */
    request({ live = false } = {}) {
      if (!inflight) return execute(live);
      followUp ||= { live: false, waiters: [] };
      followUp.live ||= live; // never downgrade a live request
      return new Promise(resolve => followUp.waiters.push(resolve));
    },
    setFocused(value) {
      const next = Boolean(value);
      if (next === focused) return;
      focused = next;
      if (!active) return;
      // Focus return: one prompt refresh when idle; a run in flight already is that refresh.
      if (focused) { if (!inflight) void execute(false); }
      // Blur with a timer pending: the next run moves out to blurredMs after the last completion, never earlier.
      else if (timer !== null) arm(completedAt + blurredMs - now());
    },
    running() { return inflight !== null; },
    focused() { return focused; },
    stop() { active = false; clear(); },
  };
}
