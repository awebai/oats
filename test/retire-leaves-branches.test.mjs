// Retirement leaves branches. A retire deletes no branch; what it preserves of a worktree is proven
// against the commit the worktree has checked out; a commit that only the worktree reaches is
// preserved before the worktree is removed; and a worktree whose HEAD moved after it was inspected is
// not removed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { startInstanceSession } from "../lib/core.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { isolateSessionEnvironment, waitUntil } from "./helpers/host-fixture.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const temporaryDirectories = [];
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function write(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, mode === undefined ? undefined : { mode });
}

/** A workspace deployment whose soul dev works in a worktree of the member clone. */
function fixture() {
  const fx = v2Deployment({
    souls: { dev: { soul: { work: "worktree" }, agents: "# Dev\n" } },
    files: { ".gitignore": "cache/\n", "tracked.txt": "base\n" },
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

test.afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Git in a repository, its output as text without the closing line feed. */
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).replace(/\n$/, "");
/** An empty commit on what the worktree has checked out → its id. */
const commitIn = (work, message) => { git(work, "-c", "commit.gpgSign=false", "commit", "--quiet", "--allow-empty", "-m", message); return git(work, "rev-parse", "HEAD"); };
/** What HEAD names, as the hex of the bytes Git prints; "" when HEAD is detached. */
function headRefHex(repo) {
  const r = spawnSync("git", ["-C", repo, "symbolic-ref", "--quiet", "HEAD"], { stdio: ["ignore", "pipe", "pipe"] });
  if (r.status === 1 && !r.stdout.length) return "";
  assert.equal(r.status, 0, String(r.stderr));
  return r.stdout.toString("hex");
}
const refHex = (ref) => Buffer.concat([Buffer.isBuffer(ref) ? ref : Buffer.from(ref), Buffer.from("\n")]).toString("hex");
/** Where the retire of an instance keeps its recoveries. */
const recoveryRootOf = (home) => join(dirname(home), ".oats-retirement", "recovery");
/** A retire's receipt, after asserting that the retire completed. */
function retiredReceipt(retired) {
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  return JSON.parse(retired.stdout);
}

// ---- The recovery is the worktree's commit, on the worktree's branch ----

const EXACT = "feature "; // ends in U+00A0, which is part of the name
const TRIMMED = "feature";

/** The worktree on the branch EXACT at a commit of its own, and a sibling branch TRIMMED at another
 *  commit: with another tree, or with the same tree. An untracked file gives the retire something
 *  to preserve. → { work, commit, sibling } */
function worktreeBesideTrimmedSibling(spawned, { sameTree }) {
  const work = join(spawned.home, "work");
  const base = git(work, "rev-parse", "HEAD");
  git(work, "switch", "--quiet", "-c", TRIMMED);
  if (!sameTree) {
    write(join(work, "sibling.txt"), "only on the sibling branch\n");
    git(work, "add", "sibling.txt");
  }
  const sibling = sameTree ? commitIn(work, "the sibling's commit") : (git(work, "-c", "commit.gpgSign=false", "commit", "--quiet", "-m", "the sibling's commit"), git(work, "rev-parse", "HEAD"));
  git(work, "switch", "--quiet", "-c", EXACT, base);
  const commit = commitIn(work, "the worktree's commit");
  write(join(work, "scratch.txt"), "untracked\n");
  assert.equal(headRefHex(work), refHex(`refs/heads/${EXACT}`), "fixture premise: the worktree is on the branch whose name ends in U+00A0");
  assert.equal(git(work, "rev-parse", `refs/heads/${TRIMMED}`), sibling, "fixture premise: the branch of the trimmed name is at the sibling's commit");
  assert.notEqual(sibling, commit, "fixture premise: the two branches are at two commits");
  assert.equal(git(work, "rev-parse", `${sibling}^{tree}`) === git(work, "rev-parse", `${commit}^{tree}`), sameTree, `fixture premise: the two commits have ${sameTree ? "the same tree" : "two trees"}`);
  return { work, commit, sibling };
}

/** The recovery's repository is at the worktree's commit, on the worktree's branch, with its untracked file. */
function assertRecoveredOnExactName(receipt, commit) {
  const repo = join(receipt.workRecovery.path, "repo");
  assert.equal(git(repo, "rev-parse", "HEAD"), commit, "the recovery's repository is at the commit the worktree had checked out");
  assert.equal(headRefHex(repo), refHex(`refs/heads/${EXACT}`), "and on the branch the worktree was on, its name as it is");
  assert.equal(readFileSync(join(repo, "scratch.txt"), "utf8"), "untracked\n");
}

test("a worktree on a branch whose name ends in U+00A0, beside a branch of the trimmed name at another commit with another tree: the recovery is the worktree's commit on its own branch name", () => {
  const f = fixture();
  const spawned = spawn(f, "exact-other-tree");
  const { commit } = worktreeBesideTrimmedSibling(spawned, { sameTree: false });
  const receipt = retiredReceipt(cli(f, ["retire", basename(spawned.home), "--json"]));
  assertRecoveredOnExactName(receipt, commit);
});

test("a worktree on a branch whose name ends in U+00A0, beside a branch of the trimmed name at another commit with the same tree: the recovery is the worktree's commit on its own branch name", () => {
  const f = fixture();
  const spawned = spawn(f, "exact-same-tree");
  const { commit } = worktreeBesideTrimmedSibling(spawned, { sameTree: true });
  const receipt = retiredReceipt(cli(f, ["retire", basename(spawned.home), "--json"]));
  assertRecoveredOnExactName(receipt, commit);
});

test("a worktree on a branch that a tag shares its name with: the recovery is the worktree's commit, on the branch", () => {
  const f = fixture();
  const spawned = spawn(f, "tag-of-the-name");
  const work = join(spawned.home, "work");
  const base = git(work, "rev-parse", "HEAD");
  git(work, "switch", "--quiet", "-c", "topic");
  const commit = commitIn(work, "the worktree's commit");
  git(work, "tag", "topic", base);
  write(join(work, "scratch.txt"), "untracked\n");
  assert.equal(headRefHex(work), refHex("refs/heads/topic"), "fixture premise: the worktree is on the branch topic");
  assert.equal(git(work, "rev-parse", "refs/tags/topic"), base, "fixture premise: a tag of the same name is at another commit");
  assert.notEqual(base, commit);

  const receipt = retiredReceipt(cli(f, ["retire", basename(spawned.home), "--json"]));
  const repo = join(receipt.workRecovery.path, "repo");
  assert.equal(git(repo, "rev-parse", "HEAD"), commit, "the recovery's repository is at the commit the worktree had checked out");
  assert.equal(headRefHex(repo), refHex("refs/heads/topic"), "and on the branch, not on the tag");
  assert.equal(readFileSync(join(repo, "scratch.txt"), "utf8"), "untracked\n");
});

// A branch name is bytes, and need not be valid UTF-8. OATS carries a name as text, so it does not
// carry such a name: the plan and the receipt say `branch: null`, and the recovery is checked out
// detached at the worktree's commit.
const NOT_UTF8 = Buffer.concat([Buffer.from("refs/heads/caf"), Buffer.from([0xe9])]);

/** Put the worktree on a branch whose name is not valid UTF-8, made with plain Git: the ref through
 *  `update-ref --stdin`, and the worktree's HEAD by writing the file `rev-parse --git-path HEAD`
 *  names. → true when Git gives those bytes back for HEAD. Where the platform cannot hold the name
 *  the test is skipped with the reason. On Linux that is a failure: there the test cannot pass by
 *  being skipped. */
function onBranchThatIsNotUtf8(t, work) {
  let reason;
  try {
    const at = git(work, "rev-parse", "HEAD");
    execFileSync("git", ["-C", work, "update-ref", "--stdin"], { input: Buffer.concat([Buffer.from("update "), NOT_UTF8, Buffer.from(` ${at}\n`)]), stdio: ["pipe", "pipe", "pipe"] });
    writeFileSync(resolve(work, git(work, "rev-parse", "--git-path", "HEAD")), Buffer.concat([Buffer.from("ref: "), NOT_UTF8, Buffer.from("\n")]));
    const got = headRefHex(work);
    if (got !== refHex(NOT_UTF8)) reason = `Git gave ${got || "a detached HEAD"} for HEAD where the test wrote ${refHex(NOT_UTF8)}`;
  } catch (e) { reason = `the platform refused a branch whose name is not valid UTF-8: ${String(e.stderr || e.message).trim()}`; }
  if (!reason) return true;
  assert.notEqual(process.platform, "linux", `this test is not skipped on Linux: ${reason}`);
  t.skip(reason);
  return false;
}

test("a worktree on a branch whose name is not valid UTF-8: the plan and the receipt carry branch null, and the recovery is checked out detached at the worktree's commit", (t) => {
  const f = fixture();
  const spawned = spawn(f, "name-not-utf8");
  const work = join(spawned.home, "work");
  if (!onBranchThatIsNotUtf8(t, work)) return;
  const commit = commitIn(work, "the worktree's commit");
  write(join(work, "scratch.txt"), "untracked\n");
  assert.equal(headRefHex(work), refHex(NOT_UTF8), "fixture premise: Git gives the name's bytes back for HEAD");
  assert.equal(execFileSync("git", ["-C", work, "for-each-ref", "--format=%(objectname)", "--points-at", commit, "refs/heads"], { encoding: "utf8" }).trim(), commit, "fixture premise: that branch is at the worktree's commit");

  const planned = cli(f, ["retire", basename(spawned.home), "--plan", "--json"]);
  assert.equal(planned.status, 0, `${planned.stderr}\n${planned.stdout}`);
  const facts = JSON.parse(planned.stdout).result.facts.work;
  assert.equal(facts.branch, null, "the plan carries no name for a branch whose name is not valid UTF-8");
  assert.equal(facts.detached, false, "and does not call the worktree detached");

  const receipt = retiredReceipt(cli(f, ["retire", basename(spawned.home), "--json"]));
  assert.equal(receipt.retention.branch, null, "the receipt carries no name either");
  const repo = join(receipt.workRecovery.path, "repo");
  assert.equal(git(repo, "rev-parse", "HEAD"), commit, "the recovery's repository is at the commit the worktree had checked out");
  assert.equal(headRefHex(repo), "", "checked out detached");
  assert.equal(readFileSync(join(repo, "scratch.txt"), "utf8"), "untracked\n");
  const drift = readJson(join(receipt.workRecovery.path, "recovery.json")).branchDrift;
  assert.equal(drift.worktreeBranch, null);
  assert.equal(drift.detachedAt, commit);
});

// ---- A commit that only the worktree reaches ----

test("--discard-worktree on a clean worktree whose HEAD is detached at a commit that no ref reaches: a recovery that holds the commit is written before the worktree is removed", () => {
  const f = fixture();
  const spawned = spawn(f, "detached-commit");
  const work = join(spawned.home, "work");
  git(work, "checkout", "--quiet", "--detach");
  const commit = commitIn(work, "a commit only the worktree's HEAD reaches");
  assert.equal(headRefHex(work), "", "fixture premise: the worktree's HEAD is detached");
  assert.equal(git(work, "status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching"), "", "fixture premise: the worktree is clean");
  assert.equal(git(f.repo, "for-each-ref", "--contains", commit, "--format=%(refname)"), "", "fixture premise: no ref of the repository reaches the commit");
  // The removal of the worktree is where the order shows: a stand-in `git` first on PATH passes every
  // call to the real Git, and when it is asked to remove a worktree it first records the HEAD of each
  // recovery the retire has completed by then: one in place under its own name, with its recovery.json
  // (a recovery is written under a staging name and renamed into place only when it is whole).
  const recoveries = recoveryRootOf(spawned.home);
  const atRemoval = join(f.base, "recoveries-at-removal");
  write(join(f.base, "bin", "git"), `#!/bin/sh
real=${shq(realGit())}
case " $* " in *" worktree remove "*)
  : >> ${shq(atRemoval)}
  for recovery in ${shq(recoveries)}/${shq(basename(spawned.home))}-*; do
    if [ -f "$recovery/recovery.json" ] && [ -d "$recovery/repo" ]; then "$real" -C "$recovery/repo" rev-parse HEAD >> ${shq(atRemoval)}; fi
  done ;;
esac
exec "$real" "$@"
`, 0o755);

  const receipt = retiredReceipt(cli(f, ["retire", basename(spawned.home), "--discard-worktree", "--json"]));
  assert.equal(existsSync(atRemoval), true, "the retire asked Git to remove the worktree");
  assert.equal(readFileSync(atRemoval, "utf8"), `${commit}\n`, "when the worktree was removed, a completed recovery already held the commit, checked out");
  assert.ok(receipt.workRecovery?.path, `a recovery is written for the commit that only the worktree reached: ${JSON.stringify(receipt)}`);
  const repo = join(receipt.workRecovery.path, "repo");
  assert.equal(git(repo, "cat-file", "-t", commit), "commit", "the recovery's repository has the commit");
  assert.equal(git(repo, "rev-parse", "HEAD"), commit, "and is checked out at it");
  assert.equal(existsSync(work), false, "the worktree is removed, after the recovery was written");
  assert.equal(existsSync(spawned.home), false, "the home is removed");
});

// ---- A HEAD that moves after the final inspection ----

const HEAD_MOVED = "the worktree's HEAD changed after it was inspected, so the worktree was not removed. The home, the worktree and the recovery are kept; retry the retire.";

/** The Git the tests run, by its path: what a stand-in on PATH passes every call to. */
function realGit() {
  for (const dir of (process.env.PATH || "").split(delimiter).filter(isAbsolute)) {
    const candidate = join(dir, "git");
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* next */ }
  }
  throw new Error("this test needs git on PATH");
}

test("a HEAD that moves between the retire's final inspection and the removal of the worktree stops the retire: the home, the worktree and the recovery are kept", () => {
  const f = fixture();
  const spawned = spawn(f, "head-moves");
  const other = spawn(f, "relinked");
  const name = basename(spawned.home);
  const work = join(spawned.home, "work");
  // Between its final inspection and its worktree step, a retire takes the retiring instance out of
  // the lineage of the instances that name it. That write marks the window: a stand-in `git` on PATH
  // passes every call to the real Git, and before the first read of the worktree's HEAD that comes
  // after that write it detaches HEAD and commits, once. So HEAD moves after the last inspection and
  // before the worktree is removed, and at no other time.
  const otherMeta = join(other.home, "instance.json");
  const edge = `"parentInstance": ${JSON.stringify(name)}`;
  write(otherMeta, JSON.stringify({ ...readJson(otherMeta), parentInstance: name }, null, 2) + "\n");
  assert.ok(readFileSync(otherMeta, "utf8").includes(edge), "fixture premise: the other instance names the retiring one as its parent");
  write(join(work, "scratch.txt"), "untracked\n");
  const marker = join(f.base, "head-moved");
  write(join(f.base, "bin", "git"), `#!/bin/sh
real=${shq(realGit())}
marker=${shq(marker)}
if [ ! -e "$marker" ] && [ "$1" = -C ]; then
  case "$2" in */instances/${name}/work)
    case " $* " in *" HEAD "*|*" HEAD^{commit} "*)
      if ! grep -q ${shq(edge)} ${shq(otherMeta)}; then
        "$real" -C "$2" checkout --quiet --detach &&
        "$real" -C "$2" -c commit.gpgSign=false commit --quiet --allow-empty -m 'made after the final inspection' &&
        "$real" -C "$2" rev-parse HEAD > "$marker"
      fi ;;
    esac ;;
  esac
fi
exec "$real" "$@"
`, 0o755);
  const before = git(work, "rev-parse", "HEAD");

  const retired = cli(f, ["retire", name, "--discard-worktree", "--json"]);
  assert.equal(existsSync(marker), true, `fixture premise: HEAD was moved after the final inspection: ${retired.stderr}\n${retired.stdout}`);
  const moved = readFileSync(marker, "utf8").trim();
  assert.notEqual(moved, before, "fixture premise: HEAD is at another commit than the one that was inspected");
  assert.equal(retired.status, 1, `the retire refuses: ${retired.stderr}\n${retired.stdout}`);
  const error = JSON.parse(retired.stdout).error;
  assert.equal(error.code, "E_WORK_PRESERVATION_FAILED");
  assert.equal(error.message, HEAD_MOVED);
  assert.equal(existsSync(join(spawned.home, "instance.json")), true, "the home is kept");
  assert.equal(git(work, "rev-parse", "HEAD"), moved, "the worktree is kept, at the commit HEAD moved to");
  assert.equal(readFileSync(join(work, "scratch.txt"), "utf8"), "untracked\n");
  const recoveries = readdirSync(recoveryRootOf(spawned.home));
  assert.equal(recoveries.length, 1, "the recovery written before the retire hooks is kept");
  assert.equal(readFileSync(join(recoveryRootOf(spawned.home), recoveries[0], "repo", "scratch.txt"), "utf8"), "untracked\n");
});

// ---- --delete-branch is refused before anything happens ----

const DELETE_BRANCH_REFUSED = "oats retire no longer deletes branches: --delete-branch is not accepted. Retire without it; the branch is left in the repository. Inspect it there and delete it with Git if it is no longer wanted.";

test("oats retire --delete-branch is refused with E_BAD_ARGS before anything happens: a recorded child that was running is still running, and the instance, its worktree and its branch are as they were", async (t) => {
  // Real tmux on a private socket, and a harness that records its process id and idles.
  // The cleanup is registered before anything that can fail, and each of its steps runs whatever the
  // one before it did.
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-leaves-branches-")));
  const socket = join(base, "tmux.sock");
  const session = "r";
  let restoreEnvironment, fx;
  t.after(() => {
    try { execFileSync("tmux", ["-u", "-S", socket, "kill-server"], { stdio: "ignore", timeout: 10000 }); } catch { /* no server on the private socket */ }
    finally {
      try { restoreEnvironment?.(); }
      finally {
        try { fx?.cleanup(); }
        finally { rmSync(base, { recursive: true, force: true }); }
      }
    }
  });
  restoreEnvironment = isolateSessionEnvironment(base, socket);
  const binDir = join(base, "bin");
  const harness = join(binDir, "claude");
  write(harness, `#!/bin/sh\necho $$ > "$OATS_INSTANCE_HOME/pid.txt"\nexec sleep 86400\n`, 0o755);
  chmodSync(harness, 0o755);
  process.env.PATH = `${binDir}:${process.env.PATH}`;
  const env = () => {
    const e = { ...process.env, OATS_HOME_DIR: join(base, "oats-home") };
    for (const k of ["OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME", "PI_AGENTS_ROOT"]) delete e[k];
    return e;
  };
  const oats = (args) => spawnSync(process.execPath, [CLI, ...args, "--dir", fx.dep, "--json"], { encoding: "utf8", env: env() });
  fx = v2Deployment({ souls: { dev: { soul: { work: "worktree" } } }, files: { "tracked.txt": "base\n" } });
  const parent = await fx.spawn("dev", { name: "parent", launch: false, harness: "claude" });
  const kid = await fx.spawn("dev", { name: "kid", work: "checkout", launch: false, harness: "claude" });
  // The child is recorded as launched at the private endpoint, in its metadata and in the
  // independent session receipt, and as a child of the instance to retire. Then it is started.
  const kidMeta = { ...readJson(join(kid.home, "instance.json")), harness: "claude", tmux: { session, window: "kid", socket }, launched: true, parentInstance: "parent",
    command: `OATS_INSTANCE='kid' OATS_INSTANCE_HOME=${shq(kid.home)} PI_AGENT_INSTANCE='kid' PI_AGENT_HOME=${shq(kid.home)} ${shq(harness)} --dangerously-skip-permissions -- "$(cat TASK.md)"`,
    launch: { version: 2, harness: "claude", launchConfig: null, launchConfigSource: null, executable: harness, executableDeclared: null, executableResolvedFrom: "PATH", args: [], env: {}, model: null, yolo: true, hooks: { launch: {}, env: {}, contributions: [] }, prompt: { kind: "task-file", file: "TASK.md" } } };
  write(join(kid.home, "instance.json"), JSON.stringify(kidMeta, null, 2) + "\n");
  const baselinePath = join(dirname(kid.home), ".oats-retirement", "baselines", `${createHash("sha256").update(kid.home).digest("hex")}.json`);
  write(baselinePath, JSON.stringify({ ...readJson(baselinePath), runtime: { launched: true, tmux: { session, window: "kid", socket } } }, null, 2) + "\n");
  const runningPid = () => {
    try {
      const text = readFileSync(join(kid.home, "pid.txt"), "utf8").trim();
      const pid = Number(text);
      if (!/^\d+$/.test(text) || !Number.isSafeInteger(pid) || pid <= 1) return null;
      process.kill(pid, 0);
      return pid;
    } catch { return null; }
  };
  startInstanceSession(kid.home, { env: env() });
  await waitUntil(() => runningPid() !== null, "the child's harness");
  const pid = runningPid();
  const parentMeta = readJson(join(parent.home, "instance.json"));
  const branchOf = () => spawnSync("git", ["-C", fx.member, "rev-parse", "--verify", "--quiet", `refs/heads/${parentMeta.branch}`], { encoding: "utf8" });
  const branchAt = branchOf().stdout.trim();
  assert.match(branchAt, /^[0-9a-f]{40,64}$/, "fixture premise: the instance's branch exists");

  const planned = oats(["retire", "parent", "--plan"]);
  assert.equal(planned.status, 0, `${planned.stderr}\n${planned.stdout}`);
  const plan = JSON.parse(planned.stdout).result;
  assert.deepEqual(plan.facts.children.map((c) => c.instance), ["kid"], "fixture premise: the plan lists the running child");

  const refused = oats(["retire", "parent", "--plan-revision", plan.planRevision, "--idempotency-key", "k-1", "--delete-branch"]);
  assert.equal(refused.status, 1, `--delete-branch is refused: ${refused.stderr}\n${refused.stdout}`);
  const error = JSON.parse(refused.stdout).error;
  assert.equal(error.code, "E_BAD_ARGS");
  assert.equal(error.message, DELETE_BRANCH_REFUSED);
  assert.equal(runningPid(), pid, "the recorded child is still running");
  assert.equal(existsSync(join(kid.home, ".oats-stop.json")), false, "and was not asked to stop");
  assert.equal(existsSync(join(parent.home, "instance.json")), true, "the instance is not retired");
  assert.equal(existsSync(join(parent.home, "work", ".git")), true, "its worktree is there");
  assert.equal(branchOf().stdout.trim(), branchAt, "its branch is where it was");
  assert.equal(existsSync(join(dirname(parent.home), ".oats-retire-receipt.k-1.json")), false, "no receipt was written");
  assert.equal(existsSync(recoveryRootOf(parent.home)), false, "and no recovery");
});

// ---- The plan's name for a HEAD that is not on a branch OATS can name ----

test("the plan of a worktree whose HEAD names a ref outside refs/heads/: branch null, and not detached", () => {
  const f = fixture();
  const spawned = spawn(f, "head-on-a-tag");
  const work = join(spawned.home, "work");
  git(work, "tag", "v1");
  writeFileSync(resolve(work, git(work, "rev-parse", "--git-path", "HEAD")), "ref: refs/tags/v1\n");
  assert.equal(headRefHex(work), refHex("refs/tags/v1"), "fixture premise: Git gives the tag's ref for HEAD");

  const planned = cli(f, ["retire", basename(spawned.home), "--plan", "--json"]);
  assert.equal(planned.status, 0, `${planned.stderr}\n${planned.stdout}`);
  const facts = JSON.parse(planned.stdout).result.facts.work;
  assert.equal(facts.branch, null, "a ref outside refs/heads/ is not a branch name");
  assert.equal(facts.detached, false);
  const text = cli(f, ["retire", basename(spawned.home), "--plan"]);
  assert.match(text.stdout, / untracked on a branch OATS carries no name for;/, "the plan's text does not call it detached");
});
