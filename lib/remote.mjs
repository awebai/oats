/** lib/remote.mjs — observe Git remotes in the operator's own access context
 * (workspace model v2, module contract §1).
 *
 * APPROACH (one approach, used for every remote kind — local bare repos and
 * https/ssh remotes alike):
 *   1. `observeRemote` resolves `at` with `git ls-remote --symref <url> …` —
 *      never a fetch when the caller already gave a full OID. A HEAD observation
 *      speaks protocol v0 unless the operator pinned `protocol.version` (one round
 *      trip instead of v2's two; what is kept of the advertisement is bounded, and a
 *      remote over budget, or one that timed out under v0, is observed under v2:
 *      observeLive).
 *   2. Every read (`readRemoteFile`, `listRemoteTree`, `fetchRemoteTree`) needs the
 *      commit locally. `ensureCommit` does a shallow, partial
 *      `git fetch --depth 1 --no-tags --filter=blob:limit=64k origin <oid>` into a
 *      content-addressed BARE cache repo under `<cacheRoot>/<sha256(key)>/` and then
 *      pins the commit with `refs/oats/commits/<oid>` so `gc` cannot prune it (the
 *      pins are also what a later fetch advertises as `have`, so it is incremental).
 *      The commit arrives with ALL its trees (every listing is complete) and the blobs
 *      up to SMALL_BLOB_LIMIT: every file discovery reads, in one round trip.
 *   3. Reads are then local plumbing: `git ls-tree -r -t -l -z` for listing and
 *      `git cat-file blob` for bytes. A read that needs a larger blob fetches it first
 *      (`ensureBlobs`: one fetch by blob id per request, a whole subtree for
 *      `fetchRemoteTree`); git never fetches one on its own (GIT_NO_LAZY_FETCH=1, and
 *      the cache stores no url to fetch from). `git archive --remote` is NOT used:
 *      GitHub and most https hosts refuse it, and per-entry plumbing lets us inspect
 *      every mode (symlink / submodule / oversize) BEFORE anything touches the disk.
 *
 * PARTIAL CACHES (awebai/oats#384): the cache is a partial clone of the remote
 * "origin" whose url is never written (it may carry credentials): every fetch passes
 * it as `-c remote.origin.url=<url>`. `ls-tree -l` prints "BAD" for the size of a blob
 * the cache lacks, so an unknown size is null until ensureBlobs fetches the blob, and
 * every budget is applied to real sizes. A server that cannot serve partial fetches
 * (no filter support; or blob wants refused, so the commit is fetched again with
 * `--refetch`) gets whole trees from then on: the cache records `oats.fetch = full`,
 * and the session's `notices` say so once. So does a git older than PARTIAL_FETCH_GIT
 * (2.45, which brought GIT_NO_LAZY_FETCH): an older git would fetch a missing blob on
 * its own or die, so every cache it touches fetches whole trees, and a partial cache it
 * finds is deleted and fetched again whole (rebuildWhole). A lost `.lock` race on the
 * cache repo's config or objects (another process starting the same cache) is retried.
 *
 * The cache is invisible plumbing: it may be wiped at any time (a wiped cache
 * simply re-fetches), and nothing outside this module references it.
 *
 * Nothing here ever prompts: GIT_TERMINAL_PROMPT=0, GIT_ASKPASS=/usr/bin/false,
 * ssh ALWAYS in BatchMode — `-o BatchMode=yes` is appended to the operator's own
 * GIT_SSH_COMMAND / core.sshCommand (or to plain `ssh`). Timeout 30 s per call;
 * 10 minutes for the fetch of a commit (GIT_FETCH_TIMEOUT_MS).
 *
 * KEY vs URL (post-0.25.0 fix M2): the canonical KEY (`<host>/<path>`, lowercase
 * host, no scheme, no `.git`) is the identity everywhere — the same repo written
 * as `git@host:org/repo.git`, `ssh://git@host/org/repo`, `https://host/org/repo`
 * or `git:host/org/repo` is ONE key and ONE cache repo. The FETCH URL honours the
 * form written: an ssh form (`git@…`, `ssh://…`) is fetched over ssh exactly as
 * written, so the operator's ssh access (keys, agent, config) is what is used;
 * an `https://` form is fetched over https; the bare `git:host/path` scheme
 * defaults to https and fetches over ssh (`git@host:path.git`) when
 * `remoteOptions.transport === "ssh"`. Nothing compares URLs; everything compares
 * keys.
 *
 * COMMIT vs TAG OID (post-0.25.0 fix M4): an `at` naming an annotated tag's own
 * OID is accepted, but the commit recorded (observeRemote result, error details,
 * cache pin) is ALWAYS the peeled commit (`rev-parse <oid>^{commit}`).
 *
 * TIMEOUT vs OVERFLOW (post-0.25.0 fix L4): `error.timedOut` is set only for the
 * timeout kill; a `maxBuffer` overflow (`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`) is
 * `error.overflowed`. A listing failure git does not explain is never a raw
 * Node error escaping this module: it is E_REMOTE_UNREADABLE { reason: "unknown" }.
 *
 * TREE SAFETY: every entry name git reports is validated BEFORE anything touches
 * the disk. A component that is empty, `.`, `..`, `.git` (any case) or contains
 * `\` / NUL is E_REMOTE_TREE_UNSAFE { why: "path" } — a crafted tree object can
 * carry such names (the transport does not fsck them), and `join()` would
 * happily normalize `../../x` out of the staging directory. Entries that would
 * collide on a case-/normalization-insensitive filesystem (README.md vs
 * readme.md, NFC vs NFD) are E_REMOTE_TREE_UNSAFE { why: "collision" }.
 *
 * CONCURRENCY (awebai/oats#386): per-key operations on one cache repo are serialized
 * in-process (withCacheLock), and every WRITE to a cache repo (init, config, fetch, pin)
 * holds its cross-process write lock `<cacheRoot>/.locks/<repo>.lock` (withCacheWriteLock):
 * a live holder is waited for (bounded by a whole fetch) and never stolen from, a dead
 * one is reclaimed; reads take no lock. A cache repo is created whole (init into a private
 * directory, then rename). A git `.lock` met under the write lock belongs to an older
 * kernel's live write (retried briefly) or to a git that was killed: one older than the
 * longest fetch, inside the cache and a regular file, is removed (a session notice says
 * so) and the write made once more; any other is E_REMOTE_UNREADABLE { reason: "cache" }
 * naming it. git is ended with SIGTERM first (it removes its own locks), SIGKILL after a
 * grace unless its group is seen empty first (process-group.mjs terminateGroup, watchGroup).
 *
 * CACHE PIN vs OBJECTS: the pin ref is the fast-path marker, but a wiped or
 * pruned object store is detected (`rev-parse <oid>^{commit}`) and refetched;
 * the pin never turns a stale cache into a claim about the remote. The object
 * must PEEL to a COMMIT: `at` naming a tree/blob (or a tag of one) is E_REMOTE_UNREADABLE.
 *
 * CONTENT DIGEST (canonical framing, shared by fetchRemoteTree and contentDigest):
 *   sha256 over the concatenation, for every REGULAR FILE sorted by relpath
 *   (byte-wise UTF-8 order, "/" separated, relative to the tree root), of
 *     "F" NUL relpath NUL mode-octal NUL size-decimal NUL bytes NUL
 *   where mode-octal is the GIT-NORMALIZED mode: "755" when the owner-exec bit
 *   is set, else "644" (Git stores only 100644/100755, so a local checkout under
 *   any umask digests identically to the fetched tree). Empty directories do not
 *   enter identity. Result: "sha256-<hex>". Empty tree → sha256 of the empty input.
 *
 * READ SESSION (one per CLI command; docs/implementation.md "The remote read path"):
 * every in-process memo this module keeps lives in a session object carried as
 * `options.session` (createReadSession). Without one, every call behaves exactly as
 * it did before sessions existed: no memo, no batch process, no file under the cache
 * root beyond the cache repos. A session holds
 *   - one `ls-remote` per (cache root, url, ref args): a host that is also a member is
 *     observed once, and every reader in the command sees the same commit; at most
 *     OBSERVE_LIMIT observations run at once, each holding its slot for ALL its git work
 *     (the ls-remote, and the fetch of the commit it names or of a reused record's);
 *   - the member prefetch (prefetchObservation; lib/workspace.mjs discoverWorkspace): a
 *     workspace discovery starts its members' observations with the host's, from the
 *     member list at the host's last observed commit (lastObservedCommit + peekAtCommit,
 *     no git process); a prefetched failure is adopted, never retried in the command;
 *   - positive peels per (cache repo, oid) — a negative peel is never kept;
 *   - one recursive tree index per (cache repo, commit): `git ls-tree -r -t -l -z` once,
 *     answering entryAt / listRemoteTree / remoteTreeOids exactly as per-path listings
 *     would; any index failure (the output budget, a timeout) falls back to per-path;
 *   - one long-lived `git cat-file --batch` per cache repo (at most BATCH_LIMIT alive),
 *     unref'd while idle and ended by session.close();
 *   - `maxAge` (seconds): > 0 lets observeRemote reuse a recorded head observation
 *     (the observation store below) no older than that;
 *   - the head observations used, for the `observation` output block;
 *   - `deadline` (DEADLINE; the deployment reads `oats status` and `oats workspace status` only, READ_REMOTE_BUDGET_MS
 *     after their session starts): every remote step gets what is left of it, not its own default — each git call's
 *     timeout (ls-remote, fetch, ls-tree, the batch readers' answers, every cache plumbing call, the git version
 *     probe), the cache write lock's wait, the half-initialised cache's wait and the lock-race backoff. A step the deadline ends is a
 *     `timeout` (git's group killed as any timeout kills it; a step not started yet starts no git), so a member
 *     not read by then degrades as any unreadable member does (a peel or version the deadline ended is a timeout,
 *     never a missing commit or an older git). A wait the deadline cuts never changes what it judges: past it no
 *     lock is taken or reclaimed, and a cache directory is not taken for a crash's leftover.
 *
 * PARSED CACHE (`memoAtCommit`, session only): a value derived only from the bytes at
 * (repo key, commit) by a given kernel never changes, so it is kept on disk under
 * `<cacheRoot>/.parsed/<kernel fingerprint>/<sha256(item key)>.json`, written
 * atomically (temp file + rename), read back only when every recorded field matches,
 * bounded (LRU by mtime, pruned at most once per session), and never holding a
 * transient failure (any E_REMOTE_UNREADABLE) or a value whose JSON round trip would
 * differ. A corrupt entry is a miss, never an error.
 *
 * OBSERVATION STORE (session only): `<cacheRoot>/.observed/<sha256(key NUL at-args NUL urlDigest)>.json`
 * records each successful live head observation { v, key, args, urlDigest, commit, ref,
 * observedAt } — never the url itself (it may carry userinfo); two spellings of one repo
 * keep a record each. A record is reused only
 * under `maxAge`, only when key, ref args and urlDigest all match, and never in place of
 * a live observation that failed.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { setMaxListeners } from "node:events";
import {
  closeSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync,
  statSync, unlinkSync, utimesSync, writeFileSync, writeSync, symlinkSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { oatsError } from "./errors.mjs";
import { killGroup, signalGroup, terminateGroup, watchGroup } from "./process-group.mjs";

export const FILE_BUDGET = 4 * 1024 * 1024;        // readRemoteFile: 4 MiB per file
export const TREE_BUDGET = 64 * 1024 * 1024;       // fetchRemoteTree: 64 MiB per subtree
/** A commit is fetched with its trees and the blobs up to this size; a read fetches any larger blob it needs. */
export const SMALL_BLOB_LIMIT = 64 * 1024;
/** The oldest git that keeps a partial cache honest: GIT_NO_LAZY_FETCH arrived in 2.45; an older git fetches a
 *  missing blob on its own, or dies trying. With an older git every cache fetches whole trees. */
export const PARTIAL_FETCH_GIT = [2, 45];
export const GIT_TIMEOUT_MS = 30_000;
/** The fetch of a commit into the cache: the first one transfers the commit's whole tree, which for a
 *  large workspace host takes far longer than GIT_TIMEOUT_MS (awebai/oats#362). */
export const GIT_FETCH_TIMEOUT_MS = 600_000;
/** The remote budget of a deployment read (`oats status`, `oats workspace status`): its session's `deadline` is
 *  this long after the session starts, so the command answers inside a caller's own limit (the Desktop's 30 s). */
export const READ_REMOTE_BUDGET_MS = 12_000;
/** What OATS keeps of a v0 ref advertisement (git's stdout, `maxBuffer`). It bounds memory, not the wire: git
 *  reads the whole advertisement before printing it, so one over budget is transferred once, then git is killed
 *  and the remote observed under v2, its server-side filter, from then on (observeLive). */
export const V0_ADVERTISEMENT_BUDGET = 4 * 1024 * 1024;
/** A session's tree index: the output budget of one `ls-tree -r -t -l -z <commit>`. */
export const TREE_INDEX_BUDGET = 64 * 1024 * 1024;
/** `--max-age` bounds (seconds). */
export const MAX_AGE_LIMIT = 86_400;
/** At most this many head observations running at once per session (real and prefetched), each for all its
 *  git work: ls-remote and the fetch of its commit, or a reused record's fetch. */
export const OBSERVE_LIMIT = 8;
/** At most this many `cat-file --batch` children alive per session (idle ones are closed first). */
const BATCH_LIMIT = 12;
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

const TRANSPORTS = new Set(["https", "ssh"]);

/**
 * A hosted ref. `fetchUrl` is the url the FORM WRITTEN asks for (null → derive from
 * `transport`): ssh forms are kept verbatim (the operator's ssh access is what must be
 * used), https forms are canonicalised, and the bare `git:` scheme follows `transport`.
 */
function hostedRef(host, rawPath, text, { fetchUrl = null, transport = "https" } = {}) {
  const h = host.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(h)) throw fail("E_REPO_REF", `repository reference has an invalid host: ${text}`, { ref: text, host });
  const path = repoPathSegments(rawPath, text);
  const url = fetchUrl ?? (transport === "ssh" ? `git@${h}:${path}.git` : `https://${h}/${path}.git`);
  return Object.freeze({ host: h, path, url, key: `${h}/${path}` });
}

function transportOf(options) {
  const t = options?.transport;
  if (t === undefined || t === null) return "https";
  if (!TRANSPORTS.has(t)) throw fail("E_REPO_REF", `remoteOptions.transport must be "https" or "ssh", got ${JSON.stringify(t)}`, { transport: t });
  return t;
}

function localRef(absPath) {
  const normalized = resolve(absPath).replace(/[\\/]+$/, "") || sep;
  return Object.freeze({ host: "local", path: normalized, url: normalized, key: `local/${normalized}` });
}

