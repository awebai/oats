/** Captured-resolution data shape. Filesystem/provenance verification and
 * authorization are separate; passing this codec alone never permits dispatch. */
import { canonicalJson, compareUtf8 } from "./portable-values.mjs";
import { TREE_FORMAT, PACKAGE_FORMAT, BYTES_FORMAT, validateIntegrity } from "./portable-digest.mjs";
import { resolveChoices } from "./portable-choices.mjs";
import { validateRepositoryIdentity, validateSoulIdentity, validateWorkspaceIdentity, sameIdentity } from "./portable-identity.mjs";
import { portablePath, parseLockedSource3, parseRepositorySource, revisionSelector } from "./source-spec.mjs";
import { isMaterializedCapabilityId } from "./capability-provenance.mjs";
import { invalidShape, objectAt, pointerKey, stringAt, stringSetAt, versionAt } from "./portable-shape.mjs";

export const RESOLUTION_FIELDS = Object.freeze(["schemaVersion", "capture", "subject", "context", "artifacts", "choices", "bindings", "messagingChoice", "resources", "resourceBundles", "dispatch", "helpers", "evidence"]);
const hash = (value, pointer) => stringAt(value, pointer, { pattern: /^sha256-[a-f0-9]{64}$/ });
const capability = (value, pointer) => { if (!isMaterializedCapabilityId(value)) invalidShape(pointer, "invalid capability identity"); };
const array = (value, pointer) => { if (!Array.isArray(value)) invalidShape(pointer, "expected array"); return value; };
const own = (value, key, pointer) => { stringAt(key, pointer); if (!Object.hasOwn(value, key)) invalidShape(pointer, "missing captured reference"); return value[key]; };
const orderedSet = (value, pointer, key = (item) => item) => {
  for (let i = 1; i < value.length; i++) if (compareUtf8(key(value[i - 1]), key(value[i])) >= 0) invalidShape(pointer, "captured set must be unique and canonically ordered");
};

export function validateResolutionRef(value) {
  canonicalJson(value, { maxBytes: 1024, maxDepth: 4, maxEntries: 8 });
  objectAt(value, ["schemaVersion", "id"], ["schemaVersion", "id"]);
  versionAt(value.schemaVersion); hash(value.id, "/id");
  return value;
}
export function validateArtifactRef(value) {
  canonicalJson(value, { maxBytes: 64 * 1024, maxDepth: 16, maxEntries: 1024 });
  objectAt(value, value?.kind === "soul" ? ["kind", "identity", "integrity"]
    : value?.kind === "capability" ? ["kind", "capability", "integrity"] : ["kind", "integrity"], ["kind", "integrity"]);
  validateIntegrity(value.integrity, [TREE_FORMAT]);
  if (value.kind === "soul") validateSoulIdentity(value.identity);
  else if (value.kind === "capability") capability(value.capability, "/capability");
  else if (value.kind !== "resource") invalidShape("/kind", "invalid artifact reference kind");
  return value;
}
export function validateResourceRef(value) {
  canonicalJson(value, { maxBytes: 64 * 1024, maxDepth: 20, maxEntries: 2048 });
  objectAt(value, ["owner", "path", "kind"], ["owner", "path", "kind"]);
  validateArtifactRef(value.owner); portablePath(value.path, { allowRoot: true });
  if (!["file", "directory", "manifest", "skill", "runtime-package"].includes(value.kind)) invalidShape("/kind", "invalid captured resource kind");
  return value;
}

