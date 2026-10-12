// No workflow in this repository restores an Actions cache. A workflow here runs a branch's code
// in the default branch's cache scope, and every pull request's CI reads that scope: a restored
// entry would stand between a job and its result. Nothing here reads a cache at all, and this
// pins it for every file under .github/workflows/, whatever files exist there.
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

const isFalse = (value) => value === false || value === "false";
/** Why `step` restores an Actions cache, or could begin to by itself; null when it cannot. */
function restoresCache(step) {
  if (typeof step?.uses !== "string") return null;
  const at = step.uses.lastIndexOf("@");
  const action = (at < 0 ? step.uses : step.uses.slice(0, at)).toLowerCase(), ref = at < 0 ? "" : step.uses.slice(at + 1);
  const inputs = step.with ?? {};
  if (action === "actions/cache" || action === "actions/cache/restore") return `it uses ${step.uses}`;
  if (Object.hasOwn(inputs, "cache") && !isFalse(inputs.cache)) return `it gives ${step.uses} the input \`cache: ${inputs.cache}\``;
  if (action === "actions/setup-node" && !SETUP_NODE_WITHOUT_AUTOMATIC_CACHE.test(ref) && !isFalse(inputs["package-manager-cache"])) {
    return `it uses ${step.uses} without \`package-manager-cache: false\`: from v5 on, actions/setup-node caches by itself when package.json names a package manager (a v4 step needs no input)`;
  }
  return null;
}

/** Every step of every job of every workflow file in the directory: { file, job, step }. */
function workflowSteps() {
  const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name)).sort();
  return { files, steps: files.flatMap((file) => {
    const workflow = parseConfigData(readFileSync(new URL(file, WORKFLOWS))).value;
    return Object.entries(workflow.jobs ?? {}).flatMap(([job, definition]) => (definition.steps ?? []).map((step) => ({ file, job, step })));
  }) };
}

test("no workflow under .github/workflows/ restores an Actions cache, and no setup action can begin to by itself", () => {
  const { files, steps } = workflowSteps();
  // The directory is read, not listed here: a workflow added later is held to the same rule.
  assert.ok(files.includes("pull-request.yml") && files.length >= 3, `the workflows are read from the directory: ${files.join(", ")}`);
  const setupNode = steps.filter(({ step }) => /^actions\/setup-node@/i.test(step.uses ?? ""));
  assert.ok(setupNode.length > 0, "the rule is checked against real steps: the workflows set up Node");
  const found = steps.map(({ file, job, step }) => ({ file, job, why: restoresCache(step) })).filter(({ why }) => why);
  assert.deepEqual(found.map(({ file, job, why }) => `${file}, job ${job}: ${why}`), [], WHY);
  // A cache-dependency-path without a cache names a cache that is not there: it goes with it.
  for (const { file, job, step } of steps) assert.equal(Object.hasOwn(step.with ?? {}, "cache-dependency-path"), false, `${file}, job ${job}: \`cache-dependency-path\` is an input of a cache. ${WHY}`);
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
    { uses: "actions/setup-go@v5", with: { cache: false } },
    { uses: "actions/checkout@v4", with: { "fetch-depth": 0 } },
    { uses: "actions/upload-artifact@v4", with: { name: "dist", path: "dist" } },
    { run: "npm ci" },
    { name: "a step that names a cache in a command restores none", run: "npm ci --cache .npm" },
  ];
  for (const step of accepted) assert.equal(restoresCache(step), null, JSON.stringify(step));
});
