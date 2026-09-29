/** A bounded, coalescing cache of `oats inspect` envelopes, keyed by the exact
    subject (deployment, server, soul+catalog or home+instance identity). Only
    successful envelopes are kept; a provider run invalidates its deployment
    because it can change what `inspect --home` reports. */

export const INSPECT_CACHE_LIMIT = 256;

/** Every field travels, absent ones as null: two subjects that differ in any
    coordinate never share an entry (same soul name under two agents roots, the
    same home before and after a restart, a catalog that changed under a soul). */
export function inspectKey({ deployment, server = null, kind, soul, agentsRoot, catalogKey, home, instance, identity }) {
  if (kind !== 'soul' && kind !== 'home') throw Object.assign(new Error('Inspect cache keys name a soul or a home'), { code: 'E_BAD_ARGS' });
  const part = value => value === undefined ? null : value;
  return JSON.stringify([part(deployment), part(server), kind, part(soul), part(agentsRoot), part(catalogKey), part(home), part(instance),
    Array.isArray(identity) ? identity.map(part) : part(identity)]);
}

export function createInspectCache({ limit = INSPECT_CACHE_LIMIT, now = () => Date.now() } = {}) {
  // Map iteration order is insertion order; a hit re-inserts, so the first key is the LRU.
  const entries = new Map();
  const flights = new Map();
  // Per-deployment epochs: a flight stores its result only if nobody invalidated
  // its deployment while it was in the air (the run may have changed the subject).
  const epochs = new Map();
  const epoch = deployment => epochs.get(deployment) || 0;
  const stamp = ms => new Date(ms).toISOString();

  function store(key, entry) {
    entries.delete(key); entries.set(key, entry);
    while (entries.size > limit) entries.delete(entries.keys().next().value);
  }
  function start(key, deployment, produce) {
    const startedAt = epoch(deployment);
    epochs.set(deployment, startedAt); // registered, so clear() can bump a deployment that is only in flight
    const flight = (async () => {
      const envelope = await produce();
      if (!envelope?.ok) return { envelope, observedAt: stamp(now()) };
      const reported = envelope.result?.observation?.observedAt;
      const observedAt = typeof reported === 'string' ? reported : stamp(now());
      if (epoch(deployment) === startedAt) store(key, { envelope, observedAt, deployment });
      return { envelope, observedAt };
    })();
    flights.set(key, flight);
    flight.finally(() => { if (flights.get(key) === flight) flights.delete(key); }).catch(() => {});
    return flight;
  }

  return {
    async read(key, { deployment, refresh = false, produce }) {
      const settled = entries.get(key);
      if (settled && !refresh) {
        store(key, settled);
        return { envelope: structuredClone(settled.envelope), observedAt: settled.observedAt, hit: true, refreshing: flights.has(key) };
      }
      // Identical concurrent requests share one kernel process, refresh or not.
      const flight = flights.get(key) || start(key, deployment, produce);
      const { envelope, observedAt } = await flight;
      return { envelope: structuredClone(envelope), observedAt, hit: false, refreshing: false };
    },
    invalidate(deployment) {
      epochs.set(deployment, epoch(deployment) + 1);
      for (const [key, entry] of entries) if (entry.deployment === deployment) entries.delete(key);
    },
    clear() {
      for (const deployment of epochs.keys()) epochs.set(deployment, epoch(deployment) + 1);
      entries.clear();
    },
    size: () => entries.size,
  };
}
