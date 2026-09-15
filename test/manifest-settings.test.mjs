import test from "node:test";
import assert from "node:assert/strict";
import { captureManifestSettings, manifestSettingDefaults } from "../lib/manifest-settings.mjs";
import { resolveChoices } from "../lib/portable-choices.mjs";
import { settingChoiceKey } from "../lib/soul-constraints.mjs";

const id = "example.action", artifact = { kind: "capability", capability: id, integrity: { format: "oats.tree-exec.v1", value: `sha256-${"a".repeat(64)}` } };
const origin = { kind: "operator", document: { kind: "operator", id: "input" }, pointer: "/settings" };

test("manifest defaults are captured below explicit values with exact artifact/file provenance", () => {
  const candidates = [{ key: settingChoiceKey(id, "nullable"), kind: "operator", value: null, origin }];
  const plan = { ...resolveChoices({ candidates }), requirements: [], candidates, capabilities: { [id]: {} }, settings: { [id]: { nullable: settingChoiceKey(id, "nullable") } } };
  const bytes = Buffer.from(JSON.stringify({ capability: id, version: "1.0.0", settings: {
    nullable: { default: "fallback" }, flag: { default: false }, items: { default: [] }, ["__proto__"]: { default: "data" },
  } }));
  const captured = captureManifestSettings(plan, [{ artifact, bytes }]);
  assert.equal(captured.choices[settingChoiceKey(id, "nullable")].value, null);
  assert.equal(captured.choices[settingChoiceKey(id, "flag")].value, false);
  assert.deepEqual(captured.choices[settingChoiceKey(id, "items")].value, []);
  assert.equal(Object.hasOwn(captured.settings[id], "__proto__"), true);
  const fallback = captured.choices[settingChoiceKey(id, "nullable")].considered.find((entry) => entry.kind === "manifest-default");
  assert.equal(fallback.disposition, "overridden");
  assert.equal(fallback.origin.document.kind, "artifact");
  assert.equal(fallback.origin.document.path, "oats.json");
  assert.equal(fallback.origin.document.integrity.format, "oats.bytes.v1");
});

test("default capture refuses missing or mismatched selected manifests", () => {
  const plan = { ...resolveChoices(), requirements: [], candidates: [], capabilities: { [id]: {} }, settings: {} };
  assert.throws(() => captureManifestSettings(plan, []), { code: "resolution-incomplete" });
  assert.throws(() => manifestSettingDefaults(artifact, Buffer.from('{"capability":"example.other","version":"1.0.0"}')), { code: "invalid-resolution" });
});
