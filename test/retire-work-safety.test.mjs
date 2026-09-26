import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { statusDisagreement } from "../lib/core.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const temporaryDirectories = [];

function write(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, mode === undefined ? undefined : { mode });
}

/** A workspace deployment whose soul dev works in a worktree of the member clone
 *  (which carries .gitignore + tracked.txt); `capabilities` are member
 *  capabilities the soul declares (their hooks are captured at spawn). */
function fixture({ capabilities = {} } = {}) {
  const declared = Object.fromEntries(Object.keys(capabilities).map((id) => [id, { from: "here" }]));
  const fx = v2Deployment({
    souls: { dev: { soul: { work: "worktree", ...(Object.keys(declared).length ? { capabilities: declared } : {}) }, agents: "# Dev\n" } },
    capabilities,
    files: { ".gitignore": "cache/\nhuman-ignored/\n", "tracked.txt": "base\n" },
  });
  temporaryDirectories.push(fx.base);
  const repo = fx.member;
  execFileSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
  const bin = join(fx.base, "bin");
  write(join(bin, "pi"), "#!/bin/sh\nexit 0\n", 0o755);
  const env = { ...fx.env, PATH: `${bin}:${fx.env.PATH}` };
  delete env.OATS_TMUX_SESSION; delete env.PI_AGENTS_TMUX_SESSION;
  return { base: fx.base, dep: fx.dep, repo, root: fx.root, env };
}

function cli(f, args) {
  return spawnSync(process.execPath, [CLI, ...args, "--dir", f.dep], { cwd: f.dep, encoding: "utf8", env: f.env });
}

function spawn(f, purpose) {
  const result = cli(f, ["spawn", "dev", "--purpose", purpose, "--no-launch", "--json"]);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout).result;
}

function installFakeTmux(f) {
  const state = join(f.base, "tmux-state");
  mkdirSync(state);
  write(join(f.base, "bin", "tmux"), `#!/bin/sh
endpoint=\${TMUX%%,*}
[ -n "$endpoint" ] || endpoint=default
if [ "$1" = "-S" ]; then endpoint=$2; shift 2; fi
command=$1; shift
state=\${TMUX_FAKE_STATE:?}/\$(printf '%s' "$endpoint" | tr / _)
case "$command" in
  has-session) exit 0 ;;
  display-message) printf '%s\\n' "$endpoint" ;;
  list-windows) [ -f "$state/window" ] && cat "$state/window"; exit 0 ;;
  new-session) mkdir -p "$state"; exit 0 ;;
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
    exit 0 ;;
  kill-window) rm -f "$state/window"; exit 0 ;;
  *) exit 0 ;;
esac
`, 0o755);
  f.env.TMUX_FAKE_STATE = state;
  return state;
}