/**
 * "git:github.com/org/repo(.git)" | "https://github.com/org/repo(.git)" | "git@github.com:org/repo(.git)"
 * | "ssh://[user@]github.com[:port]/org/repo(.git)" | "/abs/path/to/bare.git" | "file:///abs/path"
 * → { host, path, url, key } | throws E_REPO_REF.
 * `key` ("<host>/<path>") is the identity: every form of one repo gives the same key.
 * `url` is what git fetches: ssh forms verbatim, https canonical, the bare `git:` scheme
 * per `options.transport` ("https" default | "ssh" → `git@<host>:<path>.git`).
 * Already-parsed refs (objects with key+url) pass through once re-validated: the
 * object's `url` must itself parse to the same `key` (no smuggled `ext::` urls or `../` keys).
 */
export function parseRepoRef(text, options = undefined) {
  const transport = transportOf(options);
  if (text && typeof text === "object" && typeof text.key === "string" && typeof text.url === "string") {
    const again = parseRepoRef(text.url);
    if (again.key !== text.key) throw fail("E_REPO_REF", `repository reference object is inconsistent: key ${text.key} does not match url ${text.url}`, { ref: text.key, url: text.url });
    return text;
  }
  if (typeof text !== "string" || !text.trim()) throw fail("E_REPO_REF", "repository reference must be a non-empty string", { ref: text });
  const ref = text.trim();
  let m;
  if ((m = /^git:([^/:@\s]+)\/(.+)$/.exec(ref))) return hostedRef(m[1], m[2], ref, { transport });
  if ((m = /^https?:\/\/([^/@\s]+)\/(.+)$/.exec(ref))) return hostedRef(m[1], m[2], ref);
  // ssh forms: the url is kept AS WRITTEN (user, port, host case) — it is the operator's access.
  if ((m = /^git@([^:/\s]+):(.+)$/.exec(ref))) return hostedRef(m[1], m[2], ref, { fetchUrl: ref });
  if ((m = /^ssh:\/\/(?:[^@/\s]+@)?([^/:@\s]+)(?::\d+)?\/(.+)$/.exec(ref))) return hostedRef(m[1], m[2], ref, { fetchUrl: ref });
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

/** The environment every git child of the kernel that may reach a remote runs under: it never prompts (no
 *  terminal prompt, askpass refused, ssh in BatchMode) and never fetches a missing object on its own. */
export function gitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/usr/bin/false",
    GIT_SSH_COMMAND: sshCommand(),
    GIT_LITERAL_PATHSPECS: "1",
    // A cache holds a commit's trees and its small blobs (SMALL_BLOB_LIMIT); a read fetches what else it needs
    // first (ensureBlobs). git must never fetch a missing blob on its own, one round trip at a time.
    GIT_NO_LAZY_FETCH: "1",
  };
}

/** Every git child this module started that has not exited yet (runGit's and the batch readers'): what
 *  reapOnExit still has to end when the process exits. */
const liveChildren = new Set();
/** The exit path (`process.on("exit")`, ReadSession.closeNow) cannot wait for a timer, so the graceful kill
 *  is done synchronously and bounded: every live git group gets SIGTERM, the process blocks for at most
 *  EXIT_GRACE_MS (git removes its lock files on SIGTERM in far less), then SIGKILL ends what is left. A
 *  child's pid cannot be reused meanwhile: Node has not reaped it. */
const EXIT_GRACE_MS = 200;
function reapOnExit() {
  // A child stays tracked until its stdio closes: a leader that exited while a descendant still holds its pipes
  // is still here, and its group still gets both signals.
  const children = [...liveChildren];
  if (!children.length) return;
  for (const child of children) signalGroup(child, "SIGTERM");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, EXIT_GRACE_MS);
  for (const child of children) signalGroup(child, "SIGKILL");
  liveChildren.clear();
}

/** Default exec dependency: runs `git <args>`; resolves { stdout, stderr } (Buffers);
 * rejects with { code, signal, killed, stderr, stdout, timedOut, overflowed }.
 *   timedOut   — the `timeout` kill (killed=true, signal SIGTERM, no error.code); set by
 *                our own timer only: a git that some other process killed (an OOM kill)
 *                exits with its signal and timedOut false;
 *   overflowed — stdout or stderr exceeded `maxBuffer` (the child is killed too, and
 *                error.code = ERR_CHILD_PROCESS_STDIO_MAXBUFFER): NOT a timeout.
 * An abort of `signal` rejects with an AbortError (code ABORT_ERR). git runs detached,
 * as its own process group: a timeout, an overflow or an abort kills the group, so
 * git's ssh or remote helper dies with it (a kill of git alone left them running until
 * their connection ended). `input` is written to git's stdin, which is then closed. Injectable via options.exec. */
export function runGit(args, { cwd, maxBuffer = 16 * 1024 * 1024, timeout = GIT_TIMEOUT_MS, input, signal } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) { reject(abortError(signal)); return; }
    // stdin is a pipe: written with `input` and closed, else never written, as execFile gave it.
    const child = watchGroup(spawn("git", args, { cwd, env: gitEnv(), detached: true, stdio: ["pipe", "pipe", "pipe"] }));
    liveChildren.add(child);
    child.once("close", () => liveChildren.delete(child));
    if (input !== undefined) { child.stdin.on("error", () => { /* EPIPE after the child died: 'close' reports it */ }); child.stdin.end(input); }
    const out = [], err = [], size = { out: 0, err: 0 };
    let done = false;
    const output = () => ({ stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
    const settle = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolvePromise(value);
    };
    const stop = (error) => {
      if (done) return;
      // SIGTERM first (git removes its lock files), SIGKILL after the grace. The error says which kill this
      // is (`timedOut` for our own timer), never the signal that finally ended git.
      terminateGroup(child);
      // stdout and stderr are drained, never destroyed: 'close' must still wait for a descendant holding them, so
      // terminateGroup's SIGKILL reaches it (and only it). Unref'd, they never keep the command alive.
      child.stdin.destroy();
      for (const s of [child.stdout, child.stderr]) { s.removeAllListeners("data"); s.resume(); s.unref?.(); }
      settle(Object.assign(error, output()));
    };
    const onAbort = () => stop(abortError(signal));
    const timer = timeout > 0 ? setTimeout(() => stop(Object.assign(new Error(`Command failed: git ${args.join(" ")} (timed out after ${timeout} ms)`),
      { code: null, killed: true, signal: "SIGTERM", timedOut: true, overflowed: false })), timeout) : null;
    signal?.addEventListener("abort", onAbort, { once: true });
    const collect = (chunks, key) => (chunk) => {
      const room = maxBuffer - size[key];
      if (chunk.length > room) {
        chunks.push(chunk.subarray(0, Math.max(0, room))); size[key] = maxBuffer;
        stop(Object.assign(new RangeError(`${key === "out" ? "stdout" : "stderr"} maxBuffer length exceeded`),
          { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true, signal: "SIGTERM", overflowed: true, timedOut: false }));
        return;
      }
      chunks.push(chunk); size[key] += chunk.length;
    };
    child.stdout.on("data", collect(out, "out"));
    child.stderr.on("data", collect(err, "err"));
    child.on("error", (error) => { killGroup(child); settle(Object.assign(error, output(), { overflowed: false, timedOut: false })); });
    child.on("close", (code, exitSignal) => {
      if (code === 0) { settle(null, output()); return; }
      const { stdout, stderr } = output();
      settle(Object.assign(new Error(`Command failed: git ${args.join(" ")}\n${stderr.toString("utf8")}`),
        { code, signal: exitSignal, killed: false, stdout, stderr, overflowed: false, timedOut: false }));
    });
  });
}

function abortError(signal) {
  return Object.assign(new Error("The operation was aborted", { cause: signal?.reason }), { name: "AbortError", code: "ABORT_ERR", overflowed: false, timedOut: false });
}

/** A git call the session's deadline left no time for: shaped as runGit's own timeout (classified "timeout"). */
function deadlineError(args) {
  return Object.assign(new Error(`Command failed: git ${args.join(" ")} (the read budget ended before it ran)`),
    { code: null, killed: false, signal: null, timedOut: true, overflowed: false, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
}

/** `exec(args, opts)` under the session's deadline: its timeout (opts.timeout, else GIT_TIMEOUT_MS) cut to what is
 *  left, and no git started once nothing is. Without a deadline, exactly `exec(args, opts)`. */
function sessionExec(exec, session, args, opts = {}) {
  if (session?.deadline == null) return exec(args, opts);
  const timeout = session.remaining(opts.timeout ?? GIT_TIMEOUT_MS);
  if (timeout <= 0) return Promise.reject(deadlineError(args));
  return exec(args, { ...opts, timeout });
}

function stderrText(error) {
  const s = error?.stderr;
  return Buffer.isBuffer(s) ? s.toString("utf8") : typeof s === "string" ? s : String(error?.message ?? "");
}

/** Classify a failed network git call into the contract's reasons. A `maxBuffer`
 * overflow is never a timeout (the child is killed in both cases; only the timeout kill
 * counts) — it falls through to the stderr text, else "network". A timeout is our own
 * timer's kill (`timedOut`), whatever signal it sent. A git lock still held by another
 * process (a lost race that outlived retryLockRace, or a dead process's stale lock) is
 * "cache": a local cache write failed, nothing about the remote. Any other signal exit is
 * "killed" (the system killed git, e.g. out of memory). */
export function classifyRemoteFailure(error) {
  if (error?.overflowed === true || error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return classifyText(error) ?? "network";
  if (error?.timedOut) return "timeout";
  if (isLockRace(error) || isLocalWriteFailure(error)) return "cache";
  if (typeof error?.signal === "string" && error.signal) return "killed";
  return classifyText(error) ?? "network";
}

/** The stderr-text half of classifyRemoteFailure; null when the text says nothing recognisable. */
function classifyText(error) {
  const text = stderrText(error).toLowerCase();
  if (/authentication failed|could not read username|could not read password|permission denied|publickey|403|forbidden|terminal prompts disabled|invalid username or password|access denied|unauthori[sz]ed/.test(text)) return "auth";
  if (/repository not found|repository '.*' not found|not found|does not appear to be a git repository|no such file or directory|not our ref|unadvertised object|couldn't find remote ref|remote ref .* not found|not a valid object name|not a tree object|bad object|is not a valid revision|no such ref/.test(text)) return "not-found";
  if (/could not resolve host|connection refused|connection timed out|network is unreachable|unable to access|early eof|remote end hung up|connection reset|ssl|tls|unable to connect/.test(text)) return "network";
  return null;
}

function unreadable(ref, error, extra = {}) {
  const reason = classifyRemoteFailure(error), killed = reason === "killed";
  if (reason === "cache") return cacheFailure(ref, error, extra);
  return fail("E_REMOTE_UNREADABLE", `cannot read remote ${ref.url} (${reason})${killed ? `: git was killed (signal ${error.signal})` : ""}`,
    { url: ref.url, key: ref.key, reason, ...(killed ? { signal: error.signal } : {}), ...extra });
}

/** The lock file a git lock error names (`Unable to create '<path>.lock'`, `could not lock config file <path>`),
 *  else null. */
function lockFileOf(error, cwd = null) {
  const text = stderrText(error);
  const m = /Unable to create '([^']+\.lock)'/.exec(text) ?? /could not lock config file ([^:\s]+)/.exec(text);
  if (!m) return null;
  const file = m[1].endsWith(".lock") ? m[1] : `${m[1]}.lock`;
  // git names a lock relative to its cwd (`could not lock config file config`), or as `<dir>/./refs/…`.
  return isAbsolute(file) ? resolve(file) : cwd ? resolve(cwd, file) : file;
}

/** git could not write a file of the local cache repo (a FETCH_HEAD, a pack, an object it cannot open or
 *  create: permissions, a directory in the way, a read-only or full disk): a fact about this machine, never
 *  about the remote. Only local file wording counts: "Permission denied (publickey)" stays auth. */
const isLocalWriteFailure = (error) => /cannot open '[^']+': |unable to create temporary file|insufficient permission for adding an object|no space left on device|read-only file system|unable to write (?:file|new|loose|sha1|index)|could not write (?:to|file|index)/i.test(stderrText(error));

/** A write to the local cache repo failed — reason "cache" (a timeout stays "timeout"), never "network" — with a
 *  message that says what to do: a lock still held names its file, safe to remove once no oats process runs;
 *  any other failure carries git's own words. `extra.stage` says which write (init, pin, config, fetch). */
function cacheFailure(ref, error, extra = {}) {
  const url = redactUrl(ref.url);
  if (error?.timedOut) return fail("E_REMOTE_UNREADABLE", `cannot write the cache of ${url} (timeout)`, { url: ref.url, key: ref.key, reason: "timeout", ...extra });
  const where = extra.cacheDir ? ` at ${extra.cacheDir}` : "";
  const lock = isLockRace(error) ? lockFileOf(error, extra.cacheDir) : null;
  if (isLockRace(error)) {
    const held = lock ? `${lock} is still held` : "a git lock in it is still held";
    return fail("E_REMOTE_UNREADABLE", `cannot write the cache of ${url}${where} (cache${extra.stage ? `, ${extra.stage}` : ""}): ${held} by another git process, or left by one that died; it is safe to remove once no oats or git process is running`,
      { url: ref.url, key: ref.key, reason: "cache", ...extra, ...(lock ? { lock } : {}) });
  }
  const why = stderrText(error).trim().split("\n").filter(Boolean).join(" ") || error?.message || error?.code || "git failed";
  const check = isLocalWriteFailure(error) ? `; check that ${extra.cacheDir ?? "the cache"} is writable by this user and its disk has room` : "";
  return fail("E_REMOTE_UNREADABLE", `cannot write the cache of ${url}${where} (cache${extra.stage ? `, ${extra.stage}` : ""}): ${why}${check}`, { url: ref.url, key: ref.key, reason: "cache", ...extra });
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
/** A write another process won (a git lock it holds, or the cache's `shallow` file it rewrote mid-fetch): a race
 *  on the local cache, retried, and never a fact about the remote. */
const isLockRace = (error) => /\.lock': File exists|Unable to create .*\.lock|another git process seems to be running|could not lock config file|shallow file has changed since we read it/i.test(stderrText(error));
/** How long a git lock is waited for before it is judged. Every oats writer of this kernel holds the cache's
 *  write lock (withCacheWriteLock), so a git lock met under it belongs to an older kernel's live write, or to a
 *  git that was killed: the wait covers the first, short writes; a fetch's lock is judged by its age. */
const LOCK_WAIT_MS = 3_000;
/** Run `fn` (one git call that writes the cache repo), again after a lost on-disk `.lock` race, until
 *  LOCK_WAIT_MS has passed (backoff up to 500 ms, jittered); a timeout or any other failure is never retried.
 *  A session's deadline cuts the backoff: the next call then ends as its timeout (sessionExec). */
async function retryLockRace(fn, session = null) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (error) {
      if (!isLockRace(error) || error.timedOut) throw error;
      if (Date.now() >= deadline) throw error;
      const backoff = Math.min(500, 50 * 2 ** attempt) * (0.5 + Math.random());
      await sleep(session ? session.remaining(backoff) : backoff);
    }
  }
}

// ---------------------------------------------------------------------------
// the cache write lock (cross-process)
// ---------------------------------------------------------------------------

