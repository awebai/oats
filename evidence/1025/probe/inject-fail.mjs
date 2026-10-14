// In a test file's process only: once INJECT_FAIL_AFTER assertions of node:assert have been made,
// every later one throws. So each test from there on fails at an assertion, after whatever it had
// set up: what a failing test leaves behind is then what the file's directory shows.
import assert from "node:assert";
if (process.env.NODE_TEST_CONTEXT && process.env.INJECT_FAIL_AFTER !== undefined && /\.test\.mjs$/.test(process.argv[1] ?? "")) {
  const after = Number(process.env.INJECT_FAIL_AFTER);
  let made = 0;
  for (const target of new Set([assert, assert.strict])) {
    for (const name of Object.keys(target)) {
      const original = target[name];
      if (typeof original !== "function" || name === "AssertionError" || name === "strict" || name === "CallTracker") continue;
      target[name] = function (...args) {
        if (++made > after) throw new assert.AssertionError({ message: `injected failure (assertion ${made})` });
        return original.apply(this, args);
      };
    }
  }
}
