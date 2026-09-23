/** lib/remote.mjs — observe Git remotes in the operator's own access context
 * (workspace model v2, module contract §1).
 *
 * APPROACH (one approach, used for every remote kind — local bare repos and
 * https/ssh remotes alike):
 *   1. `observeRemote` resolves `at` with `git ls-remote --symref <url> …` —
 *      never a fetch when the caller already gave a full OID.
 *   2. Every read (`readRemoteFile`, `listRemoteTree`, `fetchRemoteTree`) needs the
 *      commit's objects locally. `ensureCommit` does a shallow
 *      `git fetch --depth 1 --no-tags <url> <oid>` into a content-addressed BARE
 *      cache repo under `<cacheRoot>/<sha256(key)>/` and then pins the commit with
 *      `refs/oats/commits/<oid>` so `gc` cannot prune it. The pin doubles as the
 *      "already fetched" marker: a pinned commit is never fetched again.
 *   3. Reads are then local plumbing: `git ls-tree -r -t -l -z` for listing and
 *      `git cat-file blob` for bytes. `git archive --remote` is NOT used: GitHub and
 *      most https hosts refuse it, and per-entry plumbing lets us inspect every
 *      mode (symlink / submodule / oversize) BEFORE anything touches the disk.
 *
 * DEVIATION FROM THE CONTRACT (named on purpose, not silently resolved): the
 * contract says "shallow git fetch --depth 1 --filter=blob:none". A blob-less
 * partial fetch would make every later `cat-file` a lazy per-blob network
 * round-trip through the promisor machinery, and topping a filtered commit up
 * to a full one afterwards requires `--refetch` semantics that vary by server.
 * We fetch depth-1 WITHOUT a blob filter: one round-trip per commit, blobs
 * present, correct on every server that allows fetching an advertised OID.
 *
 * The cache is invisible plumbing: it may be wiped at any time (a wiped cache
 * simply re-fetches), and nothing outside this module references it.
 *
 * Nothing here ever prompts: GIT_TERMINAL_PROMPT=0, GIT_ASKPASS=/usr/bin/false,
 * ssh ALWAYS in BatchMode — `-o BatchMode=yes` is appended to the operator's own
 * GIT_SSH_COMMAND / core.sshCommand (or to plain `ssh`). Timeout 30 s per call.
 *
 * TREE SAFETY: every entry name git reports is validated BEFORE anything touches
 * the disk. A component that is empty, `.`, `..`, `.git` (any case) or contains
 * `\` / NUL is E_REMOTE_TREE_UNSAFE { why: "path" } — a crafted tree object can
 * carry such names (the transport does not fsck them), and `join()` would
 * happily normalize `../../x` out of the staging directory. Entries that would
 * collide on a case-/normalization-insensitive filesystem (README.md vs
 * readme.md, NFC vs NFD) are E_REMOTE_TREE_UNSAFE { why: "collision" }.
 *
 * CONCURRENCY: per-key operations on one cache repo are serialized in-process
 * (two observes of the same remote never race `git init` or `fetch`), and a
 * fetch that loses an on-disk `.lock` race to another process is retried.
 *
 * CACHE PIN vs OBJECTS: the pin ref is the fast-path marker, but a wiped or
 * pruned object store is detected (`cat-file -e <oid>^{commit}`) and refetched;
 * the pin never turns a stale cache into a claim about the remote. The object
 * must be a COMMIT: a tag or `at` naming a tree/blob is E_REMOTE_UNREADABLE.
 *
 * CONTENT DIGEST (canonical framing, shared by fetchRemoteTree and contentDigest):
 *   sha256 over the concatenation, for every REGULAR FILE sorted by relpath
 *   (byte-wise UTF-8 order, "/" separated, relative to the tree root), of
 *     "F" NUL relpath NUL mode-octal NUL size-decimal NUL bytes NUL
 *   where mode-octal is the GIT-NORMALIZED mode: "755" when the owner-exec bit
 *   is set, else "644" (Git stores only 100644/100755, so a local checkout under
 *   any umask digests identically to the fetched tree). Empty directories do not
 *   enter identity. Result: "sha256-<hex>". Empty tree → sha256 of the empty input.
 */
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync,
  writeFileSync, writeSync, symlinkSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { oatsError } from "./errors.mjs";

