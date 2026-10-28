/** lib/materialize.mjs — copy whole, compose, record (workspace model v2, module contract §5).
 *
 * Supersedes the module/skill assembly in core.mjs spawn (`prepared` copies, symlinked
 * skill sets, ambient exclusion) and the captured path's artifact store.
 *
 * materialize(resolution, home, options)
 *   For every module of the resolution: fetch its capability directory whole into
 *   <home>/.oats/modules/<name>/, verify the copy's content digest, copy its skills as
 *   FULL copies into <home>/.agents/skills/<skill>/ — FLAT, one level deep, where every
 *   harness discovers them (Claude Code through .claude/skills/<skill>/); skill names are
 *   unique across the modules (E_SKILL_DUPLICATE) — compose <home>/AGENTS.md
 *   (soul body + each module's inject, same marker comments as the kernel composer),
 *   keep the CLAUDE.md / .claude/skills aliases, and record modules + providers in
 *   <home>/instance.json.
 *
 * TRANSACTION: everything is built under <home>/.oats/.staging-<pid>-<random>/ (unique per
 * call, so two materializations of one home never share staging) and then renamed into
 * place. Any failure before the commit removes the staging directory and leaves the home
 * exactly as it was (a `.oats/` directory created only for staging is removed too). The
 * commit re-checks the home's shape (no symlink planted at .oats/.agents/.claude or the
 * module and skill targets during the fetch), then runs a short sequence of renames — modules,
 * skills, AGENTS.md, instance.json, and the CLAUDE.md / .claude/skills aliases — with a
 * rollback journal: should any step fail, everything already placed is undone and the
 * previous AGENTS.md / instance.json restored before a named error (E_MATERIALIZE_HOME)
 * propagates. A second materialization racing on the same home surfaces as
 * E_MATERIALIZE_HOME { why: "busy" }, never a raw ENOTEMPTY. stageMaterialize exposes
 * that same composer before commit, including complete-root replacement for stopped
 * homes. Its durable rename journal can finish forward after provider adoption; ordinary
 * materialize calls continue to roll back a failed commit and discard staging.
 *
 * SOURCES. A module is fetched from its repository at `from.commit` at the capability
 * directory the RESOLVER recorded (`module.dir`: the manifest-listed directory — for a
 * package, the `oats-package.json#capabilities[]` entry, which need not equal the
 * capability name: oats-package/capabilities/oats-okf → oats.okf); without `module.dir`,
 * `capabilities/<name>` (member) or `<lock.path>/capabilities/<name>` (package) is assumed.
 * A package module's `from.commit` must equal the lock entry's `commit` when a lock is
 * given (E_MATERIALIZE_INTEGRITY why:lock); the lock, when given, must be v3 (E_LOCK_SCHEMA).
 * The repository of a package is `from.repoKey` when the resolver recorded it, else the
 * lock entry's `url`, else derived from its `source` ("git:<key>@<ref>" directly;
 * "catalog:<id>" through `options.catalog[id].url`). A repository that cannot be
 * determined is E_MATERIALIZE_SOURCE — nothing is guessed.
 *
 * INTEGRITY. `fetch` returns the digest of what it wrote; `remote.contentDigest(dest)` is
 * recomputed over the bytes on disk and must agree (E_MATERIALIZE_INTEGRITY), as must
 * `module.digest` when the resolver pinned one. The verified digest is what gets recorded.
 *
 * SAFETY. Module names use the capabilityName grammar; skill directory names are single
 * safe path components; every skill/inject path resolves under its module root; symlinks
 * are never copied (the fetch already refuses them; the copy refuses them again).
 *
 * driftOf(instanceJson, discovery, { lock })
 *   Compares each recorded module with the workspace's current picture → current | moved |
 *   missing ("missing" = repo not confirmed, or the capability no longer present).
 */
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync,
  readlinkSync, rmdirSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { oatsError } from "./errors.mjs";
import * as defaultRemote from "./remote.mjs";
import { renderInstructionText } from "./instruction-composition.mjs";
import { DEFAULT_PACKAGE_PATH, validateLock } from "./packages.mjs";
import { clone, plainObject } from "./drift.mjs";
export { driftOf, soulDriftOf } from "./drift.mjs";

export const MODULES_DIR = join(".oats", "modules");
export const SKILLS_DIR = join(".agents", "skills");
const OID_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256-[0-9a-f]{64}$/;
const CAPABILITY_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
/** A single directory-entry name we are willing to create: not empty, not "."/"..", no separators/NUL. */
const SAFE_COMPONENT_RE = /^(?!\.+$)[^/\\\x00]+$/;

/** oatsError with the details reachable as BOTH e.provenance (today's field) and e.details (Phase A convention). */
function fail(code, message, details) {
  const e = oatsError(code, message, details);
  if (details) e.details = details;
  return e;
}

/* ───────────────────────────── validation ─────────────────────────────── */

