import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCapturedSourceReceipt, withCapturedSourceReceiptFile } from "../lib/captured-source-receipt-file.mjs";

const RID = `sha256-${"a".repeat(64)}`;
const origin = { kind: "operator", document: { kind: "operator", id: "receipt-fixture" }, pointer: "/binding" };

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oats-source-receipt-"))), deployment = join(root, "deployment"), home = join(root, "home"), work = join(home, "work");
  mkdirSync(deployment); mkdirSync(work, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const receipt = {
    schemaVersion: 1, kind: "persistent", home, work, context: deployment,
    agent: "expert", instance: "expert-1",
    sourceIdentity: { kind: "local-soul", source: `path:${join(root, "source")}`, exportPath: "." },
    role: "Retained role\n", executionBinding: { schemaVersion: 1, deployment, resolution: { schemaVersion: 1, id: RID } },
    responsibleHuman: null,
    binding: { schemaVersion: 1, capability: "example.knowledge", payloadContract: "example.locations", payloadVersion: 1,
      payload: { store: "captured" }, credentialRefs: {}, provenance: [origin] },
  };
  return { root, deployment, home, receipt };
}

test("captured source receipt is a private synchronous snapshot with owned cleanup", (t) => {
  const f = fixture(t); let path;
  const value = withCapturedSourceReceiptFile(f.home, f.receipt, (env) => {
    path = env.OATS_SOURCE_RECEIPT_FILE;
    assert.equal(statSync(path).mode & 0o777, 0o400);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), f.receipt);
    assert.equal(path.startsWith(f.home), false, "snapshot is not durable home state");
    return "registered";
  });
  assert.equal(value, "registered"); assert.equal(existsSync(path), false);
  let failedPath;
  assert.throws(() => withCapturedSourceReceiptFile(f.home, f.receipt, (env) => { failedPath = env.OATS_SOURCE_RECEIPT_FILE; throw new Error("fixture failure"); }), /fixture failure/);
  assert.equal(existsSync(failedPath), false);
});

test("captured source receipt validates identity, binding and exact invocation home", (t) => {
  const f = fixture(t);
  assert.equal(validateCapturedSourceReceipt(f.receipt), f.receipt);
  assert.throws(() => withCapturedSourceReceiptFile(join(f.root, "other"), f.receipt, () => {}), { code: "invalid-declaration" });
  assert.throws(() => validateCapturedSourceReceipt({ ...f.receipt, context: join(f.root, "other") }), { code: "invalid-declaration" });
  assert.throws(() => validateCapturedSourceReceipt({ ...f.receipt, kind: "helper" }), { code: "invalid-declaration" });
  assert.throws(() => validateCapturedSourceReceipt({ ...f.receipt, sourceIdentity: null }), { code: "invalid-declaration" });
  assert.doesNotThrow(() => validateCapturedSourceReceipt({ ...f.receipt, kind: "helper", sourceIdentity: null }));
  assert.throws(() => validateCapturedSourceReceipt({ ...f.receipt, responsibleHuman: { provider: "example.messaging" } }), { code: "invalid-declaration" });
  assert.throws(() => validateCapturedSourceReceipt({ ...f.receipt, role: "x".repeat(128 * 1024 + 1) }), { code: "invalid-declaration" });
});