export const ORIGIN_KINDS = Object.freeze(["soul-requirement", "soul-default", "workspace-default", "import-adoption", "operator", "package-dependency", "work-target", "migration-evidence", "provider-binding", "workspace-admission", "member-backlink", "source-export", "manifest-default"]);
export function validateOrigin(value) {
  canonicalJson(value, { maxBytes: 64 * 1024, maxDepth: 16, maxEntries: 1024 });
  objectAt(value, ["kind", "document", "pointer", "span"], ["kind", "document", "pointer"]);
  if (!ORIGIN_KINDS.includes(value.kind)) invalidShape("/kind", "invalid origin kind");
  stringAt(value.pointer, "/pointer", { empty: true, pattern: /^(?:\/(?:[^~]|~[01])*)*$/ });
  const doc = value.document;
  if (doc?.kind === "source") {
    objectAt(doc, ["kind", "source", "revision", "path", "integrity"], ["kind", "source", "revision", "path", "integrity"]);
    portablePath(doc.path); validateIntegrity(doc.integrity, [BYTES_FORMAT]);
    if (typeof doc.source === "string" && doc.source.startsWith("path:")) {
      if (parseLockedSource3(doc.source, ".").kind !== "path" || doc.revision !== "local") invalidShape("/document", "invalid local document witness");
    } else {
      if (parseRepositorySource(doc.source).normalized !== doc.source || typeof doc.revision !== "string" || !/^[a-f0-9]{40}$/.test(doc.revision)) invalidShape("/document", "invalid exact document source");
    }
  } else if (doc?.kind === "deployment") {
    objectAt(doc, ["kind", "path", "integrity"], ["kind", "path", "integrity"]);
    portablePath(doc.path); validateIntegrity(doc.integrity, [BYTES_FORMAT]);
  } else if (doc?.kind === "operator") {
    objectAt(doc, ["kind", "id"], ["kind", "id"]); stringAt(doc.id, "/document/id");
  } else if (doc?.kind === "record") {
    objectAt(doc, ["kind", "ref"], ["kind", "ref"]); validateResolutionRef(doc.ref);
  } else if (doc?.kind === "artifact") {
    objectAt(doc, ["kind", "owner", "path", "integrity"], ["kind", "owner", "path", "integrity"]);
    validateArtifactRef(doc.owner); portablePath(doc.path); validateIntegrity(doc.integrity, [BYTES_FORMAT]);
  } else invalidShape("/document", "invalid origin document");
  if (Object.hasOwn(value, "span")) {
    objectAt(value.span, ["start", "end"], ["start", "end"]);
    if (!Number.isSafeInteger(value.span.start) || !Number.isSafeInteger(value.span.end)
        || value.span.start < 0 || value.span.end < value.span.start) invalidShape("/span", "invalid source span");
  }
  return value;
}
const origins = (value, pointer) => array(value, pointer).forEach(validateOrigin);

export function validateCapturedChoices(value) {
  canonicalJson(value); objectAt(value, null, []);
  const requirements = [], candidates = [];
  for (const [key, choice] of Object.entries(value)) {
    objectAt(choice, ["value", "selectedBy", "constraints", "considered"], ["value", "selectedBy", "constraints", "considered"]);
    if (choice.selectedBy !== null) validateOrigin(choice.selectedBy);
    for (const constraint of array(choice.constraints, "/choices/constraints")) {
      objectAt(constraint, ["kind", "value", "origin"], ["kind", "origin"]);
      validateOrigin(constraint.origin); requirements.push({ key, ...constraint });
    }
    for (const considered of array(choice.considered, "/choices/considered")) {
      objectAt(considered, ["kind", "value", "origin", "disposition"], ["kind", "value", "origin", "disposition"]);
      validateOrigin(considered.origin);
      if (!["selected", "overridden"].includes(considered.disposition)) invalidShape("/choices/considered", "invalid choice disposition");
      candidates.push({ key, kind: considered.kind, value: considered.value, origin: considered.origin });
    }
  }
  const replay = resolveChoices({ requirements, candidates });
  if (replay.status !== "resolved" || !sameIdentity(replay.choices, value)) invalidShape("/choices", "captured choices do not satisfy their recorded constraints", "resolution-incomplete");
}

/** Shared envelope codec for both preparation output and immutable records.
 * Domain payload interpretation and mutable provider readiness remain separate. */
