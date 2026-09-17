/** Fresh setup acceptance boundary. Read-only comparison and explicit mutation
 * handoff only; all source discovery and request construction remain owned by
 * portable-onboarding. */
import { canonicalJson, freezeJson } from "./portable-values.mjs";
import { sameIdentity } from "./portable-identity.mjs";
import { buildFreshPreparationRequest, recheckFreshOnboarding } from "./portable-onboarding.mjs";
import { oatsError } from "./errors.mjs";

export const PORTABLE_ONBOARDING_ACCEPTANCE_VERSION = 1;

/** Prove two issued/ready inspections name one unchanged source while retaining
 * distinct organization and standalone work/context facts. */
export function compareFreshSourceAcceptance({ organization, standalone }) {
  const organizationRequest = buildFreshPreparationRequest(organization), standaloneRequest = buildFreshPreparationRequest(standalone);
  if (!organization.workspace || organization.context.kind !== "workspace") throw oatsError("invalid-declaration", "organization acceptance requires an explicit workspace context");
  if (standalone.workspace !== null || standalone.context.kind !== "standalone") throw oatsError("invalid-declaration", "standalone acceptance requires an explicit standalone context");
  if (standalone.workTarget.git.present) throw oatsError("invalid-declaration", "standalone acceptance work target must be explicitly non-Git");
  if (!sameIdentity(organization.source.identity, standalone.source.identity)) throw oatsError("source-identity-change", "acceptance inspections name different source identities");
  if (organization.source.revision.commit !== standalone.source.revision.commit
      || organization.source.exportPath !== standalone.source.exportPath
      || organization.source.definition !== standalone.source.definition) {
    throw oatsError("integrity-drift", "acceptance inspections do not name the same unchanged source export");
  }
  return freezeJson({ schemaVersion: PORTABLE_ONBOARDING_ACCEPTANCE_VERSION, status: "ready",
    source: { identity: organization.source.identity, commit: organization.source.revision.commit,
      exportPath: organization.source.exportPath, definition: organization.source.definition },
    organization: { context: organization.context, workTarget: organization.workTarget,
      preparation: organizationRequest.preparation },
    standalone: { context: standalone.context, workTarget: standalone.workTarget,
      preparation: standaloneRequest.preparation },
    effects: { writes: false, preparation: false, approval: false, enrollment: false } });
}

function approvalRequests(result) {
  const requests = [];
  for (const selection of Array.isArray(result?.selections) ? result.selections : []) {
    for (const capability of Array.isArray(selection.approvalRequired) ? selection.approvalRequired : []) {
      requests.push({ capability, artifactSet: selection.artifactSet, request: selection.request });
    }
  }
  return requests;
}

/** Recheck fresh deployment state immediately before an explicitly supplied
 * public preparation function. Missing integration/provisioning remains pending;
 * no stale inspection is permission to overwrite managed state. */
export function prepareFreshOnboarding(inspection, options = {}, { prepareCapturedComposition } = {}) {
  canonicalJson(options);
  const built = buildFreshPreparationRequest(inspection, options);
  const preflight = recheckFreshOnboarding(inspection);
  const requestedBindings = built.preparation.operator?.bindings ?? null;
  if (preflight.deployment.state === "absent") return freezeJson({ schemaVersion: PORTABLE_ONBOARDING_ACCEPTANCE_VERSION,
    status: "pending", code: "fresh-deployment-provisioning-required", mutationAttempted: false,
    preparation: built.preparation, workTarget: built.workTarget, requestedBindings,
    resolution: null, approvalRequests: [], problems: [{ code: "fresh-deployment-provisioning-required", message: "provision the explicit fresh deployment path before preparation" }] });
  if (typeof prepareCapturedComposition !== "function") return freezeJson({ schemaVersion: PORTABLE_ONBOARDING_ACCEPTANCE_VERSION,
    status: "pending", code: "onboarding-integration-required", mutationAttempted: false,
    preparation: built.preparation, workTarget: built.workTarget, requestedBindings,
    resolution: null, approvalRequests: [], problems: [{ code: "onboarding-integration-required", message: "the public captured preparation adapter is not available" }] });
  const result = prepareCapturedComposition(built.preparation);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw oatsError("invalid-resolution", "public preparation returned no structured result");
  return freezeJson({ schemaVersion: PORTABLE_ONBOARDING_ACCEPTANCE_VERSION,
    status: typeof result.status === "string" ? result.status : "pending", mutationAttempted: true,
    preparation: built.preparation, workTarget: built.workTarget, requestedBindings,
    resolution: result.resolution ?? null, approvalRequests: approvalRequests(result), problems: Array.isArray(result.problems) ? result.problems : [] });
}