export const FILE_BUDGET = 4 * 1024 * 1024;        // readRemoteFile: 4 MiB per file
export const TREE_BUDGET = 64 * 1024 * 1024;       // fetchRemoteTree: 64 MiB per subtree
export const GIT_TIMEOUT_MS = 30_000;
const OID_RE = /^[0-9a-f]{40}$/;
const SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;
/** A ref name we are willing to hand to `git ls-remote` as a pattern: never a leading
 * dash (option injection), no whitespace/control chars, no revision syntax (`^{`, `@{`, `~`,
 * `:`), no `..`, no glob chars, no `\`, no `.lock` component, no leading/trailing `/`. */
const AT_BAD_RE = /^[-/]|\/$|\.\.|[\s~^:?*[\\\x00-\x1f\x7f]|@\{|\/\.|^\.|\.lock(?:\/|$)|\/\//;
/** Tree entry-name components that must never reach the filesystem. */
const BAD_COMPONENT_RE = /^(?:|\.|\.\.|\.git)$/i;

/** oatsError with the details reachable as BOTH e.provenance (today's field) and e.details. */
function fail(code, message, details) {
  const e = oatsError(code, message, details);
  if (details) e.details = details;
  return e;
}

// ---------------------------------------------------------------------------
// parseRepoRef
// ---------------------------------------------------------------------------

function repoPathSegments(rawPath, text) {
  const cleaned = rawPath.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
  const parts = cleaned.split("/");
  if (parts.length < 2 || parts.some((p) => !SEGMENT_RE.test(p) || p === "." || p === "..")) {
    throw fail("E_REPO_REF", `repository reference has an invalid path: ${text}`, { ref: text, path: rawPath });
  }
  return parts.join("/");
}

function hostedRef(host, rawPath, text) {
  const h = host.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(h)) throw fail("E_REPO_REF", `repository reference has an invalid host: ${text}`, { ref: text, host });
  const path = repoPathSegments(rawPath, text);
  return Object.freeze({ host: h, path, url: `https://${h}/${path}.git`, key: `${h}/${path}` });
}

function localRef(absPath) {
  const normalized = resolve(absPath).replace(/[\\/]+$/, "") || sep;
  return Object.freeze({ host: "local", path: normalized, url: normalized, key: `local/${normalized}` });
}

/**
 * "git:github.com/org/repo(.git)" | "https://github.com/org/repo(.git)" | "git@github.com:org/repo(.git)"
 * | "/abs/path/to/bare.git" | "file:///abs/path" → { host, path, url, key } | throws E_REPO_REF.
 * Already-parsed refs (objects with key+url) pass through once re-validated: the
 * object's `url` must itself parse to the same `key` (no smuggled `ext::` urls or `../` keys).
 */
export function parseRepoRef(text) {
  if (text && typeof text === "object" && typeof text.key === "string" && typeof text.url === "string") {
    const again = parseRepoRef(text.url);
    if (again.key !== text.key) throw fail("E_REPO_REF", `repository reference object is inconsistent: key ${text.key} does not match url ${text.url}`, { ref: text.key, url: text.url });
    return text;
  }
  if (typeof text !== "string" || !text.trim()) throw fail("E_REPO_REF", "repository reference must be a non-empty string", { ref: text });
  const ref = text.trim();
  let m;
  if ((m = /^git:([^/:@\s]+)\/(.+)$/.exec(ref))) return hostedRef(m[1], m[2], ref);
  if ((m = /^https?:\/\/([^/@\s]+)\/(.+)$/.exec(ref))) return hostedRef(m[1], m[2], ref);
  if ((m = /^git@([^:/\s]+):(.+)$/.exec(ref))) return hostedRef(m[1], m[2], ref);
  if (/^file:\/\//.test(ref)) {
    try { return localRef(fileURLToPath(ref)); } catch { throw fail("E_REPO_REF", `invalid file URL: ${ref}`, { ref }); }
  }
  if (isAbsolute(ref)) return localRef(ref);
  throw fail("E_REPO_REF", `unrecognized repository reference: ${ref}`, { ref });
}

// ---------------------------------------------------------------------------
// git plumbing
// ---------------------------------------------------------------------------

/** The operator's own ssh command (GIT_SSH_COMMAND, else core.sshCommand, else `ssh`),
 * ALWAYS with `-o BatchMode=yes` appended so ssh can never prompt for a passphrase or
 * host key. Resolved once per process; `-o` after the operator's flags is valid for ssh
 * and for every ssh-compatible wrapper that forwards its argv. */
let sshCommandCache;
export function sshCommand() {
  if (sshCommandCache !== undefined) return sshCommandCache;
  let base = process.env.GIT_SSH_COMMAND?.trim();
  if (!base) {
    try { base = execFileSync("git", ["config", "--get", "core.sshCommand"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim(); } catch { base = ""; }
  }
  if (!base) base = "ssh";
  sshCommandCache = /(?:^|\s)-o\s*BatchMode=yes(?:\s|$)/i.test(base) ? base : `${base} -o BatchMode=yes`;
  return sshCommandCache;
}

function gitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/usr/bin/false",
    GIT_SSH_COMMAND: sshCommand(),
    GIT_LITERAL_PATHSPECS: "1",
  };
}

/** Default exec dependency: runs `git <args>`; resolves { stdout, stderr } (Buffers);
 * rejects with { code, signal, killed, stderr, stdout }. Injectable via options.exec. */
export function runGit(args, { cwd, maxBuffer = 16 * 1024 * 1024, timeout = GIT_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile("git", args, { cwd, env: gitEnv(), timeout, maxBuffer, shell: false, encoding: "buffer", killSignal: "SIGKILL" },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout; error.stderr = stderr;
          error.timedOut = error.killed === true || error.signal === "SIGKILL";
          reject(error);
        } else resolvePromise({ stdout, stderr });
      });
  });
}

