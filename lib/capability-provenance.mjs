/** Existing materialized-capability data contract: layout/identity, lock-row
 * validation and installation provenance. No scope discovery, lock writes,
 * acquisition, approval, resolver or lifecycle dispatch. */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { oatsError } from "./errors.mjs";

/** Scope-relative capability store subtrees. */
export const CAPABILITIES_DIRNAME = join(".agents", "capabilities");
export const INSTALLED_SUBDIR = "installed";

/** THE identity grammar for a MATERIALIZED (revised-v2) capability.
 *
 * A materialized capability id is not merely a label: it becomes a DIRECTORY
 * NAME directly under `installed/`, so anything that can steer a filesystem
 * join must be impossible before the join happens. The grammar is deliberately
 * the package-id grammar — namespaced dots are fine, and `/`, `\`, `..`,
 * absolute forms, `@`, and percent-encoded spellings are all outside it.
 *
 * The LEGACY v1 / owned / `from: path:` grammar (loadManifestAt) stays looser
 * on purpose: those artifacts are named by `basename()` of their source, never
 * by the declared id, so the id never reaches a path there. Tightening it would
 * strand already-published standalone capabilities. */
export const CAPABILITY_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
export const isMaterializedCapabilityId = (id) => typeof id === "string" && CAPABILITY_ID_RE.test(id);
/** Why a capability id was refused, in one sentence, for every caller's own
 * typed error (the lock parser raises invalid-lock, manifest validation raises
 * invalid-package-manifest — the code each consumer already branches on). */
export const capabilityIdViolation = (id) =>
  `${JSON.stringify(id)} is not a valid capability identity — expected ${CAPABILITY_ID_RE.source} (a namespaced id such as "oats.okf"; path separators, "..", absolute paths, "@" and encoded forms are refused because the id names a directory under ${INSTALLED_SUBDIR}/)`;

/** Generated provenance file inside every materialized artifact. It is INSIDE
 * the hashed tree, so tampering with it is integrity drift; the lock stays
 * authoritative. */
export const CAPABILITY_INSTALLATION_FILE = ".oats-installation.json";

export const PACKAGE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
/** Own-property PRESENCE of any of these on a package row is forbidden
 * transitional evidence (contract §4.1) — never truthiness and never array
 * length, so an empty `capabilities: []` or a dependency-free old row still
 * classifies. Package-row `path`/`dependencies` are NEVER tells: the current
 * shape retains both. */
export const TRANSITIONAL_ROW_FIELDS = ["capabilities", "trustedCapabilities", "depsIntegrity"];

/** Normalize a configured package path to its canonical form, or throw.
 *
 * Canonical form is a POSIX-relative path with no redundant or trailing
 * separators; every spelling of the repository root ("", ".", "./", "./.")
 * normalizes to the single canonical "." so a root selection round-trips
 * identically through spec → lock → JSON → doctor/list/update (contract §4).
 *
 * Fail-closed: absolute paths, Windows drive paths, host-ambient "~" spellings,
 * backslash separators (ambiguous — a backslash is a legal POSIX filename
 * character, so accepting it as a separator would make containment checks
 * disagree with the filesystem) and NUL are rejected as invalid-source; ".."
 * traversal is path-escape. Returns undefined ONLY for an absent value, so the
 * caller can apply the source-appropriate default. */
