// awebai/oats#910: a fixture owns its expected warning (test/helpers/host-fixture.mjs
// expectLoginFallback). The line the kernel writes where it plans to start a fixture's tmux server is
// taken out of the output only when it is exactly the fixture's, and every capture asserts something.
//
// Each case runs in a child whose stderr this file reads: a line the helper must leave in the output
// is left in the child's, never in this file's own.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { LOGIN_FALLBACK_WARNING, fixtureBase, inheritedEnv, loginFallbackReason, noLoginShell, oatsSocket } from "./helpers/host-fixture.mjs";

const HOST = new URL("./helpers/host-fixture.mjs", import.meta.url).href;
const CORE = new URL("../lib/core.mjs", import.meta.url).href;
const LINE = LOGIN_FALLBACK_WARNING["no-shell"];

/** Run `body` (the source of a module) in a child in a fixture of its own: a HOME that is not the
 *  user's and a login shell that does not exist. It has `H` (the helper), `line`, `dir` (a
 *  TMUX_TMPDIR nothing runs under), `appear()` and `vanish()` (a file at that directory's `oats`
 *  socket, as a started and a killed server leave it), `own()` (process.stderr's own `write`:
 *  none, data or accessor) and `out`, which it fills. → { out, stderr } */
function inFixture(t, body, { isolated = false } = {}) {
  const base = fixtureBase("oats-few-");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "tmux");
  mkdirSync(join(base, "home"), { recursive: true });
  writeFileSync(join(base, "driver.mjs"), `import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const H = await import(${JSON.stringify(HOST)});
const base = ${JSON.stringify(base)}, dir = ${JSON.stringify(dir)}, line = H.LOGIN_FALLBACK_WARNING["no-shell"], out = {};
const pristine = process.stderr.write;
const appear = () => { mkdirSync(dirname(H.oatsSocket(dir)), { recursive: true }); writeFileSync(H.oatsSocket(dir), ""); };
const vanish = () => rmSync(H.oatsSocket(dir));
const own = () => { const d = Object.getOwnPropertyDescriptor(process.stderr, "write"); return (d ? (d.get ? "accessor" : "data") : "none") + (process.stderr.write === pristine ? ", the earlier write" : ""); };
const expect = (options) => H.expectLoginFallback({ tmuxTmpdir: dir, ...options });
const ended = (expectation, options) => { try { return expectation.end(options); } catch (e) { return e.message; } };
${body}
await new Promise((resolve) => setImmediate(resolve));
process.stdout.write(JSON.stringify(out));
`);
  const env = isolated ? inheritedEnv() : { ...inheritedEnv(), HOME: join(base, "home"), OATS_TEST_LOGIN_SHELL: noLoginShell(base) };
  const r = spawnSync(process.execPath, [join(base, "driver.mjs")], { cwd: base, env, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, `the child failed:\n${r.stdout}\n${r.stderr}`);
  return { out: JSON.parse(r.stdout), stderr: r.stderr, base, dir };
}

test("the reason a fixture has: none in the user's own home or with a shell that exists, else the missing shell or the HOME", (t) => {
  const base = fixtureBase("oats-few-");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const shell = join(base, "bash");
  assert.equal(loginFallbackReason({ HOME: base, OATS_TEST_LOGIN_SHELL: shell }), "no-shell");
  assert.equal(loginFallbackReason({ HOME: base }), "not-home");
  assert.equal(loginFallbackReason({}), "not-home", "no HOME at all is not the user's");
  writeFileSync(shell, "");
  assert.equal(loginFallbackReason({ HOME: base, OATS_TEST_LOGIN_SHELL: shell }), null, "a shell that exists answers something else");
  assert.equal(loginFallbackReason({ HOME: userInfo().homedir, OATS_TEST_LOGIN_SHELL: join(base, "absent") }), null, "in the user's home the kernel runs the user's shell");
  assert.equal(loginFallbackReason({ HOME: userInfo().homedir }), null);
});

test("only a write that is exactly the fixture's sentence is taken, and only while an expectation is in force", (t) => {
  const { out, stderr } = inFixture(t, `
out.reason = H.loginFallbackReason();
const e = expect();
process.stderr.write(line);
process.stderr.write(Buffer.from(line));
process.stderr.write(line, () => { out.calledBack = true; });
process.stderr.write(line.replace("ENOENT", "EACCES"));
process.stderr.write(line.replace("assured\\n", "assured.\\n"));
process.stderr.write("oats: " + line);
process.stderr.write(line + line);
process.stderr.write(H.LOGIN_FALLBACK_WARNING["not-home"]);
out.taken = e.end();
out.again = e.end();
process.stderr.write(line);
`);
  assert.equal(out.reason, "no-shell");
  assert.deepEqual([out.taken, out.again, out.calledBack], [3, 3, true], "a string, a buffer, and a write with a callback, which is called");
  assert.equal(stderr, [
    LINE.replace("ENOENT", "EACCES"), // another reason
    LINE.replace("assured\n", "assured.\n"), // one character more
    `oats: ${LINE}`, // not the whole write
    LINE + LINE, // two in one write
    LOGIN_FALLBACK_WARNING["not-home"], // another fixture's sentence
    LINE, // after the end
  ].join(""), "every other line stays in the output");
});

