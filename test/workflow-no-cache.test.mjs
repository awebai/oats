// No workflow in this repository restores an Actions cache. A workflow here runs a branch's code
// in the default branch's cache scope, and every pull request's CI reads that scope: a restored
// entry would stand between a job and its result. Nothing here reads a cache at all, and this
// pins it for every file under .github/workflows/, whatever files exist there.
//
// The rule can only speak for an action somebody has read. So a workflow may use the actions on
// the list below and no other: not an action off the list, not a local action, not a reusable
// workflow, whose steps are in another file.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseConfigData } from "../lib/config-data.mjs";

const WORKFLOWS = new URL("../.github/workflows/", import.meta.url);
const WHY = "No workflow in this repository restores an Actions cache: a workflow here runs a branch's code in the default branch's cache scope, which every pull request's CI reads.";

/** The majors of actions/setup-node that never cache unless asked to: their action.yml has the
 *  `cache` input and no `package-manager-cache`. From v5 on (read at the tags v5, v6 and v7) the
 *  action has `package-manager-cache`, `default: true`: it caches by itself when package.json
 *  names a package manager, unless that input is false. v4 does not know the input and would
 *  warn about it, so a v4 step is kept from caching by its major, a later one by the input. */
const SETUP_NODE_WITHOUT_AUTOMATIC_CACHE = /^v[1-4](\.\d+){0,2}$/;

/** The actions a workflow here may use: the ones the workflows use, each read for whether it
 *  saves or restores a cache by itself. Of these only actions/setup-node can, and the rule
 *  below holds it. */
const ALLOWED_ACTIONS = ["actions/checkout", "actions/setup-node", "actions/upload-artifact", "actions/download-artifact", "actions/attest-build-provenance"];
const HOW_TO_ALLOW = "An action is added to the list of allowed actions by whoever has read whether it saves or restores a cache by itself.";

/** A `uses` value as { action, ref }: the action's name in lower case (the runner matches it
 *  whatever its case) and what follows the last `@`. A local action has no ref. */
function parseUses(uses) {
  const at = uses.lastIndexOf("@");
  return { action: (at < 0 ? uses : uses.slice(0, at)).toLowerCase(), ref: at < 0 ? "" : uses.slice(at + 1) };
}
/** Why `step` uses an action nobody has read for this rule; null when its action is on the list
 *  or it uses none. The name must be the listed one exactly: a path under a listed action
 *  (`actions/cache/save`) is another action. */
function usesUnlistedAction(step) {
  if (step?.uses === undefined) return null;
  if (typeof step.uses !== "string") return "its `uses` is not a string";
  const { action } = parseUses(step.uses);
  if (action.startsWith("./") || action.startsWith("../")) return `it uses the local action ${step.uses}: its steps are not in the workflow file, so the rule cannot read them`;
  if (!ALLOWED_ACTIONS.includes(action)) return `it uses ${step.uses}, which is not on the list of allowed actions (${ALLOWED_ACTIONS.join(", ")}). ${HOW_TO_ALLOW}`;
  return null;
}
/** Why a job is refused as a whole; null when its steps are its own. A job that calls a reusable
 *  workflow (`uses:` on the job) has its steps in another file, or another repository. */
function callsWorkflow(definition) {
  return definition?.uses === undefined ? null : `it calls the reusable workflow ${definition.uses}: its steps are not in the workflow file, so the rule cannot read them`;
}

const isFalse = (value) => value === false || value === "false";
/** A step's inputs by lower-cased name: the runner matches an input's name whatever its case
 *  (`CACHE: npm` is the action's `cache`), so the rule does too. */
const inputsOf = (step) => new Map(Object.entries(step?.with ?? {}).map(([name, value]) => [name.toLowerCase(), value]));
/** Why `step` restores an Actions cache, or could begin to by itself; null when it cannot. A
 *  `cache` input is refused whatever its value: no step names a cache at all, and what turns a
 *  later actions/setup-node's own caching off is its `package-manager-cache`, not `cache`. */
