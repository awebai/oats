/** Explicit source-to-record preparation. Current locks are inputs to NEW work
 * only; source/package observations are frozen once and never dispatch authority. */
import { isAbsolute, join } from "node:path";
import { objectAt } from "./portable-shape.mjs";
import { canonicalJson, compareUtf8 } from "./portable-values.mjs";
import { readPortableBytes } from "./portable-files.mjs";
import { validateOrigin } from "./resolution-shape.mjs";
import { createWorkspaceDiscovery } from "./workspace-discovery.mjs";
import { parseSoulImport } from "./workspace-definition.mjs";
import { sameIdentity } from "./portable-identity.mjs";
import { planSoftwareChoices } from "./portable-composition.mjs";
import { captureManifestSettings } from "./manifest-settings.mjs";
import { preparePackageArtifacts } from "./portable-package-preparation.mjs";
import { parseLockedSource3, parseRepositorySource } from "./source-spec.mjs";
import { retainPortableArtifact, verifyPortableArtifact } from "./portable-artifacts.mjs";
import { treeIntegrity } from "./portable-digest.mjs";
import { readLock3, writeLock3, emptyLock3, artifactSetKey3, requestKey3 } from "./portable-lock.mjs";
import { readApprovalLedger, evaluateCapturedApprovals } from "./artifact-approvals.mjs";
import { commitCapturedResolution } from "./captured-resolutions.mjs";
import { oatsError } from "./errors.mjs";

// Project an ALREADY RESOLVED package graph for lock-v3's per-root set. This
// performs no dependency parsing, source lookup, acquisition or version choice.
function packageSubset(artifacts, root) {
  const ids = new Set([root]), pending = [root];
  while (pending.length) for (const id of artifacts.packages[pending.pop()].dependencies) if (!ids.has(id)) { ids.add(id); pending.push(id); }
  return { schemaVersion: 1, packages: Object.fromEntries([...ids].sort(compareUtf8).map((id) => [id, artifacts.packages[id]])),
    capabilities: Object.fromEntries(Object.entries(artifacts.capabilities).filter(([, row]) => row.origin.kind === "package" && ids.has(row.origin.package))) };
}

/** Repositories and kernel callbacks belong to this operation; the caller owns
 * their lifetime/scratch cleanup. No hook, launch, enrollment or approval here. */
