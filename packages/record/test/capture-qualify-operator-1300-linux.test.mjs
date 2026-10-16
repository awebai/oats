// Operator-shaped first upgrade at 1300 streams (#1108 checkpoint Q, B): most
// bytes in sessions over 8 MiB on the retained path, beside the small-session
// tail, scaled by a stated F. Runs only in a dispatched "Linux tests" workflow
// (fixtures/real-manager.mjs); a skip is not evidence. Only completion is
// asserted; the bars on #1108 are read from the report.
import test from "node:test";
import { TEST_TIMEOUT_MS, realManagerSkip } from "./fixtures/qualify.mjs";
import { qualifyOperatorShaped } from "./fixtures/qualify-operator.mjs";

const skip = realManagerSkip("linux") ?? false;

test("operator-shaped first upgrade at 1300 streams completes at production policy", { skip, timeout: TEST_TIMEOUT_MS }, async t => {
  await qualifyOperatorShaped(t, { streams: 1300 });
});
