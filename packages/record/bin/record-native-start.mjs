#!/usr/bin/env node
// The environment/argv stays in this process, never in the custody receipt.
import { recordNativeStart } from "../lib/native-history.mjs";
try {
  const [home, id, runtime, args] = process.argv.slice(2);
  recordNativeStart(home, id, runtime, JSON.parse(args));
} catch {
  // Native paths can contain user-chosen data; never echo argv or env on errors.
  console.error("native record location receipt failed; launch refused and pending custody retained");
  process.exitCode = 1;
}
