// Stands in for the fake CLI of test/desktop-server.test.mjs in a probe copy of that file: logs when
// this process started, its first line and its exit, then runs the real fake unchanged.
import { appendFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
const now = () => performance.timeOrigin + performance.now();
const rec = (what) => {
  try {
    appendFileSync(process.env.FAKE_PROBE_LOG, JSON.stringify({ t: now(), what, pid: process.pid, started: now() - process.uptime() * 1000,
      tools: process.env.FAKE_PROBE_TOOLS ?? null, args: process.argv.slice(2, 5) }) + "\n");
  } catch { /* the probe never fails the fake */ }
};
rec("fake-first-line");
process.on("exit", () => rec("fake-exit"));
await import(process.env.FAKE_PROBE_TARGET);
