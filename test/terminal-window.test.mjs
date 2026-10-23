// `oats tui --open` and `oats session attach --open` (awebai/oats#1483): a terminal window in the
// person's desktop session, running the plain command. No test here opens a window: the launcher
// lookup is injected, and the CLI's runs find only fake launchers that record their argv.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { oatsDirectory, openTerminalWindow, plainCommand, terminalLaunch, windowCommand } from "../lib/terminal-window.mjs";

const BIN = fileURLToPath(new URL("../bin/oats.mjs", import.meta.url));
const SYSTEMD_RUN = ["--user", "--collect", "--quiet", "-p", "KillMode=process", "-E", "DISPLAY", "-E", "WAYLAND_DISPLAY", "-E", "XAUTHORITY"];
/** A lookup that finds exactly `tools`, each in /usr/bin. */
const finding = (...tools) => (name) => tools.includes(name) ? `/usr/bin/${name}` : null;
const TEXT = `env PATH=/n/bin:"$PATH" oats tui --dir /d`;

test("the plain command quotes each word by the kernel's one rule, and a shell reads back the same words", () => {
  const words = ["oats", "tui", "--dir", "/home/a b/it's \"here\" $HOME `x` \\"];
  const command = plainCommand(words);
  assert.equal(command, `oats tui --dir '/home/a b/it'\\''s "here" $HOME \`x\` \\'`);
  const out = execFileSync("/bin/sh", ["-c", `printf '%s\\n' ${command}`], { encoding: "utf8" });
  assert.deepEqual(out.split("\n").slice(0, -1), words);
});

