// The theme of this computer, main side (#602): Omarchy's colors.toml parsed and
// resolved, the watch on `current/`, the system appearance, and the IPC guard.
// Inert but for one test: an in-memory fs, fake timers, a fake nativeTheme and a
// fake ipc. No Electron, no real watch, no file outside the fixtures. The one
// test under "the real file system" runs the reader in a child process, on a
// temporary directory it removes.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import {
  parseColorsToml, resolveHostPalette, readOmarchyTheme, createHostThemeSource, installHostThemeHandlers,
  omarchyCurrentDir, HOST_THEME_MAX_BYTES, HOST_THEME_DEBOUNCE_MS, HOST_THEME_RETRY_MS,
} from "../host-theme.mjs";
import { trustedRendererUrl } from "../renderer/window-binding.mjs";
import { colorsToml, hostState, systemState } from "./helpers/host-theme-fixture.mjs";

const HOME = join("/", "home", "fixture");
const CURRENT = omarchyCurrentDir(HOME);
const THEME = join(CURRENT, "theme"), COLORS = join(THEME, "colors.toml"), NAME = join(CURRENT, "theme.name");
const resolve = text => resolveHostPalette(parseColorsToml(text));
const tick = () => new Promise(resolve => setImmediate(resolve));

/** A directory. It opens, as on Linux and macOS, unless `opens` is false (a platform that refuses). */
const dir = ({ opens = true } = {}) => ({ dir: true, opens });
const file = (content, { denied = false } = {}) => ({ bytes: Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"), denied });
/** What opens but is not a regular file: a FIFO that has a writer, a device. Its bytes are there to be left unread. */
const special = content => ({ special: true, bytes: Buffer.from(content, "utf8") });
/** An in-memory fs with the six calls the source uses; `watch` only records and hands back an emitter.
 * A descriptor keeps the entry it opened: replacing the entry at a path does not change an open file,
 * and growing an entry's `bytes` does. */
function fakeFs(tree = {}) {
  const entries = new Map(Object.entries(tree)), fds = new Map(), calls = { stat: [], open: [], flags: [], fstat: [], read: [] }, watchers = [];
  const error = code => Object.assign(new Error(code), { code });
  const stats = entry => ({ isFile: () => !entry.dir && !entry.special, isDirectory: () => Boolean(entry.dir), size: entry.dir ? 0 : entry.bytes.length });
  let next = 3, watchThrows = false;
  return {
    entries, calls, watchers, fds,
    failWatch() { watchThrows = true; },
    statSync(path) {
      calls.stat.push(path);
      const entry = entries.get(path);
      if (!entry) throw error("ENOENT");
      return stats(entry);
    },
    openSync(path, flags) {
      calls.open.push(path); calls.flags.push(flags);
      const entry = entries.get(path);
      if (!entry) throw error("ENOENT");
      if (entry.dir && !entry.opens) throw error("EISDIR");
      if (entry.denied) throw error("EACCES");
      fds.set(next, { entry, at: 0 });
      return next++;
    },
    fstatSync(fd) {
      calls.fstat.push(fd);
      const open = fds.get(fd);
      if (!open) throw error("EBADF");
      return stats(open.entry);
    },
    readSync(fd, buffer, offset, length) {
      calls.read.push(fd);
      const open = fds.get(fd);
      if (open.entry.dir) throw error("EISDIR");
      const bytes = open.entry.bytes;
      const copied = bytes.copy(buffer, offset, open.at, Math.min(bytes.length, open.at + length));
      open.at += copied;
      return copied;
    },
    closeSync(fd) { if (!fds.delete(fd)) throw error("EBADF"); },
    watch(path, options, listener) {
      if (watchThrows) throw error("ENOSPC");
      const handlers = new Map();
      const watcher = { path, options, listener, closed: false, close() { watcher.closed = true; },
        on(event, fn) { handlers.set(event, fn); return watcher; }, fail() { handlers.get("error")?.(error("EIO")); } };
      watchers.push(watcher);
      return watcher;
    },
  };
}
/** A computer with an Omarchy theme: `current/`, `theme/`, the colours file and the name file. */
const omarchy = (colors = colorsToml("tokyo-night")) => fakeFs({
  [CURRENT]: dir(), [THEME]: dir(), [COLORS]: file(colors), [NAME]: file("tokyo-night\n"),
});
function swapTheme(fs, colors) { fs.entries.set(THEME, dir()); fs.entries.set(COLORS, file(colors)); }
function removeTheme(fs) { fs.entries.delete(THEME); fs.entries.delete(COLORS); }

function fakeTimers() {
  const pending = new Map();
  let now = 0, id = 0;
  return {
    setTimeout(fn, ms) { pending.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout(handle) { pending.delete(handle); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...pending].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]); now = due[1].at; due[1].fn();
      }
      now = end;
    },
    get pending() { return pending.size; },
  };
}
function fakeNativeTheme(dark = true) {
  const listeners = new Set();
  return { shouldUseDarkColors: dark, listeners,
    on(event, fn) { assert.equal(event, "updated"); listeners.add(fn); }, removeListener(event, fn) { assert.equal(event, "updated"); listeners.delete(fn); },
    set(value) { this.shouldUseDarkColors = value; for (const fn of [...listeners]) fn(); } };
}
function source(fs, { dark = true } = {}) {
  const timers = fakeTimers(), nativeTheme = fakeNativeTheme(dark), sent = [];
  const host = createHostThemeSource({ fs, home: HOME, nativeTheme, timers, send: state => sent.push(state) });
  return { host, timers, nativeTheme, sent, event: () => fs.watchers.at(-1).listener("rename", "theme") };
}

