// The one implementation of the hand-started test runs on a hosted runner: macOS
// (.github/workflows/macos-tests.yml, scripts/macos-tests.mjs) and Linux
// (.github/workflows/linux-tests.yml, scripts/linux-tests.mjs), both owned by
// docs/named-test-runs.md. It runs named test files of a named ref, each alone, and prints what
// a reader of the run needs beside GitHub's own record of it. Each runner's script is a small
// platform object and a command line:
//
//   node scripts/<runner>-tests.mjs prepare <tree>   validate the request, print the header,
//                                                     put the commit in <tree>
//   node scripts/<runner>-tests.mjs run <tree>       validate again, run each file, print the table
//
// A platform is { title, script, request: { ref, files }, fileTimeoutMs, readFacts({ env, step }),
// headerLines(facts), summary(facts), refusal(facts)? }: the header's title, the command line's path,
// the names of the request's two environment variables, the time one file gets on that runner, the
// facts and lines only that runner has, and, when the runner can be unfit to run tests (Linux: its
// user manager did not answer), why. The time a file gets, and the job's timeout that holds it, are
// each runner's constants; the number of files a run takes is this file's.
//
// The request is two environment variables, <RUNNER>_TESTS_REF and <RUNNER>_TESTS_FILES. They
// are a person's text and are treated as such:
//
//   * Neither is ever part of a shell line: every child is started with an argument array.
//   * The ref's text is never an argument of git either. The script lists the branches and
//     tags the checkout fetched from origin and looks the name up in that list; git is only
//     given object ids that git printed, or 40 hexadecimal characters.
//   * A file is checked against a plain pattern, then against the commit's own tree
//     (`git ls-tree`), before anything of the ref is checked out.
//
// Two trees. The workflow checks out its own commit and runs its script from it; the ref
// under test goes to <tree>, a second directory (`git worktree add --detach`). A ref that
// predates the workflow has no script, and the code that validates and decides is the
// workflow's, not the tested branch's. Nothing is installed in the scripts' tree, so this file
// and the runners' scripts import node's built-in modules only: not the kernel (`lib/`), not a
// package.
//
// What is protected, and what is not. All of it holds for a run whose workflow commit is the
// default branch's: started from another branch, the workflow and these scripts are that
// branch's, and so is every line they print, the header's `workflow ref` included. Where a
// run ran from is read in GitHub's record of the run, never in its log.
//
// `prepare` runs before any code of the ref does: the validation and its header are printed
// by a runner nothing of the ref has touched. From the first install step on, the ref's code
// runs as the runner's own user, and nothing printed after that is out of its reach, the
// per-file results and the table included. `run` validates again rather than trust a value
// carried between steps, which guards against an accident and not against a commit that sets
// out to forge its result. The two trees are no boundary either: they let a ref older than
// the workflow be tested, and keep an honest branch from changing the runner by accident
// (docs/named-test-runs.md).

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, appendFileSync, constants, existsSync, lstatSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { devNull, machine, release, type } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

// ---- the bounds: constants, never inputs ---------------------------------------------------------
// The time one file gets, and the job's timeout, are each runner's (FILE_TIMEOUT_MS and
// JOB_TIMEOUT_MINUTES of scripts/macos-tests.mjs and scripts/linux-tests.mjs).

/** Files one run takes, on either runner. */
export const MAX_FILES = 10;
/** What a file's output pipes get to close after it ended, and again after its group was killed. */
export const KILL_GRACE_MS = 2_000;
/** How often, and how many times, a group that still has a member when its file ended is looked at
 *  again before that member counts as left behind. */
const SETTLE_PROBE_MS = 50, SETTLE_PROBES = 5;

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// ---- text of unknown content ---------------------------------------------------------------------

const SHOWN = 200;
/** A value of unknown content for one log line: quoted, every character outside printable ASCII
 *  escaped, cut at 200 characters. */
export function show(text) {
  const s = String(text);
  const quoted = JSON.stringify(s.slice(0, SHOWN)).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return s.length > SHOWN ? `${quoted} (cut: ${s.length} characters)` : quoted;
}
/** Text for the step summary's HTML: `&`, `<` and `>` escaped. */
export const html = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- the list of files ---------------------------------------------------------------------------

/** The file list as entries → { files, repeated }. Commas, spaces, tabs and newlines separate, in
 *  any mix; a leading or trailing separator names nothing. A file named twice is listed once (in
 *  `repeated` too, for the note). */
export function parseFileList(text) {
  const files = [], repeated = [];
  for (const entry of String(text ?? "").split(/[\s,]+/).filter(Boolean)) {
    if (!files.includes(entry)) files.push(entry);
    else if (!repeated.includes(entry)) repeated.push(entry);
  }
  return { files, repeated };
}

