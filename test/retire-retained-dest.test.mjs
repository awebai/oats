// A retained worktree's destination always fits (awebai/oats#821). Retire re-homes a worktree it
// keeps (work/, or an extra `.work-*` tree) to <workspace>/.agents/worktrees/<repo>/<leaf>, the
// leaf being the branch name flattened to one path component. A leaf over the kernel's bound
// (RETAINED_LEAF_MAX bytes) is cut and followed by 6 hex of the SHA-256 of the full branch name, so
// a long branch retires instead of failing with ENAMETOOLONG; a leaf within it is unchanged. The
// long names are built with the fixture base's nameOfLength, from the kernel's bound, so a case
// exercises that bound and never the filesystem's.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RETAINED_LEAF_MAX } from "../lib/core.mjs";
import { nameOfLength } from "./helpers/host-fixture.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

async function instance(t, name) {
  const fx = v2Deployment({ souls: { dev: { soul: { work: "worktree" } } } });
  t.after(fx.cleanup);
  const r = await fx.spawn("dev", { instance: name, work: "worktree" });
  const home = r.home;
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: fx.env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  /** A dirty extra tree on `branch`, made the way the briefing says: it is retained, never removed. */
  const tree = (purpose, branch) => {
    const path = join(home, `.work-${purpose}`);
    git(fx.member, "worktree", "add", "-q", "--detach", path);
    git(path, "fetch", "-q", "--refmap=", "origin", "main");
    git(path, "switch", "-q", "-c", branch, "FETCH_HEAD");
    writeFileSync(join(path, "x.txt"), `${purpose}\n`);
    return path;
  };
  const registered = (path) => git(fx.member, "worktree", "list", "--porcelain").split("\n").includes(`worktree ${path}`);
  const retained = (leaf) => join(fx.dep, ".agents", "worktrees", "ws", leaf);
  const plan = () => { const p = fx.cli(["retire", name, "--plan", "--json"]); assert.equal(p.status, 0, p.stderr + p.stdout); return p.json().result; };
  const apply = (revision, key) => fx.cli(["retire", name, "--plan-revision", revision, "--idempotency-key", key, "--json"]);
  return { fx, home, git, tree, registered, retained, plan, apply };
}
/** `n` characters of `char`, or a skip naming the limit when the host's NAME_MAX/PATH_MAX cannot hold them. */
const segment = (t, base, n, char) => {
  const s = nameOfLength(base, n, char);
  if (s.length !== n) t.skip(`a branch segment of ${n} characters does not fit this host's NAME_MAX/PATH_MAX under ${base}`);
  return s.length === n ? s : null;
};
/** The leaf the kernel's rule gives a branch, written out independently: flattened, and cut and hashed when over the bound. */
const flatten = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
const cutLeaf = (branch) => `${flatten(branch).slice(0, RETAINED_LEAF_MAX - 7).replace(/-+$/, "")}-${createHash("sha256").update(branch, "utf8").digest("hex").slice(0, 6)}`;
const bytes = (leaf) => Buffer.byteLength(leaf, "utf8");

