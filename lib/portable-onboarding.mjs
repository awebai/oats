/** Read-only fresh setup and source discovery facade.
 *
 * Existing project content is allowed. Relevant OATS-managed state produces a
 * separate-path hold; nothing is deleted, rewritten, installed, enrolled or
 * prepared here. Repository reads are delegated to the existing transaction and
 * workspace discovery/parser stack. */
import { lstatSync, opendirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createWorkspaceDiscovery } from "./workspace-discovery.mjs";
import { parseMemberExports } from "./workspace-definition.mjs";
import { canonicalJson, compareUtf8, freezeJson } from "./portable-values.mjs";
import { validateOrigin } from "./resolution-shape.mjs";
import { oatsError } from "./errors.mjs";

export const PORTABLE_ONBOARDING_VERSION = 1;
const issued = new WeakMap();
const preflightWitnesses = new WeakMap();
const MANAGED_PATHS = Object.freeze([
  ["deployment-config", "oats-config.yaml"],
  ["selection-lock", "oats-lock.json"],
  ["schedules", "oats-schedules.json"],
  ["portable-state", ".agents/portable"],
  ["captured-resolutions", ".agents/resolutions"],
  ["migration-evidence", ".agents/resolution-evidence"],
  ["installed-capabilities", ".agents/capabilities/installed"],
  ["retained-capabilities", ".agents/capabilities/artifacts"],
  ["retained-souls", ".agents/soul-artifacts"],
  ["retained-resources", ".agents/resource-artifacts"],
  ["schedule-state", ".agents/schedules"],
  ["installed-packages", ".agents/packages/installed"],
  ["native-history", ".oats-native-record"],
]);

const present = (path) => { try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
function exact(value, allowed, required, where) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw oatsError("invalid-declaration", `${where} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw oatsError("invalid-declaration", `${where} has unsupported field ${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) throw oatsError("invalid-declaration", `${where} is missing ${key}`);
  return value;
}
function canonicalExistingDirectory(path, label) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path) throw oatsError("invalid-declaration", `${label} must be a normalized absolute path`);
  let actual;
  try { actual = realpathSync(path); } catch (error) { if (error.code === "ENOENT") throw oatsError("source-unavailable", `${label} is absent`); throw error; }
  if (actual !== path || !lstatSync(actual).isDirectory()) throw oatsError("invalid-declaration", `${label} must be a real non-symlinked directory`);
  return actual;
}
function directoryIdentity(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory()) throw oatsError("selection-changed", "fresh setup directory is no longer a real directory");
  return { dev: stat.dev, ino: stat.ino };
}
function freshDeploymentPath(path) {
  if (typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path) throw oatsError("invalid-declaration", "fresh deployment must be a normalized absolute path");
  const stat = present(path);
  if (stat) {
    if (!stat.isDirectory() || realpathSync(path) !== path) throw oatsError("invalid-declaration", "fresh deployment path must be a real non-symlinked directory");
    return { path, state: "existing", identity: { dev: stat.dev, ino: stat.ino } };
  }
  let parent;
  try { parent = realpathSync(dirname(path)); }
  catch (error) { if (error.code === "ENOENT") throw oatsError("source-unavailable", "fresh deployment parent is absent"); throw error; }
  if (parent !== dirname(path) || !lstatSync(parent).isDirectory()) throw oatsError("invalid-declaration", "fresh deployment parent must be a real non-symlinked directory");
  return { path, state: "absent", parent: directoryIdentity(parent) };
}
function relativePath(root, path) { return relative(root, path).split(sep).join("/"); }
function scanInstanceState(root, base, budget) {
  const found = [], path = join(root, base), stat = present(path);
  if (!stat) return found;
  if (!stat.isDirectory() || realpathSync(path) !== path) return [{ kind: "managed-agents-root", path: base }];
  const directory = opendirSync(path);
  try {
    for (;;) {
      const entry = directory.readSync();
      if (entry === null) break;
      if (++budget.visited > budget.maxEntries) throw oatsError("resource-limit", "fresh deployment instance scan entry limit exceeded");
      if (!entry.isDirectory()) continue;
      for (const [kind, child] of [["instance-homes", "instances"], ["retirement-state", ".oats-retirement"]]) {
        const target = join(path, entry.name, child);
        if (present(target)) found.push({ kind, path: relativePath(root, target) });
      }
    }
  } finally { directory.closeSync(); }
  return found;
}

