import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { disposableHomeRootProblem, manifestContractProblems } from "../lib/capability-contract.mjs";
import { DISPOSABLE_HOME_ACCEPTED, DISPOSABLE_HOME_REFUSED } from "./helpers/disposable-home.mjs";

// The mirrored official payloads (mirrors/) and this repository's own
// capabilities (capabilities/) must validate against the manifest schema
// this kernel publishes, with every key the harness accepts (operations
// included): a schema behind the harness lets a package author ship a
// manifest OATS loads but the mirror validator refuses, or the reverse.
test("every mirrored and repo-owned capability manifest validates against docs/capability-manifest.schema.json", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const root = resolve(new URL("..", import.meta.url).pathname);
  const schema = JSON.parse(readFileSync(join(root, "docs", "capability-manifest.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false, allowUnionTypes: true }).compile(schema);
  const dirs = ["capabilities", "mirrors"].flatMap((parent) => readdirSync(join(root, parent)).map((d) => `${parent}/${d}`))
    .filter((d) => existsSync(join(root, d, "oats.json")));
  assert.ok(dirs.includes("mirrors/oats-okf") && dirs.includes("capabilities/oats-workspace-experts"));
  for (const d of dirs) {
    const manifest = JSON.parse(readFileSync(join(root, d, "oats.json"), "utf8"));
    assert.equal(validate(manifest), true, `${d}: ${JSON.stringify(validate.errors)}`);
  }
  const okf = JSON.parse(readFileSync(join(root, "mirrors", "oats-okf", "oats.json"), "utf8"));
  assert.deepEqual(Object.keys(okf.operations).sort(), ["harvest", "inspect"]);
  // The schema rejects what the harness rejects.
  const base = { capability: "acme.x", version: "1.0.0", compatibility: { oats: ">=0.6.2" }, description: "x", commands: { go: "bin/x.mjs" } };
  assert.equal(validate({ ...base, operations: { run: { command: "go", kind: "view" } } }), true);
  assert.equal(validate({ ...base, operations: { run: { command: "go", kind: "batch" } } }), false, "unknown kind");
  assert.equal(validate({ ...base, operations: { "Bad Name": { command: "go" } } }), false, "bad name");
  assert.equal(validate({ ...base, operations: { run: { kind: "view" } } }), false, "command required");
  assert.equal(validate({ ...base, operations: { run: { command: "go", args: [{ flag: "--n" }] } } }), false, "arg name required");
  // Workspace discovery reads `private` (lib/workspace.mjs); `team` was removed in 0.30 (a soul's teams are the workspace's souls:).
  assert.equal(validate({ ...base, private: true }), true, "private: true");
  assert.equal(validate({ ...base, private: "yes" }), false, "private must be a boolean");
  assert.equal(validate({ ...base, team: "engineering" }), false, "team was removed in 0.30");
});

// The schema is what a package author validates against; the contract (lib/capability-contract.mjs)
// is what the kernel enforces. A `retirement` one accepts and the other refuses is a manifest that
// validates and does not load, or the reverse.
test("the schema and the manifest contract give the same verdict on a retirement declaration's shape and on every disposable home entry", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const root = resolve(new URL("..", import.meta.url).pathname);
  const schema = JSON.parse(readFileSync(join(root, "docs", "capability-manifest.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false, allowUnionTypes: true }).compile(schema);
  const base = { capability: "acme.x", version: "1.0.0", compatibility: { oats: ">=0.6.2" }, description: "x", commands: { go: "bin/x.mjs" } };
  const bySchema = (retirement) => validate({ ...base, retirement });
  const byContract = (retirement) => manifestContractProblems({ capability: "acme.x", retirement });
  assert.equal(validate(base), true, `the manifest every case below adds a retirement to is valid: ${JSON.stringify(validate.errors)}`);

  for (const [value, why] of DISPOSABLE_HOME_REFUSED) {
    const retirement = { disposable: { home: [value] } };
    assert.equal(bySchema(retirement), false, `the schema refuses ${JSON.stringify(value)}`);
    // Refused for that entry, where the contract's pointer names it, and not for something else in the manifest.
    assert.deepEqual([...new Set(validate.errors.map((e) => e.instancePath))], ["/retirement/disposable/home/0"], `${JSON.stringify(value)}: ${JSON.stringify(validate.errors)}`);
    assert.equal(disposableHomeRootProblem(value), why, JSON.stringify(value));
    assert.deepEqual(byContract(retirement).map((p) => p.pointer), ["/retirement/disposable/home/0"], `the contract refuses ${JSON.stringify(value)}`);
  }
  for (const value of DISPOSABLE_HOME_ACCEPTED) {
    const retirement = { disposable: { home: [value] } };
    assert.equal(bySchema(retirement), true, `the schema accepts ${JSON.stringify(value)}: ${JSON.stringify(validate.errors)}`);
    assert.equal(disposableHomeRootProblem(value), undefined, JSON.stringify(value));
    assert.deepEqual(byContract(retirement), [], `the contract accepts ${JSON.stringify(value)}`);
  }
  // One rule, both directions: for every entry, whatever the lists above say, the two verdicts are the same.
  for (const value of [...DISPOSABLE_HOME_REFUSED.map(([v]) => v), ...DISPOSABLE_HOME_ACCEPTED]) {
    const retirement = { disposable: { home: [value] } };
    assert.equal(bySchema(retirement), byContract(retirement).length === 0, `schema and contract disagree on ${JSON.stringify(value)}`);
  }

  // The shape of the declaration: a `disposable` map, only `home` and `work`, each an array of strings.
  for (const [retirement, sound] of [
    [{}, false],
    [{ disposable: [] }, false],
    [{ disposable: {}, extra: 1 }, false],
    [{ disposable: { other: [] } }, false],
    [{ disposable: { home: ".aw" } }, false],
    [{ disposable: { work: [1] } }, false],
    [{ disposable: {} }, true],
    [{ disposable: { work: ["node_modules"] } }, true],
  ]) {
    assert.equal(bySchema(retirement), sound, `schema: ${JSON.stringify(retirement)} ${JSON.stringify(validate.errors)}`);
    assert.equal(byContract(retirement).length === 0, sound, `contract: ${JSON.stringify(retirement)}`);
  }
  // A work root's text is the schema's alone to refuse at read: the kernel checks it where it
  // records the roots at spawn (lib/core.mjs retirementDisposableRoots), not in the contract.
  assert.equal(bySchema({ disposable: { work: [""] } }), false, "a work root is a non-empty string");
});

// Forward-tolerant hook events (0.49.0): an event this kernel does not run is a warning when it is not
// required and a refusal when it is. The schema accepts the same additional events with the same shape.
test("an unknown hook event: the schema and the contract accept it unless it is required, and the contract warns that it does not run", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const { APPROVED_HOOKS, manifestContract } = await import("../lib/capability-contract.mjs");
  const kernelEvents = [...APPROVED_HOOKS].join(", ");
  const root = resolve(new URL("..", import.meta.url).pathname);
  const schema = JSON.parse(readFileSync(join(root, "docs", "capability-manifest.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false, allowUnionTypes: true }).compile(schema);
  const base = { capability: "acme.x", version: "1.0.0", compatibility: { oats: ">=0.6.2" }, description: "x" };
  const warning = (event) => ({ code: "hook-event-unsupported", pointer: `/hooks/${event}`,
    message: `capability acme.x declares hook "${event}", which this kernel does not run; it is ignored (this kernel runs ${kernelEvents})` });
  for (const [declaration, sound] of [
    ["bin/h.mjs", true],
    [{ command: "bin/h.mjs" }, true],
    [{ command: "bin/h.mjs", required: false }, true],
    [{ command: "bin/h.mjs", inputs: { sourceReceipt: { version: 1 } } }, true],
    [{ command: "bin/h.mjs", required: true }, false],
    [{ command: "bin/h.mjs", required: "yes" }, false],
    [{ command: "bin/h.mjs", when: "always" }, false],
    [{ required: false }, false],
    [{ command: 7 }, false],
    [7, false],
  ]) {
    const hooks = { "future-event": declaration };
    const contract = manifestContract({ ...base, hooks });
    assert.equal(validate({ ...base, hooks }), sound, `schema: ${JSON.stringify(declaration)} ${JSON.stringify(validate.errors)}`);
    assert.equal(contract.problems.length === 0, sound, `contract: ${JSON.stringify(declaration)} ${JSON.stringify(contract.problems)}`);
    assert.deepEqual(contract.warnings, sound ? [warning("future-event")] : [], `a sound unknown event is one warning, a refused one none: ${JSON.stringify(declaration)}`);
  }
  // Required: refused with the message and pointer it had before 0.49.0.
  assert.deepEqual(manifestContractProblems({ ...base, hooks: { "future-other": { command: "bin/h.mjs", required: true } } }),
    [{ pointer: "/hooks/future-other", message: `capability acme.x declares unsupported hook "future-other" (${kernelEvents})` }]);
  // The contract alone refuses an empty command and a script outside the capability, for an unknown event as for a known one.
  for (const event of ["future-event", "launch"]) {
    for (const [declaration, why] of [[" ", /must be a command string/], [{ command: "" }, /must be a command string/], ["../out.mjs", /escapes the capability directory/], [{ command: "/abs.mjs" }, /escapes the capability directory/]]) {
      const contract = manifestContract({ ...base, hooks: { [event]: declaration } });
      assert.match(contract.problems.map((p) => p.message).join("\n"), why, `${event}: ${JSON.stringify(declaration)}`);
      assert.deepEqual(contract.warnings, [], `${event}: a refused declaration is no warning`);
    }
  }
  // Every approved event keeps its verdicts, and is never a warning.
  for (const event of ["soul-scaffold", "spawn", "retire", "launch"]) {
    assert.deepEqual(manifestContract({ ...base, hooks: { [event]: "bin/h.mjs" } }), { problems: [], warnings: [] }, event);
    const required = manifestContract({ ...base, hooks: { [event]: { command: "bin/h.mjs", required: true } } });
    assert.equal(required.problems.length === 0, event === "spawn", `${event} required`);
    assert.equal(validate({ ...base, hooks: { [event]: { command: "bin/h.mjs", required: true } } }), event === "spawn", `schema: ${event} required`);
  }
  // Several unknown events beside a known one: one warning each, the known one runs as before.
  assert.deepEqual(manifestContract({ ...base, hooks: { spawn: "bin/h.mjs", a: "bin/a.mjs", "b/c": "bin/b.mjs" } }).warnings.map((w) => w.pointer), ["/hooks/a", "/hooks/b~1c"]);
});
