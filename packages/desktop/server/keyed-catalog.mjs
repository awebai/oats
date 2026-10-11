/** One kernel-read document per deployment, held under the KEY of the workspace state it was
 * read under, re-read only when that key moves. The souls catalog and the capabilities table are
 * two instances of this; the invariants live here once:
 *
 * - One flight per deployment at a time; a newer keyed flight replaces the map entry and the
 *   older promise still settles (its result lands under its own key).
 * - A failed read keeps the last good value with the failure next to it (a stale table beats an
 *   empty view) and is retried only after `retryMs`.
 * - `prefetch` starts a read UNBOUND (key null) before the workspace state is known, so a cold
 *   cycle runs it alongside the roster reads. Cold means NOTHING is held for the deployment (or
 *   what is held is a failure past its retry window): a value that landed unbound, good or failed,
 *   is held and stops further prefetches for its window, so a deployment whose roster reads keep
 *   failing costs one read, not one per cycle. `settle` binds the state's key to the unbound
 *   flight — still in the air or already landed — but ONLY when both belong to the same cycle:
 *   every prefetch opens a cycle, and a flight started by an older prefetch (its roster reads
 *   failed) is never bound to a state it was not read under; that cycle reads under its key
 *   instead. A value held under null answers for no key, so it is never served as current.
 * - `demand` is the request path with nothing good to show: it reads now (a same-key flight is
 *   joined), whatever the retry window says — the window throttles background cycles, never a
 *   user who is looking at a failure. `refresh` is a LIVE read: it joins only a live same-key
 *   flight, never a background one.
 * - `observedAt` is the kernel's observation stamp when it reports one, else the read's
 *   completion time; a failure keeps the previous stamp.
 * - Every held result has an AGE BOUND: `ttlMs` (HELD_TTL_MS, the background max-age) from the
 *   time it was stored. Past it the entry is `stale` — and that is REQUEST-DRIVEN: the cycle's
 *   `settle` still answers from a stale entry (age alone never starts a kernel run in the
 *   background; a `souls` plus an `oats capabilities` run per deployment every minute, focused or
 *   blurred, is exactly the churn the app must not cause), while a request that finds it stale
 *   answers at once and `revalidate`s: one single-flight re-read behind the answer, joined by
 *   every request until it lands. The key sees what `workspace status` reports; the TTL bounds
 *   what it cannot (local configuration edited outside Desktop: `oats teams`, `oats soul teams`,
 *   `oats sync` from a terminal) to "TTL + one read of the next time someone looks", without the
 *   Desktop naming or touching any deployment file — that is the kernel's to know.
 *
 * `read(deployment, cli, { maxAge })` is the catalog's kernel read; it resolves
 * `{ value, reason, observedAt }` (value null on failure) and must not throw. */
import { OBSERVE_MAX_AGE_FEATURE } from '../../client/deployment-contract.mjs';

/** How long a held result may be served (catalogs and inspections alike): the background
 * max-age, so nothing held is older than what a background poll would accept from the kernel. */
export const HELD_TTL_MS = 60_000;

