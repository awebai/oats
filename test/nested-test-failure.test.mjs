// The failure message of the nested Desktop run in release-workflow.test.mjs
// (awebai/oats#644): it must name the failing tests, whichever reporter the
// child used, and stay bounded. The fixtures are Node 22 output (CI's
// version) trimmed of most stack frames; the last tests run a real child.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { MAX_FAILURES, MAX_MESSAGE, describeNestedTestFailure } from "./helpers/nested-test-failure.mjs";

const T = "/home/runner/work/oats/oats/packages/desktop/test";
const NPM = "\n> @awebai/oats-desktop@0.45.0 test\n> node --test test/*.test.mjs\n\n";

const TAP_SUMMARY = (pass, fail) => [`# tests ${pass + fail}`, "# suites 1", `# pass ${pass}`, `# fail ${fail}`, "# cancelled 0", "# skipped 0", "# todo 0", "# duration_ms 201234.5", ""].join("\n");

const TAP_ONE = `${NPM}TAP version 13
# Subtest: renders the roster
ok 1 - renders the roster
  ---
  duration_ms: 1.03291
  type: 'test'
  ...
# Subtest: top fails
not ok 2 - top fails
  ---
  duration_ms: 1.42869
  type: 'test'
  location: '${T}/a.test.mjs:4:1'
  failureType: 'testCodeFailure'
  error: |-
    one is not two

    1 !== 2

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 2
  actual: 1
  operator: 'strictEqual'
  stack: |-
    TestContext.<anonymous> (file://${T}/a.test.mjs:4:34)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:979:25)
  ...
1..2
${TAP_SUMMARY(1, 1)}`;

const TAP_SEVERAL = `${NPM}TAP version 13
# Subtest: top fails
not ok 1 - top fails
  ---
  duration_ms: 1.42869
  type: 'test'
  location: '${T}/a.test.mjs:4:1'
  failureType: 'testCodeFailure'
  error: |-
    one is not two

    1 !== 2

  code: 'ERR_ASSERTION'
  stack: |-
    TestContext.<anonymous> (file://${T}/a.test.mjs:4:34)
  ...
# Subtest: suite
    # Subtest: inner ok
    ok 1 - inner ok
      ---
      duration_ms: 0.267935
      type: 'test'
      ...
    # Subtest: inner fails
    not ok 2 - inner fails
      ---
      duration_ms: 1.007349
      type: 'test'
      location: '${T}/a.test.mjs:7:3'
      failureType: 'testCodeFailure'
      error: |-
        boom
        second line
      code: 'ERR_TEST_FAILURE'
      stack: |-
        TestContext.<anonymous> (file://${T}/a.test.mjs:7:35)
        Test.runInAsyncScope (node:async_hooks:214:14)
      ...
    1..2
not ok 2 - suite
  ---
  duration_ms: 1.673785
  type: 'suite'
  location: '${T}/a.test.mjs:5:1'
  failureType: 'subtestsFailed'
  error: '1 subtest failed'
  code: 'ERR_TEST_FAILURE'
  ...
# Subtest: parent
    # Subtest: middle
        # Subtest: deep \\# 2
        not ok 1 - deep \\# 2
          ---
          duration_ms: 1.548923
          type: 'test'
          location: '${T}/a.test.mjs:9:39'
          failureType: 'testTimeoutFailure'
          error: 'test timed out after 5000ms'
          code: 'ERR_TEST_FAILURE'
          ...
        1..1
    not ok 1 - middle
      ---
      duration_ms: 1.9
      type: 'test'
      location: '${T}/a.test.mjs:9:20'
      failureType: 'subtestsFailed'
      error: '1 subtest failed'
      code: 'ERR_TEST_FAILURE'
      ...
    # Subtest: sibling
    not ok 2 - sibling
      ---
      duration_ms: 0
      type: 'test'
      location: '${T}/a.test.mjs:12:5'
      failureType: 'cancelledByParent'
      error: 'test did not finish before its parent and was cancelled'
      code: 'ERR_TEST_FAILURE'
      ...
    1..2
not ok 3 - parent
  ---
  duration_ms: 2.08542
  type: 'test'
  location: '${T}/a.test.mjs:9:1'
  failureType: 'subtestsFailed'
  error: '2 subtests failed'
  code: 'ERR_TEST_FAILURE'
  ...
# a stray line some earlier test printed
# Subtest: todo later
not ok 4 - todo later # TODO
  ---
  duration_ms: 0.1
  type: 'test'
  ...
# stray stdout line
# file://${T}/b.test.mjs:3
# throw new Error("import-time crash");
#       ^
# Error: import-time crash
#     at file://${T}/b.test.mjs:3:7
#     at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
#     at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:681:26)
#     at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5)
# Node.js v22.23.3
# Subtest: ${T}/b.test.mjs
not ok 5 - ${T}/b.test.mjs
  ---
  duration_ms: 50.748879
  type: 'test'
  location: '${T}/b.test.mjs:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..5
${TAP_SUMMARY(1, 7)}`;

