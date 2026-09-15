/** Small shape checks shared by portable document/record codecs. Call only on
 * decoded or canonical-data-validated values; these helpers do not resolve policy. */
import { oatsError } from "./errors.mjs";
import { scalarString } from "./portable-values.mjs";

export const pointerKey = (key) => key.replace(/~/g, "~0").replace(/\//g, "~1");
export function invalidShape(pointer, message, code = "invalid-declaration") {
  throw oatsError(code, `${message} at ${pointer || "/"}`);
}
export function objectAt(value, allowed, required, pointer = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidShape(pointer, "expected object");
  if (allowed) for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalidShape(`${pointer}/${pointerKey(key)}`, "unknown field");
  }
  for (const key of required ?? []) if (!Object.hasOwn(value, key)) invalidShape(`${pointer}/${pointerKey(key)}`, "missing field");
  return value;
}
export function stringAt(value, pointer, { pattern, empty = false } = {}) {
  scalarString(value, pointer);
  if ((!empty && !value) || (pattern && !pattern.test(value))) invalidShape(pointer, "invalid string");
  return value;
}
export function versionAt(value, pointer = "/schemaVersion") {
  if (value !== 1) invalidShape(pointer, "unsupported wire version", "unsupported-wire-version");
}
export function stringSetAt(value, pointer, validate = stringAt) {
  if (!Array.isArray(value)) invalidShape(pointer, "expected array");
  const seen = new Set();
  value.forEach((item, index) => {
    validate(item, `${pointer}/${index}`);
    if (seen.has(item)) invalidShape(`${pointer}/${index}`, "duplicate set entry");
    seen.add(item);
  });
  return value;
}
