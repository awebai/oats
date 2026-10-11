// The user's key file, tui.json: which keys do what, and whether the screen is drawn in ASCII.
// Read once at start and never written. A file that is wrong in any way is refused whole, each
// problem as one line that says what to change: the TUI resolves no conflict and guesses nothing
// (there is no "last wins"), because a key that silently does something else is worse than a
// program that does not start. The lines go to a terminal, so nothing taken from the file, and
// no path, reaches one unless it is plain printable ASCII.
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { ACTIONS, bindings, keyLabel } from "./actions.mjs";
import { displayLine } from "./client.mjs";
import { isKeyId } from "./term/keys.mjs";

/** The largest tui.json that is read, in bytes. A larger file is refused by its size, unread. */
export const CONFIG_LIMIT = 64 * 1024;

const TOO_LARGE = `it is larger than ${CONFIG_LIMIT / 1024} KiB`;
const NOT_AN_OBJECT = 'it is not one JSON object, like {"keys": {"quit": ["q"]}}';
const SETTINGS = "the settings are keys and ascii";
const KEY_IDS = "key ids look like q, ctrl+c, shift+tab, f5, space";
/** A name from the file is echoed only when it is this: it cannot move a cursor or fill a screen. */
const PLAIN_NAME = /^[\x21-\x7e]{1,40}$/;
const PLAIN_PATH = /^[\x20-\x7e]{1,200}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,30}$/;
/** The most problems that are printed: a file of nothing but mistakes must not fill a terminal. */
export const MAX_PROBLEMS = 20;

const plain = (name) => typeof name === "string" && PLAIN_NAME.test(name);
/** Whether the footer and the help can name a key: its label is drawn as text from outside (the
 *  shared display filter), and a label that filter would change would name another key, or none.
 *  Such a key (a bidi override, a combining mark on a space) is refused here, with the file named,
 *  where a key the views cannot draw would otherwise be bound and never said. */
const nameable = (key) => { const label = keyLabel(key); return displayLine(label) === label; };
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
/** Never the text of an error, which may hold anything: its code, when that is a plain one. */
const unreadable = (error) => { const code = error?.code; return `it cannot be read${typeof code === "string" && ERROR_CODE.test(code) ? ` (${code})` : ""}`; };

/** The path of tui.json: `$XDG_CONFIG_HOME/oats/tui.json` when that variable is set, not empty
 *  and absolute (the XDG rule: a relative value is ignored), else `<home>/.config/oats/tui.json`. */
export function configPath(env, home) {
  const xdg = env?.XDG_CONFIG_HOME;
  return join(typeof xdg === "string" && xdg !== "" && isAbsolute(xdg) ? xdg : join(home, ".config"), "oats", "tui.json");
}

/** What tui.json says, checked: `value` is the file already parsed, `defaults` the action table.
 *  Pure. Answers `{ ok: true, actions, ascii }` or `{ ok: false, problems }`.
 *
 *  `actions` is a frozen table shaped exactly like `defaults` (same order, ids and labels, frozen
 *  rows with frozen `keys`) in which the list of each action the file names REPLACES that action's
 *  keys; an empty list unbinds it, and an action the file does not name keeps its keys. It is
 *  proved with bindings() before it is answered, so no key in it does two things.
 *
 *  `problems` are plain ASCII clauses, one per problem, without the line's prefix. A problem with
 *  the file's shape is answered alone; the problems inside `keys` are all answered, in the file's
 *  order. A key given to two actions is judged with the kept defaults included and names both. An
 *  action whose list is refused takes no part in that judgement: what it was meant to hold is not
 *  known. The ids of `defaults` are the program's own; one that is not plain is still never echoed. */
