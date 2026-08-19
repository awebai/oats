#!/usr/bin/env node
// Hostile reader engine: fabricated out-of-thread refs and an inverted span.
process.stdin.resume();
process.stdin.on("end", () => {
  process.stdout.write(
    JSON.stringify({
      segments: [
        { start: "line:9999", end: "line:1", type: "admin", established: "fabricated", outcome: "fruitful" },
        { start: "line:3", end: "line:1", type: "admin", established: "inverted", outcome: "fruitful" },
      ],
    }) + "\n",
  );
});
process.stdin.on("data", () => {});
