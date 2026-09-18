// Independent native record custody. Recipes are relaunch templates, not proof
// of where a past process wrote. Only the execution-side recorder resolves env.
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { isUtf8 } from "node:buffer";
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
  const value = privateJson(join(nativeHistoryPath(home), "history.json"));
  if (value.version === 2) return validateManifest(value, sourceHome(home));
  if (value.version !== 1 || value.home !== sourceHome(home) || typeof value.completeHistory !== "boolean") throw new Error("invalid native record history authority");
  return value;
}
// Called only for a newly scaffolded home, before capability hooks. A legacy
// start can record new locations but cannot invent authority for earlier starts.
export function initializeNativeHistory(home, { completeHistory = true } = {}) {
  const dir = nativeHistoryPath(home);
  // An existing custody directory with a lost manifest is not a new home.
  // Do not repair it to an empty inventory (including through legacy callers).
  if (lstatSync(dir, { throwIfNoEntry: false }) || lstatSync(rootFor(home), { throwIfNoEntry: false })) { manifest(home); return; }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { writeFileSync(join(dir, "history.json"), JSON.stringify({ version: 1, home: sourceHome(home), completeHistory }) + "\n", { mode: 0o600, flag: "wx" }); }
  catch (e) { if (e.code !== "EEXIST") throw e; manifest(home); } // retain earlier launches if a name is reused
}
export function prepareNativeStart(home, runtime) {
  try { if (manifest(home).version !== 1) custodyError("protected history requires captured native preparation"); }
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
  const header = manifest(home);
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("invalid native record start id");
  const path = join(nativeHistoryPath(home), `${id}.json`);
  const pending = header.version === 2 ? privateJson(path) : JSON.parse(readFileSync(path, "utf8"));
  if (header.version === 2) {
    if (pending.version !== 2) custodyError("protected history cannot use a v1 start receipt");
    return recordCapturedPiStart(home, id, runtime, args, env);
  }
  if (pending.version === 2) custodyError("captured receipt lacks its expected-ID manifest");
  if (pending.version !== 1 || pending.id !== id || pending.home !== sourceHome(home) || pending.runtime !== runtime || pending.state !== "pending") throw new Error("invalid native record start receipt");
  const locations = nativeLaunchLocations(runtime, { cwd: home, env, args }).map(canonical);
  atomic(path, { version: 1, id, home: sourceHome(home), runtime, state: "started", startedAt: new Date().toISOString(), locations });
}
export function historicalSessionRoots(home, { withProof = false } = {}) {
  const authority = manifest(home);
  if (!authority.completeHistory) throw new Error("native record roots for earlier launches are unknown; legacy history cannot certify complete capture");
  const roots = { cc: [], pi: [], codex: [] };
  if (authority.version === 2) {
    if (!withProof) custodyError("protected native roots require proof-bearing inventory");
    const capturedPi = { home: authority.home, nativeRecordId: authority.capturedPi.nativeRecordIds[0] };
    const row = proofReceipt(capturedPi); // validates the ENTIRE expected inventory, not surviving rows alone
    roots.pi.push({ path: row.proposedRoot, capturedPi });
    return roots;
  }
  for (const name of readdirSync(nativeHistoryPath(home)).sort()) {
    if (name === "history.json") continue;
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) throw new Error("unrecognized or unfinished native record receipt");
    const row = JSON.parse(readFileSync(join(nativeHistoryPath(home), name), "utf8"));
    const source = { claude: "cc", pi: "pi", codex: "codex" }[row.runtime];
    if (row.version === 2) custodyError("captured receipt lacks its expected-ID manifest");
    if (row.version !== 1 || row.id !== basename(name, ".json") || row.home !== authority.home || !source || row.state !== "started" || !Array.isArray(row.locations) || row.locations.length === 0) throw new Error("native record launch is pending or its location receipt is invalid");
    for (const path of row.locations) {
      if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0") || resolve(path) !== path) throw new Error("invalid historical native record location");
      if (!roots[source].includes(path)) roots[source].push(path);
    }
  }
  return roots;
}

