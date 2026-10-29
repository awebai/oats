// The warm reader's lifetime (awebai/oats#1630 D8; docs/desktop-cli-api.md "The warm reader"; lib/reader.mjs).
// A reader lives as long as its client holds it: stdin EOF, EPIPE on stdout or SIGTERM/SIGINT/SIGHUP end it at
// once, and a request in flight is then not answered: its read session is closed from the `exit` handler, which
// kills its git children. A request is kept in flight by a workspace member whose host accepts and never answers
// (test/cli-read-budget.test.mjs: a local HTTP server reached through `insteadOf`), so its `git ls-remote` (the
// member's head observation, lib/remote.mjs) is still running, holding the connection, when the reader is ended;
// the connection closing is the git gone. And the reader's stdout carries protocol lines only: a stray
// console.log or stdout write goes to stderr, and no child on the read path inherits fd 1.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { OATS_VERSION } from "../lib/version.mjs";
import { systemExecutable } from "./helpers/host-fixture.mjs";
import { CLI, v2Deployment } from "./helpers/v2-deployment.mjs";

/** This file's own slow host: another file's run on the same host never shares its processes' command lines. */
const SLOW_HOST = `slow-reader-${process.pid}.example`;
const SLOW = `https://${SLOW_HOST}/org/slow`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms, what) {
  for (const deadline = Date.now() + ms; !check();) {
    if (Date.now() > deadline) assert.fail(`${what} (waited ${ms} ms)`);
    await sleep(25);
  }
}

/** A reader child on `env`, ended with `fx` if still running: `next()` is its next stdout line as a frame, `send(...)` writes request lines (an
 *  object is JSON-encoded; a string is sent as it is) in one write, `end()` closes stdin and waits for its exit. */
function startReader(fx, env, { nodeArgs = [] } = {}) {
  const child = spawn(process.execPath, [...nodeArgs, CLI, "reader", "--stdio"], { env, stdio: ["pipe", "pipe", "pipe"] });
  const r = { child, lines: [], stderr: "", exit: null };
  // A test that fails with its reader running ends it before the fixture's leftover check.
  fx.beforeCleanup(() => { if (!r.exit) child.kill("SIGTERM"); });
  let buf = "", read = 0;
  child.stdin.on("error", () => { /* the reader is gone: what it answered is asserted */ });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d) => { buf += d; for (let nl; (nl = buf.indexOf("\n")) !== -1;) { r.lines.push(buf.slice(0, nl)); buf = buf.slice(nl + 1); } });
  child.stdout.on("error", () => { /* destroyed on purpose (EPIPE) */ });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d) => { r.stderr += d; });
  r.exited = new Promise((done) => child.on("close", (code, signal) => { r.exit = { code, signal }; done(r.exit); }));
  r.next = async (ms = 60_000) => {
    await until(() => read < r.lines.length || r.exit, ms, `no line from the reader\n${r.stderr}`);
    if (read >= r.lines.length) assert.fail(`the reader exited (${JSON.stringify(r.exit)}) before its next line\n${r.stderr}`);
    return JSON.parse(r.lines[read++]);
  };
  r.send = (...requests) => child.stdin.write(requests.map((q) => `${typeof q === "string" ? q : JSON.stringify(q)}\n`).join(""));
  return r;
}
async function helloed(fx, env, opts) {
  const r = startReader(fx, env, opts);
  assert.deepEqual(await r.next(), { readerApi: 1, version: OATS_VERSION, reads: ["status", "workspace status"] });
  return r;
}
/** How the reader ended, and how long after `since`. */
async function ended(r, since, ms = 10_000) {
  await until(() => r.exit, ms, `the reader is still running\n${r.stderr}`);
  return { ...r.exit, elapsed: Date.now() - since };
}

/** An HTTP server that accepts every request and never answers; `open()` counts the connections still open. */
async function silentServer() {
  const sockets = new Set();
  const server = createServer(() => { /* never answers */ });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, open: () => sockets.size, close: () => { for (const s of sockets) s.destroy(); server.close(); } };
}

/** Command lines (argv) of this host's processes that name the slow member: Linux only (/proc), else null. */
function slowGits() {
  if (process.platform !== "linux") return null;
  const found = [];
  for (const pid of readdirSync("/proc").filter((n) => /^\d+$/.test(n))) {
    let argv;
    try { argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean); } catch { continue; }
    if (argv.some((a) => a.includes(SLOW_HOST))) found.push(argv);
  }
  return found;
}

