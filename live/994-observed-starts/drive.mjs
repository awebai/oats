// The #994 live runs: start one executable in one pane on a private tmux socket and watch it.
// Driven by run.sh; see README.md. This script SENDS NO KEY, EVER: every tmux call goes through
// tmux() below, which runs one of five subcommands, none of which can put input into a pane.
//
//   node drive.mjs plan <mode> [NAME] [--prepare] [--checkout <path>]
//       checks every refusal, creates the run folder, and (without --prepare) the out dir, whose
//       path is the only line it prints on stdout. Starts nothing.
//   node drive.mjs run <out-dir> <mode> [NAME] [--checkout <path>]
//       checks every refusal again, then makes the run and writes what it saw to the out dir.
//
// It does not drive the kernel: no spawn, no deployment, no `oats` command. It needs the OATS
// checkout only for the kernel's own readings, which it imports and never copies:
//   lib/launch-prompt-completion.mjs  CLAUDE_QUESTION_MARKERS
//   lib/launch-prompt-fixtures.mjs    normalizeScreen, showsClaudeSession, matchFlagIgnoredEntry, claudeVersionOf
//   lib/session-input.mjs             inspectSessionTarget (its other export, which sends input, is never imported)
// Exit status: 0 the run was made; 1 the run failed or its cleanup left something; 2 refused.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, appendFileSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { forbidden, parseExtraEnv } from "./report.mjs";
import { CLEAN_WINDOW_MS, judge } from "./verdict.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE = "awebai/oats#994";
const INTERVAL = 100;
const SESSION = "live994", WINDOW = "pane";
const CHANNEL = "plugin:aweb-channel@awebai-marketplace";
const PROMPT = ["--", "@TASK.md"];
const OPT_OUTS = ["DISABLE_TELEMETRY", "DO_NOT_TRACK", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"];
const CHROME_KEY = "claudeInChromeDefaultEnabled";
// `args` is what follows the executable in the pane; a mode without it starts no pane.
const MODES = {
  probe: { probe: true },
  plain: { args: PROMPT },
  "no-chrome": { args: ["--no-chrome", ...PROMPT] },
  approved: { args: ["--channels", CHANNEL, ...PROMPT] },
  "approved-optout": { args: ["--channels", CHANNEL, ...PROMPT], optOut: true },
  trust: { args: PROMPT },
  old: { probe: true, args: ["--no-chrome", ...PROMPT], executable: "LIVE_994_OLD_CLAUDE" },
  "chrome-offer": { args: PROMPT, chrome: true },
  "chrome-flag": { args: ["--no-chrome", ...PROMPT], chrome: true },
  "chrome-env": { args: PROMPT, chrome: true, env: { CLAUDE_CODE_ENABLE_CFC: "0" } },
  "chrome-yolo": { args: ["--dangerously-skip-permissions", ...PROMPT], chrome: true },
};
const PROBES = [["--no-chrome", "plugin", "list", "--json"], ["plugin", "list", "--json"]];
const SCRIPTS = ["run.sh", "drive.mjs", "verdict.mjs", "report.mjs", "cleanup.sh", "stub-claude.sh", "check-dry-runs.sh", "tmux.conf"];
// The run folder's TASK.md: nine lines that ask for nothing.
const TASK = `# A start that is only watched (${LIVE})

This file is the first prompt of a start that nobody attends.

There is no task here. Do not read, write or run anything.

Answer with the single word "idle", and then wait.

No key is sent to this session, and nobody will answer.
`;
// The pane's command, run directly by tmux as `/bin/sh -c <this> live994-pane <exit file> <executable> <args>`:
// the executable, its exit status into the exit file, then an idle shell. The kernel's own pane
// ends in a shell too, and its evidence reads anything else there as a harness still running.
const PANE_SCRIPT = `out=$1; shift; "$@"; printf '%s\\n' "$?" > "$out"; exec /bin/sh`;
const PANE_FORMAT = "#{window_id}\t#{pane_id}\t#{pane_pid}";
// The transport's own snapshot format (lib/launch-prompt-transport.mjs).
const SNAPSHOT_FORMAT = `${PANE_FORMAT}\t#{pane_width}\t#{pane_height}\t#{window_panes}`;
const TMUX_COMMANDS = new Set(["new-session", "display-message", "capture-pane", "list-panes", "kill-server"]);
// Rows of a notice block begin with this bar (lib/launch-prompt-fixtures.mjs, NOTICE_BAR).
const NOTICE_BAR = "▎";

class Refusal extends Error {}
const refuse = (message) => { throw new Refusal(message); };
const real = (path) => { try { return realpathSync(path); } catch { return null; } };
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const within = (path, dir) => path === dir || path.startsWith(dir + "/");

function onPath(name) {
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (!isAbsolute(dir)) continue;
    const path = join(dir, name);
    try { accessSync(path, constants.X_OK); if (statSync(path).isFile()) return path; } catch { /* next */ }
  }
  return null;
}

