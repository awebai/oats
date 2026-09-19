/** Bounded, non-authorizing observations in the EXISTING witnessed Pi history
 * directory. These JSON files are NOT native JSONL transcripts or root proofs. */
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, realpathSync, renameSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalJson, parseStrictJson } from "./portable-values.mjs";
import { objectAt } from "./portable-shape.mjs";
import { oatsError } from "./errors.mjs";

const bad = message => { throw oatsError("E_PI_HOST_OUTCOME", message); };
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const limits = { maxBytes: 32768, maxDepth: 16, maxEntries: 512 };
const code = value => Number.isInteger(value) && value >= 0 && value <= 255;
const text = value => typeof value === "string" && value.length > 0 && value.length <= 4096 && !value.includes("\0");

export function piOutcomePath(sessionDir, nativeRecordId, kind) {
  if (!isAbsolute(sessionDir) || resolve(sessionDir) !== sessionDir || sessionDir.includes("\0")
    || typeof nativeRecordId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(nativeRecordId) || !["sdk", "process"].includes(kind)) bad("invalid Pi outcome locator");
  return join(sessionDir, `.oats-pi-${kind}-${nativeRecordId}.json`);
}

function syncDirectory(path, check) {
  check();
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { fsyncSync(fd); } finally { closeSync(fd); }
  check();
}

/** Exclusive publication; uncertain/partial/existing evidence is retained, not
 * overwritten, adopted or cleaned to manufacture a successful observation. */
function writeOnce(path, bytes, check) {
  check();
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  const identity = fstatSync(fd);
  const checkFile = () => {
    check();
    const current = lstatSync(path);
    if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino) bad("Pi outcome file was replaced during publication");
  };
  try {
    checkFile();
    let offset = 0;
    while (offset < bytes.length) {
      const count = writeSync(fd, bytes, offset, bytes.length - offset);
      if (count <= 0) bad("Pi outcome write did not complete");
      offset += count;
    }
    fsyncSync(fd); checkFile();
  } finally { closeSync(fd); }
  syncDirectory(dirname(path), check);
  checkFile();
}

function validateObservation(observed) {
  objectAt(observed, ["exitCode", "observation"], ["exitCode", "observation"]);
  if (!code(observed.exitCode)) bad("SDK outcome lacks an observed numeric return status");
  const o = observed.observation;
  if (o === null) return;
  objectAt(o, ["sdkVersion", "header", "sessionId", "sessionFile", "model", "finalAssistant"], ["sdkVersion", "header", "sessionId", "sessionFile", "model", "finalAssistant"]);
  for (const field of ["sdkVersion", "sessionId", "sessionFile"]) if (o[field] !== null && !text(o[field])) bad("invalid SDK metadata");
  if (o.header !== null) {
    objectAt(o.header, ["type", "version", "id", "cwd", "timestamp"], ["type", "version", "id", "cwd", "timestamp"]);
    if (o.header.type !== "session" || !Number.isSafeInteger(o.header.version) || !["id", "cwd", "timestamp"].every(k => text(o.header[k]))) bad("invalid observed SDK header");
  }
  if (o.model !== null) {
    objectAt(o.model, ["provider", "id"], ["provider", "id"]);
    if (!text(o.model.provider) || !text(o.model.id)) bad("invalid observed SDK model");
  }
  if (o.finalAssistant !== null) {
    const a = o.finalAssistant;
    objectAt(a, ["entryId", "provider", "model", "responseModel", "stopReason", "timestamp"], ["entryId", "provider", "model", "responseModel", "stopReason", "timestamp"]);
    if (!["entryId", "provider", "model"].every(k => text(a[k])) || (a.responseModel !== null && !text(a.responseModel))
      || !["stop", "length", "toolUse", "error", "aborted"].includes(a.stopReason) || !Number.isFinite(a.timestamp) || a.timestamp < 0) bad("invalid final assistant metadata");
  }
}

function validateReceipt(value, kind, authority) {
  canonicalJson(value, limits);
  objectAt(value, ["schemaVersion", "kind", "authority", "observed"], ["schemaVersion", "kind", "authority", "observed"]);
  if (value.schemaVersion !== 1 || value.kind !== `oats.pi-${kind}-outcome` || !same(value.authority, authority)) bad("Pi outcome differs from original dispatch authority");
  if (kind === "sdk") validateObservation(value.observed);
  else {
    objectAt(value.observed, ["exitCode", "source"], ["exitCode", "source"]);
    if (!code(value.observed.exitCode) || value.observed.source !== "launcher-wait-status") bad("process outcome lacks actual launcher status");
  }
  return value;
}