function assertResolution(resolution) {
  const bad = (path, why) => fail("E_MATERIALIZE_RESOLUTION", `resolution ${path}: ${why}`, { path });
  if (!plainObject(resolution)) throw bad("/", "must be an object (lib/resolve.mjs#resolveSoul output)");
  if (resolution.resolutionApi !== 1) throw bad("/resolutionApi", `must be 1 (found ${JSON.stringify(resolution.resolutionApi)})`);
  if (!Array.isArray(resolution.modules)) throw bad("/modules", "must be an array");
  const seen = new Set();
  resolution.modules.forEach((m, i) => {
    const at = `/modules/${i}`;
    if (!plainObject(m)) throw bad(at, "must be an object");
    if (typeof m.name !== "string" || !CAPABILITY_NAME_RE.test(m.name)) throw bad(`${at}/name`, `must match ${CAPABILITY_NAME_RE} (found ${JSON.stringify(m.name)})`);
    if (seen.has(m.name)) throw bad(`${at}/name`, `duplicate module ${JSON.stringify(m.name)}`);
    seen.add(m.name);
    if (!plainObject(m.from)) throw bad(`${at}/from`, "must be an object");
    if (m.from.kind !== "member" && m.from.kind !== "package") throw bad(`${at}/from/kind`, 'must be "member" or "package"');
    if (m.from.kind === "member" && (typeof m.from.repoKey !== "string" || !m.from.repoKey)) throw bad(`${at}/from/repoKey`, "must be a repo key");
    if (m.from.kind === "package" && (typeof m.from.package !== "string" || !m.from.package)) throw bad(`${at}/from/package`, "must be a package id");
    if (typeof m.from.commit !== "string" || !OID_RE.test(m.from.commit)) throw bad(`${at}/from/commit`, "must be a full 40-hex OID");
    if (m.digest !== undefined && m.digest !== null && (typeof m.digest !== "string" || !DIGEST_RE.test(m.digest))) throw bad(`${at}/digest`, "must be sha256-<hex> when present");
    if (m.manifest !== undefined && !plainObject(m.manifest)) throw bad(`${at}/manifest`, "must be an object when present");
    if (m.dir !== undefined && m.dir !== null && (typeof m.dir !== "string" || !m.dir)) throw bad(`${at}/dir`, "must be a non-empty repo-relative path when present");
  });
  if (resolution.skills !== undefined && !Array.isArray(resolution.skills)) throw bad("/skills", "must be an array when present");
  if (resolution.injects !== undefined && !Array.isArray(resolution.injects)) throw bad("/injects", "must be an array when present");
  if (resolution.payloads !== undefined && !plainObject(resolution.payloads)) throw bad("/payloads", "must be an object when present");
  if (resolution.instructionOrder !== undefined) {
    if (!Array.isArray(resolution.instructionOrder)) throw bad("/instructionOrder", "must be an array of module names when present");
    const listed = new Set();
    resolution.instructionOrder.forEach((name, i) => {
      if (!seen.has(name)) throw bad(`/instructionOrder/${i}`, `names no module (found ${JSON.stringify(name)})`);
      if (listed.has(name)) throw bad(`/instructionOrder/${i}`, `lists module ${JSON.stringify(name)} twice`);
      listed.add(name);
    });
  }
  return resolution;
}

/** A path declared by a manifest/resolution, relative to the module root: normalized, contained. */
function modulePath(text, module, what) {
  if (typeof text !== "string" || !text.trim()) throw fail("E_MATERIALIZE_RESOLUTION", `module ${module}: ${what} path must be a non-empty string`, { module, what, path: text });
  const rel = posix.normalize(text.trim().replace(/\\/g, "/")).replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!rel || rel === "." || rel.startsWith("../") || rel === ".." || posix.isAbsolute(rel) || rel.split("/").some((c) => !SAFE_COMPONENT_RE.test(c))) {
    throw fail("E_MATERIALIZE_RESOLUTION", `module ${module}: ${what} path ${JSON.stringify(text)} does not stay inside the module`, { module, what, path: text });
  }
  return rel;
}

/* ───────────────────────────── sources ─────────────────────────────── */

/** The ref string lib/remote.mjs#parseRepoRef understands for a canonical repo key. */
export function refForKey(key) {
  if (typeof key !== "string" || !key) throw fail("E_REPO_REF", "repo key must be a non-empty string", { key });
  if (key.startsWith("local/")) return key.slice("local/".length);
  return `git:${key}`;
}

function packageRepoKey(module, entry, catalog, remote) {
  if (typeof module.from.repoKey === "string" && module.from.repoKey) return module.from.repoKey;
  if (!entry) return null;
  if (typeof entry.url === "string" && entry.url) return remote.parseRepoRef(entry.url).key;
  const source = String(entry.source || "");
  if (source.startsWith("git:")) {
    const at = source.lastIndexOf("@");
    return at > 4 ? source.slice(4, at) : source.slice(4);
  }
  if (source.startsWith("catalog:")) {
    const c = catalog?.[module.from.package];
    if (c && typeof c.url === "string" && c.url) return remote.parseRepoRef(c.url).key;
  }
  return null;
}

/** A repo-relative directory recorded by the resolver (module.dir): normalized, contained, no odd components. */
function repoRelativeDir(text, module) {
  const rel = posix.normalize(String(text).replace(/\\/g, "/")).replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!rel || rel === "." || rel === ".." || rel.startsWith("../") || posix.isAbsolute(rel) || rel.split("/").some((c) => !SAFE_COMPONENT_RE.test(c) || /^\.git$/i.test(c))) {
    throw fail("E_MATERIALIZE_RESOLUTION", `module ${module}: dir ${JSON.stringify(text)} is not a relative path inside the repository`, { module, path: text });
  }
  return rel;
}

/** Where a module is fetched from → { key, ref, commit, dir }.
 * The capability directory is the one the resolver recorded (`module.dir`, i.e. the manifest-listed
 * directory — a package's `oats-package.json#capabilities[]` entry, a member's `capabilities/<dir>`);
 * only without it is `capabilities/<name>` assumed. The two differ for real packages (oats-okf → oats.okf). */
function moduleSource(module, { lock, catalog, remote }) {
  const name = module.name, from = module.from;
  const recordedDir = typeof module.dir === "string" && module.dir ? repoRelativeDir(module.dir, name) : null;
  if (from.kind === "member") {
    return { key: from.repoKey, ref: refForKey(from.repoKey), commit: from.commit, dir: recordedDir ?? `capabilities/${name}` };
  }
  if (lock !== undefined && lock !== null) validateLock(lock); // E_LOCK_SCHEMA
  const entry = plainObject(lock?.packages) ? lock.packages[from.package] ?? null : null;
  if (entry && entry.commit !== from.commit) {
    throw fail("E_MATERIALIZE_INTEGRITY", `module ${name}: resolution pins package ${from.package} at ${from.commit} but the lock records ${entry.commit}`,
      { module: name, package: from.package, resolved: from.commit, locked: entry.commit, why: "lock" });
  }
  const key = packageRepoKey(module, entry, catalog, remote);
  if (!key) {
    throw fail("E_MATERIALIZE_SOURCE", `module ${name}: cannot determine the repository of package ${from.package} (no from.repoKey, and the lock/catalog do not name one)`,
      { module: name, package: from.package, lockSource: entry?.source ?? null });
  }
  const path = typeof from.path === "string" && from.path ? from.path : (typeof entry?.path === "string" && entry.path ? entry.path : DEFAULT_PACKAGE_PATH);
  const pkgPath = posix.normalize(path.replace(/\\/g, "/")).replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!pkgPath || pkgPath === "." || pkgPath.startsWith("..") || posix.isAbsolute(pkgPath)) {
    throw fail("E_MATERIALIZE_SOURCE", `module ${name}: package path ${JSON.stringify(path)} is not a relative path inside the repository`, { module: name, package: from.package, path });
  }
  if (recordedDir && recordedDir !== pkgPath && !recordedDir.startsWith(`${pkgPath}/`)) {
    throw fail("E_MATERIALIZE_SOURCE", `module ${name}: recorded dir ${recordedDir} is outside the package path ${pkgPath}`, { module: name, package: from.package, dir: recordedDir, path: pkgPath });
  }
  return { key, ref: refForKey(key), commit: from.commit, dir: recordedDir ?? `${pkgPath}/capabilities/${name}` };
}

