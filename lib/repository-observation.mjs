/** Exact, transaction-scoped repository observations. Bare Git reads never check
 * out or execute source content. Cache lifetime/auth context is one transaction. */
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { canonicalJson, decodeUtf8, freezeJson, parseStrictJson } from "./portable-values.mjs";
import { bytesIntegrity } from "./portable-digest.mjs";
import { parseRepositorySource, portablePath, revisionSelector } from "./source-spec.mjs";
import { sameIdentity, validateRepositoryIdentity } from "./portable-identity.mjs";
import { validateOrigin } from "./resolution-shape.mjs";
import { assertRetainableTree } from "./capability-artifacts.mjs";
import { oatsError } from "./errors.mjs";

/** Refuse host aliases that are not ordinary source filenames before any write. */
export function validateProjectionPath(path, platform = process.platform) {
  portablePath(path);
  if (platform === "win32" && path.split("/").some((part) => /[:<>"|?*\x00-\x1f]/.test(part) || /[ .]$/.test(part)
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))) {
    throw oatsError("source-incomplete", "source path is not an ordinary filename on this host");
  }
  return path;
}

function githubCoordinates(url) {
  let host, path;
  if (url.includes("://")) { const parsed = new URL(url); host = parsed.hostname; path = parsed.pathname.slice(1); }
  else { const match = /^[^@]+@([^:]+):(.+)$/.exec(url); if (!match) return null; [, host, path] = match; }
  if (host.toLowerCase() !== "github.com") return null;
  const parts = path.replace(/\.git$/, "").split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) throw oatsError("source-identity-unresolved", "GitHub repository locator cannot be qualified");
  return { host: "github.com", owner: parts[0], name: parts[1] };
}

/** Native host credentials only; no token extraction, copying or fallback after
 * a GitHub identity lookup fails. Unsupported hosts use explicit remote identity. */
