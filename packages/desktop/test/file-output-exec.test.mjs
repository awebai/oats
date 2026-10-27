// The exec of a change whose output is files (packages/client/file-output-exec.mjs): execFile's contract over a
// detached child whose stdout and stderr are unlinked files, and the lifetime regression (a client that goes,
// by exit or by any signal, never cuts the child's writes short). The private dir is observed through TMPDIR,
// which os.tmpdir() reads on every call: each test points it at a scratch dir of its own and lists that.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileToFiles, FILE_OUTPUT_PREFIX } from '../../client/file-output-exec.mjs';

const POSIX = process.platform !== 'win32';
const LINUX = process.platform === 'linux';
const FIXTURES = fileURLToPath(new URL('./fixtures/session-resume/', import.meta.url));
const node = process.execPath;

/** A scratch dir as the OS temp dir for the test's length; returns it. */
function scratchTmp(t) {
  const before = process.env.TMPDIR;
  const dir = mkdtempSync(join(tmpdir(), 'file-output-exec-test-'));
  process.env.TMPDIR = dir;
  t.after(() => { if (before === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = before; rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
/** The fds of this process that name something under `dir` (Linux), deleted or not. */
const fdsUnder = (dir) => readdirSync('/proc/self/fd').map((fd) => { try { return readlinkSync(`/proc/self/fd/${fd}`); } catch { return ''; } }).filter((p) => p.startsWith(dir));

/** Run and collect the one callback; asserts it is called exactly once. */
function run(bin, argv, options) {
  return new Promise((resolve, reject) => {
    let calls = 0;
    const child = execFileToFiles(bin, argv, options, (error, stdout, stderr) => {
      calls += 1;
      if (calls > 1) reject(new Error('called back twice'));
      setTimeout(() => (calls === 1 ? resolve({ error, stdout, stderr, child }) : null), 50);
    });
  });
}
const script = (source) => ['-e', source];

test('argv, cwd and env are passed; stdin is ignored; stdout and stderr are the unlinked files; the child leads its own session', { skip: !POSIX }, async (t) => {
  const tmp = scratchTmp(t);
  const cwd = mkdtempSync(join(tmp, 'cwd-'));
  const probe = `const fs = require('node:fs');
    const linux = process.platform === 'linux';
    const stat = linux ? fs.readFileSync('/proc/self/stat', 'utf8').split(') ')[1].split(' ') : null;
    process.stdout.write(JSON.stringify({ argv: process.argv.slice(1), cwd: process.cwd(), env: process.env.FOE_PROBE ?? null,
      stdin: fs.fstatSync(0).isCharacterDevice(), files: [fs.fstatSync(1).isFile(), fs.fstatSync(2).isFile()],
      links: linux ? [fs.readlinkSync('/proc/self/fd/1'), fs.readlinkSync('/proc/self/fd/2')] : null,
      leader: linux ? Number(stat[2]) === process.pid && Number(stat[3]) === process.pid : null }));`;
  const { error, stdout, stderr } = await run(node, [...script(probe), 'a b', '--c'], { cwd, env: { ...process.env, FOE_PROBE: 'seen' } });
  assert.equal(error, null);
  assert.equal(stderr, '');
  const seen = JSON.parse(stdout);
  assert.deepEqual(seen.argv, ['a b', '--c']);
  // The child reports its cwd resolved: on macOS the temp dir is under /var, a link to /private/var.
  assert.equal(seen.cwd, realpathSync(cwd));
  assert.equal(seen.env, 'seen');
  assert.equal(seen.stdin, true, 'stdin is /dev/null');
  assert.deepEqual(seen.files, [true, true], 'stdout and stderr are files, not pipes');
  if (LINUX) {
    for (const [link, name] of [[seen.links[0], 'stdout'], [seen.links[1], 'stderr']]) {
      assert.ok(link.startsWith(join(tmp, FILE_OUTPUT_PREFIX)) && link.endsWith(`/${name} (deleted)`), `${name} was unlinked before the child wrote: ${link}`);
    }
    assert.equal(seen.leader, true, 'a session and a process group of its own');
  }
  assert.deepEqual(readdirSync(tmp).filter((n) => n.startsWith(FILE_OUTPUT_PREFIX)), [], 'nothing left on disk');
});

test('the private dir and both files are gone as soon as the spawn returns', { skip: !POSIX }, async (t) => {
  const tmp = scratchTmp(t);
  let returned;
  const done = new Promise((resolve) => { returned = execFileToFiles(node, script('setTimeout(() => process.stdout.write("late"), 200)'), {}, (...answer) => resolve(answer)); });
  assert.ok(Number.isInteger(returned.pid), 'the child is returned');
  assert.deepEqual(readdirSync(tmp), [], 'gone while the child still runs');
  if (LINUX) assert.equal(fdsUnder(tmp).filter((p) => !p.endsWith('(deleted)')).length, 0, 'no fd names a path that still exists');
  const [error, stdout] = await done;
  assert.deepEqual([error, stdout], [null, 'late'], 'read back from the client\'s own fds');
  if (LINUX) assert.deepEqual(fdsUnder(tmp), [], 'every fd closed after the callback');
});

test('exit 0 gives the text of both streams, UTF-8; `buffer` gives Buffers', { skip: !POSIX }, async (t) => {
  scratchTmp(t);
  const out = await run(node, script('process.stdout.write("out ✓"); process.stderr.write("err ✓")'), {});
  assert.deepEqual([out.error, out.stdout, out.stderr], [null, 'out ✓', 'err ✓']);
  const raw = await run(node, script('process.stdout.write("out ✓")'), { encoding: 'buffer' });
  assert.ok(Buffer.isBuffer(raw.stdout) && Buffer.isBuffer(raw.stderr));
  assert.equal(raw.stdout.toString('utf8'), 'out ✓');
});

test('a nonzero exit gives its code with the output; a signal gives the signal; neither says killed', { skip: !POSIX }, async (t) => {
  scratchTmp(t);
  const exited = await run(node, script('process.stdout.write("partial"); process.stderr.write("w" + "hy"); process.exitCode = 3'), {});
  assert.ok(exited.error instanceof Error);
  assert.deepEqual([exited.error.code, exited.error.signal, exited.error.killed], [3, null, false]);
  assert.deepEqual([exited.stdout, exited.stderr], ['partial', 'why']);
  assert.doesNotMatch(exited.error.message, /why/, 'no text of the child in the error');
  const signalled = await run(node, script('process.kill(process.pid, "SIGTERM"); setTimeout(() => {}, 5000)'), {});
  assert.deepEqual([signalled.error.code, signalled.error.signal, signalled.error.killed], [null, 'SIGTERM', false]);
});

test('more than maxBuffer on either stream is ERR_CHILD_PROCESS_STDIO_MAXBUFFER, with what fits', { skip: !POSIX }, async (t) => {
  scratchTmp(t);
  const out = await run(node, script('process.stdout.write("x".repeat(100))'), { maxBuffer: 10 });
  assert.ok(out.error instanceof RangeError);
  assert.equal(out.error.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  assert.equal(out.stdout, 'x'.repeat(10));
  const err = await run(node, script('process.stderr.write("y".repeat(100)); process.exitCode = 2'), { maxBuffer: 10 });
  assert.equal(err.error.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'the overflow is the answer, over the exit');
  const exact = await run(node, script('process.stdout.write("x".repeat(10))'), { maxBuffer: 10 });
  assert.deepEqual([exact.error, exact.stdout], [null, 'x'.repeat(10)], 'exactly maxBuffer fits');
  const big = await run(node, script('process.stdout.write("z".repeat(2 * 1024 * 1024))'), {});
  assert.equal(big.error.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'the default bound is execFile\'s 1 MiB');
  assert.equal(big.stdout.length, 1024 * 1024);
});

test('a nonzero timeout throws a TypeError, and nothing is made or started', { skip: !POSIX }, (t) => {
  const tmp = scratchTmp(t);
  for (const timeout of [1, 60_000, Infinity, -1]) {
    assert.throws(() => execFileToFiles(node, script(''), { timeout }, () => assert.fail('called back')), TypeError);
  }
  assert.throws(() => execFileToFiles(node, script(''), { maxBuffer: -1 }, () => {}), TypeError);
  assert.deepEqual(readdirSync(tmp), []);
});

test('a timeout of 0 (none) is accepted', { skip: !POSIX }, async (t) => {
  scratchTmp(t);
  const { error, stdout } = await run(node, script('process.stdout.write("ok")'), { timeout: 0 });
  assert.deepEqual([error, stdout], [null, 'ok']);
});

test('a spawn that fails calls back once with its error and empty output, and leaves nothing', { skip: !POSIX }, async (t) => {
  const tmp = scratchTmp(t);
  const missing = await run(join(tmp, 'no-such-oats'), ['session', 'resume', '--json'], {});
  assert.equal(missing.error.code, 'ENOENT');
  assert.deepEqual([missing.stdout, missing.stderr], ['', '']);
  const noCwd = await run(node, script(''), { cwd: join(tmp, 'no-such-dir') });
  assert.equal(noCwd.error.code, 'ENOENT');
  assert.deepEqual(readdirSync(tmp), []);
  if (LINUX) assert.deepEqual(fdsUnder(tmp), [], 'every fd closed');
});

test('a failure before the spawn returns closes and removes what was made, then throws', { skip: !POSIX }, (t) => {
  const tmp = scratchTmp(t);
  // spawn refuses a NUL in an argument or in the file synchronously: after the dir and both files were made.
  assert.throws(() => execFileToFiles(node, ['a\0b'], {}, () => assert.fail('called back')), (error) => error.code === 'ERR_INVALID_ARG_VALUE');
  assert.throws(() => execFileToFiles(`${node}\0`, [], {}, () => assert.fail('called back')), (error) => error.code === 'ERR_INVALID_ARG_VALUE');
  assert.deepEqual(readdirSync(tmp), []);
  if (LINUX) assert.deepEqual(fdsUnder(tmp), [], 'no fd left open');
  // No temp dir to make one in: the first step fails, nothing else happens.
  process.env.TMPDIR = join(tmp, 'gone');
  assert.throws(() => execFileToFiles(node, script(''), {}, () => assert.fail('called back')), (error) => error.code === 'ENOENT');
  assert.equal(existsSync(join(tmp, 'gone')), false);
});

/** The lines of a child's stdout, as they come. */
function firstLine(child, ms) {
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('the helper printed no line in time')), ms);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { text += chunk; const at = text.indexOf('\n'); if (at >= 0) { clearTimeout(timer); resolve(text.slice(0, at)); } });
    child.once('exit', () => { if (!text.includes('\n')) { clearTimeout(timer); reject(new Error('the helper exited without a line')); } });
  });
}
function exited(child, ms) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the helper did not exit in time')), ms);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}
async function markerOf(path, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the stand-in wrote no marker in time');
}
const kill = (pid, signal) => { try { process.kill(pid, signal); } catch { /* gone */ } };