/* ───────────────────────────── copying ─────────────────────────────── */

/** Full copy of a fetched tree: regular files and directories only, exec bit preserved as 0o755 / 0o644. */
function copyTree(src, dest, shownRoot, allowAliases = false, root = src) {
  const st = lstatSync(src);
  if (st.isSymbolicLink()) throw fail("E_REMOTE_TREE_UNSAFE", `${shownRoot} is a symlink`, { path: shownRoot, why: "symlink" });
  if (!st.isDirectory()) throw fail("E_MATERIALIZE_RESOLUTION", `${shownRoot} is not a directory`, { path: shownRoot });
  mkdirSync(dest, { recursive: true, mode: 0o755 });
  for (const name of readdirSync(src).sort()) {
    const from = join(src, name), to = join(dest, name), shown = `${shownRoot}/${name}`, s = lstatSync(from);
    if (s.isSymbolicLink()) {
      if (allowAliases && defaultRemote.OATS_ALIAS_SYMLINK(relative(root, from).split(sep).join("/")) && readlinkSync(from) === "AGENTS.md") {
        symlinkSync("AGENTS.md", to); continue;
      }
      throw fail("E_REMOTE_TREE_UNSAFE", `${shown} is a symlink`, { path: shown, why: "symlink" });
    }
    if (s.isDirectory()) { copyTree(from, to, shown, allowAliases, root); continue; }
    if (!s.isFile()) throw fail("E_REMOTE_TREE_UNSAFE", `${shown} is not a regular file`, { path: shown, why: "device" });
    copyFileSync(from, to);
    chmodSync(to, (s.mode & 0o111) ? 0o755 : 0o644);
  }
}

function hasSkillDoc(dir) {
  try { return statSync(join(dir, "SKILL.md")).isFile(); } catch { return false; }
}

/** The skills a module contributes → [{ name, path }] (path relative to the module root).
 * Precedence: resolution.skills rows for the module; else manifest.skills; else every
 * skills/<dir>/SKILL.md in the fetched tree. */
export function moduleSkills(resolution, module, moduleDir) {
  return skillRowsOf(resolution, module, fsTree(moduleDir), { verify: true });
}

/** The fetched module tree as skillRowsOf reads it: paths relative to the module root, POSIX. */
function fsTree(moduleDir) {
  const abs = (rel) => join(moduleDir, ...rel.split("/"));
  return {
    isSkill: (rel) => hasSkillDoc(abs(rel)),
    isDir: (rel) => existsSync(abs(rel)) && lstatSync(abs(rel)).isDirectory(),
    children: (rel) => readdirSync(abs(rel)).sort(),
  };
}

/** A remote listing of the module's `skills/` (listRemoteTree, depth 2, relative to it) as skillRowsOf reads
 *  a tree: only the fallback branch reads one (a module whose manifest declares no `skills`). A listed
 *  symlink is not a SKILL.md. */
function listedSkillsTree(entries) {
  const blobs = new Set(), trees = new Set();
  for (const e of entries) {
    if (e.type === "blob") blobs.add(`skills/${e.path}`);
    else if (e.type === "tree") trees.add(`skills/${e.path}`);
  }
  return {
    isSkill: (rel) => blobs.has(`${rel}/SKILL.md`),
    // listRemoteTree answers [] for a missing `skills/`, one that is not a directory and an empty one alike.
    isDir: (rel) => (rel === "skills" ? entries.length > 0 : trees.has(rel)),
    children: (rel) => [...trees].filter((t) => t.startsWith(`${rel}/`) && !t.slice(rel.length + 1).includes("/")).map((t) => t.slice(rel.length + 1)).sort(),
  };
}

/** moduleSkills' precedence over `tree` ({ isSkill, isDir, children }, module-relative). `verify` checks
 *  each row has a readable SKILL.md (a fetched tree); the preview's rows from the resolution were checked
 *  over the remote by the resolver, and its fallback rows are SKILL.md holders by construction. */
function skillRowsOf(resolution, module, tree, { verify }) {
  const declared = (resolution.skills || []).filter((s) => s && s.module === module.name);
  const rows = [];
  if (declared.length) {
    for (const s of declared) {
      const rel = modulePath(s.path, module.name, "skill");
      const name = typeof s.name === "string" && s.name ? s.name : posix.basename(rel);
      rows.push({ name, path: rel });
    }
  } else if (Array.isArray(module.manifest?.skills)) {
    for (const entry of module.manifest.skills) {
      const rel = modulePath(entry, module.name, "skill");
      if (tree.isSkill(rel)) { rows.push({ name: posix.basename(rel), path: rel }); continue; }
      // A directory of skills (manifest `skills: ["skills"]`): each child with a SKILL.md is one skill.
      if (tree.isDir(rel)) {
        for (const child of tree.children(rel)) if (tree.isSkill(`${rel}/${child}`)) rows.push({ name: child, path: `${rel}/${child}` });
      } else {
        throw fail("E_MATERIALIZE_RESOLUTION", `module ${module.name}: declared skills path ${JSON.stringify(entry)} is missing from the fetched capability`, { module: module.name, path: entry });
      }
    }
  } else if (tree.isDir("skills")) {
    for (const child of tree.children("skills")) if (tree.isSkill(`skills/${child}`)) rows.push({ name: child, path: `skills/${child}` });
  }
  for (const r of rows) {
    if (!SAFE_COMPONENT_RE.test(r.name)) throw fail("E_MATERIALIZE_RESOLUTION", `module ${module.name}: skill name ${JSON.stringify(r.name)} is not a safe directory name`, { module: module.name, skill: r.name });
    if (verify && !tree.isSkill(r.path)) throw fail("E_MATERIALIZE_RESOLUTION", `module ${module.name}: skill ${r.name} (${r.path}) has no readable SKILL.md in the fetched capability`, { module: module.name, skill: r.name, path: r.path });
  }
  return rows;
}

