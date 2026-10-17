// A link keeps its own mode through the recovery copy (lib/tree-copy.mjs copyTreeSafe), awebai/oats#1360.
// The exact digest that verifies a worktree recovery holds every link's permission bits; a copy that
// recreated a link with the platform's default mode was refused ("worktree recovery verification
// disagreed with the source") for an ignored dependency tree whose node_modules/.bin links were 0700.
// A tiny tree of that shape, never a real one: the link-mode cases need a platform that can set a
// link's mode (lchmod: macOS) and are skipped elsewhere, where every link is 0777 on both sides.
import test from "node:test";
import assert from "node:assert/strict";
import fs, { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyTreeSafe, treeDisagreement } from "../lib/tree-copy.mjs";
import { preservationDetails, recoveryDisagreed } from "../lib/core.mjs";
import { cli, fixture, spawn } from "./helpers/retire-work-safety-fixture.mjs";

// lchmod is a property only where the platform has it; a named import would not link elsewhere.
const lchmod = fs.lchmodSync;
const NO_LCHMOD = typeof lchmod !== "function" && "this platform cannot set a link's mode (no lchmod)";
const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-link-mode-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
let n = 0;
const modeOf = (path) => lstatSync(path).mode & 0o7777;
const TOOL = join("node_modules", ".bin", "tool");

/** A tiny ignored dependency tree under `root`: node_modules/pkg/tool.js (0755), the relative link
 *  node_modules/.bin/tool -> ../pkg/tool.js, a dangling link and an absolute one. With `linkMode`,
 *  every link gets that mode (lchmod). → the links' raw targets and modes, by relative path. */
function dependencyTree(root, linkMode) {
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(root, "node_modules", "pkg", "tool.js"), "#!/usr/bin/env node\n");
  chmodSync(join(root, "node_modules", "pkg", "tool.js"), 0o755);
  symlinkSync("../pkg/tool.js", join(root, TOOL));
  symlinkSync("../pkg/gone.js", join(root, "node_modules", ".bin", "dangling"));
  symlinkSync("/usr/bin/env", join(root, "node_modules", ".bin", "absolute"));
  const links = [TOOL, join("node_modules", ".bin", "dangling"), join("node_modules", ".bin", "absolute")];
  if (linkMode !== undefined) for (const link of links) lchmod(join(root, link), linkMode);
  return Object.fromEntries(links.map((link) => [link, { target: readlinkSync(join(root, link), "buffer"), mode: modeOf(join(root, link)) }]));
}
const fresh = () => { const dir = join(base, String(n++)); mkdirSync(dir); return dir; };

test("copyTreeSafe gives each link its source's raw target and its own mode, and the copy matches its source exactly", { skip: NO_LCHMOD }, () => {
  const dir = fresh(), src = join(dir, "src"), dest = join(dir, "dest");
  const links = dependencyTree(src, 0o700);
  for (const { mode } of Object.values(links)) assert.equal(mode, 0o700, "the fixture's links have a non-default mode");
  copyTreeSafe(src, dest);
  for (const [link, { target, mode }] of Object.entries(links)) {
    assert.ok(readlinkSync(join(dest, link), "buffer").equals(target), `${link}: the raw target`);
    assert.equal(modeOf(join(dest, link)), mode, `${link}: the link's own mode`);
  }
  assert.equal(modeOf(join(src, "node_modules", "pkg", "tool.js")), 0o755, "the source link's target keeps its mode");
  assert.equal(modeOf(join(dest, "node_modules", "pkg", "tool.js")), 0o755, "the copied target has its own mode, not the link's");
  assert.deepEqual(treeDisagreement(src, dest), { entries: [], complete: true });
});

