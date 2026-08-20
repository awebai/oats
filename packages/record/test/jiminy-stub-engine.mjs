#!/usr/bin/env node
// Test stub for the jiminy memory template: proves which session id the
// engine was invoked with by embedding it in the segment it returns.
// Reads the reader prompt on stdin (ignored beyond the first window line
// refs), prints one closed segment covering the window.
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const prompt = chunks.join("");
  const locs = [...prompt.matchAll(/\[line:(\d+)\]/g)].map((m) => Number(m[1]));
  const start = Math.min(...locs);
  const end = Math.max(...locs) + 1;
  const session = process.argv[2] ?? "no-session-arg";
  process.stdout.write(
    JSON.stringify({
      segments: [
        {
          start: `line:${start}`,
          end: `line:${end}`,
          type: "exploration",
          about: ["stub"],
          established: `read with memory session ${session}`,
          outcome: "fruitful",
        },
      ],
    }),
  );
});
