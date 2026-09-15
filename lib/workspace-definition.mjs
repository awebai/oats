/** Portable workspace/member/import declarations. Data validation only;
 * repository identity, reciprocal admission and fetching belong to discovery. */
import { parseConfigData } from "./config-data.mjs";
import { canonicalJson } from "./portable-values.mjs";
import { parseRepositorySource, portablePath, revisionSelector } from "./source-spec.mjs";
import { invalidShape, objectAt, pointerKey, stringAt, versionAt } from "./portable-shape.mjs";
import { FUNDAMENTAL_SLOTS, validatePolicyChoices, validateProviderDeclaration } from "./portable-policy.mjs";
import { isMaterializedCapabilityId } from "./capability-provenance.mjs";
import { oatsError } from "./errors.mjs";

const ALIAS = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SOUL_ALIAS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function arrayAt(value, pointer) { if (!Array.isArray(value)) invalidShape(pointer, "expected array"); return value; }
function repositoryAt(value, pointer, { revisionRequired = false, path = false } = {}) {
  objectAt(value, ["source", "revision", ...(path ? ["path"] : [])], ["source", ...(revisionRequired ? ["revision"] : [])], pointer);
  const source = parseRepositorySource(value.source);
  if (Object.hasOwn(value, "revision")) revisionSelector(value.revision);
  if (path && Object.hasOwn(value, "path")) portablePath(value.path);
  return { ...value, source: source.normalized };
}
function duplicate(label, first, current, origins) {
  throw oatsError("requirement-conflict", `duplicate ${label}`, [origins[first] ?? { pointer: first }, origins[current] ?? { pointer: current }]);
}

/** Identical four-field source reference for standalone and workspace imports.
 * Normalization is not verified upstream identity or an enrollment operation. */
export function parseSoulImport(input, { pointer = "", origins = {}, origin = null, localBase, allowLocalPaths = false } = {}) {
  canonicalJson(input, { maxBytes: 256 * 1024, maxDepth: 32, maxEntries: 10_000 });
  const value = objectAt(input, ["source", "soul", "revision", "alias", "adoption"], ["source", "soul", "revision", "alias"], pointer);
  const source = parseRepositorySource(value.source);
  portablePath(value.soul); revisionSelector(value.revision);
  stringAt(value.alias, `${pointer}/alias`, { pattern: SOUL_ALIAS });
  const sources = Object.create(null);
  if (Object.hasOwn(value, "adoption")) {
    const adoption = objectAt(value.adoption, ["teamAliases", "providers", "bindings"], [], `${pointer}/adoption`);
    if (Object.hasOwn(adoption, "teamAliases")) {
      objectAt(adoption.teamAliases, null, [], `${pointer}/adoption/teamAliases`);
      for (const [name, target] of Object.entries(adoption.teamAliases)) {
        stringAt(name, `${pointer}/adoption/teamAliases`, { pattern: ALIAS });
        stringAt(target, `${pointer}/adoption/teamAliases/${pointerKey(name)}`, { pattern: ALIAS });
      }
    }
    if (Object.hasOwn(adoption, "providers")) {
      objectAt(adoption.providers, FUNDAMENTAL_SLOTS, [], `${pointer}/adoption/providers`);
      Object.assign(sources, validatePolicyChoices(adoption.providers, {
        pointer: `${pointer}/adoption/providers`, origins, origin, localBase, allowLocalPaths,
      }));
    }
    if (Object.hasOwn(adoption, "bindings")) objectAt(adoption.bindings, null, [], `${pointer}/adoption/bindings`);
  }
  return { reference: { ...value, source: source.normalized }, sources };
}

