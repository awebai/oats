/** Exact-artifact local approval authority. Presence/catalog/legacy trust and
 * captured booleans never grant approval. No current selection-lock lookup. */
import { join } from "node:path";
import { canonicalJson, parseStrictJson } from "./portable-values.mjs";
import { jsonIntegrity } from "./portable-digest.mjs";
import { objectAt, versionAt } from "./portable-shape.mjs";
import { validateArtifactRef, validateOrigin } from "./resolution-shape.mjs";
import { verifyResolutionInputs, verifyRetainedCapability } from "./captured-resolutions.mjs";
import { verifyPortableArtifact } from "./portable-artifacts.mjs";
import { readLock3 } from "./portable-lock.mjs";
import { executableSurfaceOf, hasExecutableSurface } from "./capability-execution.mjs";
import { isMaterializedCapabilityId } from "./capability-provenance.mjs";
import { readPortableBytes } from "./portable-files.mjs";
import { portableStateDirectory, withPortableStateWrite, writeGuardedPortableDocument } from "./portable-state.mjs";
import { oatsError } from "./errors.mjs";

const emptyLedger = () => ({ schemaVersion: 1, capabilities: Object.create(null) });
const invalid = (message) => { throw oatsError("invalid-approval", message); };
export function artifactApprovalKey(artifact) {
  validateArtifactRef(artifact);
  if (artifact.kind !== "capability") invalid("capability approval cannot authorize an unrelated resource bundle");
  return `${artifact.integrity.format}:${artifact.integrity.value}`;
}
export function validateApprovalLedger(ledger) {
  canonicalJson(ledger);
  objectAt(ledger, ["schemaVersion", "capabilities"], ["schemaVersion", "capabilities"]);
  versionAt(ledger.schemaVersion); objectAt(ledger.capabilities, null, []);
  for (const [id, entries] of Object.entries(ledger.capabilities)) {
    if (!isMaterializedCapabilityId(id)) invalid("invalid approval capability identity");
    objectAt(entries, null, []);
    for (const [key, entry] of Object.entries(entries)) {
      objectAt(entry, ["artifact", "approved", "provenance"], ["artifact", "approved", "provenance"]);
      if (artifactApprovalKey(entry.artifact) !== key || entry.artifact.capability !== id || entry.approved !== true) invalid("approval key, artifact or capability differs");
      if (!Array.isArray(entry.provenance) || !entry.provenance.length) invalid("approval requires explicit operator provenance");
      for (const origin of entry.provenance) {
        validateOrigin(origin);
        if (origin.kind !== "operator" || origin.document.kind !== "operator") invalid("approval cannot inherit source or legacy authority");
      }
    }
  }
  return ledger;
}
export function readApprovalLedger(scope) {
  const root = portableStateDirectory(scope);
  const bytes = root === null ? null : readPortableBytes(join(root, "approvals.json"), { allowMissing: true, invalidCode: "invalid-approval" });
  if (bytes === null) return { ledger: emptyLedger(), integrity: null };
  const ledger = parseStrictJson(bytes);
  validateApprovalLedger(ledger);
  if (!bytes.equals(Buffer.from(canonicalJson(ledger)))) invalid("approval ledger must use canonical JSON bytes");
  return { ledger, integrity: jsonIntegrity(ledger) };
}
function approved(ledger, artifact) {
  const key = artifactApprovalKey(artifact);
  return Object.hasOwn(ledger.capabilities, artifact.capability) && Object.hasOwn(ledger.capabilities[artifact.capability], key);
}
function manifestFor(verified, id) {
  return verified.manifests.get(id);
}

/** Diagnostic projection for this record's capabilities, not an action permit.
 * Dedicated helper records get their own approval check when used. */
export function inspectCapturedApprovals(scope, reference) {
  const verified = verifyResolutionInputs(scope, reference), { ledger } = readApprovalLedger(scope);
  return { reference, capabilities: evaluateCapturedApprovals(verified, ledger) };
}

/** Shared evaluation over already verified inputs and a freshly read ledger.
 * This remains data; the action loader decides which surfaces the action uses. */
export function evaluateCapturedApprovals(verified, ledger) {
  validateApprovalLedger(ledger);
  return Object.entries(verified.record.artifacts.capabilities).map(([id, row]) => {
    const manifest = manifestFor(verified, id), required = hasExecutableSurface(manifest);
    return { artifact: row.artifact, required, surface: executableSurfaceOf(manifest),
      status: !required ? "not-required" : approved(ledger, row.artifact) ? "approved" : "approval-required" };
  });
}

function grantApproval(context, artifact, manifest, origin) {
  const key = artifactApprovalKey(artifact), id = artifact.capability;
  const { ledger, integrity } = readApprovalLedger(context.deployment);
  if (!hasExecutableSurface(manifest)) return { artifact, status: "not-required" };
  if (approved(ledger, artifact)) return { artifact, status: "already-approved" };
  if (!Object.hasOwn(ledger.capabilities, id)) ledger.capabilities[id] = Object.create(null);
  ledger.capabilities[id][key] = { artifact, approved: true, provenance: [origin] };
  validateApprovalLedger(ledger);
  writeGuardedPortableDocument(context, join(context.root, "approvals.json"), ledger, { absent: integrity === null });
  return { artifact, status: "approved" };
}

/** Prospective approval must be possible BEFORE running an executable provider
 * codec to complete a resolution. Address an exact retained artifact set, never
 * today's selected capability ID or a fabricated partial resolution. */
export function approveAvailableCapability(scope, setKey, id, origin, validateManifest) {
  validateOrigin(origin);
  if (origin.kind !== "operator" || origin.document.kind !== "operator") invalid("approval requires an explicit operator input");
  if (typeof setKey !== "string" || !/^sha256-[a-f0-9]{64}$/.test(setKey) || typeof id !== "string") invalid("invalid artifact-set approval target");
  if (typeof validateManifest !== "function") throw new TypeError("prospective approval requires the complete kernel manifest codec");
  return withPortableStateWrite(scope, (context) => {
    const { lock } = readLock3(context.deployment);
    const set = lock?.artifactSets[setKey];
    if (!set || !Object.hasOwn(set.capabilities, id)) invalid("capability is not in that exact retained artifact set");
    const artifact = set.capabilities[id].artifact;
    const root = verifyPortableArtifact(context.deployment, artifact).dir;
    const manifest = verifyRetainedCapability(root, set, id, validateManifest(root));
    return grantApproval(context, artifact, manifest, origin);
  });
}

/** Explicit approval writer. Called by the explicit operator approval operation,
 * not preparation/discovery. Approval still does not qualify provider/host readiness
 * or replace full manifest/launch compilation at the eventual action boundary. */
export function approveCapturedCapability(scope, reference, id, origin) {
  validateOrigin(origin);
  if (origin.kind !== "operator" || origin.document.kind !== "operator") invalid("approval requires an explicit operator input");
  return withPortableStateWrite(scope, (context) => {
    const verified = verifyResolutionInputs(context.deployment, reference);
    if (typeof id !== "string" || !Object.hasOwn(verified.record.artifacts.capabilities, id)) invalid("approval capability is not selected in this captured record");
    return grantApproval(context, verified.record.artifacts.capabilities[id].artifact, manifestFor(verified, id), origin);
  });
}
