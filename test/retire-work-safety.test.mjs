import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn as spawnProcess, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { capabilityFiles, v2Deployment } from "./helpers/v2-deployment.mjs";
import { linkExecutables, waitUntil as waitFor } from "./helpers/host-fixture.mjs";
import { fingerprintTree, statusDisagreement } from "../lib/core.mjs";
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

/** How a refusal of the copy made before the retire hooks ends, as regular-expression source, for an
 *  instance that was never launched: what this retire has and has not done by then. */
function refusedBeforeHooks(instance) {
  return String.raw`\. No retire hook has run, no recovery was written and nothing was deleted: ${instance} is not retired and its home and work are kept; this retire stopped no session$`;
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
  assert.match(error.message, new RegExp(String.raw`recovered Git index\/status disagreed with the source: f00\.txt \(source  M, recovery absent\); f01\.txt .*; f09\.txt \(source  M, recovery absent\); and 1 more${refusedBeforeHooks("dev-diffrows")}`));
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
  assert.match(error.message, new RegExp(String.raw`nested recovery human-ignored\/nested Git state disagreed with source: run\.sh \(source  M, recovery absent\)${refusedBeforeHooks("dev-nestedrows")}`));
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
function nestedRepository(work, ...under) {
  const nested = join(work, "human-ignored", ...under, "nested");
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
/** The Git directory a worktree shares with the repository it belongs to. */
const commonDirOf = (work) => execFileSync("git", ["-C", work, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
/** A repository's own info/exclude; a clone has one only where Git's templates provide it, so absent reads as no rule. */
const excludeRulesOf = (repo) => { const file = join(repo, ".git", "info", "exclude"); return existsSync(file) ? readFileSync(file, "utf8") : ""; };
/** A repository's tag names. Sorted here: the order `git tag` lists in follows the user's configuration. */
const tagNamesOf = (repo) => execFileSync("git", ["-C", repo, "tag", "--list"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").filter(Boolean).sort();

test("a retire hook that moves only the home: the work is proven unchanged and is not copied again, with a nested repository that has a stash and its own exclude rules", () => {
  // Two inspections of an untouched worktree must give the same work state, or every retire whose hook
  // writes the home would copy the work twice. The stash, the tags, the exclude rules and the status
  // settings are part of that state, for the worktree and for the nested repository.
  const f = fixture({ capabilities: hookCapability(quietHook("")) });
  const spawned = spawn(f, "hook-home-only");
  const work = join(spawned.home, "work");
  // The worktree's own stash and exclude rules are kept by the repository it belongs to. A work copy carries them, so they are state too.
  write(join(work, "stash.txt"), "worktree-stash\n");
  execFileSync("git", ["-C", work, "add", "stash.txt"]);
  execFileSync("git", ["-C", work, "stash", "push", "-qm", "worktree stash"]);
  write(join(commonDirOf(work), "info", "exclude"), ".worktree-scratch/\n");
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
  assert.match(stashListOf(work), /worktree stash/, "fixture premise: the worktree has a stash");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(readFileSync(join(recovery.path, "repo", "tracked.txt"), "utf8"), "changed before the retire\n");
  assert.match(stashListOf(nestedUnder(join(recovery.path, "repo"))), /nested stash/, "the one work copy carries the nested stash");
  assert.match(stashListOf(join(recovery.path, "repo")), /worktree stash/, "and the worktree's stash");
  assert.match(excludeRulesOf(join(recovery.path, "repo")), /^\.worktree-scratch\/$/m, "and the worktree's exclude rule");
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

test("a retire hook that tags a commit inside a nested repository, with no status row changing: the nested repository under after-hooks/repo/ carries the tag", () => {
  const retire = quietHook(`const nested = gitIn(join(work, 'human-ignored', 'nested'));
nested('tag', 'by-the-retire-hook');
seen.tags = nested('tag', '--list');`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-nested-tag");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work);
  execFileSync("git", ["-C", nested, "tag", "before-the-retire"]);
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"], "fixture premise: the only status row is the ignored directory that holds the nested repository");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  // Sorted here: the order `git tag` lists in follows the user's configuration.
  const tagNames = (listing) => listing.split("\n").filter(Boolean).sort();
  const tagsOf = (repo) => tagNames(execFileSync("git", ["-C", nestedUnder(repo), "tag", "--list"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  assert.deepEqual(tagNames(seen.tags), ["before-the-retire", "by-the-retire-hook"], "fixture premise: the hook made a tag");
  assert.equal(existsSync(join(nestedUnder(join(recovery.path, "repo")), ".git")), true);
  assert.deepEqual(tagsOf(join(recovery.path, "repo")), ["before-the-retire"], "a work copy carries a nested repository's tags: the pre-hook snapshot has the one that existed then");
  assert.equal(existsSync(join(nestedUnder(afterRepo), ".git")), true, "the work is copied again under after-hooks/repo/: the nested repository's tags moved");
  assert.deepEqual(tagsOf(afterRepo), ["before-the-retire", "by-the-retire-hook"]);
  assertBothCopiedAgain(recovery);
});

test("a retire hook that gives a nested repository another branch, on a commit nothing else reaches, with no status row, index entry, HEAD, tag or stash changing: the work is copied again, and the nested repository under after-hooks/repo/ has the commit", () => {
  // The nested repository's Git directory goes with the worktree, so every branch in it is removed
  // with it. The hook's commit is a stash commit that is stored under no stash ref: only the new
  // branch reaches it, and the nested repository's files, index and checked-out branch stay as they were.
  const STATUS = "'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none'";
  const retire = quietHook(`const inNested = gitIn(join(work, 'human-ignored', 'nested'));
const stateOf = () => ({ status: inNested(${STATUS}), head: inNested('rev-parse', 'HEAD'), branch: inNested('symbolic-ref', 'HEAD'), index: inNested('ls-files', '-s', '-v', '-z'),
  tags: inNested('for-each-ref', 'refs/tags'), stash: inNested('for-each-ref', 'refs/stash') });
seen.before = stateOf();
seen.commit = inNested('stash', 'create').trim();
inNested('update-ref', 'refs/heads/backup', seen.commit);
seen.after = stateOf();
seen.branches = inNested('for-each-ref', '--format=%(refname)', 'refs/heads');`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-nested-branch");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work);
  write(join(nested, "nested.txt"), "changed in the nested repository\n");
  const nestedStatusBefore = porcelain(nested);
  assert.deepEqual(statusRowsIn(nestedStatusBefore), [" M nested.txt"], "fixture premise: the nested repository has one modified tracked file before the retire");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"], "fixture premise: the only status row is the ignored directory that holds the nested repository");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.match(seen.commit, /^[0-9a-f]{40,64}$/, "fixture premise: the hook made a commit of the nested repository's modified state");
  assert.deepEqual(seen.branches.split("\n").filter(Boolean).filter((ref) => ref.endsWith("/backup")), ["refs/heads/backup"], "fixture premise: the hook gave the nested repository a branch named backup");
  assert.deepEqual(seen.after, seen.before, "fixture premise: the nested repository's status, HEAD, checked-out branch, index, tags and stash are as they were");
  assert.equal(seen.before.status, nestedStatusBefore, "fixture premise: and its status is the one it had before the retire");
  assert.equal(seen.before.stash, "", "fixture premise: the commit is under no stash ref");
  const hasCommit = (repo) => { try { execFileSync("git", ["-C", repo, "cat-file", "-e", seen.commit], { stdio: ["ignore", "pipe", "pipe"] }); return true; } catch { return false; } };
  assert.equal(existsSync(join(nestedUnder(join(recovery.path, "repo")), ".git")), true);
  assert.equal(hasCommit(nestedUnder(join(recovery.path, "repo"))), false, "the pre-hook snapshot's nested repository does not have the commit: it did not exist yet");
  assert.equal(existsSync(join(nestedUnder(afterRepo), ".git")), true, "the work is copied again under after-hooks/repo/: the nested repository's branches moved, although nothing else of it did");
  assert.equal(hasCommit(nestedUnder(afterRepo)), true, "the nested repository copied after the hooks has the hook's commit");
  assert.equal(readFileSync(join(nestedUnder(afterRepo), "nested.txt"), "utf8"), "changed in the nested repository\n", "its files are the same in both copies");
  assertBothCopiedAgain(recovery);
});

test("a repository inside a nested repository cannot be proven unchanged: the work is copied again after the hooks, and a retire hook's commit there is under after-hooks/repo/", () => {
  const retire = quietHook(`const inner = gitIn(join(work, 'human-ignored', 'nested', 'inner'));
inner('commit', '--quiet', '--allow-empty', '-m', 'made by the retire hook');
seen.innerHead = inner('rev-parse', 'HEAD').trim();
seen.nestedStatus = gitIn(join(work, 'human-ignored', 'nested'))('status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none');`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-inner-commit");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work);
  // A repository inside the nested one: the nested repository sees it as one untracked directory.
  const inner = join(nested, "inner");
  mkdirSync(inner);
  execFileSync("git", ["init", "-q", inner]);
  execFileSync("git", ["-C", inner, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", inner, "config", "user.name", "Test"]);
  execFileSync("git", ["-C", inner, "config", "maintenance.auto", "false"]);
  write(join(inner, "inner.txt"), "inner-commit\n");
  execFileSync("git", ["-C", inner, "add", "."]);
  execFileSync("git", ["-C", inner, "commit", "-qm", "inner"]);
  const innerBefore = headOf(inner);
  const nestedStatusBefore = porcelain(nested);
  assert.deepEqual(statusRowsIn(nestedStatusBefore), ["?? inner/"], "fixture premise: the nested repository reports the inner one as one untracked directory");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"], "fixture premise: the only status row is the ignored directory that holds the nested repository");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(seen.nestedStatus, nestedStatusBefore, "fixture premise: the nested repository's status is as it was");
  assert.notEqual(seen.innerHead, innerBefore, "fixture premise: the hook moved the inner repository's HEAD");
  const innerUnder = (repo) => join(nestedUnder(repo), "inner");
  assert.equal(existsSync(join(innerUnder(join(recovery.path, "repo")), ".git")), true, "a work copy carries the inner repository with its Git directory");
  assert.equal(headOf(innerUnder(join(recovery.path, "repo"))), innerBefore, "the pre-hook snapshot's inner repository is at the commit before the hook");
  assert.equal(existsSync(join(innerUnder(afterRepo), ".git")), true, "the work is copied again under after-hooks/repo/: nothing proves the inner repository unchanged");
  assert.equal(headOf(innerUnder(afterRepo)), seen.innerHead);
  assertBothCopiedAgain(recovery);
});

test("a nested repository under a directory whose name has a line feed cannot be proven unchanged: the work is copied again after the hooks, and a retire hook's rewrite of its MERGE_MSG is under after-hooks/repo/", () => {
  // Git prints such a repository's paths over more than one line. Taken apart wrongly, every file the
  // state reads under them would be "not there", before the hooks and after them alike.
  const BEFORE = "A message\n", REWRITTEN = "A message, as the retire hook left it\n";
  const retire = quietHook(`const nested = join(work, 'human-ignored', 'line\\nfeed', 'nested');
writeFileSync(join(nested, '.git', 'MERGE_MSG'), ${JSON.stringify(REWRITTEN)});
seen.nestedStatus = gitIn(nested)('status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none');`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-nested-line-feed");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work, "line\nfeed");
  const under = (repo) => join(repo, "human-ignored", "line\nfeed", "nested");
  write(join(nested, ".git", "MERGE_MSG"), BEFORE);
  assert.equal(execFileSync("git", ["-C", nested, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trimEnd().split("\n").length, 2, "fixture premise: Git prints the nested repository's Git directory over two lines");
  const nestedStatusBefore = porcelain(nested);
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"], "fixture premise: the only status row is the ignored directory that holds the nested repository");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(seen.nestedStatus, nestedStatusBefore, "fixture premise: the nested repository's status is as it was");
  assert.equal(readFileSync(join(under(join(recovery.path, "repo")), ".git", "MERGE_MSG"), "utf8"), BEFORE, "the pre-hook snapshot's nested repository carries the message as it was");
  assert.equal(existsSync(join(under(afterRepo), ".git")), true, "the work is copied again under after-hooks/repo/: the nested repository's state could not be read, so nothing proves it unchanged");
  assert.equal(readFileSync(join(under(afterRepo), ".git", "MERGE_MSG"), "utf8"), REWRITTEN);
  assert.equal(readFileSync(join(under(afterRepo), "nested.txt"), "utf8"), "nested-commit\n", "its files are the same in both copies");
  assertBothCopiedAgain(recovery);
});

const resolveUndoOf = (repo) => execFileSync("git", ["-C", repo, "ls-files", "--resolve-undo", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("a retire hook that makes and resolves a conflict on a committed file, leaving every index entry, status row and byte as it was: the index of the work copied under after-hooks/repo/ holds the resolve-undo records", () => {
  // The index file is copied whole, so a work copy holds its resolve-undo records. Resolving a conflict adds
  // them, and here the entry that comes back is the one that was there: nothing else of the index moves.
  const retire = quietHook(`const indexOf = () => ({ stage: git('ls-files', '--stage', '-z'), marks: git('ls-files', '-s', '-v', '-z'), head: git('rev-parse', 'HEAD'), undo: git('ls-files', '--resolve-undo', '-z') });
seen.before = indexOf();
const blob = git('rev-parse', 'HEAD:tracked.txt').trim();
const rows = ['0 ' + '0'.repeat(blob.length) + '\\ttracked.txt', ...[1, 2, 3].map((stage) => '100644 ' + blob + ' ' + stage + '\\ttracked.txt')];
execFileSync('git', ['-C', work, 'update-index', '--index-info'], { input: rows.join('\\n') + '\\n' });
seen.conflict = git('ls-files', '--stage', '-z', '--', 'tracked.txt');
git('add', 'tracked.txt');
seen.after = indexOf();`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-resolve-undo");
  const work = join(spawned.home, "work");
  write(join(work, "scratch.txt"), "untracked\n");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["?? scratch.txt"], "fixture premise: the committed file is unmodified, and an untracked file gives the pre-hook pass a work copy");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  // Each row of either listing is "<mode> <object> <stage>\t<path>": the stage and the path of each. The
  // index holds the repository's other files too, so the conflict is listed for this file only.
  const stagesIn = (listing) => listing.split("\0").filter(Boolean).map((row) => row.replace(/^\d+ [0-9a-f]+ (\d)\t/, "$1 "));
  const THREE_STAGES = ["1 tracked.txt", "2 tracked.txt", "3 tracked.txt"];
  assert.deepEqual(stagesIn(seen.conflict), THREE_STAGES, "fixture premise: the hook put the file in conflict, as its stages 1, 2 and 3");
  assert.equal(seen.before.undo, "", "fixture premise: no resolve-undo record before the hook, for any file");
  assert.deepEqual(stagesIn(seen.after.undo), THREE_STAGES, "fixture premise: resolving left three resolve-undo records, all for that file");
  assert.equal(seen.after.stage, seen.before.stage, "fixture premise: the index entries are as they were");
  assert.equal(seen.after.marks, seen.before.marks, "fixture premise: and so are their marks");
  assert.equal(seen.after.head, seen.before.head, "fixture premise: and the commit");
  assert.equal(readFileSync(join(recovery.path, "repo", "tracked.txt"), "utf8"), "base\n");
  assert.equal(resolveUndoOf(join(recovery.path, "repo")), "", "the pre-hook snapshot's index has no resolve-undo record");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: the index's resolve-undo records moved, although no entry, status row or byte did");
  assert.equal(resolveUndoOf(afterRepo), seen.after.undo, "the copy's index holds the records");
  assert.equal(readFileSync(join(afterRepo, "tracked.txt"), "utf8"), "base\n", "its files are the same in both copies");
  assertBothCopiedAgain(recovery);
});

// What a work copy holds of the worktree's own repository is state as well: the exclude rules and status
// settings the copy is given, the stash and the tags. They are kept by the repository the worktree belongs
// to, so a hook can change them without touching a file or a status row of the worktree.

test("a retire hook that adds an exclude rule to the repository the worktree belongs to, with no status row changing: the work copied under after-hooks/repo/ carries the rule", () => {
  const retire = quietHook(`import { mkdirSync } from 'node:fs';
const common = git('rev-parse', '--path-format=absolute', '--git-common-dir').trim();
mkdirSync(join(common, 'info'), { recursive: true });
writeFileSync(join(common, 'info', 'exclude'), '.by-hook/\\n');`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-worktree-exclude");
  const work = join(spawned.home, "work");
  write(join(work, "tracked.txt"), "changed before the retire\n");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), [" M tracked.txt"], "fixture premise: one modified tracked file before the retire");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(readFileSync(join(commonDirOf(f.repo), "info", "exclude"), "utf8"), ".by-hook/\n", "fixture premise: the hook wrote the rule; it matches nothing, so no status row moved");
  assert.equal(existsSync(join(recovery.path, "repo", ".git")), true);
  assert.equal(excludeRulesOf(join(recovery.path, "repo")).includes(".by-hook/"), false, "the pre-hook snapshot does not have the rule");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: its exclude rules moved");
  assert.match(excludeRulesOf(afterRepo), /^\.by-hook\/$/m);
  assert.equal(readFileSync(join(afterRepo, "tracked.txt"), "utf8"), "changed before the retire\n", "its files are the same in both copies");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that tags the instance's commit, with no status row changing: the work copied under after-hooks/repo/ carries the tag", () => {
  const retire = quietHook(`git('tag', 'by-the-retire-hook');
seen.tags = git('tag', '--list');`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-worktree-tag");
  const work = join(spawned.home, "work");
  write(join(work, "tracked.txt"), "changed before the retire\n");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), [" M tracked.txt"], "fixture premise: one modified tracked file before the retire");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(seen.tags.split("\n").includes("by-the-retire-hook"), true, "fixture premise: the hook made a tag");
  assert.equal(existsSync(join(recovery.path, "repo", ".git")), true);
  assert.equal(tagNamesOf(join(recovery.path, "repo")).includes("by-the-retire-hook"), false, "the pre-hook snapshot does not have the tag");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: a work copy carries the tags, and they moved");
  assert.equal(tagNamesOf(afterRepo).includes("by-the-retire-hook"), true);
  assertBothCopiedAgain(recovery);
});

/** Give the instance's branch one commit that a second local branch, `keep`, also reaches: no commit is branch-only. → that commit. */
function commitAlsoOnKeep(work) {
  write(join(work, "committed.txt"), "committed on the instance's branch\n");
  execFileSync("git", ["-C", work, "add", "committed.txt"]);
  execFileSync("git", ["-C", work, "commit", "-qm", "the instance's commit"]);
  execFileSync("git", ["-C", work, "branch", "keep"]);
  return headOf(work);
}

test("a snapshot that was home-only before the hooks gets a work copy when a class appears after them from outside the work state: a retire hook deletes the other branch that reached the instance's commit, and the retire deletes the instance's", () => {
  const retire = quietHook(`git('branch', '--quiet', '-D', 'keep');
seen.head = git('rev-parse', 'HEAD').trim();
seen.branches = git('branch', '--list', 'keep');`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-drops-branch");
  const work = join(spawned.home, "work");
  const commit = commitAlsoOnKeep(work);
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  const statusBefore = porcelain(work);
  assert.equal(statusBefore, "", "fixture premise: a clean worktree before the retire");

  const { receipt, recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore, { flags: ["--delete-branch"] });
  // The work state did not move: same status, same commit, same bytes. Only another ref did.
  assert.equal(seen.head, commit, "fixture premise: the hook did not move HEAD");
  assert.equal(seen.branches, "", "fixture premise: the hook deleted the other branch");
  assert.equal(recovery.repoCopy?.copied, false, "fixture premise: the snapshot before the hooks is home-only, because no commit was branch-only then");
  assert.equal(existsSync(join(recovery.path, "repo")), false);
  assert.ok(recovery.classes.includes("branch-only local commits"), `the class appeared after the hooks: ${recovery.classes.join(", ")}`);
  assert.ok(receipt.retention.branchDeleted, "fixture premise: the retire deleted the instance's branch");
  assert.equal(execFileSync("git", ["-C", f.repo, "branch", "--list", receipt.retention.branchDeleted, "keep"], { encoding: "utf8" }).trim(), "", "no branch reaches the commit any more");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied under after-hooks/repo/, although nothing in the work state moved: the recovery held no work copy, and the commit is now branch-only");
  assert.equal(headOf(afterRepo), commit, "the commit is in the recovery");
  assert.equal(readFileSync(join(afterRepo, "committed.txt"), "utf8"), "committed on the instance's branch\n");
  assertBothCopiedAgain(recovery);
});

test("a snapshot that was home-only before the hooks gets a work copy when the retire hook removes the instance's retirement baseline", () => {
  const retire = quietHook(`import { readdirSync, rmSync } from 'node:fs';
const baselines = join(dirname(home), '.oats-retirement', 'baselines');
for (const name of readdirSync(baselines)) rmSync(join(baselines, name));`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-drops-baseline");
  const work = join(spawned.home, "work");
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  assert.equal(existsSync(baselineOf(spawned.home)), true, "fixture premise: the baseline is where the hook will look");
  const statusBefore = porcelain(work);
  assert.equal(statusBefore, "", "fixture premise: a clean worktree before the retire");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(existsSync(baselineOf(spawned.home)), false, "fixture premise: the hook removed the baseline");
  assert.equal(recovery.repoCopy?.copied, false, "fixture premise: the snapshot before the hooks is home-only");
  assert.equal(existsSync(join(recovery.path, "repo")), false);
  assert.ok(recovery.classes.includes("unknown instance-home provenance"), `the class appeared after the hooks: ${recovery.classes.join(", ")}`);
  assert.equal(existsSync(join(afterRepo, ".git")), true, "without the baseline nothing says the work is disposable: it is copied under after-hooks/repo/");
  assert.equal(readFileSync(join(afterRepo, "tracked.txt"), "utf8"), "base\n");
  assertBothCopiedAgain(recovery);
});

test("an instance with nothing to preserve before the hooks gets its one recovery when a class appears after them, although nothing in its home or its work moved: a retire hook deletes the other branch that reached the instance's commit", () => {
  const retire = quietHook(`git('branch', '--quiet', '-D', 'keep');
seen.head = git('rev-parse', 'HEAD').trim();
seen.branches = git('branch', '--list', 'keep');`, { home: false });
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "late-class");
  const work = join(spawned.home, "work");
  const commit = commitAlsoOnKeep(work);
  const statusBefore = porcelain(work);
  assert.equal(statusBefore, "", "fixture premise: a clean worktree before the retire");

  const { receipt, recovery, seen } = retireAfterQuietHook(f, spawned, statusBefore, { flags: ["--delete-branch"], home: false });
  assert.equal(seen.head, commit, "fixture premise: the hook did not move HEAD");
  assert.equal(seen.branches, "", "fixture premise: the hook deleted the other branch");
  assert.deepEqual(recovery.classes, ["branch-only local commits"], "the one class, and it appeared after the hooks");
  assert.ok(receipt.retention.branchDeleted, "fixture premise: the retire deleted the instance's branch");
  assert.equal(execFileSync("git", ["-C", f.repo, "branch", "--list", receipt.retention.branchDeleted, "keep"], { encoding: "utf8" }).trim(), "", "no branch reaches the commit any more");
  // Written by the post-hook pass as the first and only recovery: the work is at its top level.
  assert.equal(existsSync(join(recovery.path, "repo", ".git")), true);
  assert.equal(headOf(join(recovery.path, "repo")), commit, "the commit is in the recovery");
  assert.equal(readFileSync(join(recovery.path, "repo", "committed.txt"), "utf8"), "committed on the instance's branch\n");
  assert.equal(existsSync(join(recovery.path, "after-hooks")), false);
  assert.equal(recovery.afterHooks, undefined);
  assert.equal(readJson(join(recovery.path, "recovery.json")).phase, "complete");
});

// ---- Bytes, not text ----
// Git's output, the names in a worktree and the targets of its links are compared as their bytes. Read
// as text, a byte that is not valid UTF-8 becomes U+FFFD, and two different such bytes read alike.

/** The tag refs of a repository as Git prints them, as the hex of those bytes. */
const tagRefBytesOf = (repo) => execFileSync("git", ["-C", repo, "for-each-ref", "--format=%(refname)", "refs/tags"], { stdio: ["ignore", "pipe", "pipe"] }).toString("hex");
const tagRefWith = (byte) => Buffer.concat([Buffer.from("refs/tags/tag-"), Buffer.from([byte]), Buffer.from("\n")]).toString("hex");
/** Run `make`, which needs a file system that stores a byte that is not UTF-8 in a name or in a link's
 *  target, and read the bytes back with `read` (hex). → true when they are there. Where the platform
 *  does not store them the test is skipped with the reason. On Linux that is a failure: there the
 *  test cannot pass by being skipped. */
function storedBytes(t, make, read, expected) {
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

test("a retire hook that changes one byte of a packed tag's name in a nested repository, from one byte that is not UTF-8 to another, with no status row, index entry, HEAD or stash changing: the work is copied again, and the nested repository under after-hooks/repo/ has the tag as the hook left it", () => {
  // The tag is in packed-refs, so no file has the byte in its name. Read as text, both names are
  // "tag-" and U+FFFD: only their bytes tell them apart.
  const STATUS = "'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching', '--ignore-submodules=none'";
  const retire = quietHook(`import { readFileSync } from 'node:fs';
const nested = join(work, 'human-ignored', 'nested');
const inNested = gitIn(nested);
const tagBytes = () => execFileSync('git', ['-C', nested, 'for-each-ref', '--format=%(refname)', 'refs/tags']).toString('hex');
const stateOf = () => ({ status: inNested(${STATUS}), head: inNested('rev-parse', 'HEAD'), branch: inNested('symbolic-ref', 'HEAD'), index: inNested('ls-files', '-s', '-v', '-z'), stash: inNested('for-each-ref', 'refs/stash') });
seen.before = stateOf();
seen.tagBefore = tagBytes();
const packed = join(nested, '.git', 'packed-refs');
const bytes = readFileSync(packed);
seen.at = bytes.indexOf(0x80);
bytes[seen.at] = 0x81;
writeFileSync(packed, bytes);
seen.after = stateOf();
seen.tagAfter = tagBytes();`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-tag-byte");
  const work = join(spawned.home, "work");
  const nested = nestedRepository(work);
  const commit = headOf(nested);
  writeFileSync(join(nested, ".git", "packed-refs"), Buffer.concat([Buffer.from(`${commit} refs/tags/tag-`), Buffer.from([0x80]), Buffer.from("\n")]));
  assert.equal(tagRefBytesOf(nested), tagRefWith(0x80), "fixture premise: Git reads the packed tag and prints its name with the byte 0x80");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"], "fixture premise: the outer status has one row, the ignored directory that holds the nested repository");

  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.ok(seen.at >= 0, "fixture premise: the hook found the byte 0x80 in packed-refs");
  assert.equal(seen.tagBefore, tagRefWith(0x80), "fixture premise: the hook saw the tag with the byte 0x80");
  assert.equal(seen.tagAfter, tagRefWith(0x81), "fixture premise: the hook left the tag with the byte 0x81");
  assert.equal(Buffer.from(seen.tagBefore, "hex").toString("utf8"), Buffer.from(seen.tagAfter, "hex").toString("utf8"), "fixture premise: read as text, the two names are the same");
  assert.deepEqual(seen.after, seen.before, "fixture premise: the hook changed no status row, HEAD, checked-out branch, index entry or stash of the nested repository");
  assert.equal(tagRefBytesOf(nestedUnder(join(recovery.path, "repo"))), tagRefWith(0x80), "the snapshot taken before the hooks has the tag as it was then, and is as it was written");
  assert.equal(existsSync(join(nestedUnder(afterRepo), ".git")), true, "the work is copied again under after-hooks/repo/: the tag's name changed, in a byte that text does not tell apart");
  assert.equal(tagRefBytesOf(nestedUnder(afterRepo)), tagRefWith(0x81), "the nested repository copied after the hooks has the tag as the hook left it");
  assert.equal(headOf(nestedUnder(afterRepo)), commit);
  assertBothCopiedAgain(recovery);
});

test("a retire hook that replaces an untracked symbolic link by one whose target differs in one byte that is not UTF-8, with the same status rows: the snapshot before the hooks holds the first target byte for byte, the work is copied again, and the link under after-hooks/repo/ holds the second", (t) => {
  const retire = quietHook(`import { symlinkSync, unlinkSync } from 'node:fs';
const link = join(work, 'link');
unlinkSync(link);
symlinkSync(Buffer.from([0x74, 0x81]), link);`);
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-link-byte");
  const work = join(spawned.home, "work");
  const link = join(work, "link");
  const targetOf = (path) => readlinkSync(path, "buffer").toString("hex");
  if (!storedBytes(t, () => symlinkSync(Buffer.from([0x74, 0x80]), link), () => targetOf(link), "7480")) return;
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["?? link"], "fixture premise: the link is untracked, and Git's row names it, not its target");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(targetOf(join(recovery.path, "repo", "link")), "7480", "the snapshot taken before the hooks holds the link with its target byte for byte");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: the link's target changed, in a byte that text does not tell apart");
  assert.equal(targetOf(join(afterRepo, "link")), "7481", "the link copied after the hooks has the target the hook gave it");
  assertBothCopiedAgain(recovery);
});

test("a clean worktree with a committed file whose name is not UTF-8, and only a home note to preserve: the retire completes with a home-only recovery", (t) => {
  const f = fixture();
  const spawned = spawn(f, "name-byte");
  const work = join(spawned.home, "work");
  const named = Buffer.concat([Buffer.from(join(work, "x")), Buffer.from([0x80])]);
  const namesWithX = () => readdirSync(work, { encoding: "buffer" }).filter((name) => name[0] === 0x78).map((name) => name.toString("hex")).join(",");
  if (!storedBytes(t, () => writeFileSync(named, "bytes\n"), namesWithX, "7880")) return;
  execFileSync("git", ["-C", work, "add", "-A"]);
  execFileSync("git", ["-C", work, "commit", "-qm", "a file whose name is not UTF-8"]);
  assert.equal(execFileSync("git", ["-C", work, "ls-files", "-z"]).includes(Buffer.from([0x78, 0x80, 0x00])), true, "fixture premise: Git tracks the file under its name, byte for byte");
  assert.equal(porcelain(work), "", "fixture premise: the file is committed and the worktree is clean");
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");

  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.equal(retired.status, 0, `a retire with only the home to preserve was refused for a file's name: ${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.deepEqual(recovery.classes, ["changed instance-home bytes"]);
  assert.equal(recovery.repoCopy?.copied, false, "the recovery holds the home only");
  assert.equal(existsSync(join(recovery.path, "repo")), false);
  assert.equal(readFileSync(join(recovery.path, "home", "notes", "x.md"), "utf8"), "an authored note\n");
  assert.equal(existsSync(join(recovery.path, "after-hooks")), false, "nothing moved after the snapshot");
  assert.equal(readJson(join(recovery.path, "recovery.json")).phase, "complete");
  assert.equal(existsSync(spawned.home), false, "the home is removed");
});

// The home's instance.json. The spawn baseline compares it without the two fields the kernel writes
// later, through a parse. The proof that the hooks left the home as it was compares its bytes.

/** Where the test's own field of instance.json has its one byte: right after this, in a JSON string. */
const PAYLOAD_MARKER = '"reviewPayload": "t';
const payloadByteIn = (file) => { const bytes = readFileSync(file); return bytes[bytes.indexOf(PAYLOAD_MARKER) + PAYLOAD_MARKER.length]; };
/** Give a home's instance.json a field that is not the kernel's, whose string holds the byte 0x80:
 *  not UTF-8. Read as text it is U+FFFD, so the file is still JSON every reader of the kernel accepts. */
function writePayloadByte(home) {
  const file = join(home, "instance.json");
  const bytes = Buffer.from(`${JSON.stringify({ ...readJson(file), reviewPayload: "tX" }, null, 2)}\n`);
  bytes[bytes.indexOf(PAYLOAD_MARKER) + PAYLOAD_MARKER.length] = 0x80;
  writeFileSync(file, bytes);
  assert.equal(payloadByteIn(file), 0x80, "fixture premise: the file holds the byte");
  assert.equal(readJson(file).reviewPayload, "t�", "fixture premise: read as text the field holds the replacement character, and the file is JSON");
}
/** quietHook body: change that byte to 0x81, and nothing else of the file. */
const CHANGES_PAYLOAD_BYTE = `import { readFileSync } from 'node:fs';
const file = join(home, 'instance.json');
const bytes = readFileSync(file);
const at = bytes.indexOf(${JSON.stringify(PAYLOAD_MARKER)}) + ${PAYLOAD_MARKER.length};
seen.byteBefore = bytes[at];
bytes[at] = 0x81;
writeFileSync(file, bytes);`;
/** quietHook body: write a new untracked file in the worktree. The status gains a row, which is a
 *  change of the work that every kernel sees, also one that compares nothing but the status text. */
const SCRATCH_BYTES = "written in the work by the retire hook\n";
const WRITES_SCRATCH = `writeFileSync(join(work, 'scratch.txt'), ${JSON.stringify(SCRATCH_BYTES)});`;
const STATUS_WITH_SCRATCH = "?? scratch.txt\0";

test("a retire hook that changes one byte that is not UTF-8 in a field of the home's instance.json that is not the kernel's, and also writes a file in the work: the home is copied again with the work, and the file under after-hooks/home/ holds the hook's byte", () => {
  // The hook writes no note in the home: the only thing it changes there is that byte.
  const f = fixture({ capabilities: hookCapability(quietHook(`${CHANGES_PAYLOAD_BYTE}\n${WRITES_SCRATCH}`, { home: false })) });
  const spawned = spawn(f, "hook-instance-byte-work");
  const work = join(spawned.home, "work");
  writePayloadByte(spawned.home);
  assert.equal(porcelain(work), "", "fixture premise: the worktree is clean before the retire");

  // The helper is given the status the hook leaves: the one new row.
  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, STATUS_WITH_SCRATCH, { home: false });
  assert.equal(seen.byteBefore, 0x80, "fixture premise: the retire left the byte as it was until the hook ran");
  assert.equal(readFileSync(join(afterRepo, "scratch.txt"), "utf8"), SCRATCH_BYTES, "fixture premise: the work moved and is copied under after-hooks/repo/");
  assert.equal(payloadByteIn(join(recovery.path, "home", "instance.json")), 0x80, "the snapshot taken before the hooks holds the file as it was then");
  const after = join(recovery.path, "after-hooks", "home", "instance.json");
  assert.equal(existsSync(after), true, "the home is copied again under after-hooks/home/: the hook changed a byte of instance.json that text does not tell apart");
  assert.equal(payloadByteIn(after), 0x81, "the file copied after the hooks has the byte the hook gave it");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that changes only that byte of the home's instance.json: the home is copied again, and the file under after-hooks/home/ holds the hook's byte", () => {
  // The kernel before one recovery per retire had this loss too: it copied again when the home's
  // fingerprint or the status text moved, and this change moves neither.
  const f = fixture({ capabilities: hookCapability(quietHook(CHANGES_PAYLOAD_BYTE, { home: false })) });
  const spawned = spawn(f, "hook-instance-byte");
  const work = join(spawned.home, "work");
  writePayloadByte(spawned.home);
  const statusBefore = porcelain(work);
  assert.equal(statusBefore, "", "fixture premise: the worktree is clean");

  const { recovery, seen } = retireAfterQuietHook(f, spawned, statusBefore, { home: false });
  assert.equal(seen.byteBefore, 0x80, "fixture premise: the retire left the byte as it was until the hook ran");
  assert.deepEqual(recovery.classes, ["changed instance-home bytes"]);
  assert.equal(payloadByteIn(join(recovery.path, "home", "instance.json")), 0x80, "the snapshot taken before the hooks holds the file as it was then");
  const after = join(recovery.path, "after-hooks", "home", "instance.json");
  assert.equal(existsSync(after), true, "the home is copied again under after-hooks/home/: the hook changed a byte of instance.json that text does not tell apart (a loss the earlier kernel had as well, with nothing else changed)");
  assert.equal(payloadByteIn(after), 0x81, "the file copied after the hooks has the byte the hook gave it");
  assert.deepEqual(recovery.afterHooks, { home: true, work: false }, "the home moved; the clean worktree did not");
  assert.deepEqual(readJson(join(recovery.path, "recovery.json")).afterHooks, { home: true, work: false });
});

test("a retire hook that rewrites the home's instance.json to the same value in other bytes (other white space), and also writes a file in the work: the home is copied again, and the file under after-hooks/home/ holds the hook's bytes", () => {
  // All of it valid UTF-8, and JSON that parses to what it was: only the bytes differ.
  const retire = quietHook(`import { readFileSync } from 'node:fs';
const file = join(home, 'instance.json');
seen.jsonBefore = readFileSync(file, 'utf8');
seen.jsonAfter = JSON.stringify(JSON.parse(seen.jsonBefore));
writeFileSync(file, seen.jsonAfter);
${WRITES_SCRATCH}`, { home: false });
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-instance-space");
  const work = join(spawned.home, "work");
  const atRetire = readFileSync(join(spawned.home, "instance.json"), "utf8");
  // Something to preserve before the hooks, so that a snapshot is taken before them: a note in the home.
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  assert.equal(porcelain(work), "", "fixture premise: the worktree is clean before the retire");

  // The helper is given the status the hook leaves: the one new row.
  const { recovery, seen, afterRepo } = retireAfterQuietHook(f, spawned, STATUS_WITH_SCRATCH, { home: false });
  assert.equal(seen.jsonBefore, atRetire, "fixture premise: the retire left the file as it was until the hook ran");
  assert.notEqual(seen.jsonAfter, seen.jsonBefore, "fixture premise: the hook wrote other bytes");
  assert.deepEqual(JSON.parse(seen.jsonAfter), JSON.parse(seen.jsonBefore), "fixture premise: the two files parse to the same value");
  assert.equal(readFileSync(join(afterRepo, "scratch.txt"), "utf8"), SCRATCH_BYTES, "fixture premise: the work moved and is copied under after-hooks/repo/");
  assert.equal(readFileSync(join(recovery.path, "home", "instance.json"), "utf8"), atRetire, "the snapshot taken before the hooks holds the file as it was then");
  const after = join(recovery.path, "after-hooks", "home", "instance.json");
  assert.equal(existsSync(after), true, "the home is copied again under after-hooks/home/: the hook rewrote instance.json, and a parse does not tell the two files apart");
  assert.equal(readFileSync(after, "utf8"), seen.jsonAfter, "the file copied after the hooks has the bytes the hook wrote");
  assertBothCopiedAgain(recovery);
});

test("fingerprintTree of an instance home tells apart two instance.json files that differ in one byte that is not UTF-8, and still leaves the kernel's own fields out of a file that is valid", () => {
  const root = mkdtempSync(join(tmpdir(), "oats-fingerprint-home-"));
  temporaryDirectories.push(root);
  const file = join(root, "instance.json");
  const withByte = (byte, fields) => {
    const bytes = Buffer.from(JSON.stringify({ instance: "dev-1", reviewPayload: "tX", ...fields }));
    bytes[bytes.indexOf('"reviewPayload":"t') + '"reviewPayload":"t'.length] = byte;
    writeFileSync(file, bytes);
    return fingerprintTree(root, { instanceHome: true });
  };
  assert.notEqual(withByte(0x80), withByte(0x81), "two files that differ in a byte that is not UTF-8 have two digests");
  // 0x58 is the X the field was written with: a file that is valid UTF-8.
  assert.equal(withByte(0x58, { spawnCompleted: false, wake: null }), withByte(0x58, { spawnCompleted: true, wake: { saved: true } }), "a valid file is compared without the fields the kernel writes after spawn, as before");
  assert.notEqual(withByte(0x58), withByte(0x59), "and with every other byte of it");
});

// ---- Two trees that the stored digest reads alike ----
// The digest a spawn baseline is stored with frames an entry as its path, NUL, its mode, NUL, its
// kind, NUL, and for a file its bytes and NUL, with no length. So a file whose bytes spell the entry
// that follows it reads like the two files. A stored digest cannot change. The proof that the retire
// hooks left a part as it was must not read the two alike.

const PAIR_A = "the first file\n", PAIR_B = "the second file\n";
/** Write the files `a` and `b` into `dir`, each with the mode 0644. */
function writePair(dir) {
  for (const [name, bytes] of [["a", PAIR_A], ["b", PAIR_B]]) {
    write(join(dir, name), bytes);
    chmodSync(join(dir, name), 0o644);
  }
}
/** What stands in the stored digest between the bytes of `a` and the bytes of `b`, in a directory at
 *  `under` (its path from the root the digest is taken of): NUL, b's path, NUL, its mode in decimal,
 *  NUL, "file", NUL. `dir` is a directory that holds the pair. */
const pairGlue = (dir, under) => `\0${join(...under, "b")}\0${lstatSync(join(dir, "b")).mode & 0o7777}\0file\0`;
const mergedPair = (glue) => `${PAIR_A}${glue}${PAIR_B}`;
/** Hook source: replace the pair in the directory `dirSource` (an expression of the hook) by the one
 *  file `a` that holds a's bytes, the glue and b's bytes. Needs readFileSync, unlinkSync,
 *  writeFileSync and join. */
const mergesPair = (dirSource, glue) => `const pair = ${dirSource};
writeFileSync(join(pair, 'a'), Buffer.concat([readFileSync(join(pair, 'a')), Buffer.from(${JSON.stringify(glue)}), readFileSync(join(pair, 'b'))]));
unlinkSync(join(pair, 'b'));`;
const PAIR_IMPORTS = "import { readFileSync, unlinkSync } from 'node:fs';";
/** The fixture premise of these tests, on two temporary trees: with the pair at `under`, the stored
 *  digest (fingerprintTree) of the two files and of the one merged file is the same. → the glue. */
function storedDigestReadsThePairAlike(under) {
  const two = mkdtempSync(join(tmpdir(), "oats-pair-two-")), one = mkdtempSync(join(tmpdir(), "oats-pair-one-"));
  temporaryDirectories.push(two, one);
  writePair(join(two, ...under));
  const glue = pairGlue(join(two, ...under), under);
  write(join(one, ...under, "a"), mergedPair(glue));
  chmodSync(join(one, ...under, "a"), 0o644);
  for (let depth = 1; depth <= under.length; depth++) chmodSync(join(one, ...under.slice(0, depth)), lstatSync(join(two, ...under.slice(0, depth))).mode & 0o7777);
  assert.deepEqual([readdirSync(join(two, ...under)).sort(), readdirSync(join(one, ...under))], [["a", "b"], ["a"]], "fixture premise: two files in one tree, one file in the other");
  assert.equal(fingerprintTree(one), fingerprintTree(two), "fixture premise: the stored digest reads the two layouts alike");
  return glue;
}
/** What a directory that held the pair holds after the hook: the one file, with the merged bytes. */
function assertMerged(dir, glue, what) {
  assert.deepEqual(readdirSync(dir), ["a"], `${what} holds the one file the hook left`);
  assert.equal(readFileSync(join(dir, "a"), "utf8"), mergedPair(glue), `${what} holds the bytes the hook wrote`);
}
/** What it held before: the two files. */
function assertPair(dir, what) {
  assert.deepEqual(readdirSync(dir).sort(), ["a", "b"], `${what} holds the two files`);
  assert.equal(readFileSync(join(dir, "a"), "utf8"), PAIR_A);
  assert.equal(readFileSync(join(dir, "b"), "utf8"), PAIR_B);
}

test("a retire hook that replaces two files of the work, under a directory Git reports as ignored whole, by one file that the stored digest reads like the two, and writes a home note: the work is copied again, and after-hooks/repo/ holds the hook's layout", () => {
  const under = ["human-ignored", "pair"];
  const glue = storedDigestReadsThePairAlike(under);
  const f = fixture({ capabilities: hookCapability(quietHook(`${PAIR_IMPORTS}\n${mergesPair("join(work, 'human-ignored', 'pair')", glue)}`)) });
  const spawned = spawn(f, "hook-pair-work");
  const work = join(spawned.home, "work");
  writePair(join(work, ...under));
  assert.equal(pairGlue(join(work, ...under), under), glue, "fixture premise: the files have the mode the premise was shown with");
  const statusBefore = porcelain(work);
  assert.deepEqual(statusRowsIn(statusBefore), ["!! human-ignored/"], "fixture premise: Git reports the directory whole, so the status text cannot change");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assertPair(join(recovery.path, "repo", ...under), "the snapshot taken before the hooks");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: the hook changed its files, in a way the stored digest does not tell apart");
  assertMerged(join(afterRepo, ...under), glue, "the work copied after the hooks");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that replaces two files of the home by one file that the stored digest reads like the two, and writes a file in the work: the home is copied again, and after-hooks/home/ holds the hook's layout", () => {
  const under = ["notes", "pair"];
  const glue = storedDigestReadsThePairAlike(under);
  // The hook writes no note of its own in the home: the only thing it changes there is the pair.
  const f = fixture({ capabilities: hookCapability(quietHook(`${PAIR_IMPORTS}\n${mergesPair("join(home, 'notes', 'pair')", glue)}\n${WRITES_SCRATCH}`, { home: false })) });
  const spawned = spawn(f, "hook-pair-home");
  const work = join(spawned.home, "work");
  writePair(join(spawned.home, ...under));
  assert.equal(pairGlue(join(spawned.home, ...under), under), glue, "fixture premise: the files have the mode the premise was shown with");
  assert.equal(porcelain(work), "", "fixture premise: the worktree is clean before the retire");

  // The helper is given the status the hook leaves: the one new row.
  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, STATUS_WITH_SCRATCH, { home: false });
  assert.equal(readFileSync(join(afterRepo, "scratch.txt"), "utf8"), SCRATCH_BYTES, "fixture premise: the work moved and is copied under after-hooks/repo/");
  assertPair(join(recovery.path, "home", ...under), "the snapshot taken before the hooks");
  assert.equal(existsSync(join(recovery.path, "after-hooks", "home")), true, "the home is copied again under after-hooks/home/: the hook changed its files, in a way the stored digest does not tell apart");
  assertMerged(join(recovery.path, "after-hooks", "home", ...under), glue, "the home copied after the hooks");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that replaces two files of a directory instance's work/ by one file that the stored digest reads like the two, and writes a home note: the work is copied again, and after-hooks/work/ holds the hook's layout", () => {
  const under = ["pair"];
  const glue = storedDigestReadsThePairAlike(under);
  const retire = `import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const home = process.env.OATS_INSTANCE_HOME;
${mergesPair("join(home, 'work', 'pair')", glue)}
writeFileSync(join(home, 'hook-note.txt'), ${JSON.stringify(HOOK_BYTES)});
console.log(JSON.stringify({ meta: { retired: true } }));
`;
  const f = fixture({ work: "directory", capabilities: hookCapability(retire) });
  const spawned = spawn(f, "hook-pair-directory");
  writePair(join(spawned.home, "work", ...under));
  assert.equal(pairGlue(join(spawned.home, "work", ...under), under), glue, "fixture premise: the files have the mode the premise was shown with");

  const retired = cli(f, ["retire", basename(spawned.home), "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [basename(recovery.path)], "one recovery directory");
  assert.equal(readFileSync(join(recovery.path, "after-hooks", "home", "hook-note.txt"), "utf8"), HOOK_BYTES, "fixture premise: the retire hook ran, and its home note is copied under after-hooks/");
  assertPair(join(recovery.path, "work", ...under), "the snapshot taken before the hooks");
  assert.equal(existsSync(join(recovery.path, "after-hooks", "work")), true, "the work is copied again under after-hooks/work/: the hook changed its files, in a way the stored digest does not tell apart");
  assertMerged(join(recovery.path, "after-hooks", "work", ...under), glue, "the work copied after the hooks");
  assertBothCopiedAgain(recovery);
  assert.equal(existsSync(spawned.home), false, "the home is removed");
});

test("fingerprintTree's digest of a tree whose names are all valid UTF-8 is the one it has always been: a file, a directory with a file, a symbolic link and a name that is not ASCII", () => {
  // A spawn baseline written by an earlier kernel holds such digests, and a retire compares with them.
  // The expected value is the SHA-256 of this byte stream, written out by hand from the algorithm
  // (per entry, in the order of the names: its path, NUL, its permission bits in decimal, NUL, then
  // "file" NUL its bytes NUL, or "link" NUL its target NUL, or "dir" NUL followed by its entries):
  //   a.txt\0420\0file\0alpha\n\0  dir\0493\0dir\0  dir/inner.txt\0416\0file\0inner\n\0
  //   link\0511\0link\0a.txt\0  zé.txt\0384\0file\0zed\n\0
  const root = mkdtempSync(join(tmpdir(), "oats-fingerprint-"));
  temporaryDirectories.push(root);
  for (const [name, content, mode] of [["a.txt", "alpha\n", 0o644], [join("dir", "inner.txt"), "inner\n", 0o640], ["zé.txt", "zed\n", 0o600]]) {
    write(join(root, name), content);
    chmodSync(join(root, name), mode);
  }
  chmodSync(join(root, "dir"), 0o755);
  symlinkSync("a.txt", join(root, "link"));
  // A link has permission bits of its own only where the platform gives it some; there they follow the umask.
  if ((lstatSync(join(root, "link")).mode & 0o7777) !== 0o777) nodeFs.lchmodSync?.(join(root, "link"), 0o777);
  assert.equal(lstatSync(join(root, "link")).mode & 0o7777, 0o777, "fixture premise: the link's permission bits are 0777");
  assert.equal(fingerprintTree(root), "sha256:612e407ca91d0e9258ab0cc9d929db7bbc9e6b6d81179a74ce745dcd7638e71a");
});

/** Whether a quietHook retire hook ran to its end for this home. */
const hookRan = (home) => existsSync(join(dirname(home), `hook-saw-${basename(home)}`));

// ---- A worktree that cannot be proven unchanged ----
// A read of the Git state that fails is never taken for "not set" or for "unchanged", and it does not
// refuse by itself: the worktree is not provable, and the copy decides. With nothing to preserve the
// retire goes through. With anything to preserve the work goes into the snapshot before the hooks, also
// when only the home has something: a snapshot that held the home only could, after the hooks, neither
// be proven to stand for the work nor be given it.

test("a nested repository whose Git state cannot be read refuses the retire at the copy, as it always did, and nothing is removed", () => {
  // A pin, not a difference: the copy asks the nested repository for its commit and fails.
  const f = fixture();
  const spawned = spawn(f, "nested-unreadable");
  const work = join(spawned.home, "work");
  // A nested repository whose Git file names a directory that is not there: Git cannot answer for it.
  write(join(work, "human-ignored", "broken", ".git"), "gitdir: /nonexistent/oats-fixture/git\n");
  write(join(work, "human-ignored", "broken", "kept.txt"), "bytes that must not be lost\n");
  const retired = cli(f, ["retire", "dev-nested-unreadable", "--discard-worktree", "--json"]);
  assert.notEqual(retired.status, 0, "a work state that cannot be read was taken for one that can");
  assert.equal(JSON.parse(retired.stdout).error.code, "E_WORK_PRESERVATION_FAILED", retired.stdout);
  assert.equal(existsSync(spawned.home), true);
  assert.equal(readFileSync(join(work, "human-ignored", "broken", "kept.txt"), "utf8"), "bytes that must not be lost\n");
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [], "neither a recovery nor its staging is left behind");
});

/** Put a directory where the worktree's repository would keep info/attributes: `git status` still works,
 *  the kernel cannot read the file, and a work copy cannot carry it. */
function unreadableAttributes(work) {
  mkdirSync(join(commonDirOf(work), "info", "attributes"), { recursive: true });
  assert.equal(porcelain(work), "", "fixture premise: Git's status still works, and reports a clean worktree");
}

test("a worktree whose Git state cannot be read, with nothing to preserve, retires: its retire hook runs and the home is removed", () => {
  const f = fixture({ capabilities: hookCapability(quietHook("", { home: false })) });
  const spawned = spawn(f, "unreadable-clean");
  unreadableAttributes(join(spawned.home, "work"));

  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.equal(retired.status, 0, `a state that cannot be read refused a retire with nothing to preserve: ${retired.stderr}\n${retired.stdout}`);
  assert.equal(hookRan(spawned.home), true, "the retire hook ran");
  assert.equal(JSON.parse(retired.stdout).workRecovery, undefined, "nothing to preserve: no recovery");
  assert.equal(existsSync(spawned.home), false, "the home is removed");
});

for (const { preserves, prepare } of [
  // A pin, not a difference: this retire copied its work before, and that copy refused on the same file.
  { preserves: "an untracked file", prepare: (home) => write(join(home, "work", "scratch.txt"), "untracked\n") },
  // New: a snapshot of the home only would leave the work neither proven nor copied after the hooks.
  { preserves: "only a home note", prepare: (home) => write(join(home, "notes", "x.md"), "an authored note\n") },
]) {
  test(`a worktree whose Git state cannot be read, with ${preserves} to preserve, has its work copied before the hooks: the copy cannot be made, so the retire refuses with E_WORK_PRESERVATION_FAILED before any hook runs and leaves no recovery`, () => {
    const f = fixture({ capabilities: hookCapability(quietHook("")) });
    const spawned = spawn(f, preserves.startsWith("only") ? "unreadable-home-only" : "unreadable-work");
    unreadableAttributes(join(spawned.home, "work"));
    prepare(spawned.home);

    const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
    assert.notEqual(retired.status, 0, `a worktree that could be neither proven nor copied was retired: ${retired.stdout}`);
    const error = JSON.parse(retired.stdout).error;
    assert.equal(error.code, "E_WORK_PRESERVATION_FAILED", retired.stdout);
    assert.match(error.message, /attributes/, "the message names what the copy could not carry");
    assert.match(error.message, new RegExp(refusedBeforeHooks(basename(spawned.home))), "the message says what this retire did and did not do");
    assert.equal(hookRan(spawned.home), false, "no retire hook ran");
    assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [], "neither a recovery nor its staging is left behind");
    assert.equal(existsSync(join(spawned.home, "work", "tracked.txt")), true, "the home and the work are kept");
  });
}

/** Put a directory where the worktree's repository would keep the stash's log, with no stash: `git status`
 *  still works and so does a work copy, which has no stash to carry; the kernel cannot read the log. */
function unreadableStashLog(work) {
  mkdirSync(join(commonDirOf(work), "logs", "refs", "stash"), { recursive: true });
  assert.equal(porcelain(work), "", "fixture premise: Git's status still works, and reports a clean worktree");
}
/** A retire hook's body that does to its worktree what `unreadableStashLog` and `unreadableAttributes` do: a directory at `...path` under the repository's common directory. */
const hookMakesDirectory = (...path) => `import { mkdirSync } from 'node:fs';
mkdirSync(join(git('rev-parse', '--path-format=absolute', '--git-common-dir').trim(), ${path.map((part) => JSON.stringify(part)).join(", ")}), { recursive: true });`;

test("a worktree whose Git state cannot be read while its copy can be made, with only a home note to preserve: the work is in the snapshot before the hooks, is copied again after them, and the retire goes through", () => {
  const f = fixture({ capabilities: hookCapability(quietHook("")) });
  const spawned = spawn(f, "unreadable-copied");
  const work = join(spawned.home, "work");
  unreadableStashLog(work);
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  const commit = headOf(work);

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, "");
  assert.equal(existsSync(join(recovery.path, "repo", ".git")), true, "the work is in the snapshot taken before the hooks, although only the home had something to preserve: nothing could prove it unchanged after them");
  assert.equal(recovery.repoCopy, undefined, "the snapshot is not home-only");
  assert.equal(headOf(join(recovery.path, "repo")), commit);
  assert.equal(readFileSync(join(recovery.path, "repo", "tracked.txt"), "utf8"), "base\n");
  assert.equal(readFileSync(join(recovery.path, "home", "notes", "x.md"), "utf8"), "an authored note\n");
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied again under after-hooks/repo/: nothing proves it unchanged");
  assert.equal(headOf(afterRepo), commit);
  assertBothCopiedAgain(recovery);
});

// A retire hook can leave the worktree in that state too. The snapshot before the hooks was then taken of
// a provable worktree and may hold the home only; after the hooks the work is copied, or the retire refuses.

test("a retire hook that leaves the worktree's Git state unreadable while its copy can be made: a snapshot that was home-only gets the work under after-hooks/repo/, and the retire goes through", () => {
  const f = fixture({ capabilities: hookCapability(quietHook(hookMakesDirectory("logs", "refs", "stash"))) });
  const spawned = spawn(f, "hook-unreadable-copied");
  const work = join(spawned.home, "work");
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  const commit = headOf(work);
  const statusBefore = porcelain(work);
  assert.equal(statusBefore, "", "fixture premise: a clean worktree before the retire");

  const { recovery, afterRepo } = retireAfterQuietHook(f, spawned, statusBefore);
  assert.equal(recovery.repoCopy?.copied, false, "fixture premise: the snapshot before the hooks is home-only, of a worktree that was provable then");
  assert.equal(existsSync(join(recovery.path, "repo")), false);
  assert.equal(existsSync(join(afterRepo, ".git")), true, "the work is copied under after-hooks/repo/, although no status row, commit or byte moved: nothing proves that after the hook");
  assert.equal(headOf(afterRepo), commit);
  assert.equal(readFileSync(join(afterRepo, "tracked.txt"), "utf8"), "base\n");
  assert.equal(readFileSync(join(recovery.path, "home", "notes", "x.md"), "utf8"), "an authored note\n", "the snapshot taken before the hooks is intact");
  assertBothCopiedAgain(recovery);
});

test("a retire hook that leaves the worktree's Git state unreadable and its copy impossible: the retire refuses with E_WORK_PRESERVATION_FAILED after the hooks, and the home, the work and the recovery written before the hooks are all kept", () => {
  const f = fixture({ capabilities: hookCapability(quietHook(hookMakesDirectory("info", "attributes"))) });
  const spawned = spawn(f, "hook-unreadable-refused");
  const work = join(spawned.home, "work");
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  assert.equal(porcelain(work), "", "fixture premise: a clean worktree before the retire");

  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.notEqual(retired.status, 0, `a worktree that could be neither proven nor copied after the hooks was retired: ${retired.stdout}`);
  const error = JSON.parse(retired.stdout).error;
  assert.equal(error.code, "E_WORK_PRESERVATION_FAILED", retired.stdout);
  assert.match(error.message, /attributes/, "the message names what the copy could not carry");
  assert.doesNotMatch(error.message, /No retire hook has run/, "the hooks have run: the message does not say otherwise");
  assert.equal(hookRan(spawned.home), true, "fixture premise: the retire hook ran to its end");
  // Everything is kept: the home with the hook's write, the work, and the snapshot taken before the hooks.
  assert.equal(readFileSync(join(spawned.home, "hook-note.txt"), "utf8"), HOOK_BYTES, "the home is kept");
  assert.equal(readFileSync(join(work, "tracked.txt"), "utf8"), "base\n", "the work is kept");
  const recoveries = readdirSync(recoveryRootOf(spawned.home));
  assert.equal(recoveries.length, 1, `one recovery directory: ${recoveries.join(", ")}`);
  const recovery = join(recoveryRootOf(spawned.home), recoveries[0]);
  const manifest = readJson(join(recovery, "recovery.json"));
  assert.equal(manifest.phase, "before-hooks", "the recovery still says the post-hook check has not concluded");
  assert.equal(manifest.repoCopy?.copied, false, "fixture premise: the snapshot before the hooks is home-only, of a worktree that was provable then");
  assert.equal(readFileSync(join(recovery, "home", "notes", "x.md"), "utf8"), "an authored note\n", "the snapshot taken before the hooks is intact");
  assert.deepEqual(readdirSync(recovery).filter((name) => name.includes("after-hooks")), [], "nothing was added to it, and no staging is left in it");
});

// ---- The one recovery of an instance that had nothing to preserve before its hooks ----
// It is written after the hooks, whole and verified, before the worktree step and before the home
// is removed. It is a complete recovery of its own: nothing in it says a snapshot was taken before.

test("a worktree that cannot be proven unchanged, with nothing to preserve before the hooks and a home write by the retire hook: the one recovery is written after the hooks and holds the work too, not the home only", () => {
  const f = fixture({ capabilities: hookCapability(quietHook("")) });
  const spawned = spawn(f, "unprovable-late");
  const work = join(spawned.home, "work");
  unreadableStashLog(work);
  const commit = headOf(work);

  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.equal(hookRan(spawned.home), true, "fixture premise: the retire hook ran to its end");
  assert.deepEqual(recovery.classes, ["changed instance-home bytes"], "the one class, and it appeared after the hooks");
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [basename(recovery.path)], "one recovery");
  // Written after the hooks as the first and only recovery: the hook's write is in home/, and nothing is under after-hooks/.
  assert.equal(readFileSync(join(recovery.path, "home", "hook-note.txt"), "utf8"), HOOK_BYTES);
  assert.equal(existsSync(join(recovery.path, "after-hooks")), false);
  assert.equal(recovery.afterHooks, undefined);
  const manifest = readJson(join(recovery.path, "recovery.json"));
  assert.equal(manifest.phase, "complete");
  assert.equal(manifest.afterHooks, undefined);
  // Only the home has something to preserve, and the worktree is not provable: its work is copied all the same.
  assert.equal(existsSync(join(recovery.path, "repo", ".git")), true, "the work is in the recovery: a worktree that cannot be proven unchanged is never left out as having nothing to preserve");
  assert.equal(recovery.repoCopy, undefined, "the recovery is not home-only");
  assert.equal(headOf(join(recovery.path, "repo")), commit);
  assert.equal(readFileSync(join(recovery.path, "repo", "tracked.txt"), "utf8"), "base\n");
  assert.equal(existsSync(spawned.home), false, "the home is removed");
});

test("the one recovery written after the hooks cannot be made: an instance with nothing to preserve before them, whose retire hook writes the home and leaves the worktree impossible to copy, is refused with E_WORK_PRESERVATION_FAILED, and the home and the work are kept", () => {
  const f = fixture({ capabilities: hookCapability(quietHook(hookMakesDirectory("info", "attributes"))) });
  const spawned = spawn(f, "late-refused");
  const work = join(spawned.home, "work");
  assert.equal(porcelain(work), "", "fixture premise: a clean worktree before the retire, in a home that has nothing to preserve");

  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.notEqual(retired.status, 0, `an instance whose one recovery could not be made was retired: ${retired.stdout}`);
  const error = JSON.parse(retired.stdout).error;
  assert.equal(error.code, "E_WORK_PRESERVATION_FAILED", retired.stdout);
  assert.match(error.message, /attributes/, "the message names what the copy could not carry");
  assert.doesNotMatch(error.message, /No retire hook has run/, "the hooks have run: the message does not say otherwise");
  assert.equal(hookRan(spawned.home), true, "fixture premise: the retire hook ran to its end");
  assert.equal(readFileSync(join(spawned.home, "hook-note.txt"), "utf8"), HOOK_BYTES, "the home is kept, with the hook's write");
  assert.equal(readFileSync(join(work, "tracked.txt"), "utf8"), "base\n", "the work is kept");
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [], "neither a recovery nor its staging is left behind");
});

test("an instance with nothing to preserve before the hooks, whose retire hook writes the home and reports incomplete cleanup: the one recovery is written, and the home and the work are kept for the retry as for any incomplete cleanup", () => {
  const retire = `import { writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const home = process.env.OATS_INSTANCE_HOME;
writeFileSync(join(home, 'hook-note.txt'), ${JSON.stringify(HOOK_BYTES)});
writeFileSync(join(dirname(home), 'hook-saw-' + basename(home)), '{}');
console.log(JSON.stringify({ meta: { retired: false, reason: 'remote unreachable' } }));
`;
  const f = fixture({ capabilities: hookCapability(retire) });
  const spawned = spawn(f, "late-owed");
  const work = join(spawned.home, "work");
  assert.equal(porcelain(work), "", "fixture premise: a clean worktree before the retire, in a home that has nothing to preserve");

  const retired = cli(f, ["retire", basename(spawned.home), "--json"]);
  assert.equal(retired.status, 1, `${retired.stderr}\n${retired.stdout}`);
  const receipt = JSON.parse(retired.stdout);
  assert.equal(hookRan(spawned.home), true, "fixture premise: the retire hook ran to its end");
  assert.ok(receipt.rollbackIncomplete?.some((item) => /acme\.hook: reported incomplete cleanup \(remote unreachable\)/.test(item)), retired.stdout);
  assert.equal(receipt.retainedHome, spawned.home);
  assert.equal(receipt.removedDir, false);
  assert.equal(existsSync(join(spawned.home, ".oats-rollback-incomplete.json")), true, "the home is kept with its cleanup marker");
  assert.equal(readFileSync(join(work, "tracked.txt"), "utf8"), "base\n", "the worktree is where it was: its step waits for the cleanup");
  // The recovery is the one written after the hooks, complete, with the hook's home write.
  const recovery = receipt.workRecovery;
  assert.deepEqual(readdirSync(recoveryRootOf(spawned.home)), [basename(recovery.path)], "one recovery");
  assert.deepEqual(recovery.classes, ["changed instance-home bytes"]);
  assert.equal(readFileSync(join(recovery.path, "home", "hook-note.txt"), "utf8"), HOOK_BYTES);
  assert.equal(readJson(join(recovery.path, "recovery.json")).phase, "complete");
  assert.equal(recovery.afterHooks, undefined);
  assert.equal(existsSync(join(recovery.path, "after-hooks")), false);
});

// ---- An entry that is not a file, a directory or a symbolic link ----
// Proving the work unchanged reads the whole worktree, and such an entry (a socket, a FIFO, a device)
// has no bytes to read or to copy. Git prints no status row for it, so a worktree that holds one can
// read as clean. The retire refuses, names the entry and says what to do; it never says to remove it.
// Before the hooks it also says what this retire has and has not done by then.
const UNSUPPORTED_ENTRY_TEXT = String.raw`\/work\/pipe has an unsupported filesystem type: it is not a file, a directory or a symbolic link, so it cannot be read or copied\. Safely stop the process or resource that owns it, or move the entry elsewhere, before retrying`;
const UNSUPPORTED_ENTRY = new RegExp(`${UNSUPPORTED_ENTRY_TEXT}$`);

test("a FIFO in a worktree that Git reports as clean refuses the retire before its hooks: the message names it, says what to do and says that the instance is not retired, no retire hook runs, no recovery is written and nothing is deleted, however often it is retried", () => {
  const f = fixture({ capabilities: hookCapability(quietHook("")) });
  const spawned = spawn(f, "fifo-before-hooks");
  const work = join(spawned.home, "work");
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  const fifo = join(work, "pipe");
  execFileSync("mkfifo", [fifo]);
  assert.equal(porcelain(work), "", "fixture premise: Git has no status row for a FIFO, so the worktree reads as clean and the snapshot before the hooks would hold the home only");

  for (const attempt of ["first", "second"]) {
    const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
    assert.notEqual(retired.status, 0, `${attempt} attempt: a worktree that cannot be read was retired: ${retired.stdout}`);
    const error = JSON.parse(retired.stdout).error;
    assert.equal(error.code, "E_WORK_INSPECTION_FAILED", retired.stdout);
    assert.match(error.message, new RegExp(`${UNSUPPORTED_ENTRY_TEXT}\\. No recovery was written and nothing was deleted: ${basename(spawned.home)} is not retired and its home is kept; this retire stopped no session$`), "the message names the entry, says what to do, and says what this retire did and did not do: this instance was never launched, so no session was stopped");
    assert.doesNotMatch(error.message, /\b(remove|delete)\b/i, "the entry may be a live endpoint: the message does not say to remove it");
    assert.equal(hookRan(spawned.home), false, `${attempt} attempt: no retire hook ran`);
    assert.equal(existsSync(recoveryRootOf(spawned.home)), false, `${attempt} attempt: no recovery was written`);
    assert.equal(readFileSync(join(spawned.home, "notes", "x.md"), "utf8"), "an authored note\n", "the home is kept");
    assert.equal(lstatSync(fifo).isFIFO(), true, "the worktree is kept as it was");
  }
});

test("a FIFO in the worktree of a launched instance refuses the retire before its hooks, after the retire stopped its session: the message says that its session has been stopped", () => {
  const f = fixture();
  const state = installFakeTmux(f);
  const socket = join(f.base, "socket-fifo");
  f.env.TMUX = `${socket},1,0`;
  const launched = cli(f, ["spawn", "dev", "--purpose", "fifo-launched", "--json"]);
  assert.equal(launched.status, 0, `${launched.stderr}\n${launched.stdout}`);
  const spawned = JSON.parse(launched.stdout).result;
  const window = join(state, socket.replaceAll("/", "_"), "window");
  assert.equal(existsSync(window), true, "fixture premise: the instance was launched, and its window is there");
  assert.equal(readFileSync(join(spawned.home, "early-harness.txt"), "utf8"), "early-harness-bytes\n", "fixture premise: the home has something to preserve");
  const work = join(spawned.home, "work");
  const fifo = join(work, "pipe");
  execFileSync("mkfifo", [fifo]);
  assert.equal(porcelain(work), "", "fixture premise: Git has no status row for a FIFO, so the worktree reads as clean");

  const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
  assert.notEqual(retired.status, 0, `a worktree that cannot be read was retired: ${retired.stdout}`);
  const error = JSON.parse(retired.stdout).error;
  assert.equal(error.code, "E_WORK_INSPECTION_FAILED", retired.stdout);
  assert.match(error.message, new RegExp(`${UNSUPPORTED_ENTRY_TEXT}\\. No recovery was written and nothing was deleted: ${basename(spawned.home)} is not retired and its home is kept; its session has been stopped$`), "the message says what this retire did by then: it stopped the session of a launched instance");
  assert.equal(existsSync(window), false, "the retire stopped the session before it refused");
  assert.equal(existsSync(recoveryRootOf(spawned.home)), false, "no recovery was written");
  assert.equal(readFileSync(join(spawned.home, "early-harness.txt"), "utf8"), "early-harness-bytes\n", "the home is kept");
  assert.equal(lstatSync(fifo).isFIFO(), true, "the worktree is kept as it was");
});

for (const { leaves, body, code, message } of [
  { leaves: "and leaves Git's state as it was", body: "", code: "E_WORK_INSPECTION_FAILED", message: UNSUPPORTED_ENTRY },
  // The Git state moved, so the work is copied without the proof's read, and the copy meets the entry: the tree copy's own refusal.
  { leaves: "and also rewrites a tracked file", body: "writeFileSync(join(work, 'tracked.txt'), 'rewritten by the retire hook\\n');", code: "E_WORK_PRESERVATION_FAILED", message: /\/work\/pipe is not a regular file, directory or symlink \(FIFO\)/ },
]) {
  test(`a retire hook that leaves a FIFO in the worktree ${leaves}: the retire refuses with ${code}, and the home, the work and the recovery written before the hooks are all kept`, () => {
    const retire = quietHook(`execFileSync('mkfifo', [join(work, 'pipe')]);
${body}`);
    const f = fixture({ capabilities: hookCapability(retire) });
    const spawned = spawn(f, body ? "fifo-by-hook-moved" : "fifo-by-hook");
    const work = join(spawned.home, "work");
    write(join(spawned.home, "notes", "x.md"), "an authored note\n");
    assert.equal(porcelain(work), "", "fixture premise: a clean worktree before the retire");

    const retired = cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]);
    assert.notEqual(retired.status, 0, `a worktree that cannot be read was retired: ${retired.stdout}`);
    const error = JSON.parse(retired.stdout).error;
    assert.equal(error.code, code, retired.stdout);
    assert.match(error.message, message, "the message names the entry");
    assert.equal(hookRan(spawned.home), true, "fixture premise: the retire hook ran to its end");
    // Everything is kept: the home with the hook's write, the work with the entry, and the snapshot taken before the hooks.
    assert.equal(readFileSync(join(spawned.home, "hook-note.txt"), "utf8"), HOOK_BYTES, "the home is kept");
    assert.equal(lstatSync(join(work, "pipe")).isFIFO(), true, "the work is kept");
    const recoveries = readdirSync(recoveryRootOf(spawned.home));
    assert.equal(recoveries.length, 1, `one recovery directory: ${recoveries.join(", ")}`);
    const recovery = join(recoveryRootOf(spawned.home), recoveries[0]);
    assert.equal(readJson(join(recovery, "recovery.json")).phase, "before-hooks", "the recovery still says the post-hook check has not concluded");
    assert.equal(readFileSync(join(recovery, "home", "notes", "x.md"), "utf8"), "an authored note\n", "the snapshot taken before the hooks is intact");
    assert.deepEqual(readdirSync(recovery).filter((name) => name.includes("after-hooks")), [], "nothing was added to it, and no staging is left in it");
  });
}

// ---- A file of the worktree that cannot be read ----
// Proving the work unchanged reads every file of a provable worktree, also one under a work root a
// capability declared disposable, and also when the snapshot before the hooks holds the home only.
// A file that cannot be read (here: over 2 GiB, which one read cannot take) refuses the retire
// before its hooks. No flag skips that read.
test("a file over 2 GiB under a declared disposable work root, with only a home note to preserve: the retire refuses with E_WORK_INSPECTION_FAILED before its hooks, with --force too, names the worktree, writes no recovery and keeps the home and the work", () => {
  const capability = hookCapability(quietHook(""));
  capability["acme.hook"].manifest.retirement = { disposable: { work: ["cache"] } };
  const f = fixture({ capabilities: capability });
  const spawned = spawn(f, "large-file");
  const work = join(spawned.home, "work");
  assert.deepEqual(readJson(baselineOf(spawned.home)).disposableReceipts, [{ owner: "acme.hook", root: "cache" }], "fixture premise: the work root was declared disposable at spawn");
  write(join(spawned.home, "notes", "x.md"), "an authored note\n");
  const large = join(work, "cache", "large.bin");
  const LARGE = 2 ** 31 + 1;
  write(large, "");
  truncateSync(large, LARGE); // sparse: no byte of it is written
  assert.deepEqual(statusRowsIn(porcelain(work)), ["!! cache/"], "fixture premise: Git reports the declared root as ignored whole, so only the home has something to preserve");

  for (const flags of [["--discard-worktree"], ["--force"]]) {
    const retired = cli(f, ["retire", basename(spawned.home), ...flags, "--json"]);
    assert.notEqual(retired.status, 0, `${flags[0]}: a worktree with a file that cannot be read was retired: ${retired.stdout}`);
    const error = JSON.parse(retired.stdout).error;
    assert.equal(error.code, "E_WORK_INSPECTION_FAILED", retired.stdout);
    assert.match(error.message, new RegExp(`^could not read the worktree at \\S+\\/work: .+\\. No recovery was written and nothing was deleted: ${basename(spawned.home)} is not retired and its home is kept; this retire stopped no session$`), `${flags[0]}: the message names the worktree, gives the reason the read failed, and says what this retire did and did not do`);
    assert.equal(hookRan(spawned.home), false, `${flags[0]}: no retire hook ran`);
    assert.equal(existsSync(recoveryRootOf(spawned.home)), false, `${flags[0]}: no recovery was written`);
    assert.equal(readFileSync(join(spawned.home, "notes", "x.md"), "utf8"), "an authored note\n", `${flags[0]}: the home is kept`);
    assert.equal(lstatSync(large).size, LARGE, `${flags[0]}: the work is kept as it was`);
  }
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

test("a forced removal past incomplete cleanup removes the home with its declared entries, and recovery holds no copy of them", () => {
  const f = fixture({ capabilities: identCapability({ meta: { retired: false, reason: "remote unreachable" } }) });
  const spawned = spawnWithNote(f, "forced");
  const retired = cli(f, ["retire", "dev-forced", "--force", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const receipt = JSON.parse(retired.stdout);
  assert.ok(receipt.forcedIncomplete?.some((item) => /acme\.ident: reported incomplete cleanup \(remote unreachable\)/.test(item)), retired.stdout);
  assert.equal(receipt.rollbackIncomplete, undefined);
  assert.equal(receipt.removedDir, true);
  assert.equal(identHookRan(spawned.home), true);
  assert.equal(existsSync(spawned.home), false, "the home is removed, and its declared entries with it");
  // What was declared went with the home: no copy of it anywhere under recovery.
  const root = recoveryRootOf(spawned.home);
  assert.deepEqual(readdirSync(root), [basename(receipt.workRecovery.path)], "one recovery");
  assert.deepEqual(pathsNamed(root, "signing.key"), [], "no key anywhere under recovery");
  for (const name of [".ident", ".ident-id-wide", ".ident-state"]) assert.deepEqual(pathsNamed(root, name), [], name);
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
    `recovery: the home is copied to ${recoveryRootOf(a.home)} before the home is removed, when it changed since spawn; not copied: .ident, .ident-id-*, .ident-state (acme.ident)`,
    "recovery: uncommitted worktree state is copied there too",
  ]);
  // Read from the baseline, never from the home: a changed baseline changes the note and nothing else.
  const baseline = readJson(baselineOf(a.home));
  write(baselineOf(a.home), JSON.stringify({ ...baseline, disposableHome: [{ owner: "acme.ident", root: ".ident" }] }, null, 2) + "\n");
  const narrowed = notes(worktree, "dev-plan");
  assert.equal(recoveryNotes(narrowed)[0], `recovery: the home is copied to ${recoveryRootOf(a.home)} before the home is removed, when it changed since spawn; not copied: .ident (acme.ident)`);
  assert.equal(narrowed.planRevision, planned.planRevision, "the plan revision does not depend on the recovery notes");
  // One note lists at most 16 declared roots, in the baseline's order, then counts the rest.
  const many = Array.from({ length: 17 }, (_, i) => `.r${String(i).padStart(2, "0")}`);
  write(baselineOf(a.home), JSON.stringify({ ...baseline, disposableHome: many.map((root) => ({ owner: "acme.ident", root })) }, null, 2) + "\n");
  assert.equal(recoveryNotes(notes(worktree, "dev-plan"))[0], `recovery: the home is copied to ${recoveryRootOf(a.home)} before the home is removed, when it changed since spawn; not copied: ${many.slice(0, 16).join(", ")} (acme.ident), and 1 more`);
  assert.equal(existsSync(recoveryRootOf(a.home)), false, "a plan writes nothing");

  const directory = fixture({ work: "directory", capabilities: hookCapability(RETIRE_WRITES_NOTHING) });
  const b = spawn(directory, "plan");
  assert.deepEqual(recoveryNotes(notes(directory, "dev-plan")), [
    `recovery: the home is copied to ${recoveryRootOf(b.home)} before the home is removed, when it changed since spawn`,
    "recovery: work/ is copied there when it is not empty",
  ]);
});
