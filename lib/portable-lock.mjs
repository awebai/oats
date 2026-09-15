/** Lock v3 is mutable input to future preparation, NEVER historical dispatch
 * authority. Existing v1/v2 readers and stores are not migrated by this module. */
import { join } from "node:path";
import { canonicalJson, parseStrictJson } from "./portable-values.mjs";
import { JSON_FORMAT, jsonIntegrity, validateIntegrity } from "./portable-digest.mjs";
import { validateArtifactSet, validateOrigin } from "./resolution-shape.mjs";
import { objectAt, stringAt } from "./portable-shape.mjs";
import { parseLockedSource3 } from "./source-spec.mjs";
import { readPortableBytes } from "./portable-files.mjs";
import { portableScope, withPortableStateWrite, writeGuardedPortableDocument } from "./portable-state.mjs";
import { oatsError } from "./errors.mjs";

const invalid = (message) => { throw oatsError("invalid-lock", message); };
export const emptyLock3 = () => ({ lockfileVersion: 3, artifactSets: {}, selections: {} });
export function requestKey3(request) {
  canonicalJson(request);
  objectAt(request, ["source", "path"], ["source", "path"]);
  parseLockedSource3(request.source, request.path);
  return jsonIntegrity(request).value;
}
export function artifactSetKey3(set) { validateArtifactSet(set); return jsonIntegrity(set).value; }
function validateProblem(problem) {
  objectAt(problem, ["code", "message", "origins", "target", "details"], ["code", "message", "origins"]);
  stringAt(problem.code, "/freshness/problems/code"); stringAt(problem.message, "/freshness/problems/message");
  if (!Array.isArray(problem.origins)) invalid("refresh problem origins must be an array");
  problem.origins.forEach(validateOrigin);
}

export function validateLock3(lock) {
  try {
    canonicalJson(lock);
    if (lock?.lockfileVersion === 1 || lock?.lockfileVersion === 2) {
      throw oatsError("migration-required", "legacy lock requires its explicit evidence/migration reader; it is not lock v3");
    }
    objectAt(lock, ["lockfileVersion", "artifactSets", "selections"], ["lockfileVersion", "artifactSets", "selections"]);
    if (lock.lockfileVersion !== 3) throw oatsError("unsupported-wire-version", "unsupported selection-lock version");
    objectAt(lock.artifactSets, null, []); objectAt(lock.selections, null, []);
    const indexes = new Map(), checked = new Set();
    for (const [key, set] of Object.entries(lock.artifactSets)) {
      if (artifactSetKey3(set) !== key) invalid("artifact-set key differs from its canonical content");
      const requests = new Map();
      for (const [id, pkg] of Object.entries(set.packages)) {
        const request = jsonIntegrity({ source: pkg.source, path: pkg.path }).value;
        if (!requests.has(request)) requests.set(request, []);
        requests.get(request).push(id);
      }
      indexes.set(key, requests);
    }
    for (const [key, selection] of Object.entries(lock.selections)) {
      objectAt(selection, ["request", "current", "available", "freshness"], ["request", "current", "available", "freshness"]);
      if (requestKey3(selection.request) !== key) invalid("selection key differs from its normalized source request");
      for (const name of ["current", "available"]) {
        const selected = selection[name];
        if (selected === null) continue;
        stringAt(selected, `/selections/${name}`);
        if (!Object.hasOwn(lock.artifactSets, selected)) invalid("selection references an absent artifact set");
        const roots = indexes.get(selected).get(key);
        if (roots?.length !== 1) invalid("selection has no unique root package matching its request");
        if (checked.has(`${selected}:${key}`)) continue;
        const set = lock.artifactSets[selected], reached = new Set([roots[0]]), pending = [roots[0]];
        while (pending.length) {
          for (const dependency of set.packages[pending.pop()].dependencies) {
            if (!reached.has(dependency)) { reached.add(dependency); pending.push(dependency); }
          }
        }
        if (reached.size !== Object.keys(set.packages).length) invalid("selected set includes packages outside the requested dependency closure");
        for (const row of Object.values(set.capabilities)) if (row.origin.kind !== "package") invalid("package selection cannot smuggle a direct local capability");
        checked.add(`${selected}:${key}`);
      }
      const freshness = selection.freshness;
      objectAt(freshness, ["state", "observedAt", "problems"], ["state", "observedAt", "problems"]);
      if (!["refreshed", "offline", "failed", "not-checked"].includes(freshness.state)) invalid("invalid freshness state");
      if (freshness.observedAt !== null) {
        stringAt(freshness.observedAt, "/freshness/observedAt");
        const date = new Date(freshness.observedAt);
        if (!Number.isFinite(date.getTime()) || date.toISOString() !== freshness.observedAt) invalid("observation timestamp must be canonical UTC ISO time");
      }
      if (freshness.state === "refreshed" && (freshness.observedAt === null || selection.available === null)) invalid("successful refresh needs an observed available set and timestamp");
      if (!Array.isArray(freshness.problems)) invalid("refresh problems must be an array");
      freshness.problems.forEach(validateProblem);
    }
    return lock;
  } catch (error) {
    if (["invalid-declaration", "invalid-source", "invalid-artifact-reference"].includes(error.code)) {
      const failure = oatsError("invalid-lock", error.message); failure.cause = error; throw failure;
    }
    throw error;
  }
}

/** Explicit scope only. Absent differs from empty-v1, unsupported or damaged.
 * Integrity is the CAS token, not software verification or executable consent. */
export function readLock3(scope) {
  const path = join(portableScope(scope), "oats-lock.json");
  const bytes = readPortableBytes(path, { allowMissing: true, invalidCode: "invalid-lock" });
  if (bytes === null) return { lock: null, integrity: null };
  const lock = parseStrictJson(bytes);
  validateLock3(lock);
  if (!bytes.equals(Buffer.from(canonicalJson(lock)))) invalid("selection lock must use canonical JSON bytes");
  return { lock, integrity: jsonIntegrity(lock) };
}

/** All new writers share a cooperative guard and compare the complete snapshot.
 * No implicit legacy migration, row merging, approval, tree cleanup or live cutover. */
export function writeLock3(scope, expectedPreviousIntegrity, next) {
  if (expectedPreviousIntegrity !== null) validateIntegrity(expectedPreviousIntegrity, [JSON_FORMAT]);
  validateLock3(next);
  return withPortableStateWrite(scope, (context) => {
    const { deployment } = context;
    const previous = readLock3(deployment);
    if (canonicalJson(previous.integrity) !== canonicalJson(expectedPreviousIntegrity)) throw oatsError("selection-changed", "selection lock changed; repeat explicit preparation");
    const integrity = jsonIntegrity(next);
    if (canonicalJson(previous.integrity) === canonicalJson(integrity)) return { lock: next, integrity, status: "kept" };
    writeGuardedPortableDocument(context, join(deployment, "oats-lock.json"), next, { absent: previous.lock === null });
    return { lock: next, integrity, status: "written" };
  });
}
