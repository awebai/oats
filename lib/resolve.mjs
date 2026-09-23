/**
 * lib/resolve.mjs — from a soul to an immutable resolution (module contract §3).
 *
 * Contract: docs/design/2026-09-23-workspace-module-contracts.md §3.
 * Decision: agents/oats-expert/soul/knowledge/decisions/workspace-model-v2.md (6, 12, 14, 16, 19–21).
 *
 * `resolveSoul(discovery, soulEntry, options)` turns a discovered soul into the
 * exact set of modules an instance will be built from: which capability comes
 * from where (a confirmed member at its latest commit, or a locked package at
 * its pinned commit), which module fills each fundamental slot, the merged
 * provider payload per capability, the composed skill set, the injects, and a
 * `revision` that changes whenever any of that changes.
 *
 * Resolution is a handshake check plus a lookup — never a search:
 *   - `from: here`      → the soul's own repo.
 *   - `from: <repo>`    → a CONFIRMED member (E_NOT_A_MEMBER) that lists the capability under
 *                         capabilities/<name>/oats.json (E_CAPABILITY_MISSING); a private capability
 *                         is usable only from its own repo (E_CAPABILITY_PRIVATE). It NEVER looks
 *                         inside the repo's oats-package/ (non-collapse rule): a name that exists only
 *                         there fails with details.hint "provided by package <id>; use from: package".
 *   - `from: package`   → the lock's packageProviding(name) (E_PACKAGE_MISSING), approved
 *                         (E_PACKAGE_UNAPPROVED). It NEVER looks at member capabilities, even when the
 *                         package's repo is a member.
 *
 * Composition order (soul wins; `off` removes):
 *   workspace.defaults.{knowledge,messaging,tasks} (slot defaults; a soul `none` drops them)
 *   ⊕ workspace.defaults.capabilities ⊕ workspace.defaults.byTeam[soul.team].capabilities
 *   ⊕ soul.capabilities
 *
 * Payloads (decision 14), later wins on scalars/arrays, objects deep-merge:
 *   workspace.messaging (messaging slot only) ⊕ soul.<slot> ⊕ local.settings[cap] ⊕ spawn.providers[cap]
 *
 * This module shells out to nothing. Remote access is injected (`remote`, default
 * lib/remote.mjs; `remoteOptions` threaded into every call). `resolveSoul` is
 * `async` because member skill trees and package capability manifests are read
 * over the remote; everything else is pure and exported for direct testing.
 */
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { oatsError as baseOatsError } from "./errors.mjs";
import * as defaultRemote from "./remote.mjs";
import { bindRemote, packageProviding, readPackageManifests, validateLock } from "./packages.mjs";

export const RESOLUTION_API = 1;
export const SLOTS = Object.freeze(["knowledge", "messaging", "tasks"]);
const CONTRACT_DOC = "docs/design/2026-09-23-workspace-module-contracts.md";

/* ───────────────────────────── helpers ────────────────────────────────── */

/** oatsError with `details` readable as both e.provenance (today) and e.details (the contract). */
function fail(code, message, details) {
  const e = baseOatsError(code, message, details);
  if (details !== undefined) e.details = details;
  return e;
}
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const show = (v) => JSON.stringify(v);
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const short = (oid) => String(oid || "").slice(0, 12);

/** Keys a payload may never carry: `__proto__` as an own key (yaml/JSON produce it) would set the
 * prototype of the merged object — a value invisible to JSON/canonicalJson (so the recorded payload
 * and the revision look clean) yet visible to every in-process property read. Refused, never skipped. */
const POISON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function assertPayloadKeys(value, path) {
  if (Array.isArray(value)) { value.forEach((v, i) => assertPayloadKeys(v, `${path}/${i}`)); return; }
  if (!isObject(value)) return;
  for (const k of Object.keys(value)) {
    if (POISON_KEYS.has(k)) throw fail("E_WORKSPACE_SCHEMA", `provider payload key ${show(k)} at ${path || "/"} is refused (it would poison the merged payload's prototype)`, { path: `${path}/${k}`, key: k, reason: "poison-key" });
    assertPayloadKeys(value[k], `${path}/${k}`);
  }
}

/** Deep-merge provider payloads: plain objects merge recursively; arrays and scalars — later wins.
 * Payload keys `__proto__` / `constructor` / `prototype` (at any depth) → E_WORKSPACE_SCHEMA. */
