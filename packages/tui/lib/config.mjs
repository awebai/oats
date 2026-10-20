// The user's key file, tui.json: which keys do what, whether the screen is drawn in ASCII, and the
// key that takes the focus from an agent's terminal back to the list.
// Read once at start, and never written but by its move from where it was before (moved()). A file
// that is wrong in any way is refused whole, each problem as one line that says what to change:
// the TUI resolves no conflict and guesses nothing
// (there is no "last wins"), because a key that silently does something else is worse than a
// program that does not start. The lines go to a terminal, so nothing taken from the file, and
// no path, reaches one unless it is plain printable ASCII.
// Beside it, keys.json (loadKeys, at the end): the chord family both clients bind. That file is not
// the TUI's alone, so it is never refused: whatever is wrong with it is the default, said in the help.
import { closeSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { ACTIONS, bindings, keyLabel } from "./actions.mjs";
import { KEYS_LIMIT, chordFamilyFrom, displayLine, keysPath, leaderKey } from "./client.mjs";
import { isKeyId } from "./term/keys.mjs";
import { BACK_KEY_RULE, backKeyId, isBackKey } from "./term/through.mjs";

/** The largest tui.json that is read, in bytes. A larger file is refused by its size, unread. */
export const CONFIG_LIMIT = 64 * 1024;

const TOO_LARGE = `it is larger than ${CONFIG_LIMIT / 1024} KiB`;
const NOT_AN_OBJECT = 'it is not one JSON object, like {"keys": {"quit": ["q"]}}';
const SETTINGS = "the settings are keys, ascii and open";
/** A key id of the shared keymap (`ctrl+\\`, `alt+o`) in the back key's spelling (`C-\\`, `M-o`):
 *  Ctrl or Alt and one character, which is what the shared leader is. Anything else: null. */
function backKeyOf(keyId) {
  const [, mod, rest] = /^(ctrl|alt)\+(.)$/.exec(keyId) ?? [];
  return mod === undefined ? null : `${mod === "ctrl" ? "C" : "M"}-${rest}`;
}
/** The back key when tui.json names none, on `platform` (a `process.platform` value): the key that
 *  takes the focus from an agent's terminal back to the list, the leader (the setting keeps its
 *  name, `open.detachKey`, from when it left a viewer). It is the shared leader, the Desktop's too
 *  (packages/client/keymap.mjs leaderKey): `C-\\` on macOS, whose terminals send Option as Meta
 *  only when told to; `M-o` (Alt+O) elsewhere. Both are read as keys no action of ACTIONS holds
 *  (`ctrl+\\`, `alt+o`), which the check of the leader below keeps true. */
export const defaultDetachKey = (platform = process.platform) => backKeyOf(leaderKey(platform === "darwin"));
/** An action id this program had and has no more, with what it is called now. */
const RENAMED = Object.freeze({ "open-workspace": "open" });
const KEY_IDS = "key ids look like q, ctrl+c, shift+tab, f5, space";
/** A name from the file is echoed only when it is this: it cannot move a cursor or fill a screen. */
const PLAIN_NAME = /^[\x21-\x7e]{1,40}$/;
const PLAIN_PATH = /^[\x20-\x7e]{1,200}$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,30}$/;
/** The most problems that are printed: a file of nothing but mistakes must not fill a terminal. */
export const MAX_PROBLEMS = 20;

const plain = (name) => typeof name === "string" && PLAIN_NAME.test(name);
/** Whether the cheat sheet and the help can name a key: its label is drawn as text from outside (the
 *  shared display filter), and a label that filter would change would name another key, or none.
 *  Such a key (a bidi override, a combining mark on a space) is refused here, with the file named,
 *  where a key the views cannot draw would otherwise be bound and never said. */
const nameable = (key) => { const label = keyLabel(key); return displayLine(label) === label; };
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
/** Never the text of an error, which may hold anything: its code, when that is a plain one. */
const unreadable = (error) => { const code = error?.code; return `it cannot be read${typeof code === "string" && ERROR_CODE.test(code) ? ` (${code})` : ""}`; };

/** The path of tui.json: `config/tui.json` in OATS's own directory of this user, `$OATS_HOME_DIR`
 *  when that is set and not empty, else `<home>/.oats` (the kernel's rule for its files, as
 *  lib/deployments.mjs has it for this computer's list of deployments). */
