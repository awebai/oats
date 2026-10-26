// A file over 2 GiB in an instance's work (awebai/oats#617): Node refuses to read such a file whole
// (ERR_FS_FILE_TOO_LARGE), so every digest on the retire path reads files in pieces of a fixed size.
// The digests stay what they were for the same bytes: a spawn baseline stores them.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs";
import { appendFileSync, chmodSync, closeSync, ftruncateSync, lstatSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statfsSync, statSync, symlinkSync, truncateSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exactTreeDigest, fingerprintTree, generatedWorkDigest, storedTreeDigest, worktreeBytes, worktreeDigests } from "../lib/core.mjs";
import { FILE_PIECE, readFilePieces } from "../lib/file-pieces.mjs";
import { cli, fixture, fixtureGit, spawn, temporaryDirectories, write } from "./helpers/retire-work-safety-fixture.mjs";

const MIB = 1024 * 1024;
const STATUS_ARGS = ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--ignore-submodules=none"];

// ---- The digests of the same bytes are the ones they were ----
// Each value below was taken from the kernel before #617, which read every file whole with
// readFileSync, over the tree smallTree makes. Its files cross the size of the pieces the digests
// read in on both sides, and one is empty.

/** Bytes that are not all alike: byte i is (i * 31 + 7) mod 251. */
function patterned(length) {
  const bytes = Buffer.alloc(length);
  for (let i = 0; i < length; i++) bytes[i] = (i * 31 + 7) % 251;
  return bytes;
}
function smallTree() {
  const root = mkdtempSync(join(tmpdir(), "oats-file-pieces-"));
  temporaryDirectories.push(root);
  for (const [name, bytes, mode] of [
    ["empty", Buffer.alloc(0), 0o644],
    ["small.txt", Buffer.from("small\n"), 0o600],
    ["one-mib", patterned(MIB), 0o644],
    [join("dir", "just-over"), patterned(MIB + 1), 0o640],
    [join("dir", "several"), patterned(3 * MIB + 12345), 0o755],
    ["instance.json", Buffer.from(JSON.stringify({ instance: "x", spawnCompleted: "2026-01-01T00:00:00Z" })), 0o644],
  ]) {
    write(join(root, name), bytes);
    chmodSync(join(root, name), mode);
  }
  chmodSync(join(root, "dir"), 0o755);
  chmodSync(root, 0o755);
  symlinkSync("small.txt", join(root, "link"));
  // A link has permission bits of its own only where the platform gives it some; there they follow the umask.
  if ((lstatSync(join(root, "link")).mode & 0o7777) !== 0o777) nodeFs.lchmodSync?.(join(root, "link"), 0o777);
  assert.equal(lstatSync(join(root, "link")).mode & 0o7777, 0o777, "fixture premise: the link's permission bits are 0777");
  return root;
}

test("#617 the fixture's files cross the size of the pieces", () => {
  assert.equal(FILE_PIECE, MIB);
});

test("#617 the digests of a tree whose files cross the size of the pieces are the ones a whole-file read gave", () => {
  const root = smallTree();
  const several = join(root, "dir", "several");
  assert.deepEqual({
    legacy: fingerprintTree(root),
    legacyHome: fingerprintTree(root, { instanceHome: true }),
    v2: storedTreeDigest(root, 2),
    v2Home: storedTreeDigest(root, 2, { instanceHome: true }),
    exact: exactTreeDigest(root),
    exactChildren: exactTreeDigest(root, { children: true }),
    legacyFile: fingerprintTree(several),
    v2File: storedTreeDigest(several, 2),
    exactFile: exactTreeDigest(several),
  }, {
    legacy: "sha256:8559122dc7aa5094427b3b7c8df2153332d57f107008b8840a3de5da735901dd",
    legacyHome: "sha256:fe5030fb08e198c9dcc2572896ed314d18435eb098eec5814e63e1229a9bfaf9",
    v2: "sha256:9f3adc71a18ae481cbba30a7334c84c8ff51abb99f5204c787113dd749432fec",
    v2Home: "sha256:a77bea498f218b64141626c677f9cd9f966a807c27bfa531d8d5ad0161c7f31b",
    exact: "sha256:6ef648a6665bedd16147d9b76ca45f5d0f2859d9a81b23c433202e979991bbf0",
    exactChildren: "sha256:9f3adc71a18ae481cbba30a7334c84c8ff51abb99f5204c787113dd749432fec",
    legacyFile: "sha256:3aac769ac1ad228dcb2ea1bc6685cffb4477898238f21302455564d9404748df",
    v2File: "sha256:4f78b269527d3e74d93de72f15121cefb5b414e692549903763a04b6aa9d5f22",
    exactFile: "sha256:4f78b269527d3e74d93de72f15121cefb5b414e692549903763a04b6aa9d5f22",
  });
});

