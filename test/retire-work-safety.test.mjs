import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CLI = resolve(new URL("../bin/oas.mjs", import.meta.url).pathname);
const temporaryDirectories = [];

function write(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, mode === undefined ? undefined : { mode });
}

function fixture({ disposable = [] } = {}) {
  const base = mkdtempSync(join(tmpdir(), "oas-retire-work-"));
  temporaryDirectories.push(base);
  const repo = join(base, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
  write(join(repo, ".gitignore"), "cache/\nhuman-ignored/\n");
  write(join(repo, "tracked.txt"), "base\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "commit", "-qm", "init"]);

  if (disposable.length) {
    write(join(repo, "oas-config.yaml"), `work-modes:\n  worktree:\n    retirement-disposable: [${disposable.join(", ")}]\n`);
    execFileSync("git", ["-C", repo, "add", "."]);
    execFileSync("git", ["-C", repo, "commit", "-qm", "config"]);
  }

  const root = join(base, "agents");
  const soul = join(root, "dev", "soul");
  write(join(soul, "soul.yaml"), `name: dev\nkind: persistent\nrepo: ${repo}\nwork: worktree\nruntime: pi\n`);
  write(join(soul, "AGENTS.md"), "# Dev\n");
  symlinkSync("AGENTS.md", join(soul, "CLAUDE.md"));
  mkdirSync(join(root, "dev", "instances"), { recursive: true });

  const bin = join(base, "bin");
  write(join(bin, "pi"), "#!/bin/sh\nexit 0\n", 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    OAS_HOME_DIR: join(base, "oas-state"),
  };
  delete env.PI_AGENTS_ROOT;
  return { base, repo, root, env };
}

function cli(f, args) {
  return spawnSync(process.execPath, [CLI, ...args, "--dir", f.root], { encoding: "utf8", env: f.env });
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
    printf 'early-runtime-bytes\\n' > "$cwd/early-runtime.txt"
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

test("launched runtime writes cannot be stamped into the clean retirement baseline", () => {
  const f = fixture();
  installFakeTmux(f);
  f.env.TMUX = `${join(f.base, "socket-a")},1,0`;
  const launched = cli(f, ["spawn", "dev", "--purpose", "early-write", "--json"]);
  assert.equal(launched.status, 0, `${launched.stderr}\n${launched.stdout}`);
  const spawned = JSON.parse(launched.stdout).result;
  assert.equal(readFileSync(join(spawned.home, "early-runtime.txt"), "utf8"), "early-runtime-bytes\n");

  const retired = cli(f, ["retire", "dev-early-write", "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.ok(recovery?.classes.includes("changed instance-home bytes"));
  assert.equal(readFileSync(join(recovery.path, "home", "early-runtime.txt"), "utf8"), "early-runtime-bytes\n");
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
  assert.match(retired.stderr, /E_RUNTIME_AUTHORITY_MISMATCH/);
  assert.equal(existsSync(spawned.home), true, "authority disagreement did not fail before deletion");
  assert.equal(existsSync(activeA), true, "refusal unexpectedly mutated the independently recorded runtime");
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

test("human retire output reports preserved classes and recovery location", () => {
  const f = fixture();
  const spawned = spawn(f, "reported");
  write(join(spawned.home, "work", "report-me.txt"), "report bytes\n");
  const retired = cli(f, ["retire", "dev-reported"]);
  assert.equal(retired.status, 0, retired.stderr);
  assert.match(retired.stdout, /Work that was not committed has been preserved: .*untracked or ignored worktree bytes/);
  assert.match(retired.stdout, /\.oas-retirement\/recovery\/dev-reported-/);
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

test("declared ignored output stays clean while an undeclared ignored twin is preserved", () => {
  const clean = fixture({ disposable: ["cache"] });
  const cleanSpawn = spawn(clean, "owned");
  write(join(cleanSpawn.home, "work", "cache", "later.bin"), "generated-later\n");
  const cleanRetire = cli(clean, ["retire", "dev-owned", "--json"]);
  assert.equal(cleanRetire.status, 0, `${cleanRetire.stderr}\n${cleanRetire.stdout}`);
  assert.equal(JSON.parse(cleanRetire.stdout).workRecovery, undefined, "declared disposable bytes caused a false recovery");

  const risky = fixture({ disposable: ["cache"] });
  const riskySpawn = spawn(risky, "ignored-risk");
  write(join(riskySpawn.home, "work", "cache", "later.bin"), "generated-later\n");
  write(join(riskySpawn.home, "work", "human-ignored", "sentinel.txt"), "ignored-human-bytes\n");
  const riskyRetire = cli(risky, ["retire", "dev-ignored-risk", "--json"]);
  assert.equal(riskyRetire.status, 0, `${riskyRetire.stderr}\n${riskyRetire.stdout}`);
  const recovery = JSON.parse(riskyRetire.stdout).workRecovery;
  assert.ok(recovery?.classes.includes("untracked or ignored worktree bytes"));
  assert.equal(readFileSync(join(recovery.path, "repo", "human-ignored", "sentinel.txt"), "utf8"), "ignored-human-bytes\n");
});

test("missing or corrupt independent authority fails closed before quiescence or deletion", () => {
  for (const corrupt of [false, true]) {
    const f = fixture({ disposable: ["cache"] });
    const spawned = spawn(f, corrupt ? "receipt-corrupt" : "receipt-missing");
    write(join(spawned.home, "work", "cache", "later.bin"), "generated-later\n");
    const baselineDir = join(dirname(spawned.home), ".oas-retirement", "baselines");
    const baseline = join(baselineDir, readdirSync(baselineDir)[0]);
    if (corrupt) write(baseline, "{not-json\n");
    else rmSync(baseline);
    const retired = cli(f, ["retire", corrupt ? "dev-receipt-corrupt" : "dev-receipt-missing", "--json"]);
    assert.notEqual(retired.status, 0, `${corrupt ? "corrupt" : "missing"} authority did not fail closed`);
    assert.match(retired.stderr, corrupt ? /E_WORK_INSPECTION_FAILED/ : /E_RUNTIME_ENDPOINT_UNKNOWN/);
    assert.equal(existsSync(spawned.home), true);
  }
});

test("retire-hook bytes are caught by the final post-hook inspection", () => {
  const f = fixture();
  const cap = join(f.repo, ".agents", "capabilities", "owned", "writer");
  write(join(cap, "oas.json"), JSON.stringify({ capability: "acme.writer", version: "1.0.0", description: "writer", hooks: { retire: "hook.mjs" } }));
  write(join(cap, "hook.mjs"), "import {writeFileSync} from 'node:fs'; import {join} from 'node:path'; writeFileSync(join(process.env.OAS_HOME, 'hook-created.txt'), 'hook-bytes\\n'); console.log(JSON.stringify({meta:{retired:true}}));\n");
  write(join(f.repo, "oas-config.yaml"), "capabilities:\n  additive:\n    acme.writer:\n      global: true\n");
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