export function validateProviderBinding(binding) {
  canonicalJson(binding);
  objectAt(binding, ["schemaVersion", "capability", "payloadContract", "payloadVersion", "payload", "credentialRefs", "provenance"], ["schemaVersion", "capability", "payloadContract", "payloadVersion", "payload", "credentialRefs", "provenance"]);
  versionAt(binding.schemaVersion); capability(binding.capability, "/bindings/capability");
  stringAt(binding.payloadContract, "/bindings/payloadContract");
  if (!Number.isSafeInteger(binding.payloadVersion) || binding.payloadVersion < 1) invalidShape("/bindings/payloadVersion", "invalid provider payload version");
  objectAt(binding.credentialRefs, null, [], "/bindings/credentialRefs");
  for (const credential of Object.values(binding.credentialRefs)) {
    if (credential?.kind === "env") {
      objectAt(credential, ["kind", "name"], ["kind", "name"]);
      stringAt(credential.name, "/bindings/credentialRefs/name", { pattern: /^[A-Za-z_][A-Za-z0-9_]*$/ });
    } else {
      objectAt(credential, ["kind", "provider", "key"], ["kind", "provider", "key"]);
      if (credential.kind !== "provider") invalidShape("/bindings/credentialRefs/kind", "invalid credential reference");
      stringAt(credential.provider, "/bindings/credentialRefs/provider"); stringAt(credential.key, "/bindings/credentialRefs/key");
    }
  }
  origins(binding.provenance, "/bindings/provenance");
  return binding;
}
function bindings(value, record) {
  for (const [slot, binding] of Object.entries(value)) {
    if (!["knowledge", "messaging", "tasks"].includes(slot)) invalidShape("/bindings", "unknown fundamental slot");
    validateProviderBinding(binding);
    own(record.artifacts.capabilities, binding.capability, "/bindings/capability");
    const selected = own(record.choices, `/layers/${slot}`, "/bindings/selection").value;
    if (!selected || typeof selected !== "object" || selected.capability !== binding.capability) invalidShape("/bindings", "binding differs from selected provider");
  }
  for (const slot of ["knowledge", "messaging", "tasks"]) {
    const selected = record.choices[`/layers/${slot}`]?.value;
    if (selected !== undefined && selected !== null) own(value, slot, "/bindings");
  }
}

export function validateMessagingChoice(value, record) {
  const selected = record.bindings.messaging;
  if (value?.enabled === false) {
    objectAt(value, ["schemaVersion", "enabled"], ["schemaVersion", "enabled"]);
    if (selected) invalidShape("/messagingChoice", "selected messaging provider cannot disappear");
  } else {
    objectAt(value, ["schemaVersion", "enabled", "privateKey", "wider", "provenance"], ["schemaVersion", "enabled", "privateKey", "wider", "provenance"]);
    if (value.enabled !== true || !selected) invalidShape("/messagingChoice", "invalid enabled messaging choice");
    objectAt(value.privateKey, ["provider", "human", "context"], ["provider", "human", "context"]);
    if (value.privateKey.provider !== selected.capability) invalidShape("/messagingChoice/privateKey", "private provider mismatch");
    objectAt(value.privateKey.human, ["provider", "id"], ["provider", "id"]);
    stringAt(value.privateKey.human.provider, "/messagingChoice/privateKey/human/provider");
    stringAt(value.privateKey.human.id, "/messagingChoice/privateKey/human/id");
    const expected = record.context.kind === "workspace" ? { kind: "workspace", identity: record.context.identity } : { kind: "standalone", key: record.context.key };
    if ((record.context.kind === "standalone" && record.context.key === null) || !sameIdentity(value.privateKey.context, expected)) invalidShape("/messagingChoice/privateKey/context", "private context mismatch");
    const seen = new Set();
    for (const team of array(value.wider, "/messagingChoice/wider")) {
      objectAt(team, ["provider", "id"], ["provider", "id"]); stringAt(team.id, "/messagingChoice/wider/id");
      if (team.provider !== selected.capability) invalidShape("/messagingChoice/wider/provider", "wider team provider mismatch");
      const key = canonicalJson(team); if (seen.has(key)) invalidShape("/messagingChoice/wider", "duplicate wider team"); seen.add(key);
    }
    orderedSet(value.wider, "/messagingChoice/wider", canonicalJson);
    origins(value.provenance, "/messagingChoice/provenance");
  }
  versionAt(value.schemaVersion);
}

