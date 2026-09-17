/** Immutable resolution records outside homes. Exact input verification is not
 * approval, enrollment or host readiness; dispatch must check those separately. */
import { linkSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readPortableBytes } from "./portable-files.mjs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { ensureStoreIgnore } from "./capability-artifacts.mjs";
import { canonicalJson, parseStrictJson } from "./portable-values.mjs";
import { bytesIntegrity, jsonIntegrity, PACKAGE_FORMAT, treeIntegrity } from "./portable-digest.mjs";
import { settingChoiceKey, soulConstraints } from "./soul-constraints.mjs";
import { verifyManifestSettings } from "./manifest-settings.mjs";
import { verifyHelperInjectionPolicies } from "./helper-injection-policy.mjs";
import { verifyPortableArtifact } from "./portable-artifacts.mjs";
import { validateResolutionRef, validateResolutionShape } from "./resolution-shape.mjs";
import { parsePortableSoul } from "./portable-soul.mjs";
import { parseConfigData } from "./config-data.mjs";
import { normalizePackagePath } from "./capability-provenance.mjs";
import { parseLockedSource3, parseRepositorySource } from "./source-spec.mjs";
import { oatsError } from "./errors.mjs";

const exists = (path) => { try { return lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
const outside = (root, target) => { const part = relative(root, target); return part === ".." || part.startsWith("../") || part.startsWith("..\\") || isAbsolute(part); };
function store(scope, create) {
  if (typeof scope !== "string" || !isAbsolute(scope)) throw oatsError("invalid-resolution", "resolution deployment must be explicit and absolute");
  let root;
  try { root = realpathSync(scope); }
  catch (error) { if (error.code === "ENOENT") throw oatsError("resolution-not-found", "resolution deployment is absent"); throw error; }
  if (!lstatSync(root).isDirectory()) throw oatsError("invalid-resolution", "resolution deployment is not a directory");
  for (const name of [".agents", "resolutions"]) {
    root = join(root, name);
    if (create) { try { mkdirSync(root, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; } }
    const stat = exists(root);
    if (!stat) throw oatsError("resolution-not-found", "resolution store is absent");
    if (!stat.isDirectory()) throw oatsError("invalid-resolution", "managed resolution store component is not a real directory");
  }
  if (create) ensureStoreIgnore(root);
  return root;
}
const readBytes = (path, missingCode = "resolution-not-found") => readPortableBytes(path, { missingCode, invalidCode: "invalid-resolution" });
function decodeRecord(path, reference) {
  const bytes = readBytes(path), value = parseStrictJson(bytes);
  if (jsonIntegrity(value).value !== reference.id || !bytes.equals(Buffer.from(canonicalJson(value)))) {
    throw oatsError("integrity-drift", "captured resolution bytes differ from their canonical address");
  }
  // Check the address before inspecting/following any references.
  validateResolutionShape(value);
  return value;
}
export function readCapturedResolution(scope, reference) {
  validateResolutionRef(reference);
  return decodeRecord(join(store(scope, false), `${reference.id}.json`), reference);
}
function resourcePath(root, reference) {
  const path = join(root, reference.path);
  let actual;
  try { actual = realpathSync(path); }
  catch (error) { if (error.code === "ENOENT") throw oatsError("resource-not-found", "captured resource is absent"); throw error; }
  if (outside(root, actual)) throw oatsError("resource-not-contained", "captured resource escapes its artifact");
  const stat = lstatSync(actual), directory = ["directory", "skill", "runtime-package"].includes(reference.kind);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw oatsError("resource-not-found", "captured resource kind differs from its declaration");
  return actual;
}

function canonicalSoulFiles(definition) {
  const body = join(dirname(definition), "AGENTS.md"), alias = join(dirname(definition), "CLAUDE.md");
  if (!exists(body)?.isFile() || !exists(alias)?.isSymbolicLink() || isAbsolute(readlinkSync(alias)) || realpathSync(alias) !== realpathSync(body)) {
    throw oatsError("resolution-incomplete", "captured soul lacks its canonical AGENTS.md/CLAUDE.md alias");
  }
  if (exists(join(dirname(definition), "knowledge"))) throw oatsError("resolution-incomplete", "portable soul knowledge must be external");
}
function verifySoulConstraints(record, root, definition) {
  const source = record.subject.soul;
  const localBase = source.revision.kind === "local" ? parseLockedSource3(source.revision.source, ".").localPath
    : record.choices["/bindings/source/localBase"]?.value;
  // Local addresses are only compared to already captured provenance here;
  // parsing never acquires or reads the original local directory.
  const definitionBytes = readBytes(definition, "resource-not-found");
  const sourceDocument = { kind: "source", source: source.revision.kind === "local" ? source.revision.source : source.revision.remote,
    revision: source.revision.kind === "local" ? "local" : source.revision.commit,
    path: source.definition, integrity: bytesIntegrity(definitionBytes) };
  const parsed = parsePortableSoul(definitionBytes, { origin: sourceDocument, localBase, allowLocalPaths: true });
  const originKey = ({ kind, document, pointer }) => canonicalJson({ kind, document, pointer });
  for (const expected of soulConstraints(parsed)) {
    const choice = record.choices[expected.key];
    const retained = choice?.constraints.some((constraint) => constraint.kind === expected.kind
      && (expected.kind !== "equals" || canonicalJson(constraint.value) === canonicalJson(expected.value))
      && originKey(constraint.origin) === originKey(expected.origin));
    if (!retained) throw oatsError("resolution-incomplete", "captured choice omits its source hard constraint or provenance");
  }
  const sourcePath = (path) => {
    if (!source.projection.roots.some((entry) => entry === "." || path === entry || path.startsWith(`${entry}/`))) {
      throw oatsError("resolution-incomplete", "declared source resource is not in the captured projection");
    }
    const file = join(root, path);
    if (!exists(file)) throw oatsError("resource-not-found", "declared source resource is absent");
    if (outside(root, realpathSync(file))) throw oatsError("resource-not-contained", "declared source resource escapes its artifact");
  };
  for (const path of parsed.declaration.resources ?? []) sourcePath(path);
  const check = (id, selection, pointer) => {
    const row = record.artifacts.capabilities[id];
    if (!row) throw oatsError("resolution-incomplete", "source hard requirement is not captured");
    const required = parsed.sources[`${pointer}/source`];
    const pkg = row.origin.kind === "package" ? record.artifacts.packages[row.origin.package] : null;
    const actual = pkg ? parseLockedSource3(pkg.source, pkg.path) : parseLockedSource3(row.origin.source, ".");
    let matches;
    if (required.kind === "repo") {
      sourcePath(required.path);
      if (!pkg || canonicalJson(treeIntegrity(join(root, required.path), { format: PACKAGE_FORMAT })) !== canonicalJson(pkg.integrity)) {
        throw oatsError("resolution-incomplete", "repo package payload differs from its retained source snapshot");
      }
      matches = source.revision.kind === "local"
        ? actual.kind === "path" && actual.localPath === join(localBase, required.path)
        : pkg && actual.kind === "git" && pkg.commit === source.revision.commit && pkg.path === required.path
          && actual.url === parseRepositorySource(source.revision.remote).url;
    } else matches = required.kind === actual.kind && required.source === actual.source && required.path === actual.path;
    if (!matches) throw oatsError("resolution-incomplete", "captured capability source violates its soul requirement");
    for (const [key, expected] of Object.entries(selection.settings ?? {})) {
      const choiceKey = record.dispatch.settingsChoices[id]?.[key];
      if (choiceKey !== settingChoiceKey(id, key) || !Object.hasOwn(record.choices, choiceKey)
          || canonicalJson(record.choices[choiceKey].value) !== canonicalJson(expected)) {
        throw oatsError("resolution-incomplete", "captured setting violates its soul requirement");
      }
    }
  };
  const requirements = parsed.declaration.requires ?? {};
  for (const [id, selection] of Object.entries(requirements.capabilities ?? {})) {
    check(id, selection, `/requires/capabilities/${id.replace(/~/g, "~0").replace(/\//g, "~1")}`);
  }
  for (const slot of ["knowledge", "messaging", "tasks"]) {
    if (!Object.hasOwn(requirements, slot)) continue;
    const provider = record.bindings[slot];
    if (!provider) throw oatsError("resolution-incomplete", "source requires an unbound fundamental provider");
    const required = requirements[slot];
    if (required !== "any") {
      if (provider.capability !== required.capability) throw oatsError("resolution-incomplete", "captured provider violates its soul requirement");
      check(required.capability, required, `/requires/${slot}`);
    }
  }
  if (parsed.declaration.knowledge) {
    const binding = record.bindings.knowledge, declared = parsed.declaration.knowledge;
    if (!binding || binding.payloadContract !== declared.contract || binding.payloadVersion !== declared.version) {
      throw oatsError("resolution-incomplete", "captured knowledge binding does not support its source declaration");
    }
  }
}

/** Shared row/installation proof for exact record inputs and prospective
 * artifact-set approval. The caller has already verified the artifact tree. */
export function verifyRetainedCapability(root, artifacts, id, manifest = parseStrictJson(readBytes(join(root, "oats.json"), "resource-not-found"))) {
  const row = artifacts.capabilities[id];
  if (!row || manifest.capability !== id || manifest.version !== row.version) throw oatsError("invalid-resolution", "retained manifest identity/version differs from its captured row");
  if (row.origin.kind === "package") {
    const pkg = artifacts.packages[row.origin.package];
    const provenance = parseStrictJson(readBytes(join(root, ".oats-installation.json"), "resource-not-found"));
    const expected = { schemaVersion: 1, capability: id, version: row.version, package: row.origin.package,
      packageVersion: pkg.version, source: pkg.source, commit: pkg.commit, packagePath: pkg.path, capabilityPath: row.origin.path };
    for (const [key, value] of Object.entries(expected)) if (provenance[key] !== value) throw oatsError("invalid-resolution", "retained installation provenance differs from its captured rows");
  }
  return manifest;
}

/** Verify only exact retained inputs. Does not read today's selection lock,
 * config, catalog, source repository, credential values or approval booleans. */
export function verifyResolutionInputs(scope, reference, { draft, maxRecords = 256 } = {}) {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 4096) throw oatsError("invalid-resolution", "invalid record graph budget");
  const roots = new Map(), records = new Map(), active = new Set();
  let edges = 0, bytes = 0;
  const rootOf = (artifact) => {
    const key = canonicalJson(artifact);
    if (!roots.has(key)) roots.set(key, verifyPortableArtifact(scope, artifact).dir);
    return roots.get(key);
  };
  const verify = (ref, supplied, depth) => {
    validateResolutionRef(ref);
    if (active.has(ref.id)) throw oatsError("invalid-resolution", "captured helper cycle");
    if (records.has(ref.id)) return records.get(ref.id);
    if (depth > 64 || records.size + active.size >= maxRecords) throw oatsError("resource-limit", "captured helper graph limit exceeded");
    const record = supplied ?? readCapturedResolution(scope, ref);
    validateResolutionShape(record);
    const encoded = canonicalJson(record);
    if (jsonIntegrity(record).value !== ref.id) throw oatsError("integrity-drift", "resolution draft/reference mismatch");
    bytes += Buffer.byteLength(encoded);
    if (bytes > 32 * 1024 * 1024) throw oatsError("resource-limit", "aggregate captured record byte limit exceeded");
    active.add(ref.id);
    try {
      if (record.subject.kind === "persistent") {
        const soul = record.subject.soul, root = rootOf(soul.sourceArtifact);
        const definition = resourcePath(root, { path: soul.definition, kind: "file" });
        for (const path of soul.projection.roots) {
          const projected = join(root, path);
          if (!exists(projected)) throw oatsError("resource-not-found", "captured source projection root is absent");
          if (outside(root, realpathSync(projected))) throw oatsError("resource-not-contained", "captured source projection escapes its artifact");
        }
        canonicalSoulFiles(definition);
        verifySoulConstraints(record, root, definition);
      } else resourcePath(rootOf(record.subject.provider), record.subject.definition);
      for (const row of Object.values(record.artifacts.capabilities)) rootOf(row.artifact);
      for (const artifact of record.resourceBundles) rootOf(artifact);
      const resources = new Map();
      for (const [key, resource] of Object.entries(record.resources)) resources.set(key, resourcePath(rootOf(resource.owner), resource));
      const definitions = Object.entries(record.dispatch.providerManifests).map(([id, resourceKey]) => ({
        artifact: record.artifacts.capabilities[id].artifact, bytes: readBytes(resources.get(resourceKey), "resource-not-found"),
      }));
      const manifests = verifyManifestSettings(record, definitions);
      verifyHelperInjectionPolicies(record, definitions);
      for (const [id, manifest] of manifests) {
        const row = record.artifacts.capabilities[id];
        verifyRetainedCapability(rootOf(row.artifact), record.artifacts, id, manifest);
        if (record.subject.kind === "helper" && record.subject.provider.capability === id) {
          const declared = Array.isArray(manifest.agents) && manifest.agents.some((entry) => {
            const path = normalizePackagePath(entry);
            return path !== undefined && record.subject.definition.path === (path === "." ? "soul.yaml" : `${path}/soul.yaml`);
          });
          if (!declared) throw oatsError("resolution-incomplete", "captured helper is not exported by its retained provider");
          const definition = resourcePath(rootOf(row.artifact), record.subject.definition);
          const helper = parseConfigData(readBytes(definition, "resource-not-found")).value;
          if (helper?.name !== record.subject.name) throw oatsError("resolution-incomplete", "captured helper name differs from its definition");
          canonicalSoulFiles(definition);
        }
        for (const [slot, binding] of Object.entries(record.bindings)) {
          if (binding.capability === id && manifest.layer !== slot) throw oatsError("invalid-resolution", "retained provider implements a different fundamental slot");
        }
      }
      for (const helper of Object.values(record.helpers)) {
        if (++edges > 4096) throw oatsError("resource-limit", "captured helper edge limit exceeded");
        const child = verify(helper, undefined, depth + 1);
        if (child.record.subject.kind !== "helper") throw oatsError("invalid-resolution", "captured helper reference names a persistent soul");
      }
      const result = { record, resources, manifests };
      records.set(ref.id, result);
      return result;
    } finally { active.delete(ref.id); }
  };
  const result = verify(reference, draft, 0);
  return { ...result, reference, roots, records };
}

/** Commit only a verified prepared record, by atomic no-replace publication.
 * Legacy reconstruction needs the later explicit migration/evidence verifier. */
export function commitCapturedResolution(scope, draft) {
  validateResolutionShape(draft);
  if (draft.capture !== "prepared") throw oatsError("migration-required", "historical reconstruction requires the explicit migration verifier");
  const reference = { schemaVersion: 1, id: jsonIntegrity(draft).value };
  const verified = verifyResolutionInputs(scope, reference, { draft });
  let existingRoot;
  try { existingRoot = store(scope, false); }
  catch (error) { if (error.code !== "resolution-not-found") throw error; }
  const existingTarget = existingRoot && join(existingRoot, `${reference.id}.json`);
  if (existingTarget && exists(existingTarget)) { decodeRecord(existingTarget, reference); return reference; }
  // Literal old evidence can be read/reused, but no caller (including callers
  // bypassing the compiler) may mint a new slot-derived/missing-policy helper.
  verifyHelperInjectionPolicies(draft, Object.entries(draft.dispatch.providerManifests).map(([id, key]) => ({
    artifact: draft.artifacts.capabilities[id].artifact, bytes: readBytes(verified.resources.get(key), "resource-not-found"),
  })), { publishing: true });
  const root = store(scope, true), target = join(root, `${reference.id}.json`);
  const staging = mkdtempSync(join(root, ".resolution-"));
  let failed = false, primary;
  try {
    const candidate = join(staging, "record.json");
    writeFileSync(candidate, canonicalJson(draft), { flag: "wx", mode: 0o600 });
    decodeRecord(candidate, reference);
    try { linkSync(candidate, target); } catch (error) { if (error.code !== "EEXIST") throw error; }
    decodeRecord(target, reference);
    return reference;
  } catch (error) { failed = true; primary = error; throw error; }
  finally {
    try { rmSync(staging, { recursive: true, force: true }); }
    catch (cleanup) {
      const error = failed ? new AggregateError([primary, cleanup], "resolution publication and cleanup failed", { cause: primary })
        : new Error("resolution staging cleanup failed", { cause: cleanup });
      error.code = failed ? primary.code : cleanup.code;
      error.stagingPath = staging;
      throw error;
    }
  }
}
