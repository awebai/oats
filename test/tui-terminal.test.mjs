// `oats tui` (preview) end to end: the real CLI on a real terminal, reading a fixture deployment
// with the checkout's own kernel.
//
// Real tmux, never the operator's (docs/implementation.md; the conventions of
// test/session-attach-detach-key.test.mjs): the fixture owns a private TMUX_TMPDIR, and the one
// server here is a socket inside the fixture. A terminal is a session of that server whose pane
// runs an interactive shell; the command is typed at it, keys are sent as a terminal sends them,
// the screen is what `capture-pane` prints, and the shell records the exit status. A signal goes
// only to a pid the command's own wrapper wrote down. Every wait is on what a pane shows or on a
// file, and the file has a budget: once it is spent every further wait fails at once, so a
// program that hangs cannot hold a shard.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertNoFixtureProcesses, fixtureBase, fixtureEnv, isolateSessionEnvironment, systemExecutable, waitUntil } from "./helpers/host-fixture.mjs";
import { comparableStty } from "./helpers/stty-line.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const CLI = resolve(new URL("../bin/oats.mjs", import.meta.url).pathname);
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const hostTool = (name) => { try { return systemExecutable(name); } catch { return null; } };

// The host's own tools, found before the environment is isolated (PATH is then the fixture's).
const REAL_TMUX = hostTool("tmux");
/** Outside CI a host without tmux skips the terminal tests; in CI test/tmux-in-ci.test.mjs fails. */
const NO_TMUX = REAL_TMUX ? false : "tmux is not on PATH: these tests drive `oats tui` in a real tmux (test/tmux-in-ci.test.mjs fails for this in CI)";
const STTY = REAL_TMUX ? systemExecutable("stty") : null; // not one of the fixture's tools: called by its path
const base = fixtureBase("oats-tui-"); // short: a socket path lives in it
const restoreEnvironment = REAL_TMUX ? isolateSessionEnvironment(base) : () => {};
const TERM = join(base, "term.sock");

/** Every test starts the real CLI, which reads the fixture with the real kernel before it draws:
 *  on a host twice oversubscribed (a load of 30 on 16 cores) the file took a minute and a half.
 *  A program that never draws would cost a ten-second wait in every test. */
const BUDGET_MS = 180000;
const FILE_DEADLINE = Date.now() + BUDGET_MS;

const tmuxRaw = (...args) => execFileSync("tmux", ["-u", "-S", TERM, ...args], { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
const tmuxOn = (...args) => tmuxRaw(...args).trim();
const lines = (text) => text.split("\n").filter(Boolean);
/** Everything on the private server: its sessions, windows and panes. The TUI makes none. */
const everything = () => lines(tmuxOn("list-panes", "-a", "-F", "#{session_name} #{window_id} #{pane_id}")).sort();
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };

if (REAL_TMUX) {
  // One session that only keeps the server: every test makes, and removes, its own.
  tmuxOn("new-session", "-d", "-s", "hold", "-n", "hold", "-x", "80", "-y", "24", "-c", base, "cat");
  tmuxOn("set-option", "-g", "default-terminal", "screen");
}

// ---- a deployment to look at ---------------------------------------------------------------------
/** The variables an OATS instance session carries (packages/client/kernel-environment.mjs): the
 *  TUI removes them from its own environment before it starts a child (docs/tui.md). */
const INSTANCE_VARIABLES = ["PI_AGENTS_ROOT", "PI_AGENT_HOME", "PI_AGENT_INSTANCE", "OATS_HOME", "OATS_INSTANCE_HOME", "OATS_INSTANCE", "OATS_DEPLOYMENT", "OATS_RESOLUTION"];
const withPath = async (path, fn) => { const saved = process.env.PATH; process.env.PATH = path; try { return await fn(); } finally { process.env.PATH = saved; } };

/** A fixture deployment (test/helpers/v2-deployment.mjs) with three instances that never ran:
 *  `alpha` and its child `beta` of the soul `dev`, and `gamma` of the soul `reviewer`, alone.
 *  `enter` is a script that sets the fixture's environment and then becomes its arguments: a
 *  terminal's shell is started through it, so the TUI typed there reads this deployment with the
 *  fixture's home, cache and tools, as `fx.cli` does.
 *
 *  A home that never ran has no recorded tmux socket, and for such a home the shared liveness
 *  collector asks the default tmux server, which no test may reach. So the first `tmux` on that
 *  PATH is `front/tmux`: it asks the fixture's own `oats` server instead, which nothing started,
 *  and real tmux answers that no server runs: every row is `stopped`. It writes down the
 *  environment it was started with. While the file `hold` exists it does not answer: it starts a
 *  `sleep` of half a minute, writes that pid to `held` and waits for it: a read that stays in
 *  flight. The sleep is in the collector's process group and outlives the four seconds the
 *  collector gives its tmux, so when it is gone long before its time, the TUI ended the group. */
async function deployment(t) {
  const fx = v2Deployment({ souls: { dev: {}, reviewer: {} }, t });
  const world = { fx, dep: fx.dep, enter: join(fx.base, "enter.sh"), holdFile: join(fx.base, "hold"), heldFile: join(fx.base, "held"), seenFile: join(fx.base, "collector-tmux.env") };
  world.spawn = (soul, options) => withPath(fx.env.PATH, () => fx.spawn(soul, { harness: "claude", ...options }));
  world.home = (await world.spawn("dev", { name: "alpha" })).home;
  await world.spawn("dev", { name: "beta", relativeTo: "alpha", relation: "child" });
  await world.spawn("reviewer", { name: "gamma" });
  const front = world.front = join(fx.base, "front");
  mkdirSync(front);
  writeFileSync(join(front, "tmux"), `#!/bin/sh
env > ${shq(world.seenFile)}
if [ -e ${shq(world.holdFile)} ]; then sleep 30 < /dev/null > /dev/null 2>&1 & echo $! >> ${shq(world.heldFile)}; wait; exit 1; fi
exec ${shq(join(base, "system-bin", "tmux"))} -L oats "$@"
`, { mode: 0o755 });
  const env = world.env = { ...fx.env, PATH: `${front}:${fx.env.PATH}` };
  writeFileSync(world.enter, `#!/bin/sh\n${Object.entries(env).map(([name, value]) => `export ${name}=${shq(value)}`).join("\n")}\nexec "$@"\n`);
  /** The pids of the sleeps that held a read, in the order they started. */
  world.held = () => (existsSync(world.heldFile) ? lines(readFileSync(world.heldFile, "utf8")).map(Number) : []);
  world.release = () => rmSync(world.holdFile, { force: true });
  return world;
}
/** The deployment most tests look at; a test that changes one makes its own. */
const WORLD = REAL_TMUX ? await deployment() : null;

/** A world of its own with one machine registered, `garnet`, which is never reached: the other
 *  worlds keep a registry with no machine, so no TUI of theirs reads another machine.
 *  The kernel keeps registered machines in `$OATS_HOME_DIR/servers.json` and reaches one by
 *  running `ssh` as found on PATH (lib/servers.mjs). So the registry is the fixture's own, and
 *  the first `ssh` on the fixture's PATH is `front/ssh`, which connects nowhere: it writes its pid
 *  to `sshCallsFile` each time it is started, prints one line on stderr and exits 255, which the
 *  kernel's roster answers as a machine that was not reached. While the file `sshHoldFile` exists
 *  it does not exit: it starts a `sleep` of half a minute, writes that pid to `sshHeldFile` and
 *  waits for it, as `front/tmux` does: a roster read that stays in flight. The sleep is in the
 *  process group of the kernel that reads the roster and outlives the twenty seconds that kernel
 *  gives a machine, so when it is gone long before its time, the TUI ended that group.
 *  The machine is registered with the real kernel, `oats server add`, which writes the
 *  registration and then asks the host once through `ssh` for its workspace key: it is run only
 *  after the two checks below, so it can neither write under the user's `~/.oats` nor start the
 *  real `ssh`. */
async function machineWorld(t) {
  const world = await deployment(t);
  const { fx } = world;
  Object.assign(world, { sshHoldFile: join(fx.base, "ssh-hold"), sshHeldFile: join(fx.base, "ssh-held"), sshCallsFile: join(fx.base, "ssh-calls") });
  const ssh = join(world.front, "ssh");
  writeFileSync(ssh, `#!/bin/sh
echo $$ >> ${shq(world.sshCallsFile)}
if [ -e ${shq(world.sshHoldFile)} ]; then sleep 30 < /dev/null > /dev/null 2>&1 & echo $! >> ${shq(world.sshHeldFile)}; wait; exit 255; fi
echo 'ssh: the fake ssh of a test connects nowhere' >&2
exit 255
`, { mode: 0o755 });
  const numbers = (file) => (existsSync(file) ? lines(readFileSync(file, "utf8")).map(Number) : []);
  /** The pids of the sleeps that held a roster read, in the order they started. */
  world.sshHeld = () => numbers(world.sshHeldFile);
  /** How often the fake `ssh` was started. */
  world.sshCalls = () => numbers(world.sshCallsFile).length;
  world.holdSsh = () => writeFileSync(world.sshHoldFile, "");
  const releaseTmux = world.release;
  world.release = () => { releaseTmux(); rmSync(world.sshHoldFile, { force: true }); };

  try {
    const registry = join(fx.base, "oats-home");
    assert.equal(world.env.OATS_HOME_DIR, registry, "the registry `oats server add` writes is the fixture's own");
    const found = spawnSync(join(base, "system-bin", "sh"), ["-c", "command -v ssh"], { env: world.env, encoding: "utf8", timeout: 10000 });
    assert.equal(found.stdout, `${ssh}\n`, `the first ssh on the fixture's PATH is the fake (${world.env.PATH})`);
    const added = fx.cli(["server", "add", "garnet", "--ssh", "garnet-host", "--workspace", "/srv/acme-platform"], { env: world.env });
    assert.equal(added.status, 0, `oats server add in the fixture: ${added.stderr}`);
    assert.ok(existsSync(join(registry, "servers.json")), "the registration is in the fixture's registry");
    assert.equal(world.sshCalls(), 1, "oats server add asked the host once, through the fake ssh");
  } catch (error) {
    if (!t) fx.cleanup(); // with a test, the fixture's own clean-up is registered
    throw error;
  }
  return world;
}
/** The world with the machine, for the tests that read a roster and change nothing. */
const MACHINES = REAL_TMUX ? await machineWorld() : null;

/** The process group a process is in: /proc's field where there is a /proc, else what `ps` says
 *  (macOS has no /proc). Null unless that is a number. As `groupOf` in
 *  packages/tui/test/read.test.mjs, which reads the same field with a helper of its own. */
function groupOf(pid) {
  try {
    const stat = existsSync("/proc/self/stat") ? readFileSync(`/proc/${pid}/stat`, "utf8") : null;
    const text = stat !== null ? stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2] : execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8", timeout: 10000 }).trim();
    return /^[0-9]+$/.test(text ?? "") ? Number(text) : null;
  } catch { return null; }
}

test.after(() => {
  if (REAL_TMUX) { try { execFileSync(REAL_TMUX, ["-S", TERM, "kill-server"], { stdio: "ignore", timeout: 10000 }); } catch { /* not running */ } }
  const errors = [];
  // Every TUI of this file ran in `base`, and so did its children: none is left (the SIGKILL case
  // leaves a collector that ends by itself, within the check's own wait).
  if (REAL_TMUX) { try { assertNoFixtureProcesses(base, { settleMs: 6000 }); } catch (error) { errors.push(error); } }
  try { WORLD?.fx.cleanup(); } catch (error) { errors.push(error); }
  try { MACHINES?.fx.cleanup(); } catch (error) { errors.push(error); }
  restoreEnvironment();
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (errors.length) throw errors[0];
});

// ---- what the program says, as the spec gives it ------------------------------------------------
const TUI = `${shq(process.execPath)} ${shq(CLI)} tui`;
const PROMPT = "tui-test$";
const USAGE = "oats tui [--dir <path>] [--ascii]";
/** The leader, which the footer names first in every focus (docs/tui.md, "The footer"). */
const LEAD = "C-\\ commands   ";
/** The Instances footer with every hint that applies with no instance selected, and with one of
 *  the fixture's selected: every instance here is stopped or unknown, and offers to be stopped and
 *  retired (and a stopped one to be started), but those hints are given up first. */
