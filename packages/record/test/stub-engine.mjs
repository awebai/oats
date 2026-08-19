#!/usr/bin/env node
// Deterministic judge stub for librarian tests: selects every candidate
// whose snippet contains the marker word DECISION, tagging it with fixed
// acts/about/case derived from the candidate line. No model involved.

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const selected = [];
  for (const m of input.matchAll(/^\[(\d+)\] ref=\S+.*\n {4}(.*)$/gm)) {
    const i = Number(m[1]);
    const snippet = m[2];
    if (snippet.includes("DECISION")) {
      selected.push({
        i,
        why: "contains the decision marker",
        acts: ["decides"],
        about: ["widget"],
        case: "widget-rollout",
      });
    }
  }
  process.stdout.write(
    "Here is my selection:\n" + JSON.stringify({ selected, task_slug: "widget-rollout" }) + "\n",
  );
});