test("the window's command puts the node and oats directories first on PATH, ahead of the window's own, then runs the plain command", () => {
  assert.equal(windowCommand(["oats", "tui"], { dirs: ["/n/bin", "/o/bin"] }), `env PATH=/n/bin:/o/bin:"$PATH" oats tui`);
  assert.equal(windowCommand(["oats", "tui"], { dirs: ["/n/bin", "/n/bin"] }), `env PATH=/n/bin:"$PATH" oats tui`, "a directory once");
  assert.equal(windowCommand(["oats", "tui"], { dirs: ["/a b/bin"] }), `env PATH='/a b/bin':"$PATH" oats tui`);
  // A shell with nothing on its PATH finds the command through the prefix alone.
  const dir = mkdtempSync(join(tmpdir(), "oats-tw-"));
  try {
    mkdirSync(join(dir, "a b"));
    writeFileSync(join(dir, "a b", "hello"), "#!/bin/sh\necho \"hello $1\"\n");
    chmodSync(join(dir, "a b", "hello"), 0o755);
    const out = execFileSync("/bin/sh", ["-c", windowCommand(["hello", "it's"], { dirs: [join(dir, "a b")] })], { encoding: "utf8", env: { PATH: "/usr/bin:/bin" } });
    assert.equal(out, "hello it's\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("on macOS Terminal is asked through osascript, the command in an AppleScript string", () => {
  const text = `env PATH=/n/bin:"$PATH" oats tui --dir '/a\\b'`;
  assert.deepEqual(terminalLaunch(text, { platform: "darwin", find: finding("osascript") }), {
    via: "osascript", file: "/usr/bin/osascript",
    args: ["-e", `tell application "Terminal" to do script "env PATH=/n/bin:\\"$PATH\\" oats tui --dir '/a\\\\b'"`],
  });
});

test("on Linux systemd-run carries the display variables to xdg-terminal-exec, else x-terminal-emulator -e, running sh -c", () => {
  assert.deepEqual(terminalLaunch(TEXT, { platform: "linux", find: finding("systemd-run", "xdg-terminal-exec", "x-terminal-emulator") }), {
    via: "xdg-terminal-exec", file: "/usr/bin/systemd-run", args: [...SYSTEMD_RUN, "/usr/bin/xdg-terminal-exec", "/bin/sh", "-c", TEXT],
  });
  assert.deepEqual(terminalLaunch(TEXT, { platform: "linux", find: finding("systemd-run", "x-terminal-emulator") }), {
    via: "x-terminal-emulator", file: "/usr/bin/systemd-run", args: [...SYSTEMD_RUN, "/usr/bin/x-terminal-emulator", "-e", "/bin/sh", "-c", TEXT],
  });
});

test("without a launcher the answer is E_OPEN_UNAVAILABLE, naming what was tried", () => {
  const unavailable = (platform, find, tried) => assert.throws(() => terminalLaunch(TEXT, { platform, find }), (e) => {
    assert.equal(e.code, "E_OPEN_UNAVAILABLE");
    assert.deepEqual(e.details.tried, tried);
    for (const name of tried) assert.match(e.message, new RegExp(name));
    return true;
  }, platform);
  unavailable("linux", finding("xdg-terminal-exec", "x-terminal-emulator"), ["systemd-run"]);
  unavailable("linux", finding("systemd-run"), ["systemd-run", "xdg-terminal-exec", "x-terminal-emulator"]);
  unavailable("darwin", finding(), ["osascript"]);
  unavailable("win32", finding("osascript", "systemd-run", "xdg-terminal-exec"), []);
});

test("the oats directory is the first PATH entry whose oats is this kernel, past an instance's .oats/bin; none gives null", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-tw-")));
  try {
    const kernel = join(dir, "pkg", "bin", "oats.mjs");
    mkdirSync(dirname(kernel), { recursive: true });
    writeFileSync(kernel, "");
    const other = join(dir, "other.mjs");
    writeFileSync(other, "");
    for (const [sub, target] of [["home/.oats/bin", kernel], ["elsewhere", other], ["global", kernel], ["later", kernel]]) {
      mkdirSync(join(dir, sub), { recursive: true });
      symlinkSync(target, join(dir, sub, "oats"));
    }
    const envPath = ["home/.oats/bin", "missing", "elsewhere", "global", "later"].map((sub) => join(dir, sub)).join(":");
    assert.equal(oatsDirectory({ envPath, kernelBin: kernel }), join(dir, "global"));
    assert.equal(oatsDirectory({ envPath: join(dir, "elsewhere"), kernelBin: kernel }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an open runs the launcher once and answers that a window was requested, with the plain command; a launcher that fails is E_OPEN_UNAVAILABLE with the command to run by hand", () => {
  const calls = [];
  const exec = (file, args, options) => { calls.push({ file, args, options }); return ""; };
  const io = { platform: "linux", find: finding("systemd-run", "xdg-terminal-exec"), exec, node: "/n/bin/node", oatsDir: "/o/bin" };
  assert.deepEqual(openTerminalWindow(["oats", "tui", "--dir", "/d d"], io), { opened: "requested", via: "xdg-terminal-exec", command: "oats tui --dir '/d d'" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "/usr/bin/systemd-run");
  assert.equal(calls[0].args.at(-1), `env PATH=/n/bin:/o/bin:"$PATH" oats tui --dir '/d d'`);
  assert.equal(calls[0].options.env, undefined, "the launcher runs in this process's environment; nothing is added or removed");

  const failing = { ...io, exec: () => { throw Object.assign(new Error("Command failed"), { stderr: "Failed to connect to bus\n" }); } };
  assert.throws(() => openTerminalWindow(["oats", "tui"], failing), (e) => {
    assert.equal(e.code, "E_OPEN_UNAVAILABLE");
    assert.match(e.message, /systemd-run/);
    assert.match(e.message, /Failed to connect to bus/);
    assert.match(e.message, /oats tui$/);
    assert.equal(e.details.command, "oats tui");
    return true;
  });
  assert.throws(() => openTerminalWindow(["oats", "tui"], { ...io, find: finding() }), (e) => e.code === "E_OPEN_UNAVAILABLE" && e.details.command === "oats tui" && /oats tui$/.test(e.message));
});

test("with no oats of this kernel on PATH, the window runs this kernel by its path", () => {
  const calls = [];
  const io = { platform: "darwin", find: finding("osascript"), exec: (file, args) => { calls.push(args); return ""; }, node: "/n/bin/node", oatsDir: null, kernelBin: "/k/bin/oats.mjs" };
  assert.deepEqual(openTerminalWindow(["oats", "tui"], io), { opened: "requested", via: "osascript", command: "/k/bin/oats.mjs tui" });
  assert.match(calls[0][1], /do script "env PATH=\/n\/bin:\\"\$PATH\\" \/k\/bin\/oats\.mjs tui"$/);
});

// ---- the CLI ---------------------------------------------------------------------------------------

/** A directory of fake launchers, each writing its argv, one per line, to `<dir>/<name>.argv`. */
function fakeLaunchers(...names) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oats-tw-bin-")));
  for (const name of names) {
    writeFileSync(join(dir, name), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > '${dir}/${name}.argv'\n`);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}
const LAUNCHER = process.platform === "darwin" ? "osascript" : "systemd-run";
/** `oats <args>` with PATH holding only `dir`: no real launcher can be found. */
const oats = (dir, args, cwd = dir) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", env: { HOME: process.env.HOME, PATH: dir } });

test("`oats tui --open --dir D --json` asks the launcher for a window running `oats tui --dir <absolute D>`, and loads no TUI", { skip: !["darwin", "linux"].includes(process.platform) }, () => {
  const dir = fakeLaunchers("osascript", "systemd-run", "xdg-terminal-exec");
  try {
    const r = oats(dir, ["tui", "--open", "--dir", "some where", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const { result } = JSON.parse(r.stdout);
    const command = `${BIN} tui --dir '${join(dir, "some where")}'`;
    assert.deepEqual(result, { opened: "requested", via: process.platform === "darwin" ? "osascript" : "xdg-terminal-exec", command });
    const argv = readFileSync(join(dir, `${LAUNCHER}.argv`), "utf8");
    assert.ok(argv.includes(`env PATH=${dirname(process.execPath)}:`), argv);
    assert.ok(argv.includes(command), argv);
    // Without --dir, the deployment at or above where oats runs; outside every deployment, none.
    const plain = oats(dir, ["tui", "--open", "--json"]);
    assert.equal(JSON.parse(plain.stdout).result.command, `${BIN} tui`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("`oats session attach --open --home H --json` asks for a window running `oats session attach --home H`, a detach key carried; --server is refused", { skip: !["darwin", "linux"].includes(process.platform) }, () => {
  const dir = fakeLaunchers("osascript", "systemd-run", "xdg-terminal-exec");
  try {
    const r = oats(dir, ["session", "attach", "--open", "--home", "/abs/home", "--detach-key", "C-\\", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).result.command, `${BIN} session attach --home /abs/home --detach-key 'C-\\'`);
    const bad = oats(dir, ["session", "attach", "--open", "--home", "/abs/home", "--detach-key", "C-h", "--json"]);
    assert.equal(JSON.parse(bad.stdout).error.code, "E_BAD_ARGS", "the key is checked before a window is asked for");
    const routed = oats(dir, ["session", "attach", "--open", "--server", "far", "--home", "/abs/home", "--json"]);
    assert.equal(JSON.parse(routed.stdout).error.code, "E_BAD_ARGS");
    const homeless = oats(dir, ["session", "attach", "--open", "--json"]);
    assert.equal(JSON.parse(homeless.stdout).error.code, "E_BAD_ARGS");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("with no launcher on PATH, `oats tui --open` fails E_OPEN_UNAVAILABLE and names the command to run by hand", () => {
  const dir = fakeLaunchers();
  try {
    const r = oats(dir, ["tui", "--open", "--dir", "/abs/dep", "--json"]);
    assert.equal(r.status, 1);
    const { error } = JSON.parse(r.stdout);
    assert.equal(error.code, "E_OPEN_UNAVAILABLE");
    assert.equal(error.details.command, `${BIN} tui --dir /abs/dep`);
    const text = oats(dir, ["tui", "--open", "--dir", "/abs/dep"]);
    assert.equal(text.status, 1);
    assert.match(text.stderr, /E_OPEN_UNAVAILABLE/);
    assert.ok(text.stderr.includes(`${BIN} tui --dir /abs/dep`), text.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
