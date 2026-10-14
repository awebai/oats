import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ACTIONS, bindings } from "../lib/actions.mjs";
import { CONFIG_LIMIT, DETACH_KEY, MAX_PROBLEMS, configPath, effectiveConfig, loadConfig } from "../lib/config.mjs";
import { isKeyId } from "../lib/term/keys.mjs";

const FILE = "/cfg/oats/tui.json";
const IDS = "up, down, top, bottom, page-up, page-down, collapse, expand, detail, filter, refresh, instances, workspaces, open, help, close, quit, suspend, redraw";
const KEY_IDS = "key ids look like q, ctrl+c, shift+tab, f5, space";
/** The whole line of a refusal, as it is printed. */
const line = (clause, file = FILE) => `oats: \`oats tui\` cannot use ${file}: ${clause} (E_TUI_CONFIG)`;
/** A line fit for a terminal: printable ASCII and nothing else. */
const PRINTABLE = /^[\x20-\x7e]*$/;

/** loadConfig over a file that exists only here. `content` is its text, or a value written as JSON.
 *  `calls` records what was asked of the file system. */
function load(content, { stat, read, env = { XDG_CONFIG_HOME: "/cfg" }, home = "/home/u" } = {}) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  const calls = [];
  const io = {
    stat(file) { calls.push(["stat", file]); return stat ? stat(file) : { file: true, size: Buffer.byteLength(text) }; },
    read(file) { calls.push(["read", file]); return read ? read(file) : text; },
  };
  return { ...loadConfig({ env, home, io }), calls };
}
/** The keys of an effective table, by action id. */
const keysOf = (actions) => Object.fromEntries(actions.map((action) => [action.id, [...action.keys]]));
const DEFAULT_KEYS = keysOf(ACTIONS);
const deepFrozen = (actions) => Object.isFrozen(actions) && actions.every((action) => Object.isFrozen(action) && Object.isFrozen(action.keys));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oats-tui-config-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
let homes = 0;
/** A fresh config home on disk, and the path tui.json has in it. */
function onDisk() {
  const home = path.join(dir, `home-${++homes}`);
  fs.mkdirSync(path.join(home, "oats"), { recursive: true });
  return { env: { XDG_CONFIG_HOME: home }, home: "/nonexistent", file: path.join(home, "oats", "tui.json") };
}

// --- The path -------------------------------------------------------------------

test("the path is $XDG_CONFIG_HOME/oats/tui.json when that is set, not empty and absolute, else <home>/.config/oats/tui.json", () => {
  assert.equal(configPath({ XDG_CONFIG_HOME: "/x/cfg" }, "/home/u"), path.join("/x/cfg", "oats", "tui.json"));
  const fallback = path.join("/home/u", ".config", "oats", "tui.json");
  assert.equal(configPath({}, "/home/u"), fallback);
  assert.equal(configPath({ XDG_CONFIG_HOME: "" }, "/home/u"), fallback, "empty");
  assert.equal(configPath({ XDG_CONFIG_HOME: "cfg" }, "/home/u"), fallback, "relative");
  assert.equal(configPath({ XDG_CONFIG_HOME: "./cfg" }, "/home/u"), fallback, "relative");
  assert.equal(configPath({ XDG_CONFIG_HOME: "~/.config" }, "/home/u"), fallback, "a tilde is not expanded: relative");
  assert.equal(configPath({ XDG_CONFIG_HOME: undefined }, "/home/u"), fallback);
  assert.equal(configPath({ XDG_CONFIG_HOME: 7 }, "/home/u"), fallback, "not a string");
  assert.equal(configPath({ XDG_CONFIG_HOME: "/x/cfg" }, undefined), path.join("/x/cfg", "oats", "tui.json"), "the home is not asked for when it is not used");
});

test("loadConfig reads the path configPath gives: a relative or empty XDG_CONFIG_HOME falls back to the home", () => {
  const fallback = path.join("/home/u", ".config", "oats", "tui.json");
  for (const env of [{}, { XDG_CONFIG_HOME: "" }, { XDG_CONFIG_HOME: "relative/cfg" }]) {
    const loaded = load({ ascii: true }, { env });
    assert.equal(loaded.path, fallback);
    assert.deepEqual(loaded.calls, [["stat", fallback], ["read", fallback]]);
  }
  assert.equal(load({}, { env: { XDG_CONFIG_HOME: "/x/cfg" } }).path, path.join("/x/cfg", "oats", "tui.json"));
});

// --- The defaults ---------------------------------------------------------------

test("no file is the defaults: the action table itself, ascii false, the detach key C-\\, and the path that was looked at; nothing is read", () => {
  const loaded = load("", { stat: () => null });
  assert.deepEqual(Object.keys(loaded), ["ok", "actions", "ascii", "detachKey", "path", "calls"]);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.actions, ACTIONS);
  assert.equal(loaded.ascii, false);
  assert.equal(loaded.detachKey, "C-\\");
  assert.equal(DETACH_KEY, "C-\\");
  assert.equal(loaded.path, FILE);
  assert.deepEqual(loaded.calls, [["stat", FILE]]);
});

test("an empty object, or one that names no action, is the defaults: an equal table, frozen like the one it was made from", () => {
  for (const value of [{}, { keys: {} }, { ascii: false }, { ascii: false, keys: {} }]) {
    const result = effectiveConfig(value);
    assert.deepEqual(Object.keys(result), ["ok", "actions", "ascii", "detachKey"]);
    assert.deepEqual(result.actions, ACTIONS);
    assert.equal(deepFrozen(result.actions), true);
    assert.equal(result.ascii, false);
    assert.equal(result.detachKey, DETACH_KEY);
  }
  assert.equal(deepFrozen(ACTIONS), true);
  assert.equal(ACTIONS.every((action) => action.keys.every(isKeyId)), true, "every default key is a key id");
});

