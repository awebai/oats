// The house fuzzy matcher of the shared home (packages/client/subsequence-score.mjs, #1276): the one copy the
// Desktop's palette and Quick Open and the TUI's palette and switcher filter with. Lower is better, null is no
// match, and a prefix beats any match inside.
import test from "node:test";
import assert from "node:assert/strict";
import { subsequenceScore } from "../packages/client/subsequence-score.mjs";

test("the score is the house rule: lower is better, null is no match, and a prefix beats any match inside", () => {
  assert.equal(subsequenceScore("acme-expert-tui", "zz"), null, "no match");
  assert.equal(subsequenceScore("acme-expert-tui", "acme") < subsequenceScore("expert-acme", "acme"), true, "a prefix first");
  assert.equal(subsequenceScore("dev-a", "da") < subsequenceScore("dev--a", "da"), true, "fewer gaps first");
  assert.equal(subsequenceScore("Souls", "SOU"), subsequenceScore("souls", "sou"), "case is not read");
});