export function normalizePackagePath(raw, { where = "package path", code = "invalid-source" } = {}) {
  // ABSENT means absent. A present `null` (JSON's way of spelling a malformed
  // value) is a violation, not a fall-through to the caller's default — a
  // catalog entry that says `"path": null` must fail, not silently install
  // DEFAULT_PACKAGE_PATH.
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") throw oatsError(code, `${where} must be a string (got ${Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw})`);
  const s = raw.trim();
  if (s.includes("\0")) throw oatsError(code, `${where} contains a NUL byte`);
  if (s.startsWith("~")) throw oatsError(code, `${where} "${s}" is a host-ambient path — package paths are repository-relative`);
  if (s.includes("\\")) throw oatsError(code, `${where} "${s}" uses backslashes — package paths are POSIX-relative (use "/")`);
  if (/^[A-Za-z]:[/\\]/.test(s)) throw oatsError(code, `${where} "${s}" is an absolute drive path — package paths are repository-relative`);
  if (isAbsolute(s)) throw oatsError(code, `${where} "${s}" is absolute — package paths are repository-relative`);
  const segments = s.split("/").filter((seg) => seg !== "" && seg !== ".");
  if (segments.includes("..")) throw oatsError("path-escape", `${where} "${s}" escapes the source root with ".."`);
  return segments.length ? segments.join("/") : ".";
}

/** Parse a lock entry's `source` against the EXACT normalized grammar the
 * writer produces. Strict on purpose: `updatePackage` turns this back into a
 * source spec, so a payload that merely "starts with catalog:" but is not a
 * valid catalog id gets RECLASSIFIED downstream — `catalog:../evil` would be
 * re-parsed as a host-relative local path and acquired from the operator's
 * filesystem. A lock also never carries a `#<path>` fragment: the selected
 * root is the entry's own `path` field, and a fragment here would produce a
 * double-fragment spec on update. */
export function parseLockSource(src) {
  const s = String(src || "");
  const bad = (why) => oatsError("invalid-source", `unknown lock source "${src}" — ${why}`);
  if (s.includes("#")) throw bad(`lock sources carry no "#<path>" fragment; the selected package root is the entry's "path" field`);
  if (s.startsWith("path:")) {
    const p = s.slice(5);
    if (!p) throw bad("empty path source");
    if (!isAbsolute(p)) throw bad("path source must be an absolute directory (the writer always resolves it)");
    return { kind: "path", path: p, normalized: s };
  }
  if (s.startsWith("catalog:")) {
    const body = s.slice(8);
    // Split at the FIRST "@", mirroring the public parser's regex: the catalog
    // id grammar cannot contain "@", so everything after the first one is the
    // selector. Splitting at the LAST "@" misreads a legitimate ref spelling
    // such as `oats.okf@release@candidate` — which the writer does produce —
    // as the id `oats.okf@release`.
    const at = body.indexOf("@");
    const id = at > 0 ? body.slice(0, at) : body;
    const selector = at > 0 ? body.slice(at + 1) : undefined;
    if (!PACKAGE_ID_RE.test(id)) throw bad(`"${id}" is not a valid official catalog id`);
    if (at > 0 && !selector) throw bad("empty catalog selector");
    return { kind: "catalog", id, selector, normalized: s };
  }
  if (s.startsWith("git:")) {
    const body = s.slice(4);
    const at = body.lastIndexOf("@") > body.lastIndexOf("/") ? body.lastIndexOf("@") : -1;
    const url = at > 0 ? body.slice(0, at) : body;
    const ref = at > 0 ? body.slice(at + 1) : undefined;
    if (!url) throw bad("empty git url");
    if (at > 0 && !ref) throw bad("empty git ref");
    if (!/^(https?:\/\/|file:\/\/|git@|ssh:\/\/|git:\/\/)/.test(url)) throw bad(`"${url}" is not an http(s)/ssh/file/git URL`);
    return { kind: "git", url, ref, normalized: s };
  }
  throw oatsError("invalid-source", `unknown lock source "${src}"`);
}

/** Semantic lock-entry validation for a PACKAGE row (runtime API addendum §4):
 * source/commit pairing, canonical path, dependency references (incl. self and
 * cycle over the locked graph), digest shapes, uniqueness. Run BEFORE restore,
 * trust/approval, update/remove/migration planning, the locked-template reader,
 * and doctor/list consumption. Fails closed with code "invalid-lock" carrying
 * file/package provenance; never normalizes or auto-repairs on read. */
