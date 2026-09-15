/** Package-side portable preparation over frozen observations. No current lock,
 * config cascade, approval or activation lookup; caller owns final composition/CAS. */
import { chmodSync, lstatSync, mkdtempSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, join, posix, relative } from "node:path";
import { canonicalJson, compareUtf8, decodeUtf8, parseStrictJson } from "./portable-values.mjs";
import { PACKAGE_FORMAT, bytesIntegrity, treeIntegrity } from "./portable-digest.mjs";
import { readPortableBytes } from "./portable-files.mjs";
import { removeOwnedStaging } from "./artifact-tree.mjs";
import { createSourceProjection, validateProjectionPath } from "./source-projection.mjs";
import { resolvePackageClosure } from "./package-closure.mjs";
import { parseLockedSource3, parsePackageDependency3, parseRepositorySource, portablePath, validateRepoAnchor, validateSelectionSource } from "./source-spec.mjs";
import { isMaterializedCapabilityId } from "./capability-provenance.mjs";
import { objectAt } from "./portable-shape.mjs";
import { validateArtifactSet, validateOrigin } from "./resolution-shape.mjs";
import { retainPortableArtifact } from "./portable-artifacts.mjs";
import { oatsError } from "./errors.mjs";

const outside = (root, target) => { const path = relative(root, target); return path === ".." || path.startsWith("../") || path.startsWith("..\\") || isAbsolute(path); };
function copyLocalPayload(source, destination) {
  const root = realpathSync(source), parent = realpathSync(join(destination, "..")), rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || !outside(root, parent)) throw oatsError("invalid-source", "package input must be a directory outside its staging tree");
  const entries = []; let count = 0, bytes = 0;
  const inspect = (directory, parts) => {
    if (parts.length > 64) throw oatsError("resource-limit", "local package source depth exceeded");
    for (const raw of readdirSync(directory, { encoding: "buffer" })) {
      if (++count > 10_000) throw oatsError("resource-limit", "local package source entry budget exceeded");
      const name = decodeUtf8(raw), lowered = name.toLowerCase();
      if (lowered === ".git") continue; // Never read/copy Git administrative state, at any depth.
      if ([".aw", ".agents", ".oats-state"].includes(lowered) || (lowered === "instances" && parts.at(-2)?.toLowerCase() === "agents")) {
        throw oatsError("source-incomplete", "local package subtree contains private deployment/auth/instance state");
      }
      const path = [...parts, name].join("/"), file = join(directory, name), stat = lstatSync(file);
      validateProjectionPath(path);
      if (!stat.isDirectory() && !stat.isFile() && !stat.isSymbolicLink()) throw oatsError("invalid-source", "local package source contains a special file");
      if (stat.isFile() && (bytes += stat.size) > 256 * 1024 * 1024) throw oatsError("resource-limit", "local package source byte budget exceeded");
      entries.push({ path, file, stat });
      if (stat.isDirectory()) inspect(file, [...parts, name]);
    }
  };
  inspect(root, []); // Complete no-follow privacy/size preflight before any copy.
  const projection = createSourceProjection(destination);
  const unchanged = (entry) => {
    const actual = lstatSync(entry.file), before = entry.stat;
    if (actual.dev !== before.dev || actual.ino !== before.ino || actual.mode !== before.mode || actual.size !== before.size
        || actual.mtimeMs !== before.mtimeMs || actual.ctimeMs !== before.ctimeMs) throw oatsError("integrity-drift", "local package source changed during snapshot");
  };
  for (const entry of entries) {
    unchanged(entry);
    if (entry.stat.isDirectory()) projection.directory(entry.path, entry.stat.mode & 0o7777);
    else if (entry.stat.isSymbolicLink()) projection.link(entry.path, readlinkSync(entry.file));
    else projection.copyFile(entry.path, entry.file, entry.stat.mode & 0o7777);
    unchanged(entry);
  }
  projection.finish(); chmodSync(destination, rootStat.mode & 0o7777);
}

