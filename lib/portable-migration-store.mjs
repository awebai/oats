/** Immutable, unselectable historical evidence records.
 *
 * Partial/unknown evidence lives outside `.agents/resolutions` and can never be
 * consumed as dispatch authority. Publication re-verifies all inventoried input
 * witnesses first and changes no lock, home, schedule, session or approval. */
import { linkSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureStoreIgnore } from "./capability-artifacts.mjs";
import { readPortableBytes } from "./portable-files.mjs";
import { JSON_FORMAT, jsonIntegrity, validateIntegrity } from "./portable-digest.mjs";
import { canonicalJson, compareUtf8, parseStrictJson } from "./portable-values.mjs";
import { portableScope } from "./portable-state.mjs";
import { objectAt, stringAt, versionAt } from "./portable-shape.mjs";
import { validateOrigin, validateResolutionRef } from "./resolution-shape.mjs";
import { validatePortableMigrationInventory, verifyPortableMigrationInventory } from "./portable-migration-evidence.mjs";
import { planPortableMigration } from "./portable-migration.mjs";
import { verifyHistoricalHomeCapabilityCandidate } from "./portable-migration-artifacts.mjs";
import { oatsError } from "./errors.mjs";

export const RESOLUTION_EVIDENCE_VERSION = 1;
const TARGET_KINDS = new Set(["selection-lock", "instance-home", "scheduled-job"]);
const ACTIONS = new Set(["preserve", "verify", "hold"]);
const exists = (path) => { try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };

export function validateResolutionEvidence(value) {
  canonicalJson(value);
  objectAt(value, ["schemaVersion", "target", "status", "evidence", "knownInputs", "unresolved", "resolution"],
    ["schemaVersion", "target", "status", "evidence", "knownInputs", "unresolved", "resolution"]);
  versionAt(value.schemaVersion);
  objectAt(value.target, ["kind", "id"], ["kind", "id"]);
  if (!TARGET_KINDS.has(value.target.kind)) throw oatsError("invalid-evidence", "unsupported migration evidence target kind");
  stringAt(value.target.id, "/target/id");
  if (!Array.isArray(value.evidence)) throw oatsError("invalid-evidence", "migration evidence origins must be an array");
  value.evidence.forEach(validateOrigin);
  objectAt(value.knownInputs, ["inventory", "action", "preserve"], ["inventory", "action", "preserve"]);
  validateIntegrity(value.knownInputs.inventory, [JSON_FORMAT]);
  if (!ACTIONS.has(value.knownInputs.action)) throw oatsError("invalid-evidence", "invalid planned migration action");
  canonicalJson(value.knownInputs.preserve);
  if (!Array.isArray(value.unresolved)) throw oatsError("invalid-evidence", "migration unresolved inputs must be an array");
  for (const item of value.unresolved) {
    objectAt(item, ["pointer", "code", "origins", "reason"], ["pointer", "code", "origins", "reason"]);
    stringAt(item.pointer, "/unresolved/pointer", { empty: true, pattern: /^(?:\/(?:[^~]|~[01])*)*$/ });
    stringAt(item.code, "/unresolved/code"); stringAt(item.reason, "/unresolved/reason");
    if (!Array.isArray(item.origins)) throw oatsError("invalid-evidence", "unresolved origins must be an array");
    item.origins.forEach(validateOrigin);
  }
  if (!['reconstructed', 'partial', 'unknown'].includes(value.status)) throw oatsError("invalid-evidence", "invalid migration evidence status");
  if (value.status === "reconstructed") {
    validateResolutionRef(value.resolution);
    if (!value.evidence.length) throw oatsError("resolution-incomplete", "reconstructed evidence requires historical witnesses");
    if (value.unresolved.length) throw oatsError("resolution-incomplete", "reconstructed evidence cannot retain unresolved managed inputs");
  } else if (value.resolution !== null) {
    throw oatsError("resolution-incomplete", "partial or unknown evidence cannot reference a captured resolution");
  }
  return value;
}

export function validateResolutionEvidenceRef(value) {
  canonicalJson(value, { maxBytes: 1024, maxDepth: 4, maxEntries: 8 });
  objectAt(value, ["schemaVersion", "id"], ["schemaVersion", "id"]);
  versionAt(value.schemaVersion);
  stringAt(value.id, "/id", { pattern: /^sha256-[a-f0-9]{64}$/ });
  return value;
}