export function configPath(env, home) {
  const own = env?.OATS_HOME_DIR;
  return join(typeof own === "string" && own !== "" ? own : join(home, ".oats"), "config", "tui.json");
}
/** Where tui.json was before awebai/oats#1390 step (b), and is looked for only to move it
 *  (moved()): `$XDG_CONFIG_HOME/oats/tui.json` when that variable is set, not empty and absolute
 *  (the XDG rule: a relative value is ignored), else `<home>/.config/oats/tui.json`. */
export function oldConfigPath(env, home) {
  const xdg = env?.XDG_CONFIG_HOME;
  return join(typeof xdg === "string" && xdg !== "" && isAbsolute(xdg) ? xdg : join(home, ".config"), "oats", "tui.json");
}
/** What the old file is renamed to once it is copied: beside it, so it is never lost. */
export const MIGRATED = "tui.json.migrated";

/** What tui.json says, checked: `value` is the file already parsed, `defaults` the action table,
 *  `platform` the one the TUI runs on (a `process.platform` value). Pure. Answers
 *  `{ ok: true, actions, ascii, detachKey }` or `{ ok: false, problems }`: `detachKey` is
 *  `open.detachKey`, or defaultDetachKey(platform) when the file names none.
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
export function effectiveConfig(value, defaults = ACTIONS, platform = process.platform) {
  if (!isObject(value)) return { ok: false, problems: [NOT_AN_OBJECT] };
  for (const [setting, given] of Object.entries(value)) {
    if (setting === "keys") { if (!isObject(given)) return { ok: false, problems: ['keys must be an object, like {"quit": ["q"]}'] }; }
    else if (setting === "ascii") { if (typeof given !== "boolean") return { ok: false, problems: ["ascii must be true or false"] }; }
    else if (setting === "open") { const refused = openProblem(given); if (refused) return { ok: false, problems: [refused] }; }
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
    if (!ids.has(id) && Object.hasOwn(RENAMED, id) && ids.has(RENAMED[id])) {
      problems.push(`${id} is called ${RENAMED[id]} now; rename it`);
    } else if (!ids.has(id)) {
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
  // The leader is read as a key wherever the TUI reads keys (docs/tui.md, "The leader"), so no
  // action may hold the key it reads as: `C-l` would be redraw's Ctrl+L, `C-j` open's Enter.
  const detachKey = value.open?.detachKey ?? defaultDetachKey(platform), leader = backKeyId(detachKey);
  const taken = defaults.find((action) => (named.get(action.id) ?? action.keys).includes(leader));
  // A file that names no leader is told it is the default, which it did not write.
  const which = value.open?.detachKey === undefined ? `the default leader ${detachKey}` : `open.detachKey ${detachKey}`;
  if (taken) problems.push(`${which} is read as ${keyLabel(leader)}, the key of ${say(taken.id)}; give the leader a key no action has, or give ${say(taken.id)} another`);
  if (problems.length > 0) return { ok: false, problems };

  const actions = Object.freeze(defaults.map((action) => Object.freeze({ ...action, keys: Object.freeze([...(named.get(action.id) ?? action.keys)]) })));
  try { bindings(actions); } catch { return { ok: false, problems: ["a key is given to two actions; a key does one thing"] }; }
  return { ok: true, actions, ascii: value.ascii === true, detachKey };
}

/** What is wrong with the `open` setting, or null. It holds one member, `detachKey`: the back key,
 *  one key of the TUI's own grammar (term/through.mjs BACK_KEY), which the TUI takes from the bytes
 *  typed into an agent's terminal and never hands to the kernel. A key outside the grammar is
 *  refused here, where the file is named, and not when an agent is opened. */
function openProblem(given) {
  if (!isObject(given)) return 'open must be an object, like {"detachKey": "F12"}';
  for (const [member, key] of Object.entries(given)) {
    if (member !== "detachKey") return `${plain(member) ? `unknown member ${member} of open` : "a member of open whose name cannot be shown is unknown"}; open has detachKey`;
    if (!isBackKey(key)) return `open.detachKey must be one key: ${BACK_KEY_RULE}`;
  }
  return null;
}

