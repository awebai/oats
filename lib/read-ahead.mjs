/** Read-ahead for the tree digests (fingerprintTrees): while a digest reads a
 *  tree, file by file, on the calling thread, worker threads read the files it
 *  will read next, several at once, so that its own reads come from the page
 *  cache. A digest of a cold tree of many small files is otherwise bound by
 *  the latency of one read at a time (#1247).
 *
 *  It changes nothing the digest computes. The digest reads every byte it
 *  hashes itself, with the same calls, in the same order, and an error is the
 *  error its own read meets: the readers' results and errors are dropped. A
 *  recovery copy's verification therefore still reads the copy's own bytes.
 *  A read-ahead that cannot start, falls behind or stops costs speed only, and
 *  the caller never waits for it: it stays synchronous.
 *
 *  Bounds: at most `readers` files are read at once (one per reader thread),
 *  each through one reused 1 MiB buffer, so the threads hold `readers` MiB.
 *  The planner never runs more than `windowKiB` of file bytes or
 *  `windowFiles` files ahead of what the digest has read, so what it brings
 *  into the cache is read soon after; a file larger than the window is left
 *  to the digest. The page cache is the kernel's, reclaimable, not this
 *  process's memory. */
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

/** The shared counters (an Int32Array over a SharedArrayBuffer). */
export const CTL = { JOB: 0, CONSUMED_KIB: 1, CONSUMED_FILES: 2, IN_FLIGHT: 3, MAX_IN_FLIGHT: 4, MAX_AHEAD_KIB: 5, MAX_AHEAD_FILES: 6 };
const CTL_LENGTH = 7;

const defaults = () => ({ enabled: true, readers: Math.min(4, Math.max(2, availableParallelism())), windowKiB: 64 * 1024, windowFiles: 4096 });
let settings = defaults();
// undefined: not started yet; null: could not start, and is not tried again.
let pool;
let active = false;
let unnotifiedKiB = 0, unnotifiedFiles = 0;

function started() {
  if (pool !== undefined) return pool;
  try {
    const ctl = new Int32Array(new SharedArrayBuffer(CTL_LENGTH * Int32Array.BYTES_PER_ELEMENT));
    const planner = new Worker(new URL("./read-ahead-worker.mjs", import.meta.url), {
      // Not the process's own flags (an --import preload, a profiler): the threads only read.
      execArgv: [],
      workerData: { role: "planner", ctl, readers: settings.readers, windowKiB: settings.windowKiB, windowFiles: settings.windowFiles },
    });
    planner.on("error", () => { if (pool?.planner === planner) pool = null; });
    // Never what keeps the process alive.
    planner.unref();
    pool = { planner, ctl };
  } catch {
    pool = null;
  }
  return pool;
}

/** Run `fn` (a digest of `roots`, paths as text or bytes, read in this order)
 *  with the files of `roots` read ahead → what `fn` returns. The walk is the
 *  digest's: `order` "bytes" (the names' bytes) or "locale" (their text by
 *  localeCompare, the legacy stored digest), passing over `excludeRoot` (top-level
 *  names, as text) and `excludePaths` (paths under a root, as bytes). Inside
 *  another read-ahead, `fn` simply runs: that one already reads its files. */
export function readingAhead(roots, { order = "bytes", excludeRoot = [], excludePaths = [] } = {}, fn) {
  if (active || !settings.enabled) return fn();
  const p = started();
  if (!p) return fn();
  const { ctl, planner } = p;
  for (const i of [CTL.CONSUMED_KIB, CTL.CONSUMED_FILES, CTL.MAX_IN_FLIGHT, CTL.MAX_AHEAD_KIB, CTL.MAX_AHEAD_FILES]) Atomics.store(ctl, i, 0);
  const job = Atomics.add(ctl, CTL.JOB, 1) + 1;
  try {
    planner.postMessage({ job, roots: roots.map((root) => Buffer.from(root)), order, excludeRoot: [...excludeRoot], excludePaths: excludePaths.map((path) => Buffer.from(path).toString("hex")) });
  } catch {
    return fn();
  }
  active = true;
  unnotifiedKiB = 0; unnotifiedFiles = 0;
  try {
    return fn();
  } finally {
    active = false;
    // The job ends: the planner stops, and the readers drop what is queued.
    Atomics.add(ctl, CTL.JOB, 1);
    Atomics.notify(ctl, CTL.CONSUMED_KIB);
  }
}

/** Tell the read-ahead that the digest has read a file of `bytes` bytes. */
export function readAheadConsumed(bytes) {
  if (!active) return;
  const { ctl } = pool;
  const kib = Math.ceil(bytes / 1024);
  Atomics.add(ctl, CTL.CONSUMED_KIB, kib);
  Atomics.add(ctl, CTL.CONSUMED_FILES, 1);
  // The planner is woken once per eighth of the window read, not per file: a
  // wake costs the digest's thread more than a small file's read.
  unnotifiedKiB += kib; unnotifiedFiles++;
  if (unnotifiedKiB >= settings.windowKiB / 8 || unnotifiedFiles >= settings.windowFiles / 8) {
    unnotifiedKiB = 0; unnotifiedFiles = 0;
    Atomics.notify(ctl, CTL.CONSUMED_KIB);
  }
}

/** For tests: the defaults with `options` over them (a new pool starts with
 *  them); with none, the defaults. */
export function configureReadAhead(options) {
  settings = { ...defaults(), ...options };
  if (pool) pool.planner.terminate().catch(() => {});
  pool = undefined;
}

/** For tests: the highest number of files read at once, and the most the
 *  planner ran ahead of the digest (KiB and files), in the last read-ahead.
 *  → undefined when no read-ahead has run. */
export function readAheadStats() {
  if (!pool) return undefined;
  const { ctl } = pool;
  return { maxInFlight: Atomics.load(ctl, CTL.MAX_IN_FLIGHT), maxAheadKiB: Atomics.load(ctl, CTL.MAX_AHEAD_KIB), maxAheadFiles: Atomics.load(ctl, CTL.MAX_AHEAD_FILES), readers: settings.readers, windowKiB: settings.windowKiB, windowFiles: settings.windowFiles };
}
