// The fixtures and helpers that the parts of what was one file, retire-work-safety.test.mjs, share:
// awebai/oats#1061 split it by subject so that each part ends within the macOS run's bound.
// Importing it registers, for the file that imports it, what that file used to set up once for itself:
// an afterEach that runs the cleanups of the fixtures a test made and removes the directories it listed
// in temporaryDirectories, and the fixture Git home, removed after the file. Each part is its own
// process, so each cleans what it made.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { v2Deployment } from "./v2-deployment.mjs";

export const CLI = resolve(new URL("../../bin/oats.mjs", import.meta.url).pathname);
export const temporaryDirectories = [];
export const fixtureCleanups = [];

/** The environment of the Git commands the test itself runs on its fixtures (fixtureGit, porcelain,
 *  headOf, nestedRepository): built from PATH alone, so nothing of the operator's reaches them (a global
 *  or system configuration, its hooks or credential helper, a proxy, GIT_DIR or another repository
 *  selector). Commits are unsigned, by a test identity. Its HOME is the file's own, removed after it. */
export const fixtureGitHome = mkdtempSync(join(tmpdir(), "oats-retire-git-home-"));
test.after(() => rmSync(fixtureGitHome, { recursive: true, force: true }));
export const FIXTURE_GIT_ENV = {
  PATH: process.env.PATH, HOME: fixtureGitHome, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: "0",
  GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "commit.gpgsign", GIT_CONFIG_VALUE_0: "false",
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid",
};
/** Git in `repo` (null: none, as for `git init <dir>`) with FIXTURE_GIT_ENV → its stdout, a Buffer unless `encoding`. */
export const fixtureGit = (repo, args, options = {}) => execFileSync("git", [...(repo === null ? [] : ["-C", repo]), ...args], { stdio: ["ignore", "pipe", "pipe"], ...options, env: FIXTURE_GIT_ENV });

export function write(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, mode === undefined ? undefined : { mode });
}

/** A workspace deployment whose soul dev works in a worktree of the member clone
 *  (which carries .gitignore + tracked.txt), or in `work` mode when given;
 *  `capabilities` are member capabilities the soul declares (their hooks are
 *  captured at spawn). `commit` changes the member repository (fx.commit). */
export function fixture({ capabilities = {}, work = "worktree" } = {}) {
  const declared = Object.fromEntries(Object.keys(capabilities).map((id) => [id, { from: "here" }]));
  const fx = v2Deployment({
    souls: { dev: { soul: { work, ...(Object.keys(declared).length ? { capabilities: declared } : {}) }, agents: "# Dev\n" } },
    capabilities,
    files: { ".gitignore": "cache/\nhuman-ignored/\n", "tracked.txt": "base\n" },
  });
  // fx.cleanup also removes the fixture's private TMUX_TMPDIR, which lives outside fx.base.
  fixtureCleanups.push(fx.cleanup);
  const repo = fx.member;
  fixtureGit(repo, ["config", "user.email", "test@example.invalid"]);
  fixtureGit(repo, ["config", "user.name", "Test"]);
  const bin = join(fx.base, "bin");
  write(join(bin, "pi"), "#!/bin/sh\nexit 0\n", 0o755);
  const env = { ...fx.env, PATH: `${bin}:${fx.env.PATH}` };
  delete env.OATS_TMUX_SESSION; delete env.PI_AGENTS_TMUX_SESSION;
  // The CLI's own Git (a spawn's `worktree add`, a retire's reads and clones) sees none of the
  // operator's configuration, hooks, credential helper, proxy or repository selectors either.
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") || /_proxy$/i.test(key)) delete env[key];
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: "0" });
  return { base: fx.base, dep: fx.dep, repo, root: fx.root, env, commit: fx.commit };
}

export function cli(f, args) {
  return spawnSync(process.execPath, [CLI, ...args, "--dir", f.dep], { cwd: f.dep, encoding: "utf8", env: f.env });
}

export function spawn(f, purpose) {
  const result = cli(f, ["spawn", "dev", "--purpose", purpose, "--no-launch", "--json"]);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout).result;
}