const WHOLE_FOOTER = `${LEAD}/ filter   Tab detail   r refresh   w workspaces   ? help   q quit`;
/** The Instances footer at a width: `help` and `quit` always stand, and a hint that would reach
 *  the last cell ends the row's hints. The acts are given up first, then `w workspaces`, then
 *  `r refresh`, so a terminal too narrow for the whole row draws it without them (views/frame.mjs
 *  `footer`). */
const footerAt = (cols) => {
  let footer = WHOLE_FOOTER;
  for (const hint of ["   w workspaces", "   r refresh"]) { if (footer.length <= cols - 1) return footer; footer = footer.replace(hint, ""); }
  return footer;
};
/** At 80 columns, the leader takes the room of `w workspaces`. */
const PLAIN_FOOTER = footerAt(80);
const FOOTER = PLAIN_FOOTER;
/** With the detail focused: the selected instance's acts first, as room allows (stop and retire
 *  at 79 and 80 columns), then the detail's own keys. */
const DETAIL_FOOTER = `${LEAD}X stop   Tab detail   Esc close   r refresh   ? help   q quit`;
const HELP_FOOTER = `${LEAD}Esc close   ? help   q quit`;
/** The switcher: its header, its footer with a workspace open, its two headings (the first is
 *  the shared home's, the second the TUI's own), and the TUI's row for a roster read that failed
 *  before any answer. */
const SWITCHER_TITLE = " workspaces";
const SWITCHER_FOOTER = `${LEAD}Enter open   / filter   r refresh   Esc close   ? help   q quit`;
const UNMATCHED = "  Not matched to a workspace";
const OFFERED = "  On this machine, not opened";
const ROSTER_FAILED = "Other machines were not read.";
/** The help's `Keys` list at 80 columns, one row per action in the table's order, and one per view
 *  for `open` (Enter): under the agent's line the back key, the terminal's rules and where the keys
 *  are listed (views/help.mjs `openRows`). */
const HELP_KEYS = [
  /^ *Up, k {2,}up$/, /^ *Down, j {2,}down$/, /^ *g, Home {2,}first$/, /^ *G, End {2,}last$/, /^ *PageUp {2,}page up$/, /^ *PageDown {2,}page down$/,
  /^ *Left, h {2,}collapse, or go to the parent$/, /^ *Right, l {2,}expand, or go to the first child$/, /^ *Tab {2,}detail$/, /^ *\/ {2,}filter$/,
  /^ *r {2,}refresh$/, /^ *1 {2,}instances$/, /^ *2 {2,}souls$/, /^ *3 {2,}capabilities$/, /^ *w {2,}workspaces$/, /^ *Ctrl\+K {2,}palette$/,
  /^ *Enter {2,}open the selected agent's terminal as a tab beside the list, or$/, /^ {2,}show its tab when it has one, in the list of instances$/,
  /^ {2,}C-\\ C-\\ takes the focus from the terminal back to the list; the$/, /^ {2,}agent keeps running\.$/,
  /^ {2,}While the terminal has the focus every other key goes to the$/, /^ {2,}agent, Ctrl\+C and Ctrl\+Z too\.$/,
  /^ {2,}Up to 4 terminals are open at a time, each a tab\. They have no$/, /^ {2,}scrollback but the viewer's own, and no mouse\.$/,
  /^ {2,}docs\/tui\.md has the keys that can be the leader\.$/,
  /^ *Enter {2,}open the selected workspace, in the switcher$/,
  /^ *z {2,}go to the shown terminal with the whole screen; the leader twice$/, /^ {2,}brings the list back$/,
  /^ *c {2,}close the shown terminal and show its neighbour; the agent keeps$/, /^ {2,}running$/,
  /^ *\[ {2,}show the terminal of the tab before the shown one$/, /^ *\] {2,}show the terminal of the tab after the shown one$/,
  // The acts, and under the last of them the rules of a confirmation (views/help.mjs ACT_RULES).
  /^ *X {2,}stop the selected agent, after a confirmation$/, /^ *D {2,}retire the selected agent, after a confirmation$/,
  /^ *S {2,}start the selected agent as it was last launched, after a$/, /^ {2,}confirmation$/,
  /^ *R {2,}restart the selected agent as it was last launched, after a$/, /^ {2,}confirmation$/,
  /^ {2,}Each act opens a confirmation with Cancel chosen: move to the act$/, /^ {2,}with Left\/Right or Tab, then press Enter\.$/,
  /^ {2,}Esc closes a confirmation; an act it sent goes on, also after oats$/, /^ {2,}tui quits\.$/,
  /^ *\? {2,}help$/, /^ *Esc {2,}close$/, /^ *q, Ctrl\+C {2,}quit$/, /^ *Ctrl\+Z {2,}suspend$/, /^ *Ctrl\+L {2,}redraw$/,
];
const NO_TERMINAL = "oats: `oats tui` needs a terminal on stdin and stdout (E_NO_TERMINAL); `oats status` prints the instances once";
const noDeployment = (dir) => `oats: no OATS deployment at or above ${dir} (E_NO_DEPLOYMENT); name one with \`oats tui --dir <path>\``;
const tooSmallLine = (cols, rows) => `Terminal too small: ${cols}x${rows}, oats tui needs 60x15.`;
const UTF8 = { locale: "C.UTF-8", rule: "─", down: "┬", stopped: "○" };
const ASCII = { locale: "C", rule: "-", down: "+", stopped: "-" };
/** The columns of the list pane where the terminal is wide enough for two panes (docs/tui.md). */
const listCols = (cols) => Math.min(60, Math.max(36, Math.floor(cols * 0.48)));
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The rows around the panes, the same in every view: what is wrong with them. `split`: the two
 *  panes are drawn, so each rule has a joint where the line between them meets it. `footer` is
 *  the last row, or what it matches. `title` and `views` are the two rows of the header, or what
 *  they match: the fixture's name with its count and the time of a read, unless a view says
 *  otherwise. */
function chromeFaults(screen, { cols, rows, look, split, footer, count, title = new RegExp(`^ fixture +${count} stopped$`), views = /^ {2}Instances {3}Souls {3}Capabilities +read \d\d:\d\d:\d\d$/ }) {
  const faults = [];
  const expect = (row, want, what) => {
    const got = screen[row] ?? "";
    if (want instanceof RegExp ? !want.test(got) : got !== want) faults.push(`${what} (row ${row + 1}) is ${JSON.stringify(screen[row])}, not ${want instanceof RegExp ? want : JSON.stringify(want)}`);
  };
  const rule = (joint) => (split ? look.rule.repeat(listCols(cols)) + joint + look.rule.repeat(cols - listCols(cols) - 1) : look.rule.repeat(cols));
  if (screen.length !== rows) faults.push(`the screen has ${screen.length} rows, not ${rows}`);
  expect(0, title, "the title row");
  expect(1, views, "the views row");
  expect(2, rule(look.down), "the rule under the views");
  // No rule over the footer: the panes reach down to it.
  if (screen[rows - 2] !== undefined && /^[─+-]+$/.test(screen[rows - 2])) faults.push(`row ${rows - 1}, over the footer, is a rule: ${JSON.stringify(screen[rows - 2])}`);
  expect(rows - 1, footer, "the footer");
  if (screen.some((row) => [...row].length > cols)) faults.push(`a row is longer than ${cols} cells`);
  return faults;
}
/** What keeps a screen from being the Instances view of the fixture at that size: nothing, when
 *  it is that view. `selected` is the instance the selection is on; `folded`: `alpha` is
 *  collapsed; `gone`: names no row shows (folded away, or hidden by the filter); `extra`: names of
 *  instances a test added; `detail`: the detail pane holds the focus. With every row hidden the
 *  list says that nothing matches the filter, and the detail is empty.
 *  With nothing hidden the list is the Desktop's order, row for row: the cluster, an empty row,
 *  the single instance. With something hidden only what the shared grouping promises whatever it
 *  hides is asserted: which rows are drawn, each once, and which is selected; not where a row
 *  stands among the groups (awebai/oats#971). */
function viewFaults(screen, { cols = 80, rows = 24, look = UTF8, selected = "alpha", folded = false, gone = [], extra = [], detail = false, footer = footerAt(cols), count = 3 } = {}) {
  const split = cols >= 80;
  const faults = chromeFaults(screen, { cols, rows, look, split, footer, count });
  const hidden = new Set([...gone, ...(folded ? ["beta"] : [])]);
  // A row is its mark and its name, indented by its level: no disclosure mark and no word (every
  // row here is stopped, which the mark says). A folded row says how many it folds away.
  const row = (name, depth, fold = "") => new RegExp(`^${name === selected ? ">" : " "} ${"  ".repeat(depth)}${literal(look.stopped)} ${name}${fold ? literal(` ${fold}`) : ""}$`);
  const wanted = [["alpha", 0, folded ? "+1" : ""], ["beta", 1], ["gamma", 0], ...extra.map((name) => [name, 0])].filter(([name]) => !hidden.has(name));
  const list = screen.slice(3, rows - 1).map((text) => (split ? [...text].slice(0, listCols(cols)).join("").trimEnd() : text));
  const NO_MATCH = "   No instance matches the filter.";
  const drawn = list.filter((text) => text !== "" && text !== NO_MATCH);
  if (wanted.length === 0 && list[0] !== NO_MATCH) faults.push(`the list's first row is ${JSON.stringify(list[0])}, not ${JSON.stringify(NO_MATCH)}`);
  if (wanted.length > 0 && list.includes(NO_MATCH)) faults.push("the list says nothing matches");
  if (hidden.size === 0 && extra.length === 0) {
    const order = [wanted[0], wanted[1], null, wanted[2]];
    order.forEach((want, i) => { if (want ? !row(...want).test(list[i] ?? "") : list[i] !== "") faults.push(`row ${i + 4} of the list is ${JSON.stringify(list[i])}, not ${want ? row(...want) : "empty"}`); });
    if (drawn.length !== 3) faults.push(`the list draws ${drawn.length} rows, not 3: ${JSON.stringify(drawn)}`);
  } else {
    for (const want of wanted) { const n = drawn.filter((text) => row(...want).test(text)).length; if (n !== 1) faults.push(`${n} rows of the list are ${row(...want)}: ${JSON.stringify(drawn)}`); }
    if (drawn.length !== wanted.length) faults.push(`the list draws ${drawn.length} rows, not ${wanted.length}: ${JSON.stringify(drawn)}`);
    for (const name of hidden) if (drawn.some((text) => new RegExp(`\\b${name}\\b`).test(text))) faults.push(`a row still shows ${name}`);
  }
  if (split) {
    const pane = screen.slice(3, rows - 1).map((text) => [...text].slice(listCols(cols) + 1).join(""));
    const title = wanted.length ? `${detail ? " >" : "  "} ${selected}` : "";
    if (pane[0] !== title) faults.push(`the detail's first row is ${JSON.stringify(pane[0])}, not ${JSON.stringify(title)}`);
    if (wanted.length && !pane.some((text) => /^ {3}soul {5}(dev|reviewer)$/.test(text))) faults.push("the detail names no soul");
  }
  return faults;
}
/** The same for the help: the rules without a joint, a `Keys` list with one row per action in the
 *  table's order, as many as the pane holds over its last row, and no row of the list. */
function helpFaults(screen, { cols = 80, rows = 24, look = UTF8, count = 3 } = {}) {
  const faults = chromeFaults(screen, { cols, rows, look, split: false, footer: HELP_FOOTER, count });
  const area = screen.slice(3, rows - 1);
  const title = area.findIndex((text) => text.trim() === "Keys");
  if (title < 0) faults.push("no row is the title `Keys`");
  const start = area.findIndex((text) => HELP_KEYS[0].test(text));
  if (start < 0 || start < title) faults.push("no row under the title is `Up, k  up`");
  else HELP_KEYS.slice(0, area.length - 1 - start).forEach((pattern, i) => { if (!pattern.test(area[start + i] ?? "")) faults.push(`row ${start + i + 4} is ${JSON.stringify(area[start + i])}, which is not ${pattern}`); });
  if (area.some((text) => /\bstopped$/.test(text))) faults.push("a row of the list is still shown");
  return faults;
}

