// Loaded with --import (through NODE_OPTIONS) in a test worker and in every node child it starts.
// Logs each temporary directory made with mkdtempSync whose name holds MKDTEMP_PROBE_MATCH, and each
// rmSync of such a path: which process, and from where. Changes nothing of what is made or removed.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const log = process.env.MKDTEMP_PROBE_LOG, match = process.env.MKDTEMP_PROBE_MATCH || "oats-tmux-";
if (log) {
  const frames = () => (new Error().stack || "").split("\n").slice(3).map((l) => l.trim().replace(/^at /, "").replace(/file:\/\/\S*\/(lib|bin|test|tests|scripts|packages)\//, "$1/")).filter((l) => /(lib|bin|test|tests|scripts|packages)\//.test(l) && !/mkdtemp-probe/.test(l)).slice(0, 10);
  const note = (what, path) => { try { fs.appendFileSync(log, JSON.stringify({ what, path, pid: process.pid, argv: process.argv.slice(1, 4), frames: frames() }) + "\n"); } catch { /* never fails the call */ } };
  const mkdtempSync = fs.mkdtempSync, rmSync = fs.rmSync;
  fs.mkdtempSync = function (prefix, ...rest) { const made = mkdtempSync.call(this, prefix, ...rest); if (String(made).includes(match)) note("made", made); return made; };
  fs.rmSync = function (path, ...rest) { if (String(path).includes(match)) note("removed", String(path)); return rmSync.call(this, path, ...rest); };
  syncBuiltinESMExports();
}