/** The file system as loadConfig needs it. `stat` follows symbolic links and answers null for a
 *  path that does not exist, which includes a path under something that is not a directory (an
 *  OATS_HOME_DIR of /dev/null); every other failure is thrown. `read` never takes in more than
 *  the limit and one byte, whatever the file became since it was measured, and `bytes` the same as
 *  bytes. For the move (moved()): `entry` answers `{ ino }` when an entry is at the path, a link
 *  not followed (a link to nothing is an entry), or null; `place` writes `bytes` as a new file at
 *  `path`, never over one: a file of its own first (mode 0600, synced), in the directory it makes
 *  with mode 0700 when it is missing, then linked there. It answers that file's `{ ino }`, with
 *  `taken: true` when an entry was at `path` already and nothing was placed; every failure is
 *  thrown, marked `noLinks` when the file system has no hard links. `rename` and `remove` are rename(2) and unlink(2), which act on a link itself. */
const NODE_IO = Object.freeze({
  entry: entryAt,
  bytes(path) { return readCapped(path); },
  place(bytes, to) {
    mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
    const own = join(dirname(to), `.${basename(to)}.${process.pid}.${Date.now()}.tmp`);
    const ino = written(own, bytes);
    try {
      linkSync(own, to);
      return { ino };
    } catch (error) {
      if (error?.code === "EEXIST") return { ino, taken: true };
      // A file system without hard links has no step that is both whole and never over a file
      // (there is no rename that refuses one): the move is refused, nothing placed.
      if (NO_LINKS.has(error?.code)) error.noLinks = true;
      throw error;
    } finally {
      try { unlinkSync(own); } catch { /* its own file, in a directory it could write */ }
    }
  },
  rename(from, to) { renameSync(from, to); },
  remove(path) { unlinkSync(path); },
  stat(path) {
    try {
      const found = statSync(path);
      return { file: found.isFile(), size: found.size };
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
      throw error;
    }
  },
  read(path) { return readCapped(path).toString("utf8"); },
  // keys.json (loadKeys): its bytes, at most KEYS_LIMIT and one, never thrown for its size. The
  // shared reader decodes them (packages/client/keys-file.mjs), as it does the Desktop's, so the same
  // bytes are the same family in both clients; one byte over the limit is too large there.
  keys(path) { return readUpTo(path, KEYS_LIMIT); },
});
/** What link(2) answers on a file system without hard links (FAT, exFAT, some network mounts). */
const NO_LINKS = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]);
/** `bytes` as a new file at `path`, made only where nothing is (mode 0600) and synced; answers its
 *  inode. A file it made and could not finish is removed. */
function written(path, bytes) {
  const fd = openSync(path, "wx", 0o600);
  let ino;
  try {
    for (let at = 0; at < bytes.length;) at += writeSync(fd, bytes, at, bytes.length - at);
    fsyncSync(fd);
    ino = fstatSync(fd).ino;
  } catch (error) {
    closeSync(fd);
    try { unlinkSync(path); } catch { /* the error thrown says what failed */ }
    throw error;
  }
  closeSync(fd);
  return ino;
}
/** `{ ino }` of the entry at `path`, a link not followed, or null when there is none. */
function entryAt(path) {
  try { return { ino: lstatSync(path).ino }; } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}
/** At most `limit` bytes of a file and one more, whatever it became since it was measured: one
 *  byte more is how a reader knows the file is over its limit. */
function readUpTo(path, limit) {
  const fd = openSync(path, "r");
  try {
    const bytes = Buffer.alloc(limit + 1);
    let length = 0, got = 0;
    while (length < bytes.length && (got = readSync(fd, bytes, length, bytes.length - length, null)) > 0) length += got;
    return bytes.subarray(0, length);
  } finally { closeSync(fd); }
}
/** At most CONFIG_LIMIT bytes of a file, whatever it became since it was measured. */
function readCapped(path) {
  const bytes = readUpTo(path, CONFIG_LIMIT);
  if (bytes.length > CONFIG_LIMIT) throw Object.assign(new Error("tui.json grew past the limit while it was read"), { code: "EFBIG" });
  return bytes;
}

/** A path for a line: as it is when it is printable ASCII of at most 200 characters, else `named`. */
const shownPath = (path, named) => (PLAIN_PATH.test(path) ? path : named);
/** Why a step of the move failed, for its line: never the text of an error, only its code. */
const failedBy = (error) => { const code = error?.code; return typeof code === "string" && ERROR_CODE.test(code) ? code : "it failed"; };

