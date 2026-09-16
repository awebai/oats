import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCapturedOperationProcess } from "../lib/captured-operation-process.mjs";

test("captured operation timeout uses non-ignorable termination", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "oats-captured-operation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "ignore-term.mjs");
  writeFileSync(file, "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);\n");
  const result = runCapturedOperationProcess({ file, cwd: directory, env: { PATH: process.env.PATH }, timeoutMs: 150 });
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.equal(result.signal, "SIGKILL");
  assert.equal(result.status, null);
});

test("captured operation timeout override remains bounded", () => {
  for (const timeoutMs of [0, 4 * 60 * 1000 + 1, Infinity]) {
    assert.throws(() => runCapturedOperationProcess({ file: "/unused", timeoutMs }), { code: "invalid-declaration" });
  }
});
