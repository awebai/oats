// An instance name as words (packages/client/instance-display-name.mjs), the visible label of an instance row in the
// Desktop's and the TUI's sidebar (0.68.1). Display only: the real name stays wherever it identifies the instance.
import test from "node:test";
import assert from "node:assert/strict";
import { instanceDisplayName } from "../packages/client/instance-display-name.mjs";

/** [name, words]: the spec's examples, then the edges. */
export const DISPLAY_CASES = Object.freeze([
  ["oats-expert-maintainer-lanes", "Oats expert maintainer lanes"],
  ["tui-leader-hint-developer-2", "Tui leader hint developer 2"],
  ["desktop-tab-keys-developer", "Desktop tab keys developer"],
  ["x", "X"],
  ["already Words", "Already Words"],
  // Runs of `-` are one space; the ends are trimmed.
  ["a--b---c", "A b c"],
  ["-lead-", "Lead"],
  ["--", ""],
  ["", ""],
  ["  padded-name  ", "Padded name"],
  // Only the first character changes: the rest stays as it was.
  ["web-API-v2", "Web API v2"],
  ["2-fast", "2 fast"],
  ["éclair-dev", "Éclair dev"],
  ["Already-Capital", "Already Capital"],
  // The first character by code point: one outside the BMP is not split.
  ["𝒳-y", "𝒳 y"],
]);

test("a name reads as words: each - a space (a run of them one), the ends trimmed, the first character upper-cased", () => {
  for (const [name, words] of DISPLAY_CASES) assert.equal(instanceDisplayName(name), words, JSON.stringify(name));
});

test("a value that is not a string reads as nothing", () => {
  for (const value of [undefined, null, 0, 42, true, {}, [], ["a-b"], Symbol.iterator]) assert.equal(instanceDisplayName(value), "", String(value?.toString?.() ?? value));
});
