/** Instance resolution — the bridge from the workspace model (remote → workspace →
 *  resolve → materialize) into a spawn.
 *
 *  A spawn is: read this machine's `oats-local.yaml` → discover the workspace over
 *  its Git remotes in the operator's access context → find the soul among the
 *  confirmed members (or external souls) → resolve every capability by `from:`
 *  (member = latest state, package = the locked version) → materialize
 *  each capability WHOLE into the new home (`.oats/modules/`, `.agents/skills/`) →
 *  compose AGENTS.md → launch the harness normally.
 *
 *  This module owns the async half (discover + resolve) and the materialize call;
 *  `core.mjs#spawnInstance` stays synchronous and consumes a PREPARED resolution
 *  (`o.prepared`) produced here. It also turns a Resolution into the capability
 *  row shape the rest of the kernel already understands (`toCapabilityRows`), so
 *  hooks, environment, requirements and retirement keep working unchanged.
 *
 *  Nothing here reads `oats-config.yaml`, an installed-capability directory or a
 *  per-soul `source:` — those do not exist in this model. */
import { existsSync, readFileSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve as resolvePath, dirname, relative, isAbsolute, sep } from "node:path";
import { oatsError } from "./errors.mjs";
import { loadLocal, discoverWorkspace, discoverRepo, standaloneRepo, observeWorkspace, observeSoulLabels } from "./workspace.mjs";
import { resolveSoul, teamsOf, kernelCompatibility } from "./resolve.mjs";
import { declaredSettings } from "./capability-contract.mjs";
import { materialize, MODULES_DIR, SKILLS_DIR } from "./materialize.mjs";
import { fetchRemoteTree } from "./remote.mjs";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, symlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readLock, LOCK_FILE, SOUL_ALIAS_SYMLINK } from "./packages.mjs";
import * as defaultRemote from "./remote.mjs";
import { parseRepoRef } from "./remote.mjs";

function err(code, message, details) { const e = oatsError(code, message, details); e.details = details; return e; }

/** Keys that would poison a payload's prototype (as own keys) or, as a CAPABILITY
 *  name, address an inherited member of a plain `{}` (`constructor`, `toString`, …).
 *  Same set as lib/resolve.mjs POISON_KEYS; refused with E_WORKSPACE_SCHEMA reason
 *  "poison-key" so a `--provider constructor x=1` never reaches Object.prototype. */
const POISON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/** `byTeam` is reserved: legal ONLY at the top level of workspace.messaging (decision 23);
 *  a spawn payload may never smuggle it in. */
const RESERVED_KEY = "byTeam";

/** Parse repeated `--provider <cap> k=v` occurrences into { <cap>: { k: v } }.
 *  Values are strings; `k=v=w` keeps everything after the first `=`. Poison keys
 *  (capability OR any path segment) are E_WORKSPACE_SCHEMA reason "poison-key";
 *  `byTeam` (any path segment) is E_WORKSPACE_SCHEMA reason "reserved-key". Both are
 *  refused again in resolve (defense in depth). The accumulators are built with
 *  Object.create(null) and only OWN keys are ever reused, so a name that happens to
 *  exist on Object.prototype (`toString`, `hasOwnProperty`) never writes through to it. */
export function parseProviderFlags(pairs) {
  const out = Object.create(null);
  for (const [cap, kv] of pairs) {
    if (typeof cap !== "string" || !/^[a-z][a-z0-9.-]{0,63}$/i.test(cap)) throw err("E_BAD_ARGS", `--provider needs <capability> <key>=<value> (got capability ${JSON.stringify(cap)})`);
    if (POISON_KEYS.has(cap)) throw err("E_WORKSPACE_SCHEMA", `--provider ${cap}: capability name ${JSON.stringify(cap)} is refused (it would poison the payload's prototype)`, { path: `/${cap}`, key: cap, reason: "poison-key" });
    if (typeof kv !== "string" || !kv.includes("=")) throw err("E_BAD_ARGS", `--provider ${cap}: expected <key>=<value>, got ${JSON.stringify(kv)}`);
    const i = kv.indexOf("=");
    const key = kv.slice(0, i), value = kv.slice(i + 1);
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(key)) throw err("E_BAD_ARGS", `--provider ${cap}: invalid key ${JSON.stringify(key)}`);
    // dotted keys nest: identity.source=retained:x → { identity: { source: "retained:x" } }
    const parts = key.split(".");
    for (const p of parts) {
      if (POISON_KEYS.has(p)) throw err("E_WORKSPACE_SCHEMA", `--provider ${cap}: key ${JSON.stringify(key)} is refused (segment ${JSON.stringify(p)} would poison the payload's prototype)`, { path: `/${cap}/${parts.join("/")}`, key: p, reason: "poison-key" });
      if (p === RESERVED_KEY) throw err("E_WORKSPACE_SCHEMA", `--provider ${cap}: key ${JSON.stringify(key)} is refused (${JSON.stringify(RESERVED_KEY)} is reserved for the top level of workspace.messaging)`, { path: `/${cap}/${parts.join("/")}`, key: p, reason: "reserved-key" });
    }
    if (!Object.hasOwn(out, cap)) out[cap] = Object.create(null);
    let cur = out[cap];
    for (const p of parts.slice(0, -1)) {
      if (!Object.hasOwn(cur, p) || cur[p] === null || typeof cur[p] !== "object") cur[p] = Object.create(null);
      cur = cur[p];
    }
    cur[parts.at(-1)] = value;
  }
  // Hand back ordinary objects (JSON-clean, Object.prototype) now that every key is vetted.
  return JSON.parse(JSON.stringify(out));
}

