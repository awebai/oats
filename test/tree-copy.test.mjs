// copyTreeSafe: the kernel's catchable recursive copy (spawn, retire and work
// recovery use it). The artifact publication and digest it once served were
// the captured path's, removed in 0.26.
import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as core from "../lib/core.mjs";
import { copyTreeSafe } from "../lib/tree-copy.mjs";
import { oatsError } from "../lib/errors.mjs";

const write = (file, bytes) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); };
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-tree-copy-")));
  t.after(() => {
    // Some cases deliberately copy read-only directories. Restore ONLY fixture
    // directory permissions for cleanup, without following links.
    const writable = (dir) => {
      chmodSync(dir, 0o700);
      for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) writable(join(dir, e.name));
    };
    writable(base);
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}
function vector(root) {
  // Deliberately created out of order; includes former exclusion candidates.
  const files = {
    "z.txt": "last\n",
    "nested/run.mjs": 'console.log("artifact");\n',
    "a.bin": Buffer.from([0, 1, 255, 128, 10, 13, 0]),
    "node_modules/vendor/index.mjs": "export default 42;\n",
    ".git/HEAD": "payload, not excluded\n",
    "oats-lock.json": '{"payload":true}\n',
    ".oats-installation.json": '{"schemaVersion":1}\n',
  };
  for (const [path, bytes] of Object.entries(files)) write(join(root, path), bytes);
  mkdirSync(join(root, "empty"));
  symlinkSync("./nested/run.mjs", join(root, "current.mjs"));
  symlinkSync("nested", join(root, "linked-dir"));
  symlinkSync("../a.bin", join(root, "nested/binary-link"));
  chmodSync(join(root, "nested/run.mjs"), 0o751);
  chmodSync(join(root, "a.bin"), 0o640);
  chmodSync(join(root, "empty"), 0o710);
  chmodSync(join(root, "nested"), 0o550);
  chmodSync(root, 0o750);
}
function snapshot(root) {
  const entries = [];
  const walk = (path, name) => {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) entries.push([name, "symlink", readlinkSync(path)]);
    else if (st.isFile()) entries.push([name, "file", st.mode & 0o7777, readFileSync(path).toString("hex")]);
    else {
      entries.push([name, "directory", st.mode & 0o7777]);
      for (const e of readdirSync(path).sort()) walk(join(path, e), `${name}/${e}`);
    }
  };
  walk(root, ".");
  return entries;
}

test("core re-exports the exact helpers, not wrappers", () => {
  assert.equal(core.copyTreeSafe, copyTreeSafe);
  assert.equal(core.oatsError, oatsError);
  const details = [{ file: "lock.json", violation: "source" }];
  const error = oatsError("invalid-lock", "original diagnostic", details);
  assert.equal(error.message, "original diagnostic");
  assert.equal(error.code, "invalid-lock");
  assert.equal(error.provenance, details);
  assert.equal(Object.hasOwn(oatsError("test", "no provenance"), "provenance"), false);
});

test("copy preserves bytes, directory/file modes and verbatim symlinks under a restrictive umask", (t) => {
  const base = fixture(t), source = join(base, "source"), copied = join(base, "copy");
  vector(source);
  const before = snapshot(source);
  const mask = process.umask(0o077);
  try { copyTreeSafe(source, copied); }
  finally { process.umask(mask); }
  assert.deepEqual(snapshot(copied), before);
  assert.deepEqual(snapshot(source), before, "copying does not mutate the source");
});

test("mechanical copy preserves even broken/external links; containment is the caller's policy", (t) => {
  const base = fixture(t), source = join(base, "source"), copy = join(base, "copy");
  mkdirSync(source);
  const external = join(base, "external");
  writeFileSync(external, "must not copy or follow\n");
  symlinkSync(external, join(source, "absolute"));
  symlinkSync("missing", join(source, "broken"));
  copyTreeSafe(source, copy);
  assert.deepEqual(snapshot(copy), snapshot(source));
  assert.deepEqual(readdirSync(copy).sort(), ["absolute", "broken"]);
});

test("copyTreeSafe: verbatim symlinks, deterministic order, modes after children, fail-closed on special files", (ctx) => {
  const t = fixture(ctx);
  const src = join(t, "src");
  write(join(src, "b.txt"), "b\n");
  write(join(src, "a/inner.txt"), "inner\n");
  symlinkSync("./b.txt", join(src, "link"));
  chmodSync(join(src, "a"), 0o500); // read-only directory: children must still copy
  const dest = join(t, "dest");
  copyTreeSafe(src, dest);
  assert.equal(readFileSync(join(dest, "a/inner.txt"), "utf8"), "inner\n");
  assert.equal(lstatSync(join(dest, "link")).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(dest, "link")), "./b.txt", "link target is verbatim, never rewritten");
  assert.equal(lstatSync(join(dest, "a")).mode & 0o777, 0o500, "directory mode is applied after its children");
  chmodSync(join(dest, "a"), 0o700);
  // A FIFO is not distributable content.
  const fifoDir = join(t, "fifo");
  mkdirSync(fifoDir, { recursive: true });
  const mk = spawnSync("mkfifo", [join(fifoDir, "pipe")]);
  if (mk.status === 0) assert.throws(() => copyTreeSafe(fifoDir, join(t, "fifo-dest")), { code: "invalid-source" }, "FIFO");
});