/** Detect only known deployment-owned state. Ordinary files, Git metadata,
 * authored souls/capabilities and source repositories do not make a path dirty. */
export function preflightFreshDeployment({ deployment, maxEntries = 4096 }) {
  canonicalJson({ deployment, maxEntries });
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100_000) throw oatsError("resource-limit", "invalid fresh deployment scan budget");
  const selected = freshDeploymentPath(deployment), managedState = [];
  if (selected.state === "existing") {
    for (const [kind, relative] of MANAGED_PATHS) if (present(join(selected.path, relative))) managedState.push({ kind, path: relative });
    const budget = { visited: 0, maxEntries };
    managedState.push(...scanInstanceState(selected.path, "agents", budget), ...scanInstanceState(selected.path, "local-agents", budget));
  }
  managedState.sort((a, b) => compareUtf8(`${a.path}:${a.kind}`, `${b.path}:${b.kind}`));
  if (canonicalJson(freshDeploymentPath(deployment)) !== canonicalJson(selected)) {
    throw oatsError("selection-changed", "fresh deployment changed during preflight; inspect it again");
  }
  const status = managedState.length ? "separate-deployment-required" : "ready";
  const result = freezeJson({ schemaVersion: PORTABLE_ONBOARDING_VERSION, status,
    deployment: { path: selected.path, state: selected.state }, managedState,
    advice: managedState.length ? ["Preserve this deployment and choose a separate fresh deployment path; no existing state was changed."] : [],
    effects: { writes: false, deletes: false, installs: false, enrollment: false } });
  preflightWitnesses.set(result, selected);
  return result;
}

function workTarget(path) {
  const canonical = canonicalExistingDirectory(path, "work target"), marker = present(join(canonical, ".git"));
  return { path: canonical, state: "existing", git: marker ? { present: true, kind: marker.isDirectory() ? "directory" : marker.isFile() ? "file" : "other" } : { present: false, kind: null } };
}
function sourceOrigin(workspace, alias) {
  const index = workspace?.parsed.imports.findIndex((entry) => entry.alias === alias) ?? -1;
  if (index < 0) throw oatsError("export-not-found", "requested alias is not advertised by the explicit workspace");
  return { reference: workspace.parsed.imports[index], origin: { ...workspace.parsed.origins[`/imports/${index}`], kind: "import-adoption" } };
}
function explicitContext(input) {
  const hasWorkspace = Object.hasOwn(input, "workspace");
  const hasStandalone = Object.hasOwn(input, "standaloneContextKey");
  if (hasWorkspace && hasStandalone) throw oatsError("invalid-declaration", "workspace and standaloneContextKey are mutually exclusive contexts");
  if (hasWorkspace) return null;
  if (!hasStandalone) throw oatsError("needs-configuration", "standalone onboarding requires an explicit standaloneContextKey (null explicitly means no private messaging context)");
  const key = input.standaloneContextKey;
  if (key !== null && (typeof key !== "string" || !key || Buffer.byteLength(key, "utf8") > 256 || key.trim() !== key || /[\x00-\x1f\x7f]/.test(key))) {
    throw oatsError("invalid-declaration", "standaloneContextKey must be explicit null or non-empty text up to 256 UTF-8 bytes");
  }
  return { kind: "standalone", key };
}
function catalogSelection(value, count) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > count || value.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= count)
      || new Set(value).size !== value.length) throw oatsError("invalid-declaration", "catalogIndexes must be unique declared workspace catalog indexes");
  return [...value].sort((a, b) => a - b);
}

/** Inspect one explicit source and optional explicit workspace/member/catalogs.
 * The caller owns the repository transaction lifetime. */