function restoresCache(step) {
  if (typeof step?.uses !== "string") return null;
  const { action, ref } = parseUses(step.uses);
  const inputs = inputsOf(step);
  if (action === "actions/cache" || action === "actions/cache/restore") return `it uses ${step.uses}`;
  if (inputs.has("cache")) return `it gives ${step.uses} the input \`cache: ${inputs.get("cache")}\``;
  if (action === "actions/setup-node" && !SETUP_NODE_WITHOUT_AUTOMATIC_CACHE.test(ref) && !isFalse(inputs.get("package-manager-cache"))) {
    return `it uses ${step.uses} without \`package-manager-cache: false\`: from v5 on, actions/setup-node caches by itself when package.json names a package manager (a v4 step needs no input)`;
  }
  return null;
}

/** Every job of every workflow file in the directory, { file, job, definition }, and every step
 *  of each, { file, job, step }. */
function workflowSteps() {
  const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name)).sort();
  const jobs = files.flatMap((file) => {
    const workflow = parseConfigData(readFileSync(new URL(file, WORKFLOWS))).value;
    return Object.entries(workflow.jobs ?? {}).map(([job, definition]) => ({ file, job, definition }));
  });
  return { files, jobs, steps: jobs.flatMap(({ file, job, definition }) => (definition.steps ?? []).map((step) => ({ file, job, step }))) };
}

test("no workflow under .github/workflows/ restores an Actions cache, and no setup action can begin to by itself", () => {
  const { files, jobs, steps } = workflowSteps();
  // The directory is read, not listed here: a workflow added later is held to the same rule.
  assert.ok(files.includes("pull-request.yml") && files.length >= 3, `the workflows are read from the directory: ${files.join(", ")}`);
  const setupNode = steps.filter(({ step }) => /^actions\/setup-node@/i.test(step.uses ?? ""));
  assert.ok(setupNode.length > 0, "the rule is checked against real steps: the workflows set up Node");
  const found = steps.map(({ file, job, step }) => ({ file, job, why: restoresCache(step) })).filter(({ why }) => why);
  assert.deepEqual(found.map(({ file, job, why }) => `${file}, job ${job}: ${why}`), [], WHY);
  // A cache-dependency-path without a cache names a cache that is not there: it goes with it.
  for (const { file, job, step } of steps) assert.equal(inputsOf(step).has("cache-dependency-path"), false, `${file}, job ${job}: \`cache-dependency-path\` is an input of a cache. ${WHY}`);
});

test("a workflow uses only the actions that were read for the rule: no other action, no local action, no reusable workflow", () => {
  const { jobs, steps } = workflowSteps();
  const unlisted = steps.map(({ file, job, step }) => ({ file, job, why: usesUnlistedAction(step) })).filter(({ why }) => why);
  assert.deepEqual(unlisted.map(({ file, job, why }) => `${file}, job ${job}: ${why}`), [], `${WHY} ${HOW_TO_ALLOW}`);
  const called = jobs.map(({ file, job, definition }) => ({ file, job, why: callsWorkflow(definition) })).filter(({ why }) => why);
  assert.deepEqual(called.map(({ file, job, why }) => `${file}, job ${job}: ${why}`), [], WHY);
  assert.ok(steps.some(({ step }) => step.uses !== undefined) && jobs.length > 0, "the rule is checked against real jobs and steps");
});