/** The skills materialize WOULD copy for every module of `resolution`, before anything is fetched (the spawn
 *  preview): moduleSkills' precedence, the fallback branch read over a remote listing of the module's
 *  `skills/` at the commit materialize fetches (moduleSource). → [{ module, name, path }], in module order.
 *  Only a module whose manifest declares no `skills` is listed; the others need no read. */
export async function plannedModuleSkills(resolution, { lock, catalog, remote = defaultRemote, remoteOptions } = {}) {
  const out = [];
  for (const module of resolution.modules) {
    let tree = { isSkill: () => false, isDir: () => false, children: () => [] };
    const declared = (resolution.skills || []).some((s) => s && s.module === module.name);
    if (!declared && !Array.isArray(module.manifest?.skills)) {
      const source = moduleSource(module, { lock, catalog, remote });
      const at = posix.join(source.dir, "skills");
      const options = remoteOptions || {};
      const list = () => remote.listRemoteTree(source.ref, source.commit, at, { depth: 2, ...options });
      // A listing at a commit never changes: the parsed cache keeps it, as the resolver's skill listings.
      tree = listedSkillsTree(typeof remote.memoAtCommit === "function" ? await remote.memoAtCommit(source.ref, source.commit, `list\0${at}\0${2}`, list, options) : await list());
    }
    for (const r of skillRowsOf(resolution, module, tree, { verify: false })) out.push({ module: module.name, ...r });
  }
  return out;
}

/** The inject files a module contributes → [relative path]. resolution.injects rows first, else manifest.inject. */
function moduleInjects(resolution, module, moduleDir) {
  const declared = (resolution.injects || []).filter((i) => i && i.module === module.name);
  const rels = declared.length
    ? declared.map((i) => modulePath(i.path, module.name, "inject"))
    : (typeof module.manifest?.inject === "string" && module.manifest.inject ? [modulePath(module.manifest.inject, module.name, "inject")] : []);
  for (const rel of rels) {
    const abs = join(moduleDir, ...rel.split("/"));
    let st = null;
    try { st = lstatSync(abs); } catch {}
    if (!st || !st.isFile()) throw fail("E_MATERIALIZE_RESOLUTION", `module ${module.name}: inject ${rel} is missing from the fetched capability`, { module: module.name, path: rel });
  }
  return rels;
}

/** Capability blocks (`capability:<module>`, built in module order) in `resolution.instructionOrder`;
 *  a module the order does not list keeps its place after the listed ones. Stable within a module. */
function instructionOrdered(resolution, blocks) {
  const order = Array.isArray(resolution.instructionOrder) ? resolution.instructionOrder : [];
  const rank = (b) => { const i = order.indexOf(b.source.slice("capability:".length)); return i < 0 ? order.length : i; };
  return blocks.map((b, i) => ({ b, i, r: rank(b) })).sort((x, y) => x.r - y.r || x.i - y.i).map(({ b }) => b);
}

/* ───────────────────────────── home ─────────────────────────────── */

function assertHome(home) {
  if (typeof home !== "string" || !isAbsolute(home)) throw fail("E_MATERIALIZE_HOME", "home must be an absolute path", { home });
  const abs = resolve(home);
  let st;
  try { st = statSync(abs); } catch { throw fail("E_MATERIALIZE_HOME", `instance home ${abs} does not exist`, { home: abs }); }
  if (!st.isDirectory()) throw fail("E_MATERIALIZE_HOME", `instance home ${abs} is not a directory`, { home: abs });
  return abs;
}

function readInstanceJson(file) {
  if (!existsSync(file)) return {};
  let parsed;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch (e) {
    throw fail("E_MATERIALIZE_HOME", `${file} is not valid JSON: ${e.message}`, { file });
  }
  if (!plainObject(parsed)) throw fail("E_MATERIALIZE_HOME", `${file} must hold a JSON object`, { file });
  return parsed;
}

function soulBody(home, options) {
  if (typeof options.soulAgentsMd === "string") return { text: options.soulAgentsMd, file: null };
  const candidates = [];
  if (typeof options.soulDir === "string") candidates.push(join(resolve(options.soulDir), "AGENTS.md"));
  for (const file of candidates) {
    try { if (statSync(file).isFile()) return { text: readFileSync(file, "utf8"), file }; } catch {}
  }
  throw fail("E_MATERIALIZE_RESOLUTION", `the soul's canonical AGENTS.md was not found (looked at ${candidates.join(", ")}); pass options.soulAgentsMd or options.soulDir`, { candidates });
}

/** `.oats/` may pre-exist (v1 homes, a previous materialization); remember whether WE made it. */
function ensureOatsDir(home) {
  const dir = join(home, ".oats");
  if (existsSync(dir)) {
    if (!lstatSync(dir).isDirectory()) throw fail("E_MATERIALIZE_HOME", `${dir} exists and is not a directory`, { path: dir });
    return { dir, created: false };
  }
  mkdirSync(dir, { mode: 0o755 });
  return { dir, created: true };
}

/* ───────────────────────────── materialize ─────────────────────────────── */