/** THE MOVE OF tui.json (docs/tui.md, "Change the keys: tui.json"; awebai/oats#1390 §3), before
 *  it is read: the file the old rule found (`old`, oldConfigPath) and the one read now (`path`).
 *    old present, new absent  its bytes are copied to the new path (placed: never over a file),
 *                             then the old file is renamed to tui.json.migrated beside it (a link
 *                             is renamed, not followed); then the new file is read. A copy that
 *                             cannot be made, or a rename that fails, refuses with the line that
 *                             says to move it by hand, the copy deleted first when it was made.
 *    both present             refused: the old file is no longer read, and nothing is chosen.
 *    old absent               nothing to move: the new file is read, or the defaults are used.
 *  "Present" is an entry at the path, a link to nothing included: it is reported, not guessed at.
 *  Answers null when the new file is to be read, else the line that refuses. A run that loses a
 *  race to another one starting (a new file placed by it after this run looked) asks the table
 *  again (again()): it reads the file that run placed once that run has moved the old file, and
 *  refuses as for both while an old file is still there, its own or the other's not yet renamed. */
function moved(old, path, io) {
  const from = shownPath(old, "its old configuration file"), to = shownPath(path, "its configuration file");
  const cannot = (reason) => `oats: \`oats tui\` cannot move ${from} to ${to} (${reason}); move it yourself (E_TUI_CONFIG)`;
  const both = `oats: \`oats tui\`: ${from} is no longer read: the TUI reads ${to}. Copy what you need into ${to}, then remove ${from} (E_TUI_CONFIG)`;
  // A step that fails because another run placed a new file since this one looked (the old file
  // renamed, its backup made, the new path taken) asks the table again: a new file and no old one
  // is that run's move, read; a new file beside this run's old one (another XDG_CONFIG_HOME's
  // move) is both, refused; no new file is this step's failure.
  const again = (reason) => {
    try {
      if (io.entry(path) === null) return cannot(reason);
      return io.entry(old) === null ? null : both;
    } catch { return cannot(reason); }
  };
  let had, has;
  try { had = io.entry(old); } catch (error) { return cannot(failedBy(error)); }
  if (had === null) return null;
  try { has = io.entry(path); } catch (error) { return cannot(failedBy(error)); }
  if (has !== null) return both;
  const aside = join(dirname(old), MIGRATED);
  let found, bytes, placed;
  try {
    // A backup of an earlier move is never written over.
    if (io.entry(aside) !== null) return again(`${MIGRATED} is there already`);
    found = io.stat(old);
  } catch (error) { return again(failedBy(error)); }
  if (found === null) return again("it is a link to nothing");
  if (found.file !== true) return cannot("it is not a regular file");
  if (!(typeof found.size === "number" && found.size <= CONFIG_LIMIT)) return cannot(TOO_LARGE);
  try { bytes = io.bytes(old); } catch (error) { return error?.code === "EFBIG" ? cannot(TOO_LARGE) : again(failedBy(error)); }
  try { placed = io.place(bytes, path); } catch (error) { return cannot(error?.noLinks === true ? "this file system has no hard links" : failedBy(error)); }
  // Only an entry found at the new path itself is another run's file; an EEXIST thrown on the way
  // (a `config` that is a file) is a failure like any other.
  if (placed.taken === true) return again("EEXIST");
  try { io.rename(old, aside); } catch (error) {
    // The old file gone and a new one there (moved meanwhile by something else): the copy is the
    // old file's bytes, and it is read; nothing is deleted.
    try { if (io.entry(old) === null && io.entry(path) !== null) return null; } catch { /* refused below */ }
    // The copy is deleted only while it is still the one this run made.
    try { if (io.entry(path)?.ino === placed.ino) io.remove(path); } catch { /* the line says to move it by hand */ }
    return cannot(failedBy(error));
  }
  return null;
}

