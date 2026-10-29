// scripts/named-test-run.mjs running files: each alone, one after another, with its counts, its exit
// status and its duration; a failing file fails the run and the ones after it still run; a file
// that does not end is killed with its whole process group, reported as timed out, and the run
// goes on. The files here are fakes in a temporary tree, run by the real `node --test`; the
// timeout is a parameter (the command line uses the script's constant).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fakeProgram, fixtureBase } from "./helpers/host-fixture.mjs";
import { buildTable, conclude, defaultTmuxSocket, runFile, runFiles, verdict } from "../scripts/named-test-run.mjs";

// The shared fixtures' base, for its short path: a socket's path has about a hundred bytes, and
// macOS's own temporary directory takes half. It is the temporary directory when that is short,
// /tmp otherwise.
const tree = fixtureBase("oats-mtr-");
const started = [];
test.after(() => {
  for (const pid of started) { try { process.kill(pid, "SIGKILL"); } catch { /* gone, as it should be */ } }
  rmSync(tree, { recursive: true, force: true });
});
// The fakes are written while the module loads: a write that throws ends the file before the
// `after` hook above could run, so the tree is removed here, and the error goes on.
const fake = (name, body) => {
  try { mkdirSync(join(tree, "test"), { recursive: true }); writeFileSync(join(tree, "test", name), body); }
  catch (error) { rmSync(tree, { recursive: true, force: true }); throw error; }
  return `test/${name}`;
};
const HEAD = 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { spawn } from "node:child_process";\nimport { mkdirSync, writeFileSync } from "node:fs";\n';
// A process that does nothing for a minute, and the line that records who is running.
const IDLE = 'spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: STDIO, detached: DETACHED })';
const pids = (name) => `writeFileSync(new URL("./${name}.pids", import.meta.url), JSON.stringify([process.pid, child.pid]));`;

const PASS = fake("pass.test.mjs", `${HEAD}test("one", () => {});\ntest("two", () => {});\ntest("not here", { skip: "no tmux" }, () => {});\n`);
const FAIL = fake("fail.test.mjs", `${HEAD}test("holds", () => {});\ntest("does not", () => assert.equal(1, 2));\n`);
const SKIP = fake("skip.test.mjs", `${HEAD}test("a", { skip: true }, () => {});\ntest("b", { skip: true }, () => {});\n`);
// Starts a process of its own, then never ends.
const HANG = fake("hang.test.mjs", `${HEAD}const child = ${IDLE.replace("STDIO", '"ignore"').replace("DETACHED", "false")};\n${pids("hang")}\ntest("never ends", () => new Promise(() => { setInterval(() => {}, 1000); }));\n`);
// Passes, and leaves a process running behind it.
const LINGER = fake("linger.test.mjs", `${HEAD}const child = ${IDLE.replace("STDIO", '"ignore"').replace("DETACHED", "false")};\nchild.unref();\n${pids("linger")}\ntest("passes", () => {});\n`);
// Passes, and leaves a server behind, listening where an unisolated tmux server named oats would:
// a daemon out of the file's group, as a tmux server is.
const LEAK = fake("leak.test.mjs", `${HEAD}import { existsSync } from "node:fs";
test("starts a server at the default place", async () => {
  const dir = \`\${process.env.TMUX_TMPDIR}/tmux-\${process.getuid()}\`, socket = \`\${dir}/oats\`;
  mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, ["-e", "require('node:net').createServer().listen(process.argv[1]); setTimeout(() => {}, 60000)", socket], { stdio: "ignore", detached: true });
  child.unref();
  ${pids("leak")}
  while (!existsSync(socket)) await new Promise((done) => setTimeout(done, 20));
});
`);

const collect = () => { const chunks = []; return { write: (chunk) => chunks.push(String(chunk)), text: () => chunks.join("") }; };
/** Whether a process is gone: no such pid, or one that has ended and only waits to be reaped. */
function gone(pid) {
  try { process.kill(pid, 0); } catch { return true; }
  try { return execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().startsWith("Z"); } catch { return true; }
}
async function allGone(list) {
  for (let i = 0; i < 100 && !list.every(gone); i++) await new Promise((done) => setTimeout(done, 50));
  return list.filter((pid) => !gone(pid));
}
const recorded = (name) => { const list = JSON.parse(readFileSync(join(tree, "test", `${name}.pids`), "utf8")); started.push(...list); return list; };

