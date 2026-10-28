// The terms of the TUI's tests on macOS at pull-request time (.github/workflows/tui-macos.yml),
// pinned by reading the file: the one trigger and its paths, the read-only token, no secret, no
// artifact, the runner, tmux, a test command that runs every TUI test file, one at a time, and the
// check for a leaked tmux server after it. Which
// actions it may use, and that it names them by commit, is test/workflow-no-cache.test.mjs's.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseConfigData } from "../lib/config-data.mjs";

const at = (path) => new URL(`../${path}`, import.meta.url);
const text = (name) => readFileSync(at(`.github/workflows/${name}`), "utf8");
/** A workflow as plain JSON data (the reader makes objects of no prototype). */
const read = (name) => JSON.parse(JSON.stringify(parseConfigData(text(name)).value));
const FILE = "tui-macos.yml";
const workflow = read(FILE), source = text(FILE);
const [jobKey] = Object.keys(workflow.jobs);
const job = workflow.jobs[jobKey], steps = job.steps;
const runs = steps.filter((step) => step.run !== undefined).map((step) => step.run);
/** The command that runs the tests. */
const TESTS = "node --test --test-concurrency=1 --test-timeout=300000 packages/tui/test/*.test.mjs test/tui-*.test.mjs";
/** The last step's: no tmux server left on the default socket. */
const NO_LEAK = 'test ! -e "$(realpath /tmp)/tmux-$(id -u)/oats" || { echo "::error::a test left a tmux server at $(realpath /tmp)/tmux-$(id -u)/oats"; exit 1; }';
/** Every test file under packages/tui, at any depth (pull-request CI runs packages/**\/*.test.mjs),
 *  and the root's test/tui-*: a file the job's globs miss is one it never runs. */
const tuiTestFiles = () => [
  ...readdirSync(at("packages/tui"), { recursive: true }).filter((name) => name.endsWith(".test.mjs") && !name.split("/").includes("node_modules")).map((name) => `packages/tui/${name}`),
  ...readdirSync(at("test")).filter((name) => /^tui-.*\.test\.mjs$/.test(name)).map((name) => `test/${name}`),
];
/** Whether `path` matches a pattern of the workflow's, read for `*` (within one segment) and `**`
 *  (across segments) only: the only wildcards its patterns use. */
const matches = (pattern, path) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*")}$`).test(path);

test("TUI tests on macOS: a pull request is the only trigger, for pull-request CI's branches, and only when it touches the TUI, the readers it shares, its root tests or the workflow", () => {
  assert.equal(workflow.name, "TUI tests on macOS");
  assert.deepEqual(Object.keys(workflow.on), ["pull_request"], "no push, no schedule, no dispatch: the tag's legs are release.yml's");
  assert.deepEqual(workflow.on.pull_request.branches, read("pull-request.yml").on.pull_request.branches, "the branches pull-request CI runs for");
  // The release lane's paths (2026-10-27), and nothing else: a filter that moves changes when the job runs.
  assert.deepEqual(workflow.on.pull_request.paths, ["packages/tui/**", "packages/client/**", "test/tui-*.test.mjs", `.github/workflows/${FILE}`]);
  // Every file the job runs is under a path that starts it, and the workflow starts it too.
  const paths = workflow.on.pull_request.paths;
  for (const file of [...tuiTestFiles(), `.github/workflows/${FILE}`]) assert.ok(paths.some((pattern) => matches(pattern, file)), `${file}: a change to it starts no run`);
  assert.ok(paths.some((pattern) => matches(pattern, "packages/client/keymap.mjs")), "the shared keymap starts a run");
  assert.ok(!paths.some((pattern) => matches(pattern, "packages/desktop/main.js")), "the Desktop's own files do not");
});

test("TUI tests on macOS: the token reads contents only, no secret is named, no step uploads an artifact or names a cache, and its check is its own", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.jobs), [jobKey], "one job");
  assert.equal(job.permissions, undefined, "the job widens nothing");
  for (const word of ["secrets.", "github.token", "GITHUB_TOKEN"]) assert.ok(!source.includes(word), `the workflow names ${word}`);
  assert.deepEqual(steps.filter((step) => step.uses).map((step) => step.uses.split("@")[0]), ["actions/checkout", "actions/setup-node"], "checkout and Node, and no other action: no upload-artifact, no cache");
  assert.deepEqual(steps[0].with, { "persist-credentials": false }, "the token stays out of the checkout's configuration");
  assert.deepEqual(steps[1].with, { "node-version": 22 }, "Node 22 and no `cache:`");
  // A run never reads as one of pull-request CI's checks, the gate above all.
  const ciNames = Object.entries(read("pull-request.yml").jobs).flatMap(([key, j]) => [key, j.name]);
  assert.ok(!ciNames.includes(job.name) && !ciNames.includes(jobKey), `the job's name or key is one of pull-request CI's: ${job.name}`);
});

test("TUI tests on macOS: on macos-14, tmux installed before the dependencies and the tests, every TUI test file run, one at a time, and no tmux server left on the default socket", () => {
  assert.equal(job["runs-on"], "macos-14");
  assert.equal(read("macos-tests.yml").jobs.run["runs-on"], job["runs-on"], "the image of the hand-started macOS runs, whose evidence this job repeats");
  assert.ok(Number.isInteger(job["timeout-minutes"]) && job["timeout-minutes"] <= 30, `a bounded job: ${job["timeout-minutes"]}`);
  // The TUI's root tests skip without tmux: a run without it would be green and prove nothing of them.
  // tmux's version is said: Homebrew's moves with no change of ours.
  assert.deepEqual(runs, ["brew install tmux && tmux -V", "npm ci", TESTS, NO_LEAK]);
  assert.deepEqual(steps.find((step) => step.run === runs[0]).env, { HOMEBREW_NO_AUTO_UPDATE: "1" });
  // One file at a time, each test within five minutes: the real-tmux files own private servers, and
  // their end checks read the host's default one. The leak check runs whatever the tests did, as a
  // hand-started run's does after each file (docs/named-test-runs.md).
  assert.equal(steps.at(-1).run, NO_LEAK);
  assert.equal(steps.at(-1).if, "always()");
  const globs = TESTS.split(" ").filter((word) => word.includes("*"));
  const files = tuiTestFiles();
  assert.ok(files.length > 30 && files.some((file) => file.startsWith("test/")), `the TUI's test files, read from the tree: ${files.length}`);
  for (const file of files) assert.ok(globs.some((glob) => matches(glob, file)), `${file} is not run`);
  for (const file of ["test/tui.test.mjs.bak", "test/tuix.test.mjs", "packages/desktop/test/tabs.test.mjs"]) assert.ok(!globs.some((glob) => matches(glob, file)), `${file} is run`);
});

test("the pattern reader: `*` stays in one segment, `**` crosses them", () => {
  assert.equal(matches("packages/tui/**", "packages/tui/test/main.test.mjs"), true);
  assert.equal(matches("test/tui-*.test.mjs", "test/tui-acts.test.mjs"), true);
  assert.equal(matches("test/tui-*.test.mjs", "test/helpers/tui-x.test.mjs"), false);
  assert.equal(matches("packages/tui/test/*.test.mjs", "packages/tui/test/fixtures/a.test.mjs"), false);
  assert.equal(matches(".github/workflows/tui-macos.yml", ".github/workflows/tui-macosXyml"), false);
});
