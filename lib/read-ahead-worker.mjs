/** The threads of read-ahead.mjs: one planner and its readers. They only read,
 *  and only to bring files into the page cache: every result and every error
 *  is dropped. Nothing they do is part of a digest.
 *
 *  The planner walks each root of a job in the order the digest will read it
 *  and hands each regular file to a free reader. It never gets more than the
 *  window (`windowKiB`, `windowFiles`) ahead of what the digest has read
 *  (CONSUMED_KIB, CONSUMED_FILES, which read-ahead.mjs counts), so the cache
 *  it fills is read before it can be evicted. A file larger than the window
 *  is passed over: the digest reads it itself, as one sequential read. A job
 *  ends when the digest finishes and moves JOB on; whatever is still queued
 *  is then dropped. */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { sep } from "node:path";
import { parentPort, workerData, Worker } from "node:worker_threads";
import { CTL } from "./read-ahead.mjs";

const ctl = workerData.ctl;
const current = (job) => Atomics.load(ctl, CTL.JOB) === job;

if (workerData.role === "reader") {
  // One read at a time, through one reused buffer: a reader holds CHUNK bytes, whatever the file's size.
  const CHUNK = 1 << 20;
  const buffer = Buffer.allocUnsafe(CHUNK);
  // O_NONBLOCK: a FIFO put in a file's place since the planner's lstat never blocks the open.
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  parentPort.on("message", ({ job, path }) => {
    if (current(job)) {
      const inFlight = Atomics.add(ctl, CTL.IN_FLIGHT, 1) + 1;
      if (inFlight > Atomics.load(ctl, CTL.MAX_IN_FLIGHT)) Atomics.store(ctl, CTL.MAX_IN_FLIGHT, inFlight);
      try {
        const fd = openSync(path, flags);
        try { if (fstatSync(fd).isFile()) while (current(job) && readSync(fd, buffer, 0, CHUNK, null) > 0); }
        finally { closeSync(fd); }
      } catch { /* the digest reads this file itself, and reports what it finds */ }
      Atomics.sub(ctl, CTL.IN_FLIGHT, 1);
    }
    parentPort.postMessage(0);
  });
} else {
  const { readers: count, windowKiB, windowFiles } = workerData;
  const readers = [];
  const free = [];
  let wake = null;
  const woken = () => { const w = wake; wake = null; w?.(); };
  for (let i = 0; i < count; i++) {
    const reader = new Worker(new URL(import.meta.url), { workerData: { role: "reader", ctl } });
    reader.on("error", () => {}); // a reader that fails is one reader fewer
    reader.on("message", () => { free.push(reader); woken(); });
    readers.push(reader);
    free.push(reader);
  }
  const SEP = Buffer.from(sep);
  const join = (dir, name) => Buffer.concat([dir, SEP, name]);
  // The digest's order of a directory's names (fingerprintTrees): their bytes,
  // or, for the legacy stored digest, their text by localeCompare.
  const names = (dir, order) => {
    const list = readdirSync(dir, { encoding: "buffer" });
    return order === "locale"
      ? list.map((bytes) => ({ bytes, name: bytes.toString("utf8") })).sort((a, b) => a.name.localeCompare(b.name)).map((e) => e.bytes)
      : list.sort(Buffer.compare);
  };
  // The regular files under `root` in walk order, with their sizes, passing
  // over what the digest passes over. An entry that cannot be read is skipped.
  function* files(root, { order, excludeRoot, excludePaths }) {
    let st;
    try { st = lstatSync(root); } catch { return; }
    if (st.isFile()) { yield [root, st.size]; return; }
    if (!st.isDirectory()) return;
    const walk = function* (dir, rel) {
      let list;
      try { list = names(dir, order); } catch { return; }
      for (const name of list) {
        const childRel = rel ? Buffer.concat([rel, SEP, name]) : name;
        if ((!rel && excludeRoot.has(name.toString("utf8"))) || (excludePaths.size && excludePaths.has(childRel.toString("hex")))) continue;
        const path = join(dir, name);
        let entry;
        try { entry = lstatSync(path); } catch { continue; }
        if (entry.isDirectory()) yield* walk(path, childRel);
        else if (entry.isFile()) yield [path, entry.size];
      }
    };
    yield* walk(root, null);
  }
  const kib = (bytes) => Math.ceil(bytes / 1024);
  // Resolves when a reader is free or the digest has read more, or after a
  // short while in any case, so that a job that ended is seen.
  const progress = () => new Promise((resolve) => {
    wake = resolve;
    const waited = Atomics.waitAsync(ctl, CTL.CONSUMED_KIB, Atomics.load(ctl, CTL.CONSUMED_KIB), 20);
    (waited.async ? waited.value : Promise.resolve()).then(() => { if (wake === resolve) woken(); });
  });
  let running = Promise.resolve();
  parentPort.on("message", (job) => {
    running = running.then(() => plan(job)).catch(() => {});
  });
  async function plan({ job, roots, order, excludeRoot, excludePaths }) {
    const options = { order, excludeRoot: new Set(excludeRoot), excludePaths: new Set(excludePaths) };
    let plannedKiB = 0, plannedFiles = 0;
    for (const root of roots) {
      for (const [path, size] of files(Buffer.from(root), options)) {
        if (!current(job)) return;
        plannedKiB += kib(size); plannedFiles++;
        if (kib(size) > windowKiB) continue;
        for (;;) {
          if (!current(job)) return;
          const aheadKiB = plannedKiB - Atomics.load(ctl, CTL.CONSUMED_KIB), aheadFiles = plannedFiles - Atomics.load(ctl, CTL.CONSUMED_FILES);
          if (free.length && aheadKiB <= windowKiB && aheadFiles <= windowFiles) {
            if (aheadKiB > Atomics.load(ctl, CTL.MAX_AHEAD_KIB)) Atomics.store(ctl, CTL.MAX_AHEAD_KIB, aheadKiB);
            if (aheadFiles > Atomics.load(ctl, CTL.MAX_AHEAD_FILES)) Atomics.store(ctl, CTL.MAX_AHEAD_FILES, aheadFiles);
            break;
          }
          await progress();
        }
        free.pop().postMessage({ job, path });
      }
    }
  }
}
