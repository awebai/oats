/**
 * OATS packages — versions, lock v3, approval (workspace model v2).
 *
 * Contract: docs/design/2026-09-23-workspace-module-contracts.md §4.
 * Decision: agents/oats-expert/soul/knowledge/decisions/workspace-model-v2.md.
 *
 * A package is a place to fetch from WITH a version attached. Nothing is
 * installed: `resolvePackages` turns each `workspace.packages` entry into an
 * exact (commit, integrity) pair recorded in `oats-lock.json`
 * (lockfileVersion 3), and the one-time executable approval per version lives
 * next to the commit it approved. A moved tag (same version string, different
 * commit) fails integrity and asks again.
 *
 * This module is synchronous except `resolvePackages`, shells out to nothing,
 * and depends only on `node:*`. Remote access is INJECTED (`remote` option) so
 * callers pass `lib/remote.mjs` and tests pass an in-memory fake.
 *
 * Lock v3 shape (exactly as the contract):
 *
 *   {
 *     lockfileVersion: 3,
 *     packages: {
 *       <id>: {
 *         source:       "catalog:<id>" | "git:<key>@<ref>",
 *         url:          "<repo url the package was read from>",   // repo identity: resolve/materialize need no catalog
 *         path:         "<dir of oats-package.json inside the repo>",
 *         version:      "<version string, no leading v>",
 *         commit:       "<full 40-hex OID>",
 *         integrity:    "sha256-<hex>",          // contentDigest of the package tree at <path>
 *         capabilities: ["<cap name>", …],        // sorted
 *         approved:     { executables: "sha256-<hex>", at: "<ISO-8601 UTC>" } | null
 *       }
 *     }
 *   }
 *
 * `packageTree` (input of `executablesDigest`):
 *
 *   { manifests: [ { name: "<cap name>", manifest: <parsed oats.json>, files: Map<relpath, Buffer> } ] }
 *
 *   `files` holds the bytes of the capability directory, keyed by POSIX
 *   relative path from that directory (e.g. "bin/tool.mjs"). Each
 *   `manifest.commands[<cmd>]` value is "<relpath> [args…]"; the FIRST token is
 *   the executable target whose bytes are digested. Only command targets are
 *   digested — skills, injects and other files are covered by `integrity`.
 *
 * Deprecated shims: every name the 0.24 kernel still imports from this module
 * is exported below as a thin function throwing E_REMOVED so nothing breaks at
 * import time; callers are deleted in the next phase.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { oatsError as baseOatsError } from "./errors.mjs";
import * as defaultRemote from "./remote.mjs";

export const LOCK_FILE = "oats-lock.json";
export const LOCK_VERSION = 3;
export const PACKAGE_MANIFEST = "oats-package.json";
export const CAPABILITY_MANIFEST = "oats.json";
/** Default location of `oats-package.json` inside a package repo when the
 * workspace value carries no path (the catalog supplies one for catalog ids). */
export const DEFAULT_PACKAGE_PATH = "oats-package";

const OID_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256-[0-9a-f]{64}$/;
const CONTRACT_DOC = "docs/design/2026-09-23-workspace-module-contracts.md";

/** `oatsError` with details attached as BOTH `e.provenance` (today's field) and
 * `e.details` (the contract's name) so callers can read either. */
function oatsError(code, message, details) {
  const e = baseOatsError(code, message, details);
  if (details !== undefined) e.details = details;
  return e;
}

// ---------- generic file-safety helpers (kept: used by bin/oats.mjs outside package code) ----------

const isInside = (base, target) => target === base || target.startsWith(base + sep);

/** Refuse to write below `scopeDir` through any symlinked path component of
 * `leafDir`. Components that do not exist yet are fine — this run creates them.
 * Re-run immediately before each write rather than cached. */
export function assertNoSymlinkedParents(scopeDir, leafDir, what) {
  const base = resolve(scopeDir);
  const leaf = resolve(leafDir);
  if (!isInside(base, leaf)) throw oatsError("E_ADOPTED_PATH_UNSAFE", `${what} resolves outside the scope: ${leaf}`, { scope: base, path: leaf });
  const rel = relative(base, leaf);
  let cur = base;
  for (const part of rel ? rel.split(sep) : []) {
    cur = join(cur, part);
    let st;
    try { st = lstatSync(cur); } catch { return; }
    if (st.isSymbolicLink()) {
      throw oatsError("E_ADOPTED_PATH_UNSAFE", `${what} passes through a symlink at ${cur} — OATS never writes through a link it did not create; remove or replace that entry`, { path: cur });
    }
    if (!st.isDirectory()) throw oatsError("E_ADOPTED_PATH_UNSAFE", `${what} passes through ${cur}, which is not a directory`, { path: cur });
  }
}