/** What keeps a screen of 80x24 from being the Instances view of a deployment that was not read.
 *  What a failed read becomes is the shared rule's answer, and so are its words: here only that
 *  it is said, on rows of its own under the views, that no instance and no time of a read is
 *  drawn for a deployment that was not read, and that the one pane has no line down its middle.
 *  `title` is what the title row matches; `reason`: the most rows the reason takes (the frame
 *  gives a long one up to four), each started at the margin, with nothing under the last. */
function notReadFaults(screen, { title = /^ \S+$/, reason = 1 } = {}) {
  const why = screen.slice(4, 4 + reason), said = why.findIndex((row) => row === "");
  return [
    ...(title.test(screen[0] ?? "") ? [] : [`the title row counts instances, or names another deployment: ${JSON.stringify(screen[0])}`]),
    ...(screen[1] === "  Instances   Souls   Capabilities" ? [] : [`the views row is ${JSON.stringify(screen[1])}`]),
    ...(screen[2] === UTF8.rule.repeat(80) && screen[22] !== UTF8.rule.repeat(80) ? [] : ["the rule under the views has a joint or is not there, or a rule is over the footer"]),
    ...(/^ \S/.test(screen[3] ?? "") && /^ \S/.test(screen[4] ?? "") ? [] : [`rows 4 and 5 do not say what state the deployment is in and why: ${JSON.stringify(screen.slice(3, 5))}`]),
    ...(why.slice(0, said < 0 ? reason : said).every((row) => /^ \S/.test(row)) ? [] : [`a row of the reason does not start at the margin: ${JSON.stringify(why)}`]),
    ...(screen.slice(said < 0 ? 4 + reason : 4 + said, 23).every((row) => row === "") ? [] : ["something is drawn under the reason"]),
    ...(screen[23] === PLAIN_FOOTER ? [] : [`the footer is ${JSON.stringify(screen[23])}`]),
  ];
}

/** The same for the switcher, which takes the whole body: the header says `workspaces` where a
 *  workspace's name stands, with no count and no time of a read; the rules have no joint; the body
 *  is `body`, row for row from its first (each a string, or what the row matches), and nothing
 *  under it. `open`: a workspace is open, so Esc has a view to close the switcher onto and the
 *  footer offers it. */
function switcherFaults(screen, { cols = 80, rows = 24, look = UTF8, body, open = true }) {
  const faults = chromeFaults(screen, { cols, rows, look, split: false, footer: open ? SWITCHER_FOOTER : SWITCHER_FOOTER.replace("   Esc close", ""), title: SWITCHER_TITLE, views: "  Instances   Souls   Capabilities" });
  const area = screen.slice(3, rows - 1);
  body.forEach((want, i) => { if (want instanceof RegExp ? !want.test(area[i] ?? "") : area[i] !== want) faults.push(`row ${i + 4} is ${JSON.stringify(area[i])}, not ${want instanceof RegExp ? want : JSON.stringify(want)}`); });
  if (!area.slice(body.length).every((text) => text === "")) faults.push(`something is drawn under the ${body.length} rows of the switcher`);
  return faults;
}

// ---- a terminal ---------------------------------------------------------------------------------

/** The pane's modes, as tmux tracks them. `bracket_paste_flag` is empty on a tmux that has no such
 *  format (it prints nothing for a name it does not know). */
const FLAGS = ["alternate_on", "cursor_flag", "wrap_flag", "mouse_any_flag", "keypad_flag", "keypad_cursor_flag", "insert_flag", "origin_flag", "bracket_paste_flag"];
let opened = 0, started = 0;

/** Wait for what a terminal shows (or for a file), within the file's budget. A timeout says what
 *  was waited for, what is missing (`faults()`, read when the wait gives up) and what the pane
 *  shows instead. */
