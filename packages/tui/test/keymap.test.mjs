// The keys the TUI shares with the Desktop are the shared keymap's (packages/client/keymap.mjs, read
// through lib/client.mjs): the leader's table, the plain keys of the list and the default leader.
// The TUI holds no copy of them, and every `does` of the shared table is one the TUI acts on: a row
// the TUI does not handle fails here, never becomes a key that does nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, LEADER, LEADER_KEYS, LEADER_OWN, leaderHandles } from "../lib/actions.mjs";
import { LEADER_TABLE, PLAIN_KEYS, leaderKey } from "../lib/client.mjs";
import { defaultDetachKey, effectiveConfig } from "../lib/config.mjs";
import { backKeyId, isBackKey } from "../lib/term/through.mjs";

test("the leader's table is the shared one, and its keys are read as it says", () => {
  assert.equal(LEADER, LEADER_TABLE);
  assert.deepEqual([...LEADER_KEYS], LEADER_TABLE.flatMap((row) => row.keys.map((key) => [key, row.does])));
});

test("every does of the shared leader table is one the TUI handles", () => {
  const unhandled = LEADER_TABLE.map((row) => row.does).filter((does) => !leaderHandles(does));
  assert.deepEqual(unhandled, [], "a does of the shared table with no handler in the TUI");
  assert.equal(leaderHandles("not-a-thing-the-tui-does"), false, "the check itself refuses an unknown does");
});

test("the leader's own does are its own, and each is in the shared table", () => {
  for (const does of LEADER_OWN) {
    assert.equal(ACTIONS.some((action) => action.id === does), false, `${does} is no action of ACTIONS`);
    assert.equal(LEADER_TABLE.some((row) => row.does === does), true, `${does} is in the shared table`);
  }
});

test("the plain keys the TUI shares are the shared ones, action by action", () => {
  for (const { does, keys } of PLAIN_KEYS) {
    const action = ACTIONS.find((each) => each.id === does);
    assert.notEqual(action, undefined, `${does} is an action of ACTIONS`);
    assert.deepEqual(action.keys, keys, `${does}'s keys`);
  }
});

test("the keys the TUI has beyond the shared ones stay its own", () => {
  const own = ACTIONS.filter((action) => !PLAIN_KEYS.some((entry) => entry.does === action.id)).map((action) => [action.id, action.keys]);
  assert.deepEqual(own, [
    ["detail", ["tab"]], ["palette", ["ctrl+k"]], ["remove", ["delete"]], ["soul-instances", ["i"]],
    ["group-next", []], ["tab-move", []], ["group-close", []],
    ["spawn-check", ["C"]], ["close", ["escape"]], ["quit", ["q", "ctrl+c"]], ["suspend", ["ctrl+z"]], ["redraw", ["ctrl+l"]],
  ]);
});

test("the default leader is the shared one, in the back key's spelling, and open.detachKey overrides it", () => {
  for (const [platform, isMac, spelt] of [["darwin", true, "C-\\"], ["linux", false, "M-o"], ["win32", false, "M-o"]]) {
    const key = defaultDetachKey(platform);
    assert.equal(key, spelt, platform);
    assert.equal(isBackKey(key), true, `${platform}: a back key`);
    assert.equal(backKeyId(key), leaderKey(isMac), `${platform}: read as the shared leader`);
    assert.equal(effectiveConfig({}, ACTIONS, platform).detachKey, spelt, `${platform}: a file that names none`);
    assert.equal(effectiveConfig({ open: { detachKey: "F12" } }, ACTIONS, platform).detachKey, "F12", `${platform}: the file's key`);
  }
});
