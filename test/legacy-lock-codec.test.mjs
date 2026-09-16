import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../lib/portable-values.mjs";
import { decodeLegacyLockBytes } from "../lib/legacy-lock-codec.mjs";
import { parseLockFileStrict, retiredCapabilityReason } from "../lib/core.mjs";

const hash = (letter) => `sha256-${letter.repeat(64)}`;
const packageRow = (overrides = {}) => ({ source: "git:https://example.test/pkg.git@main", path: "oats-package", version: "1.0.0",
  commit: "a".repeat(40), integrity: hash("a"), dependencies: [], ...overrides });
const capabilityRow = (overrides = {}) => ({ version: "1.0.0", package: "example.pkg", path: "capabilities/action",
  integrity: hash("b"), trusted: false, ...overrides });
const options = (file) => ({ file, retiredCapabilityReason });

function compareWithCore(t, documents) {
  const root = mkdtempSync(join(tmpdir(), "oats-legacy-codec-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (let index = 0; index < documents.length; index++) {
    const file = join(root, `${index}.json`), bytes = Buffer.from(documents[index]);
    writeFileSync(file, bytes);
    const actual = decodeLegacyLockBytes(bytes, options(file));
    const expected = parseLockFileStrict(file);
    assert.equal(canonicalJson(actual), canonicalJson(expected), `bytes decoder differs for fixture ${index}`);
  }
}

function bothRefuse(t, documents) {
  const root = mkdtempSync(join(tmpdir(), "oats-legacy-codec-refuse-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (let index = 0; index < documents.length; index++) {
    const file = join(root, `${index}.json`), bytes = Buffer.from(documents[index]);
    writeFileSync(file, bytes);
    assert.throws(() => parseLockFileStrict(file), { code: "invalid-lock" }, `core accepted refused fixture ${index}`);
    assert.throws(() => decodeLegacyLockBytes(bytes, options(file)), { code: "invalid-lock" }, `bytes decoder accepted refused fixture ${index}`);
  }
}

test("bytes decoder preserves representative v1/v2 and retired-entry semantics", (t) => {
  compareWithCore(t, [
    JSON.stringify({ capabilities: { "example.legacy": { source: "marketplace:example.legacy@1", version: "1", integrity: hash("a"), trustedExecutables: true, historicalExtra: "preserved" } } }),
    JSON.stringify({ lockfileVersion: 1, capabilities: { "oats.web": { malformed: true } } }),
    JSON.stringify({ lockfileVersion: 2, packages: {
      "example.pkg": packageRow({ dependencies: ["example.dep"] }),
      "example.dep": packageRow({ source: "path:/explicit/dep", path: ".", commit: "local", dependencies: [] }),
    }, capabilities: { "example.action": capabilityRow() } }),
    JSON.stringify({ lockfileVersion: 2, packages: {} }),
    JSON.stringify({ lockfileVersion: 2, packages: {}, capabilities: {} }),
  ]);
});

test("bytes decoder preserves existing malformed/transitional/graph/back-reference refusals", (t) => {
  const valid = { lockfileVersion: 2, packages: { "example.pkg": packageRow() }, capabilities: { "example.action": capabilityRow() } };
  bothRefuse(t, [
    "{not json",
    JSON.stringify([]),
    JSON.stringify({ lockfileVersion: 99, packages: {}, capabilities: {} }),
    JSON.stringify({ lockfileVersion: 1, packages: {}, capabilities: {} }),
    JSON.stringify({ lockfileVersion: 1, capabilities: { "example.bad": { source: "path:/x", version: 1, integrity: hash("a") } } }),
    JSON.stringify({ lockfileVersion: 2, packages: { "example.pkg": packageRow() } }),
    JSON.stringify({ lockfileVersion: 2, packages: { "example.pkg": { ...packageRow(), capabilities: [] } }, capabilities: {} }),
    JSON.stringify({ ...valid, packages: { "example.pkg": packageRow({ unknown: true }) } }),
    JSON.stringify({ ...valid, capabilities: { "example.action": capabilityRow({ package: "missing.pkg" }) } }),
    JSON.stringify({ lockfileVersion: 2, packages: {
      "example.pkg": packageRow({ dependencies: ["example.dep"] }),
      "example.dep": packageRow({ dependencies: ["example.pkg"] }),
    }, capabilities: {} }),
  ]);
});

test("common bounded JSON ingress rejects duplicate keys, invalid UTF-8 and oversized bytes without writes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oats-legacy-codec-bytes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const before = readdirSync(root);
  for (const bytes of [
    Buffer.from('{"lockfileVersion":1,"capabilities":{},"capabilities":{"x":{}}}'),
    Buffer.from([0xff]),
  ]) assert.throws(() => decodeLegacyLockBytes(bytes, options("literal-evidence")), { code: "invalid-lock" });
  const valid = Buffer.from('{"lockfileVersion":1,"capabilities":{}}');
  assert.throws(() => decodeLegacyLockBytes(valid, { ...options("literal-evidence"), limits: { maxBytes: 8 } }), { code: "invalid-lock" });
  assert.deepEqual(readdirSync(root), before, "the bytes-only decoder created no files");
});
