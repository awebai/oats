// The palette of `oats tui` filters as the Desktop's ⌘K does (awebai/oats#855, Spec T1b item 1):
// the TUI cannot import the Desktop's renderer, so packages/tui/lib/model.mjs holds a copy of its
// subsequence score, and this file holds the two to the same answers. A change to either is a
// change to both.
import test from "node:test";
import assert from "node:assert/strict";
import { subsequenceScore as desktopScore } from "../packages/desktop/renderer/overlay-picker.mjs";
import { subsequenceScore as tuiScore } from "../packages/tui/lib/model.mjs";

const TEXTS = ["acme-ledger-developer-note-target", "acme-expert-tui", "Instances", "Souls", "Capabilities", "Workspaces", "Refresh", "Help",
  "Stop acme-expert-tui", "Restart dev-a", "dev-a", "dev-b", "garnet", "ÉCOLE-é", "名前-dev", "", "a b c", "AbC", "x".repeat(300)];
const QUERIES = ["", "a", "ac", "acme", "ad", "tui", "dev", "DEV", "sou", "cap", "ws", "st", "re", "é", "名", "z", "acme-ledger-developer-note-target-and-more", " ", "a b", "xxx", "abc", "ABC"];

test("the palette's subsequence score answers as the Desktop's does for every text and query: the same number, or both no match", () => {
  for (const text of TEXTS) for (const query of QUERIES) {
    assert.equal(tuiScore(text, query), desktopScore(text, query), `${JSON.stringify(text)} / ${JSON.stringify(query)}`);
  }
});

test("the score is the Desktop's rule: lower is better, null is no match, and a prefix beats any match inside", () => {
  assert.equal(tuiScore("acme-expert-tui", "zz"), null);
  assert.equal(tuiScore("acme-expert-tui", "acme") < tuiScore("expert-acme", "acme"), true, "a prefix first");
  assert.equal(tuiScore("dev-a", "da") < tuiScore("dev--a", "da"), true, "fewer gaps first");
  assert.equal(tuiScore("Souls", "SOU"), tuiScore("souls", "sou"), "case is not read");
});
