/** The captured path's installed-store writer: used only by the captured-path
 *  test fixtures (capability-artifacts, captured-resolutions). No CLI route
 *  reaches it (test/captured-store-writer-reach.test.mjs proves it). It is
 *  deleted with the captured path in (e).
 *
 *  Moved verbatim from lib/core.mjs (0.25 package engine), except that
 *  updatePackage acts on the one scope it is given — no lock-scope walk and no
 *  oats-config.yaml reference check (the config chain is gone). It writes
 *  <scope>/.agents/capabilities/installed/<id>/ (with .oats-installation.json)
 *  and the lockfileVersion 2 package + capability rows of <scope>/oats-lock.json,
 *  which lib/capability-artifacts.mjs verifies. */
import { capabilityArtifactIntegrity, copyTreeSafe } from "./artifact-tree.mjs";
import { CAPABILITIES_DIRNAME, INSTALLED_SUBDIR, PACKAGE_ID_RE, capabilityIdViolation, isMaterializedCapabilityId, normalizePackagePath, parseLockSource, validateCapabilityLockEntry, validateLockEntry } from "./capability-provenance.mjs";
import { oatsError } from "./errors.mjs";
import { resolvePackageClosure } from "./package-closure.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  DEFAULT_PACKAGE_PATH, OATS_LOCK_FILE, OATS_VERSION, assertPlatformInvariantLocks, atomicWriteFileSync, capabilityCompatibility, defaultCatalogResolve, loadPackageManifestAt, materializeCapability, packageIntegrity, parseLockFileStrict,
} from "./core.mjs";

const installedCapabilitiesDir = (level) => join(level, CAPABILITIES_DIRNAME, INSTALLED_SUBDIR);

/** Remove source-control metadata from the ROOT of a managed artifact.
 *
 * It must not be installed, and it must not become an integrity exclusion:
 * excluded-but-present bytes are mutable, approval-invisible input. Nested
 * `.git` names are ordinary payload and stay hashed/contained. */
function stripArtifactVcsRoot(dir) {
  const vcs = join(dir, ".git");
  const existed = existsSync(vcs);
  rmSync(vcs, { recursive: true, force: true });
  return existed;
}

/** @returns {{ changed: boolean, rollback: () => void }} */
function ensureInstalledGitignorePreflight(levelDir) {
  const noop = { changed: false, rollback: () => {} };
  if (!spawnSyncOk("git", ["-C", levelDir, "rev-parse", "--is-inside-work-tree"])) return noop;
  const store = join(levelDir, CAPABILITIES_DIRNAME);
  const file = join(store, ".gitignore");
  const line = `${INSTALLED_SUBDIR}/`;
  const existed = existsSync(file);
  const current = existed ? readFileSync(file, "utf8") : "";
  if (current.split("\n").some((l) => l.trim() === line)) return noop;
  try {
    mkdirSync(store, { recursive: true });
    writeFileSync(file, current + (current && !current.endsWith("\n") ? "\n" : "") + `# OATS: materialized capabilities are reprojected from oats-lock.json by \`oats install\`.\n${line}\n`);
  } catch (e) {
    throw oatsError("path-escape", `cannot ensure ${file} ignores "${line}": ${e.message} — generated capability artifacts must never be committable, so the operation stops before touching the store or the lock`, [{ file }]);
  }
  // One-shot: the ignore is now ensured before staging AND still referenced by
  // the commit-time failure path, so rollback can legitimately be reached twice
  // on one failure. Undoing twice would restore bytes over a later, correct
  // state, so the second call is a no-op.
  let undone = false;
  return {
    changed: true,
    rollback: () => {
      if (undone) return;
      undone = true;
      try { if (existed) writeFileSync(file, current); else rmSync(file, { force: true }); } catch { /* nothing better to do during rollback */ }
    },
  };
}

function spawnSyncOk(cmd, argv) {
  try { execFileSync(cmd, argv, { stdio: "ignore" }); return true; } catch { return false; }
}

// ---------- distribution packages (docs/design/package-engine-contract.md) ----------
/** Where one materialized capability artifact lives at a scope.
 *
 * This is the LAST line of defence, and it is a positive proof rather than a
 * blocklist: the id must match the materialized grammar, and the lexically
 * resolved destination must be an IMMEDIATE child of `installed/`. Nothing is
 * derived from the id before it is validated, so a hostile id cannot influence
 * the path it is being checked against. */
export const installedCapabilityDir = (levelDir, capabilityId) => {
  if (!isMaterializedCapabilityId(capabilityId)) throw oatsError("path-escape", `capability artifact path refused: ${capabilityIdViolation(capabilityId)}`);
  const root = installedCapabilitiesDir(levelDir);
  const dir = join(root, capabilityId);
  // Lexical, not realpath: this proves the NAME cannot walk out of the store.
  // Symlink containment of the store itself is a separate, earlier concern.
  if (dirname(resolve(dir)) !== resolve(root)) {
    throw oatsError("path-escape", `capability artifact path refused: ${JSON.stringify(capabilityId)} does not resolve to an immediate child of ${root}`);
  }
  return dir;
};

/** Prefix of a transaction staging directory. It lives inside the (gitignored)
 * installed store so the commit phase is a same-filesystem rename, and it is
 * dot-prefixed so discovery skips it. */
const STAGING_PREFIX = ".staging-";

/** Split an optional `#<package-path>` fragment off a source spec. A source may
 * carry at most one fragment; the fragment is removed BEFORE `@ref` parsing so
 * a path can never be mistaken for part of a ref. */
function splitPackagePathFragment(spec) {
  const hash = spec.indexOf("#");
  if (hash < 0) return { body: spec, fragment: undefined };
  const fragment = spec.slice(hash + 1);
  if (fragment.includes("#")) throw oatsError("invalid-source", `package source "${spec}" has more than one "#<path>" fragment`);
  return { body: spec.slice(0, hash), fragment };
}