test("ascii true is --ascii; it is false when absent, and anything but a boolean is refused", () => {
  assert.equal(effectiveConfig({ ascii: true }).ascii, true);
  assert.equal(effectiveConfig({ ascii: false }).ascii, false);
  assert.equal(effectiveConfig({ keys: { quit: ["x"] } }).ascii, false);
  assert.equal(load({ ascii: true, keys: { quit: ["x"] } }).ascii, true);
  for (const ascii of [1, 0, "true", "yes", null, [], {}]) {
    assert.deepEqual(load({ ascii }).lines, [line("ascii must be true or false")], JSON.stringify(ascii));
  }
});

// --- Replacement ----------------------------------------------------------------

test("a list replaces that action's keys, an empty list unbinds it, and an action that is not named keeps its keys", () => {
  const result = effectiveConfig({ keys: { quit: ["q"], refresh: ["r", "f5"], suspend: [] }, ascii: false });
  assert.equal(result.ok, true);
  assert.deepEqual(keysOf(result.actions), { ...DEFAULT_KEYS, quit: ["q"], refresh: ["r", "f5"], suspend: [] });
  assert.deepEqual(result.actions.map(({ id, label }) => [id, label]), ACTIONS.map(({ id, label }) => [id, label]), "same order, ids and labels");
  assert.deepEqual(result.actions.map((action) => Object.keys(action)), ACTIONS.map((action) => Object.keys(action)), "rows shaped like the table's");
  assert.equal(deepFrozen(result.actions), true);
  const map = bindings(result.actions);
  assert.equal(map.get("f5"), "refresh");
  assert.equal(map.has("ctrl+c"), false, "quit's list replaced its keys: ctrl+c went with them");
  assert.equal(map.has("ctrl+z"), false, "suspend is unbound");
  assert.equal(map.get("ctrl+l"), "redraw", "an action not named keeps its key");
  assert.deepEqual(keysOf(ACTIONS), DEFAULT_KEYS, "the table it was made from is untouched");
});

test("a key an action gave up is free for another, whatever the order they are written in", () => {
  for (const keys of [{ quit: ["x"], refresh: ["q"] }, { refresh: ["q"], quit: ["x"] }]) {
    const result = effectiveConfig({ keys });
    assert.equal(result.ok, true, JSON.stringify(keys));
    assert.deepEqual([bindings(result.actions).get("q"), bindings(result.actions).get("x")], ["refresh", "quit"]);
  }
  const swapped = effectiveConfig({ keys: { up: ["j", "down"], down: ["k", "up"] } });
  assert.deepEqual([swapped.actions[0].keys, swapped.actions[1].keys], [["j", "down"], ["k", "up"]], "two actions may trade their keys");
});

test("the table answered holds its own lists: changing what was parsed afterwards changes nothing", () => {
  const value = { keys: { quit: ["x"] } };
  const result = effectiveConfig(value);
  value.keys.quit.push("y");
  assert.deepEqual(result.actions.find((action) => action.id === "quit").keys, ["x"]);
  assert.throws(() => result.actions.find((action) => action.id === "quit").keys.push("z"), TypeError);
});

test("a key id a terminal may never send is accepted: what is asked is whether it is a key id", () => {
  const keys = { refresh: ["f12", "ctrl+alt+shift+f12"], help: ["alt+é", "é"], detail: ["shift+tab", "alt+enter", "space", "alt++", "+"], instances: ["\u{1f44d}\u{1f3fd}"] };
  const result = effectiveConfig({ keys });
  assert.equal(result.ok, true);
  assert.deepEqual(keysOf(result.actions), { ...DEFAULT_KEYS, ...keys });
});

test("refused: a key the help cannot name, one whose label the display filter would change, though it is a key id", () => {
  // A bidi override, a zero-width space and a combining mark on a space: each one grapheme, so a
  // key id; drawn, each would name another key or none.
  for (const key of ["\u202e", "\u200b", " \u0301", "alt+\u202e"]) {
    assert.equal(isKeyId(key), true, `${JSON.stringify(key)} is a key id`);
    assert.deepEqual(load({ keys: { quit: [key] } }).lines, [line("a key of quit that cannot be shown is a key the help cannot name; give a key whose character can be shown")], JSON.stringify(key));
    assert.deepEqual(effectiveConfig({ keys: { help: ["x", key] } }), { ok: false, problems: ["a key of help that cannot be shown is a key the help cannot name; give a key whose character can be shown"] });
  }
  // Every default key can be named.
  assert.equal(effectiveConfig({ keys: Object.fromEntries(ACTIONS.map((action) => [action.id, [...action.keys]])) }).ok, true);
});

