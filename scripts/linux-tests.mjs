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
// The workflow enables lingering for that user and sets XDG_RUNTIME_DIR before this script runs;
// this script asks the manager whether it is up, waiting at most USER_MANAGER_WAIT_MS, and the
// header says what it answered. A manager that does not answer `running` or `degraded` fails the
// step, after the header and before any file runs.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { formatDuration, html, imageLine, isCommandLine, main, outputOf, show } from "./named-test-run.mjs";

/** What `prepare` waits, at most, for the user manager to finish starting. A bound, not an input. */
export const USER_MANAGER_WAIT_MS = 60_000;
/** The states in which the user manager has answered and can run units. `degraded` is a running
 *  manager with a failed unit, which the runner image may have of its own. */
const ANSWERED = new Set(["running", "degraded"]);

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

/** Ask the user manager for its state, waiting for it to finish starting when `wait` → { answered,
 *  state, waited, ms }. Never a shell; never longer than `waitMs`. */
export function askUserManager({ systemctl, wait, waitMs, env }) {
  const started = Date.now();
  const result = spawnSync(systemctl, ["--user", "is-system-running", ...(wait ? ["--wait"] : [])], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env, timeout: waitMs, killSignal: "SIGKILL" });
  return { ...userManagerAnswer(result, waitMs), waited: wait, ms: Date.now() - started };
}

/** The Linux runner → a platform for named-test-run.mjs. `prepare` waits for the user manager; `run`
 *  asks it again without waiting. The programs and the wait are the tests' seams; the command line
 *  uses the defaults. */
export function linuxPlatform({ systemctl = "/usr/bin/systemctl", loginctl = "/usr/bin/loginctl", waitMs = USER_MANAGER_WAIT_MS } = {}) {
  return {
    title: "Linux test run",
    script: "scripts/linux-tests.mjs",
    request: { ref: "LINUX_TESTS_REF", files: "LINUX_TESTS_FILES" },
    readFacts: ({ env, step }) => {
      let osRelease = null;
      try { osRelease = readFileSync("/etc/os-release", "utf8"); } catch { /* not there: not a Linux of that kind */ }
      const uid = process.getuid();
      return {
        linux: process.platform === "linux" ? { os: prettyName(osRelease) } : null,
        uid, xdgRuntimeDir: env.XDG_RUNTIME_DIR || null,
        linger: outputOf(loginctl, ["show-user", String(uid), "--property=Linger", "--value"]),
        userManager: { ...askUserManager({ systemctl, wait: step === "prepare", waitMs, env }), waitMs },
      };
    },
    headerLines: (f) => {
      const m = f.userManager;
      return [
        `  Linux:               ${f.linux ? `${show(f.linux.os ?? "unknown")} (${show(f.system)})` : `NOT Linux: ${show(f.system)}`}`,
        imageLine(f),
        `  XDG_RUNTIME_DIR:     ${f.xdgRuntimeDir ? show(f.xdgRuntimeDir) : "(not set)"}`,
        `  lingering:           ${f.linger ? show(f.linger) : "unknown"} (loginctl show-user ${f.uid} --property=Linger)`,
        `  user manager:        ${m.answered ? `answered ${show(m.state)}` : `did NOT answer: ${show(m.state)}`} (systemctl --user is-system-running${m.waited ? ` --wait, ${formatDuration(m.ms)} of at most ${formatDuration(m.waitMs)}` : `, read again, ${formatDuration(m.ms)}`})`,
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