function stderrText(error) {
  const s = error?.stderr;
  return Buffer.isBuffer(s) ? s.toString("utf8") : typeof s === "string" ? s : String(error?.message ?? "");
}

/** Classify a failed network git call into the contract's four reasons. */
export function classifyRemoteFailure(error) {
  if (error?.timedOut || error?.signal === "SIGKILL" || error?.signal === "SIGTERM") return "timeout";
  const text = stderrText(error).toLowerCase();
  if (/authentication failed|could not read username|could not read password|permission denied|publickey|403|forbidden|terminal prompts disabled|invalid username or password|access denied|unauthori[sz]ed/.test(text)) return "auth";
  if (/repository not found|repository '.*' not found|not found|does not appear to be a git repository|no such file or directory|not our ref|unadvertised object|couldn't find remote ref|remote ref .* not found|not a valid object name|not a tree object|bad object|is not a valid revision|no such ref/.test(text)) return "not-found";
  if (/could not resolve host|connection refused|connection timed out|network is unreachable|unable to access|early eof|remote end hung up|connection reset|ssl|tls|unable to connect/.test(text)) return "network";
  return "network";
}

function unreadable(ref, error, extra = {}) {
  const reason = classifyRemoteFailure(error);
  return fail("E_REMOTE_UNREADABLE", `cannot read remote ${ref.url} (${reason})`, { url: ref.url, key: ref.key, reason, ...extra });
}

// ---------------------------------------------------------------------------
// cache
// ---------------------------------------------------------------------------

function defaultCacheRoot() { return join(homedir(), ".cache", "oats", "remotes"); }

/** Per-cache-dir in-process mutex: operations on one bare cache repo run one at a time. */
const cacheLocks = new Map();
async function withCacheLock(dir, fn) {
  const previous = cacheLocks.get(dir) ?? Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  cacheLocks.set(dir, previous.then(() => mine));
  await previous;
  try { return await fn(); } finally {
    release();
    if (cacheLocks.get(dir) === mine) cacheLocks.delete(dir);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isLockRace = (error) => /\.lock': File exists|Unable to create .*\.lock|another git process seems to be running/i.test(stderrText(error));

async function cacheRepo(ref, options) {
  const exec = options.exec ?? runGit;
  const root = options.cacheDir ?? defaultCacheRoot();
  const dir = join(root, createHash("sha256").update(ref.key).digest("hex"));
  if (!existsSync(join(dir, "HEAD"))) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { await exec(["init", "-q", "--bare", dir]); }
    catch (error) {
      // Another process may have won the init race; a usable repo is all we need.
      if (!existsSync(join(dir, "HEAD"))) throw unreadable(ref, error, { cacheDir: dir, stage: "init" });
    }
    try { writeFileSync(join(dir, "oats-remote.json"), JSON.stringify({ key: ref.key, url: ref.url }, null, 2) + "\n", { flag: "wx" }); } catch {}
  }
  const local = (args, opts = {}) => exec(["-C", dir, "-c", "gc.auto=0", ...args], { cwd: dir, ...opts });
  return { dir, exec, local };
}

function pinRef(oid) { return `refs/oats/commits/${oid}`; }

/** Is <oid> present in the cache AND a commit? (`cat-file -e <oid>^{commit}` fails on a
 * missing object, a pruned store, or a tag/tree/blob.) */
async function hasCommit(repo, oid) {
  return repo.local(["cat-file", "-e", `${oid}^{commit}`]).then(() => true, () => false);
}

async function objectType(repo, oid) {
  try { return (await repo.local(["cat-file", "-t", oid])).stdout.toString("utf8").trim(); } catch { return null; }
}

/** Ensure <oid> (a full COMMIT OID) and all its trees/blobs are present in the cache. */
async function ensureCommit(ref, oid, options) {
  const root = options.cacheDir ?? defaultCacheRoot();
  const dir = join(root, createHash("sha256").update(ref.key).digest("hex"));
  return withCacheLock(dir, async () => {
    const repo = await cacheRepo(ref, options);
    if (await hasCommit(repo, oid)) return repo; // pinned AND present AND a commit
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await repo.local(["fetch", "-q", "--depth", "1", "--no-tags", "--no-recurse-submodules", ref.url, oid]);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (!isLockRace(error) || error.timedOut) break;
        await sleep(100 * (attempt + 1) ** 2);
      }
    }
    if (lastError) throw unreadable(ref, lastError, { commit: oid });
    if (!(await hasCommit(repo, oid))) {
      const type = await objectType(repo, oid);
      throw fail("E_REMOTE_UNREADABLE", `${oid} in ${ref.url} is ${type ? `a ${type}` : "missing"}, not a commit`, { url: ref.url, key: ref.key, reason: "not-found", commit: oid, type });
    }
    await repo.local(["update-ref", pinRef(oid), oid]);
    return repo;
  });
}

