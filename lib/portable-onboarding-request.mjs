/** Thin request-file transport for explicit new-work preparation.
 * The CLI owns flag parsing through its existing router; public core owns the
 * preparation schema/resolver. This module reads no ambient authority and never
 * prepares, installs, approves, activates or dispatches a command. */
import { isAbsolute, resolve } from "node:path";
import { readPortableBytes } from "./portable-files.mjs";
import { canonicalJson, freezeJson, parseStrictJson } from "./portable-values.mjs";
import { objectAt } from "./portable-shape.mjs";
import { oatsError } from "./errors.mjs";

/**
 * file: explicit normalized absolute JSON file.
 * inputFlags: OTHER prepare value flags already parsed by the existing router;
 *   request/json are consumed by that router and must not occur here. Even a
 *   false/null/empty-valued competing flag is a conflict by own-key presence.
 * explicitSelector: existing capturedSelector(argv, {}) result, or null. No
 *   second global selector parser, inherited resolution or environment lookup.
 *
 * Return the decoded request itself, not a wrapper/private prepare input. Unknown
 * request fields survive unchanged so the sole public core validator can refuse
 * them; never strip them to produce an apparently compatible request.
 */
export function readPortablePreparationRequest(options) {
  canonicalJson(options);
  objectAt(options, ["file", "inputFlags", "explicitSelector"], ["file"]);
  const { file, inputFlags = {}, explicitSelector = null } = options;
  objectAt(inputFlags, null, []);
  if (Object.keys(inputFlags).length) throw oatsError("E_BAD_ARGS", "--request cannot be combined with other preparation input flags");
  if (explicitSelector !== null) throw oatsError("E_BAD_ARGS", "new-work preparation cannot use explicit captured selectors");
  if (typeof file !== "string" || !isAbsolute(file) || resolve(file) !== file || file.includes("\0")) {
    throw oatsError("E_BAD_ARGS", "--request needs a normalized absolute JSON file path");
  }
  let bytes;
  try { bytes = readPortableBytes(file, { missingCode: "E_BAD_ARGS", invalidCode: "E_BAD_ARGS" }); }
  catch (error) {
    // Do not echo request content, source/settings or OS diagnostic payloads.
    throw oatsError(error.code === "resource-limit" ? "resource-limit"
      : error.code === "integrity-drift" ? "integrity-drift" : "E_BAD_ARGS", "preparation request file could not be read as bounded regular bytes");
  }
  let input;
  try { input = parseStrictJson(bytes); }
  catch (error) {
    throw oatsError(error.code === "resource-limit" ? "resource-limit" : "invalid-declaration", "preparation request file must contain bounded strict UTF-8 JSON");
  }
  // Only the transport's JSON-object boundary is checked here, not a copy of the
  // public preparation field/choice/provider validation contract.
  objectAt(input, null, []);
  return freezeJson(input);
}