test("a copy whose link has the default mode, as copyTreeSafe made it before, is named mode at that link, in the refusal's details", { skip: NO_LCHMOD }, () => {
  const dir = fresh(), src = join(dir, "src"), dest = join(dir, "dest");
  dependencyTree(src, 0o700);
  copyTreeSafe(src, dest);
  // The link as the copier made it before: recreated with its raw target and the platform's mode.
  rmSync(join(dest, TOOL));
  symlinkSync(readlinkSync(join(src, TOOL), "buffer"), join(dest, TOOL));
  assert.notEqual(modeOf(join(dest, TOOL)), 0o700, "fixture premise: a new link does not have the source's mode");
  const what = "worktree recovery verification disagreed with the source";
  const e = recoveryDisagreed(what, src, dest, []);
  const entries = [{ path: "node_modules/.bin/tool", kind: "mode" }];
  assert.equal(e.message, `${what}; where they differ now (diagnostic only): node_modules/.bin/tool (mode)`);
  assert.deepEqual(e.recoveryDisagreement, { basis: "current", entries, complete: true });
  assert.deepEqual(preservationDetails("/the/home", e), { home: "/the/home", recoveryDisagreement: { basis: "current", entries, complete: true } });
  assert.equal(preservationDetails("/the/home", new Error("other")), undefined, "no details for an error that carries none");
});

test("a link that already has its source's mode needs no lchmod, on any platform", () => {
  const dir = fresh(), src = join(dir, "src"), dest = join(dir, "dest");
  const links = dependencyTree(src);
  copyTreeSafe(src, dest, { lchmod: () => assert.fail("no lchmod is needed when the new link's mode is the source's") });
  for (const [link, { target, mode }] of Object.entries(links)) {
    assert.ok(readlinkSync(join(dest, link), "buffer").equals(target), link);
    assert.equal(modeOf(join(dest, link)), mode, link);
  }
});

test("where a link's mode cannot be set, the copy is refused and no target changes", { skip: NO_LCHMOD }, () => {
  for (const [lchmodSeam, why] of [[null, /this platform cannot set a link's mode \(no lchmod\)/], [() => {}, /lchmod left it \d{4}/]]) {
    const dir = fresh(), src = join(dir, "src"), dest = join(dir, "dest");
    const links = dependencyTree(src, 0o700);
    assert.throws(() => copyTreeSafe(src, dest, { lchmod: lchmodSeam }), (e) => /^cannot copy the link .* with its mode 0700: /.test(e.message) && why.test(e.message) && /the copy would differ from its source$/.test(e.message), String(why));
    for (const [link, { target, mode }] of Object.entries(links)) {
      assert.ok(readlinkSync(join(src, link), "buffer").equals(target), `${link}: the source link is untouched`);
      assert.equal(modeOf(join(src, link)), mode, `${link}: the source link keeps its mode`);
    }
    assert.equal(modeOf(join(src, "node_modules", "pkg", "tool.js")), 0o755, "the link's target is never chmodded");
    if (existsSync(join(dest, "node_modules", "pkg", "tool.js"))) assert.equal(modeOf(join(dest, "node_modules", "pkg", "tool.js")), 0o755, "nor the copy's");
  }
});

test("a retire recovers a worktree's ignored dependency tree with its links' modes, and verifies", { skip: NO_LCHMOD }, () => {
  const f = fixture();
  const spawned = spawn(f, "linkmode");
  // cache/ is ignored by the fixture's .gitignore: an ignored dependency tree, copied by the recovery.
  const deps = join(spawned.home, "work", "cache");
  const links = dependencyTree(deps, 0o700);
  const retired = cli(f, ["retire", spawned.instance, "--json"]);
  assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
  const recovery = JSON.parse(retired.stdout).workRecovery;
  assert.ok(recovery?.path, `the work was preserved: ${retired.stdout}`);
  assert.equal(existsSync(spawned.home), false, "the home was retired once the copy verified");
  const copied = join(recovery.path, "repo", "cache");
  for (const [link, { target, mode }] of Object.entries(links)) {
    assert.ok(readlinkSync(join(copied, link), "buffer").equals(target), `${link}: the raw target`);
    assert.equal(modeOf(join(copied, link)), mode, `${link}: the link's own mode`);
  }
  assert.equal(modeOf(join(copied, "node_modules", "pkg", "tool.js")), 0o755);
});
