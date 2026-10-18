// scripts/linux-tests.mjs, the Linux platform of the hand-started test runs: how it reads the
// runner's user manager and what the header says of it. Nothing here asks this host's own systemd:
// the programs are fakes. The two steps with this platform are in named-test-run.test.mjs, the
// workflow's terms in linux-tests-workflow.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILE_TIMEOUT_MS, RETRY_PAUSE_MS, USER_MANAGER_WAIT_MS, askUserManager, linux, linuxPlatform, notYetReachable, prettyName, userManagerAnswer } from "../scripts/linux-tests.mjs";
import { fakeProgram } from "./helpers/host-fixture.mjs";
import { formatHeader } from "../scripts/named-test-run.mjs";

const dir = mkdtempSync(join(tmpdir(), "oats-linux-tests-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const program = (name, body) => fakeProgram(dir, name, body);

test("linux-tests: the request, the title and the wait are the runner's own", () => {
  assert.deepEqual(linux.request, { ref: "LINUX_TESTS_REF", files: "LINUX_TESTS_FILES" });
  assert.equal(linux.title, "Linux test run");
  assert.equal(linux.script, "scripts/linux-tests.mjs");
  assert.equal(linux.fileTimeoutMs, FILE_TIMEOUT_MS);
  assert.equal(USER_MANAGER_WAIT_MS, 60_000, "the bound the spec set: a change comes with a measured reason");
  assert.ok(RETRY_PAUSE_MS > 0 && RETRY_PAUSE_MS * 10 <= USER_MANAGER_WAIT_MS, "the manager is asked again many times within the bound");
});

test("linux-tests prettyName: the os-release name, quoted or not", () => {
  assert.equal(prettyName('NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\nID=ubuntu\n'), "Ubuntu 24.04.1 LTS");
  assert.equal(prettyName("PRETTY_NAME='Debian 12'\n"), "Debian 12");
  assert.equal(prettyName("PRETTY_NAME=Plain\n"), "Plain");
  for (const none of ["", "NAME=x\n", null, 'PRETTY_NAME=""\n']) assert.equal(prettyName(none), null);
});

test("linux-tests userManagerAnswer: running and degraded have answered, whatever the exit status; anything else has not, and says what it was", () => {
  assert.deepEqual(userManagerAnswer({ status: 0, stdout: "running\n", stderr: "" }, 60_000), { answered: true, state: "running" });
  assert.deepEqual(userManagerAnswer({ status: 1, stdout: "degraded\n", stderr: "" }, 60_000), { answered: true, state: "degraded" });
  for (const state of ["starting", "initializing", "offline", "maintenance", "stopping", "unknown"]) {
    assert.deepEqual(userManagerAnswer({ status: 1, stdout: `${state}\n`, stderr: "" }, 60_000), { answered: false, state });
  }
  assert.deepEqual(userManagerAnswer({ status: 1, stdout: "", stderr: "Failed to connect to bus: No medium found\nmore\n" }, 60_000), { answered: false, state: "Failed to connect to bus: No medium found" });
  assert.deepEqual(userManagerAnswer({ status: 1, stdout: "", stderr: "" }, 60_000), { answered: false, state: "exit 1" });
  assert.deepEqual(userManagerAnswer({ status: null, signal: "SIGKILL", error: Object.assign(new Error("spawnSync ETIMEDOUT"), { code: "ETIMEDOUT" }) }, 60_000), { answered: false, state: "no answer within 60.0s" });
  assert.deepEqual(userManagerAnswer({ status: null, error: Object.assign(new Error("spawnSync ENOENT"), { code: "ENOENT" }) }, 60_000), { answered: false, state: "could not be asked (ENOENT)" });
});

test("linux-tests notYetReachable: a manager whose bus is not there yet, and nothing else", () => {
  for (const state of ["offline", "unknown", "Failed to connect to bus: No such file or directory", "Failed to connect to bus: No medium found"]) assert.equal(notYetReachable(state), true, state);
  for (const state of ["running", "degraded", "starting", "maintenance", "stopping", "no answer within 60.0s", "could not be asked (ENOENT)", "exit 1"]) assert.equal(notYetReachable(state), false, state);
});

test("linux-tests askUserManager: --wait only when asked to wait, and never longer than the bound", () => {
  const echo = program("systemctl-args", 'echo "$*" >&2; echo running');
  assert.deepEqual({ ...askUserManager({ systemctl: echo, wait: true, waitMs: 10_000, env: process.env }), ms: 0 }, { answered: true, state: "running", waited: true, asks: 1, ms: 0 });
  const args = program("systemctl-show-args", 'echo "$*"');
  assert.equal(askUserManager({ systemctl: args, wait: true, waitMs: 10_000, env: process.env }).state, "--user is-system-running --wait");
  assert.equal(askUserManager({ systemctl: args, wait: false, waitMs: 10_000, env: process.env }).state, "--user is-system-running");
  const hangs = program("systemctl-hangs", "exec sleep 30");
  const asked = askUserManager({ systemctl: hangs, wait: true, waitMs: 300, env: process.env });
  assert.deepEqual({ answered: asked.answered, state: asked.state }, { answered: false, state: "no answer within 0.3s" });
  assert.ok(asked.ms < 10_000, `the wait was not bounded: ${asked.ms}ms`);
  // A program that is not there is not a manager that is starting: it is not asked again.
  const missing = askUserManager({ systemctl: join(dir, "no-such-program"), wait: true, waitMs: 5_000, env: process.env, pauseMs: 50 });
  assert.deepEqual({ state: missing.state, asks: missing.asks }, { state: "could not be asked (ENOENT)", asks: 1 });
});

// A manager that lingering has queued but that has not started: until its bus is there, systemctl
// answers at once, without waiting. Each fake counts its calls in a file of its own.
const starting = (name, unreachableCalls) => {
  const count = join(dir, `${name}.count`);
  return { count, systemctl: program(name, `n=$(cat '${count}' 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > '${count}'; if [ "$n" -le ${unreachableCalls} ]; then echo "Failed to connect to bus: No such file or directory" >&2; echo unknown; exit 1; fi; echo running`) };
};
test("linux-tests askUserManager: a manager that cannot be reached yet is asked again until it answers, within the bound", () => {
  const { count, systemctl } = starting("systemctl-starting", 3);
  const asked = askUserManager({ systemctl, wait: true, waitMs: 10_000, env: process.env, pauseMs: 50 });
  assert.deepEqual({ answered: asked.answered, state: asked.state, asks: asked.asks }, { answered: true, state: "running", asks: 4 });
  assert.ok(asked.ms >= 3 * 50 && asked.ms < 10_000, `waited ${asked.ms}ms`);
  assert.equal(readFileSync(count, "utf8").trim(), "4");
  // The second step reads the state once, and does not wait for a manager that is not there.
  const once = starting("systemctl-starting-once", 3);
  assert.deepEqual({ ...askUserManager({ systemctl: once.systemctl, wait: false, waitMs: 10_000, env: process.env, pauseMs: 50 }), ms: 0 }, { answered: false, state: "unknown", waited: false, asks: 1, ms: 0 });
});

test("linux-tests askUserManager: a manager that never becomes reachable is refused at the bound, not at once", (t) => {
  const trace = join(dir, "systemctl-never.trace"), source = join(dir, "systemctl-never.mjs"), count = join(dir, "systemctl-never.count");
  // The third probe deliberately outlasts the entire bound. Its entry and missing completion
  // witness a real spawnSync deadline crossing. Keep the first two replies in the shell so
  // repeated Node startup does not consume the time in which the third probe must enter.
  writeFileSync(source, `
    import { appendFileSync } from "node:fs";
    const trace = ${JSON.stringify(trace)};
    appendFileSync(trace, JSON.stringify({ ask: 3, pid: process.pid, invokedPid: Number(process.argv[2]), entered: Date.now(), state: null }) + "\\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1600);
    appendFileSync(trace, JSON.stringify({ completed: Date.now() }) + "\\n");
    console.log("unknown");
    process.exitCode = 1;
  `);
  const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const systemctl = program("systemctl-never", `
    n=0
    if [ -f ${quote(count)} ]; then read -r n < ${quote(count)}; fi
    n=$((n + 1))
    printf '%s\\n' "$n" > ${quote(count)}
    if [ "$n" -lt 3 ]; then
      printf '{"ask":%s,"pid":%s,"state":"unknown"}\\n' "$n" "$$" >> ${quote(trace)}
      echo unknown
      exit 1
    fi
    exec ${quote(process.execPath)} ${quote(source)} "$$"
  `);
  const started = Date.now();
  const asked = askUserManager({ systemctl, wait: true, waitMs: 800, env: process.env, pauseMs: 50 });
  const returned = Date.now(), entries = readFileSync(trace, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  t.diagnostic(JSON.stringify({ started, deadline: started + 800, returned, entries, asked }));
  assert.equal(entries.length, 3, "two unreachable replies, then an unfinished third probe");
  assert.deepEqual(entries.map((entry) => entry.ask), [1, 2, 3]);
  assert.deepEqual(entries.map((entry) => entry.state), ["unknown", "unknown", null]);
  assert.equal(entries[2].pid, entries[2].invokedPid, "exec keeps the third probe in its owned process");
  assert.ok(entries[2].entered < started + 800, "the third probe entered before the deadline");
  assert.ok(returned - started >= 800 - 50, "the external elapsed time agrees with the wait bound");
  assert.equal(asked.asks, entries.length);
  assert.equal(asked.answered, false);
  assert.ok(asked.asks > 2, `asked ${asked.asks} times`);
  assert.ok(asked.ms >= 800 - 50 && asked.ms < 5_000, `refused after ${asked.ms}ms`);
  assert.equal(asked.state, "unknown");
});

const A = "a".repeat(40), B = "b".repeat(40);
const facts = (over = {}) => ({
  asked: "main", kinds: ["branch"], commit: A, files: ["test/a.test.mjs"], repeated: [],
  workflowRef: "awebai/oats/.github/workflows/linux-tests.yml@refs/heads/main", workflowSha: B, scriptCommit: B,
  runUrl: "https://github.com/awebai/oats/actions/runs/1", runAttempt: "1",
  linux: { os: "Ubuntu 24.04.1 LTS" }, system: "Linux 6.8.0-1015-azure", imageOS: "ubuntu24", imageVersion: "20261001.1",
  arch: "x64", machine: "x86_64", node: "v22.9.0", nodePath: "/opt/hostedtoolcache/node/22.9.0/x64/bin/node", fileSystem: "case-sensitive",
  tmux: null, tmuxSocket: { path: "/tmp/tmux-1001/oats", there: false }, changed: [],
  uid: 1001, xdgRuntimeDir: "/run/user/1001", linger: "yes",
  userManager: { answered: true, state: "running", waited: true, asks: 1, ms: 1234, waitMs: 60_000 }, ...over,
});

test("linux-tests header: the system, the runner image, XDG_RUNTIME_DIR, lingering and the user manager's answer, in place of macOS's lines", () => {
  const header = formatHeader(facts(), linux);
  assert.equal(header[0], "Linux test run");
  const at = header.indexOf('  Linux:               "Ubuntu 24.04.1 LTS" ("Linux 6.8.0-1015-azure")');
  assert.ok(at > 0, header.join("\n"));
  assert.deepEqual(header.slice(at, at + 5), [
    '  Linux:               "Ubuntu 24.04.1 LTS" ("Linux 6.8.0-1015-azure")',
    '  runner image:        ImageOS "ubuntu24", ImageVersion "20261001.1"',
    '  XDG_RUNTIME_DIR:     "/run/user/1001"',
    '  lingering:           "yes" (loginctl show-user 1001 --property=Linger)',
    '  user manager:        answered "running" (systemctl --user is-system-running --wait, asked once, 1.2s of at most 60.0s)',
  ]);
  assert.equal(header[at - 1], '  run:                 "https://github.com/awebai/oats/actions/runs/1", attempt "1"');
  assert.equal(header[at + 5], '  architecture:        x64 (machine "x86_64")');
  assert.ok(header.includes("  bounds:              at most 10 files a run, 20 minutes a file"), header.join("\n"));
  assert.equal(linux.refusal(facts()), null);
  assert.match(formatHeader(facts({ userManager: { answered: true, state: "degraded", waited: true, asks: 7, ms: 3456, waitMs: 60_000 } }), linux).join("\n"), /answered "degraded" \(systemctl --user is-system-running --wait, asked 7 times, 3\.5s of at most 60\.0s\)/);
  assert.equal(linux.summary(facts()), 'Linux "Ubuntu 24.04.1 LTS", user manager "running"');

  // Not Linux, nothing set, nothing answered, the second step: each is said.
  const silent = facts({ linux: null, system: "Darwin 23.6.0", xdgRuntimeDir: null, linger: null, userManager: { answered: false, state: "offline", waited: false, asks: 1, ms: 20, waitMs: 60_000 } });
  const text = formatHeader(silent, linux).join("\n");
  for (const line of ['Linux:               NOT Linux: "Darwin 23.6.0"', "XDG_RUNTIME_DIR:     (not set)", "lingering:           unknown (loginctl", 'user manager:        did NOT answer: "offline" (systemctl --user is-system-running, read again, 0.0s)']) {
    assert.ok(text.includes(line), `the header lacks: ${line}\n${text}`);
  }
  assert.deepEqual(linux.refusal(silent), { entry: "the user manager", why: 'did not answer ("offline"): `systemctl --user` cannot be relied on, so no file runs' });
  assert.equal(linux.summary(silent), "NOT Linux, user manager did NOT answer");
  // The state is a program's text: it is shown, never printed raw.
  assert.match(formatHeader(facts({ userManager: { answered: false, state: "::error::x\nnext", waited: true, asks: 1, ms: 1, waitMs: 60_000 } }), linux).join("\n"), /did NOT answer: "::error::x\\nnext"/);
});

test("linux-tests readFacts: lingering from loginctl, XDG_RUNTIME_DIR from the environment, and the user manager waited for only by prepare", () => {
  const args = program("systemctl-echo", 'echo "$*"');
  const platform = linuxPlatform({ systemctl: args, loginctl: program("loginctl-yes", 'echo yes'), waitMs: 10_000 });
  const prepared = platform.readFacts({ env: { ...process.env, XDG_RUNTIME_DIR: "/run/user/7" }, step: "prepare" });
  assert.deepEqual({ uid: prepared.uid, xdg: prepared.xdgRuntimeDir, linger: prepared.linger, state: prepared.userManager.state, waited: prepared.userManager.waited, waitMs: prepared.userManager.waitMs },
    { uid: process.getuid(), xdg: "/run/user/7", linger: "yes", state: "--user is-system-running --wait", waited: true, waitMs: 10_000 });
  const ran = platform.readFacts({ env: { ...process.env, XDG_RUNTIME_DIR: "" }, step: "run" });
  assert.deepEqual({ xdg: ran.xdgRuntimeDir, state: ran.userManager.state, waited: ran.userManager.waited }, { xdg: null, state: "--user is-system-running", waited: false });
  assert.equal(linuxPlatform({ systemctl: args, loginctl: join(dir, "no-such-program") }).readFacts({ env: process.env, step: "run" }).linger, null);
  assert.equal(prepared.linux === null, process.platform !== "linux");
});