/** A fixture whose workspace has a member whose host never answers, and a reader on it with a request in flight
 *  for `read(dir)`: its git is connected when this returns. `instance`: spawn one first (status reads the
 *  members only for an instance's drift). */
async function inFlight(t, read, { instance = false } = {}) {
  const fx = v2Deployment({ t });
  if (instance) await fx.spawn("dev", { instance: "dev-slow" });
  // Registered after the fixture's own cleanup, which therefore checks for leftover processes first.
  const server = await silentServer();
  t.after(server.close);
  fx.commit({ "oats-workspace.yaml": { yaml: { schemaVersion: 2, name: "fixture", members: [fx.ref, SLOW], teams: { global: { description: "Fixture team" } }, defaults: { knowledge: "none", messaging: "none", tasks: "none" } } } });
  // A budget far longer than the test: the git is still running when the reader is ended.
  const env = { ...fx.env, OATS_READ_REMOTE_BUDGET_MS: "30000", GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.http://127.0.0.1:${server.port}/.insteadOf`, GIT_CONFIG_VALUE_0: `https://${SLOW_HOST}/` };
  const r = await helloed(fx, env);
  r.send({ id: "slow", argv: read(fx.dep) });
  await until(() => server.open() > 0, 30_000, `git never reached the silent member\n${r.stderr}`);
  const gits = slowGits();
  if (gits) assert.ok(gits.some((argv) => argv.includes("ls-remote")), `the read's git in flight is a git ls-remote: ${JSON.stringify(gits)}`);
  assert.equal(r.lines.length, 1, "the request is in flight, not answered");
  return { fx, server, r };
}
/** The read's git is gone: the silent server's connections closed and (Linux) no process names the member. */
async function assertGitGone(server) {
  await until(() => server.open() === 0, 5_000, "the read's git still holds its connection");
  const gits = slowGits();
  if (gits) assert.deepEqual(gits, [], "no git of the read outlives the reader");
}

test("stdin EOF ends an idle reader at once, exit 0; SIGINT and SIGHUP end it with 130 and 129", { timeout: 60_000 }, async (t) => {
  const fx = v2Deployment({ t });
  const r = await helloed(fx, fx.env);
  const since = Date.now();
  r.child.stdin.end();
  const end = await ended(r, since);
  assert.deepEqual([end.code, end.signal], [0, null], r.stderr);
  assert.ok(end.elapsed < 5_000, `exited ${end.elapsed} ms after EOF`);
  assert.equal(r.lines.length, 1, "nothing after the hello");
  for (const [signal, code] of [["SIGINT", 130], ["SIGHUP", 129]]) {
    const s = await helloed(fx, fx.env);
    s.child.kill(signal);
    const out = await ended(s, Date.now());
    assert.deepEqual([out.code, out.signal], [code, null], `${signal}: ${s.stderr}`);
  }
});

test("stdin EOF with a workspace status in flight: the reader exits 0 without answering, and kills its git ls-remote", { timeout: 120_000 }, async (t) => {
  const { r, server } = await inFlight(t, (dir) => ["workspace", "status", "--dir", dir, "--json"]);
  const since = Date.now();
  r.child.stdin.end();
  const end = await ended(r, since);
  assert.deepEqual([end.code, end.signal], [0, null], r.stderr);
  assert.ok(end.elapsed < 5_000, `exited ${end.elapsed} ms after EOF`);
  assert.equal(r.lines.length, 1, `no answer to the request in flight: ${r.lines.slice(1).join("\n")}`);
  await assertGitGone(server);
});

test("SIGTERM with a status in flight: the reader exits 143 without answering, and kills its git ls-remote", { timeout: 120_000 }, async (t) => {
  const { r, server } = await inFlight(t, (dir) => ["status", "--dir", dir, "--json"], { instance: true });
  const since = Date.now();
  r.child.kill("SIGTERM");
  const end = await ended(r, since);
  assert.deepEqual([end.code, end.signal], [143, null], r.stderr);
  assert.ok(end.elapsed < 5_000, `exited ${end.elapsed} ms after SIGTERM`);
  assert.equal(r.lines.length, 1, `no answer to the request in flight: ${r.lines.slice(1).join("\n")}`);
  await assertGitGone(server);
});

test("EPIPE: a reader whose client closed its stdout exits 0 on its next write", { timeout: 60_000 }, async (t) => {
  const fx = v2Deployment({ t });
  const r = await helloed(fx, fx.env);
  r.child.stdout.destroy();
  const since = Date.now();
  // stdin stays open: only the write that fails ends it.
  r.send({ id: 1, argv: ["status", "--dir", fx.dep, "--json"] });
  const end = await ended(r, since, 30_000);
  assert.deepEqual([end.code, end.signal], [0, null], r.stderr);
});

test("stray stdout output goes to stderr: the reader's stdout carries protocol lines only", { timeout: 60_000 }, async (t) => {
  const fx = v2Deployment({ t });
  // A module loaded first, as a dependency's stray logging would be, that writes to stdout on SIGUSR2.
  const preload = join(fx.base, "stray.mjs");
  writeFileSync(preload, 'process.on("SIGUSR2", () => { console.log("stray-log"); process.stdout.write("stray-write\\n"); });\n');
  const r = await helloed(fx, fx.env, { nodeArgs: ["--import", pathToFileURL(preload).href] });
  r.child.kill("SIGUSR2");
  await until(() => r.stderr.includes("stray-log") && r.stderr.includes("stray-write"), 10_000, `the strays reached stderr\n${r.stderr}`);
  // And while a request is in flight.
  r.send({ id: "a", argv: ["workspace", "status", "--dir", fx.dep, "--json"] }, { id: "b", argv: ["status", "--dir", fx.dep, "--json"] });
  r.child.kill("SIGUSR2");
  assert.equal((await r.next()).id, "a");
  assert.equal((await r.next()).id, "b");
  r.child.stdin.end();
  assert.deepEqual((await ended(r, Date.now())).code, 0, r.stderr);
  assert.equal(r.stderr.match(/stray-log/g).length, 2, r.stderr);
  assert.equal(r.stderr.match(/stray-write/g).length, 2, r.stderr);
  assert.equal(r.lines.length, 3);
  for (const line of r.lines) {
    const frame = JSON.parse(line);
    assert.ok(frame && typeof frame === "object" && ("readerApi" in frame || "id" in frame), `a protocol frame: ${line}`);
  }
});

test("no child on the read path inherits the reader's stdout", { skip: process.platform !== "linux" && "reads /proc/<pid>/fd", timeout: 120_000 }, async (t) => {
  const fx = v2Deployment({ t });
  await fx.spawn("dev", { instance: "dev-fd" }); // an instance: status reads its session and process state
  // Shims first on PATH: each logs its own fd 1, then runs the host's binary.
  const shims = join(fx.base, "fd-shims"), log = join(fx.base, "fd1.log");
  mkdirSync(shims);
  writeFileSync(log, "");
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const shimmed = [];
  for (const name of ["tmux", "git", "lsof", "ps"]) {
    let real;
    try { real = systemExecutable(name); } catch { continue; } // not on this host
    writeFileSync(join(shims, name), `#!/bin/sh\nprintf '%s %s\\n' ${name} "$(readlink /proc/$$/fd/1)" >> ${q(log)}\nexec ${q(real)} "$@"\n`);
    chmodSync(join(shims, name), 0o755);
    shimmed.push(name);
  }
  assert.ok(shimmed.includes("git"), "git is on this host");
  const r = await helloed(fx, { ...fx.env, PATH: `${shims}:${fx.env.PATH}` });
  const stdout = readlinkSync(`/proc/${r.child.pid}/fd/1`);
  const reads = [["status", "--dir", fx.dep, "--json"], ["workspace", "status", "--dir", fx.dep, "--json"], ["status", "--max-age", "60", "--dir", fx.dep, "--json"]];
  r.send(...reads.map((argv, id) => ({ id, argv })));
  for (const id of reads.keys()) {
    const frame = await r.next();
    assert.equal(frame.id, id);
    assert.equal(frame.exit, 0, JSON.stringify(frame));
  }
  r.child.stdin.end();
  assert.equal((await ended(r, Date.now())).code, 0, r.stderr);
  const logged = readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => line.split(" "));
  assert.ok(logged.some(([name]) => name === "git"), `the shims ran: ${JSON.stringify(logged)}`);
  const inherited = logged.filter(([, target]) => target === stdout);
  assert.deepEqual(inherited, [], `children that inherited the reader's stdout (${stdout})`);
});
