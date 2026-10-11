// An instance attached to a tree of its owner is not left with a link to nowhere without being told
// (awebai/oats#964). Its `work` is a link to the owner's `work/` or to one of the owner's extra
// trees. When the owner is retired, a tree that is re-homed takes its attached children with it
// (their link is repointed), and a tree that is removed is said, by name, in the plan beforehand
// and in the receipt afterwards. `oats worktree remove` does not remove a tree under an attached
// instance whose session runs or cannot be read, and names one whose session is stopped. One
// function finds who is attached to a tree (core attachedWorkLink), for both verbs. Every case
// runs the real CLI against a scratch deployment.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { oatsSocket, waitUntil } from "./helpers/host-fixture.mjs";
import { startGated } from "./helpers/fs-gate-preload.mjs";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";

const HAS_TMUX = (() => { try { execFileSync("tmux", ["-V"], { stdio: "ignore", timeout: 5000 }); return true; } catch { return false; } })();
const NO_TMUX = !HAS_TMUX && "tmux is not installed";
const SHELL = "/bin/sh";
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
/** A link that is there and leads nowhere. */
const dangles = (link) => lstatSync(link).isSymbolicLink() && !existsSync(link);
/** The #718 note for `work/`, word for word. */
const WORK_NOTE = (names) => `attached child instance(s) ${names} use this home's work/ as their work: a retire that keeps the worktree repoints their work link to it; with --discard-worktree the worktree is removed and their work link will dangle`;
const REPOINTED = (names) => `; attached child instance(s) ${names} use it as their work, and the retire repoints their work link to it`;
const GONE = (names) => `; attached child instance(s) ${names} use it as their work, and their work link would then point at a path that is gone`;
const REMOVED_TREE = "an extra worktree of the retired instance, clean: its branch and commits stay in its repository";

/** A scratch deployment of the souls `dev` (work: worktree) and `dev-twin` (work: checkout), and
 *  what the cases do in it. One instance name fits both souls (`dev-twin-1`): two homes of one name
 *  under one root. */