/**
 * materialize(resolution, home, options) → { modules, skills, agentsMd, instanceJson }
 *
 * options:
 *   fetch(ref, commit, dir, destDir, remoteOptions) → { files, bytes, digest }   default remote.fetchRemoteTree
 *   remote            module with parseRepoRef + contentDigest (+ fetchRemoteTree when `fetch` is not given); default lib/remote.mjs
 *   remoteOptions     threaded into fetch (cacheDir, exec, …)
 *   lock              oats-lock.json v3 object: package repo/path/commit for from.kind === "package"
 *   catalog           { <id>: { url, ref, path } } for lock entries whose source is "catalog:<id>"
 *   soulAgentsMd      the soul's canonical AGENTS.md text (else read from options.soulDir)
 *   blocks            pre-rendered blocks [{ source, file, content }] placed AFTER the capability injects
 *                     (the kernel's own kernel:… and work-mode:… blocks, composed by core.mjs)
 *   now()             ISO timestamp source (tests)
 *
 * The AGENTS.md is the soul's body, then each module's inject in `resolution.instructionOrder`
 * (the soul's listing, then the workspace defaults' order; a module the order omits follows, in
 * module order), then `blocks`. `outcome.blocks` lists every block in that written order.
 *
 * stageMaterialize adds `replace` (complete roots), `staging` (explicit scratch
 * directory), `existingModules` (name → frozen source path), and `instanceJson`
 * (derived metadata transform). Its commit({preserveOnFailure:true}) retains
 * forward progress and can be reopened with {staging, resume:true}. Add
 * retainStaging:true until the caller has durably recorded its remaining lifecycle steps.
 */
export async function materialize(resolution, home, options = {}) {
  const transaction = await stageMaterialize(resolution, home, options);
  return transaction.commit();
}

/** Build the same composition as spawn without publishing it. Replacement transactions
 * swap complete module/skill roots; a caller holds the lifecycle claim while using them.
 * `staging` may be outside the home for a read-only preview. `resume` reopens a staged
 * transaction after an interrupted forward-only commit; no resolution or fetch is needed.
 * `existingModules` names verified frozen copies to retain instead of fetching them.
 * `instanceJson(merged, outcome)` supplies the caller's derived metadata; updateInstance
 * can subsequently record provider hook results before commit. rollback() restores
 * a retained swap when no provider hook has adopted the new version.
 */