// This advertises the COMPLETE protected discovery/read/append chain, not only
// this writer. The five libraries ship together. Existing v1 receipts are never
// upgraded; only genuinely unused, complete scaffold history may move forward.
export const CAPTURED_PI_RECORD_VERSION = 2;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function custodyError(message) { throw Object.assign(new Error(message), { code: "E_CAPTURED_PI_CUSTODY" }); }
function closed(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) || required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) custodyError("invalid captured Pi custody shape");
}
function absolutePath(path) { return typeof path === "string" && isAbsolute(path) && resolve(path) === path && !/[\0\r\n]/.test(path); }
function validIntent(intent, incarnationId) {
  closed(intent, ["schemaVersion", "executionId", "incarnationId", "attempt"]);
  if (intent.schemaVersion !== 1 || !UUID.test(incarnationId) || intent.incarnationId !== incarnationId || typeof intent.executionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(intent.executionId) || !Number.isSafeInteger(intent.attempt) || intent.attempt < 1) custodyError("invalid original captured Pi intent");
}
function rootFor(home) { const history = nativeHistoryPath(home); return join(dirname(history), basename(history) + ".pi"); }
function physical(path, directory = false) {
  if (!absolutePath(path) || realpathSync(path) !== path) custodyError("captured Pi custody path is not physical");
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (directory && !stat.isDirectory())) custodyError("captured Pi custody path was substituted");
  return stat;
}
function directoryIdentity(path) {
  const stat = physical(path, true);
  if (!Number.isSafeInteger(stat.dev) || !Number.isSafeInteger(stat.ino)) custodyError("unrepresentable captured directory identity");
  return { dev: stat.dev, ino: stat.ino };
}
function privateJson(path) {
  physical(dirname(path), true);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o777) !== 0o600 || (process.getuid && before.uid !== process.getuid()) || before.size > 256 * 1024) custodyError("invalid private captured receipt");
    const bytes = Buffer.alloc(before.size + 1); let size = 0, n;
    while (size < bytes.length && (n = readSync(fd, bytes, size, bytes.length - size, null))) size += n;
    const after = fstatSync(fd), named = lstatSync(path);
    for (const stat of [after, named]) if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.nlink !== 1 || stat.size !== before.size || stat.mtimeMs !== before.mtimeMs || stat.ctimeMs !== before.ctimeMs) custodyError("captured receipt changed while reading");
    if (size !== before.size) custodyError("captured receipt size changed");
    const data = bytes.subarray(0, size);
    if (!isUtf8(data)) custodyError("captured receipt is not UTF-8");
    const text = data.toString("utf8"), value = JSON.parse(text);
    // New private v2 receipts use our compact serializer. Reject duplicate keys
    // and alternate encodings rather than letting parsers disagree on authority.
    if (value?.version === 2 && text.trim() !== JSON.stringify(value)) custodyError("captured receipt is not canonical writer output");
    return value;
  } finally { closeSync(fd); }
}
function validateManifest(header, home) {
  closed(header, ["version", "home", "completeHistory", ...(header?.version === 2 ? ["capturedPi"] : [])]);
  if (![1, 2].includes(header.version) || header.home !== home || header.completeHistory !== true) custodyError("captured history is missing or incomplete");
  if (header.version === 2) {
    closed(header.capturedPi, ["incarnationId", "nativeRecordIds"]);
    const { incarnationId, nativeRecordIds: ids } = header.capturedPi;
    if (!UUID.test(incarnationId) || !Array.isArray(ids) || ids.length === 0 || ids.length > 4096 || ids.some(id => typeof id !== "string" || !UUID.test(id)) || new Set(ids).size !== ids.length) custodyError("invalid captured expected-ID inventory");
  }
  return header;
}
function protectedManifest(home) {
  return validateManifest(privateJson(join(nativeHistoryPath(home), "history.json")), home);
}
function inventory(home) {
  if (!absolutePath(home) || sourceHome(home) !== home) custodyError("captured home identity is not canonical");
  const history = nativeHistoryPath(home); physical(history, true);
  const header = protectedManifest(home);
  const names = readdirSync(history).sort();
  if (names.length > 16384) custodyError("captured receipt inventory exceeds bound");
  const rows = new Map();
  for (const name of names) {
    if (name === "history.json") continue;
    const id = basename(name, ".json");
    if (name !== id + ".json" || !UUID.test(id)) custodyError("unfinished or unknown captured native receipt");
    const row = privateJson(join(history, name));
    if (row.version === 2) {
      validateReceipt(row, home, id);
      if (header.version !== 2 || !header.capturedPi.nativeRecordIds.includes(id) || row.incarnationId !== header.capturedPi.incarnationId || (row.rootWitness && row.rootWitness.establishedBy.nativeRecordId !== header.capturedPi.nativeRecordIds[0])) custodyError("unlisted or foreign captured native receipt");
    } else if (header.version === 2 || row.version !== 1 || row.id !== id || row.home !== home || !["claude", "pi", "codex"].includes(row.runtime) || row.state !== "started" || !Array.isArray(row.locations) || !row.locations.length || row.locations.some(p => !absolutePath(p))) custodyError("unknown or pending historical native receipt");
    rows.set(id, row);
  }
  if (header.version === 2 && (rows.size !== header.capturedPi.nativeRecordIds.length || header.capturedPi.nativeRecordIds.some(id => !rows.has(id)))) custodyError("expected native receipt is missing; history is not fresh or complete");
  if (!isDeepStrictEqual(privateJson(join(history, "history.json")), header) || !isDeepStrictEqual(readdirSync(history).sort(), names)) custodyError("native custody inventory changed during validation");
  return { header, rows };
}
function validateReceipt(row, home, id) {
  closed(row, ["version", "id", "home", "runtime", "incarnationId", "intent", "state", "proposedRoot", "rootWitness"], ["startedAt", "locations"]);
  if (row.version !== 2 || row.id !== id || !UUID.test(id) || row.home !== home || row.runtime !== "pi" || row.proposedRoot !== rootFor(home) || !["pending", "root-established", "started"].includes(row.state)) custodyError("invalid captured native receipt");
  validIntent(row.intent, row.incarnationId);
  if (row.state === "started") {
    if (typeof row.startedAt !== "string" || !Number.isFinite(Date.parse(row.startedAt)) || new Date(row.startedAt).toISOString() !== row.startedAt || !isDeepStrictEqual(row.locations, [row.proposedRoot])) custodyError("invalid captured native start fields");
  } else if (Object.hasOwn(row, "startedAt") || Object.hasOwn(row, "locations")) custodyError("unstarted captured receipt has execution fields");
  if (row.rootWitness === null) { if (row.state !== "pending") custodyError("captured root is unproven"); return; }
  const w = row.rootWitness;
  closed(w, ["schemaVersion", "profile", "path", "identity", "establishedBy"]);
  closed(w.identity, ["dev", "ino"]); closed(w.establishedBy, ["nativeRecordId", "intent"]);
  if (w.schemaVersion !== 1 || w.profile !== "pi-zero-print-1" || w.path !== row.proposedRoot || !UUID.test(w.establishedBy.nativeRecordId) || !Number.isSafeInteger(w.identity.dev) || w.identity.dev < 0 || !Number.isSafeInteger(w.identity.ino) || w.identity.ino < 0) custodyError("invalid original Pi root witness");
  validIntent(w.establishedBy.intent, row.incarnationId);
}
function validateWitness(row, rows) {
  const witness = row.rootWitness, establishing = witness && rows.get(witness.establishedBy.nativeRecordId);
  if (!establishing || establishing.version !== 2 || !["root-established", "started"].includes(establishing.state) || establishing.home !== row.home || establishing.incarnationId !== row.incarnationId || establishing.rootWitness?.establishedBy.nativeRecordId !== establishing.id || !isDeepStrictEqual(establishing.intent, witness.establishedBy.intent) || !isDeepStrictEqual(establishing.rootWitness, witness)) custodyError("original establishing receipt is missing or contradictory");
  if (!isDeepStrictEqual(directoryIdentity(row.proposedRoot), witness.identity)) custodyError("original Pi session directory was replaced");
}
function selection(home, authority, withIntent = false, creating = false) {
  closed(authority, ["incarnationId", "sessionDir", ...(withIntent ? ["intent"] : []), ...(creating ? ["assertAuthority"] : [])]);
  if (!UUID.test(authority.incarnationId) || !absolutePath(home) || home !== sourceHome(home) || authority.sessionDir !== rootFor(home)) custodyError("captured root selection differs from original custody");
  if (withIntent) validIntent(authority.intent, authority.incarnationId);
  if (creating && typeof authority.assertAuthority !== "function") custodyError("kernel authority callback required");
}
function inspectedRoot(home, authority) {
  const { header, rows } = inventory(home), captured = [...rows.values()].filter(r => r.version === 2);
  if (header.version === 2 && header.capturedPi.incarnationId !== authority.incarnationId) custodyError("captured inventory belongs to another incarnation");
  for (const row of captured) {
    if (row.incarnationId !== authority.incarnationId || row.state !== "started") custodyError("foreign or uncertain captured root claim");
    validateWitness(row, rows);
  }
  if (!captured.length) {
    if (header.version !== 1 || rows.size || lstatSync(authority.sessionDir, { throwIfNoEntry: false })) custodyError("existing or previously claimed native storage is not fresh");
    return { header, rows, witness: null };
  }
  const witness = captured[0].rootWitness;
  if (captured.some(r => !isDeepStrictEqual(r.rootWitness, witness))) custodyError("conflicting original Pi root witnesses");
  return { header, rows, witness };
}
export function inspectCapturedPiRoot(home, authority) {
  selection(home, authority); inspectedRoot(home, authority);
}
function syncDirectory(path) { const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
function publishCustody(home, name, value, previous, check) {
  const history = nativeHistoryPath(home), path = join(history, name), tmp = path + "." + randomUUID() + ".tmp";
  const bytes = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(bytes) > 256 * 1024) custodyError("captured custody publication exceeds bound");
  const unchanged = () => { check(); if (previous === null ? lstatSync(path, { throwIfNoEntry: false }) : !isDeepStrictEqual(privateJson(path), previous)) custodyError("native custody publication lost original authority"); };
  unchanged();
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  unchanged(); renameSync(tmp, path); syncDirectory(history); check();
  if (!isDeepStrictEqual(privateJson(path), value)) custodyError("native custody publication is uncertain");
}
function publishCaptured(home, row, previous, check) {
  validateReceipt(row, home, row.id);
  publishCustody(home, row.id + ".json", row, previous, check);
}
export function prepareCapturedPiStart(home, authority) {
  selection(home, authority, true, true); authority.assertAuthority();
  const { header, rows, witness } = inspectedRoot(home, authority);
  if ([...rows.values()].some(r => r.version === 2 && r.intent.executionId === authority.intent.executionId)) custodyError("existing native admission must not prepare another start");
  const history = nativeHistoryPath(home), directories = [dirname(history), history].map(path => [path, directoryIdentity(path)]);
  const check = () => {
    authority.assertAuthority();
    for (const [path, identity] of directories) if (!isDeepStrictEqual(directoryIdentity(path), identity)) custodyError("original native custody parent changed");
    for (const [id, row] of rows) if (!isDeepStrictEqual(privateJson(join(history, id + ".json")), row)) custodyError("original native receipt changed during preparation");
    if (witness && !isDeepStrictEqual(directoryIdentity(authority.sessionDir), witness.identity)) custodyError("original root changed during preparation");
  };
  const id = randomUUID(), pending = { version: 2, id, home, runtime: "pi", incarnationId: authority.incarnationId, intent: structuredClone(authority.intent), state: "pending", proposedRoot: authority.sessionDir, rootWitness: structuredClone(witness) };
  const claimed = validateManifest({ version: 2, home, completeHistory: header.completeHistory, capturedPi: { incarnationId: authority.incarnationId, nativeRecordIds: [...(header.capturedPi?.nativeRecordIds ?? []), id] } }, home);
  // The expected ID is durable BEFORE its pending receipt or root can exist.
  // Losing either receipt or S can no longer masquerade as a fresh scaffold.
  publishCustody(home, "history.json", claimed, header, check);
  const claimCheck = () => { check(); if (!isDeepStrictEqual(protectedManifest(home), claimed)) custodyError("original expected-ID claim changed"); };
  publishCaptured(home, pending, null, claimCheck); claimCheck();
  let established = witness;
  if (witness) validateWitness(pending, rows);
  else {
    mkdirSync(authority.sessionDir, { mode: 0o700 }); // exclusive: EEXIST is uncertainty, never adoption
    const identity = directoryIdentity(authority.sessionDir); syncDirectory(dirname(authority.sessionDir)); claimCheck();
    established = { schemaVersion: 1, profile: "pi-zero-print-1", path: authority.sessionDir, identity, establishedBy: { nativeRecordId: id, intent: structuredClone(authority.intent) } };
  }
  const guard = () => { claimCheck(); if (!isDeepStrictEqual(directoryIdentity(authority.sessionDir), established.identity)) custodyError("captured root changed during establishment"); };
  publishCaptured(home, { ...pending, state: "root-established", rootWitness: established }, pending, guard);
  inventory(home); // no unlisted/unfinished writes may be ignored before return
  return id;
}
function recordCapturedPiStart(home, id, runtime, args, env) {
  const { header, rows } = inventory(home), row = rows.get(id);
  if (!row || row.version !== 2 || row.state !== "root-established" || runtime !== "pi") custodyError("captured start must consume an established v2 receipt");
  for (const prior of rows.values()) if (prior.version === 2 && prior.id !== id) {
    if (prior.state !== "started" || prior.incarnationId !== row.incarnationId || !isDeepStrictEqual(prior.rootWitness, row.rootWitness)) custodyError("other native start is foreign or uncertain");
    validateWitness(prior, rows);
  }
  if (env.OATS_INSTANCE_HOME !== home || env.OATS_INCARNATION_ID !== row.incarnationId || env.OATS_EXECUTION_ID !== row.intent.executionId || env.OATS_EXECUTION_ATTEMPT !== String(row.intent.attempt)) custodyError("native execution differs from original admitted context");
  const selected = Array.isArray(args) ? args.filter(a => typeof a === "string" && (a === "--session-dir" || a.startsWith("--session-dir="))) : [];
  if (selected.length !== 1 || !isDeepStrictEqual(nativeLaunchLocations(runtime, { cwd: home, args, env }), [row.proposedRoot])) custodyError("effective native session directory differs from original root");
  const guard = () => {
    const { rows: current } = inventory(home);
    if (!isDeepStrictEqual(current.get(id), row)) custodyError("prepared native receipt changed");
    validateWitness(row, current);
  };
  // Publication itself changes this row, so the effect guard checks original
  // root/establishing association; previous bytes are separately pinned above.
  guard();
  const establish = rows.get(row.rootWitness.establishedBy.nativeRecordId);
  const check = () => {
    if (!isDeepStrictEqual(protectedManifest(home), header)) custodyError("expected-ID claim changed before execution");
    const current = privateJson(join(nativeHistoryPath(home), establish.id + ".json"));
    if (establish.id !== id && !isDeepStrictEqual(current, establish)) custodyError("establishing receipt changed");
    if (!isDeepStrictEqual(directoryIdentity(row.proposedRoot), row.rootWitness.identity)) custodyError("native root changed before execution");
  };
  publishCaptured(home, { ...row, state: "started", startedAt: new Date().toISOString(), locations: [row.proposedRoot] }, row, check);
}
function proofReceipt(proof) {
  closed(proof, ["home", "nativeRecordId"]);
  if (!UUID.test(proof.nativeRecordId)) custodyError("invalid native root proof reference");
  const { rows } = inventory(proof.home), row = rows.get(proof.nativeRecordId);
  if (!row || row.version !== 2 || row.state !== "started") custodyError("missing started native root proof");
  for (const r of rows.values()) if (r.version === 2) {
    if (r.state !== "started" || r.incarnationId !== row.incarnationId || !isDeepStrictEqual(r.rootWitness, row.rootWitness)) custodyError("incomplete or contradictory captured history");
    validateWitness(r, rows);
  }
  return row;
}
export function assertCapturedPiStart(home, nativeRecordId, authority) {
  selection(home, authority, true);
  const row = proofReceipt({ home, nativeRecordId });
  if (row.incarnationId !== authority.incarnationId || !isDeepStrictEqual(row.intent, authority.intent) || row.proposedRoot !== authority.sessionDir) custodyError("started receipt differs from original admitted root");
}
function protectedRoot(path) {
  for (let dir = resolve(path); ; dir = dirname(dir)) {
    if (basename(dirname(dir)) === ".oats-native-record" && /^[a-f0-9]{64}\.pi$/.test(basename(dir))) return dir;
    if (dirname(dir) === dir) return null;
  }
}
// Shared discovery/snapshot/capture perimeter. A copied proof is only a REF:
// reload the external authoritative receipts; never accept supplied dev/ino.
export function assertCapturedPiProof(proof, path) {
  const row = proofReceipt(proof), rel = relative(row.proposedRoot, path);
  if (!absolutePath(path) || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) custodyError("native source escaped witnessed root");
  for (let current = path; ; current = dirname(current)) {
    const stat = physical(current, current !== path);
    if (current === row.proposedRoot) {
      if (!stat.isDirectory() || !isDeepStrictEqual({ dev: stat.dev, ino: stat.ino }, row.rootWitness.identity)) custodyError("native root changed during contained-path validation");
      break;
    }
  }
}
export function guardCapturedPath(path, proof) {
  if (proof !== undefined) return assertCapturedPiProof(proof, path);
  let physicalPath = path;
  try { physicalPath = realpathSync(path); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (protectedRoot(path) || protectedRoot(physicalPath)) custodyError("protected native path requires its original proof");
}
