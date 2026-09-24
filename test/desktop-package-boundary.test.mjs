// Desktop package boundary for workspace model v2 (Phase F §3b exit checks).
//   1. No shipped Desktop source imports the checkout kernel or accepts a
//      framework-root override (the packaged app has no bundled kernel).
//   2. The retired 0.24 deployment reader, roster model and catalog DTO are
//      gone, and no Desktop file names a legacy local-soul directory or the
//      removed catalog verb (docs/CHANGELOG lines excepted).
//   3. No shipped source reads a deployment file: the kernel's JSON is the
//      deployment model. Filesystem names may appear only in comments.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = join(ROOT, "packages", "desktop");

function files({ tests = false, docs = false } = {}) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(join(PKG, d), { withFileTypes: true })) {
      if (["node_modules", "vendor", "dist"].includes(e.name) || (!tests && e.name === "test") || (!docs && e.name === "docs")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|cjs|js|html|css|json|md)$/.test(e.name) && e.name !== "package-lock.json" && (docs || !/^(CHANGELOG|README)/.test(e.name))) out.push(p);
    }
  };
  walk(".");
  return out.map((f) => [f, readFileSync(join(PKG, f), "utf8")]);
}
/** Source text with // and block comments removed (code only). */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

test("no shipped desktop source imports the checkout kernel or accepts a framework-root override", () => {
  for (const [f, src] of files().filter(([f]) => /\.(mjs|cjs)$/.test(f))) {
    assert.ok(!src.includes("lib/core.mjs"), `${f}: references the checkout kernel`);
    assert.ok(!src.includes("OATS_DESKTOP_FRAMEWORK_ROOT"), `${f}: accepts the framework-root env override`);
    assert.ok(!/FRAMEWORK_ROOT|REPO_ROOT/.test(src), `${f}: infers a repo/framework root`);
  }
});

test("the 0.24 deployment reader, roster model and catalog DTO are deleted, not wrapped", () => {
  for (const retired of ["server/deployment.mjs", "server/model.mjs", "server/catalog.mjs", "renderer/official-catalog.mjs"]) {
    assert.equal(existsSync(join(PKG, retired)), false, retired);
  }
  for (const [f, src] of files({ tests: true }).filter(([f]) => /\.(mjs|cjs)$/.test(f))) {
    assert.doesNotMatch(src, /server\/(deployment|model|catalog)\.mjs|official-catalog\.mjs/, `${f}: imports a retired module`);
  }
});

test("exit check: no Desktop file names legacy local-soul directories or the removed catalog verb", () => {
  const hits = [];
  for (const [f, src] of files({ tests: true })) {
    src.split("\n").forEach((line, i) => { if (/local-agents|tmp-agents|oats catalog/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(hits, []);
});

test("no shipped source reads a deployment file; the v2 deployment is detected by existence only", () => {
  const reads = /\b(readFileSync|readFile|createReadStream|openSync)\s*\([^)]*(oats-config\.yaml|oats-local\.yaml|oats-workspace\.yaml|oats-membership\.yaml|oats-lock\.json|soul\.yaml|oats\.json|package-catalog\.json)/;
  for (const [f, src] of files().filter(([f]) => /\.(mjs|cjs)$/.test(f))) {
    const body = code(src);
    assert.doesNotMatch(body, reads, `${f}: reads a deployment file`);
    assert.doesNotMatch(body, /["'`](oats-config\.yaml|oats-lock\.json|soul\.yaml|oats-workspace\.yaml|oats-membership\.yaml)["'`]/, `${f}: names a deployment file in code`);
    assert.doesNotMatch(body, /\.agents\/capabilities|capabilities\/installed/, `${f}: names an installed-capability store`);
  }
  // The single permitted deployment-file reference is main's lstat existence
  // check for the directory that holds oats-local.yaml (F2's detection rule).
  const main = code(readFileSync(join(PKG, "main.mjs"), "utf8"));
  assert.match(main, /lstatSync\(join\(path, "oats-local\.yaml"\)\)\.isFile\(\)/);
});
