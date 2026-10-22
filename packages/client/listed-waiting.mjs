/** Whether anyone waits in the deployments this computer lists but a client does not serve: the yellow
 * dot of the sidebar's list of workspaces, for a workspace none of whose deployments is open. A served
 * deployment's dot comes from its own observation (panel-views.mjs `workspaceChoices`); this re-runs the
 * identity read (deployment-identity.mjs `cliDeploymentIdentity`, its `waiting`) of each listed one, on a
 * slow and bounded schedule, and keeps each path's last answer. Both clients use it.
 *
 * The bounds, each pinned by packages/desktop/test/listed-waiting.test.mjs:
 *   - at most ONE read in flight, whatever the number of paths;
 *   - each path read at most once per interval, measured from the start of its last read:
 *     LISTED_WAITING_FOCUSED_MS while the client is focused (the default), LISTED_WAITING_BLURRED_MS while
 *     it is not. A failed read waits its interval like any other: no retry;
 *   - the path most due first: a path never read before one read, then the one read longest ago, then
 *     the set's order;
 *   - one timer (`timers.setTimeout`, unref'd: it never keeps a process alive), armed for the next due
 *     time and re-armed when the set, the focus or a read's end changes it; never a busy loop;
 *   - every read passes `maxAge` LISTED_WAITING_MAX_AGE (seconds; the read's `--max-age`).
 *
 * It runs no CLI itself: the caller passes `read(path, { maxAge })`, typically
 * `(path, o) => cliDeploymentIdentity(cli, path, o, io)`, whose answer is never a rejection (one is read as
 * a failure anyway). Asking (`waiting`, `snapshot`) never starts a read. */

export const LISTED_WAITING_FOCUSED_MS = 60_000;
export const LISTED_WAITING_BLURRED_MS = 300_000;
/** Seconds: how old an observation the kernel may answer a read from. */
export const LISTED_WAITING_MAX_AGE = 300;

/** What an identity read's answer says of `waiting`: true, false, or null (unknown) for a failure, an
 * answer that is not `{ ok: true }`, or a `waiting` that is neither boolean. */
const answered = (answer) => (answer?.ok === true && typeof answer.waiting === 'boolean' ? answer.waiting : null);

/**
 * @param {{ read: (path: string, options: { maxAge: number }) => Promise<object>,
 *   timers?: { setTimeout: Function, clearTimeout: Function }, now?: () => number, onChange?: () => void }} options
 *   `now` is the clock in ms; `onChange()` is called after a read's answer changed a path's value (from
 *   null, too: the first answer of a new path is a change), never for a read that changed nothing, and
 *   never by `setPaths` (whose caller made that change itself).
 * @returns {{ setPaths(paths: string[]): void, setFocused(focused: boolean): void,
 *   waiting(path: string): boolean | null, snapshot(): Map<string, boolean | null>, stop(): void }}
 *   `setPaths` replaces the set of paths: one no longer in it loses its value, and an answer for it that
 *   arrives later is dropped; a new one (a path removed and given again included) is due at once and is
 *   null until read. `waiting(path)` is the path's last answer, null for a path not in the set or not yet
 *   read. `snapshot()` is a new Map of every path in the set to its value, in the set's order.
 *   `stop()` clears the timer for good: nothing more is read or reported, and an answer that arrives
 *   after it is dropped; what was answered before stays readable.
 */
export function createListedWaiting({ read, timers = globalThis, now = Date.now, onChange = () => {} }) {
  /** path -> { value, readAt }: `readAt` the clock when its last read began, null before the first. */
  let entries = new Map();
  let focused = true, stopped = false, flight = null, timer = null;

  const interval = () => (focused ? LISTED_WAITING_FOCUSED_MS : LISTED_WAITING_BLURRED_MS);
  /** The path most due and when: never read first (due at once), then the oldest read; the set's order on a tie. */
  function mostDue() {
    let next = null;
    for (const [path, entry] of entries) {
      const at = entry.readAt === null ? -Infinity : entry.readAt + interval();
      if (next === null || at < next.at) next = { path, entry, at };
    }
    return next;
  }
  function clear() { if (timer !== null) { timers.clearTimeout(timer); timer = null; } }
  /** Arm the one timer for the next due time; none while a read is in flight (its end arms it) or with no path. */
  function schedule() {
    clear();
    if (stopped || flight !== null) return;
    const next = mostDue();
    if (next === null) return;
    timer = timers.setTimeout(fire, Math.max(0, next.at - now()));
    timer?.unref?.();
  }
  function fire() {
    timer = null;
    if (stopped || flight !== null) return;
    const next = mostDue();
    if (next === null) return;
    if (next.at > now()) return schedule(); // woken early: wait for its time
    begin(next.path, next.entry);
  }
  function begin(path, entry) {
    entry.readAt = now();
    const mine = flight = { path, entry };
    let pending;
    try { pending = Promise.resolve(read(path, { maxAge: LISTED_WAITING_MAX_AGE })); } catch { pending = Promise.resolve(null); }
    pending.then((answer) => answer, () => null).then((answer) => {
      if (stopped || flight !== mine) return;
      flight = null;
      // A path removed meanwhile (or removed and given again: a new entry) drops what was read for it.
      const current = entries.get(path) === entry;
      const changed = current && answered(answer) !== entry.value;
      if (changed) entry.value = answered(answer);
      schedule();
      if (changed) onChange();
    });
  }

  return {
    setPaths(paths) {
      if (stopped) return;
      const next = new Map();
      for (const path of Array.isArray(paths) ? paths : []) {
        if (typeof path === 'string' && !next.has(path)) next.set(path, entries.get(path) ?? { value: null, readAt: null });
      }
      entries = next;
      schedule();
    },
    setFocused(value) {
      if (stopped || Boolean(value) === focused) return;
      focused = Boolean(value);
      schedule(); // the interval changed: every due time moves with it, from the last read's start
    },
    waiting(path) { return entries.get(path)?.value ?? null; },
    snapshot() { return new Map([...entries].map(([path, entry]) => [path, entry.value])); },
    stop() { stopped = true; flight = null; clear(); },
  };
}
