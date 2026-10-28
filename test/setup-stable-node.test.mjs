// `oats setup` hands the turn record's setup the node to write down (awebai/oats#1003): the rule's
// answer for the node running this kernel, as OATS_NODE_BIN, over whatever the caller's environment
// held. When the rule has no stable answer the kernel says so, once, in this caller's words.
//
// The rule itself (a keg and its opt link) is test/stable-node-hooks.test.mjs; what the script writes
// with the node it is handed is packages/record/test/setup.test.mjs.
//
// SAFETY. `oats setup` writes the user's Claude settings, installs a user service and runs a capture
// pass. Here it cannot reach the real ones:
//   - every run of setup is `--dry-run`, which writes nothing, starts nothing and runs no pass;
//   - the kernel's environment is built from nothing: HOME is a directory of the fixture, and PATH
//     holds a stand-in `systemctl` and `launchctl` (which record a call, and none is expected) and
//     the fixture's own directories. run() refuses a HOME outside the fixture.
// The node "running the kernel" is process.execPath, set by a preload in the child to a fake that
// still runs (a script that execs the real node), as test/stable-node-hooks.test.mjs sets it in-process.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fixtureBase } from "./helpers/host-fixture.mjs";

const REAL_NODE = process.execPath;
const KERNEL_BIN = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const base = fixtureBase("oats-setup-node-");
test.after(() => rmSync(base, { recursive: true, force: true }));

function write(p, c, mode) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); if (mode) chmodSync(p, mode); return p; }
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
/** A node that runs, at a path of the test's choosing. */
const fakeNode = (path) => write(path, `#!/bin/sh\nexec ${shq(REAL_NODE)} "$@"\n`, 0o755);

const standins = join(base, "standins");
for (const name of ["systemctl", "launchctl"]) write(join(standins, name), `#!/bin/sh\necho "${name} $*" >> ${shq(join(standins, "calls.log"))}\n`, 0o755);
const preload = write(join(base, "exec-path.mjs"), "process.execPath = process.env.FIXTURE_EXEC_PATH;\n");
const POISON = "/poison/from-the-ambient-environment";

let n = 0;
/** `oats <args>` by a kernel whose node is `node`, on `path`, with the poisoned variable around it. */
function run(node, path, args) {
  const home = join(base, `home-${++n}`);
  assert.ok(home.startsWith(base + "/"), `the kernel's HOME (${home}) is inside the fixture`);
  const settings = write(join(home, ".claude", "settings.json"), "{}\n");
  const env = { HOME: home, PATH: [standins, ...path].join(":"), TURN_RECORD_ROOT: join(home, "record"), FIXTURE_EXEC_PATH: node, OATS_NODE_BIN: POISON };
  const r = spawnSync(REAL_NODE, ["--import", preload, KERNEL_BIN, ...args], { env, cwd: home, encoding: "utf8" });
  return { ...r, home, settings };
}
const dryRun = (node, path) => {
  const r = run(node, path, ["setup", "--dry-run", "--owner", "fixture-owner"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry run: no first capture pass/);
  assert.equal(readFileSync(r.settings, "utf8"), "{}\n", "a dry run writes nothing");
  // ~/.oats holds the CLI's compile cache (lib/compile-cache.mjs), and only that.
  assert.deepEqual(readdirSync(r.home).sort(), [".claude", ".oats"], "no unit, no record");
  assert.deepEqual(readdirSync(join(r.home, ".oats")), ["compile-cache"]);
  assert.equal(existsSync(join(standins, "calls.log")), false, "no service manager was called");
  return r;
};
/** A child's stderr without Node's own ExperimentalWarning lines and the hint Node adds to the first
 *  of them (Node 22 prints one for node:sqlite, a later Node none): what is left is what the kernel
 *  and the script said, and it is still matched exactly. */
const ownStderr = (stderr) => stderr.split("\n").filter((line) => !/^\(node:\d+\) ExperimentalWarning: /.test(line) && line !== "(Use `node --trace-warnings ...` to show where the warning was created)").join("\n");
assert.equal(ownStderr("(node:3849) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n(Use `node --trace-warnings ...` to show where the warning was created)\noats: warning: x\n"), "oats: warning: x\n");
const WARNING = (node) => `oats: warning: the node path ${node} is not stable (no Homebrew opt link and no node on PATH resolves to it): the capture hooks and the capture service stop when it goes away; install a node with a stable path and run \`oats setup\` again`;

test("oats setup --dry-run reports the node of a PATH entry that is the node running the kernel, not the caller's variable", () => {
  const node = fakeNode(join(base, "versions", "22.1.0", "bin", "node"));
  const entry = join(base, "on-path", "bin");
  mkdirSync(entry, { recursive: true });
  symlinkSync(node, join(entry, "node"));
  const r = dryRun(node, [entry]);
  assert.match(r.stdout, new RegExp(`^node:  ${join(entry, "node")}$`, "m"));
  assert.equal(ownStderr(r.stderr), "", "a stable answer is not warned about");
  assert.doesNotMatch(r.stdout, /poison/);
});

test("with no stable answer, oats setup says so once, in its own words, and a dry run says it too", () => {
  const node = fakeNode(join(base, "loose", "node"));
  const r = dryRun(node, []);
  assert.match(r.stdout, new RegExp(`^node:  ${node}$`, "m"), "the path as it is");
  assert.doesNotMatch(r.stdout, /poison/);
  assert.equal(ownStderr(r.stderr), `${WARNING(node)}\n`, "the warning, once, and nothing else");
  assert.doesNotMatch(r.stdout + r.stderr, /restart the instance/);
  assert.doesNotMatch(r.stdout, /not stable/, "the script adds no warning of its own");
});

test("only setup is handed a node: the record's other commands say nothing of it", () => {
  const node = fakeNode(join(base, "loose-2", "node"));
  const r = run(node, [], ["recall"]);
  assert.equal(r.status, 2, "recall with no query: its usage");
  assert.match(r.stderr, /usage: recall/);
  assert.doesNotMatch(r.stderr, /not stable/);
});
