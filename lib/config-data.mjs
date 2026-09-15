/** One bounded decoder for new portable documents. YAML is syntax, not an
 * object-construction language: no tags, anchors, aliases, merges or coercive keys.
 * Legacy core readers are unchanged until the explicit consumer migration. */
import { isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";
import { bytesIntegrity } from "./portable-digest.mjs";
import { byteView, canonicalJson, dataLimits, decodeUtf8, parseStrictJson } from "./portable-values.mjs";
import { oatsError } from "./errors.mjs";

const pointerKey = (key) => key.replace(/~/g, "~0").replace(/\//g, "~1");
export function parseConfigData(input, { format = "auto", origin = null, limits: requested = {} } = {}) {
  const limits = dataLimits({ maxBytes: 1024 * 1024, ...requested });
  const data = typeof input === "string" ? input : byteView(input);
  const size = typeof data === "string" ? Buffer.byteLength(data, "utf8") : data.byteLength;
  if (size > limits.maxBytes) throw oatsError("resource-limit", "portable document byte limit exceeded");
  const source = decodeUtf8(input);
  canonicalJson(origin, { maxBytes: 64 * 1024, maxDepth: 16, maxEntries: 1024 });
  if (!["auto", "json", "yaml"].includes(format)) throw oatsError("invalid-declaration", "unsupported configuration syntax");
  const json = format === "json" || (format === "auto" && /^[\s]*[\[{]/.test(source));
  const origins = Object.create(null);
  let entries = 0;
  const mark = (pointer, depth, node) => {
    if (depth > limits.maxDepth || ++entries > limits.maxEntries) {
      throw oatsError("resource-limit", "portable document depth/entry limit exceeded");
    }
    origins[pointer] = { document: origin, pointer };
    if (node?.range) origins[pointer].span = { start: node.range[0], end: node.range[1] };
  };
  let value;
  if (json) {
    value = parseStrictJson(source, limits);
    const walk = (item, pointer, depth) => {
      mark(pointer, depth);
      if (item && typeof item === "object") {
        for (const [key, child] of Object.entries(item)) walk(child, `${pointer}/${pointerKey(key)}`, depth + 1);
      }
    };
    walk(value, "", 0);
  } else {
    let document;
    try { document = parseDocument(source, { version: "1.2", schema: "core", uniqueKeys: true, strict: true, merge: false }); }
    catch (error) {
      throw oatsError(error instanceof RangeError ? "resource-limit" : "invalid-declaration", "portable YAML could not be decoded");
    }
    if (document.errors.length || document.warnings.length || document.directives.yaml.version !== "1.2") {
      const issue = document.errors[0] ?? document.warnings[0];
      throw oatsError("invalid-declaration", `invalid portable YAML${issue ? ` (${issue.code})` : " version"}`);
    }
    const decode = (node, pointer, depth) => {
      mark(pointer, depth, node);
      if (node === null) return null;
      if (isAlias(node) || node.anchor || node.tag) {
        throw oatsError("invalid-declaration", "YAML anchors, aliases and explicit tags are not portable data");
      }
      if (isScalar(node)) return node.value;
      if (isSeq(node)) return node.items.map((child, i) => decode(child, `${pointer}/${i}`, depth + 1));
      if (isMap(node)) {
        const result = Object.create(null);
        for (const pair of node.items) {
          const key = pair.key;
          if (!isScalar(key) || typeof key.value !== "string" || key.anchor || key.tag
              || (key.value === "<<" && key.type !== "QUOTE_DOUBLE" && key.type !== "QUOTE_SINGLE")) {
            throw oatsError("invalid-declaration", "portable YAML mapping keys must be literal strings without merge syntax");
          }
          if (Object.hasOwn(result, key.value)) throw oatsError("invalid-declaration", "duplicate portable YAML key");
          result[key.value] = decode(pair.value, `${pointer}/${pointerKey(key.value)}`, depth + 1);
        }
        return result;
      }
      throw oatsError("invalid-declaration", "unsupported portable YAML node");
    };
    value = decode(document.contents, "", 0);
    // Enforce Unicode-scalar/finite JSON semantics even for YAML core scalars.
    canonicalJson(value, limits);
  }
  return { value, origins, integrity: bytesIntegrity(Buffer.from(source, "utf8")) };
}