test("named-test-run runFiles: each file alone and in order; a failing file fails the run, and the files after it still run", async () => {
  const out = collect();
  const runs = await runFiles([FAIL, PASS, SKIP], { cwd: tree, write: out.write, timeoutMs: 120_000 });
  assert.deepEqual(runs.map((run) => [run.file, run.counts, run.code, run.signal, run.timedOut, run.leftover, run.leak]), [
    [FAIL, { tests: 2, pass: 1, fail: 1, cancelled: 0, skipped: 0, todo: 0 }, 1, null, false, false, false],
    [PASS, { tests: 3, pass: 2, fail: 0, cancelled: 0, skipped: 1, todo: 0 }, 0, null, false, false, false],
    [SKIP, { tests: 2, pass: 0, fail: 0, cancelled: 0, skipped: 2, todo: 0 }, 0, null, false, false, false],
  ]);
  assert.deepEqual(runs.map((run) => verdict(run).label), ["FAILED", "passed", "no test passed"]);
  assert.ok(runs.every((run) => run.durationMs > 0));
  // The log: each file's command, its own output, then its result, one file after another.
  const text = out.text(), order = [
    `=== 1/3 ${FAIL}: node --test ${FAIL} ===`, "does not", `=== ${FAIL}: FAILED (exit 1); tests 2, passed 1, failed 1, skipped 0, cancelled 0, todo 0; exit 1;`,
    `=== 2/3 ${PASS}: node --test ${PASS} ===`, `=== ${PASS}: passed (exit 0); tests 3, passed 2, failed 0, skipped 1, cancelled 0, todo 0; exit 0;`,
    `=== 3/3 ${SKIP}: node --test ${SKIP} ===`, `=== ${SKIP}: no test passed (exit 0, and no test passed (skipped, or none): this is not evidence); tests 2, passed 0, failed 0, skipped 2, cancelled 0, todo 0; exit 0;`,
  ];
  let from = 0;
  for (const part of order) { const at = text.indexOf(part, from); assert.ok(at >= 0, `missing, or out of order: ${part}\n${text}`); from = at + part.length; }
  const table = buildTable(runs);
  assert.match(table[1], /^test\/fail\.test\.mjs +FAILED +2 +1 +1 +0 +0 +0 +1 +\d+\.\ds$/);
  assert.match(table[3], /^test\/skip\.test\.mjs +no test passed +2 +0 +0 +2 +0 +0 +0 +\d+\.\ds$/);
  assert.deepEqual(conclude(runs), { ok: false, lines: ["3 files: 2 without a failure, 1 failed or timed out.", "1 of them passed no test (skipped, or none): a file that only skips is not evidence.", "Result: FAILED"] });
  assert.equal(conclude(runs.slice(1)).ok, true, "without the failing file the run passes");
});

