// Fixed command policy. Alternate values are an internal test seam, never CLI
// tuning flags or evidence that unbounded public receipt operations are bounded.
import { performance } from "node:perf_hooks";

export const CAPTURE_POLICY = Object.freeze({ intervalSeconds: 900, heapMiB: 256,
  rssBytes: 2147483648, deadlineSeconds: 300, maxRecordBytes: 8388608 });

export class CaptureStop extends Error {
  constructor(reason) { super(`capture stopped: ${reason}`); this.reason = reason; }
}

export class CaptureBudget {
  constructor({ policy = CAPTURE_POLICY, clock = () => performance.now(),
    rss = () => process.memoryUsage().rss, supervisorAlive = () => true, drainSeconds = 5, drainAt } = {}) {
    this.policy = policy; this.clock = clock; this.rss = rss;
    this.supervisorAlive = supervisorAlive; this.started = clock();
    this.drainAt = drainAt ?? this.started + Math.max(0, policy.deadlineSeconds - drainSeconds) * 1000;
    this.peakRssBytes = null; this.reason = null;
  }
  sample() {
    const rss = this.rss();
    this.peakRssBytes = Math.max(this.peakRssBytes ?? 0, rss);
    if (!this.reason) {
      if (!this.supervisorAlive()) this.reason = "interrupted";
      else if (rss > this.policy.rssBytes) this.reason = "rss";
      else if (this.clock() >= this.drainAt) this.reason = "deadline";
    }
    return this.reason;
  }
  check() { const reason = this.sample(); if (reason) throw new CaptureStop(reason); }
}