for (const ending of ['exit', 'SIGTERM', 'SIGHUP', 'SIGKILL']) {
  test(`lifetime: a client that ends by ${ending === 'exit' ? 'a normal exit' : `${ending} to its process group`} never cuts the change's writes short`, { skip: !POSIX, timeout: 40_000 }, async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'file-output-exec-lifetime-'));
    const marker = join(scratch, 'marker.json');
    let helper = null, standIn = null;
    try {
      // The helper leads a process group, as a client started from a terminal does: the signal goes to the
      // whole group, as a Ctrl-C or a hang-up would. The stand-in, in a session of its own, is not in it.
      helper = spawn(node, [join(FIXTURES, 'exec-helper.mjs'), join(FIXTURES, 'stand-in-kernel.mjs'), marker, ending === 'exit' ? 'exit' : 'wait'],
        { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
      standIn = JSON.parse(await firstLine(helper, 10_000)).pid;
      assert.ok(Number.isInteger(standIn), 'the helper started the stand-in');
      if (ending !== 'exit') kill(-helper.pid, ending);
      await exited(helper, 10_000);
      const facts = await markerOf(marker, 25_000);
      assert.notEqual(facts.gaveUp, true, 'the stand-in saw its client go');
      assert.deepEqual(facts.stdout, { written: facts.size, error: null }, 'every stdout byte written, no EPIPE');
      assert.deepEqual(facts.stderr, { written: facts.size, error: null }, 'every stderr byte written, no EPIPE');
      assert.ok(facts.size > 64 * 1024, 'more than a pipe holds');
    } finally {
      if (helper) kill(-helper.pid, 'SIGKILL');
      if (standIn) { kill(-standIn, 'SIGKILL'); kill(standIn, 'SIGKILL'); }
      rmSync(scratch, { recursive: true, force: true });
    }
  });
}