test("named-test-run runFiles: a file that does not end is killed with its whole process group, reported as timed out, and the run goes on", async () => {
  const out = collect();
  const runs = await runFiles([HANG, PASS], { cwd: tree, write: out.write, timeoutMs: 6_000 });
  assert.ok(existsSync(join(tree, "test", "hang.pids")), `the hanging file did not start within its time:\n${out.text()}`);
  const [hung, after] = runs;
  assert.deepEqual([hung.timedOut, hung.counts, hung.code, hung.signal, hung.leftover], [true, null, null, "SIGKILL", false]);
  assert.deepEqual(verdict(hung), { ok: false, label: "TIMED OUT", why: "no end after its time: its process group was killed (SIGKILL)" });
  assert.ok(hung.durationMs >= 6_000 && hung.durationMs < 20_000, `killed at its timeout: ${hung.durationMs}ms`);
  // The file's own process and the one it started are both gone: the group, not only its leader.
  assert.deepEqual(await allGone(recorded("hang")), [], "processes of the hung file's group still run");
  assert.deepEqual([after.file, verdict(after).label, after.counts?.pass], [PASS, "passed", 2], "the file after it ran");
  assert.match(out.text(), /\(no end after 6\.0s: killing the file's process group\)/);
  assert.match(out.text(), /=== test\/hang\.test\.mjs: TIMED OUT \(no end after its time: its process group was killed \(SIGKILL\)\); counts unknown; exit SIGKILL; \d+\.\ds ===/);
  assert.match(buildTable(runs)[1], /^test\/hang\.test\.mjs +TIMED OUT +- +- +- +- +- +- +SIGKILL +\d+\.\ds$/);
  assert.deepEqual(conclude(runs).lines.slice(-1), ["Result: FAILED"]);
});

test("named-test-run runFile: a file that ends leaves no process of its group running for the next file", async () => {
  const out = collect();
  const run = await runFile(LINGER, { cwd: tree, write: out.write, timeoutMs: 120_000 });
  assert.deepEqual([verdict(run).label, run.code, run.timedOut, run.leftover], ["passed", 0, false, true], out.text());
  assert.deepEqual(await allGone(recorded("linger")), []);
  const said = collect();
  await runFiles([LINGER], { cwd: tree, write: said.write, timeoutMs: 120_000 });
  recorded("linger");
  assert.match(said.text(), /\(processes it started were still running when it ended: they were killed\)/);
});

// `npm test` puts the tree's node_modules/.bin first on PATH, and the tests find the tree's
// installed binaries there by name (pi, for a fixture instance): a file run alone does too.
test("named-test-run runFile: a file finds the tree's node_modules/.bin binaries by name, first on PATH", async () => {
  const bin = join(tree, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  fakeProgram(bin, "oats-mtr-tree-bin", "echo from-the-tree");
  const file = "test/tree-bin.test.mjs";
  writeFileSync(join(tree, file), `${HEAD}import { execFileSync } from "node:child_process";\ntest("runs the tree's binary by name", () => {\n  assert.equal(execFileSync("oats-mtr-tree-bin", { encoding: "utf8" }).trim(), "from-the-tree");\n  assert.equal(process.env.PATH.split(${JSON.stringify(delimiter)})[0], ${JSON.stringify(bin)});\n});\n`);
  const out = collect(), run = await runFile(file, { cwd: tree, env: { ...process.env, PATH: dirname(process.execPath) }, write: out.write, timeoutMs: 120_000 });
  assert.deepEqual([verdict(run).label, run.counts?.pass], ["passed", 1], out.text());
});

// The seam: a plain script in place of `node --test <file>`, for the ends a test runner does not have on request.
const script = (name, body) => { writeFileSync(join(tree, name), body); return name; };
const plain = { cwd: tree, command: [process.execPath], timeoutMs: 120_000 };
const SUMMARY = ["tests 1", "suites 0", "pass 1", "fail 0", "cancelled 0", "skipped 0", "todo 0", "duration_ms 1"].map((line) => `# ${line}`).join("\\n");

// The time a file gets is the runner's constant, passed in: without one, every file would be killed
// at once and read as hung. A caller that forgets it is refused, and nothing is started.
test("named-test-run runFile: a missing or non-positive timeout is refused before anything runs", async () => {
  for (const timeoutMs of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, "300000"]) {
    assert.throws(() => runFile(PASS, { cwd: tree, timeoutMs }), /^TypeError: runFile: timeoutMs must be a positive number of milliseconds, got /, String(timeoutMs));
  }
  await assert.rejects(runFiles([PASS], { cwd: tree, write: () => {} }), /runFile: timeoutMs must be a positive number of milliseconds, got undefined/);
});

test("named-test-run runFile: a file that prints no summary has unknown counts and fails with its exit status or signal", async () => {
  const cases = [
    [script("crash.mjs", 'console.error("boom"); process.exit(3);\n'), { code: 3, signal: null }, /^exit 3, and no summary was printed$/],
    [script("killed.mjs", 'process.kill(process.pid, "SIGTERM"); setTimeout(() => {}, 60000);\n'), { code: null, signal: "SIGTERM" }, /^exit SIGTERM, and no summary was printed$/],
    [script("silent.mjs", 'console.log("looks fine");\n'), { code: 0, signal: null }, /^exit 0, but no summary was printed: nothing says a test ran$/],
  ];
  for (const [file, { code, signal }, why] of cases) {
    const out = collect(), run = await runFile(file, { ...plain, write: out.write });
    assert.deepEqual([run.counts, run.code, run.signal, run.timedOut], [null, code, signal, false], file);
    const v = verdict(run);
    assert.deepEqual([v.ok, v.label], [false, "FAILED"]);
    assert.match(v.why, why);
  }
  // Both of its streams reach the log, and a summary on stderr is not the runner's.
  const out = collect();
  const run = await runFile(script("stderr.mjs", `console.log("to stdout"); console.error("${SUMMARY}");\n`), { ...plain, write: out.write });
  assert.equal(run.counts, null);
  assert.ok(out.text().includes("to stdout") && out.text().includes("# tests 1"));
  // A file that cannot be started at all is a failure, not a crash of the run.
  const absent = await runFile("test/pass.test.mjs", { ...plain, cwd: join(tree, "no-such-directory"), write: collect().write });
  assert.deepEqual([verdict(absent).ok, verdict(absent).label], [false, "FAILED"]);
  assert.match(verdict(absent).why, /could not be started/);
});

test("named-test-run runFile: a process that keeps the file's output open after it ended does not hold the run", async () => {
  // In the file's group: ended with it, after the grace.
  const holder = script("holder.mjs", `import { spawn } from "node:child_process";\nimport { writeFileSync } from "node:fs";\nconst child = ${IDLE.replace("STDIO", '["ignore", "inherit", "inherit"]').replace("DETACHED", "false")};\nchild.unref();\nwriteFileSync(new URL("./holder.pids", import.meta.url), JSON.stringify([child.pid]));\nconsole.log("${SUMMARY}");\n`);
  const before = Date.now(), run = await runFile(holder, { ...plain, graceMs: 300, write: collect().write });
  const held = JSON.parse(readFileSync(join(tree, "holder.pids"), "utf8")); started.push(...held);
  assert.deepEqual([run.code, run.leftover, verdict(run).label, run.counts.pass], [0, true, "passed", 1]);
  assert.ok(Date.now() - before < 30_000, "the run did not wait for the holder's minute");
  assert.deepEqual(await allGone(held), []);
  // Out of the file's group (a daemon, as a tmux server is): not this script's to kill. It is left
  // running, and the run goes on without the output it holds.
  const daemon = script("daemon.mjs", `import { spawn } from "node:child_process";\nimport { writeFileSync } from "node:fs";\nconst child = ${IDLE.replace("STDIO", '["ignore", "inherit", "inherit"]').replace("DETACHED", "true")};\nchild.unref();\nwriteFileSync(new URL("./daemon.pids", import.meta.url), JSON.stringify([child.pid]));\nconsole.log("${SUMMARY}");\n`);
  const began = Date.now(), escaped = await runFile(daemon, { ...plain, graceMs: 300, write: collect().write });
  const [daemonPid] = JSON.parse(readFileSync(join(tree, "daemon.pids"), "utf8")); started.push(daemonPid);
  assert.deepEqual([escaped.code, escaped.leftover, verdict(escaped).label], [0, false, "passed"]);
  assert.ok(Date.now() - began < 30_000);
  assert.equal(gone(daemonPid), false, "a process outside the file's group is not killed");
});

test("named-test-run runFiles: the file after which tmux's default socket first exists is marked, and the run fails for it", async () => {
  const env = { ...process.env, TMUX_TMPDIR: mkdtempSync(join(tree, "tmux-")) };
  const socket = defaultTmuxSocket(env);
  assert.equal(socket, join(env.TMUX_TMPDIR, `tmux-${process.getuid()}`, "oats"));
  // The longest path a fake listens on. macOS takes 104 bytes for a socket's path, Linux 108.
  assert.ok(Buffer.byteLength(socket) < 104, `the fixture's base is too long for a socket's path on macOS: ${socket}`);
  // No file leaves one: nothing is marked.
  const clean = await runFiles([PASS, PASS], { cwd: tree, env, write: collect().write, timeoutMs: 120_000, tmuxSocket: socket });
  assert.deepEqual(clean.map((run) => run.leak), [false, false]);
  assert.equal(conclude(clean).ok, true);

  const out = collect();
  const runs = await runFiles([PASS, LEAK, PASS], { cwd: tree, env, write: out.write, timeoutMs: 120_000, tmuxSocket: socket });
  assert.deepEqual(runs.map((run) => [verdict(run).label, run.leak]), [["passed", false], ["passed", true], ["passed", false]], `only the file that made it is marked:\n${out.text()}`);
  assert.ok(existsSync(socket), "nothing is removed");
  const [, server] = recorded("leak");
  assert.equal(gone(server), false, "nothing is killed: the server it left is not this script's to end");
  assert.match(out.text(), /\(left a tmux server on the default socket: ".*\/tmux-\d+\/oats" exists now and did not before; nothing was killed or removed\)/);
  assert.match(buildTable(runs)[2], /^test\/leak\.test\.mjs +passed .* left a tmux server on the default socket$/);
  assert.ok(buildTable(runs).filter((line) => line.includes("left a tmux server")).length === 1);
  assert.deepEqual(conclude(runs), { ok: false, lines: [
    "3 files: 3 without a failure, 0 failed or timed out.",
    "test/leak.test.mjs left a tmux server on the default socket: its fixture did not isolate its tmux server, and the run fails for it.",
    "Result: FAILED",
  ] });

  // There before the first file: not a file's doing. The check is skipped, and no file is marked.
  const later = await runFiles([PASS, LEAK], { cwd: tree, env, write: collect().write, timeoutMs: 120_000, tmuxSocket: socket });
  recorded("leak");
  assert.deepEqual(later.map((run) => run.leak), [false, false]);
  assert.equal(conclude(later).ok, true);
  // And with no path to look at (the header found the socket already there), nothing is looked for.
  const skipped = await runFiles([PASS], { cwd: tree, env, write: collect().write, timeoutMs: 120_000, tmuxSocket: null });
  assert.deepEqual(skipped.map((run) => run.leak), [false]);
});
