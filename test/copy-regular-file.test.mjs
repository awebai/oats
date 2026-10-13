// awebai/oats#1029: what the retire's copier copies "as a file" is a regular file, or the kernel
// refuses and says what is there. The system call is not the judge: copyFileSync of an empty directory
// fails on one file system (EISDIR) and writes an empty file on another, where a directory's size is 0.
//
// Every refusal here is the kernel's own sentence, compared whole, so each row holds on any file
// system: none waits for the copy to fail. A link is followed, as Git follows one at each of these
// paths: what Git reads there decides.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyRegularFile } from "../lib/core.mjs";
import { fixtureBase } from "./helpers/host-fixture.mjs";

const CORE = new URL("../lib/core.mjs", import.meta.url).href;
const base = fixtureBase("oats-copy-file-");
test.after(() => rmSync(base, { recursive: true, force: true }));
let cases = 0;
/** A directory of its own for one case → { dir, source, dest }: `dest` is under a directory that is not there yet. */
function place() {
  const dir = join(base, `case-${++cases}`);
  mkdirSync(dir);
  return { dir, source: join(dir, "source"), dest: join(dir, "made", "by", "the", "copy") };
}
const sentence = (path, what) => `the recovery copies ${path} as a file, and ${what} is there`;
/** The copy refuses with exactly the kernel's sentence, writes nothing, and the system never spoke. */
function refuses({ dir, source, dest }, what) {
  let thrown;
  try { copyRegularFile(source, dest); } catch (e) { thrown = e; }
  assert.ok(thrown, `${what}: copied, or taken for absent`);
  assert.equal(thrown.message, sentence(source, what));
  assert.equal(thrown.code, undefined, "the kernel's own error, not a system call's");
  assert.equal(existsSync(join(dir, "made")), false, "nothing was written, not even the destination's directory");
}
const bitsOf = (path) => lstatSync(path).mode & 0o7777;
const isRoot = process.getuid?.() === 0;

test("a regular file is copied: its bytes and its mode, into a directory the copy makes, over what was there", () => {
  const p = place();
  writeFileSync(p.source, "the bytes\n", { mode: 0o640 });
  chmodSync(p.source, 0o640);
  assert.equal(copyRegularFile(p.source, p.dest), true);
  assert.equal(readFileSync(p.dest, "utf8"), "the bytes\n");
  assert.equal(bitsOf(p.dest), 0o640);
  // A second copy replaces what the first left, as the copy of an index over the clone's own does.
  writeFileSync(p.source, "other bytes\n");
  assert.equal(copyRegularFile(p.source, p.dest), true);
  assert.equal(readFileSync(p.dest, "utf8"), "other bytes\n");
  // An empty file is a file.
  writeFileSync(p.source, "");
  assert.equal(copyRegularFile(p.source, p.dest), true);
  assert.equal(readFileSync(p.dest, "utf8"), "");
});

test("a path named by bytes that are not UTF-8 is copied as a file too, as a branch's log is", (t) => {
  const p = place();
  const odd = (path) => Buffer.concat([Buffer.from(path), Buffer.from([0xff])]);
  try { writeFileSync(odd(p.source), "log bytes\n"); }
  catch (e) { t.skip(`this file system refuses a name that is not valid UTF-8 (${e.code})`); return; }
  // The directory the copy makes is named by bytes too, as the log of a branch `<bytes>/x` is.
  const made = odd(join(p.dir, "made"));
  const dest = Buffer.concat([made, Buffer.from("/copy")]);
  assert.equal(copyRegularFile(odd(p.source), dest), true);
  assert.equal(readFileSync(dest, "utf8"), "log bytes\n");
  assert.equal(readdirSync(p.dir, { encoding: "buffer" }).some((name) => name.equals(odd("made"))), true, "the directory has the bytes of its name, not a decoding of them");
  assert.equal(copyRegularFile(odd(join(p.dir, "absent")), odd(join(p.dir, "other", "dest"))), false);
  mkdirSync(odd(join(p.dir, "dir")));
  assert.throws(() => copyRegularFile(odd(join(p.dir, "dir")), odd(join(p.dir, "other", "dest"))), /as a file, and a directory is there$/);
  assert.equal(existsSync(join(p.dir, "other")), false);
});

test("nothing there is `false`, and nothing is written: an absent path, and a path under a file", () => {
  const p = place();
  assert.equal(copyRegularFile(p.source, p.dest), false);
  writeFileSync(join(p.dir, "a-file"), "x");
  assert.equal(copyRegularFile(join(p.dir, "a-file", "under-it"), p.dest), false, "ENOTDIR is `not there`");
  assert.equal(existsSync(join(p.dir, "made")), false);
});

