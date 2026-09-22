/** K1 — read-only Git observation of one instance's work tree.
 *
 * Truth comes from the tree itself (never from recorded spawn metadata):
 * branch/HEAD via the worktree, status via porcelain v2 NUL records, ahead/
 * behind reported twice and separately (upstream; merge-base with the
 * repository's default branch) with "no upstream" ≠ 0/0. Diffs are bounded and
 * addressed by an opaque file id minted with an observation revision; a diff
 * against a tree that has since moved is refused, never served. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { oatsError } from "./errors.mjs";

const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const DIFF_MAX_BYTES = 256 * 1024;
export const INSTANCE_GIT_API = 1;

/** Every invocation is read-only and helper-free: the tree being observed may
 *  carry a hostile repo config (an agent works there), so external diff /
 *  textconv drivers, fsmonitor and hooks are disabled explicitly, the caller's
 *  Git environment is not inherited, and optional locks are off so status/diff
 *  never refresh (write) the index. */
const READ_ONLY_GIT = ["--no-optional-locks",
  "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "diff.external=", "-c", "core.pager=cat",
  "-c", "core.untrackedCache=false", "-c", "index.threads=1", "-c", "safe.bareRepository=explicit"];
function gitEnv() {
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", LANG: "C", LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" };
  // The user's global config may name helpers too; observations do not need it.
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  return env;
}
function git(cwd, argv, { allowFail = false, input, diffExit = false } = {}) {
  const [sub, ...rest] = argv;
  const extra = sub === "diff" ? ["--no-ext-diff", "--no-textconv", "--no-color"] : [];
  try {
    return execFileSync("git", [...READ_ONLY_GIT, "-C", cwd, sub, ...extra, ...rest], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: GIT_MAX_BUFFER, input, shell: false, timeout: 30_000, env: gitEnv() });
  } catch (e) {
    // `git diff --no-index` exits 1 when the inputs differ: that is the answer, not a failure.
    if (diffExit && e.status === 1 && typeof e.stdout === "string") return e.stdout;
    if (allowFail) return null;
    throw oatsError("E_GIT_FAILED", `git ${sub} failed in ${cwd}: ${String(e.stderr ?? e.message ?? "").trim() || "unknown error"}`);
  }
}
const trim = (s) => (s === null ? null : s.trim());

/** The instance's work tree, from its home. The home's instance.json names
 *  the work mode; the tree is `<home>/work` (a directory or a symlink to the
 *  shared checkout). Missing/retired → attributed refusal, never a crash. */
export function instanceWorkTree(home) {
  const metaFile = join(home, "instance.json");
  if (!existsSync(metaFile)) throw oatsError("E_SESSION_UNKNOWN", `${home} is not an OATS instance home (no instance.json)`);
  let meta;
  try { meta = JSON.parse(readFileSync(metaFile, "utf8")); } catch (e) { throw oatsError("E_SESSION_UNKNOWN", `${metaFile}: ${e.message}`); }
  const work = join(home, "work");
  if (!existsSync(work)) throw oatsError("E_NO_WORKTREE", `${meta.instance ?? home} has no work tree at ${work} (retired, recovered, or never materialized)`);
  const inside = trim(git(work, ["rev-parse", "--is-inside-work-tree"], { allowFail: true }));
  if (inside !== "true") throw oatsError("E_NO_WORKTREE", `${work} is not inside a git work tree`);
  return { meta, work, mode: meta.work ?? null };
}

/** Porcelain v2 `-z` records → entries. Renames carry both paths. */
export function parsePorcelainV2(raw) {
  const fields = raw.split("\0");
  const entries = [];
  let branch = { oid: null, head: null, upstream: null, ahead: null, behind: null };
  for (let i = 0; i < fields.length; i++) {
    const rec = fields[i];
    if (!rec) continue;
    if (rec.startsWith("# ")) {
      const [, key, ...rest] = rec.split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") branch.oid = value === "(initial)" ? null : value;
      else if (key === "branch.head") branch.head = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") branch.upstream = value;
      else if (key === "branch.ab") { const m = /^\+(\d+) -(\d+)$/.exec(value); if (m) { branch.ahead = Number(m[1]); branch.behind = Number(m[2]); } }
      continue;
    }
    const type = rec[0];
    if (type === "1") {
      const parts = rec.split(" ");
      entries.push({ kind: "changed", xy: parts[1], submodule: parts[2] !== "N...", path: parts.slice(8).join(" "), origPath: null });
    } else if (type === "2") {
      const parts = rec.split(" ");
      const path = parts.slice(9).join(" ");
      const origPath = fields[++i] ?? null; // rename/copy: the original path is the next NUL field
      entries.push({ kind: /^R/.test(parts[8]) ? "renamed" : "copied", xy: parts[1], submodule: parts[2] !== "N...", score: parts[8], path, origPath });
    } else if (type === "u") {
      const parts = rec.split(" ");
      entries.push({ kind: "unmerged", xy: parts[1], submodule: parts[2] !== "N...", path: parts.slice(10).join(" "), origPath: null });
    } else if (type === "?") entries.push({ kind: "untracked", xy: "??", submodule: false, path: rec.slice(2), origPath: null });
    else if (type === "!") entries.push({ kind: "ignored", xy: "!!", submodule: false, path: rec.slice(2), origPath: null });
  }
  return { branch, entries };
}

