// The terms of the hand-started macOS test workflow (.github/workflows/macos-tests.yml), pinned by
// reading the file. The workflow runs a branch's code on request, so each term is a line that must
// not move unnoticed: the one trigger, the read-only token, no secret, no artifact, no cache step, no
// input in a shell line, the two trees, the bounds. docs/macos-test-runs.md states them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseConfigData } from "../lib/config-data.mjs";
import { FILE_TIMEOUT_MS, JOB_TIMEOUT_MINUTES, MAX_FILES } from "../scripts/macos-tests.mjs";

const DIR = new URL("../.github/workflows/", import.meta.url);
const text = (name) => readFileSync(new URL(name, DIR), "utf8");
// As plain objects: the reader builds its values without a prototype, and deepEqual tells the two apart.
const read = (name) => JSON.parse(JSON.stringify(parseConfigData(text(name)).value));
const workflow = read("macos-tests.yml"), source = text("macos-tests.yml");
const job = workflow.jobs.run, steps = job.steps;
const SCRIPT = "node runner/scripts/macos-tests.mjs";
const REQUEST = { MACOS_TESTS_REF: "${{ inputs.ref }}", MACOS_TESTS_FILES: "${{ inputs.files }}" };

/** Every string of a parsed document, with the keys that lead to it. */
function strings(value, path = []) {
  if (typeof value === "string") return [{ value, path }];
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, child]) => strings(child, [...path, key]));
  return [];
}
const using = (document, action) => Object.values(document.jobs).flatMap((j) => j.steps ?? []).filter((step) => step.uses?.split("@")[0] === action || step.uses?.startsWith(`${action}/`));

test("macOS tests: started by hand and by nothing else, with a ref, a list of files and a tmux switch that is off", () => {
  assert.equal(workflow.name, "macOS tests");
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"], "no push, pull_request or schedule trigger");
  const { inputs } = workflow.on.workflow_dispatch;
  assert.deepEqual(Object.keys(inputs), ["ref", "files", "tmux"], "the bounds are the script's constants, not inputs");
  for (const name of ["ref", "files"]) assert.deepEqual({ required: inputs[name].required, type: inputs[name].type }, { required: true, type: "string" });
  assert.deepEqual({ type: inputs.tmux.type, default: inputs.tmux.default }, { type: "boolean", default: false });
});

test("macOS tests: the token reads contents only, no secret is named, and no step uploads an artifact or saves or restores a cache", () => {
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(Object.keys(workflow.jobs), ["run"]);
  assert.equal(job.permissions, undefined, "the job widens nothing");
  // Its check is its own: a run must never read as one of pull-request CI's, the gate above all.
  const ciNames = Object.entries(read("pull-request.yml").jobs).flatMap(([key, j]) => [key, j.name]);
  assert.ok(ciNames.includes("Node 22 / test, validate, pack, smoke") && !ciNames.includes(job.name) && !ciNames.includes("run"), `the job's name or key is one of pull-request CI's: ${job.name}`);
  for (const word of ["secrets.", "github.token", "GITHUB_TOKEN"]) assert.ok(!source.includes(word), `the workflow names ${word}`);
  // The two actions pull-request CI uses, as it references them, and no other: no
  // actions/upload-artifact, no actions/cache.
  assert.deepEqual(steps.filter((step) => step.uses).map((step) => step.uses), ["actions/checkout@v4", "actions/setup-node@v4"]);
  // No `cache:`: a cache written here would be in the scope of the branch the run belongs to,
  // which is the default branch's for a run that counts as evidence, and every branch reads that.
  // (A later major of actions/setup-node caches by itself where package.json names a package
  // manager: moving off v4 needs its switch for that turned off, and this line changed with it.)
  assert.deepEqual(using(workflow, "actions/setup-node")[0].with, { "node-version": 22 });
  assert.equal(using(read("pull-request.yml"), "actions/setup-node")[0].with["node-version"], 22, "Node as pull-request CI");
});

test("macOS tests: no input is written into a shell line", () => {
  const all = strings(workflow);
  for (const step of steps.filter((s) => s.run !== undefined)) {
    assert.ok(!step.run.includes("${{"), `an expression in a shell line: ${step.run}`);
    assert.ok(!/\binputs\b|github\.event/.test(step.run), `an input in a shell line: ${step.run}`);
  }
  // An expression is expanded before the step exists. Under `env:` and `with:` it becomes a value,
  // under `if:` a condition; anywhere else it could become part of what runs.
  const placed = ({ path }) => path.at(-1) === "if" || path.includes("env") || path.includes("with") || path.join(".") === "concurrency.group";
  for (const s of all.filter(({ value }) => value.includes("${{"))) assert.ok(placed(s), `an expression outside env:, with: and if: at ${s.path.join(".")}`);
  for (const s of all.filter(({ value }) => value.includes("inputs."))) assert.ok(placed(s) && s.path.join(".") !== "concurrency.group", `an input outside env:, with: and if: at ${s.path.join(".")}`);
  assert.equal(all.filter(({ value }) => value.includes("inputs.")).length, 5, "the ref and the files, twice each as environment variables, and the tmux condition");
  // The shell lines themselves, whole: nothing else runs.
  assert.deepEqual(steps.filter((s) => s.run !== undefined).map((s) => s.run), ["brew install tmux", `${SCRIPT} prepare tested`, "npm ci", "npm ci", `${SCRIPT} run tested`]);
});

