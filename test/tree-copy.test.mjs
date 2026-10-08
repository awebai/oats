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
import { copyTreeSafe, entriesAsBytes } from "../lib/tree-copy.mjs";
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

/** Whether the file system under `dir` stores a name that is not valid UTF-8. Where it does not (APFS)
 *  the test is skipped with the reason; on Linux that is a failure. */
function namesAsBytesKept(t, dir) {
  const probe = Buffer.concat([Buffer.from(join(dir, "probe-caf")), Buffer.from([0xe9])]);
  try { writeFileSync(probe, ""); rmSync(probe); return true; }
  catch (e) {
    const reason = `the file system refuses a name that is not valid UTF-8 (${e.code}), as APFS does`;
    assert.notEqual(process.platform, "linux", `this test is not skipped on Linux: ${reason}`);
    t.skip(reason);
    return false;
  }
}

test("copyTreeSafe carries names that are not valid UTF-8 byte for byte, given its paths as strings or as Buffers, in the order of the names' bytes", (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-tree-copy-bytes-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  if (!namesAsBytesKept(t, base)) return;
  const name = (text, ...bytes) => Buffer.concat([Buffer.from(text), Buffer.from(bytes)]);
  const at = (...parts) => Buffer.concat(parts.flatMap((part, i) => (i ? [Buffer.from("/"), part] : [part])));
  const src = Buffer.from(join(base, "src"));
  mkdirSync(at(src, name("dir-", 0xe9)), { recursive: true });
  writeFileSync(at(src, name("dir-", 0xe9), name("caf", 0xe9)), "inner\n");
  writeFileSync(at(src, name("caf", 0xe8)), "e8\n");
  writeFileSync(at(src, name("caf", 0xe9)), "e9\n");
  symlinkSync(name("caf", 0xe9), at(src, name("link-", 0x80)));
  const hexNames = (dir) => readdirSync(dir, { encoding: "buffer" }).map((n) => n.toString("hex")).sort();
  for (const [what, from, to] of [["strings", join(base, "src"), join(base, "copy-text")], ["Buffers", src, Buffer.from(join(base, "copy-bytes"))]]) {
    copyTreeSafe(from, to);
    assert.deepEqual(hexNames(to), hexNames(src), `${what}: every top-level name, byte for byte`);
    assert.equal(readFileSync(at(Buffer.from(to), name("caf", 0xe9)), "utf8"), "e9\n", `${what}: a file is opened by its own name`);
    assert.equal(readFileSync(at(Buffer.from(to), name("caf", 0xe8)), "utf8"), "e8\n", `${what}: two names that read alike as text stay two files`);
    assert.equal(readFileSync(at(Buffer.from(to), name("dir-", 0xe9), name("caf", 0xe9)), "utf8"), "inner\n", `${what}: a directory whose name is not UTF-8 is walked`);
    assert.equal(readlinkSync(at(Buffer.from(to), name("link-", 0x80)), "buffer").toString("hex"), name("caf", 0xe9).toString("hex"), `${what}: a link named with such a byte keeps its target`);
    assert.equal(core.exactTreeDigest(to.toString()), core.exactTreeDigest(join(base, "src")), `${what}: the copy digests like its source`);
  }
  // The order copyTreeSafe walks a directory in (entriesAsBytes): the names' bytes, compared as bytes.
  const listed = join(base, "listed");
  mkdirSync(listed);
  const names = [name("b"), name("caf", 0xe9), name("a"), name("caf", 0xe8), name("B")];
  for (const n of names) writeFileSync(at(Buffer.from(listed), n), "");
  assert.deepEqual(entriesAsBytes(listed).map((e) => e.name.toString("hex")), [name("B"), name("a"), name("b"), name("caf", 0xe8), name("caf", 0xe9)].map((n) => n.toString("hex")), "entries in the order of their bytes (Buffer.compare)");
});