function defaultBranch(work) {
  const sym = trim(git(work, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { allowFail: true }));
  if (sym) return { ref: sym, source: "origin/HEAD" };
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    if (git(work, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], { allowFail: true }) !== null) return { ref: candidate, source: "well-known" };
  }
  return null;
}

function countRange(work, range) {
  const out = trim(git(work, ["rev-list", "--left-right", "--count", range], { allowFail: true }));
  if (out === null) return null;
  const [left, right] = out.split(/\s+/).map(Number);
  return { left, right };
}

function indexRevisionOf(work) {
  const listing = git(work, ["ls-files", "--stage", "-z"], { allowFail: true });
  return listing === null ? "no-index" : createHash("sha256").update(listing).digest("hex").slice(0, 40);
}
function blobOf(work, path) {
  // Content fingerprint of the working-tree file without writing an object.
  return trim(git(work, ["hash-object", "--no-filters", "--", path], { allowFail: true }));
}
/** The branch's upstream remote (else `origin`, else null), with host/path parsed
 *  from ssh/https/git forms so a consumer can pick a forge backend WITHOUT running
 *  Git itself. Parsing only: no network, no forge knowledge. */
export function parseRemoteUrl(url) {
  if (typeof url !== "string" || !url) return { host: null, path: null };
  let m = /^(?:ssh:\/\/)?(?:[^@\/]+@)?([^:\/]+)(?::\d+)?[:\/](.+?)(?:\.git)?\/?$/.exec(url);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    try { const u = new URL(url); m = [null, u.hostname, u.pathname.replace(/^\/+/, "").replace(/\.git$/, "").replace(/\/+$/, "")]; } catch { m = null; }
  }
  if (!m || !m[1] || !m[2]) return { host: null, path: null };
  return { host: m[1].toLowerCase(), path: m[2] };
}
function remoteOf(work, branch) {
  const configured = branch ? trim(git(work, ["config", "--get", `branch.${branch}.remote`], { allowFail: true })) : null;
  const name = configured && configured !== "." ? configured : (trim(git(work, ["remote"], { allowFail: true })) ?? "").split("\n").includes("origin") ? "origin" : null;
  if (!name) return null;
  const url = trim(git(work, ["remote", "get-url", name], { allowFail: true }));
  if (!url) return null;
  return { name, url, ...parseRemoteUrl(url), source: configured && configured !== "." ? "branch-upstream" : "origin" };
}
function fileId(revision, indexOid, entry) {
  return createHash("sha256").update(`${revision}\0${indexOid}\0${entry.kind}\0${entry.path}\0${entry.origPath ?? ""}`).digest("hex").slice(0, 24);
}