/** The qualified name of a discovered soul: `<package>/<soul>` for a package soul,
 *  `<member name>/<soul>` for a member's, `<source repo name>/<soul>` for an external one. */
export function qualifiedSoulName(entry) {
  if (typeof entry?.package === "string") return `${entry.package}/${entry.name}`;
  return `${memberNameOf(entry?.repoKey ?? "")}/${entry?.name}`;
}

/** Find the soul named `name` in a discovery: confirmed members, external souls and package
 *  souls. A bare name must be unique across all three (else E_SOUL_AMBIGUOUS naming each
 *  qualified form); `<repo>/<soul>` names a member (its key, a key suffix or its member name)
 *  or an external source, `<package>/<soul>` a package soul. */
export function findSoulEntry(discovery, name) {
  const [repoPart, soulPart] = name.includes("/") && !name.startsWith("/") ? [name.slice(0, name.lastIndexOf("/")), name.slice(name.lastIndexOf("/") + 1)] : [null, name];
  const hits = [];
  // A standalone view's one row is the repo's own (unconfirmed by definition — the
  // workspace could not be read); resolveSoul admits exactly that case.
  const standaloneOwn = discovery.standalone === true ? discovery.key : null;
  const memberMatches = (key) => !repoPart || key === repoPart || key.endsWith(repoPart) || memberNameOf(key) === repoPart;
  for (const m of discovery.members || []) {
    if (!m.confirmed && m.key !== standaloneOwn) continue;
    for (const s of m.souls || []) {
      if (s.name !== soulPart || !memberMatches(m.key)) continue;
      hits.push({ ...s, repoKey: m.key, memberCommit: m.commit, external: false });
    }
  }
  for (const x of discovery.external || []) {
    if (x.soul?.name === soulPart && (!repoPart || (x.source && String(x.source).includes(repoPart)))) hits.push({ ...x.soul, repoKey: x.soul.repoKey ?? parseRepoRef(x.source.replace(/@.*$/, "")).key, commit: x.commit, external: true });
  }
  for (const s of discovery.packageSouls || []) {
    if (s.name === soulPart && (!repoPart || repoPart === s.package)) hits.push({ ...s, external: false });
  }
  if (hits.length === 0) throw err("E_SOUL_UNKNOWN", `no soul ${JSON.stringify(name)} among the confirmed members, external souls or package souls of this workspace`, { name, members: (discovery.members || []).filter((m) => m.confirmed).map((m) => m.key), packages: [...new Set((discovery.packageSouls || []).map((s) => s.package))].sort() });
  if (hits.length > 1) {
    const qualified = hits.map(qualifiedSoulName);
    throw err("E_SOUL_AMBIGUOUS", `soul ${JSON.stringify(name)} is ${hits.length} souls (${qualified.join(", ")}); name one of them`, { name, repos: hits.map((h) => h.repoKey), qualified });
  }
  if (Array.isArray(hits[0].collides)) throw err("E_SOUL_AMBIGUOUS", `package souls ${hits[0].collides.join(" and ")} would share the agent directory agents/${hits[0].agentName}/ — keep one of the packages in the workspace's packages:`, { name, agentDir: hits[0].agentName, qualified: hits[0].collides });
  return hits[0];
}

/** The agents-root directory of a discovered soul: a package soul's is `<package>--<soul>`
 *  (packageSoulAgentName), every other soul's is its name. */
export function agentDirOf(entry) { return typeof entry?.agentName === "string" ? entry.agentName : entry?.name; }

/** `oats-local.yaml` `souls.disabled` (not run on this machine): an entry names a soul by its
 *  bare name (every soul of that name) or its qualified name. → the matching entry or null. */
export function disabledEntry(local, soulEntry) {
  const list = Array.isArray(local?.souls?.disabled) ? local.souls.disabled : [];
  const qualified = qualifiedSoulName(soulEntry);
  return list.find((d) => d === soulEntry.name || d === qualified) ?? null;
}

/**
 * A home's LIVE eligible teams (teams contract 2026-09-25, decision 6). Teams are messaging
 * state, not frozen composition: the soul's labels are read from its repository NOW and each
 * label's payload from the workspace's current `messaging`. The home's modules and skills are
 * untouched. No workspace discovery: exactly two repository reads — the workspace host at its
 * current commit (observeWorkspace) and the soul's own repo (observeSoulLabels).
 * → { teams, source: "live" } — or, when that cannot answer (the host or the soul's repo is
 *   unreachable, the soul is no longer listed, a standalone deployment), the spawn-time record:
 *   { teams: <record, or null when none>, source: "recorded", reason }.
 * `source` travels as OATS_TEAMS_SOURCE: a provider leaves a joined team only on a `live` answer.
 */
