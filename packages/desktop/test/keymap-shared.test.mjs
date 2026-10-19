// The keys the Desktop shares with the TUI (packages/client/keymap.mjs), pinned exactly: the leader
// per platform, the leader's table (rows, order, keys) and the plain keys. A key bound twice in either
// table is a defect and fails here. The TUI reads the same module, and its own test
// (packages/tui/test/keymap.test.mjs) pins that; no Desktop test reads packages/tui.
// The Desktop's defaults for app.leader and every sidebar.key.* come from the module: a copy of the
// module with another entry gives a copy of the engine another default, and keybindings.mjs holds
// no literal of its own.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_KEYMAP, SIDEBAR_KEYS, defaultBinding, chordFromKeyId } from "../renderer/keybindings.mjs";
import {
  LEADER, LEADER_TABLE, PLAIN_KEYS, leaderKey, leaderDoes, plainKeys, leaderRows,
} from "../../client/keymap.mjs";

test("the leader is Ctrl+\\ on macOS and Alt+O elsewhere", () => {
  assert.deepEqual({ ...LEADER }, { mac: "ctrl+\\", other: "alt+o" });
  assert.ok(Object.isFrozen(LEADER));
  assert.equal(leaderKey(true), "ctrl+\\");
  assert.equal(leaderKey(false), "alt+o");
});

test("the leader's table: every row, in order, with its keys and what it does", () => {
  assert.deepEqual(LEADER_TABLE.map(({ keys, does, terminal }) => [keys.join(" "), does, !!terminal]), [
    ["k space", "palette", false],
    ["1", "instances", false],
    ["2", "souls", false],
    ["3", "capabilities", false],
    ["up", "previous", false],
    ["down", "next", false],
    ["z", "zoom", true],
    ["w", "close-terminal", true],
    ["left", "tab-previous", true],
    ["right", "tab-next", true],
    ["|", "split-right", true],
    ["-", "split-down", true],
    ["tab", "group-next", true],
    ["m", "tab-move", true],
    ["x", "group-close", true],
    ["X", "stop", false],
    ["R", "restart", false],
    ["S", "start", false],
    ["D", "retire", false],
    ["n", "spawn", false],
    ["N", "spawn-another", false],
    ["/", "filter", false],
    ["o", "workspaces", false],
    ["?", "help", false],
    ["escape", "list", false],
  ]);
  for (const row of LEADER_TABLE) assert.equal(typeof row.label, "string", `${row.does} has a label`);
});

test("the plain keys: every action, with its keys", () => {
  assert.deepEqual(PLAIN_KEYS.map(({ does, keys }) => [does, keys.join(" ")]), [
    ["up", "up k"], ["down", "down j"], ["top", "g home"], ["bottom", "G end"],
    ["page-up", "pageup"], ["page-down", "pagedown"], ["collapse", "left h"], ["expand", "right l"],
    ["filter", "/"], ["refresh", "r"], ["instances", "1"], ["souls", "2"], ["capabilities", "3"],
    ["workspaces", "w"], ["open", "enter"], ["zoom", "z"], ["close-terminal", "c"],
    ["tab-previous", "["], ["tab-next", "]"], ["split-right", "|"], ["split-down", "-"],
    ["stop", "X"], ["retire", "D"], ["start", "S"], ["restart", "R"],
    ["spawn", "n"], ["spawn-another", "N"], ["help", "?"],
  ]);
});

test("no key is bound twice, in the leader's table or in the plain keys", () => {
  for (const [name, rows] of [["LEADER_TABLE", LEADER_TABLE], ["PLAIN_KEYS", PLAIN_KEYS]]) {
    const seen = new Map();
    for (const row of rows) for (const key of row.keys) {
      assert.ok(!seen.has(key), `${name}: ${key} is bound to ${seen.get(key)} and to ${row.does}`);
      seen.set(key, row.does);
    }
    assert.equal(new Set(rows.map((row) => row.does)).size, rows.length, `${name}: one row per action`);
  }
});

