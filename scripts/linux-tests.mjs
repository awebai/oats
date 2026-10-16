#!/usr/bin/env node
// The script of the hand-started Linux test runs (.github/workflows/linux-tests.yml,
// docs/named-test-runs.md): the Linux platform of scripts/named-test-run.mjs, which runs named
// test files of a named ref, each alone, and its command line.
//
//   node scripts/linux-tests.mjs prepare <tree>   validate the request, wait for the user manager,
//                                                 print the header, put the commit in <tree>
//   node scripts/linux-tests.mjs run <tree>       validate again, ask the user manager again, run
//                                                 each file, print the table
//
// The request is two environment variables, LINUX_TESTS_REF and LINUX_TESTS_FILES. What is done
// with them, and what a run does and does not protect, is said once, in scripts/named-test-run.mjs.
//
// The runner is for tests that drive the runner user's own systemd manager (`systemctl --user`).
// The workflow enables lingering for that user and sets XDG_RUNTIME_DIR before this script runs.
// Lingering only queues the manager's start, so this script waits for it, at most
// USER_MANAGER_WAIT_MS in all: while the manager's bus cannot be reached yet it asks again, and once
// it can, `--wait` waits for the manager to finish starting. The header says what it answered. A
// manager that does not answer `running` or `degraded` fails the step, after the header and before
// any file runs.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { formatDuration, html, imageLine, isCommandLine, main, outputOf, show } from "./named-test-run.mjs";

/** What one file gets on Linux before its process group is killed. A bound, not an input: the #1108
 *  qualification files (storage at thousands of streams, frames of tens of megabytes, a rollback)
 *  run capture passes of up to 300 s each, and a first upgrade may take several. */
export const FILE_TIMEOUT_MS = 20 * 60_000;
/** The Linux job's `timeout-minutes` (test/linux-tests-workflow.test.mjs pins the workflow to it): room
 *  for MAX_FILES files at FILE_TIMEOUT_MS each, the two asks of the user manager and the installs
 *  before them, under GitHub's 6-hour limit for a job. */
export const JOB_TIMEOUT_MINUTES = 240;
/** What `prepare` waits, at most and in all, for the user manager to be reached and to finish
 *  starting. A bound, not an input. */
export const USER_MANAGER_WAIT_MS = 60_000;
/** The states in which the user manager has answered and can run units. `degraded` is a running
 *  manager with a failed unit, which the runner image may have of its own. */
const ANSWERED = new Set(["running", "degraded"]);

/** How long `prepare` pauses before it asks a manager it could not reach again. */
export const RETRY_PAUSE_MS = 500;