export async function liveTeams(home, meta, { remoteOptions, remote } = {}) {
  const recorded = (reason, error) => ({ teams: Array.isArray(meta?.teams) ? meta.teams : null, source: "recorded", reason, ...(error ? { error } : {}) });
  const soul = meta?.workspace?.soul;
  // A home without a workspace soul record (a pre-0.29 capability agent's) has nothing to re-read.
  if (!soul || typeof soul.repoKey !== "string" || typeof meta.agent !== "string") return recorded("no-workspace-soul");
  // A package soul's labels are pinned with the package: the spawn-time record is its answer.
  if (soul.package && typeof soul.package === "object") return recorded("package-soul");
  const deployment = dirname(dirname(dirname(dirname(resolvePath(home)))));
  try {
    const found = loadLocal(deployment);
    if (!found.path || resolvePath(dirname(found.path)) !== resolvePath(deployment)) return recorded("no-deployment");
    if (typeof found.local.standalone === "string" && found.local.standalone) return recorded("standalone");
    const wsObs = await observeWorkspace(found.local.workspace, { remoteOptions, remote });
    const labels = await observeSoulLabels(wsObs, { name: meta.agent, repoKey: soul.repoKey }, { remoteOptions, remote });
    if (labels === null) return recorded("soul-not-listed");
    return { teams: teamsOf(wsObs.workspace, labels), source: "live" };
  } catch (e) { return recorded("unreadable", { code: e?.code || "E_REMOTE_UNREADABLE", message: e?.message ?? String(e) }); }
}

/** The per-commit soul cache under an agent directory: `<agentDir>/souls/<commit12>/`.
 *  Each entry is IMMUTABLE once written (fetched to staging, renamed in) and is never
 *  removed by the kernel — a running instance records its own commit's directory
 *  (realpath, instance.json `soulDir`, handed to hooks as OATS_SOUL), so nothing can
 *  change under it. */
export const SOULS_DIR = "souls";
export const SOUL_SOURCE_STAMP = ".oats-soul-source.json";
const commit12 = (c) => String(c || "").slice(0, 12) || "unknown";
/** The kernel-owned "current" pointer `<agentDir>/soul` is a symlink whose target
 *  sits inside `<agentDir>/souls/`. Returns that target's realpath, or null when the
 *  path is absent, a real directory (0.25.0 layout) or a symlink elsewhere. */
export function soulPointerTarget(soulDir) {
  let st; try { st = lstatSync(soulDir); } catch { return null; }
  if (!st.isSymbolicLink()) return null;
  let real; try { real = realpathSync(soulDir); } catch { return null; }
  let soulsReal; try { soulsReal = realpathSync(join(dirname(soulDir), SOULS_DIR)); } catch { return null; }
  const rel = relative(soulsReal, real);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.includes(sep)) return null;
  return real;
}
/** Atomically point `<agentDir>/soul` at `target`: symlink to a temp name, rename over.
 *  The previous target directory is untouched (an instance may link it). */
function swapSoulPointer(soulDir, target) {
  const tmp = `${soulDir}.pointer-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    symlinkSync(target, tmp);
    renameSync(tmp, soulDir); // rename over an existing symlink replaces it; over a directory it fails (caller migrates first)
  } catch (x) { try { rmSync(tmp, { force: true }); } catch { /* nothing */ } throw x; }
}

/** Fetch a prepared soul's source tree (soul.yaml + AGENTS.md, CLAUDE.md → AGENTS.md) into `dest`. */
async function fetchSoulSource(prepared, dest) {
  const e = prepared.soulEntry;
  const ref = typeof e.ref === "string" ? e.ref : e.repoKey.startsWith("local/") ? e.repoKey.slice("local/".length) : `git:${e.repoKey}`;
  // A soul's CLAUDE.md → AGENTS.md alias is the one symlink a soul source may carry.
  const { digest } = await fetchRemoteTree(ref, e.commit, e.path, dest, { ...(prepared.remoteOptions || {}), allowSymlinks: SOUL_ALIAS_SYMLINK });
  // A package soul is what the lock recorded at sync: the same bytes at the locked commit.
  if (typeof e.package === "string" && digest !== e.digest) {
    throw err("E_PACKAGE_INTEGRITY", `package soul ${e.qualifiedName} v${e.version} @ ${String(e.commit).slice(0, 12)}: content digest ${digest} does not match the locked ${e.digest} — run \`oats sync\` (a lock that was edited: remove the entry and sync again)`, { package: e.package, soul: e.name, version: e.version, commit: e.commit, why: "soul-digest", locked: e.digest, observed: digest });
  }
  if (!existsSync(join(dest, "soul.yaml")) || !existsSync(join(dest, "AGENTS.md"))) throw err("E_SOUL_INCOMPLETE", `soul ${e.name} at ${e.repoKey}@${String(e.commit).slice(0, 12)} lacks soul.yaml or AGENTS.md`, { repoKey: e.repoKey, commit: e.commit, path: e.path });
  if (!existsSync(join(dest, "CLAUDE.md"))) symlinkSync("AGENTS.md", join(dest, "CLAUDE.md"));
}