export function preparePackageArtifacts({ requests, deployment, directory, repositories, kernel, observations = [], catalog, allowLocalPaths = false }) {
  canonicalJson(requests);
  if (!Array.isArray(requests) || !requests.length || typeof directory !== "string" || !isAbsolute(directory)
      || typeof deployment !== "string" || !isAbsolute(deployment) || typeof allowLocalPaths !== "boolean") throw oatsError("invalid-source", "package preparation needs explicit requests, scope and scratch directory");
  for (const name of ["loadPackageManifestAt", "capabilityCompatibility", "assertPlatformInvariantLocks", "materializeCapability"]) {
    if (typeof kernel?.[name] !== "function") throw new TypeError(`package preparation requires kernel.${name}`);
  }
  for (const request of requests) {
    objectAt(request, ["source", "origin", "capability"], ["source", "origin"]); validateOrigin(request.origin);
    if (request.capability !== undefined && !isMaterializedCapabilityId(request.capability)) throw oatsError("invalid-source", "invalid requested capability identity");
  }
  const staging = mkdtempSync(join(realpathSync(directory), ".package-preparation-")), owned = lstatSync(staging);
  const cached = new Map(), sourceObservations = [...observations]; let counter = 0, closed = false;
  const cleanup = () => {
    if (closed) return;
    const current = lstatSync(staging);
    if (!current.isDirectory() || current.dev !== owned.dev || current.ino !== owned.ino) throw oatsError("source-incomplete", "package staging cleanup lost ownership");
    removeOwnedStaging(staging); closed = true;
  };
  const observe = (source, selector, origin) => {
    const existing = sourceObservations.find((value) => value.source.remote === source && (value.source.commit === selector || value.source.selector === selector));
    if (existing) return existing;
    const observation = repositories.observe(source, { ...(selector === undefined ? {} : { revision: selector }), origin });
    sourceObservations.push(observation);
    return observation;
  };
  const readPackage = (request) => {
    validateOrigin(request.origin);
    let selected = request.source;
    if (selected?.kind === "catalog") {
      const normalized = parsePackageDependency3(selected.source);
      if (canonicalJson(normalized) !== canonicalJson(selected)) throw oatsError("invalid-source", "catalog request fields disagree");
    } else validateSelectionSource(selected);
    const key = canonicalJson(selected);
    if (cached.has(key)) return cached.get(key);
    let originalSource, packagePath, commit, payload, sourceDocument, repoAnchor = null, localBase;
    const destination = join(staging, `package-${counter++}`);
    let repository, selector;
    if (selected.kind === "repo") {
      repoAnchor = selected.anchor;
      if (repoAnchor.source.startsWith("path:")) {
        const root = parseLockedSource3(repoAnchor.source, ".").localPath;
        const localPath = join(root, selected.path);
        selected = { kind: "path", source: `path:${localPath}`, path: ".", localPath, portable: false };
      } else {
        repository = repoAnchor.source; selector = repoAnchor.revision; packagePath = selected.path;
        originalSource = `${repository}@${selector}`;
      }
    }
    if (selected.kind === "catalog") {
      if (typeof catalog !== "function") throw oatsError("needs-configuration", "package dependency requires an explicit catalog resolver");
      const entry = catalog(selected.id, selected.selector);
      if (!entry || typeof entry.url !== "string") throw oatsError("invalid-source", "catalog did not resolve a repository");
      repository = parseRepositorySource(`git:${entry.url}`).normalized;
      selector = entry.ref; packagePath = entry.path ?? "oats-package"; originalSource = selected.source;
    } else if (selected.kind === "git") {
      repository = parseRepositorySource(`git:${selected.url}`).normalized;
      selector = selected.selector; packagePath = selected.path; originalSource = selected.source;
    }
    if (selected.kind === "path") {
      if (!allowLocalPaths) throw oatsError("needs-configuration", "local package input requires explicit authorization");
      localBase = selected.localPath; originalSource = selected.source; packagePath = "."; commit = "local";
      copyLocalPayload(localBase, destination); payload = destination;
      sourceDocument = { kind: "source", source: originalSource, revision: "local", path: "oats-package.json" };
    } else {
      portablePath(packagePath, { allowRoot: true });
      const observation = observe(repository, selector, request.origin);
      repositories.materialize(observation, [packagePath], destination);
      payload = join(destination, packagePath); commit = observation.source.commit;
      repoAnchor = { source: observation.source.remote, revision: commit };
      sourceDocument = { kind: "source", source: observation.source.remote, revision: commit, path: posix.join(packagePath, "oats-package.json") };
    }
    // Strict JSON ingress precedes the sole existing full package/manifest codec.
    const bytes = readPortableBytes(join(payload, "oats-package.json")); parseStrictJson(bytes);
    sourceDocument.integrity = bytesIntegrity(bytes);
    const manifest = kernel.loadPackageManifestAt(payload, { strict: true });
    const dependencyRequests = (manifest.dependencies ?? []).map((spec, index) => {
      // Local siblings are authoring input. A remote manifest never gains access
      // to adopter files merely because another root request was local.
      let source = parsePackageDependency3(spec, { localBase, allowLocalPaths: allowLocalPaths && localBase !== undefined });
      if (source.kind === "repo") {
        if (!repoAnchor) throw oatsError("needs-configuration", "repo dependency has no explicit repository snapshot anchor");
        source = { ...source, anchor: validateRepoAnchor(repoAnchor) };
      }
      return { source, origin: { kind: "package-dependency", document: sourceDocument, pointer: `/dependencies/${index}` } };
    });
    const record = { package: manifest.package, version: manifest.version, source: originalSource, path: packagePath, commit,
      sourceKey: canonicalJson({ source: originalSource, path: packagePath, commit }), dir: payload, manifest,
      capabilities: manifest._capabilities, dependencyRequests, origins: [request.origin] };
    cached.set(key, record); return record;
  };
  try {
    const graph = resolvePackageClosure({ requests, readPackage,
      validatePackage(record) {
        const compatibility = kernel.capabilityCompatibility(record.manifest);
        if (!compatibility.compatible) throw oatsError("incompatible-oats", `package ${record.package} requires OATS ${compatibility.range}`);
      },
      finalizePackage: (record, deps) => ({ ...record, deps, integrity: treeIntegrity(record.dir, { format: PACKAGE_FORMAT }) }),
      discardPackage: () => {}, // All duplicate payloads belong to outer owned staging.
    });
    const owners = new Map();
    for (const record of graph.packages.values()) for (const cap of record.capabilities) {
      if (owners.has(cap.id) && owners.get(cap.id) !== record.package) throw oatsError("duplicate-capability-id", "selected package closures export conflicting capability identities");
      owners.set(cap.id, record.package);
    }
    requests.forEach((request, index) => {
      if (request.capability && !graph.packages.get(graph.roots[index]).capabilities.some((cap) => cap.id === request.capability)) throw oatsError("capability-list-mismatch", "selected source does not export the required capability");
    });
    kernel.assertPlatformInvariantLocks([...graph.packages.values()].flatMap((record) => record.capabilities.map((cap) => cap.dir)));
    const artifactSet = { schemaVersion: 1, packages: Object.create(null), capabilities: Object.create(null) };
    const artifacts = new Map();
    for (const record of graph.packages.values()) {
      artifactSet.packages[record.package] = { source: record.source, path: record.path, version: record.version, commit: record.commit,
        integrity: record.integrity, dependencies: [...new Set(record.deps)].sort(compareUtf8) };
      for (const cap of record.capabilities) {
        const projected = kernel.materializeCapability({ cap, pkg: record, artifactsDir: join(staging, "artifacts") });
        const artifact = { kind: "capability", capability: cap.id, integrity: treeIntegrity(projected.dir) };
        artifactSet.capabilities[cap.id] = { version: projected.version, artifact, origin: { kind: "package", package: record.package, path: cap.rel, projectionVersion: 1 } };
        artifacts.set(cap.id, projected.dir);
      }
    }
    validateArtifactSet(artifactSet);
    for (const [id, source] of artifacts) retainPortableArtifact(deployment, source, artifactSet.capabilities[id].artifact);
    return { artifactSet, roots: graph.roots, cleanup };
  } catch (error) {
    try { cleanup(); } catch (failure) {
      const combined = new AggregateError([error, failure], "package preparation and cleanup failed", { cause: error });
      combined.code = error.code; combined.stagingPath = staging; throw combined;
    }
    throw error;
  }
}