export function inspectPortableOnboarding(input, { repositories } = {}) {
  canonicalJson(input);
  exact(input, ["deployment", "workTarget", "source", "origin", "workspace", "member", "catalogIndexes", "standaloneContextKey"],
    ["deployment", "workTarget", "source", "origin"], "portable onboarding inspection");
  if (!repositories || typeof repositories !== "object") throw oatsError("invalid-source", "portable onboarding needs an explicit repository transaction");
  validateOrigin(input.origin);
  const standalone = explicitContext(input);
  const deployment = preflightFreshDeployment({ deployment: input.deployment });
  const target = workTarget(input.workTarget), discovery = createWorkspaceDiscovery(repositories);
  const witness = { deployment: preflightWitnesses.get(deployment), work: directoryIdentity(target.path) };
  const workspace = Object.hasOwn(input, "workspace") ? discovery.readWorkspace(input.workspace) : null;
  const selected = typeof input.source === "string" ? sourceOrigin(workspace, input.source) : { reference: input.source, origin: input.origin };
  const imported = discovery.importSoul(selected.reference, { origin: selected.origin });
  const indexDocument = repositories.readFile(imported.observation, "oats.yaml");
  const exports = parseMemberExports(indexDocument.bytes, { origin: indexDocument.origin });
  const membership = input.member ? (() => {
    if (!workspace) throw oatsError("needs-configuration", "member inspection needs an explicit workspace");
    return discovery.checkMember(workspace, input.member);
  })() : { schemaVersion: 1, status: "not-requested", evidence: [], problems: [] };
  const catalogs = [];
  const selectedCatalogs = catalogSelection(input.catalogIndexes, workspace?.parsed.catalogs.length ?? 0);
  if (selectedCatalogs.length && !workspace) throw oatsError("needs-configuration", "catalog inspection needs an explicit workspace");
  for (const index of selectedCatalogs) {
    const declared = workspace.parsed.catalogs[index], base = workspace.parsed.origins[`/catalogs/${index}`];
    if (!declared.path) throw oatsError("needs-configuration", "catalog inspection needs an explicit descriptor path");
    const origin = { ...base, kind: "workspace-default" }; validateOrigin(origin);
    const observation = repositories.observe(declared.source, { ...(declared.revision ? { revision: declared.revision } : {}), origin });
    const document = repositories.readFile(observation, declared.path);
    catalogs.push({ index, declaration: declared, source: observation.source, document: document.origin });
  }
  const declaredTeams = workspace?.parsed.declaration.teams ?? {};
  const status = deployment.status !== "ready" ? deployment.status
    : input.member && membership.status !== "eligible" ? "needs-configuration" : "ready-for-preparation";
  const result = freezeJson({ schemaVersion: PORTABLE_ONBOARDING_VERSION, status, deployment, workTarget: target,
    source: { location: imported.reference.source, reference: imported.reference, identity: imported.identity,
      revision: imported.observation.source, alias: imported.reference.alias, exportPath: imported.reference.soul,
      definition: imported.definition, roots: imported.roots, exports: exports.exports, provenance: imported.provenance },
    workspace: workspace ? { request: structuredClone(input.workspace), identity: workspace.identity, source: workspace.source,
      name: workspace.parsed.declaration.name, members: workspace.parsed.members,
      imports: workspace.parsed.imports, catalogs: workspace.parsed.catalogs } : null,
    context: workspace ? { kind: "workspace", identity: workspace.identity } : standalone,
    repositoryMembership: { request: input.member ? structuredClone(input.member) : null, result: membership },
    teams: { declared: declaredTeams, enrollment: "not-performed", privateTeamQualification: "not-evaluated" },
    catalogs, problems: membership.problems ?? [],
    effects: { deploymentWrites: false, repositoryReads: true, repositoryScratch: "caller-owned",
      installs: false, activation: false, credentials: false, teams: false, jobs: false } });
  issued.set(result, witness);
  if (status === "ready-for-preparation") recheckFreshOnboarding(result);
  return result;
}

/** Metadata-only public view, NOT a serialized fresh-inspection witness or a
 * preparation request. Provider payloads/adoption values have not gone through
 * their owner's nonsecret classification and must not leak through inspection. */