/** A preview's soul source. A preview writes NOTHING in the deployment (K6b), so it
 *  never populates the per-commit cache or moves the `soul` pointer: it reads the
 *  cache entry for the prepared commit when one is already complete, else fetches
 *  the source into a temporary directory outside the deployment. `cleanup` removes
 *  that temporary copy; `fetched` says whether the preview had to fetch. */
export async function previewWorkspaceSoul(prepared, agentsRoot) {
  const e = prepared.soulEntry;
  const commitDir = join(agentsRoot, agentDirOf(e), SOULS_DIR, commit12(e.commit));
  if (existsSync(join(commitDir, "soul.yaml")) && existsSync(join(commitDir, "AGENTS.md"))) return { soulDir: realpathSync(commitDir), fetched: false, cleanup: () => {} };
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "oats-preview-soul-")));
  const cleanup = () => rmSync(tmp, { recursive: true, force: true });
  try { await fetchSoulSource(prepared, join(tmp, "soul")); }
  catch (x) { cleanup(); throw x; }
  return { soulDir: join(tmp, "soul"), fetched: true, cleanup };
}

/** Materialize a workspace soul's SOURCE (soul.yaml, AGENTS.md, skills/…) into the
 *  per-commit cache `<agentsRoot>/<name>/souls/<commit12>/` and point the classic
 *  `<agentsRoot>/<name>/soul` at it (a SYMLINK, swapped atomically), so the classic
 *  spawn skeleton, findAgent, doctor … keep reading "current" from the usual place
 *  while every spawned home links its OWN commit's directory (decision 7: an
 *  instance never changes under itself — a later spawn may fetch a new commit and
 *  move the pointer, but no directory an instance links is ever touched; a preview
 *  never calls this, see previewWorkspaceSoul).
 *
 *  Idempotent per (repo, commit): an existing complete entry is reused (never
 *  refetched, never rewritten); an entry that lost its soul.yaml is moved aside and
 *  refetched. `.oats-soul-source.json` stamps what the pointer currently shows.
 *  Migration: a 0.25.0 `soul/` that is a REAL directory is moved to
 *  `souls/<commit from the stamp | unknown>/` before the pointer replaces it.
 *  Returns the PER-COMMIT directory (what a home should link). */
export async function ensureWorkspaceSoul(prepared, agentsRoot) {
  const e = prepared.soulEntry;
  const agentDir = join(agentsRoot, agentDirOf(e)); const soulDir = join(agentDir, "soul");
  const soulsDir = join(agentDir, SOULS_DIR);
  const stamp = join(agentDir, SOUL_SOURCE_STAMP);
  const readStamp = () => { try { return JSON.parse(readFileSync(stamp, "utf8")); } catch { return null; } };
  const commitDir = join(soulsDir, commit12(e.commit));
  mkdirSync(soulsDir, { recursive: true });

  // --- migration: a 0.25.0 real `soul/` directory becomes souls/<commit|unknown>/ ---
  let st; try { st = lstatSync(soulDir); } catch { st = null; }
  if (st && !st.isSymbolicLink() && st.isDirectory()) {
    const cur = readStamp();
    const legacyCommit = cur && cur.repoKey === e.repoKey && typeof cur.commit === "string" && cur.commit ? commit12(cur.commit) : "unknown";
    let dest = join(soulsDir, legacyCommit);
    if (existsSync(dest)) dest = join(soulsDir, `${legacyCommit}.migrated-${process.pid}-${randomBytes(4).toString("hex")}`);
    renameSync(soulDir, dest);
    swapSoulPointer(soulDir, dest);
  } else if (st && !st.isSymbolicLink()) {
    // a regular file where the pointer belongs: not ours to keep
    rmSync(soulDir, { force: true });
  }

  // --- the per-commit entry: reuse when complete, else fetch (staging → rename in) ---
  let complete = existsSync(join(commitDir, "soul.yaml")) && existsSync(join(commitDir, "AGENTS.md"));
  if (existsSync(commitDir) && !complete) {
    // A damaged entry (someone removed soul.yaml): move it aside — an instance may
    // still link it, so it is never deleted — and fetch a fresh copy under the canonical name.
    renameSync(commitDir, `${commitDir}.damaged-${process.pid}-${randomBytes(4).toString("hex")}`);
  }
  if (!complete) {
    const staging = join(soulsDir, `.soul-staging-${process.pid}-${randomBytes(4).toString("hex")}`);
    try {
      await fetchSoulSource(prepared, staging);
      try { renameSync(staging, commitDir); }
      catch (x) {
        // Lost a race with a concurrent fetch of the same commit: theirs is the same bytes.
        if (!(existsSync(join(commitDir, "soul.yaml")) && existsSync(join(commitDir, "AGENTS.md")))) throw x;
        rmSync(staging, { recursive: true, force: true });
      }
    } catch (x) { try { rmSync(staging, { recursive: true, force: true }); } catch { /* nothing */ } throw x; }
  }

  // --- the "current" pointer + its stamp ---
  const target = realpathSync(commitDir);
  if (soulPointerTarget(soulDir) !== target) swapSoulPointer(soulDir, target);
  const cur = readStamp();
  if (!cur || cur.repoKey !== e.repoKey || cur.commit !== e.commit || cur.path !== e.path) {
    const pkg = typeof e.package === "string" ? { package: e.package, version: e.version } : {};
    writeFileSync(stamp, JSON.stringify({ repoKey: e.repoKey, commit: e.commit, path: e.path, ...pkg, fetchedAt: new Date().toISOString() }, null, 2) + "\n");
  }
  return target;
}

