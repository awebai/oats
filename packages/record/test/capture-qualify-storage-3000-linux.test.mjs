// Storage and durability qualification at 3,000 streams (#1108 checkpoint Q1b):
// first upgrade over journals the outgoing release made, at production policy,
// and a no-op pass. Runs only in a dispatched "Linux tests" workflow
// (fixtures/real-manager.mjs); a skip is not evidence. The small-append case is
// in the 1,300-stream file, so this file's bound goes to its first upgrade.
import test from "node:test";
import { TEST_TIMEOUT_MS, realManagerSkip } from "./fixtures/qualify.mjs";
import { qualifyStorage } from "./fixtures/qualify-storage.mjs";

const skip = realManagerSkip("linux") ?? false;

test("3,000 streams: first upgrade completes at production policy and the no-op reads ~no content within 300 s", { skip, timeout: TEST_TIMEOUT_MS }, async t => {
  await qualifyStorage(t, { streams: 3000 });
});