test("effectiveConfig checks against the table it is given", () => {
  const table = Object.freeze([{ id: "a", keys: ["x"], label: "A", extra: 1 }, { id: "b", keys: ["y"], label: "B" }]);
  assert.deepEqual(effectiveConfig({ keys: { b: ["z"] } }, table), { ok: true, actions: [{ id: "a", keys: ["x"], label: "A", extra: 1 }, { id: "b", keys: ["z"], label: "B" }], ascii: false, detachKey: DETACH_KEY });
  assert.deepEqual(effectiveConfig({ keys: { quit: ["q"] } }, table), { ok: false, problems: ["unknown action quit; the actions are a, b"] });
  assert.deepEqual(effectiveConfig({ keys: { b: ["x"] } }, table), { ok: false, problems: ["the key x is given to a and to b; a key does one thing"] });
  assert.deepEqual(effectiveConfig({ keys: { b: [] } }, table).ok, true, "only quit must keep a key");
  const defect = [{ id: "a", keys: ["x"], label: "A" }, { id: "b", keys: ["x"], label: "B" }];
  assert.throws(() => bindings(defect));
  assert.deepEqual(effectiveConfig({}, defect), { ok: false, problems: ["the key x is given to a and to b; a key does one thing"] }, "a table that binds a key twice is a problem, never a throw");
  assert.equal(effectiveConfig({ keys: { b: ["y"] } }, defect).ok, true, "and the file can mend it");
});

// --- The refusals, each by name --------------------------------------------------

test("refused: not a regular file (a directory, a FIFO, a device), without reading it", () => {
  const loaded = load("{}", { stat: () => ({ file: false, size: 2 }) });
  assert.deepEqual(Object.keys(loaded), ["ok", "lines", "calls"]);
  assert.equal(loaded.ok, false);
  assert.deepEqual(loaded.lines, [line("it is not a regular file")]);
  assert.deepEqual(loaded.calls, [["stat", FILE]], "it was not read");
});

test("refused: it cannot be read, with the error's code when it is a plain one and never its text", () => {
  const fail = (code, message = "EACCES: permission denied, stat '/cfg/oats/tui.json'") => () => { throw Object.assign(new Error(message), code === undefined ? {} : { code }); };
  assert.deepEqual(load("{}", { stat: fail("EACCES") }).lines, [line("it cannot be read (EACCES)")]);
  assert.deepEqual(load("{}", { stat: fail("ELOOP") }).lines, [line("it cannot be read (ELOOP)")]);
  assert.deepEqual(load("{}", { read: fail("EISDIR") }).lines, [line("it cannot be read (EISDIR)")]);
  assert.deepEqual(load("{}", { read: fail("EIO") }).lines, [line("it cannot be read (EIO)")]);
  for (const code of [undefined, "", "eacces", "E ACCES", "E\x1b[2J", "E".repeat(32), 13, null, { toString: () => "EACCES" }]) {
    assert.deepEqual(load("{}", { stat: fail(code, "\x1b[2Jhostile") }).lines, [line("it cannot be read")], String(code));
    assert.deepEqual(load("{}", { read: fail(code, "\x1b[2Jhostile") }).lines, [line("it cannot be read")], String(code));
  }
  assert.deepEqual(load("{}", { stat: () => { throw "a string"; } }).lines, [line("it cannot be read")]);
  assert.deepEqual(load("{}", { read: () => { throw null; } }).lines, [line("it cannot be read")]);
  assert.deepEqual(load("{}", { stat: fail("ENOENT") }).lines, [line("it cannot be read (ENOENT)")], "only a null from stat means no file: an injected stat that throws is a failure");
});

test("refused: larger than 64 KiB, by its size alone: a file exactly at the limit is read, one byte over is never read", () => {
  assert.equal(CONFIG_LIMIT, 64 * 1024);
  const padded = (size) => { const head = '{"ascii": true, "keys": {"quit": ["x"]}}'; return head + " ".repeat(size - head.length); };
  const at = load(padded(CONFIG_LIMIT));
  assert.equal(at.ok, true);
  assert.deepEqual([at.ascii, bindings(at.actions).get("x")], [true, "quit"]);
  assert.deepEqual(at.calls, [["stat", FILE], ["read", FILE]]);

  const over = load(padded(CONFIG_LIMIT + 1));
  assert.deepEqual(over.lines, [line("it is larger than 64 KiB")]);
  assert.deepEqual(over.calls, [["stat", FILE]], "read was not called");
  for (const size of [CONFIG_LIMIT + 1, 2 ** 40, Infinity, NaN, undefined, "12"]) {
    const huge = load("{}", { stat: () => ({ file: true, size }), read: () => assert.fail("read was called") });
    assert.deepEqual(huge.lines, [line("it is larger than 64 KiB")], String(size));
  }
  const grew = load("{}", { read: () => { throw Object.assign(new Error("grew"), { code: "EFBIG" }); } });
  assert.deepEqual(grew.lines, [line("it is larger than 64 KiB")], "a file that grew past the limit after it was measured");
});

test("refused: not valid JSON, and the parser's own words never reach the line", () => {
  for (const text of ["", " ", "{", "{'keys': {}}", '{"keys": {"quit": ["q"],}}', "// keys\n{}", '{"ascii": true} {"ascii": false}', "\uFEFF{}", "\x1b[2J", "{\"keys\": {\"quit\": [\"\x1b[2J\"]}}", "undefined", "NaN", '{"a\x00": 1'] ) {
    assert.deepEqual(load(text).lines, [line("it is not valid JSON")], JSON.stringify(text));
  }
});

test("refused: valid JSON that is not one object", () => {
  for (const text of ["[]", '[{"ascii": true}]', '"keys"', "null", "true", "false", "0", "12.5"]) {
    assert.deepEqual(load(text).lines, [line('it is not one JSON object, like {"keys": {"quit": ["q"]}}')], text);
  }
  for (const value of [undefined, null, [], "keys", 1, true, () => ({})]) {
    assert.deepEqual(effectiveConfig(value), { ok: false, problems: ['it is not one JSON object, like {"keys": {"quit": ["q"]}}'] });
  }
});