export function validateLockEntry(packageId, entry, allPackages = {}, opts = {}) {
  const where = opts.file ? ` (${opts.file})` : "";
  const bad = (msg) => oatsError("invalid-lock", `lock entry for package "${packageId}"${where} is invalid: ${msg}`, [{ package: packageId, file: opts.file, violation: msg }]);
  if (!entry || typeof entry !== "object") throw bad("not an object");
  for (const k of ["source", "path", "version", "commit", "integrity"]) if (!entry[k] || typeof entry[k] !== "string") throw bad(`missing ${k}`);
  // The selected package root is a STRICT separate field (contract §1.1) stored
  // in canonical form only — a lock is never normalized or repaired on read, so
  // a non-canonical spelling ("./sub", "sub/", "") is invalid, not silently
  // accepted. That is what makes the root representation round-trip.
  {
    let canonical;
    try { canonical = normalizePackagePath(entry.path, { where: "path", code: "invalid-lock" }); }
    catch (e) { throw bad(`invalid path ${JSON.stringify(entry.path)} — ${e.message}`); }
    if (canonical !== entry.path) throw bad(`path ${JSON.stringify(entry.path)} is not in canonical form (expected ${JSON.stringify(canonical)})`);
  }
  if (!/^sha256-[0-9a-f]{64}$/.test(entry.integrity)) throw bad(`malformed integrity "${entry.integrity}"`);
  // Present-but-wrong-typed optional fields are invalid — default ONLY when absent.
  // `dependencies` is ALWAYS recorded (empty array when none), so a reader never
  // has to distinguish absent from empty.
  if (!Array.isArray(entry.dependencies)) throw bad("dependencies must be an array (empty when the package has none)");
  for (const d of entry.dependencies) if (typeof d !== "string" || !PACKAGE_ID_RE.test(d)) throw bad(`dependencies contains an invalid package id ${JSON.stringify(d)}`);
  if (new Set(entry.dependencies).size !== entry.dependencies.length) throw bad("dependencies contains duplicates");
  // Package rows lock transport only. A capability list, a trust list or a
  // dependency-closure digest here is the unsupported transitional shape — the
  // central parser rejects those documents outright (contract §4.1); this is
  // the entry-level backstop for a row reaching validation another way.
  for (const gone of TRANSITIONAL_ROW_FIELDS) {
    if (Object.hasOwn(entry, gone)) throw bad(`"${gone}" is a transitional package-root field — package rows lock transport only (capabilities and trust live on capability rows)`);
  }
  let src;
  try { src = parseLockSource(entry.source); } catch { throw bad(`unrecognized source "${entry.source}"`); }
  if (src.kind === "path" && !src.path) throw bad("empty path source");
  if (src.kind === "git" && !src.url) throw bad("empty git source");
  if (src.kind === "catalog" && !src.id) throw bad("empty catalog source");
  if (src.kind === "path") {
    if (entry.commit !== "local") throw bad(`path source requires commit "local", got "${entry.commit}"`);
    // Local acquisition is exact-directory: the source string already names the
    // package root, so the only valid contained path is the root itself.
    if (entry.path !== ".") throw bad(`path source requires path "." (local sources are exact directories), got ${JSON.stringify(entry.path)}`);
  }
  else if (!/^[0-9a-f]{40}$/.test(entry.commit)) throw bad(`${src.kind} source requires an exact 40-hex commit, got "${entry.commit}"`);
  for (const d of entry.dependencies || []) {
    if (d === packageId) throw bad(`self-dependency "${d}"`);
    // Object.hasOwn: a dependency literally named "constructor"/"__proto__"
    // must not pass via Object.prototype.
    if (!Object.hasOwn(allPackages, d)) throw bad(`dependency "${d}" is not locked in the same packages map`);
  }
  // Cycle over the locked dependency graph reachable from this entry.
  const visiting = new Set();
  const visited = new Set();
  const walk = (id, chain) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw bad(`dependency cycle in the locked graph: ${[...chain, id].join(" → ")}`);
    visiting.add(id);
    const deps = Object.hasOwn(allPackages, id) && Array.isArray(allPackages[id]?.dependencies) ? allPackages[id].dependencies : [];
    for (const d of deps) if (Object.hasOwn(allPackages, d) || d === packageId) walk(d, [...chain, id]);
    visiting.delete(id); visited.add(id);
  };
  walk(packageId, []);
  return true;
}

