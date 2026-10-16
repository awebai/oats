#!/usr/bin/env node
// The script of the hand-started macOS test runs (.github/workflows/macos-tests.yml,
// docs/named-test-runs.md): the macOS platform of scripts/named-test-run.mjs, which runs named
// test files of a named ref, each alone, and its command line.
//
//   node scripts/macos-tests.mjs prepare <tree>   validate the request, print the header,
//                                                 put the commit in <tree>
//   node scripts/macos-tests.mjs run <tree>       validate again, run each file, print the table
//
// The request is two environment variables, MACOS_TESTS_REF and MACOS_TESTS_FILES. What is done
// with them, and what a run does and does not protect, is said once, in scripts/named-test-run.mjs.

import { html, imageLine, isCommandLine, main, outputOf, show } from "./named-test-run.mjs";

/** What one file gets on macOS before its process group is killed. A bound, not an input. */
export const FILE_TIMEOUT_MS = 5 * 60_000;
/** The macOS job's `timeout-minutes` (test/macos-tests-workflow.test.mjs pins the workflow to it): room
 *  for MAX_FILES files at FILE_TIMEOUT_MS each, and for the installs before them. */
export const JOB_TIMEOUT_MINUTES = 60;

/** The macOS runner: its version and build, read with sw_vers. It never refuses. */
export const macos = {
  title: "macOS test run",
  script: "scripts/macos-tests.mjs",
  request: { ref: "MACOS_TESTS_REF", files: "MACOS_TESTS_FILES" },
  fileTimeoutMs: FILE_TIMEOUT_MS,
  readFacts: () => ({
    macos: process.platform === "darwin" ? { version: outputOf("/usr/bin/sw_vers", ["-productVersion"]), build: outputOf("/usr/bin/sw_vers", ["-buildVersion"]) } : null,
  }),
  headerLines: (f) => [
    `  macOS:               ${f.macos ? `${show(f.macos.version ?? "unknown")} (build ${show(f.macos.build ?? "unknown")})` : `NOT macOS: ${show(f.system)}`}`,
    imageLine(f),
  ],
  summary: (f) => (f.macos ? `macOS ${html(show(f.macos.version ?? "unknown"))}` : "NOT macOS"),
};

if (isCommandLine(import.meta.url)) {
  process.exitCode = await main(macos, process.argv.slice(2));
}