export function readHostingIdentity(repository, { environment = process.env, expectedIdentity } = {}) {
  if (expectedIdentity?.kind === "canonical-remote") return { identity: { kind: "canonical-remote", remote: repository.normalized } };
  const coordinates = githubCoordinates(repository.url);
  if (!coordinates) return { identity: { kind: "canonical-remote", remote: repository.normalized } };
  let metadata;
  try {
    const output = execFileSync("gh", ["api", "--hostname", coordinates.host, `repos/${coordinates.owner}/${coordinates.name}`,
      "--jq", "{id, full_name, default_branch}"], { env: environment, timeout: 30_000, maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    metadata = parseStrictJson(output);
  } catch { throw oatsError("source-identity-unresolved", "repository hosting identity is unavailable in the selected access context"); }
  if (!Number.isSafeInteger(metadata.id) || metadata.id < 1 || typeof metadata.full_name !== "string") throw oatsError("source-identity-unresolved", "hosting response lacks a stable repository identity");
  if (metadata.full_name.toLowerCase() !== `${coordinates.owner}/${coordinates.name}`.toLowerCase()) throw oatsError("source-identity-change", "repository redirect or rename requires an explicit identity mapping");
  revisionSelector(metadata.default_branch);
  return { identity: { kind: "provider-repository", provider: "github", host: coordinates.host, id: String(metadata.id) }, defaultBranch: metadata.default_branch };
}

function gitEnvironment(environment) {
  const out = { ...environment };
  // Keep native credential/SSH facilities, but never an invoking repository's
  // object/index/config injection. Host HOME/config credentials remain host-owned.
  const retained = new Set(["GIT_ASKPASS", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_SSH_VARIANT", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM"]);
  for (const key of Object.keys(out)) if (key.startsWith("GIT_") && !retained.has(key)) delete out[key];
  out.GIT_TERMINAL_PROMPT = "0"; out.GIT_LITERAL_PATHSPECS = "1"; out.GIT_NO_REPLACE_OBJECTS = "1";
  return out;
}

export function createRepositoryTransaction({ directory, accessContextKey, environment = process.env, identityReader = readHostingIdentity, allowLocalGit = false,
  maxRepositories = 32, maxEntries = 10_000, maxBytes = 256 * 1024 * 1024 } = {}) {
  if (typeof directory !== "string" || !isAbsolute(directory) || typeof accessContextKey !== "string" || !accessContextKey) throw oatsError("invalid-source", "repository observation requires an explicit scratch directory and access context");
  canonicalJson(accessContextKey, { maxBytes: 8192 });
  for (const value of [maxRepositories, maxEntries, maxBytes]) if (!Number.isSafeInteger(value) || value < 1) throw oatsError("resource-limit", "invalid repository observation budget");
  const parent = realpathSync(directory);
  if (!lstatSync(parent).isDirectory()) throw oatsError("invalid-source", "repository observation scratch root is not a directory");
  const root = mkdtempSync(join(parent, ".repository-transaction-")), owned = lstatSync(root), hooks = join(root, "empty-hooks");
  mkdirSync(hooks, { mode: 0o700 });
  const env = gitEnvironment(environment), memo = new Map(), snapshots = new Map(), hosts = new Map(), defaults = new Map(), handles = new WeakMap(), blobs = new Map();
  let closed = false, readBytes = 0, entriesRead = 0;
  const active = () => { if (closed) throw oatsError("source-unavailable", "repository transaction is closed"); };
  const git = (args, limit = 1024 * 1024) => {
    active();
    try { return execFileSync("git", ["-c", `core.hooksPath=${hooks}`, "-c", "protocol.ext.allow=never", "-c", `protocol.file.allow=${allowLocalGit ? "always" : "never"}`,
      "-c", "http.followRedirects=false", ...args], { cwd: root, env, timeout: 60_000, maxBuffer: limit, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { throw oatsError(error.code === "ENOBUFS" ? "resource-limit" : "source-unavailable", "repository read failed in the selected access context"); }
  };
  const hostFor = (repository, expectedIdentity) => {
    if (!hosts.has(repository.normalized)) {
      if (hosts.size >= maxRepositories * 4) throw oatsError("resource-limit", "repository identity count exceeded");
      try {
        const response = identityReader(repository, { environment: env, expectedIdentity });
        validateRepositoryIdentity(response.identity);
        if (response.defaultBranch !== undefined) revisionSelector(response.defaultBranch);
        hosts.set(repository.normalized, { value: freezeJson({ identity: structuredClone(response.identity),
          ...(response.defaultBranch === undefined ? {} : { defaultBranch: response.defaultBranch }) }) });
      } catch (error) { hosts.set(repository.normalized, { error }); }
    }
    const hosted = hosts.get(repository.normalized);
    if (hosted.error) throw hosted.error;
    const host = hosted.value;
    if (host.identity.kind === "canonical-remote" && host.identity.remote !== repository.normalized) throw oatsError("source-identity-change", "canonical repository identity differs from its source");
    if (expectedIdentity && !sameIdentity(host.identity, expectedIdentity)) throw oatsError("source-identity-change", "repository hosting identity changed");
    const identityKey = canonicalJson(host.identity);
    if (host.defaultBranch !== undefined && !defaults.has(identityKey)) defaults.set(identityKey, { selector: host.defaultBranch });
    return host;
  };
  const dataFor = (observation) => {
    active(); const data = handles.get(observation);
    if (!data) throw oatsError("invalid-source", "repository observation was not issued by this transaction");
    return data;
  };
  const list = (data, paths, recursive) => {
    const args = ["-C", data.directory, "ls-tree", "-z", "--full-tree", ...(recursive ? ["-r"] : []), data.commit];
    if (!paths.includes(".")) args.push("--", ...paths);
    const rows = decodeUtf8(git(args, 16 * 1024 * 1024)).split("\0").filter(Boolean);
    if ((entriesRead += rows.length) > maxEntries) throw oatsError("resource-limit", "repository entry budget exceeded");
    return rows.map((row) => {
      const at = row.indexOf("\t"), header = /^([0-7]{6}) (blob|tree|commit) ([a-f0-9]{40})$/.exec(row.slice(0, at)), path = row.slice(at + 1);
      if (!header || at < 0) throw oatsError("invalid-source", "repository returned a malformed tree entry");
      portablePath(path);
      if (path.split("/").some((part) => part.toLowerCase() === ".git")) throw oatsError("resource-not-contained", "source projection cannot include Git administrative files");
      if (!paths.some((root) => root === "." || path === root || path.startsWith(`${root}/`))) throw oatsError("resource-not-contained", "repository returned an unselected source path");
      return { mode: header[1], type: header[2], object: header[3], path };
    });
  };
  const blob = (data, entry, limit) => {
    if (entry.type !== "blob") throw oatsError("source-incomplete", "selected source contains an unsupported submodule or object kind");
    const key = `${data.directory}:${entry.object}`;
    if (!blobs.has(key)) {
      const sizeText = decodeUtf8(git(["-C", data.directory, "cat-file", "-s", entry.object], 1024)).trim();
      const size = Number(sizeText);
      if (!/^[0-9]+$/.test(sizeText) || !Number.isSafeInteger(size) || size > limit || readBytes + size > maxBytes) throw oatsError("resource-limit", "repository content byte budget exceeded");
      const bytes = git(["-C", data.directory, "cat-file", "blob", entry.object], size + 1024);
      if (bytes.length !== size) throw oatsError("integrity-drift", "repository blob changed during reading");
      readBytes += size; blobs.set(key, bytes);
    }
    const bytes = blobs.get(key);
    if (bytes.length > limit) throw oatsError("resource-limit", "repository descriptor byte limit exceeded");
    return Buffer.from(bytes);
  };

  return {
    identify(source, { expectedIdentity } = {}) {
      active();
      if (expectedIdentity !== undefined) validateRepositoryIdentity(expectedIdentity);
      const repository = parseRepositorySource(source), host = hostFor(repository, expectedIdentity);
      return Object.freeze({ identity: host.identity, source: repository.normalized, accessContextKey });
    },
    observe(source, { revision, origin, expectedIdentity } = {}) {
      active(); validateOrigin(origin);
      if (expectedIdentity !== undefined) validateRepositoryIdentity(expectedIdentity);
      // Local working snapshots use path: custody, not portable file: identities.
      // allowLocalGit only enables an explicit host/test transport mapping.
      const repository = parseRepositorySource(source);
      if (revision !== undefined) revisionSelector(revision);
      const key = canonicalJson({ source: repository.normalized, selector: revision ?? null });
      if (!memo.has(key)) {
        if (memo.size >= maxRepositories * 4) throw oatsError("resource-limit", "repository request count exceeded");
        // Cache failures too: a single transaction never re-observes a moving
        // request because its first attempt was inconvenient or inaccessible.
        const slot = {}; memo.set(key, slot);
        try {
          const host = hostFor(repository, expectedIdentity), identityKey = canonicalJson(host.identity);
          let selector = revision ?? defaults.get(identityKey)?.selector, exactHead = revision === undefined ? defaults.get(identityKey)?.exactHead : undefined;
          if (selector === undefined) {
            const head = decodeUtf8(git(["ls-remote", "--symref", "--", repository.url, "HEAD"], 64 * 1024));
            const symbolic = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(head), resolved = /^([a-f0-9]{40})\tHEAD$/m.exec(head);
            if (!symbolic || !resolved) throw oatsError("source-identity-unresolved", "repository default branch is unavailable");
            selector = symbolic[1]; exactHead = resolved[1];
            defaults.set(identityKey, { selector, exactHead });
          }
          revisionSelector(selector);
          const snapshotKey = canonicalJson({ identity: host.identity, selector });
          if (snapshots.has(snapshotKey)) {
            const existing = snapshots.get(snapshotKey);
            if (existing.error) throw existing.error;
            slot.data = existing.data;
          } else {
            if (snapshots.size >= maxRepositories) throw oatsError("resource-limit", "repository snapshot count exceeded");
            const directory = join(root, `repository-${snapshots.size}.git`);
            snapshots.set(snapshotKey, slot);
            // One selected shallow snapshot, not all repository branches/history.
            // Servers may decline filtering; budgets below bound selected reads,
            // not the transport's pack size. Git/host resource limits still apply.
            git(["init", "--quiet", "--bare", directory]);
            git(["-C", directory, "remote", "add", "origin", repository.url]);
            git(["-C", directory, "fetch", "--quiet", "--depth=1", "--filter=blob:none", "--no-tags", "--", "origin", exactHead ?? selector], 4 * 1024 * 1024);
            const commit = decodeUtf8(git(["-C", directory, "rev-parse", "--verify", "--quiet", "--end-of-options", "FETCH_HEAD^{commit}"], 1024)).trim();
            if (exactHead && commit !== exactHead) throw oatsError("integrity-drift", "fetched default branch differs from its exact observation");
            if (!/^[a-f0-9]{40}$/.test(commit)) throw oatsError("source-identity-unresolved", "repository selector did not resolve to an exact commit");
            slot.data = { directory, identity: Object.freeze({ ...host.identity }), selector, commit };
          }
        } catch (error) { slot.error = error; throw error; }
      }
      const slot = memo.get(key);
      if (slot.error) throw slot.error;
      const data = { ...slot.data, remote: repository.normalized };
      if (expectedIdentity && !sameIdentity(data.identity, expectedIdentity)) throw oatsError("source-identity-change", "cached repository identity differs from the request");
      const observation = Object.freeze({ schemaVersion: 1, source: Object.freeze({ identity: data.identity, remote: data.remote,
        selector: data.selector, commit: data.commit, provenance: freezeJson([structuredClone(origin)]) }), accessContextKey });
      handles.set(observation, data);
      return observation;
    },
    readFile(observation, path, { optional = false } = {}) {
      portablePath(path); const data = dataFor(observation), rows = list(data, [path], false);
      if (!rows.length && optional) return null;
      if (rows.length !== 1 || rows[0].path !== path || !["100644", "100755"].includes(rows[0].mode)) throw oatsError("export-not-found", "repository descriptor is absent or is not a regular file");
      const bytes = blob(data, rows[0], 1024 * 1024);
      return { bytes, origin: { kind: "source", source: data.remote, revision: data.commit, path, integrity: bytesIntegrity(bytes) } };
    },
    materialize(observation, roots, destination) {
      const data = dataFor(observation);
      canonicalJson(roots);
      if (!Array.isArray(roots) || !roots.length || roots.length > 1024 || new Set(roots).size !== roots.length) throw oatsError("invalid-source", "source projection needs a bounded unique root set");
      roots.forEach((path) => portablePath(path, { allowRoot: true }));
      if (typeof destination !== "string" || !isAbsolute(destination)) throw oatsError("invalid-source", "source projection destination must be explicit");
      const rows = list(data, roots, true);
      for (const path of roots) if (!rows.some((row) => path === "." || row.path === path || row.path.startsWith(`${path}/`))) throw oatsError("export-not-found", "required source projection root is absent");
      for (const entry of rows) validateProjectionPath(entry.path);
      const expected = new Map(rows.map((entry) => [entry.path, entry]));
      if (expected.size !== rows.length) throw oatsError("invalid-source", "source tree has duplicate paths");
      mkdirSync(destination, { mode: 0o700 }); // Never merge into an existing tree.
      const boundary = realpathSync(destination), directories = new Set([""]);
      const targetFor = (path) => {
        const parts = path.split("/");
        let current = boundary, relative = "";
        for (const part of parts.slice(0, -1)) {
          relative = relative ? `${relative}/${part}` : part;
          current = join(current, part);
          let existed = false;
          try { mkdirSync(current, { mode: 0o700 }); }
          catch (error) { if (error.code !== "EEXIST") throw error; existed = true; }
          // No recursive mkdir: it would follow a previously created source link
          // under a case/normalization alias BEFORE final containment validation.
          if (!lstatSync(current).isDirectory() || (existed && !directories.has(relative))) {
            throw oatsError("artifact-not-contained", "projection parent is a link or aliases another source path");
          }
          directories.add(relative);
        }
        return join(current, parts.at(-1));
      };
      try {
        for (const entry of rows) {
          const target = targetFor(entry.path), bytes = blob(data, entry, maxBytes);
          if (entry.mode === "120000") symlinkSync(decodeUtf8(bytes, "source link target"), target);
          else if (["100644", "100755"].includes(entry.mode)) {
            const mode = entry.mode === "100755" ? 0o755 : 0o644;
            writeFileSync(target, bytes, { flag: "wx", mode }); chmodSync(target, mode);
            if ((lstatSync(target).mode & 0o100) !== (mode & 0o100)) throw oatsError("source-incomplete", "host filesystem cannot retain the source owner-execute flag");
          } else throw oatsError("source-incomplete", "source object mode cannot be retained");
        }
        // Require exact round-trip names as well, rather than certifying a host's
        // silently normalized spelling or an unenumerated alternate stream.
        const inspect = (directory, prefix = "") => {
          for (const raw of readdirSync(directory, { encoding: "buffer" })) {
            const name = decodeUtf8(raw), path = prefix ? `${prefix}/${name}` : name, target = join(directory, name), stat = lstatSync(target);
            if (stat.isDirectory()) inspect(target, path);
            else {
              const entry = expected.get(path);
              if (!entry || (entry.mode === "120000" ? !stat.isSymbolicLink() : !stat.isFile())) throw oatsError("source-incomplete", "host projection paths differ from the Git source");
              expected.delete(path);
            }
          }
        };
        inspect(boundary);
        if (expected.size) throw oatsError("source-incomplete", "host filesystem did not retain every source path");
        assertRetainableTree(boundary);
        return { directory: destination, roots: [...roots], observation };
      } catch (error) { error.stagingPath = destination; throw error; }
    },
    close() {
      if (closed) return;
      const current = lstatSync(root);
      if (!current.isDirectory() || current.dev !== owned.dev || current.ino !== owned.ino) throw oatsError("source-unavailable", "repository transaction cleanup lost ownership");
      closed = true;
      rmSync(root, { recursive: true });
    },
  };
}
