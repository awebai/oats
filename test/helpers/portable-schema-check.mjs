import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Ajv from "ajv";

const ajv = new Ajv({ strict: true, ownProperties: true });
for (const name of ["portable", "captured-resolution", "oats-lock-v3", "artifact-approvals"]) {
  ajv.addSchema(JSON.parse(readFileSync(new URL(`../../docs/${name}.schema.json`, import.meta.url), "utf8")));
}
export const wireValidator = (definition) => ajv.getSchema(`https://oats.dev/schemas/portable-v1.json#/$defs/${definition}`);
export function validateWire(definition, value) {
  const validate = wireValidator(definition);
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
}