export function writePiOutcome(kind, authority, observed, check) {
  const receipt = { schemaVersion: 1, kind: `oats.pi-${kind}-outcome`, authority, observed };
  validateReceipt(receipt, kind, authority);
  writeOnce(piOutcomePath(authority.sessionDir, authority.nativeRecordId, kind), Buffer.from(canonicalJson(receipt, limits)), check);
  return receipt;
}

/** Preserve the legacy ID-only marker. Called AFTER process outcome publication,
 * under the same original home/root guards, never by an unguarded shell write. */
export function writePiExitMarker(authority, check) {
  const temporary = join(authority.home, `.oats-start-exited.${authority.nativeRecordId}.tmp`);
  writeOnce(temporary, Buffer.from(authority.intent.executionId + "\n"), check);
  check();
  renameSync(temporary, join(authority.home, ".oats-start-exited"));
  syncDirectory(authority.home, check);
}

export function readPiOutcome(kind, authority, check) {
  const path = piOutcomePath(authority.sessionDir, authority.nativeRecordId, kind);
  check();
  let before;
  try { before = lstatSync(path); }
  catch (error) { if (error.code !== "ENOENT") throw error; check(); return null; }
  if (!before.isFile() || before.size > limits.maxBytes) bad("Pi outcome is not a bounded regular file");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const assertNamedDescriptor = () => {
      // A pre-open stat can ALSO belong to a redirected ancestor. Bind the FD
      // to the CURRENT physical name under original-root proof before reading,
      // not merely to that earlier stat or a root that was restored after open.
      check();
      const named = lstatSync(path), opened = fstatSync(fd);
      if (realpathSync(path) !== path) bad("Pi outcome path is not physical");
      for (const stat of [named, opened]) {
        if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino
          || stat.size !== before.size || stat.mtimeMs !== before.mtimeMs || stat.ctimeMs !== before.ctimeMs) bad("Pi outcome descriptor differs from its witnessed name");
      }
      check();
    };
    assertNamedDescriptor();
    const bytes = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < bytes.length) {
      assertNamedDescriptor();
      const n = readSync(fd, bytes, size, bytes.length - size, null);
      if (n === 0) break;
      size += n;
    }
    assertNamedDescriptor();
    if (size !== before.size) bad("Pi outcome changed while reading");
    return validateReceipt(parseStrictJson(bytes.subarray(0, size), limits), kind, authority);
  } finally { closeSync(fd); }
}

/** Qualifies ONLY native-print completion, never learning/privacy/readiness or
 * another action. Actual root checks surround receipt/session-path reads. */
export function summarizePiOutcome(authority, sdk, process, check) {
  if (sdk) validateReceipt(sdk, "sdk", authority);
  if (process) validateReceipt(process, "process", authority);
  const observed = sdk?.observed.observation, selected = authority.selected;
  let sessionFileObserved = false;
  if (observed?.sessionFile) {
    const file = observed.sessionFile;
    if (!isAbsolute(file) || resolve(file) !== file || dirname(file) !== authority.sessionDir || !file.endsWith(".jsonl")) bad("SDK outcome names an unowned session file");
    check();
    try { sessionFileObserved = lstatSync(file).isFile() && realpathSync(file) === file; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    check();
  }
  const final = observed?.finalAssistant;
  const finalObserved = !!(sessionFileObserved && observed.sdkVersion === selected.sdkVersion
    && observed.header?.version === 3 && observed.header.cwd === authority.home
    && observed.header.id === observed.sessionId && observed.model?.provider === selected.provider
    && observed.model.id === selected.id && final?.provider === selected.provider && final.model === selected.id);
  const processExitCode = process?.observed.exitCode ?? null, sdkExitCode = sdk?.observed.exitCode ?? null;
  const failed = (processExitCode !== null && processExitCode !== 0) || (sdkExitCode !== null && sdkExitCode !== 0)
    || (finalObserved && ["error", "aborted"].includes(final.stopReason));
  const qualified = !failed && processExitCode === 0 && sdkExitCode === 0 && finalObserved && final.stopReason === "stop";
  check();
  return { schemaVersion: 1, contract: "oats.pi-print-completion", nonAuthorizing: true,
    authority, status: qualified ? "succeeded" : failed ? "failed" : "incomplete", qualified,
    processExitCode, sdkExitCode, finalObserved, sdk: observed ?? null,
    // No default success when either observer, native header or final turn is absent.
    evidence: { process: process !== null, sdk: sdk !== null, sessionFile: sessionFileObserved } };
}
