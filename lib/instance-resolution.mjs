/** Instance resolution — the bridge from the workspace model (remote → workspace →
 *  resolve → materialize) into a spawn.
 *
 *  A spawn is: read this machine's `oats-local.yaml` → discover the workspace over
 *  its Git remotes in the operator's access context → find the soul among the
 *  confirmed members (or external souls) → resolve every capability by `from:`
 *  (member = latest state, package = the locked, approved version) → materialize
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
import { existsSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, resolve as resolvePath, dirname, basename } from "node:path";
import { oatsError } from "./errors.mjs";
import { loadLocal, discoverWorkspace, discoverRepo, standaloneRepo } from "./workspace.mjs";
import { resolveSoul } from "./resolve.mjs";
import { materialize, MODULES_DIR, SKILLS_DIR } from "./materialize.mjs";
import { fetchRemoteTree } from "./remote.mjs";
import { mkdirSync, renameSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { readLock, LOCK_FILE } from "./packages.mjs";
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

/** Find the soul named `name` in a discovery: confirmed members first (by
 *  `repo/name` or bare name when unique), then external souls. */
export function findSoulEntry(discovery, name) {
  const [repoPart, soulPart] = name.includes("/") && !name.startsWith("/") ? [name.slice(0, name.lastIndexOf("/")), name.slice(name.lastIndexOf("/") + 1)] : [null, name];
  const hits = [];
  // A standalone view's one row is the repo's own (unconfirmed by definition — the
  // workspace could not be read); resolveSoul admits exactly that case.
  const standaloneOwn = discovery.standalone === true ? discovery.key : null;
  for (const m of discovery.members || []) {
    if (!m.confirmed && m.key !== standaloneOwn) continue;
    for (const s of m.souls || []) {
      if (s.name !== soulPart) continue;
      if (repoPart && !m.key.endsWith(repoPart) && m.key !== repoPart) continue;
      hits.push({ ...s, repoKey: m.key, memberCommit: m.commit, external: false });
    }
  }
  for (const x of discovery.external || []) {
    if (x.soul?.name === soulPart && (!repoPart || (x.source && String(x.source).includes(repoPart)))) hits.push({ ...x.soul, repoKey: x.soul.repoKey ?? parseRepoRef(x.source.replace(/@.*$/, "")).key, commit: x.commit, external: true });
  }
  if (hits.length === 0) throw err("E_SOUL_UNKNOWN", `no soul ${JSON.stringify(name)} among the confirmed members or external souls of this workspace`, { name, members: (discovery.members || []).filter((m) => m.confirmed).map((m) => m.key) });
  if (hits.length > 1) throw err("E_SOUL_AMBIGUOUS", `soul ${JSON.stringify(name)} exists in ${hits.length} repos; name it as <repo>/${soulPart}`, { name, repos: hits.map((h) => h.repoKey) });
  return hits[0];
}

/** Materialize a workspace soul's SOURCE (soul.yaml, AGENTS.md, skills/…) into
 *  `<agentsRoot>/<name>/soul/` so the classic spawn skeleton (which reads the
 *  soul from a directory) can proceed. Idempotent per (repo, commit): a soul dir
 *  already at that commit is reused; a different commit replaces it atomically
 *  (instances keep their own copies, so this is safe). Returns the soul dir. */
export async function ensureWorkspaceSoul(prepared, agentsRoot) {
  const e = prepared.soulEntry;
  const agentDir = join(agentsRoot, e.name); const soulDir = join(agentDir, "soul");
  const stamp = join(agentDir, ".oats-soul-source.json");
  try { const cur = JSON.parse(readFileSync(stamp, "utf8")); if (cur.repoKey === e.repoKey && cur.commit === e.commit && existsSync(join(soulDir, "soul.yaml"))) return soulDir; } catch { /* absent or stale */ }
  const ref = e.repoKey.startsWith("local/") ? e.repoKey.slice("local/".length) : `git:${e.repoKey}`;
  const staging = join(agentDir, `.soul-staging-${process.pid}-${randomBytes(4).toString("hex")}`);
  mkdirSync(agentDir, { recursive: true });
  try {
    // A soul's CLAUDE.md → AGENTS.md alias is the one symlink a soul source may carry.
    await fetchRemoteTree(ref, e.commit, e.path, staging, { ...(prepared.remoteOptions || {}), allowSymlinks: (p) => p === "CLAUDE.md" });
    if (!existsSync(join(staging, "soul.yaml")) || !existsSync(join(staging, "AGENTS.md"))) throw err("E_SOUL_INCOMPLETE", `soul ${e.name} at ${e.repoKey}@${String(e.commit).slice(0, 12)} lacks soul.yaml or AGENTS.md`, { repoKey: e.repoKey, commit: e.commit, path: e.path });
    if (!existsSync(join(staging, "CLAUDE.md"))) symlinkSync("AGENTS.md", join(staging, "CLAUDE.md"));
    if (existsSync(soulDir)) { const old = `${soulDir}.previous-${Date.now()}`; renameSync(soulDir, old); try { rmSync(old, { recursive: true, force: true }); } catch { /* leave it */ } }
    renameSync(staging, soulDir);
    writeFileSync(stamp, JSON.stringify({ repoKey: e.repoKey, commit: e.commit, path: e.path, fetchedAt: new Date().toISOString() }, null, 2) + "\n");
    return soulDir;
  } catch (x) { try { rmSync(staging, { recursive: true, force: true }); } catch { /* nothing */ } throw x; }
}