const SEGMENT = /^[A-Za-z0-9._-]+$/;
// Why an entry is not the path of a test file → a reason, or null. The pattern is
// `test/**/*.test.mjs` or `packages/<name>/test/**/*.test.mjs`, written over plain segments:
// nothing in an accepted entry is a glob, an option or a pathspec's magic.
export function fileShapeRefusal(entry) {
  const segments = String(entry).split("/");
  if (segments.includes("..")) return "has a `..` segment";
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) return "has a segment that is empty or has a character outside A-Z a-z 0-9 . _ -";
    if (segment.startsWith(".")) return "has a segment that starts with a dot";
  }
  const under = segments[0] === "test" ? segments.slice(1) : segments[0] === "packages" && segments[2] === "test" ? segments.slice(3) : null;
  const name = segments.at(-1);
  if (!under?.length || !name.endsWith(".test.mjs")) return "does not match test/**/*.test.mjs or packages/<name>/test/**/*.test.mjs";
  return null;
}

/** Why a list of distinct files is not one run's → a reason, or null. */
export function boundsRefusal(files) {
  if (!files.length) return "no test file was named";
  if (files.length > MAX_FILES) return `${files.length} files were named; one run takes at most ${MAX_FILES}`;
  return null;
}

// ---- the ref -------------------------------------------------------------------------------------

const COMMIT_ID = /^[0-9a-f]{40}$/i;
const REF_MAX = 255;
const NO_PULL_REQUEST = "a pull request is not accepted (a fork's head is not this repository's commit): name a branch or a tag of this repository, or give a commit's full id";
/** Why a ref's text is not a branch name, a tag name or a full commit id of a plain shape → a
 *  reason, or null. An allow-list: a branch whose name has another character is asked for by its
 *  commit id. */
export function refShapeRefusal(asked) {
  if (asked === "") return "no ref was given";
  if (/^#\d+$/.test(asked)) return NO_PULL_REQUEST;
  if (asked.length > REF_MAX) return `is longer than ${REF_MAX} characters`;
  if (/[\s\x00-\x1f\x7f]/.test(asked)) return "has white space or a control character";
  if (asked.startsWith("-")) return "starts with `-`";
  if (asked.includes("..")) return "has `..`";
  if (!/^[A-Za-z0-9._/-]+$/.test(asked)) return "has a character outside A-Z a-z 0-9 . _ / -: give the commit's full id (40 characters) instead";
  return null;
}

/** What a name with no branch, tag or commit behind it probably was → the refusal's reason. */
export function unknownRefReason(asked) {
  // Only once nothing of that name was found: a branch may be named `2026`, or `pull/7/head`.
  if (/^\d+$/.test(asked) || /^(refs\/)?pull\//.test(asked)) return `is no branch or tag, and ${NO_PULL_REQUEST}`;
  if (/^[0-9a-f]{4,39}$/i.test(asked)) return "is no branch or tag; if it is a shortened commit id, give all 40 characters";
  if (asked.startsWith("refs/")) return "is no branch or tag: give the short name (`main`, not `refs/heads/main`)";
  if (asked.startsWith("origin/")) return "is no branch or tag: give the branch's name without `origin/`";
  return "is no branch or tag that was fetched from origin";
}

/** What `asked` may name among the refs fetched from origin → [{ kind, object }], `kind` one of
 *  "branch", "tag", "commit id". Exact names only: nothing here is a pattern or a revision
 *  expression. */
export function refCandidates(asked, refs) {
  const found = [];
  if (refs.branches.has(asked)) found.push({ kind: "branch", object: refs.branches.get(asked) });
  if (refs.tags.has(asked)) found.push({ kind: "tag", object: refs.tags.get(asked) });
  if (COMMIT_ID.test(asked)) found.push({ kind: "commit id", object: asked.toLowerCase() });
  return found;
}

/** The one commit a ref names, from its candidates once looked up ([{ kind, commit }] or
 *  [{ kind, why }]) → { ok, commit, kinds } or { ok: false, why }. Every reading of the name must
 *  hold, and all must be the same commit: a name that is a branch and a tag of two commits is refused. */
export function chooseCommit(asked, looked) {
  if (!looked.length) return { ok: false, why: unknownRefReason(asked) };
  const failed = looked.filter((c) => !c.commit);
  if (failed.length) return { ok: false, why: failed.map((c) => (looked.length > 1 ? `as a ${c.kind}, ${c.why}` : c.why)).join("; ") };
  const commits = [...new Set(looked.map((c) => c.commit))];
  if (commits.length > 1) return { ok: false, why: `names more than one commit (${looked.map((c) => `the ${c.kind} is ${c.commit}`).join(", ")}): give the full id of the one you mean` };
  return { ok: true, commit: commits[0], kinds: looked.map((c) => c.kind) };
}

// ---- git: argument arrays, a fixed environment ---------------------------------------------------

/** git's environment: nothing a caller's GIT_* variable or a host's configuration could turn, no
 *  prompt, no fetch of its own. With no system or user configuration no filter is defined, so
 *  checking the commit out runs no program on its files. */
function gitEnv(env) {
  const kept = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("GIT_")));
  return { ...kept, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: "0", GIT_LITERAL_PATHSPECS: "1", GIT_NO_LAZY_FETCH: "1" };
}
/** Run git in `dir` → { ok, out, err }. Never a shell. */
function git(dir, args, env) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: gitEnv(env), timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0 && !r.error, out: String(r.stdout ?? ""), err: String(r.stderr ?? "").trim() || r.error?.message || "" };
}

/** The branches and tags the checkout fetched from origin → { branches, tags }, each a Map of a
 *  short name to an object id. A symbolic ref (`origin/HEAD`) is no branch. */