export async function stageMaterialize(resolution, home, options = {}) {
  if (options.resume) return resumeMaterialization(home, options.staging);
  assertResolution(resolution);
  const homeAbs = assertHome(home);
  const remote = options.remote ?? defaultRemote;
  if (typeof remote?.contentDigest !== "function" || typeof remote?.parseRepoRef !== "function") {
    throw new TypeError("materialize: remote must provide contentDigest() and parseRepoRef() (module contract §1)");
  }
  const fetch = options.fetch ?? remote.fetchRemoteTree;
  if (typeof fetch !== "function") throw new TypeError("materialize: options.fetch (or remote.fetchRemoteTree) must be a function");
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  const { lock, catalog } = options;

  // Everything that can be decided without touching the network or the disk, first.
  const sources = resolution.modules.map((m) => {
    const existing = Object.hasOwn(options.existingModules ?? {}, m.name) ? options.existingModules[m.name] : undefined;
    return { module: m, existing,
      source: existing ? { commit: m.from.commit, key: m.from.repoKey } : moduleSource(m, { lock, catalog, remote }),
    };
  });
  const body = soulBody(homeAbs, options);
  const instanceFile = join(homeAbs, "instance.json");
  const previous = readInstanceJson(instanceFile);
  const modulesRoot = join(homeAbs, MODULES_DIR);
  const skillsRoot = join(homeAbs, SKILLS_DIR);
  const parents = [join(homeAbs, ".oats"), modulesRoot, join(homeAbs, ".agents"), skillsRoot, join(homeAbs, ".claude")];
  /** The home must still be what we checked: module targets absent, every parent a real directory (or absent).
   * Run before the fetch AND immediately before the commit — a symlink planted in between must not be written through. */
  // Skill targets are known only once each module is fetched; the commit-time re-check covers them.
  // skill name, lower-cased → { module, path, name }: one directory per skill, and on a
  // case-insensitive filesystem `Foo` and `foo` are one directory.
  const skillOwners = new Map();
  const assertHomeShape = () => {
    for (const { module } of sources) {
      const target = join(modulesRoot, module.name);
      let st = null;
      try { st = lstatSync(target); } catch {}
      if (st && !options.replace) throw fail("E_MATERIALIZE_HOME", `${target} already exists — the instance already carries module ${module.name}; materialize never overwrites a module in place`, { home: homeAbs, module: module.name, path: target });
    }
    for (const owner of skillOwners.values()) {
      const name = owner.name, target = join(skillsRoot, name);
      let st = null;
      try { st = lstatSync(target); } catch {}
      if (st && !options.replace) throw fail("E_MATERIALIZE_HOME", `${target} already exists — the instance already carries a skill named ${name}; materialize never overwrites a skill in place`, { home: homeAbs, module: owner.module, skill: name, path: target });
    }
    for (const p of parents) {
      let st = null;
      try { st = lstatSync(p); } catch {}
      if (st && !st.isDirectory()) throw fail("E_MATERIALIZE_HOME", `${p} exists and is not a directory`, { home: homeAbs, path: p, why: "not-a-directory" });
    }
    for (const p of [join(homeAbs, "AGENTS.md"), instanceFile]) {
      let st = null;
      try { st = lstatSync(p); } catch {}
      if (st && !st.isFile() && !st.isSymbolicLink()) throw fail("E_MATERIALIZE_HOME", `${p} exists and is not a file`, { home: homeAbs, path: p, why: "not-a-file" });
    }
  };
  assertHomeShape();

  const oats = options.staging ? { dir: join(homeAbs, ".oats"), created: false } : ensureOatsDir(homeAbs);
  // Unique per call: two materializations of one home in one process (or across processes) never share staging.
  const staging = options.staging ? resolve(options.staging) : join(oats.dir, `.staging-${process.pid}-${randomBytes(6).toString("hex")}`);
  assertStagingPath(staging, homeAbs);
  if (linkPresent(staging)) throw fail("E_MATERIALIZE_HOME", `staging directory ${staging} already exists; resume it explicitly or choose another path`, { path: staging, why: "busy" });
  let stagingOwned = false;
  const discard = () => {
    try { if (stagingOwned) rmSync(staging, { recursive: true, force: true }); } catch { /* an unremovable staging dir must not mask the original error */ }
    if (oats.created) { try { rmdirSync(oats.dir); } catch { /* something else appeared; leave it */ } }
  };

  let outcome;
  try {
    try { mkdirSync(staging, { mode: 0o755 }); }
    catch (e) {
      if (e?.code === "EEXIST") throw fail("E_MATERIALIZE_HOME", `${staging} appeared while materializing`, { path: staging, why: "busy" });
      throw e;
    }
    stagingOwned = true;
    mkdirSync(join(staging, "modules"), { mode: 0o755 });
    mkdirSync(join(staging, "skills"), { mode: 0o755 });

    const moduleRows = [], skillRows = [], capabilityBlocks = [], recorded = {};
    for (const { module, source, existing } of sources) {
      const stagedModule = join(staging, "modules", module.name);
      const finalModule = join(modulesRoot, module.name);
      let fetched;
      try {
        if (existing) {
          copyTree(existing, stagedModule, module.name, true);
          fetched = { digest: remote.contentDigest(stagedModule, { allowSymlinks: defaultRemote.OATS_ALIAS_SYMLINK }) };
        } else fetched = await fetch(source.ref, source.commit, source.dir, stagedModule, { ...(options.remoteOptions || {}), allowSymlinks: defaultRemote.OATS_ALIAS_SYMLINK });
      }
      catch (e) {
        if (e?.code === "E_REMOTE_PATH_MISSING") {
          throw fail("E_CAPABILITY_MISSING", `module ${module.name}: ${source.dir} is not present in ${source.key}@${source.commit.slice(0, 12)}`,
            { module: module.name, repoKey: source.key, commit: source.commit, path: source.dir, cause: e.message });
        }
        throw e;
      }
      if (!plainObject(fetched) || typeof fetched.digest !== "string" || !DIGEST_RE.test(fetched.digest)) {
        throw fail("E_MATERIALIZE_INTEGRITY", `module ${module.name}: fetch did not report a sha256 content digest`, { module: module.name, reported: fetched?.digest ?? null, why: "fetch" });
      }
      let stagedStat = null;
      try { stagedStat = lstatSync(stagedModule); } catch {}
      if (!stagedStat || !stagedStat.isDirectory()) {
        throw fail("E_MATERIALIZE_INTEGRITY", `module ${module.name}: fetch reported success but wrote nothing at ${stagedModule}`, { module: module.name, path: stagedModule, why: "fetch" });
      }
      // Defense in depth: regular files and directories only, whatever `fetch`/`remote` claim (contract §1).
      assertPlainTree(stagedModule, module.name, stagedModule);
      const digest = remote.contentDigest(stagedModule, { allowSymlinks: defaultRemote.OATS_ALIAS_SYMLINK });
      if (digest !== fetched.digest) {
        throw fail("E_MATERIALIZE_INTEGRITY", `module ${module.name}: the copy digests ${digest} but the fetch reported ${fetched.digest}`,
          { module: module.name, repoKey: source.key, commit: source.commit, expected: fetched.digest, actual: digest, why: "copy" });
      }
      const expectedDigest = module.digest ?? (existing ? previous.modules?.[module.name]?.digest : null);
      if (expectedDigest && expectedDigest !== digest) {
        throw fail("E_MATERIALIZE_INTEGRITY", `module ${module.name}: content digest ${digest} does not match the recorded ${expectedDigest}`,
          { module: module.name, repoKey: source.key, commit: source.commit, expected: expectedDigest, actual: digest, why: "resolution" });
      }

      for (const skill of moduleSkills(resolution, module, stagedModule)) {
        // Skills land flat, so a name is one directory in the home: two sources for one
        // name — two modules, or two paths of one module — are a duplicate.
        const key = skill.name.toLowerCase();
        const owner = skillOwners.get(key);
        if (owner && owner.module === module.name && owner.path === skill.path && owner.name === skill.name) continue;
        if (owner) {
          const detail = owner.module === module.name ? `${module.name} (${owner.path} and ${skill.path})` : `both ${owner.module} and ${module.name}`;
          const names = owner.name === skill.name ? JSON.stringify(skill.name) : `${JSON.stringify(owner.name)} / ${JSON.stringify(skill.name)} (one directory on a case-insensitive filesystem)`;
          throw fail("E_SKILL_DUPLICATE", `skill ${names} is contributed by ${detail}`, { name: skill.name, modules: [owner.module, module.name] });
        }
        skillOwners.set(key, { module: module.name, path: skill.path, name: skill.name });
        const src = join(stagedModule, ...skill.path.split("/"));
        const staged = join(staging, "skills", skill.name);
        copyTree(src, staged, `${module.name}/${skill.path}`);
        skillRows.push({ module: module.name, name: skill.name, from: `${MODULES_DIR}/${module.name}/${skill.path}`.split(sep).join("/"), path: join(skillsRoot, skill.name) });
      }

      for (const rel of moduleInjects(resolution, module, stagedModule)) {
        const content = readFileSync(join(stagedModule, ...rel.split("/")), "utf8").trim();
        capabilityBlocks.push({ source: `capability:${module.name}`, file: join(finalModule, ...rel.split("/")), content });
      }

      const at = now();
      const from = clone(module.from);
      recorded[module.name] = existing && previous.modules?.[module.name]?.digest === digest && previous.modules[module.name].commit === source.commit
        ? clone(previous.modules[module.name]) : { from, commit: source.commit, digest, materializedAt: at };
      moduleRows.push({ name: module.name, from, commit: source.commit, digest, files: fetched.files ?? null, bytes: fetched.bytes ?? null, path: finalModule, materializedAt: at });
    }

    const blocks = [...instructionOrdered(resolution, capabilityBlocks), ...(Array.isArray(options.blocks) ? options.blocks : [])];
    for (const b of blocks) {
      if (!plainObject(b) || typeof b.source !== "string" || typeof b.file !== "string" || typeof b.content !== "string") {
        throw fail("E_MATERIALIZE_RESOLUTION", "options.blocks entries must be { source, file, content } strings", { block: b });
      }
    }
    const agentsText = renderInstructionText(body.text, blocks);
    writeFileSync(join(staging, "AGENTS.md"), agentsText, { mode: 0o644 });

    let merged = { ...previous, modules: recorded, providers: clone(resolution.payloads ?? {}) };
    if (typeof resolution.revision === "string" && resolution.revision) merged.resolutionRevision = resolution.revision;
    outcome = { modules: moduleRows, skills: skillRows, agentsMd: join(homeAbs, "AGENTS.md"), instanceJson: merged, blocks };
    if (typeof options.instanceJson === "function") merged = options.instanceJson(merged, outcome);
    if (!plainObject(merged)) throw fail("E_MATERIALIZE_RESOLUTION", "options.instanceJson must return an object");
    outcome.instanceJson = merged;
    writeFileSync(join(staging, "instance.json"), JSON.stringify(merged, null, 2) + "\n", { mode: 0o644 });
    const state = { api: 1, home: homeAbs, replace: options.replace === true, outcome, operations: [], initialParents: [".claude", SKILLS_DIR, ".agents", MODULES_DIR].filter(p => linkPresent(join(homeAbs, p))) };
    saveMaterialization(staging, state);
    return materializationTransaction(staging, state, { assertHomeShape, discard });
  } catch (error) {
    discard();
    throw error;
  }
}

