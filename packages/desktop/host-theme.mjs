/* oats desktop — the theme of the computer that runs Desktop (main, #602).

   "This computer" is a theme choice: Desktop's chrome and terminals take their
   colours from the host. On an Omarchy computer that is the current Omarchy
   theme; anywhere else it is the system's light or dark appearance.

   The source is Omarchy's own `colors.toml` (`~/.local/state/omarchy/current/
   theme/colors.toml`), not a generated terminal config: it is the file every
   terminal config is generated from, every theme has one, and it alone carries
   the polarity and the accent. Main never runs a host program to read colours.

   Pure: the parser and resolver take text, and the source takes its `fs`,
   timers and `nativeTheme`, so all of it is testable without Electron. Only
   colours and the polarity leave this module: no path, no file content and no
   name (`current/theme.name` is never read; its write is just one of the events
   that trigger a re-read). */
import { constants } from "node:fs";
import { join } from "node:path";
import { mixHex } from "./renderer/host-theme.mjs";

/** Omarchy hard-codes `$HOME/.local/state`; `XDG_STATE_HOME` is not consulted. */
export const omarchyCurrentDir = home => join(home, ".local", "state", "omarchy", "current");
/** The colours file is read up to this size; a larger one is unreadable. */
export const HOST_THEME_MAX_BYTES = 64 * 1024;
/** After an event on `current/`, wait this long for the change to settle. */
export const HOST_THEME_DEBOUNCE_MS = 200;
/** A missing colours file is read once more after this long: `omarchy-theme-set`
 * removes `theme/` and moves the next one in, so the file is absent for a moment. */
export const HOST_THEME_RETRY_MS = 500;

/** How the colours file is opened: read-only, and never waiting. `O_NONBLOCK`
 * makes the open of a FIFO return at once instead of waiting for a writer (it
 * changes nothing for a regular file); `O_NOCTTY` keeps the open of a terminal
 * device from having a side effect. A flag a platform lacks adds nothing. */
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOCTTY ?? 0);

const HEX = /^#[0-9a-f]{6}$/i;
const NAMES = ["red", "green", "yellow", "blue", "magenta", "cyan"];

/** `key = "value"` lines, `#` comments and blank lines, as Omarchy's own
 * `omarchy-theme-color` reads them: the value is the text between the first
 * pair of quotes (inline comments after it are ignored), else the trimmed bare
 * text; the last duplicate wins. Anything else on a line is skipped. */
export function parseColorsToml(text) {
  const entries = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at < 0) continue;
    const key = line.slice(0, at).replace(/["' \t]/g, "");
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue; // a comment, a table header, an unsupported key
    const raw = line.slice(at + 1);
    const quoted = raw.match(/["']([^"']*)/);
    entries.set(key, quoted ? quoted[1] : raw.trim());
  }
  return entries;
}

/** The palette Desktop uses, resolved the way Omarchy resolves its own (first
 * valid `#rrggbb` wins, left to right), or null when the background, the
 * foreground or one of the six normal colours is missing. */
export function resolveHostPalette(entries) {
  const pick = (...keys) => {
    for (const key of keys) { const value = entries.get(key); if (typeof value === "string" && HEX.test(value)) return value.toLowerCase(); }
    return null;
  };
  const background = pick("background", "bg", "color0");
  const foreground = pick("foreground", "fg", "color7");
  const normal = NAMES.map((name, i) => pick(name, ...(name === "magenta" ? ["purple"] : []), `color${i + 1}`));
  if (!background || !foreground || normal.some(value => !value)) return null;
  const bright = NAMES.map((name, i) => pick(`bright_${name}`, ...(name === "magenta" ? ["bright_purple"] : []), `color${i + 9}`)
    ?? mixHex(normal[i], "#ffffff", 0.2));
  const declared = [entries.get("mode"), entries.get("theme_type")].find(value => value === "dark" || value === "light");
  // Omarchy's own rule for a palette that names no polarity.
  const sum = [1, 3, 5].reduce((total, at) => total + parseInt(background.slice(at, at + 2), 16), 0);
  const mode = declared ?? (sum > 382 ? "light" : "dark");
  const blue = normal[3];
  const brightForeground = pick("bright_foreground", "bright_fg", "color15") ?? foreground;
  return {
    mode,
    colors: {
      background, foreground,
      accent: pick("accent") ?? blue,
      selection: pick("selection", "selection_background") ?? mixHex(background, foreground, 0.2),
      canvas: pick("dark_background", "dark_bg") ?? mixHex(background, "#000000", mode === "dark" ? 0.25 : 0.05),
      brightForeground,
      // Omarchy's fixed mapping (its ghostty, alacritty, kitty and foot templates agree).
      ansi: [background, ...normal, foreground,
        pick("muted", "color8", "dark_foreground", "dark_fg") ?? mixHex(background, foreground, 0.4), ...bright,
        brightForeground],
    },
  };
}

/** A regular file's text, read up to `max` bytes as UTF-8. `{ text }`, or
 * `{ reason }`: "missing" when there is no such file, "unreadable" for
 * anything else (a directory, a FIFO, too large, not UTF-8, no permission).
 *
 * The path is opened first, without blocking, and what is checked is the file
 * that was opened, never the path: an entry can be replaced between a check of
 * its path and the open, and a blocking open of a FIFO waits for a writer for
 * ever, in the main process. Nothing is read from a descriptor that is not a
 * regular file within the limit. */
function readBounded(fs, path, max) {
  const failure = error => ({ reason: error?.code === "ENOENT" || error?.code === "ENOTDIR" ? "missing" : "unreadable" });
  let fd = null;
  try {
    fd = fs.openSync(path, OPEN_FLAGS); // follows a symlink, as Omarchy's own `-f` test does
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > max) return { reason: "unreadable" };
    const buffer = Buffer.alloc(max + 1);
    let length = 0;
    for (let n; length <= max && (n = fs.readSync(fd, buffer, length, buffer.length - length, null)) > 0;) length += n;
    if (length > max) return { reason: "unreadable" }; // grew since the fstat
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)) };
  } catch (error) { return failure(error); }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* nothing to release */ } } }
}

