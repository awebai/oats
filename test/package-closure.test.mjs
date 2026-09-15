import test from "node:test";
import assert from "node:assert/strict";
import { resolvePackageClosure } from "../lib/package-closure.mjs";

function adapters(records) {
  const validated = [], discarded = [];
  return { validated, discarded, options: {
    readPackage: (request) => records[request],
    validatePackage: (record) => validated.push(record.package),
    finalizePackage: (record, deps) => ({ ...record, deps }),
    discardPackage: (record) => discarded.push(record.dir),
  } };
}
const record = (id, dependencies = []) => ({ package: id, sourceKey: `source:${id}`, dir: `staged:${id}`, dependencyRequests: dependencies });

test("shared closure walks dependency-first once per identity and never discards a reused authoritative root", () => {
  const fixture = adapters({ a: record("a", ["c"]), b: record("b", ["c"]), c: record("c") });
  const result = resolvePackageClosure({ requests: ["a", "b"], ...fixture.options, maxPackages: 3 });
  assert.deepEqual(result.roots, ["a", "b"]);
  assert.deepEqual([...result.packages.keys()], ["c", "a", "b"]);
  assert.deepEqual(fixture.validated, ["a", "c", "b"]);
  assert.deepEqual(fixture.discarded, []);
  assert.deepEqual(result.packages.get("b").deps, ["c"]);
});

test("cycles, conflicting package provenance and bounded graph exhaustion refuse before installation", () => {
  const cycle = adapters({ a: record("a", ["b"]), b: record("b", ["a"]) });
  assert.throws(() => resolvePackageClosure({ requests: ["a"], ...cycle.options }), { code: "dependency-cycle" });
  const collision = adapters({ a: record("same"), b: { ...record("same"), sourceKey: "other-source", dir: "other-stage" } });
  assert.throws(() => resolvePackageClosure({ requests: ["a", "b"], ...collision.options }), (error) => {
    assert.equal(error.code, "duplicate-package-identity");
    assert.deepEqual(error.provenance, ["source:same", "other-source"]); return true;
  });
  const bounded = adapters({ a: record("a", ["b"]), b: record("b") });
  assert.throws(() => resolvePackageClosure({ requests: ["a"], ...bounded.options, maxPackages: 1 }), { code: "resource-limit" });
});
