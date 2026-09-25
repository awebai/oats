/** lib/materialize.mjs — copy whole, compose, record (workspace model v2, module contract §5).
 *
 * Supersedes the module/skill assembly in core.mjs spawn (`prepared` copies, symlinked
 * skill sets, ambient exclusion) and capability-artifacts.mjs.
 *
 * materialize(resolution, home, options)
 *   For every module of the resolution: fetch its capability directory whole into
 *   <home>/.oats/modules/<name>/, verify the copy's content digest, copy its skills as
 *   FULL copies into <home>/.agents/skills/<name>/<skill>/, compose <home>/AGENTS.md
 *   (soul body + each module's inject, same marker comments as the kernel composer),
 *   keep the CLAUDE.md / .claude/skills aliases, and record modules + providers in
 *   <home>/instance.json.
 *
 * TRANSACTION: everything is built under <home>/.oats/.staging-<pid>-<random>/ (unique per
 * call, so two materializations of one home never share staging) and then renamed into
 * place. Any failure before the commit removes the staging directory and leaves the home
 * exactly as it was (a `.oats/` directory created only for staging is removed too). The
 * commit re-checks the home's shape (no symlink planted at .oats/.agents/.claude or the
 * module targets during the fetch), then runs a short sequence of renames — modules,
 * skills, AGENTS.md, instance.json, and the CLAUDE.md / .claude/skills aliases — with a
 * rollback journal: should any step fail, everything already placed is undone and the
 * previous AGENTS.md / instance.json restored before a named error (E_MATERIALIZE_HOME)
 * propagates. A second materialization racing on the same home surfaces as
 * E_MATERIALIZE_HOME { why: "busy" }, never a raw ENOTEMPTY.
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
const plainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

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
function copyTree(src, dest, shownRoot) {
  const st = lstatSync(src);
  if (st.isSymbolicLink()) throw fail("E_REMOTE_TREE_UNSAFE", `${shownRoot} is a symlink`, { path: shownRoot, why: "symlink" });
  if (!st.isDirectory()) throw fail("E_MATERIALIZE_RESOLUTION", `${shownRoot} is not a directory`, { path: shownRoot });
  mkdirSync(dest, { recursive: true, mode: 0o755 });
  for (const name of readdirSync(src).sort()) {
    const from = join(src, name), to = join(dest, name), shown = `${shownRoot}/${name}`, s = lstatSync(from);
    if (s.isSymbolicLink()) throw fail("E_REMOTE_TREE_UNSAFE", `${shown} is a symlink`, { path: shown, why: "symlink" });
    if (s.isDirectory()) { copyTree(from, to, shown); continue; }
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
function moduleSkills(resolution, module, moduleDir) {
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
      const abs = join(moduleDir, ...rel.split("/"));
      if (hasSkillDoc(abs)) { rows.push({ name: posix.basename(rel), path: rel }); continue; }
      // A directory of skills (manifest `skills: ["skills"]`): each child with a SKILL.md is one skill.
      if (existsSync(abs) && lstatSync(abs).isDirectory()) {
        for (const child of readdirSync(abs).sort()) if (hasSkillDoc(join(abs, child))) rows.push({ name: child, path: `${rel}/${child}` });
      } else {
        throw fail("E_MATERIALIZE_RESOLUTION", `module ${module.name}: declared skills path ${JSON.stringify(entry)} is missing from the fetched capability`, { module: module.name, path: entry });
      }
    }
  } else {
    const skillsRoot = join(moduleDir, "skills");
    if (existsSync(skillsRoot) && lstatSync(skillsRoot).isDirectory()) {
      for (const child of readdirSync(skillsRoot).sort()) if (hasSkillDoc(join(skillsRoot, child))) rows.push({ name: child, path: `skills/${child}` });
    }
  }
  for (const r of rows) {
    if (!SAFE_COMPONENT_RE.test(r.name)) throw fail("E_MATERIALIZE_RESOLUTION", `module ${module.name}: skill name ${JSON.stringify(r.name)} is not a safe directory name`, { module: module.name, skill: r.name });
    const abs = join(moduleDir, ...r.path.split("/"));
    if (!hasSkillDoc(abs)) throw fail("E_MATERIALIZE_RESOLUTION", `module ${module.name}: skill ${r.name} (${r.path}) has no readable SKILL.md in the fetched capability`, { module: module.name, skill: r.name, path: r.path });
  }
  return rows;
}

/** The inject files a module contributes → [relative path]. resolution.injects rows first, else manifest.inject;
 * none for a module row marked `inject: false` (a capability agent's knowledge-layer provider carries no
 * memory protocol: lib/instance-resolution.mjs#prepareCapabilityAgent). */
