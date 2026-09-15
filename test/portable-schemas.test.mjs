import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { portableSchemas } from "../scripts/portable-schemas.mjs";
import { emptyLock3 } from "../lib/portable-lock.mjs";
import { validateWire, wireValidator } from "./helpers/portable-schema-check.mjs";

test("checked-in portable schemas are generated deterministically and compile without network", () => {
  for (const [name, schema] of Object.entries(portableSchemas())) {
    assert.equal(readFileSync(new URL(`../docs/${name}`, import.meta.url), "utf8"), JSON.stringify(schema, null, 2) + "\n");
  }
  validateWire("Lock3", emptyLock3());
  validateWire("ApprovalLedger", { schemaVersion: 1, capabilities: {} });
});

test("structural schemas reject legacy/extra authority and literal credential fields without interpreting provider payloads", () => {
  const lock = wireValidator("Lock3"), binding = wireValidator("ProviderBinding");
  assert.equal(lock({ lockfileVersion: 2, packages: {}, capabilities: {} }), false);
  assert.equal(lock({ ...emptyLock3(), trusted: true }), false);
  const value = { schemaVersion: 1, capability: "example.documents", payloadContract: "alternate.documents", payloadVersion: 1,
    payload: { arbitrary: ["provider", { defines: "this" }] }, credentialRefs: { api: { kind: "env", name: "DOC_TOKEN" } }, provenance: [] };
  assert.equal(binding(value), true, JSON.stringify(binding.errors));
  value.credentialRefs.api.value = "literal-not-a-reference";
  assert.equal(binding(value), false);
});
