import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn as spawnProcess, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { capabilityFiles, v2Deployment } from "./helpers/v2-deployment.mjs";
import { linkExecutables, waitUntil as waitFor } from "./helpers/host-fixture.mjs";
import { statusDisagreement } from "../lib/core.mjs";
import { workRecoveryLines } from "../lib/retire-output.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const temporaryDirectories = [];

function write(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, mode === undefined ? undefined : { mode });
}

/** A workspace deployment whose soul dev works in a worktree of the member clone
 *  (which carries .gitignore + tracked.txt), or in `work` mode when given;
 *  `capabilities` are member capabilities the soul declares (their hooks are
 *  captured at spawn). `commit` changes the member repository (fx.commit). */
function fixture({ capabilities = {}, work = "worktree" } = {}) {
  const declared = Object.fromEntries(Object.keys(capabilities).map((id) => [id, { from: "here" }]));
  const fx = v2Deployment({
    souls: { dev: { soul: { work, ...(Object.keys(declared).length ? { capabilities: declared } : {}) }, agents: "# Dev\n" } },
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
  return { base: fx.base, dep: fx.dep, repo, root: fx.root, env, commit: fx.commit };
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

test("corrupt independent authority fails closed before quiescence or deletion", () => {
  const f = fixture();
  const spawned = spawn(f, "receipt-corrupt");
  write(join(spawned.home, "work", "cache", "later.bin"), "generated-later\n");
  const baselineDir = join(dirname(spawned.home), ".oats-retirement", "baselines");
  write(join(baselineDir, readdirSync(baselineDir)[0]), "{not-json\n");
  const retired = cli(f, ["retire", "dev-receipt-corrupt", "--json"]);
  assert.notEqual(retired.status, 0, "corrupt authority did not fail closed");
  assert.equal(JSON.parse(retired.stdout).error.code, "E_WORK_INSPECTION_FAILED", retired.stdout);
  assert.equal(existsSync(spawned.home), true);
});

test("0.30 a home without its session receipt (before 0.25.9) retires when its session is observably absent — hooks run, work is preserved, --force too — and refuses a live or ambiguous one, --force included", () => {
  const hook = "import {writeFileSync} from 'node:fs'; import {basename, dirname, join} from 'node:path'; writeFileSync(join(dirname(process.env.OATS_HOME), `retire-hook-ran-${basename(process.env.OATS_HOME)}`), 'ran\\n'); console.log(JSON.stringify({meta:{retired:true}}));\n";
  const f = fixture({ capabilities: { "acme.undo": { manifest: { description: "undo", hooks: { retire: "hook.mjs" } }, files: { "hook.mjs": hook } } } });
  const socket = join(f.base, "legacy-tmux.sock");
  const tmux = (...args) => execFileSync("tmux", ["-u", "-S", socket, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const baselineDir = (home) => join(dirname(home), ".oats-retirement", "baselines");
  /** A launched home as a pre-0.25.9 kernel left it: an endpoint in instance.json and no receipt. */
  const legacy = (purpose) => {
    const before = new Set(existsSync(join(f.root, "dev", "instances", ".oats-retirement", "baselines")) ? readdirSync(join(f.root, "dev", "instances", ".oats-retirement", "baselines")) : []);
    const spawned = spawn(f, purpose);
    for (const b of readdirSync(baselineDir(spawned.home))) if (!before.has(b)) rmSync(join(baselineDir(spawned.home), b));
    const metaPath = join(spawned.home, "instance.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    write(metaPath, JSON.stringify({ ...meta, launched: true, tmux: { session: "legacy", window: spawned.instance, socket } }, null, 2) + "\n");
    return spawned;
  };
  const plan = (instance) => { const r = cli(f, ["retire", instance, "--plan", "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout).result; };
  const hookRan = (home) => existsSync(join(dirname(home), `retire-hook-ran-${basename(home)}`));
  try {
    // Absent: the recorded tmux server is not running. The plan says so; retire runs the hook and preserves the work.
    const gone = legacy("gone");
    write(join(gone.home, "work", "notes.txt"), "human-bytes\n");
    let p = plan(gone.instance);
    assert.equal(p.facts.session.state, "absent"); assert.equal(p.facts.session.present, false); assert.equal(p.facts.session.established, true);
    assert.match(p.facts.session.note, /before 0\.25\.9.*tmux server .* is not running/);
    assert.ok(p.notes.some((n) => /^session absent: .*nothing needs quiescing$/.test(n)), JSON.stringify(p.notes));
    let r = cli(f, ["retire", gone.instance, "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(existsSync(gone.home), false);
    assert.ok(hookRan(gone.home), "the retire hook ran");
    const recovery = JSON.parse(r.stdout).workRecovery;
    assert.ok(recovery?.path && existsSync(recovery.path), "the home's work was preserved");

    // Live: the recorded window is there. Refused, --force included; the plan says it is not observably absent.
    tmux("new-session", "-d", "-s", "legacy", "-n", "keeper", "sleep 600");
    const live = legacy("live");
    tmux("new-window", "-d", "-t", "legacy:", "-n", live.instance, "sleep 600");
    p = plan(live.instance);
    assert.equal(p.facts.session.state, "unestablished"); assert.equal(p.facts.session.established, false);
    assert.match(p.facts.session.note, /recorded window legacy:.* is still present/);
    for (const extra of [[], ["--force"]]) {
      r = cli(f, ["retire", live.instance, ...extra, "--json"]);
      assert.notEqual(r.status, 0, `retired a live session ${extra.join(" ")}`);
      const err = JSON.parse(r.stdout).error;
      assert.equal(err.code, "E_RUNTIME_ENDPOINT_UNKNOWN");
      assert.match(err.message, /not observably absent \(the recorded window .* is still present\); stop that session yourself/);
      assert.equal(existsSync(live.home), true); assert.equal(hookRan(live.home), false);
    }
    // Ambiguous: the recorded window is gone, but a pane it cannot identify works in the home. Refused.
    tmux("kill-window", "-t", `=legacy:=${live.instance}`);
    tmux("new-window", "-d", "-t", "legacy:", "-n", "renamed", "-c", live.home, "sleep 600");
    r = cli(f, ["retire", live.instance, "--force", "--json"]);
    assert.notEqual(r.status, 0);
    assert.match(JSON.parse(r.stdout).error.message, /a tmux pane \(legacy:renamed\) on .* works in this home/);
    assert.equal(existsSync(live.home), true);
    // Once nothing works in the home, the same home retires with --force.
    tmux("kill-window", "-t", "=legacy:=renamed");
    r = cli(f, ["retire", live.instance, "--force", "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(existsSync(live.home), false); assert.ok(hookRan(live.home));
  } finally { try { tmux("kill-server"); } catch { /* not running */ } }
});

test("0.30 a home without its session receipt is absent only when no live process works in it: a process on no tmux at all refuses (named by pid), with or without a recorded launch, --force included; a failed process scan refuses as ambiguous", async () => {
  const hook = "import {writeFileSync} from 'node:fs'; import {basename, dirname, join} from 'node:path'; writeFileSync(join(dirname(process.env.OATS_HOME), `retire-hook-ran-${basename(process.env.OATS_HOME)}`), 'ran\\n'); console.log(JSON.stringify({meta:{retired:true}}));\n";
  const f = fixture({ capabilities: { "acme.undo": { manifest: { description: "undo", hooks: { retire: "hook.mjs" } }, files: { "hook.mjs": hook } } } });
  const socket = join(f.base, "gone-tmux.sock");
  const baselines = join(f.root, "dev", "instances", ".oats-retirement", "baselines");
  /** A pre-0.25.9 home: no receipt; `launched` records a tmux endpoint on a server that is gone. */
  const legacy = (purpose, { launched }) => {
    const before = new Set(existsSync(baselines) ? readdirSync(baselines) : []);
    const spawned = spawn(f, purpose);
    for (const b of readdirSync(baselines)) if (!before.has(b)) rmSync(join(baselines, b));
    const metaPath = join(spawned.home, "instance.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    if (launched) write(metaPath, JSON.stringify({ ...meta, launched: true, tmux: { session: "legacy", window: spawned.instance, socket } }, null, 2) + "\n");
    return spawned;
  };
  const hookRan = (home) => existsSync(join(dirname(home), `retire-hook-ran-${basename(home)}`));
  const refusedWith = (instance, extra, re) => {
    const r = cli(f, ["retire", instance, ...extra, "--json"]);
    assert.notEqual(r.status, 0, `retired ${instance} ${extra.join(" ")}: ${r.stdout}`);
    const err = JSON.parse(r.stdout).error;
    assert.equal(err.code, "E_RUNTIME_ENDPOINT_UNKNOWN");
    assert.match(err.message, re);
  };
  const children = [];
  const worker = (cwd) => { const c = spawnProcess("sleep", ["600"], { cwd, stdio: "ignore" }); children.push(c); return c; };
  try {
    for (const launched of [true, false]) {
      // (a) the recorded server is gone / (b) no launch recorded — and a harness started by hand works in the home, on no tmux at all.
      const home = legacy(launched ? "handrun" : "unlaunched-handrun", { launched });
      const w = worker(home.home);
      await waitFor(() => { const r = cli(f, ["retire", home.instance, "--plan", "--json"]); return JSON.parse(r.stdout).result?.facts.session.note?.includes(`pid ${w.pid}`); }, "the plan names the worker");
      const p = JSON.parse(cli(f, ["retire", home.instance, "--plan", "--json"]).stdout).result;
      assert.equal(p.facts.session.established, false);
      assert.match(p.facts.session.note, new RegExp(`a process works in this home \\(pid ${w.pid} sleep\\); stop it, then retire`));
      for (const extra of [[], ["--force"]]) refusedWith(home.instance, extra, new RegExp(`not observably absent \\(a process works in this home \\(pid ${w.pid} sleep\\)`));
      assert.equal(existsSync(home.home), true); assert.equal(hookRan(home.home), false);
      // (c) once it stops, the same home retires.
      w.kill("SIGKILL");
      await waitFor(() => !JSON.stringify(JSON.parse(cli(f, ["retire", home.instance, "--plan", "--json"]).stdout).result.facts.session).includes("a process works"));
      const r = cli(f, ["retire", home.instance, "--json"]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(existsSync(home.home), false); assert.ok(hookRan(home.home));
    }
    // (d) the scan cannot run (no lsof on PATH): ambiguous, refused, --force included.
    const blind = legacy("blind", { launched: false });
    const bin = join(f.base, "no-lsof-bin");
    linkExecutables(bin, ["node", "git"]);
    const saved = f.env.PATH;
    f.env.PATH = `${join(f.base, "bin")}:${bin}`;
    try { for (const extra of [[], ["--force"]]) refusedWith(blind.instance, extra, /could not scan for a process working in this home \(lsof is not on PATH\)/); }
    finally { f.env.PATH = saved; }
    assert.equal(existsSync(blind.home), true); assert.equal(hookRan(blind.home), false);
  } finally { for (const c of children) try { c.kill("SIGKILL"); } catch { /* gone */ } }
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
  // Unset in the source; a clone probes its own on macOS. Linux git never sets it (`--unset-all` would exit 5).
  if (spawnSync("git", ["-C", f.repo, "config", "--local", "--get", "core.precomposeUnicode"]).status === 0) execFileSync("git", ["-C", f.repo, "config", "--local", "--unset-all", "core.precomposeUnicode"]);
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

// ---------- one recovery per retire; provider-owned home state is not copied ----------

const recoveryRootOf = (home) => join(dirname(home), ".oats-retirement", "recovery");
const baselineOf = (home) => join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
/** Every path under `root` whose last segment is `name`; symlinks are entries, never followed. */
function pathsNamed(root, name) {
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
/** The top-level names of a directory as a receipt's `home.paths` writes them: a directory ends in `/`. */
const topLevel = (dir) => readdirSync(dir, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).sort();

/** A capability that declares nothing and whose retire hook runs `retire`. */
const HOOK_BYTES = "written by the retire hook\n";
const RETIRE_WRITES_HOME = `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(join(process.env.OATS_INSTANCE_HOME, 'hook-note.txt'), ${JSON.stringify(HOOK_BYTES)});
console.log(JSON.stringify({ meta: { retired: true } }));
`;
const RETIRE_WRITES_WORK = `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(join(process.env.OATS_INSTANCE_HOME, 'work', 'from-retire.txt'), ${JSON.stringify(HOOK_BYTES)});
console.log(JSON.stringify({ meta: { retired: true } }));
`;
const RETIRE_WRITES_NOTHING = "console.log(JSON.stringify({ meta: { retired: true } }));\n";
const hookCapability = (retire) => ({ "acme.hook": { manifest: { description: "acts at retire", hooks: { retire: "retire.mjs" } }, files: { "retire.mjs": retire } } });

/** A provider with state of its own in the home, as a messaging provider keeps
 *  its identity: the spawn hook writes a signing key under two hidden entries,
 *  the retire hook reports whether the key was still there, writes a receipt
 *  under a third, and leaves a marker BESIDE the home that it ran. `declare`:
 *  whether the manifest declares the three as retirement.disposable.home. */
const IDENT_KEY = "ident-signing-key 7f3a9c51e0b2\n";
const IDENT_DECLARED = [".ident", ".ident-state", ".ident-id-*"];
const IDENT_SPAWN = `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.OATS_INSTANCE_HOME;
for (const dir of ['.ident', '.ident-id-wide']) {
  mkdirSync(join(home, dir), { recursive: true });
  writeFileSync(join(home, dir, 'signing.key'), ${JSON.stringify(IDENT_KEY)});
}
console.log(JSON.stringify({ meta: { minted: true } }));
`;
const identRetire = (meta) => `import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const home = process.env.OATS_INSTANCE_HOME;
const keyPresent = existsSync(join(home, '.ident', 'signing.key'));
mkdirSync(join(home, '.ident-state'), { recursive: true });
writeFileSync(join(home, '.ident-state', 'retire.json'), JSON.stringify({ at: 'retire' }));
writeFileSync(join(dirname(home), 'retire-hook-ran-' + basename(home)), 'ran');
console.log(JSON.stringify({ meta: { ...${JSON.stringify(meta)}, keyPresent } }));
`;
const identManifest = (declare) => ({ description: "a provider with state of its own in the home", hooks: { spawn: "spawn.mjs", retire: "retire.mjs" }, ...(declare ? { retirement: { disposable: { home: IDENT_DECLARED } } } : {}) });
const identCapability = ({ declare = true, meta = { retired: true } } = {}) => ({ "acme.ident": { manifest: identManifest(declare), files: { "spawn.mjs": IDENT_SPAWN, "retire.mjs": identRetire(meta) } } });
const identHookRan = (home) => existsSync(join(dirname(home), `retire-hook-ran-${basename(home)}`));
const IDENT_NOT_COPIED = [".ident", ".ident-id-wide", ".ident-state"].map((path) => ({ scope: "home", path, owner: "acme.ident" }));
/** Spawn an instance of the ident provider and give it one authored note, so a retire has a home change to preserve. */
function spawnWithNote(f, purpose) {
  const spawned = spawn(f, purpose);
  assert.equal(readFileSync(join(spawned.home, ".ident", "signing.key"), "utf8"), IDENT_KEY, "fixture premise: the spawn hook minted the key in the home");
  assert.equal(readFileSync(join(spawned.home, ".ident-id-wide", "signing.key"), "utf8"), IDENT_KEY);
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  return spawned;
}

for (const work of ["directory", "worktree"]) {
  test(`one retire writes one recovery (${work}): a retire hook's home write goes under after-hooks/, the work is copied once, and the summary says it once`, () => {
    const f = fixture({ work, capabilities: hookCapability(RETIRE_WRITES_HOME) });
    const workPart = work === "directory" ? "work" : "repo";
    const workClass = work === "directory" ? "directory work bytes" : "untracked or ignored worktree bytes";
    const a = spawn(f, "one");
    write(join(a.home, "work", "human.txt"), "human bytes\n");
    const retired = cli(f, ["retire", "dev-one", "--json"]);
    assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
    const receipt = JSON.parse(retired.stdout);
    const recovery = receipt.workRecovery;
    assert.equal(Object.hasOwn(receipt, "workRecoveries"), false, "workRecoveries is no longer emitted");
    assert.deepEqual(readdirSync(recoveryRootOf(a.home)), [basename(recovery.path)], "one recovery directory, and no staging left beside it");
    assert.deepEqual(readdirSync(recovery.path).sort(), ["after-hooks", "home", "recovery.json", workPart].sort(), "no staging left inside it");
    assert.deepEqual(recovery.afterHooks, { home: true, work: false });
    assert.deepEqual(pathsNamed(recoveryRootOf(a.home), "human.txt"), [join(recovery.path, workPart, "human.txt")], "the work is copied once");
    assert.equal(readFileSync(join(recovery.path, workPart, "human.txt"), "utf8"), "human bytes\n");
    // Positive control: the fixture reached the post-hook pass, which used to write the second directory.
    assert.equal(readFileSync(join(recovery.path, "after-hooks", "home", "hook-note.txt"), "utf8"), HOOK_BYTES);
    assert.equal(existsSync(join(recovery.path, "home", "hook-note.txt")), false, "the pre-hook snapshot does not hold what the hook wrote later");
    assert.deepEqual(readdirSync(join(recovery.path, "after-hooks")), ["home"], "only the part the hook moved is copied again");
    // First-seen order: the work class from before the hooks, then the home class the hook caused.
    assert.deepEqual(recovery.classes, [workClass, "changed instance-home bytes"]);
    // `home` names the pre-hook home/ snapshot's top-level entries, largest first.
    assert.deepEqual(recovery.home.paths.map((p) => p.path).sort(), topLevel(join(recovery.path, "home")));
    assert.ok(recovery.home.paths.some((p) => p.path === "instance.json") && recovery.home.paths.some((p) => p.path === ".oats/"), JSON.stringify(recovery.home.paths));
    assert.ok(recovery.home.paths.every((p, i, all) => i === 0 || all[i - 1].bytes >= p.bytes), "largest first");
    assert.equal(recovery.home.bytes, recovery.home.paths.reduce((n, p) => n + p.bytes, 0));
    assert.ok(recovery.bytes > recovery.home.bytes, "bytes covers the whole directory");
    assert.equal(recovery.notCopied, undefined, "nothing was declared, so nothing was left out");
    const manifest = readJson(join(recovery.path, "recovery.json"));
    assert.equal(manifest.version, 1);
    assert.equal(manifest.phase, "complete");
    assert.deepEqual(manifest.afterHooks, recovery.afterHooks);
    assert.deepEqual(manifest.home, recovery.home);
    assert.deepEqual(manifest.classes, recovery.classes);
    assert.equal(existsSync(a.home), false);

    // The text output of the same retire: the block once, and where the second snapshot is.
    const b = spawn(f, "one-text");
    write(join(b.home, "work", "human.txt"), "human bytes\n");
    const text = cli(f, ["retire", "dev-one-text"]);
    assert.equal(text.status, 0, text.stderr);
    const lines = text.stdout.split("\n");
    assert.equal(lines.filter((line) => line.includes("has been preserved")).length, 1, text.stdout);
    assert.ok(lines.includes(`Work that was not committed has been preserved: ${workClass}, changed instance-home bytes`), text.stdout);
    assert.equal(lines.filter((line) => line.includes(".oats-retirement/recovery/dev-one-text-")).length, 1, text.stdout);
    assert.match(text.stdout, /^  copied from the home: .+ — \d+(\.\d)? (B|KiB|MiB) in total$/m);
    assert.ok(lines.includes("  copied outputs: human.txt (12 B) — 12 B in total"), text.stdout);
    assert.ok(lines.includes("  after the retire hooks: home copied again under after-hooks/"), text.stdout);
    assert.equal(lines.some((line) => line.includes("not copied:")), false, text.stdout);
    assert.equal(readdirSync(recoveryRootOf(b.home)).length, 2, "one directory per retire");
  });
}

test("a home that only has something to preserve after the retire hooks still gets its one verified recovery before it is removed", () => {
  for (const [purpose, retire, where] of [
    ["late-home", RETIRE_WRITES_HOME, ["home", "hook-note.txt"]],
    ["late-work", RETIRE_WRITES_WORK, ["repo", "from-retire.txt"]],
  ]) {
    const f = fixture({ capabilities: hookCapability(retire) });
    const spawned = spawn(f, purpose);
    const retired = cli(f, ["retire", `dev-${purpose}`, "--json"]);
    assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
    const recovery = JSON.parse(retired.stdout).workRecovery;
    assert.ok(recovery?.path, `${purpose}: the hook's change was not preserved: ${retired.stdout}`);
    assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [basename(recovery.path)]);
    assert.equal(readFileSync(join(recovery.path, ...where), "utf8"), HOOK_BYTES, purpose);
    // Written by the post-hook pass as the first and only recovery: nothing was there to add to.
    assert.equal(existsSync(join(recovery.path, "after-hooks")), false, purpose);
    assert.equal(recovery.afterHooks, undefined, purpose);
    assert.equal(readJson(join(recovery.path, "recovery.json")).phase, "complete", purpose);
    assert.equal(existsSync(spawned.home), false, purpose);
  }
  // Control: the same instance is clean before its hooks. With a hook that writes nothing, nothing is preserved.
  const f = fixture({ capabilities: hookCapability(RETIRE_WRITES_NOTHING) });
  const spawned = spawn(f, "clean");
  const retired = cli(f, ["retire", "dev-clean", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  assert.equal(JSON.parse(retired.stdout).workRecovery, undefined);
  assert.equal(existsSync(recoveryRootOf(spawned.home)), false);
});

test("a retire hook that rewrites an already modified tracked file and writes the home: Git's status text does not change, and the hook's work bytes are still copied under after-hooks/", () => {
  const BEFORE = "changed before the retire\n", REWRITTEN = "rewritten by the retire hook\n";
  assert.notEqual(REWRITTEN, BEFORE, "fixture premise: the hook's bytes are not the pre-hook bytes");
  // The hook rewrites the tracked file, writes a home file, and leaves beside the home what Git
  // reports once it has written (the kernel's own status command), for this test to read.
  const retire = `import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const home = process.env.OATS_INSTANCE_HOME;
const work = join(home, 'work');
writeFileSync(join(work, 'tracked.txt'), ${JSON.stringify(REWRITTEN)});
writeFileSync(join(home, 'hook-note.txt'), ${JSON.stringify(HOOK_BYTES)});
const status = execFileSync('git', ['-C', work, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none'], { encoding: 'utf8' });
writeFileSync(join(dirname(home), 'status-after-hook-' + basename(home)), status);
console.log(JSON.stringify({ meta: { retired: true } }));
`;
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "same-status");
  const work = join(spawned.home, "work");
  assert.equal(readFileSync(join(work, "tracked.txt"), "utf8"), "base\n", "fixture premise: tracked.txt is committed");
  write(join(work, "tracked.txt"), BEFORE);
  const statusBefore = porcelain(work);
  assert.ok(statusBefore.split("\0").includes(" M tracked.txt"), `fixture premise: the file is modified before the retire, saw ${JSON.stringify(statusBefore)}`);

  const retired = cli(f, ["retire", "dev-same-status", "--discard-worktree", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const receipt = JSON.parse(retired.stdout);
  const recovery = receipt.workRecovery;
  assert.ok(recovery?.path, `a recovery was written: ${retired.stdout}`);
  // The premises: the hook ran, and its write left Git's status text as it was.
  assert.equal(readFileSync(join(dirname(spawned.home), `status-after-hook-${basename(spawned.home)}`), "utf8"), statusBefore, "fixture premise: the status text is the same after the hook's write");
  assert.equal(readFileSync(join(recovery.path, "after-hooks", "home", "hook-note.txt"), "utf8"), HOOK_BYTES, "the hook's home file is copied under after-hooks/");
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [basename(recovery.path)], "one recovery directory");
  assert.equal(readFileSync(join(recovery.path, "repo", "tracked.txt"), "utf8"), BEFORE, "the pre-hook snapshot is untouched");
  // The worktree is discarded: the hook's bytes exist nowhere else.
  assert.equal(receipt.retention.worktree, "removed");
  assert.equal(existsSync(work), false, "the worktree is gone");
  assert.equal(existsSync(spawned.home), false);
  assert.equal(existsSync(join(recovery.path, "after-hooks", "repo", "tracked.txt")), true, "the work the hook changed is copied again under after-hooks/, although the status text did not change");
  assert.equal(readFileSync(join(recovery.path, "after-hooks", "repo", "tracked.txt"), "utf8"), REWRITTEN);
  assert.deepEqual(recovery.afterHooks, { home: true, work: true });
  assert.deepEqual(readJson(join(recovery.path, "recovery.json")).afterHooks, { home: true, work: true });
});

// ---- A retire hook that moves the work without moving a row of Git's status ----
// What a recovery's work copy carries is more than the files: the commit, the index and an
// in-progress operation's state, and the same for a nested repository. Each hook below moves
// one of them, leaves every status row as it was, and also writes a home file, so the
// post-hook pass runs. Each retire discards the worktree: the recovery is where the hook's
// change has to be.

/** A retire hook's source. `body` runs with `home`, `work`, `git(...args)` (in the work tree),
 *  `gitIn(dir)` and `seen` in scope. The hook then writes a home file (unless `home` is false)
 *  and leaves beside the home, as JSON, what `body` put in `seen` and `seen.status`: the
 *  kernel's status command, run once the hook has written. */
const quietHook = (body, { home = true } = {}) => `import { execFileSync } from 'node:child_process';
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
function retireAfterQuietHook(f, spawned, statusBefore, { flags = ["--discard-worktree"], home = true } = {}) {
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
function assertBothCopiedAgain(recovery) {
  assert.deepEqual(recovery.afterHooks, { home: true, work: true });
  assert.deepEqual(readJson(join(recovery.path, "recovery.json")).afterHooks, { home: true, work: true });
}
const statusRowsIn = (status) => status.split("\0").filter(Boolean);
/** The commit a repository is at. `repo` must be a repository's own top level: Git would otherwise answer for the one around it. */
const headOf = (repo) => execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

test("a snapshot that was home-only before the hooks does not hide a later work change: a retire hook rewrites a file under an ignored directory that Git reports whole, and its bytes are copied under after-hooks/repo/", () => {
  const AT_SPAWN = "generated at spawn\n", REWRITTEN = "regenerated by the retire hook\n";
  // The spawn hook writes the ignored file, so the spawn baseline holds its bytes: at retire it is no change.
  const spawnHook = `import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const cache = join(process.env.OATS_INSTANCE_HOME, 'work', 'cache');
mkdirSync(cache, { recursive: true });
writeFileSync(join(cache, 'gen.bin'), ${JSON.stringify(AT_SPAWN)});
console.log(JSON.stringify({ meta: { generated: true } }));
`;
  const retire = quietHook(`writeFileSync(join(work, 'cache', 'gen.bin'), ${JSON.stringify(REWRITTEN)});`);
  const f = fixture({ capabilities: { "acme.hook": { manifest: { description: "generates at spawn, regenerates at retire", hooks: { spawn: "spawn.mjs", retire: "retire.mjs" } }, files: { "spawn.mjs": spawnHook, "retire.mjs": retire } } } });
  const spawned = spawn(f, "home-only-first");
  const work = join(spawned.home, "work");
  assert.equal(readFileSync(join(work, "cache", "gen.bin"), "utf8"), AT_SPAWN, "fixture premise: the spawn hook wrote the ignored file");
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! cache/"], "fixture premise: the only status row is the ignored directory, reported whole");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  // Before the hooks only the home had changed, so that snapshot holds the home and no work.
  assert.equal(recovery.repoCopy?.copied, false, "fixture premise: the snapshot before the hooks is home-only");
  assert.equal(existsSync(join(recovery.path, "repo")), false, "the pre-hook snapshot has no work copy, and gains none");
  assert.equal(readFileSync(join(recovery.path, "home", "notes", "x.md"), "utf8"), "an authored note\n");
  assert.equal(existsSync(join(afterRepo, "cache", "gen.bin")), true, "the ignored file the hook rewrote is copied under after-hooks/repo/, although no status row changed and the pre-hook snapshot holds no work");
  assert.equal(readFileSync(join(afterRepo, "cache", "gen.bin"), "utf8"), REWRITTEN);
  assertBothCopiedAgain(recovery);
});

test("a retire hook that commits without changing a byte or a status row: the work copied under after-hooks/repo/ is at the hook's commit", () => {
  const retire = quietHook(`git('-c', 'user.name=Hook', '-c', 'user.email=hook@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'made by the retire hook');
seen.head = git('rev-parse', 'HEAD').trim();`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-commit");
  const work = join(spawned.home, "work");
  write(join(work, "tracked.txt"), "changed before the retire\n");
  const headBefore = headOf(work);
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), [" M tracked.txt"], "fixture premise: one modified tracked file before the retire");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.match(seen.head, /^[0-9a-f]{40,}$/);
  assert.notEqual(seen.head, headBefore, "fixture premise: the hook moved HEAD");
  assert.equal(existsSync(join(recovery.path, "repo", ".git")), true);
  assert.equal(headOf(join(recovery.path, "repo")), headBefore, "the pre-hook snapshot is at the commit before the hook");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/, although no file byte and no status row changed: the commit did");
  assert.equal(headOf(afterRepo), seen.head);
  assert.equal(readFileSync(join(afterRepo, "tracked.txt"), "utf8"), "changed before the retire\n");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that commits inside a nested repository without changing a byte or a status row: the nested repository under after-hooks/repo/ is at the hook's commit", () => {
  const retire = quietHook(`const nested = gitIn(join(work, 'human-ignored', 'nested'));
nested('commit', '--quiet', '--allow-empty', '-m', 'made by the retire hook');
seen.nestedHead = nested('rev-parse', 'HEAD').trim();`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-nested-commit");
  const work = join(spawned.home, "work");
  const nested = join(work, "human-ignored", "nested");
  mkdirSync(nested, { recursive: true });
  execFileSync("git", ["init", "-q", nested]);
  execFileSync("git", ["-C", nested, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", nested, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", nested, "config", "maintenance.auto", "false"]); // the hook commits here just before the worktree is removed: no background Git
  write(join(nested, "nested.txt"), "nested-commit\n");
  execFileSync("git", ["-C", nested, "add", "."]);
  execFileSync("git", ["-C", nested, "commit", "-qm", "nested"]);
  const nestedBefore = headOf(nested);
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"], "fixture premise: the only status row is the ignored directory that holds the nested repository");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.match(seen.nestedHead, /^[0-9a-f]{40,}$/);
  assert.notEqual(seen.nestedHead, nestedBefore, "fixture premise: the hook moved the nested repository's HEAD");
  const nestedIn = (repo) => join(repo, "human-ignored", "nested");
  assert.equal(existsSync(join(nestedIn(join(recovery.path, "repo")), ".git")), true);
  assert.equal(headOf(nestedIn(join(recovery.path, "repo"))), nestedBefore, "the pre-hook snapshot's nested repository is at the commit before the hook");
  assert.equal(existsSync(join(nestedIn(afterRepo), ".git")), true, "the work is copied again under after-hooks/repo/, although no file byte and no status row changed: the nested repository's commit did");
  assert.equal(headOf(nestedIn(afterRepo)), seen.nestedHead);
  assert.equal(readFileSync(join(nestedIn(afterRepo), "nested.txt"), "utf8"), "nested-commit\n");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that stages other content for a file whose status row stays MM: the index of the work copied under after-hooks/repo/ holds what the hook staged", () => {
  const STAGED = "staged before the retire\n", UNSTAGED = "in the worktree, not staged\n", RESTAGED = "staged by the retire hook\n";
  // The hook changes the index entry only: the worktree file and HEAD stay as they are.
  const retire = quietHook(`const mode = git('ls-files', '-s', '--', 'tracked.txt').slice(0, 6);
const oid = execFileSync('git', ['-C', work, 'hash-object', '-w', '--stdin'], { input: ${JSON.stringify(RESTAGED)}, encoding: 'utf8' }).trim();
git('update-index', '--cacheinfo', mode + ',' + oid + ',tracked.txt');
seen.staged = git('show', ':tracked.txt');
seen.head = git('rev-parse', 'HEAD').trim();`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-restage");
  const work = join(spawned.home, "work");
  write(join(work, "tracked.txt"), STAGED);
  execFileSync("git", ["-C", work, "add", "tracked.txt"]);
  write(join(work, "tracked.txt"), UNSTAGED);
  const headBefore = headOf(work);
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["MM tracked.txt"], "fixture premise: staged content, and other content in the worktree");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(seen.staged, RESTAGED, "fixture premise: the hook staged other content");
  assert.equal(seen.head, headBefore, "fixture premise: HEAD did not move");
  const stagedIn = (repo) => execFileSync("git", ["-C", repo, "show", ":tracked.txt"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(existsSync(join(recovery.path, "repo", ".git")), true);
  assert.equal(stagedIn(join(recovery.path, "repo")), STAGED, "the pre-hook snapshot's index holds what was staged before the hook");
  assert.equal(readFileSync(join(recovery.path, "repo", "tracked.txt"), "utf8"), UNSTAGED);
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/, although no file byte, no status row and no commit changed: the index did");
  assert.equal(stagedIn(afterRepo), RESTAGED);
  assert.equal(readFileSync(join(afterRepo, "tracked.txt"), "utf8"), UNSTAGED, "the worktree file is the same in both copies");
  assert.equal(headOf(afterRepo), headBefore);
  assertBothCopiedAgain(recovery);
});

test("a retire hook that rewrites the message of an in-progress merge, with no status row: the work copied under after-hooks/repo/ carries the hook's message", () => {
  const BEFORE = "Unfinished merge\n", REWRITTEN = "Unfinished merge, as the retire hook left it\n";
  const retire = quietHook(`writeFileSync(join(git('rev-parse', '--absolute-git-dir').trim(), 'MERGE_MSG'), ${JSON.stringify(REWRITTEN)});`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-merge-message");
  const work = join(spawned.home, "work");
  // The in-progress merge of the test above ("home changes with an in-progress Git operation…"): the state a copy carries beside the files.
  write(join(spawned.home, "notes.md"), "Merge is unfinished.\n");
  const gitDir = execFileSync("git", ["-C", work, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim();
  const head = execFileSync("git", ["-C", work, "rev-parse", "HEAD"], { encoding: "utf8" });
  write(join(gitDir, "MERGE_HEAD"), head);
  write(join(gitDir, "MERGE_MSG"), BEFORE);
  const statusBefore = porcelain(work);
  assert.equal(statusBefore, "", "fixture premise: no status row before the retire");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(readFileSync(join(recovery.path, "repo", ".git", "MERGE_MSG"), "utf8"), BEFORE, "the pre-hook snapshot carries the message as it was");
  assert.equal(existsSync(join(afterRepo, ".git", "MERGE_MSG")), true, "the work is copied again under after-hooks/repo/, although no file byte, no status row and no commit changed: the operation's state did");
  assert.equal(readFileSync(join(afterRepo, ".git", "MERGE_MSG"), "utf8"), REWRITTEN);
  assert.equal(readFileSync(join(afterRepo, ".git", "MERGE_HEAD"), "utf8"), head);
  assertBothCopiedAgain(recovery);
});

test("a retire hook that only rewrites an already modified tracked file, and nothing in the home: its bytes are copied under after-hooks/repo/, and the home is not copied again", () => {
  const BEFORE = "changed before the retire\n", REWRITTEN = "rewritten by the retire hook\n";
  const retire = quietHook(`writeFileSync(join(work, 'tracked.txt'), ${JSON.stringify(REWRITTEN)});`, { home: false });
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-work-only");
  const work = join(spawned.home, "work");
  write(join(work, "tracked.txt"), BEFORE);
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), [" M tracked.txt"], "fixture premise: one modified tracked file before the retire");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore, { home: false });
  assert.equal(readFileSync(join(recovery.path, "repo", "tracked.txt"), "utf8"), BEFORE, "the pre-hook snapshot is untouched");
  assert.equal(readFileSync(join(afterRepo, "tracked.txt"), "utf8"), REWRITTEN, "the bytes moved, the status text and the home did not: the work is copied again");
  assert.equal(existsSync(join(recovery.path, "after-hooks", "home")), false, "the home did not move, so it is not copied again");
  assert.deepEqual(recovery.afterHooks, { home: false, work: true });
  assert.deepEqual(readJson(join(recovery.path, "recovery.json")).afterHooks, { home: false, work: true });
});

test("a retire hook that rewrites a file that was already untracked: its bytes are copied under after-hooks/repo/", () => {
  const BEFORE = "untracked before the retire\n", REWRITTEN = "rewritten by the retire hook\n";
  const retire = quietHook(`writeFileSync(join(work, 'scratch.txt'), ${JSON.stringify(REWRITTEN)});`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-untracked");
  const work = join(spawned.home, "work");
  write(join(work, "scratch.txt"), BEFORE);
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["?? scratch.txt"], "fixture premise: one untracked file before the retire");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(readFileSync(join(recovery.path, "repo", "scratch.txt"), "utf8"), BEFORE, "the pre-hook snapshot is untouched");
  assert.equal(readFileSync(join(afterRepo, "scratch.txt"), "utf8"), REWRITTEN);
  assertBothCopiedAgain(recovery);
});

test("a retire hook that commits on a branch the retire then deletes: the commit is in the work copied under after-hooks/repo/, although the snapshot before the hooks was home-only", () => {
  const retire = quietHook(`git('-c', 'user.name=Hook', '-c', 'user.email=hook@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'made by the retire hook');
seen.head = git('rev-parse', 'HEAD').trim();`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-commit-deleted");
  const work = join(spawned.home, "work");
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  const headBefore = headOf(work);
  const statusBefore = porcelain(work);
  assert.equal(statusBefore, "", "fixture premise: a clean worktree before the retire");

  const { receipt, recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore, { flags: ["--delete-branch"] });
  assert.notEqual(seen.head, headBefore, "fixture premise: the hook moved HEAD");
  assert.equal(recovery.repoCopy?.copied, false, "fixture premise: the snapshot before the hooks is home-only");
  assert.equal(existsSync(join(recovery.path, "repo")), false);
  assert.ok(receipt.retention.branchDeleted, "fixture premise: the retire deleted the branch");
  assert.equal(execFileSync("git", ["-C", f.repo, "branch", "--list", receipt.retention.branchDeleted], { encoding: "utf8" }).trim(), "", "the branch is gone from the repository");
  assert.ok(recovery.classes.includes("branch-only local commits"), recovery.classes.join(", "));
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied under after-hooks/repo/");
  assert.equal(headOf(afterRepo), seen.head, "the hook's commit is in the recovery");
  assertBothCopiedAgain(recovery);
});

/** A nested repository under the worktree's ignored human-ignored/, with one commit. → its directory. */
function nestedRepository(work) {
  const nested = join(work, "human-ignored", "nested");
  mkdirSync(nested, { recursive: true });
  execFileSync("git", ["init", "-q", nested]);
  execFileSync("git", ["-C", nested, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", nested, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", nested, "config", "maintenance.auto", "false"]);
  write(join(nested, "nested.txt"), "nested-commit\n");
  execFileSync("git", ["-C", nested, "add", "."]);
  execFileSync("git", ["-C", nested, "commit", "-qm", "nested"]);
  return nested;
}
const stashListOf = (repo) => execFileSync("git", ["-C", repo, "stash", "list"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const nestedUnder = (repo) => join(repo, "human-ignored", "nested");

test("a retire hook that moves only the home: the work is proven unchanged and is not copied again, with a nested repository that has a stash and its own exclude rules", () => {
  // Two inspections of an untouched worktree must give the same work state, or every retire whose hook
  // writes the home would copy the work twice. The nested repository's stash, exclude rules and
  // configuration are part of that state.
  const f = fixture({ capabilities: hookCapability(quietHook("")) });
  const spawned = spawn(f, "hook-home-only");
  const work = join(spawned.home, "work");
  write(join(work, "tracked.txt"), "changed before the retire\n");
  write(join(work, "scratch.txt"), "untracked\n");
  const nested = nestedRepository(work);
  write(join(nested, "stash.txt"), "nested-stash\n");
  execFileSync("git", ["-C", nested, "add", "stash.txt"]);
  execFileSync("git", ["-C", nested, "stash", "push", "-qm", "nested stash"]);
  write(join(nested, ".git", "info", "exclude"), ".nested-scratch/\n");
  write(join(nested, ".nested-scratch", "local.txt"), "excluded in the nested repository only\n");
  write(join(nested, "nested.txt"), "changed in the nested repository\n");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore).sort(), [" M tracked.txt", "!! human-ignored/", "?? scratch.txt"], "fixture premise: a modified file, an untracked file, and the ignored directory that holds the nested repository");
  assert.match(stashListOf(nested), /nested stash/, "fixture premise: the nested repository has a stash");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(readFileSync(join(recovery.path, "repo", "tracked.txt"), "utf8"), "changed before the retire\n");
  assert.match(stashListOf(nestedUnder(join(recovery.path, "repo"))), /nested stash/, "the one work copy carries the nested stash");
  assert.equal(existsSync(afterRepo), false, "the work did not move: it is not copied again");
  assert.deepEqual(recovery.afterHooks, { home: true, work: false });
  assert.deepEqual(readJson(join(recovery.path, "recovery.json")).afterHooks, { home: true, work: false });
});

test("a retire hook that stashes inside a nested repository and leaves its files as they were: the nested repository under after-hooks/repo/ carries the stash", () => {
  const retire = quietHook(`const nested = gitIn(join(work, 'human-ignored', 'nested'));
nested('stash', 'push', '--quiet', '-m', 'made by the retire hook');
nested('stash', 'apply', '--quiet');
seen.nestedStatus = nested('status', '--porcelain=v1', '-z');
seen.stash = nested('stash', 'list');`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-nested-stash");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work);
  write(join(nested, "nested.txt"), "changed in the nested repository\n");
  const nestedStatusBefore = execFileSync("git", ["-C", nested, "status", "--porcelain=v1", "-z"], { encoding: "utf8" });
  assert.equal(nestedStatusBefore, " M nested.txt\0", "fixture premise: one modified file in the nested repository");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"], "fixture premise: the only status row is the ignored directory that holds the nested repository");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.match(seen.stash, /made by the retire hook/, "fixture premise: the hook made a stash");
  assert.equal(seen.nestedStatus, nestedStatusBefore, "fixture premise: the nested repository's status is as it was");
  assert.equal(existsSync(join(nestedUnder(join(recovery.path, "repo")), ".git")), true);
  assert.equal(stashListOf(nestedUnder(join(recovery.path, "repo"))), "", "the pre-hook snapshot's nested repository has no stash");
  assert.equal(existsSync(join(nestedUnder(afterRepo), ".git")), true, "the work is copied again under after-hooks/repo/: the nested repository's stash moved");
  assert.match(stashListOf(nestedUnder(afterRepo)), /made by the retire hook/);
  assert.equal(readFileSync(join(nestedUnder(afterRepo), "nested.txt"), "utf8"), "changed in the nested repository\n", "its files are the same in both copies");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that adds an exclude rule to a nested repository, with no status row changing: the nested repository under after-hooks/repo/ carries the rule", () => {
  const retire = quietHook(`writeFileSync(join(work, 'human-ignored', 'nested', '.git', 'info', 'exclude'), '.by-hook/\\n');
seen.nestedStatus = gitIn(join(work, 'human-ignored', 'nested'))('status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none');`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-nested-exclude");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work);
  mkdirSync(join(nested, ".git", "info"), { recursive: true });
  const nestedStatusBefore = porcelain(nested);
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"], "fixture premise: the only status row is the ignored directory that holds the nested repository");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(seen.nestedStatus, nestedStatusBefore, "fixture premise: the rule matches nothing, so the nested repository's status is as it was");
  // A clone has an info/exclude only where Git's templates provide one: absent reads as no rule.
  const excludeOf = (repo) => { const file = join(nestedUnder(repo), ".git", "info", "exclude"); return existsSync(file) ? readFileSync(file, "utf8") : ""; };
  assert.equal(excludeOf(join(recovery.path, "repo")).includes(".by-hook/"), false, "the pre-hook snapshot's nested repository does not have the rule");
  assert.equal(existsSync(join(nestedUnder(afterRepo), ".git")), true, "the work is copied again under after-hooks/repo/: the nested repository's exclude rules moved");
  assert.match(excludeOf(afterRepo), /^\.by-hook\/$/m);
  assertBothCopiedAgain(recovery);
});

test("a nested repository whose Git state cannot be read refuses the retire as an inspection failure, and nothing is removed", () => {
  const f = fixture();
  const spawned = spawn(f, "nested-unreadable");
  const work = join(spawned.home, "work");
  // A nested repository whose Git file names a directory that is not there: Git cannot answer for it.
  write(join(work, "human-ignored", "broken", ".git"), "gitdir: /nonexistent/oats-fixture/git\n");
  write(join(work, "human-ignored", "broken", "kept.txt"), "bytes that must not be lost\n");
  const retired = cli(f, ["retire", "dev-nested-unreadable", "--discard-worktree", "--json"]);
  assert.notEqual(retired.status, 0, "a work state that cannot be read was taken for one that can");
  assert.equal(JSON.parse(retired.stdout).error.code, "E_WORK_INSPECTION_FAILED", retired.stdout);
  assert.equal(existsSync(spawned.home), true);
  assert.equal(readFileSync(join(work, "human-ignored", "broken", "kept.txt"), "utf8"), "bytes that must not be lost\n");
  assert.equal(existsSync(recoveryRootOf(spawned.home)), false, "no recovery was written");
});

test("home entries a capability declared in retirement.disposable.home are not copied to recovery, stay for the retire hooks, and are named without their contents", () => {
  const f = fixture({ capabilities: identCapability() });
  const spawned = spawnWithNote(f, "ident");
  // Recorded at spawn, in the independent baseline: sorted by owner, then root.
  assert.deepEqual(readJson(baselineOf(spawned.home)).disposableHome, [".ident", ".ident-id-*", ".ident-state"].map((root) => ({ owner: "acme.ident", root })));
  const retired = cli(f, ["retire", "dev-ident", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const receipt = JSON.parse(retired.stdout);
  const recovery = receipt.workRecovery;
  const root = recoveryRootOf(spawned.home);
  assert.deepEqual(readdirSync(root), [basename(recovery.path)]);
  assert.deepEqual(pathsNamed(root, "signing.key"), [], "no key anywhere under recovery");
  for (const name of [".ident", ".ident-id-wide", ".ident-state"]) assert.deepEqual(pathsNamed(root, name), [], name);
  assert.equal(readFileSync(join(recovery.path, "home", "notes", "x.md"), "utf8"), "an authored note\n");
  // The hook-written .ident-state is declared too: named as not copied, and no post-hook copy was triggered by it.
  assert.deepEqual(recovery.notCopied, IDENT_NOT_COPIED);
  assert.equal(recovery.afterHooks, undefined);
  assert.equal(existsSync(join(recovery.path, "after-hooks")), false);
  assert.equal(recovery.home.paths.some((p) => p.path.startsWith(".ident")), false, JSON.stringify(recovery.home.paths));
  // Exclusion is "do not copy": the key was still in the home when the retire hook ran.
  assert.equal(identHookRan(spawned.home), true);
  assert.deepEqual(receipt.capabilityMeta["acme.ident"], { retired: true, keyPresent: true });
  // Names and owners only: no contents, sizes, hashes or modes of what was left out.
  const manifestText = readFileSync(join(recovery.path, "recovery.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  assert.deepEqual(manifest.notCopied, recovery.notCopied);
  assert.equal(manifest.phase, "complete");
  for (const row of [...recovery.notCopied, ...manifest.notCopied]) assert.deepEqual(Object.keys(row).sort(), ["owner", "path", "scope"]);
  for (const [what, text] of [["recovery.json", manifestText], ["the receipt", retired.stdout]]) {
    assert.equal(text.includes(IDENT_KEY.trim()), false, `the key's bytes are in ${what}`);
    assert.equal(text.includes(Buffer.from(IDENT_KEY).toString("base64")), false, `the key's bytes are in ${what}, encoded`);
  }
  assert.equal(existsSync(spawned.home), false);

  // The text output names them once, by capability.
  const again = spawnWithNote(f, "ident-text");
  const text = cli(f, ["retire", "dev-ident-text"]);
  assert.equal(text.status, 0, text.stderr);
  assert.ok(text.stdout.split("\n").includes("  not copied: .ident, .ident-id-wide, .ident-state (acme.ident)"), text.stdout);
  assert.equal(text.stdout.includes("after the retire hooks"), false, text.stdout);
  assert.equal(text.stdout.includes(IDENT_KEY.trim()), false);
  assert.deepEqual(pathsNamed(recoveryRootOf(again.home), "signing.key"), []);
});

test("positive control: the same provider without the declaration has its key copied to recovery, before and after the hooks", () => {
  const f = fixture({ capabilities: identCapability({ declare: false }) });
  const spawned = spawnWithNote(f, "undeclared");
  assert.deepEqual(readJson(baselineOf(spawned.home)).disposableHome, [], "nothing was declared, so nothing was recorded");
  const retired = cli(f, ["retire", "dev-undeclared", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.equal(readFileSync(join(recovery.path, "home", ".ident", "signing.key"), "utf8"), IDENT_KEY);
  assert.equal(readFileSync(join(recovery.path, "home", ".ident-id-wide", "signing.key"), "utf8"), IDENT_KEY);
  assert.equal(recovery.notCopied, undefined);
  // The hook's undeclared .ident-state write moves the home: the post-hook pass runs, in the same directory.
  assert.deepEqual(recovery.afterHooks, { home: true, work: false });
  assert.equal(readFileSync(join(recovery.path, "after-hooks", "home", ".ident-state", "retire.json"), "utf8"), JSON.stringify({ at: "retire" }));
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [basename(recovery.path)]);
  assert.equal(pathsNamed(recoveryRootOf(spawned.home), "signing.key").length, 4, "the search used above finds a copied key");
});

test("a retire hook that reports incomplete cleanup keeps the home with its declared entries, and recovery still holds no copy of them", () => {
  const f = fixture({ capabilities: identCapability({ meta: { retired: false, reason: "remote unreachable" } }) });
  const spawned = spawnWithNote(f, "owed");
  const retired = cli(f, ["retire", "dev-owed", "--json"]);
  assert.equal(retired.status, 1, `${retired.stderr}\n${retired.stdout}`);
  const receipt = JSON.parse(retired.stdout);
  assert.ok(receipt.rollbackIncomplete?.some((item) => /acme\.ident: reported incomplete cleanup \(remote unreachable\)/.test(item)), retired.stdout);
  assert.equal(receipt.retainedHome, spawned.home);
  assert.equal(receipt.removedDir, false);
  assert.equal(identHookRan(spawned.home), true);
  // The credential a retry needs is where it was, with the hook's own state and the cleanup marker.
  assert.equal(readFileSync(join(spawned.home, ".ident", "signing.key"), "utf8"), IDENT_KEY);
  assert.equal(readFileSync(join(spawned.home, ".ident-id-wide", "signing.key"), "utf8"), IDENT_KEY);
  assert.equal(existsSync(join(spawned.home, ".ident-state", "retire.json")), true);
  assert.equal(existsSync(join(spawned.home, ".oats-rollback-incomplete.json")), true);
  assert.deepEqual(pathsNamed(recoveryRootOf(spawned.home), "signing.key"), []);
  assert.equal(readFileSync(join(receipt.workRecovery.path, "home", "notes", "x.md"), "utf8"), "an authored note\n");
  assert.deepEqual(receipt.workRecovery.notCopied, IDENT_NOT_COPIED);
});

test("the fingerprint and the copy agree: a change to declared entries alone preserves nothing, an undeclared hidden entry is preserved", () => {
  const f = fixture({ capabilities: identCapability() });
  const quiet = spawn(f, "declared-only");
  write(join(quiet.home, ".ident", "rotated.key"), "rotated after spawn\n");
  write(join(quiet.home, ".ident-id-late", "signing.key"), IDENT_KEY);
  let retired = cli(f, ["retire", "dev-declared-only", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  assert.equal(JSON.parse(retired.stdout).workRecovery, undefined, "only declared entries changed (the test's and the retire hook's)");
  assert.equal(identHookRan(quiet.home), true);
  assert.equal(existsSync(recoveryRootOf(quiet.home)), false, "no recovery was written");
  assert.equal(existsSync(quiet.home), false);

  // Control: a hidden entry nobody declared is the instance's work.
  const loud = spawn(f, "undeclared-entry");
  write(join(loud.home, ".other", "x"), "undeclared\n");
  retired = cli(f, ["retire", "dev-undeclared-entry", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.deepEqual(recovery.classes, ["changed instance-home bytes"]);
  assert.equal(readFileSync(join(recovery.path, "home", ".other", "x"), "utf8"), "undeclared\n");
  assert.deepEqual(pathsNamed(recoveryRootOf(loud.home), "signing.key"), []);
});

test("the spawn baseline is the only authority for exclusions: a declaration added afterwards to instance.json and to the home's module copy excludes nothing", () => {
  const f = fixture({ capabilities: identCapability({ declare: false }) });
  const spawned = spawnWithNote(f, "late-declare");
  const retirement = { disposable: { home: IDENT_DECLARED } };
  const metaPath = join(spawned.home, "instance.json");
  const meta = readJson(metaPath);
  const runtime = meta.capabilityRuntime.find((cap) => cap.id === "acme.ident");
  assert.ok(runtime, "fixture premise: instance.json records the provider's runtime row");
  runtime.retirement = retirement;
  for (const cap of meta.capabilities || []) if (cap.id === "acme.ident") cap.retirement = retirement;
  meta.retirement = retirement;
  meta.disposableHome = IDENT_DECLARED.map((root) => ({ owner: "acme.ident", root }));
  write(metaPath, JSON.stringify(meta, null, 2) + "\n");
  const modulePath = join(spawned.home, ".oats", "modules", "acme.ident", "oats.json");
  write(modulePath, JSON.stringify({ ...readJson(modulePath), retirement }, null, 2) + "\n");
  const retired = cli(f, ["retire", "dev-late-declare", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.equal(readFileSync(join(recovery.path, "home", ".ident", "signing.key"), "utf8"), IDENT_KEY);
  assert.equal(readFileSync(join(recovery.path, "home", ".ident-id-wide", "signing.key"), "utf8"), IDENT_KEY);
  assert.equal(recovery.notCopied, undefined);
});

test("an existing home gains no exclusions when its capability starts declaring them: it retires with the home copied whole, an instance spawned afterwards does not", () => {
  const f = fixture({ capabilities: identCapability({ declare: false }) });
  const before = spawnWithNote(f, "before-update");
  const declaring = identCapability()["acme.ident"];
  f.commit(capabilityFiles("acme.ident", declaring.manifest, declaring.files), "acme.ident declares its home state");
  const after = spawnWithNote(f, "after-update");
  assert.deepEqual(readJson(baselineOf(after.home)).disposableHome.map((row) => row.root), [".ident", ".ident-id-*", ".ident-state"], "fixture premise: the update reached a new spawn");

  let retired = cli(f, ["retire", "dev-before-update", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const old = JSON.parse(retired.stdout).workRecovery;
  assert.equal(readFileSync(join(old.path, "home", ".ident", "signing.key"), "utf8"), IDENT_KEY);
  assert.equal(readFileSync(join(old.path, "home", ".ident-id-wide", "signing.key"), "utf8"), IDENT_KEY);
  assert.equal(readFileSync(join(old.path, "home", "notes", "x.md"), "utf8"), "an authored note\n");
  assert.equal(old.notCopied, undefined);
  assert.deepEqual(readdirSync(recoveryRootOf(before.home)), [basename(old.path)], "one directory");

  retired = cli(f, ["retire", "dev-after-update", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const fresh = JSON.parse(retired.stdout).workRecovery;
  assert.deepEqual(pathsNamed(fresh.path, "signing.key"), []);
  assert.deepEqual(fresh.notCopied, IDENT_NOT_COPIED);
  assert.equal(readdirSync(recoveryRootOf(after.home)).length, 2);
});

test("a declared name that is a symlink in the home is left out by its name, and its target is never read or copied", () => {
  const f = fixture({ capabilities: identCapability() });
  const spawned = spawnWithNote(f, "linked");
  const outside = join(f.base, "outside");
  write(join(outside, "outside-secret.txt"), "never copied\n");
  symlinkSync(outside, join(spawned.home, ".ident-id-link"));
  symlinkSync(outside, join(spawned.home, ".plain-link"));
  const retired = cli(f, ["retire", "dev-linked", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.deepEqual(recovery.notCopied.map((row) => row.path), [".ident", ".ident-id-link", ".ident-id-wide", ".ident-state"]);
  assert.throws(() => lstatSync(join(recovery.path, "home", ".ident-id-link")), /ENOENT/, "the declared link is not in the copy");
  // Control: an undeclared link is copied, as a link. Neither is followed.
  assert.equal(lstatSync(join(recovery.path, "home", ".plain-link")).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(recovery.path, "home", ".plain-link")), outside);
  assert.deepEqual(pathsNamed(recoveryRootOf(spawned.home), "outside-secret.txt"), []);
  assert.equal(readFileSync(join(outside, "outside-secret.txt"), "utf8"), "never copied\n");
});

test("a failed recovery copy refuses before any retire hook runs and keeps the home with its declared entries and its baseline", () => {
  const f = fixture({ capabilities: identCapability() });
  const spawned = spawnWithNote(f, "blocked");
  const baseline = readFileSync(baselineOf(spawned.home), "utf8");
  // The recovery storage is unusable: a file where the directory would be.
  write(recoveryRootOf(spawned.home), "not a directory");
  const retired = cli(f, ["retire", "dev-blocked", "--json"]);
  assert.notEqual(retired.status, 0, `a retire that could not copy must refuse: ${retired.stdout}`);
  assert.equal(identHookRan(spawned.home), false, "no retire hook ran");
  assert.equal(readFileSync(join(spawned.home, ".ident", "signing.key"), "utf8"), IDENT_KEY);
  assert.equal(readFileSync(join(spawned.home, ".ident-id-wide", "signing.key"), "utf8"), IDENT_KEY);
  assert.equal(readFileSync(join(spawned.home, "notes", "x.md"), "utf8"), "an authored note\n");
  assert.equal(readJson(join(spawned.home, "instance.json")).instance, "dev-blocked");
  assert.equal(readFileSync(baselineOf(spawned.home), "utf8"), baseline, "the baseline is untouched");
  assert.equal(readFileSync(recoveryRootOf(spawned.home), "utf8"), "not a directory");
});

test("a recovery that fails verification refuses with E_WORK_PRESERVATION_FAILED, leaves no recovery directory and keeps the home with its declared entries", () => {
  // The status disagreement of the "names the differing status rows" test above.
  const f = fixture({ capabilities: identCapability() });
  const spawned = spawnWithNote(f, "unverified");
  const work = join(spawned.home, "work");
  const names = ["a.txt", "b.txt"];
  for (const n of names) write(join(work, n), `${n}\r\n`);
  execFileSync("git", ["-C", work, "add", ...names]);
  execFileSync("git", ["-C", work, "commit", "-qm", "crlf files"]);
  staleUnderTextAttribute(f.repo, f.base, names.map((n) => join(work, n)));
  write(join(work, "untracked.txt"), "forces a repository recovery\n");
  const retired = cli(f, ["retire", "dev-unverified", "--json"]);
  assert.equal(retired.status, 1, retired.stdout);
  const error = JSON.parse(retired.stdout).error;
  assert.equal(error.code, "E_WORK_PRESERVATION_FAILED");
  assert.match(error.message, /recovered Git index\/status disagreed with the source/);
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [], "neither a recovery nor its staging is left behind");
  assert.equal(identHookRan(spawned.home), false, "no retire hook ran");
  assert.equal(existsSync(spawned.home), true, "the home is kept");
  assert.equal(readFileSync(join(spawned.home, ".ident", "signing.key"), "utf8"), IDENT_KEY);
  assert.equal(readFileSync(join(spawned.home, ".ident-id-wide", "signing.key"), "utf8"), IDENT_KEY);
  assert.equal(existsSync(baselineOf(spawned.home)), true);
});

test("without a valid baseline nothing is excluded, although the capability still declares: the baseline missing, of another version, or with a row outside the grammar", () => {
  const cases = {
    missing: (file) => rmSync(file),
    version: (file) => write(file, JSON.stringify({ ...readJson(file), version: 1 }, null, 2) + "\n"),
    // One bad row disqualifies the whole list: no row of it excludes anything.
    grammar: (file) => { const b = readJson(file); write(file, JSON.stringify({ ...b, disposableHome: [...b.disposableHome, { owner: "acme.ident", root: "notes" }] }, null, 2) + "\n"); },
  };
  for (const [name, damage] of Object.entries(cases)) {
    const f = fixture({ capabilities: identCapability() });
    const spawned = spawnWithNote(f, `baseline-${name}`);
    assert.equal(readJson(baselineOf(spawned.home)).disposableHome.length, 3, "fixture premise: the declaration was recorded at spawn");
    assert.deepEqual(readJson(join(spawned.home, ".oats", "modules", "acme.ident", "oats.json")).retirement, { disposable: { home: IDENT_DECLARED } }, "fixture premise: the home's module copy still declares");
    damage(baselineOf(spawned.home));
    const retired = cli(f, ["retire", `dev-baseline-${name}`, "--json"]);
    assert.equal(retired.status, 0, `${name}: ${retired.stderr}\n${retired.stdout}`);
    const recovery = JSON.parse(retired.stdout).workRecovery;
    assert.equal(readFileSync(join(recovery.path, "home", ".ident", "signing.key"), "utf8"), IDENT_KEY, name);
    assert.equal(readFileSync(join(recovery.path, "home", ".ident-id-wide", "signing.key"), "utf8"), IDENT_KEY, name);
    assert.equal(readFileSync(join(recovery.path, "home", "notes", "x.md"), "utf8"), "an authored note\n", name);
    assert.equal(recovery.notCopied, undefined, name);
    assert.equal(Object.hasOwn(readJson(join(recovery.path, "recovery.json")), "notCopied"), false, name);
  }
});

test("the recovery lines are one function for the local and the remote path: a historical receipt with workRecoveries prints a block per entry, a new one prints one block with what was copied, what was not, and the second snapshot", () => {
  const historical = { retired: "dev-1", workRecovery: { path: "/r/dev-1-BBB", classes: ["directory work bytes"], bytes: 2048 }, workRecoveries: [
    { path: "/r/dev-1-AAA", classes: ["changed instance-home bytes", "directory work bytes"], bytes: 1536, outputs: { paths: [{ path: "scratch/", bytes: 1024 }, { path: "note.txt", bytes: 12 }], bytes: 1036 } },
    { path: "/r/dev-1-BBB", classes: ["directory work bytes"], bytes: 2048 },
  ] };
  assert.deepEqual(workRecoveryLines(historical), [
    "Work that was not committed has been preserved: changed instance-home bytes, directory work bytes",
    "  /r/dev-1-AAA (1.5 KiB)",
    "  copied outputs: scratch/ (1.0 KiB), note.txt (12 B) — 1.0 KiB in total",
    "Work that was not committed has been preserved: directory work bytes",
    "  /r/dev-1-BBB (2.0 KiB)",
  ]);
  assert.deepEqual(workRecoveryLines(historical, { host: "build.example" }), [
    "Work that was not committed has been preserved on build.example: changed instance-home bytes, directory work bytes",
    "  /r/dev-1-AAA (1.5 KiB)",
    "  copied outputs: scratch/ (1.0 KiB), note.txt (12 B) — 1.0 KiB in total",
    "Work that was not committed has been preserved on build.example: directory work bytes",
    "  /r/dev-1-BBB (2.0 KiB)",
  ]);
  const current = { retired: "dev-1", workRecovery: {
    path: "/r/dev-1-CCC", classes: ["changed instance-home bytes", "untracked or ignored worktree bytes"], bytes: 3 * 1024 * 1024,
    home: { paths: [".oats/", "a/", "b/", "c/", "d/", "e/", "f/", "g/", "h.md", "i.md"].map((path, i) => ({ path, bytes: 2048 - i })), bytes: 20435 },
    outputs: { paths: [{ path: "scratch/", bytes: 1024 }], bytes: 1024 },
    notCopied: [{ scope: "home", path: ".aw", owner: "oats.aweb" }, { scope: "home", path: ".ident", owner: "acme.ident" }, { scope: "home", path: ".oats-aweb", owner: "oats.aweb" }],
    afterHooks: { home: true, work: false },
  } };
  const block = (preserved) => [
    preserved,
    "  /r/dev-1-CCC (3.0 MiB)",
    "  copied from the home: .oats/ (2.0 KiB), a/ (2.0 KiB), b/ (2.0 KiB), c/ (2.0 KiB), d/ (2.0 KiB), e/ (2.0 KiB), f/ (2.0 KiB), g/ (2.0 KiB), and 2 more — 20.0 KiB in total",
    "  copied outputs: scratch/ (1.0 KiB) — 1.0 KiB in total",
    "  not copied: .ident (acme.ident); .aw, .oats-aweb (oats.aweb)",
    "  after the retire hooks: home copied again under after-hooks/",
  ];
  assert.deepEqual(workRecoveryLines(current), block("Work that was not committed has been preserved: changed instance-home bytes, untracked or ignored worktree bytes"));
  assert.deepEqual(workRecoveryLines(current, { host: "build.example" }), block("Work that was not committed has been preserved on build.example: changed instance-home bytes, untracked or ignored worktree bytes"));
  const variant = (afterHooks) => workRecoveryLines({ workRecovery: { path: "/r/x", classes: ["directory work bytes"], afterHooks } }).at(-1);
  assert.equal(variant({ home: false, work: true }), "  after the retire hooks: work copied again under after-hooks/");
  assert.equal(variant({ home: true, work: true }), "  after the retire hooks: home and work copied again under after-hooks/");
  assert.equal(variant(undefined), "  /r/x");
  assert.deepEqual(workRecoveryLines({ retired: "dev-1" }), [], "nothing preserved, nothing said");
});

test("the retire plan says where a recovery would be written and what is declared as not copied, per work mode, without changing the plan revision", () => {
  const notes = (f, instance) => { const r = cli(f, ["retire", instance, "--plan", "--json"]); assert.equal(r.status, 0, r.stdout + r.stderr); return JSON.parse(r.stdout).result; };
  const recoveryNotes = (plan) => plan.notes.filter((n) => n.startsWith("recovery: "));
  const worktree = fixture({ capabilities: identCapability() });
  const a = spawn(worktree, "plan");
  const planned = notes(worktree, "dev-plan");
  assert.deepEqual(recoveryNotes(planned), [
    `recovery: home files changed since spawn are copied to ${recoveryRootOf(a.home)} before the home is removed; not copied: .ident, .ident-id-*, .ident-state (acme.ident)`,
    "recovery: uncommitted worktree state is copied there too",
  ]);
  // Read from the baseline, never from the home: a changed baseline changes the note and nothing else.
  const baseline = readJson(baselineOf(a.home));
  write(baselineOf(a.home), JSON.stringify({ ...baseline, disposableHome: [{ owner: "acme.ident", root: ".ident" }] }, null, 2) + "\n");
  const narrowed = notes(worktree, "dev-plan");
  assert.equal(recoveryNotes(narrowed)[0], `recovery: home files changed since spawn are copied to ${recoveryRootOf(a.home)} before the home is removed; not copied: .ident (acme.ident)`);
  assert.equal(narrowed.planRevision, planned.planRevision, "the plan revision does not depend on the recovery notes");
  // One note lists at most 16 declared roots, in the baseline's order, then counts the rest.
  const many = Array.from({ length: 17 }, (_, i) => `.r${String(i).padStart(2, "0")}`);
  write(baselineOf(a.home), JSON.stringify({ ...baseline, disposableHome: many.map((root) => ({ owner: "acme.ident", root })) }, null, 2) + "\n");
  assert.equal(recoveryNotes(notes(worktree, "dev-plan"))[0], `recovery: home files changed since spawn are copied to ${recoveryRootOf(a.home)} before the home is removed; not copied: ${many.slice(0, 16).join(", ")} (acme.ident), and 1 more`);
  assert.equal(existsSync(recoveryRootOf(a.home)), false, "a plan writes nothing");

  const directory = fixture({ work: "directory", capabilities: hookCapability(RETIRE_WRITES_NOTHING) });
  const b = spawn(directory, "plan");
  assert.deepEqual(recoveryNotes(notes(directory, "dev-plan")), [
    `recovery: home files changed since spawn are copied to ${recoveryRootOf(b.home)} before the home is removed`,
    "recovery: work/ is copied there when it is not empty",
  ]);
});