async function until(term, predicate, what, faults = () => []) {
  const left = Math.max(0, FILE_DEADLINE - Date.now());
  try { await waitUntil(predicate, what, Math.min(10000, left)); } catch (error) {
    if (!/^timed out waiting for /.test(error?.message ?? "")) throw error;
    const missing = faults();
    assert.fail(`${error.message}${left === 0 ? ` (this file's budget of ${BUDGET_MS / 1000}s was spent before the wait began)` : ""}${missing.length ? `: ${missing.join("; ")}` : ""}; ${term.id} (${term.flagsLine()}) shows:\n${term.shows()}`);
  }
}
/** Wait for a whole screen: `faults(screen)` answers what keeps it from being the one waited for. */
const untilScreen = (term, faults, what) => until(term, () => faults(term.screen()).length === 0, what, () => faults(term.screen()));

/** A terminal of `cols`x`rows`: a new session of the private server, removed after the test. Its
 *  pane runs `command`, or an interactive bash with job control, a known prompt and the locale
 *  named (the TUI reads LC_ALL to choose its rules), started in `cwd` with the environment of
 *  `world`'s deployment and `env` over it; then it resolves at the first prompt. */
async function terminal(t, { cols = 80, rows = 24, locale = UTF8.locale, command, world = WORLD, cwd = base, env = {} } = {}) {
  const id = `t${++opened}`;
  const extra = Object.entries(env).map(([name, value]) => `${name}=${shq(value)} `).join("");
  const shell = command ?? `sh ${shq(world.enter)} env ${extra}LC_ALL=${locale} LANG=${locale} HISTFILE=/dev/null PS1=${shq(`${PROMPT} `)} bash --norc --noprofile -i`;
  const [pane, session] = tmuxOn("new-session", "-d", "-P", "-F", "#{pane_id} #{session_id}", "-s", id, "-x", String(cols), "-y", String(rows), "-c", cwd, shell).split(" ");
  let files = 0, typed = null;
  const term = {
    id, pane, session,
    /** The screen: one string per row, as `capture-pane` prints them (no trailing spaces). */
    screen() { return tmuxRaw("capture-pane", "-p", "-t", pane).split("\n").slice(0, -1); },
    /** The screen with wrapped rows joined: a line longer than the terminal is one line. */
    joined() { return tmuxRaw("capture-pane", "-p", "-J", "-t", pane).split("\n").map((row) => row.trimEnd()).filter(Boolean); },
    /** Whether the pane shows `line`, printed by the command typed last (or by the pane's own
     *  command), as a whole line: a joined row of its own, or the rest of the row that holds the
     *  prompt and what was typed. A typed line that fills its last row exactly leaves that row
     *  marked as wrapped, and the joined capture then has what was printed next on the same row. */
    showsLine(line) { const rows = term.joined(); return rows.includes(line) || (typed !== null && rows.includes(`${PROMPT} ${typed}${line}`)); },
    /** Whether the prompt is on the row after what was typed last, with nothing printed between
     *  them: the last two joined rows are the typed line and the prompt, or, where the typed line
     *  fills its row (see `showsLine`), the last joined row is the typed line with the prompt on
     *  its end. */
    promptFollowsTyped() { const rows = term.joined(), line = `${PROMPT} ${typed}`; return typed !== null && ((rows.at(-2) === line && rows.at(-1) === PROMPT) || rows.at(-1) === `${line}${PROMPT}`); },
    shows() { try { return term.screen().map((row) => `  |${row}`).join("\n"); } catch (error) { return `  (no pane: ${error.message})`; } },
    flags() { const values = tmuxOn("display-message", "-p", "-t", pane, FLAGS.map((flag) => `#{${flag}}`).join(",")).split(","); return Object.fromEntries(FLAGS.map((flag, i) => [flag, values[i] ?? ""])); },
    flagsLine() { try { return Object.entries(term.flags()).map(([flag, value]) => `${flag}=${value}`).join(" "); } catch { return "no flags"; } },
    size() { return tmuxOn("display-message", "-p", "-t", pane, "#{pane_width}x#{pane_height}"); },
    /** The row the cursor is on, counted from 0 as the rows of `screen()` are. */
    cursorRow() { return Number(tmuxOn("display-message", "-p", "-t", pane, "#{cursor_y}")); },
    /** Keys, as tmux names them, typed at the terminal. */
    press(...keys) { tmuxOn("send-keys", "-t", pane, ...keys); },
    atPrompt() { return term.screen().filter(Boolean).at(-1) === PROMPT; },
    async prompt(why) { await until(term, () => term.atPrompt(), `the shell's prompt in ${id}, ${why}`); },
    /** A command line typed at the shell's prompt, and Enter. */
    async command(text, why) {
      await term.prompt(`before typing ${why}`);
      tmuxOn("send-keys", "-l", "-t", pane, text);
      tmuxOn("send-keys", "-t", pane, "Enter");
      typed = text;
    },
    /** The terminal's line settings, as `stty -g` prints them in the pane's own shell. */
    async stty(when) {
      const file = join(base, `${id}-stty-${++files}`);
      await term.command(`${shq(STTY)} -g > ${shq(file)}`, `stty -g ${when}`);
      await until(term, () => existsSync(file) && /\n$/.test(readFileSync(file, "utf8")), `the output of stty -g ${when} in ${id}`);
      await term.prompt(`after stty -g ${when}`);
      return comparableStty(readFileSync(file, "utf8").trim());
    },
    /** Everything a program can leave changed: the line settings, the pane's modes and title, and
     *  every option of the server, the session, the window and the pane. Taken at the prompt. */
    async state(when) {
      const stty = await term.stty(when);
      return {
        stty, flags: term.flags(), title: tmuxOn("display-message", "-p", "-t", pane, "#{pane_title}"),
        options: {
          global: tmuxOn("show-options", "-g"), server: tmuxOn("show-options", "-s"), windowGlobal: tmuxOn("show-window-options", "-g"),
          session: tmuxOn("show-options", "-t", session), window: tmuxOn("show-window-options", "-t", pane), pane: tmuxOn("show-options", "-p", "-t", pane),
        },
      };
    },
    kill() { try { tmuxOn("kill-session", "-t", session); } catch { /* gone */ } },
    /** Something to do when the test that opened this terminal is over. */
    after(fn) { t.after(fn); },
  };
  t.after(term.kill); // a failed test leaves nothing for the next one
  if (!command) await term.prompt("when its shell has started");
  return term;
}

/** `oats tui`, the real CLI, typed at a terminal's prompt through a wrapper that writes its own pid
 *  and then becomes the CLI (so the pid is the TUI's, and the shell's job is the TUI). `args` are
 *  the word's arguments: the deployment by `--dir`, unless a test says otherwise. The shell
 *  records the exit status unless `record` is false. Resolves once the Instances view of that
 *  deployment is on the screen, read (or once `first(run, term)` has seen the first screen of a
 *  run that starts on another): `at` is what `viewFaults` is told about every screen of this run
 *  (its size, its look). */
async function tui(term, at = {}, { record = true, world = WORLD, args = `--dir ${shq(world.dep)}`, first = (run) => run.view("after the start") } = {}) {
  const n = ++started;
  const pidFile = join(base, `tui-${n}.pid`), statusFile = join(base, `tui-${n}.status`);
  await term.command(`sh -c ${shq(`echo $$ > ${shq(pidFile)}; exec ${TUI} ${args}`)}${record ? `; echo $? > ${shq(statusFile)}` : ""}`, "the oats tui command");
  const run = {
    statusFile, world,
    /** The exit status the pane's shell recorded; null while the command runs. */
    status() { const text = existsSync(statusFile) ? readFileSync(statusFile, "utf8") : ""; return /^\d+\n$/.test(text) ? Number(text) : null; },
    async ended(why) { await until(term, () => run.status() !== null, `oats tui in ${term.id} to end ${why}`); return run.status(); },
    /** The Instances view is on the screen, as `want` says, and the program still runs. */
    async view(why, want = {}) {
      await untilScreen(term, (screen) => viewFaults(screen, { ...at, ...want }), `the Instances view ${why}`);
      assert.equal(run.status(), null, `oats tui still runs ${why}`);
    },
    async help(why, want = {}) {
      await untilScreen(term, (screen) => helpFaults(screen, { ...at, ...want }), `the help ${why}`);
      assert.equal(run.status(), null, `oats tui still runs ${why}`);
    },
    /** The switcher is on the screen, with `want.body` as its rows, and the program still runs. */
    async switcher(why, want) {
      await untilScreen(term, (screen) => switcherFaults(screen, { ...at, ...want }), `the switcher ${why}`);
      assert.equal(run.status(), null, `oats tui still runs ${why}`);
    },
    /** A read in flight: the next answer of the collector's tmux is held (see `deployment`), the
     *  refresh key starts a read now, and this resolves once a held tmux wrote down the pid of its
     *  sleep: the pids that hold reads, of processes that run. `release()` lets the next read
     *  answer again. */
    async reading(why) {
      const before = world.held().length;
      writeFileSync(world.holdFile, "");
      term.press("r");
      await until(term, () => world.held().length > before, `a read in flight ${why}: the collector's tmux, held`);
      const pids = world.held().slice(before);
      assert.ok(pids.every((pid) => Number.isInteger(pid) && pid > 1 && alive(pid)), `what holds the read runs ${why} (${pids})`);
      return pids;
    },
    /** A roster read in flight, in a world with a machine (see `machineWorld`): the next `ssh` of
     *  the kernel that reads the roster is held, and this resolves once a held `ssh` wrote down
     *  the pid of its sleep: the pids that hold the read, of processes that run. One roster read
     *  runs at a time, and the refresh key starts one only while none is in flight: so `r` is
     *  pressed again, once a second, until a read it started is held (the read of the start may
     *  have been past its `ssh` when the hold was set). With `press` false no key is pressed: the
     *  hold was set earlier, when `before` sleeps had held a read, and the read waited for is one
     *  the TUI starts unasked (the first of a run, the one of a return from a suspend).
     *  That kernel leads a process group of its own (lib/read.mjs), which is what the TUI ends on
     *  every way out: what holds the read is in a group, and not in the TUI's. */
    async rosterReading(why, { press = true, before = world.sshHeld().length } = {}) {
      world.holdSsh();
      let pressed = 0;
      await until(term, () => {
        if (world.sshHeld().length > before) return true;
        if (press && Date.now() - pressed >= 1000) { term.press("r"); pressed = Date.now(); }
        return false;
      }, `a roster read in flight ${why}: the kernel's ssh, held`);
      const pids = world.sshHeld().slice(before);
      assert.ok(pids.every((pid) => Number.isInteger(pid) && pid > 1 && alive(pid)), `what holds the roster read runs ${why} (${pids})`);
      const own = groupOf(run.pid);
      if (own !== null) for (const pid of pids) { const group = groupOf(pid); assert.ok(group !== null && group !== own, `what holds the roster read (${pid}, in the process group ${group}) is in a group, and not in the TUI's (${own}), ${why}`); }
      return pids;
    },
    /** The children of a read that was in flight are gone. Left alone, what held the read would
     *  run for half a minute, far longer than any wait of this file: the TUI ended its group. */
    async childrenGone(pids, why) {
      await until(term, () => pids.every((pid) => !alive(pid)), `the children of the read in flight (${pids}) to be gone ${why}`);
    },
  };
  term.after(world.release); // a held read of a failed test holds no later one
  await first(run, term);
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  assert.ok(Number.isInteger(pid) && pid > 1, `the wrapper wrote the pid (${pid})`);
  run.pid = pid;
  return run;
}
/** A shell's terminal: its own screen, with a cursor and autowrap. */
function assertShellModes(flags, why) {
  assert.deepEqual({ alternate_on: flags.alternate_on, cursor_flag: flags.cursor_flag, wrap_flag: flags.wrap_flag }, { alternate_on: "0", cursor_flag: "1", wrap_flag: "1" }, `${why}: the shell's own screen, with a cursor and autowrap`);
}
/** The modes the TUI switches on, and the ones it never touches (docs/tui.md). */
function assertRunningModes(term, why) {
  const { bracket_paste_flag: paste, insert_flag: _insert, origin_flag: _origin, ...flags } = term.flags();
  assert.deepEqual(flags, { alternate_on: "1", cursor_flag: "0", wrap_flag: "0", mouse_any_flag: "0", keypad_flag: "0", keypad_cursor_flag: "0" }, `${why}: the alternate screen, no cursor, no autowrap; no mouse, no keypad modes`);
  // The shell's readline switches bracketed paste off before it runs a command: on here, it is the TUI's.
  if (paste !== "") assert.equal(paste, "1", `${why}: bracketed paste is on`);
}

// ---- the reading of `stty -g` itself: no terminal needed ----------------------------------------
test("a stty -g line is compared without macOS's PENDIN bit and with everything else: that bit of lflag is cleared in a macOS line and nothing else is; a Linux line is untouched", () => {
  // Two real lines of one pane on macOS, from the control's output: PENDIN set, and clear.
  const mac = (lflag, iflag = "6b02") => `gfmt1:cflag=4b00:iflag=${iflag}:lflag=${lflag}:oflag=3:discard=f:dsusp=19:eof=4:eol=ff:eol2=ff:erase=7f:intr=3:kill=15:lnext=16:min=1:quit=1c:reprint=12:start=11:status=14:stop=13:susp=1a:time=0:werase=17:ispeed=9600:ospeed=9600`;
  assert.equal(comparableStty(mac("200005cb")), mac("5cb"), "that bit is cleared, and no other character of the line changes");
  assert.equal(comparableStty(mac("5cb")), mac("5cb"), "a line without the bit is returned as it is");
  assert.equal(comparableStty(mac("200005cb")), comparableStty(mac("5cb")), "two lines that differ only in PENDIN compare equal");
  assert.equal(comparableStty(mac("a00005cb")), mac("800005cb"), "the bits above it stay (NOFLSH, 0x80000000)");
  assert.equal(comparableStty(mac("20000000")), mac("0"), "PENDIN alone leaves no bit");

  // Every other difference is still a difference.
  assert.notEqual(comparableStty(mac("200005c3")), comparableStty(mac("5cb")), "ECHO (0x8) off on one side");
  assert.notEqual(comparableStty(mac("220005cb")), comparableStty(mac("200005cb")), "NOKERNINFO (0x02000000), the bit next to it in the name");
  assert.notEqual(comparableStty(mac("200004cb")), comparableStty(mac("200005cb")), "ICANON (0x100) off: raw mode left on");
  assert.notEqual(comparableStty(mac("200005cb", "6b00")), comparableStty(mac("5cb")), "a bit of iflag");
  assert.notEqual(comparableStty(mac("5cb").replace("oflag=3", "oflag=20000003")), comparableStty(mac("5cb")), "the same bit in another field is that field's");
  assert.notEqual(comparableStty(mac("5cb").replace("min=1", "min=0")), comparableStty(mac("5cb")), "a control character");

  // A macOS line it cannot read is returned as it is, and so fails its comparison as it stands.
  for (const odd of [
    mac("200005cb").replace("lflag=200005cb:", ""), // no lflag
    mac("200005cb").replace("lflag=200005cb", "lflag="), // empty
    mac("200005cb").replace("lflag=200005cb", "lflag=0x200005cb"), // not plain hex
    mac("200005cb").replace("oflag=3", "lflag=20000003"), // written twice
    mac("200005cb").replace("lflag=", "xlflag="), // another name that ends the same
  ]) assert.equal(comparableStty(odd), odd, odd);

  // Linux prints hex fields with no names; the fourth is lflag. Nothing of it is touched, whatever it holds.
  const linux = "4500:5:f00bf:8a3b:3:1c:7f:15:4:0:1:0:11:13:1a:0:12:f:17:16:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0:0";
  assert.equal(comparableStty(linux), linux);
  const linuxWithThatBit = linux.replace(":8a3b:", ":20008a3b:");
  assert.equal(comparableStty(linuxWithThatBit), linuxWithThatBit);
  assert.notEqual(comparableStty(linuxWithThatBit), comparableStty(linux), "on Linux that bit is compared like any other");
  assert.equal(comparableStty(""), "");
});

// ---- no terminal at all: plain children ---------------------------------------------------------
test("without a terminal on stdout `oats tui` prints the E_NO_TERMINAL line on stderr and exits 1 with no escape byte, with or without --dir; --json is refused as one JSON envelope, --help prints the usage, and --server and a --dir without a path are refused", () => {
  // The worktree may live inside an agent's instance home: the children run in the fixture, with
  // its environment, and with no name that makes them an OATS instance.
  const env = REAL_TMUX ? { ...process.env } : fixtureEnv(base, { extra: { OATS_HOME_DIR: join(base, "oats-home") } });
  for (const key of Object.keys(env)) if (key !== "OATS_HOME_DIR" && /^(OATS_|PI_AGENT|TMUX)/.test(key)) delete env[key];
  const cli = (...args) => spawnSync(process.execPath, [CLI, "tui", ...args], { cwd: base, env: { ...env, TERM: "xterm-256color" }, encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });

  // The terminal is asked for before the deployment is looked for: no directory changes the answer.
  const none = cli(), named = cli("--dir", base);
  for (const r of [none, named]) assert.deepEqual({ status: r.status, stdout: r.stdout, stderr: r.stderr }, { status: 1, stdout: "", stderr: `${NO_TERMINAL}\n` });

  const json = cli("--json");
  assert.equal(json.status, 1);
  assert.deepEqual(JSON.parse(json.stdout), { schemaVersion: 1, ok: false, error: { code: "E_BAD_ARGS", message: "oats tui is interactive and has no --json form; `oats status --json` is the machine view" } });
  assert.equal(json.stdout.trim().split("\n").length, 1, "one envelope, on one line");

  const help = cli("--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Usage:\n/);
  assert.ok(help.stdout.includes(USAGE), help.stdout);
  assert.equal(help.stderr, "");

  const server = cli("--server", "x");
  assert.deepEqual({ status: server.status, stdout: server.stdout }, { status: 1, stdout: "" });
  assert.match(server.stderr, /\(E_BAD_ARGS\)/);
  assert.ok(server.stderr.includes("--server") && server.stderr.includes(USAGE), `--server is named, with the usage: ${server.stderr}`);
  const bare = cli("--dir");
  assert.deepEqual({ status: bare.status, stdout: bare.stdout, stderr: bare.stderr }, { status: 1, stdout: "", stderr: `oats: \`oats tui --dir\` takes a path (E_BAD_ARGS); usage: ${USAGE}\n` });
  for (const r of [none, named, json, help, server, bare]) assert.equal(/\x1b/.test(r.stdout + r.stderr), false, "no escape byte without a terminal");
});

// ---- on a terminal ------------------------------------------------------------------------------
const TMUX_VERSION = REAL_TMUX ? execFileSync(REAL_TMUX, ["-V"], { encoding: "utf8", timeout: 10000 }).trim() : "none";
test(`the tmux these tests run against: ${TMUX_VERSION}`, { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  t.diagnostic(`tmux -V: ${TMUX_VERSION}; pane modes it reports at a shell prompt: ${term.flagsLine()}`);
  assert.match(TMUX_VERSION, /^tmux /);
  assert.equal(term.size(), "80x24", "a detached session made with -x and -y has that size");
});

test("on a terminal of 80x24 `oats tui --dir` shows the fixture's instances, grouped as the shared home groups them, with the detail of the selected one; j, h, l, /, text, Enter, Esc, r, Tab and ? each do what the help says, waited for on what the pane shows; q exits with status 0 and the shell's screen is back", { skip: NO_TMUX }, async (t) => {
  const world = await deployment(t); // its own: this test adds an instance
  const term = await terminal(t, { world });
  const run = await tui(term, {}, { world });
  const two = (left, right) => `${left.padEnd(38)}│${right}`.trimEnd();
  assert.deepEqual(term.screen().map((row) => row.replace(/read \d\d:\d\d:\d\d$/, "read HH:MM:SS")), [
    `${" fixture".padEnd(70)}3 stopped`,
    "  Instances   Souls   Capabilities                                read HH:MM:SS",
    `${"─".repeat(38)}┬${"─".repeat(41)}`,
    two("> ○ alpha", "   alpha"),
    two("    ○ beta", "   soul     dev"),
    two("", "   state    stopped"),
    two("  ○ gamma", "   harness  claude"),
    two("", "   work     directory"),
    two("", "   home     …/agents/dev/instances/alpha"),
    ...Array(14).fill(two("", "")),
    FOOTER,
  ], "the Instances view, row for row");

  term.press("j");
  await run.view("after j: the next row, the child", { selected: "beta" });
  term.press("h");
  await run.view("after h on a row with nothing below it: its parent", { selected: "alpha" });
  term.press("h");
  await run.view("after h on an open row: collapsed", { selected: "alpha", folded: true });
  term.press("l");
  await run.view("after l on a collapsed row: open again", { selected: "alpha" });
  term.press("l");
  await run.view("after l on an open row: its first child", { selected: "beta" });

  term.press("/");
  await run.view("after /: the filter field takes the footer", { selected: "beta", footer: /^C-\\ commands {3}\/ +Enter keep {3}Esc clear$/ });
  tmuxOn("send-keys", "-l", "-t", term.pane, "gamq");
  await run.view("after text: q is text in the field, and nothing matches", { gone: ["alpha", "beta", "gamma"], footer: /^C-\\ commands {3}\/gamq +Enter keep {3}Esc clear$/ });
  term.press("BSpace");
  await run.view("after Backspace: the one match, selected", { selected: "gamma", gone: ["alpha", "beta"], footer: /^C-\\ commands {3}\/gam +Enter keep {3}Esc clear$/ });
  term.press("Enter");
  await run.view("after Enter: the filter is kept and the keys are keys again", { selected: "gamma", gone: ["alpha", "beta"], footer: /^C-\\ commands {3}\/gam +\/ filter {3}Tab detail {3}\? help {3}q quit$/ });
  term.press("Escape");
  await run.view("after Esc: the filter is cleared, the selection stays on its instance", { selected: "gamma" });

  // The view follows the deployment: an instance spawned meanwhile is there after a read. (That
  // the key asks for one is packages/tui/test/main.test.mjs's; a read comes every five seconds too.)
  await world.spawn("reviewer", { name: "delta" });
  term.press("r");
  const more = { selected: "gamma", extra: ["delta"], count: 4 };
  await run.view("after r: the new instance", more);

  term.press("Tab");
  await run.view("after Tab: the detail holds the focus", { ...more, detail: true, footer: DETAIL_FOOTER });
  term.press("Escape");
  await run.view("after Esc: the list has it again", more);
  term.press("?");
  await run.help("after ?", { count: 4 });
  term.press("Escape");
  await run.view("after Esc closed the help", more);
  term.press("?");
  await run.help("after ? again", { count: 4 });
  term.press("?");
  await run.view("after ? closed the help", more);

  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
  await term.prompt("after q");
  assert.equal(term.screen().includes(FOOTER), false, `the view is gone from the shell's screen:\n${term.shows()}`);
  assert.equal(alive(run.pid), false, "the process is gone");
});

/** A terminal is intact after a TUI that left it by `leave`: status `status`, what held a read
 *  in flight is gone, and `stty -g`, the pane's modes and every tmux option are what they were
 *  before the start; while it ran, only the alternate screen, the cursor, autowrap and bracketed
 *  paste were changed. `arrive(term, run)` brings the TUI to where it is left, and answers the
 *  pids of what holds its read then. `env` is set in the terminal's shell over the world's, and
 *  `start` is what `tui` is told of the start (its arguments, its first screen). */
async function leavesTheTerminalIntact(t, { how, status, world = WORLD, env = {}, start = {}, arrive, leave }) {
  const term = await terminal(t, { world, env });
  const before = await term.state("before the start");
  assertShellModes(before.flags, "before the start");
  const mine = everything();
  const run = await tui(term, {}, { world, ...start });
  assertRunningModes(term, `while it runs, before ${how}`);
  assert.deepEqual(everything(), mine, "the TUI made no session, window or pane");

  const reading = await arrive(term, run);
  await leave(term, run);
  await run.childrenGone(reading, `after ${how}`);
  assert.equal(await run.ended(`after ${how}`), status, term.shows());
  await until(term, () => !alive(run.pid), `the process ${run.pid} to be gone after ${how}`);
  // The cursor the alternate screen saved is the one that came back: the prompt is on the row
  // after the command line, with the cursor on it, and nothing of the view above it.
  await term.prompt(`after ${how}`);
  const screen = term.screen(), promptRow = screen.findLastIndex((row) => row === PROMPT);
  assert.equal(term.cursorRow(), promptRow, `the cursor is on the prompt's row after ${how}:\n${term.shows()}`);
  assert.equal(screen.slice(promptRow + 1).every((row) => row === ""), true, `nothing below the prompt after ${how}:\n${term.shows()}`);
  assert.notEqual(screen[promptRow - 1], "", `no empty row between the command and the prompt after ${how}:\n${term.shows()}`);
  assert.ok(term.promptFollowsTyped(), `the row above the prompt is the command line after ${how}:\n${term.shows()}`);
  const after = await term.state(`after ${how}`);
  assert.equal(after.stty, before.stty, `stty -g after ${how}`);
  assert.deepEqual(after.flags, before.flags, `the pane's modes after ${how}`);
  assertShellModes(after.flags, `after ${how}`);
  assert.deepEqual(after, before, `the terminal and the server after ${how}`);
  for (const footer of [FOOTER, SWITCHER_FOOTER]) assert.equal(term.screen().includes(footer), false, `the shell's screen is back:\n${term.shows()}`);
}

for (const [how, status, leave, first = async () => {}] of [
  ["q", 0, (term) => term.press("q")],
  ["Ctrl+C, the byte 0x03 on a raw terminal", 0, (term) => term.press("C-c")],
  ["SIGINT", 130, (term, run) => process.kill(run.pid, "SIGINT")],
  ["SIGTERM", 143, (term, run) => process.kill(run.pid, "SIGTERM")],
  ["SIGQUIT", 131, (term, run) => process.kill(run.pid, "SIGQUIT")],
  // Ctrl+L leaves and enters the alternate screen again. However often it did, the end is one
  // leave, and the shell's cursor is where the first entry found it. Keys are read in order, so the
  // help that answers the `?` typed after a Ctrl+L shows that the Ctrl+L was acted on before it.
  ...[1, 3].map((times) => [`${times} Ctrl+L and then q`, 0, (term) => term.press("q"), async (term, run) => {
    for (let i = 1; i <= times; i++) {
      term.press("C-l");
      term.press("?");
      await run.help(`after Ctrl+L number ${i}, then ?`);
      assertRunningModes(term, `after Ctrl+L number ${i}`);
      term.press("Escape");
      await run.view(`after Ctrl+L number ${i}, then ? and Esc`);
    }
  }]),
]) {
  test(`the terminal is intact after ${how}, with the view drawn and a read in flight: status ${status}, the read's children are gone, and stty -g, the pane's modes and every tmux option are what they were before the start; while it ran, only the alternate screen, the cursor, autowrap and bracketed paste were changed`, { skip: NO_TMUX }, async (t) => {
    await leavesTheTerminalIntact(t, { how, status, leave, arrive: async (term, run) => { await first(term, run); return run.reading(`before ${how}`); } });
  });
}

/** A choice of the switcher at 80 columns: the selection's mark, the mark of the workspace that
 *  is open, the name in a column a third of the width, and two cells on what stands beside it. */
const choice = (label, place, { selected = false, open = false } = {}) => `${selected ? ">" : " "} ${open ? "*" : " "} ${label.padEnd(26)}  ${place}`.trimEnd();
/** The same where what stands beside the name is the shared home's to word: `beside` is the
 *  source of what it matches. */
const choiceLike = (label, beside, marks) => new RegExp(`^${literal(choice(label, "", marks).padEnd(32))}${beside}$`);
/** The switcher in the world with the machine: the fixture's workspace, open and selected, and
 *  under the shared heading the machine that did not answer, by its own name with the short
 *  reason the shared home gives it. */
const MACHINES_SWITCHER = [choice("fixture", "This machine", { selected: true, open: true }), UNMATCHED, choiceLike("garnet", "\\S.*")];

test("the terminal is intact after q with the switcher open and a roster read in flight: status 0, the held ssh of the read is gone, and stty -g, the pane's modes and every tmux option are what they were before the start, with the prompt on the row after the command", { skip: NO_TMUX }, async (t) => {
  await leavesTheTerminalIntact(t, {
    how: "q in the switcher", status: 0, world: MACHINES, leave: (term) => term.press("q"),
    arrive: async (term, run) => {
      const reading = await run.rosterReading("before the switcher is opened");
      term.press("w");
      await run.switcher("after w, with a roster read in flight", { body: MACHINES_SWITCHER });
      assertRunningModes(term, "with the switcher open");
      assert.ok(reading.every(alive), `the roster read is still in flight with the switcher open (${reading})`);
      return reading;
    },
  });
});

/** What the fixture's tmux says for the one socket it does not read: an invented sentence. The
 *  kernel's reason for an instance whose terminal server it could not read is that tmux's own
 *  words (lib/core.mjs `recordedTmuxWindows`). */
const NOT_READ = "tmux: the socket of acme-platform could not be read";

/** Make the kernel answer that it does not know whether the instance in `home` runs, with `said`
 *  as its reason. The TUI runs no kernel but its install's own, so the answer is the real
 *  kernel's: it reads a launched home's windows from the tmux socket the home recorded, and where
 *  that tmux fails with anything but "no server" it answers `running: null`, the state
 *  `unreachable` and what tmux wrote on stderr. So the home is recorded as launched on a socket in
 *  the fixture, receipt included (as `recordedHome` of test/status-recorded-socket.test.mjs
 *  records one), and for that socket `front/tmux` writes `said` on stderr and exits 1. Nothing is
 *  started and no socket file is made: the path only names the server that is asked for. The
 *  shared collector leaves a row the kernel answered so as it is (packages/client/liveness.mjs):
 *  the reason that reaches the screen is the kernel's. */
function serverNotRead(world, home, said) {
  const socket = join(world.fx.base, "not-read.sock");
  const record = join(home, "instance.json"), meta = JSON.parse(readFileSync(record, "utf8"));
  const runtime = { launched: true, tmux: { session: "oats-agents", window: meta.instance, socket } };
  writeFileSync(record, `${JSON.stringify({ ...meta, ...runtime }, null, 2)}\n`);
  const receipt = join(dirname(home), ".oats-retirement", "baselines", `${createHash("sha256").update(home).digest("hex")}.json`);
  writeFileSync(receipt, `${JSON.stringify({ ...JSON.parse(readFileSync(receipt, "utf8")), runtime }, null, 2)}\n`);
  // After the script's first line: for this socket nothing else of it runs, and no tmux is asked.
  const front = join(world.front, "tmux");
  writeFileSync(front, readFileSync(front, "utf8").replace("\n", `\ncase " $* " in *" -S "${shq(socket)}" "*) echo ${shq(said)} >&2; exit 1 ;; esac\n`));
}

test("the reason the kernel gives for an instance it could not observe stands in the detail under the state, after `OATS says:` and with no quotation mark: with a tmux that fails for the socket one instance is recorded on, that instance reads the shared `state unknown` in the list, `unreachable` on its detail's state line, and is counted as unknown, its detail has the kernel's text wrapped under `state`, and the others are stopped as before; after q the terminal is intact", { skip: NO_TMUX }, async (t) => {
  const world = await deployment(t); // its own: this test changes a home's record and the fixture's tmux
  serverNotRead(world, join(world.fx.root, "reviewer", "instances", "gamma"), NOT_READ);

  const two = (left, right) => `${left.padEnd(38)}│${right}`.trimEnd();
  // Only the row whose state is not known has a word, the shared label `state unknown`: the word
  // column is as wide as it, and starts at cell 20.
  const listed = (row, word) => `${row.padEnd(20)}${word}`;
  /** The whole screen with `selected` selected and `detail` as the rows of its detail. */
  const screenOf = (selected, detail) => {
    const at = (name) => (name === selected ? ">" : " ");
    const list = [`${at("alpha")} ○ alpha`, `${at("beta")}   ○ beta`, "", listed(`${at("gamma")} ? gamma`, "state unknown")];
    return [
      `${" fixture".padEnd(59)}2 stopped  1 unknown`,
      `${"  Instances   Souls   Capabilities".padEnd(66)}read HH:MM:SS`,
      `${"─".repeat(38)}┬${"─".repeat(41)}`,
      ...Array.from({ length: 20 }, (_, i) => two(list[i] ?? "", detail[i] ?? "")),
      FOOTER,
    ];
  };
  /** What keeps a screen from being `want`, row for row, but for its two clock times: when it was
   *  read (the header) and when the instance was started (the detail of a launched home). */
  const faults = (want) => (screen) => {
    const got = screen.map((row) => row.replace(/read \d\d:\d\d:\d\d$/, "read HH:MM:SS").replace(/(│ {3}started {2})\S.*$/, "$1HH:MM"));
    return [...(got.length === want.length ? [] : [`the screen has ${got.length} rows, not ${want.length}`]), ...want.flatMap((row, i) => (got[i] === row ? [] : [`row ${i + 1} is ${JSON.stringify(got[i])}, not ${JSON.stringify(row)}`]))];
  };
  const ALPHA = ["   alpha", "   soul     dev", "   state    stopped", "   harness  claude", "   work     directory", "   home     …/agents/dev/instances/alpha"];
  // The reason is one fact with no label: it continues the state above it, on as many rows as it
  // needs in the 28 cells a value has here.
  const GAMMA = [
    "   gamma", "   soul     reviewer", "   state    unreachable",
    "            OATS says: tmux: the socket", "            of acme-platform could not", "            be read",
    "   harness  claude", "   work     directory", "   started  HH:MM", "   home     …ts/reviewer/instances/gamma",
  ];

  await leavesTheTerminalIntact(t, {
    how: "q with the detail of an instance the kernel could not observe", status: 0, world, leave: (term) => term.press("q"),
    start: { first: (run, term) => untilScreen(term, faults(screenOf("alpha", ALPHA)), "the Instances view with one instance the kernel could not observe") },
    arrive: async (term, run) => {
      term.press("j", "j");
      await untilScreen(term, faults(screenOf("gamma", GAMMA)), "the detail of the instance the kernel could not observe, after j and j");
      assert.equal(run.status(), null, "oats tui still runs with that detail drawn");
      // However the reason wraps, the rows under the state are the speaker's words and the
      // kernel's text, and nothing around them.
      const pane = term.screen().slice(3, 23).map((row) => [...row].slice(listCols(80) + 1).join(""));
      const state = pane.indexOf("   state    unreachable"), under = [];
      for (let i = state + 1; /^ {12}\S/.test(pane[i] ?? ""); i++) under.push(pane[i].trim());
      assert.equal(under.join(" "), `OATS says: ${NOT_READ}`, `the rows under the state:\n${term.shows()}`);
      assert.equal(term.screen().some((row) => row.includes('"')), false, `no quotation mark is on the screen:\n${term.shows()}`);
      return []; // no read is held
    },
  });
});

test("SIGHUP ends it with status 129, and the children of a read in flight with it; SIGKILL ends it at once: either way the process is gone and the private server holds exactly the sessions, windows and panes the tests made", { skip: NO_TMUX }, async (t) => {
  for (const [signal, status] of [["SIGHUP", 129], ["SIGKILL", 137]]) {
    const term = await terminal(t);
    const mine = everything();
    const run = await tui(term);
    // After SIGKILL nothing ran that could end a child either: a read then ends by itself.
    const reading = signal === "SIGHUP" ? await run.reading("before SIGHUP") : [];
    process.kill(run.pid, signal);
    await run.childrenGone(reading, `after ${signal}`);
    assert.equal(await run.ended(`after ${signal}`), status, term.shows());
    await until(term, () => !alive(run.pid), `the process ${run.pid} to be gone after ${signal}`);
    assert.deepEqual(everything(), mine, `${signal}: nothing was added to the server, and nothing of the test's was taken`);
    // After SIGKILL nothing ran that could put the terminal back: it is left in the alternate
    // screen, which is expected and documented, and not asserted. The terminal goes with its session.
    t.diagnostic(`after ${signal} the pane reports ${term.flagsLine()}`);
    run.world.release();
    term.kill();
    assert.deepEqual(everything(), mine.filter((row) => !row.startsWith(`${term.id} `)), `${signal}: the test's terminal is removed`);
  }
});

test("with a roster read in flight SIGTERM ends it with status 143 and SIGHUP with status 129, and the held ssh of the read with it: either way the process is gone and the private server holds exactly the sessions, windows and panes the tests made", { skip: NO_TMUX }, async (t) => {
  for (const [signal, status] of [["SIGTERM", 143], ["SIGHUP", 129]]) {
    const term = await terminal(t, { world: MACHINES });
    const mine = everything();
    const run = await tui(term, {}, { world: MACHINES });
    const reading = await run.rosterReading(`before ${signal}`);
    process.kill(run.pid, signal);
    await run.childrenGone(reading, `after ${signal}`);
    assert.equal(await run.ended(`after ${signal}`), status, term.shows());
    await until(term, () => !alive(run.pid), `the process ${run.pid} to be gone after ${signal}`);
    assert.deepEqual(everything(), mine, `${signal}: nothing was added to the server, and nothing of the test's was taken`);
    run.world.release();
    term.kill();
    assert.deepEqual(everything(), mine.filter((row) => !row.startsWith(`${term.id} `)), `${signal}: the test's terminal is removed`);
  }
});

test("Ctrl+Z with the first roster read of the run in flight: the read is given up and its held ssh is gone, and the shell's prompt returns; fg draws the view again and a new roster read runs, and the row of a roster read that failed is not on the screen, since a read given up is no failed answer; q then exits 0 and the held ssh of the new read is gone too", { skip: NO_TMUX }, async (t) => {
  const world = MACHINES;
  const term = await terminal(t, { world });
  // Held before the start: no roster answered in this run, so a read taken as failed would be
  // said on a row of its own after the list (after an answer, a machine's heading says it).
  const before = world.sshHeld().length;
  world.holdSsh();
  term.after(world.release);
  const run = await tui(term, {}, { world, record: false });
  const reading = await run.rosterReading("before Ctrl+Z", { press: false, before });

  term.press("C-z");
  await run.childrenGone(reading, "after Ctrl+Z");
  await until(term, () => term.flags().alternate_on === "0" && term.atPrompt(), "the shell's prompt on its own screen after Ctrl+Z");
  assert.equal(world.sshHeld().length, before + reading.length, "no roster read was started while it was stopped");

  // The hold stays: the read the return starts is held too, and so is seen to run.
  await term.command("fg", "fg");
  await run.view("after fg");
  const again = await run.rosterReading("after fg", { press: false, before: before + reading.length });
  assert.equal(term.screen().some((row) => row.includes(ROSTER_FAILED)), false, `no row says that a roster read failed:\n${term.shows()}`);
  await run.view("with the new roster read in flight");

  term.press("q");
  await run.childrenGone(again, "after q");
  await term.command(`echo $? > ${shq(run.statusFile)}`, "the status of fg");
  assert.equal(await run.ended("after fg and q"), 0, term.shows());
});

test("Ctrl+Z during a read suspends with the terminal handed back: the read is given up and its children are gone, the shell's prompt returns, the alternate screen is off, autowrap and the cursor are on and stty -g is what it was; fg draws the view again from a new read; q then exits 0", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  const before = await term.state("before the start");
  const run = await tui(term, {}, { record: false });
  assertRunningModes(term, "while it runs");

  const reading = await run.reading("before Ctrl+Z");
  term.press("C-z");
  await run.childrenGone(reading, "after Ctrl+Z");
  run.world.release();
  await until(term, () => term.flags().alternate_on === "0" && term.atPrompt(), "the shell's prompt on its own screen after Ctrl+Z");
  await until(term, () => /^T/.test(execFileSync("ps", ["-o", "stat=", "-p", String(run.pid)], { encoding: "utf8", timeout: 10000 }).trim()), `the process ${run.pid} to be stopped`);
  assert.ok(term.joined().some((row) => /Stopped/.test(row)), `the shell reports a stopped job:\n${term.shows()}`);
  const stopped = await term.state("while it is stopped");
  assert.equal(stopped.stty, before.stty, "stty -g while stopped");
  assertShellModes(stopped.flags, "while stopped");
  assert.deepEqual(stopped.flags, before.flags, "the pane's modes while stopped");
  assert.deepEqual(stopped, before, "the terminal and the server while stopped");

  await term.command("fg", "fg");
  await run.view("after fg");
  assertRunningModes(term, "after fg");
  term.press("?");
  await run.help("after fg: it reads keys again");
  term.press("Escape");
  await run.view("after the help was closed");

  term.press("q");
  await term.command(`echo $? > ${shq(run.statusFile)}`, "the status of fg");
  assert.equal(await run.ended("after fg and q"), 0, term.shows());
  const after = await term.state("after q");
  assert.deepEqual(after, before, "the terminal and the server after a suspend, a return and q");
});

test("Ctrl+Z through a wrapper that does not exec: the wrapper stops with the TUI, the interactive shell's prompt returns with the alternate screen off, fg draws the view again, and after q the wrapper goes on", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  const before = await term.state("before the start");
  const statusFile = join(base, `${term.id}-wrapped.status`);
  await term.command(`sh -c ${shq(`${TUI} --dir ${shq(WORLD.dep)}; echo after-the-tui`)}`, "oats tui under sh -c");
  await untilScreen(term, (screen) => viewFaults(screen), "the view under a wrapper");
  assertRunningModes(term, "while it runs under a wrapper");

  term.press("C-z");
  await until(term, () => term.flags().alternate_on === "0" && term.atPrompt(), "the interactive shell's prompt on its own screen after Ctrl+Z under a wrapper");
  assert.ok(term.joined().some((row) => /Stopped/.test(row)), `the shell reports a stopped job:\n${term.shows()}`);
  assert.equal(term.screen().includes("after-the-tui"), false, "the wrapper stopped too: it has not gone on to its next command");
  const stopped = await term.state("while the wrapper is stopped");
  assertShellModes(stopped.flags, "while the wrapper is stopped");
  assert.deepEqual(stopped, before, "the terminal and the server while stopped");

  await term.command("fg", "fg");
  await untilScreen(term, (screen) => viewFaults(screen), "the view after fg under a wrapper");
  assertRunningModes(term, "after fg under a wrapper");

  term.press("q");
  await until(term, () => term.screen().includes("after-the-tui") && term.atPrompt(), "the wrapper's next command to print after q");
  await term.command(`echo $? > ${shq(statusFile)}`, "the status of fg");
  await until(term, () => existsSync(statusFile) && /\n$/.test(readFileSync(statusFile, "utf8")), "the status of the wrapper");
  assert.equal(readFileSync(statusFile, "utf8"), "0\n");
  assert.deepEqual(await term.state("after q under a wrapper"), before, "the terminal and the server afterwards");
});

test("Ctrl+Z, the deployment removed, fg: the view returns and says, in the shared home's words, that the deployment is not observed and why, with no instance drawn; it still reads keys, and q exits 0", { skip: NO_TMUX }, async (t) => {
  const world = await deployment(t); // its own: this test removes it
  const term = await terminal(t, { world });
  const run = await tui(term, {}, { world, record: false });
  term.press("C-z");
  await until(term, () => term.flags().alternate_on === "0" && term.atPrompt(), "the shell's prompt on its own screen after Ctrl+Z");
  renameSync(world.dep, `${world.dep}-gone`);

  await term.command("fg", "fg");
  await untilScreen(term, notReadFaults, "the view after fg, saying the deployment could not be read");
  assertRunningModes(term, "after fg");
  t.diagnostic(`after fg with the deployment gone the pane shows:\n${term.shows()}`);
  term.press("?");
  await until(term, () => term.screen().some((row) => row.trim() === "Keys") && term.screen().at(-1) === HELP_FOOTER, "the help, after fg with the deployment gone");
  assert.equal(run.status(), null, "it still runs");
  term.press("Escape");
  await untilScreen(term, notReadFaults, "the view again after the help was closed");

  term.press("q");
  await term.command(`echo $? > ${shq(run.statusFile)}`, "the status of fg");
  assert.equal(await run.ended("after fg and q"), 0, term.shows());
});

test("it follows the terminal's size: at 60x15 the view still draws, in one pane; below it, in either direction, one line gives the size found and the size needed; back at 80x24 the two panes return with the selection where it was; under 80 columns the detail is a page of its own", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  const run = await tui(term);
  // A detached session keeps the size it was made with, and resize-window sets window-size to
  // manual for that window itself: no server option is needed. tmux passes a pane's new size on
  // at most a few times a second, so every step here is a wait on the screen.
  const resize = (cols, rows) => { tmuxOn("resize-window", "-t", term.pane, "-x", String(cols), "-y", String(rows)); assert.equal(term.size(), `${cols}x${rows}`, "tmux resized the pane"); };
  const tooSmall = async (cols, rows) => {
    resize(cols, rows);
    const want = [tooSmallLine(cols, rows), ...Array(rows - 1).fill("")];
    await untilScreen(term, (screen) => (JSON.stringify(screen) === JSON.stringify(want) ? [] : [`the screen is not that one line and ${rows - 1} empty rows`]), `the one line of a terminal too small at ${cols}x${rows}, ${JSON.stringify(want[0])}`);
    assert.equal(run.status(), null, `oats tui still runs at ${cols}x${rows}`);
  };

  term.press("j");
  await run.view("after j", { selected: "beta" });
  resize(60, 15);
  await run.view("at 60x15, the smallest size it draws at", { cols: 60, rows: 15, selected: "beta" });
  await tooSmall(59, 15); // one column short
  await tooSmall(60, 14); // one row short
  await tooSmall(59, 14);
  resize(80, 24);
  await run.view("back at 80x24: the state was kept", { selected: "beta" });
  assertRunningModes(term, "after the resizes");

  // With the focus on the detail, a terminal under 80 columns shows the detail alone.
  term.press("Tab");
  await run.view("after Tab", { selected: "beta", detail: true, footer: DETAIL_FOOTER });
  resize(79, 24);
  const pageFaults = (screen) => [
    ...chromeFaults(screen, { cols: 79, rows: 24, look: UTF8, split: false, footer: DETAIL_FOOTER, count: 3 }),
    ...(screen[3] === " > beta" ? [] : [`row 4 is ${JSON.stringify(screen[3])}, not the detail's title`]),
    ...(screen.includes("   parent   alpha") ? [] : ["no row names the parent"]),
    ...(screen.some((row) => /\balpha +stopped$/.test(row)) ? ["a row of the list is still shown"] : []),
  ];
  await untilScreen(term, pageFaults, "the detail as a page at 79x24");
  term.press("Escape");
  await run.view("after Esc at 79x24: the list, in one pane", { cols: 79, rows: 24, selected: "beta" });

  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

let refusals = 0;
/** A pane nothing but the program writes to: no shell prompt, no readline. It waits for a line, so
 *  that the recording of what it receives starts before the program does, and for another at its
 *  end: a dead pane kept by remain-on-exit reports its cursor as off. Resolves with every byte the
 *  pane received, the status, and the terminal. */
async function bare(t, command, what) {
  const n = ++refusals;
  const statusFile = join(base, `refusal-${n}.status`), record = join(base, `refusal-${n}.bytes`);
  const term = await terminal(t, { command: `read go; ${command}; echo $? > ${shq(statusFile)}; echo tui-ended; read stay` });
  tmuxOn("pipe-pane", "-o", "-t", term.pane, `cat > ${shq(record)}`);
  const before = term.flags();
  term.press("Enter");
  await until(term, () => existsSync(record) && readFileSync(record, "utf8").includes("tui-ended"), `everything the pane received ${what}, to its end`);
  const received = readFileSync(record);
  assert.equal(received.includes(0x1b), false, `no escape byte reached the terminal ${what}: ${JSON.stringify(received.toString("latin1"))}`);
  assert.deepEqual(term.flags(), before, `no mode of the terminal changed ${what}`);
  // The terminal's echo of the Enter, the program's lines, the pane's own last word.
  return { term, status: readFileSync(statusFile, "utf8"), text: received.toString("utf8").replace(/\r/g, "") };
}

for (const [what, set] of [["TERM=dumb", "env TERM=dumb"], ["an empty TERM", "env TERM="], ["no TERM", "env -u TERM"]]) {
  test(`with ${what} on a real terminal it refuses with the E_NO_TERMINAL line and status 1, and the terminal received no escape byte and changed no mode`, { skip: NO_TMUX }, async (t) => {
    const { term, status, text } = await bare(t, `${set} ${TUI}`, `with ${what}`);
    assert.equal(status, "1\n", term.shows());
    assert.equal(text, `\n${NO_TERMINAL}\ntui-ended\n`);
    assert.ok(term.showsLine(NO_TERMINAL), `the pane shows the line:\n${term.shows()}`);
  });
}

test("outside a deployment it prints one line with E_NO_DEPLOYMENT that names the directory and --dir, with status 1, and the terminal received no escape byte and changed no mode: where it was started, for a --dir that is a file, and for one that is not there; at a shell's prompt the terminal and the server are what they were", { skip: NO_TMUX }, async (t) => {
  // Outside a deployment and with no --dir the TUI looks in ~/Agents before it gives up (the
  // test after this one). Here there is none to look in: the panes of `bare` have this worker's
  // home and the shell's terminal has the fixture's, and neither holds an `Agents`.
  for (const home of [process.env.HOME, WORLD.env.HOME]) assert.equal(existsSync(join(home, "Agents")), false, `${home} holds no Agents`);
  const file = join(base, "a-file"), missing = join(base, "not", "there");
  writeFileSync(file, "");
  for (const [what, args, dir] of [["where it was started", "", realpathSync(base)], ["for a --dir that is a file", `--dir ${shq(file)}`, file], ["for a --dir that is not there", `--dir ${shq(missing)}`, missing]]) {
    const { term, status, text } = await bare(t, `${TUI} ${args}`, what);
    assert.equal(status, "1\n", term.shows());
    assert.equal(text, `\n${noDeployment(dir)}\ntui-ended\n`, what);
  }
  const term = await terminal(t);
  const before = await term.state("before the start");
  const statusFile = join(base, `${term.id}-outside.status`);
  await term.command(`${TUI}; echo $? > ${shq(statusFile)}`, "oats tui outside a deployment");
  await until(term, () => existsSync(statusFile) && /\n$/.test(readFileSync(statusFile, "utf8")), "the status of oats tui outside a deployment");
  await term.prompt("after the refusal");
  assert.equal(readFileSync(statusFile, "utf8"), "1\n");
  assert.ok(term.showsLine(noDeployment(realpathSync(base))), `the pane shows the line:\n${term.shows()}`);
  assert.deepEqual(await term.state("after the refusal"), before, "the terminal and the server after the refusal");
});

test("started outside a deployment and with no --dir, it opens on the switcher when ~/Agents holds a deployment: the folder is listed by its name and its path under the heading for what is not opened; Enter opens it and the Instances view of that deployment is drawn, which says that it is not observed and why; w returns to the switcher, where it is now the open one; q exits 0 and the terminal is what it was. With an ~/Agents that holds no deployment, and with a --dir that is in no deployment, it prints the E_NO_DEPLOYMENT line as before", { skip: NO_TMUX }, async (t) => {
  // A home of the test's own, for its terminals only. test/helpers/v2-deployment.mjs makes a
  // deployment in a base of its own and nowhere else, so the folder holds only a regular
  // `oats-local.yaml` (the fixture deployment's own): a deployment for the switcher, which reads
  // nothing of a folder but that file's existence, and one the kernel cannot read once it is opened.
  const home = join(base, "home-with-agents"), folder = join(home, "Agents", "acme-ledger"), here = realpathSync(base);
  mkdirSync(folder, { recursive: true });
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const refused = async (args, what) => {
    const { term, status, text } = await bare(t, `env HOME=${shq(home)} ${TUI} ${args}`, what);
    assert.equal(status, "1\n", term.shows());
    assert.equal(text, `\n${noDeployment(here)}\ntui-ended\n`, what);
  };
  await refused("", "with an ~/Agents whose one folder is no deployment");
  writeFileSync(join(folder, "oats-local.yaml"), readFileSync(join(WORLD.dep, "oats-local.yaml")));
  // What was asked for is not there: a --dir is never answered with the switcher.
  await refused(`--dir ${shq(here)}`, "for a --dir in no deployment, with a deployment in ~/Agents");

  await leavesTheTerminalIntact(t, {
    how: "q in the switcher of a run started outside a deployment", status: 0, env: { HOME: home }, leave: (term) => term.press("q"),
    // Nothing is open yet: Esc has no view to close the switcher onto, and the footer does not offer it.
    start: { args: "", first: (run) => run.switcher("at the start", { open: false, body: [OFFERED, choice("acme-ledger", "~/Agents/acme-ledger", { selected: true })] }) },
    arrive: async (term, run) => {
      term.press("Enter");
      // The view of that deployment: its folder's name in the header, and the state and the
      // reason of a deployment that was not read, which are the shared home's words.
      await untilScreen(term, (screen) => notReadFaults(screen, { title: /^ acme-ledger$/, reason: 4 }), "the Instances view of the folder's deployment after Enter");
      assert.equal(run.status(), null, "oats tui still runs after Enter");
      term.press("w");
      // It is served now, so it is no folder to open: it is this run's one workspace, which the
      // shared home lists by its machine and a short reason, under its heading for what it
      // matched to no workspace.
      await run.switcher("after w", { body: [UNMATCHED, choiceLike("acme-ledger", "This machine \\S+ \\S.*", { selected: true, open: true })] });
      return []; // no read is held
    },
  });
});

test("what follows a typed command is found on the pane whether the typed line ends one cell short of its row, fills it exactly or runs one cell over: a line the command prints, and the prompt after a command that prints nothing. Where the typed line fills its row, the joined capture has what follows on the command's own row, and no row equal to it", { skip: NO_TMUX }, async (t) => {
  const cols = 80;
  // What prints a line, and the line: it is put together by printf, so it is nowhere in what is
  // typed. The second is longer than the pane and wraps by itself. The third prints nothing.
  const short = ["printf '%s%s\\n' shown -by-the-command", "shown-by-the-command"], long = [`printf '%0${cols + 20}d\\n' 7`, `${"0".repeat(cols + 19)}7`], silent = [":", null];
  // The length of the typed line, prompt included, and what it prints.
  const cases = [[cols - 1, short], [cols, short], [cols + 1, short], [2 * cols, short], [cols - 1, long], [cols, long], [cols - 1, silent], [cols, silent], [cols + 1, silent], [2 * cols, silent]];
  for (const [n, [length, [print, line]]] of cases.entries()) {
    const what = `a typed line of ${length} cells in ${cols} columns that prints ${line === null ? "nothing" : `${line.length} cells`}`;
    const done = join(base, `typed-${n}.done`);
    const term = await terminal(t, { cols, env: { DONE: done } });
    // The rest of the typed line is a comment: the command prints that line and nothing else.
    const text = `${print}; : > "$DONE"; #`.padEnd(length - PROMPT.length - 1, "x");
    assert.equal(`${PROMPT} ${text}`.length, length, `${what}: the command fits the length asked for`);
    await term.command(text, what);
    await until(term, () => existsSync(done), `the command to end, ${what}`);
    await term.prompt(`after ${what}`);
    const rows = term.joined(), fills = length % cols === 0, next = line ?? PROMPT;
    const pane = `\n${rows.join("\n")}`;
    if (fills) {
      // What the second way of both helpers is for. A tmux or a shell that does not do this
      // fails here: on such a host this case would test nothing of it.
      assert.equal(rows.includes(`${PROMPT} ${text}`), false, `${what}: the typed line fills its row, and the joined capture was expected to have what follows on that row, not on one of its own. This tmux or this shell does not join them, so this case cannot test what it is for:${pane}`);
      assert.equal(rows.includes(`${PROMPT} ${text}${next}`), true, `${what}: the joined row is the prompt, what was typed and what follows:${pane}`);
      if (line !== null) assert.equal(rows.includes(line), false, `${what}: the printed line is no row of its own:${pane}`);
    } else {
      assert.equal(rows.includes(`${PROMPT} ${text}`), true, `${what}: the typed line is a joined row of its own:${pane}`);
      if (line !== null) assert.equal(rows.includes(line), true, `${what}: the printed line is a joined row of its own:${pane}`);
    }
    assert.equal(term.promptFollowsTyped(), line === null, `${what}: the prompt follows what was typed, with nothing between, only where nothing was printed:\n${term.shows()}`);
    assert.equal(term.showsLine(text), false, `${what}: what was typed is not a line the command printed`);
    if (line !== null) {
      assert.equal(text.includes(line), false);
      assert.equal(term.showsLine(line), true, `${what}: the pane shows the line:\n${term.shows()}`);
      // Only a whole line: not a part of one.
      assert.equal(term.showsLine(line.slice(1)), false, `${what}: a part of the line is not the line`);
      assert.equal(term.showsLine(line.slice(0, -1)), false, `${what}: a part of the line is not the line`);
    }
    term.kill();
  }
});

test("started in an agent's pane, in the instance's home and with the variables of an instance session set, it shows the deployment that home is in, and no child of a read sees one of them; with one of the two that name a captured context the kernel refuses the word as it refuses every command, before anything is drawn", { skip: NO_TMUX }, async (t) => {
  // Each names another place: a kernel that ran with them would answer for that place, or refuse.
  // Two of the eight name a captured context, which bin/oats.mjs refuses for every command but
  // `version` before the command runs: the TUI never starts with those, and they are the last part
  // of this test. (That it removes all eight is packages/tui/test/read.test.mjs's.)
  const CAPTURED = ["OATS_RESOLUTION", "OATS_DEPLOYMENT"];
  const stray = Object.fromEntries(INSTANCE_VARIABLES.filter((name) => !CAPTURED.includes(name)).map((name) => [name, join(base, "elsewhere", name.toLowerCase())]));
  const term = await terminal(t, { cwd: WORLD.home, env: stray });
  const shellEnv = join(base, `${term.id}-shell.env`);
  await term.command(`env > ${shq(shellEnv)}; echo written`, "env in the pane's shell");
  await until(term, () => term.screen().includes("written") && term.atPrompt(), "the shell's environment, written down");
  for (const name of Object.keys(stray)) assert.ok(lines(readFileSync(shellEnv, "utf8")).includes(`${name}=${stray[name]}`), `the pane's shell has ${name}`);

  rmSync(WORLD.seenFile, { force: true });
  const run = await tui(term, {}, { args: "" }); // no --dir: the deployment is found from the home
  // The view is drawn from a read whose collector ran its tmux, which wrote its environment down.
  await until(term, () => existsSync(WORLD.seenFile) && /(^|\n)PATH=/.test(readFileSync(WORLD.seenFile, "utf8")), "the environment the collector's tmux was started with");
  const seen = lines(readFileSync(WORLD.seenFile, "utf8")).map((line) => line.split("=")[0]);
  assert.deepEqual(INSTANCE_VARIABLES.filter((name) => seen.includes(name)), [], "no instance variable reached a child's child");
  assert.ok(seen.includes("HOME") && seen.includes("OATS_HOME_DIR"), "the rest of the environment did");
  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());

  for (const name of CAPTURED) {
    const refused = await bare(t, `env ${name}=${shq(join(base, "elsewhere"))} ${TUI} --dir ${shq(WORLD.dep)}`, `with ${name} set`);
    assert.equal(refused.status, "1\n", refused.term.shows());
    assert.match(refused.text, new RegExp(`^\\noats: this environment carries a captured context \\(${name}\\): [^\\n]+\\ntui-ended\\n$`), `the kernel's own refusal, on one line, with ${name} set`);
  }
});

test("tui.json is honoured: the key it gives an action is that action's key in the footer, in the help and at the keyboard, and the default it replaced is no key; a file the TUI cannot use is named on stderr with E_TUI_CONFIG, status 1, and nothing is drawn", { skip: NO_TMUX }, async (t) => {
  const good = join(base, "config-good"), bad = join(base, "config-bad");
  for (const [dir, value] of [[good, { keys: { quit: ["x"] } }], [bad, { keys: { fly: ["x"] } }]]) {
    mkdirSync(join(dir, "oats"), { recursive: true });
    writeFileSync(join(dir, "oats", "tui.json"), JSON.stringify(value));
  }
  const term = await terminal(t, { env: { XDG_CONFIG_HOME: good } });
  const run = await tui(term, { footer: FOOTER.replace("q quit", "x quit") });
  term.press("q"); // no key now: read, and nothing happens
  term.press("?");
  // At 80x24 the help's first page ends forty-eight rows above `quit`: the table holds the three
  // views, `workspaces`, `open` three times with the agent's terminal in nine rows and the Souls
  // view's in two, `soul-instances`, `zoom` in two, `close-terminal` in two, `tab-previous` and
  // `tab-next`, the split's five in eight rows (`split-right`, `split-down` and `group-next` in two
  // each, `tab-move` and `group-close` in one), the four acts in six rows with the two rules of a
  // confirmation in four under them, and the spawn's three in nine rows (`spawn` in four,
  // `spawn-another` in three, `spawn-check` in two) (HELP_KEYS); the movement keys scroll the help,
  // and forty-eight rows down show it.
  for (let i = 0; i < 48; i++) term.press("j");
  await until(term, () => term.screen().some((row) => /^ *x {2,}quit$/.test(row)) && term.screen().at(-1) === HELP_FOOTER.replace("q quit", "x quit"), "the help with x as the quit key, after a q that did not quit");
  assert.equal(term.screen().some((row) => /^ *q\b.* quit$/.test(row)), false, `q is no key of quit:\n${term.shows()}`);
  term.press("Escape");
  await run.view("after the help was closed");
  term.press("x");
  assert.equal(await run.ended("after x"), 0, term.shows());

  const refused = await bare(t, `env XDG_CONFIG_HOME=${shq(bad)} ${TUI} --dir ${shq(WORLD.dep)}`, "with a tui.json that names an action there is none of");
  assert.equal(refused.status, "1\n", refused.term.shows());
  const said = refused.text.split("\n").filter(Boolean);
  assert.equal(said.length, 2, refused.text);
  assert.ok(said[0].startsWith(`oats: \`oats tui\` cannot use ${join(bad, "oats", "tui.json")}: `) && said[0].endsWith(" (E_TUI_CONFIG)") && said[0].includes("fly"), said[0]);
  assert.equal(said[1], "tui-ended");
});

test("a bracketed paste outside the filter field is dropped whole: a pasted q does not quit, nor does a longer paste with q and a newline in it; into the open field its first line is the filter's text, a line the display filter would change adds nothing, and nothing of a paste is a key; a typed q then quits with status 0", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  const run = await tui(term);
  // -p pastes between the bracket codes only when the pane's program asked for them: it did.
  const paste = (text) => { tmuxOn("set-buffer", "-b", `${term.id}-paste`, text); tmuxOn("paste-buffer", "-d", "-p", "-b", `${term.id}-paste`, "-t", term.pane); };

  paste("q");
  term.press("?"); // input is read in order: once the help is open, the paste before it was read
  await run.help("after a pasted q, then ?");
  term.press("?");
  await run.view("after the help was closed");

  paste("quit q\n?q\x03");
  term.press("?");
  await run.help("after a longer paste, then ?");
  term.press("Escape");
  await run.view("after the pastes");
  assertRunningModes(term, "after the pastes");

  term.press("/");
  await run.view("after /", { footer: /^C-\\ commands {3}\/ +Enter keep {3}Esc clear$/ });
  paste("gam\nq\n");
  await run.view("after a paste into the field: its first line", { selected: "gamma", gone: ["alpha", "beta"], footer: /^C-\\ commands {3}\/gam +Enter keep {3}Esc clear$/ });
  paste("\u202Ema"); // a bidi override: the display filter replaces it
  term.press("Enter"); // read after the paste: the footer shows what the field held then
  await run.view("after a paste the display filter would change, then Enter: nothing was added", { selected: "gamma", gone: ["alpha", "beta"], footer: /^C-\\ commands {3}\/gam +\/ filter {3}Tab detail {3}\? help {3}q quit$/ });
  term.press("Escape");
  await run.view("after Esc cleared the filter", { selected: "gamma" });

  term.press("q");
  assert.equal(await run.ended("after a typed q"), 0, term.shows());
});