// ---------------------------------------------------------------------------
// Member clones — where a workspace soul's `work: worktree|checkout` target lives
// ---------------------------------------------------------------------------

/** The taught member name of a repo key: the last path segment without `.git`
 *  (`github.com/northwind/platform` → `platform`). The same rule `oats onboard`
 *  and `oats sync` print (memberLabel). */
export function memberNameOf(key) {
  return String(key).split("/").filter(Boolean).pop()?.replace(/\.git$/i, "") || String(key);
}

/** The convention path of a member's clone: `<deployment>/<member name>` — except a
 *  member called `agents`, which is cloned as `agents-repo/` because `<deployment>/agents/`
 *  is the instance root (design doc §4; matches onboard's cloneDirOf). */
export function conventionCloneDir(deployment, key) {
  const name = memberNameOf(key);
  return join(deployment, name === "agents" ? "agents-repo" : name);
}

/** Normalise a key an operator may have WRITTEN in `clones:` — the canonical key
 *  (`github.com/org/repo`), or any ref form parseRepoRef understands (`git:…`,
 *  `https://…`, `git@host:…`, `/abs/bare.git`) — to the canonical key. A key that
 *  parses no way is returned as written (it can then only match literally). */
function canonicalCloneKey(written) {
  const s = String(written).trim();
  if (s.startsWith("local/")) return s; // a local key is already canonical
  for (const candidate of [s, `git:${s}`]) {
    try { return parseRepoRef(candidate).key; } catch { /* next form */ }
  }
  return s;
}

/** The remote urls a clone carries (any remote, not only origin), parsed to their
 *  repo keys. Not a git repo → null. */