/** Read tui.json, once, after its move from where it was before (moved()). Answers
 *  `{ ok: true, actions, ascii, detachKey, path }`, or
 *  `{ ok: false, lines }`: the complete lines to print (no trailing newline), after which the TUI
 *  must not start. No file is the defaults: `actions` is ACTIONS itself, `ascii` is false and
 *  `detachKey` is defaultDetachKey(platform); `platform` is the one the TUI runs on (a
 *  `process.platform` value, given so the answer is known for each).
 *
 *  `io` is the file system (node:fs when omitted): `io.stat(path)` answers `{ file, size }` after
 *  following symbolic links, or null when the path does not exist, and throws for anything else;
 *  `io.read(path)` answers the text; the move uses `entry`, `bytes`, `place`, `rename` and `remove`
 *  (see NODE_IO). The size is checked before `read` or `bytes` is called, so a file over
 *  CONFIG_LIMIT, a directory or a FIFO is never opened. A line holds a path only when it is
 *  printable ASCII, and never the text of an error: only its code, when it is a plain one. */
export function loadConfig({ env = process.env, home = homedir(), io = NODE_IO, platform = process.platform } = {}) {
  const path = configPath(env, home);
  const refusal = moved(oldConfigPath(env, home), path, io);
  if (refusal !== null) return { ok: false, lines: [refusal] };
  const listed = (problems) => (problems.length > MAX_PROBLEMS ? [...problems.slice(0, MAX_PROBLEMS), problems.length - MAX_PROBLEMS === 1 ? "1 more problem is not listed" : `${problems.length - MAX_PROBLEMS} more problems are not listed`] : problems);
  const refused = (problems) => ({ ok: false, lines: listed(problems).map((problem) => `oats: \`oats tui\` cannot use ${PLAIN_PATH.test(path) ? path : "its configuration file"}: ${problem} (E_TUI_CONFIG)`) });
  let found, text, value;
  try { found = io.stat(path); } catch (error) { return refused([unreadable(error)]); }
  if (found === null) return { ok: true, actions: ACTIONS, ascii: false, detachKey: defaultDetachKey(platform), path };
  if (found.file !== true) return refused(["it is not a regular file"]);
  if (!(typeof found.size === "number" && found.size <= CONFIG_LIMIT)) return refused([TOO_LARGE]); // read only what is known to fit
  try { text = io.read(path); } catch (error) { return refused([error?.code === "EFBIG" ? TOO_LARGE : unreadable(error)]); }
  try { value = JSON.parse(text); } catch { return refused(["it is not valid JSON"]); }
  const checked = effectiveConfig(value, ACTIONS, platform);
  return checked.ok ? { ...checked, path } : refused(checked.problems);
}

/** What loadKeys hands the shared reader for a path that is there and is no regular file (a
 *  directory, a FIFO, a device): an error that is not ENOENT or ENOTDIR, so "unreadable". Such a
 *  file is never opened: a FIFO would hold the start until something wrote to it. */
const NOT_A_FILE = Object.freeze({ reason: "not a regular file" });

/** Read keys.json, once, at the start (docs/tui.md, "Switch to Ctrl+Shift"): the chord family the
 *  TUI binds on Linux and Windows, as the shared reader (packages/client/keys-file.mjs
 *  chordFamilyFrom) says it, a frozen `{ family, why }`. The file is the clients' and the user's:
 *  `config/keys.json` beside tui.json (keysPath), `{ "chords": "ctrl+alt" | "ctrl+shift" }`. The
 *  TUI only reads it, and never refuses to start for it: no file, a file that cannot be read, one
 *  that is not a regular file, over KEYS_LIMIT, not JSON or naming no family it knows are all the
 *  default, Ctrl+Alt, with `why` saying which (the help says it: chordFamilyNote). A change is read
 *  at the next start. macOS has no family; the answer is read there too, and ignored.
 *
 *  `io` is the file system (node:fs when omitted): `io.stat(path)` as loadConfig's, and
 *  `io.keys(path)` the file's bytes, at most KEYS_LIMIT and one of them (NODE_IO). Nothing it
 *  throws reaches the user: it is the reader's `error`. */
export function loadKeys({ env = process.env, home = homedir(), io = NODE_IO } = {}) {
  const path = keysPath(env, home);
  try {
    const found = io.stat(path);
    if (found === null) return chordFamilyFrom(null);
    if (found.file !== true) return chordFamilyFrom(null, NOT_A_FILE);
    return chordFamilyFrom(io.keys(path));
  } catch (error) {
    return chordFamilyFrom(null, error ?? NOT_A_FILE);
  }
}
