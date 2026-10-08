// `oats doctor` lists what retires left behind (#703 part 2a): one information line per recovery
// copy and per retained worktree, read-only and helper-free, with no new key in --json.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureBase } from "./helpers/host-fixture.mjs";
import { git, v2Deployment } from "./helpers/v2-deployment.mjs";
import { RETAINED_LINES_MAX, retainedRecoveryLines, retainedWorktreeLines, retainedWorktrees } from "../lib/retained-after-retire.mjs";

/** Every entry under `dir` as path → kind, size and mtime, links not followed; files' bytes hashed. */
function snapshot(dir, out = new Map()) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const st = lstatSync(path);
    out.set(path, `${st.mode}:${st.size}:${st.mtimeMs}${st.isFile() ? `:${createHash("sha256").update(readFileSync(path)).digest("hex")}` : ""}`);
    if (st.isDirectory()) snapshot(path, out);
  }
  return out;
}

/** A deployment with what retires leave: two recovery copies of agent `dev` (one with after-hooks/
 *  and a repository copy on branch agents/b, one whose recovery.json is broken) and two retained
 *  worktrees of the member repository (agents/a, dirty, at a commit origin/main reaches; agents/b,
 *  clean, two commits no other ref reaches). The member repository's config names an fsmonitor
 *  that leaves a marker when Git runs it. */