// ---------------------------------------------------------------------------
// observeRemote
// ---------------------------------------------------------------------------

function requireCommit(commit) {
  if (typeof commit !== "string" || !OID_RE.test(commit)) throw fail("E_REPO_REF", "commit must be a full 40-hex OID", { commit });
  return commit;
}

function parseLsRemote(stdout) {
  const lines = stdout.toString("utf8").split("\n").filter(Boolean);
  const symrefs = new Map(), oids = new Map();
  for (const line of lines) {
    const [left, right] = line.split("\t");
    if (left.startsWith("ref: ")) symrefs.set(right, left.slice(5));
    else oids.set(right, left);
  }
  return { symrefs, oids };
}

function resolveAt(parsed, at) {
  if (at === undefined || at === null || at === "" || at === "HEAD") {
    const oid = parsed.oids.get("HEAD");
    return oid ? { commit: oid, ref: parsed.symrefs.get("HEAD") ?? null } : null;
  }
  const candidates = [`refs/tags/${at}^{}`, `refs/tags/${at}`, `refs/heads/${at}`, at, `${at}^{}`];
  for (const name of candidates) {
    const oid = parsed.oids.get(name);
    if (oid) {
      const bare = name.replace(/\^\{\}$/, "");
      return { commit: oid, ref: bare.startsWith("refs/") ? bare : null };
    }
  }
  return null;
}

/**
 * at: undefined → remote default branch (ls-remote --symref HEAD); a full OID; or a tag/branch name.
 * → { key, url, commit, ref, observedAt } | throws E_REMOTE_UNREADABLE { url, reason }.
 * Never half-succeeds; never prompts. A full OID already in the cache costs no network call.
 */