function executable(name, { required = true } = {}) {
  const value = process.env[name];
  if (!value) return required ? refuse(`${name} is required: the absolute path of the executable (there is no default from PATH)`) : null;
  if (!isAbsolute(value)) refuse(`${name} must be an absolute path`);
  const path = real(value);
  let ok = false;
  try { accessSync(value, constants.X_OK); ok = !!path && statSync(path).isFile(); } catch { /* not executable */ }
  if (!ok) refuse(`${name} is not an executable file`);
  // tmux reads an argument that ends in a semicolon as the end of its command.
  if (value.endsWith(";")) refuse(`${name} must not end in a semicolon`);
  return { given: value, real: path };
}

function parse(argv) {
  const [mode, ...rest] = argv;
  if (!Object.hasOwn(MODES, mode ?? "")) refuse(`mode must be one of: ${Object.keys(MODES).join(", ")}`);
  let optOut = null;
  if (MODES[mode].optOut) {
    optOut = rest.shift();
    if (!OPT_OUTS.includes(optOut)) refuse(`approved-optout takes one of: ${OPT_OUTS.join(", ")}`);
  }
  const opts = { mode, optOut, prepare: false, checkout: join(HERE, "..", "..") };
  while (rest.length) {
    const arg = rest.shift();
    if (arg === "--prepare") opts.prepare = true;
    else if (arg === "--checkout") opts.checkout = rest.shift() ?? refuse("--checkout takes the path of an OATS checkout");
    else refuse(`unknown option ${arg}`);
  }
  return opts;
}

/** The scratch base: an existing directory outside every home, in no instance home, whose path
 *  holds none of the strings the sanitation check forbids, and short enough for a socket path. */
function scratchBase() {
  const given = process.env.LIVE_994_BASE;
  if (!given) refuse("LIVE_994_BASE is required: an existing scratch directory outside the home directory");
  if (!isAbsolute(given)) refuse("LIVE_994_BASE must be an absolute path");
  const base = real(given);
  let dir = false;
  try { dir = !!base && statSync(base).isDirectory(); } catch { /* missing */ }
  if (!dir) refuse("LIVE_994_BASE must be an existing directory (create it first; this script creates only what is inside it)");
  if (base === "/") refuse("LIVE_994_BASE must not be the root directory");
  // Nobody else may plant anything inside it.
  const owner = statSync(base);
  if (owner.uid !== process.getuid() || (owner.mode & 0o022)) refuse("LIVE_994_BASE must be a directory of your own that no other user can write (chmod go-w)");
  // tmux expands `#` sequences in a pane's start directory.
  if (base.includes("#")) refuse("LIVE_994_BASE must not hold a # character");
  for (const row of forbidden()) {
    if (row.class === "home" || row.class === "extra-env-home") {
      if (within(base, row.value) || within(row.value, base)) refuse(`LIVE_994_BASE must be outside the home directory (${row.class}): frames name the run folder, and no frame may hold that path`);
    } else if (base.includes(row.value)) refuse(`LIVE_994_BASE holds a string the sanitation check forbids (${row.class}): every frame would fail it`);
  }
  for (let at = base; ; at = dirname(at)) {
    if (existsSync(join(at, "instance.json"))) refuse("LIVE_994_BASE is inside an OATS instance home: run from a neutral directory");
    if (dirname(at) === at) break;
  }
  // <base>/tmux/<UTC stamp>-<pid>: a socket path has a limit near 104 bytes.
  if (Buffer.byteLength(base) > 70) refuse("LIVE_994_BASE is too long for a private tmux socket inside it: use a path of at most 70 bytes");
  return base;
}

