// The CLI keeps Node's compile cache in $OATS_HOME_DIR/compile-cache (awebai/oats#1630,
// lib/compile-cache.mjs): made 0700 there by default; the caller's NODE_COMPILE_CACHE or
// NODE_DISABLE_COMPILE_CACHE wins and nothing is written under OATS_HOME_DIR; and a cache that
// cannot be made changes nothing a command answers. That no hook inherits a NODE_COMPILE_CACHE
// is test/operation.test.mjs's, with the rest of a provider command's environment.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "compile-cache-")));
  t.after(() => { chmodTree(base); rmSync(base, { recursive: true, force: true }); });
  mkdirSync(join(base, "tmp"));
  return base;
}
function chmodTree(dir) {
  try { chmodSync(dir, 0o700); } catch { return; }
  for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) chmodTree(join(dir, e.name));
}
/** The CLI run outside any deployment or home, with only the environment named here. */
function oats(base, argv, extra) {
  const env = { ...process.env, TMPDIR: join(base, "tmp"), ...extra };
  for (const k of ["NODE_COMPILE_CACHE", "NODE_DISABLE_COMPILE_CACHE", "OATS_INSTANCE", "OATS_INSTANCE_HOME", "OATS_HOME", "PI_AGENT_INSTANCE", "PI_AGENT_HOME"]) if (!(k in (extra ?? {}))) delete env[k];
  const r = spawnSync(process.execPath, [CLI, ...argv], { cwd: base, env, encoding: "utf8", timeout: 60000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const files = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());

test("by default the cache is $OATS_HOME_DIR/compile-cache, a 0700 directory the command fills", (t) => {
  const base = fixture(t);
  const home = join(base, "oats-home");
  const r = oats(base, ["version", "--json"], { OATS_HOME_DIR: home });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  const cache = join(home, "compile-cache");
  assert.ok(statSync(cache).isDirectory());
  assert.equal(statSync(cache).mode & 0o777, 0o700, "the directory is the user's own");
  assert.equal(statSync(home).mode & 0o777, 0o700, "as is the OATS_HOME_DIR it made");
  assert.ok(files(cache).length > 0, "Node wrote the cache at exit");
  assert.deepEqual(readdirSync(join(base, "tmp")), [], "nothing in the shared temporary directory");
});

test("the caller's NODE_COMPILE_CACHE wins: the cache lands there, nothing under OATS_HOME_DIR", (t) => {
  const base = fixture(t);
  const home = join(base, "oats-home"), theirs = join(base, "theirs");
  const r = oats(base, ["version", "--json"], { OATS_HOME_DIR: home, NODE_COMPILE_CACHE: theirs });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
  assert.ok(files(theirs).length > 0);
  assert.equal(existsSync(join(home, "compile-cache")), false);
});

test("NODE_DISABLE_COMPILE_CACHE wins: no cache is written anywhere, even when it is empty", (t) => {
  for (const value of ["1", ""]) {
    const base = fixture(t);
    const home = join(base, "oats-home");
    const r = oats(base, ["version", "--json"], { OATS_HOME_DIR: home, NODE_DISABLE_COMPILE_CACHE: value });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(existsSync(join(home, "compile-cache")), false, JSON.stringify(value));
    assert.deepEqual(readdirSync(join(base, "tmp")), [], "nor Node's default place");
  }
});

test("a cache that cannot be made answers exactly what a writable one does, for a --json success and a --json failure", (t) => {
  const base = fixture(t);
  const writable = join(base, "writable");
  const fileHome = join(base, "a-file"); writeFileSync(fileHome, "");
  const cacheFile = join(base, "cache-is-a-file"); mkdirSync(cacheFile); writeFileSync(join(cacheFile, "compile-cache"), "");
  const unwritable = [fileHome, join(fileHome, "below"), cacheFile];
  // Permissions bind no root: there a read-only directory is writable all the same.
  if (process.getuid?.() !== 0) {
    const readOnly = join(base, "read-only"); mkdirSync(readOnly); chmodSync(readOnly, 0o500);
    const readOnlyCache = join(base, "read-only-cache"); mkdirSync(join(readOnlyCache, "compile-cache"), { recursive: true }); chmodSync(join(readOnlyCache, "compile-cache"), 0o500);
    unwritable.push(readOnly, join(readOnly, "below"), readOnlyCache);
  }
  for (const argv of [["version", "--json"], ["no-such-command", "--json"]]) {
    const expected = oats(base, argv, { OATS_HOME_DIR: writable });
    assert.ok(files(join(writable, "compile-cache")).length > 0);
    for (const home of unwritable) assert.deepEqual(oats(base, argv, { OATS_HOME_DIR: home }), expected, `${argv.join(" ")} with OATS_HOME_DIR=${home}`);
  }
  assert.equal(oats(base, ["no-such-command", "--json"], { OATS_HOME_DIR: writable }).status, 1, "the failure is one");
});
