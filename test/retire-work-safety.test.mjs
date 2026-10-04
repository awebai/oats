import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn as spawnProcess, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { linkExecutables, waitUntil as waitFor } from "./helpers/host-fixture.mjs";
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
  // An endpoint per server: the ambient one ($TMUX, else "default"), a socket named with -S, and
  // the OATS server the kernel selects with -L oats, which lives at $TMUX_FAKE_OATS.
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
state=\${TMUX_FAKE_STATE:?}/\$(printf '%s' "$endpoint" | tr / _)
case "$command" in
  has-session) exit 0 ;;
  list-sessions) exit 0 ;;
  list-windows) [ -f "$state/window" ] && cat "$state/window"; exit 0 ;;
  new-session) mkdir -p "$state"; printf '%s\\t@0\\n' "$endpoint"; exit 0 ;;
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
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("launched harness writes cannot be stamped into the clean retirement baseline", () => {
  const f = fixture();
  installFakeTmux(f);
  f.env.TMUX = `${join(f.base, "ambient-socket")},1,0`;
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
  // The spawn opens its window on the OATS server (here socket A), whatever the ambient TMUX names.
  const socketA = join(f.base, "socket-a");
  f.env.TMUX_FAKE_OATS = socketA;
  f.env.TMUX = `${join(f.base, "ambient-socket")},1,0`;
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
  f.env.TMUX_FAKE_OATS = socketA;
  f.env.TMUX = `${join(f.base, "ambient-socket")},1,0`;
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
  // No retire deletes a branch: the switched branch survives in the repository, as any branch would.
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
  const retired = cli(f, ["retire", "dev-home-only", "--discard-worktree", "--json"]);
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

test("commits only a branch has stay on that branch: no retire deletes it, also with --discard-worktree, which needs no recovery for them", () => {
  for (const flags of [[], ["--discard-worktree"]]) {
    const f = fixture();
    const purpose = flags.length ? "branch-discarded" : "branch-kept";
    const spawned = spawn(f, purpose);
    const work = join(spawned.home, "work");
    write(join(work, "commit.txt"), "unique\n");
    execFileSync("git", ["-C", work, "add", "."]);
    execFileSync("git", ["-C", work, "commit", "-qm", "unique to the instance's branch"]);
    const tip = execFileSync("git", ["-C", work, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const retired = cli(f, ["retire", `dev-${purpose}`, ...flags, "--json"]);
    assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
    const result = JSON.parse(retired.stdout);
    assert.equal(result.branchDeleted, false, purpose);
    assert.equal(result.workRecovery ?? null, null, `${purpose}: the commit is on a branch that outlives the worktree, so nothing needs a recovery`);
    assert.equal(execFileSync("git", ["-C", f.repo, "rev-parse", `refs/heads/agents/dev-${purpose}`], { encoding: "utf8" }).trim(), tip, `${purpose}: the branch is where it was`);
  }
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

test("K3b retention: plain retire RE-HOMES the worktree (dirty state intact, branch untouched) under <workspace>/.agents/worktrees/<repo>/<branch>; --discard-worktree removes the worktree and deletes no branch", () => {
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

  // Discard restores removal, and deletes no branch: neither the worktree's nor the recorded one.
  const d = spawn(f, "discard"); const dw = join(d.home, "work");
  execFileSync("git", ["-C", dw, "switch", "--quiet", "-c", "feat/to-keep"]);
  const rd = JSON.parse(cli(f, ["retire", "dev-discard", "--discard-worktree", "--json"]).stdout);
  assert.equal(rd.retention.worktree, "removed"); assert.equal(rd.retention.branch, "feat/to-keep"); assert.equal(rd.branchDeleted, false);
  assert.equal(Object.hasOwn(rd.retention, "branchDeleted"), false); assert.equal(Object.hasOwn(rd.retention, "branchDeletionSkipped"), false);
  assert.ok(repoGit("branch", "--list", "feat/to-keep"), "the worktree's branch is left");
  assert.ok(repoGit("branch", "--list", rd.retention.recordedBranch), "the recorded spawn branch is left");
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

test("K3 pin 2: a plan-driven --discard-worktree whose retire hook switches the branch deletes no branch: the confirmed and the switched one are both left", () => {
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
  // The hook switches the branch after the plan comparison, before the worktree step.
  const fresh = plan;
  const r = JSON.parse(cli(f, ["retire", "dev-bind", "--plan-revision", fresh.planRevision, "--idempotency-key", "b-1", "--discard-worktree", "--json"]).stdout);
  assert.equal(r.retired, "dev-bind");
  assert.equal(r.branchDeleted, false, `no branch deleted: ${JSON.stringify(r.retention)} hooks=${JSON.stringify(r.hooks ?? r.capabilityMeta)}`);
  assert.equal(r.retention.worktree, "removed");
  assert.equal(r.retention.branch, "feat/sneaky", "the branch the worktree was on when it was removed");
  assert.equal(Object.hasOwn(r.retention, "branchDeletionSkipped"), false);
  const branches = execFileSync("git", ["-C", f.repo, "branch", "--list", "feat/*"], { encoding: "utf8" });
  assert.match(branches, /feat\/confirmed/); assert.match(branches, /feat\/sneaky/, "neither the confirmed nor the switched branch was deleted");
});