/** A directory this script writes into: `name` directly under `parent` (already resolved), created
 *  if it is missing and never followed if it is a link. Everything written lands inside the base. */
function ownDirectory(parent, name) {
  const path = join(parent, name);
  try { mkdirSync(path, { mode: 0o700 }); } catch (e) { if (e?.code !== "EEXIST") throw e; }
  const entry = lstatSync(path);
  if (!entry.isDirectory() || entry.uid !== process.getuid() || (entry.mode & 0o022) || real(path) !== path) {
    refuse(`${path} must be a directory of this run's own: not a link, and one that no other user can write`);
  }
  return path;
}

function runFolder(base, mode) {
  const folder = ownDirectory(ownDirectory(base, `run-${mode}`), "home");
  const task = join(folder, "TASK.md");
  try { writeFileSync(task, TASK, { flag: "wx", mode: 0o600 }); }
  catch (e) {
    if (e?.code !== "EEXIST") throw e;
    // The one already there must be this text, in a plain file: a link is never followed.
    let same = false;
    try { const fd = openSync(task, constants.O_RDONLY | constants.O_NOFOLLOW); try { same = lstatSync(task).isFile() && readFileSync(fd, "utf8") === TASK; } finally { closeSync(fd); } } catch { /* a link, or unreadable */ }
    if (!same) refuse(`the run folder holds another TASK.md: ${task}`);
  }
  return folder;
}

