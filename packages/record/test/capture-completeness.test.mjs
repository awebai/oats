// Completion receipts are native CLI results, not exit-code heuristics.
// All sources/stores here are isolated fixtures; no harness is launched.
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { RecordStore } from "../lib/store.mjs";
import { captureSessions } from "../lib/capture-cc.mjs";

const CAPTURE = new URL("../bin/capture.mjs", import.meta.url).pathname;
const OATS = new URL("../../../bin/oats.mjs", import.meta.url).pathname;
const ts = "2026-09-13T10:00:00Z";
function line(cwd, text = "capturable") {
  return JSON.stringify({ cwd, type: "user", timestamp: ts, message: { content: text } }) + "\n";
}
function fixture(t, format = "cc") {
  const base = mkdtempSync(join(tmpdir(), "capture-completeness-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, "instance"), user = join(base, "user"), root = join(base, "record");
  const project = format === "cc" ? join(user, ".claude", "projects", "-shared")
    : format === "pi" ? join(user, ".pi", "agent", "sessions", "--shared--")
      : join(user, ".codex", "sessions", "2026", "09", "13");
  mkdirSync(home); mkdirSync(project, { recursive: true }); mkdirSync(root);
  const file = join(project, "s1.jsonl");
  const env = { ...process.env, HOME: user, TURN_RECORD_ROOT: root, TURN_RECORD_OWNER: "tester" };
  const store = new RecordStore(root, { owner: "tester" });
  const stream = `tester~${format}.s1`;
  const run = ({ preload, native = false, background = false } = {}) => spawnSync(process.execPath,
    [...(preload ? ["--import", preload] : []), ...(native ? [OATS, "capture"] : [CAPTURE]),
      ...(background ? ["--sessions-only"] : ["--home", home]), "--no-index"],
    { env, cwd: home, encoding: "utf8", timeout: 10000 });
  const inject = (code) => {
    const path = join(base, "fault.mjs");
    writeFileSync(path, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const source = ${JSON.stringify(file)}, root = ${JSON.stringify(root)}, project = ${JSON.stringify(project)};
${code}
syncBuiltinESMExports();`);
    return path;
  };
  return { base, home, user, root, project, file, store, stream, run, inject };
}
function incomplete(result, status = "incomplete") {
  assert.equal(result.status, status === "failed" ? 1 : 0, result.stderr + result.stdout);
  const out = JSON.parse(result.stdout);
  assert.equal(out.complete, false, "this receipt must not authorize final source retirement");
  assert.equal(out.status, status);
  assert.doesNotMatch(result.stderr, /\n\s+at /, "no stack traces or native record dumps");
  return out;
}

for (const format of ["cc", "pi", "codex"]) {
  test(`native oats capture: ${format} torn tails block completion until the writer terminates the record`, (t) => {
    const f = fixture(t, format);
    const header = format === "cc" ? line(f.home)
      : JSON.stringify(format === "pi" ? { type: "session", cwd: f.home, timestamp: ts }
        : { type: "session_meta", timestamp: ts, payload: { cwd: f.home } }) + "\n";
    // Valid JSON without a newline is not a committed native record either.
    const tail = line(f.home, "tail-only-private-marker").trimEnd();
    writeFileSync(f.file, header + tail);
    let out = incomplete(f.run({ native: true }));
    assert.equal(out.incomplete, 1); assert.equal(out.appended, 1);
    assert.equal(out.issues[0].reason, "torn-tail");
    assert.equal(out.sessions[0].turns, 1);
    assert.doesNotMatch(JSON.stringify(out), /tail-only-private-marker/);
    const background = f.run({ background: true });
    assert.equal(background.status, 0, background.stderr);
    assert.match(background.stdout, /incomplete/);
    out = incomplete(f.run({ native: true }));
    assert.equal(out.appended, 0, "a retry cannot reinterpret the partial record as valid");
    assert.equal(f.store.readStream(f.stream).length, 1);
    appendFileSync(f.file, "\n");
    const done = f.run({ native: true }); assert.equal(done.status, 0, done.stderr);
    out = JSON.parse(done.stdout);
    assert.equal(out.complete, true); assert.equal(out.status, "complete");
    assert.equal(out.incomplete, 0); assert.equal(out.appended, 1);
    assert.equal(out.sessions[0].turns, 2);
    assert.equal(f.store.readStream(f.stream).map((t) => t.body.line).join("\n") + "\n", header + tail + "\n");
  });
}

test("home capture refuses uncommitted first records and no-cwd sources, without disclosing contents", (t) => {
  const f = fixture(t);
  writeFileSync(f.file, line(f.home, "uncommitted-private-marker").trimEnd());
  let out = incomplete(f.run());
  assert.deepEqual(out.unattributed, [{ source: "cc", path: f.file }]);
  assert.deepEqual(out.sessions, []); assert.equal(out.appended, 0);
  assert.doesNotMatch(JSON.stringify(out), /uncommitted-private-marker/);
  writeFileSync(f.file, '{"type":"summary","body":"unknown-private-marker"}\n');
  out = incomplete(f.run());
  assert.doesNotMatch(JSON.stringify(out), /unknown-private-marker/);
  // Explicit exclusions remain allowed and are checked before opening.
  writeFileSync(join(f.root, "ignore"), "s1\n");
  const preload = f.inject(`const open = fs.openSync;
fs.openSync = (p, ...args) => { if (String(p) === source) throw new Error('ignored source was opened'); return open(p, ...args); };`);
  const done = f.run({ preload }); assert.equal(done.status, 0, done.stderr);
  out = JSON.parse(done.stdout); assert.equal(out.complete, true); assert.equal(out.ignored, 1);
});

test("home capture never captures an unrelated held or torn session in the same directory", (t) => {
  const f = fixture(t);
  writeFileSync(f.file, line(f.home));
  const other = join(f.project, "sibling.jsonl");
  writeFileSync(other, JSON.stringify({ cwd: join(f.base, "another-instance"), message: "unrelated-private-marker" }) + "\npartial");
  const result = f.run(); assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.complete, true); assert.equal(out.appended, 1);
  assert.equal(out.held, 0); assert.equal(out.incomplete, 0); assert.equal(out.sessions.length, 1);
  assert.deepEqual(f.store.listStreams(), [f.stream]);
  assert.doesNotMatch(result.stdout + result.stderr, /unrelated-private-marker/);
});

test("oversized native lines hold their suffix without advancing offsets or exposing it", (t) => {
  const f = fixture(t);
  const header = line(f.home), big = line(f.home, "oversized-private-marker"), after = line(f.home, "after oversized");
  writeFileSync(f.file, header + big + after);
  // Exercise V8's actual failure code without allocating a >512 MB string.
  const preload = f.inject(`const decode = Buffer.prototype.toString;
Buffer.prototype.toString = function (...args) {
  if (this.includes(Buffer.from('oversized-private-marker'))) {
    throw Object.assign(new RangeError('Cannot create a string longer than the V8 limit'), { code: 'ERR_STRING_TOO_LONG' });
  }
  return decode.apply(this, args);
};`);
  for (let i = 0; i < 2; i++) {
    const out = incomplete(f.run({ preload }));
    assert.equal(out.issues[0].reason, "oversized-line");
    assert.equal(out.incomplete, 1); assert.equal(out.sessions[0].turns, 1);
    assert.doesNotMatch(JSON.stringify(out), /oversized-private-marker/);
    const offsets = JSON.parse(readFileSync(join(f.root, "index", "capture-offsets.json")));
    assert.equal(offsets[`${f.stream}:${f.file}`].bytes, Buffer.byteLength(header));
  }
  const done = JSON.parse(f.run().stdout);
  assert.equal(done.complete, true); assert.equal(done.appended, 2); assert.equal(done.sessions[0].turns, 3);
});

test("invalid UTF-8 never corrupts source byte offsets or admits a partial record", (t) => {
  const f = fixture(t);
  const header = line(f.home);
  writeFileSync(f.file, Buffer.concat([Buffer.from(header), Buffer.from([0xff, 10]), Buffer.from(line(f.home, "after invalid bytes"))]));
  for (let i = 0; i < 2; i++) {
    const out = incomplete(f.run());
    assert.equal(out.issues[0].reason, "invalid-utf8");
    assert.equal(out.sessions[0].turns, 1);
    assert.equal(out.issues[0].offset, Buffer.byteLength(header));
  }
  assert.equal(f.store.readStream(f.stream).length, 1);
});

for (const [name, fault] of [
  ["discovery read failure", `const open = fs.openSync, read = fs.readSync; let sourceFd;
fs.openSync = (p, ...args) => { const fd = open(p, ...args); if (String(p) === source) sourceFd = fd; return fd; };
fs.readSync = (fd, ...args) => { if (fd === sourceFd) throw Object.assign(new Error('simulated read failure'), { code: 'EIO' }); return read(fd, ...args); };`],
  ["discovery open failure", `const open = fs.openSync; fs.openSync = (p, ...args) => { if (String(p) === source) throw Object.assign(new Error('simulated open failure'), { code: 'EACCES' }); return open(p, ...args); };`],
  ["directory scan failure", `const scan = fs.readdirSync; fs.readdirSync = (p, ...args) => { if (String(p) === project) throw Object.assign(new Error('simulated scan failure'), { code: 'EACCES' }); return scan(p, ...args); };`],
  ["default root stat failure", `const stat = fs.statSync; fs.statSync = (p, ...args) => { if (String(p) === ${JSON.stringify("REPLACE_PI_ROOT")}) throw Object.assign(new Error('simulated root failure'), { code: 'EACCES' }); return stat(p, ...args); };`],
  ["source disappears after attribution", `const stat = fs.statSync; fs.statSync = (p, ...args) => { if (String(p) === source) fs.rmSync(source, { force: true }); return stat(p, ...args); };`],
  ["source disappears after discovery", `const mkdir = fs.mkdirSync; fs.mkdirSync = (p, ...args) => { if (String(p) === root + '/.capture.lock') fs.rmSync(source); return mkdir(p, ...args); };`],
  ["source short read during capture", `const open = fs.openSync, read = fs.readSync; let opens = 0, captureFd;
fs.openSync = (p, ...args) => { const fd = open(p, ...args); if (String(p) === source && ++opens === 2) captureFd = fd; return fd; };
fs.readSync = (fd, ...args) => fd === captureFd ? 0 : read(fd, ...args);`],
  ["source disappears after capture append", `const write = fs.writeFileSync; fs.writeFileSync = (p, ...args) => { const result = write(p, ...args); if (String(p).endsWith('capture-offsets.json')) fs.rmSync(source, { force: true }); return result; };`],
]) {
  test(`home capture fails closed on ${name}`, (t) => {
    const f = fixture(t);
    writeFileSync(f.file, line(f.home));
    const preload = f.inject(fault.replace('REPLACE_PI_ROOT', join(f.user, ".pi", "agent", "sessions")));
    const out = incomplete(f.run({ preload }), "failed");
    assert.equal(out.failed, 1); assert.equal(out.appended, null); assert.ok(out.error);
    assert.equal(existsSync(join(f.root, ".capture.lock")), false, "failure does not strand the capture lock");
  });
}

test("final capture distrusts an unchanged offset when the journal was wiped", (t) => {
  const f = fixture(t);
  writeFileSync(f.file, line(f.home));
  assert.equal(JSON.parse(f.run().stdout).complete, true);
  rmSync(dirname(f.store.journalPath(f.stream)), { recursive: true });
  const done = JSON.parse(f.run().stdout);
  assert.equal(done.complete, true); assert.equal(done.appended, 1); assert.equal(done.sessions[0].turns, 1);
});

test("the lower-level final pass cannot silently lose a pinned discovered source", (t) => {
  const f = fixture(t);
  writeFileSync(f.file, line(f.home));
  const files = [f.file];
  rmSync(f.file);
  assert.throws(() => captureSessions(f.store, { owner: "tester", files, final: true }), { code: "ENOENT" });
});

test("ordinary Claude config files and absent optional runtimes are not scan failures", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.user, ".claude.json"), "{}");
  writeFileSync(join(f.user, ".claude.json.backup"), "{}");
  writeFileSync(f.file, line(f.home));
  const result = f.run({ native: true }); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).complete, true);
});

test("exhausted cwd discovery bounds remain incomplete even beside a complete relevant session", (t) => {
  const f = fixture(t);
  writeFileSync(f.file, line(f.home));
  const path = join(f.project, "late-cwd.jsonl");
  writeFileSync(path, JSON.stringify({ type: "bookkeeping", payload: "x".repeat(8 * 1024 * 1024) }) + "\n" + line(f.home));
  const out = incomplete(f.run());
  assert.deepEqual(out.unattributed, [{ source: "cc", path }]);
  assert.equal(out.sessions.length, 1); assert.equal(out.appended, 1);
  assert.equal(f.store.readStream("tester~cc.late-cwd").length, 0);
});

test("invalid UTF-8 cannot fabricate cwd attribution", (t) => {
  const f = fixture(t);
  const pathWithReplacement = join(f.home, "replacement-\ufffd");
  const bytes = Buffer.from(line(pathWithReplacement));
  const replacement = bytes.indexOf(Buffer.from("\ufffd"));
  writeFileSync(f.file, Buffer.concat([bytes.subarray(0, replacement), Buffer.from([0xff]), bytes.subarray(replacement + 3)]));
  const out = incomplete(f.run());
  assert.deepEqual(out.unattributed, [{ source: "cc", path: f.file }]);
  assert.deepEqual(out.sessions, []);
});