export function describePortableOnboarding(inspection) {
  if (!issued.has(inspection)) throw oatsError("invalid-declaration", "inspection summary requires an issued onboarding view");
  const reference = value => ({ source: value.source, soul: value.soul, revision: value.revision, alias: value.alias,
    adoptionPresent: Object.hasOwn(value, "adoption") });
  const { reference: selected, exports, ...source } = inspection.source;
  return freezeJson({ ...inspection,
    source: { ...source, adoptionPresent: Object.hasOwn(selected, "adoption"), exports: {
      souls: (exports.souls ?? []).map(({ path, definition, description }) => ({ path, definition, ...(description === undefined ? {} : { description }) })),
      packages: (exports.packages ?? []).map(({ path, description }) => ({ path, ...(description === undefined ? {} : { description }) })),
      knowledge: (exports.knowledge ?? []).map(({ contract, version }) => ({ contract, version, payloadOmitted: true })),
    } },
    workspace: inspection.workspace ? { ...inspection.workspace, imports: inspection.workspace.imports.map(reference) } : null,
    omitted: { providerPayloads: true, adoptionValues: true },
  });
}

/** Ephemeral local root custody, not a new persistent authority/schema. Ordinary
 * project content changes are allowed; replacing the inspected directories or
 * provisioning a previously absent deployment requires a fresh inspection. */
export function recheckFreshOnboarding(inspection) {
  const witness = issued.get(inspection);
  if (!witness) throw oatsError("invalid-declaration", "fresh target recheck requires an issued inspection");
  const current = preflightFreshDeployment({ deployment: inspection.deployment.deployment.path });
  if (current.status !== "ready") throw oatsError("fresh-deployment-required", "fresh deployment acquired managed state after inspection; preserve it and choose another path");
  if (canonicalJson(preflightWitnesses.get(current)) !== canonicalJson(witness.deployment)) {
    throw oatsError("selection-changed", "inspected deployment or its absent-path parent changed; inspect it again");
  }
  let work;
  try { work = directoryIdentity(canonicalExistingDirectory(inspection.workTarget.path, "work target")); }
  catch { throw oatsError("selection-changed", "inspected work target is no longer available at its owned path"); }
  if (canonicalJson(work) !== canonicalJson(witness.work)) throw oatsError("selection-changed", "inspected work target directory changed; inspect it again");
  return current;
}

/** Build data for the existing preparation API. This function never invokes it.
 * Work target remains adjacent and distinct from deployment/source inputs. */
export function buildFreshPreparationRequest(inspection, options = {}) {
  canonicalJson(options);
  exact(options, ["operator", "mode", "allowLocalPaths"], [], "fresh preparation options");
  if (!issued.has(inspection)) throw oatsError("invalid-declaration", "fresh preparation requires an inspection issued by this module");
  if (inspection.status !== "ready-for-preparation") throw oatsError("fresh-deployment-required", "fresh preparation is held by deployment or membership preflight");
  const { operator, mode, allowLocalPaths = false } = options;
  if (typeof allowLocalPaths !== "boolean") throw oatsError("invalid-declaration", "allowLocalPaths must be boolean");
  if (mode !== undefined && (typeof mode !== "string" || !mode.trim())) throw oatsError("invalid-declaration", "preparation mode must be non-empty text");
  const input = { deployment: inspection.deployment.deployment.path,
    source: inspection.source.reference,
    origin: inspection.source.revision.provenance[0], allowLocalPaths,
    ...(inspection.workspace ? { workspace: inspection.workspace.request } : { standaloneContextKey: inspection.context.key }),
    ...(inspection.repositoryMembership.request ? { member: inspection.repositoryMembership.request } : {}),
    ...(operator === undefined ? {} : { operator }), ...(mode === undefined ? {} : { mode }) };
  canonicalJson(input);
  return freezeJson({ schemaVersion: PORTABLE_ONBOARDING_VERSION, operation: "prepare", persisted: false,
    preparation: input, workTarget: inspection.workTarget,
    effects: { writes: false, installs: false, activation: false, enrollment: false } });
}