/** Every refusal, before anything is started. `prepare` needs only the mode and the base. */
function preflight(opts) {
  const mode = MODES[opts.mode];
  if (!["darwin", "linux"].includes(process.platform)) refuse(`unsupported platform ${process.platform}`);
  if (Number(process.versions.node.split(".")[0]) < 20) refuse("Node 20 or later is required");
  let extra;
  try { extra = parseExtraEnv(process.env.LIVE_994_EXTRA_ENV); } catch (e) { refuse(e.message); }
  const extraHome = extra.filter(([name]) => name === "HOME").map(([, value]) => value).pop() ?? null;
  if (extraHome !== null) {
    if (!mode.chrome) refuse("LIVE_994_EXTRA_ENV may carry HOME only in the chrome-* modes");
    let dir = false;
    try { dir = isAbsolute(extraHome) && statSync(extraHome).isDirectory(); } catch { /* missing */ }
    if (!dir) refuse("the HOME in LIVE_994_EXTRA_ENV must be an existing directory, as an absolute path");
  }
  const base = scratchBase();
  if (opts.prepare) return { ...opts, base };

  const checkout = real(opts.checkout);
  const needs = ["lib/launch-prompt-completion.mjs", "lib/launch-prompt-fixtures.mjs", "lib/session-input.mjs"];
  if (!checkout || needs.some((file) => !existsSync(join(checkout, file)))) refuse("--checkout is not an OATS checkout with the launch-prompt modules");
  const gitPath = onPath("git") ?? refuse("git is not on PATH");
  const git = (...args) => spawnSync(gitPath, ["-C", checkout, ...args], { encoding: "utf8", env: { PATH: process.env.PATH } });
  const head = git("rev-parse", "HEAD");
  if (head.status !== 0) refuse("--checkout is not a git checkout");
  if (git("status", "--porcelain", "--untracked-files=no", "--", "lib").stdout.trim()) refuse("the checkout has uncommitted changes under lib/: the recorded head must be the code that is imported");

  const dryRun = process.env.LIVE_994_DRY_RUN === "yes";
  if (process.env.LIVE_994_DRY_RUN && !dryRun) refuse("LIVE_994_DRY_RUN is `yes` or unset");
  const variable = mode.executable ?? "LIVE_994_EXECUTABLE";
  const exe = executable(variable);
  const stub = real(join(HERE, "stub-claude.sh"));
  const isStub = exe.real === stub;
  if (isStub && !dryRun) refuse(`${variable} is this directory's stub: that is a dry run, which shows nothing about Claude. Set LIVE_994_DRY_RUN=yes for one`);
  if (dryRun && !isStub) refuse(`LIVE_994_DRY_RUN=yes runs only this directory's stub-claude.sh: ${variable} is another executable`);
  if (process.env.LIVE_994_STUB_SCENARIO && !dryRun) refuse("LIVE_994_STUB_SCENARIO is for a dry run only");
  const binary = executable("LIVE_994_CLAUDE_BINARY", { required: false });

  const configDir = process.env.LIVE_994_CONFIG_DIR || null;
  if (configDir) {
    let dir = false;
    try { dir = isAbsolute(configDir) && statSync(configDir).isDirectory(); } catch { /* missing */ }
    if (!dir) refuse("LIVE_994_CONFIG_DIR must be an existing directory, as an absolute path");
    // Nothing this script writes may land in the configuration: not the base around it, and
    // none of the places inside the base this script writes to.
    const config = real(configDir);
    const inside = within(config, base) && config !== base ? config.slice(base.length + 1).split("/")[0] : null;
    if (within(base, config) || (inside !== null && /^(run-|out-|tmux$)/.test(inside))) refuse("LIVE_994_CONFIG_DIR overlaps where this script writes (the base, or its run-*, out-* and tmux directories)");
  } else if (!dryRun && !(mode.chrome && extraHome)) {
    refuse(mode.chrome
      ? "a chrome-* mode needs LIVE_994_CONFIG_DIR, or HOME in LIVE_994_EXTRA_ENV for the operator's own configuration"
      : "LIVE_994_CONFIG_DIR is required: the Claude configuration directory prepared for this run");
  }

  const secondsText = process.env.LIVE_994_SECONDS || "20";
  if (!/^\d{1,3}$/.test(secondsText)) refuse("LIVE_994_SECONDS must be a whole number of seconds");
  const seconds = Number(secondsText);
  if (seconds * 1000 < CLEAN_WINDOW_MS) refuse(`LIVE_994_SECONDS is shorter than the clean window (${CLEAN_WINDOW_MS} ms)`);
  if (seconds > 600) refuse("LIVE_994_SECONDS is at most 600");
  const size = /^(\d{2,3})x(\d{1,3})$/.exec(process.env.LIVE_994_PANE || "110x35");
  if (!size || Number(size[1]) < 20 || Number(size[1]) > 500 || Number(size[2]) < 5 || Number(size[2]) > 200) refuse("LIVE_994_PANE must be WxH, from 20x5 to 500x200");

  const modeEnv = { ...(mode.env ?? {}), ...(opts.optOut ? { [opts.optOut]: "1" } : {}) };
  for (const [name] of extra) {
    if (/^(LIVE_994_|TMUX)/.test(name) || name === "CLAUDE_CONFIG_DIR") refuse(`LIVE_994_EXTRA_ENV may not set ${name}`);
    if (Object.hasOwn(modeEnv, name)) refuse(`LIVE_994_EXTRA_ENV may not set ${name}: this mode sets it`);
    if (opts.optOut && OPT_OUTS.includes(name)) refuse(`LIVE_994_EXTRA_ENV may not set ${name}: approved-optout sets one opt-out variable, the one it is given`);
  }

  const tmuxPath = onPath("tmux") ?? refuse("tmux is not on PATH");
  let tmuxVersion;
  try { tmuxVersion = execFileSync(tmuxPath, ["-V"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], env: { PATH: process.env.PATH } }).trim(); }
  catch { refuse("tmux -V failed"); }

  return { ...opts, base, checkout, oatsHead: head.stdout.trim(), dryRun, variable, executable: exe.given, isStub,
    versionFrom: binary ? "LIVE_994_CLAUDE_BINARY" : variable, versionPath: binary ? binary.given : exe.given,
    configDir, extra, extraHome, seconds, width: Number(size[1]), height: Number(size[2]), modeEnv, tmuxPath, tmuxVersion,
    args: mode.args ?? null, probe: !!mode.probe, chrome: !!mode.chrome };
}

