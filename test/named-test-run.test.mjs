// scripts/named-test-run.mjs, the one implementation of the hand-started test runs: what it accepts
// and what it refuses. The request is a person's text and the workflows run a branch's code, so every
// refusal of docs/named-test-runs.md has its case here: first the pure parts, then the whole
// validation against a checkout whose `origin` is a local bare repository, through the macOS
// platform. The runs themselves are in named-test-run-files.test.mjs, the Linux platform in
// linux-tests.test.mjs, the workflows' terms in macos-tests-workflow.test.mjs and
// linux-tests-workflow.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import {
  MAX_FILES, boundsRefusal, buildMarkdownTable, buildTable, chooseCommit, conclude, countsReader, defaultTmuxSocket, fileShapeRefusal,
  formatHeader, main, measureCase, parseFileList, prepare, readCounts, refCandidates, refShapeRefusal, resolveRef, run, show, summaryLines, testEnv,
  treeEntryRefusal, unknownRefReason, validateRequest, verdict,
} from "../scripts/named-test-run.mjs";
import { macos } from "../scripts/macos-tests.mjs";
import { linuxPlatform } from "../scripts/linux-tests.mjs";
import { fakeProgram } from "./helpers/host-fixture.mjs";

const A = "a".repeat(40), B = "b".repeat(40);
/** A writer that keeps what a step prints. */
const collect = () => { const chunks = []; return { write: (chunk) => chunks.push(String(chunk)), text: () => chunks.join("") }; };

// ---- the pure parts ------------------------------------------------------------------------------

test("named-test-run parseFileList: commas, spaces and newlines in any mix; a trailing separator names nothing; a file named twice is listed once", () => {
  assert.deepEqual(parseFileList("test/a.test.mjs, test/b.test.mjs\n\ttest/c.test.mjs ,,\n"), { files: ["test/a.test.mjs", "test/b.test.mjs", "test/c.test.mjs"], repeated: [] });
  assert.deepEqual(parseFileList(" ,test/a.test.mjs,"), { files: ["test/a.test.mjs"], repeated: [] });
  assert.deepEqual(parseFileList("test/a.test.mjs test/b.test.mjs test/a.test.mjs test/a.test.mjs"), { files: ["test/a.test.mjs", "test/b.test.mjs"], repeated: ["test/a.test.mjs"] });
  for (const empty of ["", " \n,", undefined, null]) assert.deepEqual(parseFileList(empty), { files: [], repeated: [] });
});

test("named-test-run fileShapeRefusal: test/**/*.test.mjs and packages/<name>/test/**/*.test.mjs over plain segments, and nothing else", () => {
  for (const ok of ["test/a.test.mjs", "test/sub/dir/a-b_c.1.test.mjs", "packages/tui/test/a.test.mjs", "packages/tui/test/deep/a.test.mjs", "packages/test/test/a.test.mjs"]) {
    assert.equal(fileShapeRefusal(ok), null, ok);
  }
  const refused = {
    "a `..` segment": ["test/../lib/core.test.mjs", "../test/a.test.mjs", "test/sub/../../a.test.mjs", "packages/../test/a.test.mjs"],
    "empty or has a character outside": [
      "/etc/passwd", "test//a.test.mjs", "test/a.test.mjs/", "/test/a.test.mjs", "test/a b.test.mjs", "test/*.test.mjs", "test/**/*.test.mjs", "test/$(id).test.mjs", "test/`id`.test.mjs",
      "test/a;id.test.mjs", "test/a\u0000.test.mjs", "test/a\n.test.mjs", ":(glob)test/a.test.mjs", ":!test/a.test.mjs", "test\\a.test.mjs", "test/é.test.mjs", "--test-reporter=tap", "",
    ],
    "starts with a dot": ["./test/a.test.mjs", "test/./a.test.mjs", "test/.hidden/a.test.mjs", "test/.test.mjs", ".git/test/a.test.mjs"],
    "does not match": [
      "tests/a.test.mjs", "capabilities/x/test/a.test.mjs", "lib/core.mjs", "test/a.mjs", "test/a.test.js", "test/a.test.mjsx", "test/desktop-schedule-roundtrip.integration.mjs", "test", "packages",
      "packages/a.test.mjs", "packages/tui/a.test.mjs", "packages/tui/lib/test/a.test.mjs", "packages/tui/test", "-rf", "--", "a.test.mjs", "test.test.mjs",
    ],
  };
  for (const [why, entries] of Object.entries(refused)) for (const entry of entries) assert.ok(fileShapeRefusal(entry)?.includes(why), `${JSON.stringify(entry)} → ${fileShapeRefusal(entry)}`);
});

test("named-test-run boundsRefusal: one run takes at least one file and at most MAX_FILES", () => {
  const files = (n) => Array.from({ length: n }, (_, i) => `test/f${i}.test.mjs`);
  assert.equal(MAX_FILES, 10);
  assert.match(boundsRefusal([]), /no test file was named/);
  assert.equal(boundsRefusal(files(1)), null);
  assert.equal(boundsRefusal(files(MAX_FILES)), null);
  assert.match(boundsRefusal(files(MAX_FILES + 1)), /11 files were named; one run takes at most 10/);
});

