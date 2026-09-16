/** Read-only verification of explicit historical materialized-v2 artifact
 * candidates. Verification proves the old lock/artifact relation and observes a
 * new owner-exec digest today; it does not prove per-home selection, historical
 * modes, retention, reconstruction or approval. */
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { capabilityArtifactIntegrity } from "./artifact-tree.mjs";
import { isMaterializedCapabilityId, verifyCapabilityInstallation } from "./capability-provenance.mjs";
import { TREE_FORMAT, treeIntegrity } from "./portable-digest.mjs";
import { portableScope } from "./portable-state.mjs";
import { verifyHistoricalLockCandidate } from "./portable-migration-evidence.mjs";
import { oatsError } from "./errors.mjs";

export const LEGACY_CAPABILITY_FORMAT = "oats.capability-legacy.v1";
export const MATERIALIZED_CAPABILITY_FORMAT = "oats.capability-artifact.v1";

function explicitArtifactDirectory(scope, input) {
  if (typeof input !== "string" || !input || input.includes("\0")) throw oatsError("invalid-evidence", "historical artifact target must be a non-empty path without NUL");
  const deployment = portableScope(scope), lexical = resolve(deployment, input);
  const part = relative(deployment, lexical);
  if (!part || part === ".." || part.startsWith(`..${sep}`) || isAbsolute(part)) throw oatsError("path-escape", "historical artifact target is outside the explicit deployment");
  let actual;
  try { actual = realpathSync(lexical); }
  catch (error) { if (error.code === "ENOENT") throw oatsError("artifact-not-found", "historical artifact candidate is absent"); throw error; }
  if (actual !== lexical || !lstatSync(actual).isDirectory()) throw oatsError("invalid-artifact", "historical artifact target must be a real non-symlinked directory");
  return { deployment, dir: actual, path: part.split(sep).join("/") };
}

/** Verify one explicit v2 flat artifact against one explicit verified lock.
 * V1 requires its distinct historical digest callback and remains held here. */
export function verifyHistoricalCapabilityCandidate(scope, inventory, { lockPath, capability, artifactDir }, { legacyLockDecoder } = {}) {
  if (!isMaterializedCapabilityId(capability)) throw oatsError("invalid-evidence", "invalid historical capability identity");
  const lock = verifyHistoricalLockCandidate(scope, inventory, lockPath, { legacyLockDecoder });
  if (lock.version !== 2) throw oatsError("migration-held", "legacy v1 capability candidates require their separate historical digest verifier");
  const row = lock.capabilities[capability];
  if (!row) throw oatsError("migration-held", "historical lock does not name this capability candidate");
  const pkg = lock.packages[row.package];
  if (!pkg) throw oatsError("invalid-lock", "historical capability candidate has no verified provider package row");
  const target = explicitArtifactDirectory(scope, artifactDir);
  const historical = capabilityArtifactIntegrity(target.dir);
  if (historical !== row.integrity) throw oatsError("integrity-drift", "historical materialized artifact differs from its literal v2 lock digest");
  verifyCapabilityInstallation(target.dir, capability, row, pkg);
  const observedIntegrity = treeIntegrity(target.dir, { format: TREE_FORMAT });
  if (capabilityArtifactIntegrity(target.dir) !== historical
      || treeIntegrity(target.dir, { format: TREE_FORMAT }).value !== observedIntegrity.value) {
    throw oatsError("integrity-drift", "historical artifact changed while its migration witness was measured");
  }
  return {
    schemaVersion: 1,
    lock: { path: lock.path, integrity: lock.integrity },
    capability: { id: capability, row }, package: { id: row.package, row: pkg },
    artifact: { path: target.path,
      historicalIntegrity: { format: MATERIALIZED_CAPABILITY_FORMAT, value: historical },
      observedIntegrity,
      modeEvidence: "observed-at-migration" },
    selectionAuthority: "none", approvalAuthority: "none", retentionStatus: "not-retained",
    evidence: lock.evidence,
  };
}

/** Establish only that one unchanged home metadata document named one exact v2
 * artifact digest. This is per-capability selection evidence, not a complete
 * composition, source/resource closure or transferred approval. */
export function verifyHistoricalHomeCapabilityCandidate(scope, inventory, request, adapters = {}) {
  if (typeof request?.homePath !== "string" || !request.homePath) throw oatsError("invalid-evidence", "historical home candidate needs an explicit inventory path");
  const artifact = verifyHistoricalCapabilityCandidate(scope, inventory, request, adapters);
  const home = inventory.homes.find((entry) => entry.path === request.homePath);
  if (!home || home.document.state !== "present") throw oatsError("migration-held", "historical home evidence is absent or invalid");
  if (home.executionBinding.state === "valid-shape") throw oatsError("migration-held", "home already carries a captured execution binding; verify that authority instead of reconstructing from legacy rows");
  const matches = home.capabilities.filter((entry) => entry.id === request.capability);
  if (matches.length !== 1 || matches[0].integrity !== artifact.artifact.historicalIntegrity.value) {
    throw oatsError("migration-held", "home metadata does not uniquely bind this capability to the verified historical artifact digest");
  }
  const runtime = matches[0];
  return { schemaVersion: 1, home: { path: home.path, document: home.document }, artifact,
    association: "capability-runtime-integrity-match", completeness: "partial",
    legacyTrustedClaim: runtime.trustedClaim, approvalAuthority: "none",
    unresolved: [
      "source revision and retained soul projection",
      "complete managed resources, helpers and runtime packages",
      "new-format exact-artifact approval",
    ] };
}