test("the readers answer from the tables, and every value they return is frozen", () => {
  assert.equal(leaderDoes("k"), "palette");
  assert.equal(leaderDoes("space"), "palette");
  assert.equal(leaderDoes("N"), "spawn-another");
  assert.equal(leaderDoes("escape"), "list");
  assert.equal(leaderDoes("q"), null);
  assert.equal(leaderDoes("K"), null, "case is kept");
  assert.deepEqual([...plainKeys("bottom")], ["G", "end"]);
  assert.deepEqual([...plainKeys("palette")], [], "no plain key");
  assert.ok(Object.isFrozen(plainKeys("bottom")));
  assert.ok(Object.isFrozen(plainKeys("nothing")));
  assert.equal(leaderRows(), LEADER_TABLE);
  assert.ok(Object.isFrozen(LEADER_TABLE) && Object.isFrozen(PLAIN_KEYS));
  for (const row of [...LEADER_TABLE, ...PLAIN_KEYS]) {
    assert.ok(Object.isFrozen(row) && Object.isFrozen(row.keys), `${row.does} is frozen`);
  }
});

const ENGINE = new URL("../renderer/keybindings.mjs", import.meta.url);
const MODULE = new URL("../../client/keymap.mjs", import.meta.url);

test("the Desktop's leader and sidebar-key defaults are the module's entries", () => {
  assert.equal(defaultBinding("app.leader", true), chordFromKeyId(LEADER.mac));
  assert.equal(defaultBinding("app.leader", false), chordFromKeyId(LEADER.other));
  assert.deepEqual([defaultBinding("app.leader", true), defaultBinding("app.leader", false)], ["Ctrl+\\", "Alt+O"]);
  const sidebar = SIDEBAR_KEYS.map(({ id, does }) => [id, does]);
  assert.equal(new Set(sidebar.map(([, does]) => does)).size, sidebar.length, "one action per key");
  for (const [id, does] of sidebar) {
    assert.ok(Object.hasOwn(DEFAULT_KEYMAP, id), id);
    assert.equal(plainKeys(does).length, 1, `${does}: one key`);
    assert.equal(defaultBinding(id, false), chordFromKeyId(plainKeys(does)[0]), id);
    assert.equal(defaultBinding(id, true), defaultBinding(id, false), `${id}: the same on every platform`);
  }
  assert.deepEqual(Object.fromEntries(sidebar.map(([id]) => [id, defaultBinding(id, false)])), {
    "sidebar.key.instances": "1", "sidebar.key.souls": "2", "sidebar.key.capabilities": "3", "sidebar.key.workspaces": "W",
    "sidebar.key.filter": "/", "sidebar.key.refresh": "R", "sidebar.key.zoom": "Z", "sidebar.key.closeTerminal": "C",
    "sidebar.key.tabPrevious": "[", "sidebar.key.tabNext": "]", "sidebar.key.splitRight": "|", "sidebar.key.splitDown": "-",
    "sidebar.key.stop": "Shift+X", "sidebar.key.retire": "Shift+D", "sidebar.key.start": "Shift+S", "sidebar.key.restart": "Shift+R",
    "sidebar.key.spawn": "N", "sidebar.key.spawnAnother": "Shift+N", "sidebar.key.help": "?",
  });
});

test("change the module's entry in a copy: the Desktop's default follows, and keybindings.mjs writes none down", async t => {
  const root = mkdtempSync(join(tmpdir(), "keymap-shared-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "client")); mkdirSync(join(root, "desktop", "renderer"), { recursive: true });
  const module = readFileSync(MODULE, "utf8");
  const changed = module.replace('other: "alt+o"', 'other: "alt+l"').replace('{ does: "refresh", keys: ["r"] }', '{ does: "refresh", keys: ["F"] }');
  assert.notEqual(changed, module);
  writeFileSync(join(root, "client", "keymap.mjs"), changed);
  writeFileSync(join(root, "desktop", "renderer", "keybindings.mjs"), readFileSync(ENGINE, "utf8"));
  const copy = await import(pathToFileURL(join(root, "desktop", "renderer", "keybindings.mjs")).href);
  assert.equal(copy.defaultBinding("app.leader", false), "Alt+L");
  assert.equal(copy.defaultBinding("sidebar.key.refresh", false), "Shift+F");
  // No literal duplicate: the engine names neither chord nor key of the shared tables.
  const engine = readFileSync(ENGINE, "utf8");
  assert.doesNotMatch(engine, /"Alt\+O"|"Ctrl\+\\\\"|"alt\+o"|"ctrl\+\\\\"/, "the leader is read, not retyped");
  assert.doesNotMatch(engine, /"sidebar\.key\.\w+":\s*"/, "no sidebar key with a literal default");
});
