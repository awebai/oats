#!/usr/bin/env node
// Root test runner for `npm test`.
//
// The suite is still `node --test` over the same globs; the only thing this
// adds is a decision about Desktop suites and root/Desktop integration. They need jsdom, marked,
// dompurify and highlight.js, which are packages/desktop's dependencies and not
// the root's. Handing them to node --test on a checkout that has only run root
// `npm ci` produced 17 ERR_MODULE_NOT_FOUND failures — the state of every fresh
// clone — which made a red root suite the normal, and therefore ignored, result.
//
// So: run them when they can load, and when they cannot, say so loudly and run
// the rest. The root files that load Desktop modules are explicitly included in
// the same group; their .integration.mjs suffix keeps them out of the root-only
// globs.
// Absence of an optional package's node_modules is a property of the
// checkout, not a defect in the code under test, so this exits 0 in that case;
// nothing is skipped silently. Both CI lanes (.github/workflows/pull-request.yml
// and release.yml) install the desktop dependencies before `npm test`, and
// test/release-workflow.test.mjs pins release.yml's install step, so the skip
// path cannot quietly become CI's normal behaviour.
//
// Any extra arguments are forwarded to node --test.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  DESKTOP_TEST_DEPS_INSTALL,
  REPO_ROOT,
  desktopTestDeps,
} from "./desktop-test-deps.mjs";

// Explicit globs, never a bare `node --test`: with no arguments node walks the
// whole tree, and a checkout that hosts agents carries nested instance worktrees
// (full copies of this repository) under agents/ and .agents/ — a bare run
// executes every copy of the suite, against the wrong trees.
const KERNEL_GLOBS = ["test/**/*.test.mjs", "tests/**/*.test.mjs", "capabilities/**/*.test.mjs"];

const { ok: desktopReady, missing } = desktopTestDeps();

// With the desktop dependencies present, keep the single packages/** glob so a
// newly added package is discovered without touching this file. Without them,
// enumerate the package directories and drop only desktop — same property.
const packageGlobs = desktopReady
  ? ["packages/**/*.test.mjs"]
  : readdirSync(join(REPO_ROOT, "packages"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "desktop")
      .map((e) => `packages/${e.name}/**/*.test.mjs`);

// Root files that load Desktop modules (and so the desktop dependencies): run
// with the Desktop suites, omitted with them.
const DESKTOP_INTEGRATION = ["test/desktop-schedule-roundtrip.integration.mjs", "tests/desktop-views.integration.mjs"];
const desktopIntegration = desktopReady ? DESKTOP_INTEGRATION : [];

const RULE = "=".repeat(78);
const notice = [
  RULE,
  "NOTICE: Desktop suites and root/Desktop integration coverage were SKIPPED — this run does NOT cover them.",
  `Root integration omitted: ${DESKTOP_INTEGRATION.join(", ")}`,
  `Reason: packages/desktop dependencies are not installed (missing: ${missing.join(", ")}).`,
  `To run them: ${DESKTOP_TEST_DEPS_INSTALL}`,
  RULE,
].join("\n");

if (!desktopReady) console.log(`\n${notice}\n`);

// Forwarded flags go BEFORE the globs: node --test reads a flag after the first
// positional as another file pattern, so `npm test -- --test-shard=k/N` silently
// ran the whole suite in every CI shard. Extra file patterns still work (they
// only narrow, alongside the default globs).
const extra = process.argv.slice(2);
const flags = extra.filter((a) => a.startsWith("-")), files = extra.filter((a) => !a.startsWith("-"));

// Test output is pristine (awebai/oats#910): an expected warning is captured and
// asserted by the test or by its fixture, never left in the output. So the run
// fails when a test file's output holds an `oats: warning:` line, even if every
// test passed. A second reporter reads each file's stderr and stdout as the run
// received them (scripts/test-warnings-reporter.mjs: it knows the file, and sees
// a line whether the worker wrote it or a child that has the worker's stderr)
// and writes what it finds to a file of this run.
//
// node --test picks its reporter only when none is named, so the one a person
// reads is named here as node would pick it: spec on a terminal and, in a pipe,
// tap before Node 23 and spec from it. A reporter given on the command line
// stays the one that is read.
const namesReporter = flags.some((f) => /^--test-reporter(=|$)/.test(f));
const namesDestination = flags.some((f) => /^--test-reporter-destination(=|$)/.test(f));
const shown = namesReporter
  ? (namesDestination ? [] : ["--test-reporter-destination=stdout"])
  : [`--test-reporter=${process.stdout.isTTY || Number(process.versions.node.split(".")[0]) >= 23 ? "spec" : "tap"}`, "--test-reporter-destination=stdout"];
const warningsDir = mkdtempSync(join(tmpdir(), "oats-test-warnings-"));
const warningsFile = join(warningsDir, "found.jsonl");
const guard = [`--test-reporter=${new URL("./test-warnings-reporter.mjs", import.meta.url).href}`, `--test-reporter-destination=${warningsFile}`];

const args = ["--test", ...flags, ...shown, ...guard, ...KERNEL_GLOBS, ...packageGlobs, ...desktopIntegration, ...files];
const run = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: "inherit" });

// The file is node's to create: it is absent only when node never started the run.
let found = "";
try { found = readFileSync(warningsFile, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; } finally { rmSync(warningsDir, { recursive: true, force: true }); }
const warnings = found.split("\n").filter(Boolean).map((line) => JSON.parse(line));

if (run.error) throw run.error;

// Repeat it after node --test's summary so the last thing on screen says the
// desktop suites did not run, whatever the counts above claim.
if (!desktopReady) console.log(`\n${notice}`);

if (warnings.length) {
  const byFile = new Map();
  for (const { file, line } of warnings) byFile.set(file, [...(byFile.get(file) ?? []), line]);
  const named = [...byFile].map(([file, lines]) => {
    const distinct = [...new Set(lines.map((line) => line.trim()))];
    return [`  ${relative(REPO_ROOT, file) || file}: ${lines.length} line${lines.length === 1 ? "" : "s"}`,
      ...distinct.slice(0, 3).map((line) => `    ${line.length > 300 ? `${line.slice(0, 300)}…` : line}`),
      ...(distinct.length > 3 ? [`    … and ${distinct.length - 3} more different lines`] : [])].join("\n");
  });
  console.error([
    "", RULE,
    `UNASSERTED WARNINGS: ${warnings.length} \`oats: warning:\` line${warnings.length === 1 ? "" : "s"} reached the test output, from ${byFile.size} test file${byFile.size === 1 ? "" : "s"}. The run FAILS.`,
    "Test output is pristine: an expected warning is captured and asserted by the test or by its fixture",
    "(docs/implementation.md, \"Tests and gates\"; test/helpers/host-fixture.mjs expectLoginFallback).",
    ...named,
    RULE,
  ].join("\n"));
  process.exit(run.status || 1);
}

process.exit(run.status ?? 1);