test("macOS tests: two trees, and the request is validated before anything of the ref is installed or run", () => {
  // The checkout is the workflow's own commit (no `ref:`), in `runner/`, with every branch and tag
  // of origin and without the token in its configuration.
  assert.deepEqual(using(workflow, "actions/checkout")[0].with, { path: "runner", "fetch-depth": 0, "persist-credentials": false });
  const at = (run) => steps.findIndex((step) => step.run === run), prepare = at(`${SCRIPT} prepare tested`), run = at(`${SCRIPT} run tested`);
  assert.deepEqual(steps[prepare].env, REQUEST);
  assert.deepEqual(steps[run].env, REQUEST);
  // Every step that works in the ref's tree comes after the validation, and the run is the last.
  const inTree = steps.map((step, i) => ({ step, i })).filter(({ step }) => step["working-directory"] !== undefined);
  assert.deepEqual(inTree.map(({ step }) => [step.run, step["working-directory"], step.env ?? null]), [
    ["npm ci", "tested", null],
    ["npm ci", "tested/packages/desktop", { ELECTRON_SKIP_BINARY_DOWNLOAD: "1" }],
  ], "the installs are pull-request CI's shards', in the ref's tree");
  assert.ok(inTree.every(({ i }) => i > prepare && i < run));
  assert.equal(run, steps.length - 1);
  // The same installs as the shards: change how pull-request CI installs and this fails until the
  // workflow is changed with it.
  const shard = read("pull-request.yml").jobs.tests.steps.filter((step) => step.run === "npm ci");
  assert.deepEqual(shard.map((step) => [step["working-directory"] ?? ".", step.env ?? null]), [[".", null], ["packages/desktop", { ELECTRON_SKIP_BINARY_DOWNLOAD: "1" }]]);
  // A red step stays red, and only the tmux install is conditional.
  for (const part of [job, ...steps]) assert.equal(part["continue-on-error"], undefined);
  assert.deepEqual(steps.filter((step) => step.if !== undefined).map((step) => [step.run, step.if, step.env]), [["brew install tmux", "${{ inputs.tmux }}", { HOMEBREW_NO_AUTO_UPDATE: "1" }]]);
  assert.equal(job.if, undefined);
  assert.ok(steps.findIndex((step) => step.run === "brew install tmux") < prepare, "tmux is installed before the header that reports it");
});

test("macOS tests: a macOS runner, a job timeout that holds the bounds, and a concurrency group no run shares", () => {
  assert.match(job["runs-on"], /^macos-\d+$/);
  // The image the repository's other macOS jobs run on: move them and this fails until it moves too.
  for (const name of ["release.yml", "build-installers.yml"]) {
    const images = Object.values(read(name).jobs).flatMap((j) => j.strategy?.matrix?.include ?? []).map((leg) => leg.os).filter((os) => os?.startsWith("macos-"));
    assert.ok(images.length && images.every((os) => os === job["runs-on"]), `${name} builds on ${[...new Set(images)].join(", ")}`);
  }
  assert.equal(job["timeout-minutes"], JOB_TIMEOUT_MINUTES);
  assert.ok(MAX_FILES * FILE_TIMEOUT_MS < JOB_TIMEOUT_MINUTES * 60_000, "the job outlasts a run of the most files, each at its timeout");
  assert.deepEqual([MAX_FILES, FILE_TIMEOUT_MS, JOB_TIMEOUT_MINUTES], [10, 5 * 60_000, 60], "the bounds the maintainers agreed: a change comes with a measured reason");
  // One group per run and no cancelling: a fixed group would let a third run cancel the pending second.
  assert.deepEqual(workflow.concurrency, { group: "macos-tests-${{ github.run_id }}", "cancel-in-progress": false });
  for (const name of readdirSync(DIR).filter((file) => file !== "macos-tests.yml")) {
    assert.ok(!String(read(name).concurrency?.group ?? "").startsWith("macos-tests"), `${name} uses this workflow's concurrency group`);
  }
});

test("macOS tests: the page that owns the workflow states its bounds as the script has them", () => {
  const page = readFileSync(new URL("../docs/macos-test-runs.md", import.meta.url), "utf8");
  for (const bound of [`at most ${MAX_FILES} files`, `${FILE_TIMEOUT_MS / 60_000} minutes`, `${JOB_TIMEOUT_MINUTES} minutes`, job["runs-on"]]) {
    assert.ok(page.includes(bound), `docs/macos-test-runs.md does not state: ${bound}`);
  }
  // The page sends a reader to two steps of the log by name: the names are the workflow's.
  for (const run of [`${SCRIPT} prepare tested`, `${SCRIPT} run tested`]) {
    const { name } = steps.find((step) => step.run === run);
    assert.ok(page.includes(`**${name}**`), `docs/macos-test-runs.md does not name the step: ${name}`);
  }
});
