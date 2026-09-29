/* oats desktop — window activity for the backend's refresh cadence (main).

   The backend polls the kernel on a fixed cadence whether or not anyone is
   looking. Main is the only process that can see every BrowserWindow, so it
   reduces them to one boolean — "is a visible, un-minimized, focused window
   showing the panel?" — and tells the server when that boolean FLIPS, never
   per event: focus/blur/show/hide/minimize/restore arrive in bursts (a
   minimize is a blur and a hide) and the server must not see N posts for one
   transition. Pure so it is unit-testable without Electron. */

/* A destroyed BrowserWindow throws from every accessor; it is not showing
 * anything, so it counts as inactive rather than aborting the reduction. */
const active = w => { try { return !!(w.isVisible() && !w.isMinimized() && w.isFocused()); } catch { return false; } };

/** True when any window is visible, not minimized and focused. */
export function windowActivity(windows) { return Array.from(windows ?? []).some(active); }

/** Edge-triggered notifier: `update(windows)` recomputes activity, posts
 * `{ focused }` only when it differs from the last RECORDED value, and returns
 * the boolean; `current()` reads that value. `initial` is what the server is
 * assumed to believe before the first update (a freshly created window is
 * focused). The post is fire-and-forget: a throwing or rejecting post is
 * swallowed and the value is recorded anyway — the server reconciles on the
 * next flip, and a dead server must never break window event handling. */
export function createActivityNotifier({ post, initial = true }) {
  let last = !!initial;
  return {
    current: () => last,
    update(windows) {
      const focused = windowActivity(windows);
      if (focused !== last) {
        last = focused;
        try { Promise.resolve(post({ focused })).catch(() => { /* server unreachable: reconciled on the next flip */ }); }
        catch { /* synchronous post failure: same */ }
      }
      return focused;
    },
  };
}