/** Semantic validation of one CAPABILITY row against the whole document
 * (contract §4). The `package` back-reference must name a locked package: it is
 * the single provider truth, so a dangling reference would leave a materialized
 * artifact with no provenance to restore or verify it from. */
export function validateCapabilityLockEntry(capabilityId, entry, allPackages = {}, opts = {}) {
  const where = opts.file ? ` (${opts.file})` : "";
  const bad = (msg) => oatsError("invalid-lock", `capability lock entry for "${capabilityId}"${where} is invalid: ${msg}`, [{ package: capabilityId, file: opts.file, violation: msg }]);
  if (typeof capabilityId !== "string" || !capabilityId) throw bad("empty capability id");
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw bad("not an object");
  for (const k of ["version", "package", "path", "integrity"]) if (!entry[k] || typeof entry[k] !== "string") throw bad(`missing ${k}`);
  if (!PACKAGE_ID_RE.test(entry.package)) throw bad(`provider package ${JSON.stringify(entry.package)} is not a valid package identity`);
  if (!Object.hasOwn(allPackages, entry.package)) throw bad(`provider package "${entry.package}" is not locked in the same packages map`);
  {
    let canonical;
    try { canonical = normalizePackagePath(entry.path, { where: "path", code: "invalid-lock" }); }
    catch (e) { throw bad(`invalid path ${JSON.stringify(entry.path)} — ${e.message}`); }
    if (canonical !== entry.path) throw bad(`path ${JSON.stringify(entry.path)} is not in canonical form (expected ${JSON.stringify(canonical)})`);
  }
  if (!/^sha256-[0-9a-f]{64}$/.test(entry.integrity)) throw bad(`malformed integrity "${entry.integrity}"`);
  if (typeof entry.trusted !== "boolean") throw bad(`"trusted" must be a boolean (got ${JSON.stringify(entry.trusted)})`);
  return true;
}

/** Read an artifact's provenance and check it AGREES with the lock rows it was
 * projected from. Disagreement is invalid-lock: the artifact and the lock claim
 * different origins, and neither may silently win. (A modified file also fails
 * integrity, but this gives the precise diagnosis.) */
export function verifyCapabilityInstallation(dir, capabilityId, capRow, pkgRow) {
  const file = join(dir, CAPABILITY_INSTALLATION_FILE);
  if (!existsSync(file)) throw oatsError("invalid-lock", `materialized capability ${capabilityId} has no ${CAPABILITY_INSTALLATION_FILE} provenance — reproject it with \`oats install\``, [{ package: capabilityId, file }]);
  let doc;
  try { doc = JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { throw oatsError("invalid-lock", `materialized capability ${capabilityId} has malformed ${CAPABILITY_INSTALLATION_FILE}: ${e.message}`, [{ package: capabilityId, file }]); }
  const expected = {
    schemaVersion: 1, capability: capabilityId, version: capRow.version, package: capRow.package,
    packageVersion: pkgRow.version, source: pkgRow.source, commit: pkgRow.commit,
    packagePath: pkgRow.path, capabilityPath: capRow.path,
  };
  for (const [k, want] of Object.entries(expected)) {
    if (doc?.[k] !== want) throw oatsError("invalid-lock", `materialized capability ${capabilityId}: ${CAPABILITY_INSTALLATION_FILE} "${k}" is ${JSON.stringify(doc?.[k])} but the lock records ${JSON.stringify(want)}`, [{ package: capabilityId, file, violation: k }]);
  }
  return doc;
}