/** Sibling temp + rename: replaces the directory entry itself, never writing
 * THROUGH a pre-planted symlink at `file`. */
export function writeFileAtomic(file, contents) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${basename(file)}.oats-tmp-${process.pid}`);
  try {
    writeFileSync(tmp, contents);
    renameSync(tmp, file);
  } finally { rmSync(tmp, { force: true }); }
}

/** Exact copy via `writeFileAtomic` (copyFileSync would follow a destination symlink). */
export function copyFileAtomic(from, to) {
  writeFileAtomic(to, readFileSync(from));
}

// ---------- lock v3 ----------

const emptyLock = () => ({ lockfileVersion: LOCK_VERSION, packages: {} });
const plainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function sortedObject(obj) {
  const out = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k];
  return out;
}

/** Structural validation of a lock v3 object. Throws E_LOCK_SCHEMA naming the
 * offending path; a v1/v2 lock names its version and points at the rebuild. */
export function validateLock(lock, { file } = {}) {
  const where = file ? ` (${file})` : "";
  if (!plainObject(lock)) throw oatsError("E_LOCK_SCHEMA", `oats-lock.json must be a JSON object${where}`, { file, path: "/" });
  const v = lock.lockfileVersion;
  if (v !== LOCK_VERSION) {
    const shown = v === undefined ? "missing" : JSON.stringify(v);
    throw oatsError("E_LOCK_SCHEMA",
      `oats-lock.json lockfileVersion ${shown} is not supported: this kernel reads lockfileVersion ${LOCK_VERSION} only (workspace model v2; no migration — delete the lock and run \`oats sync\`)${where}`,
      { file, path: "/lockfileVersion", found: v, expected: LOCK_VERSION });
  }
  if (!plainObject(lock.packages)) throw oatsError("E_LOCK_SCHEMA", `oats-lock.json "packages" must be an object${where}`, { file, path: "/packages" });
  for (const [id, entry] of Object.entries(lock.packages)) {
    const at = `/packages/${id}`;
    const bad = (field, why) => oatsError("E_LOCK_SCHEMA", `oats-lock.json ${at}/${field}: ${why}${where}`, { file, path: `${at}/${field}`, id });
    if (!plainObject(entry)) throw oatsError("E_LOCK_SCHEMA", `oats-lock.json ${at} must be an object${where}`, { file, path: at, id });
    if (typeof entry.source !== "string" || !/^(catalog:|git:)/.test(entry.source)) throw bad("source", 'must be "catalog:<id>" or "git:<key>@<ref>"');
    if (entry.url !== undefined && (typeof entry.url !== "string" || !entry.url)) throw bad("url", "must be a non-empty repo url when present");
    if (typeof entry.path !== "string" || !entry.path) throw bad("path", "must be a non-empty string");
    if (typeof entry.version !== "string" || !entry.version) throw bad("version", "must be a non-empty string");
    if (typeof entry.commit !== "string" || !OID_RE.test(entry.commit)) throw bad("commit", "must be a full 40-hex OID");
    if (typeof entry.integrity !== "string" || !DIGEST_RE.test(entry.integrity)) throw bad("integrity", "must be sha256-<hex>");
    if (!Array.isArray(entry.capabilities) || entry.capabilities.some((c) => typeof c !== "string" || !c)) throw bad("capabilities", "must be an array of capability names");
    if (entry.approved !== null) {
      if (!plainObject(entry.approved)) throw bad("approved", "must be null or { executables, at }");
      if (typeof entry.approved.executables !== "string" || !DIGEST_RE.test(entry.approved.executables)) throw bad("approved/executables", "must be sha256-<hex>");
      if (typeof entry.approved.at !== "string" || Number.isNaN(Date.parse(entry.approved.at))) throw bad("approved/at", "must be an ISO-8601 timestamp");
    }
  }
  return lock;
}

/** Read `<dir>/oats-lock.json`. A missing file is an empty v3 lock; anything
 * else is validated (E_LOCK_SCHEMA). Returns a fresh object every call. */
export function readLock(dir) {
  const file = join(resolve(dir), LOCK_FILE);
  if (!existsSync(file)) return emptyLock();
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch (e) {
    throw oatsError("E_LOCK_SCHEMA", `oats-lock.json is not valid JSON (${file}): ${e.message}`, { file, path: "/" });
  }
  return validateLock(parsed, { file });
}

