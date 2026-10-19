// awebai/oats#1025: a test file leaves nothing behind. The root run (scripts/run-tests.mjs) gives
// each test file a temporary directory of its own (scripts/test-file-tmpdir.mjs) and fails when a
// file leaves something in it, even if every test passed, naming the file and what is left.
// Each case is a real nested run of the runner over one or two small test files.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixtureBase, inheritedEnv } from "./helpers/host-fixture.mjs";
import { describeNestedTestFailure } from "./helpers/nested-test-failure.mjs";
import { outsideTemporaryUnavailable, removeOutsideBase } from "./helpers/outside-temporary.mjs";

const HOST_FIXTURE = fileURLToPath(new URL("./helpers/host-fixture.mjs", import.meta.url));
const OUTSIDE_HELPER = fileURLToPath(new URL("./helpers/outside-temporary.mjs", import.meta.url));
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
 *  nested run's result. `env` is added to the runner's environment; `runner` gives node's arguments
 *  for the runner's path, when the runner is not started as a file. The nested run starts with no
 *  compile cache, so that one in a directory outside it was made by what the run started. */
function rootRun(t, sources, { env: extra = {}, runner = (path) => [path] } = {}) {
  const root = fixtureBase("oats-lb-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  for (const script of ["run-tests.mjs", "desktop-test-deps.mjs", "test-warnings-reporter.mjs", "test-file-tmpdir.mjs"]) cpSync(new URL(`../scripts/${script}`, import.meta.url), join(root, "scripts", script));
  for (const dir of ["packages/pi", "test"]) mkdirSync(join(root, dir), { recursive: true });
  for (const [name, source] of Object.entries(sources)) writeFileSync(join(root, "test", name), source);
  const env = { ...inheritedEnv(), ...extra };
  delete env.NODE_TEST_CONTEXT; // the nested run is a run of its own, not a subtest of this one
  delete env.NODE_COMPILE_CACHE;
  const r = spawnSync(process.execPath, runner(join(root, "scripts", "run-tests.mjs")), { cwd: root, env, encoding: "utf8", timeout: 120000 });
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

test("a base a file leaves in /var/tmp, named for the run and the file (test/helpers/outside-temporary.mjs), fails the run, which names the file and removes the base", { skip: outsideTemporaryUnavailable() ?? false }, (t) => {
  const MAKES = `import { basename, dirname } from "node:path";\nimport { chmodSync } from "node:fs";\ntest("leaves a base outside the temporary directories", () => { const own = tmpdir(); const base = mkdtempSync(join("/var/tmp", "oats-deployments-test-" + basename(dirname(own)) + "." + basename(own) + "-")); writeFileSync(join(base, "file"), "x"); mkdirSync(join(base, "locked")); writeFileSync(join(base, "locked", "file"), "x"); chmodSync(join(base, "locked"), 0o500); console.log("@@BASE " + base); });\n`;
  const r = rootRun(t, { "outside.test.mjs": `${HEAD}${MAKES}`, "clean.test.mjs": `${HEAD}test("passes and leaves nothing", () => {});\n` });
  const base = r.stdout.match(/@@BASE (\S+)/)?.[1];
  t.after(() => { if (base) removeOutsideBase(base); });
  assert.ok(base, says(r));
  assert.notEqual(r.status, 0, `the run fails though every test passed. ${says(r)}`);
  assert.match(r.stderr, /LEFT BEHIND: 1 test file left/);
  assert.deepEqual(leftBy(r, "test/outside.test.mjs"), { head: "  test/outside.test.mjs: 1 entry", entries: [`${base}/`] });
  assert.doesNotMatch(r.stderr, /clean\.test\.mjs/);
  assert.equal(existsSync(base), false, "the run removes it, a read-only directory in it included");
});

test("a base made with outsideTemporaryBase is removed when its test fails while a directory in it is read-only: the run names nothing left behind", { skip: outsideTemporaryUnavailable() ?? false }, (t) => {
  const FAILS = `import { chmodSync } from "node:fs";\nimport { outsideTemporaryBase } from ${JSON.stringify(OUTSIDE_HELPER)};\ntest("fails with a read-only directory in its base", (t) => { const base = outsideTemporaryBase(t); console.log("@@BASE " + base); mkdirSync(join(base, "config")); writeFileSync(join(base, "config", "deployments.json"), "{}"); chmodSync(join(base, "config"), 0o500); assert.equal(1, 2); });\n`;
  const r = rootRun(t, { "fails.test.mjs": `${HEAD}${FAILS}` });
  const base = r.stdout.match(/@@BASE (\S+)/)?.[1];
  t.after(() => { if (base) removeOutsideBase(base); });
  assert.ok(base, says(r));
  assert.equal(r.status, 1, says(r));
  counts(r, 0, 1);
  assert.doesNotMatch(r.stderr, /LEFT BEHIND/, says(r));
  assert.equal(existsSync(base), false, "the test's own hook removed it");
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

// A child given inheritedEnv() has the file's TMPDIR and nothing else of the run (OATS_ names are the
// session's): the helpers know the file's directory by its own shape and by the file the runner
// writes beside it, n.file beside n.
test("a child given the fixture's environment makes its fixture base and private tmux directory in the file's own directory: what it does not remove is named", (t) => {
  const parent = mkdtempSync("/tmp/oats-lb-"); // long enough that the file's directory in it is over 20 characters
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const record = join(fixtureBase("oats-lb-made-"), "made.json");
  t.after(() => {
    // Where the child made them: in the nested run, or under /tmp when the helpers lost the file's directory.
    const made = existsSync(record) ? JSON.parse(readFileSync(record, "utf8")) : [];
    for (const dir of made) if (/^(escaped|oats-tmux)-[A-Za-z0-9]{6}$/.test(basename(dir))) rmSync(dir, { recursive: true, force: true });
    rmSync(dirname(record), { recursive: true, force: true });
  });
  const r = rootRun(t, { "escape.test.mjs": `${HEAD}import { inheritedEnv } from ${JSON.stringify(HOST_FIXTURE)};
test("a child given the fixture's environment makes a fixture base and a private tmux directory, and removes neither", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", 'import { fixtureBase, privateTmuxTmpdir } from ${JSON.stringify(pathToFileURL(HOST_FIXTURE).href)}; console.log(JSON.stringify([fixtureBase("escaped-"), privateTmuxTmpdir()]));'], { env: inheritedEnv(), encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  writeFileSync(process.env.LB_MADE, child.stdout);
});\n` }, { env: { TMPDIR: parent, LB_MADE: record } });
  assert.notEqual(r.status, 0, says(r));
  counts(r, 1, 0);
  assert.deepEqual(leftBy(r, "test/escape.test.mjs").entries.map((entry) => entry.replace(/-[A-Za-z0-9]{6}\/$/, "-*/")), ["escaped-*/", "oats-tmux-*/"]);
});

test("the fixture helpers make their directories in the file's own directory whatever its length, and under /tmp when the temporary directory is long and not the run's", (t) => {
  const base = fixtureBase("oats-lb-");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  // The helpers read the temporary directory when they are called: each case is a process of its own.
  const made = (dir) => {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fixtureBase, privateTmuxTmpdir } from ${JSON.stringify(pathToFileURL(HOST_FIXTURE).href)};
const dirs = [fixtureBase("oats-lb-made-"), privateTmuxTmpdir()];
for (const dir of dirs) rmSync(dir, { recursive: true });
console.log(JSON.stringify(dirs.map((dir) => dirname(dir))));`], { env: { ...inheritedEnv(), TMPDIR: dir }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const tmp = realpathSync("/tmp");
  // A file's directory as the runner makes it: <run>/ot-XXXXXX/<n>, and <n>.file beside it.
  const own = join(base, "a-long-temporary-directory", "ot-AbC123", "0");
  mkdirSync(own, { recursive: true });
  writeFileSync(`${own}.file`, "/a/test/file.test.mjs");
  assert.deepEqual(made(own), [own, own], "the file's own directory, though its path is long");
  const unmarked = join(base, "a-long-temporary-directory", "ot-AbC123", "1");
  mkdirSync(unmarked);
  assert.deepEqual(made(unmarked), [tmp, tmp], "shaped like one, but the runner wrote no file beside it: under /tmp");
  const long = join(base, "a-temporary-directory-with-a-long-path");
  mkdirSync(long);
  writeFileSync(`${long}.file`, "/a/test/file.test.mjs");
  assert.deepEqual(made(long), [tmp, tmp], "a long temporary directory that is not the run's: under /tmp, as before");
});

test("the run's directory is the runner's to know: no test file's process sees OATS_TEST_RUN_DIR, nor a process it starts, and each file still has a directory of its own", (t) => {
  const r = rootRun(t, { "env.test.mjs": `${HEAD}test("the variable is in no environment of the file", () => {
  assert.equal(process.env.OATS_TEST_RUN_DIR, undefined);
  const child = spawnSync(process.execPath, ["-p", 'process.env.OATS_TEST_RUN_DIR ?? "absent"'], { encoding: "utf8" });
  assert.equal(child.stdout.trim(), "absent", child.stderr);
  console.log("@@TMPDIR " + tmpdir());
});\n` });
  passes(r);
  counts(r, 1, 0);
  const own = r.stdout.match(/@@TMPDIR (\S+)/)?.[1];
  assert.ok(own, says(r));
  assert.match(dirname(own), /[/\\]ot-[A-Za-z0-9]{6}$/, "the file's temporary directory is in the run's directory");
});

// Node writes a compile cache where NODE_COMPILE_CACHE says, and a tool a test starts may ask for one
// (npm does): a run that passed a developer's NODE_COMPILE_CACHE on would write into that cache.
test("the run's processes do not inherit a compile cache: with NODE_COMPILE_CACHE set, a test and a tool it starts write none there", (t) => {
  const outside = fixtureBase("oats-lb-cache-");
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  // The runner itself starts with no compile cache and has the variable from then on, as the runner of
  // a developer who set it would pass it on: what is in the directory then was made by what it started.
  const runner = (path) => ["--input-type=module", "-e", `process.env.NODE_COMPILE_CACHE = ${JSON.stringify(outside)}; await import(${JSON.stringify(pathToFileURL(path).href)});`];
  passes(rootRun(t, { "cache.test.mjs": `${HEAD}import { getCompileCacheDir } from "node:module";
test("has no compile cache of the host, and neither has a tool it starts", () => {
  assert.equal(process.env.NODE_COMPILE_CACHE, undefined);
  assert.equal(getCompileCacheDir(), undefined);
  const tool = spawnSync(process.execPath, ["-e", 'const m = require("node:module"); m.enableCompileCache(); console.log(m.getCompileCacheDir())'], { encoding: "utf8" });
  assert.equal(tool.status, 0, tool.stderr);
  assert.ok(tool.stdout.trim().startsWith(join(tmpdir(), "node-compile-cache")), tool.stdout);
});\n` }, { runner }));
  assert.deepEqual(readdirSync(outside), [], "nothing was written in the outside compile cache");
});