test("#617 a worktree's digests, its untracked paths read as taps of the walk, are the ones a whole-file read gave", () => {
  const root = smallTree();
  fixtureGit(null, ["init", "-q", root]);
  const status = fixtureGit(root, STATUS_ARGS);
  const both = worktreeDigests(root, status);
  assert.ok(both, "the worktree's digests are read");
  assert.deepEqual({ generated: both.generated, bytes: both.bytes }, {
    generated: "sha256:04c511a06bba9d5ec9f56871307ac0a5dc75a852354aaa1baa01cb2513f64b8a",
    bytes: "sha256:9f3adc71a18ae481cbba30a7334c84c8ff51abb99f5204c787113dd749432fec",
  });
});

test("#617 a file's stored digest is the one spelled out from its bytes read whole", () => {
  // The stored digest of version 2 of a file alone: "entry", NUL, its bits, NUL, "file", NUL, its length, NUL, its bytes.
  const root = smallTree();
  for (const name of ["empty", "one-mib", join("dir", "just-over"), join("dir", "several")]) {
    const path = join(root, name);
    const bytes = readFileSync(path);
    const stream = Buffer.concat([Buffer.from(`entry\0${statSync(path).mode & 0o7777}\0file\0${bytes.length}\0`), bytes]);
    assert.equal(storedTreeDigest(path, 2), `sha256:${createHash("sha256").update(stream).digest("hex")}`, name);
  }
});

// ---- A file that changes while it is read ----
// A digest frames a file's bytes with their length, which it takes when it opens the file: the bytes
// that follow are exactly that many.

/** readFilePieces of `path` with `between()` run after its first piece → { size, bytes }. */
function readWith(path, between) {
  const pieces = [];
  let size, first = true;
  const io = { readSync: (fd, ...args) => { const n = readSync(fd, ...args); if (first) { first = false; between(); } return n; } };
  readFilePieces(path, (s) => { size = s; }, (piece) => pieces.push(Buffer.from(piece)), io);
  return { size, bytes: Buffer.concat(pieces) };
}

