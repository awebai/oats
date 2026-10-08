// awebai/oats#789: before retire removes a home it has no usable receipt for (or whose tmux server
// is lost, or that was opened in Herdr), it decides that nothing works there: no tmux pane and no
// process has its cwd in the home. tmux and lsof report those cwds in the on-disk spelling, so on a
// case-insensitive filesystem (APFS, the macOS default) the home must be compared in its on-disk
// spelling too, or a home addressed in another letter case looks empty while a session works in it.
// The same holds for the `.work-*` extra trees retire keeps as worktrees: git reports their paths
// on disk.
//
// Real processes, real lsof, and a tmux server on this file's own socket; no stubs. The deployment
// is realpath'd, so its on-disk spelling is the fixture's own: `deployment`.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { observeSessionWithoutReceipt, processesInHome } from "../lib/core.mjs";
import { git, v2Deployment } from "./helpers/v2-deployment.mjs";

const fx = v2Deployment({ souls: { dev: {}, wt: { soul: { work: "worktree" } } } });
const socket = join(fx.base, "absence.sock");
const tmux = (...args) => execFileSync("tmux", ["-f", "/dev/null", "-u", "-S", socket, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] }).trim();
const pids = [];
test.after(() => {
  for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  try { tmux("kill-server"); } catch { /* not started */ }
  fx.cleanup();
});

/** Whether this filesystem folds letter case: `Probe` created, `probe` found. */
const caseInsensitive = (() => {
  const probe = join(fx.base, "Probe");
  mkdirSync(probe);
  try { return existsSync(join(fx.base, "probe")); } finally { rmSync(probe, { recursive: true, force: true }); }
})();
const FOLDS = caseInsensitive ? {} : { skip: "filesystem is case-sensitive: two spellings are two directories" };
/** The same path with the deployment directory's letter case changed. */
const upper = (p) => p.replace(`${fx.base}/deployment`, `${fx.base}/DEPLOYMENT`);

async function spawnHome(soul, name) {
  const path = process.env.PATH;
  process.env.PATH = fx.env.PATH;
  try { return (await fx.spawn(soul, { name, harness: "claude" })).home; } finally { process.env.PATH = path; }
}
/** A live process working in `dir` (its on-disk spelling), and not this process's child: the scan
 *  leaves out the caller and its children. Killed after the file's tests, whatever happened. */
function workIn(dir) {
  const pid = Number(execFileSync("sh", ["-c", `(cd "$1" && exec sleep 600) >/dev/null 2>&1 & echo $!`, "sh", dir], { encoding: "utf8" }).trim());
  pids.push(pid);
  return pid;
}

test("#789 P1: a process working in a home is found through another spelling of the home", FOLDS, async () => {
  const home = await spawnHome("dev", "p1");
  const pid = workIn(home);
  for (const spelling of [home, upper(home)]) {
    const scan = await fx.inEnv(() => processesInHome(spelling));
    assert.equal(scan.ok, true, JSON.stringify(scan));
    assert.ok(scan.processes.some((p) => p.pid === pid), `${spelling}: ${JSON.stringify(scan.processes)}`);
  }
});

test("#789 P2: a tmux pane working in a home without its receipt is seen through another spelling of the home", FOLDS, async () => {
  const home = await spawnHome("dev", "p2");
  tmux("new-session", "-d", "-s", "absence", "-n", "other", "-c", home, "sleep 600");
  // The recorded window is gone, so only the pane's cwd can say the home is still worked in.
  const meta = { launched: true, tmux: { session: "absence", window: "p2", socket } };
  for (const spelling of [home, upper(home)]) {
    const seen = await fx.inEnv(() => observeSessionWithoutReceipt(spelling, meta));
    assert.equal(seen.absent, false, `${spelling}: ${JSON.stringify(seen)}`);
    assert.match(seen.note, /a tmux pane \(absence:other\) on .* works in this home/);
  }
});

test("#789 P3: retire through another spelling refuses a home without its receipt while a process works in it", FOLDS, async () => {
  // A worktree home: a directory home without its receipt is refused on its work mode before anything else.
  const home = await spawnHome("wt", "p3");
  rmSync(join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`));
  const pid = workIn(home);
  const r = fx.cli(["retire", "p3", "--dir", upper(fx.dep), "--json"]);
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  const error = JSON.parse(r.stdout).error;
  assert.equal(error?.code, "E_RUNTIME_ENDPOINT_UNKNOWN", r.stdout);
  assert.match(error.message, new RegExp(`a process works in this home \\(pid ${pid} `));
  assert.equal(existsSync(home), true, "the home is kept");
});

test("#789 P4: retire through another spelling keeps a detached extra tree as a worktree, so its own commit stays reachable", FOLDS, async () => {
  const home = await spawnHome("wt", "p4");
  const extra = join(home, ".work-x");
  git(fx.member, "worktree", "add", "-q", "--detach", extra);
  writeFileSync(join(extra, "notes.txt"), "detached work\n");
  git(extra, "add", "notes.txt");
  git(extra, "commit", "-qm", "detached work");
  const commit = git(extra, "rev-parse", "HEAD");
  const plan = fx.cli(["retire", "p4", "--plan", "--dir", upper(fx.dep), "--json"]);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  const planned = JSON.parse(plan.stdout).result.facts.extraWorktrees;
  assert.deepEqual(planned.map((t) => [t.disposition, t.detachedAt]), [["retain", commit]], plan.stdout);
  const r = fx.cli(["retire", "p4", "--dir", upper(fx.dep), "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const [tree] = JSON.parse(r.stdout).extraWorktrees;
  assert.equal(tree?.outcome, "retained", r.stdout);
  assert.equal(existsSync(home), false, "the home itself is retired");
  const kept = git(fx.member, "worktree", "list", "--porcelain").split("\n\n").find((w) => w.includes(`HEAD ${commit}`));
  assert.ok(kept && !kept.includes("prunable"), `the commit's worktree is registered and present:\n${kept}`);
  assert.equal(git(join(kept.match(/^worktree (.*)$/m)[1]), "rev-parse", "HEAD"), commit);
});