function sourceSelection(value) {
  objectAt(value, ["identity", "revision", "alias", "sourceArtifact", "definition", "projection"], ["identity", "revision", "alias", "sourceArtifact", "definition", "projection"]);
  validateSoulIdentity(value.identity); validateArtifactRef(value.sourceArtifact);
  if (value.sourceArtifact.kind !== "soul" || !sameIdentity(value.identity, value.sourceArtifact.identity)) invalidShape("/subject/soul", "source artifact identity mismatch");
  stringAt(value.alias, "/subject/soul/alias", { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ });
  portablePath(value.definition);
  objectAt(value.projection, ["roots"], ["roots"]);
  stringSetAt(value.projection.roots, "/subject/soul/projection/roots", (path) => portablePath(path, { allowRoot: true }));
  orderedSet(value.projection.roots, "/subject/soul/projection/roots");
  if (!value.projection.roots.length || !value.projection.roots.some((root) => root === "." || value.definition === root || value.definition.startsWith(`${root}/`))) {
    invalidShape("/subject/soul/definition", "definition is not in the captured projection");
  }
  const exportPath = value.identity.exportPath;
  if (exportPath !== "." && !value.definition.startsWith(`${exportPath}/`)) invalidShape("/subject/soul/definition", "definition is outside exported soul");
  const revision = value.revision;
  if (revision?.kind === "local") {
    objectAt(revision, ["kind", "source", "integrity", "provenance", "repository"], ["kind", "source", "integrity", "provenance"]);
    if (parseLockedSource3(revision.source, ".").kind !== "path") invalidShape("/subject/soul/revision", "local witness requires an explicit source");
    validateIntegrity(revision.integrity, [TREE_FORMAT]);
    if (!sameIdentity(revision.integrity, value.sourceArtifact.integrity)) invalidShape("/subject/soul/revision", "local projection witness mismatch");
    if (value.identity.kind === "local-soul") {
      if (value.identity.source !== revision.source || Object.hasOwn(revision, "repository")) invalidShape("/subject/soul/revision", "local source identity mismatch");
    } else {
      validateRepositoryIdentity(revision.repository);
      if (!sameIdentity(revision.repository, value.identity.repository)) invalidShape("/subject/soul/revision", "local Git witness repository mismatch");
    }
  } else {
    objectAt(revision, ["identity", "remote", "selector", "commit", "provenance"], ["identity", "remote", "selector", "commit", "provenance"]);
    validateRepositoryIdentity(revision.identity);
    if (value.identity.kind !== "git-soul" || !sameIdentity(revision.identity, value.identity.repository)) invalidShape("/subject/soul/revision", "Git observation identity mismatch");
    if (parseRepositorySource(revision.remote).normalized !== revision.remote) invalidShape("/subject/soul/revision/remote", "noncanonical observed remote");
    if (revision.identity.kind === "canonical-remote" && revision.identity.remote !== revision.remote) invalidShape("/subject/soul/revision/remote", "observed remote contradicts canonical source identity");
    revisionSelector(revision.selector);
    stringAt(revision.commit, "/subject/soul/revision/commit", { pattern: /^[a-f0-9]{40}$/ });
  }
  origins(revision.provenance, "/subject/soul/revision/provenance");
  if (!revision.provenance.length) invalidShape("/subject/soul/revision/provenance", "source witness is missing", "resolution-incomplete");
}