/** One consistent observation of the tree. Every field is what git said. */
export function observeInstanceGit(home) {
  const { meta, work, mode } = instanceWorkTree(home);
  const headOid = trim(git(work, ["rev-parse", "--verify", "--quiet", "HEAD"], { allowFail: true }));
  const raw = git(work, ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all", "--ignore-submodules=none"]);
  const { branch, entries } = parsePorcelainV2(raw);
  // The index state participates in the revision so that a stage/unstage
  // between observation and diff is a moved tree, not a stale-but-served diff.
  // Hashed from the index listing: no `write-tree`, so observing creates no object.
  const indexOid = indexRevisionOf(work);
  const revision = headOid ?? "unborn";
  const at = new Date().toISOString();
  const upstream = branch.upstream
    ? { ref: branch.upstream, ahead: branch.ahead, behind: branch.behind }
    : { ref: null, ahead: null, behind: null };
  const base = defaultBranch(work);
  let baseComparison = { ref: null, source: null, mergeBase: null, ahead: null, behind: null };
  if (base && headOid) {
    const mergeBase = trim(git(work, ["merge-base", "HEAD", base.ref], { allowFail: true }));
    const counts = mergeBase ? countRange(work, `${base.ref}...HEAD`) : null;
    baseComparison = { ref: base.ref, source: base.source, mergeBase, ahead: counts ? counts.right : null, behind: counts ? counts.left : null };
  }
  const files = entries.filter((e) => e.kind !== "ignored").map((e) => ({ id: fileId(revision, indexOid, e), ...e }));
  const summary = { changed: 0, renamed: 0, copied: 0, unmerged: 0, untracked: 0 };
  for (const f of files) summary[f.kind]++;
  return {
    instanceGitApi: INSTANCE_GIT_API,
    instance: meta.instance ?? null, agent: meta.agent ?? null, home, workMode: mode,
    observation: { revision, indexRevision: indexOid, at, worktree: work, branch: branch.head, detached: branch.head === null && headOid !== null, unborn: headOid === null },
    recorded: { branch: meta.branch ?? null, repo: meta.repo ?? null, drift: meta.branch !== undefined && meta.branch !== null && branch.head !== meta.branch },
    upstream, base: baseComparison,
    remote: remoteOf(work, branch.head),
    summary, files,
    notes: [
      ...(upstream.ref === null ? ["no upstream configured: upstream ahead/behind are unknown, not zero"] : []),
      ...(baseComparison.ref === null ? ["no default branch found (origin/HEAD, origin/main, origin/master, main, master): base comparison unknown"] : []),
    ],
  };
}

/** A bounded unified diff for one observed file. The caller passes the id
 *  and the observation revision it was minted under; a moved tree refuses. */
export function diffInstanceFile(home, { fileId: id, revision, indexRevision } = {}) {
  if (typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id)) throw oatsError("E_BAD_ARGS", "--file needs the opaque file id from `oats instance git --json`");
  if (typeof revision !== "string" || !revision) throw oatsError("E_BAD_ARGS", "--revision needs the observation revision the file id was minted under");
  const current = observeInstanceGit(home);
  if (current.observation.revision !== revision || (indexRevision !== undefined && current.observation.indexRevision !== indexRevision)) {
    throw Object.assign(oatsError("E_STALE_OBSERVATION", "the work tree moved since this file id was observed; re-observe with `oats instance git --json`"), { observation: current.observation });
  }
  const file = current.files.find((f) => f.id === id);
  if (!file) throw Object.assign(oatsError("E_STALE_OBSERVATION", "this file id is not part of the current observation; re-observe"), { observation: current.observation });
  const work = current.observation.worktree;
  const paths = file.origPath ? [file.origPath, file.path] : [file.path];
  const before = { blob: blobOf(work, file.path) };
  let patch, binary = false;
  if (file.kind === "untracked") {
    const numstat = trim(git(work, ["diff", "--no-index", "--numstat", "--", "/dev/null", file.path], { diffExit: true, allowFail: true }));
    binary = /^-\t-\t/.test(numstat ?? "");
    patch = binary ? "" : (git(work, ["diff", "--no-index", "--", "/dev/null", file.path], { diffExit: true, allowFail: true }) ?? "");
  } else {
    const numstat = trim(git(work, ["diff", current.observation.revision, "--numstat", "-M", "--", ...paths], { allowFail: true }));
    binary = /^-\t-\t/.test(numstat ?? "");
    patch = binary ? "" : git(work, ["diff", current.observation.revision, "-M", "--", ...paths]);
  }
  // Consistency across the read, not only before it: HEAD, index and the file's
  // own content must be what the observation said when the patch was produced.
  const after = { revision: trim(git(work, ["rev-parse", "--verify", "--quiet", "HEAD"], { allowFail: true })) ?? "unborn", indexRevision: indexRevisionOf(work), blob: blobOf(work, file.path) };
  if (after.revision !== current.observation.revision || after.indexRevision !== current.observation.indexRevision || after.blob !== before.blob) {
    const moved = observeInstanceGit(home);
    throw Object.assign(oatsError("E_STALE_OBSERVATION", "the work tree moved while the diff was being read; re-observe with `oats instance git --json`"), { observation: moved.observation });
  }
  const bytes = Buffer.byteLength(patch, "utf8");
  const truncated = bytes > DIFF_MAX_BYTES;
  const body = truncated ? Buffer.from(patch, "utf8").subarray(0, DIFF_MAX_BYTES).toString("utf8") : patch;
  return {
    instanceGitApi: INSTANCE_GIT_API, observation: current.observation,
    file: { id: file.id, kind: file.kind, xy: file.xy, path: file.path, origPath: file.origPath },
    against: file.kind === "untracked" ? "empty" : current.observation.revision, binary, bytes, truncated, limit: DIFF_MAX_BYTES, patch: body,
    readOnly: { helpers: "disabled", optionalLocks: "off", objectsWritten: 0 },
  };
}