const TRANSACTION_FILE = ".materialize-transaction.json";

/** Refuse path aliases before creating or reopening staging. Staging cannot cover the
 * home itself or any published composition path. Ancestors inside the home must be
 * real directories; system ancestors such as macOS /tmp may be directory aliases. */
function assertStagingPath(staging, home) {
  if (!isAbsolute(staging) || staging === home || relative(staging, home).split(sep)[0] !== "..") {
    throw fail("E_MATERIALIZE_HOME", `unsafe staging directory ${staging}`, { path: staging });
  }
  if ([".oats", ".agents", ".claude", "AGENTS.md", "instance.json", "CLAUDE.md"].some(p => join(home, p) === staging)) throw fail("E_MATERIALIZE_HOME", `staging directory overlaps the home composition: ${staging}`, { path: staging });
  for (const published of [join(home, MODULES_DIR), join(home, SKILLS_DIR)]) {
    const rel = relative(published, staging);
    if (!rel || (!rel.startsWith(`..${sep}`) && rel !== "..")) throw fail("E_MATERIALIZE_HOME", `staging directory is inside ${published}`, { path: staging });
  }
  let at = resolve(staging, "..");
  const insideHome = !relative(home, staging).startsWith(`..${sep}`);
  while (insideHome && at !== home) {
    if (linkPresent(at) && !lstatSync(at).isDirectory()) throw fail("E_MATERIALIZE_HOME", `${at} exists and is not a directory`, { path: at });
    const parent = resolve(at, "..");
    if (parent === at) break;
    at = parent;
  }
}

function saveMaterialization(staging, state) {
  const file = join(staging, TRANSACTION_FILE), temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, file);
}

function resumeMaterialization(home, stagingPath) {
  const homeAbs = assertHome(home);
  if (typeof stagingPath !== "string" || !isAbsolute(stagingPath)) throw fail("E_MATERIALIZE_HOME", "resuming materialization requires an absolute staging path");
  const staging = resolve(stagingPath);
  assertStagingPath(staging, homeAbs);
  if (!lstatSync(staging).isDirectory() || !lstatSync(join(staging, TRANSACTION_FILE)).isFile()) throw fail("E_MATERIALIZE_HOME", `invalid materialization staging directory ${staging}`);
  const state = readInstanceJson(join(staging, TRANSACTION_FILE));
  if (state.api !== 1 || state.home !== homeAbs || typeof state.replace !== "boolean" || !plainObject(state.outcome) || !Array.isArray(state.outcome.modules) || !Array.isArray(state.outcome.skills) || !Array.isArray(state.operations)) throw fail("E_MATERIALIZE_HOME", `invalid materialization transaction in ${staging}`);
  return materializationTransaction(staging, state);
}

/** A durable intent before each rename makes an interrupted swap distinguishable from
 * a pending one. Forward-only failures keep both copies and retry the remaining moves;
 * ordinary spawn failures reverse the same journal and discard staging. */