/** Parse + normalize a package source spec (contract §1): git shorthand, raw
 * git URL, local path, or official catalog short ID. Git spellings accept an
 * optional `#<path>` fragment selecting a contained package root; the parsed
 * `packagePath` is undefined when the spec does not select one (resolution
 * applies DEFAULT_PACKAGE_PATH or the catalog entry's path). */
function parsePackageSource(spec, { baseDir } = {}) {
  const raw = String(spec ?? "").trim();
  if (!raw) throw oatsError("invalid-source", "empty package source");
  const { body: s, fragment } = splitPackagePathFragment(raw);
  if (!s) throw oatsError("invalid-source", `package source "${raw}" selects a path but names no source`);
  const packagePath = normalizePackagePath(fragment, { where: `package path in "${raw}"` });
  // Fragments belong to Git sources only. A catalog entry supplies its own
  // path ({url, ref?, path?}) and a local path is an EXACT directory
  // (contract §9) — accepting "#" on either would create a second, ambiguous
  // way to spell the same selection.
  const noFragment = (kind) => {
    if (fragment !== undefined) throw oatsError("invalid-source", `${kind} sources do not take a "#<path>" fragment: "${raw}"`);
  };
  const splitRef = (str) => {
    const at = str.lastIndexOf("@");
    if (at > 0 && at > str.lastIndexOf("/")) return [str.slice(0, at), str.slice(at + 1)];
    return [str, undefined];
  };
  const asPath = (raw) => {
    // Classify BEFORE tilde expansion (reviewer-3626ef2 blocker): `~/x` is a
    // host-ambient spelling, not an absolute path — expanding first turned it
    // absolute and let remote manifests reach $HOME through the guard.
    const tilde = raw.startsWith("~/") || raw === "~";
    // Replacer FUNCTION, not a replacement string — a home directory containing
    // `$&`/`$'`/`` $` ``/`$1` would otherwise expand against the match.
    const expanded = tilde ? raw.replace(/^~(?=\/|$)/, () => homedir()) : raw;
    // Relativeness from the PARSED payload (reviewer-2a4adec: "path:sub" and
    // whitespace variants are relative too). Tilde spellings are NOT absolute
    // for classification purposes: they are ambient-host references, treated
    // like relative specs so the no-local-base guard rejects them from
    // git/catalog manifests.
    const relativeSpec = tilde || !isAbsolute(expanded);
    // Relative paths resolve against baseDir when provided (the depending
    // package's root — contract: package-relative), else the process CWD.
    // Tilde stays home-anchored (never baseDir-joined) for CLI use.
    const p = tilde ? resolve(expanded) : baseDir && relativeSpec ? resolve(baseDir, expanded) : resolve(expanded);
    // Local acquisition is EXACT-DIRECTORY (contract §9): the named directory
    // IS the package root whatever it is called — no default-path heuristic.
    return { kind: "path", path: p, relative: relativeSpec, packagePath: ".", normalized: `path:${p}` };
  };
  if (s.startsWith("path:")) { noFragment("local path"); return asPath(s.slice(5)); }
  if (s.startsWith(".") || s.startsWith("/") || s.startsWith("~")) { noFragment("local path"); return asPath(s); }
  if (s.startsWith("git:") && !s.startsWith("git://")) {
    const [body, ref] = splitRef(s.slice(4));
    if (!/^[^/\s]+\/[^/\s]+\/[^/\s]+$/.test(body)) throw oatsError("invalid-source", `git shorthand must be git:host/org/repo[@ref][#<path>]: "${spec}"`);
    const url = `https://${body}${body.endsWith(".git") ? "" : ".git"}`;
    return { kind: "git", url, ref, packagePath, normalized: ref ? `git:${url}@${ref}` : `git:${url}` };
  }
  if (/^(https?:\/\/|file:\/\/|git@|ssh:\/\/|git:\/\/)/.test(s)) {
    const [url, ref] = splitRef(s);
    return { kind: "git", url, ref, packagePath, normalized: ref ? `git:${url}@${ref}` : `git:${url}` };
  }
  const m = /^([a-z0-9][a-z0-9._-]*)(?:@(.+))?$/.exec(s);
  if (m) {
    noFragment("official catalog");
    return { kind: "catalog", id: m[1], selector: m[2], normalized: m[2] ? `catalog:${m[1]}@${m[2]}` : `catalog:${m[1]}` };
  }
  throw oatsError("invalid-source", `"${spec}" is not a git source, local path, or official catalog id`);
}

const LOCKFILE_VERSION = 2;

/** A null-prototype copy of a raw parsed JSON map. Raw objects return inherited
 * `constructor`/`toString`/`valueOf` for `map[id]` even with no own entry, so
 * every ID-keyed map in the engine goes through this (or `Object.hasOwn`) before
 * any lookup, membership check or graph walk. */
function nullProtoMap(raw) {
  const out = Object.create(null);
  for (const k of Object.keys(raw || {})) out[k] = raw[k];
  return out;
}

/** The lock document at ONE scope as a mutable draft. An existing v1 lock —
 * INCLUDING an empty one — is `legacy-lock`: conversion happens only through
 * explicit migration, so only an ABSENT lock is a fresh document. */
function lockDraft(levelDir) {
  const file = join(levelDir, OATS_LOCK_FILE);
  const strict = parseLockFileStrict(file);
  if (strict && strict.version !== LOCKFILE_VERSION) {
    throw oatsError("legacy-lock", `${file} is lockfileVersion ${strict.version} — run \`oats migrate --dir ${levelDir}\` to convert this scope before locking capabilities`, [{ file, lockfileVersion: strict.version }]);
  }
  return { file, doc: strict ? { packages: nullProtoMap(strict.packages), capabilities: nullProtoMap(strict.capabilities) } : { packages: Object.create(null), capabilities: Object.create(null) } };
}