function store(scope, create) {
  let root = portableScope(scope);
  for (const name of [".agents", "resolution-evidence"]) {
    root = join(root, name);
    if (create) { try { mkdirSync(root, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; } }
    const stat = exists(root);
    if (!stat) throw oatsError("evidence-not-found", "resolution evidence store is absent");
    if (!stat.isDirectory() || realpathSync(root) !== root) throw oatsError("invalid-evidence", "resolution evidence store component is not a real directory");
  }
  if (create) ensureStoreIgnore(root);
  return root;
}

function decode(path, reference) {
  const bytes = readPortableBytes(path, { missingCode: "evidence-not-found", invalidCode: "invalid-evidence" });
  const value = parseStrictJson(bytes);
  if (jsonIntegrity(value).value !== reference.id || !bytes.equals(Buffer.from(canonicalJson(value)))) {
    throw oatsError("integrity-drift", "resolution evidence bytes differ from their canonical address");
  }
  validateResolutionEvidence(value);
  return value;
}

export function readResolutionEvidence(scope, reference) {
  validateResolutionEvidenceRef(reference);
  return decode(join(store(scope, false), `${reference.id}.json`), reference);
}

function targetKey(target) { return canonicalJson(target); }
function entryFor(plan, target) {
  const wanted = targetKey(target), entry = plan.targets.find((candidate) => targetKey(candidate.target) === wanted);
  if (!entry) throw oatsError("invalid-evidence", "migration target is not in the verified inventory plan");
  if (entry.status === "reconstructed") throw oatsError("migration-required", "reconstructed publication requires the dedicated historical evidence verifier");
  return entry;
}
function publishEvidence(deployment, document) {
  validateResolutionEvidence(document);
  const reference = { schemaVersion: 1, id: jsonIntegrity(document).value };
  const root = store(deployment, true), destination = join(root, `${reference.id}.json`);
  if (exists(destination)) { decode(destination, reference); return reference; }
  const staging = mkdtempSync(join(root, ".evidence-"));
  let failed = false, primary;
  try {
    const candidate = join(staging, "record.json");
    writeFileSync(candidate, canonicalJson(document), { flag: "wx", mode: 0o600 });
    decode(candidate, reference);
    try { linkSync(candidate, destination); } catch (error) { if (error.code !== "EEXIST") throw error; }
    decode(destination, reference);
    return reference;
  } catch (error) { failed = true; primary = error; throw error; }
  finally {
    try { rmSync(staging, { recursive: true, force: true }); }
    catch (cleanup) {
      const error = failed ? new AggregateError([primary, cleanup], "evidence publication and cleanup failed", { cause: primary })
        : new Error("evidence staging cleanup failed", { cause: cleanup });
      error.code = failed ? primary.code : cleanup.code; error.stagingPath = staging; throw error;
    }
  }
}

/** Publish exactly one target from the deterministic plan after re-reading all
 * inventory witnesses. Reconstructed records require a later dedicated verifier
 * and are deliberately outside this function. */
export function commitPlannedResolutionEvidence(scope, inventory, target, adapters = {}) {
  validatePortableMigrationInventory(inventory);
  const current = verifyPortableMigrationInventory(scope, inventory, adapters);
  const plan = planPortableMigration(current), entry = entryFor(plan, target);
  const document = { schemaVersion: RESOLUTION_EVIDENCE_VERSION,
    target: entry.target, status: entry.status, evidence: entry.evidence,
    knownInputs: { inventory: plan.inventory, action: entry.action, preserve: entry.preserve ?? null },
    unresolved: entry.unresolved, resolution: null };
  return publishEvidence(current.deployment, document);
}

/** Persist a narrow verified home→materialized-v2 capability association as
 * partial evidence. Raw legacy source/settings/commands are intentionally not
 * copied; their literal document remains addressed by the evidence origins. */
export function commitHistoricalHomeCapabilityEvidence(scope, inventory, request, adapters = {}) {
  validatePortableMigrationInventory(inventory);
  const candidate = verifyHistoricalHomeCapabilityCandidate(scope, inventory, request, adapters);
  const current = verifyPortableMigrationInventory(scope, inventory, adapters), plan = planPortableMigration(current);
  const entry = entryFor(plan, { kind: "instance-home", id: candidate.home.path });
  const origins = [...entry.evidence, ...candidate.artifact.evidence];
  const seen = new Set(), evidence = origins.filter((origin) => { const key = canonicalJson(origin); if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => compareUtf8(canonicalJson(a), canonicalJson(b)));
  const proof = { kind: "home-capability-v2", home: candidate.home.path,
    capability: { id: candidate.artifact.capability.id, version: candidate.artifact.capability.row.version,
      package: candidate.artifact.package.id, path: candidate.artifact.capability.row.path },
    artifact: candidate.artifact.artifact, association: candidate.association,
    legacyTrustedClaim: candidate.legacyTrustedClaim, selectionAuthority: candidate.artifact.selectionAuthority,
    approvalAuthority: candidate.approvalAuthority, retentionStatus: candidate.artifact.retentionStatus };
  const document = { schemaVersion: RESOLUTION_EVIDENCE_VERSION, target: entry.target, status: "partial", evidence,
    knownInputs: { inventory: plan.inventory, action: "hold", preserve: proof }, unresolved: entry.unresolved, resolution: null };
  return publishEvidence(current.deployment, document);
}
