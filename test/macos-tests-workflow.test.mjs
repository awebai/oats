// The terms of the hand-started macOS test workflow (.github/workflows/macos-tests.yml), pinned by
// reading the file. The workflow runs a branch's code on request, so each term is a line that must
// not move unnoticed: the one trigger, the read-only token, no secret, no artifact, no cache step, no
// input in a shell line, the two trees, the bounds. The terms it shares with the Linux workflow are
// checked by test/helpers/named-tests-workflow.mjs; docs/named-test-runs.md states them.
import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBoundsAndConcurrency, assertDispatchOnly, assertNoInputInShell, assertPage, assertReadOnly, assertTwoTrees, load, read,
} from "./helpers/named-tests-workflow.mjs";
import { MAX_FILES } from "../scripts/named-test-run.mjs";
import { FILE_TIMEOUT_MS, JOB_TIMEOUT_MINUTES } from "../scripts/macos-tests.mjs";

const macos = load("macos-tests.yml");
const { workflow, job, steps } = macos;
const SCRIPT = "node runner/scripts/macos-tests.mjs";
const REQUEST = { MACOS_TESTS_REF: "${{ inputs.ref }}", MACOS_TESTS_FILES: "${{ inputs.files }}" };

test("macOS tests: started by hand and by nothing else, with a ref, a list of files and a tmux switch that is off", () => {
  // The name is a contract: test files that need macOS guard on it (docs/named-test-runs.md, Guard contract).
  assert.equal(workflow.name, "macOS tests");
  assertDispatchOnly(macos, ["ref", "files", "tmux"]);
  const { inputs } = workflow.on.workflow_dispatch;
  assert.deepEqual({ type: inputs.tmux.type, default: inputs.tmux.default }, { type: "boolean", default: false });
});

test("macOS tests: the token reads contents only, no secret is named, and no step uploads an artifact or saves or restores a cache", () => {
  assertReadOnly(macos);
});

test("macOS tests: no input is written into a shell line", () => {
  assertNoInputInShell(macos, {
    inputCount: 5, inputsWhy: "the ref and the files, twice each as environment variables, and the tmux condition",
    runLines: ["brew install tmux", `${SCRIPT} prepare tested`, "npm ci", "npm ci", `${SCRIPT} run tested`],
  });
});

test("macOS tests: two trees, and the request is validated before anything of the ref is installed or run", () => {
  const prepare = assertTwoTrees(macos, {
    script: SCRIPT, request: REQUEST,
    conditional: [["brew install tmux", "${{ inputs.tmux }}", { HOMEBREW_NO_AUTO_UPDATE: "1" }]],
  });
  assert.ok(steps.findIndex((step) => step.run === "brew install tmux") < prepare, "tmux is installed before the header that reports it");
});

test("macOS tests: a macOS runner, a job timeout that holds the bounds, and a concurrency group no run shares", () => {
  assert.match(job["runs-on"], /^macos-\d+$/);
  // The image the repository's other macOS jobs run on: move them and this fails until it moves too.
  for (const name of ["release.yml", "build-installers.yml"]) {
    const images = Object.values(read(name).jobs).flatMap((j) => j.strategy?.matrix?.include ?? []).map((leg) => leg.os).filter((os) => os?.startsWith("macos-"));
    assert.ok(images.length && images.every((os) => os === job["runs-on"]), `${name} builds on ${[...new Set(images)].join(", ")}`);
  }
  assertBoundsAndConcurrency(macos, { prefix: "macos-tests", fileTimeoutMs: FILE_TIMEOUT_MS, jobTimeoutMinutes: JOB_TIMEOUT_MINUTES });
  assert.deepEqual([MAX_FILES, FILE_TIMEOUT_MS, JOB_TIMEOUT_MINUTES], [10, 5 * 60_000, 60], "the bounds the maintainers agreed: a change comes with a measured reason");
});

test("macOS tests: the page that owns the workflow states its bounds as the script has them, and its name as the guard contract", () => {
  assertPage(macos, { script: SCRIPT, fileTimeoutMs: FILE_TIMEOUT_MS, jobTimeoutMinutes: JOB_TIMEOUT_MINUTES });
});
