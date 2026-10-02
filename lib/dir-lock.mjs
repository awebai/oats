/**
 * A mkdir lock for short read-modify-write sections over files several oats
 * processes share (the host schedule state, the server registry).
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** A mkdir lock that is never reclaimed by another process: an existing
 *  lock whose owner is unreadable or dead is refused with the directory to
 *  remove, because the gap between mkdir and owner.json belongs to a live
 *  acquirer and a dead-owner reclaim races every other acquirer. The
 *  holder removes its own lock in finally and on SIGINT/SIGTERM. A lock still
 *  held after `retryMs` is refused with `busy(why)`, the caller's own error. */
export function withDirLock(dir, what, fn, { retryMs = 0, busy } = {}) {
  mkdirSync(dirname(dir), { recursive: true });
  const deadline = Date.now() + retryMs;
  for (;;) {
    try { mkdirSync(dir); break; }
    catch (e) {
      if (e.code !== "EEXIST") throw e;
      let owner; try { owner = JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")); } catch { owner = undefined; }
      if (owner?.pid && pidAlive(owner.pid) && Date.now() < deadline) { pause(50); continue; }
      throw busy(!owner ? "its owner is not readable yet or the file is missing" : pidAlive(owner.pid) ? `pid ${owner.pid} holds it` : `its owner pid ${owner.pid} is gone`);
    }
  }
  writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: process.pid, at: new Date().toISOString(), what }) + "\n");
  const release = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };
  const onSignal = (sig) => { release(); process.exit(sig === "SIGINT" ? 130 : 143); };
  process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
  try { return fn(); }
  finally { process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal); release(); }
}
