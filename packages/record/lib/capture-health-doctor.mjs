// Fixed private package entry for the kernel's bounded offline diagnosis.
// No store construction, capture dispatch, manager or configurable executable.
import { homedir } from "node:os";
import { join } from "node:path";
import { captureHealthForDoctor } from "./capture-health.mjs";

try {
  const root = process.env.TURN_RECORD_ROOT ?? join(homedir(), ".turn-record");
  console.log(JSON.stringify(captureHealthForDoctor(root)));
} catch (error) {
  console.log(JSON.stringify({ status: "failed", error: error.message }));
  process.exitCode = 1;
}
