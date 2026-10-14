// Loaded with --import (through NODE_OPTIONS) in a test worker and in every node child it starts.
// Logs each `oats: warning:` line written to this process's stderr or stdout: which process wrote
// it, and from where. Changes nothing of what is written.
import { appendFileSync } from "node:fs";
const log = process.env.WARN_PROBE_LOG;
if (log) {
  for (const stream of ["stderr", "stdout"]) {
    const original = process[stream].write;
    process[stream].write = function (chunk, ...rest) {
      try {
        const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
        if (text.includes("oats: warning:")) {
          const frames = (new Error().stack || "").split("\n").slice(2).map((l) => l.trim().replace(/^at /, "").replace(/file:\/\/\S*\/(lib|bin|test|tests|scripts|packages)\//, "$1/")).filter((l) => /(lib|bin|test|tests|scripts|packages)\//.test(l) && !/stderr-probe/.test(l));
          appendFileSync(log, JSON.stringify({ stream, pid: process.pid, argv: process.argv.slice(1, 5), worker: /\.test\.mjs$/.test(process.argv[1] ?? ""), tty: !!process[stream].isTTY, text: text.trim().slice(0, 260), frames: frames.slice(0, 12) }) + "\n");
        }
      } catch { /* the probe never fails a write */ }
      return original.call(this, chunk, ...rest);
    };
  }
}