test("refused: a top-level key other than keys, ascii and open", () => {
  assert.deepEqual(load({ theme: "dark" }).lines, [line("unknown setting theme; the settings are keys, ascii and open")]);
  assert.deepEqual(load({ Keys: {} }).lines, [line("unknown setting Keys; the settings are keys, ascii and open")]);
  assert.deepEqual(load('{"__proto__": {"ascii": true}}').lines, [line("unknown setting __proto__; the settings are keys, ascii and open")]);
  assert.deepEqual(load('{"constructor": 1}').lines, [line("unknown setting constructor; the settings are keys, ascii and open")]);
  assert.deepEqual(load({ "": 1 }).lines, [line("a setting whose name cannot be shown is unknown; the settings are keys, ascii and open")]);
});

test("refused: keys that is not an object", () => {
  for (const keys of [[], [["quit", ["q"]]], "q", 1, true, null]) {
    assert.deepEqual(load({ keys }).lines, [line('keys must be an object, like {"quit": ["q"]}')], JSON.stringify(keys));
  }
});

test("a refusal of the file's shape is one line and ends the check: the first in the file's order, and nothing about its keys", () => {
  const broken = { quit: [], reload: ["x"], up: ["Ctrl+C"] };
  assert.equal(load({ keys: broken }).lines.length, 3);
  assert.deepEqual(load({ keys: broken, theme: 1 }).lines, [line("unknown setting theme; the settings are keys, ascii and open")]);
  assert.deepEqual(load({ keys: broken, ascii: "yes" }).lines, [line("ascii must be true or false")]);
  assert.deepEqual(load({ ascii: "yes", theme: 1, keys: [] }).lines, [line("ascii must be true or false")]);
  assert.deepEqual(load({ theme: 1, ascii: "yes", keys: [] }).lines, [line("unknown setting theme; the settings are keys, ascii and open")]);
  assert.deepEqual(load({ keys: [], ascii: "yes", theme: 1 }).lines, [line('keys must be an object, like {"quit": ["q"]}')]);
});

test("refused: an unknown action id, with the ids there are", () => {
  assert.deepEqual(load({ keys: { reload: ["f5"] } }).lines, [line(`unknown action reload; the actions are ${IDS}`)]);
  assert.equal(IDS, ACTIONS.map((action) => action.id).join(", "));
  for (const id of ["Quit", "QUIT", "page_up", "pageup", "toString", "constructor", "hasOwnProperty"]) {
    assert.deepEqual(load({ keys: { [id]: ["f5"] } }).lines, [line(`unknown action ${id}; the actions are ${IDS}`)], id);
  }
  assert.deepEqual(load('{"keys": {"__proto__": ["f5"]}}').lines, [line(`unknown action __proto__; the actions are ${IDS}`)]);
  assert.deepEqual(load({ keys: { "": ["f5"] } }).lines, [line(`an action id that cannot be shown is unknown; the actions are ${IDS}`)]);
  assert.deepEqual(load({ keys: { reload: 7 } }).lines, [line(`unknown action reload; the actions are ${IDS}`)], "its value is not looked at");
});

test("refused: a value that is not a list of strings, once for the action", () => {
  const clause = (id) => `${id} must be a list of key ids, like ["q", "ctrl+c"]`;
  for (const value of ["q", 1, true, null, {}, { 0: "q" }, [1], ["q", 1], [null], [["q"]], [{ key: "q" }], ["x", 1, null, {}]]) {
    assert.deepEqual(load({ keys: { refresh: value } }).lines, [line(clause("refresh"))], JSON.stringify(value));
  }
  assert.deepEqual(load({ keys: { quit: "q" } }).lines, [line(clause("quit"))], "and not that quit has no key: what it was meant to hold is not known");
  assert.deepEqual(load({ keys: { refresh: "q", help: ["r"] } }).lines, [line(clause("refresh"))], "nor is its default key held against another action");
  assert.deepEqual(load({ keys: { help: ["r"], refresh: ["q", 1], quit: ["x"] } }).lines, [line(clause("refresh"))], "nor a string of the refused list");
});

test("refused: a string that is not a key id, each one, with what a key id looks like", () => {
  assert.deepEqual(load({ keys: { quit: ["Ctrl+C"] } }).lines, [line(`the key Ctrl+C of quit is not a key id; ${KEY_IDS}`)]);
  assert.deepEqual(load({ keys: { quit: ["q", "ctrl+shift+alt+x", "esc", "f13", "ab", "alt+"], help: ["ctrl+h"] } }).lines, [
    line(`the key ctrl+shift+alt+x of quit is not a key id; ${KEY_IDS}`),
    line(`the key esc of quit is not a key id; ${KEY_IDS}`),
    line(`the key f13 of quit is not a key id; ${KEY_IDS}`),
    line(`the key ab of quit is not a key id; ${KEY_IDS}`),
    line(`the key alt+ of quit is not a key id; ${KEY_IDS}`),
    line(`the key ctrl+h of help is not a key id; ${KEY_IDS}`),
  ]);
  assert.deepEqual(load({ keys: { quit: [""] } }).lines, [line(`an empty key of quit is not a key id; ${KEY_IDS}`)]);
  assert.deepEqual(load({ keys: { quit: [" "] } }).lines, [line(`a key of quit that cannot be shown is not a key id; ${KEY_IDS}`)], "the space is written space");
  assert.deepEqual(load({ keys: { quit: ["\t", "q"] } }).lines, [line(`a key of quit that cannot be shown is not a key id; ${KEY_IDS}`)]);
  assert.deepEqual(load({ keys: { quit: ["bogus"], refresh: ["q"] } }).lines, [line(`the key bogus of quit is not a key id; ${KEY_IDS}`)], "quit is named, so its default keys are free");
});