export function effectiveConfig(value, defaults = ACTIONS) {
  if (!isObject(value)) return { ok: false, problems: [NOT_AN_OBJECT] };
  for (const [setting, given] of Object.entries(value)) {
    if (setting === "keys") { if (!isObject(given)) return { ok: false, problems: ['keys must be an object, like {"quit": ["q"]}'] }; }
    else if (setting === "ascii") { if (typeof given !== "boolean") return { ok: false, problems: ["ascii must be true or false"] }; }
    else return { ok: false, problems: [`${plain(setting) ? `unknown setting ${setting}` : "a setting whose name cannot be shown is unknown"}; ${SETTINGS}`] };
  }

  const ids = new Set(defaults.map((action) => action.id));
  const say = (id) => (plain(id) ? id : "an action whose id cannot be shown");
  const keyOf = (key, id) => (plain(key) ? `the key ${key} of ${say(id)}` : key === "" ? `an empty key of ${say(id)}` : `a key of ${say(id)} that cannot be shown`);
  const lists = Object.hasOwn(value, "keys") ? Object.entries(value.keys) : [];
  const named = new Map(lists.filter(([id]) => ids.has(id)).map(([id]) => [id, []]));
  const problems = [], owner = new Map();
  /** One key, one action: the first to hold a key keeps it, and every later claim is a problem. */
  const claim = (key, id) => {
    if (!owner.has(key)) { owner.set(key, id); return true; }
    const which = plain(key) ? `the key ${key}` : "a key that cannot be shown";
    problems.push(owner.get(key) === id ? `${which} is given to ${say(id)} twice; list it once` : `${which} is given to ${say(owner.get(key))} and to ${say(id)}; a key does one thing`);
    return false;
  };
  // The keys the file leaves alone are held first, so a key the file gives away twice is found
  // where the file gives it. (Two of them clashing is a defect of the table, said the same way.)
  for (const action of defaults) if (!named.has(action.id)) for (const key of action.keys) claim(key, action.id);
  for (const [id, list] of lists) {
    if (!ids.has(id)) {
      problems.push(`${plain(id) ? `unknown action ${id}` : "an action id that cannot be shown is unknown"}; the actions are ${[...ids].filter(plain).join(", ")}`);
    } else if (!Array.isArray(list) || !list.every((key) => typeof key === "string")) {
      problems.push(`${say(id)} must be a list of key ids, like ["q", "ctrl+c"]`);
    } else {
      for (const key of list) {
        if (!isKeyId(key)) problems.push(`${keyOf(key, id)} is not a key id; ${KEY_IDS}`);
        else if (!nameable(key)) problems.push(`${keyOf(key, id)} is a key the help cannot name; give a key whose character can be shown`);
        else if (claim(key, id)) named.get(id).push(key);
      }
      if (id === "quit" && list.length === 0) problems.push("quit has no key; give it one");
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  const actions = Object.freeze(defaults.map((action) => Object.freeze({ ...action, keys: Object.freeze([...(named.get(action.id) ?? action.keys)]) })));
  try { bindings(actions); } catch { return { ok: false, problems: ["a key is given to two actions; a key does one thing"] }; }
  return { ok: true, actions, ascii: value.ascii === true };
}

/** The file system as loadConfig needs it. `stat` follows symbolic links and answers null for a
 *  path that does not exist, which includes a path under something that is not a directory (an
 *  XDG_CONFIG_HOME of /dev/null); every other failure is thrown. `read` never takes in more than
 *  the limit and one byte, whatever the file became since it was measured. */
const NODE_IO = Object.freeze({
  stat(path) {
    try {
      const found = statSync(path);
      return { file: found.isFile(), size: found.size };
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
      throw error;
    }
  },
  read(path) {
    const fd = openSync(path, "r");
    try {
      const bytes = Buffer.alloc(CONFIG_LIMIT + 1);
      let length = 0, got = 0;
      while (length < bytes.length && (got = readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += got;
      if (length > CONFIG_LIMIT) throw Object.assign(new Error("tui.json grew past the limit while it was read"), { code: "EFBIG" });
      return bytes.toString("utf8", 0, length);
    } finally { closeSync(fd); }
  },
});

/** Read tui.json, once. Answers `{ ok: true, actions, ascii, path }`, or `{ ok: false, lines }`:
 *  the complete lines to print (no trailing newline), after which the TUI must not start.
 *  No file is the defaults: `actions` is ACTIONS itself and `ascii` is false.
 *
 *  `io` is the file system (node:fs when omitted): `io.stat(path)` answers `{ file, size }` after
 *  following symbolic links, or null when the path does not exist, and throws for anything else;
 *  `io.read(path)` answers the text. The size is checked before `read` is called, so a file over
 *  CONFIG_LIMIT, a directory or a FIFO is never opened. A line holds the path only when it is
 *  printable ASCII, and never the text of an error: only its code, when it is a plain one. */
export function loadConfig({ env = process.env, home = homedir(), io = NODE_IO } = {}) {
  const path = configPath(env, home);
  const listed = (problems) => (problems.length > MAX_PROBLEMS ? [...problems.slice(0, MAX_PROBLEMS), problems.length - MAX_PROBLEMS === 1 ? "1 more problem is not listed" : `${problems.length - MAX_PROBLEMS} more problems are not listed`] : problems);
  const refused = (problems) => ({ ok: false, lines: listed(problems).map((problem) => `oats: \`oats tui\` cannot use ${PLAIN_PATH.test(path) ? path : "its configuration file"}: ${problem} (E_TUI_CONFIG)`) });
  let found, text, value;
  try { found = io.stat(path); } catch (error) { return refused([unreadable(error)]); }
  if (found === null) return { ok: true, actions: ACTIONS, ascii: false, path };
  if (found.file !== true) return refused(["it is not a regular file"]);
  if (!(typeof found.size === "number" && found.size <= CONFIG_LIMIT)) return refused([TOO_LARGE]); // read only what is known to fit
  try { text = io.read(path); } catch (error) { return refused([error?.code === "EFBIG" ? TOO_LARGE : unreadable(error)]); }
  try { value = JSON.parse(text); } catch { return refused(["it is not valid JSON"]); }
  const checked = effectiveConfig(value);
  return checked.ok ? { ...checked, path } : refused(checked.problems);
}
