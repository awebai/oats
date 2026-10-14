// Package-private synchronous work context. Public library calls never enter
// this scope implicitly. A worker chooses bounded work before entering it.
import { DerivedState } from "./derived-state.mjs";

const contexts = new WeakMap();
export const captureContext = store => contexts.get(store);

// All stream locks precede the database write transaction, matching ordinary
// writers' stream -> database order. Acquiring another stream inside the
// transaction would deadlock against a public caller holding that stream.
export function withCaptureGroup(store, streams, fn, { state, check = () => {}, batchBytes = 8 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(batchBytes) || batchBytes < 1 || batchBytes > 8 * 1024 * 1024) throw new Error("invalid capture work-group batch size");
  if (contexts.has(store)) throw new Error("capture work groups cannot nest");
  if (state?.depth) throw new Error("capture work group cannot acquire streams inside a transaction");
  const held = new Set();
  for (const stream of streams) {
    store.journalPath(stream);
    held.add(stream);
    if (held.size > 128) throw new Error("capture work group exceeds 128 streams");
  }
  const ordered = [...held].sort();
  const acquire = index => {
    check();
    if (index < ordered.length) return store.withStreamLock(ordered[index], () => acquire(index + 1), { check });
    const owned = !state, derived = state ?? new DerivedState(store.root);
    try {
      return derived.transaction(() => {
        contexts.set(store, { state: derived, held, batchBytes });
        try {
          const result = fn();
          if (result && typeof result.then === "function") throw new Error("capture work groups must be synchronous");
          return result;
        } finally { contexts.delete(store); }
      });
    } finally { if (owned) derived.close(); }
  };
  return acquire(0);
}