test("refused: one key given to two actions, naming the key and both; a user's key against a default of an action the file does not name", () => {
  assert.deepEqual(load({ keys: { refresh: ["q"] } }).lines, [line("the key q is given to quit and to refresh; a key does one thing")]);
  assert.deepEqual(load({ keys: { quit: ["r"] } }).lines, [line("the key r is given to refresh and to quit; a key does one thing")]);
  assert.deepEqual(load({ keys: { help: ["f1", "ctrl+c", "escape"] } }).lines, [
    line("the key ctrl+c is given to quit and to help; a key does one thing"),
    line("the key escape is given to close and to help; a key does one thing"),
  ]);
  assert.deepEqual(effectiveConfig({ keys: { refresh: ["q"] } }), { ok: false, problems: ["the key q is given to quit and to refresh; a key does one thing"] });
  // The switcher's two actions hold `w` and `enter` by default: a file written before they
  // existed that gives one of them to another action is refused like any other, and is
  // honoured once it gives the switcher's action another key, or none.
  assert.deepEqual(load({ keys: { refresh: ["w"] } }).lines, [line("the key w is given to workspaces and to refresh; a key does one thing")]);
  assert.deepEqual(load({ keys: { detail: ["enter"] } }).lines, [line("the key enter is given to open and to detail; a key does one thing")]);
  assert.equal(load({ keys: { refresh: ["w"], workspaces: ["f2"] } }).ok, true);
  assert.equal(load({ keys: { detail: ["enter"], open: [] } }).ok, true);
});

test("refused: one key given to two actions by two lists of the file, found at the second", () => {
  assert.deepEqual(load({ keys: { quit: ["x"], refresh: ["x"] } }).lines, [line("the key x is given to quit and to refresh; a key does one thing")]);
  assert.deepEqual(load({ keys: { refresh: ["x"], quit: ["x"] } }).lines, [line("the key x is given to refresh and to quit; a key does one thing")]);
  assert.deepEqual(load({ keys: { up: ["x"], down: ["x"], top: ["x"] } }).lines, [
    line("the key x is given to up and to down; a key does one thing"),
    line("the key x is given to up and to top; a key does one thing"),
  ], "the first to hold it keeps it: there is no last wins");
  assert.deepEqual(load({ keys: { help: ["é"], close: ["é"] } }).lines, [line("a key that cannot be shown is given to help and to close; a key does one thing")]);
});

test("refused: the same key twice in one action's list", () => {
  assert.deepEqual(load({ keys: { quit: ["q", "q"] } }).lines, [line("the key q is given to quit twice; list it once")]);
  assert.deepEqual(load({ keys: { refresh: ["r", "f5", "r", "f5", "r"] } }).lines, [
    line("the key r is given to refresh twice; list it once"),
    line("the key f5 is given to refresh twice; list it once"),
    line("the key r is given to refresh twice; list it once"),
  ]);
  assert.deepEqual(load({ keys: { help: ["日", "日"] } }).lines, [line("a key that cannot be shown is given to help twice; list it once")]);
});

test("refused: quit left with no key", () => {
  assert.deepEqual(load({ keys: { quit: [] } }).lines, [line("quit has no key; give it one")]);
  assert.deepEqual(effectiveConfig({ keys: { quit: [] } }), { ok: false, problems: ["quit has no key; give it one"] });
  assert.deepEqual(load({ keys: { quit: [], refresh: ["q", "ctrl+c"] } }).lines, [line("quit has no key; give it one")], "giving its keys to another action does not help");
  for (const action of ACTIONS.filter((a) => a.id !== "quit")) assert.equal(effectiveConfig({ keys: { [action.id]: [] } }).ok, true, `${action.id} may be unbound`);
  assert.equal(effectiveConfig({ keys: Object.fromEntries(ACTIONS.map((a) => [a.id, a.id === "quit" ? ["q"] : []])) }).ok, true, "quit alone is enough");
});

test("every problem inside keys is said, one line each, in the file's order", () => {
  const keys = { reload: ["x"], quit: [], refresh: ["q", "Ctrl+C", "f5", "f5"], help: "?", up: ["x"], down: ["x", "r"], redraw: ["ctrl+l"] };
  assert.deepEqual(load({ ascii: true, keys }).lines, [
    line(`unknown action reload; the actions are ${IDS}`),
    line("quit has no key; give it one"),
    line(`the key Ctrl+C of refresh is not a key id; ${KEY_IDS}`),
    line("the key f5 is given to refresh twice; list it once"),
    line('help must be a list of key ids, like ["q", "ctrl+c"]'),
    line("the key x is given to up and to down; a key does one thing"),
  ]);
  assert.deepEqual(Object.keys(load({ keys })), ["ok", "lines", "calls"], "a refusal answers no table");
});

