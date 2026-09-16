#!/usr/bin/env node
/** Shared wire schemas, not a second semantic resolver. Generate checked-in JSON
 * with --write; ordinary invocation checks drift. No network or provider code. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ORIGIN_KINDS, RESOLUTION_FIELDS } from "../lib/resolution-shape.mjs";
import { CHOICE_KINDS } from "../lib/portable-choices.mjs";
import { TREE_FORMAT, PACKAGE_FORMAT, BYTES_FORMAT } from "../lib/portable-digest.mjs";

const id = "https://oats.dev/schemas/portable-v1.json";
const s = { type: "string", minLength: 1 }, text = { type: "string" }, v1 = { const: 1 };
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const one = (...schemas) => ({ oneOf: schemas });
const nullable = (schema) => one({ type: "null" }, schema);
const list = (items, set = false) => ({ type: "array", items, ...(set ? { uniqueItems: true } : {}) });
const object = (properties, optional = []) => ({ type: "object", properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)), additionalProperties: false });
const map = (additionalProperties, propertyNames) => ({ type: "object", additionalProperties, ...(propertyNames ? { propertyNames } : {}) });
const enumeration = (...values) => ({ enum: values });
const positive = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const nonnegative = { ...positive, minimum: 0 };
const cap = { ...s, pattern: "^[a-z0-9][a-z0-9._-]*$" };
const hash = { ...s, pattern: "^sha256-[a-f0-9]{64}$" };
const slug = { ...s, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" };
const path = { ...s, pattern: "^(?![A-Za-z]:)(?!.*(?:^|/)\\.{1,2}(?:/|$))[^/\\\\\u0000]+(?:/[^/\\\\\u0000]+)*$" };
const rootPath = one({ const: "." }, path);
const git = { ...s, pattern: "^git:.+$" }, local = { ...s, pattern: "^path:/.*$" };
const lockedSource = { ...s, pattern: "^(?:git:.+|path:/.*|catalog:.+)$" };
const commit = { ...s, pattern: "^[a-f0-9]{40}$" };
const integrity = (format) => object({ format: { const: format }, value: hash });
const origins = list(ref("Origin"));

const d = {
  Hash: hash, RelativePath: path, RootRelativePath: rootPath, CapabilityId: cap,
  TreeIntegrity: integrity(TREE_FORMAT), PackageIntegrity: integrity(PACKAGE_FORMAT), ByteIntegrity: integrity(BYTES_FORMAT),
  ResolutionRef: object({ schemaVersion: v1, id: hash }),
  RepositoryIdentity: one(
    object({ kind: { const: "provider-repository" }, provider: { ...s, pattern: "^[a-z][a-z0-9.-]*$" }, host: { ...s, pattern: "^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$" }, id: s }),
    object({ kind: { const: "canonical-remote" }, remote: git })),
  SoulIdentity: one(
    object({ kind: { const: "git-soul" }, repository: ref("RepositoryIdentity"), exportPath: path }),
    object({ kind: { const: "local-soul" }, source: local, exportPath: rootPath })),
  WorkspaceIdentity: object({ repository: ref("RepositoryIdentity"), path: { const: "oats-workspace.yaml" } }),
  CapabilityArtifactRef: object({ kind: { const: "capability" }, capability: cap, integrity: ref("TreeIntegrity") }),
  SoulArtifactRef: object({ kind: { const: "soul" }, identity: ref("SoulIdentity"), integrity: ref("TreeIntegrity") }),
  ResourceArtifactRef: object({ kind: { const: "resource" }, integrity: ref("TreeIntegrity") }),
  ArtifactRef: one(ref("CapabilityArtifactRef"), ref("SoulArtifactRef"), ref("ResourceArtifactRef")),
  ResourceRef: object({ owner: ref("ArtifactRef"), path: rootPath, kind: enumeration("file", "directory", "manifest", "skill", "runtime-package") }),
  OperatorDocument: object({ kind: { const: "operator" }, id: s }),
  SourceDocument: one(object({ kind: { const: "source" }, source: git, revision: commit, path, integrity: ref("ByteIntegrity") }),
    object({ kind: { const: "source" }, source: local, revision: { const: "local" }, path, integrity: ref("ByteIntegrity") })),
  DeploymentDocument: object({ kind: { const: "deployment" }, path, integrity: ref("ByteIntegrity") }),
  RecordDocument: object({ kind: { const: "record" }, ref: ref("ResolutionRef") }),
  ArtifactDocument: object({ kind: { const: "artifact" }, owner: ref("ArtifactRef"), path, integrity: ref("ByteIntegrity") }),
};
d.Origin = object({
  kind: enumeration(...ORIGIN_KINDS),
  document: one(ref("SourceDocument"), ref("DeploymentDocument"), ref("OperatorDocument"), ref("RecordDocument"), ref("ArtifactDocument")),
  pointer: { ...text, pattern: "^(?:/(?:[^~]|~[01])*)*$" }, span: object({ start: nonnegative, end: nonnegative }),
}, ["span"]);
d.OperatorOrigin = object({ ...d.Origin.properties, kind: { const: "operator" }, document: ref("OperatorDocument") }, ["span"]);
d.Constraint = one(object({ kind: { const: "equals" }, value: {}, origin: ref("Origin") }), object({ kind: { const: "required" }, origin: ref("Origin") }));
d.Considered = object({ kind: enumeration(...CHOICE_KINDS), value: {}, origin: ref("Origin"), disposition: enumeration("selected", "overridden") });
d.Choice = object({ value: {}, selectedBy: nullable(ref("Origin")), constraints: list(ref("Constraint")), considered: list(ref("Considered")) });
d.GitObservation = object({ identity: ref("RepositoryIdentity"), remote: git, selector: s, commit, provenance: { ...origins, minItems: 1 } });
d.LocalObservation = object({ kind: { const: "local" }, source: local, integrity: ref("TreeIntegrity"), provenance: { ...origins, minItems: 1 }, repository: ref("RepositoryIdentity") }, ["repository"]);
d.SoulSelection = object({ identity: ref("SoulIdentity"), revision: one(ref("GitObservation"), ref("LocalObservation")), alias: slug,
  sourceArtifact: ref("SoulArtifactRef"), definition: path, projection: object({ roots: { ...list(rootPath, true), minItems: 1, description: "Set in canonical UTF-8 order; runtime verifies closure and witnesses." } }) });
d.PackageRow = object({ source: lockedSource, path: rootPath, version: s, commit: one(commit, { const: "local" }), integrity: ref("PackageIntegrity"), dependencies: list(cap, true) });
d.CapabilityOrigin = one(
  object({ kind: { const: "package" }, package: cap, path: rootPath, projectionVersion: v1 }),
  object({ kind: { const: "local-capability" }, source: local, authoredAs: enumeration("owned", "path"), witness: ref("Origin") }));
d.CapabilityRow = object({ version: s, artifact: ref("CapabilityArtifactRef"), origin: ref("CapabilityOrigin") });
d.ArtifactSet = object({ schemaVersion: v1, packages: map(ref("PackageRow"), cap), capabilities: map(ref("CapabilityRow"), cap) });
d.CredentialRef = one(object({ kind: { const: "env" }, name: { ...s, pattern: "^[A-Za-z_][A-Za-z0-9_]*$" } }),
  object({ kind: { const: "provider" }, provider: s, key: s }));
d.ProviderBinding = object({ schemaVersion: v1, capability: cap, payloadContract: s, payloadVersion: positive, payload: {}, credentialRefs: map(ref("CredentialRef")), provenance: origins });
d.Context = one(object({ kind: { const: "workspace" }, identity: ref("WorkspaceIdentity"), observation: ref("Origin") }),
  object({ kind: { const: "standalone" }, key: nullable(s) }));
d.PrivateContext = one(object({ kind: { const: "workspace" }, identity: ref("WorkspaceIdentity") }), object({ kind: { const: "standalone" }, key: s }));
d.TeamRef = object({ provider: s, id: s });
d.MessagingChoice = one(object({ schemaVersion: v1, enabled: { const: false } }), object({ schemaVersion: v1, enabled: { const: true },
  privateKey: object({ provider: cap, human: ref("TeamRef"), context: ref("PrivateContext") }), wider: list(ref("TeamRef"), true), provenance: origins }));
d.RuntimeResource = object({ runtime: s, package: s, resource: s, requiredBy: origins });
d.LaunchRecipe = { type: "object", required: ["version", "runtime"], properties: { version: v1, runtime: enumeration("pi", "claude", "codex") },
  description: "Envelope only: the sole existing launch codec owns all remaining recipe fields and their interpretation." };
d.InstructionBlock = object({ source: { ...s, pattern: "^(kernel|work-mode|capability|config):[A-Za-z0-9._:-]+$" }, resource: s, choice: s }, ["choice"]);
d.InstructionOmission = object({ source: d.InstructionBlock.properties.source, reason: enumeration("disabled", "helper-knowledge"), choice: s }, ["choice"]);
d.InstructionComposition = object({ schemaVersion: v1, mode: enumeration("worktree", "checkout", "attached", "workspace", "directory"), body: s,
  blocks: list(ref("InstructionBlock")), omissions: list(ref("InstructionOmission")),
  skills: list(object({ name: { ...s, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" }, resource: s })) });
d.Dispatch = object({ schemaVersion: v1, providerManifests: map(s, cap), settingsChoices: map(map(s), cap), launch: nullable(ref("LaunchRecipe")),
  runtimePackages: list(ref("RuntimeResource")), hostRequirements: list({}), workTargetInputs: map(s), composition: ref("InstructionComposition") }, ["composition"]);
d.Dispatch.allOf = [{ if: { type: "object", properties: { launch: { type: "object" } }, required: ["launch"] }, then: { type: "object", properties: { composition: ref("InstructionComposition") }, required: ["composition"] } }];
d.CapturedResolution = object({ schemaVersion: v1, capture: enumeration("prepared", "reconstructed"),
  subject: one(object({ kind: { const: "persistent" }, soul: ref("SoulSelection") }),
    object({ kind: { const: "helper" }, provider: ref("CapabilityArtifactRef"), definition: ref("ResourceRef"), name: slug })),
  context: ref("Context"), artifacts: ref("ArtifactSet"), choices: map(ref("Choice"), { pattern: "^/" }),
  bindings: { type: "object", additionalProperties: false, properties: Object.fromEntries(["knowledge", "messaging", "tasks"].map((slot) => [slot, ref("ProviderBinding")])) },
  messagingChoice: ref("MessagingChoice"), resources: map(ref("ResourceRef")), resourceBundles: list(ref("ResourceArtifactRef"), true),
  dispatch: ref("Dispatch"), helpers: map(ref("ResolutionRef")), evidence: origins });
d.CapturedResolution.allOf = [{ if: { type: "object", properties: { capture: { const: "reconstructed" } }, required: ["capture"] },
  then: { type: "object", properties: { evidence: { type: "array", minItems: 1 } } } }];
if (JSON.stringify(Object.keys(d.CapturedResolution.properties).sort()) !== JSON.stringify([...RESOLUTION_FIELDS].sort())) throw new Error("captured schema fields differ from runtime codec");
d.Problem = object({ code: s, message: s, origins, target: {}, details: {} }, ["target", "details"]);
d.PackageRequest = object({ source: lockedSource, path: rootPath });
d.Freshness = object({ state: enumeration("refreshed", "offline", "failed", "not-checked"),
  observedAt: nullable({ ...s, pattern: "^(?:[0-9]{4}|[+-][0-9]{6})-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$" }), problems: list(ref("Problem")) });
d.Selection = object({ request: ref("PackageRequest"), current: nullable(hash), available: nullable(hash), freshness: ref("Freshness") });
d.Selection.allOf = [{ if: { type: "object", properties: { freshness: { type: "object", properties: { state: { const: "refreshed" } }, required: ["state"] } }, required: ["freshness"] },
  then: { type: "object", properties: { available: hash, freshness: { type: "object", properties: { observedAt: s } } } } }];
d.Lock3 = object({ lockfileVersion: { const: 3 }, artifactSets: map(ref("ArtifactSet"), hash), selections: map(ref("Selection"), hash) });
d.ApprovalEntry = object({ artifact: ref("CapabilityArtifactRef"), approved: { const: true }, provenance: { ...list(ref("OperatorOrigin")), minItems: 1 } });
d.ApprovalLedger = object({ schemaVersion: v1, capabilities: map(map(ref("ApprovalEntry"), { pattern: `^${TREE_FORMAT.replace(/\./g, "\\.")}:sha256-[a-f0-9]{64}$` }), cap) });

export function portableSchemas() {
  const shared = { $schema: "http://json-schema.org/draft-07/schema#", $id: id, title: "Portable OATS shared wire values v1",
    description: "Structural schemas only. Strict bounded decoding, canonical source/digest identities, cross-reference equality, constraints, provenance, graph limits and filesystem verification remain mandatory runtime checks. Provider payloads remain opaque; schema acceptance grants no trust, enrollment or privacy guarantee.", $defs: d };
  const entry = (name, definition, title) => ({ $schema: shared.$schema, $id: `https://oats.dev/schemas/${name}.json`, title,
    description: "New private wire boundary; public consumer activation requires the explicit preparation/migration integration. See portable-v1.json for semantic verification requirements.", $ref: `${id}#/$defs/${definition}` });
  return { "portable.schema.json": shared,
    "captured-resolution.schema.json": entry("captured-resolution-v1", "CapturedResolution", "Captured resolution v1"),
    "oats-lock-v3.schema.json": entry("selection-lock-v3", "Lock3", "Source-request selection lock v3"),
    "artifact-approvals.schema.json": entry("artifact-approvals-v1", "ApprovalLedger", "Exact capability approval ledger v1") };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../docs"), write = process.argv.includes("--write");
  for (const [name, schema] of Object.entries(portableSchemas())) {
    const bytes = JSON.stringify(schema, null, 2) + "\n", path = join(root, name);
    if (write) writeFileSync(path, bytes);
    else if (readFileSync(path, "utf8") !== bytes) throw new Error(`generated schema drift: ${name}; run node scripts/portable-schemas.mjs --write`);
  }
  console.log(`${write ? "wrote" : "checked"} four portable wire schemas`);
}