export function validateArtifactSet(value) {
  canonicalJson(value);
  objectAt(value, ["schemaVersion", "packages", "capabilities"], ["schemaVersion", "packages", "capabilities"]);
  versionAt(value.schemaVersion);
  objectAt(value.packages, null, []); objectAt(value.capabilities, null, []);
  for (const [id, row] of Object.entries(value.packages)) {
    capability(id, "/artifacts/packages");
    objectAt(row, ["source", "path", "version", "commit", "integrity", "dependencies"], ["source", "path", "version", "commit", "integrity", "dependencies"]);
    const source = parseLockedSource3(row.source, row.path);
    stringAt(row.version, "/artifacts/packages/version");
    validateIntegrity(row.integrity, [PACKAGE_FORMAT]);
    if (typeof row.commit !== "string" || (source.kind === "path" ? row.commit !== "local" : !/^[a-f0-9]{40}$/.test(row.commit))) invalidShape("/artifacts/packages/commit", "invalid exact package revision");
    stringSetAt(row.dependencies, "/artifacts/packages/dependencies", capability);
    orderedSet(row.dependencies, "/artifacts/packages/dependencies");
    for (const dependency of row.dependencies) own(value.packages, dependency, "/artifacts/packages/dependencies");
  }
  // Iterative bounded DFS: no recursive dependency traversal or prototype lookup.
  const visited = new Set(), active = new Set();
  for (const id of Object.keys(value.packages)) {
    const stack = [{ id, exit: false }];
    while (stack.length) {
      const current = stack.pop();
      if (current.exit) { active.delete(current.id); visited.add(current.id); continue; }
      if (active.has(current.id)) invalidShape("/artifacts/packages", "package dependency cycle");
      if (visited.has(current.id)) continue;
      if (active.size > 256) invalidShape("/artifacts/packages", "package graph depth limit", "resource-limit");
      active.add(current.id); stack.push({ id: current.id, exit: true });
      for (const dependency of value.packages[current.id].dependencies) stack.push({ id: dependency, exit: false });
    }
  }
  for (const [id, row] of Object.entries(value.capabilities)) {
    capability(id, "/artifacts/capabilities");
    objectAt(row, ["version", "artifact", "origin"], ["version", "artifact", "origin"]);
    stringAt(row.version, "/artifacts/capabilities/version"); validateArtifactRef(row.artifact);
    if (row.artifact.kind !== "capability" || row.artifact.capability !== id) invalidShape("/artifacts/capabilities", "artifact/map identity mismatch");
    if (row.origin?.kind === "package") {
      objectAt(row.origin, ["kind", "package", "path", "projectionVersion"], ["kind", "package", "path", "projectionVersion"]);
      capability(row.origin.package, "/artifacts/capabilities/origin/package");
      own(value.packages, row.origin.package, "/artifacts/capabilities/origin/package");
      portablePath(row.origin.path, { allowRoot: true }); versionAt(row.origin.projectionVersion);
    } else {
      objectAt(row.origin, ["kind", "source", "authoredAs", "witness"], ["kind", "source", "authoredAs", "witness"]);
      if (row.origin.kind !== "local-capability" || !["owned", "path"].includes(row.origin.authoredAs)
          || parseLockedSource3(row.origin.source, ".").kind !== "path") invalidShape("/artifacts/capabilities/origin", "invalid local provenance");
      validateOrigin(row.origin.witness);
    }
  }
  return value;
}

function validateComposition(composition, record) {
  objectAt(composition, ["schemaVersion", "mode", "body", "blocks", "skills", "omissions"], ["schemaVersion", "mode", "body", "blocks", "skills", "omissions"]);
  versionAt(composition.schemaVersion);
  if (!["worktree", "checkout", "attached", "workspace", "directory"].includes(composition.mode)) invalidShape("/dispatch/composition/mode", "invalid work mode");
  const body = own(record.resources, composition.body, "/dispatch/composition/body");
  const subject = record.subject, definition = subject.kind === "persistent" ? subject.soul.definition : subject.definition.path;
  const owner = subject.kind === "persistent" ? subject.soul.sourceArtifact : subject.provider;
  const bodyPath = [...definition.split("/").slice(0, -1), "AGENTS.md"].join("/");
  if (body.kind !== "file" || body.path !== bodyPath || !sameIdentity(body.owner, owner)) invalidShape("/dispatch/composition/body", "composition body is not the captured canonical soul instructions");
  const sources = new Set(), names = new Set();
  const source = (label) => {
    stringAt(label, "/dispatch/composition/source", { pattern: /^(kernel|work-mode|capability|config):[A-Za-z0-9._:-]+$/ });
    if (sources.has(label)) invalidShape("/dispatch/composition", "duplicate instruction source or contradictory omission");
    sources.add(label);
  };
  for (const block of array(composition.blocks, "/dispatch/composition/blocks")) {
    objectAt(block, ["source", "resource", "choice"], ["source", "resource"]); source(block.source);
    const resource = own(record.resources, block.resource, "/dispatch/composition/blocks");
    if (resource.kind !== "file" || block.resource === composition.body) invalidShape("/dispatch/composition/blocks", "instruction block is not an independent file");
    if (block.choice !== undefined && own(record.choices, block.choice, "/choices").value !== block.resource) invalidShape("/dispatch/composition/blocks", "instruction override differs from captured choice");
  }
  for (const omission of array(composition.omissions, "/dispatch/composition/omissions")) {
    objectAt(omission, ["source", "reason", "choice"], ["source", "reason"]); source(omission.source);
    if (omission.reason === "disabled") {
      if (own(record.choices, omission.choice, "/choices").value !== null) invalidShape("/dispatch/composition/omissions", "disabled injection lacks explicit none choice");
    } else if (omission.reason === "helper-policy") {
      if (subject.kind !== "helper" || !omission.source.startsWith("capability:")
        || omission.choice !== `/helpers/injections/${pointerKey(omission.source.slice("capability:".length))}`
        || own(record.choices, omission.choice, "/choices").value !== null) invalidShape("/dispatch/composition/omissions", "helper omission lacks its own explicit none choice");
    } else if (omission.reason !== "helper-knowledge" || subject.kind !== "helper" || !omission.source.startsWith("capability:") || omission.choice !== undefined) {
      invalidShape("/dispatch/composition/omissions", "invalid injection omission");
    }
  }
  for (const skill of array(composition.skills, "/dispatch/composition/skills")) {
    objectAt(skill, ["name", "resource"], ["name", "resource"]);
    stringAt(skill.name, "/dispatch/composition/skills/name", { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ });
    if (names.has(skill.name)) invalidShape("/dispatch/composition/skills", "duplicate captured skill name");
    names.add(skill.name);
    if (own(record.resources, skill.resource, "/resources").kind !== "skill") invalidShape("/dispatch/composition/skills", "wrong captured skill kind");
  }
}