test("at most MAX_PROBLEMS problems are printed: a file with more says the first ones, in the file's order, and then how many it left out", () => {
  const bad = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`nope${String(i).padStart(2, "0")}`, ["x"]]));
  const unknown = (i) => line(`unknown action nope${String(i).padStart(2, "0")}; the actions are ${IDS}`);
  assert.equal(MAX_PROBLEMS, 20);
  const atLimit = load({ keys: bad(MAX_PROBLEMS) }).lines;
  assert.deepEqual(atLimit, Array.from({ length: MAX_PROBLEMS }, (_, i) => unknown(i)), "exactly the limit: every problem, and no count");
  const over = load({ keys: bad(MAX_PROBLEMS + 1) }).lines;
  assert.deepEqual(over, [...atLimit, line("1 more problem is not listed")]);
  const many = load({ keys: bad(500) }).lines;
  assert.equal(many.length, MAX_PROBLEMS + 1);
  assert.deepEqual(many.slice(0, MAX_PROBLEMS), atLimit);
  assert.equal(many.at(-1), line("480 more problems are not listed"));
});

// --- What reaches a terminal ------------------------------------------------------

const HOSTILE = ["\x1b[2J", "\x1b]0;title\x07", "a\x07b", "q\x00", "\u009b31m", "\u0085", "x\ny", "x\ry", "tab\there", "a b", " ", "é", "日本", "\u202Eevil", "\u{1f600}", "\uFEFFq", "\x7f", "x".repeat(41), "x".repeat(5000)];

test("a name from the file reaches a line only when it is plain printable ASCII of at most 40 characters", () => {
  const forty = "x".repeat(40), fortyOne = "x".repeat(41);
  assert.deepEqual(load({ [forty]: 1 }).lines, [line(`unknown setting ${forty}; the settings are keys, ascii and open`)]);
  assert.deepEqual(load({ [fortyOne]: 1 }).lines, [line("a setting whose name cannot be shown is unknown; the settings are keys, ascii and open")]);
  assert.deepEqual(load({ keys: { [forty]: [] } }).lines, [line(`unknown action ${forty}; the actions are ${IDS}`)]);
  assert.deepEqual(load({ keys: { [fortyOne]: [] } }).lines, [line(`an action id that cannot be shown is unknown; the actions are ${IDS}`)]);
  assert.deepEqual(load({ keys: { help: [forty] } }).lines, [line(`the key ${forty} of help is not a key id; ${KEY_IDS}`)]);
  assert.deepEqual(load({ keys: { help: [fortyOne] } }).lines, [line(`a key of help that cannot be shown is not a key id; ${KEY_IDS}`)]);
  assert.deepEqual(load({ keys: { help: ["!~", "(E_TUI_CONFIG)"] } }).lines, [line(`the key !~ of help is not a key id; ${KEY_IDS}`), line(`the key (E_TUI_CONFIG) of help is not a key id; ${KEY_IDS}`)]);
});

test("a hostile name never appears in a line, wherever the file puts it, and every line is printable ASCII", () => {
  const all = [];
  const refused = (loaded, what) => { assert.equal(loaded.ok, false, what); assert.ok(loaded.lines.length > 0, what); return loaded.lines; };
  const table = (name) => [{ id: "north", keys: ["x"], label: "N" }, { id: name, keys: ["y", "x"], label: name }, { id: "south", keys: [], label: "S" }];
  for (const name of HOSTILE) {
    const label = JSON.stringify(name).slice(0, 30);
    const lines = [
      ...refused(load({ [name]: 1 }), `setting ${label}`),
      ...refused(load({ keys: { [name]: ["x"] } }), `action ${label}`),
      ...refused(load({ keys: { [name]: name } }), `action and value ${label}`),
      ...refused(load({ keys: { help: [name, "Ctrl+C"] } }), `key ${label}`),
      ...refused(load({ keys: { help: [name, "x"], close: [name, "x"], up: [name, name] } }), `key twice ${label}`),
      ...refused(load({ keys: { quit: name } }), `value ${label}`),
      ...refused(load({ ascii: name }), `ascii ${label}`),
      ...refused(load({ keys: name }), `keys ${label}`),
      ...refused(load(name), `content ${label}`),
      ...refused(load(JSON.stringify(name)), `a JSON string ${label}`),
      ...refused(load("{}", { stat: () => { throw Object.assign(new Error(name), { code: name }); } }), `stat error ${label}`),
      ...refused(load("{}", { read: () => { throw Object.assign(new Error(name), { code: name }); } }), `read error ${label}`),
      // The program's own table is trusted, and still an id of it that is not plain is not echoed.
      ...effectiveConfig({ keys: { [name]: [name], north: [name, name], south: ["x", name] } }, table(name)).problems,
      ...effectiveConfig({}, table(name)).problems,
    ];
    assert.ok(lines.length >= 16, label);
    // A lone space is in every line; every other name here must be in none.
    for (const produced of lines) if (name !== " ") assert.equal(produced.includes(name), false, `${label} in: ${produced.slice(0, 200)}`);
    // In the path the rule is the path's: a space and 41 characters are plain there.
    const inPath = refused(load({ theme: 1 }, { env: { XDG_CONFIG_HOME: `/cfg/${name}` } }), `path ${label}`);
    if (!PRINTABLE.test(name) || name.length > 200) assert.deepEqual(inPath, [line("unknown setting theme; the settings are keys, ascii and open", "its configuration file")], label);
    all.push(...lines, ...inPath);
  }
  assert.ok(all.length > 300, `${all.length} lines`);
  for (const produced of all) assert.match(produced, PRINTABLE);
});

