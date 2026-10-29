/** lib/reader-lane.mjs — SPIKE (read-parallel), not for merge: the warm reader's reads on worker lanes, one lane per
 *  read form, so that `status` and `workspace status` are answered at the same time. Each lane is a worker thread: its
 *  own isolate, so its own copy of every module-level binding (lib/read-call.mjs READ_STATE is per lane for free).
 *  A worker cannot chdir, and the cwd is process-wide, so a lane never changes it: while a request runs, the lane's
 *  children get `cwd: <--dir>` (PATH's relative entries and git's repository discovery then resolve as in a CLI run
 *  there) and the lane's `process.cwd()` answers `--dir` (path.resolve of a relative OATS_REMOTE_CACHE,
 *  PI_AGENTS_ROOT, OATS_PACKAGE_CATALOG). The prototype does both with a shim of the lane's own child_process and
 *  process.cwd; a real build would pass `cwd` at each spawn site instead.
 *
 *  Main side: startLanes(reads) → { answer(argv) → frame }. Worker side: this same file, run as a worker. */
import { isMainThread, parentPort, Worker } from "node:worker_threads";

if (isMainThread) {
  // Nothing at import: the main thread only calls startLanes.
} else {
  await laneMain();
}

/** One worker per read form; a request goes to its form's lane, and each lane answers its own in arrival order. */
export async function startLanes(reads) {
  const { hotRead } = await import("./hot-reads.mjs");
  const young = Number(process.env.SPIKE_LANE_YOUNG_MB) || 0;
  const lanes = new Map();
  await Promise.all(reads.map((form) => new Promise((ready, failed) => {
    const worker = new Worker(new URL(import.meta.url), { ...(young ? { resourceLimits: { maxYoungGenerationSizeMb: young } } : {}) });
    const waiting = new Map();
    let seq = 0;
    worker.on("message", (m) => {
      if (m.ready) return ready();
      const w = waiting.get(m.seq);
      waiting.delete(m.seq);
      if (m.error) w.failed(Object.assign(new Error(m.error.message), { stack: m.error.stack }));
      else w.done(m.frame);
    });
    worker.on("error", (e) => { failed(e); for (const w of waiting.values()) w.failed(e); waiting.clear(); });
    lanes.set(form, { ask: (argv) => new Promise((done, f) => { const n = ++seq; waiting.set(n, { done, failed: f }); worker.postMessage({ seq: n, argv }); }) });
  })));
  return {
    // A request no lane takes is answered by the first lane: its answer is the refusal the reader gives it.
    answer: (argv) => (lanes.get(hotRead(argv)?.form) ?? lanes.values().next().value).ask(argv),
  };
}

async function laneMain() {
  const { statSync, accessSync, constants } = await import("node:fs");
  const cp = (await import("node:child_process")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  let current = null;
  const withCwd = (options) => (current && !(options && options.cwd) ? { ...(options || {}), cwd: current } : options);
  for (const name of ["execFileSync", "spawnSync", "spawn", "execFile"]) {
    const orig = cp[name];
    cp[name] = function (file, args, options, ...rest) {
      if (Array.isArray(args)) return orig.call(this, file, args, withCwd(options), ...rest);
      if (args && typeof args === "object") return orig.call(this, file, withCwd(args), options, ...rest);
      return orig.call(this, file, args, withCwd(options), ...rest);
    };
  }
  syncBuiltinESMExports();
  const cwd = process.cwd.bind(process);
  process.cwd = () => current ?? cwd();
  const lane = {
    /** As a chdir to `dir` would: a refusal message when it could not be the working directory. */
    enter(dir) {
      try {
        if (!statSync(dir).isDirectory()) return `--dir ${dir} cannot be the working directory (ENOTDIR)`;
        accessSync(dir, constants.X_OK);
      } catch (e) { return `--dir ${dir} cannot be the working directory (${e.code ?? e.message})`; }
      current = dir;
      return null;
    },
    leave() { current = null; },
  };
  const { answer, PRELOAD } = await import("./reader.mjs");
  for (const load of Object.values(PRELOAD)) await load();
  let chain = Promise.resolve();
  parentPort.on("message", ({ seq, argv }) => {
    chain = chain.then(async () => {
      // The frame as JSON text: one stringify here, where the main thread would do it, and no structured clone.
      try { parentPort.postMessage({ seq, frame: { raw: JSON.stringify(await answer(argv, () => {}, { lane })) } }); }
      catch (e) { parentPort.postMessage({ seq, error: { message: String(e?.message ?? e), stack: String(e?.stack ?? e) } }); }
    });
  });
  parentPort.postMessage({ ready: true });
}