test("the sentence is taken only while the fixture's premise holds: not once its login shell exists, nor with no expectation of it", (t) => {
  const { out, stderr } = inFixture(t, `
const shell = process.env.OATS_TEST_LOGIN_SHELL;
const e = expect();
mkdirSync(dirname(shell), { recursive: true }); writeFileSync(shell, "");
process.stderr.write(line);
out.withShell = e.end();
out.reasonWithShell = H.loginFallbackReason();
const none = expect();
process.stderr.write(line);
out.none = none.end();
rmSync(shell);
const other = expect({ reason: "not-home" });
process.stderr.write(H.LOGIN_FALLBACK_WARNING["not-home"]);
out.other = other.end();
try { expect({ reason: "no-such-reason" }); } catch (e) { out.unknown = e.message; }
`);
  assert.deepEqual([out.withShell, out.reasonWithShell, out.none, out.other], [0, null, 0, 0]);
  assert.match(out.unknown, /no login-environment fallback warning is known for the reason "no-such-reason"/);
  assert.equal(stderr, LINE + LINE + LOGIN_FALLBACK_WARNING["not-home"], "all three stay in the output");
});

test("for the length of a call process.stderr.write is an accessor, and afterwards process.stderr has the own properties it had", (t) => {
  const { out, stderr } = inFixture(t, `
const seq = (out.one = []);
seq.push(own());
const a = expect(); seq.push(own());
a.end(); seq.push(own());

// Nested (a spawn inside fx.inEnv), then overlapping (two calls awaited together).
const nested = (out.nested = []);
const b = expect(), c = expect(); nested.push(own());
c.end(); nested.push(own());
b.end(); nested.push(own());
const overlapping = (out.overlapping = []);
const d = expect(), f = expect(); overlapping.push(own());
d.end(); overlapping.push(own());
f.end(); overlapping.push(own());

// Inside a session environment's expectation, which needs no accessor of its own.
const within = (out.within = []);
const life = expect({ lifetime: true }); within.push(own());
const g = expect(); within.push(own());
process.stderr.write(line);
out.call = g.end(); within.push(own());
appear();
out.life = life.end(); within.push(own());
vanish();
`);
  const none = "none, the earlier write";
  assert.deepEqual(out.one, [none, "accessor", none]);
  assert.deepEqual(out.nested, ["accessor", "accessor", none], "there until the outer call has ended");
  assert.deepEqual(out.overlapping, ["accessor", "accessor", none], "there until the last of them has ended");
  assert.deepEqual(out.within, ["data", "accessor", "data", none], "a session environment's capture is a plain property");
  assert.deepEqual([out.call, out.life], [1, 1], "one line, counted by both expectations in force");
  assert.equal(stderr, "");
});

test("a test's own process.stderr.write, put there inside the call or before it, sees the line first, and nothing is asserted for that call", (t) => {
  const { out, stderr } = inFixture(t, `
// Inside the call, and put back: the test holds the line (test/schedule-gone-server.test.mjs).
const a = expect();
const earlier = process.stderr.write, mine = (out.inside = []);
process.stderr.write = (chunk) => { mine.push(String(chunk)); return true; };
process.stderr.write(line);
process.stderr.write = earlier;
appear();
out.insideEnd = ended(a); out.afterInside = own();
vanish();

// Inside the call, passing on what it sees: the capture is below it.
const b = expect();
const below = process.stderr.write, passed = (out.passed = []);
process.stderr.write = function (chunk, ...rest) { passed.push(String(chunk)); return below.call(this, chunk, ...rest); };
process.stderr.write(line);
process.stderr.write = below;
out.passedEnd = ended(b);

// Before the call: the capture is not put over it, and the test's property is left as it was.
const before = (out.before = []);
const held = (chunk) => { before.push(String(chunk)); return true; };
process.stderr.write = held;
const c = expect(); out.duringHeld = own();
process.stderr.write(line);
appear();
out.beforeEnd = ended(c);
vanish();
out.afterHeld = own() + (process.stderr.write === held ? ", the test's" : "");
delete process.stderr.write;
`);
  assert.deepEqual(out.inside, [LINE]);
  assert.equal(out.insideEnd, 0, "a server appeared and the capture saw no line: the test held it, so nothing fails");
  assert.equal(out.afterInside, "none, the earlier write");
  assert.deepEqual([out.passed, out.passedEnd], [[LINE], 1], "what the test passes on is captured");
  assert.deepEqual([out.before, out.beforeEnd], [[LINE], 0]);
  assert.deepEqual([out.duringHeld, out.afterHeld], ["data", "data, the test's"]);
  assert.equal(stderr, "");
});