export function createKeyedCatalog({ read, retryMs, ttlMs = HELD_TTL_MS, now = () => Date.now() }) {
  const held = new Map(), flights = new Map(), cycles = new Map(), unbound = new Map(), current = new Map();
  const iso = ms => new Date(ms).toISOString();
  const inWindow = entry => !entry.reason || now() - entry.at < retryMs;
  const fresh = entry => now() - entry.at < ttlMs;
  /** A held entry answers a CYCLE for `key` while it is good (age is a request's concern), or its failure is inside the retry window. */
  const answers = (last, key) => !!last && last.key === key && inWindow(last);
  /** Anything held inside its window (bound or not) makes a prefetch pointless. */
  const usable = last => !!last && inWindow(last);
  /** Build the flight's entry and hold it — unless the flight is keyed and the key moved on while it
   * flew (a newer settle/demand/refresh under another key has its own flight): then the newer state's
   * entry is not overwritten. Either way the flight resolves with the entry IT built, so a request
   * awaiting it is answered for the key it asked, not with whatever happens to be held. */
  function land(deployment, flight, result) {
    const last = held.get(deployment), at = now(), key = flight.key; // the key is read at completion: an adopted flight lands bound
    const entry = result.value
      ? { key, value: result.value, reason: null, at, observedAt: result.observedAt ?? iso(at) }
      : { key, value: last?.value ?? null, reason: result.reason ?? { code: 'E_CLI_FAILED', message: '' }, at, observedAt: last?.observedAt ?? null };
    const superseded = key !== null && current.has(deployment) && current.get(deployment) !== key;
    if (!superseded) {
      held.set(deployment, entry);
      if (key === null) unbound.set(deployment, flight.cycle); else unbound.delete(deployment);
    }
    return entry;
  }
  function start(deployment, cli, key, maxAge) {
    // Live = the kernel observes the remotes afresh: asked for (maxAge 0), or the only thing a kernel
    // without observe-max-age can do — then a refresh joins the flight instead of starting a twin.
    const live = maxAge === 0 || !(Array.isArray(cli?.features) && cli.features.includes(OBSERVE_MAX_AGE_FEATURE));
    const flight = { key, live, cycle: cycles.get(deployment) ?? 0, promise: null };
    // Dispatched synchronously: a prefetch's kernel process starts in the same tick as the roster reads.
    let dispatched;
    try { dispatched = Promise.resolve(read(deployment, cli, maxAge !== undefined ? { maxAge } : {})); } catch (error) { dispatched = Promise.reject(error); }
    flight.promise = dispatched
      .catch(() => ({ value: null, reason: { code: 'E_CLI_FAILED', message: '' }, observedAt: null }))
      .then(result => ({ ...structuredClone(land(deployment, flight, result)), stale: false }))
      .finally(() => { if (flights.get(deployment) === flight) flights.delete(deployment); });
    flights.set(deployment, flight);
    return flight;
  }
  const snapshot = deployment => { const entry = held.get(deployment); return entry ? { ...structuredClone(entry), stale: !fresh(entry) } : null; };
  return {
    /** Open a cycle; start an unbound read when nothing usable is held and nothing is in flight. */
    prefetch(deployment, cli, { maxAge } = {}) {
      cycles.set(deployment, (cycles.get(deployment) ?? 0) + 1);
      if (flights.has(deployment) || usable(held.get(deployment))) return null;
      return start(deployment, cli, null, maxAge).promise;
    },
    /** Bind this cycle's key: adopt the cycle's unbound flight (in flight or landed), answer from a
     * held entry for the key, or start a keyed read. Synchronous: `pending` is what is still coming. */
    settle(deployment, cli, key, { maxAge } = {}) {
      const cycle = cycles.get(deployment) ?? 0, last = held.get(deployment);
      current.set(deployment, key);
      let flight = flights.get(deployment);
      if (flight && flight.key === null && flight.cycle === cycle) flight.key = key;
      if (last && last.key === null && unbound.get(deployment) === cycle) { last.key = key; unbound.delete(deployment); }
      if (answers(last, key)) return { entry: snapshot(deployment), pending: null };
      if (!flight || flight.key !== key) flight = start(deployment, cli, key, maxAge);
      return { entry: snapshot(deployment), pending: flight.promise };
    },
    /** Read now for `key` (the request path with nothing good held): join a same-key flight, else
     * start one with `maxAge`, ignoring the retry window. */
    async demand(deployment, cli, key, { maxAge } = {}) {
      current.set(deployment, key);
      const flight = flights.get(deployment);
      return (flight?.key === key ? flight : start(deployment, cli, key, maxAge)).promise;
    },
    /** The request path with a STALE good entry: start one same-key re-read behind the answer, or
     * join the one in flight; never awaited by the caller, whose answer is the held entry with
     * `refreshing`. Resolves with the landed entry for whoever attaches it — null when another
     * key's flight is in the air (a cycle moved the state on and is reading it: that read answers,
     * and starting a stale-key read beside it would displace it and cost a duplicate). */
    revalidate(deployment, cli, key, { maxAge } = {}) {
      const flight = flights.get(deployment);
      if (flight) return flight.key === key ? flight.promise : null;
      return start(deployment, cli, key, maxAge).promise;
    },
    /** A LIVE read for `key` (maxAge 0): joins only a live same-key flight; a background flight in
     * the air is not it (its heads may be up to maxAge old), so a live one starts beside it. */
    async refresh(deployment, cli, key) {
      current.set(deployment, key);
      const flight = flights.get(deployment);
      return (flight?.key === key && flight.live ? flight : start(deployment, cli, key, 0)).promise;
    },
    held: snapshot,
    refreshing(deployment) { return flights.has(deployment); },
    forget(deployment) { held.delete(deployment); flights.delete(deployment); unbound.delete(deployment); current.delete(deployment); },
    forgetAll() { held.clear(); flights.clear(); unbound.clear(); current.clear(); },
  };
}
