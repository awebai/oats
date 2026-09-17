import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../lib/portable-values.mjs";
import { capturedSelector } from "../lib/captured-selector.mjs";
import { readPortablePreparationRequest } from "../lib/portable-onboarding-request.mjs";

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oats-onboarding-request-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, file: join(root, "prepare.json") };
}

test("request transport preserves exact JSON choices/null/unknown fields without preparation or defaults", t => {
  const { root, file } = fixture(t);
  const request = { deployment: join(root, "fresh"), source: { source: "git:https://example.invalid/soul.git", revision: "pinned", soul: "agents/expert", alias: "expert" },
    standaloneContextKey: null, allowLocalPaths: false, mode: "directory",
    operator: { policy: {}, document: { kind: "operator", id: "fixture" }, bindings: { destination: "chosen", flag: false, list: [] } },
    futureField: { mustNotDisappear: true } };
  const bytes = Buffer.from(JSON.stringify(request, null, 2) + "\n"); writeFileSync(file, bytes);
  const before = readdirSync(root), input = readPortablePreparationRequest({ file });
  assert.equal(canonicalJson(input), canonicalJson(request));
  assert.equal(Object.hasOwn(input, "standaloneContextKey"), true); assert.equal(input.standaloneContextKey, null);
  assert.equal(Object.hasOwn(input, "origin"), false, "transport does not invent provenance/defaults");
  assert.equal(input.futureField.mustNotDisappear, true, "unknown fields reach public core for refusal, not filtering");
  assert.equal(Object.isFrozen(input), true); assert.equal(Object.isFrozen(input.operator.bindings), true);
  assert.deepEqual(readFileSync(file), bytes); assert.deepEqual(readdirSync(root), before);
});

test("request transport refuses conflicting parsed inputs/selectors before file access and ignores ambient capture", t => {
  const { root, file } = fixture(t);
  for (const inputFlags of [{ dir: root }, { source: null }, { workspace: false }, { work: "" }]) {
    assert.throws(() => readPortablePreparationRequest({ file, inputFlags }),
      error => error.code === "E_BAD_ARGS" && /combined/.test(error.message));
  }
  const selector = capturedSelector(["--deployment", root, "--resolution", `sha256-${"a".repeat(64)}`, "prepare"], {});
  assert.throws(() => readPortablePreparationRequest({ file, explicitSelector: selector }),
    error => error.code === "E_BAD_ARGS" && /captured selectors/.test(error.message));
  const inherited = { OATS_DEPLOYMENT: process.env.OATS_DEPLOYMENT, OATS_RESOLUTION: process.env.OATS_RESOLUTION };
  t.after(() => { for (const [key, value] of Object.entries(inherited)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  process.env.OATS_DEPLOYMENT = "/old/unrelated"; process.env.OATS_RESOLUTION = "deliberately-invalid-old-binding";
  writeFileSync(file, JSON.stringify({ deployment: root, source: "explicit-alias" }));
  const input = readPortablePreparationRequest({ file, explicitSelector: capturedSelector(["prepare"], {}) });
  assert.equal(input.deployment, root); assert.equal(Object.hasOwn(input, "resolution"), false);
  assert.equal(Object.hasOwn(input, "standaloneContextKey"), false, "omission remains omission even under old ambient authority");
});

test("request bytes are bounded strict JSON with no-follow reads and sanitized errors", t => {
  const { root, file } = fixture(t);
  const invalidBytes = [Buffer.from('{"source":"FAKE_TOKEN_DO_NOT_ECHO","source":"duplicate"}'), Buffer.from([0xff]), Buffer.from('{"broken":"FAKE_TOKEN_DO_NOT_ECHO"')];
  for (const bytes of invalidBytes) {
    writeFileSync(file, bytes);
    assert.throws(() => readPortablePreparationRequest({ file }),
      error => error.code === "invalid-declaration" && !error.message.includes("FAKE_TOKEN"));
    assert.deepEqual(readFileSync(file), bytes);
  }
  truncateSync(file, 8 * 1024 * 1024 + 1);
  assert.throws(() => readPortablePreparationRequest({ file }), { code: "resource-limit" });
  const target = join(root, "valid.json"); writeFileSync(target, '{"source":"explicit-alias"}');
  rmSync(file); symlinkSync(target, file);
  assert.throws(() => readPortablePreparationRequest({ file }), { code: "E_BAD_ARGS" });
  assert.equal(readFileSync(target, "utf8"), '{"source":"explicit-alias"}');
  assert.throws(() => readPortablePreparationRequest({ file: "relative.json" }), { code: "E_BAD_ARGS" });
  assert.throws(() => readPortablePreparationRequest({ file, unexpectedOption: true }), { code: "invalid-declaration" });
});