// ── 1. parse and resolve ────────────────────────────────────────────────────

test("the directory is <home>/.local/state/omarchy/current: Omarchy hard-codes it, and XDG_STATE_HOME is not consulted", t => {
  const before = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join("/", "elsewhere");
  t.after(() => { if (before === undefined) delete process.env.XDG_STATE_HOME; else process.env.XDG_STATE_HOME = before; });
  assert.equal(omarchyCurrentDir(HOME), join(HOME, ".local", "state", "omarchy", "current"));
});

test("a dark stock theme (Tokyo Night) resolves to its mode, its surfaces and the 16 colours in Omarchy's mapping", () => {
  assert.deepEqual(resolve(colorsToml("tokyo-night")), {
    mode: "dark",
    colors: {
      background: "#1a1b26", foreground: "#a9b1d6", accent: "#7aa2f7", selection: "#292e42", canvas: "#13141c", brightForeground: "#c0caf5",
      ansi: [
        "#1a1b26", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#ad8ee6", "#449dab", "#a9b1d6",
        "#414868", "#ff7a93", "#b9f27c", "#ff9e64", "#7da6ff", "#bb9af7", "#0db9d7", "#c0caf5",
      ],
    },
  });
});

test("a light stock theme (Rosé Pine) resolves the same way", () => {
  assert.deepEqual(resolve(colorsToml("rose-pine")), {
    mode: "light",
    colors: {
      background: "#faf4ed", foreground: "#575279", accent: "#56949f", selection: "#dfdad9", canvas: "#ede7e1", brightForeground: "#575279",
      ansi: [
        "#faf4ed", "#b4637a", "#286983", "#ea9d34", "#56949f", "#907aa9", "#d7827e", "#575279",
        "#cecacd", "#b4637a", "#286983", "#ea9d34", "#56949f", "#907aa9", "#d7827e", "#575279",
      ],
    },
  });
});