test("the path is echoed only when it is printable ASCII of at most 200 characters; otherwise the line says its configuration file", () => {
  const withHome = (xdg) => load({ theme: 1 }, { env: { XDG_CONFIG_HOME: xdg } }).lines;
  const clause = "unknown setting theme; the settings are keys, ascii and open";
  assert.deepEqual(withHome("/my config"), [line(clause, path.join("/my config", "oats", "tui.json"))], "a space is printable");
  for (const xdg of ["/cfg/\x1b[2J", "/cfg/a\nb", "/cfg/é", "/cfg/日本", "/cfg/a\tb", "/cfg/\x7f", "/cfg/\u009b"]) {
    assert.deepEqual(withHome(xdg), [line(clause, "its configuration file")], JSON.stringify(xdg));
  }
  const tail = path.join("x", "oats", "tui.json").length - 1; // what configPath adds after the home's last character
  const fits = `/${"d".repeat(200 - 1 - tail)}`;
  assert.equal(configPath({ XDG_CONFIG_HOME: fits }, "/h").length, 200);
  assert.deepEqual(withHome(fits), [line(clause, configPath({ XDG_CONFIG_HOME: fits }, "/h"))]);
  assert.deepEqual(withHome(`${fits}d`), [line(clause, "its configuration file")], "201 characters");
  assert.equal(load({}, { env: { XDG_CONFIG_HOME: "/cfg/\x1b[2J" } }).path, path.join("/cfg/\x1b[2J", "oats", "tui.json"), "the path answered is the real one: it is for opening, not for printing");
});

// --- Real files -------------------------------------------------------------------

test("on disk: no file is the defaults, a file is read, and what it says is used", () => {
  const { env, home, file } = onDisk();
  assert.deepEqual(loadConfig({ env, home }), { ok: true, actions: ACTIONS, ascii: false, detachKey: DETACH_KEY, path: file });
  assert.equal(loadConfig({ env, home }).actions, ACTIONS);
  fs.writeFileSync(file, JSON.stringify({ keys: { quit: ["q"], refresh: ["r", "f5"], suspend: [] }, ascii: true }));
  const loaded = loadConfig({ env, home });
  assert.deepEqual([loaded.ok, loaded.ascii, loaded.path], [true, true, file]);
  assert.deepEqual(keysOf(loaded.actions), { ...DEFAULT_KEYS, quit: ["q"], refresh: ["r", "f5"], suspend: [] });
  fs.writeFileSync(file, "{ not json");
  assert.deepEqual(loadConfig({ env, home }), { ok: false, lines: [line("it is not valid JSON", file)] });
  assert.equal(fs.readFileSync(file, "utf8"), "{ not json", "the file is never written");
});

test("on disk: with no config directory at all, or a config home that is not a directory, there is no file", () => {
  const missing = path.join(dir, "no-such-home");
  assert.deepEqual(loadConfig({ env: { XDG_CONFIG_HOME: missing }, home: "/nonexistent" }), { ok: true, actions: ACTIONS, ascii: false, detachKey: DETACH_KEY, path: path.join(missing, "oats", "tui.json") });
  assert.deepEqual(loadConfig({ env: {}, home: missing }), { ok: true, actions: ACTIONS, ascii: false, detachKey: DETACH_KEY, path: path.join(missing, ".config", "oats", "tui.json") });
  const notADirectory = path.join(dir, "a-file");
  fs.writeFileSync(notADirectory, "");
  assert.equal(loadConfig({ env: { XDG_CONFIG_HOME: notADirectory }, home: "/nonexistent" }).ok, true, "as XDG_CONFIG_HOME=/dev/null");
});

test("on disk: a symbolic link to a regular file is read; a link to a directory, a directory and a FIFO are refused", (t) => {
  const linked = onDisk();
  const target = path.join(dir, "real-keys.json");
  fs.writeFileSync(target, JSON.stringify({ keys: { quit: ["x"] } }));
  fs.symlinkSync(target, linked.file);
  const loaded = loadConfig(linked);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.actions.find((action) => action.id === "quit").keys, ["x"]);
  assert.equal(loaded.path, linked.file, "the path is the link's");

  const twice = onDisk();
  fs.symlinkSync(linked.file, twice.file);
  assert.deepEqual(loadConfig(twice).actions.find((action) => action.id === "quit").keys, ["x"], "a link to a link to a file");

  const toDirectory = onDisk();
  fs.symlinkSync(dir, toDirectory.file);
  assert.deepEqual(loadConfig(toDirectory), { ok: false, lines: [line("it is not a regular file", toDirectory.file)] });

  const directory = onDisk();
  fs.mkdirSync(directory.file);
  assert.deepEqual(loadConfig(directory), { ok: false, lines: [line("it is not a regular file", directory.file)] });

  const dangling = onDisk();
  fs.symlinkSync(path.join(dir, "nothing-here"), dangling.file);
  assert.deepEqual(loadConfig(dangling), { ok: true, actions: ACTIONS, ascii: false, detachKey: DETACH_KEY, path: dangling.file }, "a link to nothing is no file");

  const loop = onDisk();
  fs.symlinkSync(loop.file, loop.file);
  assert.deepEqual(loadConfig(loop), { ok: false, lines: [line("it cannot be read (ELOOP)", loop.file)] });

  const fifo = onDisk();
  if (spawnSync("mkfifo", [fifo.file]).status !== 0) { t.diagnostic("no mkfifo here: the FIFO is not tried"); return; }
  assert.deepEqual(loadConfig(fifo), { ok: false, lines: [line("it is not a regular file", fifo.file)] }, "and it is not opened: opening a FIFO would wait for a writer");
});