test("Ctrl+L takes the terminal again: after the screen and the modes were reset from outside the program, the view is complete, the modes are the TUI's again and a paste is still not keys", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  const run = await tui(term);
  // `send-keys -R` resets the pane's terminal state inside tmux: the screen is cleared without the
  // program writing or knowing, so a program that only writes what changed would leave it empty.
  tmuxOn("send-keys", "-R", "-t", term.pane);
  assert.deepEqual(term.screen().filter(Boolean), [], `${TMUX_VERSION} wiped the pane's screen`);
  term.press("C-l");
  await run.view("after Ctrl+L on a wiped screen");
  // tmux's reset also put the pane's modes back to a terminal's defaults (cursor shown, autowrap
  // on, bracketed paste off): Ctrl+L sets the TUI's own again, so a paste cannot act as keys.
  assertRunningModes(term, `after ${TMUX_VERSION}'s reset and Ctrl+L`);
  tmuxOn("set-buffer", "-b", `${term.id}-paste`, "q");
  tmuxOn("paste-buffer", "-d", "-p", "-b", `${term.id}-paste`, "-t", term.pane);
  term.press("C-l");
  term.press("?");
  await run.help("after another Ctrl+L, then ?");
  term.press("C-l");
  term.press("Escape");
  await run.view("after Ctrl+L with the help open, then Esc");

  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

test("in a locale that is not UTF-8 the view's rules and marks are ASCII, and the keys, the help and q work the same", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t, { locale: ASCII.locale });
  const run = await tui(term, { look: ASCII });
  const screen = term.screen();
  assert.equal(screen[2], `${"-".repeat(38)}+${"-".repeat(41)}`);
  assert.equal(screen[22], `${"".padEnd(38)}|`, "no rule over the footer: the line between the panes reaches it");
  assert.equal(screen[3].slice(0, 38).trimEnd(), "> - alpha");
  assert.equal(screen.some((row) => /[^\x20-\x7e]/.test(row)), false, `every character on the screen is printable ASCII:\n${term.shows()}`);
  term.press("h");
  await run.view("after h in an ASCII locale: collapsed", { folded: true });
  assert.equal(term.screen().some((row) => /[^\x20-\x7e]/.test(row)), false, `every character on the screen is printable ASCII:\n${term.shows()}`);
  term.press("?");
  await run.help("in an ASCII locale");
  term.press("Escape");
  await run.view("after the help was closed", { folded: true });
  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});