export function parseWorkspaceDefinition(input, { origin = null, localBase, allowLocalPaths = false, limits } = {}) {
  const parsed = parseConfigData(input, { origin, limits });
  const value = objectAt(parsed.value, ["schemaVersion", "name", "members", "defaults", "knowledge", "teams", "catalogs", "imports"], ["schemaVersion", "name"]);
  versionAt(value.schemaVersion); stringAt(value.name, "/name");
  const sources = Object.create(null), members = [], imports = [], catalogs = [];
  if (Object.hasOwn(value, "defaults")) Object.assign(sources, validatePolicyChoices(value.defaults, {
    pointer: "/defaults", origins: parsed.origins, origin, localBase, allowLocalPaths,
  }));
  if (Object.hasOwn(value, "members")) {
    const seen = new Map();
    arrayAt(value.members, "/members").forEach((entry, index) => {
      const at = `/members/${index}`, member = repositoryAt(entry, at);
      if (seen.has(member.source)) duplicate("member repository", seen.get(member.source), at, parsed.origins);
      seen.set(member.source, at); members.push(member);
    });
  }
  if (Object.hasOwn(value, "knowledge")) {
    objectAt(value.knowledge, ["stores"], ["stores"], "/knowledge");
    arrayAt(value.knowledge.stores, "/knowledge/stores").forEach((store, index) => validateProviderDeclaration(store, `/knowledge/stores/${index}`));
  }
  if (Object.hasOwn(value, "teams")) {
    objectAt(value.teams, null, [], "/teams");
    for (const [alias, team] of Object.entries(value.teams)) {
      const at = `/teams/${pointerKey(alias)}`;
      stringAt(alias, at, { pattern: ALIAS });
      if (alias === "private") { if (team !== "per-human") invalidShape(at, "private team floor must be per-human"); continue; }
      objectAt(team, ["provider", "id"], ["provider", "id"], at);
      if (!isMaterializedCapabilityId(team.provider)) invalidShape(`${at}/provider`, "invalid messaging provider identity");
      stringAt(team.id, `${at}/id`);
    }
  }
  if (Object.hasOwn(value, "catalogs")) {
    arrayAt(value.catalogs, "/catalogs").forEach((entry, index) => catalogs.push(repositoryAt(entry, `/catalogs/${index}`, { path: true })));
  }
  if (Object.hasOwn(value, "imports")) {
    const seen = new Map();
    arrayAt(value.imports, "/imports").forEach((entry, index) => {
      const at = `/imports/${index}`;
      const imported = parseSoulImport(entry, { pointer: at, origins: parsed.origins, origin, localBase, allowLocalPaths });
      if (seen.has(imported.reference.alias)) duplicate("import alias", seen.get(imported.reference.alias), at, parsed.origins);
      seen.set(imported.reference.alias, at);
      Object.assign(sources, imported.sources); imports.push(imported.reference);
    });
  }
  return { declaration: value, sources, members, imports, catalogs, origins: parsed.origins, integrity: parsed.integrity };
}

export function parseMemberExports(input, { origin = null, limits } = {}) {
  const parsed = parseConfigData(input, { origin, limits });
  const value = objectAt(parsed.value, ["schemaVersion", "workspace", "exports"], ["schemaVersion", "exports"]);
  versionAt(value.schemaVersion);
  const workspace = Object.hasOwn(value, "workspace") ? repositoryAt(value.workspace, "/workspace") : null;
  const exports = objectAt(value.exports, ["souls", "packages", "knowledge"], [], "/exports");
  for (const kind of ["souls", "packages"]) {
    if (!Object.hasOwn(exports, kind)) continue;
    const seen = new Map();
    arrayAt(exports[kind], `/exports/${kind}`).forEach((entry, index) => {
      const at = `/exports/${kind}/${index}`;
      objectAt(entry, kind === "souls" ? ["path", "definition", "description"] : ["path", "description"],
        kind === "souls" ? ["path", "definition"] : ["path"], at);
      portablePath(entry.path, { allowRoot: kind === "packages" });
      if (seen.has(entry.path)) duplicate(`${kind} export path`, seen.get(entry.path), at, parsed.origins);
      seen.set(entry.path, at);
      if (kind === "souls") {
        portablePath(entry.definition);
        if (!entry.definition.startsWith(`${entry.path}/`)) invalidShape(`${at}/definition`, "definition must be inside its exported soul path");
      }
      if (Object.hasOwn(entry, "description")) stringAt(entry.description, `${at}/description`, { empty: true });
    });
  }
  if (Object.hasOwn(exports, "knowledge")) arrayAt(exports.knowledge, "/exports/knowledge").forEach((store, index) => validateProviderDeclaration(store, `/exports/knowledge/${index}`));
  return { declaration: value, workspace, exports, origins: parsed.origins, integrity: parsed.integrity };
}
