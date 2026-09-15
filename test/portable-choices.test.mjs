import test from "node:test";
import assert from "node:assert/strict";
import { resolveChoices } from "../lib/portable-choices.mjs";

const origin = (name) => ({ document: { kind: "fixture", id: name }, pointer: "/choice" });
const key = "/layers/tasks";
const a = { capability: "example.tasks", source: "source-A" };
const b = { capability: "example.other", source: "source-B" };

test("a hard source selection wins over an incompatible workspace fallback; explicit conflicting override fails", () => {
  const requirement = { key, kind: "equals", value: a, origin: origin("soul") };
  const fallback = { key, kind: "workspace-default", value: b, origin: origin("workspace") };
  const plan = resolveChoices({ requirements: [requirement], candidates: [fallback] });
  assert.equal(plan.status, "resolved");
  assert.deepEqual(plan.choices[key].value, a);
  assert.deepEqual(plan.choices[key].selectedBy, requirement.origin);
  assert.equal(plan.choices[key].considered[0].disposition, "overridden");
  for (const kind of ["import-adoption", "operator"]) {
    const override = { ...fallback, kind, origin: origin(kind) };
    const denied = resolveChoices({ requirements: [requirement], candidates: [override] });
    assert.equal(denied.status, "conflict");
    assert.deepEqual(denied.problems[0].origins, [requirement.origin, override.origin]);
  }
});

test("one resolver applies fallback precedence and bounded compatible choices without mutating inputs", () => {
  const candidates = ["operator", "workspace-default", "import-adoption", "soul-default"].map((kind) => ({
    key: "/settings/example/target", kind, value: kind, origin: origin(kind),
  }));
  const before = JSON.stringify(candidates);
  const plan = resolveChoices({ candidates });
  assert.equal(plan.status, "resolved");
  assert.equal(plan.choices["/settings/example/target"].value, "operator");
  assert.equal(plan.choices["/settings/example/target"].considered.filter((item) => item.disposition === "selected").length, 1);
  assert.equal(JSON.stringify(candidates), before);
  assert.deepEqual(resolveChoices({ candidates: [...candidates].reverse() }), plan);
});

test("required presence invents no provider and distinguishes missing binding from meaningful false/empty data", () => {
  const required = { key, kind: "required", origin: origin("soul") };
  const missing = resolveChoices({ requirements: [required], candidates: [{ key, kind: "workspace-default", value: null, origin: origin("workspace") }] });
  assert.equal(missing.status, "needs-configuration");
  assert.equal(missing.choices[key].value, null);
  assert.equal(missing.problems[0].code, "needs-configuration");
  for (const value of [false, [], 0]) {
    const dataKey = "/bindings/example/value";
    assert.equal(resolveChoices({ requirements: [{ ...required, key: dataKey }], candidates: [{ key: dataKey, kind: "operator", value, origin: origin("operator") }] }).status, "resolved");
  }
});

test("conflicting requirements/equal authority retain both origins; arbitrary policy expressions are not supported", () => {
  const requirements = [a, b].map((value, index) => ({ key, kind: "equals", value, origin: origin(`requirement-${index}`) }));
  const hard = resolveChoices({ requirements });
  assert.equal(hard.status, "conflict");
  assert.deepEqual(hard.problems[0].origins, requirements.map((item) => item.origin));
  const candidates = requirements.map((item) => ({ ...item, kind: "workspace-default" }));
  const conflict = resolveChoices({ candidates });
  assert.equal(conflict.status, "conflict");
  assert.deepEqual(conflict.problems[0].origins, candidates.map((item) => item.origin));
  assert.throws(() => resolveChoices({ requirements: [{ key, kind: "expression", value: "execute()", origin: origin("bad") }] }), { code: "invalid-declaration" });
});