test("on disk: a file exactly at the limit is read and one byte over is refused", () => {
  const { env, home, file } = onDisk();
  fs.writeFileSync(file, `{"ascii": true}${" ".repeat(CONFIG_LIMIT - 15)}`);
  assert.equal(fs.statSync(file).size, CONFIG_LIMIT);
  assert.equal(loadConfig({ env, home }).ascii, true);
  fs.appendFileSync(file, " ");
  assert.deepEqual(loadConfig({ env, home }), { ok: false, lines: [line("it is larger than 64 KiB", file)] });
});

test("on disk: a file that cannot be opened is refused with the code", (t) => {
  if (typeof process.getuid !== "function" || process.getuid() === 0) { t.skip("needs a user that a file mode can stop"); return; }
  const { env, home, file } = onDisk();
  fs.writeFileSync(file, "{}", { mode: 0o000 });
  assert.deepEqual(loadConfig({ env, home }), { ok: false, lines: [line("it cannot be read (EACCES)", file)] });
});

test("on disk: a file whose size says less than it holds is still never read past the limit", (t) => {
  // A file of /proc is regular and says size 0, whatever it holds.
  const endless = "/proc/kallsyms";
  let size = -1;
  try { if (fs.statSync(endless).isFile()) size = fs.statSync(endless).size; } catch { /* not this system */ }
  if (size !== 0) { t.skip(`no ${endless} that says size 0`); return; }
  const fd = fs.openSync(endless, "r"), probe = Buffer.alloc(CONFIG_LIMIT + 2);
  let held = 0, got = 0;
  try { while (held < probe.length && (got = fs.readSync(fd, probe, held, probe.length - held, null)) > 0) held += got; } finally { fs.closeSync(fd); }
  if (held <= CONFIG_LIMIT) { t.skip(`${endless} holds too little here`); return; }
  const { env, home, file } = onDisk();
  fs.symlinkSync(endless, file);
  assert.deepEqual(loadConfig({ env, home }), { ok: false, lines: [line("it is larger than 64 KiB", file)] });
});

// --- open.detachKey ---------------------------------------------------------------

test("open.detachKey is the key that leaves an agent's terminal, passed as it is: its grammar is the kernel's, and a file without it keeps C-\\", () => {
  for (const key of ["F12", "C-]", "M-x", "S-F5", "C-\\", "not a key at all", "x".repeat(16)]) {
    const loaded = load({ open: { detachKey: key } });
    assert.equal(loaded.ok, true, key);
    assert.equal(loaded.detachKey, key, key);
  }
  assert.equal(load({ open: {} }).detachKey, DETACH_KEY, "an open object that names no key");
  assert.equal(load({ keys: { quit: ["q"] }, ascii: true }).detachKey, DETACH_KEY, "a file written before the setting existed means what it meant");
  const all = load({ keys: { open: ["o"] }, ascii: true, open: { detachKey: "F12" } });
  assert.deepEqual([all.ok, all.ascii, all.detachKey, bindings(all.actions).get("o")], [true, true, "F12", "open"]);
});

test("refused: an open.detachKey that is not 1 to 16 printable ASCII characters, one that begins with -, one the help cannot name, an unknown member of open, and an open that is not an object", () => {
  const shape = 'open.detachKey must be 1 to 16 printable ASCII characters, like "F12"';
  for (const key of ["", "x".repeat(17), "C-\u00e9", "C-\n", "\u001b[A", 12, null, true, ["F12"], { key: "F12" }]) {
    assert.deepEqual(load({ open: { detachKey: key } }).lines, [line(shape)], JSON.stringify(key));
  }
  for (const key of ["-", "--detach-key", "-x", "--server"]) assert.deepEqual(load({ open: { detachKey: key } }).lines, [line("open.detachKey cannot begin with -")], key);
  // Printable ASCII the display filter would change (a run of spaces, a space at an end): drawn
  // in the footer and the help, it would name another key.
  for (const key of [" ", "C-  x", " F12", "F12 "]) assert.deepEqual(load({ open: { detachKey: key } }).lines, [line("open.detachKey is a key the help cannot name; give a key whose characters can be shown")], JSON.stringify(key));
  assert.deepEqual(load({ open: { detachKey: "F12", command: "x" } }).lines, [line("unknown member command of open; open has detachKey")]);
  assert.deepEqual(load({ open: { "\u001b": 1 } }).lines, [line("a member of open whose name cannot be shown is unknown; open has detachKey")]);
  for (const open of ["F12", [], null, 1, true]) assert.deepEqual(load({ open }).lines, [line('open must be an object, like {"detachKey": "F12"}')], JSON.stringify(open));
  // A refusal of open is a refusal of the file's shape: one line, before anything about its keys.
  assert.deepEqual(load({ keys: { nope: ["x"] }, open: { detachKey: "-x" } }).lines, [line("open.detachKey cannot begin with -")]);
});

test("a file that names open-workspace, the action's name before it became open, is refused with the name it has now", () => {
  assert.deepEqual(load({ keys: { "open-workspace": ["o"] } }).lines, [line("open-workspace is called open now; rename it")]);
  assert.deepEqual(load({ keys: { "open-workspace": [] } }).lines, [line("open-workspace is called open now; rename it")]);
  assert.equal(load({ keys: { open: ["o"] } }).ok, true);
  // Against a table that has no open, the old name is just unknown.
  assert.deepEqual(effectiveConfig({ keys: { "open-workspace": ["o"] } }, Object.freeze([{ id: "a", keys: ["x"], label: "A" }])), { ok: false, problems: ["unknown action open-workspace; the actions are a"] });
});