export function mergePayload(...layers) {
  let out = {};
  for (const layer of layers) {
    if (layer === undefined || layer === null) continue;
    if (!isObject(layer)) throw new TypeError(`a provider payload must be an object, got ${typeof layer}`);
    assertPayloadKeys(layer, "");
    out = mergeInto(out, layer);
  }
  return out;
}
function mergeInto(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    if (POISON_KEYS.has(k)) throw fail("E_WORKSPACE_SCHEMA", `provider payload key ${show(k)} is refused`, { key: k, reason: "poison-key" });
    out[k] = isObject(v) && isObject(out[k]) ? mergeInto(out[k], v) : clone(v);
  }
  return out;
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Canonical JSON: object keys sorted (recursively), arrays in order, no whitespace. */
export function canonicalJson(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort(byCodepoint).map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

/** revision = sha256(canonical JSON)[0:24] — the fingerprint a spawn decision embeds. */
export function revisionOf(body) {
  return createHash("sha256").update(canonicalJson(body)).digest("hex").slice(0, 24);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** A repo ref lib/remote.mjs can open for a canonical key ("<host>/<path>" | "local/<abs>"). */
export function refForKey(key) {
  if (typeof key !== "string" || !key) throw fail("E_REPO_REF", `not a repo key: ${show(key)}`, { key });
  return key.startsWith("local/") ? key.slice("local/".length) : `git:${key}`;
}

function remoteOf({ remote, remoteOptions } = {}) {
  const r = remote ?? defaultRemote;
  for (const name of ["parseRepoRef", "readRemoteFile", "listRemoteTree"]) {
    if (typeof r?.[name] !== "function") throw new TypeError(`remote must provide ${name}() (module contract §1)`);
  }
  return bindRemote(r, remoteOptions);
}

/* ───────────────────────────── semver-ish ranges ──────────────────────── */

const VERSION_RE = /^v?(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** "v2.1.3-rc.1+build" → { major, minor, patch, prerelease: ["rc", 1] } | null. */
export function parseVersion(text) {
  const m = typeof text === "string" && VERSION_RE.exec(text.trim());
  if (!m) return null;
  const num = (s) => (s === undefined || /^[xX*]$/.test(s) ? 0 : Number(s));
  return {
    major: Number(m[1]), minor: num(m[2]), patch: num(m[3]),
    prerelease: m[4] ? m[4].split(".").map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}
function compareVersions(a, b) {
  for (const k of ["major", "minor", "patch"]) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;   // a release outranks any prerelease of the same triple
  if (b.prerelease.length === 0) return -1;
  const n = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < n; i++) {
    const x = a.prerelease[i], y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x < y ? -1 : 1;
    if (typeof x === "number") return -1;    // numeric identifiers rank below alphanumeric ones
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

const COMPARATOR_RE = /^(>=|<=|>|<|=|\^|~)?(.+)$/;
/** One comparator → [{ op, version }] (a partial or ^/~ form expands to a lower and upper bound). */
function expandComparator(token) {
  if (token === "*" || token === "" || /^[xX]$/.test(token)) return [];
  const m = COMPARATOR_RE.exec(token);
  if (!m) return null;
  const op = m[1] || "";
  const raw = m[2];
  const parts = VERSION_RE.exec(raw.replace(/^v/, ""));
  if (!parts) return null;
  const v = parseVersion(raw);
  const hasMinor = parts[2] !== undefined && !/^[xX*]$/.test(parts[2]);
  const hasPatch = parts[3] !== undefined && !/^[xX*]$/.test(parts[3]);
  const bump = (major, minor, patch) => ({ major, minor, patch, prerelease: [] });
  const lower = { op: ">=", version: v };
  if (op === "^") {
    const upper = v.major > 0 || !hasMinor ? bump(v.major + 1, 0, 0) : v.minor > 0 || !hasPatch ? bump(0, v.minor + 1, 0) : bump(0, 0, v.patch + 1);
    return [lower, { op: "<", version: upper }];
  }
  if (op === "~") return [lower, { op: "<", version: hasMinor ? bump(v.major, v.minor + 1, 0) : bump(v.major + 1, 0, 0) }];
  if (op === "" || op === "=") {
    if (hasMinor && hasPatch) return [{ op: "=", version: v }];
    return [lower, { op: "<", version: hasMinor ? bump(v.major, v.minor + 1, 0) : bump(v.major + 1, 0, 0) }];
  }
  if (!hasMinor || !hasPatch) {
    // >=1.2 → >=1.2.0 ; <1.2 → <1.2.0 ; >1.2 → >=1.3.0 ; <=1.2 → <1.3.0
    const next = hasMinor ? bump(v.major, v.minor + 1, 0) : bump(v.major + 1, 0, 0);
    if (op === ">") return [{ op: ">=", version: next }];
    if (op === "<=") return [{ op: "<", version: next }];
  }
  return [{ op, version: v }];
}
const OPS = {
  ">=": (c) => c >= 0, ">": (c) => c > 0, "<=": (c) => c <= 0, "<": (c) => c < 0, "=": (c) => c === 0,
};

/**
 * Does `version` satisfy `range`? Supports `>=`, `>`, `<=`, `<`, `=`, `^`, `~`, exact, partial
 * (`1.2`), `*`, whitespace-AND and `||`-OR. No dependency. Throws E_COMPATIBILITY { why: "range" }
 * for an unparseable range and { why: "version" } for an unparseable version.
 */
export function satisfiesRange(version, range) {
  const v = parseVersion(version);
  if (!v) throw fail("E_COMPATIBILITY", `cannot compare ${show(version)}: not a version`, { why: "version", version, range });
  if (typeof range !== "string") throw fail("E_COMPATIBILITY", `not a version range: ${show(range)}`, { why: "range", range });
  const alternatives = range.split("||").map((alt) => alt.trim());
  for (const alt of alternatives) {
    const tokens = alt.length ? alt.split(/\s+/) : [""];
    const comparators = [];
    for (const token of tokens) {
      const expanded = expandComparator(token);
      if (expanded === null) throw fail("E_COMPATIBILITY", `not a version range: ${show(range)} (at ${show(token)})`, { why: "range", range, token });
      comparators.push(...expanded);
    }
    if (comparators.every((c) => OPS[c.op](compareVersions(v, c.version)))) return true;
  }
  return false;
}

/* ───────────────────────────── composition ────────────────────────────── */

const choiceOf = (value, path, via) => {
  if (value === "off") return "off";
  if (isObject(value) && typeof value.from === "string" && value.from) {
    // `here` has a referent only in a soul (its own repo); a workspace default would mean a different repo per soul.
    if (value.from === "here" && via !== "soul") throw fail("E_WORKSPACE_SCHEMA", `${path}/from: "here" is only meaningful in a soul; a workspace default names a repo key or package`, { path: `${path}/from`, value: value.from });
    return { from: value.from };
  }
  throw fail("E_WORKSPACE_SCHEMA", `${path} must be { from: <location> } or "off", got ${show(value)}`, { path, value });
};

/**
 * The ordered capability map of a soul BEFORE any lookup:
 *   slot defaults (dropped where the soul says `none`) ⊕ defaults.capabilities ⊕ defaults.byTeam[team] ⊕ soul.capabilities
 * → [{ name, from, via }] sorted by name; `off` removes the entry from every lower layer.
 * `via` is one of "defaults.<slot>" | "defaults.capabilities" | "defaults.byTeam.<team>" | "soul".
 */
export function composeCapabilities(workspace, soulDefinition, { team = null } = {}) {
  const map = new Map();
  const apply = (entries, via, path) => {
    for (const [name, value] of Object.entries(entries || {})) {
      const choice = choiceOf(value, `${path}/${name}`, via);
      if (choice === "off") map.delete(name);
      else map.set(name, { name, from: choice.from, via });
    }
  };
  const defaults = isObject(workspace?.defaults) ? workspace.defaults : {};
  for (const slot of SLOTS) {
    const d = defaults[slot];
    if (soulDefinition?.[slot] === "none" || d === "none" || !isObject(d)) continue;
    const names = Object.keys(d);
    if (names.length > 1) throw fail("E_WORKSPACE_SCHEMA", `defaults.${slot} names ${names.length} capabilities; a slot default names at most one`, { path: `/defaults/${slot}`, names });
    apply(d, `defaults.${slot}`, `/defaults/${slot}`);
  }
  apply(defaults.capabilities, "defaults.capabilities", "/defaults/capabilities");
  if (team !== null && isObject(defaults.byTeam) && isObject(defaults.byTeam[team])) {
    apply(defaults.byTeam[team].capabilities, `defaults.byTeam.${team}`, `/defaults/byTeam/${team}/capabilities`);
  }
  apply(soulDefinition?.capabilities, "soul", "/capabilities");
  return [...map.values()].sort((a, b) => byCodepoint(a.name, b.name));
}

/* ───────────────────────────── lookups ────────────────────────────────── */

function memberRow(discovery, repoKey) {
  return (discovery?.members || []).find((m) => m.key === repoKey) || null;
}

/** The ref the workspace lists a member under (keeps the operator's spelling: ssh vs https); else from the key. */
function memberRef(discovery, remote, repoKey) {
  for (const ref of discovery?.workspace?.members || []) {
    try { if (remote.parseRepoRef(ref).key === repoKey) return ref; } catch { /* validated upstream */ }
  }
  return refForKey(repoKey);
}

/** Resolve `from: <repo>` (or `here`) against member capabilities only — the non-collapse rule. */
function lookupMember(discovery, soul, name, from, via, lock) {
  const repoKey = from === "here" ? soul.repoKey : from;
  const row = memberRow(discovery, repoKey);
  const where = { capability: name, from, repoKey, soul: soul.name, via };
  const standaloneOwn = discovery?.standalone === true && repoKey === soul.repoKey && row !== null;
  if (!row) {
    const ws = discovery?.key ? ` ${discovery.key}` : "";
    throw fail("E_NOT_A_MEMBER", `${name}: ${from === "here" ? `here (${repoKey})` : repoKey} is not a member of the workspace${ws} — a capability comes from a confirmed member or from a package`, { ...where, reason: "not-listed" });
  }
  if (!row.confirmed && !standaloneOwn) {
    throw fail("E_NOT_A_MEMBER", `${name}: ${repoKey} is listed but not confirmed (${row.reason || "unconfirmed"}${row.detail ? `: ${row.detail}` : ""})`, { ...where, reason: row.reason || "unconfirmed", detail: row.detail });
  }
  const cap = (row.capabilities || []).find((c) => c.name === name) || null;
  if (!cap) {
    const details = { ...where, commit: row.commit };
    // The name may live in a package tier: say so, but never resolve it from here (decision 19).
    const providing = safePackageProviding(lock, name);
    let hint = null;
    if (providing) hint = `provided by package ${providing.id}; use from: package`;
    else if (row.publishes?.package) hint = `${repoKey} publishes package ${row.publishes.package}; a capability under oats-package/ is package-tier — pin the package in packages: and use from: package`;
    throw fail("E_CAPABILITY_MISSING", `${name}: ${repoKey}@${short(row.commit)} has no capabilities/${name}/oats.json${hint ? ` (${hint})` : ""}`, hint ? { ...details, hint } : details);
  }
  if (cap.private && cap.repoKey !== soul.repoKey) {
    throw fail("E_CAPABILITY_PRIVATE", `${name}: ${repoKey} marks it private; it is usable only by souls of ${repoKey} (this soul lives in ${soul.repoKey})`, { ...where, owner: repoKey, soulRepo: soul.repoKey });
  }
  return { row, cap };
}
function safePackageProviding(lock, name) {
  if (!isObject(lock)) return null;
  try { return packageProviding(lock, name); } catch { return null; }
}

/** Resolve `from: package` through the lock only — never through member capabilities. */
function lookupPackage(lock, name, via, soul) {
  const where = { capability: name, from: "package", soul: soul.name, via };
  if (!isObject(lock) || !isObject(lock.packages)) throw fail("E_PACKAGE_MISSING", `${name}: from: package needs the workspace lock (oats-lock.json v3) — run \`oats sync\``, { ...where, reason: "no-lock" });
  const providing = packageProviding(lock, name);
  if (!providing) throw fail("E_PACKAGE_MISSING", `${name}: no locked package provides it — add the package to packages: and run \`oats sync\``, { ...where, locked: Object.keys(lock.packages).sort() });
  if (!providing.entry.approved || !isObject(providing.entry.approved) || typeof providing.entry.approved.executables !== "string" || !/^sha256-[0-9a-f]{64}$/.test(providing.entry.approved.executables)) {
    throw fail("E_PACKAGE_UNAPPROVED", `${name}: package ${providing.id} v${providing.entry.version} (${short(providing.entry.commit)}) is not approved — review its executables and approve once per version`, { ...where, id: providing.id, version: providing.entry.version, commit: providing.entry.commit });
  }
  return providing;
}

/** The repo ref a locked package is read from: the lock's recorded url, else the catalog's url for catalog ids, else the key for git refs. */
function packageRef(id, entry, catalog, remote) {
  const cat = isObject(catalog) ? (isObject(catalog.packages) && !("url" in catalog.packages) ? catalog.packages : catalog) : {};
  if (entry.source === `catalog:${id}`) {
    if (typeof entry.url === "string" && entry.url) return entry.url;
    const c = cat[id];
    if (isObject(c) && typeof c.url === "string") return c.url;
    throw fail("E_PACKAGE_MISSING", `${id}: locked from the catalog, but neither the lock (url) nor a catalog entry says which repo to read it from — run \`oats sync\` (lock v3 records url) or pass { catalog } to resolveSoul`, { id, source: entry.source, reason: "no-catalog" });
  }
  const m = /^git:(.+)@([^@]+)$/.exec(entry.source);
  if (!m) throw fail("E_LOCK_SCHEMA", `${id}: lock source ${show(entry.source)} is neither catalog:<id> nor git:<key>@<ref>`, { id, source: entry.source });
  const key = m[1];
  const ref = refForKey(key);
  remote.parseRepoRef(ref); // E_REPO_REF for a smuggled key
  return ref;
}

/* ───────────────────────────── skills ─────────────────────────────────── */

const SAFE_REL = (rel) => typeof rel === "string" && rel && !posix.isAbsolute(rel) && !/^[\\/]/.test(rel) && !/\0/.test(rel) && !rel.split(/[\\/]/).some((p) => p === "..");

/** Normalize a manifest-declared relative path ("./skills/x/" → "skills/x"); null when unsafe. */
function declaredPath(rel) {
  if (!SAFE_REL(rel)) return null;
  const n = posix.normalize(rel).replace(/\/+$/, "");
  return n === "." || n === "" || n.startsWith("../") ? null : n;
}

/**
 * Skills declared by a manifest: each `skills[]` entry is a directory under the capability that either
 * IS a skill (holds SKILL.md) or holds skill directories (<entry>/<skill>/SKILL.md) — the same reading
 * the 0.24 kernel applied. `listing` is a listRemoteTree()-shaped array RELATIVE TO THE ENTRY.
 * → [{ name, path }] with path relative to the capability directory.
 */
export function skillsInListing(declared, listing) {
  const out = [];
  const blobs = new Set((listing || []).filter((e) => e.type === "blob").map((e) => e.path));
  if (blobs.has("SKILL.md")) return [{ name: posix.basename(declared), path: declared }];
  for (const p of [...blobs].sort(byCodepoint)) {
    const m = /^([^/]+)\/SKILL\.md$/.exec(p);
    if (m) out.push({ name: m[1], path: posix.join(declared, m[1]) });
  }
  return out;
}

/** Enumerate the skills of one module over the remote (or a discovery-provided listing). */
async function enumerateSkills({ remote, ref, commit, dir, manifest, listing, moduleName, missing }) {
  const declaredList = Array.isArray(manifest.skills) ? manifest.skills : [];
  const skills = [];
  for (const raw of declaredList) {
    const declared = declaredPath(raw);
    if (!declared) throw missing(raw, "unsafe", `declares skills entry ${show(raw)}, which is not a relative path inside the capability`);
    let entries;
    if (Array.isArray(listing)) {
      // Discovery already listed the capability directory (relative to it): project onto this entry.
      entries = listing.filter((e) => e.path === declared || e.path.startsWith(`${declared}/`)).map((e) => ({ ...e, path: e.path === declared ? "" : e.path.slice(declared.length + 1) })).filter((e) => e.path);
    } else {
      entries = await remote.listRemoteTree(ref, commit, posix.join(dir, declared), { depth: 2 });
    }
    const found = skillsInListing(declared, entries);
    if (found.length === 0) throw missing(raw, "skill-missing", `declares skills entry ${show(raw)} but no SKILL.md is there (neither ${declared}/SKILL.md nor ${declared}/*/SKILL.md)`);
    for (const s of found) skills.push({ module: moduleName, name: s.name, path: s.path });
  }
  return skills;
}

/* ───────────────────────────── resolveSoul ────────────────────────────── */

/**
 * From a discovered soul to an immutable Resolution.
 *
 * discovery: discoverWorkspace(...) output (or standaloneRepo(...) output — from:here only).
 * soulEntry: one of discovery.members[].souls[] or discovery.external[].soul
 *            ({ name, path, repoKey, commit, team, private, definition }).
 * options:   { local, lock, spawn = { providers? }, catalog, remote, remoteOptions }
 *            `catalog` (package-catalog.json shape) tells which repo a `catalog:<id>` lock entry is read from.
 *
 * → Resolution { resolutionApi: 1, soul, modules[], slots, payloads, skills[], injects[], revision } — deep-frozen.
 * Extra fields beyond the contract (recorded for materialize): module.dir (capability dir, repo-relative)
 * and from.repoKey on package modules.
 */
export async function resolveSoul(discovery, soulEntry, { local = null, lock = null, spawn = {}, catalog = null, remote: injected, remoteOptions } = {}) {
  if (!isObject(soulEntry) || typeof soulEntry.name !== "string" || typeof soulEntry.repoKey !== "string") {
    throw new TypeError("resolveSoul: soulEntry must be a discovery SoulEntry { name, path, repoKey, commit, team, private, definition }");
  }
  if (!isObject(spawn)) throw new TypeError("resolveSoul: spawn must be an object");
  if (lock !== null && lock !== undefined) validateLock(lock); // E_LOCK_SCHEMA: a lock passed in memory meets the same bar as one read from disk
  const remote = remoteOf({ remote: injected, remoteOptions });
  const workspace = isObject(discovery?.workspace) ? discovery.workspace : null;
  assertSoulDiscovered(discovery, soulEntry);
  const definition = isObject(soulEntry.definition) ? soulEntry.definition : {};
  const team = typeof soulEntry.team === "string" ? soulEntry.team : null;
  const soul = { name: soulEntry.name, repoKey: soulEntry.repoKey, commit: soulEntry.commit ?? null, team, path: soulEntry.path ?? null };

  // Standalone: the soul's own repo only, workspace defaults unknown (decision 10).
  const declared = discovery?.standalone === true
    ? composeCapabilities(null, { ...definition, capabilities: soulEntry.capabilities ?? definition.capabilities }, { team })
    : composeCapabilities(workspace, definition, { team });

  const modules = [];
  const skills = [];
  const injects = [];
  for (const { name, from, via } of declared) {
    let module;
    if (from === "package") {
      const { id, entry } = lookupPackage(lock, name, via, soul);
      const ref = packageRef(id, entry, catalog, remote);
      const details = { capability: name, id, version: entry.version, commit: entry.commit, path: entry.path };
      const { capabilities } = await readPackageManifests(remote, ref, entry.commit, entry.path, details);
      const cap = capabilities.find((c) => c.name === name);
      if (!cap) throw fail("E_PACKAGE_INTEGRITY", `${name}: the lock says package ${id} v${entry.version} provides it, but ${entry.path}/oats-package.json at ${short(entry.commit)} does not`, { ...details, listed: capabilities.map((c) => c.name) });
      module = {
        name, from: { kind: "package", package: id, version: entry.version, commit: entry.commit, integrity: entry.integrity, repoKey: remote.parseRepoRef(ref).key },
        manifest: clone(cap.manifest), layer: layerOf(cap.manifest), private: cap.manifest.private === true, dir: cap.dir,
      };
      const missing = (raw, why, text) => fail("E_PACKAGE_MANIFEST", `${name} (package ${id} v${entry.version}) ${text}`, { ...details, skill: raw, why });
      skills.push(...await enumerateSkills({ remote, ref, commit: entry.commit, dir: cap.dir, manifest: cap.manifest, moduleName: name, missing }));
    } else {
      const { row, cap } = lookupMember(discovery, soul, name, from, via, lock);
      const ref = memberRef(discovery, remote, cap.repoKey);
      module = {
        name, from: { kind: "member", repoKey: cap.repoKey, commit: cap.commit ?? row.commit },
        manifest: clone(cap.manifest), layer: layerOf(cap.manifest), private: cap.private === true, dir: cap.path,
      };
      const missing = (raw, why, text) => fail("E_CAPABILITY_MISSING", `${name} (${cap.repoKey}@${short(module.from.commit)}) ${text}`, { capability: name, repoKey: cap.repoKey, commit: module.from.commit, skill: raw, why });
      skills.push(...await enumerateSkills({ remote, ref, commit: module.from.commit, dir: cap.path, manifest: cap.manifest, listing: cap.listing, moduleName: name, missing }));
    }
    if (typeof module.manifest.inject === "string" && module.manifest.inject) {
      const inject = declaredPath(module.manifest.inject);
      if (!inject) throw fail(module.from.kind === "package" ? "E_PACKAGE_MANIFEST" : "E_CAPABILITY_MISSING", `${name} declares inject ${show(module.manifest.inject)}, which is not a relative path inside the capability`, { capability: name, inject: module.manifest.inject, why: "unsafe" });
      injects.push({ module: name, path: inject });
    }
    modules.push(module);
  }

  // Slots (decision: a resolved capability whose manifest has layer X fills slot X; two → conflict; soul `none` empties).
  const slots = { knowledge: null, messaging: null, tasks: null };
  const viaOf = new Map(declared.map((d) => [d.name, d.via]));
  for (const m of modules) {
    const via = viaOf.get(m.name);
    const slotDefault = typeof via === "string" && via.startsWith("defaults.") && SLOTS.includes(via.slice("defaults.".length)) ? via.slice("defaults.".length) : null;
    // A slot default must fill THAT slot: its manifest's layer is the slot (contract §3 "else workspace default").
    if (slotDefault && m.layer !== slotDefault) {
      throw fail("E_SLOT_CONFLICT", `slot ${slotDefault}: defaults.${slotDefault} names ${m.name}, whose manifest declares layer ${m.layer ? show(m.layer) : "none"} — a slot default must be a ${slotDefault}-layer capability`, { slot: slotDefault, modules: [m.name], soul: soul.name, reason: "layer-mismatch", layer: m.layer });
    }
    if (!m.layer) continue;
    if (slots[m.layer]) throw fail("E_SLOT_CONFLICT", `slot ${m.layer}: both ${slots[m.layer]} and ${m.name} declare layer ${m.layer}; a soul fills each slot with at most one capability`, { slot: m.layer, modules: [slots[m.layer], m.name], soul: soul.name });
    if (definition[m.layer] === "none") throw fail("E_SLOT_CONFLICT", `slot ${m.layer}: the soul says ${m.layer}: none but names ${m.name}, which declares layer ${m.layer}`, { slot: m.layer, modules: [m.name], soul: soul.name, reason: "none" });
    slots[m.layer] = m.name;
  }

  // Duplicate skill names within the composed set (decision 16).
  const seenSkills = new Map();
  for (const s of skills) {
    if (seenSkills.has(s.name)) {
      const prior = seenSkills.get(s.name);
      throw fail("E_SKILL_DUPLICATE", `skill ${show(s.name)} is contributed by both ${prior.module} (${prior.path}) and ${s.module} (${s.path})`, { name: s.name, modules: [prior.module, s.module], paths: [prior.path, s.path], soul: soul.name });
    }
    seenSkills.set(s.name, s);
  }

  // Payloads (decision 14): workspace.messaging (messaging slot) ⊕ soul.<slot> ⊕ local.settings[cap] ⊕ spawn.providers[cap].
  const settings = isObject(local?.settings) ? local.settings : {};
  const providers = isObject(spawn.providers) ? spawn.providers : {};
  const moduleNames = new Set(modules.map((m) => m.name));
  for (const [cap, value] of Object.entries(providers)) {
    if (!isObject(value)) throw new TypeError(`spawn.providers.${cap} must be an object`);
    if (!moduleNames.has(cap)) throw fail("E_CAPABILITY_MISSING", `--provider ${cap}: the soul ${soul.name} does not resolve a capability named ${show(cap)} (modules: ${[...moduleNames].sort().join(", ") || "none"})`, { capability: cap, soul: soul.name, hint: "a provider payload targets one of the soul's resolved capabilities", modules: [...moduleNames].sort() });
  }
  const payloads = {};
  for (const m of modules) {
    const layers = [];
    if (m.layer === "messaging" && isObject(workspace?.messaging)) layers.push(workspace.messaging);
    if (m.layer && isObject(definition[m.layer])) layers.push(definition[m.layer]);
    if (isObject(settings[m.name])) layers.push(settings[m.name]);
    if (isObject(providers[m.name])) layers.push(providers[m.name]);
    payloads[m.name] = mergePayload(...layers);
  }

  // Compatibility floors (soul.compatibility) are constraints on PACKAGE versions.
  for (const [cap, range] of Object.entries(isObject(definition.compatibility) ? definition.compatibility : {})) {
    const m = modules.find((x) => x.name === cap);
    if (!m || m.from.kind !== "package") continue;
    const where = { capability: cap, package: m.from.package, version: m.from.version, range, soul: soul.name };
    // A git:<repo>@<OID> package carries the OID as its version: unversioned, so no floor can be met (even an all-digit OID).
    if (/^[0-9a-f]{40}$/i.test(String(m.from.version)) || !parseVersion(m.from.version)) {
      throw fail("E_COMPATIBILITY", `${cap}: package ${m.from.package} is pinned at ${show(m.from.version)}, which is not a version — the soul's floor ${show(range)} cannot be checked; pin a tagged version in packages.${m.from.package}`, { ...where, why: "unversioned" });
    }
    let ok;
    try { ok = satisfiesRange(m.from.version, range); }
    catch (e) { if (e?.code === "E_COMPATIBILITY") throw fail("E_COMPATIBILITY", `${cap}: ${e.message}`, { ...where, ...(e.details || {}) }); throw e; }
    if (!ok) {
      throw fail("E_COMPATIBILITY", `${cap}: package ${m.from.package} is pinned at v${m.from.version}, below the soul's floor ${show(range)} — bump packages.${m.from.package} in the workspace`, where);
    }
  }

  modules.sort((a, b) => byCodepoint(a.name, b.name));
  skills.sort((a, b) => byCodepoint(a.module, b.module) || byCodepoint(a.name, b.name));
  injects.sort((a, b) => byCodepoint(a.module, b.module));
  const body = { resolutionApi: RESOLUTION_API, soul, modules, slots, payloads, skills, injects };
  return deepFreeze({ ...body, revision: revisionOf(body) });
}

function layerOf(manifest) {
  return SLOTS.includes(manifest?.layer) ? manifest.layer : null;
}

/**
 * Membership gate (decision 1, contract §3): the soul must be one discovery actually listed — a soul of a
 * CONFIRMED member row (same repoKey, name and commit), an `external[]` soul, or (standalone) the repo's own.
 * A soul of an unconfirmed member → E_MEMBERSHIP_UNCONFIRMED { repoKey, reason }; a soul of a repo the
 * workspace does not list → E_NOT_A_MEMBER; a row that does not carry this soul → E_MEMBERSHIP_UNCONFIRMED { reason: "stale" }.
 */
function assertSoulDiscovered(discovery, soulEntry) {
  const { name, repoKey } = soulEntry;
  const where = { soul: name, repoKey };
  const sameSoul = (s) => isObject(s) && s.name === name && s.repoKey === repoKey && (s.commit ?? null) === (soulEntry.commit ?? null);
  if ((discovery?.external || []).some((e) => sameSoul(e?.soul))) return;
  const row = memberRow(discovery, repoKey);
  if (!row) throw fail("E_NOT_A_MEMBER", `soul ${name}: ${repoKey} is not a member of the workspace${discovery?.key ? ` ${discovery.key}` : ""} (nor an external soul) — a soul is spawned from a confirmed member or an external entry`, { ...where, reason: "not-listed" });
  if (!row.confirmed && !(discovery?.standalone === true)) {
    throw fail("E_MEMBERSHIP_UNCONFIRMED", `soul ${name}: ${repoKey} is listed but its membership is not confirmed (${row.reason || "unconfirmed"}${row.detail ? `: ${row.detail}` : ""}) — an unconfirmed member contributes nothing but its row`, { ...where, reason: row.reason || "unconfirmed", detail: row.detail ?? null });
  }
  if (!(row.souls || []).some(sameSoul)) {
    throw fail("E_MEMBERSHIP_UNCONFIRMED", `soul ${name}: ${repoKey}@${short(row.commit)} does not list it at that commit — the soul entry is stale or fabricated; re-run discovery`, { ...where, reason: "stale", commit: row.commit, soulCommit: soulEntry.commit ?? null });
  }
}

export { CONTRACT_DOC as RESOLVE_CONTRACT };
