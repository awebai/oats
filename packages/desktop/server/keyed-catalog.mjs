/** One kernel-read document per deployment, held under the KEY of the workspace state it was
 * read under, re-read only when that key moves. The souls catalog and the capabilities table are
 * two instances of this; the invariants live here once:
 *
 * - One flight per deployment at a time; a newer keyed flight replaces the map entry and the
 *   older promise still settles (its result lands under its own key).
 * - A failed read keeps the last good value with the failure next to it (a stale table beats an
 *   empty view) and is retried only after `retryMs`.
 * - `prefetch` starts a read UNBOUND (key null) before the workspace state is known, so a cold
 *   cycle runs it alongside the roster reads. `settle` binds the state's key to it — whether the
 *   flight is still in the air or already landed — but ONLY when both belong to the same cycle:
 *   every prefetch opens a cycle, and a flight started by an older prefetch (its roster reads
 *   failed) is never bound to a state it was not read under; the cycle re-reads instead. A value
 *   held under null answers for no key, so it is never served as current.
 * - `observedAt` is the kernel's observation stamp when it reports one, else the read's
 *   completion time; a failure keeps the previous stamp.
 *
 * `read(deployment, cli, { maxAge })` is the catalog's kernel read; it resolves
 * `{ value, reason, observedAt }` (value null on failure) and must not throw. */
export function createKeyedCatalog({ read, retryMs, now = () => Date.now() }) {
  const held = new Map(), flights = new Map(), cycles = new Map(), unbound = new Map();
  const iso = ms => new Date(ms).toISOString();
  const inWindow = entry => !entry.reason || now() - entry.at < retryMs;
  /** A held entry answers for `key` while it is good, or while its failure is inside the retry window. */
  const answers = (last, key) => !!last && last.key === key && inWindow(last);
  /** Anything bound and inside its window makes a prefetch pointless. */
  const usable = last => !!last && last.key !== null && inWindow(last);
  function land(deployment, flight, result) {
    const last = held.get(deployment), at = now(), key = flight.key; // the key is read at completion: an adopted flight lands bound
    const entry = result.value
      ? { key, value: result.value, reason: null, at, observedAt: result.observedAt ?? iso(at) }
      : { key, value: last?.value ?? null, reason: result.reason ?? { code: 'E_CLI_FAILED', message: '' }, at, observedAt: last?.observedAt ?? null };
    held.set(deployment, entry);
    if (key === null) unbound.set(deployment, flight.cycle); else unbound.delete(deployment);
    return entry;
  }
  function start(deployment, cli, key, maxAge) {
    const flight = { key, cycle: cycles.get(deployment) ?? 0, promise: null };
    // Dispatched synchronously: a prefetch's kernel process starts in the same tick as the roster reads.
    let dispatched;
    try { dispatched = Promise.resolve(read(deployment, cli, maxAge !== undefined ? { maxAge } : {})); } catch (error) { dispatched = Promise.reject(error); }
    flight.promise = dispatched
      .catch(() => ({ value: null, reason: { code: 'E_CLI_FAILED', message: '' }, observedAt: null }))
      .then(result => land(deployment, flight, result))
      .finally(() => { if (flights.get(deployment) === flight) flights.delete(deployment); });
    flights.set(deployment, flight);
    return flight;
  }
  const snapshot = deployment => { const entry = held.get(deployment); return entry ? structuredClone(entry) : null; };
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
      let flight = flights.get(deployment);
      if (flight && flight.key === null && flight.cycle === cycle) flight.key = key;
      if (last && last.key === null && unbound.get(deployment) === cycle) { last.key = key; unbound.delete(deployment); }
      if (answers(last, key)) return { entry: snapshot(deployment), pending: null };
      if (!flight || flight.key !== key) flight = start(deployment, cli, key, maxAge);
      return { entry: snapshot(deployment), pending: flight.promise.then(() => snapshot(deployment)) };
    },
    /** A live read for `key` (maxAge 0), joining the flight in progress rather than doubling it. */
    async refresh(deployment, cli, key) {
      const flight = flights.get(deployment) ?? start(deployment, cli, key, 0);
      await flight.promise;
      return snapshot(deployment);
    },
    held: snapshot,
    refreshing(deployment) { return flights.has(deployment); },
    forget(deployment) { held.delete(deployment); flights.delete(deployment); unbound.delete(deployment); },
    forgetAll() { held.clear(); flights.clear(); unbound.clear(); },
  };
}