/** Validate a COMPLETE prospective document, then write it atomically. An
 * invalid lock must never be produced by a writer (maintainer finding 3). */
function writeLockDocument(file, doc) {
  const packages = Object.create(null);
  for (const id of Object.keys(doc.packages)) {
    if (!PACKAGE_ID_RE.test(id)) throw oatsError("invalid-lock", `${file} packages map has an invalid package key ${JSON.stringify(id)}`, [{ file, package: id }]);
    packages[id] = doc.packages[id];
  }
  for (const id of Object.keys(packages)) validateLockEntry(id, packages[id], packages, { file });
  for (const id of Object.keys(doc.capabilities)) validateCapabilityLockEntry(id, doc.capabilities[id], packages, { file });
  // Sorted keys keep the serialization deterministic across runs and platforms.
  const sorted = (m) => Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]]));
  atomicWriteFileSync(file, JSON.stringify({ lockfileVersion: LOCKFILE_VERSION, packages: sorted(doc.packages), capabilities: sorted(doc.capabilities) }, null, 2) + "\n");
  return file;
}

/** Replace many rows at one scope in ONE validated write — the acquire / update /
 * remove / migrate commit step. `packages` and `capabilities` are maps of
 * id → entry (or null to delete). `replacePackages` names packages whose ENTIRE
 * export set is being rewritten, so capability rows they used to supply and no
 * longer do are dropped in the same transaction instead of dangling. */
function writeLockEntries(levelDir, { packages = {}, capabilities = {}, replacePackages = [] } = {}) {
  const { file, doc } = lockDraft(levelDir);
  for (const pid of replacePackages) {
    for (const [cid, row] of Object.entries(doc.capabilities)) if (row.package === pid) delete doc.capabilities[cid];
  }
  for (const [id, entry] of Object.entries(packages)) {
    if (!PACKAGE_ID_RE.test(id)) throw oatsError("invalid-lock", `invalid package identity ${JSON.stringify(id)}`);
    if (entry === null) delete doc.packages[id]; else doc.packages[id] = entry;
  }
  for (const [id, entry] of Object.entries(capabilities)) {
    if (entry === null) delete doc.capabilities[id]; else doc.capabilities[id] = entry;
  }
  return writeLockDocument(file, doc);
}

/** Check out the exact commit a caller-supplied ref names, and return it.
 *
 * A ref is a PUBLIC value — it arrives from a CLI spec, a lock entry, or a
 * REMOTE package manifest's `dependencies[]` — so it must never reach git as
 * an option-capable argument. `git checkout -q --detach` (i.e. a ref spelled
 * `--detach`) exits 0 without selecting any revision, after which a caller
 * that reads HEAD reports whatever was already checked out AS the pinned
 * commit: a silent fail-open on the exact pin this function exists to enforce.
 *
 * So: resolve behind `--end-of-options` first, require a 40-hex commit, check
 * THAT out (a hex string cannot be an option), and verify HEAD landed on it. */