function moduleInjects(resolution, module, moduleDir) {
  if (module.inject === false) return [];
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
 *   blocks            pre-rendered blocks [{ source, file, content }] placed BEFORE the capability injects
 *                     (the kernel's own kernel:… and work-mode:… blocks, composed by core.mjs)
 *   now()             ISO timestamp source (tests)
 */
export async function materialize(resolution, home, options = {}) {
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
  const sources = resolution.modules.map((m) => ({ module: m, source: moduleSource(m, { lock, catalog, remote }) }));
  const body = soulBody(homeAbs, options);
  const instanceFile = join(homeAbs, "instance.json");
  const previous = readInstanceJson(instanceFile);
  const modulesRoot = join(homeAbs, MODULES_DIR);
  const skillsRoot = join(homeAbs, SKILLS_DIR);
  const parents = [join(homeAbs, ".oats"), modulesRoot, join(homeAbs, ".agents"), skillsRoot, join(homeAbs, ".claude")];
  /** The home must still be what we checked: module targets absent, every parent a real directory (or absent).
   * Run before the fetch AND immediately before the commit — a symlink planted in between must not be written through. */
  const assertHomeShape = () => {
    for (const { module } of sources) {
      for (const target of [join(modulesRoot, module.name), join(skillsRoot, module.name)]) {
        let st = null;
        try { st = lstatSync(target); } catch {}
        if (st) throw fail("E_MATERIALIZE_HOME", `${target} already exists — the instance already carries module ${module.name}; materialize never overwrites a module in place`, { home: homeAbs, module: module.name, path: target });
      }
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

  const oats = ensureOatsDir(homeAbs);
  // Unique per call: two materializations of one home in one process (or across processes) never share staging.
  const staging = join(oats.dir, `.staging-${process.pid}-${randomBytes(6).toString("hex")}`);
  const discard = () => {
    try { rmSync(staging, { recursive: true, force: true }); } catch { /* an unremovable staging dir must not mask the original error */ }
    if (oats.created) { try { rmdirSync(oats.dir); } catch { /* something else appeared; leave it */ } }
  };
  /** A real directory at `p` (mkdir without following a symlink; EEXIST on a non-directory → refusal). */
  const ensureDir = (p) => {
    try { mkdirSync(p, { mode: 0o755 }); }
    catch (e) {
      if (e?.code !== "EEXIST") throw e;
      if (!lstatSync(p).isDirectory()) throw fail("E_MATERIALIZE_HOME", `${p} exists and is not a directory`, { home: homeAbs, path: p, why: "not-a-directory" });
    }
  };

  let outcome;
  try {
    mkdirSync(join(staging, "modules"), { recursive: true, mode: 0o755 });
    mkdirSync(join(staging, "skills"), { recursive: true, mode: 0o755 });

    const moduleRows = [], skillRows = [], capabilityBlocks = [], recorded = {};
    const skillOwners = new Map();
    for (const { module, source } of sources) {
      const stagedModule = join(staging, "modules", module.name);
      const finalModule = join(modulesRoot, module.name);
      let fetched;
      try { fetched = await fetch(source.ref, source.commit, source.dir, stagedModule, { ...(options.remoteOptions || {}), allowSymlinks: defaultRemote.OATS_ALIAS_SYMLINK }); }
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
      if (module.digest && module.digest !== digest) {
        throw fail("E_MATERIALIZE_INTEGRITY", `module ${module.name}: content digest ${digest} does not match the resolution's ${module.digest}`,
          { module: module.name, repoKey: source.key, commit: source.commit, expected: module.digest, actual: digest, why: "resolution" });
      }

      for (const skill of moduleSkills(resolution, module, stagedModule)) {
        const owner = skillOwners.get(skill.name);
        if (owner && owner !== module.name) {
          throw fail("E_SKILL_DUPLICATE", `skill ${JSON.stringify(skill.name)} is contributed by both ${owner} and ${module.name}`, { name: skill.name, modules: [owner, module.name] });
        }
        skillOwners.set(skill.name, module.name);
        const src = join(stagedModule, ...skill.path.split("/"));
        const staged = join(staging, "skills", module.name, skill.name);
        copyTree(src, staged, `${module.name}/${skill.path}`);
        skillRows.push({ module: module.name, name: skill.name, from: `${MODULES_DIR}/${module.name}/${skill.path}`.split(sep).join("/"), path: join(skillsRoot, module.name, skill.name) });
      }

      for (const rel of moduleInjects(resolution, module, stagedModule)) {
        const content = readFileSync(join(stagedModule, ...rel.split("/")), "utf8").trim();
        capabilityBlocks.push({ source: `capability:${module.name}`, file: join(finalModule, ...rel.split("/")), content });
      }

      const at = now();
      const from = clone(module.from);
      recorded[module.name] = { from, commit: source.commit, digest, materializedAt: at };
      moduleRows.push({ name: module.name, from, commit: source.commit, digest, files: fetched.files ?? null, bytes: fetched.bytes ?? null, path: finalModule, materializedAt: at });
    }

    const blocks = [...(Array.isArray(options.blocks) ? options.blocks : []), ...capabilityBlocks];
    for (const b of blocks) {
      if (!plainObject(b) || typeof b.source !== "string" || typeof b.file !== "string" || typeof b.content !== "string") {
        throw fail("E_MATERIALIZE_RESOLUTION", "options.blocks entries must be { source, file, content } strings", { block: b });
      }
    }
    const agentsText = renderInstructionText(body.text, blocks);
    writeFileSync(join(staging, "AGENTS.md"), agentsText, { mode: 0o644 });

    const merged = { ...previous, modules: recorded, providers: clone(resolution.payloads ?? {}) };
    if (typeof resolution.revision === "string" && resolution.revision) merged.resolutionRevision = resolution.revision;
    writeFileSync(join(staging, "instance.json"), JSON.stringify(merged, null, 2) + "\n", { mode: 0o644 });

    // ── commit: re-check the home (TOCTOU), then a short sequence of renames with a rollback journal ──
    assertHomeShape();
    const undo = [];                      // LIFO: () => void
    const backupDir = join(staging, "previous");
    mkdirSync(backupDir, { mode: 0o755 });
    const swapIn = (src, dest, label) => {
      // Preserve whatever was at dest (file or symlink) in staging so a later failure can restore it.
      let had = false;
      try { lstatSync(dest); had = true; } catch {}
      if (had) { renameSync(dest, join(backupDir, label)); undo.push(() => renameSync(join(backupDir, label), dest)); }
      renameSync(src, dest);
      undo.push(() => rmSync(dest, { recursive: true, force: true }));
    };
    const placeDir = (src, dest) => {
      try { renameSync(src, dest); }
      catch (e) {
        if (e?.code === "EEXIST" || e?.code === "ENOTEMPTY" || e?.code === "EISDIR") {
          throw fail("E_MATERIALIZE_HOME", `${dest} appeared while materializing — another materialization of this home is in flight, or the home changed under us`, { home: homeAbs, path: dest, why: "busy" });
        }
        throw e;
      }
      undo.push(() => rmSync(dest, { recursive: true, force: true }));
    };
    const mkdirTracked = (p) => {
      let existed = true;
      try { lstatSync(p); } catch { existed = false; }
      ensureDir(p);
      if (!existed) undo.push(() => { try { rmdirSync(p); } catch { /* not empty: someone else's */ } });
    };
    try {
      for (const p of [join(homeAbs, ".oats"), modulesRoot, join(homeAbs, ".agents"), skillsRoot, join(homeAbs, ".claude")]) mkdirTracked(p);
      for (const { module } of sources) {
        placeDir(join(staging, "modules", module.name), join(modulesRoot, module.name));
        if (existsSync(join(staging, "skills", module.name))) placeDir(join(staging, "skills", module.name), join(skillsRoot, module.name));
      }
      swapIn(join(staging, "AGENTS.md"), join(homeAbs, "AGENTS.md"), "AGENTS.md");
      swapIn(join(staging, "instance.json"), instanceFile, "instance.json");
      // Aliases (relative symlinks), only when absent — the canonical-plus-alias construction stays; inside the transaction.
      const claudeMd = join(homeAbs, "CLAUDE.md");
      if (!linkPresent(claudeMd)) { symlinkSync("AGENTS.md", claudeMd); undo.push(() => rmSync(claudeMd, { force: true })); }
      const claudeSkills = join(homeAbs, ".claude", "skills");
      if (!linkPresent(claudeSkills)) { symlinkSync(join("..", ".agents", "skills"), claudeSkills); undo.push(() => rmSync(claudeSkills, { force: true })); }
    } catch (e) {
      for (const step of undo.reverse()) { try { step(); } catch { /* best effort: the original error is what matters */ } }
      if (e?.code === "EACCES" || e?.code === "EPERM" || e?.code === "EROFS" || e?.code === "EISDIR" || e?.code === "ENOTDIR") {
        throw fail("E_MATERIALIZE_HOME", `cannot write the instance home ${homeAbs}: ${e.message}`, { home: homeAbs, why: "unwritable", cause: e.code });
      }
      throw e;
    }
    discard();

    outcome = { modules: moduleRows, skills: skillRows, agentsMd: join(homeAbs, "AGENTS.md"), instanceJson: merged, blocks };
  } catch (error) {
    discard();
    throw error;
  }
  return outcome;
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

/**
 * driftOf(instanceJson, discovery, { lock } = {})
 * → [{ module, from, recorded: { repoKey, commit }, current: { commit } | null, status: "current"|"moved"|"missing", reason? }]
 *
 * Member modules: the confirmed member row for `repoKey` in `discovery.members` is the current
 * state — unconfirmed/absent → "missing" (reason "unconfirmed"); the capability gone from the
 * member → "missing" (reason "capability-absent"); a different commit → "moved"; else "current".
 * Package modules are pinned by version: without a lock they are "current"; with one, the lock's
 * entry decides — absent package or capability → "missing", another commit → "moved".
 */
export function driftOf(instanceJson, discovery, { lock } = {}) {
  const modules = plainObject(instanceJson?.modules) ? instanceJson.modules : {};
  const members = Array.isArray(discovery?.members) ? discovery.members : [];
  const rows = [];
  for (const name of Object.keys(modules).sort()) {
    const rec = modules[name] || {};
    const from = plainObject(rec.from) ? rec.from : {};
    const commit = typeof rec.commit === "string" ? rec.commit : (typeof from.commit === "string" ? from.commit : null);
    if (from.kind === "package") {
      const recorded = { repoKey: from.repoKey ?? null, package: from.package ?? null, version: from.version ?? null, commit };
      if (!plainObject(lock?.packages)) { rows.push({ module: name, from: clone(from), recorded, current: commit ? { commit } : null, status: "current" }); continue; }
      const entry = lock.packages[from.package];
      if (!entry) { rows.push({ module: name, from: clone(from), recorded, current: null, status: "missing", reason: "package-absent" }); continue; }
      if (Array.isArray(entry.capabilities) && !entry.capabilities.includes(name)) {
        rows.push({ module: name, from: clone(from), recorded, current: { commit: entry.commit, version: entry.version }, status: "missing", reason: "capability-absent" }); continue;
      }
      rows.push({ module: name, from: clone(from), recorded, current: { commit: entry.commit, version: entry.version }, status: entry.commit === commit ? "current" : "moved" });
      continue;
    }
    const repoKey = typeof from.repoKey === "string" ? from.repoKey : null;
    const recorded = { repoKey, commit };
    const member = repoKey ? members.find((m) => m && m.key === repoKey) : null;
    if (!member || !member.confirmed || typeof member.commit !== "string") {
      rows.push({ module: name, from: clone(from), recorded, current: null, status: "missing", reason: member ? (member.reason || "unconfirmed") : "unconfirmed" });
      continue;
    }
    const present = Array.isArray(member.capabilities) && member.capabilities.some((c) => c && c.name === name);
    if (!present) { rows.push({ module: name, from: clone(from), recorded, current: { commit: member.commit }, status: "missing", reason: "capability-absent" }); continue; }
    rows.push({ module: name, from: clone(from), recorded, current: { commit: member.commit }, status: member.commit === commit ? "current" : "moved" });
  }
  return rows;
}

/**
 * soulDriftOf(instanceJson, discovery)
 * → { name, repoKey, commit, current: { commit } | null, status: "current"|"moved"|"missing", reason? } | null
 *
 * Decision 17 for the SOUL SOURCE: a workspace spawn records `instance.json.workspace.soul =
 * { repoKey, commit, team }` (the member and commit the soul was fetched from). The member row
 * for `repoKey` in `discovery.members` is the current state: a different commit → "moved", the
 * soul gone from the member → "missing" (reason "soul-absent"), no usable row → "missing"
 * (reason "unconfirmed" / the row's reason). A standalone view's own member row is unconfirmed
 * by construction (reason "cannot-read") yet carries the repo's current commit — it is compared,
 * not reported missing. Returns null for a home without a recorded workspace soul (classic).
 */
export function soulDriftOf(instanceJson, discovery) {
  const soul = plainObject(instanceJson?.workspace) && plainObject(instanceJson.workspace.soul) ? instanceJson.workspace.soul : null;
  if (!soul || typeof soul.repoKey !== "string") return null;
  const name = typeof instanceJson.agent === "string" ? instanceJson.agent : (typeof instanceJson.soul === "string" ? instanceJson.soul : null);
  const commit = typeof soul.commit === "string" ? soul.commit : null;
  const members = Array.isArray(discovery?.members) ? discovery.members : [];
  const member = members.find((m) => m && m.key === soul.repoKey) || null;
  const standaloneOwn = discovery?.standalone === true && member && member.key === discovery.key && typeof member.commit === "string";
  const base = { name, repoKey: soul.repoKey, commit, team: soul.team ?? null };
  if (!member || (!member.confirmed && !standaloneOwn) || typeof member.commit !== "string") {
    return { ...base, current: null, status: "missing", reason: member ? (member.reason || "unconfirmed") : "unconfirmed" };
  }
  const present = name === null || (Array.isArray(member.souls) && member.souls.some((s) => s && s.name === name));
  if (!present) return { ...base, current: { commit: member.commit }, status: "missing", reason: "soul-absent" };
  return { ...base, current: { commit: member.commit }, status: member.commit === commit ? "current" : "moved" };
}

/** Read the modules recorded in an instance home (→ {} when absent). */
export function recordedModules(home) {
  const file = join(resolve(home), "instance.json");
  if (!existsSync(file)) return {};
  const parsed = readInstanceJson(file);
  return plainObject(parsed.modules) ? parsed.modules : {};
}
