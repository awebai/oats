// The drift guard between the two clients' leader tables, until the TUI reads the shared one.
// packages/client/keymap.mjs is the only place the leader's table is written down for the Desktop;
// the TUI still holds its own (packages/tui/lib/actions.mjs LEADER). This test holds them equal:
// the same rows in the same order, each with the same keys and the same `does`. It is the only test
// that reads packages/tui for the keymap, and it goes when the TUI imports keymap.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { LEADER_TABLE } from "../packages/client/keymap.mjs";
import { LEADER } from "../packages/tui/lib/actions.mjs";

const shape = (rows) => rows.map(({ keys, does }) => ({ keys: [...keys], does }));

test("the shared leader table is the TUI's: keys, does and order", () => {
  assert.deepEqual(shape(LEADER_TABLE), shape(LEADER));
});

test("the shared leader table marks the same rows terminal-only as the TUI's", () => {
  assert.deepEqual(LEADER_TABLE.map((row) => !!row.terminal), LEADER.map((row) => !!row.terminal));
});