/** Canonical lock text: sorted package ids, sorted capability names, 2-space indent, trailing newline. */
export function canonicalLock(lock) {
  validateLock(lock);
  const packages = {};
  for (const id of Object.keys(lock.packages).sort()) {
    const e = lock.packages[id];
    packages[id] = {
      source: e.source, ...(typeof e.url === "string" && e.url ? { url: e.url } : {}), path: e.path, version: e.version, commit: e.commit, integrity: e.integrity,
      capabilities: [...e.capabilities].sort(),
      approved: e.approved ? { executables: e.approved.executables, at: e.approved.at } : null,
    };
  }
  return { lockfileVersion: LOCK_VERSION, packages };
}

/** Write `<dir>/oats-lock.json` atomically in canonical form. Returns the file path. */
export function writeLock(dir, lock) {
  const file = join(resolve(dir), LOCK_FILE);
  writeFileAtomic(file, JSON.stringify(canonicalLock(lock), null, 2) + "\n");
  return file;
}

// ---------- workspace `packages:` values ----------

/** Strip a single leading "v" from a semver-ish tag ("v2.1.3" → "2.1.3"). */
const versionOf = (text) => text.replace(/^v(?=\d)/, "");

/** The two — and only two — `packages:` value forms (contract §2, non-collapse rule):
 *   catalog version:  v2.1.3 | 2.1.3 | v1.0.0-rc.1        (resolves through the official catalog)
 *   direct git ref:   git:<repo>@<ref>                    (<repo> = any ref lib/remote.mjs understands;
 *                                                          <ref> = tag/branch name or full OID)
 * Shared by lib/workspace.mjs (schema validation) and resolvePackages. */
