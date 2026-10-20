/* oats desktop — keys.json, the chord family both clients bind (main).

   On Linux and Windows the shared chords are one of two families (packages/client/keymap.mjs
   CHORD_FAMILIES): Ctrl+Alt, the default, or Ctrl+Shift, the option for a terminal that passes
   Ctrl+Shift apart from Ctrl (foot, Alacritty). The choice is one file of this user's, shared with
   the TUI: `config/keys.json` in `$OATS_HOME_DIR`, else `~/.oats` (beside tui.json), shaped
   `{ "chords": "ctrl+alt" | "ctrl+shift" }`. It is the clients' file: the kernel never reads it, and
   it is in no deployment's configuration (docs/desktop-keyboard.md, "Switch to Ctrl+Shift").

   The file's text means what packages/client/keys-file.mjs says it means, there and only there:
   this module does the IO around it. Main reads the file and hands the family to every window
   (`chord-family:get`, `chord-family:changed`), and it is the one that writes it, when the
   Shortcuts page asks (`chord-family:set`): `chords` set, every other key kept (keysWithFamily),
   atomically, as a temporary file in the same directory renamed over the old one, so a reader
   sees the old file or the new one, never a part. The TUI picks a change up at its next start.

   Only plain state leaves this module: the family, why it is the default when it fell back, and
   the line the page shows for that (chordFamilyNote). No path and no file content. */
import { constants } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { CHORD_FAMILIES } from "../client/keymap.mjs";
import { KEYS_LIMIT, chordFamilyFrom, chordFamilyNote, keysPath, keysWithFamily } from "../client/keys-file.mjs";

/** How keys.json is opened to read: read-only and never waiting (host-theme.mjs has why: a FIFO's
 * open would wait for a writer, in the main process). A flag a platform lacks adds nothing. */
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOCTTY ?? 0);

/** keys.json's text as the reader takes it: `{ text }`, or `{ error }`, the error the read threw
 * (or one standing for it: a directory or a FIFO, and text that is not UTF-8, are a file that
 * cannot be read). At most KEYS_LIMIT + 1 bytes are read: a file longer than the limit answers
 * its first KEYS_LIMIT + 1 bytes, one character each (latin1), so that the reader sees text longer
 * than the limit and says it is too large. The path is opened first and the opened file is
 * checked, never the path (host-theme.mjs readBounded). */
export function readKeysText(fs, path) {
  let fd = null;
  try {
    fd = fs.openSync(path, OPEN_FLAGS);
    if (!fs.fstatSync(fd).isFile()) return { error: Object.assign(new Error("keys.json is not a file"), { code: "EISDIR" }) };
    const buffer = Buffer.alloc(KEYS_LIMIT + 1);
    let length = 0;
    for (let n; length < buffer.length && (n = fs.readSync(fd, buffer, length, buffer.length - length, null)) > 0;) length += n;
    if (length > KEYS_LIMIT) return { text: buffer.toString("latin1", 0, length) };
    try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)) }; }
    catch { return { error: Object.assign(new Error("keys.json is not UTF-8"), { code: "EILSEQ" }) }; }
  } catch (error) { return { error }; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* nothing to release */ } } }
}

/** The chord family keys.json at `path` names, as the page gets it: frozen `{ family, why, note }`
 * (chordFamilyFrom's family and why, and chordFamilyNote's line or null). Every way the file can
 * fail is the default, Ctrl+Alt. */
export function readChordFamily(fs, path) {
  const { text = null, error = null } = readKeysText(fs, path);
  const read = chordFamilyFrom(text, error);
  return Object.freeze({ family: read.family, why: read.why, note: chordFamilyNote(read) });
}

/** Where a write of `path` goes: the file a symbolic link at `path` leads to, else `path` itself
 * (no entry, or one that is no link). A link to nothing is written at its target too. */
function linkTarget(fs, path) {
  let entry;
  try { entry = fs.lstatSync(path); } catch { return path; }
  if (!entry.isSymbolicLink()) return path;
  try { return fs.realpathSync(path); } catch {
    const to = fs.readlinkSync(path);
    return isAbsolute(to) ? to : join(dirname(path), to);
  }
}

/** Write `family` to keys.json at `path`: the file's current text with `chords` set and every other
 * key kept (keysWithFamily; a file that cannot be read, or is not a JSON object, gives way to
 * `{ "chords" }`). Atomic: the new text goes to a file of its own in the same directory (mode 0600,
 * made where nothing is, synced), which is then renamed over keys.json; a failure removes it and
 * leaves keys.json as it was. The directory is made, mode 0700, when it is missing. Throws a
 * TypeError, before touching anything, for a family that is not one of CHORD_FAMILIES, and the
 * failure of any step. `stamp` names the temporary file (tests). */
export function writeChordFamily(fs, path, family, { stamp = `${process.pid}.${Date.now()}` } = {}) {
  if (!CHORD_FAMILIES.includes(family)) throw new TypeError(`unknown chord family: ${String(family)}`);
  const text = keysWithFamily(readKeysText(fs, path).text ?? null, family);
  // A keys.json that is a symbolic link (a dotfile manager's) is written where it leads, so the
  // rename replaces the file it names and the link stays.
  const target = linkTarget(fs, path);
  const dir = dirname(target);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const own = join(dir, `.keys.json.${stamp}.tmp`);
  const bytes = Buffer.from(text, "utf8");
  const fd = fs.openSync(own, "wx", 0o600);
  try {
    for (let at = 0; at < bytes.length;) at += fs.writeSync(fd, bytes, at, bytes.length - at);
    fs.fsyncSync(fd);
  } catch (error) {
    try { fs.closeSync(fd); } catch { /* the error thrown says what failed */ }
    try { fs.unlinkSync(own); } catch { /* its own file */ }
    throw error;
  }
  fs.closeSync(fd);
  try { fs.renameSync(own, target); } catch (error) {
    try { fs.unlinkSync(own); } catch { /* its own file */ }
    throw error;
  }
}

/** The chord family, read when asked and kept the same in every window.
 *
 * `get()` reads keys.json now (a window asks as it starts, so a hand edit is taken by the next
 * window), `refresh()` reads it again (app focus), and `set(family)` writes it and reads it back.
 * `send(state)` hands a state to every window, and is called only for one that differs from the
 * last one read, so a change made by one window, or by hand, reaches all of them at once. */
export function createChordFamilySource({ fs, env, home, send = () => {} }) {
  const path = keysPath(env, home);
  let last = null;
  function read() {
    const state = readChordFamily(fs, path);
    const serial = JSON.stringify(state);
    const changed = last !== null && serial !== last;
    last = serial;
    if (changed) { try { send(state); } catch { /* a closing window must not stop the next read */ } }
    return state;
  }
  return {
    path,
    get: () => read(),
    refresh: () => { if (last !== null) read(); },
    set(family) {
      writeChordFamily(fs, path, family);
      return read();
    },
  };
}

/** `chord-family:get` answers the family, and `chord-family:set` writes one and answers the family
 * then read; both to the app's own renderer only. `guard` is main's trusted-frame guard and throws
 * for any other frame; `set` refuses a family that is not one of CHORD_FAMILIES. */
export function installChordFamilyHandlers({ ipc, guard, source }) {
  ipc.handle("chord-family:get", event => { guard(event); return source.get(); });
  ipc.handle("chord-family:set", (event, family) => { guard(event); return source.set(family); });
}