export function installFakeTmux(f) {
  const state = join(f.base, "tmux-state");
  mkdirSync(state);
  // An endpoint per server: the ambient one ($TMUX, else "default"), a socket named with -S, and
  // the OATS server the kernel selects with -L oats, which lives at $TMUX_FAKE_OATS. The state is
  // found without the environment too: a window is created by a tmux client given the locale only.
  write(join(f.base, "bin", "tmux"), `#!/bin/sh
endpoint=\${TMUX%%,*}
[ -n "$endpoint" ] || endpoint=default
while :; do
  case "$1" in
    -u) shift ;;
    -S) endpoint=$2; shift 2 ;;
    -L) endpoint=\${TMUX_FAKE_OATS:?}; shift 2 ;;
    *) break ;;
  esac
done
command=$1; shift
state=\${TMUX_FAKE_STATE:-${state}}/\$(printf '%s' "$endpoint" | tr / _)
case "$command" in
  has-session) exit 0 ;;
  list-sessions) exit 0 ;;
  list-windows) [ -f "$state/window" ] && cat "$state/window"; exit 0 ;;
  new-session) mkdir -p "$state"; printf '%s\\t@0\\n' "$endpoint"; exit 0 ;;
  show-environment) printf 'PATH="%s"; export PATH;\\n' "$PATH"; exit 0 ;;
  set-option) exit 0 ;;
  new-window)
    while [ $# -gt 0 ]; do
      case "$1" in
        -n) window=$2; shift 2 ;;
        -c) cwd=$2; shift 2 ;;
        *) shift ;;
      esac
    done
    mkdir -p "$state"; printf '%s\\n' "$window" > "$state/window"
    printf 'early-harness-bytes\\n' > "$cwd/early-harness.txt"
    printf '@1\\n'
    exit 0 ;;
  kill-window) rm -f "$state/window"; exit 0 ;;
  *) exit 0 ;;
esac
`, 0o755);
  f.env.TMUX_FAKE_STATE = state;
  f.env.TMUX_FAKE_OATS = join(f.base, "oats-socket");
  return state;
}

test.afterEach(() => {
  for (const cleanup of fixtureCleanups.splice(0)) cleanup();
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Git status as the retire verification reads it. */
export const porcelain = (repo) => fixtureGit(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--ignore-submodules=none"], { encoding: "utf8" });

/** Give `repo` a config-local core.attributesFile marking `files` as text, and make their stat stale so status re-reads them. */
export function staleUnderTextAttribute(repo, base, files, patterns = "*.txt text\n") {
  const attributes = join(base, `attributes-${files.length}`);
  write(attributes, patterns);
  fixtureGit(repo, ["config", "core.attributesFile", attributes]);
  for (const file of files) utimesSync(file, new Date(2020, 0, 1), new Date(2020, 0, 1));
}

/** How a refusal of the copy made before the retire hooks ends, as regular-expression source, for an
 *  instance that was never launched: what this retire has and has not done by then. */
export function refusedBeforeHooks(instance) {
  return String.raw`\. No retire hook has run, no recovery was written and nothing was deleted: ${instance} is not retired and its home and work are kept; this retire stopped no session$`;
}

/** How a refusal after the retire hooks ends, as regular-expression source, for an instance that was
 *  never launched: what this retire has and has not done by then. */
export const REFUSED_AFTER_HOOKS = String.raw`\. The retire hooks have run; the home, its work and the pre-hook recovery \(if any\) are kept; this retire stopped no session\.$`;

export const recoveryRootOf = (home) => join(dirname(home), ".oats-retirement", "recovery");

export const baselineOf = (home) => join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);

export const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** Every path under `root` whose last segment is `name`; symlinks are entries, never followed. */
export function pathsNamed(root, name) {
  const hits = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.name === name) hits.push(path);
      if (e.isDirectory()) walk(path);
    }
  };
  if (existsSync(root)) walk(root);
  return hits.sort();
}

/** A capability that declares nothing and whose retire hook runs `retire`. */
export const HOOK_BYTES = "written by the retire hook\n";

export const RETIRE_WRITES_NOTHING = "console.log(JSON.stringify({ meta: { retired: true } }));\n";

export const hookCapability = (retire) => ({ "acme.hook": { manifest: { description: "acts at retire", hooks: { retire: "retire.mjs" } }, files: { "retire.mjs": retire } } });

/** A provider with state of its own in the home, as a messaging provider keeps
 *  its identity: the spawn hook writes a signing key under two hidden entries,
 *  the retire hook reports whether the key was still there, writes a receipt
 *  under a third, and leaves a marker BESIDE the home that it ran. `declare`:
 *  whether the manifest declares the three as retirement.disposable.home. */
export const IDENT_KEY = "ident-signing-key 7f3a9c51e0b2\n";

export const IDENT_DECLARED = [".ident", ".ident-state", ".ident-id-*"];

export const IDENT_SPAWN = `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.OATS_INSTANCE_HOME;
for (const dir of ['.ident', '.ident-id-wide']) {
  mkdirSync(join(home, dir), { recursive: true });
  writeFileSync(join(home, dir, 'signing.key'), ${JSON.stringify(IDENT_KEY)});
}
console.log(JSON.stringify({ meta: { minted: true } }));
`;