export const CATALOG_VERSION_RE = /^v?\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/;
const REF_NAME_RE = /^(?![-/.])(?!.*\.\.)(?!.*[\s~^:?*[\\\x00-\x1f\x7f])(?!.*@\{)(?!.*\/\.)(?!.*\.lock(?:\/|$))(?!.*\/\/)[^/]+(?:\/[^/]+)*(?<!\/|\.)$/;

/**
 * Classify one `packages:` value WITHOUT touching the catalog or the network.
 * → { kind: "catalog", version } | { kind: "git", repo, at } | { problem: "<why>" }
 * `repo` is the remainder after `git:` when that remainder is itself a full ref
 * (`/abs/bare.git`, `file:///…`, `https://…`, `git@host:…`), else `git:<host>/<path>` as written.
 */
export function classifyPackageValue(value) {
  if (typeof value !== "string" || !value.trim()) return { problem: "must be a non-empty string" };
  const text = value.trim();
  if (text !== value) return { problem: "must not carry surrounding whitespace" };
  if (text.startsWith("git:")) {
    const atIdx = text.lastIndexOf("@");
    if (atIdx <= "git:".length) return { problem: "a git package must be written git:<repo>@<ref> (no @<ref> found)" };
    const rest = text.slice("git:".length, atIdx);
    const at = text.slice(atIdx + 1);
    if (!at) return { problem: "a git package must be written git:<repo>@<ref> (empty <ref>)" };
    if (rest.includes("@") && !/^git@[^@/:]+:/.test(rest)) return { problem: "a git package carries exactly one @<ref> (a repo ref has no @ except the git@host: ssh form)" };
    if (!OID_RE.test(at) && !REF_NAME_RE.test(at)) return { problem: `${JSON.stringify(at)} is not a tag/branch name or full OID` };
    if (!rest) return { problem: "a git package must be written git:<repo>@<ref> (empty <repo>)" };
    // `git:` + an already-complete ref form: hand the remainder to parseRepoRef unchanged.
    const repo = /^(?:\/|file:\/\/|https?:\/\/|git@)/.test(rest) ? rest : `git:${rest}`;
    return { kind: "git", repo, at };
  }
  if (/^(?:https?:\/\/|file:\/\/|git@|\/)/.test(text) || text.includes("@") || text.includes("/")) {
    return { problem: "a package outside the catalog must be written git:<repo>@<ref>" };
  }
  if (!CATALOG_VERSION_RE.test(text)) return { problem: `${JSON.stringify(text)} is neither a version (v2.1.3) nor git:<repo>@<ref>` };
  return { kind: "catalog", version: versionOf(text) };
}

/** Split a catalog ref into a prefix and its version tail:
 * "v2.1.3" → { prefix: "", vee: true } ; "oats-framework/v1.1.3" → { prefix: "oats-framework/", vee: true }. */
function refPattern(catalogRef) {
  const m = /^(.*?)(v?)(\d[^/]*)$/.exec(catalogRef);
  if (!m) return null;
  return { prefix: m[1], vee: m[2] === "v" };
}

/** Recompose a catalog ref for a requested version, keeping the catalog's tag convention. */
function catalogRefFor(entry, requested) {
  const pat = refPattern(entry.ref || "");
  const bare = versionOf(requested);
  if (!pat) return requested; // catalog ref carries no version tail — the request is the ref
  return `${pat.prefix}${pat.vee ? "v" : ""}${bare}`;
}

/** Accept either the file shape ({ policy, packages: {…} }) or a bare id → entry map. */
function catalogPackages(catalog) {
  if (!plainObject(catalog)) return {};
  if (plainObject(catalog.packages) && !("url" in catalog.packages)) return catalog.packages;
  return catalog;
}

/** Interpret one `workspace.packages` value for package `id`.
 *  - "<version>"            → catalog lookup; ref recomposed from the catalog's tag convention
 *  - "git:<repo>@<ref>"     → direct ref; `<repo>` is any repo ref `lib/remote.mjs` understands
 *                             (git:host/path, https://…, git@host:…, /abs/bare.git, file:///…)
 * Nothing else is accepted (E_WORKSPACE_SCHEMA for a malformed value, E_REPO_REF for a bad git form).
 * → { kind: "catalog"|"git", remoteRef, at, path } */
export function parsePackageRequest(id, value, catalog) {
  const c = classifyPackageValue(value);
  if (c.problem) {
    const code = typeof value === "string" && value.trim().startsWith("git:") ? "E_REPO_REF" : "E_WORKSPACE_SCHEMA";
    throw oatsError(code, `packages.${id}: ${c.problem}, got ${JSON.stringify(value)}`, { id, value, path: `/packages/${id}`, problems: [c.problem] });
  }
  if (c.kind === "git") return { kind: "git", remoteRef: c.repo, at: c.at, path: DEFAULT_PACKAGE_PATH };
  const text = value.trim();
  const entry = catalogPackages(catalog)[id];
  if (!plainObject(entry) || typeof entry.url !== "string") {
    throw oatsError("E_PACKAGE_MISSING", `packages.${id}: ${JSON.stringify(text)} is a catalog version but the catalog has no package ${JSON.stringify(id)} — use git:<repo>@<ref> for a package outside the catalog`, { id, value: text });
  }
  return { kind: "catalog", remoteRef: entry.url, at: catalogRefFor(entry, text), path: typeof entry.path === "string" && entry.path ? entry.path : DEFAULT_PACKAGE_PATH };
}

// ---------- reading a package over the injected remote ----------

const pjoin = (...parts) => posix.normalize(posix.join(...parts));

const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function assertRelPath(what, rel, details) {
  if (typeof rel !== "string" || !rel || isAbsolute(rel) || /^[\\/]/.test(rel) || /[\x00]/.test(rel) || rel.split(/[\\/]/).some((p) => p === ".." || /^[A-Za-z]:$/.test(p))) {
    throw oatsError("E_PACKAGE_MANIFEST", `${what} must be a relative path inside the package, got ${JSON.stringify(rel)}`, details);
  }
}

/** Read + parse a JSON file of the package. A missing file is E_PACKAGE_MANIFEST (the
 * package is malformed), never a leaked E_REMOTE_PATH_MISSING. */
async function readJson(remote, remoteRef, commit, path, what, details) {
  let bytes;
  try { ({ bytes } = await remote.readRemoteFile(remoteRef, commit, path)); } catch (e) {
    if (e?.code === "E_REMOTE_PATH_MISSING") throw oatsError("E_PACKAGE_MANIFEST", `${what} is missing: no ${path} in ${typeof remoteRef === "string" ? remoteRef : remoteRef?.key}@${String(commit).slice(0, 12)}`, { ...details, path, cause: e.code });
    throw e;
  }
  try { return JSON.parse(Buffer.from(bytes).toString("utf8")); } catch (e) {
    throw oatsError("E_PACKAGE_MANIFEST", `${what} at ${path} is not valid JSON: ${e.message}`, { ...details, path });
  }
}

/** Read `oats-package.json` and every capability manifest it lists.
 * → { manifest, capabilities: [{ name, dir, manifest }] } (sorted by name, codepoint order).
 * Two capability dirs declaring the same name → E_PACKAGE_MANIFEST { duplicate }. */
export async function readPackageManifests(remote, remoteRef, commit, path, details = {}) {
  const manifestPath = pjoin(path, PACKAGE_MANIFEST);
  const manifest = await readJson(remote, remoteRef, commit, manifestPath, "package manifest", details);
  if (!plainObject(manifest) || typeof manifest.package !== "string" || !Array.isArray(manifest.capabilities)) {
    throw oatsError("E_PACKAGE_MANIFEST", `package manifest at ${manifestPath} must declare "package" and "capabilities"`, { ...details, path: manifestPath });
  }
  const capabilities = [];
  const seen = new Map();
  for (const rel of manifest.capabilities) {
    assertRelPath(`${manifestPath} capabilities[]`, rel, { ...details, path: manifestPath });
    const dir = pjoin(path, rel);
    const capManifest = await readJson(remote, remoteRef, commit, pjoin(dir, CAPABILITY_MANIFEST), "capability manifest", details);
    if (!plainObject(capManifest) || typeof capManifest.capability !== "string" || !capManifest.capability) {
      throw oatsError("E_PACKAGE_MANIFEST", `capability manifest at ${pjoin(dir, CAPABILITY_MANIFEST)} must declare "capability"`, { ...details, path: dir });
    }
    if (seen.has(capManifest.capability)) {
      throw oatsError("E_PACKAGE_MANIFEST", `package ${manifest.package} declares capability ${JSON.stringify(capManifest.capability)} twice (${seen.get(capManifest.capability)} and ${dir})`, { ...details, path: dir, duplicate: capManifest.capability, other: seen.get(capManifest.capability) });
    }
    seen.set(capManifest.capability, dir);
    capabilities.push({ name: capManifest.capability, dir, manifest: capManifest });
  }
  capabilities.sort((a, b) => byCodepoint(a.name, b.name));
  return { manifest, capabilities };
}

/** Content digest of the package tree at `path`: the digest `fetchRemoteTree` reports for a
 * copy into a scratch directory (contract §1: `contentDigest(dir)` is the local-directory form;
 * the remote has no digest-without-copy primitive yet — see the deferred note in the review). */
async function packageIntegrity(remote, remoteRef, commit, path) {
  if (typeof remote.fetchRemoteTree !== "function") {
    throw oatsError("E_PACKAGE_INTEGRITY", "remote must provide fetchRemoteTree() to compute a package's integrity", { path: "/remote" });
  }
  const scratch = mkdtempSync(join(tmpdir(), "oats-pkg-"));
  const dest = join(scratch, "tree");
  try {
    const { digest } = await remote.fetchRemoteTree(remoteRef, commit, path, dest, { allowSymlinks: defaultRemote.OATS_ALIAS_SYMLINK });
    return digest;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

/** Depth bound for reading a capability directory: deep enough for any real layout. */
export const PACKAGE_TREE_DEPTH = 64;

/** Build a `packageTree` (see module header) for `executablesDigest` from the remote.
 * Reads every blob under each capability directory. */
export async function readPackageTree(remote, remoteRef, commit, path, { depth = PACKAGE_TREE_DEPTH, remoteOptions } = {}) {
  remote = bindRemote(remote, remoteOptions);
  const { capabilities } = await readPackageManifests(remote, remoteRef, commit, path);
  const manifests = [];
  for (const cap of capabilities) {
    const listing = await remote.listRemoteTree(remoteRef, commit, cap.dir, { depth });
    const files = new Map();
    for (const item of listing) {
      if (item.type !== "blob") continue;
      const { bytes } = await remote.readRemoteFile(remoteRef, commit, pjoin(cap.dir, item.path));
      files.set(item.path, Buffer.from(bytes));
    }
    manifests.push({ name: cap.name, manifest: cap.manifest, files });
  }
  return { manifests };
}

// ---------- resolvePackages ----------

function assertDigest(what, value, details) {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) throw oatsError("E_PACKAGE_INTEGRITY", `${what} is not a sha256-<hex> digest: ${JSON.stringify(value)}`, details);
  return value;
}

/** Bind `remoteOptions` (cacheDir, exec, …) into every call of a contract-§1 remote. */
export function bindRemote(remote, remoteOptions) {
  if (!remoteOptions || Object.keys(remoteOptions).length === 0) return remote;
  const bound = { ...remote };
  for (const name of ["observeRemote", "readRemoteFile", "listRemoteTree", "fetchRemoteTree"]) {
    if (typeof remote[name] !== "function") continue;
    bound[name] = (...args) => {
      const arity = { observeRemote: 1, readRemoteFile: 3, listRemoteTree: 3, fetchRemoteTree: 4 }[name];
      const opts = { ...(args[arity] || {}), ...remoteOptions };
      return remote[name](...args.slice(0, arity), opts);
    };
  }
  return bound;
}

/**
 * Resolve every `workspace.packages` entry to an exact commit + integrity and
 * merge into the lock (immutably — the input lock is never mutated).
 *
 * options.catalog: package-catalog.json (file shape or its `packages` map)
 * options.lock:    current lock (v3) — defaults to an empty lock
 * options.remote:  { observeRemote, readRemoteFile, listRemoteTree, fetchRemoteTree } — defaults to
 *                  lib/remote.mjs; tests pass an in-memory fake. options.remoteOptions (cacheDir, exec, …)
 *                  is threaded into every remote call.
 *
 * → { lock, changes: [{ id, from, to, commit, approvalNeeded }] }
 *   - `from` is the previously locked version or null; `to` is the resolved version
 *     (null when the package was removed from the workspace and dropped from the lock).
 *   - `approvalNeeded` = the entry's `approved` is null.
 *   - A locked entry whose version string is unchanged but whose commit or
 *     integrity moved → E_PACKAGE_INTEGRITY { id, version, locked, observed }.
 *   - Unchanged entries keep their approval ONLY when the recorded executables digest still
 *     matches the tree (else E_PACKAGE_UNAPPROVED); a new version starts unapproved.
 *   - A value resolving to a BRANCH → E_PACKAGE_INTEGRITY { why: "branch" }: versions are immutable.
 */
export async function resolvePackages(workspace, { catalog = {}, lock = emptyLock(), remote = defaultRemote, remoteOptions } = {}) {
  if (!remote || typeof remote.observeRemote !== "function" || typeof remote.readRemoteFile !== "function") {
    throw new TypeError("resolvePackages: remote must provide observeRemote()/readRemoteFile() (module contract §1)");
  }
  remote = bindRemote(remote, remoteOptions);
  const previous = validateLock(lock);
  const requests = plainObject(workspace?.packages) ? workspace.packages : {};
  const ids = Object.keys(requests).sort();
  const nextPackages = {};
  const changes = [];

  for (const id of ids) {
    const req = parsePackageRequest(id, requests[id], catalog);
    const details = { id, value: requests[id] };
    const obs = await remote.observeRemote(req.remoteRef, { at: req.at });
    if (!obs || typeof obs.commit !== "string" || !OID_RE.test(obs.commit)) {
      throw oatsError("E_PACKAGE_INTEGRITY", `packages.${id}: remote did not yield a full commit OID for ${req.remoteRef}@${req.at}`, { ...details, observed: obs?.commit });
    }
    // A package version must be immutable: a branch is a moving target and is refused up front
    // (a tag that later moves is caught below as E_PACKAGE_INTEGRITY).
    if (typeof obs.ref === "string" && /^refs\/heads\//.test(obs.ref)) {
      throw oatsError("E_PACKAGE_INTEGRITY", `packages.${id}: ${req.at} is a branch (${obs.ref}), not a version — pin a tag or a full commit OID`, { ...details, why: "branch", ref: obs.ref, commit: obs.commit });
    }
    const source = req.kind === "catalog" ? `catalog:${id}` : `git:${obs.key}@${req.at}`;
    const version = req.kind === "catalog" ? versionOf(requests[id].trim()) : versionOf(req.at);
    const old = previous.packages[id] || null;

    // Same version + same source + same path as locked: the lock must still describe reality.
    if (old && old.version === version && old.source === source && old.path === req.path) {
      if (old.commit !== obs.commit) {
        throw oatsError("E_PACKAGE_INTEGRITY",
          `packages.${id} ${version} is locked at ${old.commit} but ${source} now resolves to ${obs.commit} — the tag moved; a version string must change when its content does`,
          { ...details, version, locked: { commit: old.commit, integrity: old.integrity }, observed: { commit: obs.commit } });
      }
      const integrity = assertDigest(`packages.${id} integrity`, await packageIntegrity(remote, req.remoteRef, obs.commit, old.path), details);
      if (integrity !== old.integrity) {
        throw oatsError("E_PACKAGE_INTEGRITY",
          `packages.${id} ${version} @ ${obs.commit}: content digest ${integrity} does not match the locked ${old.integrity}`,
          { ...details, version, locked: { commit: old.commit, integrity: old.integrity }, observed: { commit: obs.commit, integrity } });
      }
      // A recorded approval must describe THESE executables, not merely any well-formed digest.
      if (old.approved) {
        const executables = executablesDigest(await readPackageTree(remote, req.remoteRef, obs.commit, old.path));
        if (executables !== old.approved.executables) {
          throw oatsError("E_PACKAGE_UNAPPROVED",
            `packages.${id} ${version}: the recorded approval ${old.approved.executables} does not match the package's executables ${executables} — approve again`,
            { ...details, version, commit: obs.commit, approved: old.approved, executables });
        }
      }
      nextPackages[id] = clone(old);
      continue;
    }

    const { capabilities } = await readPackageManifests(remote, req.remoteRef, obs.commit, req.path, details);
    const integrity = assertDigest(`packages.${id} integrity`, await packageIntegrity(remote, req.remoteRef, obs.commit, req.path), details);
    nextPackages[id] = {
      source, url: obs.url, path: req.path, version, commit: obs.commit, integrity,
      capabilities: capabilities.map((c) => c.name).sort(),
      approved: null,
    };
    changes.push({ id, from: old ? old.version : null, to: version, commit: obs.commit, approvalNeeded: true });
  }

  for (const id of Object.keys(previous.packages).sort()) {
    if (!(id in requests)) changes.push({ id, from: previous.packages[id].version, to: null, commit: null, approvalNeeded: false });
  }

  return { lock: { lockfileVersion: LOCK_VERSION, packages: sortedObject(nextPackages) }, changes };
}

// ---------- executables digest + approval ----------

/** First token of a `commands` value is the executable target (e.g. "bin/x.mjs cut" → "bin/x.mjs"). */
export function commandTarget(specification) {
  return String(specification).trim().split(/\s+/)[0] || "";
}

/** Every executable a manifest can make the kernel run: `commands.*` targets AND `hooks.*.command`
 * targets (hooks run automatically at spawn/retire — the executables an approver most needs to see).
 * → [{ kind: "command"|"hook", name, target }] in canonical order. */
export function manifestExecutables(manifest) {
  const out = [];
  const commands = plainObject(manifest?.commands) ? manifest.commands : {};
  for (const cmd of Object.keys(commands).sort(byCodepoint)) out.push({ kind: "command", name: cmd, target: commandTarget(commands[cmd]), spec: commands[cmd] });
  const hooks = plainObject(manifest?.hooks) ? manifest.hooks : {};
  for (const hook of Object.keys(hooks).sort(byCodepoint)) {
    // A hook is { command, ... } (schema: required command) or a bare string. A hook object WITHOUT
    // `command` is malformed — it enters the list with spec undefined so executablesDigest refuses it
    // (E_PACKAGE_MANIFEST), never an invisible no-op an approver does not see.
    const spec = plainObject(hooks[hook]) ? hooks[hook].command : hooks[hook];
    out.push({ kind: "hook", name: hook, target: spec === undefined || spec === null ? "" : commandTarget(spec), spec });
  }
  return out;
}

/**
 * sha256 over every capability manifest's executables' bytes — `commands` targets and
 * `hooks.*.command` targets — in canonical codepoint order (manifest name, kind, entry name).
 * Locale-independent: the same tree digests identically on every machine.
 * Input is a `packageTree` (module header). A target missing from `files` →
 * E_PACKAGE_MANIFEST { capability, command, target }. Empty set → the digest of nothing.
 */
export function executablesDigest(packageTree) {
  if (!plainObject(packageTree) || !Array.isArray(packageTree.manifests)) {
    throw oatsError("E_PACKAGE_MANIFEST", "executablesDigest expects { manifests: [{ name, manifest, files }] }", { path: "/manifests" });
  }
  const hash = createHash("sha256");
  const manifests = [...packageTree.manifests].sort((a, b) => byCodepoint(String(a.name), String(b.name)));
  for (const { name, manifest, files } of manifests) {
    for (const { kind, name: entry, target, spec } of manifestExecutables(manifest)) {
      const label = kind === "hook" ? `hooks.${entry}.command` : `commands.${entry}`;
      const details = { capability: name, command: entry, kind, target };
      if (typeof spec !== "string") throw oatsError("E_PACKAGE_MANIFEST", `${name}: ${label} must be a string, got ${typeof spec}`, details);
      assertRelPath(`${name} ${label}`, target, details);
      const bytes = files instanceof Map ? files.get(target) : (plainObject(files) && Object.hasOwn(files, target) ? files[target] : undefined);
      if (bytes === undefined) throw oatsError("E_PACKAGE_MANIFEST", `${name}: ${label} targets ${target}, which is not in the package`, details);
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      // Hooks enter the framing under "hooks.<name>" so a hook and a command of the same name never collide.
      hash.update(`${name}\0${kind === "hook" ? `hooks.${entry}` : entry}\0${target}\0${buf.length}\0`);
      hash.update(buf);
      hash.update("\0");
    }
  }
  return `sha256-${hash.digest("hex")}`;
}

/** Record the executable approval for package `id`. Returns a NEW lock; the input is untouched. */
export function approve(lock, id, digest, at = new Date().toISOString()) {
  validateLock(lock);
  const entry = lock.packages[id];
  if (!entry) throw oatsError("E_PACKAGE_MISSING", `cannot approve ${JSON.stringify(id)}: not in the lock — run \`oats sync\` first`, { id });
  if (typeof digest !== "string" || !DIGEST_RE.test(digest)) throw oatsError("E_PACKAGE_INTEGRITY", `approval digest for ${id} must be sha256-<hex>`, { id, digest });
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) throw oatsError("E_LOCK_SCHEMA", `approval timestamp for ${id} is not ISO-8601: ${JSON.stringify(at)}`, { id, at });
  const next = clone(lock);
  next.packages[id] = { ...next.packages[id], approved: { executables: digest, at: new Date(ms).toISOString() } };
  return next;
}

/** Which locked package provides capability `capName`? → { id, entry } | null.
 * Two packages providing the same name is ambiguous and fails closed:
 * E_PACKAGE_MISSING { capability, ambiguous: [ids] } — never a silent first-by-id pick. */
export function packageProviding(lock, capName) {
  if (!plainObject(lock?.packages)) return null;
  const providers = Object.keys(lock.packages).sort().filter((id) => Array.isArray(lock.packages[id]?.capabilities) && lock.packages[id].capabilities.includes(capName));
  if (providers.length === 0) return null;
  if (providers.length > 1) {
    throw oatsError("E_PACKAGE_MISSING", `capability ${JSON.stringify(capName)} is provided by ${providers.length} locked packages (${providers.join(", ")}) — a soul cannot say which; keep one of them in packages:`, { capability: capName, ambiguous: providers });
  }
  return { id: providers[0], entry: lock.packages[providers[0]] };
}

// ---------- deprecated shims (phase A only; callers are deleted next phase) ----------

const removed = (name) => function removedByWorkspaceModel() {
  throw oatsError("E_REMOVED", `${name} was removed by the workspace model; see ${CONTRACT_DOC}`, { name, contract: CONTRACT_DOC });
};

export const aggregateMissingRequirements = removed("aggregateMissingRequirements");
export const applyConfigMerge = removed("applyConfigMerge");
export const applyFromOasScope = removed("applyFromOasScope");
export const beginRunJournal = removed("beginRunJournal");
export const capabilityRuntimeTargets = removed("capabilityRuntimeTargets");
export const commandOnPath = removed("commandOnPath");
export const discoverMigrationScopes = removed("discoverMigrationScopes");
export const discoverOasScopes = removed("discoverOasScopes");
export const discoverWorkspaceScopes = removed("discoverWorkspaceScopes");
export const lockedPackageCapabilities = removed("lockedPackageCapabilities");
export const normalizeRequirement = removed("normalizeRequirement");
export const oasRenameMap = removed("oasRenameMap");
export const packageSpecIdentity = removed("packageSpecIdentity");
export const planConfigMerge = removed("planConfigMerge");
export const planFromOasScope = removed("planFromOasScope");
export const readAdoptedTemplate = removed("readAdoptedTemplate");
export const requirementInstallPlan = removed("requirementInstallPlan");
export const runRequirementInstall = removed("runRequirementInstall");
export const runtimePackageInstalled = removed("runtimePackageInstalled");
export const runtimePackageStatus = removed("runtimePackageStatus");
export const selectConfigTemplate = removed("selectConfigTemplate");
export const splitConfigLines = removed("splitConfigLines");
export const transformOasConfigText = removed("transformOasConfigText");
export const validateConfigTemplate = removed("validateConfigTemplate");
export const writeAdoptedTemplate = removed("writeAdoptedTemplate");
export const adoptedTemplateDir = removed("adoptedTemplateDir");
/** Was a constant table; any property access throws E_REMOVED. */
export const REQUIREMENT_MANAGERS = new Proxy(Object.freeze({}), {
  get(_t, prop) { if (typeof prop === "symbol" || prop === "then") return undefined; removed("REQUIREMENT_MANAGERS")(); },
  has() { removed("REQUIREMENT_MANAGERS")(); },
});