function gitCheckoutExactRef(dir, ref, spec) {
  const resolve1 = (rev) => {
    try { return execFileSync("git", ["-C", dir, "rev-parse", "--verify", "--quiet", "--end-of-options", rev], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
    catch { return ""; }
  };
  // Direct resolution first, preserving git's own precedence (exact SHA, tag,
  // local branch). Then the remote-tracking fallback: a plain clone materializes
  // only the default branch locally, so `<ref>` for any OTHER branch exists
  // solely as refs/remotes/origin/<ref>. `git checkout <ref>` used to reach it
  // by DWIM guessing — which is exactly what we gave up by checking out a
  // resolved hash, so it has to be resolved explicitly instead (still behind
  // --end-of-options, and the "refs/" prefix cannot start with a dash).
  const sha = resolve1(`${ref}^{commit}`) || resolve1(`refs/remotes/origin/${ref}^{commit}`);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw oatsError("invalid-source", `git ref ${JSON.stringify(String(ref))} does not resolve to a commit in ${spec}`);
  execFileSync("git", ["-C", dir, "checkout", "-q", "--detach", sha], { stdio: "pipe" });
  const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== sha) throw oatsError("invalid-source", `git checkout of ${sha} in ${spec} left HEAD at ${head}`);
  return sha;
}

/** Resolve a configured package path inside a fetched checkout to the directory
 * it selects, WITHOUT requiring a manifest there. Returns undefined when the
 * path names nothing (or a non-directory) in this checkout — the caller decides
 * whether that is a diagnosis (inspection) or a failure (acquisition).
 *
 * Containment is decided on the REALPATH: a symlinked payload root is followed,
 * but a link (at any depth of the configured path) whose target lands outside
 * the checkout is path-escape, and so is a broken link. Lexical checks alone
 * cannot see either. */
function resolvePackagePayloadDir(checkout, packagePath, spec) {
  const base = realpathSync(checkout);
  const escapes = (real) => {
    const fromRoot = relative(base, real);
    return fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
  };
  // Walk COMPONENT BY COMPONENT. A single lstat of the full path cannot tell a
  // genuinely absent path from one whose intermediate link is broken —
  // "dangling/sub" makes both existsSync and lstat fail — so a broken or
  // escaping link at any depth would be misreported as "no package here".
  const segments = packagePath === "." ? [] : packagePath.split("/");
  let current = checkout;
  for (let i = 0; i < segments.length; i++) {
    current = join(current, segments[i]);
    const traversed = segments.slice(0, i + 1).join("/");
    let st;
    try { st = lstatSync(current); }
    catch { return undefined; } // genuinely absent at this depth
    if (!st.isSymbolicLink()) continue;
    let real;
    try { real = realpathSync(current); }
    catch { throw oatsError("path-escape", `package path "${packagePath}" in ${spec} traverses a broken symlink at "${traversed}"`); }
    if (escapes(real)) throw oatsError("path-escape", `package path "${packagePath}" in ${spec} leaves the fetched source root at "${traversed}" after symlink resolution: ${real}`);
  }
  const real = realpathSync(current);
  if (escapes(real)) throw oatsError("path-escape", `package path "${packagePath}" in ${spec} resolves outside the fetched source root after symlink resolution: ${real}`);
  return statSync(real).isDirectory() ? real : undefined;
}

/** Resolve the package root inside a fetched source (contract §1.1): the
 * configured path must exist, be a directory contained in the checkout after
 * symlink resolution, and carry oats-package.json there. Exported so every
 * consumer that fetches a source itself (WS2 profile diff) selects the package
 * root exactly the way acquisition does. */
function resolvePackageRoot(checkout, packagePath, spec) {
  const dir = resolvePackagePayloadDir(checkout, packagePath, spec);
  if (!dir) throw oatsError("invalid-source", `package path "${packagePath}" is not a directory in ${spec}${packagePath === DEFAULT_PACKAGE_PATH ? ` — the default package path; select another with "#<path>" (or "#." for the repository root)` : ""}`);
  if (!existsSync(join(dir, "oats-package.json"))) throw oatsError("invalid-package-manifest", `${spec} has no oats-package.json at package path "${packagePath}"${packagePath === DEFAULT_PACKAGE_PATH ? ` (the default package path) — select another with "#<path>" (or "#." for the repository root)` : ""}`);
  return dir;
}

/** Fetch ONE exact commit of a source once and materialize ONLY the selected
 * contained package root at `dest` (contract §5). `opts.path` overrides the
 * spec's and the catalog's selection — restore passes the LOCKED path so an
 * upstream/catalog path move can never change what a bare restore installs.
 * Returns the resolved commit and the normalized path that was installed. */
function fetchPackageSource(parsed, dest, catalog, { commit, path: pathOverride } = {}) {
  if (parsed.kind === "catalog") {
    const r = (catalog || defaultCatalogResolve)(parsed.id, parsed.selector);
    if (!r || !r.url) throw oatsError("invalid-source", `the official package catalog cannot resolve "${parsed.id}${parsed.selector ? `@${parsed.selector}` : ""}"`);
    const entryPath = normalizePackagePath(r.path, { where: `package path in the official catalog entry for "${parsed.id}"` });
    const path = pathOverride ?? entryPath ?? DEFAULT_PACKAGE_PATH;
    return fetchPackageSource({ kind: "git", url: r.url, ref: r.ref, packagePath: path }, dest, catalog, { commit, path });
  }
  if (parsed.kind === "git") {
    const path = pathOverride ?? parsed.packagePath ?? DEFAULT_PACKAGE_PATH;
    // Clone the whole repository ONCE beside dest, then keep only the selected
    // subtree: everything else (repo docs, CI, owner souls, sibling packages)
    // never becomes installed bytes and never reaches the integrity digest.
    const checkout = `${dest}.checkout`;
    rmSync(checkout, { recursive: true, force: true });
    try {
      execFileSync("git", ["clone", "-q", parsed.url, checkout], { stdio: "pipe" });
      const ref = commit || parsed.ref;
      const head = ref
        ? gitCheckoutExactRef(checkout, ref, parsed.url)
        : execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const payload = resolvePackageRoot(checkout, path, parsed.url);
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(payload, dest);
      // Our own clone metadata is never package payload (and packageIntegrity
      // already ignores it) — dropping it keeps installed bytes equal to the
      // selected subtree whether that subtree is the repository root or not.
      rmSync(join(dest, ".git"), { recursive: true, force: true });
      return { commit: head, path };
    } finally { rmSync(checkout, { recursive: true, force: true }); }
  }
  if (pathOverride !== undefined && pathOverride !== ".") {
    throw oatsError("invalid-source", `local package sources are exact directories (contract §9); "${parsed.normalized}" cannot select the contained path "${pathOverride}"`);
  }
  if (!existsSync(parsed.path)) throw oatsError("invalid-source", `local package path does not exist: ${parsed.path}`);
  if (!existsSync(join(parsed.path, "oats-package.json"))) throw oatsError("invalid-package-manifest", `${parsed.path} has no oats-package.json distribution manifest`);
  copyTreeSafe(parsed.path, dest);
  stripArtifactVcsRoot(dest);
  return { commit: "local", path: "." };
}

/** The lock rows at ONE scope (not the merged chain), as null-prototype maps.
 * Raises invalid-lock on any violation; an absent or v1 lock reads as empty. */
function levelLockRows(levelDir) {
  const strict = parseLockFileStrict(join(levelDir, OATS_LOCK_FILE));
  return strict && strict.version === LOCKFILE_VERSION
    ? { packages: strict.packages, capabilities: strict.capabilities }
    : { packages: Object.create(null), capabilities: Object.create(null) };
}

/** Ensure the scope's ignore, THEN open staging.
 *
 * Staging lives under `installed/`, so every fetched and materialized byte sits
 * inside the work tree from the moment it is written. Ensuring the ignore only
 * at commit time left that whole window — fetch, closure validation, projection,
 * the caller's pre-commit gate — with generated state visible to `git status`
 * and committable by anything running meanwhile. The ignore is transactional:
 * if staging itself cannot be opened, the ignore is rolled back before the
 * failure propagates. */
function beginStaging(levelDir) {
  const root = installedCapabilitiesDir(levelDir);
  const capabilitiesDir = dirname(root);
  // Snapshot the anchors BEFORE the preflight, not after: writing the ignore
  // creates `.agents/capabilities/` (and `.agents/`), so letting makeStaging
  // discover them afterwards would classify directories THIS operation created
  // as pre-existing, and a refused acquisition would leave them behind.
  const absent = [root, capabilitiesDir, dirname(capabilitiesDir)].filter((d) => !existsSync(d)); // deepest first
  const ignore = ensureInstalledGitignorePreflight(levelDir);
  try {
    const staged = makeStaging(levelDir);
    return { dir: staged.dir, createdAnchors: [...new Set([...absent, ...staged.createdAnchors])], ignore };
  } catch (e) { ignore.rollback(); throw e; }
}

/** Create a transaction staging directory inside the (gitignored) installed
 * store: same filesystem as the destination, so the commit phase is a rename;
 * dot-prefixed, so discovery skips it.
 *
 * Staging has to live inside the store, so on a scope that has no store yet this
 * necessarily creates `.agents/`, `.agents/capabilities/` and
 * `.agents/capabilities/installed/`. A refused or failed acquisition must leave
 * the scope UNTOUCHED, so the exact set of anchor directories this operation
 * had to create is recorded here and handed back for `pruneCreatedAnchors`.
 * Returns them DEEPEST-FIRST, which is also the only safe removal order.
 *
 * @returns {{ dir: string, createdAnchors: string[] }} */
function makeStaging(levelDir) {
  const root = installedCapabilitiesDir(levelDir);
  const capabilitiesDir = dirname(root);
  const anchors = [root, capabilitiesDir, dirname(capabilitiesDir)]; // installed → capabilities → .agents
  const createdAnchors = anchors.filter((d) => !existsSync(d));
  mkdirSync(root, { recursive: true });
  return { dir: mkdtempSync(join(root, STAGING_PREFIX)), createdAnchors };
}

/** Undo the anchor directories `makeStaging` had to create, deepest-first.
 *
 * Only directories THIS operation created are candidates — a pre-existing empty
 * `.agents/` belongs to the scope and is never removed. `rmdirSync` refuses a
 * non-empty directory, which is exactly the "only while empty" rule: it makes
 * owned/, adopted/, config-templates/, an installed artifact, or any unrelated
 * state a hard stop rather than something to reason about. The first failure
 * breaks the loop, because a directory that could not be removed is by
 * definition still holding everything above it.
 *
 * Safe to call unconditionally after a SUCCESSFUL operation too: the store is
 * non-empty then, so every rmdir fails on the first try and nothing happens. */
function pruneCreatedAnchors(createdAnchors) {
  for (const dir of createdAnchors) {
    try { rmdirSync(dir); } catch { break; }
  }
}

/** UTF-8 decoder that REFUSES malformed input instead of substituting U+FFFD, and
 * KEEPS a leading BOM instead of eating it — the returned `content` must
 * re-encode to the exact bytes `contentIntegrity` covers, or an adopter writing
 * the template back would produce a file the digest no longer matches. */
const TEMPLATE_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Read one declared config template into the frozen descriptor shape.
 *
 * `contentIntegrity` digests the EXACT FILE BYTES, not the decoded string.
 * Hashing the string would silently hash U+FFFD replacement characters for any
 * byte sequence Node could not decode, producing a digest nothing can reproduce
 * from the file — and adoption compares template bytes. Config templates are
 * UTF-8 text by contract, so undecodable bytes are a malformed package rather
 * than something to repair: the decode is fail-closed. Both the staged reader
 * (acquisition) and the locked reader go through here, so their descriptors —
 * `legacySpelling` included — cannot drift apart. */
function configTemplateDescriptor(pkgId, dir, name, tpl, legacySpelling) {
  const bytes = readFileSync(join(dir, tpl.path));
  let content;
  try { content = TEMPLATE_DECODER.decode(bytes); }
  catch { throw oatsError("invalid-package-manifest", `package "${pkgId}" config template "${name}" (${tpl.path}) is not valid UTF-8 — config templates are UTF-8 text`); }
  return {
    template: name, path: tpl.path,
    ...(tpl.description !== undefined ? { description: tpl.description } : {}),
    default: tpl.default === true,
    content, contentIntegrity: `sha256-${createHash("sha256").update(bytes).digest("hex")}`,
    legacySpelling: legacySpelling === true,
  };
}

function stagedConfigTemplates(pkgId, manifest) {
  const out = [];
  for (const [name, tpl] of Object.entries(manifest._configTemplates || {})) {
    out.push({ package: pkgId, ...configTemplateDescriptor(pkgId, manifest._dir, name, tpl, manifest._legacySpelling) });
  }
  return out;
}

/** Resolve + acquire a package closure at one scope (contract §5.3): fetch the
 * root source and its whole dependency closure into TEMPORARY staging, validate
 * every manifest (official selector / pinned git / local path — no semver
 * solver), detect cycles and identity collisions, MATERIALIZE each declared
 * capability into a flat self-contained artifact under
 * `.agents/capabilities/installed/<id>/`, write the exact lock, and discard
 * staging. A package root is never persisted.
 *
 * Activates nothing and trusts nothing: `trusted` is carried over only for a
 * capability whose newly projected artifact is byte-identical to the one already
 * locked. Transactional: everything validates against staging BEFORE any
 * destination mutation, artifacts swap with backups, and the lock is written
 * once at the end.
 *
 * `opts.assertCommittable(preview)` is a caller-supplied PRE-COMMIT GATE, called
 * once with the complete staged outcome — `{ root, packages, capabilities,
 * configTemplates }`, the same records this function is about to return, with
 * template `content` and `contentIntegrity` included — while the scope is still
 * untouched. It is a PURE GATE: it may only inspect and throw. A throw discards
 * staging and mutates nothing (no ignore file, no artifact, no lock byte), so a
 * refusal needs no rollback. */
export function acquirePackage(levelDir, spec, opts = {}) {
  const lockFile = join(levelDir, OATS_LOCK_FILE);
  // Fail closed on a scope that has not been converted yet, BEFORE any source
  // fetch, staging, ignore or artifact work: current rows cannot be written
  // beside a v1 document, and silently converting one would be exactly the
  // implicit migration the Decision forbids. EVERY v1 is refused, including an
  // empty one — an empty v1 is still an unconverted scope, `lockDraft` refuses
  // it identically, and exempting it here would convert it as a side effect of
  // `oats install` while making the caller pay for a fetch first.
  const existing = levelLockRows(levelDir);
  {
    const strict = parseLockFileStrict(lockFile);
    if (strict && strict.version !== LOCKFILE_VERSION) {
      throw oatsError("legacy-lock", `${lockFile} is lockfileVersion ${strict.version} — run \`oats migrate\` at this scope before installing packages`, [{ file: lockFile, lockfileVersion: strict.version }]);
    }
  }
  const { dir: staging, createdAnchors, ignore } = beginStaging(levelDir);
  const artifactsDir = join(staging, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });
  let counter = 0;
  const readPackage = (srcSpec, parent, chain) => {
    const baseDir = parent?.parsedSource.kind === "path" ? parent.parsedSource.path : undefined;
    const p = parsePackageSource(srcSpec, { baseDir });
    if (parent) {
      if (p.kind === "git" && !p.ref) throw oatsError("invalid-source", `package dependency must be pinned to a tag/commit: "${srcSpec}" (declared by ${parent.package})`);
      if (p.kind === "path" && p.relative && !baseDir) throw oatsError("invalid-source", `package dependency "${srcSpec}" (declared by ${parent.package}) is a relative path, but ${parent.package} was not acquired from a local path — relative dependencies only work between co-located local packages`);
    }
    const dest = join(staging, `pkg-${counter++}`);
    let commit, packagePath;
    if (!chain.length && opts.rootSnapshot) {
      // payloadDir is the ALREADY-SELECTED contained root, so this copy is the
      // same subtree a fresh fetch would produce — and the layout re-check below
      // is what makes a source mutated between inspection and acquisition fail
      // before any store or lock write.
      if (!opts.rootSnapshot.payloadDir) throw oatsError("invalid-source", `inspected Git source has no package at path "${opts.rootSnapshot.path}" for ${srcSpec}`);
      copyTreeSafe(opts.rootSnapshot.payloadDir, dest);
      stripArtifactVcsRoot(dest);
      commit = opts.rootSnapshot.commit;
      packagePath = opts.rootSnapshot.path;
      const packageLayout = existsSync(join(dest, "oats-package.json"));
      const capabilityLayout = existsSync(join(dest, "oats.json"));
      if (packageLayout !== opts.rootSnapshot.payloadPackage || capabilityLayout !== opts.rootSnapshot.payloadCapability || !packageLayout) {
        throw oatsError("invalid-source", `inspected Git root layout changed before package acquisition for ${srcSpec}`);
      }
    } else ({ commit, path: packagePath } = fetchPackageSource(p, dest, opts.catalog));
    const m = loadPackageManifestAt(dest);
    const id = m.package;
    // Preserve the ORIGINAL catalog spec in lock metadata: bare and explicit
    // selector forms must remain distinguishable for update. The resolved git
    // commit is already pinned separately in `commit`.
    const source = p.kind === "catalog" ? (p.selector ? `catalog:${p.id}@${p.selector}` : `catalog:${p.id}`) : p.kind === "path" ? p.normalized : `git:${p.url}@${p.ref || commit}`;
    // Dedup identity includes the SELECTED ROOT: one repository may legitimately
    // contain several packages (contract §1.1), so two payload roots claiming one
    // package identity are a collision, not the same package resolved twice.
    const sourceKey = `${source}#${packagePath}`;
    return {
      package: id, dir: dest, manifest: m, source, path: packagePath, sourceKey, commit,
      version: m.version, capabilities: m._capabilities, parsedSource: p, dependencyRequests: m.dependencies || [],
    };
  };
  try {
    const { roots: [rootId], packages: resolved } = resolvePackageClosure({
      requests: [spec], readPackage, context: levelDir,
      validatePackage(record) {
        const compat = capabilityCompatibility(record.manifest);
        if (!compat.compatible) throw oatsError("incompatible-oats", `package ${record.package} requires OATS ${compat.range} (running ${OATS_VERSION})`);
      },
      finalizePackage: (record, deps) => ({ ...record, integrity: packageIntegrity(record.dir), deps }),
      discardPackage: (record) => rmSync(record.dir, { recursive: true, force: true }),
    });
    if (opts.expectPackage && rootId !== opts.expectPackage) {
      throw oatsError("duplicate-package-identity", `source ${spec} no longer provides root package "${opts.expectPackage}" (root resolved to "${rootId}")`);
    }
    // Same-scope capability-ID collisions: within the closure, and against
    // capabilities already locked at this scope by packages OUTSIDE it.
    const capOwner = new Map();
    for (const [cid, row] of Object.entries(existing.capabilities)) {
      if (!resolved.has(row.package)) capOwner.set(cid, row.package);
    }
    for (const [pid, r] of resolved) {
      for (const c of r.capabilities) {
        if (capOwner.has(c.id) && capOwner.get(c.id) !== pid) throw oatsError("duplicate-capability-id", `capability "${c.id}" is exported by both package "${capOwner.get(c.id)}" and package "${pid}" at ${levelDir}`, [capOwner.get(c.id), pid]);
        capOwner.set(c.id, pid);
      }
    }
    // A locked source never advances on acquire (only `oats update` may): the
    // selected root is checked before integrity, because two different roots can
    // hold byte-identical trees and that must not silently rewrite the path.
    for (const [pid, r] of resolved) {
      const prior = Object.hasOwn(existing.packages, pid) ? existing.packages[pid] : undefined;
      if (!prior || opts.replace) continue;
      // The way OUT of a path mismatch depends on who owns the selected root.
      // `oats update` re-resolves from the locked source: a catalog entry owns
      // its `path`, so an update adopts a moved root; a git spec's "#<path>" is
      // the operator's OWN selection and stays sticky, so recommending update
      // there would name a command that cannot resolve it. Local sources are
      // always the exact directory (path "."), so they never reach this.
      if (prior.path !== r.path) {
        const lockedKind = (() => { try { return parseLockSource(prior.source).kind; } catch { return undefined; } })();
        const route = lockedKind === "git"
          ? `a git source's "#<path>" is your own selection, so \`oats update ${pid}\` would keep "${prior.path}". To move it, \`oats remove ${pid}\` (refused while config or dependent packages still reference it), then re-install the git source with the intended "#<path>"`
          : `use \`oats update ${pid}\``;
        throw oatsError("integrity-drift", `package "${pid}" resolves to package path "${r.path}" but the existing lock records "${prior.path}" — a locked source never advances on acquire; ${route}`);
      }
      if (prior.integrity !== r.integrity) throw oatsError("integrity-drift", `package "${pid}" resolves to integrity ${r.integrity} but the existing lock records ${prior.integrity} — a locked source never advances on acquire; use \`oats update ${pid}\``);
    }
    // TRANSACTION-WIDE platform-invariance preflight over every materialization
    // root BEFORE any npm ci, so a clean closure cannot materialize ahead of a
    // rejected sibling (reviewer-11752b2).
    assertPlatformInvariantLocks([...resolved.values()].flatMap((r) => r.capabilities.map((c) => c.dir)));
    // Project every capability of the closure, in staging.
    const projected = [];
    const configTemplates = [];
    for (const [, r] of resolved) {
      for (const cap of r.capabilities) projected.push(materializeCapability({ cap, pkg: r, artifactsDir }));
      configTemplates.push(...stagedConfigTemplates(r.package, r.manifest));
    }
    // Trust is carried over ONLY for a byte-identical artifact — that is the
    // whole meaning of "trust binds to the capability integrity". Everything
    // else lands untrusted, including a brand-new acquisition.
    for (const proj of projected) {
      const prior = Object.hasOwn(existing.capabilities, proj.capability) ? existing.capabilities[proj.capability] : undefined;
      const same = prior && prior.integrity === proj.integrity && prior.package === proj.package;
      proj.trusted = !!(same && prior.trusted);
      const dest = installedCapabilityDir(levelDir, proj.capability);
      proj.installedDir = dest;
      proj.status = !existsSync(dest) ? "installed"
        : same && capabilityArtifactIntegrity(dest) === proj.integrity ? "kept"
          : "replaced";
    }
    // PRE-COMMIT GATE (contract §5.3). The caller sees the COMPLETE staged
    // outcome — the same records `acquirePackage` is about to return — while
    // nothing in the scope has been touched: no ignore file, no artifact, no
    // lock byte. Throwing from here discards staging and mutates nothing, which
    // is what lets guided `oats init --package` present and validate the whole
    // selected plan (including template bytes and digests) before committing,
    // and what lets `oats update` refuse an export drop byte-exactly. Judging the
    // result after the commit cannot achieve either: putting "the previous
    // version" back re-acquires from a source that has itself moved on.
    if (opts.assertCommittable) {
      opts.assertCommittable({
        root: rootId,
        packages: [...resolved.values()].map((r) => ({
          package: r.package, version: r.version, source: r.source, path: r.path, commit: r.commit,
          integrity: r.integrity, dependencies: [...new Set(r.deps)].sort(),
          capabilities: r.capabilities.map((c) => c.id),
        })),
        capabilities: projected.map((p) => ({
          capability: p.capability, version: p.version, package: p.package, path: p.path,
          integrity: p.integrity, trusted: p.trusted, status: p.status, layer: p.layer,
          executableSurface: p.executableSurface,
        })),
        configTemplates,
      });
    }
    // COMMIT. The scope's ignore was already ensured before staging opened
    // (contract §3.3), so nothing generated has been visible to git at any
    // point. Artifacts swap with backups and the lock is written once. ANY
    // failure — including one during the swap or the lock write — rolls
    // artifacts, lock bytes and ignore bytes back.
    const originalLock = existsSync(lockFile) ? readFileSync(lockFile, "utf8") : null;
    const done = []; // { dest, backup? } — rollback state, registered BEFORE each move
    const retired = [];
    try {
      for (const proj of projected) {
        if (proj.status === "kept") continue;
        const dest = proj.installedDir;
        // The record joins `done` BEFORE the first destructive rename. Pushing
        // it after both moves left a window: if the second rename failed, the
        // pre-existing artifact was already in staging with nothing recording
        // it, so rollback restored nothing and the staging cleanup deleted it.
        const record = { dest, backup: undefined, landed: false };
        done.push(record);
        if (existsSync(dest)) {
          const backup = join(staging, `backup-${proj.capability}`);
          renameSync(dest, backup);
          record.backup = backup;
        }
        mkdirSync(dirname(dest), { recursive: true });
        renameSync(proj.dir, dest);
        record.landed = true;
        proj.dir = dest;
      }
      // DROPPED EXPORTS retire inside this transaction. `replacePackages` is
      // about to remove their lock rows, so their artifacts must move in the
      // same commit: a post-commit rmSync could leave the lock and the store
      // disagreeing with no way back. Success lets the staging cleanup delete
      // them; failure restores them along with everything else.
      const staying = new Set(projected.map((p) => p.capability));
      for (const [cid, row] of Object.entries(existing.capabilities)) {
        if (!resolved.has(row.package) || staying.has(cid)) continue;
        const dir = installedCapabilityDir(levelDir, cid);
        retired.push(cid);
        if (!existsSync(dir)) continue;
        const record = { dest: dir, backup: undefined, landed: false };
        done.push(record);
        const backup = join(staging, `retired-${cid}`);
        renameSync(dir, backup);
        record.backup = backup;
      }
      for (const proj of projected) proj.dir = proj.installedDir;
      writeLockEntries(levelDir, {
        packages: Object.fromEntries([...resolved.values()].map((r) => [r.package, {
          source: r.source, path: r.path, version: r.version, commit: r.commit, integrity: r.integrity,
          dependencies: [...new Set(r.deps)].sort(),
        }])),
        capabilities: Object.fromEntries(projected.map((p) => [p.capability, {
          version: p.version, package: p.package, path: p.path, integrity: p.integrity, trusted: p.trusted,
        }])),
        replacePackages: [...resolved.keys()],
      });
    } catch (e) {
      for (const d of done.reverse()) {
        // A record with no backup and nothing landed means the FIRST rename
        // failed: dest still holds the untouched pre-existing artifact (or
        // never existed). Removing it here would destroy the exact bytes this
        // rollback exists to preserve.
        if (d.landed || d.backup) rmSync(d.dest, { recursive: true, force: true });
        if (d.backup && existsSync(d.backup)) renameSync(d.backup, d.dest);
      }
      if (originalLock === null) rmSync(lockFile, { force: true });
      else writeFileSync(lockFile, originalLock);
      ignore.rollback();
      throw e;
    }
    return {
      root: rootId, lockFile, retired,
      installed: [...resolved.values()].map((r) => ({
        package: r.package, version: r.version, source: r.source, path: r.path, commit: r.commit,
        integrity: r.integrity, dependencies: [...new Set(r.deps)].sort(),
        capabilities: r.capabilities.map((c) => c.id),
        kept: r.capabilities.every((c) => projected.find((p) => p.capability === c.id)?.status === "kept"),
      })),
      capabilities: projected.map((p) => ({
        capability: p.capability, version: p.version, package: p.package, path: p.path,
        integrity: p.integrity, dir: p.dir, trusted: p.trusted, status: p.status, layer: p.layer,
        executableSurface: p.executableSurface,
      })),
      configTemplates,
    };
  } catch (e) {
    // The ignore was written BEFORE staging, so every failure path — including
    // the ones that never reach the commit block — has to undo it. rollback is
    // one-shot, so the commit block having already called it is harmless.
    ignore.rollback();
    throw e;
  } finally {
    rmSync(staging, { recursive: true, force: true });
    // Staging had to live inside the store, so on a scope that had none this
    // operation created `.agents/`, `.agents/capabilities/` and `installed/`.
    // A refused or failed acquisition must leave the scope untouched, so undo
    // exactly those — deepest-first, only while empty, never a pre-existing one.
    pruneCreatedAnchors(createdAnchors);
  }
}