/** The one key this script reads from a Claude configuration, as absent, true, false or other. */
function chromeSetting(cfg) {
  const dir = cfg.configDir ?? cfg.extraHome;
  if (!dir) return "not-read";
  let value;
  try {
    const parsed = JSON.parse(readFileSync(join(dir, ".claude.json"), "utf8"));
    if (!parsed || typeof parsed !== "object" || !Object.hasOwn(parsed, CHROME_KEY)) return "absent";
    value = parsed[CHROME_KEY];
  } catch (e) { return e?.code === "ENOENT" ? "absent" : "unreadable"; }
  return value === true ? "true" : value === false ? "false" : "other";
}

function noticeBlockCount(text) {
  let blocks = 0, inside = false;
  for (const row of text.split("\n")) {
    const bar = row.startsWith(NOTICE_BAR);
    if (bar && !inside) blocks += 1;
    inside = bar;
  }
  return blocks;
}

class CaptureError extends Error {}

async function run(out, cfg) {
  const save = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + "\n");
  process.stdout.on("error", () => { /* a closed terminal must not stop the cleanup */ });
  const log = (line) => { appendFileSync(join(out, "run.log"), line + "\n"); console.log(line); };

  const load = (file) => import(pathToFileURL(join(cfg.checkout, file)).href);
  const { CLAUDE_QUESTION_MARKERS } = await load("lib/launch-prompt-completion.mjs");
  const { normalizeScreen, showsClaudeSession, matchFlagIgnoredEntry, claudeVersionOf } = await load("lib/launch-prompt-fixtures.mjs");
  const { inspectSessionTarget } = await load("lib/session-input.mjs");

  const folder = runFolder(cfg.base, cfg.mode);
  const socketDir = ownDirectory(cfg.base, "tmux");
  const socket = join(socketDir, `${out.slice(-16)}-${process.pid}`);
  const exitFile = join(out, `exit-${cfg.mode}`);
  const state = { live: LIVE, mode: cfg.mode, out, socket, session: SESSION, panePid: null };
  save("state.json", state);

  // The pane's whole environment, and the probe's: nothing of the caller's but PATH, the throwaway
  // HOME of the out dir, a terminal type and a locale. LIVE_994_EXTRA_ENV comes last.
  const paneEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME, TERM: process.env.TERM, LANG: process.env.LANG,
    ...(cfg.configDir ? { CLAUDE_CONFIG_DIR: cfg.configDir } : {}),
    ...(cfg.dryRun ? { LIVE_994_STUB_SCENARIO: process.env.LIVE_994_STUB_SCENARIO || "session", LIVE_994_STUB_LOG: join(out, "stub-calls.log"),
      LIVE_994_STUB_FIXTURE: join(cfg.checkout, "test", "fixtures", "launch-prompts", "frame-01.txt") } : {}),
    ...cfg.modeEnv, ...Object.fromEntries(cfg.extra),
  };
  const host = {
    live: LIVE, mode: cfg.mode, ...(cfg.optOut ? { optOut: cfg.optOut } : {}),
    platform: `${process.platform}-${process.arch}`,
    ...claudeVersionOf(cfg.versionPath), claudeVersionReadFrom: cfg.versionFrom,
    executableVariable: cfg.variable, stub: cfg.isStub, dryRun: cfg.dryRun,
    configuration: cfg.configDir ? "LIVE_994_CONFIG_DIR" : cfg.extraHome ? "the HOME of LIVE_994_EXTRA_ENV" : "none",
    pane: { requested: `${cfg.width}x${cfg.height}`, width: null, height: null },
    paneArguments: cfg.args, paneEnvironmentNames: Object.keys(paneEnv).sort(), modeEnvironment: cfg.modeEnv,
    extraEnvNames: cfg.extra.map(([name]) => name),
    seconds: cfg.seconds, intervalMs: INTERVAL, cleanWindowMs: CLEAN_WINDOW_MS,
    tmuxVersion: cfg.tmuxVersion, nodeVersion: process.version, oatsHead: cfg.oatsHead,
    scripts: Object.fromEntries(SCRIPTS.map((file) => [file, sha256(readFileSync(join(HERE, file)))])),
    startedAt: new Date().toISOString(),
  };
  save("host.json", host);
  log(`mode ${cfg.mode}${cfg.optOut ? ` ${cfg.optOut}` : ""}; executable from ${cfg.variable}${cfg.isStub ? " (DRY-RUN STUB)" : ""}; Claude ${host.claudeVersion} (${host.claudeVersionSource})`);
  log(`run folder: ${folder}`);
  log(`out dir: ${out}`);

  /** Every tmux call of this script: this socket, and one of five subcommands. */
  const tmux = (args, { env = { PATH: process.env.PATH }, timeout = 2000, config = false } = {}) => {
    args.forEach((arg, i) => { if ((i === 0 || args[i - 1] === ";") && !TMUX_COMMANDS.has(arg)) throw new Error(`this script does not run tmux ${arg}`); });
    return execFileSync(cfg.tmuxPath, ["-u", ...(config ? ["-f", join(HERE, "tmux.conf")] : []), "-S", socket, ...args],
      { encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env });
  };

  const chrome = cfg.chrome ? { key: CHROME_KEY, before: chromeSetting(cfg), after: null } : null;
  let failure = null;

  let probes = null;
  if (cfg.probe) {
    probes = PROBES.map((argv) => {
      const r = spawnSync(cfg.executable, argv, { cwd: folder, env: paneEnv, encoding: "utf8", timeout: 60000, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      let stdoutIsJsonArray = false;
      try { stdoutIsJsonArray = Array.isArray(JSON.parse(r.stdout)); } catch { /* not JSON */ }
      const line = String(r.stderr || "").split("\n").find((l) => l.trim()) ?? null;
      const row = { argv, exitStatus: r.status, signal: r.signal, timedOut: r.error?.code === "ETIMEDOUT",
        failedToStart: r.error && r.error.code !== "ETIMEDOUT" ? String(r.error.code) : null, stdoutIsJsonArray, stderrFirstLine: line === null ? null : line.slice(0, 240) };
      log(`probe \`${argv.join(" ")}\`: exit ${row.exitStatus}, JSON array ${stdoutIsJsonArray}`);
      return row;
    });
    save("probe.json", probes);
  }

  let timeline = null, cleanup = null;
  if (cfg.args) {
    let stop = null;
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => { stop ??= signal; });
    const rows = [];
    let target = null, createTookMs = null;
    try {
      const before = performance.now();
      let created;
      try {
        created = tmux(["new-session", "-d", "-s", SESSION, "-n", WINDOW, "-x", String(cfg.width), "-y", String(cfg.height), "-c", folder,
          "-P", "-F", PANE_FORMAT, "/bin/sh", "-c", PANE_SCRIPT, "live994-pane", exitFile, cfg.executable, ...cfg.args], { env: paneEnv, timeout: 10000, config: true });
      } catch { failure = "the pane could not be created"; }
      const t0 = performance.now();
      if (!failure) {
        createTookMs = Math.round(t0 - before);
        const fields = created.trim().split("\t");
        if (fields.length !== 3 || !/^@\d+$/.test(fields[0]) || !/^%\d+$/.test(fields[1]) || !/^[1-9]\d*$/.test(fields[2])) failure = "the pane could not be created";
        else target = { windowId: fields[0], paneId: fields[1], pid: fields[2] };
      }
      if (target) {
        state.panePid = Number(target.pid);
        save("state.json", state);
        mkdirSync(join(out, "frames", cfg.mode), { recursive: true });
        log(`pane ${target.paneId} created in ${createTookMs} ms; watching for ${cfg.seconds} s, a capture every ${INTERVAL} ms`);

        // The transport's snapshot, command for command: geometry, the visible pane, geometry again.
        const snapshot = () => {
          let text;
          try {
            text = tmux(["display-message", "-p", "-t", target.paneId, SNAPSHOT_FORMAT, ";", "capture-pane", "-p", "-t", target.paneId, ";",
              "display-message", "-p", "-t", target.paneId, SNAPSHOT_FORMAT]);
          } catch (e) { throw new CaptureError(e?.code === "ETIMEDOUT" ? "tmux-timed-out" : "tmux-failed"); }
          const lines = text.split("\n");
          if (lines.at(-1) === "") lines.pop();
          const first = lines.shift(), last = lines.pop();
          if (first !== last) throw new CaptureError("identity-or-geometry-changed-during-capture");
          const fields = first?.split("\t") || [];
          if (fields.length !== 6 || fields[5] !== "1" || !/^[1-9]\d*$/.test(fields[3]) || !/^[1-9]\d*$/.test(fields[4])) throw new CaptureError("pane-not-exclusively-owned");
          if (fields[0] !== target.windowId || fields[1] !== target.paneId || fields[2] !== target.pid) throw new CaptureError("pane-replaced");
          if (lines.length !== Number(fields[4])) throw new CaptureError("incomplete-visible-capture");
          return { width: Number(fields[3]), height: Number(fields[4]), text: lines.join("\n") + "\n" };
        };

        // What the pane runs, by the kernel's own evidence: inspectSessionTarget reads tmux's
        // `list-panes` and, when the pane's command is a shell, `ps`. Both calls pass through here,
        // so the row records exactly what the kernel's function was given.
        const paneProcess = () => {
          let listed = null, sample = null;
          const ps = () => (sample ??= execFileSync("ps", ["-axo", "pid=,ppid=,comm="], { encoding: "utf8", timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], env: { PATH: process.env.PATH } }));
          const exec = (command, args) => {
            if (command === "ps" && args.join(" ") === "-axo pid=,ppid=,comm=") return ps();
            if (command === "tmux" && args[0] === "-u" && args[1] === "-S" && args[2] === socket && args[3] === "list-panes") return (listed = tmux(args.slice(3)));
            throw new Error(`this script does not run ${command} ${args.join(" ")}`);
          };
          let observed = null, descendants = null;
          try { observed = inspectSessionTarget({ socket, session: SESSION, window: WINDOW }, { exec }); } catch { /* unreadable at this capture */ }
          const [, , command, pid] = (listed ?? "").trim().split("\t");
          try {
            if (/^\d+$/.test(pid ?? "")) {
              const table = ps().split("\n").map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+/)).filter(Boolean);
              const under = new Set([pid]);
              for (let grew = true; grew;) { grew = false; for (const [, child, parent] of table) if (under.has(parent) && !under.has(child)) { under.add(child); grew = true; } }
              descendants = under.size - 1;
            }
          } catch { /* ps failed at this capture */ }
          return { panePid: /^\d+$/.test(pid ?? "") ? Number(pid) : null, paneCommand: command ?? null, paneState: observed?.state ?? null, descendants,
            // harnessRunning of lib/core.mjs (not exported): present, and neither a fallback shell nor a dead pane.
            harnessRunning: observed ? observed.present === true && observed.state !== "shell" && observed.state !== "stopped" : null };
        };

        let lastText = null, lastSize = null, failedInARow = 0;
        for (let next = t0; !stop && !failure;) {
          const wait = next - performance.now();
          if (wait > 0) await sleep(wait);
          const ms = Math.round(performance.now() - t0);
          if (ms > cfg.seconds * 1000 || stop) break;
          let screen = null, error = null;
          try { screen = snapshot(); } catch (e) { if (!(e instanceof CaptureError)) throw e; error = e.message; }
          const exited = existsSync(exitFile);
          let row;
          if (screen) {
            failedInARow = 0;
            const changed = screen.text !== lastText;
            row = { ms, width: screen.width, height: screen.height, blank: normalizeScreen(screen.text) === "", digest: sha256(screen.text), changed,
              markers: CLAUDE_QUESTION_MARKERS.filter((marker) => screen.text.includes(marker)), sessionBanner: showsClaudeSession(screen.text),
              noticeBlocks: noticeBlockCount(screen.text), flagIgnoredEntry: matchFlagIgnoredEntry(screen.text)?.id ?? null };
            if (lastSize && (lastSize.width !== screen.width || lastSize.height !== screen.height)) row.geometryChanged = true;
            if (changed) {
              row.frame = `frames/${cfg.mode}/t+${String(ms).padStart(6, "0")}.txt`;
              writeFileSync(join(out, row.frame), screen.text);
            }
            lastText = screen.text;
            lastSize = { width: screen.width, height: screen.height };
            host.pane.width ??= screen.width;
            host.pane.height ??= screen.height;
          } else {
            row = { ms, failed: true, error };
            if (++failedInARow >= 3) failure = "three consecutive captures failed";
          }
          rows.push({ ...row, exitFile: exited, ...paneProcess() });
          next = t0 + (Math.floor((performance.now() - t0) / INTERVAL) + 1) * INTERVAL;
        }
      }
    } finally {
      // The cleanup runs whatever happened above, a failed write of the evidence included: kill
      // this run's private tmux server. Nothing else is killed and nothing is removed.
      try {
        let exitStatus = null;
        try { exitStatus = Number(readFileSync(exitFile, "utf8").trim()); } catch { /* the executable had not exited */ }
        timeline = { live: LIVE, mode: cfg.mode, ...(cfg.optOut ? { optOut: cfg.optOut } : {}), intervalMs: INTERVAL, seconds: cfg.seconds,
          createTookMs, pane: target ? { ...target, pid: Number(target.pid) } : null, exitStatus: Number.isInteger(exitStatus) ? exitStatus : null,
          failure, interrupted: stop, rows };
        save("timeline.json", timeline);
      } finally {
        try { tmux(["kill-server"], { timeout: 5000 }); } catch { /* no server: never started, or already gone */ }
        const serverGone = () => { try { tmux(["list-panes", "-a", "-F", "#{pane_id}"]); return false; } catch (e) { return e?.code !== "ETIMEDOUT"; } };
        // Signal 0 sends nothing: it asks whether any process of the pane's group is left.
        const groupGone = () => { if (!target) return true; try { process.kill(-Number(target.pid), 0); return false; } catch (e) { return e?.code === "ESRCH"; } };
        for (let waited = 0; waited < 3000 && !(serverGone() && groupGone()); waited += 100) await sleep(100);
        cleanup = { serverGone: serverGone(), paneProcessGroupGone: groupGone() };
        // Said on the terminal first, so it is reported even when nothing can be written.
        console.log(`cleanup: tmux server gone ${cleanup.serverGone}, pane process group gone ${cleanup.paneProcessGroupGone}`);
        save("cleanup.json", cleanup);
      }
    }
  }

  if (chrome) { chrome.after = chromeSetting(cfg); save("chrome-setting.json", chrome); }
  save("host.json", host);
  const verdict = { ...(timeline ? judge(timeline) : { live: LIVE, mode: cfg.mode, pane: false }),
    ...(probes ? { probe: probes.map(({ stderrFirstLine, ...row }) => ({ ...row, stderr: stderrFirstLine !== null })) } : {}) };
  save("verdict.json", verdict);
  if (timeline) log(`outcome: ${verdict.outcome}${failure ? `; RUN FAILED: ${failure}` : ""}`);
  const unclean = cleanup && !(cleanup.serverGone && cleanup.paneProcessGroupGone);
  return failure || timeline?.interrupted || unclean ? 1 : 0;
}

