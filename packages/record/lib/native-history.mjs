// Independent native record custody. Recipes are relaunch templates, not proof
// of where a past process wrote. Only the execution-side recorder resolves env.
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { nativeLaunchLocations } from "./session-roots.mjs";

function canonical(home) {
  try { return realpathSync(home); }
  catch (e) {
    if (e.code !== "ENOENT") throw e;
    home = resolve(home);
    return dirname(home) === home ? home : join(canonical(dirname(home)), basename(home));
  }
}
// The source-home leaf is an identity, not a redirectable lookup hint. Resolve
// parent aliases (e.g. /tmp), but never select another home's authority by
// following a substituted leaf. Retired homes may legitimately be absent.
function sourceHome(home) {
  const absolute = resolve(home);
  try {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("native record source home was substituted; refusing redirected history authority");
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  return join(canonical(dirname(absolute)), basename(absolute));
}
export function nativeHistoryPath(home) {
  home = sourceHome(home);
  return join(dirname(home), ".oats-native-record", createHash("sha256").update(home).digest("hex"));
}
function atomic(path, value) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(tmp, path);
}
function manifest(home) {
  const value = JSON.parse(readFileSync(join(nativeHistoryPath(home), "history.json"), "utf8"));
  if (value.version !== 1 || value.home !== sourceHome(home) || typeof value.completeHistory !== "boolean") throw new Error("invalid native record history authority");
  return value;
}
// Called only for a newly scaffolded home, before capability hooks. A legacy
// start can record new locations but cannot invent authority for earlier starts.
export function initializeNativeHistory(home, { completeHistory = true } = {}) {
  const dir = nativeHistoryPath(home);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { writeFileSync(join(dir, "history.json"), JSON.stringify({ version: 1, home: sourceHome(home), completeHistory }) + "\n", { mode: 0o600, flag: "wx" }); }
  catch (e) { if (e.code !== "EEXIST") throw e; manifest(home); } // retain earlier launches if a name is reused
}
export function prepareNativeStart(home, runtime) {
  try { manifest(home); }
  catch (e) {
    if (e.code !== "ENOENT") throw e;
    initializeNativeHistory(home, { completeHistory: false });
  }
  const id = randomUUID();
  atomic(join(nativeHistoryPath(home), `${id}.json`), { version: 1, id, home: sourceHome(home), runtime, state: "pending" });
  return id;
}
// Executed under the SAME environment prefix, cwd and native argv as the
// harness, after the backend shell's startup. No environment map or argv is
// serialized. Failure leaves pending evidence and prevents the native exec.
export function recordNativeStart(home, id, runtime, args, env = process.env) {
  manifest(home);
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("invalid native record start id");
  const path = join(nativeHistoryPath(home), `${id}.json`);
  const pending = JSON.parse(readFileSync(path, "utf8"));
  if (pending.version !== 1 || pending.id !== id || pending.home !== sourceHome(home) || pending.runtime !== runtime || pending.state !== "pending") throw new Error("invalid native record start receipt");
  const locations = nativeLaunchLocations(runtime, { cwd: home, env, args }).map(canonical);
  atomic(path, { version: 1, id, home: sourceHome(home), runtime, state: "started", startedAt: new Date().toISOString(), locations });
}
export function historicalSessionRoots(home) {
  const authority = manifest(home);
  if (!authority.completeHistory) throw new Error("native record roots for earlier launches are unknown; legacy history cannot certify complete capture");
  const roots = { cc: [], pi: [], codex: [] };
  for (const name of readdirSync(nativeHistoryPath(home)).sort()) {
    if (name === "history.json") continue;
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) throw new Error("unrecognized or unfinished native record receipt");
    const row = JSON.parse(readFileSync(join(nativeHistoryPath(home), name), "utf8"));
    const source = { claude: "cc", pi: "pi", codex: "codex" }[row.runtime];
    if (row.version !== 1 || row.id !== basename(name, ".json") || row.home !== authority.home || !source || row.state !== "started" || !Array.isArray(row.locations) || row.locations.length === 0) throw new Error("native record launch is pending or its location receipt is invalid");
    for (const path of row.locations) {
      if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0") || resolve(path) !== path) throw new Error("invalid historical native record location");
      if (!roots[source].includes(path)) roots[source].push(path);
    }
  }
  return roots;
}