export async function observeRemote(refText, { at, ...options } = {}) {
  const ref = parseRepoRef(refText);
  const exec = options.exec ?? runGit;
  if (at !== undefined && at !== null && typeof at !== "string") throw fail("E_REPO_REF", "at must be a string (full OID, tag or branch name)", { at });
  if (typeof at === "string" && OID_RE.test(at)) {
    await ensureCommit(ref, at, options);
    return { key: ref.key, url: ref.url, commit: at, ref: null, observedAt: new Date().toISOString() };
  }
  const wantHead = at === undefined || at === null || at === "" || at === "HEAD";
  if (!wantHead && AT_BAD_RE.test(at)) throw fail("E_REPO_REF", `at must be a full OID or a plain tag/branch name, got ${JSON.stringify(at)}`, { at });
  const args = ["ls-remote", "--symref", ref.url];
  if (wantHead) args.push("HEAD");
  else args.push(`refs/tags/${at}`, `refs/tags/${at}^{}`, `refs/heads/${at}`, at);
  let out;
  try { out = await exec(args, { timeout: GIT_TIMEOUT_MS }); }
  catch (error) { throw unreadable(ref, error, { at: at ?? null }); }
  const parsed = parseLsRemote(out.stdout);
  const hit = resolveAt(parsed, at);
  if (!hit) throw fail("E_REMOTE_UNREADABLE", `remote ${ref.url} has no ref matching ${at ?? "HEAD"}`, { url: ref.url, key: ref.key, reason: "not-found", at: at ?? null });
  if (!OID_RE.test(hit.commit)) throw fail("E_REMOTE_UNREADABLE", `remote ${ref.url} returned a non-OID for ${at ?? "HEAD"}`, { url: ref.url, key: ref.key, reason: "not-found", at: at ?? null });
  await ensureCommit(ref, hit.commit, options);
  return { key: ref.key, url: ref.url, commit: hit.commit, ref: hit.ref, observedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// tree reading
// ---------------------------------------------------------------------------

function normalizeTreePath(path, { allowRoot }) {
  if (path === undefined || path === null || path === "" || path === ".") {
    if (allowRoot) return "";
    throw fail("E_REPO_REF", "path must name a file, not the tree root", { path });
  }
  if (typeof path !== "string") throw fail("E_REPO_REF", "path must be a string", { path });
  const parts = path.replace(/\\/g, "/").split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0) { if (allowRoot) return ""; throw fail("E_REPO_REF", "path must name a file", { path }); }
  if (parts.some((p) => p === "..")) throw fail("E_REPO_REF", "path must be relative and must not escape the tree", { path });
  return parts.join("/");
}

/** Parse `git ls-tree -l -z` output → [{ mode, type, oid, size, path }]. */
function parseLsTree(stdout) {
  const entries = [];
  for (const record of stdout.toString("utf8").split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    const meta = record.slice(0, tab).trim().split(/\s+/), path = record.slice(tab + 1);
    const [mode, type, oid, size] = meta;
    entries.push({ mode, type, oid, size: size === "-" ? null : Number(size), path });
  }
  return entries;
}

/** Refuse any entry whose name could escape or subvert a checkout: a component that is
 * empty, `.`, `..`, `.git` (any case), or a name containing `\` or NUL. Git's transport does
 * not fsck tree entry names, so a hostile remote can serve them. */
function assertSafeEntryPath(entryPath, ref, commit, shown = entryPath) {
  const bad = /[\\\x00]/.test(entryPath) || entryPath.split("/").some((c) => BAD_COMPONENT_RE.test(c));
  if (bad) throw fail("E_REMOTE_TREE_UNSAFE", `${shown} has an unsafe entry name`, { path: shown, why: "path", key: ref.key, commit });
}

/** Entries that would collide on a case- or normalization-insensitive filesystem (APFS, NTFS). */
function assertNoCollisions(entries, ref, commit, prefix) {
  const seen = new Map();
  for (const e of entries) {
    const folded = e.path.normalize("NFC").toLowerCase();
    const other = seen.get(folded);
    if (other !== undefined && other !== e.path) {
      const shown = prefix ? `${prefix}/${e.path}` : e.path;
      throw fail("E_REMOTE_TREE_UNSAFE", `${shown} collides with ${prefix ? `${prefix}/${other}` : other} on a case-insensitive filesystem`, { path: shown, why: "collision", other: prefix ? `${prefix}/${other}` : other, key: ref.key, commit });
    }
    seen.set(folded, e.path);
  }
}

/** `git ls-tree -l -z [flags] <spec> [-- <path>]`; null when <spec> names no tree. */
async function lsTree(repo, spec, { flags = [], path } = {}) {
  try {
    const args = ["ls-tree", "-l", "-z", ...flags, spec];
    if (path !== undefined) args.push("--", path);
    const out = await repo.local(args, { maxBuffer: 64 * 1024 * 1024 });
    return parseLsTree(out.stdout);
  } catch (error) {
    const text = stderrText(error).toLowerCase();
    if (/not a tree object|not a valid object name|does not exist|bad object|fatal: not a tree|path .* does not exist|exists on disk, but not in/.test(text)) return null;
    throw error;
  }
}

/** Return the single ls-tree entry for <commit>:<path>, or null when absent. */
async function entryAt(repo, commit, path) {
  const entries = await lsTree(repo, commit, { path });
  if (!entries) return null;
  return entries.find((e) => e.path === path) ?? null;
}

/**
 * → { bytes, size } | E_REMOTE_UNREADABLE | E_REMOTE_PATH_MISSING { path } | E_REMOTE_FILE_OVERSIZE { path, size, budget }
 * A symlink at <path> is refused (E_REMOTE_TREE_UNSAFE { path, why: "symlink" }); a directory → E_REMOTE_PATH_MISSING.
 */
export async function readRemoteFile(refText, commit, path, options = {}) {
  const ref = parseRepoRef(refText);
  requireCommit(commit);
  const rel = normalizeTreePath(path, { allowRoot: false });
  const repo = await ensureCommit(ref, commit, options);
  const entry = await entryAt(repo, commit, rel);
  if (!entry || entry.type !== "blob") throw fail("E_REMOTE_PATH_MISSING", `${rel} is not a file in ${ref.key}@${commit.slice(0, 12)}`, { path: rel, key: ref.key, commit });
  if (entry.mode === "120000") throw fail("E_REMOTE_TREE_UNSAFE", `${rel} is a symlink`, { path: rel, why: "symlink", key: ref.key, commit });
  if (entry.size > FILE_BUDGET) throw fail("E_REMOTE_FILE_OVERSIZE", `${rel} is ${entry.size} bytes (budget ${FILE_BUDGET})`, { path: rel, size: entry.size, budget: FILE_BUDGET, key: ref.key, commit });
  let out;
  try { out = await repo.local(["cat-file", "blob", entry.oid], { maxBuffer: FILE_BUDGET + 1024 }); }
  catch (error) { throw unreadable(ref, error, { commit, path: rel }); }
  return { bytes: out.stdout, size: out.stdout.length };
}

/**
 * → [{ path, type: "blob"|"tree", size? }] relative to <dir>, depth-bounded (depth 1 = direct children).
 * Missing dir → []. Symlinks are reported as type "symlink" so callers can skip them.
 */
export async function listRemoteTree(refText, commit, dir, { depth = 2, ...options } = {}) {
  const ref = parseRepoRef(refText);
  requireCommit(commit);
  if (!Number.isInteger(depth) || depth < 1) throw fail("E_REPO_REF", "depth must be a positive integer", { depth });
  const rel = normalizeTreePath(dir, { allowRoot: true });
  const repo = await ensureCommit(ref, commit, options);
  const spec = rel ? `${commit}:${rel}` : commit;
  if (rel) {
    const entry = await entryAt(repo, commit, rel);
    if (!entry || entry.type !== "tree") return [];
  }
  const entries = await lsTree(repo, spec, { flags: ["-r", "-t"] });
  if (!entries) return [];
  const result = [];
  for (const e of entries) {
    assertSafeEntryPath(e.path, ref, commit, rel ? `${rel}/${e.path}` : e.path);
    if (e.path.split("/").length > depth) continue;
    if (e.type === "commit") continue; // submodule gitlinks are not part of the observable tree
    const type = e.mode === "120000" ? "symlink" : e.type;
    const row = { path: e.path, type };
    if (e.type === "blob") row.size = e.size;
    result.push(row);
  }
  result.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return result;
}

// ---------------------------------------------------------------------------
// digest
// ---------------------------------------------------------------------------

const NUL = Buffer.from([0]);
const gitMode = (mode) => ((mode & 0o100) ? "755" : "644");
const byPath = (a, b) => Buffer.compare(Buffer.from(a.path, "utf8"), Buffer.from(b.path, "utf8"));

function createDigest() {
  const hash = createHash("sha256");
  let files = 0, bytes = 0;
  return {
    add(relpath, mode, content) {
      hash.update("F"); hash.update(NUL);
      hash.update(Buffer.from(relpath, "utf8")); hash.update(NUL);
      hash.update(gitMode(mode)); hash.update(NUL);
      hash.update(String(content.length)); hash.update(NUL);
      hash.update(content); hash.update(NUL);
      files += 1; bytes += content.length;
    },
    finish() { return { files, bytes, digest: `sha256-${hash.digest("hex")}` }; },
  };
}

/** Same digest as fetchRemoteTree, computed over a local directory. Symlinks and
 * non-regular entries are refused (E_REMOTE_TREE_UNSAFE); a missing dir → E_REMOTE_PATH_MISSING. */
function posixNormalize(p) {
  const out = [];
  for (const seg of p.split("/")) { if (!seg || seg === ".") continue; if (seg === "..") { if (out.length && out.at(-1) !== "..") out.pop(); else out.push(".."); } else out.push(seg); }
  return out.join("/");
}
export function contentDigest(dir, { allowSymlinks = null } = {}) {
  if (typeof dir !== "string" || !isAbsolute(dir)) throw fail("E_REPO_REF", "contentDigest requires an absolute directory path", { path: dir });
  let st;
  try { st = lstatSync(dir); } catch { throw fail("E_REMOTE_PATH_MISSING", `${dir} does not exist`, { path: dir }); }
  if (!st.isDirectory()) throw fail("E_REMOTE_PATH_MISSING", `${dir} is not a directory`, { path: dir });
  const files = [];
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs)) {
      if (!rel && name === ".git") continue; // a local checkout's metadata is not content
      const p = join(abs, name), r = rel ? `${rel}/${name}` : name, s = lstatSync(p);
      if (s.isSymbolicLink()) {
        // Refused by default (contract §1). The same narrow opt-in fetchRemoteTree
        // honours (a relative, non-escaping alias such as CLAUDE.md → AGENTS.md)
        // digests as `symlink:<target>` so a fetched tree and its digest agree.
        if (typeof allowSymlinks !== "function" || !allowSymlinks(r)) throw fail("E_REMOTE_TREE_UNSAFE", `${r} is a symlink`, { path: r, why: "symlink" });
        files.push({ path: r, mode: 0o777, bytes: Buffer.from(`symlink:${readlinkSync(p)}`) });
        continue;
      }
      if (s.isDirectory()) walk(p, r);
      else if (s.isFile()) files.push({ path: r, mode: s.mode, abs: p });
      else throw fail("E_REMOTE_TREE_UNSAFE", `${r} is not a regular file`, { path: r, why: "device" });
    }
  };
  walk(dir, "");
  files.sort(byPath);
  const d = createDigest();
  for (const f of files) d.add(f.path, f.mode, f.bytes ?? readFileSync(f.abs));
  return d.finish().digest;
}

