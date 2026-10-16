// Two soul rules of the shared home that the Desktop's soul grid and the TUI's Souls view share (#1276): which
// rows a soul filter keeps (soul-facts.mjs soulMatches) and the sentence of a failed catalog read
// (spawn-messages.mjs soulCatalogFailure). One copy each; a client keeps only its own trim.
import test from "node:test";
import assert from "node:assert/strict";
import { soulMatches } from "../packages/client/soul-facts.mjs";
import { soulCatalogFailure } from "../packages/client/spawn-messages.mjs";

test("soulMatches: the name, the description or where the soul comes from contains the query, case aside", () => {
  const row = { name: "Dev-Notes", description: "Writes the release NOTES", repoName: "acme-agents" };
  for (const query of ["dev", "DEV-n", "release notes", "acme", "AGENTS", "", "-"]) assert.equal(soulMatches(row, query), true, query);
  for (const query of ["ops", "dev notes", "acme agents", " dev"]) assert.equal(soulMatches(row, query), false, query);
  // A missing field is no text: it matches nothing but the empty query.
  assert.equal(soulMatches({ name: "ops" }, "undefined"), false);
  assert.equal(soulMatches({ name: "ops", description: null, repoName: undefined }, "null"), false);
  assert.equal(soulMatches({ name: "ops" }, ""), true);
});

test("soulCatalogFailure: the Desktop's sentence, with the kernel's message when there is one", () => {
  assert.equal(soulCatalogFailure({ code: "E_CLI_FAILED", message: "" }), "Couldn't read this workspace's souls.");
  assert.equal(soulCatalogFailure({ code: "E_X", message: "the lock is stale" }), "Couldn't read this workspace's souls: the lock is stale");
  for (const reason of [null, undefined, {}, { message: 7 }, { message: ["x"] }]) assert.equal(soulCatalogFailure(reason), "Couldn't read this workspace's souls.");
});