function deployment(t) {
  const fx = v2Deployment({ souls: { dev: { soul: { work: "worktree" } }, "dev-twin": { soul: { work: "checkout" } } }, t });
  // An in-process spawn looks for the harness's executable on this process's PATH, with `launch: false`
  // too: the fixture's PATH has the inert harnesses, a bare runner's has none.
  const hostPath = process.env.PATH; process.env.PATH = fx.env.PATH; t.after(() => { process.env.PATH = hostPath; });
  // As the worktree verb's own tests: no system or global Git configuration, no prompt, no helper.
  Object.assign(fx.env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "",
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "" });
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: fx.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  // A stand-in harness that idles until it is signalled: a child that is to run is spawned with
  // this directory first on PATH, and no harness installed on the host is ever started.
  const idleBin = join(fx.base, "idle-bin");
  mkdirSync(idleBin);
  writeFileSync(join(idleBin, "pi"), `#!/bin/sh\necho $$ > "$OATS_INSTANCE_HOME/harness.pid"\nexec sleep 600\n`, { mode: 0o755 });
  const socket = oatsSocket(fx.env.TMUX_TMPDIR);
  const harnesses = [];
  fx.beforeCleanup(() => {
    for (const pid of harnesses) if (alive(pid)) process.kill(pid, "SIGKILL");
    if (HAS_TMUX && existsSync(socket)) { try { execFileSync("tmux", ["-f", "/dev/null", "-S", socket, "kill-server"], { stdio: "ignore", timeout: 10000 }); } catch { /* no server runs */ } }
  });
  const envelope = (r) => { try { return r.json(); } catch { assert.fail(`no envelope: ${r.stdout}${r.stderr}`); } };
  const ok = (r) => { const e = envelope(r); assert.equal(e.ok, true, JSON.stringify(e.error)); return e.result; };
  const d = {
    fx, git,
    /** A worktree instance of `soul`: an owner. */
    owner: (instance, soul = "dev") => fx.spawn(soul, { instance }),
    /** A tree of `home` made with Git: `<home>/.work-<purpose>` on a new branch of `repo`. Clean
     *  (a retire removes it) unless `dirty` (a retire re-homes it). */
    tree: (home, purpose, { dirty = false, repo = fx.member } = {}) => {
      const path = join(home, `.work-${purpose}`);
      git(repo, "worktree", "add", "-q", "-b", `tree-${purpose}`, path);
      if (dirty) writeFileSync(join(path, "uncommitted.txt"), "work in the tree\n");
      return path;
    },
    /** A tree of `home` made with `oats worktree add`: the kind `oats worktree remove` removes. */
    added: (home, purpose) => { const r = ok(d.wt(home, ["add", "--purpose", purpose, "--branch", `agents/${purpose}`, "--base", "main", "--json"])); return r.path; },
    /** `oats worktree …` from `home`, as an agent runs it. */
    wt: (home, args) => fx.cli(["worktree", ...args], { cwd: home, env: { OATS_INSTANCE_HOME: home } }),
    /** An instance attached to the tree at `dir`: its owner and its repository are derived (#958). */
    attach: (purpose, dir, { runnable = false } = {}) => ok(fx.cli(["spawn", "dev", "--work", "attached", "--work-dir", dir, "--purpose", purpose, "--no-launch", "--json"], { env: { SHELL, ...(runnable ? { PATH: `${idleBin}:${fx.env.PATH}` } : {}) } })),
    /** Start the stand-in harness of `kid` (spawned `runnable`) and wait until its session reads as running. */
    start: async (kid) => {
      const started = fx.cli(["session", "start", "--home", kid.home, "--json"], { env: { SHELL } });
      assert.equal(started.status, 0, `fixture premise: \`oats session start\` starts ${kid.instance}\n${started.stdout}\n${started.stderr}`);
      const harness = () => { try { const text = readFileSync(join(kid.home, "harness.pid"), "utf8").trim(); return /^\d+$/.test(text) && Number(text) > 1 ? Number(text) : null; } catch { return null; } };
      await waitUntil(() => harness() !== null && alive(harness()), `the stand-in harness of ${kid.instance} to run`);
      harnesses.push(harness());
      await waitUntil(() => { const s = d.stopPlan(kid.instance).targets[0].session; return s.present === true && s.state !== "shell"; }, `the session of ${kid.instance} to read as running`);
    },
    stopPlan: (instance) => ok(fx.cli(["instance", "stop", instance, "--plan", "--json"], { env: { SHELL } })),
    /** Remove the spawn's receipt of `home`: its session can then not be established. */
    unreadable: (home) => {
      const dir = join(dirname(home), ".oats-retirement", "baselines");
      const mine = readdirSync(dir).filter((n) => { try { return readJson(join(dir, n)).home === realpathSync(home); } catch { return false; } });
      assert.equal(mine.length, 1, "fixture premise: one receipt of that home");
      rmSync(join(dir, mine[0]));
      assert.equal(d.stopPlan(basename(home)).targets[0].session.established, false, "fixture premise: its session is not established");
    },
    plan: (instance) => ok(fx.cli(["retire", instance, "--plan", "--json"])),
    /** `oats retire <instance> --json` → its receipt (a retire that is done prints it over several lines). */
    retired: (instance, flags = []) => {
      const r = fx.cli(["retire", instance, "--json", ...flags]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      return JSON.parse(r.stdout);
    },
    link: (kid) => readlinkSync(join(kid.home, "work")),
    registered: (path, repo = fx.member) => git(repo, "worktree", "list", "--porcelain").split("\n").includes(`worktree ${path}`),
  };
  return d;
}