test("named-test-run refShapeRefusal: a branch name, a tag name or a full commit id of a plain shape", () => {
  // `2026` and `pull/7/head` are names a branch may have: only a name nothing answers to is taken for a pull request.
  for (const ok of ["main", "release/0.24", "v0.53.0", "agents/oats-kernel-developer-macos-test-workflow", "feature_x", A, "a.b", "x".repeat(255), "2026", "pull/7/head", "0".repeat(40)]) assert.equal(refShapeRefusal(ok), null, ok);
  const refused = {
    "no ref was given": [""],
    "a pull request is not accepted": ["#123"],
    "longer than 255": ["x".repeat(256)],
    "white space or a control character": ["a b", "a\tb", "a\nb", "main\u0000", "\u007fmain", "main\r"],
    "starts with `-`": ["-x", "--upload-pack=touch", "--output=/tmp/x", "-"],
    "has `..`": ["a..b", "main..feature", "../x", ".."],
    "a character outside": ["main^", "main~1", "main@{1}", "@", "a:b", "HEAD:test/a.test.mjs", "$(id)", "`id`", "a;b", "a|b", "a&b", "a>b", "a*", "a?", "a[b]", "a\\b", "é", "a'b", "a\"b", "feature#1", "a+b", "{a}"],
  };
  for (const [why, refs] of Object.entries(refused)) for (const ref of refs) assert.ok(refShapeRefusal(ref)?.includes(why), `${JSON.stringify(ref)} → ${refShapeRefusal(ref)}`);
  // A name with another character has a way in: its commit.
  assert.match(refShapeRefusal("feature#1"), /give the commit's full id \(40 characters\) instead/);
});

test("named-test-run chooseCommit: every reading of the name must hold, and all must be one commit", () => {
  const refs = { branches: new Map([["main", A], ["both", A], ["clash", A], [B, A]]), tags: new Map([["v1", B], ["both", "tagobject"], ["clash", B]]) };
  assert.deepEqual(refCandidates("main", refs), [{ kind: "branch", object: A }]);
  assert.deepEqual(refCandidates("v1", refs), [{ kind: "tag", object: B }]);
  assert.deepEqual(refCandidates("both", refs), [{ kind: "branch", object: A }, { kind: "tag", object: "tagobject" }]);
  assert.deepEqual(refCandidates(A.toUpperCase(), refs), [{ kind: "commit id", object: A }], "a commit id is taken in either case, and used as git prints it");
  assert.deepEqual(refCandidates(B, refs), [{ kind: "branch", object: A }, { kind: "commit id", object: B }], "a branch named as a commit id is two readings");
  // Exact names only: no prefix, no pattern, no part of a name.
  for (const none of ["mai", "main/", "ma*", "release", "origin/main", "refs/heads/main", "HEAD", A.slice(0, 12)]) assert.deepEqual(refCandidates(none, refs), [], none);

  assert.deepEqual(chooseCommit("main", [{ kind: "branch", commit: A }]), { ok: true, commit: A, kinds: ["branch"] });
  assert.deepEqual(chooseCommit("both", [{ kind: "branch", commit: A }, { kind: "tag", commit: A }]), { ok: true, commit: A, kinds: ["branch", "tag"] });
  const clash = chooseCommit("clash", [{ kind: "branch", commit: A }, { kind: "tag", commit: B }]);
  assert.equal(clash.ok, false);
  assert.match(clash.why, new RegExp(`names more than one commit \\(the branch is ${A}, the tag is ${B}\\): give the full id`));
  assert.deepEqual(chooseCommit("t", [{ kind: "tag", why: "does not point at a commit" }]), { ok: false, why: "does not point at a commit" });
  assert.match(chooseCommit(B, [{ kind: "branch", commit: A }, { kind: "commit id", why: "is on no branch" }]).why, /^as a commit id, is on no branch$/);

  // No reading at all: the reason says what the text probably was.
  assert.match(chooseCommit("abc1234", []).why, /shortened commit id, give all 40 characters/);
  assert.match(unknownRefReason(A.slice(0, 39)), /shortened commit id/);
  for (const number of ["17", "pull/17/head", "refs/pull/17/merge"]) assert.match(unknownRefReason(number), /is no branch or tag, and a pull request is not accepted \(a fork's head/, number);
  assert.match(unknownRefReason("refs/heads/main"), /give the short name/);
  assert.match(unknownRefReason("origin/main"), /without `origin\/`/);
  assert.match(unknownRefReason("no-such-branch"), /is no branch or tag that was fetched from origin/);
});

test("named-test-run treeEntryRefusal: a regular file of the commit, not a link, a directory or a submodule", () => {
  assert.equal(treeEntryRefusal({ mode: "100644", type: "blob" }), null);
  assert.equal(treeEntryRefusal({ mode: "100755", type: "blob" }), null);
  assert.match(treeEntryRefusal(undefined), /is not a file at that commit/);
  assert.match(treeEntryRefusal({ mode: "120000", type: "blob" }), /is a symbolic link at that commit/);
  assert.match(treeEntryRefusal({ mode: "040000", type: "tree" }), /is a directory at that commit/);
  assert.match(treeEntryRefusal({ mode: "160000", type: "commit" }), /is a submodule at that commit/);
});

const summary = (mark, n) => ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo", "duration_ms"].map((key, i) => `${mark} ${key} ${n[i]}`).join("\n");
test("named-test-run readCounts: the runner's own summary, from either reporter, and not a look-alike in a test's output", () => {
  const counts = { tests: 5, pass: 2, fail: 1, cancelled: 1, skipped: 1, todo: 0 };
  const numbers = [5, 2, 2, 1, 1, 1, 0, "73.773915"];
  // The spec reporter (a terminal, and every Node after 22), and TAP (Node 22 writing to a pipe).
  assert.deepEqual(readCounts(`✔ passes (0.8ms)\n${summary("ℹ", numbers)}\n`), counts);
  assert.deepEqual(readCounts(`TAP version 13\nok 1 - passes\n1..5\n${summary("#", numbers)}\n`), counts);
  assert.deepEqual(readCounts(summary("ℹ", numbers)), counts, "a last line with no newline");
  assert.deepEqual(readCounts(summary("ℹ", numbers).replace(/\n/g, "\r\n")), counts, "CRLF");
  assert.deepEqual(readCounts(summary("ℹ", numbers).replace(/^(.*)$/gm, "\u001b[34m$1\u001b[39m")), counts, "colours");
  // After the summary the spec reporter repeats each failure, indented, with whatever the test put
  // in its message: a nested run's summary there is not this run's.
  const nested = summary("ℹ", [9, 0, 9, 0, 0, 0, 0, 1]).replace(/^/gm, "  ");
  assert.deepEqual(readCounts(`${summary("ℹ", numbers)}\n\n✖ failing tests:\n\n✖ fails (1.7ms)\n  AssertionError: nested\n${nested}\n`), counts);
  // A whole look-alike block that a test printed is before the runner's: the last block counts.
  assert.deepEqual(readCounts(`${summary("ℹ", [9, 0, 9, 0, 0, 0, 0, 1])}\n✔ prints a nested run (2ms)\n${summary("ℹ", numbers)}\n`), counts);
  // Lone lines and a block cut short are no summary.
  assert.equal(readCounts("ℹ tests 99\nℹ pass 99\n✔ passes\n"), null);
  assert.equal(readCounts(summary("ℹ", numbers).split("\n").slice(0, 7).join("\n")), null, "killed before the last line");
  assert.equal(readCounts(summary("ℹ", numbers).replace("ℹ fail 1\n", "")), null, "a line missing");
  assert.equal(readCounts(""), null);
  assert.equal(readCounts("# tests 3 \n# Subtest: tests\nnot a summary\n"), null);
  // A block interrupted by a new first line starts again.
  assert.deepEqual(readCounts(`ℹ tests 1\nℹ suites 1\n${summary("ℹ", numbers)}\n`), counts);
});

test("named-test-run countsReader: the summary is read as the output streams, whatever the chunks", () => {
  const output = Buffer.from(`${"x".repeat(5000)}\n✔ a test\n${"y".repeat(700)}${summary("ℹ", [3, 0, 3, 0, 0, 0, 0, 12])}\n`);
  // The long line before the block has no newline of its own: the block's first line is part of it, so no block.
  const whole = countsReader(); whole.push(output);
  assert.equal(whole.end(), null);
  const text = Buffer.from(`${"x".repeat(5000)}\n✔ a test\n${"y".repeat(700)}\n${summary("ℹ", [3, 0, 3, 0, 0, 0, 0, 12])}\n`);
  for (const size of [1, 2, 3, 7, 64, 4096]) {
    const reader = countsReader();
    for (let i = 0; i < text.length; i += size) reader.push(text.subarray(i, i + size)); // 1 to 3 bytes: the mark's three bytes come apart
    assert.deepEqual(reader.end(), { tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, `chunks of ${size}`);
  }
});

const ran = (over = {}) => ({ file: "test/a.test.mjs", counts: { tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, code: 0, signal: null, timedOut: false, durationMs: 1234, leftover: false, leak: false, error: null, ...over });
test("named-test-run verdict: the exit status decides, and the counts must agree with it", () => {
  assert.deepEqual(verdict(ran()), { ok: true, label: "passed", why: "exit 0" });
  const fails = [
    [ran({ code: 1, counts: { tests: 3, pass: 2, fail: 1, cancelled: 0, skipped: 0, todo: 0 } }), "FAILED", /^exit 1$/],
    [ran({ code: 7, counts: null }), "FAILED", /exit 7, and no summary was printed/],
    [ran({ code: null, signal: "SIGSEGV", counts: null }), "FAILED", /exit SIGSEGV, and no summary was printed/],
    [ran({ code: null, signal: "SIGKILL", counts: null, timedOut: true }), "TIMED OUT", /its process group was killed \(SIGKILL\)/],
    // A status that the output does not bear out is no pass: a file that ended 0 and printed no
    // summary, or one whose summary counts failures.
    [ran({ counts: null }), "FAILED", /exit 0, but no summary was printed/],
    [ran({ counts: { tests: 3, pass: 2, fail: 1, cancelled: 0, skipped: 0, todo: 0 } }), "FAILED", /exit 0, but its summary counts failed or cancelled/],
    [ran({ counts: { tests: 3, pass: 2, fail: 0, cancelled: 1, skipped: 0, todo: 0 } }), "FAILED", /exit 0, but its summary counts failed or cancelled/],
    [ran({ code: null, counts: null, error: "spawn ENOENT" }), "FAILED", /could not be started: spawn ENOENT/],
  ];
  for (const [result, label, why] of fails) {
    const v = verdict(result);
    assert.deepEqual([v.ok, v.label], [false, label], JSON.stringify(result));
    assert.match(v.why, why);
  }
  // Nothing but skips: not a failure, and said not to be evidence.
  for (const counts of [{ tests: 4, pass: 0, fail: 0, cancelled: 0, skipped: 4, todo: 0 }, { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 }]) {
    const v = verdict(ran({ counts }));
    assert.deepEqual([v.ok, v.label], [true, "no test passed"]);
    assert.match(v.why, /this is not evidence/);
  }
});

test("named-test-run buildTable: one row a file, with its counts, its exit status and its duration; a failure fails the run", () => {
  const runs = [
    ran(),
    ran({ file: "test/longer-name.test.mjs", code: 1, counts: { tests: 12, pass: 10, fail: 1, cancelled: 0, skipped: 1, todo: 0 }, durationMs: 65_432 }),
    ran({ file: "test/hangs.test.mjs", code: null, signal: "SIGKILL", counts: null, timedOut: true, durationMs: 300_000 }),
    ran({ file: "test/skips.test.mjs", counts: { tests: 2, pass: 0, fail: 0, cancelled: 0, skipped: 2, todo: 0 }, durationMs: 90 }),
    ran({ file: "test/leaks.test.mjs", leak: true }),
  ];
  assert.deepEqual(buildTable(runs), [
    "file                       result          tests  passed  failed  skipped  cancelled  todo     exit  duration  note",
    "test/a.test.mjs            passed              3       3       0        0          0     0        0      1.2s",
    "test/longer-name.test.mjs  FAILED             12      10       1        1          0     0        1     65.4s",
    "test/hangs.test.mjs        TIMED OUT           -       -       -        -          -     -  SIGKILL    300.0s",
    "test/skips.test.mjs        no test passed      2       0       0        2          0     0        0      0.1s",
    "test/leaks.test.mjs        passed              3       3       0        0          0     0        0      1.2s  left a tmux server on the default socket",
  ]);
  assert.deepEqual(conclude(runs), { ok: false, lines: [
    "5 files: 3 without a failure, 2 failed or timed out.",
    "1 of them passed no test (skipped, or none): a file that only skips is not evidence.",
    "test/leaks.test.mjs left a tmux server on the default socket: its fixture did not isolate its tmux server, and the run fails for it.",
    "Result: FAILED",
  ] });
  assert.deepEqual(conclude([ran()]), { ok: true, lines: ["1 file: 1 without a failure, 0 failed or timed out.", "Result: passed"] });
  // A run of nothing but skips ends 0, and says what it is worth.
  assert.deepEqual(conclude([runs[3]]), { ok: true, lines: ["1 file: 1 without a failure, 0 failed or timed out.", "1 of them passed no test (skipped, or none): a file that only skips is not evidence.", "Result: passed"] });
  // A file that passed and left a tmux server behind fails the run by itself.
  assert.equal(conclude([ran(), runs[4]]).ok, false);
  const markdown = buildMarkdownTable(runs.slice(0, 2));
  assert.equal(markdown.length, 4);
  assert.equal(markdown[0], "| file | result | tests | passed | failed | skipped | cancelled | todo | exit | duration | note |");
  assert.equal(markdown[2], "| test/a.test.mjs | passed | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 1.2s |  |");
});

test("named-test-run show: a value of unknown content cannot start a line, hide a character or flood the log", () => {
  assert.equal(show("main"), '"main"');
  assert.equal(show("a\nb\u001b[31m\u0000"), '"a\\nb\\u001b[31m\\u0000"');
  assert.equal(show("‮gnp.exe\u007f"), '"\\u202egnp.exe\\u007f"');
  assert.equal(show("::error::x"), '"::error::x"');
  assert.equal(show("x".repeat(300)), `"${"x".repeat(200)}" (cut: 300 characters)`);
});

test("named-test-run testEnv: a test file gets this process's environment, less the request, the runner's command files and the nested-run marker", () => {
  const env = { PATH: "/bin", CI: "true", GITHUB_ACTIONS: "true", TMUX_TMPDIR: "/t", MACOS_TESTS_REF: "main", MACOS_TESTS_FILES: "test/a.test.mjs", GITHUB_ENV: "/e", GITHUB_OUTPUT: "/o", GITHUB_PATH: "/p", GITHUB_STATE: "/s", GITHUB_STEP_SUMMARY: "/m", NODE_TEST_CONTEXT: "child-v8" };
  assert.deepEqual(testEnv(env, Object.values(macos.request)), { PATH: "/bin", CI: "true", GITHUB_ACTIONS: "true", TMUX_TMPDIR: "/t" });
  // Each runner drops its own request's names.
  assert.deepEqual(testEnv({ PATH: "/bin", LINUX_TESTS_REF: "main", LINUX_TESTS_FILES: "test/a.test.mjs", XDG_RUNTIME_DIR: "/run/user/1001" }, Object.values(linuxPlatform().request)), { PATH: "/bin", XDG_RUNTIME_DIR: "/run/user/1001" });
  // The tested tree's node_modules/.bin comes first, as `npm test` puts it: the files find its pi.
  assert.deepEqual(testEnv(env, Object.values(macos.request), "/w/tested"), { PATH: `/w/tested/node_modules/.bin${delimiter}/bin`, CI: "true", GITHUB_ACTIONS: "true", TMUX_TMPDIR: "/t" });
  assert.deepEqual(testEnv({ CI: "true" }, [], "/w/tested"), { CI: "true", PATH: "/w/tested/node_modules/.bin" });
  // A relative tree is made absolute: a child resolves a relative PATH entry against its own directory.
  assert.equal(testEnv({ PATH: "/bin" }, [], "tested").PATH, `${join(process.cwd(), "tested", "node_modules", ".bin")}${delimiter}/bin`);
});

const facts = (over = {}) => ({
  asked: "main", kinds: ["branch"], commit: A, files: ["test/a.test.mjs", "test/b.test.mjs"], repeated: [],
  workflowRef: "awebai/oats/.github/workflows/macos-tests.yml@refs/heads/main", workflowSha: B, scriptCommit: B,
  runUrl: "https://github.com/awebai/oats/actions/runs/1", runAttempt: "1",
  macos: { version: "14.7.1", build: "23H222" }, system: "Darwin 23.6.0", imageOS: "macos14", imageVersion: "20261001.1",
  arch: "arm64", machine: "arm64", node: "v22.9.0", nodePath: "/usr/local/bin/node", fileSystem: "case-insensitive",
  tmux: { path: "/opt/homebrew/bin/tmux", version: "tmux 3.5a" }, tmuxSocket: { path: "/private/tmp/tmux-501/oats", there: false }, changed: [], ...over,
});
/** Not macOS, no tmux, not a workflow run, a name that is a branch and a tag, a file named twice, a
 *  changed file. */
const notAWorkflowRun = () => facts({ macos: null, system: "Linux 6.8", tmux: null, workflowRef: null, workflowSha: null, runUrl: null, imageOS: null, imageVersion: null, kinds: ["branch", "tag"], repeated: ["test/a.test.mjs"], changed: [" M package.json"] });
test("named-test-run formatHeader: what the log says of the run", () => {
  const header = formatHeader(facts(), macos).join("\n");
  for (const line of [
    `commit under test:   ${A}`, 'ref asked for:       "main" (a branch)',
    'workflow ref:        "awebai/oats/.github/workflows/macos-tests.yml@refs/heads/main"', `workflow commit:     "${B}"`, `script's commit:     ${B} (the workflow's)`,
    'macOS:               "14.7.1" (build "23H222")', 'runner image:        ImageOS "macos14", ImageVersion "20261001.1"', 'architecture:        arm64 (machine "arm64")',
    'node:                v22.9.0 ("/usr/local/bin/node")', "file system:         case-insensitive (measured", 'tmux on PATH:        "/opt/homebrew/bin/tmux", "tmux 3.5a"',
    'tmux default socket: "/private/tmp/tmux-501/oats" is not there', "tracked files that differ from the commit: none", "at most 10 files a run, 5 minutes a file",
    "files (2), each alone, in this order:\n    test/a.test.mjs\n    test/b.test.mjs",
  ]) assert.ok(header.includes(line), `the header lacks: ${line}\n${header}`);

  // Not macOS, no tmux, not a workflow run: each is said, none is left out.
  const local = formatHeader(notAWorkflowRun(), macos).join("\n");
  for (const line of ['macOS:               NOT macOS: "Linux 6.8"', "tmux on PATH:        no", "workflow ref:        (not set: not a workflow run)", "ImageOS (not set), ImageVersion (not set)", '"main" (a branch and a tag)', "(named more than once, runs once: test/a.test.mjs)", 'tracked files that differ from the commit: 1 (" M package.json")']) {
    assert.ok(local.includes(line), `the header lacks: ${line}\n${local}`);
  }
  assert.match(formatHeader(facts({ scriptCommit: A }), macos).join("\n"), /NOT the workflow's commit/);
  assert.match(formatHeader(facts({ kinds: ["commit id"] }), macos).join("\n"), /\(a commit id\)/);
  assert.match(formatHeader(facts({ tmuxSocket: { path: "/private/tmp/tmux-501/oats", there: true } }), macos).join("\n"), /EXISTS before the first file: the leak check is skipped for this run/);
});

// What the macOS runner printed before its code became named-test-run.mjs's, captured once by running
// scripts/macos-tests.mjs as it was at fc8a91ad, with the facts and runs of this file. The macOS
// runner's printed evidence is unchanged, and this says so by comparing whole texts.
//   * `header` and `headerLocal` are that script's formatHeader output, `refused` its prepare's
//     output, exit status and step summary for a refused request, and `usage` its main's usage line:
//     real output of the code at fc8a91ad.
//   * `summary` and `summaryLocal` are not: that code wrote the step summary inside run(), from files
//     it had just run, with no seam for given facts and runs. They were built from run()'s summary
//     expression, copied verbatim into the capture and fed this file's facts and runs. So they pin
//     summaryLines to that expression's text, not to a recorded run's summary.
const BEFORE_THE_SHARED_SCRIPT = {
  "header": "macOS test run\n  commit under test:   aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n  ref asked for:       \"main\" (a branch)\n  workflow ref:        \"awebai/oats/.github/workflows/macos-tests.yml@refs/heads/main\"\n  workflow commit:     \"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"\n  script's commit:     bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb (the workflow's)\n  run:                 \"https://github.com/awebai/oats/actions/runs/1\", attempt \"1\"\n  macOS:               \"14.7.1\" (build \"23H222\")\n  runner image:        ImageOS \"macos14\", ImageVersion \"20261001.1\"\n  architecture:        arm64 (machine \"arm64\")\n  node:                v22.9.0 (\"/usr/local/bin/node\")\n  file system:         case-insensitive (measured beside the tree: a file made, then looked for by another case)\n  tmux on PATH:        \"/opt/homebrew/bin/tmux\", \"tmux 3.5a\"\n  tmux default socket: \"/private/tmp/tmux-501/oats\" is not there (looked for again after each file)\n  tracked files that differ from the commit: none\n  bounds:              at most 10 files a run, 5 minutes a file\n  files (2), each alone, in this order:\n    test/a.test.mjs\n    test/b.test.mjs",
  "headerLocal": "macOS test run\n  commit under test:   aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n  ref asked for:       \"main\" (a branch and a tag)\n  workflow ref:        (not set: not a workflow run)\n  workflow commit:     (not set: not a workflow run)\n  script's commit:     bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n  run:                 (not set: not a workflow run)\n  macOS:               NOT macOS: \"Linux 6.8\"\n  runner image:        ImageOS (not set), ImageVersion (not set)\n  architecture:        arm64 (machine \"arm64\")\n  node:                v22.9.0 (\"/usr/local/bin/node\")\n  file system:         case-insensitive (measured beside the tree: a file made, then looked for by another case)\n  tmux on PATH:        no\n  tmux default socket: \"/private/tmp/tmux-501/oats\" is not there (looked for again after each file)\n  tracked files that differ from the commit: 1 (\" M package.json\")\n  bounds:              at most 10 files a run, 5 minutes a file\n  files (2), each alone, in this order:\n    test/a.test.mjs\n    test/b.test.mjs\n  (named more than once, runs once: test/a.test.mjs)",
  "summary": "## macOS test run: FAILED\n\n- Commit under test: <code>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</code>, asked for as <code>\"main\"</code>.\n- Workflow: <code>\"awebai/oats/.github/workflows/macos-tests.yml@refs/heads/main\"</code> at <code>\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"</code>.\n- macOS \"14.7.1\", arm64, node v22.9.0, case-insensitive file system, tmux \"tmux 3.5a\".\n\n| file | result | tests | passed | failed | skipped | cancelled | todo | exit | duration | note |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n| test/a.test.mjs | passed | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 1.2s |  |\n| test/b.test.mjs | FAILED | 2 | 1 | 1 | 0 | 0 | 0 | 1 | 4.3s |  |\n\n- 2 files: 1 without a failure, 1 failed or timed out.\n- Result: FAILED\n\nThe step's log has the full header and each file's output; it is the evidence, not this summary.\n",
  "summaryLocal": "## macOS test run: passed\n\n- Commit under test: <code>aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</code>, asked for as <code>\"main\"</code>.\n- Workflow: <code>\"not a workflow run\"</code> at <code>\"-\"</code>.\n- NOT macOS, arm64, node v22.9.0, case-insensitive file system, tmux not on PATH.\n\n| file | result | tests | passed | failed | skipped | cancelled | todo | exit | duration | note |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n| test/a.test.mjs | passed | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 1.2s |  |\n\n- 1 file: 1 without a failure, 0 failed or timed out.\n- Result: passed\n\nThe step's log has the full header and each file's output; it is the evidence, not this summary.\n",
  "refused": {
    "code": 2,
    "out": "Refused: nothing was checked out, installed or run.\n  ref \"-x\": starts with `-`\n  file \"../y\": has a `..` segment\n",
    "summary": "## macOS test run: refused\n\nRefused: nothing was checked out, installed or run.\n\n<pre>\nref \"-x\": starts with `-`\nfile \"../y\": has a `..` segment\n</pre>\n\n"
  },
  "usage": "usage: node scripts/macos-tests.mjs <prepare|run> <tree>   (the request: MACOS_TESTS_REF, MACOS_TESTS_FILES)\n"
};
test("named-test-run macOS: the header, the summary, a refusal and the usage are byte for byte what the macOS script printed", async () => {
  const today = BEFORE_THE_SHARED_SCRIPT;
  const local = notAWorkflowRun();
  assert.equal(formatHeader(facts(), macos).join("\n"), today.header);
  assert.equal(formatHeader(local, macos).join("\n"), today.headerLocal);
  const runs = [ran(), ran({ file: "test/b.test.mjs", code: 1, counts: { tests: 2, pass: 1, fail: 1, cancelled: 0, skipped: 0, todo: 0 }, durationMs: 4321 })];
  assert.equal(summaryLines(facts(), runs, macos).join("\n"), today.summary);
  assert.equal(summaryLines(local, [ran()], macos).join("\n"), today.summaryLocal);
  const dir = mkdtempSync(join(tmpdir(), "oats-named-test-run-today-")), file = join(dir, "summary.md"), out = collect();
  try {
    const code = prepare({ tree: join(dir, "never"), platform: macos, repo: dir, env: { MACOS_TESTS_REF: "-x", MACOS_TESTS_FILES: "test/a.test.mjs ../y", GITHUB_STEP_SUMMARY: file }, write: out.write });
    assert.deepEqual({ code, out: out.text(), summary: readFileSync(file, "utf8") }, today.refused);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const usage = collect();
  await main(macos, [], {}, usage.write);
  assert.equal(usage.text(), today.usage);
});

// ---- against a checkout: a local bare repository as origin ---------------------------------------

const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-macos-tests-")));
test.after(() => rmSync(base, { recursive: true, force: true }));
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_TERMINAL_PROMPT: "0" };
const git = (dir, ...args) => execFileSync("git", ["-C", dir, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "protocol.file.allow=always", ...args], { encoding: "utf8", env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] }).trim();
const marker = join(base, "ran.marker");
// A test file that says it ran: nothing of a refused request may run, so this must not appear.
const FAKE = 'import test from "node:test";\nimport { writeFileSync } from "node:fs";\ntest("ran", () => writeFileSync(process.env.MACOS_TESTS_MARKER, "ran\\n", { flag: "a" }));\n';

/** origin (bare) with branches, tags and the odd entries, and `runner`, a clone of it as
 *  actions/checkout leaves one: every branch of origin under refs/remotes/origin, every tag. */
function buildFixture() {
  const origin = join(base, "origin.git"), seed = join(base, "seed"), runner = join(base, "runner");
  git(base, "init", "-q", "--bare", "-b", "main", origin);
  git(base, "clone", "-q", origin, seed);
  const write = (rel, text) => { mkdirSync(dirname(join(seed, rel)), { recursive: true }); writeFileSync(join(seed, rel), text); };
  const commit = (message) => { git(seed, "add", "-A"); git(seed, "commit", "-qm", message); return git(seed, "rev-parse", "HEAD"); };
  git(seed, "checkout", "-q", "-b", "main");
  write("test/a.test.mjs", FAKE);
  const first = commit("first");
  git(seed, "tag", "v1");
  write("test/sub/b.test.mjs", FAKE);
  write("packages/p/test/c.test.mjs", FAKE);
  write("test/dir.test.mjs/inside.txt", "a directory named as a test file\n");
  symlinkSync("a.test.mjs", join(seed, "test/link.test.mjs"));
  symlinkSync("sub", join(seed, "test/linked"));
  const main = commit("second");
  git(seed, "tag", "-a", "-m", "annotated", "v2");
  git(seed, "tag", "both"); git(seed, "branch", "both");
  git(seed, "tag", "clash", first); git(seed, "branch", "clash");
  git(seed, "tag", "blobtag", git(seed, "rev-parse", "HEAD:test/a.test.mjs"));
  git(seed, "branch", "2026");
  git(seed, "checkout", "-q", "-b", "feature/x");
  write("test/only-feature.test.mjs", FAKE);
  const feature = commit("feature");
  git(seed, "checkout", "-q", "-b", "gone", "main");
  write("test/gone.test.mjs", FAKE);
  const gone = commit("on a branch that is deleted");
  git(seed, "push", "-q", "origin", "refs/heads/*:refs/heads/*", "refs/tags/*:refs/tags/*");
  git(seed, "push", "-q", "origin", ":refs/heads/gone");
  // --no-local: as a fetch over the network, only what the branches and tags reach comes along.
  git(base, "clone", "-q", "--no-local", origin, runner);
  // In the checkout and on no branch or tag of origin: a commit nothing points at, and one on a branch of the checkout's own.
  const dangling = git(runner, "commit-tree", "-m", "dangling", "-p", main, `${main}^{tree}`);
  git(runner, "branch", "local-only", git(runner, "commit-tree", "-m", "local", "-p", main, `${main}^{tree}`));
  const localOnly = git(runner, "rev-parse", "local-only");
  return { origin, runner, first, main, feature, gone, dangling, localOnly };
}
// Built while the module loads: a build that throws ends the file before the `after` hook above
// could run, so the base is removed here, and the error goes on.
const fixture = (() => { try { return buildFixture(); } catch (error) { rmSync(base, { recursive: true, force: true }); throw error; } })();
const { runner } = fixture;
const request = (ref, files = "test/a.test.mjs") => validateRequest({ ref, files }, runner);
const why = (result) => result.refusals.map(({ entry, why: reason }) => `${entry}: ${reason}`).join("\n");

test("named-test-run resolveRef: a branch, a tag and a full commit id of origin resolve to their commit", () => {
  const { first, main, feature } = fixture;
  assert.deepEqual(resolveRef("main", runner), { asked: "main", ok: true, commit: main, kinds: ["branch"] });
  assert.deepEqual(resolveRef("feature/x", runner), { asked: "feature/x", ok: true, commit: feature, kinds: ["branch"] });
  assert.deepEqual(resolveRef("v1", runner), { asked: "v1", ok: true, commit: first, kinds: ["tag"] });
  assert.deepEqual(resolveRef("v2", runner), { asked: "v2", ok: true, commit: main, kinds: ["tag"] }, "an annotated tag is peeled to its commit");
  assert.deepEqual(resolveRef(first, runner), { asked: first, ok: true, commit: first, kinds: ["commit id"] });
  assert.deepEqual(resolveRef(feature.toUpperCase(), runner), { asked: feature.toUpperCase(), ok: true, commit: feature, kinds: ["commit id"] });
  assert.deepEqual(resolveRef("2026", runner), { asked: "2026", ok: true, commit: main, kinds: ["branch"] }, "a branch named as a number is a branch");
  // A branch and a tag of one name: one commit is no ambiguity, two are.
  assert.deepEqual(resolveRef("both", runner), { asked: "both", ok: true, commit: main, kinds: ["branch", "tag"] });
  const clash = resolveRef("clash", runner);
  assert.equal(clash.ok, false);
  assert.match(clash.why, new RegExp(`the branch is ${main}, the tag is ${first}`));
});

test("named-test-run resolveRef: what is not a commit of origin's branches and tags is refused", () => {
  const { main, gone, dangling, localOnly } = fixture;
  const refused = [
    [gone, /is no commit of what was fetched from origin \(a commit on no branch or tag, or a fork's, is not accepted\)/],
    ["0".repeat(40), /is no commit of what was fetched from origin/],
    [dangling, /is on no branch or tag that was fetched from origin/],
    [localOnly, /is on no branch or tag that was fetched from origin/],
    ["local-only", /is no branch or tag that was fetched from origin/],
    ["gone", /is no branch or tag that was fetched from origin/],
    [main.slice(0, 12), /shortened commit id, give all 40 characters/],
    ["HEAD", /is no branch or tag/],
    ["origin/main", /without `origin\/`/],
    ["refs/heads/main", /give the short name/],
    ["feature", /is no branch or tag/],
    ["blobtag", /does not point at a commit/],
    [git(runner, "rev-parse", "v2"), /is a tag, not a commit/],
    [git(runner, "rev-parse", "main^{tree}"), /is a tree, not a commit/],
    ["17", /a pull request is not accepted/],
    ["#17", /a pull request is not accepted/],
    ["refs/pull/17/head", /a pull request is not accepted/],
    ["main^", /a character outside/],
    ["--upload-pack=x", /starts with `-`/],
    ["v1..main", /has `\.\.`/],
    ["", /no ref was given/],
    // The text is taken as it was typed: white space around a name that exists is still refused.
    ["  main\n", /white space or a control character/],
    ["main ", /white space or a control character/],
    ["\tmain\r", /white space or a control character/],
    ["\u00a0main", /white space or a control character/],
    [" ", /white space or a control character/],
    ["\n", /white space or a control character/],
  ];
  for (const [ref, reason] of refused) {
    const result = resolveRef(ref, runner);
    assert.equal(result.ok, false, `${JSON.stringify(ref)} resolved to ${result.commit}`);
    assert.equal(result.asked, ref, "the refusal shows the text as it was typed");
    assert.match(result.why, reason, JSON.stringify(ref));
  }
  assert.deepEqual(resolveRef(undefined, runner), { ok: false, asked: "", why: "no ref was given" });
});

test("named-test-run validateRequest: files are checked against the commit's own tree", () => {
  const { main, first, feature } = fixture;
  assert.deepEqual(request("main", "test/a.test.mjs, test/sub/b.test.mjs\npackages/p/test/c.test.mjs test/a.test.mjs"), {
    ok: true, asked: "main", commit: main, kinds: ["branch"], files: ["test/a.test.mjs", "test/sub/b.test.mjs", "packages/p/test/c.test.mjs"], repeated: ["test/a.test.mjs"],
  });
  assert.equal(request("feature/x", "test/only-feature.test.mjs").commit, feature);
  const refused = [
    ["main", "test/link.test.mjs", /file "test\/link\.test\.mjs": is a symbolic link at that commit/],
    ["main", "test/linked/b.test.mjs", /file "test\/linked\/b\.test\.mjs": is not a file at that commit/],
    ["main", "test/dir.test.mjs", /is a directory at that commit, not a file/],
    ["main", "test/missing.test.mjs", /is not a file at that commit/],
    ["main", "test/A.test.mjs", /is not a file at that commit/],
    // A file of main that the ref does not have, and one of another branch.
    ["v1", "test/sub/b.test.mjs", new RegExp(`is not a file at that commit \\(${first}\\)`)],
    ["main", "test/only-feature.test.mjs", /is not a file at that commit/],
    ["main", "", /the list of files: no test file was named/],
    ["main", " ,\n", /no test file was named/],
    ["main", Array.from({ length: 11 }, (_, i) => `test/f${i}.test.mjs`).join(" "), /the list of files: 11 files were named; one run takes at most 10/],
  ];
  for (const [ref, files, reason] of refused) {
    const result = request(ref, files);
    assert.equal(result.ok, false, `${ref} ${files}`);
    assert.match(why(result), reason);
  }
});

test("named-test-run validateRequest: a refusal names every entry it refuses, and why", () => {
  const result = request("pull/7/head", "test/a.test.mjs ../etc/passwd test/missing.test.mjs lib/core.mjs");
  assert.deepEqual(result, { ok: false, refusals: [
    { entry: 'ref "pull/7/head"', why: "is no branch or tag, and a pull request is not accepted (a fork's head is not this repository's commit): name a branch or a tag of this repository, or give a commit's full id" },
    { entry: 'file "../etc/passwd"', why: "has a `..` segment" },
    { entry: 'file "lib/core.mjs"', why: "does not match test/**/*.test.mjs or packages/<name>/test/**/*.test.mjs" },
  ] }, "with no commit, a well-formed file cannot be looked up and is not blamed");
  const files = request("main", "test/link.test.mjs test/missing.test.mjs test/a.test.mjs -rf");
  assert.deepEqual(files.refusals.map(({ entry }) => entry), ['file "-rf"', 'file "test/link.test.mjs"', 'file "test/missing.test.mjs"']);
});

const stepEnv = (ref, files, extra = {}) => ({ ...process.env, MACOS_TESTS_REF: ref, MACOS_TESTS_FILES: files, MACOS_TESTS_MARKER: marker, TMUX_TMPDIR: join(base, "no-tmux-here"), GITHUB_STEP_SUMMARY: "", ...extra });

test("named-test-run prepare: a refused request checks nothing out and runs nothing", () => {
  const { gone, dangling } = fixture;
  for (const [i, [ref, files, reason]] of [
    [gone, "test/a.test.mjs", /is no commit of what was fetched from origin/],
    [dangling, "test/a.test.mjs", /is on no branch or tag/],
    ["main@{0}", "test/a.test.mjs", /a character outside/],
    ["main", "test/link.test.mjs", /is a symbolic link/],
    ["main", "test/missing.test.mjs", /is not a file at that commit/],
    ["main", Array.from({ length: 11 }, (_, n) => `test/f${n}.test.mjs`).join(","), /one run takes at most 10/],
    ["42", "test/a.test.mjs ../x", /a pull request is not accepted[^]*has a `\.\.` segment/],
  ].entries()) {
    const tree = join(base, `refused-${i}`), out = collect(), summary = join(base, `refused-${i}.md`);
    assert.equal(prepare({ tree, platform: macos, repo: runner, env: stepEnv(ref, files, { GITHUB_STEP_SUMMARY: summary }), write: out.write }), 2, `${ref} ${files}`);
    assert.match(out.text(), /^Refused: nothing was checked out, installed or run\.\n/);
    assert.match(out.text(), reason);
    assert.ok(!existsSync(tree), "nothing was checked out");
    assert.match(readFileSync(summary, "utf8"), /## macOS test run: refused/);
    assert.match(readFileSync(summary, "utf8"), reason);
  }
  assert.ok(!existsSync(marker), "nothing ran");
  assert.equal(git(runner, "worktree", "list", "--porcelain").match(/^worktree /gm).length, 1, "no tree was added to the checkout");
});

test("named-test-run prepare, then run: the commit goes to a second tree, the header says what was resolved, and each file runs there", async () => {
  const { feature } = fixture;
  const tree = join(base, "tested"), summary = join(base, "summary.md");
  const env = stepEnv("feature/x", "test/only-feature.test.mjs, test/a.test.mjs", { GITHUB_STEP_SUMMARY: summary, GITHUB_WORKFLOW_REF: "o/r/.github/workflows/macos-tests.yml@refs/heads/main", GITHUB_SHA: fixture.main });
  const prepared = collect();
  assert.equal(prepare({ tree, platform: macos, repo: runner, env, write: prepared.write }), 0, prepared.text());
  assert.equal(git(tree, "rev-parse", "HEAD"), feature);
  assert.equal(git(tree, "rev-parse", "--abbrev-ref", "HEAD"), "HEAD", "detached: no branch of the checkout moves");
  assert.equal(git(runner, "rev-parse", "HEAD"), fixture.main, "the script's own tree stays where it was");
  for (const line of [`commit under test:   ${feature}`, 'ref asked for:       "feature/x" (a branch)', `script's commit:     ${fixture.main} (the workflow's)`, "tracked files that differ from the commit: none", `${feature} is checked out at ${tree}.`]) {
    assert.ok(prepared.text().includes(line), `prepare did not print: ${line}\n${prepared.text()}`);
  }
  assert.match(prepared.text(), /file system:         case-(in)?sensitive \(measured/);
  assert.match(prepared.text(), /tmux default socket: .*no-tmux-here\/tmux-\d+\/oats" is not there/);
  // The boundary is in the evidence itself: the first step's last line says what is above it.
  assert.match(prepared.text(), /\nEverything above this line was printed before any code of the ref ran\.\n$/);
  assert.ok(!existsSync(marker), "prepare runs nothing of the ref");
  // A second prepare does not write over a tree that is there.
  assert.equal(prepare({ tree, platform: macos, repo: runner, env, write: collect().write }), 2);

  const out = collect();
  assert.equal(await run({ tree, platform: macos, repo: runner, env, write: out.write, timeoutMs: 120_000 }), 0, out.text());
  assert.equal(readFileSync(marker, "utf8"), "ran\nran\n", "each file ran once");
  const text = out.text();
  assert.ok(text.indexOf(`commit under test:   ${feature}`) < text.indexOf("=== 1/2 test/only-feature.test.mjs: node --test test/only-feature.test.mjs ==="), "the header comes before the first file");
  // The second step's header does not claim what only the first can: it was read after the installs.
  assert.ok(!text.includes("Everything above this line"));
  assert.match(text, /This header was read again after the ref's install scripts ran[^]*The header to rely on is the validation step's/);
  assert.match(text, /=== test\/only-feature\.test\.mjs: passed \(exit 0\); tests 1, passed 1, failed 0, skipped 0, cancelled 0, todo 0; exit 0; \d+\.\ds ===/);
  assert.match(text, /test\/a\.test\.mjs +passed +1 +1 +0 +0 +0 +0 +0 +\d+\.\ds\n\n2 files: 2 without a failure, 0 failed or timed out\.\nResult: passed\n$/);
  const page = readFileSync(summary, "utf8");
  assert.match(page, /## macOS test run: passed/);
  assert.ok(page.includes(`<code>${feature}</code>`) && page.includes("| test/a.test.mjs | passed | 1 | 1 | 0 | 0 | 0 | 0 | 0 |"));

  // The second step trusts nothing carried from the first: a request that names another commit
  // than the tree holds, or one that is refused, runs nothing.
  rmSync(marker);
  for (const [ref, files, reason] of [["main", "test/a.test.mjs", /the tree at .* is not at /], ["feature/x", "test/missing.test.mjs", /is not a file at that commit/], ["", "test/a.test.mjs", /no ref was given/]]) {
    const refused = collect();
    assert.equal(await run({ tree, platform: macos, repo: runner, env: stepEnv(ref, files), write: refused.write }), 2);
    assert.match(refused.text(), /^Refused: no file was run\./);
    assert.match(refused.text(), reason);
  }
  assert.equal(await run({ tree: join(base, "no-such-tree"), platform: macos, repo: runner, env, write: collect().write }), 2);
  assert.ok(!existsSync(marker), "nothing ran");
});

// The Linux platform, through the same two steps. Its programs are fakes: nothing here asks this
// host's own systemd, so the case runs the same on a Mac and on pull-request CI.
const program = (name, body) => fakeProgram(base, name, body);
const linuxEnv = (extra = {}) => ({ ...process.env, LINUX_TESTS_REF: "feature/x", LINUX_TESTS_FILES: "test/a.test.mjs", MACOS_TESTS_MARKER: marker, TMUX_TMPDIR: join(base, "no-tmux-here"), XDG_RUNTIME_DIR: "/run/user/1001", GITHUB_STEP_SUMMARY: "", ...extra });
test("named-test-run Linux: the header says the user manager answered, and the files run", async () => {
  if (existsSync(marker)) rmSync(marker);
  const loginctl = program("loginctl", "echo yes");
  const answering = linuxPlatform({ systemctl: program("systemctl-running", "echo running"), loginctl });
  const tree = join(base, "linux-tested"), summary = join(base, "linux-summary.md");
  const prepared = collect();
  assert.equal(prepare({ tree, platform: answering, repo: runner, env: linuxEnv({ GITHUB_STEP_SUMMARY: summary }), write: prepared.write }), 0, prepared.text());
  assert.match(prepared.text(), /^Linux test run\n  commit under test:   /);
  for (const line of ['XDG_RUNTIME_DIR:     "/run/user/1001"', 'lingering:           "yes" (loginctl show-user', 'user manager:        answered "running" (systemctl --user is-system-running --wait, ', "of at most 60.0s)"]) {
    assert.ok(prepared.text().includes(line), `prepare did not print: ${line}\n${prepared.text()}`);
  }
  assert.match(prepared.text(), /\nEverything above this line was printed before any code of the ref ran\.\n$/);
  const out = collect();
  assert.equal(await run({ tree, platform: answering, repo: runner, env: linuxEnv({ GITHUB_STEP_SUMMARY: summary }), write: out.write, timeoutMs: 120_000 }), 0, out.text());
  assert.match(out.text(), /user manager: {8}answered "running" \(systemctl --user is-system-running, read again, /);
  assert.equal(readFileSync(marker, "utf8"), "ran\n");
  assert.match(readFileSync(summary, "utf8"), /## Linux test run: passed\n\n[^]*, user manager "running", /);
  rmSync(marker);
});

test("named-test-run Linux: a user manager probe at the deadline refuses prepare and run without side effects", async (t) => {
  if (existsSync(marker)) rmSync(marker);
  // A manager that does not answer: the header says so, the step fails after it, and nothing runs.
  const trace = join(base, "systemctl-offline.trace"), source = join(base, "systemctl-offline.mjs"), count = join(base, "systemctl-offline.count");
  // Each step gets one finite probe which deliberately outlasts its entire wait bound.
  // exec keeps the sleeper in the owned process; an entry without completion witnesses its kill.
  writeFileSync(source, `
    import { appendFileSync } from "node:fs";
    const trace = ${JSON.stringify(trace)};
    appendFileSync(trace, JSON.stringify({ pid: process.pid, invokedPid: Number(process.argv[2]), ask: Number(process.argv[3]), state: null, entered: Date.now(), waited: process.argv.includes("--wait") }) + "\\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
    appendFileSync(trace, JSON.stringify({ completed: Date.now() }) + "\\n");
    console.log("offline");
    process.exitCode = 1;
  `);
  const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const systemctl = program("systemctl-offline", `
    waited=false
    for arg in "$@"; do
      case "$arg" in --wait) waited=true ;; esac
    done
    n=1
    if [ "$waited" = true ]; then
      n=0
      if [ -f ${quote(count)} ]; then read -r n < ${quote(count)}; fi
      n=$((n + 1))
      printf '%s\\n' "$n" > ${quote(count)}
      if [ "$n" -lt 3 ]; then
        printf '{"pid":%s,"ask":%s,"state":"offline","waited":true}\\n' "$$" "$n" >> ${quote(trace)}
        echo offline
        exit 1
      fi
    fi
    exec ${quote(process.execPath)} ${quote(source)} "$$" "$n" "$@"
  `);
  const silent = linuxPlatform({ systemctl, loginctl: program("loginctl-refusal", "echo yes"), waitMs: 600, pauseMs: 50 });
  const readFacts = silent.readFacts, observations = [];
  silent.readFacts = (args) => {
    const started = Date.now(), facts = readFacts(args);
    observations.push({ step: args.step, started, returned: Date.now(), manager: facts.userManager });
    return facts;
  };
  const unfit = join(base, "linux-unfit"), refusedSummary = join(base, "linux-refused.md");
  const refused = collect();
  assert.equal(prepare({ tree: unfit, platform: silent, repo: runner, env: linuxEnv({ GITHUB_STEP_SUMMARY: refusedSummary }), write: refused.write }), 2);
  assert.ok(!refused.text().includes("The request is valid"));
  assert.match(readFileSync(refusedSummary, "utf8"), /## Linux test run: refused/);
  const again = collect();
  assert.equal(await run({ tree: unfit, platform: silent, repo: runner, env: linuxEnv(), write: again.write, timeoutMs: 120_000 }), 2);
  assert.match(again.text(), /\nRefused: no file was run\.\n  the user manager: did not answer/);
  assert.ok(!existsSync(marker), "nothing ran");
  const entries = readFileSync(trace, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  // Exclude loginctl's prefix. This estimate includes post-return sampling overhead;
  // the manager's own elapsed time and timeout state carry the real timeout evidence.
  const estimatedDeadlines = observations.map(({ returned, manager }) => returned - manager.ms + 600);
  t.diagnostic(JSON.stringify({ observations, estimatedDeadlines, entries, prepare: refused.text(), run: again.text() }));
  assert.deepEqual(observations.map(({ step }) => step), ["prepare", "run"]);
  assert.equal(entries.length, 4, "two offline replies and one unfinished probe per step, with no completion witness");
  assert.deepEqual(entries.map(({ waited }) => waited), [true, true, true, false]);
  assert.deepEqual(entries.map(({ ask }) => ask), [1, 2, 3, 1]);
  assert.deepEqual(entries.map(({ state }) => state), ["offline", "offline", null, null]);
  assert.equal(observations[1].manager.state, observations[0].manager.state);
  for (const [i, { started, returned, manager }] of observations.entries()) {
    const entry = entries[i + 2];
    assert.equal(entry.pid, entry.invokedPid);
    assert.ok(entry.entered < estimatedDeadlines[i], "the probe entered before the deadline estimated from manager elapsed");
    assert.ok(returned - started >= 600 - 50, "the external elapsed time agrees with the bound");
    assert.equal(manager.answered, false);
    assert.equal(manager.asks, i === 0 ? 3 : 1);
    assert.equal(manager.waited, i === 0);
    assert.ok(manager.ms >= 600 - 50 && manager.ms < 5_000, `refused after ${manager.ms}ms`);
  }
  assert.match(refused.text(), /user manager: {8}did NOT answer: "no answer within 0\.6s" \(systemctl --user is-system-running --wait, asked \d+ times, \d+\.\ds of at most 0\.6s\)/);
  assert.match(refused.text(), /\n\nRefused: nothing was installed or run\.\n  the user manager: did not answer \("no answer within 0\.6s"\): `systemctl --user` cannot be relied on, so no file runs\n$/);
});

test("named-test-run main: on a workflow run nothing it prints is read as a workflow command", async () => {
  const out = collect(), tree = join(base, "never");
  // Refused on its shape, before the checkout is read at all.
  assert.equal(await main(macos, ["prepare", tree], stepEnv("::error::x", "::add-mask::failed", { GITHUB_ACTIONS: "true" }), out.write), 2);
  const lines = out.text().trimEnd().split("\n");
  const token = /^::stop-commands::([0-9a-f]{32})$/.exec(lines[0])?.[1];
  assert.ok(token, `the first line stops workflow commands: ${lines[0]}`);
  assert.equal(lines.at(-1), `::${token}::`, "the last line resumes them, for the steps after");
  assert.ok(lines.slice(1, -1).every((line) => !line.startsWith("::")), "no line between starts as a command");
  assert.match(out.text(), /ref "::error::x": has a character outside/);
  assert.match(out.text(), /file "::add-mask::failed": has a segment that is empty or has a character outside/);
  assert.ok(!existsSync(tree));
  // Not a workflow run: no command lines at all.
  const local = collect();
  assert.equal(await main(macos, ["prepare", tree], stepEnv("-x", "test/a.test.mjs", { GITHUB_ACTIONS: "" }), local.write), 2);
  assert.ok(!local.text().includes("::stop-commands::"));
  for (const argv of [[], ["prepare"], ["check", tree], ["run", tree, "extra"]]) {
    const usage = collect();
    assert.equal(await main(macos, argv, stepEnv("main", "test/a.test.mjs"), usage.write), 2);
    assert.match(usage.text(), /^usage: node scripts\/macos-tests\.mjs <prepare\|run> <tree>/);
  }
});

test("named-test-run measureCase: measured, by a file made and looked for by another case", () => {
  const dir = mkdtempSync(join(base, "case-"));
  const measured = measureCase(dir);
  writeFileSync(join(dir, "probe"), "");
  assert.equal(measured, existsSync(join(dir, "PROBE")) ? "case-insensitive" : "case-sensitive");
  assert.deepEqual(execFileSync("ls", ["-A", dir], { encoding: "utf8" }).trim().split("\n"), ["probe"], "the measuring leaves nothing behind");
  assert.match(measureCase(join(base, "no-such-directory")), /^unknown \(ENOENT\)$/);
});

test("named-test-run defaultTmuxSocket: tmux's own place for the server named oats", () => {
  const uid = process.getuid();
  assert.equal(defaultTmuxSocket({ TMUX_TMPDIR: "/some/dir" }), `/some/dir/tmux-${uid}/oats`);
  // /tmp is a link on macOS: tmux resolves it, and so does this.
  assert.equal(defaultTmuxSocket({}), `${realpathSync("/tmp")}/tmux-${uid}/oats`);
  assert.equal(defaultTmuxSocket({ TMUX_TMPDIR: "" }), `${realpathSync("/tmp")}/tmux-${uid}/oats`);
});