/** One read of the current Omarchy theme under `dir`: `{ state }` or `{ reason }`
 * ("missing" | "unreadable" | "invalid"). */
export function readOmarchyTheme(fs, dir) {
  const colors = readBounded(fs, join(dir, "theme", "colors.toml"), HOST_THEME_MAX_BYTES);
  if (colors.reason) return { reason: colors.reason };
  const palette = resolveHostPalette(parseColorsToml(colors.text));
  if (!palette) return { reason: "invalid" };
  return { state: { source: "omarchy", mode: palette.mode, colors: palette.colors } };
}

/** The host theme, read and kept current.
 *
 * `start()` reads once and, when `current/` exists, watches it (the parent,
 * never `theme/` or `colors.toml`: `omarchy-theme-set` replaces `theme/` with a
 * new directory on every change, which would end a watch on it). An event is
 * debounced, then read; a missing colours file is read once more before it is
 * reported, so the swap never shows as a problem. `refresh()` re-reads now (app
 * focus; `nativeTheme`'s `updated` calls it too), which also corrects a missed
 * or failed watch: there is no retry loop. `send(state)` is called only for a
 * state that differs from the last one sent. `get()` answers the current state,
 * starting the source if nobody has. */
export function createHostThemeSource({ fs, home, nativeTheme, send = () => {},
  timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) } }) {
  const dir = omarchyCurrentDir(home);
  let started = false, disposed = false, omarchy = false, watcher = null;
  let debounce = null, retry = null, current = null, sent = null, waiting = [];
  const system = reason => ({ source: "system", mode: nativeTheme.shouldUseDarkColors ? "dark" : "light",
    ...(reason ? { problem: { origin: "omarchy", reason } } : {}) });
  const cancel = () => {
    if (debounce !== null) { timers.clearTimeout(debounce); debounce = null; }
    if (retry !== null) { timers.clearTimeout(retry); retry = null; }
  };
  function settle(state) {
    current = state;
    const waiters = waiting; waiting = [];
    for (const resolve of waiters) resolve(state);
    const serial = JSON.stringify(state);
    if (serial === sent) return;
    sent = serial;
    try { send(state); } catch { /* a closing window must not stop the next read */ }
  }
  function read(retried = false) {
    if (disposed) return;
    cancel();
    if (!omarchy) return settle(system());
    const result = readOmarchyTheme(fs, dir);
    if (result.reason === "missing" && !retried) { retry = timers.setTimeout(() => { retry = null; read(true); }, HOST_THEME_RETRY_MS); return; }
    settle(result.state ?? system(result.reason));
  }
  const changed = () => {
    if (disposed) return;
    cancel();
    debounce = timers.setTimeout(() => { debounce = null; read(); }, HOST_THEME_DEBOUNCE_MS);
  };
  const stopWatching = () => { const w = watcher; watcher = null; try { w?.close(); } catch { /* already closed */ } };
  const refresh = () => { if (started) read(); };
  function start() {
    if (started || disposed) return;
    started = true;
    try { omarchy = fs.statSync(dir).isDirectory(); } catch { omarchy = false; }
    try { nativeTheme.on("updated", refresh); } catch { /* app focus still re-reads */ }
    if (omarchy) {
      try {
        watcher = fs.watch(dir, { persistent: false }, changed);
        watcher.on?.("error", stopWatching);
      } catch { watcher = null; /* focus and appearance re-reads still follow the theme */ }
    }
    read();
  }
  return {
    start, refresh,
    get() {
      start();
      if (current || disposed) return Promise.resolve(current ?? system());
      return new Promise(resolve => { waiting.push(resolve); });
    },
    dispose() {
      if (disposed) return;
      disposed = true; cancel(); stopWatching();
      try { nativeTheme.removeListener?.("updated", refresh); } catch { /* quitting */ }
      const waiters = waiting; waiting = [];
      for (const resolve of waiters) resolve(current ?? system());
    },
  };
}

/** `host-theme:get`: the current state, to the app's own renderer only. `guard`
 * is main's trusted-frame guard and throws for any other frame. */
export function installHostThemeHandlers({ ipc, guard, source }) {
  ipc.handle("host-theme:get", async event => { guard(event); return source.get(); });
}
