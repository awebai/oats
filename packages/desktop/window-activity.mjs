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

/* The views the open windows show, for the backend's remote roster read (#1124). Main alone knows them
   (window-set.mjs); the backend reads the machines of those windows' workspaces and no other's, so it
   must hold the set as it is now. */

/** At most this many views in one post (the backend refuses more); a larger set is posted as one
 * window showing the switcher, which makes the backend read every machine. */
export const MAX_WINDOW_VIEWS = 64;

/** The set posted for `views` (each window's view id, or null for one bound to none): sorted, so the
 * same windows in another order are the same set. */
export function postedViews(views) {
  const list = Array.from(views ?? []);
  if (list.length > MAX_WINDOW_VIEWS) return [null];
  return list.sort((a, b) => (a === null ? -1 : b === null ? 1 : a < b ? -1 : a > b ? 1 : 0));
}

/** Serialized notifier: `update(views, epoch)` posts `{ views }` when the set, or the server it is
 * posted to (`epoch`: main's count of server changes), differs from what the backend last accepted.
 * One post at a time: a set that changes while a post is in flight is posted after it, so an older
 * set can never land after a newer one. `post` resolves truthy when the backend accepted the set; a
 * post that fails or throws leaves it unaccepted, and the next `update` posts it again. */
export function createViewsNotifier({ post }) {
  let accepted = null, wanted = null, posting = false;
  const sig = (s) => JSON.stringify(s);
  async function drain() {
    if (posting) return;
    posting = true;
    try {
      while (wanted && sig(wanted) !== sig(accepted)) {
        const sent = wanted;
        let ok = false;
        try { ok = !!(await post({ views: sent.views })); } catch { ok = false; }
        if (!ok) break;              // retried at the next update
        accepted = sent;
      }
    } finally { posting = false; }
  }
  return {
    update(views, epoch) {
      wanted = { epoch, views: postedViews(views) };
      return drain();
    },
  };
}