test("a retire that re-homes an extra tree repoints each child attached to it, as it does for work/; the plan names each child with its tree (#964)", async (t) => {
  const d = deployment(t);
  const owner = await d.owner("dev-owner");
  // Another repository than the owner's, with a tree of it in the owner's home.
  const other = join(d.fx.base, "other-repo");
  execFileSync("git", ["init", "-q", "-b", "main", other], { env: d.fx.env });
  d.git(other, "commit", "--allow-empty", "-qm", "another repository");
  const shared = d.tree(owner.home, "shared", { dirty: true });
  const foreign = d.tree(owner.home, "foreign", { dirty: true, repo: other });
  const alone = d.tree(owner.home, "alone", { dirty: true });
  // Two children on one tree, one on work/, one on the tree of the other repository, none on the third.
  const first = d.attach("first", shared), second = d.attach("second", shared);
  const onWork = d.attach("on-work", join(owner.home, "work"));
  const onForeign = d.attach("on-foreign", foreign);

  const plan = d.plan(owner.instance);
  const rows = Object.fromEntries(plan.facts.extraWorktrees.map((row) => [row.path, row]));
  for (const path of [shared, foreign, alone]) assert.equal(rows[path].disposition, "retain", path);
  const noteOf = (path) => { const notes = plan.notes.filter((n) => n.startsWith(`extra worktree ${path} `)); assert.equal(notes.length, 1, path); return notes[0]; };
  assert.ok(noteOf(shared).endsWith(REPOINTED(`${first.instance}, ${second.instance}`)), noteOf(shared));
  assert.ok(noteOf(foreign).endsWith(REPOINTED(onForeign.instance)), noteOf(foreign));
  assert.doesNotMatch(noteOf(alone), /attached child/, "a tree nobody is attached to: its note as it was");
  assert.deepEqual(plan.notes.filter((n) => n.startsWith("attached child")), [WORK_NOTE(onWork.instance)], "the note for work/, word for word");

  const receipt = d.retired(owner.instance);
  assert.equal(receipt.removedDir, true);
  assert.equal(receipt.warnings, undefined, "every child was repointed: nothing to warn of");
  const movedTo = Object.fromEntries(receipt.extraWorktrees.map((row) => [row.path, row.movedTo]));
  for (const [kid, tree] of [[first, shared], [second, shared], [onForeign, foreign]]) {
    assert.equal(d.link(kid), movedTo[tree], `${kid.instance}: its link is the tree's new path`);
    assert.equal(readFileSync(join(kid.home, "work", "uncommitted.txt"), "utf8"), "work in the tree\n", `${kid.instance}: its work is the tree, with what it held`);
    // The child's own plan observes its work again.
    assert.equal(d.plan(kid.instance).facts.work.observed, true, kid.instance);
    assert.equal(readJson(join(kid.home, "instance.json")).work, "attached", "instance.json is not rewritten for the relink");
  }
  assert.equal(d.link(onWork), receipt.retention.movedTo, "the child on work/ follows work/, as before");
  assert.equal(d.registered(realpathSync(movedTo[foreign]), other), true, "the other repository's tree is registered at its new path");
});