export function readRefs(repo, env = process.env) {
  const r = git(repo, ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", "refs/remotes/origin", "refs/tags"], env);
  if (!r.ok) throw new Error(`the refs fetched from origin could not be listed: ${r.err}`);
  const branches = new Map(), tags = new Map();
  for (const line of r.out.split("\n").filter(Boolean)) {
    const [name, object, symref] = line.split("\0");
    if (symref) continue;
    if (name.startsWith("refs/remotes/origin/")) branches.set(name.slice("refs/remotes/origin/".length), object);
    else if (name.startsWith("refs/tags/")) tags.set(name.slice("refs/tags/".length), object);
  }
  return { branches, tags };
}

/** Look one candidate up → { kind, commit } or { kind, why }. A branch or a tag is peeled to its
 *  commit. A commit id must be a commit the checkout has, reachable from a branch or a tag fetched
 *  from origin: nothing is fetched for it, so a commit of a fork is never there. */
function lookUp({ kind, object }, repo, env) {
  if (kind !== "commit id") {
    const peeled = git(repo, ["rev-parse", "--verify", "--quiet", `${object}^{commit}`], env);
    return peeled.ok ? { kind, commit: peeled.out.trim() } : { kind, why: "does not point at a commit" };
  }
  const type = git(repo, ["cat-file", "-t", object], env);
  if (!type.ok) return { kind, why: "is no commit of what was fetched from origin (a commit on no branch or tag, or a fork's, is not accepted)" };
  if (type.out.trim() !== "commit") return { kind, why: `is a ${type.out.trim()}, not a commit` };
  const holder = git(repo, ["for-each-ref", "--count=1", "--contains", object, "--format=%(refname)", "refs/remotes/origin", "refs/tags"], env);
  if (!holder.ok || !holder.out.trim()) return { kind, why: "is on no branch or tag that was fetched from origin" };
  return { kind, commit: object };
}

/** The commit a ref's text names in the checkout at `repo` → { ok, asked, commit, kinds } or
 *  { ok: false, asked, why }. */
export function resolveRef(text, repo, env = process.env) {
  // As it was typed: white space around a name is refused like any other, and the header shows
  // the text that was asked for, not a tidied one.
  const asked = String(text ?? "");
  const shape = refShapeRefusal(asked);
  if (shape) return { ok: false, asked, why: shape };
  return { asked, ...chooseCommit(asked, refCandidates(asked, readRefs(repo, env)).map((c) => lookUp(c, repo, env))) };
}

/** Why a path is not a regular file of a commit, from its `git ls-tree` entry → a reason, or null. */
export function treeEntryRefusal(entry) {
  if (!entry) return "is not a file at that commit";
  if (entry.mode === "120000") return "is a symbolic link at that commit";
  if (entry.type !== "blob") return `is a ${entry.type === "tree" ? "directory" : "submodule"} at that commit, not a file`;
  return null;
}
/** The entries of `files` in a commit's tree → Map of a path to { mode, type }. A path under a
 *  symbolic link, or one that is not there, has no entry. */
function treeEntries(repo, commit, files, env) {
  const r = git(repo, ["ls-tree", "-z", "--full-tree", commit, "--", ...files], env);
  if (!r.ok) throw new Error(`the tree of ${commit} could not be read: ${r.err}`);
  const entries = new Map();
  for (const record of r.out.split("\0").filter(Boolean)) {
    const [meta, path] = record.split("\t");
    const [mode, type] = meta.split(" ");
    entries.set(path, { mode, type });
  }
  return entries;
}

/** Validate a whole request against the checkout at `repo`, touching nothing →
 *  { ok, asked, commit, kinds, files, repeated } or { ok: false, refusals: [{ entry, why }] }.
 *  Every refused entry is named, not only the first. */
export function validateRequest({ ref, files: list }, repo, env = process.env) {
  const refusals = [];
  const resolved = resolveRef(ref, repo, env);
  if (!resolved.ok) refusals.push({ entry: `ref ${show(resolved.asked)}`, why: resolved.why });
  const { files, repeated } = parseFileList(list);
  const bounds = boundsRefusal(files);
  if (bounds) refusals.push({ entry: "the list of files", why: bounds });
  const shaped = [];
  for (const file of files) {
    const why = fileShapeRefusal(file);
    if (why) refusals.push({ entry: `file ${show(file)}`, why });
    else shaped.push(file);
  }
  if (resolved.ok && shaped.length) {
    const entries = treeEntries(repo, resolved.commit, shaped, env);
    for (const file of shaped) {
      const why = treeEntryRefusal(entries.get(file));
      if (why) refusals.push({ entry: `file ${show(file)}`, why: `${why} (${resolved.commit})` });
    }
  }
  if (refusals.length) return { ok: false, refusals };
  return { ok: true, asked: resolved.asked, commit: resolved.commit, kinds: resolved.kinds, files, repeated };
}

// ---- a file's counts -----------------------------------------------------------------------------

const SUMMARY_KEYS = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo", "duration_ms"];
const SUMMARY_LINE = /^(?:ℹ|#) ([a-z_]+) (\d+(?:\.\d+)?)$/;
const SUMMARY_LINE_MAX = 256;
const ANSI = /\x1b\[[0-9;]*m/g;
/** A reader of `node --test`'s summary from its output as it streams → { push(chunk), end() }.
 *  `end()` is { tests, pass, fail, cancelled, skipped, todo }, or null when no summary was printed.
 *  The summary is the last whole block of the runner's eight lines, each starting its line (`ℹ tests 3`
 *  from the spec reporter, `# tests 3` from TAP, which Node 22 prints to a pipe). A test's own
 *  output may hold such lines (a nested run's, shown in a failure): those are indented, or come
 *  before the runner's block. This reads counts to report; the verdict is the exit status. */
export function countsReader() {
  const decoder = new StringDecoder("utf8");
  let rest = "", overlong = false, at = 0, block = {}, last = null;
  const line = (text) => {
    const m = SUMMARY_LINE.exec(text.replace(ANSI, "").replace(/\r$/, ""));
    if (m && m[1] === SUMMARY_KEYS[0]) { at = 0; block = {}; }
    if (!m || m[1] !== SUMMARY_KEYS[at]) { at = 0; return; }
    block[m[1]] = Number(m[2]);
    if (++at === SUMMARY_KEYS.length) { last = block; at = 0; }
  };
  const take = (text) => {
    const lines = (rest + text).split("\n");
    rest = lines.pop();
    for (const [i, l] of lines.entries()) { if (overlong && i === 0) { overlong = false; at = 0; } else line(l); }
    // A line this long is not a summary line: do not keep it whole while it has no end.
    if (rest.length > SUMMARY_LINE_MAX) { rest = ""; overlong = true; }
  };
  return {
    push(chunk) { take(typeof chunk === "string" ? chunk : decoder.write(chunk)); },
    end() {
      take(`${decoder.end()}\n`);
      if (!last) return null;
      const { tests, pass, fail, cancelled, skipped, todo } = last;
      return { tests, pass, fail, cancelled, skipped, todo };
    },
  };
}
/** The counts in a whole output → as countsReader's end(). */
export function readCounts(text) {
  const reader = countsReader();
  reader.push(text);
  return reader.end();
}

// ---- running one file ----------------------------------------------------------------------------

/** Whether a process group still has a member (ESRCH: none; macOS answers EPERM for one of zombies only). */
function groupAlive(pgid) { try { process.kill(-pgid, 0); return true; } catch { return false; } }
/** SIGKILL a child's whole process group. Only a child that was started has a group of its own: a
 *  failed start has no pid, and `kill(-0)` would address this process's own group. */
function killGroup(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try { process.kill(-pid, "SIGKILL"); } catch { /* the group is gone */ }
}

/** The environment a test file runs in: this process's, as a developer's shell would have it, less
 *  the request (the file has no use for it), the runner's command files (a step's outputs, its
 *  summary and the next steps' environment are the workflow's to write: this keeps a test from
 *  writing them by accident and is no boundary, the files are the same user's) and node's marker of
 *  a nested test run, which would make the file report in the runner's wire format when this
 *  script is itself under test. `requestVars` are the names of the request's two variables. */
export function testEnv(env, requestVars = []) {
  const dropped = new Set([...requestVars, "GITHUB_ENV", "GITHUB_OUTPUT", "GITHUB_PATH", "GITHUB_STATE", "GITHUB_STEP_SUMMARY", "NODE_TEST_CONTEXT"]);
  return Object.fromEntries(Object.entries(env).filter(([key]) => !dropped.has(key)));
}

/** Run one test file alone, as a developer does: `node --test <file>` from `cwd`, in a process
 *  group of its own → Promise of { file, counts, code, signal, timedOut, durationMs, leftover,
 *  error }. Its output goes to `write` as it comes. After `timeoutMs` the whole group is killed. A
 *  file that ended leaves no process of its group behind either (`leftover` says there was one):
 *  the next file runs alone. `timeoutMs` is required: a runner's constant, never a default here, and a
 *  missing one throws rather than kill every file at once. `requestVars` go to testEnv. `command` is
 *  the tests' seam; the command line never passes it. */
export function runFile(file, { cwd, env = process.env, write = (chunk) => process.stdout.write(chunk), timeoutMs, graceMs = KILL_GRACE_MS, requestVars = [], command = [process.execPath, "--test"] } = {}) {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError(`runFile: timeoutMs must be a positive number of milliseconds, got ${String(timeoutMs)}`);
  return new Promise((done) => {
    const started = Date.now(), reader = countsReader();
    const result = { file, counts: null, code: null, signal: null, timedOut: false, durationMs: 0, leftover: false, error: null };
    let child;
    try { child = spawn(command[0], [...command.slice(1), file], { cwd, env: testEnv(env, requestVars), detached: true, stdio: ["ignore", "pipe", "pipe"] }); }
    catch (error) { done({ ...result, error: error.message }); return; }
    let settled = false, closed = false, wait = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(wait);
      child.stdout.destroy(); child.stderr.destroy();
      done({ ...result, counts: reader.end(), durationMs: Date.now() - started });
    };
    const timer = setTimeout(() => {
      result.timedOut = true;
      write(`\n(no end after ${formatDuration(timeoutMs)}: killing the file's process group)\n`);
      killGroup(child.pid);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { reader.push(chunk); write(chunk); });
    child.stderr.on("data", (chunk) => write(chunk));
    child.on("error", (error) => { result.error = error.message; settle(); });
    child.on("close", () => { closed = true; });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      result.code = code; result.signal = signal;
      // The pipes close when their last holder ends: at once, unless a process the file started
      // still holds them. Once they have closed, or after the grace, what is left of the group is
      // ended. A member that is only waiting to be reaped is given a moment first, so that the note
      // about processes left behind is not made for one that had already ended.
      let ended = false, probes = 0;
      const sweep = () => {
        if (groupAlive(child.pid) && !result.timedOut && ++probes <= SETTLE_PROBES) { wait = setTimeout(sweep, SETTLE_PROBE_MS); return; }
        if (groupAlive(child.pid)) { result.leftover = !result.timedOut; killGroup(child.pid); }
        if (closed) settle();
        else { child.once("close", settle); wait = setTimeout(settle, graceMs); }
      };
      const end = () => { if (!ended) { ended = true; clearTimeout(wait); sweep(); } };
      if (closed) end();
      else { child.once("close", end); wait = setTimeout(end, graceMs); }
    });
  });
}

/** A file's verdict from its run → { ok, label, why }. The exit status decides; the counts must
 *  agree with it. `label` is "passed", "FAILED", "TIMED OUT" or "no test passed" (exit 0 and
 *  nothing but skips: not a failure, and not evidence). */
export function verdict(run) {
  const exit = exitText(run);
  if (run.error) return { ok: false, label: "FAILED", why: `it could not be started: ${run.error}` };
  if (run.timedOut) return { ok: false, label: "TIMED OUT", why: `no end after its time: its process group was killed (${exit})` };
  if (run.signal || run.code !== 0) return { ok: false, label: "FAILED", why: run.counts ? `exit ${exit}` : `exit ${exit}, and no summary was printed` };
  if (!run.counts) return { ok: false, label: "FAILED", why: "exit 0, but no summary was printed: nothing says a test ran" };
  if (run.counts.fail > 0 || run.counts.cancelled > 0) return { ok: false, label: "FAILED", why: "exit 0, but its summary counts failed or cancelled tests" };
  if (run.counts.pass === 0) return { ok: true, label: "no test passed", why: "exit 0, and no test passed (skipped, or none): this is not evidence" };
  return { ok: true, label: "passed", why: "exit 0" };
}
const exitText = (run) => run.signal ?? (run.code === null ? "-" : String(run.code));
/** Milliseconds as seconds with one decimal: `12.3s`. */
export function formatDuration(ms) { return `${(ms / 1000).toFixed(1)}s`; }

// ---- tmux's default socket -----------------------------------------------------------------------

/** Where tmux puts the socket of the server named `oats` when nothing isolates it → a path:
 *  `<dir>/tmux-<uid>/oats`, `<dir>` being TMUX_TMPDIR when it is set, else /tmp with its link
 *  resolved (/private/tmp on macOS). A fixture that fails to isolate its tmux server starts one
 *  there. On a clean runner nothing fails because of it, so the run looks for it. */
export function defaultTmuxSocket(env = process.env) {
  let dir = env.TMUX_TMPDIR;
  if (!dir) { try { dir = realpathSync("/tmp"); } catch { dir = "/tmp"; } }
  return join(dir, `tmux-${process.getuid()}`, "oats");
}
/** Whether anything is at that place. Nothing is ever killed or removed there. */
const socketThere = (path) => lstatSync(path, { throwIfNoEntry: false }) !== undefined;
const LEAK_NOTE = "left a tmux server on the default socket";

// ---- the table -----------------------------------------------------------------------------------

const COLUMNS = ["file", "result", "tests", "passed", "failed", "skipped", "cancelled", "todo", "exit", "duration", "note"];
function row(run) {
  const c = run.counts, n = (key) => (c ? String(c[key]) : "-");
  return [run.file, verdict(run).label, n("tests"), n("pass"), n("fail"), n("skipped"), n("cancelled"), n("todo"), exitText(run), formatDuration(run.durationMs), run.leak ? LEAK_NOTE : ""];
}
/** The table of every file's run, as text lines for the log. Counts that are not known are `-`; the
 *  note marks the file after which tmux's default socket first existed. */
export function buildTable(runs) {
  const rows = [COLUMNS, ...runs.map(row)];
  const widths = COLUMNS.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((cell, i) => (i < 2 || i === COLUMNS.length - 1 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ").trimEnd());
}
/** The same table as Markdown, for the step summary. */
export function buildMarkdownTable(runs) {
  const line = (cells) => `| ${cells.map(html).join(" | ")} |`;
  return [line(COLUMNS), `|${COLUMNS.map((_, i) => (i < 2 || i === COLUMNS.length - 1 ? " --- " : " ---: ")).join("|")}|`, ...runs.map((run) => line(row(run)))];
}
/** The run's last lines → { ok, lines }: how many files passed, and whether the run does. A file
 *  that left a tmux server on the default socket fails the run, whatever its own result. */
export function conclude(runs) {
  const verdicts = runs.map(verdict), failed = verdicts.filter((v) => !v.ok).length, empty = verdicts.filter((v) => v.label === "no test passed").length;
  const leaks = runs.filter((run) => run.leak);
  const lines = [`${runs.length} file${runs.length === 1 ? "" : "s"}: ${runs.length - failed} without a failure, ${failed} failed or timed out.`];
  if (empty) lines.push(`${empty} of them passed no test (skipped, or none): a file that only skips is not evidence.`);
  for (const run of leaks) lines.push(`${run.file} ${LEAK_NOTE}: its fixture did not isolate its tmux server, and the run fails for it.`);
  const ok = failed === 0 && leaks.length === 0;
  lines.push(ok ? "Result: passed" : "Result: FAILED");
  return { ok, lines };
}

/** Run each file alone, one after another, and print each one's result → Promise of the runs. A
 *  failing or hung file does not stop the ones after it. With `tmuxSocket` (a path that is not
 *  there yet), the file after which it first exists gets `leak`. */
export async function runFiles(files, { cwd, env = process.env, write = (chunk) => process.stdout.write(chunk), timeoutMs, graceMs = KILL_GRACE_MS, tmuxSocket = null, requestVars = [], command } = {}) {
  const runs = [];
  let watching = tmuxSocket !== null && !socketThere(tmuxSocket);
  for (const [i, file] of files.entries()) {
    write(`\n=== ${i + 1}/${files.length} ${file}: node --test ${file} ===\n`);
    const run = await runFile(file, { cwd, env, write, timeoutMs, graceMs, requestVars, ...(command ? { command } : {}) });
    run.leak = watching && socketThere(tmuxSocket);
    if (run.leak) watching = false;
    runs.push(run);
    const v = verdict(run), c = run.counts;
    const counts = c ? `tests ${c.tests}, passed ${c.pass}, failed ${c.fail}, skipped ${c.skipped}, cancelled ${c.cancelled}, todo ${c.todo}` : "counts unknown";
    write(`\n=== ${file}: ${v.label} (${v.why}); ${counts}; exit ${exitText(run)}; ${formatDuration(run.durationMs)} ===\n`);
    if (run.leftover) write("    (processes it started were still running when it ended: they were killed)\n");
    if (run.leak) write(`    (${LEAK_NOTE}: ${show(tmuxSocket)} exists now and did not before; nothing was killed or removed)\n`);
  }
  return runs;
}

// ---- the header: what the log says of the run ----------------------------------------------------

/** Whether the file system `dir` is on tells names apart by case, measured: create a file, look for
 *  it by another case → "case-sensitive", "case-insensitive", or "unknown (...)". */
export function measureCase(dir) {
  let probe;
  try {
    probe = mkdtempSync(join(dir, ".case-probe-"));
    writeFileSync(join(probe, "probe"), "");
    const made = statSync(join(probe, "probe"));
    try {
      const other = statSync(join(probe, "PROBE"));
      return other.ino === made.ino && other.dev === made.dev ? "case-insensitive" : "unknown (PROBE exists and is another file)";
    } catch (error) { return error.code === "ENOENT" ? "case-sensitive" : `unknown (${error.code})`; }
  } catch (error) { return `unknown (${error.code ?? error.message})`; }
  finally { if (probe) rmSync(probe, { recursive: true, force: true }); }
}

/** What a program prints, trimmed → text, or null when it could not be run or failed. Never a shell. */
export const outputOf = (file, args) => { try { return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 }).trim(); } catch { return null; } };
function onPath(name, env) {
  for (const dir of String(env.PATH ?? "").split(delimiter).filter(isAbsolute)) {
    try { accessSync(join(dir, name), constants.X_OK); if (statSync(join(dir, name)).isFile()) return join(dir, name); } catch { /* next */ }
  }
  return null;
}

/** The facts of the header, read from this host → an object for formatHeader: the runners' common
 *  facts, and the platform's own (`step` is "prepare" or "run"). */
export function readFacts({ request, tree, platform, step, repo = REPO_ROOT, env = process.env }) {
  const tmux = onPath("tmux", env), parent = dirname(tree);
  const sameDevice = existsSync(tree) && statSync(tree).dev === statSync(parent).dev;
  const changed = existsSync(tree) ? git(tree, ["status", "--porcelain", "--untracked-files=no"], env) : null;
  return {
    asked: request.asked, kinds: request.kinds, commit: request.commit, files: request.files, repeated: request.repeated,
    workflowRef: env.GITHUB_WORKFLOW_REF ?? null, workflowSha: env.GITHUB_SHA ?? null,
    scriptCommit: git(repo, ["rev-parse", "--verify", "--quiet", "HEAD"], env).out.trim() || null,
    runUrl: env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    system: `${type()} ${release()}`,
    imageOS: env.ImageOS ?? null, imageVersion: env.ImageVersion ?? null,
    arch: process.arch, machine: machine(),
    node: process.version, nodePath: process.execPath,
    fileSystem: sameDevice ? measureCase(parent) : "unknown (the tree is not there, or not on its parent's file system)",
    tmux: tmux ? { path: tmux, version: outputOf(tmux, ["-V"]) } : null,
    tmuxSocket: { path: defaultTmuxSocket(env), there: socketThere(defaultTmuxSocket(env)) },
    changed: changed?.ok ? changed.out.split("\n").filter(Boolean) : null,
    ...platform.readFacts({ env, step }),
  };
}

const unset = "(not set: not a workflow run)";
/** The header's line for the runner image, which every hosted runner names the same way. */
export const imageLine = (f) => `  runner image:        ImageOS ${f.imageOS ? show(f.imageOS) : "(not set)"}, ImageVersion ${f.imageVersion ? show(f.imageVersion) : "(not set)"}`;
/** The header as text lines: the platform's title and its own lines among the common ones. Every
 *  value that is not this script's own goes through show(). */
export function formatHeader(f, platform) {
  const lines = [
    platform.title,
    `  commit under test:   ${f.commit}`,
    `  ref asked for:       ${show(f.asked)} (${f.kinds.map((k) => (k === "commit id" ? "a commit id" : `a ${k}`)).join(" and ")})`,
    `  workflow ref:        ${f.workflowRef ? show(f.workflowRef) : unset}`,
    `  workflow commit:     ${f.workflowSha ? show(f.workflowSha) : unset}`,
    `  script's commit:     ${f.scriptCommit ?? "unknown"}${f.workflowSha && f.scriptCommit ? (f.scriptCommit === f.workflowSha ? " (the workflow's)" : " (NOT the workflow's commit)") : ""}`,
    `  run:                 ${f.runUrl ? `${show(f.runUrl)}, attempt ${show(f.runAttempt ?? "?")}` : unset}`,
    ...platform.headerLines(f),
    `  architecture:        ${f.arch} (machine ${show(f.machine)})`,
    `  node:                ${f.node} (${show(f.nodePath)})`,
    `  file system:         ${f.fileSystem} (measured beside the tree: a file made, then looked for by another case)`,
    `  tmux on PATH:        ${f.tmux ? `${show(f.tmux.path)}, ${show(f.tmux.version ?? "version unknown")}` : "no"}`,
    `  tmux default socket: ${show(f.tmuxSocket.path)} ${f.tmuxSocket.there ? "EXISTS before the first file: the leak check is skipped for this run" : "is not there (looked for again after each file)"}`,
  ];
  if (f.changed) lines.push(`  tracked files that differ from the commit: ${f.changed.length ? `${f.changed.length} (${f.changed.slice(0, 10).map(show).join(", ")}${f.changed.length > 10 ? ", ..." : ""})` : "none"}`);
  lines.push(`  bounds:              at most ${MAX_FILES} files a run, ${platform.fileTimeoutMs / 60_000} minutes a file`);
  lines.push(`  files (${f.files.length}), each alone, in this order:`);
  for (const file of f.files) lines.push(`    ${file}`);
  for (const file of f.repeated) lines.push(`  (named more than once, runs once: ${file})`);
  return lines;
}

// ---- the two steps -------------------------------------------------------------------------------

const NOTHING_YET = "nothing was checked out, installed or run", NO_FILE = "no file was run";
/** Print a refusal, every entry of it → the exit status. `nothing` says how far the job had come. */
function refuse(refusals, { write, env, platform, nothing = NOTHING_YET }) {
  write(`Refused: ${nothing}.\n`);
  for (const { entry, why } of refusals) write(`  ${entry}: ${why}\n`);
  summarize(env, [`## ${platform.title}: refused`, "", `Refused: ${nothing}.`, "", "<pre>", ...refusals.map(({ entry, why }) => html(`${entry}: ${why}`)), "</pre>", ""]);
  return 2;
}
function summarize(env, lines) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

/** Why the tree is not the validated commit with each file a regular file in it → a reason, or null. */
function treeRefusal(tree, request, env) {
  const head = git(tree, ["rev-parse", "--verify", "--quiet", "HEAD"], env);
  if (!head.ok || head.out.trim() !== request.commit) return `the tree at ${tree} is not at ${request.commit}`;
  const top = git(tree, ["rev-parse", "--show-toplevel"], env);
  if (!top.ok || realpathSync(top.out.trim()) !== realpathSync(tree)) return `${tree} is not the root of a tree of its own`;
  for (const file of request.files) {
    const segments = file.split("/");
    for (const [i] of segments.entries()) {
      const stat = lstatSync(join(tree, ...segments.slice(0, i + 1)), { throwIfNoEntry: false });
      const last = i === segments.length - 1;
      if (!stat || (last ? !stat.isFile() : !stat.isDirectory())) return `${segments.slice(0, i + 1).join("/")} is not a regular ${last ? "file" : "directory"} in the tree that was checked out`;
    }
  }
  return null;
}

// The boundary, said in the log itself. Only the first step's output is out of the ref's reach,
// and that in a run whose workflow commit is the default branch's.
const BEFORE_THE_REF = "Everything above this line was printed before any code of the ref ran.";
const AFTER_THE_INSTALLS = "This header was read again after the ref's install scripts ran, and all that follows is printed while its code runs.\nThe header to rely on is the validation step's, printed before any code of the ref ran: the two should agree.";

const INSTALLED_NOTHING = "nothing was installed or run";
/** The request a step reads: the platform's two environment variables. */
const requestOf = (platform, env) => ({ ref: env[platform.request.ref], files: env[platform.request.files] });

/** Step one: validate the request, put its commit in `tree`, print the header → the exit status. A
 *  runner the platform finds unfit (its `refusal`) is refused after the header, which says why. */
export function prepare({ tree, platform, repo = REPO_ROOT, env = process.env, write = (chunk) => process.stdout.write(chunk) }) {
  const request = validateRequest(requestOf(platform, env), repo, env);
  if (!request.ok) return refuse(request.refusals, { write, env, platform });
  if (existsSync(tree)) return refuse([{ entry: `the tree ${show(tree)}`, why: "is there already" }], { write, env, platform });
  const added = git(repo, ["worktree", "add", "--detach", tree, request.commit], env);
  if (!added.ok) return refuse([{ entry: `commit ${request.commit}`, why: `could not be checked out: ${added.err}` }], { write, env, platform });
  const wrong = treeRefusal(tree, request, env);
  if (wrong) return refuse([{ entry: `commit ${request.commit}`, why: wrong }], { write, env, platform });
  const facts = readFacts({ request, tree, platform, step: "prepare", repo, env });
  const unfit = platform.refusal?.(facts);
  write(`${formatHeader(facts, platform).join("\n")}\n\n`);
  if (unfit) return refuse([unfit], { write, env, platform, nothing: INSTALLED_NOTHING });
  write(`The request is valid. ${request.commit} is checked out at ${tree}.\n${BEFORE_THE_REF}\n`);
  return 0;
}

/** The step summary of a run that ran its files → lines of Markdown. */
export function summaryLines(facts, runs, platform) {
  const { ok, lines } = conclude(runs);
  return [
    `## ${platform.title}: ${ok ? "passed" : "FAILED"}`, "",
    `- Commit under test: <code>${html(facts.commit)}</code>, asked for as <code>${html(show(facts.asked))}</code>.`,
    `- Workflow: <code>${html(show(facts.workflowRef ?? "not a workflow run"))}</code> at <code>${html(show(facts.workflowSha ?? "-"))}</code>.`,
    `- ${platform.summary(facts)}, ${html(facts.arch)}, node ${html(facts.node)}, ${html(facts.fileSystem)} file system, tmux ${facts.tmux ? html(show(facts.tmux.version ?? "version unknown")) : "not on PATH"}.`,
    "", ...buildMarkdownTable(runs), "", ...lines.map((line) => `- ${html(line)}`), "",
    "The step's log has the full header and each file's output; it is the evidence, not this summary.", "",
  ];
}

/** Step two: validate again, run each file in `tree`, print the table → Promise of the exit status.
 *  Each file gets the platform's `fileTimeoutMs`; `timeoutMs` is the tests' seam. */
export async function run({ tree, platform, repo = REPO_ROOT, env = process.env, write = (chunk) => process.stdout.write(chunk), timeoutMs = platform.fileTimeoutMs }) {
  const request = validateRequest(requestOf(platform, env), repo, env);
  if (!request.ok) return refuse(request.refusals, { write, env, platform, nothing: NO_FILE });
  const wrong = treeRefusal(tree, request, env);
  if (wrong) return refuse([{ entry: `commit ${request.commit}`, why: wrong }], { write, env, platform, nothing: NO_FILE });
  const facts = readFacts({ request, tree, platform, step: "run", repo, env });
  const unfit = platform.refusal?.(facts);
  write(`${formatHeader(facts, platform).join("\n")}\n\n${AFTER_THE_INSTALLS}\n`);
  if (unfit) return refuse([unfit], { write, env, platform, nothing: NO_FILE });
  // Read once, before the first file: a socket that is there already is not a file's doing.
  const runs = await runFiles(request.files, { cwd: tree, env, write, timeoutMs, tmuxSocket: facts.tmuxSocket.there ? null : facts.tmuxSocket.path, requestVars: Object.values(platform.request) });
  const { ok, lines } = conclude(runs);
  write(`\n${buildTable(runs).join("\n")}\n\n${lines.join("\n")}\n`);
  summarize(env, summaryLines(facts, runs, platform));
  return ok ? 0 : 1;
}

/** A runner's command line → Promise of the exit status. On a workflow run, what this step prints is
 *  kept from being read as workflow commands (`::error::`, `::add-mask::`): most of it is a test's
 *  output. */
export async function main(platform, argv, env = process.env, write = (chunk) => process.stdout.write(chunk)) {
  const [step, treeArg] = argv;
  if (argv.length !== 2 || !["prepare", "run"].includes(step)) {
    write(`usage: node ${platform.script} <prepare|run> <tree>   (the request: ${platform.request.ref}, ${platform.request.files})\n`);
    return 2;
  }
  const tree = resolve(treeArg), token = env.GITHUB_ACTIONS === "true" ? randomBytes(16).toString("hex") : null;
  if (token) write(`::stop-commands::${token}\n`);
  try { return step === "prepare" ? prepare({ tree, platform, env, write }) : await run({ tree, platform, env, write }); }
  catch (error) { write(`${basename(platform.script, ".mjs")}: ${error.stack ?? error}\n`); return 2; }
  finally { if (token) write(`\n::${token}::\n`); }
}

/** Whether a runner's script was started as the command line, from its `import.meta.url`. */
export const isCommandLine = (url) => Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(url);