test("the Souls view, with the real `oats souls`: the leader then 2 shows the workspace's souls, each with its instances here counted; Enter shows the selected soul's detail; i shows its instances in the Instances view, filtered by that soul and said so in the footer; Esc clears the filter; q exits 0", { skip: NO_TMUX }, async (t) => {
  const term = await terminal(t);
  const run = await tui(term);
  const footer = () => term.screen().at(-1) ?? "";
  const row = (name) => term.screen().find((line) => new RegExp(`^[> ] ■ ${name}\\b`).test(line)) ?? null;
  term.press("C-\\");
  await until(term, () => footer().startsWith("C-\\   k palette"), "the leader's hint");
  term.press("2");
  await until(term, () => row("dev") !== null && row("reviewer") !== null, "the souls, read with `oats souls`");
  assert.match(row("dev"), /^[> ] ■ dev ·2(?: |│|$)/, "dev has alpha and beta here");
  assert.match(row("reviewer"), /^[> ] ■ reviewer ·1(?: |│|$)/, "reviewer has gamma");
  assert.equal(term.screen()[1].includes("Souls"), true);
  // Move to dev, wherever soulRows sorts it.
  if (!row("dev").startsWith(">")) { term.press("k"); await until(term, () => row("dev")?.startsWith(">"), "dev selected"); }
  term.press("Enter");
  await until(term, () => footer().includes("Enter instances"), "the detail holds the focus: Enter shows the soul's instances");
  const detail = () => term.screen().slice(3, -1).map((line) => line.split("│")[1] ?? "");
  assert.equal(detail()[0].trimEnd(), " > dev", `the detail is dev's, with the focus:\n${term.shows()}`);
  assert.equal(detail().some((line) => line.trim() === "○ alpha  ○ beta"), true, `its instances here, with their marks:\n${term.shows()}`);
  term.press("i");
  await until(term, () => footer().startsWith(`${LEAD}soul dev `), "the Instances view, filtered by dev");
  const shown = () => term.screen().slice(3, -1).map((line) => line.split("│")[0]).join("\n");
  assert.match(shown(), /alpha/);
  assert.match(shown(), /beta/);
  assert.doesNotMatch(shown(), /gamma/, "the reviewer's instance is not dev's");
  term.press("Escape");
  await until(term, () => /gamma/.test(shown()) && !footer().includes("soul dev"), "Esc clears the soul filter");
  term.press("q");
  assert.equal(await run.ended("after q"), 0, term.shows());
});