function leftovers(t) {
  const fx = v2Deployment();
  t.after(() => fx.cleanup());
  const retained = join(fx.dep, ".agents", "worktrees", "ws");
  const wtA = join(retained, "agents-a"), wtB = join(retained, "agents-b");
  mkdirSync(retained, { recursive: true });
  git(fx.member, "worktree", "add", "-q", "-b", "agents/a", wtA);
  git(fx.member, "worktree", "add", "-q", "-b", "agents/b", wtB);
  git(wtB, "commit", "-q", "--allow-empty", "-m", "b1");
  git(wtB, "commit", "-q", "--allow-empty", "-m", "b2");
  writeFileSync(join(wtA, "notes.txt"), "untracked\n");
  writeFileSync(join(wtA, "oats-membership.yaml"), "changed\n");
  // A tracked file whose stat moved but not its bytes: a status that refreshes the index rewrites it.
  const later = new Date(Date.now() + 60_000);
  utimesSync(join(wtA, "oats-workspace.yaml"), later, later);

  const recoveries = join(fx.root, "dev", "instances", ".oats-retirement", "recovery");
  const full = join(recoveries, "dev-one-Ab12Cd"), broken = join(recoveries, "dev-two-Xy34Zw");
  mkdirSync(join(full, "home"), { recursive: true });
  mkdirSync(join(full, "after-hooks", "home"), { recursive: true });
  writeFileSync(join(full, "recovery.json"), JSON.stringify({ version: 1, phase: "complete", instance: "dev-one", classes: ["changed instance-home bytes", "untracked or ignored worktree bytes"] }));
  writeFileSync(join(full, "home", "instance.json"), JSON.stringify({ instance: "dev-one", repo: fx.member }));
  git(fx.base, "clone", "-q", "--no-local", "--branch", "agents/b", fx.member, join(full, "repo"));
  git(join(full, "repo"), "remote", "remove", "origin");
  mkdirSync(join(broken, "home"), { recursive: true });
  writeFileSync(join(broken, "recovery.json"), "{ not json");

  const marker = join(fx.base, "fsmonitor-ran");
  const monitor = join(fx.base, "fsmonitor");
  writeFileSync(monitor, `#!/bin/sh\necho ran >> '${marker}'\n`);
  chmodSync(monitor, 0o755);
  git(fx.member, "config", "core.fsmonitor", monitor);
  return { fx, wtA, wtB, full, broken, marker, recoveries };
}
const doctorJson = (fx) => {
  const r = fx.cli(["doctor", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("doctor lists recovery copies and retained worktrees as information lines, read-only, keys unchanged", (t) => {
  const keysBefore = (() => {
    const fx = v2Deployment();
    try { return Object.keys(doctorJson(fx)).sort(); } finally { fx.cleanup(); }
  })();
  const { fx, wtA, wtB, full, broken, marker, recoveries } = leftovers(t);
  const trees = [join(fx.dep, ".agents"), recoveries, join(fx.member, ".git")];
  const before = trees.map((dir) => snapshot(dir));
  const indexes = [join(fx.member, ".git", "worktrees", "agents-a", "index"), join(fx.member, ".git", "worktrees", "agents-b", "index")].map((p) => readFileSync(p));

  const doc = doctorJson(fx);
  assert.deepEqual(Object.keys(doc).sort(), keysBefore, "--json grows no key: only information's contents");
  const recovery = doc.information.filter((l) => l.startsWith("retained-recovery:"));
  const worktree = doc.information.filter((l) => l.startsWith("retained-worktree:"));
  for (const line of [...recovery, ...worktree]) assert.doesNotMatch(line, /\n/, "one element per line");
  for (const line of [...recovery, ...worktree]) assert.doesNotMatch(line, /unique|redundant|safe to delete/i, "facts, never a conclusion");

  assert.equal(recovery.length, 3);
  assert.match(recovery[0], /^retained-recovery: 2 recovery copies that retires left in this deployment; nothing removes them; .*#after-a-retire-inspect-restore-dispose$/);
  assert.equal(recovery[1], `retained-recovery: ${full}: instance dev-one; phase complete; classes: changed instance-home bytes, untracked or ignored worktree bytes; ${recovery[1].match(/size: [^;]+/)[0]}; after-hooks/ present; commits: 2 not reachable from any other ref; retained worktree on the same branch: ${wtB}`);
  assert.match(recovery[1], /; size: \d+(\.\d)? (B|KiB|MiB);/);
  assert.match(recovery[2], new RegExp(`^retained-recovery: ${broken}: recovery\\.json is not valid JSON, so its phase and classes are not known; instance dev-two \\(by the directory's name\\); size: \\d+ B; no after-hooks/; commits: no repository copy$`));

  assert.equal(worktree.length, 3);
  assert.match(worktree[0], /^retained-worktree: 2 retained worktrees that retires left in this deployment; nothing removes them; /);
  // origin/HEAD reaches it too: a remote's branch is named before its HEAD.
  assert.equal(worktree[1], `retained-worktree: ${wtA}: repository ${fx.member}; branch agents/a; not clean; uncommitted: unstaged changes, untracked files; commits: all reachable from origin/main`);
  assert.equal(worktree[2], `retained-worktree: ${wtB}: repository ${fx.member}; branch agents/b; clean; commits: 2 not reachable from any other ref`);

  // Text output: the same lines, one INFO block per kind.
  const text = fx.cli(["doctor"]);
  assert.equal(text.status, 0, text.stderr);
  assert.ok(text.stdout.includes(`\n\n${recovery.map((l) => `INFO: ${l}`).join("\n")}\n`), text.stdout);
  assert.ok(text.stdout.includes(`\n\n${worktree.map((l) => `INFO: ${l}`).join("\n")}\n`), text.stdout);

  // Nothing was written: no index refreshed, no mtime moved, no helper run.
  assert.deepEqual(trees.map((dir) => snapshot(dir)), before);
  assert.deepEqual([join(fx.member, ".git", "worktrees", "agents-a", "index"), join(fx.member, ".git", "worktrees", "agents-b", "index")].map((p) => readFileSync(p)), indexes);
  assert.equal(existsSync(marker), false, "the repository's core.fsmonitor never ran");
  // The fixture is hostile for real: a plain status runs the fsmonitor.
  git(wtA, "status", "--porcelain");
  assert.equal(existsSync(marker), true, "the fixture's fsmonitor runs under a plain git status");
});

test("a recovery's source is a hint: a commit it lacks, a path that is not a repository, a detached worktree", (t) => {
  const { fx, wtB, full } = leftovers(t);
  // The recovery's HEAD is a commit the source does not have.
  git(join(full, "repo"), "commit", "-q", "--allow-empty", "-m", "only in the copy");
  const head = git(join(full, "repo"), "rev-parse", "HEAD");
  let doc = doctorJson(fx);
  assert.ok(doc.information.some((l) => l.startsWith(`retained-recovery: ${full}:`) && l.includes(`; commits: HEAD ${head.slice(0, 12)} is not in the source repository; retained worktree on the same branch: ${wtB}`)), doc.information.join("\n"));
  // The copied home names a directory that is not a repository's top level.
  const notRepo = join(fx.dep, "agents");
  writeFileSync(join(full, "home", "instance.json"), JSON.stringify({ repo: notRepo }));
  doc = doctorJson(fx);
  assert.ok(doc.information.some((l) => l.startsWith(`retained-recovery: ${full}:`) && l.endsWith(`; commits: unknown (recorded repository ${notRepo} is not a Git repository)`)), doc.information.join("\n"));
  // A detached retained worktree: named by its commit, with no own branch to leave out.
  const commit = git(wtB, "rev-parse", "HEAD");
  git(wtB, "checkout", "-q", "--detach");
  doc = doctorJson(fx);
  assert.ok(doc.information.includes(`retained-worktree: ${wtB}: repository ${fx.member}; detached at ${commit.slice(0, 12)}; clean; commits: all reachable from agents/b`), doc.information.join("\n"));
});

test("each kind shows at most 50 items, then how many more; a staging copy and a stray entry are listed", (t) => {
  const base = fixtureBase("oats-retained-");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const recoveries = join(base, "agents", "dev", "instances", ".oats-retirement", "recovery");
  const n = RETAINED_LINES_MAX + 3;
  for (let i = 0; i < n; i++) mkdirSync(join(recoveries, `dev-${String(i).padStart(3, "0")}-abcdef`), { recursive: true });
  mkdirSync(join(recoveries, ".dev-9-zzzzzz"));
  writeFileSync(join(base, "stray"), "x");
  mkdirSync(join(base, ".agents", "worktrees", "ws"), { recursive: true });
  writeFileSync(join(base, ".agents", "worktrees", "ws", "file"), "x");
  const kept = retainedWorktrees(base);
  const lines = retainedRecoveryLines(join(base, "agents"), kept);
  assert.equal(lines.length, 1 + RETAINED_LINES_MAX + 1);
  assert.match(lines[0], new RegExp(`^retained-recovery: ${n + 1} recovery copies `));
  assert.equal(lines[1], `retained-recovery: ${join(recoveries, ".dev-9-zzzzzz")}: unfinished copy (staging a retire could not remove); size: 0 B`);
  assert.equal(lines.at(-1), "retained-recovery: … and 4 more");
  assert.match(lines[2], /: recovery\.json is missing, so its phase and classes are not known; instance dev-000 \(by the directory's name\); size: 0 B; no after-hooks\/; commits: no repository copy$/);
  assert.deepEqual(retainedWorktreeLines(kept).slice(1), [`retained-worktree: ${join(base, ".agents", "worktrees", "ws", "file")}: not a directory`]);
  assert.deepEqual(retainedRecoveryLines(join(base, "nothing"), { trees: [], unreadable: [] }), [], "nothing to say: no lines");
});

/** A script that appends to `marker` whenever Git runs it, then passes its input through. */
function markerScript(fx, name, marker) {
  const path = join(fx.base, name);
  writeFileSync(path, `#!/bin/sh\necho ran >> '${marker}'\ncat\n`);
  chmodSync(path, 0o755);
  return path;
}

test("a status that would run the repository's content filter is not asked for", (t) => {
  const { fx, wtA, } = leftovers(t);
  const marker = join(fx.base, "filter-ran");
  // A clean and a process filter, named by committed attributes, for files whose stat moved.
  writeFileSync(join(wtA, ".gitattributes"), "*.txt filter=probe\n*.dat filter=proc\n");
  writeFileSync(join(wtA, "a.txt"), "a\n");
  writeFileSync(join(wtA, "b.dat"), "b\n");
  git(wtA, "add", ".gitattributes", "a.txt", "b.dat");
  git(wtA, "commit", "-qm", "filtered files");
  git(fx.member, "config", "--unset", "core.fsmonitor");
  git(fx.member, "config", "filter.probe.clean", markerScript(fx, "clean-filter", marker));
  git(fx.member, "config", "filter.proc.process", markerScript(fx, "process-filter", marker));
  const later = new Date(Date.now() + 60_000);
  for (const file of [join(wtA, "a.txt"), join(wtA, "b.dat")]) utimesSync(file, later, later);

  const doc = doctorJson(fx);
  const line = doc.information.find((l) => l.startsWith(`retained-worktree: ${wtA}:`));
  assert.match(line, /; branch agents\/a; clean: unknown \(its repository configures a content filter that doctor does not run: filter\.probe, filter\.proc\); commits: 1 not reachable from any other ref$/);
  assert.equal(existsSync(marker), false, "no filter ran");
  // The fixture is hostile for real: a plain status runs the filter.
  git(wtA, "status", "--porcelain");
  assert.equal(existsSync(marker), true, "the fixture's filter runs under a plain git status");
});

test("a status never enters a submodule, whose own configuration may name a filter", (t) => {
  const { fx, wtB, } = leftovers(t);
  const marker = join(fx.base, "filter-ran");
  git(fx.member, "config", "--unset", "core.fsmonitor");
  const sub = join(fx.base, "sub");
  git(fx.base, "init", "-q", sub);
  writeFileSync(join(sub, ".gitattributes"), "*.txt filter=inner\n");
  writeFileSync(join(sub, "c.txt"), "c\n");
  git(sub, "add", "-A");
  git(sub, "commit", "-qm", "sub");
  git(wtB, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "sub");
  git(wtB, "commit", "-qm", "submodule");
  git(join(wtB, "sub"), "config", "filter.inner.clean", markerScript(fx, "inner-filter", marker));
  const later = new Date(Date.now() + 60_000);
  utimesSync(join(wtB, "sub", "c.txt"), later, later);

  const doc = doctorJson(fx);
  assert.ok(doc.information.includes(`retained-worktree: ${wtB}: repository ${fx.member}; branch agents/b; clean; submodule work trees not read; commits: 3 not reachable from any other ref`), doc.information.join("\n"));
  assert.equal(existsSync(marker), false, "the submodule's filter never ran");
  // The fixture is hostile for real: a plain status enters the submodule and runs it.
  git(wtB, "status", "--porcelain");
  assert.equal(existsSync(marker), true, "the submodule's filter runs under a plain git status");
});

test("a branch name is compared exactly: one ending in U+00A0 is the tree's own branch, not another ref", (t) => {
  const { fx } = leftovers(t);
  const kept = join(fx.dep, ".agents", "worktrees", "ws", "kept");
  git(fx.member, "worktree", "add", "-q", "-b", "kept ", kept);
  git(kept, "commit", "-q", "--allow-empty", "-m", "only on kept");
  const doc = doctorJson(fx);
  assert.ok(doc.information.includes(`retained-worktree: ${kept}: repository ${fx.member}; branch kept ; clean; commits: 1 not reachable from any other ref`), doc.information.join("\n"));
});

test("directories that can't be listed are counted against the 50 lines and summed up in the count line", { skip: process.getuid?.() === 0 ? "root can list a directory with mode 000" : false }, (t) => {
  const base = fixtureBase("oats-retained-");
  const root = join(base, ".agents", "worktrees");
  const locked = [];
  t.after(() => { for (const dir of locked) chmodSync(dir, 0o700); rmSync(base, { recursive: true, force: true }); });
  mkdirSync(join(root, "ws"), { recursive: true });
  writeFileSync(join(root, "ws", "file"), "x");
  for (let i = 0; i < RETAINED_LINES_MAX + 1; i++) {
    const dir = join(root, `repo-${String(i).padStart(3, "0")}`);
    mkdirSync(dir);
    chmodSync(dir, 0o000);
    locked.push(dir);
  }
  const lines = retainedWorktreeLines(retainedWorktrees(base));
  assert.equal(lines.length, 1 + RETAINED_LINES_MAX + 1);
  assert.match(lines[0], new RegExp(`^retained-worktree: 1 retained worktree that retires left in this deployment; ${RETAINED_LINES_MAX + 1} directories could not be listed, and what they hold is not counted; `));
  assert.equal(lines[1], `retained-worktree: ${join(root, "ws", "file")}: not a directory`);
  assert.equal(lines[2], `retained-worktree: ${locked[0]} could not be listed (EACCES)`);
  assert.equal(lines.at(-1), "retained-worktree: … and 2 more");
});