/** The PRETTY_NAME of an os-release file's text → the name, or null. */
export function prettyName(text) {
  const m = /^PRETTY_NAME=(.*)$/m.exec(String(text ?? ""));
  return m ? m[1].trim().replace(/^(["'])(.*)\1$/, "$2") || null : null;
}

/** What `systemctl --user is-system-running` said, from its spawnSync result → { answered, state }.
 *  It prints the state on its output whatever its exit status (`degraded` exits 1), so the state
 *  decides, not the status. */
export function userManagerAnswer(result, waitMs) {
  if (result.error?.code === "ETIMEDOUT") return { answered: false, state: `no answer within ${formatDuration(waitMs)}` };
  if (result.error) return { answered: false, state: `could not be asked (${result.error.code ?? result.error.message})` };
  const state = String(result.stdout ?? "").split("\n")[0].trim();
  if (ANSWERED.has(state)) return { answered: true, state };
  const said = state || String(result.stderr ?? "").trim().split("\n")[0];
  return { answered: false, state: said || `exit ${result.status ?? result.signal}` };
}

/** Whether an answer that is not one says the manager cannot be reached yet: its bus is not there,
 *  which is so until the manager lingering queued has started. `--wait` does not wait for that: it
 *  connects first, and answers at once when it cannot. */
export function notYetReachable(state) {
  return state === "offline" || state === "unknown" || state.startsWith("Failed to connect to bus");
}

/** Block this (synchronous) step for `ms`. */
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Ask the user manager for its state → { answered, state, waited, asks, ms }. With `wait`, it waits
 *  for the manager to finish starting (`--wait`), and asks again every `pauseMs` while the manager
 *  cannot be reached yet. Never a shell; never longer than `waitMs` in all. Without `wait`, it asks
 *  once. */
export function askUserManager({ systemctl, wait, waitMs, env, pauseMs = RETRY_PAUSE_MS }) {
  const started = Date.now(), elapsed = () => Date.now() - started;
  const ask = () => userManagerAnswer(spawnSync(systemctl, ["--user", "is-system-running", ...(wait ? ["--wait"] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env, timeout: Math.max(1, waitMs - elapsed()), killSignal: "SIGKILL" }), waitMs);
  let answer = ask(), asks = 1;
  while (wait && !answer.answered && notYetReachable(answer.state) && elapsed() + pauseMs < waitMs) {
    pause(pauseMs);
    answer = ask();
    asks += 1;
  }
  return { ...answer, waited: wait, asks, ms: elapsed() };
}

/** The Linux runner → a platform for named-test-run.mjs. `prepare` waits for the user manager; `run`
 *  asks it again without waiting. The programs, the wait and the pause are the tests' seams; the
 *  command line uses the defaults. */
export function linuxPlatform({ systemctl = "/usr/bin/systemctl", loginctl = "/usr/bin/loginctl", waitMs = USER_MANAGER_WAIT_MS, pauseMs = RETRY_PAUSE_MS } = {}) {
  return {
    title: "Linux test run",
    script: "scripts/linux-tests.mjs",
    request: { ref: "LINUX_TESTS_REF", files: "LINUX_TESTS_FILES" },
    fileTimeoutMs: FILE_TIMEOUT_MS,
    readFacts: ({ env, step }) => {
      let osRelease = null;
      try { osRelease = readFileSync("/etc/os-release", "utf8"); } catch { /* not there: not a Linux of that kind */ }
      const uid = process.getuid();
      return {
        linux: process.platform === "linux" ? { os: prettyName(osRelease) } : null,
        uid, xdgRuntimeDir: env.XDG_RUNTIME_DIR || null,
        linger: outputOf(loginctl, ["show-user", String(uid), "--property=Linger", "--value"]),
        userManager: { ...askUserManager({ systemctl, wait: step === "prepare", waitMs, env, pauseMs }), waitMs },
      };
    },
    headerLines: (f) => {
      const m = f.userManager;
      return [
        `  Linux:               ${f.linux ? `${show(f.linux.os ?? "unknown")} (${show(f.system)})` : `NOT Linux: ${show(f.system)}`}`,
        imageLine(f),
        `  XDG_RUNTIME_DIR:     ${f.xdgRuntimeDir ? show(f.xdgRuntimeDir) : "(not set)"}`,
        `  lingering:           ${f.linger ? show(f.linger) : "unknown"} (loginctl show-user ${f.uid} --property=Linger)`,
        `  user manager:        ${m.answered ? `answered ${show(m.state)}` : `did NOT answer: ${show(m.state)}`} (systemctl --user is-system-running${m.waited ? ` --wait, asked ${m.asks === 1 ? "once" : `${m.asks} times`}, ${formatDuration(m.ms)} of at most ${formatDuration(m.waitMs)}` : `, read again, ${formatDuration(m.ms)}`})`,
      ];
    },
    summary: (f) => `${f.linux ? `Linux ${html(show(f.linux.os ?? "unknown"))}` : "NOT Linux"}, user manager ${f.userManager.answered ? html(show(f.userManager.state)) : "did NOT answer"}`,
    refusal: (f) => (f.userManager.answered ? null : { entry: "the user manager", why: `did not answer (${show(f.userManager.state)}): \`systemctl --user\` cannot be relied on, so no file runs` }),
  };
}

/** The Linux runner as the workflow runs it. */
export const linux = linuxPlatform();

if (isCommandLine(import.meta.url)) {
  process.exitCode = await main(linux, process.argv.slice(2));
}