test("#617 a file that shrinks while it is read refuses with E_WORK_INSPECTION_FAILED naming it", () => {
  const root = smallTree();
  const path = join(root, "dir", "several");
  assert.throws(() => readWith(path, () => truncateSync(path, MIB + 10)), (e) => {
    assert.equal(e.code, "E_WORK_INSPECTION_FAILED");
    assert.match(e.message, new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} changed while it was read`));
    return true;
  });
});

test("#617 a file that grows while it is read is read for the size it had when opened", () => {
  const root = smallTree();
  const path = join(root, "dir", "several");
  const before = readFileSync(path);
  const { size, bytes } = readWith(path, () => appendFileSync(path, "appended"));
  assert.equal(size, before.length);
  assert.ok(bytes.equals(before), "the bytes read are the ones it held when opened");
});

// ---- A sparse file over 2 GiB ----
// A sparse file costs no disk: the digests read it where it is.

const LARGE = 2 * 1024 * MIB + 4096 + 7;
const HEAD = Buffer.from("head of the large file\n"), TAIL = Buffer.from("tail of the large file\n");

/** A sparse file of LARGE bytes at `path`: HEAD, a hole, TAIL. */
function sparseFile(path) {
  const fd = openSync(path, "w");
  try {
    writeSync(fd, HEAD, 0, HEAD.length, 0);
    ftruncateSync(fd, LARGE);
    writeSync(fd, TAIL, 0, TAIL.length, LARGE - TAIL.length);
  } finally { closeSync(fd); }
  const st = statSync(path);
  assert.ok(st.size > 2 ** 31, "fixture premise: the file is over 2 GiB");
  assert.ok(st.blocks * 512 < 64 * MIB, `fixture premise: the file is sparse (${st.blocks * 512} bytes allocated)`);
}
/** The stored digest of version 2 of the large file alone, spelled out and hashed as it is read here. */
function spelledLargeDigest(path) {
  const hash = createHash("sha256").update(`entry\0${statSync(path).mode & 0o7777}\0file\0${LARGE}\0`);
  const buffer = Buffer.alloc(16 * MIB), fd = openSync(path, "r");
  try { for (let at = 0, n; (n = readSync(fd, buffer, 0, buffer.length, at)) > 0; at += n) hash.update(buffer.subarray(0, n)); }
  finally { closeSync(fd); }
  return `sha256:${hash.digest("hex")}`;
}

test("#617 the digests of a tree that holds a sparse file over 2 GiB are read, and the file's is the one spelled out from its bytes", { timeout: 10 * 60 * 1000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "oats-large-digest-"));
  temporaryDirectories.push(root);
  const large = join(root, "large.bin");
  try {
    sparseFile(large);
    assert.equal(storedTreeDigest(large, 2), spelledLargeDigest(large));
    for (const digest of [fingerprintTree(root), storedTreeDigest(root, 2), exactTreeDigest(root)]) assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  } finally { rmSync(large, { force: true }); }
});

test("#617 a worktree whose untracked file is a sparse file over 2 GiB has its digests, from one read and apart alike", { timeout: 10 * 60 * 1000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "oats-large-worktree-"));
  temporaryDirectories.push(root);
  fixtureGit(null, ["init", "-q", root]);
  const large = join(root, "large.bin");
  try {
    sparseFile(large);
    const status = fixtureGit(root, STATUS_ARGS);
    const both = worktreeDigests(root, status);
    assert.ok(both, "the worktree's digests are read in one walk");
    assert.deepEqual({ generated: both.generated, bytes: both.bytes }, { generated: generatedWorkDigest(root, status), bytes: worktreeBytes(root) });
  } finally { rmSync(large, { force: true }); }
});

// ---- A directory instance with a sparse file over 2 GiB retires ----
// The recovery copies the file, and the copy is written out in full: the test needs that much free
// space, and frees it at the end.

const FREE_NEEDED = 8 * 1024 * MIB;

test("#617 a directory instance with a sparse file over 2 GiB in its work retires, and its verified recovery holds the file", { timeout: 15 * 60 * 1000 }, (t) => {
  const f = fixture({ work: "directory" });
  const fs = statfsSync(f.base);
  if (fs.bavail * fs.bsize < FREE_NEEDED) {
    t.skip(`the recovery copy of a ${LARGE}-byte file needs ${FREE_NEEDED} bytes free; ${fs.bavail * fs.bsize} are`);
    return;
  }
  const spawned = spawn(f, "large");
  const large = join(spawned.home, "work", "large.bin");
  let copy;
  try {
    sparseFile(large);
    const expected = spelledLargeDigest(large);
    const retired = cli(f, ["retire", "dev-large", "--json"]);
    assert.equal(retired.status, 0, `${retired.stderr}\n${retired.stdout}`);
    const recovery = JSON.parse(retired.stdout).workRecovery;
    assert.ok(recovery?.path, `a recovery was written: ${retired.stdout}`);
    assert.deepEqual(recovery.classes, ["directory work bytes"]);
    copy = join(recovery.path, "work", "large.bin");
    assert.equal(statSync(copy).size, LARGE, "the copy holds every byte");
    assert.equal(storedTreeDigest(copy, 2), expected, "the copy holds the file's bytes");
  } finally {
    rmSync(large, { force: true });
    if (copy) rmSync(copy, { force: true });
  }
});
