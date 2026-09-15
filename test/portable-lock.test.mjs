import test from "node:test";
import assert from "node:assert/strict";
import { validateWire } from "./helpers/portable-schema-check.mjs";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../lib/portable-values.mjs";
import { TREE_FORMAT, PACKAGE_FORMAT } from "../lib/portable-digest.mjs";
import { artifactSetKey3, emptyLock3, readLock3, requestKey3, validateLock3, writeLock3 } from "../lib/portable-lock.mjs";
import { withPortableStateWrite, writeGuardedPortableDocument } from "../lib/portable-state.mjs";

const request = { source: "git:https://github.com/example/tools.git@main", path: "oats-package" };
const integrity = (format, letter) => ({ format, value: `sha256-${letter.repeat(64)}` });
// Wire/CAS fixtures, not proof these synthetic artifact hashes exist or are approved.
function fixtureLock() {
  const set = (letter) => ({ schemaVersion: 1,
    packages: { "example.tools": { ...request, version: "1.0.0", commit: letter.repeat(40), integrity: integrity(PACKAGE_FORMAT, letter), dependencies: [] } },
    capabilities: { "example.action": { version: "1.0.0", artifact: { kind: "capability", capability: "example.action", integrity: integrity(TREE_FORMAT, letter) },
      origin: { kind: "package", package: "example.tools", path: "action", projectionVersion: 1 } } } });
  const a = set("a"), b = set("b"), A = artifactSetKey3(a), B = artifactSetKey3(b), key = requestKey3(request);
  return { lock: { lockfileVersion: 3, artifactSets: { [A]: a, [B]: b }, selections: { [key]: { request,
    current: A, available: B, freshness: { state: "refreshed", observedAt: "2026-09-15T00:00:00.000Z", problems: [] } } } }, A, B, key };
}
function scope(t) { const root = mkdtempSync(join(tmpdir(), "oats-lock3-")); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }

test("source-request lock keeps A current and B available without claiming latest or trust", () => {
  const { lock, A, B, key } = fixtureLock();
  validateWire("Lock3", lock);
  validateLock3(lock);
  lock.selections[key].freshness = { state: "failed", observedAt: "2026-09-15T00:00:00.000Z", problems: [{ code: "offline", message: "Refresh unavailable", origins: [] }] };
  validateLock3(lock);
  assert.equal(lock.selections[key].current, A); assert.equal(lock.selections[key].available, B);
  lock.selections[key].trusted = true;
  assert.throws(() => validateLock3(lock), { code: "invalid-lock" });
});

test("canonical keys and requested root correlation reject unrelated otherwise-valid sets", () => {
  const { lock, A, key } = fixtureLock();
  const unrelated = structuredClone(lock.artifactSets[A]);
  unrelated.packages["example.tools"].source = "git:https://github.com/example/other.git@main";
  const otherKey = artifactSetKey3(unrelated); lock.artifactSets[otherKey] = unrelated;
  lock.selections[key].available = otherKey;
  assert.throws(() => validateLock3(lock), { code: "invalid-lock" });
  const bad = fixtureLock().lock;
  bad.artifactSets[A].packages["example.tools"].version = "changed";
  assert.throws(() => validateLock3(bad), { code: "invalid-lock" });
});

test("whole-snapshot CAS refuses stale writers, held guards, legacy and symlinked locks without repair", (t) => {
  const root = scope(t), first = fixtureLock().lock;
  assert.deepEqual(readLock3(root), { lock: null, integrity: null });
  const written = writeLock3(root, null, first);
  assert.equal(canonicalJson(readLock3(root).lock), canonicalJson(first));
  assert.throws(() => writeLock3(root, null, emptyLock3()), { code: "selection-changed" });
  let closedContext;
  withPortableStateWrite(root, (context) => {
    closedContext = context;
    assert.throws(() => writeLock3(root, written.integrity, emptyLock3()), { code: "selection-changed" });
  });
  assert.throws(() => writeGuardedPortableDocument(closedContext, join(root, "oats-lock.json"), emptyLock3()), { code: "selection-changed" });
  assert.equal(writeLock3(root, written.integrity, first).status, "kept");
  const next = writeLock3(root, written.integrity, emptyLock3());
  assert.equal(next.status, "written");
  assert.throws(() => writeLock3(root, written.integrity, first), { code: "selection-changed" });
  const legacy = '{"lockfileVersion":1,"capabilities":{}}\n';
  writeFileSync(join(root, "oats-lock.json"), legacy);
  assert.throws(() => writeLock3(root, null, first), { code: "migration-required" });
  assert.equal(readFileSync(join(root, "oats-lock.json"), "utf8"), legacy);
  rmSync(join(root, "oats-lock.json"));
  writeFileSync(join(root, "other.json"), canonicalJson(first)); symlinkSync("other.json", join(root, "oats-lock.json"));
  assert.throws(() => readLock3(root), { code: "invalid-lock" });
});

test("two independent new writers cannot both commit an absent-lock snapshot", async (t) => {
  const root = scope(t), module = new URL("../lib/portable-lock.mjs", import.meta.url).href;
  const code = `import {emptyLock3,writeLock3} from ${JSON.stringify(module)}; try {writeLock3(process.argv[1],null,emptyLock3()); process.stdout.write('written');} catch(e) {process.stdout.write(e.code ?? 'unexpected');}`;
  const writer = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, root], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; child.stdout.on("data", (part) => { out += part; }); child.stderr.on("data", (part) => { err += part; });
    child.on("error", reject); child.on("close", (exit) => exit === 0 ? resolve(out) : reject(new Error(err)));
  });
  assert.deepEqual((await Promise.all([writer(), writer()])).sort(), ["selection-changed", "written"]);
  assert.equal(canonicalJson(readLock3(root).lock), canonicalJson(emptyLock3()));
});