test("hex values in any case are lower-cased, and a value that is not #rrggbb is ignored (stock Hackerman)", () => {
  const text = colorsToml("hackerman");
  assert.match(text, /^accent = "#82FB9C"$/m, "the stock file writes upper-case hex");
  assert.match(text, /^hyprland_active_border = "rgba\(/m, "and carries a key that is not a colour");
  const palette = resolve(text);
  assert.equal(palette.mode, "dark");
  assert.equal(palette.colors.background, "#0b0c16");
  assert.equal(palette.colors.accent, "#82fb9c");
  for (const value of [...palette.colors.ansi, palette.colors.selection, palette.colors.canvas]) assert.match(value, /^#[0-9a-f]{6}$/);
});

test("a legacy file (accent, selection, background, foreground, color0…color15, no mode) is valid: colorN names and the mode from luminance", () => {
  const text = colorsToml("legacy");
  assert.doesNotMatch(text, /^(mode|theme_type|red|muted|dark_background)\b/m);
  assert.deepEqual(resolve(text), {
    mode: "light", // 0xfd + 0xf6 + 0xe3 = 726, over 382
    colors: {
      background: "#fdf6e3", foreground: "#657b83", accent: "#268bd2", selection: "#657b83",
      canvas: "#f0ead8", // no dark_background: the background mixed 5% towards black (light mode)
      brightForeground: "#fdf6e3",
      ansi: [
        "#fdf6e3", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#657b83",
        "#002b36", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3",
      ],
    },
  });
});

const minimal = (background, extra = "") => `background = "${background}"\nforeground = "#ffffff"\nred = "#ff0000"\ngreen = "#00ff00"\nyellow = "#ffff00"\nblue = "#0000ff"\nmagenta = "#ff00ff"\ncyan = "#00ffff"\n${extra}`;

test("what a palette leaves out is derived: bright colours, muted, bright foreground, accent, selection and canvas", () => {
  assert.deepEqual(resolve(minimal("#404040")), {
    mode: "dark",
    colors: {
      background: "#404040", foreground: "#ffffff",
      accent: "#0000ff", // blue
      selection: "#666666", // the background mixed 20% towards the foreground
      canvas: "#303030", // the background mixed 25% towards black (dark mode)
      brightForeground: "#ffffff", // the foreground
      ansi: [
        "#404040", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
        "#8c8c8c", // muted: the background mixed 40% towards the foreground
        "#ff3333", "#33ff33", "#ffff33", "#3333ff", "#ff33ff", "#33ffff", // each normal colour mixed 20% towards white
        "#ffffff",
      ],
    },
  });
  assert.equal(resolve(minimal("#c0c0c0")).colors.canvas, "#b6b6b6", "light mode: 5% towards black");
});

test("mode: `mode`, then `theme_type`, only when exactly dark or light; else Omarchy's luminance rule (R+G+B over 382 is light)", () => {
  assert.equal(resolve(minimal("#000000", 'mode = "light"')).mode, "light");
  assert.equal(resolve(minimal("#ffffff", 'mode = "dark"')).mode, "dark");
  assert.equal(resolve(minimal("#000000", 'theme_type = "light"')).mode, "light");
  assert.equal(resolve(minimal("#000000", 'mode = "Dark"\ntheme_type = "light"')).mode, "light", "a mode that is not exactly dark or light is no mode");
  assert.equal(resolve(minimal("#ffffff", 'mode = "auto"')).mode, "light", "nor does it stop the luminance rule");
  assert.equal(resolve(minimal("#7f7f80")).mode, "dark", "127 + 127 + 128 = 382 is not over 382");
  assert.equal(resolve(minimal("#808080")).mode, "light", "384 is");
});

test("key order: first valid #rrggbb wins, left to right, for every colour Desktop uses", () => {
  const ansi = Array.from({ length: 16 }, (_, i) => `color${i} = "#${String(i).padStart(2, "0").repeat(3)}"`).join("\n");
  const only = resolve(ansi); // nothing but color0…color15
  assert.deepEqual(only.colors.ansi, Array.from({ length: 16 }, (_, i) => `#${String(i).padStart(2, "0").repeat(3)}`), "colorN is the last name tried for every slot");
  assert.equal(only.colors.background, "#000000"); assert.equal(only.colors.foreground, "#070707"); assert.equal(only.colors.brightForeground, "#151515");
  assert.equal(only.colors.accent, "#040404", "no accent: blue");
  const named = resolve(`${ansi}\nbg = "#a00000"\nfg = "#a00001"\npurple = "#a00002"\nbright_purple = "#a00003"\ndark_fg = "#a00004"\nbright_fg = "#a00005"\nselection_background = "#a00006"\ndark_bg = "#a00007"`);
  assert.equal(named.colors.background, "#a00000", "bg before color0");
  assert.equal(named.colors.foreground, "#a00001", "fg before color7");
  assert.equal(named.colors.ansi[5], "#050505", "color5 before purple");
  assert.equal(named.colors.ansi[13], "#131313", "color13 before bright_purple");
  const aliased = resolve(`${ansi.split("\n").filter(line => !/^color(5|13) =/.test(line)).join("\n")}\npurple = "#a00002"\nbright_purple = "#a00003"`);
  assert.deepEqual([aliased.colors.ansi[5], aliased.colors.ansi[13]], ["#a00002", "#a00003"],
    "purple and bright_purple are the last names tried: read when neither magenta nor colorN names the colour");
  assert.equal(named.colors.ansi[8], "#080808", "color8 before dark_fg for muted");
  assert.equal(named.colors.brightForeground, "#a00005", "bright_fg before color15");
  assert.equal(named.colors.ansi[15], "#a00005");
  assert.equal(named.colors.selection, "#a00006"); assert.equal(named.colors.canvas, "#a00007");
  const full = resolve(`${ansi}\nbg = "#a00000"\nbackground = "#b00000"\nfg = "#a00001"\nforeground = "#b00001"\npurple = "#a00002"\nmagenta = "#b00002"\nmuted = "#b00004"\nbright_foreground = "#b00005"\nselection = "#b00006"\nselection_background = "#a00006"\ndark_background = "#b00007"\ndark_bg = "#a00007"\naccent = "#b00008"\nbright_red = "#b00009"`);
  assert.deepEqual([full.colors.background, full.colors.foreground, full.colors.ansi[5], full.colors.ansi[8], full.colors.brightForeground, full.colors.selection, full.colors.canvas, full.colors.accent, full.colors.ansi[9]],
    ["#b00000", "#b00001", "#b00002", "#b00004", "#b00005", "#b00006", "#b00007", "#b00008", "#b00009"], "the canonical name first");
  assert.equal(resolve(`${ansi}\nbackground = "rgb(1, 2, 3)"\nbg = "#a00000"`).colors.background, "#a00000", "an invalid value does not stop the search");
});

test("the line parser: quotes of either kind, bare values, comments, blank lines, duplicates; nothing else is read", () => {
  const entries = parseColorsToml([
    "# a comment", "", "   ", "[colors]", "not a pair",
    'accent = "#7aa2f7" # blue', "selection='#292e42'", "mode = dark", '  spaced_key   =   "#010203"  ',
    '# red = "#ffffff"', 'red = "#111111"', 'red = "#222222"', 'bad key! = "#333333"', 'empty = ""',
  ].join("\r\n"));
  assert.deepEqual([...entries], [
    ["accent", "#7aa2f7"], ["selection", "#292e42"], ["mode", "dark"], ["spaced_key", "#010203"], ["red", "#222222"], ["empty", ""],
  ]);
});

test("a palette is invalid when the background, the foreground or one of the six normal colours is missing or malformed", () => {
  assert.equal(resolve(colorsToml("missing-colour")), null);
  assert.equal(resolve(colorsToml("malformed-colour")), null);
  assert.equal(resolve(""), null);
  for (const key of ["background", "foreground", "red", "green", "yellow", "blue", "magenta", "cyan"]) {
    const without = minimal("#000000").split("\n").filter(line => !line.startsWith(`${key} =`)).join("\n");
    assert.equal(resolve(without), null, `no ${key}`);
  }
  assert.ok(resolve(colorsToml("impossible")), "a palette whose text cannot pass still resolves here: the renderer's derivation refuses it");
});

// ── reading the file ────────────────────────────────────────────────────────

test("one read: the state carries colours and polarity only (no name, no path), and theme.name is never read", () => {
  const fs = omarchy();
  const { state, reason } = readOmarchyTheme(fs, CURRENT);
  assert.equal(reason, undefined);
  assert.deepEqual(state, hostState("tokyo-night"));
  assert.deepEqual(Object.keys(state).sort(), ["colors", "mode", "source"]);
  assert.deepEqual(Object.keys(state.colors).sort(), ["accent", "ansi", "background", "brightForeground", "canvas", "foreground", "selection"]);
  assert.doesNotMatch(JSON.stringify(state), /fixture|tokyo|omarchy\/|\.toml/, "nothing of the path or the name");
  assert.deepEqual(fs.calls.open, [COLORS], "only the colours file is opened");
  assert.deepEqual(fs.calls.stat, [], "and no path is checked: what is checked is the file that was opened");
  assert.deepEqual(fs.calls.fstat, [3]);
  assert.equal(fs.fds.size, 0, "the file is closed");
});

test("the colours file is opened read-only and without blocking, so a FIFO at its path cannot hold the main process", () => {
  const fs = omarchy();
  assert.deepEqual(readOmarchyTheme(fs, CURRENT).state, hostState("tokyo-night"));
  assert.equal(fs.calls.flags.length, 1, "one open");
  const [flags] = fs.calls.flags;
  assert.equal(typeof flags, "number", 'numeric flags, never the string "r"');
  if (process.platform !== "win32") assert.ok(constants.O_NONBLOCK > 0 && constants.O_NOCTTY > 0, "this platform defines both flags");
  for (const name of ["O_NONBLOCK", "O_NOCTTY"]) {
    if (constants[name] !== undefined) assert.equal(flags & constants[name], constants[name], `${name} is set`);
  }
  assert.equal(flags & (constants.O_WRONLY | constants.O_RDWR), 0, "read-only");
  assert.equal(flags, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOCTTY ?? 0), "and nothing else: a flag the platform lacks adds nothing");
  assert.equal(fs.fds.size, 0);
});

test("each unusable source gives its reason: missing, unreadable, invalid", () => {
  const read = tree => { const fs = fakeFs({ [CURRENT]: dir(), ...tree }); const result = readOmarchyTheme(fs, CURRENT); assert.equal(fs.fds.size, 0); assert.equal(result.state, undefined); return result.reason; };
  assert.equal(read({}), "missing", "current/ exists, theme/ does not");
  assert.equal(read({ [THEME]: dir() }), "missing", "theme/ exists, colors.toml does not");
  assert.equal(read({ [THEME]: dir(), [COLORS]: dir() }), "unreadable", "colors.toml is a directory that opens");
  assert.equal(read({ [THEME]: dir(), [COLORS]: dir({ opens: false }) }), "unreadable", "colors.toml is a directory the platform refuses to open");
  assert.equal(read({ [THEME]: dir(), [COLORS]: special(colorsToml("tokyo-night")) }), "unreadable", "colors.toml is not a regular file");
  assert.equal(read({ [THEME]: dir(), [COLORS]: file(colorsToml("tokyo-night"), { denied: true }) }), "unreadable", "no permission");
  assert.equal(read({ [THEME]: dir(), [COLORS]: file(Buffer.from([0x62, 0x67, 0x20, 0x3d, 0x20, 0xff, 0xfe, 0x0a])) }), "unreadable", "not UTF-8");
  const padded = size => { const text = colorsToml("tokyo-night"); return file(`${text}#${"x".repeat(size - Buffer.byteLength(text) - 1)}`); };
  assert.equal(HOST_THEME_MAX_BYTES, 64 * 1024);
  assert.equal(read({ [THEME]: dir(), [COLORS]: padded(HOST_THEME_MAX_BYTES + 1) }), "unreadable", "over 64 KiB");
  assert.equal(read({ [THEME]: dir(), [COLORS]: file(colorsToml("missing-colour")) }), "invalid");
  assert.equal(read({ [THEME]: dir(), [COLORS]: file(colorsToml("malformed-colour")) }), "invalid");
  const atLimit = fakeFs({ [CURRENT]: dir(), [THEME]: dir(), [COLORS]: padded(HOST_THEME_MAX_BYTES) });
  assert.deepEqual(readOmarchyTheme(atLimit, CURRENT).state, hostState("tokyo-night"), "exactly 64 KiB is read");
});

test("what is checked is the file that was opened: one that is not a regular file, or is over the limit, is unreadable and nothing is read from it", () => {
  const cases = [
    ["a FIFO that has a writer, or a device", special(colorsToml("tokyo-night"))],
    ["a directory", dir()],
    ["a file over 64 KiB", file("x".repeat(HOST_THEME_MAX_BYTES + 1))],
  ];
  for (const [what, entry] of cases) {
    const fs = fakeFs({ [CURRENT]: dir(), [THEME]: dir(), [COLORS]: entry });
    assert.deepEqual(readOmarchyTheme(fs, CURRENT), { reason: "unreadable" }, what);
    assert.deepEqual(fs.calls.fstat, [3], `${what}: the descriptor is checked`);
    assert.deepEqual(fs.calls.read, [], `${what}: nothing is read`);
    assert.equal(fs.fds.size, 0, `${what}: closed`);
  }
});

test("an entry replaced after any check of its path is judged by what was opened", () => {
  const fs = omarchy();
  const open = fs.openSync.bind(fs);
  // The replacement holds a valid palette: a reader that trusted a check of the path would read it and answer a state.
  fs.openSync = (path, flags) => { fs.entries.set(path, special(colorsToml("rose-pine"))); return open(path, flags); };
  assert.deepEqual(readOmarchyTheme(fs, CURRENT), { reason: "unreadable" });
  assert.deepEqual(fs.calls.read, [], "nothing is read from it");
  assert.equal(fs.fds.size, 0);
});

test("a file that grew past the limit between the check and the read is unreadable, not truncated", () => {
  const fs = omarchy();
  const fstat = fs.fstatSync.bind(fs);
  fs.fstatSync = fd => { const result = fstat(fd); fs.entries.get(COLORS).bytes = Buffer.from("x".repeat(HOST_THEME_MAX_BYTES + 10)); return result; };
  assert.deepEqual(readOmarchyTheme(fs, CURRENT), { reason: "unreadable" });
  assert.deepEqual(fs.calls.fstat, [3], "the check passed: the file was within the limit then");
  assert.ok(fs.calls.read.length > 0, "and the read found it over the limit");
  assert.equal(fs.fds.size, 0);
});

// ── the real file system ────────────────────────────────────────────────────

const REAL_FS_READER = fileURLToPath(new URL("./fixtures/host-theme/read-real-fs.mjs", import.meta.url));
/** Far more than the child needs. It is never a measure: it only ends a reader that blocks. */
const REAL_FS_DEADLINE_MS = 10_000;

test("the real file system, in a child with a deadline: a regular file and a symlink to one are read; a file replaced by a FIFO just before the open is unreadable, and the reader returns", {
  skip: process.platform === "win32" ? "the cases need the mkfifo program and FIFOs, which Windows does not have" : false,
}, () => {
  const root = mkdtempSync(join(tmpdir(), "oats-host-theme-"));
  try {
    // spawnSync kills this child, and only it, at the deadline, and has waited for it when it returns.
    const child = spawnSync(process.execPath, [REAL_FS_READER, root], { timeout: REAL_FS_DEADLINE_MS, killSignal: "SIGKILL", encoding: "utf8" });
    const said = `\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`;
    assert.equal(child.error, undefined, `the child did not end (a reader that blocks is killed at the deadline) or could not run: ${child.error?.message}${said}`);
    assert.equal(child.signal, null, said);
    assert.equal(child.status, 0, said);
    const read = { state: hostState("tokyo-night") };
    assert.deepEqual(child.stdout.trimEnd().split("\n").map(line => JSON.parse(line)), [
      { case: "regular", result: read },
      { case: "symlink", result: read },
      { case: "swap", replaced: true }, // the regular file was a FIFO when the real open was called
      { case: "swap", result: { reason: "unreadable" } },
      { case: "fifo", result: { reason: "unreadable" } },
      { case: "directory", result: { reason: "unreadable" } },
      { case: "dangling", result: { reason: "missing" } },
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── 4. live change ──────────────────────────────────────────────────────────

test("start: one read, one state, and one non-recursive watch on current/ (never on theme/ or colors.toml)", () => {
  const fs = omarchy(), u = source(fs);
  u.host.start(); u.host.start();
  assert.deepEqual(u.sent, [hostState("tokyo-night")]);
  assert.equal(fs.watchers.length, 1, "started once");
  assert.equal(fs.watchers[0].path, CURRENT, "the parent directory: omarchy-theme-set replaces theme/ with a new one on every change");
  assert.notEqual(fs.watchers[0].options?.recursive, true);
  assert.deepEqual(fs.calls.stat, [CURRENT], "the one path checked is current/; the colours file is opened, not checked by path");
  assert.equal(fs.fds.size, 0);
  assert.equal(u.nativeTheme.listeners.size, 1);
  assert.equal(u.timers.pending, 0);
});

test("an event on current/ yields one new state after the debounce, however many events the change makes", () => {
  const fs = omarchy(), u = source(fs);
  u.host.start();
  const reads = () => fs.calls.open.length;
  const before = reads();
  swapTheme(fs, colorsToml("rose-pine"));
  u.event(); u.timers.advance(50); u.event(); u.timers.advance(50); u.event(); // rm, mv, the theme.name write
  u.timers.advance(HOST_THEME_DEBOUNCE_MS - 1);
  assert.equal(reads(), before, "nothing is read before the change has settled");
  assert.equal(u.sent.length, 1);
  u.timers.advance(1);
  assert.equal(reads(), before + 1, "one read");
  assert.deepEqual(u.sent, [hostState("tokyo-night"), hostState("rose-pine")]);
  assert.equal(HOST_THEME_DEBOUNCE_MS, 200);
  assert.equal(u.timers.pending, 0);
});

test("a state is sent only when it differs from the last one sent", () => {
  const fs = omarchy(), u = source(fs);
  u.host.start();
  u.event(); u.timers.advance(HOST_THEME_DEBOUNCE_MS); // e.g. the background link changed
  u.host.refresh(); u.nativeTheme.set(false);
  assert.deepEqual(u.sent, [hostState("tokyo-night")], "the same palette is not sent again, whatever caused the read");
});

test("two changes in quick succession give one state per settled palette, never one in between", () => {
  const fs = omarchy(), u = source(fs);
  u.host.start();
  swapTheme(fs, colorsToml("hackerman")); u.event(); u.timers.advance(HOST_THEME_DEBOUNCE_MS - 1);
  swapTheme(fs, colorsToml("rose-pine")); u.event(); u.timers.advance(HOST_THEME_DEBOUNCE_MS);
  assert.deepEqual(u.sent, [hostState("tokyo-night"), hostState("rose-pine")]);
});

test("the swap gap (theme/ absent, then present within the retry) yields no problem state", () => {
  const fs = omarchy(), u = source(fs);
  u.host.start();
  removeTheme(fs); u.event();
  u.timers.advance(HOST_THEME_DEBOUNCE_MS); // read: the file is not there; one more read is scheduled
  assert.equal(u.sent.length, 1, "a missing file is not reported yet");
  assert.equal(u.timers.pending, 1);
  swapTheme(fs, colorsToml("rose-pine")); // the next theme lands, and its event is missed
  u.timers.advance(HOST_THEME_RETRY_MS - 1);
  assert.equal(u.sent.length, 1);
  u.timers.advance(1);
  assert.deepEqual(u.sent, [hostState("tokyo-night"), hostState("rose-pine")]);
  assert.equal(u.sent.some(state => state.problem), false, "the gap never shows as a problem");
  assert.equal(HOST_THEME_RETRY_MS, 500);
});

test("the swap gap with its events: the move's event restarts the debounce, and the retry of the earlier read is dropped", () => {
  const fs = omarchy(), u = source(fs);
  u.host.start();
  removeTheme(fs); u.event(); u.timers.advance(HOST_THEME_DEBOUNCE_MS);
  swapTheme(fs, colorsToml("rose-pine")); u.event();
  assert.equal(u.timers.pending, 1, "one timer: the debounce; the pending retry is gone");
  u.timers.advance(HOST_THEME_DEBOUNCE_MS);
  assert.deepEqual(u.sent, [hostState("tokyo-night"), hostState("rose-pine")]);
  u.timers.advance(HOST_THEME_RETRY_MS * 2);
  assert.equal(u.sent.length, 2);
});

test("a colours file still absent past the retry is `missing`, by the system appearance; a later good file clears it", () => {
  const fs = omarchy(), u = source(fs, { dark: false });
  u.host.start();
  removeTheme(fs); u.event();
  u.timers.advance(HOST_THEME_DEBOUNCE_MS); u.timers.advance(HOST_THEME_RETRY_MS);
  assert.deepEqual(u.sent.at(-1), systemState("light", "missing"));
  assert.deepEqual(Object.keys(u.sent.at(-1).problem).sort(), ["origin", "reason"]);
  assert.equal(u.timers.pending, 0, "one retry, not a loop");
  swapTheme(fs, colorsToml("rose-pine")); u.event(); u.timers.advance(HOST_THEME_DEBOUNCE_MS);
  assert.deepEqual(u.sent.at(-1), hostState("rose-pine"));
  assert.equal(u.sent.length, 3);
});

test("unreadable and invalid sources are reported at once (no retry), with the system's mode", () => {
  const fs = omarchy(), u = source(fs);
  u.host.start();
  fs.entries.set(COLORS, file(colorsToml("missing-colour"))); u.event(); u.timers.advance(HOST_THEME_DEBOUNCE_MS);
  assert.deepEqual(u.sent.at(-1), systemState("dark", "invalid"));
  assert.equal(u.timers.pending, 0);
  fs.entries.set(COLORS, dir()); u.event(); u.timers.advance(HOST_THEME_DEBOUNCE_MS);
  assert.deepEqual(u.sent.at(-1), systemState("dark", "unreadable"));
  u.nativeTheme.set(false);
  assert.deepEqual(u.sent.at(-1), systemState("light", "unreadable"), "the fallback follows the system appearance");
});

test("app focus and a nativeTheme update re-read at once, which corrects a missed watch event", () => {
  const fs = omarchy(), u = source(fs);
  u.host.start();
  swapTheme(fs, colorsToml("rose-pine")); // no event
  u.host.refresh();
  assert.deepEqual(u.sent.at(-1), hostState("rose-pine"));
  swapTheme(fs, colorsToml("hackerman"));
  u.nativeTheme.set(false);
  assert.deepEqual(u.sent.at(-1), hostState("hackerman"));
  assert.equal(u.timers.pending, 0);
  assert.deepEqual(fs.calls.open, [COLORS, COLORS, COLORS], "three reads");
  assert.deepEqual(fs.calls.stat, [CURRENT], "and no check of a path after the one of current/ at start");
  assert.equal(fs.fds.size, 0);
});

test("a watch that throws or errors is not retried: the source keeps working from focus and appearance re-reads", () => {
  const throwing = omarchy(); throwing.failWatch();
  const a = source(throwing);
  a.host.start();
  assert.deepEqual(a.sent, [hostState("tokyo-night")]);
  swapTheme(throwing, colorsToml("rose-pine")); a.host.refresh();
  assert.deepEqual(a.sent.at(-1), hostState("rose-pine"));
  assert.equal(throwing.watchers.length, 0); assert.equal(a.timers.pending, 0);

  const failing = omarchy(), b = source(failing);
  b.host.start();
  failing.watchers[0].fail();
  assert.equal(failing.watchers[0].closed, true);
  swapTheme(failing, colorsToml("rose-pine")); b.host.refresh(); b.host.refresh();
  assert.deepEqual(b.sent.at(-1), hostState("rose-pine"));
  assert.equal(failing.watchers.length, 1, "no second watch");
});

test("dispose closes the watch, drops the timers and the appearance listener; nothing is read or sent afterwards", () => {
  const fs = omarchy(), u = source(fs);
  u.host.start();
  u.event();
  u.host.dispose(); u.host.dispose();
  assert.equal(fs.watchers[0].closed, true);
  assert.equal(u.timers.pending, 0);
  assert.equal(u.nativeTheme.listeners.size, 0);
  const reads = fs.calls.open.length, checks = fs.calls.stat.length;
  swapTheme(fs, colorsToml("rose-pine"));
  fs.watchers[0].listener("rename", "theme"); u.timers.advance(1000); u.host.refresh(); u.host.start();
  assert.equal(fs.calls.open.length, reads, "no read");
  assert.equal(fs.calls.stat.length, checks, "and no second check of current/");
  assert.equal(u.sent.length, 1);
});

// ── 5. system appearance ────────────────────────────────────────────────────

test("no current/: the state is `system`, follows nativeTheme, carries no problem, and nothing is watched", () => {
  const fs = fakeFs({}), u = source(fs, { dark: true });
  u.host.start();
  assert.deepEqual(u.sent, [{ source: "system", mode: "dark" }]);
  assert.equal(fs.watchers.length, 0);
  u.nativeTheme.set(false);
  assert.deepEqual(u.sent.at(-1), { source: "system", mode: "light" });
  u.nativeTheme.set(true);
  assert.deepEqual(u.sent.at(-1), { source: "system", mode: "dark" });
  assert.equal(u.sent.some(state => "problem" in state || "colors" in state), false, "no palette is imported and nothing is a problem");
  // Omarchy installed while Desktop runs is picked up at the next start, not now.
  for (const [path, entry] of omarchy().entries) fs.entries.set(path, entry);
  u.host.refresh();
  assert.deepEqual(u.sent.at(-1), { source: "system", mode: "dark" });
  assert.equal(fs.watchers.length, 0);
});

// ── the renderer asks ───────────────────────────────────────────────────────

test("get: answers the state it has, computing it on demand when nothing has been read yet", async () => {
  const fs = omarchy(), u = source(fs);
  assert.deepEqual(await u.host.get(), hostState("tokyo-night"), "asked before app ready: the source starts");
  assert.equal(fs.watchers.length, 1);
  removeTheme(fs); u.event(); u.timers.advance(HOST_THEME_DEBOUNCE_MS);
  assert.deepEqual(await u.host.get(), hostState("tokyo-night"), "asked during the swap gap: the last settled state, not a problem");
});

test("get: a first read that finds no colours file answers only once the retry has settled", async () => {
  const fs = fakeFs({ [CURRENT]: dir() }), u = source(fs);
  let answer = null;
  u.host.get().then(state => { answer = state; });
  const second = u.host.get();
  await tick();
  assert.equal(answer, null, "the gap is not answered");
  swapTheme(fs, colorsToml("tokyo-night"));
  u.timers.advance(HOST_THEME_RETRY_MS);
  await tick();
  assert.deepEqual(answer, hostState("tokyo-night"));
  assert.deepEqual(await second, hostState("tokyo-night"));
});

// ── 7. IPC guard ────────────────────────────────────────────────────────────

const main = readFileSync(new URL("../main.mjs", import.meta.url), "utf8");
const RENDERER = "file:///fixture/renderer/index.html";
/** Main's shipped trusted-frame guard, from its source. */
function shippedGuard() {
  const start = main.indexOf("function trustedFrame(e) {"), end = main.indexOf("// ---- IPC: the theme of this computer", start);
  assert.ok(start >= 0 && end > start, "main.mjs defines its guard just before the host theme");
  return runInNewContext(`${main.slice(start, end)}\nguard`, { trustedRendererUrl, RENDERER_URL: RENDERER });
}

test("host-theme:get refuses an untrusted frame at the handler and answers the app's own renderer", async () => {
  const handlers = new Map(), asked = [];
  const state = hostState("tokyo-night");
  installHostThemeHandlers({ ipc: { handle: (channel, fn) => handlers.set(channel, fn) }, guard: shippedGuard(),
    source: { get: () => { asked.push(1); return Promise.resolve(state); } } });
  assert.deepEqual([...handlers.keys()], ["host-theme:get"]);
  const handler = handlers.get("host-theme:get");
  for (const url of ["https://evil.example/", "file:///fixture/renderer/other.html", "file:///fixture/renderer/index.html#ws=", undefined]) {
    await assert.rejects(handler({ senderFrame: url === undefined ? undefined : { url } }), /forbidden: untrusted frame/, String(url));
  }
  assert.deepEqual(asked, [], "a refused frame reads nothing");
  assert.deepEqual(await handler({ senderFrame: { url: RENDERER } }), state);
  assert.equal(asked.length, 1);
});

test("main installs the handler with its own guard and pushes each state to every live window", () => {
  const start = main.indexOf("const hostTheme = createHostThemeSource({"), tail = "installHostThemeHandlers({ ipc: ipcMain, guard, source: hostTheme });";
  const end = main.indexOf(tail, start);
  assert.ok(start >= 0 && end > start, "main.mjs wires the host theme");
  const sends = [], windows = [
    { webContents: { isDestroyed: () => false, send: (...args) => sends.push(["one", ...args]) } },
    { webContents: { isDestroyed: () => true, send: () => assert.fail("a destroyed window gets nothing") } },
    { webContents: { isDestroyed: () => false, send: () => { throw new Error("closing"); } } },
    { webContents: { isDestroyed: () => false, send: (...args) => sends.push(["two", ...args]) } },
  ];
  const made = { stub: true }, guard = () => {}, ipcMain = {}, nativeTheme = {}, calls = {};
  const fns = Object.fromEntries(["statSync", "fstatSync", "openSync", "readSync", "closeSync", "watch"].map(name => [name, () => {}]));
  runInNewContext(main.slice(start, end + tail.length), { ...fns, homedir: () => HOME, nativeTheme, ipcMain, guard,
    BrowserWindow: { getAllWindows: () => windows },
    createHostThemeSource: options => { calls.source = options; return made; },
    installHostThemeHandlers: options => { calls.handlers = options; } });
  assert.deepEqual(Object.keys(calls.source.fs).sort(), ["closeSync", "fstatSync", "openSync", "readSync", "statSync", "watch"], "the fs it is given: stat, a bounded read of a checked descriptor, a watch");
  assert.equal(calls.source.home, HOME); assert.equal(calls.source.nativeTheme, nativeTheme);
  assert.equal(calls.handlers.guard, guard, "the existing trusted-frame guard");
  assert.equal(calls.handlers.source, made); assert.equal(calls.handlers.ipc, ipcMain);
  const state = hostState("rose-pine");
  calls.source.send(state);
  assert.deepEqual(sends, [["one", "host-theme:changed", state], ["two", "host-theme:changed", state]]);
});

test("main starts the source at app ready, re-reads on window focus and closes it at quit (the primary instance only)", async () => {
  const block = main.match(/if \(primaryInstance\) \{\n {2}app\.whenReady\(\)\.then\(\(\) => hostTheme\.start\(\)\);[^]*?\n\}/)?.[0];
  assert.ok(block, "main.mjs has the host theme's lifecycle block");
  const run = primaryInstance => {
    const events = new Map(), calls = [];
    let ready;
    const app = { whenReady: () => new Promise(resolve => { ready = resolve; }), on: (event, fn) => events.set(event, fn) };
    runInNewContext(block, { primaryInstance, app, hostTheme: { start: () => calls.push("start"), refresh: () => calls.push("refresh"), dispose: () => calls.push("dispose") } });
    return { events, calls, ready: () => ready?.() };
  };
  const primary = run(true);
  assert.deepEqual(primary.calls, [], "not before the app is ready");
  primary.ready(); await tick();
  assert.deepEqual(primary.calls, ["start"]);
  primary.events.get("browser-window-focus")(); primary.events.get("will-quit")();
  assert.deepEqual(primary.calls, ["start", "refresh", "dispose"]);
  assert.deepEqual([...primary.events.keys()].sort(), ["browser-window-focus", "will-quit"]);
  const second = run(false);
  assert.equal(second.events.size, 0);
  assert.deepEqual(second.calls, []);
});

test("preload: hostTheme() invokes host-theme:get, and onHostThemeChanged hands over the state only and returns an unsubscribe", async () => {
  const require = createRequire(import.meta.url);
  let api = null;
  const listeners = new Map(), invoked = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, "oatsDesktop"); api = value; } },
    ipcRenderer: {
      invoke: (...args) => { invoked.push(args); return Promise.resolve("answer"); },
      on: (channel, fn) => { listeners.set(channel, fn); }, removeListener: (channel, fn) => { if (listeners.get(channel) === fn) listeners.delete(channel); },
      send() {},
    },
    webUtils: {},
  };
  runInNewContext(readFileSync(new URL("../preload.cjs", import.meta.url), "utf8"),
    { require: name => name === "electron" ? electron : require(name === "./terminal-bridge.cjs" ? "../terminal-bridge.cjs" : name) });
  assert.equal(await api.hostTheme("ignored"), "answer");
  assert.deepEqual(invoked, [["host-theme:get"]], "no argument crosses the bridge");
  const heard = [];
  const off = api.onHostThemeChanged(state => heard.push(state));
  const state = hostState("tokyo-night");
  listeners.get("host-theme:changed")({ sender: "the IPC event stays in the preload" }, state);
  assert.deepEqual(heard, [state]);
  off();
  assert.equal(listeners.has("host-theme:changed"), false);
});