/** Transactional package update (contract §5.5): re-resolve the closure from the
 * row's ORIGINAL spec (or opts.spec), validate everything in staging, then
 * replace ALL of that package's exported capability artifacts and lock rows
 * together.
 *
 * Trust survives only for capabilities whose new artifact is byte-identical
 * (acquirePackage carries it over on exactly that condition). Exports that no
 * longer exist are retired ONLY when safe — no config in the chain references
 * them — otherwise the whole update fails `remove-blocked` BEFORE anything is
 * fetched or replaced. */
export function updatePackage(level, packageId, opts = {}) {
  const own = levelLockRows(level); // full-scope strict validation before acting
  const entry = own.packages[packageId];
  if (!entry) throw oatsError("unknown-capability", `package "${packageId}" is not locked in ${join(level, OATS_LOCK_FILE)}`);
  const src = parseLockSource(entry.source);
  // Re-resolve from the un-pinned identity: catalog id (fresh selector), git url
  // at its recorded ref (tags may move; unpinned = default branch), or path. The
  // SELECTED ROOT round-trips differently per source kind: a git spec's path is
  // the user's own selection, so it is re-appended and stays sticky across
  // updates; a catalog entry OWNS its path, so an update deliberately re-reads it
  // and may adopt a moved root (reported below).
  if (opts.spec && src.kind !== "catalog") throw oatsError("invalid-source", `package "${packageId}" is locked from a ${src.kind} source; a selector (--to) applies to catalog-sourced packages only (its source is ${entry.source})`);
  if (opts.spec && parsePackageSource(opts.spec).id !== src.id) throw oatsError("invalid-source", `selector spec "${opts.spec}" names a different catalog package than the lock's ${src.id}`);
  const spec = opts.spec || (src.kind === "catalog" ? (src.selector ? `${src.id}@${src.selector}` : src.id)
    : src.kind === "git" ? `${src.ref && !/^[0-9a-f]{40}$/.test(src.ref) ? `${src.url}@${src.ref}` : src.url}#${entry.path}`
      : src.path);
  const beforeCaps = Object.entries(own.capabilities).filter(([, r]) => r.package === packageId).map(([cid, r]) => ({ capability: cid, ...r }));
  const before = {
    version: entry.version, commit: entry.commit, integrity: entry.integrity, path: entry.path,
    capabilities: beforeCaps.map((c) => c.capability).sort(),
    trustedCapabilities: beforeCaps.filter((c) => c.trusted).map((c) => c.capability).sort(),
  };
  // expectPackage makes an identity change a PRE-COMMIT failure inside
  // acquirePackage (nothing installed/locked if the source renamed itself).
  const r = acquirePackage(level, spec, { ...opts, replace: true, expectPackage: packageId });
  const after = r.installed.find((p) => p.package === packageId);
  if (!after) throw oatsError("duplicate-package-identity", `source ${spec} no longer provides package "${packageId}" (root resolved to "${r.root}")`);
  // Dropped exports were retired INSIDE the acquire transaction — their lock
  // rows and their artifacts moved together, so there is nothing to clean up
  // here and no post-commit window in which the two could disagree.
  const removedCapabilities = before.capabilities.filter((c) => !after.capabilities.includes(c));
  const changed = after.integrity !== before.integrity;
  return {
    package: packageId, level, changed, pathChanged: after.path !== before.path, before, after,
    installed: r.installed, capabilities: r.capabilities, configTemplates: r.configTemplates,
    addedCapabilities: after.capabilities.filter((c) => !before.capabilities.includes(c)),
    removedCapabilities, retiredArtifacts: removedCapabilities,
    invalidatedApprovals: before.trustedCapabilities.filter((c) => !r.capabilities.some((p) => p.capability === c && p.trusted)),
  };
}