test("a directory is refused in the kernel's words, empty or not: the answer does not wait for the copy to fail", () => {
  const empty = place();
  mkdirSync(empty.source);
  refuses(empty, "a directory");
  const full = place();
  mkdirSync(full.source);
  writeFileSync(join(full.source, "inside"), "x");
  refuses(full, "a directory");
});

test("a refusal leaves what the destination already held", () => {
  const p = place();
  mkdirSync(p.source);
  mkdirSync(join(p.dir, "kept"));
  writeFileSync(join(p.dir, "kept", "dest"), "what was there\n");
  assert.throws(() => copyRegularFile(p.source, join(p.dir, "kept", "dest")), { message: sentence(p.source, "a directory") });
  assert.equal(readFileSync(join(p.dir, "kept", "dest"), "utf8"), "what was there\n");
});

test("a link is followed, as Git follows it: to a file it is copied as a plain file; to nothing it is `not there`; to anything else, or to itself, it is refused", () => {
  const file = place();
  writeFileSync(join(file.dir, "target"), "what Git reads through the link\n", { mode: 0o600 });
  chmodSync(join(file.dir, "target"), 0o600);
  symlinkSync(join(file.dir, "target"), file.source);
  assert.equal(copyRegularFile(file.source, file.dest), true);
  assert.equal(lstatSync(file.dest).isFile(), true, "the copy is a plain file, not a link");
  assert.equal(readFileSync(file.dest, "utf8"), "what Git reads through the link\n");
  assert.equal(bitsOf(file.dest), 0o600, "with the mode of what the link reaches");

  const twice = place();
  writeFileSync(join(twice.dir, "target"), "two links away\n");
  symlinkSync("target", join(twice.dir, "middle"));
  symlinkSync("middle", twice.source);
  assert.equal(copyRegularFile(twice.source, twice.dest), true);
  assert.equal(lstatSync(twice.dest).isFile(), true);
  assert.equal(readFileSync(twice.dest, "utf8"), "two links away\n");

  const dangling = place();
  symlinkSync(join(dangling.dir, "nothing"), dangling.source);
  assert.equal(copyRegularFile(dangling.source, dangling.dest), false, "a link that leads nowhere is `not there`");
  assert.equal(existsSync(join(dangling.dir, "made")), false);

  const toDirectory = place();
  mkdirSync(join(toDirectory.dir, "target"));
  symlinkSync(join(toDirectory.dir, "target"), toDirectory.source);
  refuses(toDirectory, "a link to a directory");

  const loop = place();
  symlinkSync(loop.source, loop.source);
  refuses(loop, "a link that cannot be followed");
});

test("a FIFO, in place or at a link's end, is refused without being opened", (t) => {
  const p = place();
  const fifo = join(p.dir, "fifo");
  try { execFileSync("mkfifo", [fifo], { stdio: "ignore" }); }
  catch (e) { t.skip(`no FIFO can be made here (${e.code ?? e.status})`); return; }
  symlinkSync(fifo, p.source);
  // In a child with a bound: a copy that opened a FIFO would wait for a writer for ever.
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { existsSync } from "node:fs";
    const { copyRegularFile } = await import(${JSON.stringify(CORE)});
    const out = [];
    for (const source of ${JSON.stringify([fifo, p.source])}) {
      try { out.push({ copied: copyRegularFile(source, ${JSON.stringify(p.dest)}) }); }
      catch (e) { out.push({ message: e.message, code: e.code ?? null }); }
    }
    console.log(JSON.stringify({ out, made: existsSync(${JSON.stringify(join(p.dir, "made"))}) }));
  `], { encoding: "utf8", timeout: 20_000 });
  assert.equal(child.error, undefined, `the copy did not answer in 20 s: it opened the FIFO (${child.error?.code})`);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), {
    out: [
      { message: sentence(fifo, "an entry that is neither a file nor a directory"), code: null },
      { message: sentence(p.source, "a link to an entry that is neither a file nor a directory"), code: null },
    ],
    made: false,
  });
});

test("an entry that cannot be looked at is refused, not taken for absent", { skip: isRoot ? "root looks into any directory" : false }, () => {
  const p = place();
  const closed = join(p.dir, "closed");
  mkdirSync(closed);
  writeFileSync(join(closed, "file"), "x");
  symlinkSync(join(closed, "file"), join(p.dir, "link-into-it"));
  chmodSync(closed, 0o000);
  try {
    refuses({ ...p, source: join(closed, "file") }, "an entry that cannot be read");
    refuses({ ...p, source: join(p.dir, "link-into-it") }, "a link that cannot be followed");
  } finally { chmodSync(closed, 0o700); }
});