test.afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("launched harness writes cannot be stamped into the clean retirement baseline", () => {
  const f = fixture();
  installFakeTmux(f);
  f.env.TMUX = `${join(f.base, "socket-a")},1,0`;
  const launched = cli(f, ["spawn", "dev", "--purpose", "early-write", "--json"]);
  assert.equal(launched.status, 0, `${launched.stderr}\n${launched.stdout}`);
  const spawned = JSON.parse(launched.stdout).result;
  assert.equal(readFileSync(join(spawned.home, "early-harness.txt"), "utf8"), "early-harness-bytes\n");

  const retired = cli(f, ["retire", "dev-early-write", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.ok(recovery?.classes.includes("changed instance-home bytes"));
  assert.equal(readFileSync(join(recovery.path, "home", "early-harness.txt"), "utf8"), "early-harness-bytes\n");
});

test("retire quiesces the exact tmux endpoint recorded at spawn, not ambient TMUX", () => {
  const f = fixture();
  const state = installFakeTmux(f);
  const socketA = join(f.base, "socket-a");
  f.env.TMUX = `${socketA},1,0`;
  const launched = cli(f, ["spawn", "dev", "--purpose", "socket", "--json"]);
  assert.equal(launched.status, 0, `${launched.stderr}\n${launched.stdout}`);
  const activeA = join(state, socketA.replaceAll("/", "_"), "window");
  assert.equal(existsSync(activeA), true, "spawn did not create the managed window on endpoint A");

  f.env.TMUX = `${join(f.base, "socket-b")},2,0`;
  const retired = cli(f, ["retire", "dev-socket", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  assert.equal(existsSync(activeA), false, "retire left the spawn endpoint's managed window running");
});

test("retire refuses a mutable instance.json endpoint that disagrees with independent authority", () => {
  const f = fixture();
  const state = installFakeTmux(f);
  const socketA = join(f.base, "socket-authority-a");
  f.env.TMUX = `${socketA},1,0`;
  const launched = cli(f, ["spawn", "dev", "--purpose", "endpoint-authority", "--json"]);
  assert.equal(launched.status, 0, `${launched.stderr}\n${launched.stdout}`);
  const spawned = JSON.parse(launched.stdout).result;
  const activeA = join(state, socketA.replaceAll("/", "_"), "window");

  const metaPath = join(spawned.home, "instance.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  meta.tmux.socket = join(f.base, "socket-authority-b");
  write(metaPath, JSON.stringify(meta, null, 2) + "\n");
  const retired = cli(f, ["retire", "dev-endpoint-authority", "--json"]);
  assert.notEqual(retired.status, 0, "mutable child metadata redefined the endpoint authority");
  assert.equal(JSON.parse(retired.stdout).error.code, "E_RUNTIME_AUTHORITY_MISMATCH", retired.stdout);
  assert.equal(existsSync(spawned.home), true, "authority disagreement did not fail before deletion");
  assert.equal(existsSync(activeA), true, "refusal unexpectedly mutated the independently recorded harness");
});

test("production retire preserves untracked worktree and unknown home bytes in a reported recovery", () => {
  const f = fixture();
  const spawnResult = spawn(f, "safe");
  const workSentinel = join(spawnResult.home, "work", "human-untracked.txt");
  const homeSentinel = join(spawnResult.home, "human-home.txt");
  write(workSentinel, "worktree-human-bytes\n");
  write(homeSentinel, "home-human-bytes\n");

  const retired = cli(f, ["retire", "dev-safe", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const result = JSON.parse(retired.stdout);
  assert.ok(result.workRecovery?.path, `retire did not report preserved work: ${retired.stdout}`);
  assert.equal(existsSync(spawnResult.home), false, "the reusable instance path was not released");
  assert.equal(readFileSync(join(result.workRecovery.path, "home", "human-home.txt"), "utf8"), "home-human-bytes\n");
  assert.equal(readFileSync(join(result.workRecovery.path, "repo", "human-untracked.txt"), "utf8"), "worktree-human-bytes\n");
});

test("retire recovers a worktree that switched branches after spawn, on its actual branch", () => {
  // Second-operator wave (2026-09-21): three developer instances branched from main inside their
  // worktrees, as instructed, and became unretirable — recovery cloned the branch recorded at spawn
  // and the status comparison could never agree. Recovery derives the branch from the worktree.
  const f = fixture();
  const spawned = spawn(f, "drift");
  const work = join(spawned.home, "work");
  const git = (...args) => execFileSync("git", ["-C", work, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("switch", "--quiet", "-c", "fix/switched-after-spawn");
  write(join(work, "switched.txt"), "committed on the switched branch\n");
  git("add", "switched.txt");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--quiet", "-m", "switched-branch work");
  const tip = git("rev-parse", "HEAD").trim();
  const recorded = JSON.parse(readFileSync(join(spawned.home, "instance.json"), "utf8")).branch;
  assert.notEqual(recorded, "fix/switched-after-spawn", "fixture premise: instance.json still records the spawn branch");
  // Untracked bytes force the repository recovery path — the one that cloned the recorded branch.
  write(join(work, "human-untracked.txt"), "worktree-human-bytes\n");

  const retired = cli(f, ["retire", "dev-drift", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.ok(recovery?.path, "drifted worktree must still be recoverable by the normal path");
  const recoveredBranch = execFileSync("git", ["-C", join(recovery.path, "repo"), "symbolic-ref", "--short", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(recoveredBranch, "fix/switched-after-spawn", "recovery clone is on the branch the worktree actually had");
  assert.equal(execFileSync("git", ["-C", join(recovery.path, "repo"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), tip);
  assert.equal(readFileSync(join(recovery.path, "repo", "switched.txt"), "utf8"), "committed on the switched branch\n");
  const manifest = JSON.parse(readFileSync(join(recovery.path, "recovery.json"), "utf8"));
  assert.deepEqual(manifest.branchDrift, { recordedBranch: recorded, worktreeBranch: "fix/switched-after-spawn", detachedAt: null });
  assert.equal(readFileSync(join(recovery.path, "repo", "human-untracked.txt"), "utf8"), "worktree-human-bytes\n");
  // Without --delete-branch the switched branch survives in the repository, as any branch would.
  assert.equal(execFileSync("git", ["-C", f.repo, "rev-parse", "refs/heads/fix/switched-after-spawn"], { encoding: "utf8" }).trim(), tip);
});

test("retire recovers a detached worktree at its exact commit", () => {
  const f = fixture();
  const spawned = spawn(f, "detached");
  const work = join(spawned.home, "work");
  const git = (...args) => execFileSync("git", ["-C", work, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("switch", "--quiet", "--detach");
  write(join(work, "detached.txt"), "committed while detached\n");
  git("add", "detached.txt");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "--quiet", "-m", "detached work");
  const tip = git("rev-parse", "HEAD").trim();
  write(join(work, "human-untracked.txt"), "worktree-human-bytes\n");
  const retired = cli(f, ["retire", "dev-detached", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.equal(execFileSync("git", ["-C", join(recovery.path, "repo"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), tip);
  assert.equal(readFileSync(join(recovery.path, "repo", "detached.txt"), "utf8"), "committed while detached\n");
  const manifest = JSON.parse(readFileSync(join(recovery.path, "recovery.json"), "utf8"));
  assert.equal(manifest.branchDrift.worktreeBranch, null);
  assert.equal(manifest.branchDrift.detachedAt, tip);
});

test("human retire output reports preserved classes and recovery location", () => {
  const f = fixture();
  const spawned = spawn(f, "reported");
  write(join(spawned.home, "work", "report-me.txt"), "report bytes\n");
  const retired = cli(f, ["retire", "dev-reported"]);
  assert.equal(retired.status, 0, retired.stderr);
  assert.match(retired.stdout, /Work that was not committed has been preserved: .*untracked or ignored worktree bytes/);
  assert.match(retired.stdout, /\.oats-retirement\/recovery\/dev-reported-/);
});

test("retire names the ignored and untracked outputs a recovery copied, and what they cost", () => {
  // There is no disposable declaration on the workspace model: a worktree's build
  // outputs (ignored cache/) are copied to recovery with everything else. Safe, not
  // clean — the summary says which paths and how many bytes.
  const f = fixture();
  const outputs = (spawned) => {
    write(join(spawned.home, "work", "cache", "deep", "big.bin"), "x".repeat(5000));
    write(join(spawned.home, "work", "cache", "small.bin"), "y".repeat(120));
    write(join(spawned.home, "work", "note.txt"), "twelve bytes");
  };
  const a = spawn(f, "costly");
  outputs(a);
  const retired = cli(f, ["retire", "dev-costly", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.deepEqual(recovery.outputs, { paths: [{ path: "cache/", bytes: 5120 }, { path: "note.txt", bytes: 12 }], bytes: 5132 });
  assert.ok(recovery.bytes >= 5132, `the recovery's own size covers the outputs it carries (${recovery.bytes})`);
  assert.deepEqual(JSON.parse(readFileSync(join(recovery.path, "recovery.json"), "utf8")).outputs, recovery.outputs, "recovery.json records them too");
  const b = spawn(f, "costly-text");
  outputs(b);
  const text = cli(f, ["retire", "dev-costly-text"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /\.oats-retirement\/recovery\/dev-costly-text-\S+ \(\d+(\.\d)? (B|KiB|MiB)\)/);
  assert.match(text.stdout, /copied outputs: cache\/ \(5\.0 KiB\), note\.txt \(12 B\) — 5\.0 KiB in total/);
});

test("home-only recovery preserves notes without cloning a clean merged worktree", () => {
  const f = fixture();
  const spawned = spawn(f, "home-only");
  write(join(spawned.home, "notes", "lesson.md"), "Keep this lesson.\n");
  const retired = cli(f, ["retire", "dev-home-only", "--delete-branch", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.deepEqual(recovery.classes, ["changed instance-home bytes"]);
  assert.equal(readFileSync(join(recovery.path, "home", "notes", "lesson.md"), "utf8"), "Keep this lesson.\n");
  assert.equal(existsSync(join(recovery.path, "repo")), false);
  assert.equal(recovery.repoCopy.copied, false);
  const manifest = JSON.parse(readFileSync(join(recovery.path, "recovery.json"), "utf8"));
  assert.deepEqual(manifest.repoCopy, recovery.repoCopy);
  assert.equal(readFileSync(join(f.repo, "tracked.txt"), "utf8"), "base\n");
  assert.equal(existsSync(spawned.home), false);
});

test("home changes with an in-progress Git operation still retain standalone Git state", () => {
  const f = fixture();
  const spawned = spawn(f, "home-merge");
  const work = join(spawned.home, "work");
  write(join(spawned.home, "notes.md"), "Merge is unfinished.\n");
  const gitDir = execFileSync("git", ["-C", work, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
  const head = execFileSync("git", ["-C", work, "rev-parse", "HEAD"], { encoding: "utf8" });
  write(join(gitDir, "MERGE_HEAD"), head);
  write(join(gitDir, "MERGE_MSG"), "Unfinished merge\n");
  assert.equal(execFileSync("git", ["-C", work, "status", "--porcelain"], { encoding: "utf8" }), "");
  const retired = cli(f, ["retire", "dev-home-merge", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.equal(readFileSync(join(recovery.path, "repo", ".git", "MERGE_HEAD"), "utf8"), head);
  assert.equal(readFileSync(join(recovery.path, "repo", ".git", "MERGE_MSG"), "utf8"), "Unfinished merge\n");
  assert.notEqual(recovery.repoCopy?.copied, false);
});

test("production recovery reopens staged index state after the original worktree is gone", () => {
  const f = fixture();
  const spawned = spawn(f, "staged");
  write(join(spawned.home, "work", "tracked.txt"), "staged-human-bytes\n");
  execFileSync("git", ["-C", join(spawned.home, "work"), "add", "tracked.txt"]);

  const retired = cli(f, ["retire", "dev-staged", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const result = JSON.parse(retired.stdout);
  assert.equal(existsSync(spawned.home), false);
  const recoveryRepo = join(result.workRecovery.path, "repo");
  const staged = execFileSync("git", ["-C", recoveryRepo, "diff", "--cached", "--name-only"], { encoding: "utf8" });
  const unstaged = execFileSync("git", ["-C", recoveryRepo, "diff", "--name-only"], { encoding: "utf8" });
  assert.equal(staged.trim(), "tracked.txt", "the staged index was not recoverable");
  assert.equal(unstaged.trim(), "", "staged bytes degraded into unstaged-only recovery");
  assert.equal(readFileSync(join(recoveryRepo, "tracked.txt"), "utf8"), "staged-human-bytes\n");
});

test("missing or corrupt independent authority fails closed before quiescence or deletion", () => {
  for (const corrupt of [false, true]) {
    const f = fixture();
    const spawned = spawn(f, corrupt ? "receipt-corrupt" : "receipt-missing");
    write(join(spawned.home, "work", "cache", "later.bin"), "generated-later\n");
    const baselineDir = join(dirname(spawned.home), ".oats-retirement", "baselines");
    const baseline = join(baselineDir, readdirSync(baselineDir)[0]);
    if (corrupt) write(baseline, "{not-json\n");
    else rmSync(baseline);
    const retired = cli(f, ["retire", corrupt ? "dev-receipt-corrupt" : "dev-receipt-missing", "--json"]);
    assert.notEqual(retired.status, 0, `${corrupt ? "corrupt" : "missing"} authority did not fail closed`);
    assert.equal(JSON.parse(retired.stdout).error.code, corrupt ? "E_WORK_INSPECTION_FAILED" : "E_RUNTIME_ENDPOINT_UNKNOWN", retired.stdout);
    assert.equal(existsSync(spawned.home), true);
  }
});

test("retire-hook bytes are caught by the final post-hook inspection", () => {
  const f = fixture({ capabilities: { "acme.writer": {
    manifest: { description: "writer", hooks: { retire: "hook.mjs" } },
    files: { "hook.mjs": "import {writeFileSync} from 'node:fs'; import {join} from 'node:path'; writeFileSync(join(process.env.OATS_HOME, 'hook-created.txt'), 'hook-bytes\\n'); console.log(JSON.stringify({meta:{retired:true}}));\n" },
  } } });
  const spawned = spawn(f, "hook-write");
  const retired = cli(f, ["retire", "dev-hook-write", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.ok(recovery?.classes.includes("changed instance-home bytes"));
  assert.equal(readFileSync(join(recovery.path, "home", "hook-created.txt"), "utf8"), "hook-bytes\n");
});

test("nested repository recovery is standalone after source repositories disappear", () => {
  const f = fixture();
  const spawned = spawn(f, "nested");
  const nested = join(spawned.home, "work", "human-ignored", "nested");
  mkdirSync(nested, { recursive: true });
  execFileSync("git", ["init", "-q", nested]);
  execFileSync("git", ["-C", nested, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", nested, "config", "user.name", "Test"]);
  write(join(nested, "nested.txt"), "nested-commit\n");
  execFileSync("git", ["-C", nested, "add", "."]);
  execFileSync("git", ["-C", nested, "commit", "-qm", "nested"]);
  write(join(nested, "stash.txt"), "nested-stash\n");
  execFileSync("git", ["-C", nested, "add", "stash.txt"]);
  execFileSync("git", ["-C", nested, "stash", "push", "-qm", "nested stash"]);
  assert.match(execFileSync("git", ["-C", nested, "stash", "list"], { encoding: "utf8" }), /nested stash/);

  const retired = cli(f, ["retire", "dev-nested", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.ok(recovery.classes.includes("nested repository state"));
  rmSync(f.repo, { recursive: true, force: true });
  const recoveredNested = join(recovery.path, "repo", "human-ignored", "nested");
  assert.match(execFileSync("git", ["-C", recoveredNested, "log", "-1", "--format=%s"], { encoding: "utf8" }), /nested/);
  assert.match(execFileSync("git", ["-C", recoveredNested, "stash", "list"], { encoding: "utf8" }), /nested stash/);
  assert.equal(existsSync(join(recoveredNested, ".git")), true);
});

/** Git status as the retire verification reads it. */
const porcelain = (repo) => execFileSync("git", ["-C", repo, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--ignore-submodules=none"], { encoding: "utf8" });
/** Work that forces a repository recovery: a local-only branch commit, an untracked file and changed home bytes. */
function dirtyWork(home) {
  const work = join(home, "work");
  write(join(work, "commit.txt"), "local-only\n");
  execFileSync("git", ["-C", work, "add", "commit.txt"]);
  execFileSync("git", ["-C", work, "commit", "-qm", "local only"]);
  write(join(work, "untracked.txt"), "untracked\n");
  write(join(home, "notes.md"), "home bytes\n");
  return work;
}

test("retire preserves a worktree whose paths are excluded only by the COMMON dir's info/exclude — an empty directory, a written one and a file; a nested repository's own exclude too", () => {
  // A fresh recovery clone has no info/exclude: a path excluded only there was `!!` in the source and `??`
  // (or, for an empty directory, absent) in the clone, so the status comparison refused every retire
  // with E_WORK_PRESERVATION_FAILED. The recovery now carries the source's effective excludes.
  const f = fixture();
  const spawned = spawn(f, "excl");
  write(join(f.repo, ".git", "info", "exclude"), "# local only\n.scratch/\n.cache-local/\nlocal-notes.txt\n");
  const work = dirtyWork(spawned.home);
  mkdirSync(join(work, ".scratch")); // EMPTY and excluded: `!! .scratch/` in the source only (the co-lead's real case)
  write(join(work, ".cache-local", "blob.bin"), "cache\n");
  write(join(work, "local-notes.txt"), "notes\n");
  const nested = join(work, "human-ignored", "nested");
  mkdirSync(nested, { recursive: true });
  execFileSync("git", ["init", "-q", nested]);
  execFileSync("git", ["-C", nested, "-c", "user.email=t@example.invalid", "-c", "user.name=T", "commit", "-q", "--allow-empty", "-m", "nested"]);
  write(join(nested, ".git", "info", "exclude"), ".nested-scratch/\n");
  mkdirSync(join(nested, ".nested-scratch"));
  const status = porcelain(work), nestedStatus = porcelain(nested);
  assert.match(status, /!! \.scratch\/\0/, "the fixture reproduces the empty excluded directory");

  const retired = cli(f, ["retire", "dev-excl", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.ok(recovery?.path, retired.stdout);
  const repo = join(recovery.path, "repo");
  assert.equal(porcelain(repo), status, "the recovered status equals the source's");
  assert.equal(porcelain(join(repo, "human-ignored", "nested")), nestedStatus);
  assert.equal(readFileSync(join(repo, ".cache-local", "blob.bin"), "utf8"), "cache\n");
  const manifest = JSON.parse(readFileSync(join(recovery.path, "recovery.json"), "utf8"));
  assert.deepEqual(manifest.excludes.map((e) => [e.repo, e.kind]), [[".", "info/exclude"], ["human-ignored/nested", "info/exclude"]], "the operator sees which exclude sources were carried");
  assert.equal(realpathSync(manifest.excludes[0].path), realpathSync(join(f.repo, ".git", "info", "exclude")));
});

test("retire preserves a worktree whose paths are excluded only by the repository's core.excludesFile, with Git's precedence (info/exclude outranks it)", () => {
  const f = fixture();
  const spawned = spawn(f, "exfile");
  const excludesFile = join(f.base, "repo-excludes");
  write(excludesFile, ".scratch/\n*.log\n");
  execFileSync("git", ["-C", f.repo, "config", "core.excludesFile", excludesFile]);
  write(join(f.repo, ".git", "info", "exclude"), "!keep.log\n"); // re-includes what core.excludesFile ignores
  const work = dirtyWork(spawned.home);
  mkdirSync(join(work, ".scratch"));
  write(join(work, "keep.log"), "kept\n");
  write(join(work, "drop.log"), "dropped\n");
  const status = porcelain(work);
  assert.match(status, /!! \.scratch\/\0/);
  assert.match(status, /\?\? keep\.log\0/); assert.match(status, /!! drop\.log\0/);

  const retired = cli(f, ["retire", "dev-exfile", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.equal(porcelain(join(recovery.path, "repo")), status);
  const manifest = JSON.parse(readFileSync(join(recovery.path, "recovery.json"), "utf8"));
  assert.deepEqual(manifest.excludes.map((e) => e.kind), ["core.excludesFile", "info/exclude"]);
  assert.equal(spawnSync("git", ["-C", join(recovery.path, "repo"), "config", "--local", "--get", "core.excludesFile"]).status, 1, "self-contained: the recovery carries the patterns, not a config pointer");
  assert.match(readFileSync(join(recovery.path, "repo", ".git", "info", "exclude"), "utf8"), /^\.scratch\/$/m);
});

test("a status disagreement names the differing rows from both sides — sorted, absent as null, renames with their source, capped at 10 with the total", () => {
  assert.deepEqual(statusDisagreement("!! .scratch/\0?? same\0R  new\0old\0", " M x\0?? same\0?? .scratch/x\0"), { total: 4, rows: [
    { path: ".scratch/", source: "!!", recovery: null },
    { path: ".scratch/x", source: null, recovery: "??" },
    { path: "new", source: "R  ← old", recovery: null },
    { path: "x", source: null, recovery: " M" },
  ] });
  assert.deepEqual(statusDisagreement("?? a\0", "?? a\0"), { rows: [], total: 0 });
  const many = Array.from({ length: 12 }, (_, i) => `!! f${String(i).padStart(2, "0")}\0`).join("");
  const capped = statusDisagreement(many, "");
  assert.equal(capped.total, 12);
  assert.deepEqual(capped.rows.map((r) => r.path), Array.from({ length: 10 }, (_, i) => `f${String(i).padStart(2, "0")}`));
});

test("retire preserves a worktree judged under the source repository's status settings: core.fileMode=false with mode-only changes, info/attributes, a key the source leaves unset — and in a nested repository", () => {
  // A recovery clone probes its own core.fileMode/ignoreCase/… and has no info/attributes, so the same bytes
  // and index read differently there: every retire of such an instance refused. The recovery now takes
  // the source's settings (recovery.json `statusConfig`).
  const f = fixture();
  const spawned = spawn(f, "statuscfg");
  const work = dirtyWork(spawned.home);
  write(join(work, "crlf.txt"), "a\r\nb\r\n");
  execFileSync("git", ["-C", work, "add", "crlf.txt"]);
  execFileSync("git", ["-C", work, "commit", "-qm", "crlf"]);
  execFileSync("git", ["-C", f.repo, "config", "core.fileMode", "false"]);
  chmodSync(join(work, "tracked.txt"), 0o755); // mode-only: clean in the source
  write(join(f.repo, ".git", "info", "attributes"), "*.txt text\n");
  utimesSync(join(work, "crlf.txt"), new Date(2020, 0, 1), new Date(2020, 0, 1)); // ` M` (needs normalizing) in the source
  execFileSync("git", ["-C", f.repo, "config", "--unset-all", "core.precomposeUnicode"]); // unset in the source; a clone probes its own on macOS
  const nested = join(work, "human-ignored", "nested");
  mkdirSync(nested, { recursive: true });
  execFileSync("git", ["init", "-q", nested]);
  write(join(nested, "run.sh"), "echo\n");
  execFileSync("git", ["-C", nested, "add", "run.sh"]);
  execFileSync("git", ["-C", nested, "-c", "user.email=t@example.invalid", "-c", "user.name=T", "commit", "-qm", "nested"]);
  execFileSync("git", ["-C", nested, "config", "core.fileMode", "false"]);
  chmodSync(join(nested, "run.sh"), 0o755);
  const status = porcelain(work), nestedStatus = porcelain(nested);
  assert.ok(!/ tracked\.txt\0/.test(status) && / M crlf\.txt\0/.test(status), JSON.stringify(status));

  const retired = cli(f, ["retire", "dev-statuscfg", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  const repo = join(recovery.path, "repo");
  assert.equal(porcelain(repo), status, "the recovered status equals the source's");
  assert.equal(porcelain(join(repo, "human-ignored", "nested")), nestedStatus);
  const local = (r, key) => spawnSync("git", ["-C", r, "config", "--local", "--get", key], { encoding: "utf8" });
  assert.equal(local(repo, "core.fileMode").stdout.trim(), "false");
  assert.equal(local(join(repo, "human-ignored", "nested"), "core.fileMode").stdout.trim(), "false");
  assert.equal(local(repo, "core.precomposeUnicode").status, 1, "a key the source leaves unset is unset in the recovery too");
  assert.equal(readFileSync(join(repo, ".git", "info", "attributes"), "utf8"), "*.txt text\n");
  const manifest = JSON.parse(readFileSync(join(recovery.path, "recovery.json"), "utf8"));
  const rows = manifest.statusConfig.map((c) => [c.repo, c.kind, c.key ?? null, c.value ?? null]);
  assert.deepEqual(rows.filter((r) => r[0] === "."), [[".", "config", "core.fileMode", "false"], ...(process.platform === "darwin" ? [[".", "config", "core.precomposeUnicode", null]] : []), [".", "info/attributes", null, null]]);
  assert.deepEqual(rows.filter((r) => r[0] !== "."), [["human-ignored/nested", "config", "core.fileMode", "false"]]);
});

/** Give `repo` a config-local core.attributesFile marking `files` as text, and make their stat stale so status re-reads them. */
function staleUnderTextAttribute(repo, base, files, patterns = "*.txt text\n") {
  const attributes = join(base, `attributes-${files.length}`);
  write(attributes, patterns);
  execFileSync("git", ["-C", repo, "config", "core.attributesFile", attributes]);
  for (const file of files) utimesSync(file, new Date(2020, 0, 1), new Date(2020, 0, 1));
}

test("E_WORK_PRESERVATION_FAILED names the differing status rows (the first 10, and how many more) in its message and --json details, for the worktree and for a nested repository; the home is kept", () => {
  // Trigger: a core.attributesFile set in the source repository's config (`*.txt text`) over files
  // committed with CRLF, their stat made stale: ` M` (needs normalizing) in the source, clean in the
  // recovery. A recovery deliberately does not carry that pointer to a host file (see carryStatusConfig);
  // if it ever does, pick another disagreement here.
  const f = fixture();
  const spawned = spawn(f, "diffrows");
  const work = join(spawned.home, "work");
  const names = Array.from({ length: 11 }, (_, i) => `f${String(i).padStart(2, "0")}.txt`);
  for (const n of names) write(join(work, n), `${n}\r\n`);
  execFileSync("git", ["-C", work, "add", ...names]);
  execFileSync("git", ["-C", work, "commit", "-qm", "eleven files"]);
  staleUnderTextAttribute(f.repo, f.base, names.map((n) => join(work, n)));
  write(join(work, "untracked.txt"), "forces a repository recovery\n");
  let retired = cli(f, ["retire", "dev-diffrows", "--json"]);
  assert.equal(retired.status, 1, retired.stdout);
  let error = JSON.parse(retired.stdout).error;
  assert.equal(error.code, "E_WORK_PRESERVATION_FAILED");
  assert.match(error.message, /recovered Git index\/status disagreed with the source: f00\.txt \(source  M, recovery absent\); f01\.txt .*; f09\.txt \(source  M, recovery absent\); and 1 more$/);
  assert.deepEqual(error.details, { home: spawned.home, statusDisagreement: { repo: ".", rows: names.slice(0, 10).map((path) => ({ path, source: " M", recovery: null })), total: 11 } });
  assert.equal(existsSync(spawned.home), true, "the home is kept");

  // A nested repository's disagreement names that repository.
  const g = fixture();
  const nestedSpawn = spawn(g, "nestedrows");
  const nested = join(nestedSpawn.home, "work", "human-ignored", "nested");
  mkdirSync(nested, { recursive: true });
  execFileSync("git", ["init", "-q", nested]);
  write(join(nested, "run.sh"), "echo\r\n");
  execFileSync("git", ["-C", nested, "add", "run.sh"]);
  execFileSync("git", ["-C", nested, "-c", "user.email=t@example.invalid", "-c", "user.name=T", "commit", "-qm", "nested"]);
  staleUnderTextAttribute(nested, g.base, [join(nested, "run.sh")], "*.sh text\n");
  retired = cli(g, ["retire", "dev-nestedrows", "--json"]);
  assert.equal(retired.status, 1, retired.stdout);
  error = JSON.parse(retired.stdout).error;
  assert.match(error.message, /nested recovery human-ignored\/nested Git state disagreed with source: run\.sh \(source  M, recovery absent\)$/);
  assert.deepEqual(error.details.statusDisagreement, { repo: "human-ignored/nested", rows: [{ path: "run.sh", source: " M", recovery: null }], total: 1 });
});

test("branch-only commits are recovered only when retirement deletes their last local ref", () => {
  const ordinary = fixture();
  const ordinarySpawn = spawn(ordinary, "branch-kept");
  write(join(ordinarySpawn.home, "work", "commit.txt"), "unique\n");
  execFileSync("git", ["-C", join(ordinarySpawn.home, "work"), "add", "."]);
  execFileSync("git", ["-C", join(ordinarySpawn.home, "work"), "commit", "-qm", "unique ordinary"]);
  const ordinaryTip = execFileSync("git", ["-C", join(ordinarySpawn.home, "work"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const ordinaryRetire = cli(ordinary, ["retire", "dev-branch-kept", "--json"]);
  assert.equal(ordinaryRetire.status, 0, `${ordinaryRetire.stderr}\n${ordinaryRetire.stdout}`);
  assert.equal(execFileSync("git", ["-C", ordinary.repo, "rev-parse", "refs/heads/agents/dev-branch-kept"], { encoding: "utf8" }).trim(), ordinaryTip);

  const deleting = fixture();
  const deletingSpawn = spawn(deleting, "branch-deleted");
  write(join(deletingSpawn.home, "work", "commit.txt"), "unique-delete\n");
  execFileSync("git", ["-C", join(deletingSpawn.home, "work"), "add", "."]);
  execFileSync("git", ["-C", join(deletingSpawn.home, "work"), "commit", "-qm", "unique deleting"]);
  const deletingTip = execFileSync("git", ["-C", join(deletingSpawn.home, "work"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const deletingRetire = cli(deleting, ["retire", "dev-branch-deleted", "--delete-branch", "--json"]);
  assert.equal(deletingRetire.status, 0, `${deletingRetire.stderr}\n${deletingRetire.stdout}`);
  const result = JSON.parse(deletingRetire.stdout);
  assert.ok(result.workRecovery.classes.includes("branch-only local commits"));
  assert.equal(execFileSync("git", ["-C", join(result.workRecovery.path, "repo"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), deletingTip);
  const gone = spawnSync("git", ["-C", deleting.repo, "rev-parse", "--verify", "refs/heads/agents/dev-branch-deleted"]);
  assert.notEqual(gone.status, 0, "the requested original branch deletion did not occur");
});

test("repository-global stash survives ordinary retirement without acting as a guard", () => {
  const f = fixture();
  const spawned = spawn(f, "stash");
  write(join(spawned.home, "work", "tracked.txt"), "stash bytes\n");
  execFileSync("git", ["-C", join(spawned.home, "work"), "stash", "push", "-qm", "survival"]);
  const stash = execFileSync("git", ["-C", f.repo, "rev-parse", "refs/stash"], { encoding: "utf8" }).trim();
  const retired = cli(f, ["retire", "dev-stash", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  assert.equal(JSON.parse(retired.stdout).workRecovery, undefined, "repository-global stash incorrectly blocked clean retirement");
  assert.equal(execFileSync("git", ["-C", f.repo, "rev-parse", "refs/stash"], { encoding: "utf8" }).trim(), stash);
});

test("clean production retire remains one command and creates no recovery", () => {
  const f = fixture();
  const spawned = spawn(f, "clean");
  const retired = cli(f, ["retire", "dev-clean", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const result = JSON.parse(retired.stdout);
  assert.equal(result.workRecovery, undefined);
  assert.equal(existsSync(spawned.home), false);
});

test("recovery copies only staged objects the clone lacks: one batch check, no per-row Git launches", () => {
  const f = fixture();
  // A logging git on PATH: every launch is one line, then the real git runs.
  const log = join(f.base, "git-launches.log");
  write(join(f.base, "bin", "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexec /usr/bin/git "$@"\n`, 0o755);
  f.env.GIT_LAUNCH_LOG = log;
  const spawned = spawn(f, "batch");
  const work = join(spawned.home, "work");
  for (let i = 0; i < 40; i++) write(join(work, "src", `file-${i}.txt`), `committed ${i}\n`);
  execFileSync("git", ["-C", work, "add", "."]);
  execFileSync("git", ["-C", work, "commit", "-qm", "forty files"]);
  write(join(work, "staged-only.txt"), "staged, never committed\n");
  execFileSync("git", ["-C", work, "add", "staged-only.txt"]);
  write(join(work, "loose.txt"), "untracked human bytes\n");
  writeFileSync(log, "");
  const retired = cli(f, ["retire", "dev-batch", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recoveryRepo = join(JSON.parse(retired.stdout).workRecovery.path, "repo");
  const launches = readFileSync(log, "utf8").split("\n").filter(Boolean);
  const perRow = launches.filter((l) => / cat-file blob | hash-object -w --stdin$/.test(l));
  assert.equal(perRow.length, 2, `expected one cat-file + one hash-object for the single staged-only blob, saw:\n${perRow.join("\n")}`);
  assert.equal(launches.filter((l) => l.includes("cat-file --batch-check")).length, 2, "one existence check before the copy and one proof after it");
  assert.equal(execFileSync("git", ["-C", recoveryRepo, "diff", "--cached", "--name-only"], { encoding: "utf8" }).trim(), "staged-only.txt");
  assert.equal(readFileSync(join(recoveryRepo, "staged-only.txt"), "utf8"), "staged, never committed\n");
  assert.equal(readFileSync(join(recoveryRepo, "loose.txt"), "utf8"), "untracked human bytes\n");
});

test("K3b retention: plain retire RE-HOMES the worktree (dirty state intact, branch untouched) under <workspace>/.agents/worktrees/<repo>/<branch>; --discard-worktree removes; --delete-branch uses the worktree's verified branch and implies discard", () => {
  const f = fixture();
  const spawned = spawn(f, "keep");
  const work = join(spawned.home, "work");
  const git = (...args) => execFileSync("git", ["-C", work, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("switch", "--quiet", "-c", "feat/kept-after-retire");
  write(join(work, "wip.txt"), "uncommitted work\n"); git("add", "wip.txt");
  write(join(work, "scratch.txt"), "untracked\n");
  const head = git("rev-parse", "HEAD");
  const retired = cli(f, ["retire", "dev-keep", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const r = JSON.parse(retired.stdout);
  assert.equal(r.worktreeRemoved, false); assert.equal(r.branchDeleted, false);
  assert.equal(r.retention.worktree, "retained"); assert.equal(r.retention.branch, "feat/kept-after-retire");
  assert.notEqual(r.retention.recordedBranch, "feat/kept-after-retire", "recorded spawn branch is reported as recorded, not used");
  assert.match(r.retention.movedTo, /\/\.agents\/worktrees\/[^/]+\/feat-kept-after-retire$/);
  assert.equal(existsSync(spawned.home), false, "home released");
  const moved = r.retention.movedTo;
  const g2 = (...args) => execFileSync("git", ["-C", moved, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  assert.equal(g2("symbolic-ref", "--short", "HEAD"), "feat/kept-after-retire"); assert.equal(g2("rev-parse", "HEAD"), head);
  assert.equal(readFileSync(join(moved, "wip.txt"), "utf8"), "uncommitted work\n"); assert.match(g2("status", "--porcelain"), /^A  wip\.txt/m, "staged state survives the move");
  assert.equal(readFileSync(join(moved, "scratch.txt"), "utf8"), "untracked\n");
  const repoGit = (...args) => execFileSync("git", ["-C", f.repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const listed = repoGit("worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).map((l) => { try { return realpathSync(l.slice(9)); } catch { return l.slice(9); } });
  assert.ok(listed.includes(realpathSync(moved)), `the repository knows the re-homed worktree: ${listed.join(", ")}`);
  assert.ok(repoGit("branch", "--list", "feat/kept-after-retire"), "branch untouched");

  // Discard restores removal; delete-branch uses the VERIFIED branch and implies discard.
  const d = spawn(f, "discard"); const dw = join(d.home, "work");
  execFileSync("git", ["-C", dw, "switch", "--quiet", "-c", "feat/to-delete"]);
  const rd = JSON.parse(cli(f, ["retire", "dev-discard", "--delete-branch", "--json"]).stdout);
  assert.equal(rd.retention.worktree, "removed"); assert.equal(rd.retention.branchDeleted, "feat/to-delete"); assert.equal(rd.branchDeleted, true);
  assert.equal(repoGit("branch", "--list", "feat/to-delete"), "", "the worktree's actual branch was deleted, not the recorded one");
  assert.ok(repoGit("branch", "--list", rd.retention.recordedBranch), "the recorded spawn branch (never checked out after the switch) is untouched");
  assert.equal(existsSync(dw), false);
});

test("K3 guarded Remove: retire --plan-revision/--idempotency-key revalidates the plan (E_PLAN_STALE with the fresh plan, nothing retired), replays a repeated key, and the version probe advertises lifecycle-plans so a GUI never sends --plan to an older CLI", () => {
  const f = fixture();
  const s = spawn(f, "guard");
  const probe = JSON.parse(cli(f, ["version", "--json"]).stdout);
  for (const feat of ["lifecycle-plans", "retire-retention", "instance-git", "readiness", "spawn-preview", "instance-events", "schedule-history"]) assert.ok(probe.features.includes(feat), feat);
  assert.equal(probe.lifecycleApi, 1);
  const plan = JSON.parse(cli(f, ["retire", "dev-guard", "--plan", "--json"]).stdout).result;
  assert.equal(plan.action, "retire"); assert.match(plan.planRevision, /^[a-f0-9]{24}$/);
  // Facts move (dirty work appears) → the shown plan is stale → refused, nothing retired.
  write(join(s.home, "work", "late.txt"), "changed after the plan was shown\n");
  const stale = cli(f, ["retire", "dev-guard", "--plan-revision", plan.planRevision, "--idempotency-key", "k-1", "--json"]);
  assert.equal(stale.status, 1); const env = JSON.parse(stale.stdout); assert.equal(env.error.code, "E_PLAN_STALE"); assert.notEqual(env.error.details.plan.planRevision, plan.planRevision);
  assert.ok(existsSync(s.home), "stale plan retired nothing");
  assert.equal(cli(f, ["retire", "dev-guard", "--plan-revision", plan.planRevision, "--json"]).status, 1, "revision without key refuses");
  const fresh = JSON.parse(cli(f, ["retire", "dev-guard", "--plan", "--json"]).stdout).result;
  const done = JSON.parse(cli(f, ["retire", "dev-guard", "--plan-revision", fresh.planRevision, "--idempotency-key", "k-2", "--json"]).stdout);
  assert.equal(done.retired, "dev-guard"); assert.equal(done.replayed, false); assert.equal(done.idempotencyKey, "k-2"); assert.equal(existsSync(s.home), false);
  const againEnv = JSON.parse(cli(f, ["retire", "dev-guard", "--plan-revision", fresh.planRevision, "--idempotency-key", "k-2", "--json"]).stdout);
  const again = againEnv.result ?? againEnv; // replay answers in the JSON-v1 envelope; a first retire prints its raw receipt (pre-existing shape)
  assert.equal(again.replayed, true); assert.equal(again.retired, "dev-guard"); assert.equal(again.retention.worktree, done.retention.worktree, "the recorded receipt, not a second retirement");
});

test("K3 pin 2: --delete-branch through a plan is bound to the CONFIRMED branch — a branch switch during retirement (hook window) deletes nothing and is reported", () => {
  // The retire hook set is the one CAPTURED at spawn (capabilityRuntime), so the
  // switching capability is declared by the soul BEFORE the instance is spawned.
  const f = fixture({ capabilities: { "acme.switcher": {
    manifest: { description: "switches the branch during retire", hooks: { retire: "hook.mjs" } },
    files: { "hook.mjs": "import {execFileSync} from 'node:child_process'; import {join} from 'node:path'; execFileSync('git', ['-C', join(process.env.OATS_HOME, 'work'), 'switch', '--quiet', '-c', 'feat/sneaky']); console.log(JSON.stringify({ meta: { retired: true } }));" },
  } } });
  const s = spawn(f, "bind"); const work = join(s.home, "work");
  execFileSync("git", ["-C", work, "switch", "--quiet", "-c", "feat/confirmed"]);
  const plan = JSON.parse(cli(f, ["retire", "dev-bind", "--plan", "--json"]).stdout).result;
  assert.equal(plan.facts.work.branch, "feat/confirmed");
  // The hook switches the branch after the plan comparison, before deletion.
  const fresh = plan;
  const r = JSON.parse(cli(f, ["retire", "dev-bind", "--plan-revision", fresh.planRevision, "--idempotency-key", "b-1", "--delete-branch", "--json"]).stdout);
  assert.equal(r.retired, "dev-bind");
  assert.equal(r.branchDeleted, false, `no branch deleted: ${JSON.stringify(r.retention)} hooks=${JSON.stringify(r.hooks ?? r.capabilityMeta)}`);
  assert.deepEqual(r.retention.branchDeletionSkipped, { expected: "feat/confirmed", actual: "feat/sneaky", reason: "the worktree's branch changed between confirmation and deletion; nothing was deleted" });
  const branches = execFileSync("git", ["-C", f.repo, "branch", "--list", "feat/*"], { encoding: "utf8" });
  assert.match(branches, /feat\/confirmed/); assert.match(branches, /feat\/sneaky/, "neither the confirmed nor the switched branch was deleted");
});