test("the rule: which actions a step may use, and what a job may not do", () => {
  const refused = [
    // The three that passed before the list existed.
    [{ uses: "./.github/actions/setup" }, /it uses the local action \.\/\.github\/actions\/setup/],
    [{ uses: "actions/setup-go@v5" }, /actions\/setup-go@v5, which is not on the list of allowed actions/],
    [{ uses: "actions/cache/save@v4", with: { path: "~/.npm", key: "k" } }, /actions\/cache\/save@v4, which is not on the list/],
    [{ uses: "actions/cache@v4" }, /not on the list/],
    [{ uses: "actions/cache/restore@v4" }, /not on the list/],
    [{ uses: "actions/setup-python@v5" }, /not on the list/],
    [{ uses: "someone/some-action@v1" }, /not on the list/],
    [{ uses: "docker://alpine:3" }, /not on the list/],
    [{ uses: "../actions/setup" }, /local action/],
    // The listed name exactly: not a path under it, not a longer or a shorter name.
    [{ uses: "actions/checkout/sub@v4" }, /not on the list/],
    [{ uses: "actions/upload-artifact/merge@v4" }, /not on the list/],
    [{ uses: "actions/checkout-extra@v4" }, /not on the list/],
    [{ uses: "actions@v4" }, /not on the list/],
    [{ uses: "" }, /not on the list/],
    [{ uses: 4 }, /is not a string/],
  ];
  for (const [step, why] of refused) assert.match(String(usesUnlistedAction(step)), why, JSON.stringify(step));
  // What to do about it is in the message, once.
  assert.match(usesUnlistedAction({ uses: "actions/setup-go@v5" }), /An action is added to the list of allowed actions by whoever has read whether it saves or restores a cache by itself\.$/);
  const accepted = [
    ...ALLOWED_ACTIONS.map((action) => ({ uses: `${action}@v4` })),
    // An action's name is matched whatever its case, and whatever its ref: the ref is the cache rule's.
    { uses: "Actions/Checkout@v4" },
    { uses: "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683" },
    { uses: "actions/setup-node@v7" },
    { run: "npm ci" },
    { name: "a step that names an action in a command uses none", run: "echo actions/cache@v4" },
  ];
  for (const step of accepted) assert.equal(usesUnlistedAction(step), null, JSON.stringify(step));

  assert.match(callsWorkflow({ uses: "./.github/workflows/build.yml" }), /it calls the reusable workflow \.\/\.github\/workflows\/build\.yml/);
  assert.match(callsWorkflow({ uses: "someone/somewhere/.github/workflows/build.yml@v1", with: { cache: false } }), /it calls the reusable workflow/);
  assert.equal(callsWorkflow({ "runs-on": "ubuntu-latest", steps: [{ run: "npm ci" }] }), null);
});

test("the rule: what counts as restoring a cache, and what keeps actions/setup-node from caching by itself", () => {
  const refused = [
    { uses: "actions/cache@v4", with: { path: "~/.npm", key: "k" } },
    { uses: "actions/cache/restore@v4", with: { path: "~/.npm", key: "k" } },
    { uses: "Actions/Cache@v4" },
    { uses: "actions/setup-node@v4", with: { "node-version": 22, cache: "npm" } },
    { uses: "actions/setup-node@v4", with: { "node-version": 22, cache: "" } },
    { uses: "actions/setup-python@v5", with: { cache: "pip" } },
    { uses: "actions/setup-go@v5", with: { cache: true } },
    // An input's name is matched whatever its case.
    { uses: "actions/setup-node@v4", with: { "node-version": 22, CACHE: "npm" } },
    { uses: "actions/setup-node@v4", with: { "node-version": 22, Cache: "npm" } },
    // No `cache` input at all, whatever it says: not `false` either.
    { uses: "actions/setup-go@v5", with: { cache: false } },
    { uses: "actions/setup-node@v4", with: { "node-version": 22, cache: "false" } },
    { uses: "actions/setup-node@v6", with: { "package-manager-cache": false, CACHE: false } },
    // A later major caches by itself unless told not to; so may a ref whose major cannot be read.
    { uses: "actions/setup-node@v5", with: { "node-version": 22 } },
    { uses: "actions/setup-node@v6" },
    { uses: "actions/setup-node@v7", with: { "package-manager-cache": true } },
    { uses: "actions/setup-node@main", with: { "node-version": 22 } },
    { uses: "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020", with: { "node-version": 22 } },
    { uses: "actions/setup-node", with: { "node-version": 22 } },
  ];
  for (const step of refused) assert.equal(typeof restoresCache(step), "string", JSON.stringify(step));
  const accepted = [
    { uses: "actions/setup-node@v4", with: { "node-version": 22 } },
    { uses: "actions/setup-node@v4.4.0", with: { "node-version": 22, "registry-url": "https://registry.npmjs.org" } },
    { uses: "actions/setup-node@v6", with: { "node-version": 22, "package-manager-cache": false } },
    { uses: "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020", with: { "package-manager-cache": "false" } },
    { uses: "actions/setup-node@v6", with: { "node-version": 22, "Package-Manager-Cache": false } },
    { uses: "actions/checkout@v4", with: { "fetch-depth": 0 } },
    { uses: "actions/upload-artifact@v4", with: { name: "dist", path: "dist" } },
    { run: "npm ci" },
    { name: "a step that names a cache in a command restores none", run: "npm ci --cache .npm" },
  ];
  for (const step of accepted) assert.equal(restoresCache(step), null, JSON.stringify(step));
});
