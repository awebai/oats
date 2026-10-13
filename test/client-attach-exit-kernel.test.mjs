// The word a client reads for an attach its detach key ended (packages/client/attach-exit.mjs
// `attachExit`) against the kernel's own status for it (lib/session-viewer.mjs
// `SESSION_DETACHED_EXIT`). The client writes the number once and the kernel once; this test imports
// both sides, which neither does of the other, and holds that the client reads the kernel's value as
// "left".
//
// Every assertion is on what the client reads from the value it is given. The kernel exports no
// constant for the other statuses of the table (0, 1, and ssh's 255 for the routed form): those rest
// on the two pages that state them, docs/execution-targets.md ("Exit status") and docs/servers.md
// ("Run there"). This file reads lib/ and edits nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_DETACHED_EXIT } from "../lib/session-viewer.mjs";
import { attachExit } from "../packages/client/attach-exit.mjs";

test("the kernel's status for an attach left by its detach key reads \"left\", on this machine and through another", () => {
  assert.equal(attachExit(SESSION_DETACHED_EXIT, { keyed: true }), "left");
  assert.equal(attachExit(SESSION_DETACHED_EXIT, { keyed: true, routed: true }), "left");
  // The kernel answers it only when the key's own binding ran: for an attach given no key it is not the key's.
  assert.equal(attachExit(SESSION_DETACHED_EXIT), "unknown");
  assert.equal(attachExit(SESSION_DETACHED_EXIT, { routed: true }), "unknown");
});
