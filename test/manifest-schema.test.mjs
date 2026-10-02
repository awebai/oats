import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

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
