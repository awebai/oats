// scripts/linux-tests.mjs, the Linux platform of the hand-started test runs: how it reads the
// runner's user manager and what the header says of it. Nothing here asks this host's own systemd:
// the programs are fakes. The two steps with this platform are in named-test-run.test.mjs, the
// workflow's terms in linux-tests-workflow.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USER_MANAGER_WAIT_MS, askUserManager, linux, linuxPlatform, prettyName, userManagerAnswer } from "../scripts/linux-tests.mjs";
import { formatHeader } from "../scripts/named-test-run.mjs";

const dir = mkdtempSync(join(tmpdir(), "oats-linux-tests-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const program = (name, body) => { const path = join(dir, name); writeFileSync(path, `#!/bin/sh\n${body}\n`); chmodSync(path, 0o755); return path; };

test("linux-tests: the request, the title and the wait are the runner's own", () => {
  assert.deepEqual(linux.request, { ref: "LINUX_TESTS_REF", files: "LINUX_TESTS_FILES" });
  assert.equal(linux.title, "Linux test run");
  assert.equal(linux.script, "scripts/linux-tests.mjs");
  assert.equal(USER_MANAGER_WAIT_MS, 60_000, "the bound the spec set: a change comes with a measured reason");
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

test("linux-tests askUserManager: --wait only when asked to wait, and never longer than the bound", () => {
  const echo = program("systemctl-args", 'echo "$*" >&2; echo running');
  assert.deepEqual({ ...askUserManager({ systemctl: echo, wait: true, waitMs: 10_000, env: process.env }), ms: 0 }, { answered: true, state: "running", waited: true, ms: 0 });
  const args = program("systemctl-show-args", 'echo "$*"');
  assert.equal(askUserManager({ systemctl: args, wait: true, waitMs: 10_000, env: process.env }).state, "--user is-system-running --wait");
  assert.equal(askUserManager({ systemctl: args, wait: false, waitMs: 10_000, env: process.env }).state, "--user is-system-running");
  const hangs = program("systemctl-hangs", "exec sleep 30");
  const asked = askUserManager({ systemctl: hangs, wait: true, waitMs: 300, env: process.env });
  assert.deepEqual({ answered: asked.answered, state: asked.state }, { answered: false, state: "no answer within 0.3s" });
  assert.ok(asked.ms < 10_000, `the wait was not bounded: ${asked.ms}ms`);
  assert.equal(askUserManager({ systemctl: join(dir, "no-such-program"), wait: true, waitMs: 1_000, env: process.env }).state, "could not be asked (ENOENT)");
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
  userManager: { answered: true, state: "running", waited: true, ms: 1234, waitMs: 60_000 }, ...over,
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
    '  user manager:        answered "running" (systemctl --user is-system-running --wait, 1.2s of at most 60.0s)',
  ]);
  assert.equal(header[at - 1], '  run:                 "https://github.com/awebai/oats/actions/runs/1", attempt "1"');
  assert.equal(header[at + 5], '  architecture:        x64 (machine "x86_64")');
  assert.equal(linux.refusal(facts()), null);
  assert.equal(linux.summary(facts()), 'Linux "Ubuntu 24.04.1 LTS", user manager "running"');

  // Not Linux, nothing set, nothing answered, the second step: each is said.
  const silent = facts({ linux: null, system: "Darwin 23.6.0", xdgRuntimeDir: null, linger: null, userManager: { answered: false, state: "offline", waited: false, ms: 20, waitMs: 60_000 } });
  const text = formatHeader(silent, linux).join("\n");
  for (const line of ['Linux:               NOT Linux: "Darwin 23.6.0"', "XDG_RUNTIME_DIR:     (not set)", "lingering:           unknown (loginctl", 'user manager:        did NOT answer: "offline" (systemctl --user is-system-running, read again, 0.0s)']) {
    assert.ok(text.includes(line), `the header lacks: ${line}\n${text}`);
  }
  assert.deepEqual(linux.refusal(silent), { entry: "the user manager", why: 'did not answer ("offline"): `systemctl --user` cannot be relied on, so no file runs' });
  assert.equal(linux.summary(silent), "NOT Linux, user manager did NOT answer");
  // The state is a program's text: it is shown, never printed raw.
  assert.match(formatHeader(facts({ userManager: { answered: false, state: "::error::x\nnext", waited: true, ms: 1, waitMs: 60_000 } }), linux).join("\n"), /did NOT answer: "::error::x\\nnext"/);
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
