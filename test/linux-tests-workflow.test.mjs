// The terms of the hand-started Linux test workflow (.github/workflows/linux-tests.yml), pinned by
// reading the file: the macOS workflow's terms (test/helpers/named-tests-workflow.mjs), and what is
// Linux's own: its name as the contract test files guard on, the runner image, and the two steps that
// prepare the runner user's systemd manager before the header reports it. docs/named-test-runs.md
// states them.
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBoundsAndConcurrency, assertDispatchOnly, assertNoInputInShell, assertPage, assertReadOnly, assertTwoTrees, load,
} from "./helpers/named-tests-workflow.mjs";
import { MAX_FILES } from "../scripts/named-test-run.mjs";
import { FILE_TIMEOUT_MS, JOB_TIMEOUT_MINUTES, USER_MANAGER_WAIT_MS } from "../scripts/linux-tests.mjs";

const linux = load("linux-tests.yml");
const { workflow, job, steps } = linux;
const SCRIPT = "node runner/scripts/linux-tests.mjs";
const REQUEST = { LINUX_TESTS_REF: "${{ inputs.ref }}", LINUX_TESTS_FILES: "${{ inputs.files }}" };
const LINGER = 'sudo loginctl enable-linger "$USER"', RUNTIME_DIR = 'echo "XDG_RUNTIME_DIR=/run/user/$(id -u)" >> "$GITHUB_ENV"';

test("Linux tests: started by hand and by nothing else, under the name test files guard on, with a ref and a list of files", () => {
  // The name is a contract: test files that drive the runner's user manager guard on it
  // (docs/named-test-runs.md, Guard contract). Renaming the workflow turns those tests into skips.
  assert.equal(workflow.name, "Linux tests");
  assertDispatchOnly(linux, ["ref", "files"]);
});

test("Linux tests: the token reads contents only, no secret is named, and no step uploads an artifact or saves or restores a cache", () => {
  assertReadOnly(linux);
});

test("Linux tests: no input is written into a shell line", () => {
  assertNoInputInShell(linux, {
    inputCount: 4, inputsWhy: "the ref and the files, twice each as environment variables",
    runLines: [LINGER, RUNTIME_DIR, `${SCRIPT} prepare tested`, "npm ci", "npm ci", `${SCRIPT} run tested`],
  });
});

test("Linux tests: two trees, and the request is validated before anything of the ref is installed or run", () => {
  assertTwoTrees(linux, { script: SCRIPT, request: REQUEST, conditional: [] });
});

test("Linux tests: lingering and XDG_RUNTIME_DIR come before the header that reports the user manager, and nothing else is changed system-wide", () => {
  const at = (line) => steps.findIndex((step) => step.run === line);
  const linger = at(LINGER), runtimeDir = at(RUNTIME_DIR), prepare = at(`${SCRIPT} prepare tested`);
  const node = steps.findIndex((step) => step.uses?.startsWith("actions/setup-node@"));
  assert.ok(node > 0 && linger > node && linger < runtimeDir && runtimeDir < prepare, "the checkout and Node, then lingering, then XDG_RUNTIME_DIR, then the validation");
  // Both after the runner's own checkout and Node, and neither with an environment of its own: the
  // variable reaches the later steps through $GITHUB_ENV, written by the step, never by an input.
  for (const i of [linger, runtimeDir]) {
    assert.equal(steps[i].env, undefined);
    assert.equal(steps[i]["working-directory"], undefined);
  }
  // The only privileged line: no package is installed, nothing else runs as root.
  assert.deepEqual(steps.filter((step) => /\b(sudo|apt|apt-get|snap|brew)\b/.test(step.run ?? "")).map((step) => step.run), [LINGER]);
});

test("Linux tests: an Ubuntu runner, a job timeout that holds the bounds and the waits for the user manager, and a concurrency group no run shares", () => {
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job.name, "Named test files on Linux");
  // prepare waits for the user manager, and run asks it again under the same bound.
  assertBoundsAndConcurrency(linux, { prefix: "linux-tests", fileTimeoutMs: FILE_TIMEOUT_MS, jobTimeoutMinutes: JOB_TIMEOUT_MINUTES, extraMs: 2 * USER_MANAGER_WAIT_MS });
  // 20 minutes a file: the #1108 qualification files run capture passes of up to 300 s, and a first
  // upgrade may need several. The job holds ten of them and the installs, under GitHub's 6 hours.
  assert.deepEqual([MAX_FILES, FILE_TIMEOUT_MS, JOB_TIMEOUT_MINUTES], [10, 20 * 60_000, 240], "the bounds the maintainers agreed: a change comes with a measured reason");
});

test("Linux tests: the page that owns the workflow states its bounds as the script has them, and its name as the guard contract", () => {
  assertPage(linux, { script: SCRIPT, fileTimeoutMs: FILE_TIMEOUT_MS, jobTimeoutMinutes: JOB_TIMEOUT_MINUTES });
});