export const identRetire = (meta) => `import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const home = process.env.OATS_INSTANCE_HOME;
const keyPresent = existsSync(join(home, '.ident', 'signing.key'));
mkdirSync(join(home, '.ident-state'), { recursive: true });
writeFileSync(join(home, '.ident-state', 'retire.json'), JSON.stringify({ at: 'retire' }));
writeFileSync(join(dirname(home), 'retire-hook-ran-' + basename(home)), 'ran');
console.log(JSON.stringify({ meta: { ...${JSON.stringify(meta)}, keyPresent } }));
`;

export const identManifest = (declare) => ({ description: "a provider with state of its own in the home", hooks: { spawn: "spawn.mjs", retire: "retire.mjs" }, ...(declare ? { retirement: { disposable: { home: IDENT_DECLARED } } } : {}) });

export const identCapability = ({ declare = true, meta = { retired: true } } = {}) => ({ "acme.ident": { manifest: identManifest(declare), files: { "spawn.mjs": IDENT_SPAWN, "retire.mjs": identRetire(meta) } } });

export const identHookRan = (home) => existsSync(join(dirname(home), `retire-hook-ran-${basename(home)}`));

export const IDENT_NOT_COPIED = [".ident", ".ident-id-wide", ".ident-state"].map((path) => ({ scope: "home", path, owner: "acme.ident" }));

/** Spawn an instance of the ident provider and give it one authored note, so a retire has a home change to preserve. */
export function spawnWithNote(f, purpose) {
  const spawned = spawn(f, purpose);
  assert.equal(readFileSync(join(spawned.home, ".ident", "signing.key"), "utf8"), IDENT_KEY, "fixture premise: the spawn hook minted the key in the home");
  assert.equal(readFileSync(join(spawned.home, ".ident-id-wide", "signing.key"), "utf8"), IDENT_KEY);
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  return spawned;
}

/** A retire hook's source. `body` runs with `home`, `work`, `git(...args)` (in the work tree),
 *  `gitIn(dir)` and `seen` in scope. The hook then writes a home file (unless `home` is false)
 *  and leaves beside the home, as JSON, what `body` put in `seen` and `seen.status`: the
 *  kernel's status command, run once the hook has written. */
export const quietHook = (body, { home = true } = {}) => `import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const home = process.env.OATS_INSTANCE_HOME;
const work = join(home, 'work');
const gitIn = (dir) => (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
const git = gitIn(work);
const seen = {};
${body}
${home ? `writeFileSync(join(home, 'hook-note.txt'), ${JSON.stringify(HOOK_BYTES)});` : "// this hook writes nothing in the home"}
seen.status = git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none');
writeFileSync(join(dirname(home), 'hook-saw-' + basename(home)), JSON.stringify(seen));
console.log(JSON.stringify({ meta: { retired: true } }));
`;

/** `oats retire <instance> --discard-worktree --json` (or with `flags`) after a quietHook.
 *  Asserts what holds whether or not the post-hook pass copies the work: exit 0, one
 *  recovery, the hook ran and left Git's status text as it was before the retire
 *  (`statusBefore`), its home file is under after-hooks/home/ (when it wrote one: `home`),
 *  and the worktree is gone.
 *  → { receipt, recovery: its workRecovery, seen: what the hook left, afterRepo: <recovery>/after-hooks/repo }. */
