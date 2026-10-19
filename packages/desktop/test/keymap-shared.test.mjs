// The keys the Desktop shares with the TUI (packages/client/keymap.mjs), pinned exactly: the leader
// per platform, the leader's table (rows, order, keys), the plain keys and the chords. A key bound
// twice in any table is a defect and fails here. The TUI reads the same module, and its own test
// (packages/tui/test/keymap.test.mjs) pins that; no Desktop test reads packages/tui.
// The Desktop's defaults for app.leader, every sidebar.key.* and the chords' actions (CHORDS_READ)
// come from the module: a copy of the module with another entry gives a copy of the engine another
// default, and keybindings.mjs holds no literal of its own.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CHORDS_READ, DEFAULT_KEYMAP, SIDEBAR_KEYS, defaultBinding, chordFromKeyId } from "../renderer/keybindings.mjs";
import {
  CHORDS, LEADER, LEADER_TABLE, PLAIN_KEYS, chordKey, leaderKey, leaderDoes, plainKeys, leaderRows,
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

test("the chords: every one, per platform, and what it does", () => {
  assert.deepEqual(CHORDS.map(({ does, mac, other }) => [does, mac, other]), [
    ["palette", "cmd+k", "ctrl+shift+k"],
    ["spawn", "cmd+p", "ctrl+shift+p"],
    ["tab-next", "ctrl+tab", "ctrl+tab"],
    ["tab-previous", "ctrl+shift+tab", "ctrl+shift+tab"],
    ["close-terminal", "cmd+w", "ctrl+shift+w"],
    ["filter", "cmd+f", "ctrl+shift+f"],
    ["split-right", "cmd+\\", "ctrl+shift+e"],
    ["split-down", "cmd+shift+\\", "ctrl+shift+o"],
  ]);
  assert.ok(Object.isFrozen(CHORDS) && CHORDS.every((entry) => Object.isFrozen(entry)));
  assert.equal(new Set(CHORDS.map((entry) => entry.does)).size, CHORDS.length, "one chord per action");
  for (const platform of ["mac", "other"]) {
    assert.equal(new Set(CHORDS.map((entry) => entry[platform])).size, CHORDS.length, `${platform}: no chord twice`);
  }
  assert.equal(chordKey("palette", true), "cmd+k");
  assert.equal(chordKey("palette", false), "ctrl+shift+k");
  assert.equal(chordKey("instances", false), null, "the stages are the Desktop's own");
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

test("the Desktop's chords are the module's entries, each read by one action", () => {
  assert.deepEqual(CHORDS_READ.map(({ does }) => does).sort(), CHORDS.map(({ does }) => does).sort(), "every chord is read, once");
  for (const { id, does } of CHORDS_READ) {
    assert.ok(Object.hasOwn(DEFAULT_KEYMAP, id), id);
    assert.equal(defaultBinding(id, true), chordFromKeyId(chordKey(does, true)), `${id} on macOS`);
    assert.equal(defaultBinding(id, false), chordFromKeyId(chordKey(does, false)), `${id} elsewhere`);
  }
  assert.deepEqual(["cmd+k", "cmd+shift+\\", "ctrl+shift+k", "ctrl+shift+tab", "ctrl+tab", "shift+tab"].map(chordFromKeyId),
    ["Mod+K", "Mod+Shift+\\", "Ctrl+Shift+K", "Ctrl+Shift+Tab", "Ctrl+Tab", "Shift+Tab"]);
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
  const changed = module.replace('other: "alt+o"', 'other: "alt+l"').replace('{ does: "refresh", keys: ["r"] }', '{ does: "refresh", keys: ["F"] }')
    .replace('{ does: "palette", mac: "cmd+k", other: "ctrl+shift+k" }', '{ does: "palette", mac: "cmd+j", other: "ctrl+shift+j" }');
  assert.notEqual(changed, module);
  writeFileSync(join(root, "client", "keymap.mjs"), changed);
  writeFileSync(join(root, "desktop", "renderer", "keybindings.mjs"), readFileSync(ENGINE, "utf8"));
  const copy = await import(pathToFileURL(join(root, "desktop", "renderer", "keybindings.mjs")).href);
  assert.equal(copy.defaultBinding("app.leader", false), "Alt+L");
  assert.equal(copy.defaultBinding("sidebar.key.refresh", false), "Shift+F");
  assert.deepEqual([copy.defaultBinding("app.palette", true), copy.defaultBinding("app.palette", false)], ["Mod+J", "Ctrl+Shift+J"]);
  // No literal duplicate: the engine names neither chord nor key of the shared tables.
  const engine = readFileSync(ENGINE, "utf8");
  assert.doesNotMatch(engine, /"Alt\+O"|"Ctrl\+\\\\"|"alt\+o"|"ctrl\+\\\\"/, "the leader is read, not retyped");
  assert.doesNotMatch(engine, /"sidebar\.key\.\w+":\s*"/, "no sidebar key with a literal default");
  for (const { id } of CHORDS_READ) assert.doesNotMatch(engine, new RegExp(`"${id.replace(".", "\\.")}":\\s*[{"]`), `${id}: the chord is read, not retyped`);
});

// Every default of the Desktop's keymap, as written: what the engine reads per platform
// (defaultBinding). Pinned before the chords moved to the shared module (packages/client/keymap.mjs
// CHORDS) and after: reading them from there changed no key, no shape and no order.
const DEFAULTS = [
  ["app.leader",{"mac":"Ctrl+\\","other":"Alt+O"}],
  ["sidebar.key.instances","1"],
  ["sidebar.key.souls","2"],
  ["sidebar.key.capabilities","3"],
  ["sidebar.key.workspaces","W"],
  ["sidebar.key.filter","/"],
  ["sidebar.key.refresh","R"],
  ["sidebar.key.zoom","Z"],
  ["sidebar.key.closeTerminal","C"],
  ["sidebar.key.tabPrevious","["],
  ["sidebar.key.tabNext","]"],
  ["sidebar.key.splitRight","|"],
  ["sidebar.key.splitDown","-"],
  ["sidebar.key.stop","Shift+X"],
  ["sidebar.key.retire","Shift+D"],
  ["sidebar.key.start","Shift+S"],
  ["sidebar.key.restart","Shift+R"],
  ["sidebar.key.spawn","N"],
  ["sidebar.key.spawnAnother","Shift+N"],
  ["sidebar.key.help","?"],
  ["split.focusNextGroup",null],
  ["app.palette",{"mac":"Mod+K","other":"Ctrl+Shift+K"}],
  ["app.quickOpenSouls",{"mac":"Mod+P","other":"Ctrl+Shift+P"}],
  ["app.chooseSoul",{"mac":"Mod+N","other":"Ctrl+Shift+N"}],
  ["app.shortcuts","Mod+,"],
  ["app.themeToggle",null],
  ["app.themePicker",{"mac":"Mod+Shift+Space","other":"Ctrl+Shift+Space"}],
  ["stage.hierarchy","Mod+1"],
  ["stage.spawn","Mod+2"],
  ["stage.automations","Mod+3"],
  ["tabs.next","Ctrl+Tab"],
  ["tabs.prev","Ctrl+Shift+Tab"],
  ["tabs.nextPage",{"mac":null,"other":"Ctrl+PageDown"}],
  ["tabs.prevPage",{"mac":null,"other":"Ctrl+PageUp"}],
  ["tabs.goto1",{"mac":"Mod+Alt+1","other":"Alt+1"}],
  ["tabs.goto2",{"mac":"Mod+Alt+2","other":"Alt+2"}],
  ["tabs.goto3",{"mac":"Mod+Alt+3","other":"Alt+3"}],
  ["tabs.goto4",{"mac":"Mod+Alt+4","other":"Alt+4"}],
  ["tabs.goto5",{"mac":"Mod+Alt+5","other":"Alt+5"}],
  ["tabs.goto6",{"mac":"Mod+Alt+6","other":"Alt+6"}],
  ["tabs.goto7",{"mac":"Mod+Alt+7","other":"Alt+7"}],
  ["tabs.goto8",{"mac":"Mod+Alt+8","other":"Alt+8"}],
  ["tabs.goto9",{"mac":"Mod+Alt+9","other":"Alt+9"}],
  ["tabs.close",{"mac":"Mod+W","other":"Ctrl+Shift+W"}],
  ["focus.nextRegion","F6"],
  ["focus.prevRegion","Shift+F6"],
  ["focus.leaveTerminal","Mod+Shift+F6"],
  ["sidebar.focusFilter",{"mac":"Mod+F","other":"Ctrl+Shift+F"}],
  ["sidebar.toggle",{"mac":"Mod+B","other":"Ctrl+Shift+B"}],
  ["split.vertical",{"mac":"Mod+\\","other":"Ctrl+Shift+E"}],
  ["split.horizontal",{"mac":"Mod+Shift+\\","other":"Ctrl+Shift+O"}],
  ["split.close",{"mac":"Mod+Alt+W","other":"Ctrl+Shift+Alt+W"}],
  ["panel.toggle",{"mac":"Mod+I","other":"Ctrl+Shift+I"}],
  ["terminal.copySelection",{"mac":null,"other":"Ctrl+Shift+C"}],
  ["terminal.fontBigger","Mod+="],
  ["terminal.fontSmaller","Mod+-"],
  ["terminal.fontReset","Mod+0"],
];

test("the Desktop's default keymap, every action on both platforms, is as pinned", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(Object.entries(DEFAULT_KEYMAP))), DEFAULTS);
  for (const [id, entry] of DEFAULTS) {
    const [mac, other] = entry !== null && typeof entry === "object" ? [entry.mac, entry.other] : [entry, entry];
    assert.equal(defaultBinding(id, true), mac, `${id} on macOS`);
    assert.equal(defaultBinding(id, false), other, `${id} elsewhere`);
  }
});