// ---------------------------------------------------------------------------
// fetchRemoteTree
// ---------------------------------------------------------------------------

/**
 * Copies the subtree <dir> of <commit> into destDir (created; must not exist).
 * Regular files and dirs only: symlinks/submodules → E_REMOTE_TREE_UNSAFE { path, why }, total > 64 MiB → why "oversize".
 * Missing <dir> → E_REMOTE_PATH_MISSING. → { files, bytes, digest }. Atomic: staging dir + rename, nothing left on failure.
 */
export async function fetchRemoteTree(refText, commit, dir, destDir, options = {}) {
  const ref = parseRepoRef(refText);
  requireCommit(commit);
  const rel = normalizeTreePath(dir, { allowRoot: true });
  if (typeof destDir !== "string" || !isAbsolute(destDir)) throw fail("E_REPO_REF", "destDir must be an absolute path", { destDir });
  const dest = resolve(destDir);
  let destStat = null;
  try { destStat = lstatSync(dest); } catch {}
  if (destStat) throw fail("E_REMOTE_TREE_UNSAFE", `${dest} already exists${destStat.isSymbolicLink() ? " (a symlink)" : ""}`, { path: dest, why: "exists" });
  const repo = await ensureCommit(ref, commit, options);
  const spec = rel ? `${commit}:${rel}` : commit;
  if (rel) {
    const entry = await entryAt(repo, commit, rel);
    if (!entry || entry.type !== "tree") throw fail("E_REMOTE_PATH_MISSING", `${rel} is not a directory in ${ref.key}@${commit.slice(0, 12)}`, { path: rel, key: ref.key, commit });
  }
  const entries = await lsTree(repo, spec, { flags: ["-r", "-t"] });
  if (!entries) throw fail("E_REMOTE_PATH_MISSING", `${rel || "."} is missing in ${ref.key}@${commit.slice(0, 12)}`, { path: rel, key: ref.key, commit });
  // Inspect everything BEFORE writing anything: names, modes, types, sizes, collisions.
  let total = 0;
  const blobs = [], trees = [], links = [];
  // `allowSymlinks(relPath)` (opt-in, narrow): a symlink whose TARGET is relative
  // and stays inside the fetched subtree may be materialized as a symlink — the
  // one legitimate case is a soul's `CLAUDE.md → AGENTS.md` alias. Anything else
  // (absolute, escaping, or not allowed by the predicate) is refused as before.
  const allowSymlinks = typeof options.allowSymlinks === "function" ? options.allowSymlinks : null;
  for (const e of entries) {
    const shown = rel ? `${rel}/${e.path}` : e.path;
    assertSafeEntryPath(e.path, ref, commit, shown);
    if (e.mode === "120000") {
      if (!allowSymlinks || !allowSymlinks(e.path)) throw fail("E_REMOTE_TREE_UNSAFE", `${shown} is a symlink`, { path: shown, why: "symlink", key: ref.key, commit });
      links.push(e); continue;
    }
    if (e.type === "commit") throw fail("E_REMOTE_TREE_UNSAFE", `${shown} is a submodule`, { path: shown, why: "device", key: ref.key, commit });
    if (e.type === "tree") { trees.push(e); continue; }
    if (e.type !== "blob" || !/^100(644|755)$/.test(e.mode)) throw fail("E_REMOTE_TREE_UNSAFE", `${shown} has unsupported mode ${e.mode}`, { path: shown, why: "device", key: ref.key, commit });
    total += e.size;
    if (total > TREE_BUDGET) throw fail("E_REMOTE_TREE_UNSAFE", `${rel || "."} exceeds ${TREE_BUDGET} bytes`, { path: rel || ".", why: "oversize", size: total, budget: TREE_BUDGET, key: ref.key, commit });
    blobs.push(e);
  }
  blobs.sort(byPath);
  assertNoCollisions(entries, ref, commit, rel);
  mkdirSync(dirname(dest), { recursive: true });
  const staging = join(dirname(dest), `.${dest.split(sep).pop()}.oats-staging-${process.pid}-${Date.now().toString(36)}`);
  try {
    mkdirSync(staging, { mode: 0o755 });
    for (const t of trees) mkdirSync(join(staging, ...t.path.split("/")), { recursive: true, mode: 0o755 });
    const d = createDigest();
    for (const b of blobs) {
      let out;
      try { out = await repo.local(["cat-file", "blob", b.oid], { maxBuffer: TREE_BUDGET + 1024 }); }
      catch (error) { throw unreadable(ref, error, { commit, path: b.path }); }
      const mode = b.mode === "100755" ? 0o755 : 0o644;
      const target = join(staging, ...b.path.split("/"));
      mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
      const fd = openSync(target, "wx", mode);
      try { writeSync(fd, out.stdout); } finally { closeSync(fd); }
      d.add(b.path, mode, out.stdout);
    }
    for (const l of links) {
      let out;
      try { out = await repo.local(["cat-file", "blob", l.oid], { maxBuffer: 64 * 1024 }); }
      catch (error) { throw unreadable(ref, error, { commit, path: l.path }); }
      const linkTarget = out.stdout.toString("utf8").trim();
      const from = dirname(l.path === "" ? "x" : l.path);
      const resolvedRel = posixNormalize(from === "." ? linkTarget : `${from}/${linkTarget}`);
      if (isAbsolute(linkTarget) || linkTarget.includes("\0") || resolvedRel.startsWith("../") || resolvedRel === "..") {
        throw fail("E_REMOTE_TREE_UNSAFE", `${rel ? `${rel}/` : ""}${l.path} is a symlink escaping the fetched tree (${linkTarget})`, { path: l.path, why: "symlink", key: ref.key, commit });
      }
      const target = join(staging, ...l.path.split("/"));
      mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
      symlinkSync(linkTarget, target);
      d.add(l.path, 0o777, Buffer.from(`symlink:${linkTarget}`));
    }
    const summary = d.finish();
    renameSync(staging, dest);
    return summary;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