test("one call: a server that appeared under the fixture's TMUX_TMPDIR with no line fails it; a line with no server does not", (t) => {
  const { out, stderr, dir } = inFixture(t, `
let e = expect(); appear();
out.started = ended(e); vanish();
e = expect(); appear(); process.stderr.write(line);
out.startedWithLine = ended(e); vanish();
e = expect(); appear();
out.notAsserted = ended(e, { assert: false }); vanish();
e = expect(); process.stderr.write(line);
out.planned = ended(e);
e = expect(); appear();
out.wasThere = ended(expect()); out.outer = typeof ended(e); vanish();
`);
  assert.match(out.started, /a tmux server appeared at .* during this fixture's call and the kernel never wrote the warning the fixture expects/);
  assert.ok(out.started.includes(oatsSocket(dir)) && out.started.includes(LINE), "it names the socket and the line");
  assert.equal(out.startedWithLine, 1);
  assert.equal(out.notAsserted, 0, "a call that threw has its own error to give");
  assert.equal(out.planned, 1, "the kernel writes the line where it plans a start: a stand-in tmux, a refusal after it");
  assert.equal(out.wasThere, 0, "a server that was there before the call is not one that appeared in it");
  assert.equal(out.outer, "string");
  assert.equal(stderr, "");
});

test("a session environment: a captured line with nothing ever created under its TMUX_TMPDIR fails it; a server with no line does not", (t) => {
  const { out, stderr, dir } = inFixture(t, `
const wait = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); // a directory's time has a grain
let e = expect({ lifetime: true }); process.stderr.write(line); process.stderr.write(line);
out.nowhere = ended(e);
e = expect({ lifetime: true }); process.stderr.write(line); appear();
out.started = ended(e); vanish();
wait(); e = expect({ lifetime: true }); process.stderr.write(line); wait(); appear(); vanish();
out.startedAndKilled = ended(e);
e = expect({ lifetime: true }); appear();
out.byAChild = ended(e); vanish();
e = expect({ lifetime: true });
out.nothing = ended(e);
`);
  assert.match(out.nowhere, /wrote this session environment's expected warning 2 times and nothing was ever created under its TMUX_TMPDIR/);
  assert.ok(out.nowhere.includes(dir) && out.nowhere.includes(LINE));
  assert.deepEqual([out.started, out.startedAndKilled], [1, 1]);
  assert.equal(out.byAChild, 0, "who planned a server is not visible from its socket: a child's line is on the child's stderr");
  assert.equal(out.nothing, 0);
  assert.equal(stderr, "");
});

test("the kernel's own line, from a real start in a session environment, is each sentence the helper holds; captured, it is counted once a start", (t) => {
  const { out, stderr } = inFixture(t, `
const restore = H.isolateSessionEnvironment(base);
const core = await import(${JSON.stringify(CORE)});
/** Kill the fixture's server and wait until it has exited: the next call plans a start again. */
const killServer = () => {
  const on = (...args) => execFileSync("tmux", ["-S", H.oatsSocket(), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const pid = Number(on("display-message", "-p", "#{pid}"));
  on("kill-server");
  const gone = () => { try { process.kill(pid, 0); return false; } catch { return true; } };
  for (let i = 0; !gone() && i < 400; i += 1) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
};
/** What the kernel writes on stderr while it makes sure of the session, held as a test holds it. */
const heard = (session) => {
  const earlier = process.stderr.write, said = [];
  process.stderr.write = (chunk) => { said.push(String(chunk)); return true; };
  try { core.ensureOatsTmuxSession(session, base); } finally { process.stderr.write = earlier; }
  return said;
};
// Captured: the first call starts the server, the second finds it.
let e = H.expectLoginFallback(); core.ensureOatsTmuxSession("one", base);
out.first = ended(e);
e = H.expectLoginFallback(); core.ensureOatsTmuxSession("two", base);
out.second = ended(e);
killServer();
out.missingShell = heard("three");
killServer();
delete process.env.OATS_TEST_LOGIN_SHELL;
out.notHome = heard("four");
try { restore(); out.restored = true; } catch (err) { out.restored = err.message; }
`, { isolated: true });
  assert.deepEqual([out.first, out.second], [1, 0]);
  assert.deepEqual(out.missingShell, [LOGIN_FALLBACK_WARNING["no-shell"]]);
  assert.deepEqual(out.notHome, [LOGIN_FALLBACK_WARNING["not-home"]]);
  assert.equal(out.restored, true, "the session environment's own check holds: its line came, and its server was there");
  assert.equal(stderr, "");
});
