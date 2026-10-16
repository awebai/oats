// Measurement worker for the qualification harness (#1108 checkpoint Q). The
// supervisor's existing workerPath seam starts it in place of
// capture-command-worker.mjs; it runs the same production operation through the
// same runCaptureWorker, after installing the existing test counting patches
// (node:sqlite opens/begins/commits; fs fsync/rename/mkdir) in this process,
// and counts the bytes lib reads, by path kind. lib reads files only through
// readSync and readFileSync (no streams, promises or FileHandle reads), both
// named imports that syncBuiltinESMExports rebinds; SQLite reads in C and is
// never counted here.
// On exit it appends its counts and /proc samples beside, never inside, the
// record root: `<root>.qualify-counts/<pid>-<worker nonce>.json`, a name a
// reused pid cannot overwrite.
import fs from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join, sep } from "node:path";
import { runCaptureWorker } from "../../lib/capture-worker.mjs";
import { captureCommandOperation } from "../../lib/capture-command-operation.mjs";

const require = createRequire(import.meta.url);
const counts = { sqlite: { opens: 0, begins: 0, commits: 0 }, fsync: {}, rename: {}, mkdir: 0, opened: {}, readBytes: {} };
const paths = new Map();
// The record root and the captured home, each as given and as resolved, so
// a path lib resolved still classifies.
let roots = [], homes = [];
const both = path => [...new Set([path, fs.realpathSync(path)])];
const under = (path, dirs) => dirs.find(dir => path.startsWith(dir + sep));
// Where an operation lands: a capture source under the captured home, or
// another path outside the record root; under the root, a journal, staging
// scratch, status, the derived databases' side files, or another path.
function kind(path) {
  if (typeof path !== "string") return "unknown";
  const root = under(path, roots);
  if (!root) return under(path, homes) ? "source" : "outside-root";
  const rest = path.slice(root.length + 1);
  if (rest.startsWith(`streams${sep}`)) return rest.endsWith("journal.jsonl") ? "journal" : "stream-dir";
  if (rest.startsWith(`.capture-tmp${sep}`) || rest === ".capture-tmp") return "staging";
  if (rest.startsWith("capture-status")) return "status";
  if (rest.startsWith(`index${sep}`)) return "index";
  return "other";
}
const bump = (map, key, n = 1) => { map[key] = (map[key] ?? 0) + n; };

const sqlite = require("node:sqlite"), Original = sqlite.DatabaseSync;
sqlite.DatabaseSync = class extends Original {
  constructor(...args) { super(...args); counts.sqlite.opens++; }
  exec(sql) {
    if (/^\s*BEGIN/i.test(sql)) counts.sqlite.begins++;
    if (/^\s*COMMIT/i.test(sql)) counts.sqlite.commits++;
    return super.exec(sql);
  }
};
const { openSync, fsyncSync, fdatasyncSync, renameSync, mkdirSync, readSync, readFileSync } = fs;
fs.openSync = (path, ...rest) => { const fd = openSync(path, ...rest); paths.set(fd, String(path)); bump(counts.opened, kind(String(path))); return fd; };
fs.fsyncSync = fd => { bump(counts.fsync, kind(paths.get(fd))); return fsyncSync(fd); };
fs.fdatasyncSync = fd => { bump(counts.fsync, kind(paths.get(fd))); return fdatasyncSync(fd); };
fs.renameSync = (from, to) => { bump(counts.rename, kind(String(to))); return renameSync(from, to); };
fs.mkdirSync = (path, ...rest) => { counts.mkdir++; return mkdirSync(path, ...rest); };
fs.readSync = (fd, ...rest) => { const n = readSync(fd, ...rest); bump(counts.readBytes, kind(paths.get(fd)), n); return n; };
fs.readFileSync = (path, options) => {
  const value = readFileSync(path, options), encoding = typeof options === "string" ? options : options?.encoding;
  bump(counts.readBytes, kind(typeof path === "number" ? paths.get(path) : String(path)),
    typeof value === "string" ? Buffer.byteLength(value, encoding ?? "utf8") : value.length);
  return value;
};
syncBuiltinESMExports();

function proc(name) {
  // The unpatched read: sampling is not the operation's reading.
  try { return readFileSync(`/proc/self/${name}`, "utf8"); } catch { return null; }
}
function sample() {
  const io = Object.fromEntries((proc("io") ?? "").trim().split("\n").filter(Boolean).map(line => line.split(": ")).map(([k, v]) => [k, Number(v)]));
  const hwm = /^VmHWM:\s+(\d+) kB$/m.exec(proc("status") ?? "")?.[1];
  return { io, vmHwmBytes: hwm ? Number(hwm) * 1024 : null, heapUsedBytes: process.memoryUsage().heapUsed };
}

await runCaptureWorker(async start => {
  roots = both(start.root); homes = both(start.options.plan.home);
  try { return await captureCommandOperation(start); }
  finally {
    const directory = `${start.root}.qualify-counts`;
    mkdirSync(directory, { recursive: true });
    fs.writeFileSync(join(directory, `${process.pid}-${start.workerNonce}.json`), JSON.stringify({ pid: process.pid, counts, ...sample() }));
  }
});