const [command, ...argv] = process.argv.slice(2);
try {
  if (command === "plan") {
    const cfg = preflight(parse(argv));
    const folder = runFolder(cfg.base, cfg.mode);
    console.error(`run folder (trust exactly this path in the seed, or leave it untrusted for \`trust\`): ${folder}`);
    if (!cfg.prepare) {
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      const out = join(cfg.base, `out-${cfg.mode}${cfg.optOut ? `-${cfg.optOut}` : ""}-${stamp}`);
      try { mkdirSync(out, { mode: 0o700 }); } catch { refuse("the out dir of this second already exists: run again"); }
      mkdirSync(join(out, "throwaway-home"), { mode: 0o700 });
      console.log(out);
    }
  } else if (command === "run") {
    const out = argv.shift();
    const cfg = preflight(parse(argv));
    if (cfg.prepare) refuse("--prepare starts nothing");
    const own = (path) => { try { const entry = lstatSync(path); return entry.isDirectory() && entry.uid === process.getuid() && real(path) === path; } catch { return false; } };
    if (!out || dirname(out) !== cfg.base || !own(out) || process.env.HOME !== join(out, "throwaway-home") || !own(process.env.HOME)) refuse("run takes the out dir that plan created, with its throwaway HOME");
    process.exitCode = await run(out, cfg);
  } else refuse("usage: node drive.mjs plan|run ... (run.sh calls this)");
} catch (e) {
  if (!(e instanceof Refusal)) throw e;
  console.error(`refused: ${e.message}`);
  process.exitCode = 2;
}
