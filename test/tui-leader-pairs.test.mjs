// The leader pairs of the real-terminal tests (test/helpers/leader-pairs.mjs), against a terminal
// that reads a pair as one, or acts on it but draws it late: a pair that repeats safely is pressed
// again until its effect is seen; one that does not is pressed again only when a frame drawn after
// it says it did not act, never on a late frame alone.
import test from "node:test";
import assert from "node:assert/strict";
import { leaderPairs } from "./helpers/leader-pairs.mjs";

/** A TUI in a terminal, as far as a pair goes: `shown` the agent whose terminal is shown (Down
 *  shows the next), `drawn` what the screen says. `merged` pairs are read as one (the leader
 *  cancelled, the key dropped); while `late` the screen keeps the frame before the pair. Esc
 *  draws a frame after all that came before it (the list's), as the TUI does. */
function terminal({ merged = 0, late = false } = {}) {
  const t = { id: "t1", shown: 0, drawn: 0, downs: 0, escapes: 0, listed: false, waiting: false, merged, late };
  t.press = (key) => {
    if (key === "L") { t.waiting = true; return; }
    if (!t.waiting) return;
    t.waiting = false;
    if (key === "Down") t.downs += 1; else t.escapes += 1;
    if (t.merged > 0) { t.merged -= 1; return; }
    if (key === "Down") t.shown += 1; else t.listed = true;
    if (key === "Down" && t.late) return;
    t.drawn = t.shown;
  };
  t.shows = () => `shown ${t.shown}, drawn ${t.drawn}`;
  return t;
}
/** A wait that answers at once: the effect is on the screen now, or it times out. */
const waitUntil = async (done, what) => { assert.ok(done(), `timed out waiting for ${what}`); return true; };
const until = async (term, done, what) => { if (!done()) assert.fail(`${what}; ${term.id} shows:\n${term.shows()}`); };
const pairs = leaderPairs({ leaderKey: "L", pause: async () => {}, waitUntil, deadline: Date.now() + 60000, until });
/** The recheck of Down: a frame drawn after the pair (the leader then Esc, which repeats safely, and
 *  draws every frame before it), then whether the next agent is shown. */
const recheck = (t, want) => async () => { t.late = false; await pairs.repeatable(t, "Esc", () => true, "the list"); t.drawn = t.shown; return t.drawn >= want; };

test("a pair that repeats safely is pressed again while its effect is not seen, three times at most, the last failure saying so", async () => {
  const once = terminal({ merged: 1 });
  await pairs.repeatable(once, "Esc", () => once.listed, "the list");
  assert.deepEqual([once.escapes, once.listed], [2, true], "the first pair was read as one: pressed again");
  const never = terminal({ merged: 3 });
  await assert.rejects(pairs.repeatable(never, "Esc", () => never.listed, "the list"), /the list, after the leader then Esc, pressed 3 times/);
  assert.equal(never.escapes, 3);
});

test("the leader then Down, acted on but drawn late, is not pressed again: the frame drawn after it says it acted, and the next agent is the one shown", async () => {
  const t = terminal({ late: true });
  await pairs.checked(t, "Down", () => t.drawn === 1, recheck(t, 1), "dev-b opened");
  assert.deepEqual([t.downs, t.shown], [1, 1], "one Down; dev-b shown, not dev-c");
});

test("the leader then Down read as one is pressed again once a frame drawn after it says it did not act; one that never acts fails after three, saying so", async () => {
  const t = terminal({ merged: 1 });
  await pairs.checked(t, "Down", () => t.drawn === 1, recheck(t, 1), "dev-b opened");
  assert.deepEqual([t.downs, t.shown], [2, 1], "the dropped Down, then one that acted");
  const never = terminal({ merged: 9 });
  await assert.rejects(pairs.checked(never, "Down", () => never.drawn === 1, recheck(never, 1), "dev-b opened"), /dev-b opened: the leader then Down, pressed 3 times, did not act/);
  assert.equal(never.downs, 3);
});