function cloneRemoteKeys(path) {
  const git = (argv) => spawnSync("git", ["-C", path, ...argv], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const inside = git(["rev-parse", "--git-dir"]);
  if (inside.status !== 0) return null;
  const cfg = git(["config", "--get-regexp", "^remote\\..*\\.url$"]);
  const keys = [];
  if (cfg.status === 0) {
    for (const line of cfg.stdout.split("\n")) {
      const url = line.replace(/^\S+\s+/, "").trim();
      if (!url) continue;
      try { keys.push(parseRepoRef(url).key); } catch { keys.push(`?/${url}`); }
    }
  }
  return keys;
}

/** Two repo keys name the same repository. Hosted keys compare literally; `local/<abs>`
 *  keys compare by realpath when the path exists (macOS tmpdir → /private/var…). */
function sameRepoKey(a, b) {
  if (a === b) return true;
  if (!a.startsWith("local/") || !b.startsWith("local/")) return false;
  const real = (k) => { try { return realpathSync(k.slice("local/".length)); } catch { return k.slice("local/".length); } };
  return real(a) === real(b);
}

/** Verify `path` is the clone of `key`: it exists, is a directory, is a Git repo, and
 *  one of its remotes parses to `key`. Anything else → E_CLONE_MISMATCH { path, expected,
 *  found } — the operator pointed the kernel at the wrong place; it never works there. */
export function verifyMemberClone(path, key, { via } = {}) {
  const mismatch = (found, why) => err("E_CLONE_MISMATCH", `${via ? `${via}: ` : ""}${path} is not a clone of ${key}${why ? ` (${why})` : ""}${found && found.length ? ` — its remotes point at ${found.join(", ")}` : ""}`, { path, expected: key, found, via: via ?? null });
  let st; try { st = statSync(path); } catch { throw mismatch(null, "the path does not exist"); }
  if (!st.isDirectory()) throw mismatch(null, "not a directory");
  const found = cloneRemoteKeys(path);
  if (found === null) throw mismatch(null, "not a Git repository");
  if (!found.some((k) => sameRepoKey(k, key))) throw mismatch(found, found.length ? "no remote names it" : "it has no remotes");
  return path;
}

/**
 * Where the work target of a PREPARED spawn lives — the member clone of the soul's
 * repo on this machine (design doc §4; decision 9: the work target is the only thing
 * that needs a clone). In order:
 *   1. `explicit` (`--repo`) — the operator's word; relative to the deployment; not
 *      verified against the member (an explicit --repo may deliberately point elsewhere);
 *   2. `oats-local.yaml` `clones: { <repo key>: <path> }` — the key as written is
 *      normalised through parseRepoRef so `git:…`, `https://…`, `git@…` spellings match;
 *   3. `<deployment>/<member name>` (`agents` → `agents-repo`);
 *   4. null — nothing on this machine.
 * A path found by (2) or (3) is VERIFIED: a directory, a Git repo, one remote parsing to
 * the member's key → else E_CLONE_MISMATCH. A `clones:` entry whose path is absent is a
 * mismatch too (the operator named it; "missing" would hide the typo).
 * Returns an absolute path or null.
 */
export function resolveMemberClone(prepared, { explicit } = {}) {
  const deployment = resolvePath(prepared?.deployment ?? process.cwd());
  if (typeof explicit === "string" && explicit.trim()) return isAbsolute(explicit) ? resolvePath(explicit) : resolvePath(deployment, explicit);
  const key = prepared?.soulEntry?.repoKey;
  if (typeof key !== "string" || !key) return null;
  return memberCloneOf(deployment, prepared?.local, key).path;
}

/** Steps 2–4 of resolveMemberClone for one member, naming the rule that found it (feature desktop-facts):
 *  → { path, rule: "clones" | "convention" } | { path: null, rule: null }; a named or conventional path that
 *  is not the member's clone is E_CLONE_MISMATCH, as for a spawn. */
export function memberCloneOf(deployment, local, key) {
  const clones = local?.clones;
  if (clones && typeof clones === "object") {
    for (const [written, value] of Object.entries(clones)) {
      if (!sameRepoKey(canonicalCloneKey(written), key)) continue;
      if (typeof value !== "string" || !value.trim()) throw err("E_CLONE_MISMATCH", `oats-local.yaml clones: ${written} must be a path`, { path: value, expected: key, found: null, via: "oats-local.yaml clones:" });
      const path = isAbsolute(value) ? resolvePath(value) : resolvePath(deployment, value);
      return { path: verifyMemberClone(path, key, { via: `oats-local.yaml clones: ${written}` }), rule: "clones" };
    }
  }
  const convention = conventionCloneDir(deployment, key);
  if (!existsSync(convention)) return { path: null, rule: null };
  return { path: verifyMemberClone(convention, key, { via: "convention path" }), rule: "convention" };
}

/** The clone url of the soul's member as the workspace names it (for remedies). */
function memberUrlOf(prepared, key) {
  for (const ref of prepared?.discovery?.workspace?.members || []) {
    try { const p = parseRepoRef(ref); if (sameRepoKey(p.key, key)) return p.url; } catch { /* validated already */ }
  }
  if (prepared?.discovery?.standalone === true && prepared.discovery.key === key) return prepared.discovery.url ?? null;
  return key.startsWith("local/") ? key.slice("local/".length) : `https://${key}.git`;
}

/** resolveMemberClone, or E_CLONE_MISSING naming BOTH ways to provide the clone
 *  (the convention path and a `clones:` entry) plus `--repo` for a one-off. */
export function requireMemberClone(prepared, { explicit } = {}) {
  const found = resolveMemberClone(prepared, { explicit });
  if (found) return found;
  const key = prepared?.soulEntry?.repoKey ?? "<repo>";
  const deployment = resolvePath(prepared?.deployment ?? process.cwd());
  const convention = conventionCloneDir(deployment, key);
  const url = memberUrlOf(prepared, key);
  const soul = prepared?.soulEntry?.name ?? "<soul>";
  const work = prepared?.soulEntry?.definition?.work ?? "worktree";
  throw err("E_CLONE_MISSING", `soul ${soul} works in a ${work} of ${key}, and this machine has no clone of it — either \`git clone ${url} ${convention}\` (the convention: <deployment>/<member name>) or point oats-local.yaml at an existing clone: \`clones: { ${key}: <abs path> }\`; for a one-off pass --repo <path>`, { soul, repoKey: key, work, deployment, convention, url, remedies: { clone: `git clone ${url} ${convention}`, local: { clones: { [key]: "<abs path>" } }, flag: "--repo <path>" } });
}

/** Would a spawn of this discovered soul be refused before it touches this machine (feature desktop-facts)?
 *  The same checks prepareInstance makes — souls.disabled, then the soul's resolution (team conflicts, slot
 *  conflicts, missing or private capabilities, compatibility …) — without spawning anything.
 *  → { spawnable: true, problem: null } | { spawnable: false, problem: { code, message } } */
export async function soulSpawnability(local, discovery, lock, soulEntry, { remoteOptions, remote } = {}) {
  const disabled = disabledEntry(local, soulEntry);
  if (disabled !== null) return { spawnable: false, problem: { code: "E_SOUL_DISABLED", message: `disabled on this machine (oats-local.yaml souls.disabled: ${disabled})` } };
  try { await resolveSoul(discovery, soulEntry, { local, lock, spawn: {}, remoteOptions, remote }); return { spawnable: true, problem: null }; }
  catch (e) { if (typeof e?.code === "string" && e.code.startsWith("E_")) return { spawnable: false, problem: { code: e.code, message: e.message } }; throw e; }
}

/** The async half of a spawn: everything that touches the network. Returns a
 *  PREPARED object that `spawnInstance` consumes synchronously. */
export async function prepareInstance(contextDir, soulName, { spawn = {}, remoteOptions, remote, local: localOverride, discovery: discoveryOverride } = {}) {
  const found = localOverride ? { path: null, local: localOverride } : loadLocal(contextDir);
  const local = found.local;
  const deployment = found.path ? dirname(found.path) : resolvePath(contextDir);
  const lock = existsSync(join(deployment, LOCK_FILE)) ? readLock(deployment) : null;
  const discovery = discoveryOverride ?? await discoverOrStandalone(local, { lock, remoteOptions, remote });
  const soulEntry = findSoulEntry(discovery, soulName);
  const disabled = disabledEntry(local, soulEntry);
  if (disabled !== null) throw err("E_SOUL_DISABLED", `soul ${qualifiedSoulName(soulEntry)} is disabled on this machine (oats-local.yaml souls.disabled: ${disabled}) — remove it from that list to spawn it here`, { name: soulEntry.name, qualifiedName: qualifiedSoulName(soulEntry), entry: disabled });
  const resolution = await resolveSoul(discovery, soulEntry, { local, lock, spawn, remoteOptions, remote });
  return { local, deployment, lock, discovery, soulEntry, resolution, remoteOptions, spawn };
}

/** E_REMOTE_UNREADABLE reasons (lib/remote.mjs classifyRemoteFailure) that mean "the
 *  operator's access context cannot see this host" — the ONLY reasons that turn a
 *  workspace spawn into the standalone view. `network` / `timeout` are transient: the
 *  workspace exists and is ours; a spawn must not quietly degrade to a standalone one. */
const ACCESS_REASONS = new Set(["auth", "not-found"]);
const isAccessFailure = (e) => e?.code === "E_REMOTE_UNREADABLE" && ACCESS_REASONS.has(e?.details?.reason ?? e?.provenance?.reason);

/** The deployment's lock, or null when it has none (an unreadable lock is E_LOCK_SCHEMA). */
export function deploymentLock(deployment) {
  return existsSync(join(deployment, LOCK_FILE)) ? readLock(deployment) : null;
}

/** Decision 10: a standalone view is a MEMBER whose workspace cannot be read — the
 *  repo must declare that workspace (oats-membership.yaml). A lone repo with no
 *  backlink is not a member of anything and never becomes a capability source. */
function requireMembership(repo, ref) {
  if (repo.membership) return;
  throw err("E_MEMBERSHIP_UNCONFIRMED", `a standalone view is a MEMBER whose workspace cannot be read; ${repo.key} declares no workspace (no oats-membership.yaml at ${String(repo.commit).slice(0, 12)})`, { key: repo.key, commit: repo.commit, ref, reason: "no-backlink" });
}

/**
 * Discover the workspace named by oats-local.yaml — or, when that ref is a REPO
 * whose workspace cannot be read (decision 10, the standalone case: a public
 * member of a privately hosted workspace), fall back to the repo's own souls and
 * capabilities. `standalone: <repo ref>` in oats-local.yaml asks for the standalone
 * view explicitly (no workspace lookup at all) — the repo must still be a member
 * (carry oats-membership.yaml), exactly as on the fallback path.
 *
 * A standalone result carries `standalone: true` and `standaloneReason`:
 *   "explicit"        — oats-local.yaml said `standalone:`;
 *   "unreadable-host" — `workspace:` named a member whose declared host is not
 *                        readable in this access context (auth / not-found).
 * A transient failure reading the host (network, timeout) is rethrown as-is.
 */
export async function discoverOrStandalone(local, { lock, deployment, remoteOptions, remote } = {}) {
  const ro = { remoteOptions, remote };
  // Package souls are listed from the deployment's lock (the `lock` given, else `<deployment>/oats-lock.json`).
  if (lock === undefined) lock = typeof deployment === "string" ? deploymentLock(deployment) : null;
  if (typeof local.standalone === "string" && local.standalone) {
    const repo = await discoverRepo(local.standalone, ro);
    requireMembership(repo, local.standalone);
    return { ...standaloneRepo(local.standalone, repo.commit, repo, { remote }), standaloneReason: "explicit" };
  }
  try { return await discoverWorkspace(local.workspace, { local, lock, ...ro }); }
  catch (e) {
    if (e?.code !== "E_WORKSPACE_SCHEMA" || e?.details?.notAHost !== true) throw e;
    // The ref is a repository without oats-workspace.yaml: is it a member whose
    // workspace we cannot read? Then the standalone view is what the operator gets.
    const repo = await discoverRepo(local.workspace, ro);
    if (!repo.membership) throw e;
    try { return await discoverWorkspace(repo.membership.workspace, { local, lock, ...ro }); }
    catch (inner) {
      // Only an ACCESS failure on the host means "standalone"; anything else
      // (network, timeout, a broken workspace file) is the caller's to see.
      if (!isAccessFailure(inner)) throw inner;
      return { ...standaloneRepo(local.workspace, repo.commit, repo, { remote }), standaloneReason: "unreadable-host", hostFailure: { code: inner.code, reason: inner.details?.reason ?? inner.provenance?.reason ?? null, url: inner.details?.url ?? inner.provenance?.url ?? null } };
    }
  }
}

/** Materialize a prepared resolution into `home`. Called by spawnInstance after
 *  the home directory exists and before the harness is launched. */
export async function materializePrepared(prepared, home) {
  return materialize(prepared.resolution, home, { lock: prepared.lock, remoteOptions: prepared.remoteOptions, soulAgentsMd: prepared.soulAgentsMd, soulDir: prepared.soulDir });
}


/** Turn a Resolution's modules (already materialized under `home`) into the
 *  capability rows the kernel's hooks/environment/requirements code consumes.
 *  Paths point INTO the instance's own copy — never at a repo or a package dir. */
export function toCapabilityRows(resolution, home) {
  const rows = [];
  for (const m of resolution.modules) {
    const dir = join(home, MODULES_DIR, m.name);
    const manifest = m.manifest;
    const skills = [];
    const skillsRoot = join(home, SKILLS_DIR, m.name);
    if (existsSync(skillsRoot)) for (const e of readdirSync(skillsRoot, { withFileTypes: true })) if (e.isDirectory()) skills.push(join(skillsRoot, e.name));
    const inject = manifest.inject ? join(dir, manifest.inject) : undefined;
    rows.push({
      id: m.name, capability: m.name, manifest, layer: manifest.layer ?? undefined, command: manifest.command,
      level: home, origin: m.from.kind === "package" ? `package:${m.from.package}@${m.from.version}` : `member:${m.from.repoKey}@${m.from.commit}`,
      provenance: [m.from.kind === "package" ? `package ${m.from.package} v${m.from.version}` : `member ${m.from.repoKey} @ ${String(m.from.commit).slice(0, 12)}`],
      settings: { ...(resolution.payloads?.[m.name] && typeof resolution.payloads[m.name] === "object" ? resolution.payloads[m.name] : {}) },
      settingsOrigins: { ...(resolution.payloadOrigins?.[m.name] && typeof resolution.payloadOrigins[m.name] === "object" ? resolution.payloadOrigins[m.name] : {}) },
      skills, inject: inject && existsSync(inject) ? inject : undefined,
      skillsDeclared: manifest.skills || [], injectDeclared: manifest.inject,
      // Member capabilities are trusted by membership (decision 2); package
      // capabilities by their declaration in the workspace's packages: (human
      // decision 2026-09-24: declaring a package is the trust decision).
      hooks: hookCommandsOf(manifest, dir), requiredHooks: requiredHooksOf(manifest),
      environment: [...(manifest.environment || [])], environmentNamespaces: [...(manifest.environmentNamespaces || [])],
      missingRequires: [], compatibility: kernelCompatibility({ ...manifest, capability: m.name }), trust: { trusted: true, reason: m.from.kind === "package" ? "declared workspace package" : "workspace member" },
      executable: !!manifest.commands && Object.keys(manifest.commands).length > 0,
      retirement: manifest.retirement,
      dir, from: m.from, _scope: 0,
    });
  }
  return rows;
}

function hookCommandsOf(manifest, dir) {
  const out = {};
  const hooks = manifest.hooks && typeof manifest.hooks === "object" ? manifest.hooks : {};
  for (const [event, spec] of Object.entries(hooks)) {
    const cmd = typeof spec === "string" ? spec : spec?.command;
    if (typeof cmd === "string" && cmd) out[event] = { command: cmd, cwd: dir, required: spec?.required === true };
  }
  return out;
}
function requiredHooksOf(manifest) {
  const hooks = manifest.hooks && typeof manifest.hooks === "object" ? manifest.hooks : {};
  return Object.entries(hooks).filter(([, s]) => s && typeof s === "object" && s.required === true).map(([e]) => e);
}

/** What a preview shows about modules: from/commit/digest per module and whether
 *  it changed since the newest existing instance of the same soul in `agentsRoot`. */
export function modulesPreview(resolution, agentsRoot, soulName) {
  let previous = null;
  const instancesDir = join(agentsRoot, soulName, "instances");
  if (existsSync(instancesDir)) {
    let newest = null;
    for (const e of readdirSync(instancesDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      try {
        const meta = JSON.parse(readFileSync(join(instancesDir, e.name, "instance.json"), "utf8"));
        if (meta?.modules && (!newest || String(meta.createdAt) > String(newest.createdAt))) newest = { name: e.name, ...meta };
      } catch { /* not an instance */ }
    }
    previous = newest;
  }
  return resolution.modules.map((m) => {
    const prev = previous?.modules?.[m.name];
    const changedSince = !previous ? null : !prev ? { instance: previous.name, was: null } : (prev.commit !== m.from.commit ? { instance: previous.name, was: prev.commit } : false);
    return { name: m.name, from: m.from, layer: m.manifest.layer ?? null, private: !!m.private, declares: declaredSettings(m.manifest), changedSince };
  });
}

/** The relative pi/claude/codex skill directory inside a home — exported so the
 *  launch recipe and tests agree on it. */
export const INSTANCE_SKILLS_DIR = SKILLS_DIR;
export const INSTANCE_MODULES_DIR = MODULES_DIR;