/** Shared exact subject union for retained records and invocation projections. */
export function validateCapturedSubject(subject) {
  canonicalJson(subject);
  if (subject?.kind === "persistent") {
    objectAt(subject, ["kind", "soul"], ["kind", "soul"]); sourceSelection(subject.soul);
  } else {
    objectAt(subject, ["kind", "provider", "definition", "name"], ["kind", "provider", "definition", "name"]);
    if (subject.kind !== "helper") invalidShape("/subject/kind", "invalid resolution subject");
    validateArtifactRef(subject.provider); validateResourceRef(subject.definition);
    if (subject.provider.kind !== "capability" || !sameIdentity(subject.provider, subject.definition.owner)) invalidShape("/subject", "helper provider/definition mismatch");
    stringAt(subject.name, "/subject/name", { pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ });
  }
  return subject;
}

export function validateCapturedContext(context) {
  canonicalJson(context);
  if (context?.kind === "workspace") {
    objectAt(context, ["kind", "identity", "observation"], ["kind", "identity", "observation"]);
    validateWorkspaceIdentity(context.identity); validateOrigin(context.observation);
  } else {
    objectAt(context, ["kind", "key"], ["kind", "key"]);
    if (context.kind !== "standalone") invalidShape("/context/kind", "invalid resolution context");
    if (context.key !== null) stringAt(context.key, "/context/key");
  }
  return context;
}

