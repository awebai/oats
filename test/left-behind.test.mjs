// awebai/oats#1025: a test file leaves nothing behind. The root run (scripts/run-tests.mjs) gives
// each test file a temporary directory of its own (scripts/test-file-tmpdir.mjs) and fails when a
// file leaves something in it, even if every test passed, naming the file and what is left.
// Each case is a real nested run of the runner over one or two small test files.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureBase, inheritedEnv } from "./helpers/host-fixture.mjs";
import { describeNestedTestFailure } from "./helpers/nested-test-failure.mjs";

const HOST_FIXTURE = fileURLToPath(new URL("./helpers/host-fixture.mjs", import.meta.url));
const HEAD = `import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
`;
/** A test that passes and leaves a directory `left-*`, with a file in it, in the temporary directory. */
const LEAVES = `test("passes, and leaves a directory", () => { writeFileSync(join(mkdtempSync(join(tmpdir(), "left-")), "file"), "x"); });\n`;

/** A repository of the test files `sources` (name → source), with the root runner as it is → the
 *  nested run's result. */
function rootRun(t, sources) {
  const root = fixtureBase("oats-lb-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  for (const script of ["run-tests.mjs", "desktop-test-deps.mjs", "test-warnings-reporter.mjs", "test-file-tmpdir.mjs"]) cpSync(new URL(`../scripts/${script}`, import.meta.url), join(root, "scripts", script));
  for (const dir of ["packages/pi", "test"]) mkdirSync(join(root, dir), { recursive: true });
  for (const [name, source] of Object.entries(sources)) writeFileSync(join(root, "test", name), source);
  const env = inheritedEnv();
  delete env.NODE_TEST_CONTEXT; // the nested run is a run of its own, not a subtest of this one
  const r = spawnSync(process.execPath, [join(root, "scripts", "run-tests.mjs")], { cwd: root, env, encoding: "utf8", timeout: 120000 });
  return { ...r, root };
}
const says = (r) => `the nested run said:\n${r.stdout}\n${r.stderr}`;
const counts = (r, pass, fail) => {
  assert.match(r.stdout, new RegExp(`(^# pass ${pass}$|ℹ pass ${pass}$)`, "m"), says(r));
  assert.match(r.stdout, new RegExp(`(^# fail ${fail}$|ℹ fail ${fail}$)`, "m"), says(r));
};
/** The lines of the block under a file's name: what the run says the file left. */
function leftBy(r, file) {
  const lines = r.stderr.split("\n"), at = lines.findIndex((line) => line.startsWith(`  ${file}: `));
  assert.notEqual(at, -1, `the run names ${file}. ${says(r)}`);
  const entries = [];
  for (const line of lines.slice(at + 1)) { if (!line.startsWith("    ")) break; entries.push(line.slice(4)); }
  return { head: lines[at], entries };
}
function passes(r) {
  assert.equal(r.status, 0, describeNestedTestFailure(r, "the nested root run"));
  assert.doesNotMatch(r.stderr, /LEFT BEHIND/);
}

test("a passing test file that leaves a directory in the temporary directory fails the root run, which names the file and what is left", (t) => {
  const r = rootRun(t, { "leaves.test.mjs": `${HEAD}${LEAVES}test("says where", () => { console.log("@@TMPDIR " + tmpdir()); });\n` });
  assert.notEqual(r.status, 0, `the run fails though every test passed. ${says(r)}`);
  counts(r, 2, 0);
  assert.match(r.stderr, /LEFT BEHIND: 1 test file left something in its temporary directory\. The run FAILS\./);
  const left = leftBy(r, "test/leaves.test.mjs");
  assert.equal(left.head, "  test/leaves.test.mjs: 1 entry");
  assert.equal(left.entries.length, 1);
  assert.match(left.entries[0], /^left-[A-Za-z0-9]{6}\/$/);
  // The file's directory was one of the run's own directory, which is gone whatever the file left.
  const own = r.stdout.match(/@@TMPDIR (\S+)/)?.[1];
  assert.ok(own, says(r));
  assert.match(dirname(own), /[/\\]ot-[A-Za-z0-9]{6}$/, "the file's temporary directory is in the run's directory");
  assert.equal(existsSync(dirname(own)), false, "the run's directory is removed when the run has ended");
});

test("a file that removes what it makes passes, and so does one that makes nothing; Node's compile cache is not counted, by its exact name only", (t) => {
  passes(rootRun(t, {
    "removes.test.mjs": `${HEAD}test("removes its directory", (t) => { const dir = mkdtempSync(join(tmpdir(), "made-")); t.after(() => rmSync(dir, { recursive: true })); writeFileSync(join(dir, "file"), "x"); });\n`,
    "nothing.test.mjs": `${HEAD}test("makes nothing", () => {});\n`,
    "cache.test.mjs": `${HEAD}test("a tool it starts made Node's compile cache", () => { mkdirSync(join(tmpdir(), "node-compile-cache", "v1"), { recursive: true }); });\n`,
  }));
  const r = rootRun(t, { "like-cache.test.mjs": `${HEAD}test("leaves a directory named like the cache", () => { mkdirSync(join(tmpdir(), "node-compile-cache-2")); });\n` });
  assert.notEqual(r.status, 0, says(r));
  assert.deepEqual(leftBy(r, "test/like-cache.test.mjs").entries, ["node-compile-cache-2/"]);
});

test("each file has a directory of its own: of two files only the one that left something is named, also when its test failed", (t) => {
  const r = rootRun(t, {
    "clean.test.mjs": `${HEAD}test("passes and leaves nothing", () => {});\n`,
    "fails.test.mjs": `${HEAD}test("leaves a file, and fails", () => { writeFileSync(join(tmpdir(), "left-by-a-failure"), "x"); assert.equal(1, 2); });\n`,
  });
  assert.equal(r.status, 1, says(r));
  counts(r, 1, 1);
  assert.match(r.stderr, /LEFT BEHIND: 1 test file left/);
  assert.deepEqual(leftBy(r, "test/fails.test.mjs"), { head: "  test/fails.test.mjs: 1 entry", entries: ["left-by-a-failure"] });
  assert.doesNotMatch(r.stderr, /clean\.test\.mjs/);
});

test("what a process the file starts makes is in the file's directory, and so is what a fixture helper makes: a base and a tmux directory nobody removed are named", (t) => {
  const r = rootRun(t, { "fixture.test.mjs": `${HEAD}import { fixtureBase, privateTmuxTmpdir } from ${JSON.stringify(HOST_FIXTURE)};
test("makes a fixture base and a private tmux directory, and removes neither", () => { fixtureBase("oats-left-"); privateTmuxTmpdir(); });
test("its child makes a directory", () => {
  const child = spawnSync(process.execPath, ["-e", 'require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "child-"))'], { stdio: "inherit" });
  assert.equal(child.status, 0);
});
test("a child given this process's own node options keeps the file's directory", () => {
  const child = spawnSync(process.execPath, [...process.execArgv, "-p", 'require("node:os").tmpdir()'], { encoding: "utf8" });
  assert.equal(child.stdout.trim(), tmpdir(), child.stderr);
});\n` });
  assert.notEqual(r.status, 0, says(r));
  counts(r, 3, 0);
  const left = leftBy(r, "test/fixture.test.mjs");
  assert.equal(left.head, "  test/fixture.test.mjs: 3 entries");
  assert.deepEqual(left.entries.map((entry) => entry.replace(/-[A-Za-z0-9]{6}\/$/, "-*/")), ["child-*/", "oats-left-*/", "oats-tmux-*/"]);
});

test("tmux's default place is the file's directory: a tmux client that runs with no TMUX_TMPDIR of a fixture leaves its socket directory there, and the run says what it is", (t) => {
  const r = rootRun(t, { "tmux.test.mjs": `${HEAD}test("asks a tmux server that does not exist, in the environment it was given", () => {
  const r = spawnSync("tmux", ["-L", "oats", "has-session", "-t", "no-such-session"], { encoding: "utf8" });
  assert.equal(r.error, undefined, "tmux is a prerequisite of the suite");
  assert.notEqual(r.status, 0);
});\n` });
  assert.notEqual(r.status, 0, says(r));
  counts(r, 1, 0);
  assert.deepEqual(leftBy(r, "test/tmux.test.mjs").entries, [`tmux-${process.getuid()}/  (tmux's default place: a tmux client ran with no TMUX_TMPDIR of a fixture)`]);
});

test("the fixture helpers make their directories in the file's own directory whatever its length, and under /tmp when the temporary directory is long and not the run's", (t) => {
  const base = fixtureBase("oats-lb-");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const long = join(base, "a-temporary-directory-with-a-long-path");
  mkdirSync(long);
  // The helpers read what the root run gave this file when the module loads: each case is a process of its own.
  const made = (extra) => {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fixtureBase, privateTmuxTmpdir } from ${JSON.stringify(HOST_FIXTURE)};
const dirs = [fixtureBase("oats-lb-made-"), privateTmuxTmpdir()];
for (const dir of dirs) rmSync(dir, { recursive: true });
console.log(JSON.stringify(dirs.map((dir) => dirname(dir))));`], { env: { ...inheritedEnv(), TMPDIR: long, ...extra }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.deepEqual(made({ OATS_TEST_TMPDIR: long }), [long, long], "the file's own directory, though its path is long");
  const elsewhere = made({ OATS_TEST_TMPDIR: join(base, "another-directory") });
  assert.deepEqual(elsewhere, [realpathSync("/tmp"), realpathSync("/tmp")], "a long temporary directory that is not the run's: under /tmp, as before");
});