/** The async half of a spawn: everything that touches the network. Returns a
 *  PREPARED object that `spawnInstance` consumes synchronously. */
export async function prepareInstance(contextDir, soulName, { spawn = {}, remoteOptions, remote, local: localOverride, discovery: discoveryOverride } = {}) {
  const found = localOverride ? { path: null, local: localOverride } : loadLocal(contextDir);
  const local = found.local;
  const deployment = found.path ? dirname(found.path) : resolvePath(contextDir);
  const lock = existsSync(join(deployment, LOCK_FILE)) ? readLock(deployment) : null;
  const discovery = discoveryOverride ?? await discoverOrStandalone(local, { remoteOptions, remote });
  const soulEntry = findSoulEntry(discovery, soulName);
  const resolution = await resolveSoul(discovery, soulEntry, { local, lock, spawn, remoteOptions, remote });
  return { local, deployment, lock, discovery, soulEntry, resolution, remoteOptions };
}

/** E_REMOTE_UNREADABLE reasons (lib/remote.mjs classifyRemoteFailure) that mean "the
 *  operator's access context cannot see this host" — the ONLY reasons that turn a
 *  workspace spawn into the standalone view. `network` / `timeout` are transient: the
 *  workspace exists and is ours; a spawn must not quietly degrade to a standalone one. */
const ACCESS_REASONS = new Set(["auth", "not-found"]);
const isAccessFailure = (e) => e?.code === "E_REMOTE_UNREADABLE" && ACCESS_REASONS.has(e?.details?.reason ?? e?.provenance?.reason);

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
export async function discoverOrStandalone(local, { remoteOptions, remote } = {}) {
  const ro = { remoteOptions, remote };
  if (typeof local.standalone === "string" && local.standalone) {
    const repo = await discoverRepo(local.standalone, ro);
    requireMembership(repo, local.standalone);
    return { ...standaloneRepo(local.standalone, repo.commit, repo, { remote }), standaloneReason: "explicit" };
  }
  try { return await discoverWorkspace(local.workspace, { local, ...ro }); }
  catch (e) {
    if (e?.code !== "E_WORKSPACE_SCHEMA" || e?.details?.notAHost !== true) throw e;
    // The ref is a repository without oats-workspace.yaml: is it a member whose
    // workspace we cannot read? Then the standalone view is what the operator gets.
    const repo = await discoverRepo(local.workspace, ro);
    if (!repo.membership) throw e;
    try { return await discoverWorkspace(repo.membership.workspace, { local, ...ro }); }
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
      skills, inject: inject && existsSync(inject) ? inject : undefined,
      skillsDeclared: manifest.skills || [], injectDeclared: manifest.inject,
      // Member capabilities are trusted by membership (decision 2); package
      // capabilities were approved per version at sync (E_PACKAGE_UNAPPROVED
      // otherwise, so reaching here means approved).
      hooks: hookCommandsOf(manifest, dir), requiredHooks: requiredHooksOf(manifest),
      environment: [...(manifest.environment || [])], environmentNamespaces: [...(manifest.environmentNamespaces || [])],
      missingRequires: [], compatibility: { ok: true }, trust: { trusted: true, reason: m.from.kind === "package" ? "approved package version" : "workspace member" },
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
    return { name: m.name, from: m.from, layer: m.manifest.layer ?? null, private: !!m.private, changedSince };
  });
}

/** The relative pi/claude/codex skill directory inside a home — exported so the
 *  launch recipe and tests agree on it. */
export const INSTANCE_SKILLS_DIR = SKILLS_DIR;
export const INSTANCE_MODULES_DIR = MODULES_DIR;
