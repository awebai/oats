import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

// The bundled official payloads must validate against the manifest schema
// this kernel publishes, with every key the runtime accepts (operations
// included): a schema behind the runtime lets a package author ship a
// manifest OATS loads but the mirror validator refuses, or the reverse.
test("every bundled capability manifest validates against docs/capability-manifest.schema.json", async () => {
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const root = resolve(new URL("..", import.meta.url).pathname);
  const schema = JSON.parse(readFileSync(join(root, "docs", "capability-manifest.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false, allowUnionTypes: true }).compile(schema);
  const dirs = readdirSync(join(root, "capabilities")).filter((d) => existsSync(join(root, "capabilities", d, "oats.json")));
  assert.ok(dirs.includes("oats-okf"));
  for (const d of dirs) {
    const manifest = JSON.parse(readFileSync(join(root, "capabilities", d, "oats.json"), "utf8"));
    assert.equal(validate(manifest), true, `${d}: ${JSON.stringify(validate.errors)}`);
  }
  const okf = JSON.parse(readFileSync(join(root, "capabilities", "oats-okf", "oats.json"), "utf8"));
  assert.deepEqual(Object.keys(okf.operations).sort(), ["harvest", "inspect"]);
  // The schema rejects what the runtime rejects.
  const base = { capability: "acme.x", version: "1.0.0", compatibility: { oats: ">=0.6.2" }, description: "x", commands: { go: "bin/x.mjs" } };
  assert.equal(validate({ ...base, operations: { run: { command: "go", kind: "view" } } }), true);
  assert.equal(validate({ ...base, operations: { run: { command: "go", kind: "batch" } } }), false, "unknown kind");
  assert.equal(validate({ ...base, operations: { "Bad Name": { command: "go" } } }), false, "bad name");
  assert.equal(validate({ ...base, operations: { run: { kind: "view" } } }), false, "command required");
  assert.equal(validate({ ...base, operations: { run: { command: "go", args: [{ flag: "--n" }] } } }), false, "arg name required");
});