test("a retire that removes a tree names each child it leaves with a link to a path that is gone: a clean extra tree, and work/ with --discard-worktree; the plan says so beforehand (#964)", async (t) => {
  const d = deployment(t);
  for (const text of [false, true]) {
    const owner = await d.owner(`dev-owner-${text ? "text" : "json"}`);
    const clean = d.tree(owner.home, `clean-${text ? "t" : "j"}`);
    const onTree = d.attach(`on-tree-${text ? "t" : "j"}`, clean), onWork = d.attach(`on-work-${text ? "t" : "j"}`, join(owner.home, "work"));
    const plan = d.plan(owner.instance);
    assert.equal(plan.facts.extraWorktrees[0].disposition, "remove");
    const note = plan.notes.find((n) => n.startsWith(`extra worktree ${clean} `));
    assert.match(note, / is clean and would be removed; its branch and commits stay in /);
    assert.ok(note.endsWith(GONE(onTree.instance)), note);
    assert.deepEqual(plan.notes.filter((n) => n.startsWith("attached child")), [WORK_NOTE(onWork.instance)]);
    const SAID = [
      `${onTree.instance}: its work was ${clean}, which this retire removed (${REMOVED_TREE}); its work link ${join(onTree.home, "work")} now points at a path that is gone`,
      `${onWork.instance}: its work was ${join(owner.home, "work")}, which this retire removed (--discard-worktree); its work link ${join(onWork.home, "work")} now points at a path that is gone`,
    ];
    if (text) {
      const r = d.fx.cli(["retire", owner.instance, "--discard-worktree"]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const lines = r.stdout.split("\n");
      for (const said of SAID) assert.ok(lines.includes(`  WARNING: ${said}`), r.stdout);
    } else {
      const receipt = d.retired(owner.instance, ["--discard-worktree"]);
      assert.equal(receipt.extraWorktrees[0].outcome, "removed");
      assert.equal(receipt.retention.worktree, "removed");
      assert.deepEqual(receipt.warnings, SAID);
    }
    assert.equal(existsSync(owner.home), false);
    for (const kid of [onTree, onWork]) assert.equal(dangles(join(kid.home, "work")), true, `${kid.instance}: its link is left as it was, and leads nowhere`);
    assert.equal(d.link(onTree), clean);
    assert.equal(d.git(d.fx.member, "rev-parse", "--verify", `refs/heads/tree-clean-${text ? "t" : "j"}`).length > 0, true, "the removed tree's branch stays");
  }
});

test("a retire that keeps the home in place moves no tree and says nothing of the children attached to them (#964)", async (t) => {
  const d = deployment(t);
  const owner = await d.owner("dev-owner");
  const tree = d.tree(owner.home, "kept", { dirty: true });
  const kid = d.attach("kid", tree);
  const receipt = d.retired(owner.instance, ["--keep-dir"]);
  assert.equal(receipt.removedDir, false);
  assert.equal(receipt.extraWorktrees, undefined);
  assert.equal(receipt.warnings, undefined);
  assert.equal(d.link(kid), tree);
  assert.equal(existsSync(join(kid.home, "work", "uncommitted.txt")), true);
});

test("a child whose attachment changed after the retire found it is left as it is, with the warning work/ has (#964)", async (t) => {
  const d = deployment(t);
  const owner = await d.owner("dev-owner");
  const tree = d.tree(owner.home, "moving", { dirty: true });
  const changed = d.attach("changed", tree), kept = d.attach("kept", tree);
  const movedTo = d.plan(owner.instance).facts.extraWorktrees[0].movedTo;
  // The retire is held where it is about to move the tree: it has found who is attached by then.
  const run = startGated([CLI, "retire", owner.instance, "--json"], { cwd: d.fx.dep, env: d.fx.env, gateDir: join(d.fx.base, "gates"),
    gates: [{ name: "about-to-move", fn: "mkdirSync", path: dirname(movedTo), waitMs: 120000 }] });
  let out;
  try {
    await run.waitGate("about-to-move");
    assert.equal(existsSync(tree), true, "the tree is still in the home");
    // The second writer: the child's record no longer says attached.
    const record = join(changed.home, "instance.json");
    writeFileSync(record, JSON.stringify({ ...readJson(record), work: "checkout" }, null, 2) + "\n");
    run.release("about-to-move");
    out = await run.done;
  } finally { await run.finish(); }
  assert.deepEqual(out.timedOut, []);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  const receipt = JSON.parse(out.stdout);
  assert.equal(receipt.extraWorktrees[0].movedTo, movedTo);
  assert.deepEqual(receipt.warnings, [`${changed.instance}: its attachment changed during the retire, so its work was left as it is now and not repointed to the retained worktree ${movedTo}; inspect ${join(changed.home, "work")}`]);
  assert.equal(d.link(changed), tree, "left as it is");
  assert.equal(d.link(kept), movedTo, "the other child is repointed");
});

test("oats worktree remove: nobody attached removes as before; an attached instance whose session is stopped is named in the warnings (#964)", async (t) => {
  const d = deployment(t);
  const owner = await d.owner("dev-owner");
  // Nobody attached: the answer it always had, key for key.
  const free = d.added(owner.home, "free");
  const plain = d.wt(owner.home, ["remove", "--purpose", "free", "--json"]);
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  assert.deepEqual(plain.json().result, { purpose: "free", path: free, removed: true, rolledBack: false, branch: "agents/free", branchKept: true });
  // Two stopped instances attached, one removal in JSON and one in text.
  for (const text of [false, true]) {
    const purpose = text ? "told-text" : "told-json";
    const tree = d.added(owner.home, purpose);
    const kid = d.attach(`on-${purpose}`, tree);
    const SAID = `${kid.instance}: its work was ${tree}, which was removed; its work link ${join(kid.home, "work")} now points at a path that is gone`;
    const r = d.wt(owner.home, ["remove", "--purpose", purpose, ...(text ? [] : ["--json"])]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    if (text) assert.ok(r.stderr.split("\n").includes(`oats: warning: ${SAID}`), r.stderr);
    else assert.deepEqual(r.json().result, { purpose, path: tree, removed: true, rolledBack: false, branch: `agents/${purpose}`, branchKept: true, warnings: [SAID] });
    assert.equal(existsSync(tree), false);
    assert.equal(existsSync(join(owner.home, ".oats", "trees", `${purpose}.json`)), false, "the record is dropped");
    assert.equal(dangles(join(kid.home, "work")), true);
    assert.equal(d.git(d.fx.member, "rev-parse", "--verify", `refs/heads/agents/${purpose}`).length > 0, true, "the branch stays");
  }
});

/** What a refused `oats worktree remove` answers and leaves: the code, the details whole, no key of
 *  a retire's refusal, and the tree, its registration and its record as they were. */
function assertRefused(d, owner, purpose, tree, children, said) {
  const r = d.wt(owner.home, ["remove", "--purpose", purpose, "--json"]);
  assert.notEqual(r.status, 0, r.stdout);
  const error = r.json().error;
  assert.equal(error.code, "E_CHILDREN_RUNNING", error.message);
  assert.deepEqual(error.details, { purpose, path: tree, children });
  assert.equal("childrenStopped" in error.details, false, "this command asks nobody to stop");
  assert.equal(error.message, said);
  assert.equal(existsSync(join(tree, ".git")), true, "the tree is there");
  assert.equal(d.registered(realpathSync(tree)), true, "and registered");
  assert.equal(existsSync(join(owner.home, ".oats", "trees", `${purpose}.json`)), true, "and its record is kept");
}

test("oats worktree remove refuses under an attached instance whose session cannot be read, and never calls it running; an instance of ambiguous lineage is read too, which the retire of its owner does not act on (#964)", async (t) => {
  const d = deployment(t);
  const owner = await d.owner("dev-owner");
  const tree = d.added(owner.home, "unread");
  const kid = d.attach("unread-kid", tree), idle = d.attach("idle-kid", tree);
  d.unreadable(kid.home);
  assertRefused(d, owner, "unread", tree, [{ instance: kid.instance, home: kid.home, session: "unknown" }],
    `${tree} is the work of an attached instance: ${kid.instance} (whether its session is running could not be read); nothing was removed (the record is kept). To remove the tree, stop it (\`oats instance stop ${kid.instance}\`) or retire it, then remove again`);
  // The step it names: once that instance is retired, the same command removes the tree, and names the one still attached.
  d.retired(kid.instance, ["--force"]);
  const again = d.wt(owner.home, ["remove", "--purpose", "unread", "--json"]);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.deepEqual(again.json().result.warnings, [`${idle.instance}: its work was ${tree}, which was removed; its work link ${join(idle.home, "work")} now points at a path that is gone`]);

  // An owner whose name is not unique under the root: the instance attached to its tree records that
  // name as its parent, and no plan follows that edge. Its link leads to the tree all the same.
  const twin = await d.owner("dev-twin-1");
  const twinTree = d.added(twin.home, "twins");
  const orphan = d.attach("of-a-twin", twinTree);
  const other = await d.owner("dev-twin-1", "dev-twin");
  assert.equal(basename(other.home), basename(twin.home), "fixture premise: two homes of one name under the root");
  const planned = d.fx.cli(["retire", basename(twin.home), "--home", twin.home, "--plan", "--json"]).json();
  assert.equal(planned.ok, true, JSON.stringify(planned.error));
  const twinPlan = planned.result;
  assert.deepEqual(twinPlan.facts.children, [], "fixture premise: no plan lists it as a child");
  assert.deepEqual(twinPlan.facts.ambiguous.map((c) => c.instance), [orphan.instance], "fixture premise: it is listed as ambiguous");
  d.unreadable(orphan.home);
  assertRefused(d, twin, "twins", twinTree, [{ instance: orphan.instance, home: orphan.home, session: "unknown" }],
    `${twinTree} is the work of an attached instance: ${orphan.instance} (whether its session is running could not be read); nothing was removed (the record is kept). To remove the tree, stop it (\`oats instance stop ${orphan.instance}\`) or retire it, then remove again`);

  // The retire of that owner does not act on it, as on no instance of ambiguous lineage: it is not
  // asked to stop, so it is not among the children whose link the retire repoints, or names.
  writeFileSync(join(twinTree, "uncommitted.txt"), "work in the tree\n");
  const twinNote = d.fx.cli(["retire", basename(twin.home), "--home", twin.home, "--plan", "--json"]).json().result.notes.filter((n) => n.startsWith(`extra worktree ${twinTree} `));
  assert.equal(twinNote.length, 1);
  assert.doesNotMatch(twinNote[0], /attached child/, "the plan's note names recorded children only");
  const receipt = d.retired(basename(twin.home), ["--home", twin.home]);
  assert.deepEqual(receipt.extraWorktrees.map((row) => [row.path, row.outcome]), [[twinTree, "retained"]]);
  assert.equal((receipt.warnings || []).some((w) => w.includes(orphan.instance)), false, "the receipt says nothing of it");
  assert.equal(d.link(orphan), twinTree, "its link is as it was");
  assert.equal(dangles(join(orphan.home, "work")), true, "and points at the path the tree has left");
});

test("oats worktree remove refuses under an attached instance whose session is running, removes nothing, and removes once it is stopped (#964)", { skip: NO_TMUX }, async (t) => {
  const d = deployment(t);
  const owner = await d.owner("dev-owner");
  const tree = d.added(owner.home, "busy");
  const kid = d.attach("busy-kid", tree, { runnable: true }), second = d.attach("busy-second", tree, { runnable: true });
  await d.start(kid);
  await d.start(second);
  assertRefused(d, owner, "busy", tree, [{ instance: kid.instance, home: kid.home, session: "running" }, { instance: second.instance, home: second.home, session: "running" }],
    `${tree} is the work of attached instances: ${kid.instance} (its session is running), ${second.instance} (its session is running); nothing was removed (the record is kept). To remove the tree, stop each one (\`oats instance stop <instance>\`) or retire it, then remove again`);
  // The step it names.
  for (const [i, inst] of [kid, second].entries()) {
    const stop = d.fx.cli(["instance", "stop", inst.instance, "--apply", "--plan-revision", d.stopPlan(inst.instance).planRevision, "--idempotency-key", `stop-${i}`, "--json"], { env: { SHELL } });
    assert.equal(stop.status, 0, stop.stdout + stop.stderr);
  }
  const removed = d.wt(owner.home, ["remove", "--purpose", "busy", "--json"]);
  assert.equal(removed.status, 0, removed.stdout + removed.stderr);
  assert.equal(removed.json().result.removed, true);
  assert.equal(removed.json().result.warnings.length, 2, "both are named: their links now lead nowhere");
  assert.equal(existsSync(tree), false);
});
