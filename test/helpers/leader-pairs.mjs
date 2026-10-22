// The leader then a key, pressed into a real terminal (test/tui-panel.test.mjs,
// test/tui-terminal.test.mjs). The TUI acts on the key only when it reads it in a later read than
// the leader (docs/tui.md, "The leader"): a pair read as one cancels the leader and drops the key,
// and nothing on the screen says the leader waits. So the key is pressed LEADER_GAP_MS after the
// leader, by a send-keys of its own, and what the key does is waited for, the pair pressed again
// while it has not come. Not seeing it does not say the pair was read as one (a frame may come
// late), so a pair that does not repeat safely is pressed again only once a frame drawn after it
// says it did not act. Pinned by test/tui-leader-pairs.test.mjs.
import assert from "node:assert/strict";

export const LEADER_GAP_MS = 300, PAIR_WAIT_MS = 5000, LEADER_TRIES = 3;

/** The pair presses of one test file. `leaderKey` is the leader as send-keys names it; `pause(ms)`;
 *  `waitUntil(done, what, ms)` (helpers/host-fixture.mjs), whose timeout is the one failure that
 *  means "not seen", within the file's `deadline`; `until(term, done, what)` the file's own wait,
 *  which fails saying what the terminal shows. */
export function leaderPairs({ leaderKey, pause, waitUntil, deadline, until, gapMs = LEADER_GAP_MS, waitMs = PAIR_WAIT_MS, tries = LEADER_TRIES }) {
  async function seen(done) {
    try { return await waitUntil(done, "the pair's effect", Math.min(waitMs, Math.max(0, deadline - Date.now()))); } catch (error) {
      if (/^timed out waiting for /.test(error?.message ?? "")) return false;
      throw error;
    }
  }
  async function pair(term, key) {
    term.press(leaderKey);
    await pause(gapMs);
    term.press(key);
  }
  return {
    /** A pair that repeats safely (its key, once its state is reached, changes nothing): pressed
     *  until `done()` holds, `tries` times at most; the last waits as `until` does, and its timeout
     *  says the pair was pressed that often. */
    async repeatable(term, key, done, what) {
      for (let n = 1; ; n++) {
        await pair(term, key);
        if (n === tries) return until(term, done, `${what}, after the leader then ${key}, pressed ${tries} times`);
        if (await seen(done)) return;
      }
    },
    /** A pair that does not repeat safely: while `done()` is not seen, `recheck()` draws a frame
     *  after the pair, answers whether it acted and puts the focus back where the pair is pressed;
     *  the pair is pressed again only when it had not acted, `tries` times at most. */
    async checked(term, key, done, recheck, what) {
      for (let n = 1; ; n++) {
        await pair(term, key);
        if (await seen(done)) return;
        if (await recheck()) return;
        assert.ok(n < tries, `${what}: the leader then ${key}, pressed ${n} times, did not act; ${term.id} shows:\n${term.shows()}`);
      }
    },
  };
}