export function prepareComposition(input, { repositories, kernel, previous: suppliedPrevious }) {
  canonicalJson(input);
  objectAt(input, ["deployment", "directory", "source", "origin", "workspace", "member", "operator", "mode", "allowLocalPaths"], ["deployment", "directory", "source", "origin"]);
  const { deployment, directory, source: requested, origin, workspace: workspaceRequest, member, operator, allowLocalPaths = false } = input;
  if (typeof directory !== "string" || !isAbsolute(directory) || typeof allowLocalPaths !== "boolean") throw oatsError("invalid-declaration", "preparation needs an explicit scratch directory and local-input policy");
  validateOrigin(origin);
  const previous = suppliedPrevious ?? readLock3(deployment); // Public wrapper reads once BEFORE creating scratch or fetching.
  const discovery = createWorkspaceDiscovery(repositories);
  const workspace = workspaceRequest ? discovery.readWorkspace(workspaceRequest) : null;
  let reference = requested, sourceOrigin = origin;
  if (typeof requested === "string") {
    const index = workspace?.parsed.imports.findIndex((entry) => entry.alias === requested) ?? -1;
    if (index < 0) throw oatsError("export-not-found", "requested alias is not advertised by this workspace");
    reference = workspace.parsed.imports[index];
    sourceOrigin = { ...workspace.parsed.origins[`/imports/${index}`], kind: "import-adoption" };
  }
  if (member) {
    if (!workspace) throw oatsError("needs-configuration", "member work needs an explicit workspace");
    const membership = discovery.checkMember(workspace, member);
    if (membership.status !== "eligible") return { status: "needs-configuration", resolution: null, problems: membership.problems };
  }
  const imported = discovery.importSoul(reference, { origin: sourceOrigin });
  const mode = input.mode ?? imported.soul.declaration.work ?? "directory";
  const adoptions = typeof requested !== "string" && imported.adoption ? [imported.adoption] : [];
  // Adoption is keyed to qualified source identity, not whichever alias the
  // caller typed. Conflicting aliases must not become a way to evade policy.
  for (const [index, entry] of (workspace?.parsed.imports ?? []).entries()) {
    if (!entry.adoption || entry.soul !== imported.identity.exportPath) continue;
    const candidate = repositories.identify(entry.source);
    if (!sameIdentity(candidate.identity, imported.identity.repository)) continue;
    const pointer = `/imports/${index}`, origins = workspace.parsed.origins;
    adoptions.push({ identity: imported.identity, pointer, origins,
      parsed: parseSoulImport(entry, { pointer, origins, origin: origins[pointer].document }) });
  }
  let plan = planSoftwareChoices({ identity: imported.identity, soul: imported.soul,
    ...(workspace ? { workspace: workspace.parsed } : {}), adoptions, ...(operator ? { operator } : {}) });
  if (plan.status !== "resolved") return { status: plan.status, resolution: null, problems: plan.problems };
  const requests = Object.entries(plan.capabilities).map(([capability, selected]) => ({ capability, source: selected.source, origin: plan.choices[selected.choiceKeys[0]].selectedBy }));
  let prepared, primary;
  try {
    prepared = requests.length ? preparePackageArtifacts({ requests, deployment, directory, repositories, kernel,
      observations: [imported.observation], allowLocalPaths, catalog: kernel.catalog })
      : { artifactSet: { schemaVersion: 1, packages: {}, capabilities: {} }, roots: [], cleanup() {} };
    const allArtifacts = prepared.artifactSet, manifests = new Map(), definitions = [];
    for (const [id, row] of Object.entries(allArtifacts.capabilities)) {
      const root = verifyPortableArtifact(deployment, row.artifact).dir;
      manifests.set(id, kernel.manifest(root));
      if (Object.hasOwn(plan.capabilities, id)) definitions.push({ artifact: row.artifact, bytes: readPortableBytes(join(root, "oats.json")) });
    }
    plan = captureManifestSettings(plan, definitions);
    const artifacts = { ...allArtifacts, capabilities: Object.fromEntries(Object.entries(allArtifacts.capabilities).filter(([id]) => Object.hasOwn(plan.capabilities, id))) };
    const roots = new Set(imported.roots);
    for (const pkg of Object.values(allArtifacts.packages)) {
      const selected = parseLockedSource3(pkg.source, pkg.path);
      if (selected.kind === "git" && pkg.commit === imported.observation.source.commit && parseRepositorySource(`git:${selected.url}`).normalized === imported.observation.source.remote) roots.add(pkg.path);
    }
    const projectionRoots = [...roots].sort(compareUtf8), sourceDirectory = join(directory, "soul-projection");
    repositories.materialize(imported.observation, projectionRoots, sourceDirectory);
    const sourceArtifact = { kind: "soul", identity: imported.identity, integrity: treeIntegrity(sourceDirectory) };
    retainPortableArtifact(deployment, sourceDirectory, sourceArtifact);
    const soul = { identity: imported.identity, alias: imported.reference.alias, revision: imported.observation.source,
      sourceArtifact, definition: imported.definition, projection: { roots: projectionRoots } };
    const context = workspace ? { kind: "workspace", identity: workspace.identity,
      observation: { ...workspace.parsed.origins[""], kind: "workspace-default" } } : { kind: "standalone", key: null };
    const seed = { schemaVersion: 1, capture: "prepared", subject: { kind: "persistent", soul }, context, artifacts,
      choices: plan.choices, evidence: imported.provenance };
    const completion = kernel.complete({ seed, plan, manifests, mode, deployment, directory });
    let resolution = null;
    if (completion.record) resolution = commitCapturedResolution(deployment, completion.record);
    // Publishing valid immutable inputs/records need not roll back on a later
    // selection CAS loss. Never delete another transaction's retained objects.
    const next = previous.lock ? structuredClone(previous.lock) : emptyLock3();
    const { ledger } = readApprovalLedger(deployment), selections = [];
    for (const root of new Set(prepared.roots)) {
      const set = packageSubset(allArtifacts, root), key = artifactSetKey3(set), pkg = set.packages[root];
      const request = { source: pkg.source, path: pkg.path }, requestKey = requestKey3(request);
      const approval = evaluateCapturedApprovals({ record: { artifacts: set }, manifests }, ledger);
      const usable = approval.every((entry) => entry.status !== "approval-required");
      next.artifactSets[key] = set;
      next.selections[requestKey] = { request, current: usable ? key : next.selections[requestKey]?.current ?? null, available: key,
        freshness: { state: "refreshed", observedAt: new Date().toISOString(), problems: [] } };
      selections.push({ request, artifactSet: key, approvalRequired: approval.filter((entry) => entry.status === "approval-required").map((entry) => entry.artifact.capability) });
    }
    writeLock3(deployment, previous.integrity, next);
    const approvals = evaluateCapturedApprovals({ record: { artifacts }, manifests }, ledger);
    return { status: resolution ? (approvals.some((entry) => entry.status === "approval-required") ? "approval-required" : "prepared") : "needs-configuration",
      resolution, executionBinding: resolution ? { schemaVersion: 1, deployment, resolution } : null,
      ...(resolution ? { responsibleHuman: completion.record.messagingChoice.enabled ? completion.record.messagingChoice.privateKey.human : null } : {}),
      source: { source: imported.reference.source, soul: imported.reference.soul, revision: imported.observation.source.commit, alias: imported.reference.alias },
      selections, problems: completion.problems ?? [] };
  } catch (error) { primary = error; throw error; }
  finally {
    try { prepared?.cleanup(); }
    catch (cleanup) {
      if (!primary) throw cleanup;
      const error = new AggregateError([primary, cleanup], "preparation and package cleanup failed", { cause: primary });
      error.code = primary.code; throw error;
    }
  }
}
