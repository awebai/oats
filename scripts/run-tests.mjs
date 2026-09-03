#!/usr/bin/env node
// Root test runner for `npm test`.
//
// The suite is still `node --test` over the same globs; the only thing this
// adds is a decision about packages/desktop. Its ~40 suites need jsdom, marked,
// dompurify and highlight.js, which are packages/desktop's dependencies and not
// the root's. Handing them to node --test on a checkout that has only run root
// `npm ci` produced 17 ERR_MODULE_NOT_FOUND failures — the state of every fresh
// clone — which made a red root suite the normal, and therefore ignored, result.
//
// So: run them when they can load, and when they cannot, say so loudly and run
// the rest. Absence of an optional package's node_modules is a property of the
// checkout, not a defect in the code under test, so this exits 0 in that case;
// nothing is skipped silently. Both CI lanes (.github/workflows/pull-request.yml
// and release.yml) install the desktop dependencies before `npm test`, and
// test/release-workflow.test.mjs pins release.yml's install step, so the skip
// path cannot quietly become CI's normal behaviour.
//
// Any extra arguments are forwarded to node --test.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DESKTOP_TEST_DEPS_INSTALL,
  REPO_ROOT,
  desktopTestDeps,
} from "./desktop-test-deps.mjs";

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

const RULE = "=".repeat(78);
const notice = [
  RULE,
  "NOTICE: packages/desktop test suites were SKIPPED — this run does NOT cover them.",
  `Reason: packages/desktop dependencies are not installed (missing: ${missing.join(", ")}).`,
  `To run them: ${DESKTOP_TEST_DEPS_INSTALL}`,
  RULE,
].join("\n");

if (!desktopReady) console.log(`\n${notice}\n`);

const args = ["--test", ...KERNEL_GLOBS, ...packageGlobs, ...process.argv.slice(2)];
const run = spawnSync(process.execPath, args, { cwd: REPO_ROOT, stdio: "inherit" });

if (run.error) throw run.error;

// Repeat it after node --test's summary so the last thing on screen says the
// desktop suites did not run, whatever the counts above claim.
if (!desktopReady) console.log(`\n${notice}`);

process.exit(run.status ?? 1);
