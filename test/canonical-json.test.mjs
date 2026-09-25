import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, decodeUtf8, parseStrictJson } from "../lib/canonical-json.mjs";
import { BYTES_FORMAT, bytesIntegrity } from "../lib/digest.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oats-canonical-json-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("canonical records use UTF-8 key order, preserve arrays and include exactly one LF", () => {
  assert.equal(canonicalJson({ 2: 2, 10: 1, nested: { z: -0, a: [true, null, "😀"] } }),
    '{"10":1,"2":2,"nested":{"a":[true,null,"😀"],"z":0}}\n');
  const a = { z: 2, a: 1 }, b = { a: 1, z: 2 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  const raw = bytesIntegrity(Buffer.from(canonicalJson(a)));
  assert.equal(raw.format, BYTES_FORMAT);
  assert.equal(raw.value, `sha256-${createHash("sha256").update('{"a":1,"z":2}\n').digest("hex")}`, "the digest covers the exact bytes, the final LF included, no implicit prefix");
  assert.deepEqual(bytesIntegrity(Buffer.from(canonicalJson(b))), raw);
  assert.throws(() => bytesIntegrity("not bytes"), { code: "invalid-declaration" });
});

test("canonical data refuses lossy strings, cycles and caller hooks without invoking them", () => {
  let called = false;
  const accessor = Object.defineProperty({}, "secret", { enumerable: true, get() { called = true; return 1; } });
  const hook = { toJSON() { called = true; return {}; } };
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [accessor, hook, cyclic, new Date(0), NaN, Infinity, undefined, 1n, "\ud800", [, 1]]) {
    assert.throws(() => canonicalJson(value), { code: "invalid-declaration" });
  }
  assert.equal(called, false);
  assert.throws(() => canonicalJson({ a: { b: 1 } }, { maxDepth: 1 }), { code: "resource-limit" });
  assert.throws(() => canonicalJson([1, 2], { maxEntries: 2 }), { code: "resource-limit" });
  assert.throws(() => canonicalJson("long", { maxBytes: 3 }), { code: "resource-limit" });
});

test("strict JSON preserves own-key data and refuses duplicate decoded keys or invalid bounded input", () => {
  const value = parseStrictJson('{"__proto__":{"safe":true},"array":[0,false,null,"x"]}');
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(Object.hasOwn(value, "__proto__"), true);
  assert.equal(value.__proto__.safe, true);
  assert.equal(Object.hasOwn({}, "safe"), false);
  assert.equal(canonicalJson(value), '{"__proto__":{"safe":true},"array":[0,false,null,"x"]}\n');
  for (const text of ['{"a":1,"\\u0061":2}', '{"x":1,}', '[1,]', '01', '1e400', 'true false', '"\\ud800"']) {
    assert.throws(() => parseStrictJson(text), { code: "invalid-declaration" }, text);
  }
  assert.throws(() => parseStrictJson(Buffer.from([0xff])), { code: "invalid-declaration" });
  assert.throws(() => parseStrictJson('[[[1]]]', { maxDepth: 1 }), { code: "resource-limit" });
  assert.throws(() => parseStrictJson('{}', { maxBytes: 1 }), { code: "resource-limit" });
  assert.equal(decodeUtf8(Buffer.from("\ufeffname")), "\ufeffname", "no silent BOM stripping in source names");
});

test("byte budgets never invoke caller-owned accessors", () => {
  let calls = 0;
  const view = new Uint8Array(Buffer.from("[true]"));
  for (const key of ["byteLength", "buffer", "byteOffset"]) {
    Object.defineProperty(view, key, { get() { calls++; return 0; } });
  }
  assert.throws(() => parseStrictJson(view, { maxBytes: 1 }), { code: "resource-limit" });
  assert.deepEqual(parseStrictJson(view), [true]);
  assert.throws(() => parseStrictJson({ get byteLength() { calls++; return 0; } }), { code: "invalid-declaration" });
  assert.equal(calls, 0);
});
