// The sentence of a failed catalog read (packages/client/catalog-messages.mjs, #1301): one sentence for the souls
// and the capabilities, each client's, with a noun from a closed pair; spawn-messages.mjs soulCatalogFailure is
// it with the noun "souls" (its words are pinned in client-soul-rules.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { catalogFailure } from "../packages/client/catalog-messages.mjs";
import { soulCatalogFailure } from "../packages/client/spawn-messages.mjs";

test("catalogFailure: the souls' and the capabilities' sentence, with the kernel's message when there is one", () => {
  for (const noun of ["souls", "capabilities"]) {
    assert.equal(catalogFailure(noun, { code: "E_CLI_FAILED", message: "" }), `Couldn't read this workspace's ${noun}.`, noun);
    assert.equal(catalogFailure(noun, { code: "E_X", message: "the lock is stale" }), `Couldn't read this workspace's ${noun}: the lock is stale`, noun);
    for (const reason of [null, undefined, {}, { message: 7 }, { message: ["x"] }]) assert.equal(catalogFailure(noun, reason), `Couldn't read this workspace's ${noun}.`, `${noun} ${JSON.stringify(reason)}`);
  }
});

test("catalogFailure: any other noun throws, so no client words a third catalog", () => {
  for (const noun of ["soul", "Souls", "capability", "instances", "", null, undefined, 1, ["souls"]]) {
    assert.throws(() => catalogFailure(noun, { message: "x" }), { name: "TypeError", message: "catalogFailure: noun must be one of souls, capabilities" }, String(noun));
  }
});

test("soulCatalogFailure is catalogFailure with the noun souls", () => {
  for (const reason of [{ code: "E_CLI_FAILED", message: "" }, { code: "E_X", message: "the lock is stale" }, null]) assert.equal(soulCatalogFailure(reason), catalogFailure("souls", reason));
});
