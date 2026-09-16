/** Exact-artifact local approval authority. Presence/catalog/legacy trust and
 * captured booleans never grant approval. No current selection-lock lookup. */
import { join } from "node:path";
import { canonicalJson, parseStrictJson } from "./portable-values.mjs";
import { jsonIntegrity } from "./portable-digest.mjs";
import { objectAt, versionAt } from "./portable-shape.mjs";
import { validateArtifactRef, validateOrigin } from "./resolution-shape.mjs";
import { verifyResolutionInputs } from "./captured-resolutions.mjs";
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

/** The only approval writer. Called by the explicit operator approval operation,
 * not preparation/discovery. Approval still does not qualify provider/host readiness
 * or replace full manifest/launch compilation at the eventual action boundary. */
export function approveCapturedCapability(scope, reference, id, origin) {
  validateOrigin(origin);
  if (origin.kind !== "operator" || origin.document.kind !== "operator") invalid("approval requires an explicit operator input");
  return withPortableStateWrite(scope, (context) => {
    const verified = verifyResolutionInputs(context.deployment, reference);
    if (typeof id !== "string" || !Object.hasOwn(verified.record.artifacts.capabilities, id)) invalid("approval capability is not selected in this captured record");
    const artifact = verified.record.artifacts.capabilities[id].artifact, key = artifactApprovalKey(artifact);
    const { ledger, integrity } = readApprovalLedger(context.deployment);
    if (!hasExecutableSurface(manifestFor(verified, id))) return { artifact, status: "not-required" };
    if (approved(ledger, artifact)) return { artifact, status: "already-approved" };
    if (!Object.hasOwn(ledger.capabilities, id)) ledger.capabilities[id] = Object.create(null);
    ledger.capabilities[id][key] = { artifact, approved: true, provenance: [origin] };
    validateApprovalLedger(ledger);
    writeGuardedPortableDocument(context, join(context.root, "approvals.json"), ledger, { absent: integrity === null });
    return { artifact, status: "approved" };
  });
}