export function retireAfterQuietHook(f, spawned, statusBefore, { flags = ["--discard-worktree"], home = true } = {}) {
  const retired = cli(f, ["retire", basename(spawned.home), ...flags, "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const receipt = JSON.parse(retired.stdout);
  const recovery = receipt.workRecovery;
  assert.ok(recovery?.path, `a recovery was written: ${retired.stdout}`);
  const left = join(dirname(spawned.home), `hook-saw-${basename(spawned.home)}`);
  assert.equal(existsSync(left), true, "fixture premise: the retire hook ran to its end");
  const seen = readJson(left);
  assert.equal(seen.status, statusBefore, "fixture premise: Git's status text is the same after the hook's change");
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [basename(recovery.path)], "one recovery directory");
  if (home) assert.equal(readFileSync(join(recovery.path, "after-hooks", "home", "hook-note.txt"), "utf8"), HOOK_BYTES, "the hook's home file is copied under after-hooks/");
  assert.equal(receipt.retention.worktree, "removed");
  assert.equal(existsSync(join(spawned.home, "work")), false, "the worktree is gone");
  assert.equal(existsSync(spawned.home), false);
  return { receipt, recovery, seen, afterRepo: join(recovery.path, "after-hooks", "repo") };
}

/** The receipt and recovery.json both say that the home and the work were copied again. */
export function assertBothCopiedAgain(recovery) {
  assert.deepEqual(recovery.afterHooks, { home: true, work: true });
  assert.deepEqual(readJson(join(recovery.path, "recovery.json")).afterHooks, { home: true, work: true });
}

export const statusRowsIn = (status) => status.split("\0").filter(Boolean);

/** The commit a repository is at. `repo` must be a repository's own top level: Git would otherwise answer for the one around it. */
export const headOf = (repo) => fixtureGit(repo, ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

/** Git in `repo`, as text. */
export const gitTextIn = (repo) => (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Whether `repo` has the object `oid` (`git cat-file -e`). */
export const hasObject = (repo, oid) => spawnSync("git", ["-C", repo, "cat-file", "-e", oid], { stdio: "ignore" }).status === 0;

/** A nested repository under the worktree's ignored human-ignored/, with one commit. → its directory. */
export function nestedRepository(work, ...under) {
  const nested = join(work, "human-ignored", ...under, "nested");
  mkdirSync(nested, { recursive: true });
  fixtureGit(null, ["init", "-q", nested]);
  fixtureGit(nested, ["config", "user.email", "test@example.invalid"]);
  fixtureGit(nested, ["config", "user.name", "Test"]);
  fixtureGit(nested, ["config", "maintenance.auto", "false"]);
  write(join(nested, "nested.txt"), "nested-commit\n");
  fixtureGit(nested, ["add", "."]);
  fixtureGit(nested, ["commit", "-qm", "nested"]);
  return nested;
}

export const stashListOf = (repo) => execFileSync("git", ["-C", repo, "stash", "list"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

export const nestedUnder = (repo) => join(repo, "human-ignored", "nested");

/** A worktree's own Git directory (under the shared repository's worktrees/): its index and an operation in progress are there. */
export const gitDirOf = (work) => execFileSync("git", ["-C", work, "rev-parse", "--absolute-git-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** The Git directory a worktree shares with the repository it belongs to. */
export const commonDirOf = (work) => execFileSync("git", ["-C", work, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A repository's own info/exclude; a clone has one only where Git's templates provide it, so absent reads as no rule. */
export const excludeRulesOf = (repo) => { const file = join(repo, ".git", "info", "exclude"); return existsSync(file) ? readFileSync(file, "utf8") : ""; };

/** A repository's tag names. Sorted here: the order `git tag` lists in follows the user's configuration. */
export const tagNamesOf = (repo) => execFileSync("git", ["-C", repo, "tag", "--list"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").filter(Boolean).sort();

/** `count` stash entries of `file` in `repo`, each with content no commit has → the stash log's commits, newest first. */
export function stashEntries(repo, file, count) {
  const git = gitTextIn(repo);
  for (let i = 1; i <= count; i++) {
    write(join(repo, file), `stash entry ${i}\n`);
    git("stash", "push", "--quiet", "-m", `entry ${i}`);
  }
  return git("log", "-g", "--format=%H", "refs/stash").split("\n").filter(Boolean);
}

/** Run `make`, which needs a file system that stores a byte that is not UTF-8 in a name or in a link's
 *  target, and read the bytes back with `read` (hex). → true when they are there. Where the platform
 *  does not store them the test is skipped with the reason. On Linux that is a failure: there the
 *  test cannot pass by being skipped. */
export function storedBytes(t, make, read, expected) {
  let reason;
  try {
    make();
    const got = read();
    if (got !== expected) reason = `the file system stored ${got || "nothing"} where the test wrote ${expected}`;
  } catch (e) { reason = `the file system refused the bytes ${expected}: ${e.message}`; }
  if (!reason) return true;
  assert.notEqual(process.platform, "linux", `this test is not skipped on Linux: ${reason}`);
  t.skip(reason);
  return false;
}

/** Whether an entry is there, a dangling link included. */
export const entryIsThere = (path) => { try { lstatSync(path); return true; } catch { return false; } };

/** `name` followed by one byte, as bytes: a name that is not valid UTF-8 for 0x80 and up. */
export const withByte = (name, byte) => Buffer.concat([Buffer.from(name), Buffer.from([byte])]);

/** `dir`/`name` as bytes. */
export const under = (dir, name) => Buffer.concat([Buffer.from(dir), Buffer.from("/"), Buffer.from(name)]);

/** The names in `dir` that start with `prefix`, as the hex of their bytes, sorted. */
export const namesStartingWith = (dir, prefix) => readdirSync(dir, { encoding: "buffer" }).filter((n) => n.subarray(0, prefix.length).equals(Buffer.from(prefix))).map((n) => n.toString("hex")).sort().join(",");

/** quietHook body: write a new untracked file in the worktree. The status gains a row, which is a
 *  change of the work that every kernel sees, also one that compares nothing but the status text. */
export const SCRATCH_BYTES = "written in the work by the retire hook\n";

export const WRITES_SCRATCH = `writeFileSync(join(work, 'scratch.txt'), ${JSON.stringify(SCRATCH_BYTES)});`;

export const STATUS_WITH_SCRATCH = "?? scratch.txt\0";

/** Whether a quietHook retire hook ran to its end for this home. */
export const hookRan = (home) => existsSync(join(dirname(home), `hook-saw-${basename(home)}`));