const SPEC = `${NPM}✔ passes (0.89884ms)
✖ top fails (1.595767ms)
▶ suite
  ✔ inner ok (0.374075ms)
  ✖ inner fails (1.256481ms)
✖ suite (2.185308ms)
ℹ tests 3
ℹ suites 1
ℹ pass 1
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 94.413245

✖ failing tests:

test at test/a.test.mjs:4:1
✖ top fails (1.595767ms)
  AssertionError [ERR_ASSERTION]: one is not two

  1 !== 2

      at TestContext.<anonymous> (file://${T}/a.test.mjs:4:34)
      at Test.runInAsyncScope (node:async_hooks:214:14)
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 2,
    operator: 'strictEqual'
  }

test at test/a.test.mjs:7:3
✖ inner fails (1.256481ms)
  Error: boom
  second line
      at TestContext.<anonymous> (file://${T}/a.test.mjs:7:35)
`;

// The failures section of a message: everything before the tails.
const failuresOf = (message) => message.slice(0, message.indexOf("\n--- stdout tail ---"));
const listed = (message) => failuresOf(message).split("\n").filter((l) => l.startsWith("✖ "));

test("a TAP run with one failure names it, with its location and error, then the tails", () => {
  const m = describeNestedTestFailure({ status: 1, error: undefined, stdout: TAP_ONE, stderr: "" }, "packages/desktop npm test");
  assert.match(m, /^packages\/desktop npm test failed \(status 1\)\n/);
  assert.match(m, /1 failing test:/);
  assert.deepEqual(listed(m), [`✖ top fails  (${T}/a.test.mjs:4:1)`]);
  assert.match(failuresOf(m), /one is not two\n\s*\n\s*1 !== 2/);
  assert.match(failuresOf(m), new RegExp(`at TestContext.<anonymous> \\(file://${T}/a\\.test\\.mjs:4:34\\)`));
  assert.doesNotMatch(failuresOf(m), /node:async_hooks|node:internal/, "node's own frames are noise");
  assert.doesNotMatch(failuresOf(m), /renders the roster/, "passing tests are not listed");
  assert.match(m, /--- stdout tail ---\n[^]*# fail 1\n[^]*--- stderr tail ---\n\(empty\)\n$/, "a bounded stdout tail, then the stderr tail, empty and saying so, end the message");
});

test("a TAP run with several failures names each leaf with its enclosing tests, not the parents it failed", () => {
  const m = describeNestedTestFailure({ status: 1, stdout: TAP_SEVERAL, stderr: "npm error code 1\n" });
  assert.deepEqual(listed(m), [
    `✖ top fails  (${T}/a.test.mjs:4:1)`,
    `✖ suite › inner fails  (${T}/a.test.mjs:7:3)`,
    `✖ parent › middle › deep # 2  (${T}/a.test.mjs:9:39)`,
    `✖ ${T}/b.test.mjs  (${T}/b.test.mjs:1:1)`,
    `✖ parent › sibling  (${T}/a.test.mjs:12:5)`,
  ], "leaves in order, cancelled fallout last; subtestsFailed parents and TODOs omitted");
  assert.match(m, /5 failing tests:/);
  assert.match(failuresOf(m), /boom\n\s*second line/);
  assert.match(failuresOf(m), /test timed out after 5000ms/);
  assert.doesNotMatch(failuresOf(m), /subtests? failed/);
  // A test file that died says only 'test failed'; its last output says why.
  const file = failuresOf(m).slice(failuresOf(m).indexOf(`✖ ${T}/b.test.mjs`));
  assert.match(file, /test failed\n\s*output before it:\n[^]*Error: import-time crash\n[^]*Node\.js v22\.23\.3/);
  assert.doesNotMatch(file, /stray line some earlier test printed/, "only the diagnostics directly above the file's block");
  assert.doesNotMatch(file, /node:internal/, "node's own frames are skipped there too");
  assert.match(m, /--- stderr tail ---\nnpm error code 1\n$/);
});

test("a spec-reporter run names the failures from its failing-tests summary", () => {
  const m = describeNestedTestFailure({ status: 1, stdout: SPEC, stderr: "" }, "packages/desktop npm test");
  assert.deepEqual(listed(m), ["✖ top fails  (test/a.test.mjs:4:1)", "✖ inner fails  (test/a.test.mjs:7:3)"]);
  assert.match(failuresOf(m), /AssertionError \[ERR_ASSERTION\]: one is not two/);
  assert.match(failuresOf(m), /Error: boom\n\s*second line/);
  assert.doesNotMatch(failuresOf(m), /node:async_hooks/);
});

test("a spec-reporter run that died before its summary still names its ✖ leaves", () => {
  const cut = SPEC.slice(0, SPEC.indexOf("ℹ tests"));
  const m = describeNestedTestFailure({ status: 1, stdout: cut, stderr: "" });
  assert.deepEqual(listed(m), ["✖ top fails", "✖ inner fails"], "the ✖ closing the ▶ suite group repeats its failing leaf");
});

test("a spec-reporter run that died before its summary names a parent that failed on its own", () => {
  // Node 22 output: a parent's body throws after its subtests passed, a later
  // group fails through a leaf, then output enough to push both out of the tail.
  const stdout = `${NPM}▶ parent body fails
  ✔ leaf passes (4.259711ms)
  ▶ nested ok
    ✔ deeper passes (0.2ms)
  ✔ nested ok (0.5ms)
✖ parent body fails (13.212652ms)
▶ outer
  ▶ inner
    ✖ leaf fails (1ms)
  ✖ inner (1.2ms)
  ✔ sibling passes (0.1ms)
✖ outer (2ms)
✔ after (0.1ms)
${"padding line\n".repeat(2000)}`;
  const m = describeNestedTestFailure({ status: null, signal: "SIGTERM", error: new Error("spawnSync npm ETIMEDOUT"), stdout, stderr: "" });
  assert.deepEqual(listed(m), ["✖ parent body fails", "✖ leaf fails"]);
  assert.doesNotMatch(m.slice(m.indexOf("--- stdout tail ---")), /parent body fails/, "only the failures section names it");
});

test("an empty stdout with r.error set (maxBuffer, timeout) says why, and that no test could be read", () => {
  for (const [code, signal] of [["ENOBUFS", "SIGTERM"], ["ETIMEDOUT", "SIGTERM"]]) {
    const error = Object.assign(new Error(`spawnSync npm ${code}`), { code });
    const m = describeNestedTestFailure({ status: null, signal, error, stdout: "", stderr: "" }, "packages/desktop npm test");
    assert.match(m, new RegExp(`^packages/desktop npm test failed \\(status null, signal SIGTERM, spawnSync npm ${code}\\)\n`));
    assert.match(m, /No failing test could be read from its output/);
    assert.match(m, /--- stdout tail ---\n\(empty\)\n--- stderr tail ---\n\(empty\)\n$/);
  }
  // A spawn that never started has no output at all.
  const m = describeNestedTestFailure({ status: null, error: new Error("spawnSync npm ENOENT"), stdout: null, stderr: null });
  assert.match(m, /status null, spawnSync npm ENOENT/);
});

test("a flood of failures is bounded: the first few shown, the rest counted, the message under the cap", () => {
  const huge = "x".repeat(5000);
  const blocks = Array.from({ length: 500 }, (_, i) => `# Subtest: flood ${i}
not ok ${i + 1} - flood ${i}
  ---
  duration_ms: 1
  type: 'test'
  location: '${T}/flood.test.mjs:${i + 1}:1'
  failureType: 'testCodeFailure'
  error: |-
    ${huge}
  code: 'ERR_TEST_FAILURE'
  ...`);
  const stdout = `${NPM}TAP version 13\n${blocks.join("\n")}\n1..500\n${"# noise\n".repeat(100000)}${TAP_SUMMARY(0, 500)}`;
  const r = { status: 1, stdout, stderr: "e".repeat(1024 * 1024) };
  const m = describeNestedTestFailure(r, "packages/desktop npm test");
  assert.ok(m.length <= MAX_MESSAGE, `message is ${m.length} characters`);
  assert.equal(listed(m).length, MAX_FAILURES);
  assert.equal(listed(m)[0], `✖ flood 0  (${T}/flood.test.mjs:1:1)`);
  assert.match(m, new RegExp(`500 failing tests, the first ${MAX_FAILURES} shown:`));
  assert.match(m, new RegExp(`… and ${500 - MAX_FAILURES} more failing tests not shown\\.`));
  assert.match(m, /# fail 500\n[^]*--- stderr tail ---\n…\ne+\n$/, "both tails survive, cut to fit");
  // The same holds for the spec reporter.
  const spec = `✖ failing tests:\n\n${Array.from({ length: 500 }, (_, i) => `test at t.mjs:${i}:1\n✖ flood ${i} (1ms)\n  ${huge}\n`).join("\n")}`;
  const s = describeNestedTestFailure({ status: 1, stdout: spec, stderr: huge });
  assert.ok(s.length <= MAX_MESSAGE, `message is ${s.length} characters`);
  assert.equal(listed(s).length, MAX_FAILURES);
});

// A passing run's output must not trip the parser either: TODO and SKIP
// directives, escaped names, a failing TODO, and a lot of it.
test("passing TAP and spec runs, with TODO and SKIP lines, list no failures and do not throw", () => {
  const passing = Array.from({ length: 4000 }, (_, i) => `# Subtest: ok \\# ${i} \\\\ x
ok ${i + 1} - ok \\# ${i} \\\\ x${i % 3 === 0 ? " # SKIP not here" : i % 3 === 1 ? " # TODO" : ""}
  ---
  duration_ms: 0.5
  type: 'test'
  ...`).join("\n");
  const tap = `${NPM}TAP version 13
${passing}
# Subtest: todo failing
not ok 4001 - todo failing # TODO later
  ---
  duration_ms: 0.3
  type: 'test'
  location: '${T}/p.test.mjs:5:1'
  failureType: 'testCodeFailure'
  error: 'todo boom'
  code: 'ERR_TEST_FAILURE'
  ...
1..4001
${TAP_SUMMARY(4001, 0)}`;
  assert.ok(tap.length > 300000, `a large passing run (${tap.length} characters)`);
  const t = describeNestedTestFailure({ status: 0, stdout: tap, stderr: "" });
  assert.deepEqual(listed(t), []);
  assert.ok(t.length <= MAX_MESSAGE);
  // Node 22 marks a failing TODO's spec line only by its reason; Node 23+ uses ⚠.
  const spec = `${NPM}✔ plain passes (1.465757ms)
﹣ skipped one (0.224492ms) # not here
✔ todo passing (0.198906ms) # TODO
✖ todo failing (0.319575ms) # later
⚠ todo failing on 26 (3.856684ms) # later
✔ name with # hash and \\ backslash (1.194243ms)
▶ group
  ﹣ inner skip (0.330408ms) # nope
  ✔ inner todo (0.174015ms) # TODO
✔ group (1.128033ms)
ℹ tests 7
ℹ pass 2
ℹ fail 0
`;
  const summary = `
✖ failing tests:

test at p.test.mjs:5:1
✖ todo failing (0.319575ms) # later
  Error: todo boom

test at p.test.mjs:6:1
⚠ todo failing on 26 (3.856684ms) # later
  Error: todo boom
`;
  for (const stdout of [spec, spec + summary]) {
    const m = describeNestedTestFailure({ status: 0, stdout, stderr: "" });
    assert.deepEqual(listed(m), [], `no failures in\n${m}`);
  }
  // In a failing run, a failing TODO does not take one of the slots.
  const failing = `${spec}✖ real failure (2ms)\n${summary}\ntest at p.test.mjs:9:1\n✖ real failure (2ms)\n  Error: real\n`;
  assert.deepEqual(listed(describeNestedTestFailure({ status: 1, stdout: failing, stderr: "" })), ["✖ real failure  (p.test.mjs:9:1)"]);
  assert.deepEqual(listed(describeNestedTestFailure({ status: 1, stdout: failing.slice(0, failing.indexOf("\n✖ failing tests:")), stderr: "" })), ["✖ real failure"]);
});

test("a parser that throws still yields a bounded message with the tails, and so does a hostile result", () => {
  const r = { status: 1, error: new Error("spawnSync npm ETIMEDOUT"), stdout: `${"o".repeat(20000)}\nlast stdout line\n`, stderr: "last stderr line\n" };
  const m = describeNestedTestFailure(r, "packages/desktop npm test", { readFailures: () => { throw new TypeError("x".repeat(5000)); } });
  assert.match(m, /^packages\/desktop npm test failed \(status 1, spawnSync npm ETIMEDOUT\)\n\nThe failing tests could not be read: the parser threw \(x+…\n\n--- stdout tail ---\n…\nlast stdout line\n--- stderr tail ---\nlast stderr line\n$/);
  assert.ok(m.length <= MAX_MESSAGE, `message is ${m.length} characters`);
  // Output that cannot even be turned into text, and a result that throws on read.
  const boom = { toString() { throw new Error("no text"); } };
  assert.match(describeNestedTestFailure({ status: 1, stdout: boom, stderr: boom, error: { message: boom } }), /^nested node --test run failed \(status 1, \)\n\nNo failing test could be read/);
  const hostile = { get status() { throw new Error("status unreadable"); } };
  assert.equal(describeNestedTestFailure(hostile, "packages/desktop npm test"), "packages/desktop npm test failed; the failure message could not be built (status unreadable).");
});

// The formatter against what this Node actually prints, under each reporter
// and under the default one (TAP on CI's Node 22, spec from Node 23).
test("a real node --test child is read right under the tap, spec and default reporters, failing or passing", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oats-nested-failure-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "probe.test.mjs"), [
    'import test, { describe, it } from "node:test";',
    'import assert from "node:assert/strict";',
    'test("passes", () => {});',
    'describe("group", () => { it("leaf breaks", () => { assert.equal(1, 2, "one is not two"); }); });',
  ].join("\n"));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const reporter of ["tap", "spec", null]) {
    const args = ["--test", ...(reporter ? [`--test-reporter=${reporter}`] : []), "probe.test.mjs"];
    const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env, timeout: 60000 });
    assert.equal(r.status, 1, `${reporter ?? "default"} reporter: the probe fails\n${r.stdout}\n${r.stderr}`);
    const m = describeNestedTestFailure(r);
    const names = listed(m);
    assert.equal(names.length, 1, `${reporter ?? "default"} reporter: exactly the leaf is listed\n${m}`);
    assert.match(names[0], /^✖ (group › )?leaf breaks {2}\(.*probe\.test\.mjs:4:\d+\)$/);
    assert.match(failuresOf(m), /one is not two/);
  }
  // And a passing child with skips and TODOs, one of them failing.
  writeFileSync(join(dir, "pass.test.mjs"), [
    'import test from "node:test";',
    'test("plain passes", () => {});',
    'test("skipped", { skip: "not here" }, () => {});',
    'test("todo failing", { todo: "later" }, () => { throw new Error("todo boom"); });',
  ].join("\n"));
  for (const reporter of ["tap", "spec", null]) {
    const args = ["--test", ...(reporter ? [`--test-reporter=${reporter}`] : []), "pass.test.mjs"];
    const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", env, timeout: 60000 });
    assert.equal(r.status, 0, `${reporter ?? "default"} reporter: the passing probe passes\n${r.stdout}\n${r.stderr}`);
    assert.deepEqual(listed(describeNestedTestFailure(r)), [], `${reporter ?? "default"} reporter: nothing listed`);
  }
});

// Reverting the assertion to a stderr-only message must turn this red: the
// formatter is only useful while the nested run's assertion uses it. The gate
// itself stays as it was (#644 changes the message, nothing else).
test("the nested Desktop run's exit-status assertion uses the formatter, and its gate is intact", () => {
  const src = readFileSync(new URL("./release-workflow.test.mjs", import.meta.url), "utf8");
  assert.match(src, /^import \{ describeNestedTestFailure \} from "\.\/helpers\/nested-test-failure\.mjs";$/m);
  assert.match(src, /if \(r\.status !== 0\) assert\.fail\(describeNestedTestFailure\(r, "packages\/desktop npm test"\)\);/,
    "the status gate, with the message built only for a failing run");
  assert.match(src, /delete env\.NODE_TEST_CONTEXT;/);
  assert.match(src, /spawnSync\("npm", \["test"\], \{[^}]*timeout: 300000, maxBuffer: 64 \* 1024 \* 1024, env \}\)/);
  assert.match(src, /assert\.match\(r\.stdout, \/\^# pass \\d\+\$\|ℹ pass \\d\+\/m, `packages\/desktop npm test reported no results/);
});
