// `oats status` reports each instance at the directory the kernel ENUMERATED
// (<soul dir>/instances/<name>), never at a location instance.json claims.
// Found by the Desktop engineer in F1 (2026-09-24): listInstances spread the
// file's contents last, so a hostile or corrupted instance.json could make the
// roster report a home outside the deployment — and every consumer that acts
// on `home` (retire, inspect --home, the Desktop's file roots) inherits it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listInstances } from "../lib/core.mjs";

function layout() {
  const root = join(realpathSync(mkdtempSync(join(tmpdir(), "oats-home-"))), "agents");
  const instances = join(root, "worker", "instances");
  mkdirSync(join(root, "worker", "soul"), { recursive: true });
  writeFileSync(join(root, "worker", "soul", "soul.yaml"), "name: worker\n");
  return { root, instances };
}
const rowsOf = (root) => listInstances(root, `none-${process.pid}`).find((a) => a.name === "worker")?.instances || [];

test("a hostile instance.json cannot relocate the reported home or rename the instance", () => {
  const { root, instances } = layout();
  const dir = join(instances, "worker-1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "instance.json"), JSON.stringify({ agent: "worker", instance: "someone-else", home: "/elsewhere/victim-home", work: "directory" }));
  const [row] = rowsOf(root);
  assert.equal(row.home, dir, "home is the enumerated directory");
  assert.equal(row.instance, "worker-1", "instance is the enumerated directory name");
  assert.equal(row.recordedHome, "/elsewhere/victim-home", "the file's claim is kept only as a diagnostic");
  assert.equal(row.recordedInstance, "someone-else");
});

test("a consistent instance.json reports exactly as before (no diagnostic keys)", () => {
  const { root, instances } = layout();
  const dir = join(instances, "worker-2");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "instance.json"), JSON.stringify({ agent: "worker", instance: "worker-2", home: dir, work: "directory", harness: "pi" }));
  const [row] = rowsOf(root);
  assert.equal(row.home, dir); assert.equal(row.instance, "worker-2"); assert.equal(row.harness, "pi");
  assert.equal(Object.hasOwn(row, "recordedHome"), false); assert.equal(Object.hasOwn(row, "recordedInstance"), false);
});