test("the bound: a leaf of exactly RETAINED_LEAF_MAX bytes is kept as it is; one byte over is cut and hashed, and -N works on the cut name; two long branches with one prefix get different leaves", async (t) => {
  const w = await instance(t, "dev-bound");
  // "agents/" flattens to "agents-": 7 bytes before the segment.
  const atLimit = segment(t, w.fx.base, RETAINED_LEAF_MAX - 7, "a");
  const over = segment(t, w.fx.base, RETAINED_LEAF_MAX - 6, "o");
  const shared = segment(t, w.fx.base, RETAINED_LEAF_MAX - 7, "s");
  // A segment that ends exactly where the cut falls: the cut name ends in "-", which is trimmed.
  const dashed = segment(t, w.fx.base, RETAINED_LEAF_MAX - 15, "d");
  if (!atLimit || !over || !shared || !dashed) return;
  const branches = { atLimit: `agents/${atLimit}`, over: `agents/${over}`, twinA: `agents/${shared}/a`, twinB: `agents/${shared}/b`, dash: `agents/${dashed}/${"q".repeat(20)}` };
  assert.equal(bytes(flatten(branches.atLimit)), RETAINED_LEAF_MAX);
  assert.equal(bytes(flatten(branches.over)), RETAINED_LEAF_MAX + 1);
  const paths = Object.fromEntries(Object.entries(branches).map(([k, b]) => [k, w.tree(k.toLowerCase(), b)]));
  // The cut name is taken: the over-long branch gets its -2.
  mkdirSync(w.retained(cutLeaf(branches.over)), { recursive: true });
  const rows = new Map(w.plan().facts.extraWorktrees.map((r) => [r.path, r]));
  const leafOf = (k) => { const row = rows.get(paths[k]); assert.equal(row.disposition, "retain", JSON.stringify(row)); return row.movedTo; };

  assert.equal(leafOf("atLimit"), w.retained(flatten(branches.atLimit)), "a leaf that fits is the flattened branch, byte for byte");
  assert.equal(leafOf("over"), w.retained(`${cutLeaf(branches.over)}-2`));
  assert.equal(bytes(cutLeaf(branches.over)), RETAINED_LEAF_MAX, "cut to the room left, then -<6 hex>");
  assert.match(cutLeaf(branches.over), new RegExp(`^agents-o{${RETAINED_LEAF_MAX - 14}}-[0-9a-f]{6}$`));
  assert.equal(leafOf("twinA"), w.retained(cutLeaf(branches.twinA)));
  assert.equal(leafOf("twinB"), w.retained(cutLeaf(branches.twinB)));
  assert.notEqual(leafOf("twinA"), leafOf("twinB"), "one prefix, two branches, two leaves: no reliance on -N");
  assert.equal(leafOf("dash"), w.retained(cutLeaf(branches.dash)));
  assert.match(cutLeaf(branches.dash), new RegExp(`^agents-d{${RETAINED_LEAF_MAX - 15}}-[0-9a-f]{6}$`), "the trailing - is trimmed before the hash");
});

test("a branch of about 400 characters in several segments retires: work/ and an extra tree are re-homed under a bounded leaf, and the plan's movedTo is the receipt's", async (t) => {
  const w = await instance(t, "dev-long");
  const [a, b, c, d] = [segment(t, w.fx.base, 190, "w"), segment(t, w.fx.base, 200, "x"), segment(t, w.fx.base, 190, "y"), segment(t, w.fx.base, 200, "z")];
  if (!a || !b || !c || !d) return;
  const workBranch = `feature/${a}/${b}`;
  const treeBranch = `agents/${c}/${d}/tail`;
  assert.ok(workBranch.length >= 390 && treeBranch.length >= 390, `${workBranch.length} and ${treeBranch.length} characters`);
  const work = join(w.home, "work");
  w.git(work, "switch", "-q", "-c", workBranch);
  writeFileSync(join(work, "wip.txt"), "work in progress\n");
  const extra = w.tree("long", treeBranch);

  const planned = w.plan();
  const [row] = planned.facts.extraWorktrees;
  assert.equal(row.movedTo, w.retained(cutLeaf(treeBranch)));
  const r = w.apply(planned.planRevision, "long-1");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const done = JSON.parse(r.stdout); // the receipt, printed whole
  assert.equal(done.extraWorktrees[0].outcome, "retained");
  assert.equal(done.extraWorktrees[0].movedTo, row.movedTo, "the apply moves where the plan said");
  assert.equal(done.retention.worktree, "retained");
  assert.equal(done.retention.branch, workBranch);
  assert.equal(done.retention.movedTo, w.retained(cutLeaf(workBranch)));
  for (const [moved, file, text] of [[done.retention.movedTo, "wip.txt", "work in progress\n"], [row.movedTo, "x.txt", "long\n"]]) {
    assert.ok(bytes(moved.slice(moved.lastIndexOf("/") + 1)) <= RETAINED_LEAF_MAX);
    assert.equal(readFileSync(join(moved, file), "utf8"), text);
    assert.equal(w.registered(moved), true, `${moved} is a worktree of the clone`);
  }
  assert.equal(w.git(done.retention.movedTo, "symbolic-ref", "--short", "HEAD"), workBranch);
  assert.equal(w.git(row.movedTo, "symbolic-ref", "--short", "HEAD"), treeBranch);
  assert.equal(existsSync(w.home), false, "the home is removed");
  assert.equal(w.registered(extra), false);
});
