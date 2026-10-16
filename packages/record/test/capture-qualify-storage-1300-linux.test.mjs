// Storage and durability qualification at 1,300 streams (#1108 checkpoint Q1a):
// first upgrade over journals the outgoing release made, at production policy;
// a no-op pass; and a small append to 50 streams. Runs only in a dispatched
// "Linux tests" workflow (fixtures/real-manager.mjs); a skip is not evidence.
// The append case lives here, not in the 3,000-stream file, so that file keeps
// its whole bound for its first upgrade.
import test from "node:test";
import { realManagerSkip } from "./fixtures/qualify.mjs";
import { FILE_BOUND_MS, qualifyStorage } from "./fixtures/qualify-storage.mjs";

const skip = realManagerSkip("linux") ?? false;

test("1,300 streams: first upgrade completes at production policy, the no-op reads ~no content, an append commits exactly its bytes", { skip, timeout: FILE_BOUND_MS }, async t => {
  await qualifyStorage(t, { streams: 1300, append: true });
});
