/** Bounded data codecs shared by portable declarations and retained records.
 * No source resolution, filesystem access, getters, or caller serialization hooks. */
import { oatsError } from "./errors.mjs";

const DEFAULTS = Object.freeze({ maxBytes: 8 * 1024 * 1024, maxDepth: 64, maxEntries: 100_000 });
export function dataLimits(options = {}) {
  const limits = { ...DEFAULTS, ...options };
  for (const key of Object.keys(DEFAULTS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) {
      throw oatsError("invalid-declaration", `invalid data limit: ${key}`);
    }
  }
  if (limits.maxDepth > 256) throw oatsError("invalid-declaration", "maximum supported data depth is 256");
  return limits;
}
export function scalarString(value, where = "value") {
  if (typeof value !== "string" || Buffer.from(value, "utf8").toString("utf8") !== value) {
    throw oatsError("invalid-declaration", `expected Unicode-scalar string at ${where}`);
  }
  return value;
}
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength").get;
const byteOffsetOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get;
const bufferOf = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get;

/** Intrinsic getters bypass caller-owned byteLength/buffer accessors. Pass an
 * undecorated view to platform codecs, rather than the caller's decorated object. */
export function byteView(input, where = "input") {
  if (!(input instanceof Uint8Array)) throw oatsError("invalid-declaration", `expected UTF-8 bytes at ${where}`);
  try { return new Uint8Array(bufferOf.call(input), byteOffsetOf.call(input), byteLengthOf.call(input)); }
  catch { throw oatsError("invalid-declaration", `invalid byte view at ${where}`); }
}
export function decodeUtf8(input, where = "input") {
  if (typeof input === "string") return scalarString(input, where);
  const bytes = byteView(input, where);
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw oatsError("invalid-declaration", `invalid UTF-8 at ${where}`); }
}
export const compareUtf8 = (a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

/** Canonical JSON includes exactly one final LF. Emit sorted keys directly:
 * JSON.stringify on a rebuilt object would reorder integer-looking keys. */
export function canonicalJson(value, options) {
  const limits = dataLimits(options), chunks = [], active = new WeakSet();
  let bytes = 0, entries = 0;
  const emit = (text) => {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > limits.maxBytes) throw oatsError("resource-limit", "canonical JSON byte limit exceeded");
    chunks.push(text);
  };
  const visit = (item, depth) => {
    if (depth > limits.maxDepth || ++entries > limits.maxEntries) {
      throw oatsError("resource-limit", "canonical JSON depth/entry limit exceeded");
    }
    if (item === null || typeof item === "boolean") { emit(JSON.stringify(item)); return; }
    if (typeof item === "string") { emit(JSON.stringify(scalarString(item))); return; }
    if (typeof item === "number" && Number.isFinite(item)) { emit(JSON.stringify(item)); return; }
    if (typeof item !== "object") throw oatsError("invalid-declaration", "value is not finite JSON data");
    if (active.has(item)) throw oatsError("invalid-declaration", "cyclic JSON data");
    const array = Array.isArray(item), proto = Object.getPrototypeOf(item);
    if (proto !== (array ? Array.prototype : Object.prototype) && !(proto === null && !array)) {
      throw oatsError("invalid-declaration", "JSON data must use plain objects and arrays");
    }
    const descriptors = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(descriptors);
    if (keys.length > limits.maxEntries - entries + (array ? 1 : 0)) {
      throw oatsError("resource-limit", "canonical JSON entry limit exceeded");
    }
    for (const key of keys) {
      if (typeof key !== "string") throw oatsError("invalid-declaration", "symbol keys are not JSON data");
      scalarString(key, "object key");
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, "value") || (!descriptor.enumerable && !(array && key === "length"))) {
        throw oatsError("invalid-declaration", "accessor/non-enumerable properties are not JSON data");
      }
    }
    active.add(item);
    try {
      if (array) {
        const length = descriptors.length.value;
        if (length > limits.maxEntries - entries) throw oatsError("resource-limit", "canonical JSON array limit exceeded");
        if (keys.length !== length + 1) throw oatsError("invalid-declaration", "sparse or extended arrays are not JSON data");
        emit("[");
        for (let i = 0; i < length; i++) {
          if (!Object.hasOwn(descriptors, String(i))) throw oatsError("invalid-declaration", "sparse or extended arrays are not JSON data");
          if (i) emit(",");
          visit(descriptors[i].value, depth + 1);
        }
        emit("]");
      } else {
        emit("{");
        keys.sort(compareUtf8).forEach((key, index) => {
          if (index) emit(",");
          emit(JSON.stringify(key)); emit(":"); visit(descriptors[key].value, depth + 1);
        });
        emit("}");
      }
    } finally { active.delete(item); }
  };
  visit(value, 0); emit("\n");
  return chunks.join("");
}

/** JSON.parse alone cannot detect duplicate decoded keys. This small JSON
 * decoder preserves that check and budgets; YAML must use it for JSON input,
 * not maintain another permissive JSON reader. Objects have null prototypes. */
export function parseStrictJson(input, options) {
  const limits = dataLimits(options);
  const data = typeof input === "string" ? input : byteView(input);
  if ((typeof data === "string" ? Buffer.byteLength(data) : byteLengthOf.call(data)) > limits.maxBytes) {
    throw oatsError("resource-limit", "JSON input byte limit exceeded");
  }
  const text = decodeUtf8(data);
  let at = 0, entries = 0;
  const bad = () => { throw oatsError("invalid-declaration", `invalid JSON at character ${at}`); };
  const space = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++; };
  const string = () => {
    const start = at++;
    while (at < text.length) {
      const char = text[at++];
      if (char === "\\") { at++; continue; }
      if (char === '"') {
        let value;
        try { value = JSON.parse(text.slice(start, at)); } catch { bad(); }
        return scalarString(value);
      }
    }
    bad();
  };
  const value = (depth) => {
    if (depth > limits.maxDepth || ++entries > limits.maxEntries) {
      throw oatsError("resource-limit", "JSON depth/entry limit exceeded");
    }
    space();
    const char = text[at];
    if (char === '"') return string();
    if (char === "{" || char === "[") {
      const array = char === "[", result = array ? [] : Object.create(null), close = array ? "]" : "}";
      at++; space();
      if (text[at] === close) { at++; return result; }
      for (;;) {
        if (array) result.push(value(depth + 1));
        else {
          if (text[at] !== '"') bad();
          const key = string(); space();
          if (Object.hasOwn(result, key)) throw oatsError("invalid-declaration", `duplicate JSON key at character ${at}`);
          if (text[at++] !== ":") bad();
          result[key] = value(depth + 1);
        }
        space();
        if (text[at] === close) { at++; return result; }
        if (text[at++] !== ",") bad();
        space();
      }
    }
    for (const [token, decoded] of [["true", true], ["false", false], ["null", null]]) {
      if (text.startsWith(token, at)) { at += token.length; return decoded; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at));
    if (number) {
      at += number[0].length;
      const result = Number(number[0]);
      if (Number.isFinite(result)) return result;
    }
    bad();
  };
  const result = value(0); space();
  if (at !== text.length) bad();
  return result;
}