/** How long a write waits for another live oats process writing the same cache: a whole fetch, and a margin. */
const CACHE_WRITE_WAIT_MS = GIT_FETCH_TIMEOUT_MS + 60_000;
/** A write lock with no readable owner (made by hand, or by a filesystem fault: ours is linked into place
 *  whole) is judged by its age instead. */
const UNREADABLE_LOCK_STALE_MS = 30_000;
/** How old a git `*.lock` must be before a write holding the cache write lock may remove it: older than the
 *  longest fetch any oats allows, so an older kernel's live fetch (it takes no write lock) is never broken. */
const GIT_LOCK_STALE_MS = GIT_FETCH_TIMEOUT_MS + 60_000;

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }

/** The write lock of the cache repo `dir`: `<cacheRoot>/.locks/<repo>.lock`, outside git's own namespace. */
const cacheWriteLockOf = (dir) => join(dirname(dir), ".locks", `${basename(dir)}.lock`);

/** The write lock as { owner, ino, mtimeMs } (owner null when it holds no readable { pid, token }), or null
 *  when it is gone. A symlink or anything but a regular file is an unreadable lock; a lock that cannot be read
 *  at all (a directory in its place, EACCES) is thrown: retrying cannot clear it. */
function readCacheWriteLock(path) {
  let st;
  try { st = lstatSync(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  let owner = null;
  if (st.isFile()) {
    try { const o = JSON.parse(readFileSync(path, "utf8")); if (Number.isSafeInteger(o?.pid) && typeof o?.token === "string") owner = o; }
    catch (error) { if (error.code === "ENOENT") return null; if (error.code && error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  }
  return { owner, ino: st.ino, mtimeMs: st.mtimeMs };
}

/**
 * Run `fn` holding the cache repo's cross-process write lock (docs: oats-kernel-expert decision
 * record-lock-liveness-tradeoff): every oats write to a cache repo — init, config, fetch, pin — happens under
 * it, so two processes never write one cache at once; reads take no lock. The lock is an exclusive-create file
 * holding { pid, token, startedAt }, linked into place whole. A live holder is waited for, never stolen from,
 * whatever its age; a dead holder's lock (or an unreadable one past UNREADABLE_LOCK_STALE_MS) is removed after
 * checking it is still the same file. Every pass that does not acquire falls through one deadline check and
 * one sleep. At the deadline: E_REMOTE_UNREADABLE { reason: "cache", stage, cacheDir, lock, holderPid }; at once
 * when a reclaimer died holding the reclaim guard (reclaimCacheWriteLock), with details.guard.
 * `fn({ waited })`: whether another process held the lock first (what it wrote is worth checking again).
 */
async function withCacheWriteLock(ref, dir, stage, session, fn) {
  const signal = session?.signal;
  const lock = cacheWriteLockOf(dir);
  const owner = { pid: process.pid, token: randomBytes(12).toString("hex"), startedAt: new Date().toISOString() };
  const url = redactUrl(ref.url);
  const refuse = (message, extra = {}) => fail("E_REMOTE_UNREADABLE", `cannot write the cache of ${url} at ${dir} (cache, ${stage}): ${message}`,
    { url: ref.url, key: ref.key, reason: "cache", stage, cacheDir: dir, lock, ...extra });
  try { mkdirSync(dirname(lock), { recursive: true, mode: 0o700 }); } catch (error) { throw refuse(`cannot create ${dirname(lock)} (${error.code ?? error.message})`); }
  const deadline = Date.now() + (session?.cacheWriteWaitMs ?? CACHE_WRITE_WAIT_MS);
  let held = null, waited = false;
  // The session's deadline ends the wait before anything is taken or reclaimed: the read is a timeout, and the
  // lock (live, stale or unreadable) stays exactly as it is.
  const budgetEnded = () => {
    let now = held;
    try { now = readCacheWriteLock(lock); } catch { /* as last seen */ }
    const holder = now?.owner ? `oats process ${now.owner.pid}` : "another process";
    return fail("E_REMOTE_UNREADABLE", `cannot write the cache of ${url} at ${dir} (timeout, ${stage}): the read budget ended ${now ? `while ${holder} held its write lock ${lock}` : `before it took its write lock ${lock}`}`,
      { url: ref.url, key: ref.key, reason: "timeout", stage, cacheDir: dir, lock, ...(now?.owner ? { holderPid: now.owner.pid } : {}) });
  };
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw unreadable(ref, abortError(signal), { cacheDir: dir, stage });
    if (session?.expired()) throw budgetEnded();
    const tmp = `${lock}.${owner.pid}.${owner.token}`;
    try {
      writeFileSync(tmp, JSON.stringify(owner) + "\n", { mode: 0o600 });
      try { linkSync(tmp, lock); break; } catch (error) { if (error.code !== "EEXIST") throw error; }
    } catch (error) { throw refuse(`cannot take its write lock ${lock} (${error.code ?? error.message})`); }
    finally { try { unlinkSync(tmp); } catch { /* never written */ } }
    try { held = readCacheWriteLock(lock); } catch (error) { throw refuse(`cannot read its write lock ${lock} (${error.code ?? error.message}); remove it if no oats process is running`); }
    if (held && isStaleLock(held) && !session?.expired()) {
      const abandoned = reclaimCacheWriteLock(lock, held, owner);
      if (abandoned) {
        throw refuse(`${abandoned.guard} was left by ${abandoned.pid ? `oats process ${abandoned.pid}, which died` : "an oats process that died"} while reclaiming the write lock ${lock}; it is safe to remove once no oats process is running`,
          { guard: abandoned.guard, ...(held.owner ? { holderPid: held.owner.pid } : {}) });
      }
    }
    if (Date.now() >= deadline) {
      throw refuse(held?.owner ? `oats process ${held.owner.pid} has been writing it since ${held.owner.startedAt} (lock ${lock}); try again once it finishes`
        : `its write lock ${lock} is held; it is safe to remove once no oats process is running`, held?.owner ? { holderPid: held.owner.pid } : {});
    }
    if (session?.expired()) throw budgetEnded();
    waited = true;
    const backoff = Math.min(250, 25 * 2 ** attempt) * (0.5 + Math.random());
    await sleep(session ? Math.max(1, session.remaining(backoff)) : backoff);
  }
  try { return await fn({ waited }); }
  finally {
    // Release only our own lock: one reclaimed from us meanwhile belongs to its new holder.
    try { if (readCacheWriteLock(lock)?.owner?.token === owner.token) unlinkSync(lock); } catch { /* gone */ }
  }
}

/** Whether a lock record (readCacheWriteLock) is provably abandoned: its owner's pid is gone, or it has no
 *  readable owner and is older than UNREADABLE_LOCK_STALE_MS. A live owner is never stale, whatever its age. */
const isStaleLock = (held) => (held.owner ? !pidAlive(held.owner.pid) : Date.now() - held.mtimeMs > UNREADABLE_LOCK_STALE_MS);
/** The same record still at `path`: the same owner token, or (no readable owner) the same file. */
const sameLock = (now, held) => (held.owner ? now?.owner?.token === held.owner.token : now && !now.owner && now.ino === held.ino && now.mtimeMs === held.mtimeMs);

/**
 * Remove the write lock `held`, proven stale — serialized among reclaimers by the guard `<lock>.reclaim`
 * (exclusive create, holding { pid, token }). Under the guard the lock is read again and removed only if it is
 * still that stale record. Only a reclaimer ever removes another process's lock, and reclaimers hold the guard,
 * so the lock cannot change between that check and the unlink: a reclaimer that paused cannot delete the lock a
 * live process took meanwhile. A live guard is waited for (the caller's next pass). A guard whose holder died
 * (or unreadable and old) is never removed: removing it would race exactly as removing the lock does, with no
 * guard left to serialize that, so two reclaimers could each delete the other's live guard, then lock. It is
 * returned instead, { guard, pid }, and the caller refuses naming it: a reclaimer dying inside its guard is a
 * microseconds window, and a human removing the file once no oats process runs is the safe recovery. Any other
 * failure leaves the lock to the caller's next pass and its deadline. → null, or the abandoned guard.
 */
function reclaimCacheWriteLock(lock, held, me) {
  const guard = `${lock}.reclaim`;
  try { writeFileSync(guard, JSON.stringify({ pid: me.pid, token: me.token }) + "\n", { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error?.code !== "EEXIST") return null;
    try { const g = readCacheWriteLock(guard); if (g && isStaleLock(g)) return { guard, pid: g.owner?.pid ?? null }; } catch { /* next pass */ }
    return null;
  }
  try {
    const now = readCacheWriteLock(lock);
    if (now && sameLock(now, held) && isStaleLock(now)) unlinkSync(lock);
  } catch { /* next pass */ }
  finally { try { if (readCacheWriteLock(guard)?.owner?.token === me.token) unlinkSync(guard); } catch { /* gone */ } }
  return null;
}

/** Remove the git lock file `lockFile` that a cache write met, if — and only if — it provably belongs to no live
 *  writer: it is inside this cache repo, ends in `.lock`, is a regular file (never a symlink), and is older than
 *  GIT_LOCK_STALE_MS. Called only while holding the cache write lock (no oats writer of this kernel can hold it).
 *  → whether it was removed. */
function reclaimGitLock(repo, lockFile) {
  if (typeof lockFile !== "string" || !lockFile.endsWith(".lock") || !isAbsolute(lockFile)) return false;
  let root, parent;
  try { root = realpathSync(repo.dir); parent = realpathSync(dirname(lockFile)); } catch { return false; }
  if (parent !== root && !parent.startsWith(root + sep)) return false;
  const file = join(parent, basename(lockFile));
  let st;
  try { st = lstatSync(file); } catch { return false; }
  if (!st.isFile() || Date.now() - st.mtimeMs <= GIT_LOCK_STALE_MS) return false;
  try { unlinkSync(file); return true; } catch { return false; }
}

/** One git call that writes the cache repo (config, fetch, update-ref), made while holding its write lock:
 *  a lost lock race (an older kernel's write) is retried briefly; a git lock that outlives that and is
 *  provably stale (reclaimGitLock: a git killed mid-write) is removed — said once as a session notice — and
 *  the call made once more. Anything else is thrown as git raised it. */
async function cacheGit(repo, args, opts = {}) {
  const run = () => repo.local(args, opts);
  try { return await retryLockRace(run, repo.session); }
  catch (error) {
    const lockFile = isLockRace(error) ? lockFileOf(error, repo.dir) : null;
    if (!lockFile || !reclaimGitLock(repo, lockFile)) throw error;
    repo.session?.notices.push(`removed a stale git lock ${lockFile} (left by a git process that was killed mid-write)`);
    return await run();
  }
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const cacheRootOf = (options) => options.cacheDir ?? defaultCacheRoot();
const cacheDirOf = (root, ref) => join(root, sha256(ref.key));

/** A url without its userinfo (`ssh://user:secret@host/…` → `ssh://host/…`): what may be written to disk. */
function redactUrl(url) {
  return typeof url === "string" ? url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, "$1") : url;
}

function repoHandle(dir, exec, session) {
  const local = (args, opts = {}) => sessionExec(exec, session, ["-C", dir, "-c", "gc.auto=0", ...args], { cwd: dir, ...(session ? { signal: session.signal } : {}), ...opts });
  return { dir, exec, local, session };
}

async function cacheRepo(ref, options) {
  const exec = options.exec ?? runGit;
  const dir = cacheDirOf(cacheRootOf(options), ref);
  const session = sessionOf(options);
  if (!existsSync(join(dir, "HEAD"))) await initCacheRepo(ref, dir, exec, session);
  return repoHandle(dir, exec, session);
}

/** How long a cache directory without HEAD is waited for (an older kernel initialising it in place) before it
 *  is taken for a crash's leftover and replaced. */
const HALF_INIT_WAIT_MS = 2_000;

/**
 * Create the cache repo at `dir` in one atomic step: `git init --bare` into a private sibling directory, then
 * rename it into place, so `dir` never exists half-initialised. Processes racing to create one cache all
 * succeed: a loser's rename finds the winner's complete repo and drops its own copy. A directory at `dir`
 * without HEAD (a crash's leftover, or an older kernel initialising in place) is waited for (bounded), then
 * moved aside and replaced; the cache is disposable. Any other failure is E_REMOTE_UNREADABLE
 * { reason: "cache", stage: "init", cacheDir }.
 */
async function initCacheRepo(ref, dir, exec, session = null) {
  const failInit = (error) => cacheFailure(ref, error, { cacheDir: dir, stage: "init" });
  const tmp = `${dir}.init-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    try { mkdirSync(tmp, { recursive: true, mode: 0o700 }); } catch (error) { throw failInit(error); }
    try { await sessionExec(exec, session, ["init", "-q", "--bare", tmp]); } catch (error) { throw failInit(error); }
    try { writeFileSync(join(tmp, "oats-remote.json"), JSON.stringify({ key: ref.key, url: redactUrl(ref.url) }, null, 2) + "\n"); } catch {}
    const deadline = Date.now() + HALF_INIT_WAIT_MS;
    for (;;) {
      try { renameSync(tmp, dir); return; } // replaces nothing, or an EMPTY directory
      catch (error) {
        if (error?.code !== "ENOTEMPTY" && error?.code !== "EEXIST") throw failInit(error);
      }
      if (existsSync(join(dir, "HEAD"))) return; // another process created it first
      if (Date.now() < deadline) {
        // The session's deadline never shortens the judgment: a directory waited for less than the whole wait is
        // never taken for a leftover. The read ends as a timeout instead.
        if (session?.expired()) throw failInit(deadlineError(["init", "-q", "--bare", dir]));
        await sleep(Math.max(1, Math.min(50, session ? session.remaining(50) : 50)));
        continue;
      }
      // No HEAD after the wait: a leftover. Move it aside (atomic; a process racing to do the same loses
      // with ENOENT, which is fine) and take its place.
      const aside = `${dir}.stale-${process.pid}-${randomBytes(4).toString("hex")}`;
      try { renameSync(dir, aside); } catch (error) { if (error?.code !== "ENOENT") throw failInit(error); }
      // A repo another process renamed in between the check and the move is complete: put it back.
      if (existsSync(join(aside, "HEAD"))) { try { renameSync(aside, dir); continue; } catch { /* taken again meanwhile */ } }
      rmSync(aside, { recursive: true, force: true });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true }); // gone already after a successful rename
  }
}

function pinRef(oid) { return `refs/oats/commits/${oid}`; }

// ---------------------------------------------------------------------------
// read session
// ---------------------------------------------------------------------------

class ReadSession {
  constructor({ maxAge = 0, now = Date.now, fingerprint = null, treeIndexBudget = TREE_INDEX_BUDGET, parsedLimits = null, batchTimeoutMs = GIT_TIMEOUT_MS,
    cacheWriteWaitMs = CACHE_WRITE_WAIT_MS, fetchTimeoutMs = GIT_FETCH_TIMEOUT_MS, deadline = null, v0AdvertisementBudget = V0_ADVERTISEMENT_BUDGET } = {}) {
    if (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > MAX_AGE_LIMIT) throw new TypeError(`maxAge must be an integer from 0 to ${MAX_AGE_LIMIT}`);
    if (deadline !== null && !Number.isFinite(deadline)) throw new TypeError("deadline must be null or a time in Date.now() milliseconds");
    this.maxAge = maxAge;
    this.now = now;
    this.startedAt = new Date(now()).toISOString();
    this.fingerprint = fingerprint;        // tests inject one; else the kernel's own (kernelFingerprint)
    this.treeIndexBudget = treeIndexBudget;
    this.batchTimeoutMs = batchTimeoutMs;  // tests shorten it; a batch answer is otherwise waited for as long as any git call
    this.cacheWriteWaitMs = cacheWriteWaitMs; // tests shorten it: how long a write waits for another live writer of its cache
    this.fetchTimeoutMs = fetchTimeoutMs;  // tests shorten it: a fetch's own timeout
    this.deadline = deadline;              // null, or when every remote step of the command must be over (remaining())
    this.v0AdvertisementBudget = v0AdvertisementBudget; // tests lower it: the largest v0 ref advertisement read
    this.protocolPins = new WeakMap();     // exec → Promise<whether protocol.version is pinned> (observeLive)
    this.parsedLimits = parsedLimits;      // tests inject small prune bounds
    this.observations = new Map();         // memo key → Promise<head observation>
    this.used = new Map();                 // memo key → { observedAt, reused }: the heads this command used
    this.peels = new Map();                // `${cacheRepo}\0${oid}` → peeled commit (positive answers only)
    this.trees = new Map();                // `${cacheRepo}\0${commit}` → Promise<tree index | null>
    this.batches = new Map();              // cacheRepo → batch reader, in least-recently-used order
    this.retiring = new Set();             // evicted batch readers still ending
    this.parsedDirs = new Set();           // fingerprint dirs touched (mtime bumped) this session
    this.observeActive = 0;                // observations running now (at most OBSERVE_LIMIT) …
    this.observeQueue = [];                // … and the ones waiting for a slot, in order: { resolve, reject }
    this.prefetched = new Map();           // memo key → prefetch entry { promise, abandoned } no caller has adopted yet
    this.aborter = new AbortController();  // close()/closeNow() kill every git child still running for this session
    this.signal = this.aborter.signal;
    setMaxListeners(0, this.signal);       // every running git child listens (up to 16 at once): no leak warning
    this.notices = [];                     // what the command should tell the operator once it ends (the CLI prints them)
    this.pruned = false;
    this.closed = false;
  }
  /** One of the session's OBSERVE_LIMIT observation slots, shared by real and prefetched observations and
   *  held for all of an observation's git work (no unbounded fan-out over a large workspace). A released
   *  slot passes straight to the next waiter. Nothing holding a slot ever waits for another one. */
  observeSlot() {
    if (this.closed) return Promise.reject(abandonedError());
    if (this.observeActive < OBSERVE_LIMIT) { this.observeActive++; return Promise.resolve(); }
    return new Promise((resolve, reject) => this.observeQueue.push({ resolve, reject }));
  }
  observeDone() {
    const next = this.observeQueue.shift();
    if (next) next.resolve(); else this.observeActive--;
  }
  /** Give up every prefetch no caller has adopted: a queued one never runs its git, and its memo entry is
   *  dropped so a later caller observes afresh. One already running finishes, or is killed by close(). */
  abandonPrefetches() {
    for (const [key, entry] of this.prefetched) {
      entry.abandoned = true;
      if (this.observations.get(key) === entry.promise) this.observations.delete(key);
    }
    this.prefetched.clear();
  }
  /** The command is over: nothing queued runs, and every git child still running is killed. */
  stop() {
    this.closed = true;
    this.abandonPrefetches();
    for (const waiter of this.observeQueue.splice(0)) waiter.reject(abandonedError());
    this.aborter.abort();
  }
  /** End the batch readers now (a long provider command is about to run) without ending the session:
   *  a later read opens a new one. */
  async closeBatches() {
    const batches = [...this.batches.values(), ...this.retiring];
    this.batches.clear();
    await Promise.all(batches.map((b) => b.close()));
    this.retiring.clear();
  }
  /** `{ observedAt, reused }`: the OLDEST head observation this command used (else the time the
   *  session began), and whether any of them came from the observation store. */
  observation() {
    let oldest = null, reused = false;
    for (const u of this.used.values()) {
      if (u.reused) reused = true;
      if (oldest === null || Date.parse(u.observedAt) < Date.parse(oldest)) oldest = u.observedAt;
    }
    return { observedAt: oldest ?? this.startedAt, reused };
  }
  /** End the session: nothing queued runs, every git child still running is killed, and every batch child
   *  is ended (stdin closed, awaited (bounded), killed if it lingers). */
  async close() {
    this.stop();
    await this.closeBatches();
  }
  /** Synchronous close for `process.on("exit")`: no waiting is possible there. */
  closeNow() {
    this.stop();
    for (const b of [...this.batches.values(), ...this.retiring]) b.kill();
    this.batches.clear();
    this.retiring.clear();
    reapOnExit(); // no timer runs on the exit path: SIGTERM, a bounded synchronous grace, then SIGKILL
  }
  /** What a wait or a git call of `ms` may take: `ms`, cut to what is left before the deadline (never below 0).
   *  Without a deadline, `ms` itself. */
  remaining(ms) { return this.deadline === null ? ms : Math.max(0, Math.min(ms, this.deadline - Date.now())); }
  /** Whether the deadline has passed: every remote step not over by then ends as a `timeout`. */
  expired() { return this.remaining(Infinity) === 0; }
  /** A session rides remoteOptions, which callers may serialise (memo keys): never its innards. */
  toJSON() { return "[oats read session]"; }
}

/** One command's read session (see the module header). `maxAge` seconds (0 = observe live). `deadline` (Date.now()
 *  milliseconds, or null): every remote step ends by then (the module header's DEADLINE). Test seams: `now`,
 *  `fingerprint`, `treeIndexBudget`, `parsedLimits`, `batchTimeoutMs`, `cacheWriteWaitMs`, `fetchTimeoutMs`,
 *  `v0AdvertisementBudget`. */
export function createReadSession(options = {}) { return new ReadSession(options); }
/** An observation the command no longer wants (its session closed, or its prefetch abandoned): never adopted
 *  by a caller that is still reading, so its shape only has to be a typed remote failure. */
function abandonedError() {
  return fail("E_REMOTE_UNREADABLE", "observation abandoned: the command no longer needs it", { reason: "unknown", abandoned: true });
}
/** Give up this session's prefetches that no caller has adopted (lib/workspace.mjs discoverWorkspace, when the
 *  host cannot be observed or once its members are read). Session only; never throws. */
export function abandonPrefetches(options = {}) { sessionOf(options)?.abandonPrefetches(); }
function sessionOf(options) { return options?.session instanceof ReadSession ? options.session : null; }

// ---------------------------------------------------------------------------
// the parsed cache: values derived from the bytes at (repo key, commit)
// ---------------------------------------------------------------------------

/** The prune bounds (count AND bytes, least recently used first; maintainer amendment 5). */
export const PARSED_LIMITS = Object.freeze({
  maxEntries: 8192, maxBytes: 128 * 1024 * 1024,          // prune when either is exceeded …
  keepEntries: 6144, keepBytes: 96 * 1024 * 1024,          // … down to both of these
  staleFingerprintMs: 7 * 24 * 3600 * 1000,                // another kernel's directory, unused this long
  staleObservationMs: 30 * 24 * 3600 * 1000,               // an observation record this old
  staleTempMs: 3600 * 1000,                                // a writer's temp file left by a crash
});

/** The kernel code fingerprint: sha256 over package.json's version, the resolved version of the
 *  `yaml` parser, then every lib/**\/*.mjs and docs/*.schema.json (path NUL bytes NUL), in sorted
 *  path order. A checkout whose parsing changed (its code, or a parser bumped without a kernel
 *  version bump) never reads another build's entries. Computed once per process, lazily. */
let fingerprintMemo = null;
export function kernelFingerprint() {
  if (fingerprintMemo) return fingerprintMemo;
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) walk(p);
      else if (d.isFile() && d.name.endsWith(".mjs")) files.push(p);
    }
  };
  walk(join(root, "lib"));
  for (const name of readdirSync(join(root, "docs"))) if (name.endsWith(".schema.json")) files.push(join(root, "docs", name));
  const rels = files.map((f) => relative(root, f).split(sep).join("/")).sort();
  const hash = createHash("sha256");
  hash.update(String(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version)); hash.update("\0");
  hash.update(`yaml@${resolvedVersion("yaml")}`); hash.update("\0");
  for (const rel of rels) { hash.update(rel); hash.update("\0"); hash.update(readFileSync(join(root, rel))); hash.update("\0"); }
  fingerprintMemo = hash.digest("hex");
  return fingerprintMemo;
}

/** The version of the package `name` this kernel imports (the package.json above its resolved entry),
 *  or "unresolved". */
function resolvedVersion(name) {
  try {
    let dir = dirname(fileURLToPath(import.meta.resolve(name)));
    for (;;) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        if (pkg.name === name) return String(pkg.version);
      } catch { /* no package.json here */ }
      const up = dirname(dir);
      if (up === dir) return "unresolved";
      dir = up;
    }
  } catch { return "unresolved"; }
}

const TRANSIENT_REASONS = new Set(["timeout", "network", "auth", "unknown", "cache"]);
/** A value the parsed cache may keep: JSON-safe (its round trip is deepStrictEqual — plain or
 *  null-prototype objects, dense arrays, finite numbers other than -0, strings, booleans, null; no
 *  undefined, no cycle) and free of transient failures (any E_REMOTE_UNREADABLE, or a remote
 *  failure reason timeout/network/auth/unknown). → encoded { data, nullProto: [pointer] } | null */
function encodeCacheable(value) {
  const nullProto = [];
  const ancestors = new Set();
  const esc = (k) => k.replace(/~/g, "~0").replace(/\//g, "~1");
  const ok = (v, ptr) => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return true;
    if (typeof v === "number") return Number.isFinite(v) && !Object.is(v, -0);
    if (typeof v !== "object" || ancestors.has(v)) return false;
    if (Object.getOwnPropertySymbols(v).length) return false;
    ancestors.add(v);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(v);
      if (Array.isArray(v)) {
        if (Object.keys(descriptors).length !== v.length + 1) return false; // indices + length only
        for (let i = 0; i < v.length; i++) { const d = descriptors[i]; if (!d || !("value" in d) || !d.enumerable || !ok(d.value, `${ptr}/${i}`)) return false; }
        return true;
      }
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) return false;
      if (proto === null) nullProto.push(ptr);
      if (v.code === "E_REMOTE_UNREADABLE" || (typeof v.code === "string" && v.code.startsWith("E_REMOTE_") && TRANSIENT_REASONS.has(v.reason))) return false;
      for (const [k, d] of Object.entries(descriptors)) if (!("value" in d) || !d.enumerable || !ok(d.value, `${ptr}/${esc(k)}`)) return false;
      return true;
    } finally { ancestors.delete(v); }
  };
  return ok(value, "") ? { data: value, nullProto } : null;
}
/** A URL that may carry a secret: any userinfo on http(s) (a bare token), or a `user:password` userinfo on any
 *  scheme. Repo content can hold one (a member ref written with credentials); such a value is never written
 *  to the parsed cache. `ssh://git@host/…` (a user, no password) is not a secret. */
const CREDENTIAL_URL_RE = /\bhttps?:\/\/[^\s"'\/@]+@|\b[a-z][a-z0-9+.-]*:\/\/[^\s"'\/@:]+:[^\s"'\/@]*@/i;
function carriesCredential(text) { return CREDENTIAL_URL_RE.test(text); }
function reviveCached(data, nullProto) {
  if (!nullProto.length) return data;
  const wanted = new Set(nullProto);
  const esc = (k) => k.replace(/~/g, "~0").replace(/\//g, "~1");
  const walk = (v, ptr) => {
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = walk(v[i], `${ptr}/${i}`); return v; }
    if (v === null || typeof v !== "object") return v;
    const out = wanted.has(ptr) ? Object.create(null) : v;
    for (const k of Object.keys(v)) {
      const child = walk(v[k], `${ptr}/${esc(k)}`);
      if (out === v && k !== "__proto__") v[k] = child; // an own "__proto__" key is data: never an assignment
      else Object.defineProperty(out, k, { value: child, enumerable: true, writable: true, configurable: true });
    }
    return out;
  };
  return walk(data, "");
}

/** Write `text` to `file` atomically: a temp file in the same directory, then rename. Failures are ignored
 *  (every store here is an optimisation, never an error). → whether it was written. */
function writeAtomicQuiet(file, text) {
  const dir = dirname(file);
  const tmp = join(dir, `.${file.slice(dir.length + 1)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, file);
    return true;
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* nothing */ }
    return false;
  }
}
/** Read and parse a JSON store file → value | undefined (absent, unreadable, corrupt: a corrupt or partial
 *  file is removed when it can be). */
function readStoreFile(file) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return undefined; }
  try { return JSON.parse(text); }
  catch { try { rmSync(file, { force: true }); } catch { /* nothing */ } return undefined; }
}

function parsedDir(root, session) { return join(root, ".parsed", session.fingerprint ?? kernelFingerprint()); }

/**
 * The parsed cache (see the module header): `compute()`'s value for `item` at (refText's key, commit),
 * from `<cacheRoot>/.parsed/<fingerprint>/` when an intact entry is there — no git process — else computed,
 * kept when cacheable, and returned. Without a session (library callers), or for a commit that is not a
 * full OID, it only computes. A thrown compute() is never kept.
 */
export async function memoAtCommit(refText, commit, item, compute, options = {}) {
  const slot = parsedSlot(refText, commit, item, options);
  if (!slot) return compute();
  if (slot.hit) return slot.value;
  const { session, key, root, dir, fingerprint, file } = slot;
  const value = await compute();
  const encoded = encodeCacheable(value);
  const text = encoded ? JSON.stringify({ v: 1, fingerprint, key, commit, item, nullProto: encoded.nullProto, value: encoded.data }) : null;
  if (text !== null && !carriesCredential(text) && writeAtomicQuiet(file, text)) {
    session.parsedDirs.add(dir);
    if (!session.pruned) { session.pruned = true; pruneStores(root, { fingerprint, limits: session.parsedLimits ?? PARSED_LIMITS, now: session.now() }); }
  }
  return value;
}
/** The parsed-cache slot of (refText's key, commit, item) in this session → null when there is no cache
 *  (no session, not a full OID, an unparseable ref), else { …where, hit, value? } — a hit read and revived,
 *  a corrupt or mismatched entry removed (a miss). */
function parsedSlot(refText, commit, item, options) {
  const session = sessionOf(options);
  if (!session || typeof commit !== "string" || !OID_RE.test(commit) || typeof item !== "string") return null;
  let key;
  try { key = parseRepoRef(refText, options).key; } catch { return null; }
  const root = cacheRootOf(options);
  const dir = parsedDir(root, session);
  const fingerprint = session.fingerprint ?? kernelFingerprint();
  const file = join(dir, `${sha256(JSON.stringify([key, commit, item]))}.json`);
  const slot = { session, key, root, dir, fingerprint, file, hit: false };
  const entry = readStoreFile(file);
  if (entry !== undefined) {
    const intact = entry && typeof entry === "object" && entry.v === 1 && entry.fingerprint === fingerprint && entry.key === key
      && entry.commit === commit && entry.item === item && Object.hasOwn(entry, "value") && Array.isArray(entry.nullProto);
    if (intact) {
      touchParsed(file, dir, session);
      return { ...slot, hit: true, value: reviveCached(entry.value, entry.nullProto) };
    }
    try { rmSync(file, { force: true }); } catch { /* a miss either way */ }
  }
  return slot;
}
/** A parsed-cache entry, read only: its value when an intact entry is there, else undefined. Never computes,
 *  never starts a git process (the member prefetch's source). */
export function peekAtCommit(refText, commit, item, options = {}) {
  const slot = parsedSlot(refText, commit, item, options);
  return slot?.hit ? slot.value : undefined;
}
/** A hit bumps the entry's mtime (LRU) and, once per session, its fingerprint directory's (in use). */
function touchParsed(file, dir, session) {
  const now = new Date(session.now());
  try { utimesSync(file, now, now); } catch { /* ignore */ }
  if (!session.parsedDirs.has(dir)) { session.parsedDirs.add(dir); try { utimesSync(dir, now, now); } catch { /* ignore */ } }
}

/**
 * Bound the stores under `root` (one scan): the current fingerprint's entries, least recently used first,
 * down to keepEntries AND keepBytes once over maxEntries OR maxBytes; other fingerprint directories unused
 * for staleFingerprintMs; observation records older than staleObservationMs; temp files a crashed writer
 * left. Never throws. → { removed, entries, bytes } for the current fingerprint.
 */
export function pruneStores(root, { fingerprint = kernelFingerprint(), limits = PARSED_LIMITS, now = Date.now() } = {}) {
  const L = { ...PARSED_LIMITS, ...limits };
  const list = (dir) => { try { return readdirSync(dir); } catch { return []; } };
  const stat = (p) => { try { return statSync(p); } catch { return null; } };
  const remove = (p, opts = {}) => { try { rmSync(p, { force: true, ...opts }); return true; } catch { return false; } };
  const parsed = join(root, ".parsed");
  let removed = 0, entries = 0, bytes = 0;
  for (const name of list(parsed)) {
    const dir = join(parsed, name);
    if (name === fingerprint) {
      const files = [];
      for (const f of list(dir)) {
        const p = join(dir, f), st = stat(p);
        if (!st) continue;
        if (f.endsWith(".tmp")) { if (now - st.mtimeMs > L.staleTempMs && remove(p)) removed++; continue; }
        files.push({ p, size: st.size, mtime: st.mtimeMs });
      }
      entries = files.length; bytes = files.reduce((n, f) => n + f.size, 0);
      if (entries > L.maxEntries || bytes > L.maxBytes) {
        files.sort((a, b) => a.mtime - b.mtime);
        for (const f of files) {
          if (entries <= L.keepEntries && bytes <= L.keepBytes) break;
          if (remove(f.p)) { removed++; entries--; bytes -= f.size; }
        }
      }
    } else {
      const st = stat(dir);
      if (st && now - st.mtimeMs > L.staleFingerprintMs && remove(dir, { recursive: true })) removed++;
    }
  }
  const observed = join(root, ".observed");
  for (const f of list(observed)) {
    const p = join(observed, f), st = stat(p);
    if (st && now - st.mtimeMs > (f.endsWith(".tmp") ? L.staleTempMs : L.staleObservationMs) && remove(p)) removed++;
  }
  return { removed, entries, bytes };
}

// ---------------------------------------------------------------------------
// the observation store: successful live head observations, for --max-age
// ---------------------------------------------------------------------------

const observationFile = (root, ref, atArgs) => join(root, ".observed", `${sha256(`${ref.key}\0${atArgs.join("\0")}\0${sha256(ref.url)}`)}.json`);

/** A recorded observation of (ref.key, atArgs) reusable now under session.maxAge, else null. With
 *  `anyAge`, an intact record of any age (what the prefetch learns the last-read commit from). */
function readObservation(root, ref, atArgs, session, { anyAge = false } = {}) {
  const rec = readStoreFile(observationFile(root, ref, atArgs));
  if (!rec || typeof rec !== "object" || rec.v !== 1 || rec.key !== ref.key || rec.urlDigest !== sha256(ref.url)) return null;
  if (!Array.isArray(rec.args) || rec.args.length !== atArgs.length || rec.args.some((a, i) => a !== atArgs[i])) return null;
  if (typeof rec.commit !== "string" || !OID_RE.test(rec.commit) || (rec.ref !== null && typeof rec.ref !== "string")) return null;
  const at = typeof rec.observedAt === "string" ? Date.parse(rec.observedAt) : NaN;
  const now = session.now();
  if (!Number.isFinite(at) || (!anyAge && (at > now + 5000 || now - at > session.maxAge * 1000))) return null;
  return { commit: rec.commit, ref: rec.ref, observedAt: rec.observedAt };
}
function writeObservation(root, ref, atArgs, obs) {
  writeAtomicQuiet(observationFile(root, ref, atArgs), JSON.stringify({ v: 1, key: ref.key, args: atArgs, urlDigest: sha256(ref.url), commit: obs.commit, ref: obs.ref, observedAt: obs.observedAt }));
}

/** The COMMIT <oid> peels to, when <oid> is present in the cache and is a commit or an
 * annotated tag chain ending in one; null on a missing object, a pruned store, or a
 * tag/tree/blob that does not peel to a commit. (`rev-parse <oid>^{commit}` peels.) */
async function peelCommit(repo, oid) {
  try {
    const out = (await repo.local(["rev-parse", "--verify", "-q", `${oid}^{commit}`])).stdout.toString("utf8").trim();
    return OID_RE.test(out) ? out : null;
  } catch { return null; }
}

async function objectType(repo, oid) {
  try { return (await repo.local(["cat-file", "-t", oid])).stdout.toString("utf8").trim(); } catch { return null; }
}

/**
 * Ensure <oid> (a full OID of a COMMIT, or of an annotated TAG that peels to one), its trees and its
 * small blobs are present in the cache (larger blobs: ensureBlobs, when a read needs them). → { repo,
 * commit } where `commit` is the PEELED commit: a tag OID given as `at` is accepted, but the commit
 * recorded everywhere is the commit it points to (fix M4). The pin is on the peeled commit; a tag
 * object gets its own `refs/oats/tags/<oid>` pin so gc cannot break the chain either.
 */
async function ensureCommit(ref, oid, options) {
  const dir = cacheDirOf(cacheRootOf(options), ref);
  // A session keeps POSITIVE peels: a commit present in the cache stays present for the command
  // (pinned, and nothing here runs gc). A negative answer is never kept.
  const session = sessionOf(options);
  const known = session?.peels.get(`${dir}\0${oid}`);
  if (known) return { repo: repoHandle(dir, options.exec ?? runGit, session), commit: known };
  const remember = (commit) => { if (session) { session.peels.set(`${dir}\0${oid}`, commit); session.peels.set(`${dir}\0${commit}`, commit); } return commit; };
  return withCacheLock(dir, async () => {
    // Already present (the common case): a read, so no write lock.
    let peeled = false; // the object store was asked already, and said no
    const usable = async (repo) => {
      if (!existsSync(join(dir, "HEAD"))) return null;
      if (!keepsPartialCache(await readVersion(repo, ref)) && await fetchMode(repo) === "partial") return null;
      peeled = true;
      return peelCommit(repo, oid);
    };
    const present = await usable(repoHandle(dir, options.exec ?? runGit, session));
    if (present) return { repo: repoHandle(dir, options.exec ?? runGit, session), commit: remember(present) };
    // Every write below (init, config, fetch, pin) holds the cache's cross-process write lock; a process that
    // waited for it finds what the holder fetched.
    return withCacheWriteLock(ref, dir, "fetch", session, async ({ waited }) => {
    let repo = await cacheRepo(ref, options);
    const version = await readVersion(repo, ref);
    // A partial cache is only safe where git cannot fetch a missing blob on its own: an older git rebuilds it whole.
    if (!keepsPartialCache(version) && await fetchMode(repo) === "partial") repo = await rebuildWhole(repo, ref, options, version);
    const cached = peeled && !waited ? null : await peelCommit(repo, oid);
    if (cached) return { repo, commit: remember(cached) }; // pinned AND present AND (peels to) a commit
    const mode = await fetchMode(repo)
      ?? (keepsPartialCache(version) ? await startPartialFetches(repo, ref) : await recordFullFetches(repo, ref, olderGitNotice(version, ref)));
    const filter = mode === "partial" ? [`--filter=${PARTIAL_FILTER}`] : ["--no-filter"];
    const { stderr } = await fetchInto(repo, ref, ["fetch", "-q", "--depth", "1", "--no-tags", "--no-recurse-submodules", ...filter, "origin", oid], { what: oid, commit: oid });
    // A server without filters says so and sends the whole tree: nothing is lost, the cache remembers.
    if (mode === "partial" && /filtering not recognized by server/i.test(stderr.toString("utf8"))) await recordFullFetches(repo, ref);
    const commit = await peelCommit(repo, oid);
    if (!commit) {
      // A peel the session's deadline ended is the read's timeout, never a missing commit.
      if (session?.expired()) throw unreadable(ref, deadlineError(["rev-parse", `${oid}^{commit}`]), { commit: oid, cacheDir: repo.dir, stage: "fetch" });
      const type = await objectType(repo, oid);
      throw fail("E_REMOTE_UNREADABLE", `${oid} in ${ref.url} is ${type ? `a ${type}` : "missing"}, not a commit`, { url: ref.url, key: ref.key, reason: "not-found", commit: oid, type });
    }
    await writePin(repo, ref, pinRef(commit), commit, commit);
    if (commit !== oid) await writePin(repo, ref, `refs/oats/tags/${oid}`, oid, commit);
    return { repo, commit: remember(commit) };
    });
  });
}

/** Pin `name` to `oid` in the cache repo. Two processes pinning one commit write the same value: a lost lock
 *  race is retried, and a ref that already holds `oid` (another process's write) counts as written. */
async function writePin(repo, ref, name, oid, commit) {
  try { await cacheGit(repo, ["update-ref", name, oid]); }
  catch (error) {
    let current = null;
    try { current = (await repo.local(["rev-parse", "--verify", "-q", name])).stdout.toString("utf8").trim(); } catch {}
    if (current === oid) return;
    throw cacheFailure(ref, error, { cacheDir: repo.dir, stage: "pin", commit });
  }
}

/** The filter a partial fetch asks for: every blob up to SMALL_BLOB_LIMIT comes with the commit. */
const PARTIAL_FILTER = `blob:limit=${SMALL_BLOB_LIMIT / 1024}k`;

/** How this cache fetches (its own `oats.fetch` config): "partial", "full" (its server cannot serve
 *  partial fetches), or null before its first fetch. */
async function fetchMode(repo) {
  try { return (await repo.local(["config", "--get", "oats.fetch"])).stdout.toString("utf8").trim() || null; } catch { return null; }
}

/** Make the cache a partial clone of the remote "origin". Its url is never written (it may carry
 *  credentials): every fetch passes it with `-c remote.origin.url=` (fetchInto). */
async function startPartialFetches(repo, ref) {
  for (const [key, value] of [["core.repositoryformatversion", "1"], ["extensions.partialclone", "origin"], ["remote.origin.promisor", "true"],
    ["remote.origin.partialclonefilter", PARTIAL_FILTER], ["oats.fetch", "partial"]]) await writeConfig(repo, ref, key, value);
  return "partial";
}

/** One `git config <key> <value>` in the cache repo. Two processes starting one cache write the same values,
 *  so a lost lock race is simply retried. */
async function writeConfig(repo, ref, key, value) {
  try { await cacheGit(repo, ["config", key, value]); }
  catch (error) { throw unreadable(ref, error, { cacheDir: repo.dir, stage: "config" }); }
}

/** This cache fetches whole trees from now on (its server cannot serve partial fetches, or this git cannot keep
 *  a partial cache): recorded, and said once (the session's notices; the CLI prints them when the command ends). */
async function recordFullFetches(repo, ref, notice = `${redactUrl(ref.url)} does not serve partial fetches; OATS fetches whole trees from it`) {
  await writeConfig(repo, ref, "oats.fetch", "full");
  repo.session?.notices.push(notice);
  return "full";
}

const olderGitNotice = (version, ref) =>
  `git ${version?.text ?? "(unknown version)"} cannot keep a partial cache (it needs ${PARTIAL_FETCH_GIT.join(".")}); OATS fetches whole trees from ${redactUrl(ref.url)}`;

/** `git --version` of the git `exec` runs, asked once per exec: → { text: "2.54.0", major, minor } | null.
 *  `opts` (a timeout, a signal) go to the call that asks. A call that timed out says nothing about this git:
 *  it answers null to its waiters and is asked again next time. */
const gitVersions = new WeakMap();
export function gitVersion(exec = runGit, opts = undefined) {
  let version = gitVersions.get(exec);
  if (!version) {
    version = Promise.resolve().then(() => exec(["--version"], ...(opts ? [opts] : []))).then((out) => {
      const m = /git version ((\d+)\.(\d+)[^\s]*)/.exec(out.stdout.toString("utf8"));
      return m ? { text: m[1], major: Number(m[2]), minor: Number(m[3]) } : null;
    }, (error) => {
      if (error?.timedOut && gitVersions.get(exec) === version) gitVersions.delete(exec);
      return null;
    });
    gitVersions.set(exec, version);
  }
  return version;
}
/** gitVersion for a read of `ref` in `repo`'s session. Under a deadline the probe gets what is left of it, and
 *  is waited for no longer (another caller may own the probe): a version the deadline left unknown is the
 *  read's timeout, never taken for an older git (which would rebuild a partial cache). */
async function readVersion(repo, ref) {
  const session = repo.session;
  if (session?.deadline == null) return gitVersion(repo.exec);
  const ended = () => unreadable(ref, deadlineError(["--version"]), { cacheDir: repo.dir, stage: "fetch" });
  const left = session.remaining(GIT_TIMEOUT_MS);
  if (left <= 0) throw ended();
  let timer;
  const late = new Promise((resolvePromise) => { timer = setTimeout(() => resolvePromise(ended), left); });
  try {
    const version = await Promise.race([gitVersion(repo.exec, { timeout: left, signal: session.signal }), late]);
    if (version === ended || (version === null && session.expired())) throw ended();
    return version;
  } finally { clearTimeout(timer); }
}
/** Whether this git keeps a partial cache honest (GIT_NO_LAZY_FETCH): an unknown version does not. */
export function keepsPartialCache(version) {
  const [major, minor] = PARTIAL_FETCH_GIT;
  return version != null && (version.major > major || (version.major === major && version.minor >= minor));
}

/** Delete a partial cache an older git cannot read (it would fetch a missing blob on its own, or die), and start
 *  it again recording whole-tree fetches. The cache is disposable: everything in it is fetched again. */
async function rebuildWhole(repo, ref, options, version) {
  const session = repo.session;
  if (session) {
    session.batches.get(repo.dir)?.kill();
    session.batches.delete(repo.dir);
    for (const map of [session.peels, session.trees]) for (const k of [...map.keys()]) if (k.startsWith(`${repo.dir}\0`)) map.delete(k);
  }
  rmSync(repo.dir, { recursive: true, force: true });
  const fresh = await cacheRepo(ref, options);
  await recordFullFetches(fresh, ref, olderGitNotice(version, ref));
  return fresh;
}

/** `git fetch` from the remote into the cache (args start at the subcommand and name the remote "origin"):
 *  a lost on-disk `.lock` race is retried, a timeout names the fetch (`what`) and how long it ran, any other
 *  failure is E_REMOTE_UNREADABLE (`raw`: the git error itself, for a caller that reads its stderr). → { stdout, stderr } */
async function fetchInto(repo, ref, args, { what, commit, input, raw = false } = {}) {
  const started = Date.now();
  let lastError;
  try { return await cacheGit(repo, ["-c", `remote.origin.url=${ref.url}`, ...args], { timeout: repo.session?.fetchTimeoutMs ?? GIT_FETCH_TIMEOUT_MS, ...(input !== undefined ? { input } : {}) }); }
  catch (error) { lastError = error; }
  if (lastError?.timedOut) {
    const elapsedMs = Date.now() - started;
    throw fail("E_REMOTE_UNREADABLE", `cannot read remote ${ref.url} (timeout): git fetch of ${what} timed out after ${Math.round(elapsedMs / 1000)} s`,
      { url: ref.url, key: ref.key, reason: "timeout", commit, operation: "fetch", elapsedMs });
  }
  throw raw ? lastError : unreadable(ref, lastError, { commit, ...(classifyRemoteFailure(lastError) === "cache" ? { cacheDir: repo.dir, stage: "fetch" } : {}) });
}

/** The sizes of `oids` in the cache, one `cat-file --batch-check`: → Map oid → size, null when the cache lacks it. */
async function blobSizes(repo, oids) {
  const out = (await repo.local(["cat-file", "--batch-check"], { input: oids.map((o) => `${o}\n`).join("") })).stdout.toString("utf8");
  const sizes = new Map(oids.map((o) => [o, null]));
  for (const line of out.split("\n")) {
    const [oid, type, size] = line.split(" ");
    if (sizes.has(oid) && type !== "missing" && /^[0-9]+$/.test(size ?? "")) sizes.set(oid, Number(size));
  }
  return sizes;
}

const isRefusedWant = (error) => /unadvertised object|not our ref|does not allow request|allow-(tip|reachable|any)-sha1-in-want/i.test(stderrText(error));

/**
 * Make the blobs of `entries` (ls-tree entries of `commit`) present before anything reads them: those
 * whose size is unknown (null: the cache lacks them) are fetched in ONE fetch, by id, and every entry's
 * `size` is then the blob's real size. A server that refuses wants of blobs by id gets the commit fetched
 * again whole (`--refetch`), and the cache records it (recordFullFetches).
 */
async function ensureBlobs(repo, ref, commit, entries) {
  const unknown = entries.filter((e) => e.size === null);
  if (!unknown.length) return;
  const oids = [...new Set(unknown.map((e) => e.oid))];
  await withCacheLock(repo.dir, async () => {
    let sizes = await blobSizes(repo, oids); // another read may have fetched them meanwhile
    let wanted = oids.filter((o) => sizes.get(o) === null);
    if (wanted.length) await withCacheWriteLock(ref, repo.dir, "fetch", repo.session, async ({ waited }) => {
      if (waited) { // another process may have fetched them while this one waited
        sizes = await blobSizes(repo, oids);
        wanted = oids.filter((o) => sizes.get(o) === null);
        if (!wanted.length) return;
      }
      const what = `${wanted.length} blob${wanted.length === 1 ? "" : "s"} at ${commit}`;
      const refetch = () => fetchInto(repo, ref, ["fetch", "-q", "--refetch", "--no-filter", "--depth", "1", "--no-tags", "--no-recurse-submodules", "origin", commit], { what: commit, commit });
      if (await fetchMode(repo) === "full") await refetch(); // a commit fetched partially before its server was found out
      else {
        try {
          await fetchInto(repo, ref, ["-c", "fetch.negotiationAlgorithm=noop", "fetch", "-q", "--no-tags", "--no-write-fetch-head", "--stdin", "origin"],
            { what, commit, input: wanted.map((o) => `${o}\n`).join(""), raw: true });
        } catch (error) {
          if (typeof error?.code === "string" && error.code.startsWith("E_")) throw error;
          if (!isRefusedWant(error)) throw unreadable(ref, error, { commit, ...(classifyRemoteFailure(error) === "cache" ? { cacheDir: repo.dir, stage: "fetch" } : {}) });
          await refetch();
          await recordFullFetches(repo, ref);
        }
      }
      sizes = await blobSizes(repo, oids);
      const still = oids.find((o) => sizes.get(o) === null);
      if (still) throw fail("E_REMOTE_UNREADABLE", `cannot read remote ${ref.url} (not-found): blob ${still} at ${commit} was not fetched`, { url: ref.url, key: ref.key, reason: "not-found", commit, oid: still });
    });
    for (const e of unknown) e.size = sizes.get(e.oid);
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
  if (isHeadAt(at)) {
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
 * With a session: one head observation per (cache root, url, ref) per command, and — under
 * session.maxAge — a recorded observation no older than that is reused instead of `ls-remote`
 * (the result then carries the RECORDED observedAt and `reused: true`). A full-OID `at` is not a
 * head observation: never recorded, reused or counted.
 */
export async function observeRemote(refText, { at, ...options } = {}) {
  const ref = parseRepoRef(refText, options);
  if (at !== undefined && at !== null && typeof at !== "string") throw fail("E_REPO_REF", "at must be a string (full OID, tag or branch name)", { at });
  if (typeof at === "string" && OID_RE.test(at)) {
    // A tag OID is accepted here; the commit recorded is the one it peels to (M4).
    const { commit } = await ensureCommit(ref, at, options);
    return { key: ref.key, url: ref.url, commit, ref: null, observedAt: new Date().toISOString() };
  }
  const args = lsRemoteArgs(ref, at);
  const session = sessionOf(options);
  if (!session) return observeLive(ref, args, at, options);
  const memoKey = JSON.stringify([cacheRootOf(options), args]);
  const obs = await sessionObservation(ref, args, at, options, session, memoKey, false);
  // Counted only here, by a caller that uses it: a prefetched head nobody asks for never is.
  session.used.set(memoKey, { observedAt: obs.observedAt, reused: obs.reused === true });
  return { ...obs, key: ref.key, url: ref.url };
}

/** The `ls-remote` argv of a head observation (`at`: HEAD, a tag or a branch; never a full OID). */
function lsRemoteArgs(ref, at) {
  const wantHead = isHeadAt(at);
  if (!wantHead && AT_BAD_RE.test(at)) throw fail("E_REPO_REF", `at must be a full OID or a plain tag/branch name, got ${JSON.stringify(at)}`, { at });
  const args = ["ls-remote", "--symref", ref.url];
  if (wantHead) args.push("HEAD");
  else args.push(`refs/tags/${at}`, `refs/tags/${at}^{}`, `refs/heads/${at}`, at);
  return args;
}

/**
 * The session's one observation of (cache root, url, ref args): started by the first caller, adopted by
 * every later one. A failure started by an ordinary caller is dropped from the memo, so a later caller
 * retries. A failure started by a PREFETCH (prefetchObservation) is kept and adopted: it happened moments
 * earlier in this same command, and a retry would double a 30 s timeout on an unreachable member
 * (spec Addendum 3, item 4).
 */
function sessionObservation(ref, args, at, options, session, memoKey, prefetch) {
  let pending = session.observations.get(memoKey);
  if (!pending) {
    const entry = prefetch ? { promise: null, abandoned: false } : null;
    pending = observeInSession(ref, args, at, options, session, entry);
    if (!prefetch) pending = pending.catch((error) => { session.observations.delete(memoKey); throw error; });
    else { entry.promise = pending; session.prefetched.set(memoKey, entry); }
    session.observations.set(memoKey, pending);
  } else if (!prefetch) session.prefetched.delete(memoKey); // adopted: never abandoned from here on
  return pending;
}

/**
 * The commit this machine last observed `refText` at (`at` as observeRemote takes it), from its observation
 * record — of any age: this is not reuse — or the full OID `at` itself. Session only; no git process.
 * → full OID | null (no session, no intact record for this key, ref args and url digest).
 */
export function lastObservedCommit(refText, { at, ...options } = {}) {
  const session = sessionOf(options);
  if (!session) return null;
  try {
    if (typeof at === "string" && OID_RE.test(at)) return at;
    const ref = parseRepoRef(refText, options);
    const record = readObservation(cacheRootOf(options), ref, lsRemoteArgs(ref, at).slice(3), session, { anyAge: true });
    return record ? record.commit : null;
  } catch { return null; }
}

/**
 * Start the session's head observation of `refText` now, without waiting for it (the member prefetch,
 * spec Addendum 3): the same memoised observation a later observeRemote adopts — success or failure —
 * under the same observation limit, reusing a record exactly as observeRemote would. Session only; an
 * unparseable ref or a full-OID `at` is ignored. Never throws, never rejects unhandled.
 */
export function prefetchObservation(refText, { at, ...options } = {}) {
  const session = sessionOf(options);
  if (!session || (typeof at === "string" && OID_RE.test(at))) return;
  try {
    const ref = parseRepoRef(refText, options);
    const args = lsRemoteArgs(ref, at);
    sessionObservation(ref, args, at, options, session, JSON.stringify([cacheRootOf(options), args]), true).catch(() => { /* adopted by its caller */ });
  } catch { /* not a ref: nothing to prefetch */ }
}

/** A head observation in a session: a reusable record (maxAge > 0) whose commit is pinned or can still be
 *  fetched, else live — and every successful live observation is recorded. A problem with a record is
 *  never an error (live instead); a failed live observation is exactly today's error. */
async function observeInSession(ref, args, at, options, session, prefetch = null) {
  const root = cacheRootOf(options);
  const atArgs = args.slice(3);
  await session.observeSlot(); // held for every git process below: the reuse path's fetch as much as ls-remote's
  try {
    // A prefetch given up while it queued (or a session closed meanwhile) runs no git at all.
    if (session.closed || prefetch?.abandoned) throw abandonedError();
    if (session.maxAge > 0) {
      const record = readObservation(root, ref, atArgs, session);
      if (record) {
        const reused = { key: ref.key, url: ref.url, commit: record.commit, ref: record.ref, observedAt: record.observedAt, reused: true };
        if (existsSync(join(cacheDirOf(root, ref), pinRef(record.commit)))) return reused;
        try { return { ...reused, commit: (await ensureCommit(ref, record.commit, options)).commit }; }
        catch { /* the recorded commit can no longer be fetched: observe live */ }
      }
    }
    const obs = await observeLive(ref, args, at, options);
    writeObservation(root, ref, atArgs, obs);
    return obs;
  } finally { session.observeDone(); }
}

/** Whether `at` asks for the remote's default branch (a HEAD observation). */
const isHeadAt = (at) => at === undefined || at === null || at === "" || at === "HEAD";

/** Whether the operator pinned `protocol.version` (env, global, system or the working directory's repo config:
 *  `git config --get`, in the observation's own environment): asked once per command (its session) and exec, or
 *  once per exec without a session. Unset (exit 1) → false; any value, or a read that fails otherwise (an abort
 *  included) → true: today's argv, never an error. */
const protocolPins = new WeakMap();
function protocolPinned(exec, session) {
  const memo = session?.protocolPins ?? protocolPins;
  let pinned = memo.get(exec);
  if (!pinned) {
    pinned = Promise.resolve().then(() => sessionExec(exec, session, ["config", "--get", "protocol.version"], { timeout: GIT_TIMEOUT_MS, ...(session ? { signal: session.signal } : {}) }))
      .then(() => true, (error) => error?.code !== 1);
    memo.set(exec, pinned);
  }
  return pinned;
}

/** The records that a remote is observed under protocol v2 only: `<cacheRoot>/.ls-remote/<sha256(key)>.<reason>.json`,
 *  beside the cache repos and their `.locks/` (written when no cache repo exists yet, and gone with a wiped cache
 *  root), each { protocol: "v2", reason, recordedAt }. `overflow` (its v0 advertisement is over budget) holds for
 *  good; `timeout` (a v0 observation timed out, which load alone can cause) for LS_REMOTE_TIMEOUT_RECORD_MS. One
 *  file per reason, so a timeout recorded by a command already in flight never replaces a permanent overflow.
 *  Written atomically (temp + rename) with no lock: concurrent writers of one file write the same fact. A record
 *  that cannot be read, is corrupt or has expired is no record: v0 is tried, never an error. */
const LS_REMOTE_TIMEOUT_RECORD_MS = 7 * 24 * 3600 * 1000;
const lsRemoteRecordFile = (root, ref, reason) => join(root, ".ls-remote", `${sha256(ref.key)}.${reason}.json`);
function lsRemoteV2Recorded(root, ref, now) {
  const record = (reason) => {
    const rec = readStoreFile(lsRemoteRecordFile(root, ref, reason));
    return rec && typeof rec === "object" && rec.protocol === "v2" && rec.reason === reason ? rec : null;
  };
  if (record("overflow")) return true;
  const rec = record("timeout");
  const at = typeof rec?.recordedAt === "string" ? Date.parse(rec.recordedAt) : NaN;
  return Number.isFinite(at) && at <= now + 5000 && now - at < LS_REMOTE_TIMEOUT_RECORD_MS;
}
function recordLsRemoteV2(root, ref, reason, now) {
  writeAtomicQuiet(lsRemoteRecordFile(root, ref, reason), JSON.stringify({ protocol: "v2", reason, recordedAt: new Date(now).toISOString() }) + "\n");
}

/** A v0 HEAD observation's failure that is final, exactly as under v2: the remote is slow, refuses us or has no
 *  such repository, our cache failed, or the command gave the read up. Anything else is retried under v2. */
const V0_FINAL_REASONS = new Set(["timeout", "auth", "not-found", "cache"]);

/**
 * `ls-remote` the remote and resolve `at`. A HEAD observation (`at` HEAD or unset) speaks protocol v0 when the
 * operator has not pinned `protocol.version` and the remote has no v2 record: one round trip, the whole ref
 * advertisement (`-c protocol.version=0 ls-remote --symref <url>`, no pattern), resolved to exactly what v2's
 * filtered answer gives, HEAD's symref included (v0's symref capability).
 *   - V0_ADVERTISEMENT_BUDGET bounds what is kept (`maxBuffer`), not what crosses the wire: git reads the whole
 *     advertisement before it prints a ref. Over budget, git is killed, the remote is observed again under v2,
 *     recorded for good (`overflow`) and said once: an over-budget remote costs its advertisement once.
 *   - A v0 timeout is today's error (no retry, never a second timeout), recorded for a week (`timeout`) and said.
 *   - Any other failure in V0_FINAL_REASONS (or an abort) is today's error; any other is retried once under v2
 *     and said once if the retry succeeds.
 * `args` (lsRemoteArgs) stays the observation's identity everywhere (records, memo keys) and is the v2 argv; tags
 * and branches always use it.
 */
async function observeLive(ref, args, at, options) {
  const exec = options.exec ?? runGit;
  const session = sessionOf(options);
  const signal = session?.signal;
  // Every git call takes what is left of the session's deadline, if it has one (sessionExec).
  const run = (argv, extra = {}) => sessionExec(exec, session, argv, { timeout: GIT_TIMEOUT_MS, ...(signal ? { signal } : {}), ...extra });
  const root = cacheRootOf(options);
  const now = () => (session ? session.now() : Date.now());
  const url = redactUrl(ref.url);
  const say = (notice) => { if (session && !session.notices.includes(notice)) session.notices.push(notice); };
  let out = null, retried = null;
  const v0 = isHeadAt(at) && !lsRemoteV2Recorded(root, ref, now()) && !(await protocolPinned(exec, session));
  // A command given up while its protocol was asked starts no ls-remote.
  if (signal?.aborted) throw unreadable(ref, abortError(signal), { at: at ?? null });
  if (v0) {
    const budget = session?.v0AdvertisementBudget ?? V0_ADVERTISEMENT_BUDGET;
    // A read whose timeout the command's deadline cuts (status, workspace status) may time out for that alone,
    // which says nothing about the remote: its timeout is not recorded.
    const cut = session ? session.remaining(GIT_TIMEOUT_MS) < GIT_TIMEOUT_MS : false;
    try { out = await run(["-c", "protocol.version=0", "ls-remote", "--symref", ref.url], { maxBuffer: budget }); }
    catch (error) {
      if (error?.overflowed === true || error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        recordLsRemoteV2(root, ref, "overflow", now());
        say(`${url} sends a ref advertisement over ${formatBytes(budget)}; OATS observes it with protocol v2`);
      } else {
        const reason = classifyRemoteFailure(error);
        const aborted = error?.code === "ABORT_ERR" || signal?.aborted;
        if (!aborted && reason === "timeout" && !cut) {
          recordLsRemoteV2(root, ref, "timeout", now());
          say(`${url} timed out under protocol v0; OATS observes it with protocol v2 for 7 days`);
        }
        if (aborted || V0_FINAL_REASONS.has(reason)) throw unreadable(ref, error, { at: at ?? null });
        retried = reason;
      }
    }
  }
  if (!out) {
    try { out = await run(args); }
    catch (error) { throw unreadable(ref, error, { at: at ?? null }); }
  }
  const parsed = parseLsRemote(out.stdout);
  const hit = resolveAt(parsed, at);
  if (!hit) throw fail("E_REMOTE_UNREADABLE", `remote ${ref.url} has no ref matching ${at ?? "HEAD"}`, { url: ref.url, key: ref.key, reason: "not-found", at: at ?? null });
  if (!OID_RE.test(hit.commit)) throw fail("E_REMOTE_UNREADABLE", `remote ${ref.url} returned a non-OID for ${at ?? "HEAD"}`, { url: ref.url, key: ref.key, reason: "not-found", at: at ?? null });
  const { commit } = await ensureCommit(ref, hit.commit, options);
  if (retried) say(`${url} failed under protocol v0 (${retried}); observed with protocol v2`);
  return { key: ref.key, url: ref.url, commit, ref: hit.ref, observedAt: new Date().toISOString() };
}
const formatBytes = (n) => (n % (1024 * 1024) === 0 ? `${n / (1024 * 1024)} MiB` : `${n} bytes`);

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

/** Parse `git ls-tree -l -z` output → [{ mode, type, oid, size, path }]. `size` is null for a tree, and for a
 *  blob the cache does not hold (git prints "BAD" for it and still succeeds): ensureBlobs learns it. */
function parseLsTree(stdout) {
  const entries = [];
  for (const record of stdout.toString("utf8").split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    const meta = record.slice(0, tab).trim().split(/\s+/), path = record.slice(tab + 1);
    const [mode, type, oid, size] = meta;
    entries.push({ mode, type, oid, size: /^[0-9]+$/.test(size) ? Number(size) : null, path });
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

/** `git ls-tree -l -z [flags] <spec> [-- <path>]`; null when <spec> names no tree.
 * Any other failure is E_REMOTE_UNREADABLE (reason "timeout" for the timeout kill, "killed"
 * for any other signal exit, else "unknown") — never a raw Node/git error: enumerateRepo turns E_REMOTE_* into a problem
 * row and would otherwise abort the whole discovery on one unexplained listing (L4). */
async function lsTree(repo, spec, { flags = [], path, ref, commit, maxBuffer = 64 * 1024 * 1024 } = {}) {
  try {
    const args = ["ls-tree", "-l", "-z", ...flags, spec];
    if (path !== undefined) args.push("--", ...[].concat(path));
    const out = await repo.local(args, { maxBuffer });
    return parseLsTree(out.stdout);
  } catch (error) {
    if (typeof error?.code === "string" && error.code.startsWith("E_")) throw error; // already an oats error
    const text = stderrText(error).toLowerCase();
    if (/not a tree object|not a valid object name|does not exist|bad object|fatal: not a tree|path .* does not exist|exists on disk, but not in/.test(text)) return null;
    const killed = !error?.timedOut && !error?.overflowed && typeof error?.signal === "string" && error.signal !== "";
    const reason = error?.timedOut ? "timeout" : killed ? "killed" : "unknown";
    const why = error?.overflowed ? "listing exceeded the output budget" : killed ? `git was killed (signal ${error.signal})` : (text.trim().split("\n")[0] || error?.code || error?.message || "git ls-tree failed");
    throw fail("E_REMOTE_UNREADABLE", `cannot list ${spec}${path !== undefined ? ` -- ${path}` : ""} in ${ref?.key ?? repo.dir} (${reason}: ${why})`, { url: ref?.url ?? null, key: ref?.key ?? null, reason, commit: commit ?? null, spec, path: path ?? null, cause: error?.code ?? null, overflowed: error?.overflowed === true, ...(killed ? { signal: error.signal } : {}) });
  }
}

/** A session's recursive listing of <commit> (one `ls-tree -r -t -l -z` per cache repo and commit):
 *  → Promise<{ list, pos } | null>, null without a session or when the listing failed (the output budget,
 *  a timeout, anything) — every caller then falls back to today's per-path listing, so the index can
 *  never raise an error per-path reading would not. `list` is in git's order: an entry, then (for a
 *  tree) everything below it, contiguously. `pos` maps a path to its FIRST entry. */
function treeIndex(repo, commit, ref) {
  const session = repo.session;
  if (!session) return null;
  const k = `${repo.dir}\0${commit}`;
  let index = session.trees.get(k);
  if (!index) {
    index = lsTree(repo, commit, { flags: ["-r", "-t"], ref, commit, maxBuffer: session.treeIndexBudget }).then((list) => {
      if (!list) return null;
      const pos = new Map();
      list.forEach((e, i) => { if (!pos.has(e.path)) pos.set(e.path, i); });
      return { list, pos };
    }, () => null);
    session.trees.set(k, index);
  }
  return index;
}
/** The index entries below the tree at `rel` ("" = the root), paths relative to it — what
 *  `ls-tree -r -t <commit>:<rel>` lists, in the same order. */
function indexDescendants(index, rel) {
  if (!rel) return index.list;
  const i = index.pos.get(rel);
  if (i === undefined) return [];
  const prefix = `${rel}/`, out = [];
  for (let j = i + 1; j < index.list.length && index.list[j].path.startsWith(prefix); j++) out.push({ ...index.list[j], path: index.list[j].path.slice(prefix.length) });
  return out;
}

/** Return the single ls-tree entry for <commit>:<path>, or null when absent. */
async function entryAt(repo, commit, path, ref) {
  const index = await treeIndex(repo, commit, ref);
  if (index) { const i = index.pos.get(path); return i === undefined ? null : index.list[i]; }
  const entries = await lsTree(repo, commit, { path, ref, commit });
  if (!entries) return null;
  return entries.find((e) => e.path === path) ?? null;
}

/** End our own, still-running child gracefully (SIGTERM, then SIGKILL after the grace; never a pid a failed
 *  spawn left at 0: lib/process-group.mjs). */
function killChild(child) {
  if (child.exitCode === null && child.signalCode === null) terminateGroup(child);
}

/**
 * A session's `git cat-file --batch` for one cache repo: read(oid, budget) → Promise<Buffer>. Spawned
 * like repo.local (same `-C <dir> -c gc.auto=0`, cwd, helper-free gitEnv()); unref'd while idle, so it
 * never keeps the process alive. A header over `budget` rejects that request with `{ oversize }` and its
 * body is skipped, never buffered; a non-blob answers as `cat-file blob` would ("bad file"). `missing`,
 * the child dying (or never starting: ENOENT), or no answer within GIT_TIMEOUT_MS (cut to what is left of
 * `session`'s deadline) rejects EVERY pending request with a git-shaped error (classifyRemoteFailure reads it
 * as today: timeout → "timeout") and ends the child; the next read starts a new one.
 */
function openBatch(dir, timeoutMs = GIT_TIMEOUT_MS, session = null) {
  // Detached, as its own process group: killChild's group kill also ends anything git started.
  const child = watchGroup(spawn("git", ["-C", dir, "-c", "gc.auto=0", "cat-file", "--batch"], { cwd: dir, env: gitEnv(), detached: true, stdio: ["pipe", "pipe", "pipe"] }));
  liveChildren.add(child);
  child.once("close", () => liveChildren.delete(child));
  const queue = [];                    // { resolve, reject, budget, size? }
  let chunks = [], length = 0, skip = 0, stderr = "", timer = null, dead = null, exited = null;
  const exitedPromise = new Promise((r) => { exited = r; });
  const handles = [child, child.stdin, child.stdout, child.stderr];
  const idle = () => { for (const h of handles) h?.unref?.(); };
  const busy = () => { for (const h of handles) h?.ref?.(); };
  const arm = () => {
    clearTimeout(timer); timer = null;
    if (!queue.length) { idle(); return; }
    const ms = session ? session.remaining(timeoutMs) : timeoutMs;
    timer = setTimeout(() => die(Object.assign(new Error(`git cat-file --batch: no answer within ${ms} ms`), { killed: true, signal: "SIGKILL", timedOut: true, stderr: Buffer.from(stderr) })), ms);
  };
  const die = (error) => {
    if (dead) return;
    dead = error; reader.dead = true;
    clearTimeout(timer); timer = null;
    killChild(child);
    while (queue.length) queue.shift().reject(error);
    idle();
  };
  const take = (n) => {
    const out = Buffer.allocUnsafe(n);
    let off = 0;
    while (off < n) {
      const c = chunks[0], k = Math.min(c.length, n - off);
      c.copy(out, off, 0, k); off += k;
      if (k === c.length) chunks.shift(); else chunks[0] = c.subarray(k);
    }
    length -= n;
    return out;
  };
  const drop = (n) => {
    length -= n;
    while (n > 0) { const c = chunks[0]; if (c.length <= n) { n -= c.length; chunks.shift(); } else { chunks[0] = c.subarray(n); n = 0; } }
  };
  const lineEnd = () => { let off = 0; for (const c of chunks) { const i = c.indexOf(10); if (i >= 0) return off + i; off += c.length; } return -1; };
  const pump = () => {
    for (;;) {
      if (skip > 0) { const n = Math.min(skip, length); drop(n); skip -= n; if (skip > 0) return; }
      if (!length) return;
      const head = queue[0];
      if (!head) { die(Object.assign(new Error("git cat-file --batch: unexpected output"), { stderr: Buffer.from(stderr) })); return; }
      if (head.size === undefined) {
        const nl = lineEnd();
        if (nl < 0) { if (length > 4096) die(Object.assign(new Error("git cat-file --batch: malformed header"), { stderr: Buffer.from(stderr) })); return; }
        const line = take(nl + 1).toString("utf8").slice(0, -1);
        const [name, type, sizeText, ...rest] = line.split(" ");
        if (type === "missing" || type === undefined) { die(Object.assign(new Error(line), { code: 128, stderr: Buffer.from(`fatal: Not a valid object name ${name}\n`), missing: type === "missing" })); return; }
        const size = Number(sizeText);
        if (rest.length || !Number.isSafeInteger(size) || size < 0) { die(Object.assign(new Error(`git cat-file --batch: malformed header ${JSON.stringify(line)}`), { stderr: Buffer.from(stderr) })); return; }
        if (type !== "blob") { queue.shift().reject(Object.assign(new Error(`${name} is a ${type}`), { code: 128, stderr: Buffer.from(`fatal: git cat-file ${name}: bad file\n`) })); skip = size + 1; arm(); continue; }
        if (size > head.budget) { queue.shift().reject(Object.assign(new Error(`${name} is ${size} bytes`), { oversize: size })); skip = size + 1; arm(); continue; }
        head.size = size;
      }
      if (length < head.size + 1) return;
      const body = take(head.size);
      drop(1); // the LF after every body
      queue.shift().resolve(body);
      arm();
    }
  };
  child.stdout.on("data", (chunk) => { chunks.push(chunk); length += chunk.length; pump(); });
  child.stderr.on("data", (chunk) => { if (stderr.length < 65536) stderr += chunk.toString("utf8"); });
  child.stdin.on("error", () => { /* EPIPE after the child died: 'close' reports it */ });
  child.on("error", (error) => { die(error); exited(); });            // ENOENT and friends: never a hang
  child.on("close", (code, signal) => { die(Object.assign(new Error(`git cat-file --batch exited (${signal ?? code})`), { code, signal, stderr: Buffer.from(stderr) })); exited(); });
  idle();
  const reader = {
    dead: false,
    read(oid, budget) {
      if (dead) return Promise.reject(dead);
      return new Promise((resolvePromise, reject) => {
        queue.push({ resolve: resolvePromise, reject, budget });
        busy();
        if (queue.length === 1) arm();
        child.stdin.write(`${oid}\n`);
      });
    },
    /** End stdin; wait (bounded) for the child to go; kill it if it lingers. */
    async close() {
      reader.dead = true; // never handed out again; git still answers what it was already asked
      if (!dead) { try { child.stdin.end(); } catch { /* already closed */ } }
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
      const t = setTimeout(() => killChild(child), 2000);
      await exitedPromise;
      clearTimeout(t);
    },
    /** End it now (process exit, eviction): dead at once, so nothing is ever queued on it again. */
    kill() { try { child.stdin.destroy(); } catch { /* nothing */ } die(Object.assign(new Error("git cat-file --batch was ended"), { stderr: Buffer.from(stderr) })); },
  };
  return reader;
}

/** The session's batch reader for this cache repo (least recently used idle ones closed beyond BATCH_LIMIT);
 *  null without a session, after close(), or with an injected exec (tests keep per-blob reads). */
function catFileBatch(repo) {
  const session = repo.session;
  if (!session || session.closed || repo.exec !== runGit) return null;
  let reader = session.batches.get(repo.dir);
  if (reader && !reader.dead) { session.batches.delete(repo.dir); session.batches.set(repo.dir, reader); return reader; }
  if (session.expired()) return null; // a per-blob read, which ends as the deadline's timeout (sessionExec)
  reader = openBatch(repo.dir, session.batchTimeoutMs, session);
  session.batches.set(repo.dir, reader);
  if (session.batches.size > BATCH_LIMIT) {
    for (const [dir, other] of session.batches) {
      if (session.batches.size <= BATCH_LIMIT) break;
      if (other === reader) continue;
      session.batches.delete(dir);
      session.retiring.add(other); // git answers what it was already asked, then ends on EOF
      other.close().finally(() => session.retiring.delete(other));
    }
  }
  return reader;
}

/**
 * → { bytes, size } | E_REMOTE_UNREADABLE | E_REMOTE_PATH_MISSING { path } | E_REMOTE_FILE_OVERSIZE { path, size, budget }
 * A symlink at <path> is refused (E_REMOTE_TREE_UNSAFE { path, why: "symlink" }); a directory → E_REMOTE_PATH_MISSING.
 */
export async function readRemoteFile(refText, commitArg, path, options = {}) {
  const ref = parseRepoRef(refText, options);
  requireCommit(commitArg);
  const rel = normalizeTreePath(path, { allowRoot: false });
  const { repo, commit } = await ensureCommit(ref, commitArg, options);
  const entry = await entryAt(repo, commit, rel, ref);
  if (!entry || entry.type !== "blob") throw fail("E_REMOTE_PATH_MISSING", `${rel} is not a file in ${ref.key}@${commit.slice(0, 12)}`, { path: rel, key: ref.key, commit });
  if (entry.mode === "120000") throw fail("E_REMOTE_TREE_UNSAFE", `${rel} is a symlink`, { path: rel, why: "symlink", key: ref.key, commit });
  const oversize = (size) => fail("E_REMOTE_FILE_OVERSIZE", `${rel} is ${size} bytes (budget ${FILE_BUDGET})`, { path: rel, size, budget: FILE_BUDGET, key: ref.key, commit });
  await ensureBlobs(repo, ref, commit, [entry]);
  if (entry.size > FILE_BUDGET) throw oversize(entry.size);
  const batch = catFileBatch(repo);
  if (batch) {
    let bytes;
    try { bytes = await batch.read(entry.oid, FILE_BUDGET); }
    catch (error) {
      if (error?.oversize !== undefined) throw oversize(error.oversize);
      throw unreadable(ref, error, { commit, path: rel });
    }
    return { bytes, size: bytes.length };
  }
  let out;
  try { out = await repo.local(["cat-file", "blob", entry.oid], { maxBuffer: FILE_BUDGET + 1024 }); }
  catch (error) { throw unreadable(ref, error, { commit, path: rel }); }
  return { bytes: out.stdout, size: out.stdout.length };
}

/** The Git tree object ids of `dirs` at `commit`, in one listing (feature desktop-facts: a member capability's
 *  fingerprint — content-addressed, so the same bytes give the same id; NOT the sha256 content digest a
 *  materialized module records). → Map dir → oid, null for a dir that is not a directory there. */
export async function remoteTreeOids(refText, commitArg, dirs, options = {}) {
  const ref = parseRepoRef(refText, options);
  requireCommit(commitArg);
  const rels = dirs.map((dir) => normalizeTreePath(dir, { allowRoot: false }));
  // Pure at the commit: a session keeps the answer in the parsed cache (as [dir, oid] pairs).
  const pairs = await memoAtCommit(ref, commitArg, `tree-oids\0${rels.join("\0")}`, async () => {
    const { repo, commit } = await ensureCommit(ref, commitArg, options);
    // One listing of nested paths (`a` beside `a/b`) recurses into `a` and never shows it: only the
    // per-path listing reproduces that, so nested requests keep it.
    const requested = new Set(rels);
    const nested = rels.some((rel) => rel.split("/").slice(0, -1).some((_, i, parts) => requested.has(parts.slice(0, i + 1).join("/"))));
    const index = rels.length && !nested ? await treeIndex(repo, commit, ref) : null;
    if (index) return rels.map((rel) => { const i = index.pos.get(rel); return i !== undefined && index.list[i].type === "tree" ? index.list[i].oid : null; });
    const entries = rels.length ? (await lsTree(repo, commit, { path: rels, ref, commit })) ?? [] : [];
    return rels.map((rel) => entries.find((e) => e.path === rel && e.type === "tree")?.oid ?? null);
  }, options);
  return new Map(dirs.map((dir, i) => [dir, pairs[i]]));
}

/** A browsable URL of a repo at a commit (feature desktop-facts): the file's page with `path`, else the tree.
 *  Only GitHub keys have one; any other host or a local repo → null. */
export function browseUrl(key, commit, path = null) {
  if (typeof key !== "string" || !/^github\.com\/[^/]+\/[^/]+$/.test(key) || typeof commit !== "string" || !commit) return null;
  const clean = typeof path === "string" && path ? path.split("/").filter(Boolean).map(encodeURIComponent).join("/") : null;
  return clean ? `https://${key}/blob/${commit}/${clean}` : `https://${key}/tree/${commit}`;
}

/**
 * → [{ path, type: "blob"|"tree"|"symlink" }] relative to <dir>, depth-bounded (depth 1 = direct children).
 * A listing never needs a blob, so it never fetches one (and so carries no sizes).
 * Missing dir → []. Symlinks are reported as type "symlink" so callers can skip them.
 */
export async function listRemoteTree(refText, commitArg, dir, { depth = 2, ...options } = {}) {
  const ref = parseRepoRef(refText, options);
  requireCommit(commitArg);
  if (!Number.isInteger(depth) || depth < 1) throw fail("E_REPO_REF", "depth must be a positive integer", { depth });
  const rel = normalizeTreePath(dir, { allowRoot: true });
  const { repo, commit } = await ensureCommit(ref, commitArg, options);
  const spec = rel ? `${commit}:${rel}` : commit;
  if (rel) {
    const entry = await entryAt(repo, commit, rel, ref);
    if (!entry || entry.type !== "tree") return [];
  }
  const index = await treeIndex(repo, commit, ref);
  const entries = index ? indexDescendants(index, rel) : await lsTree(repo, spec, { flags: ["-r", "-t"], ref, commit });
  if (!entries) return [];
  const result = [];
  for (const e of entries) {
    // Depth first, THEN the name check (L3): a hostile or merely odd name BELOW the
    // requested depth is not part of this listing and must not blank it; a bad name AT
    // a kept depth is still refused.
    if (e.path.split("/").length > depth) continue;
    assertSafeEntryPath(e.path, ref, commit, rel ? `${rel}/${e.path}` : e.path);
    if (e.type === "commit") continue; // submodule gitlinks are not part of the observable tree
    const type = e.mode === "120000" ? "symlink" : e.type;
    result.push({ path: e.path, type });
  }
  result.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return result;
}

/**
 * → { files: [{ path, size }], total } for the regular files (blobs) under <dir> at <commit>, recursively,
 * relative to <dir>, sorted by path in codepoint order (feature capability-show): `total` of them in all, and
 * `files` the first `limit` (every one without a limit). Symlinks and gitlinks are omitted; a name that could
 * escape a checkout ANYWHERE below <dir> is refused (E_REMOTE_TREE_UNSAFE, as listRemoteTree), past the limit
 * too. One listing (the session's tree index when it has one); the sizes a partial cache lacks are learned with
 * ONE ensureBlobs call over the listed files only, so nothing past the limit is fetched. A missing dir, or one
 * that is not a directory → { files: [], total: 0 }. Memoized at the commit (memoAtCommit), per limit.
 */
export async function listRemoteFiles(refText, commitArg, dir, { limit, ...options } = {}) {
  const ref = parseRepoRef(refText, options);
  requireCommit(commitArg);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) throw fail("E_REPO_REF", "limit must be a non-negative integer", { limit });
  const rel = normalizeTreePath(dir, { allowRoot: true });
  const none = { files: [], total: 0 };
  return memoAtCommit(ref, commitArg, `files\0${rel}\0${limit ?? "all"}`, async () => {
    const { repo, commit } = await ensureCommit(ref, commitArg, options);
    if (rel) {
      const entry = await entryAt(repo, commit, rel, ref);
      if (!entry || entry.type !== "tree") return none;
    }
    const index = await treeIndex(repo, commit, ref);
    const entries = index ? indexDescendants(index, rel) : await lsTree(repo, rel ? `${commit}:${rel}` : commit, { flags: ["-r"], ref, commit });
    if (!entries) return none;
    const blobs = [];
    for (const e of entries) {
      assertSafeEntryPath(e.path, ref, commit, rel ? `${rel}/${e.path}` : e.path);
      if (e.type === "blob" && e.mode !== "120000") blobs.push({ ...e });
    }
    blobs.sort(byPath);
    const listed = limit === undefined ? blobs : blobs.slice(0, limit);
    await ensureBlobs(repo, ref, commit, listed);
    return { files: listed.map((e) => ({ path: e.path, size: e.size })), total: blobs.length };
  }, options);
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
/**
 * The ONE symlink an OATS tree may carry (decision 13): a `CLAUDE.md` whose target
 * is `AGENTS.md` beside it — the Claude-harness alias of the canonical
 * instructions. Souls carry it at their root; a capability's agents/<name>/ dirs
 * carry it too. Anything else stays refused. The rule is on the PATH (any depth,
 * basename CLAUDE.md); fetchRemoteTree still enforces the target constraint
 * (relative, non-escaping) and contentDigest digests it as `symlink:<target>`.
 */
export const OATS_ALIAS_SYMLINK = (relPath) => typeof relPath === "string" && (relPath === "CLAUDE.md" || relPath.endsWith("/CLAUDE.md"));

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
export async function fetchRemoteTree(refText, commitArg, dir, destDir, options = {}) {
  const ref = parseRepoRef(refText, options);
  requireCommit(commitArg);
  const rel = normalizeTreePath(dir, { allowRoot: true });
  if (typeof destDir !== "string" || !isAbsolute(destDir)) throw fail("E_REPO_REF", "destDir must be an absolute path", { destDir });
  const dest = resolve(destDir);
  let destStat = null;
  try { destStat = lstatSync(dest); } catch {}
  if (destStat) throw fail("E_REMOTE_TREE_UNSAFE", `${dest} already exists${destStat.isSymbolicLink() ? " (a symlink)" : ""}`, { path: dest, why: "exists" });
  const { repo, commit } = await ensureCommit(ref, commitArg, options);
  const spec = rel ? `${commit}:${rel}` : commit;
  if (rel) {
    const entry = await entryAt(repo, commit, rel, ref);
    if (!entry || entry.type !== "tree") throw fail("E_REMOTE_PATH_MISSING", `${rel} is not a directory in ${ref.key}@${commit.slice(0, 12)}`, { path: rel, key: ref.key, commit });
  }
  const entries = await lsTree(repo, spec, { flags: ["-r", "-t"], ref, commit });
  if (!entries) throw fail("E_REMOTE_PATH_MISSING", `${rel || "."} is missing in ${ref.key}@${commit.slice(0, 12)}`, { path: rel, key: ref.key, commit });
  // Inspect everything BEFORE writing anything: names, modes, types, collisions, then (once the blobs
  // are present) sizes.
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
    blobs.push(e);
  }
  assertNoCollisions(entries, ref, commit, rel);
  // Every blob of the subtree (files and link targets) in ONE fetch, then the budget on their real sizes.
  await ensureBlobs(repo, ref, commit, [...blobs, ...links]);
  let total = 0;
  for (const b of blobs) {
    total += b.size;
    if (total > TREE_BUDGET) throw fail("E_REMOTE_TREE_UNSAFE", `${rel || "."} exceeds ${TREE_BUDGET} bytes`, { path: rel || ".", why: "oversize", size: total, budget: TREE_BUDGET, key: ref.key, commit });
  }
  blobs.sort(byPath);
  mkdirSync(dirname(dest), { recursive: true });
  const staging = join(dirname(dest), `.${dest.split(sep).pop()}.oats-staging-${process.pid}-${Date.now().toString(36)}`);
  try {
    mkdirSync(staging, { mode: 0o755 });
    for (const t of trees) mkdirSync(join(staging, ...t.path.split("/")), { recursive: true, mode: 0o755 });
    // One canonical pass over blobs AND links in byte order of path: contentDigest
    // walks the written tree in the same order, so the two digests agree whatever
    // the git tree listed first.
    const items = [...blobs.map((b) => ({ kind: "blob", e: b })), ...links.map((l) => ({ kind: "link", e: l }))].sort((a, b) => byPath(a.e, b.e));
    const d = createDigest();
    // Blob bytes (all present now: ensureBlobs above): through the session's `cat-file --batch` reader when
    // there is one (no process per blob), else one `cat-file blob` each. A reader opened before ensureBlobs
    // fetched a blob still finds it (git re-reads its packs on a miss); one still missing answers `missing`
    // (GIT_NO_LAZY_FETCH), never a fetch. A batch read may take what is left of TREE_BUDGET, never
    // FILE_BUDGET (a single blob over 4 MiB still copies); a symlink target keeps its 64 KiB cap. A blob the
    // reader answers `missing`, or over its budget, is read once more alone: that read's error is this path's
    // error without a session, classified as it always was (the reader's own words are not git's). Any other
    // failure, the reader dying or its session closing included, is E_REMOTE_UNREADABLE, as a per-blob read's is.
    const LINK_BUDGET = 64 * 1024;
    let read = 0;
    const readBlob = async (oid, path, budget, maxBuffer) => {
      const batch = catFileBatch(repo);
      try {
        if (batch) {
          try { return await batch.read(oid, budget); }
          catch (error) { if (error?.oversize === undefined && error?.missing !== true) throw error; }
        }
        return (await repo.local(["cat-file", "blob", oid], { maxBuffer })).stdout;
      } catch (error) { throw unreadable(ref, error, { commit, path }); }
    };
    for (const { kind, e } of items) {
      if (kind === "blob") {
        const b = e;
        const bytes = await readBlob(b.oid, b.path, TREE_BUDGET - read, TREE_BUDGET + 1024);
        read += bytes.length;
        const mode = b.mode === "100755" ? 0o755 : 0o644;
        const target = join(staging, ...b.path.split("/"));
        mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
        const fd = openSync(target, "wx", mode);
        try { writeSync(fd, bytes); } finally { closeSync(fd); }
        d.add(b.path, mode, bytes);
        continue;
      }
      const l = e;
      const linkTarget = (await readBlob(l.oid, l.path, LINK_BUDGET, LINK_BUDGET)).toString("utf8").trim();
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