function materializationTransaction(staging, state, callbacks = {}) {
  const home = state.home, outcome = state.outcome;
  const discard = callbacks.discard ?? (() => { try { rmSync(staging, { recursive: true, force: true }); } catch { /* cleanup must not turn success into rollback */ } });
  let committed = false;
  const operations = () => state.replace
    ? [{ label: "modules", dest: join(home, MODULES_DIR) }, { label: "skills", dest: join(home, SKILLS_DIR) }, { label: "AGENTS.md", dest: join(home, "AGENTS.md") }, { label: "instance.json", dest: join(home, "instance.json") }]
    : [...outcome.modules.map(m => ({ label: `modules/${safeName(m.name)}`, dest: join(home, MODULES_DIR, m.name) })),
      ...outcome.skills.map(s => ({ label: `skills/${safeName(s.name)}`, dest: join(home, SKILLS_DIR, s.name) })),
      { label: "AGENTS.md", dest: join(home, "AGENTS.md") }, { label: "instance.json", dest: join(home, "instance.json") }];
  const allowedLabels = new Set(operations().map(op => op.label));
  if (state.operations.some(op => !plainObject(op) || !allowedLabels.has(op.label) || typeof op.had !== "boolean" || !["pending", "backed", "placed"].includes(op.phase)) ||
      (state.aliases !== undefined && (!Array.isArray(state.aliases) || state.aliases.some(alias => !["CLAUDE.md", ".claude/skills"].includes(alias))))) {
    throw fail("E_MATERIALIZE_HOME", `invalid materialization journal in ${staging}`, { path: staging });
  }
  const ensureDir = (p) => {
    if (linkPresent(p)) {
      if (!lstatSync(p).isDirectory()) throw fail("E_MATERIALIZE_HOME", `${p} exists and is not a directory`, { path: p });
    } else mkdirSync(p, { mode: 0o755 });
  };
  const checkParents = () => {
    for (const p of [join(home, ".oats"), join(home, ".agents"), join(home, ".claude")]) ensureDir(p);
    for (const p of [join(home, MODULES_DIR), join(home, SKILLS_DIR)]) if (linkPresent(p) && !lstatSync(p).isDirectory()) throw fail("E_MATERIALIZE_HOME", `${p} exists and is not a directory`, { path: p });
    if (!state.replace) { ensureDir(join(home, MODULES_DIR)); ensureDir(join(home, SKILLS_DIR)); }
  };
  const safeBackup = (label) => join(staging, "previous", ...label.split("/"));
  const safeSource = (label) => join(staging, ...label.split("/"));
  const updateInstance = (json) => {
    if (!plainObject(json) || state.operations.length || committed) throw fail("E_MATERIALIZE_HOME", "instance metadata can only be updated before the materialization swap");
    outcome.instanceJson = clone(json);
    writeFileSync(join(staging, "instance.json"), JSON.stringify(json, null, 2) + "\n", { mode: 0o644 });
    saveMaterialization(staging, state);
  };
  const rollback = ({ suppressErrors = false } = {}) => {
    if (!linkPresent(staging)) throw fail("E_MATERIALIZE_HOME", "materialization staging is gone; rollback requires retainStaging:true", { path: staging });
    const failures = [];
    for (const alias of state.aliases ?? []) {
      try { rmSync(join(home, alias), { force: true }); } catch (e) { failures.push(e.message); }
    }
    for (const op of operations().reverse()) {
      const saved = state.operations.find(row => row.label === op.label);
      if (!saved) continue;
      const src = safeSource(op.label), backup = safeBackup(op.label);
      try {
        if (!linkPresent(src) && linkPresent(op.dest)) { mkdirSync(resolve(src, ".."), { recursive: true }); renameSync(op.dest, src); }
        if (linkPresent(backup)) renameSync(backup, op.dest);
      } catch (e) { failures.push(e.message); }
    }
    // Only remove parents created by this materialization, and only if empty.
    for (const rel of [".claude", SKILLS_DIR, ".agents", MODULES_DIR]) {
      try { if (!state.initialParents?.includes(rel)) rmdirSync(join(home, rel)); } catch {}
    }
    if (!failures.length) discard();
    else if (!suppressErrors) throw fail("E_MATERIALIZE_HOME", `cannot fully roll back materialization; staging retained at ${staging}: ${failures.join("; ")}`, { path: staging, why: "rollback" });
    committed = false;
  };
  const commit = ({ preserveOnFailure = false, retainStaging = false } = {}) => {
    if (committed) return outcome;
    try {
      // Spawn retains its original pre-commit race checks. A resumed replacement
      // may already have published roots, so only its parent shape is checked.
      if (!state.operations.length) callbacks.assertHomeShape?.();
      checkParents();
      for (const op of operations()) {
        let saved = state.operations.find(row => row.label === op.label);
        const src = safeSource(op.label), backup = safeBackup(op.label);
        if (!saved) {
          saved = { label: op.label, had: linkPresent(op.dest), phase: "pending" };
          if (!state.replace && (op.label.startsWith("modules/") || op.label.startsWith("skills/")) && saved.had) throw fail("E_MATERIALIZE_HOME", `${op.dest} appeared while materializing`, { path: op.dest, why: "busy" });
          state.operations.push(saved); saveMaterialization(staging, state);
        }
        if (saved.phase === "pending") {
          if (saved.had && !linkPresent(backup)) {
            mkdirSync(resolve(backup, ".."), { recursive: true });
            renameSync(op.dest, backup);
          }
          saved.phase = "backed"; saveMaterialization(staging, state);
        }
        if (saved.phase === "backed") {
          if (linkPresent(src)) {
            if (linkPresent(op.dest)) throw fail("E_MATERIALIZE_HOME", `${op.dest} appeared while materializing`, { path: op.dest, why: "busy" });
            renameSync(src, op.dest);
          }
          else if (!linkPresent(op.dest)) throw fail("E_MATERIALIZE_HOME", `staged materialization is missing ${src}`, { path: src });
          saved.phase = "placed"; saveMaterialization(staging, state);
        }
      }
      const claudeMd = join(home, "CLAUDE.md"), claudeSkills = join(home, ".claude", "skills");
      if (!linkPresent(claudeMd)) { symlinkSync("AGENTS.md", claudeMd); state.aliases = [...(state.aliases ?? []), "CLAUDE.md"]; saveMaterialization(staging, state); }
      if (!linkPresent(claudeSkills)) { symlinkSync(join("..", ".agents", "skills"), claudeSkills); state.aliases = [...(state.aliases ?? []), ".claude/skills"]; saveMaterialization(staging, state); }
      committed = true;
      if (!retainStaging) discard();
      return outcome;
    } catch (error) {
      if (!preserveOnFailure) rollback({ suppressErrors: true });
      if (["EACCES", "EPERM", "EROFS", "EISDIR", "ENOTDIR"].includes(error?.code)) throw fail("E_MATERIALIZE_HOME", `cannot write the instance home ${home}: ${error.message}`, { home, why: "unwritable", cause: error.code });
      throw error;
    }
  };
  return { outcome, staging, commit, discard, rollback, updateInstance };
}

function safeName(name) {
  if (typeof name !== "string" || !SAFE_COMPONENT_RE.test(name)) throw fail("E_MATERIALIZE_HOME", "invalid name in materialization transaction", { name });
  return name;
}

/** Every entry under `dir` is a regular file or a directory (no symlinks, devices, sockets) — E_REMOTE_TREE_UNSAFE. */
function assertPlainTree(dir, module, root = dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), st = lstatSync(p);
    if (st.isSymbolicLink()) {
      // The one admitted alias (OATS_ALIAS_SYMLINK) must point at its sibling AGENTS.md.
      const rel = relative(root, p).split(sep).join("/");
      if (!defaultRemote.OATS_ALIAS_SYMLINK(rel) || readlinkSync(p) !== "AGENTS.md") throw fail("E_REMOTE_TREE_UNSAFE", `module ${module}: ${p} is a symlink`, { module, path: p, why: "symlink" });
      continue;
    }
    if (st.isDirectory()) { assertPlainTree(p, module, root); continue; }
    if (!st.isFile()) throw fail("E_REMOTE_TREE_UNSAFE", `module ${module}: ${p} is not a regular file`, { module, path: p, why: "device" });
  }
}

function linkPresent(path) {
  try { lstatSync(path); return true; } catch { return false; }
}

/* ───────────────────────────── driftOf ─────────────────────────────── */



/** Read the modules recorded in an instance home (→ {} when absent). */
export function recordedModules(home) {
  const file = join(resolve(home), "instance.json");
  if (!existsSync(file)) return {};
  const parsed = readInstanceJson(file);
  return plainObject(parsed.modules) ? parsed.modules : {};
}
