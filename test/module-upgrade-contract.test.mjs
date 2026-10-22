import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { manifestContract } from "../lib/capability-contract.mjs";

test("upgrade lifecycle event is approved and optional in the schema and manifest contract", () => {
  const schema = JSON.parse(readFileSync(new URL("../docs/capability-manifest.schema.json", import.meta.url), "utf8"));
  const base = { capability: "acme.x" };
  for (const upgrade of ["bin/upgrade.mjs", { command: "bin/upgrade.mjs" }, { command: "bin/upgrade.mjs", required: false }]) {
    assert.deepEqual(manifestContract({ ...base, hooks: { upgrade } }), { problems: [], warnings: [] });
  }
  assert.equal(schema.properties.hooks.properties.upgrade.$ref, "#/$defs/OptionalHook");
  const optionalObject = schema.$defs.OptionalHook.oneOf.find(shape => shape.type === "object");
  assert.deepEqual(optionalObject.required, ["command"]);
  assert.deepEqual(optionalObject.properties.required.const, false);
  const required = manifestContract({ ...base, hooks: { upgrade: { command: "bin/upgrade.mjs", required: true } } });
  assert.deepEqual(required.problems.map(p => p.pointer), ["/hooks/upgrade/required"]);
  assert.match(required.problems[0].message, /cannot be required/);
  assert.match(manifestContract({ ...base, hooks: { upgrade: "../outside.mjs" } }).problems[0].message, /escapes the capability directory/);
});