export function validateResolutionShape(value) {
  canonicalJson(value);
  objectAt(value, RESOLUTION_FIELDS, RESOLUTION_FIELDS);
  versionAt(value.schemaVersion);
  if (!["prepared", "reconstructed"].includes(value.capture)) invalidShape("/capture", "incomplete evidence is not a captured resolution", "resolution-incomplete");
  validateArtifactSet(value.artifacts);
  validateCapturedSubject(value.subject);
  validateCapturedContext(value.context);
  for (const key of ["choices", "bindings", "resources", "helpers"]) objectAt(value[key], null, [], `/${key}`);
  origins(value.evidence, "/evidence");
  if (value.capture === "reconstructed" && !value.evidence.length) invalidShape("/evidence", "reconstruction requires evidence", "resolution-incomplete");
  const owners = new Set();
  const addOwner = (ref) => { validateArtifactRef(ref); owners.add(canonicalJson(ref)); };
  for (const row of Object.values(value.artifacts.capabilities)) addOwner(row.artifact);
  if (value.subject.kind === "persistent") addOwner(value.subject.soul.sourceArtifact);
  for (const ref of array(value.resourceBundles, "/resourceBundles")) {
    if (ref?.kind !== "resource") invalidShape("/resourceBundles", "expected managed resource bundle");
    const key = canonicalJson(ref); if (owners.has(key)) invalidShape("/resourceBundles", "duplicate resource bundle"); addOwner(ref);
  }
  orderedSet(value.resourceBundles, "/resourceBundles", canonicalJson);
  if (value.subject.kind === "helper" && !owners.has(canonicalJson(value.subject.provider))) invalidShape("/subject/provider", "helper provider is not selected");
  for (const resource of Object.values(value.resources)) {
    validateResourceRef(resource);
    if (!owners.has(canonicalJson(resource.owner))) invalidShape("/resources", "resource owner is not selected");
  }
  for (const ref of Object.values(value.helpers)) validateResolutionRef(ref);
  objectAt(value.dispatch, ["schemaVersion", "providerManifests", "settingsChoices", "launch", "runtimePackages", "hostRequirements", "workTargetInputs", "composition"], ["schemaVersion", "providerManifests", "settingsChoices", "launch", "runtimePackages", "hostRequirements", "workTargetInputs"]);
  versionAt(value.dispatch.schemaVersion);
  for (const key of ["providerManifests", "settingsChoices", "workTargetInputs"]) objectAt(value.dispatch[key], null, [], `/dispatch/${key}`);
  const manifests = value.dispatch.providerManifests;
  if (Object.keys(manifests).length !== Object.keys(value.artifacts.capabilities).length) invalidShape("/dispatch/providerManifests", "selected manifest set mismatch");
  for (const [id, row] of Object.entries(value.artifacts.capabilities)) {
    const resource = own(value.resources, own(manifests, id, "/dispatch/providerManifests"), "/resources");
    if (!sameIdentity(resource.owner, row.artifact) || resource.kind !== "manifest" || resource.path !== "oats.json") invalidShape("/dispatch/providerManifests", "manifest owner/path mismatch");
  }
  for (const key of Object.values(value.dispatch.workTargetInputs)) own(value.resources, key, "/dispatch/workTargetInputs");
  for (const [id, settings] of Object.entries(value.dispatch.settingsChoices)) {
    own(value.artifacts.capabilities, id, "/dispatch/settingsChoices");
    objectAt(settings, null, [], "/dispatch/settingsChoices");
    for (const [name, key] of Object.entries(settings)) {
      if (key !== `/settings/${pointerKey(id)}/${pointerKey(name)}`) invalidShape("/dispatch/settingsChoices", "setting reference is not its canonical choice key");
      own(value.choices, key, "/choices");
    }
  }
  if (value.dispatch.composition !== undefined) validateComposition(value.dispatch.composition, value);
  if (value.dispatch.launch !== null) {
    if (!value.dispatch.composition) invalidShape("/dispatch/composition", "launchable capture lacks instruction/resource composition", "resolution-incomplete");
    objectAt(value.dispatch.launch, null, ["version", "runtime"], "/dispatch/launch");
    versionAt(value.dispatch.launch.version);
    if (!["pi", "claude", "codex"].includes(value.dispatch.launch.runtime)) invalidShape("/dispatch/launch/runtime", "invalid captured runtime");
    if (value.dispatch.launch.executableResource !== undefined || value.dispatch.launch.executable === "captured-resource") {
      const executable = own(value.resources, value.dispatch.launch.executableResource, "/dispatch/launch/executableResource");
      const entrypoint = value.dispatch.launch.entrypoint;
      objectAt(entrypoint, ["capability", "command"], ["capability", "command"], "/dispatch/launch/entrypoint");
      stringAt(entrypoint.command, "/dispatch/launch/entrypoint/command");
      const owner = own(value.artifacts.capabilities, entrypoint.capability, "/dispatch/launch/entrypoint/capability");
      if (value.dispatch.launch.executable !== "captured-resource" || executable.kind !== "file"
        || !sameIdentity(executable.owner, owner.artifact)
        || value.dispatch.launch.executableResource !== `executable:${entrypoint.capability}:command:${entrypoint.command}`) invalidShape("/dispatch/launch/executableResource", "captured launch executable must be its exact declared retained command resource");
    }
  }
  for (const runtime of array(value.dispatch.runtimePackages, "/dispatch/runtimePackages")) {
    objectAt(runtime, ["runtime", "package", "resource", "requiredBy"], ["runtime", "package", "resource", "requiredBy"]);
    stringAt(runtime.runtime, "/dispatch/runtimePackages/runtime"); stringAt(runtime.package, "/dispatch/runtimePackages/package");
    const resource = own(value.resources, runtime.resource, "/dispatch/runtimePackages/resource");
    if (resource.kind !== "runtime-package") invalidShape("/dispatch/runtimePackages/resource", "wrong runtime resource kind");
    origins(runtime.requiredBy, "/dispatch/runtimePackages/requiredBy");
  }
  array(value.dispatch.hostRequirements, "/dispatch/hostRequirements");
  validateCapturedChoices(value.choices); bindings(value.bindings, value); validateMessagingChoice(value.messagingChoice, value);
  return value;
}
