// The Desktop's readers on the REAL refusal of an unmatched launch preference (OATS 0.53.0, awebai/oats#989;
// docs/desktop-cli-api.md § "Launch preferences"). Nothing here is a hand-written kernel shape, and no kernel
// sentence is written in this file: the refusal is the error lib/launch-preference.mjs
// `launchPreferenceUnmatched` builds over the kernel's own layers, the report is lib/core.mjs
// `launchReportFor`'s, and the code, the bound of each text and the `fix` are the kernel's constants. Each is
// then read the way the Desktop reads it: the preview's reason (packages/client/spawn-preview-contract.mjs
// `previewFailure`), the dialog's problem (spawn-messages.mjs `spawnProblem`), the press's reason
// (spawn-apply-contract.mjs `spawnApplyReason`), the soul's Launch report (launch-contract.mjs `launchOf`)
// and the lines both places show (packages/desktop/renderer/speaker-line.mjs `kernelLines`).
// This file reads lib/ and edits nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { LAUNCH_PREFERENCE_UNMATCHED, LAUNCH_PROBLEM_TEXT_MAX, UNMATCHED_FIX, launchLayers, launchPreferenceUnmatched, selectionFrom } from "../lib/launch-preference.mjs";
import { launchReportFor } from "../lib/core.mjs";
import { previewFailure } from "../packages/client/spawn-preview-contract.mjs";
import { spawnApplyReason } from "../packages/client/spawn-apply-contract.mjs";
import { spawnProblem } from "../packages/client/spawn-messages.mjs";
import { launchOf, REPORT_FROM } from "../packages/client/launch-contract.mjs";
import { displayLine, DETAIL_WITHHELD, MAX_DISPLAY_LINE } from "../packages/client/display-text.mjs";
import { originLead } from "../packages/client/instance-presentation.mjs";
import { kernelLines } from "../packages/desktop/renderer/speaker-line.mjs";
import { DESKTOP_TERMS } from "../packages/desktop/renderer/desktop-terms.mjs";

const CODE = LAUNCH_PREFERENCE_UNMATCHED, MAX = LAUNCH_PROBLEM_TEXT_MAX, LEAD = originLead("kernel", DESKTOP_TERMS);
const SOUL = "planner", OFFERED = [SOUL, "example.pkg/reviewer"];
/** The same configurations as a deployment's reader gives them to a report: each with its name. */
const CONFIGS = { private: { name: "private", harness: "claude", model: "claude-opus-5-5" }, fast: { name: "fast", harness: "pi" } };
/** The kernel's layers of one soul with no entry of its own, over a `souls.launch` that holds `keys` beside "*". */
const layersOf = (keys) => launchLayers({ definition: {}, entry: { repoKey: "github.com/acme/agents", path: `souls/${SOUL}` }, key: SOUL,
  local: { souls: { launch: { "*": "fast", ...Object.fromEntries(keys.map((key) => [key, "private"])) } } },
  offered: { keys: OFFERED, unread: { all: null, bare: null, packages: {} } } });
/** The refusal a spawn that names no launch gets. */
function refusal(keys) { const layers = layersOf(keys); return launchPreferenceUnmatched({ choice: selectionFrom({ layers }), layers }); }
/** That refusal, and the report a listing carries for the same soul. */
const refused = (keys) => ({ error: refusal(keys), report: launchReportFor({ layers: layersOf(keys), launchConfigs: CONFIGS, contextDir: tmpdir() }) });
/** Keys long enough that the kernel's message has exactly its bound: found, not assumed. */
function keysAtBound() {
  for (let count = 1; count <= 3; count++) for (let length = 1; length < MAX; length++) {
    const keys = Array.from({ length: count }, (_, i) => `example.pkg/${"abc"[i].repeat(length)}`);
    if (refusal(keys).message.length === MAX) return keys;
  }
  return null;
}
const CASES = [
  ["one key", ["example.okf/reviewer"]],
  ["three keys with near names", ["example.pkg/reviewr", "example.pkg/reviewers", "plannr"]],
  ["long keys, the message at its bound", keysAtBound()],
];

test("the kernel's bound of each text is inside the display filter's, so neither text is cut on its way to the screen", () => {
  assert.ok(MAX < MAX_DISPLAY_LINE, `${MAX} < ${MAX_DISPLAY_LINE}`);
  assert.ok(UNMATCHED_FIX.length <= MAX);
  assert.notEqual(CASES[2][1], null, "a set of keys puts the message at its bound");
  assert.equal(refusal(CASES[2][1]).message.length, MAX);
});

for (const [name, keys] of CASES) test(`${name}: the refusal travels to the dialog as the Desktop's sentence and the kernel's two texts, each whole`, () => {
  const { error } = refused(keys), { message } = error, fix = error.details.fix;
  assert.equal(error.code, CODE); assert.equal(fix, UNMATCHED_FIX);
  assert.ok(message.length <= MAX && fix.length <= MAX);

  // The preview's reason keeps the three.
  const reason = previewFailure(error.code, null, message, fix).reason;
  assert.deepEqual(reason, { code: CODE, message, fix });

  // The dialog as it opens: the Desktop's own sentence, and the kernel's two texts as parts, as they came.
  const problem = spawnProblem(reason, "preview");
  assert.equal(problem.code, CODE);
  assert.deepEqual(problem.kernel, { message, fix });
  assert.equal(problem.detail, CODE, "no kernel text where it would stand without its speaker");
  // The sentence is the Desktop's: it holds no part of the kernel's message (no key, no five words in a row of it).
  for (const key of keys) assert.equal(problem.text.includes(key), false, key);
  const words = message.split(/\s+/);
  for (let i = 0; i + 5 <= words.length; i++) assert.equal(problem.text.includes(words.slice(i, i + 5).join(" ")), false, words.slice(i, i + 5).join(" "));
  assert.equal(problem.text.includes(fix), false);

  // Each part is its own display line, whole: the filter neither withholds, cuts nor changes it.
  assert.equal(displayLine(message), message); assert.equal(displayLine(fix), fix);
  assert.notEqual(displayLine(message), DETAIL_WITHHELD);
  assert.deepEqual(kernelLines(problem.kernel.message, problem.kernel.fix), [`${LEAD} ${message}`, fix]);

  // A press: the code survives where no kernel text travels, with the shorter sentence and no parts.
  const pressed = spawnApplyReason(error.code);
  assert.equal(pressed.code, CODE);
  assert.equal(pressed.message.includes(message), false); assert.equal(Object.hasOwn(pressed, "fix"), false);
  const atPress = spawnProblem(pressed, "spawn");
  assert.equal(atPress.code, CODE); assert.equal(Object.hasOwn(atPress, "kernel"), false);
  assert.notEqual(atPress.text, problem.text);
  assert.ok(atPress.text.length < problem.text.length, "the press's sentence is the shorter one");
  assert.equal(atPress.detail, `${CODE} · ${pressed.message}`);
  for (const key of keys) assert.equal(atPress.text.includes(key) || atPress.detail.includes(key), false, key);
});

for (const [name, keys] of CASES) test(`${name}: the soul's Launch report reads as the lead and both texts, whole`, () => {
  const { error, report } = refused(keys);
  assert.deepEqual(report.problem, { code: CODE, message: error.message, fix: UNMATCHED_FIX });
  const launch = launchOf(report, REPORT_FROM);
  assert.notEqual(launch, undefined, "the Launch reader decodes the report");
  assert.deepEqual(launch.problem, report.problem);
  assert.deepEqual(kernelLines(launch.problem.message, launch.problem.fix), [`${LEAD} ${error.message}`, UNMATCHED_FIX]);
});
