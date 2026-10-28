// The panel (lib/panel.mjs): the private tmux server of a run, its control client, the viewer in
// a window of it, frames, keys, and the sweep of what a crashed run left. Against a FAKE tmux
// (fixtures/panel/tmux.mjs) behind a shell wrapper in a temp directory: it records every call and
// plays a control client the test drives. No test here starts a real tmux.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { execFile as nodeExecFile, execFileSync, spawn } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import os from "node:os";
import { PassThrough } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEAD_WAIT_MS, FRAME_MS, REAP_ASK_MS, STATUS_WAIT_MS, KEEPER_SCRIPT, MAX_SHOWN, MAX_TERMINALS, PANEL_FS, SESSION, STDERR_KEPT, VIEW_SCRIPT, controlWord, createPanel, startCommands, sweep, tmuxArgument } from "../lib/panel.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/panel/tmux.mjs", import.meta.url));
const ROOT = realpathSync(mkdtempSync(path.join(os.tmpdir(), "panel-test-")));
const panels = [], worlds = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(what, check, ms = 5000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(5);
  }
}
/** Whether the pid runs the fake now (its command line names the fixture). */
const isFake = (pid) => { try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(FAKE); } catch { return false; } };
const ownGroup = () => { try { const stat = readFileSync("/proc/self/stat", "utf8"); return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]); } catch { return null; } };

test.after(() => {
  for (const panel of panels) panel.end();
  // Nothing is left behind: a fake that still runs is ended, by the pid it wrote down.
  for (const world of worlds) for (const { pid } of world.calls()) if (isFake(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  rmSync(ROOT, { recursive: true, force: true });
});

/** A temp directory with the fake tmux, its plan, and a run directory (0700) for the panel. */
function makeWorld(plan = {}) {
  const dir = path.join(ROOT, `w${worlds.length + 1}`), fake = path.join(dir, "fake"), run = path.join(dir, "run");
  mkdirSync(fake, { recursive: true });
  mkdirSync(run);
  chmodSync(run, 0o700);
  const tmux = path.join(fake, "tmux");
  writeFileSync(tmux, `#!/bin/sh\nFAKE_TMUX_HOME='${fake}' exec '${process.execPath}' '${FAKE}' "$@"\n`);
  chmodSync(tmux, 0o755);
  const world = {
    dir, fake, run, tmux, socket: path.join(run, "tmux"),
    // Written whole, then renamed into place: the fake reads plan.json at every command, and a
    // read between the truncation and the write of a plain rewrite fails to parse and ends it.
    plan(next) { writeFileSync(path.join(fake, "plan.json.new"), JSON.stringify(next)); renameSync(path.join(fake, "plan.json.new"), path.join(fake, "plan.json")); },
    // Whole lines only: the last one may be in the middle of being written by the fake.
    calls() { const log = path.join(fake, "calls.jsonl"); return existsSync(log) ? readFileSync(log, "utf8").split("\n").slice(0, -1).filter(Boolean).map((line) => JSON.parse(line)) : []; },
    invocations() { return world.calls().filter((call) => call.argv); },
    control() { return world.calls().filter((call) => call.control !== undefined).map((call) => call.control); },
    windows() { return world.calls().filter((call) => call.window !== undefined); },
    inject(line) { appendFileSync(path.join(fake, "inject.txt"), `${line}\n`); },
    emit(line) { world.inject(`emit ${line}`); },
    done() { const file = path.join(fake, "emitted.txt"); return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []; },
  };
  world.plan(plan);
  worlds.push(world);
  return world;
}
/** Timers that fire when the test says so: the panel's frame tick, and a dead viewer's wait for its
 *  status and its asks to reap. fire(ms) fires those of that delay only; fire() all. */
function frameTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout(fn, ms) { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    get count() { return pending.size; },
    delays() { return [...pending.values()].map((t) => t.ms); },
    fire(ms) {
      const all = [...pending].filter(([, t]) => ms === undefined || t.ms === ms);
      for (const [id] of all) pending.delete(id);
      for (const [, t] of all) t.fn();
    },
  };
}
/** A panel over a world, recording what it says, and what its control clients printed as the
 *  panel reads it (`heard()`): a listener of the same stream, added before the panel's own, so a
 *  line in it has reached the panel too. That the fake WROTE a line (world.done()) does not mean
 *  the panel has read it yet. */
function panelOf(world, more = {}) {
  const timers = frameTimers(), screens = [], closed = [], captured = [], heard = [];
  const listening = (...args) => { const child = spawn(...args); child.stdout?.on("data", (chunk) => heard.push(chunk.toString("utf8"))); return child; };
  const panel = createPanel({
    spawn: listening, dir: () => world.run, tmux: world.tmux, timers, pid: 4242, clock: () => "2026-10-15T00:00:00.000Z",
    env: { ...process.env, TMUX: "/tmp/tmux-1000/default,1,0", TMUX_PANE: "%7" },
    capture: (text, size) => { captured.push({ text, size }); return { built: text, size }; },
    onScreen: (event) => screens.push(event), onClosed: (event) => closed.push(event), ...more,
  });
  panels.push(panel);
  return { panel, timers, screens, closed, captured, heard: () => heard.join("") };
}
const VIEWER = [process.execPath, "/opt/oats/bin/oats.mjs", "session", "attach", "--home", "/home/agent"];
/** What tmux's subscription prints for the pane of window `id` once it is dead (the fake's pane
 *  and window share their number): `status` empty when a signal ended it. */
/** The dead-pane subscription's line for a viewer's window: its exit status, or the signal that
 *  ended it; neither while tmux has no status yet. */
/** The panes the control client paused or continued, in order (`%1:pause`, …: THE OUTPUT OF A TAB
 *  NOT DRAWN). */
const flows = (world) => world.control().map((line) => /^refresh-client -A '(%\d+:(?:continue|pause))'$/.exec(line)?.[1]).filter(Boolean);
const dead = (id, status = "", signal = "") => `%subscription-changed oats-tui-dead $0 ${id} ${id.slice(1)} %${id.slice(1)} : 1 ${status} ${signal}`;
/** A panel with one viewer open and its first (fresh) capture drawn: everything settled. */
async function opened(plan = {}, more = {}) {
  const world = makeWorld(plan), made = panelOf(world, more);
  const { id } = await made.panel.open({ argv: VIEWER, cols: 50, rows: 10 });
  await waitFor("the first capture", () => made.screens.length === 1);
  return { world, id, ...made };
}
const count = (lines, prefix) => lines.filter((line) => line.startsWith(prefix)).length;

// Every test has a world of its own (its fake, its run directory, its timers), so they run side by
// side: each open starts four short processes of the fake. The one test that changes the
// process's own listeners runs alone, after them.
describe("the panel", { concurrency: 8 }, () => {
  test("the first open starts one private server: its version, then the control client starting the server with exit-unattached right after the session and every option, in ONE command list; nothing is sent before the list is answered", async () => {
    const world = makeWorld({ startDelayMs: 150 }), { panel } = panelOf(world);
    const { id } = await panel.open({ argv: VIEWER, cols: 50, rows: 10 });
    assert.equal(id, "@1");
    assert.equal(panel.current, "@1");
    const calls = world.invocations();
    const shape = (call) => (call.flags.includes("-V") ? "version" : call.commands.map((command) => command[0]).join(","));
    assert.deepEqual(calls.map(shape), ["version",
      "new-session,set-option,set-option,set-option,set-option,set-option,set-option,set-option,refresh-client,unbind-key,unbind-key,unbind-key,unbind-key",
      "set-option,new-window"]);
    assert.ok(calls[1].flags.includes("-C"), "the server is started by the control client itself");
    // Every call: -u, no configuration, the run's own socket; never TMUX or TMUX_PANE.
    for (const call of calls) {
      assert.deepEqual(call.flags.slice(0, 5), ["-u", "-f", "/dev/null", "-S", world.socket], call.argv.join(" "));
      assert.deepEqual(call.env, { TMUX: false, TMUX_PANE: false, PATH: true });
    }
    // The session (which attaches the client that made it) first, exit-unattached at once after it:
    // never before, which would end the server before any client is attached, and never in a call
    // of its own, which a TUI killed in between would leave out (the server would live on).
    const alive = path.join(world.run, "alive");
    assert.deepEqual(calls[1].commands, [
      ["new-session", "-s", SESSION, "-x", "80", "-y", "24", "/bin/sh", "-c", KEEPER_SCRIPT, "oats-tui-keeper", alive],
      ["set-option", "-s", "exit-unattached", "on"],
      ["set-option", "-s", "escape-time", "0"], ["set-option", "-g", "status", "off"], ["set-option", "-g", "prefix", "None"], ["set-option", "-g", "prefix2", "None"],
      ["set-option", "-gw", "remain-on-exit", "on"], ["set-option", "-gwq", "remain-on-exit-format", ""],
      ["refresh-client", "-B", "oats-tui-dead:%*:#{pane_dead} #{pane_dead_status} #{pane_dead_signal}"],
      ["unbind-key", "-a"], ["unbind-key", "-a", "-T", "root"], ["unbind-key", "-a", "-T", "copy-mode"], ["unbind-key", "-a", "-T", "copy-mode-vi"]]);
    assert.deepEqual(calls[1].commands, startCommands({ alive }));
    // No global window-size: tmux 3.3a to 3.5a crash in the next new-window when it is manual (CI's
    // 3.4 did). Each viewer's window is made manual by its own resize-window.
    assert.equal(calls[1].commands.some((command) => command.includes("window-size")), false, "no global window-size");
    // The keeper's FIFO is made, 0600, and its write end held, BEFORE the server starts: a keeper
    // that finds no writer means the TUI is gone, never that it has not come yet.
    assert.deepEqual(world.calls().find((call) => "alive" in call).alive, { fifo: true, mode: 0o600, held: true });
    assert.equal(calls.filter((call) => call.commands.flat().includes("exit-unattached")).length, 1, "only in the start list");
    // Nothing on stdin before the start list was answered; the first command is the viewer's.
    const log = world.calls(), startedAt = log.findIndex((call) => call.started), firstSent = log.findIndex((call) => call.control !== undefined);
    assert.ok(startedAt >= 0 && (firstSent < 0 || firstSent > startedAt), "nothing sent before the start's blocks");
    assert.equal(world.control().includes("set-option -s exit-unattached on"), false);
    // The control client is in a process group of its own: the TUI's Ctrl+Z does not stop it.
    const group = ownGroup();
    if (group !== null) assert.notEqual(calls[1].pgid, group);
    panel.end();
  });

  test("owner.json marks the run directory (0600, its tool, the TUI's pid, the time), and the viewer's stderr file exists, 0600 and empty, before its window is made", async () => {
    const { world, panel } = await opened();
    const owner = path.join(world.run, "owner.json");
    assert.deepEqual(JSON.parse(readFileSync(owner, "utf8")), { tool: "oats-tui", pid: 4242, started: "2026-10-15T00:00:00.000Z" });
    assert.equal(statSync(owner).mode & 0o777, 0o600);
    assert.equal(statSync(world.run).mode & 0o777, 0o700, "the directory is the caller's, as it made it");
    const [window] = world.windows();
    assert.deepEqual(window.e, { E: path.join(world.run, "1.view.err") });
    assert.deepEqual(window.files, { E: { mode: 0o600, size: 0 } });
    panel.end();
  });

  test("the viewer's command is the constant script with the viewer's argv after it: a row's text (a quote, $(…), ;, #{…}, a newline, a trailing ;) arrives as the same argv element and never in the script", async () => {
    const hostile = "/home/o'brien $(touch /tmp/x); `id` #{pane_id} #[fg=red]\nnext;";
    const argv = [process.execPath, "/opt/oats/bin/oats.mjs", "session", "attach", "--home", hostile, ";", "kill-server;", "-x", "x\\;"];
    const world = makeWorld(), { panel } = panelOf(world);
    await panel.open({ argv, cols: 50, rows: 10 });
    const [window] = world.windows();
    // As tmux splits its arguments (the fake does it the same way), the command is ours, whole.
    assert.deepEqual(window.command, ["/bin/sh", "-c", VIEW_SCRIPT, ...argv]);
    // exec: the viewer is the pane's own process, so the pane's hang-up reaches it at once.
    assert.equal(VIEW_SCRIPT, 'exec "$0" "$@" 2>"$E"');
    assert.equal(window.target, `${SESSION}:`);
    assert.equal(window.format, "#{window_id} #{pane_id}");
    const call = world.invocations().find((c) => c.commands.some((command) => command[0] === "new-window"));
    assert.deepEqual(call.commands.map((command) => command[0]), ["set-option", "new-window"], "no command was made of a row's text");
    assert.deepEqual(call.commands[0], ["set-option", "-t", SESSION, "default-size", "50x10"]);
    panel.end();
  });

  test("tmuxArgument escapes only a trailing ; and tmux reads it back as it was", () => {
    assert.equal(tmuxArgument("plain"), "plain");
    assert.equal(tmuxArgument("a;b"), "a;b");
    assert.equal(tmuxArgument("x;"), "x\\;");
    assert.equal(tmuxArgument(";"), "\\;");
    assert.equal(tmuxArgument("x\\;"), "x\\\\;");
  });

  test("no poll timer: idle, nothing is armed; the open pane's %output arms one tick of FRAME_MS and the capture follows it; another pane's output arms nothing", async () => {
    const { world, panel, timers, screens, id, heard } = await opened();
    assert.equal(timers.count, 0, "idle: no timer");
    world.emit("%output %9 another pane");
    world.emit("%output %1 hello");
    await waitFor("the tick", () => timers.count === 1);
    assert.deepEqual(timers.delays(), [FRAME_MS]);
    world.emit("%output %1 more");
    await waitFor("the panel to hear it all", () => heard().includes("%output %1 more\n"));
    assert.equal(timers.count, 1, "a burst arms one tick");
    timers.fire();
    await waitFor("the capture", () => screens.length === 2);
    assert.equal(screens[1].id, id);
    assert.equal(timers.count, 0, "idle again: no timer");
    assert.equal(count(world.control(), "capture-pane"), 2, "the one at open, the one the output asked for");
    world.emit(`%layout-change ${id} fa5e,50x10,0,0,1 fa5e,50x10,0,0,1 *`);
    await waitFor("the tick of a layout change", () => timers.count === 1);
    panel.end();
  });

  test("one capture in flight: output during a capture marks the screen stale and exactly one more capture follows it", async () => {
    const { world, panel, timers, screens, heard } = await opened();
    world.plan({ holdCapture: true });
    world.emit("%output %1 a");
    await waitFor("the tick", () => timers.count === 1);
    timers.fire();
    await waitFor("the capture asked", () => count(world.control(), "capture-pane") === 2);
    for (const n of [1, 2, 3]) world.emit(`%output %1 burst ${n}`);
    await waitFor("the panel to hear the burst", () => heard().includes("%output %1 burst 3\n"));
    assert.equal(timers.count, 0, "no tick while a capture is in flight");
    assert.equal(count(world.control(), "capture-pane"), 2);
    world.inject("release");
    await waitFor("the held capture drawn", () => screens.length === 2);
    assert.equal(timers.count, 1, "the burst arms the next tick after it");
    timers.fire();
    await waitFor("the next capture asked", () => count(world.control(), "capture-pane") === 3);
    world.inject("release");
    await waitFor("the last capture drawn", () => screens.length === 3);
    assert.equal(timers.count, 0);
    assert.equal(count(world.control(), "capture-pane"), 3, "exactly one more");
    panel.end();
  });

  test("a capture, out of band: capture-pane -e -N into the one buffer, save-buffer to <run dir>/capture, delete-buffer, and the cursor, four lines of the control client; the file's lines handed to the caller's capture with the size", async () => {
    const { world, panel, screens, captured, id } = await opened();
    const file = path.join(world.run, "capture");
    assert.deepEqual(world.control(), ["resize-window -t @1 -x 50 -y 10", "capture-pane -e -N -b oats-tui-capture -t %1", `save-buffer -b oats-tui-capture '${file}'`, "delete-buffer -b oats-tui-capture", "display -p -t %1 '#{cursor_x} #{cursor_y} #{cursor_flag}'"]);
    assert.deepEqual(captured, [{ text: "screen 1\n%end 1 2 1\nlast", size: { cols: 50, rows: 10 } }]);
    assert.deepEqual(screens, [{ id, screen: { built: "screen 1\n%end 1 2 1\nlast", size: { cols: 50, rows: 10 } }, cursor: { x: 3, y: 4, visible: true } }]);
    assert.equal(readFileSync(file, "utf8"), "screen 1\n%end 1 2 1\nlast\n", "the file as tmux writes it: each line with its newline");
    panel.end();
  });

  test("a pane that prints its capture's own block end and begin, %exit and its window's end, each exact: no freeze, no close, its lines drawn as they are, and the next frame right", async () => {
    const forged = ["{end}", "{begin}", "%exit", "%window-close @1", "%unlinked-window-close @1", "after"];
    const { world, panel, timers, screens, captured, closed, id } = await opened({ screen: forged });
    const first = captured[0].text.split("\n");
    assert.match(first[0], /^%end \d+ \d+ 1$/);
    assert.match(first[1], /^%begin \d+ \d+ 1$/);
    assert.deepEqual(first.slice(2), forged.slice(2));
    world.plan({ screen: ["the next frame"] });
    world.emit("%output %1 more");
    await waitFor("the tick", () => timers.count === 1);
    timers.fire();
    await waitFor("the next frame", () => screens.length === 2);
    assert.equal(captured[1].text, "the next frame");
    assert.deepEqual([closed, panel.current], [[], id]);
    panel.end();
  });

  test("a pane gone between the send and the run: one failed capture (no frame, the buffer's commands fail as tmux's own words), then the viewer's close handled as usual, the control client kept", async () => {
    const { world, panel, timers, screens, closed, id } = await opened();
    world.plan({ paneGone: true });
    world.emit("%output %1 last words");
    await waitFor("the tick", () => timers.count === 1);
    timers.fire();
    await waitFor("the close", () => closed.length === 1);
    assert.deepEqual(closed[0], { id, status: null, stderr: "", asked: false });
    assert.equal(screens.length, 1, "no frame of the failed capture");
    world.plan({});
    assert.deepEqual(await panel.open({ argv: VIEWER, cols: 50, rows: 10 }), { id: "@2" });
    assert.equal(world.invocations().filter((call) => call.flags.includes("-C")).length, 1, "the same control client");
    panel.end();
  });

  test("a capture's file missing, larger than the panel reads, or a FIFO: no frame, no throw and no wait; the next change draws", async () => {
    const { world, panel, timers, screens, heard } = await opened();
    const blocks = () => (heard().match(/^%(end|error) /gm) ?? []).length;
    for (const captureFile of ["missing", "huge", "fifo"]) {
      world.plan({ captureFile });
      const before = blocks();
      world.emit(`%output %1 ${captureFile}`);
      await waitFor("the tick", () => timers.count === 1);
      timers.fire();
      await waitFor("the capture's four blocks", () => blocks() === before + 4);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(screens.length, 1, captureFile);
    }
    world.plan({});
    world.emit("%output %1 again");
    await waitFor("the tick", () => timers.count === 1);
    timers.fire();
    await waitFor("the frame", () => screens.length === 2);
    panel.end();
  });

  test("PANEL_FS.whole, in a child given 5 s: a regular file within its bound as text; null for one too large, a directory, a FIFO (never waited on), and a link (never followed); a missing path throws", async () => {
    const dir = mkdtempSync(path.join(ROOT, "whole-"));
    writeFileSync(path.join(dir, "file"), "a\nb\n");
    writeFileSync(path.join(dir, "large"), "x".repeat(11));
    mkdirSync(path.join(dir, "dir"));
    execFileSync("mkfifo", ["-m", "600", path.join(dir, "fifo")]);
    symlinkSync(path.join(dir, "file"), path.join(dir, "link"));
    // A module of its own, importing the panel statically (the package uses no dynamic import).
    const child = path.join(dir, "child.mjs");
    writeFileSync(child, [`import { PANEL_FS } from ${JSON.stringify(new URL("../lib/panel.mjs", import.meta.url).href)};`, "const out = {};",
      `for (const name of ["file", "large", "dir", "fifo", "link", "missing"]) { try { out[name] = PANEL_FS.whole(${JSON.stringify(dir)} + "/" + name, 10); } catch (error) { out[name] = error.code; } }`,
      "console.log(JSON.stringify(out));"].join("\n"));
    const answer = JSON.parse(execFileSync(process.execPath, [child], { encoding: "utf8", timeout: 5000 }));
    assert.equal(answer.file, "a\nb\n");
    assert.deepEqual([answer.large, answer.dir, answer.fifo], [null, null, null]);
    assert.ok(answer.link === null || answer.link === "ELOOP", `a link is not followed: ${answer.link}`);
    assert.equal(answer.missing, "ENOENT");
  });

  test("fail closed: a block that answers with words its command does not say ends the control client; the viewer is closed with no status, and the next open starts a new server", async () => {
    for (const command of ["save-buffer", "resize-window"]) {
      const { world, panel, timers, closed, id } = await opened();
      world.plan({ answers: { [command]: ["words tmux never says here"] } });
      if (command === "resize-window") panel.resize(60, 12);
      else { world.emit("%output %1 x"); await waitFor("the tick", () => timers.count === 1); timers.fire(); }
      await waitFor("the close", () => closed.length === 1);
      assert.deepEqual(closed[0], { id, status: null, stderr: "", asked: false }, command);
      assert.equal(panel.current, null);
      world.plan({});
      await panel.open({ argv: VIEWER, cols: 50, rows: 10 });
      assert.equal(world.invocations().filter((call) => call.flags.includes("-C")).length, 2, `${command}: a new control client`);
      panel.end();
    }
  });

  test("fail closed at the start: a start block that succeeds with words fails the start (E_PANEL_START), and no viewer is opened", async () => {
    const world = makeWorld({ startSays: ["words tmux never says here"] }), { panel } = panelOf(world);
    await assert.rejects(panel.open({ argv: VIEWER, cols: 50, rows: 10 }), { code: "E_PANEL_START", detail: "tmux answered the start with words its commands never say" });
    assert.deepEqual(world.windows(), []);
    panel.end();
  });

  test("controlWord: a path as one word of a control line, in single quotes, `'` as '\"'\"', every # doubled; a control character makes it no word; a run directory whose path holds one is refused at the start (E_PANEL_START), with no tmux run", async () => {
    assert.equal(controlWord("/tmp/oats-tui-x/capture"), "'/tmp/oats-tui-x/capture'");
    assert.equal(controlWord(`/a b'c"d$HOME#(touch x)#{pane_id}~;\\`), `'/a b'"'"'c"d$HOME##(touch x)##{pane_id}~;\\'`);
    for (const bad of ["/a\nb", "/a\rb", "/a\u001bb", "/a\u007fb", "/a\u0000b"]) assert.equal(controlWord(bad), null, JSON.stringify(bad));
    const world = makeWorld();
    const { panel } = panelOf(world, { dir: () => path.join(world.dir, "line\nbreak") });
    await assert.rejects(panel.open({ argv: VIEWER }), { code: "E_PANEL_START", message: /control character/ });
    assert.deepEqual(world.invocations(), []);
    panel.end();
  });

  test("hidden, output only marks the screen stale; shown again, one fresh capture; refresh() captures now", async () => {
    const { world, panel, timers, screens, heard } = await opened();
    panel.setVisible(false);
    world.emit("%output %1 unseen");
    await waitFor("the panel to hear the output", () => heard().includes("%output %1 unseen\n"));
    assert.equal(timers.count, 0);
    assert.equal(count(world.control(), "capture-pane"), 1);
    panel.setVisible(true);
    await waitFor("the fresh capture", () => screens.length === 2);
    assert.equal(timers.count, 0, "no tick: it was captured at once");
    panel.refresh();
    await waitFor("the refresh", () => screens.length === 3);
    assert.equal(count(world.control(), "capture-pane"), 3);
    panel.end();
  });

  test("pause() asks tmux for no output and captures nothing; resume() asks for it again and captures fresh", async () => {
    const { world, panel, timers, screens, heard } = await opened();
    panel.pause();
    world.emit("%output %1 while stopped");
    await waitFor("the pause sent", () => world.control().includes("refresh-client -f no-output"));
    await waitFor("the panel to hear the output", () => heard().includes("%output %1 while stopped\n"));
    assert.equal(timers.count, 0);
    panel.resume();
    await waitFor("the fresh capture", () => screens.length === 2);
    assert.deepEqual(world.control().filter((line) => line.startsWith("refresh-client")), ["refresh-client -f no-output", "refresh-client -f '!no-output'"]);
    panel.end();
  });

  // T3 moved one meaning here: a resize captures only a window whose size changed (it captured the
  // shown tab after every resize), so the size that is no number is now followed by nothing at all.
  test("resize(): resize-window of the open window, then a capture of the new size; a size that is no number, or the window's own, resizes and captures nothing", async () => {
    const { world, panel, screens, captured } = await opened();
    panel.resize(72, 20);
    await waitFor("the capture", () => screens.length === 2);
    const lines = world.control();
    assert.ok(lines.indexOf("resize-window -t @1 -x 72 -y 20") < lines.lastIndexOf("capture-pane -e -N -b oats-tui-capture -t %1"));
    assert.deepEqual(captured[1].size, { cols: 72, rows: 20 });
    const from = world.control().length;
    panel.resize("x", -1);
    panel.resize(72, 20);
    panel.refresh();
    await waitFor("the refresh's capture", () => screens.length === 3);
    await sleep(30);
    const after = world.control().slice(from);
    assert.equal(after.filter((line) => line.startsWith("resize-window")).length, 0, "nothing resized");
    assert.equal(count(after, "capture-pane"), 1, "the refresh's capture alone");
    assert.equal(world.control().filter((line) => line.startsWith("resize-window")).at(-1), "resize-window -t @1 -x 72 -y 20", "a size that is no number keeps the last");
    assert.deepEqual(captured[2].size, { cols: 72, rows: 20 });
    panel.end();
  });

  test("input(): send-keys -H, at most 256 bytes a command, in order; paste(): the bracketed marks around the text, every end mark inside it removed", async () => {
    const { world, panel } = await opened();
    const bytes = Buffer.from(Array.from({ length: 600 }, (_, i) => i % 256));
    panel.input(bytes);
    panel.input("é");
    panel.paste("a\x1b[201~b\x1b[20\x1b[201~1~c");
    await waitFor("the keys sent", () => count(world.control(), "send-keys") === 5);
    const sent = world.control().filter((line) => line.startsWith("send-keys"));
    for (const line of sent) assert.match(line, /^send-keys -t %1 -H( [0-9a-f]{2})+$/);
    const decoded = sent.map((line) => Buffer.from(line.split(" -H ")[1].split(" ").map((h) => parseInt(h, 16))));
    assert.deepEqual(decoded.map((chunk) => chunk.length), [256, 256, 88, 2, 15]);
    assert.deepEqual(Buffer.concat(decoded.slice(0, 3)), bytes);
    assert.equal(decoded[3].toString("utf8"), "é");
    assert.equal(decoded[4].toString("latin1"), "\x1b[200~abc\x1b[201~");
    panel.end();
  });

  test("input() and paste() with no viewer window are dropped, and so is every method's call before any open", async () => {
    const world = makeWorld(), { panel } = panelOf(world);
    for (const act of [() => panel.input("x"), () => panel.paste("x"), () => panel.resize(10, 10), () => panel.close(), () => panel.refresh(), () => panel.setVisible(true), () => panel.pause(), () => panel.resume()]) assert.doesNotThrow(act);
    assert.equal(panel.current, null);
    assert.deepEqual(world.invocations(), [], "nothing started");
    const opening = panel.open({ argv: VIEWER, cols: 50, rows: 10 });
    panel.input("lost");
    panel.paste("lost");
    await opening;
    await sleep(30);
    assert.equal(count(world.control(), "send-keys"), 0);
    panel.end();
  });

  test("a viewer that ends by itself: its pane heard dead with its status (the subscription), onClosed with that status and the last 4096 bytes of its stderr, its file removed, and the dead pane killed", async () => {
    // 5097 bytes: the last 4096 begin inside the first "é", whose second byte is dropped.
    const head = "x".repeat(1000), tail = `${"é".repeat(STDERR_KEPT / 2)}z`;
    const { world, panel, closed, id } = await opened({ window: { stderr: head + "y" + tail } });
    world.emit(dead(id, 3));
    await waitFor("the end", () => closed.length === 1);
    await waitFor("the dead pane killed", () => world.control().includes("kill-pane -t %1"));
    assert.deepEqual(Object.keys(closed[0]).sort(), ["asked", "id", "status", "stderr"]);
    assert.equal(closed[0].id, id);
    assert.equal(closed[0].status, 3);
    assert.equal(closed[0].asked, false);
    assert.equal(closed[0].stderr, `${"é".repeat(STDERR_KEPT / 2 - 1)}z`);
    assert.equal(panel.current, null);
    assert.deepEqual(readdirSync(world.run).filter((name) => name.includes(".view.")), []);
    panel.end();
  });

  test("close(): kill-pane through the control client, the slot free at once, and onClosed with asked: true and no status (the pane hung up)", async () => {
    const { world, panel, closed, id } = await opened({ killPaneSilent: true, window: { stderr: "bye" } });
    panel.close();
    assert.equal(panel.current, null, "free when close() returns");
    const next = panel.open({ argv: VIEWER, cols: 50, rows: 10 }); // the next may follow at once
    await waitFor("the kill", () => world.control().includes("kill-pane -t %1"));
    assert.deepEqual((await next), { id: "@2" });
    assert.equal(closed.length, 0, "not over until its window has ended");
    world.emit(`%window-close ${id}`);
    await waitFor("the end", () => closed.length === 1);
    assert.deepEqual(closed[0], { id, status: null, stderr: "bye", asked: true });
    assert.equal(panel.current, "@2");
    panel.end();
  });

  test("close() while the open is under way: the open answers its id, its window is killed at once, and onClosed says asked", async () => {
    const world = makeWorld({ startDelayMs: 100 }), { panel, closed, screens } = panelOf(world);
    const opening = panel.open({ argv: VIEWER, cols: 50, rows: 10 });
    panel.close();
    assert.equal(panel.current, null);
    assert.deepEqual(await opening, { id: "@1" });
    await waitFor("the end", () => closed.length === 1);
    assert.deepEqual(closed[0], { id: "@1", status: null, stderr: "", asked: true });
    assert.ok(world.control().includes("kill-pane -t %1"));
    assert.equal(count(world.control(), "capture-pane"), 0, "never drawn");
    assert.equal(screens.length, 0);
    panel.end();
  });

  test("a viewer that exits at once: its window's end heard before new-window answered; open resolves first, then onClosed", async () => {
    // new-window's answer is held back until well after the control client said the window ended.
    const execFile = (file, args, options, callback) => nodeExecFile(file, args, options, (...answer) => (args.includes("new-window") ? setTimeout(() => callback(...answer), 100) : callback(...answer)));
    const world = makeWorld({ window: { status: 7, stderr: "gone at once", closeAtOnce: true } }), { panel, closed } = panelOf(world, { execFile });
    const order = [];
    const answer = await panel.open({ argv: VIEWER, cols: 50, rows: 10 }).then((value) => { order.push(["open", closed.length]); return value; });
    assert.deepEqual(answer, { id: "@1" });
    await waitFor("the end", () => closed.length === 1);
    assert.deepEqual(order, [["open", 0]], "onClosed came after open() answered");
    assert.deepEqual(closed[0], { id: "@1", status: 7, stderr: "gone at once", asked: false });
    assert.equal(panel.current, null);
    assert.equal(count(world.control(), "capture-pane"), 0);
    await waitFor("the dead pane killed", () => world.control().includes("kill-pane -t %1"));
    panel.end();
  });

  test("the dead-pane subscription: a signal's end has no status; a live pane, the keeper's dead pane, a pane no viewer has and a line not of that shape change nothing; a viewer being closed that is heard dead is over once", async () => {
    const { world, panel, closed, id, heard } = await opened();
    for (const line of [
      "%subscription-changed oats-tui-dead $0 @1 1 %1 : 0  ",
      "%subscription-changed oats-tui-dead $0 @0 0 %0 : 1 0 ",
      "%subscription-changed oats-tui-dead $0 @9 9 %9 : 1 1 ",
      "%subscription-changed another $0 @1 1 %1 : 1 1",
      "%subscription-changed oats-tui-dead $0 @1 1 %1 : 1 1 more",
      "%subscription-changed oats-tui-dead $0 @1 1 %1 : 1 1",
      "%subscription-changed oats-tui-dead $0 @1 1 %1 : 1 1 9",
      "%subscription-changed oats-tui-dead $0 @1 1 %1 : 1 0 kill",
      "%subscription-changed oats-tui-dead $0 @1 1 %1 : 1 1234 ",
    ]) world.emit(line);
    await waitFor("the panel to hear them", () => heard().includes(": 1 1234 \n"));
    assert.deepEqual([closed, panel.current, world.control().filter((line) => line.startsWith("kill-pane"))], [[], id, []]);
    world.emit(dead(id, "", "HUP"));
    await waitFor("the end", () => closed.length === 1);
    assert.deepEqual(closed[0], { id, status: null, stderr: "", asked: false }, "a signal ended it: no status");
    const second = await panel.open({ argv: VIEWER, cols: 50, rows: 10 });
    world.plan({ killPaneSilent: true });
    panel.close();
    world.emit(dead(second.id, 0));
    await waitFor("the closing one over", () => closed.length === 2);
    assert.deepEqual(closed[1], { id: second.id, status: 0, stderr: "", asked: true });
    world.emit(`%unlinked-window-close ${second.id}`);
    await waitFor("the panel to hear its window's end", () => heard().includes(`%unlinked-window-close ${second.id}\n`));
    assert.equal(closed.length, 2, "over once");
    panel.end();
  });

  test("a signal's end is heard however tmux says the signal: its number (Linux), or the libc's name, in lower case on macOS (sys_signame: `kill`, `hup`); the viewer is over with no status and its pane killed (awebai/oats#1613)", async () => {
    for (const signal of ["9", "kill", "hup"]) {
      const { world, panel, closed, id } = await opened();
      world.emit(dead(id, "", signal));
      await waitFor(`the end by ${signal}`, () => closed.length === 1);
      assert.deepEqual(closed[0], { id, status: null, stderr: "", asked: false }, `${signal}: a signal ended it, no status`);
      await waitFor(`the dead pane killed, ${signal}`, () => world.control().includes("kill-pane -t %1"));
      panel.end();
    }
  });

  test("a pane heard dead before tmux has its status (`1  `) is not over: the viewer ends with the status of the line that follows (CI, tmux 3.4)", async () => {
    const { world, panel, closed, id, heard } = await opened({ window: { stderr: "oats: session no longer exists" } });
    world.emit(dead(id));
    await waitFor("the panel to hear it", () => heard().includes(`${dead(id)}\n`));
    await sleep(200);
    assert.deepEqual([closed, panel.current, count(world.control(), "kill-pane")], [[], id, 0], "still open, its pane not killed");
    world.emit(dead(id, 1));
    await waitFor("the end", () => closed.length === 1);
    assert.deepEqual(closed[0], { id, status: 1, stderr: "oats: session no longer exists", asked: false });
    await waitFor("the dead pane killed", () => world.control().includes("kill-pane -t %1"));
    panel.end();
  });

  test("on tmux 3.2 (no pane_dead_signal), a pane heard dead with no status and no signal that nothing follows (a signal's end there) is over with no status after DEAD_WAIT_MS", async () => {
    const { world, panel, closed, id, heard, timers } = await opened({ version: "tmux 3.2" });
    world.emit(dead(id));
    await waitFor("the panel to hear it", () => heard().includes(`${dead(id)}\n`));
    world.emit(dead(id));
    await waitFor("the panel to hear it again", () => heard().split(`${dead(id)}\n`).length === 3);
    assert.deepEqual(timers.delays().filter((ms) => ms === DEAD_WAIT_MS), [DEAD_WAIT_MS], "one wait, armed once");
    assert.deepEqual(closed, [], "not over before the wait");
    timers.fire();
    assert.deepEqual(closed, [{ id, status: null, stderr: "", asked: false }]);
    await waitFor("the dead pane killed", () => world.control().includes("kill-pane -t %1"));
    panel.end();
  });

  test("a viewer that exits at once, heard dead before new-window answered and before tmux had its status: opened, then over with the status that follows", async () => {
    const execFile = (file, args, options, callback) => nodeExecFile(file, args, options, (...answer) => (args.includes("new-window") ? setTimeout(() => callback(...answer), 100) : callback(...answer)));
    const world = makeWorld({ window: { stderr: "gone at once", closeAtOnce: true } }), { panel, closed } = panelOf(world, { execFile });
    assert.deepEqual(await panel.open({ argv: VIEWER, cols: 50, rows: 10 }), { id: "@1" });
    await sleep(100);
    assert.deepEqual([closed, panel.current], [[], "@1"], "open, waiting for its status");
    world.emit(dead("@1", 7));
    await waitFor("the end", () => closed.length === 1);
    assert.deepEqual(closed[0], { id: "@1", status: 7, stderr: "gone at once", asked: false });
    await waitFor("the dead pane killed", () => world.control().includes("kill-pane -t %1"));
    panel.end();
  });

  test("on tmux 3.3 and later a pane heard dead with no status and no signal waits for its status STATUS_WAIT_MS at most: the line with its status ends it before then, and with none it is over with no status, its pane killed (CI, tmux 3.4: a status that never came left the terminal open)", async () => {
    assert.equal(STATUS_WAIT_MS > DEAD_WAIT_MS, true);
    for (const version of ["tmux 3.3", "tmux 3.4", "tmux 3.7c", "tmux next-3.8"]) {
      // The status comes in time: its line ends the viewer, and the wait is put away.
      const early = await opened({ version });
      early.world.emit(dead(early.id));
      await waitFor("the panel to hear it", () => early.heard().includes(`${dead(early.id)}\n`));
      assert.deepEqual(early.timers.delays().filter((ms) => ms === STATUS_WAIT_MS || ms === DEAD_WAIT_MS), [STATUS_WAIT_MS], `${version}: one wait, of STATUS_WAIT_MS`);
      assert.deepEqual([early.closed, early.panel.current, count(early.world.control(), "kill-pane")], [[], early.id, 0], `${version}: still open`);
      early.world.emit(dead(early.id, 3));
      await waitFor("the end", () => early.closed.length === 1);
      assert.deepEqual(early.closed[0], { id: early.id, status: 3, stderr: "", asked: false }, version);
      assert.equal(early.timers.delays().includes(STATUS_WAIT_MS), false, `${version}: the wait put away`);
      early.panel.end();
      // It never comes: once the wait has passed the viewer is over with no status, and its pane
      // is killed, which closes its window. A line heard again meanwhile arms no second wait.
      const never = await opened({ version, window: { stderr: "oats: session no longer exists" } });
      never.world.emit(dead(never.id));
      await waitFor("the panel to hear it", () => never.heard().includes(`${dead(never.id)}\n`));
      never.world.emit(dead(never.id));
      await waitFor("the panel to hear it again", () => never.heard().split(`${dead(never.id)}\n`).length === 3);
      assert.deepEqual(never.timers.delays().filter((ms) => ms === STATUS_WAIT_MS), [STATUS_WAIT_MS], `${version}: armed once`);
      assert.deepEqual(never.closed, [], `${version}: not over before the wait`);
      never.timers.fire();
      assert.deepEqual(never.closed, [{ id: never.id, status: null, stderr: "oats: session no longer exists", asked: false }], version);
      await waitFor("the dead pane killed", () => never.world.control().includes("kill-pane -t %1"));
      never.panel.end();
    }
  });

  test("a viewer heard dead with no status makes the server reap its children, `run-shell true` at once and every REAP_ASK_MS while it waits, and no more once it is over: a tmux built with libutempter loses the SIGCHLD of a viewer that exits as its pane is destroyed (awebai/oats#1277)", async () => {
    const reaps = (world) => world.control().filter((line) => line.startsWith("run-shell"));
    const asking = (timers) => timers.delays().filter((ms) => ms === REAP_ASK_MS);
    for (const version of ["tmux 3.2", "tmux 3.4"]) {
      // A first dead line with its status asks nothing.
      const at = await opened({ version });
      at.world.emit(dead(at.id, 3));
      await waitFor("the end", () => at.closed.length === 1);
      assert.deepEqual([at.closed[0].status, reaps(at.world), asking(at.timers)], [3, [], []], `${version}: nothing to reap`);
      at.panel.end();
      // The status comes after two asks: the asks end with the viewer.
      const { world, panel, closed, id, heard, timers } = await opened({ version });
      world.emit(dead(id));
      await waitFor("the first ask", () => reaps(world).length === 1);
      assert.deepEqual(reaps(world), ["run-shell true"], version);
      assert.deepEqual(asking(timers), [REAP_ASK_MS], `${version}: the next ask armed`);
      world.emit(dead(id));
      await waitFor("the panel to hear it again", () => heard().split(`${dead(id)}\n`).length === 3);
      assert.deepEqual([reaps(world).length, asking(timers)], [1, [REAP_ASK_MS]], `${version}: heard again, no second round`);
      timers.fire(REAP_ASK_MS);
      await waitFor("the second ask", () => reaps(world).length === 2);
      assert.deepEqual([asking(timers), closed], [[REAP_ASK_MS], []], `${version}: armed again, still open`);
      world.emit(dead(id, 1));
      await waitFor("the end", () => closed.length === 1);
      assert.deepEqual(closed[0], { id, status: 1, stderr: "", asked: false }, version);
      assert.deepEqual(asking(timers), [], `${version}: no more asks`);
      panel.end();
      // No status comes: the asks end with the wait.
      const never = await opened({ version });
      never.world.emit(dead(never.id));
      await waitFor("the first ask", () => reaps(never.world).length === 1);
      never.timers.fire();
      assert.deepEqual(never.closed, [{ id: never.id, status: null, stderr: "", asked: false }], version);
      assert.deepEqual(asking(never.timers), [], `${version}: no more asks`);
      never.panel.end();
    }
  });

  test("end() while a viewer waits for its status: the wait is put away, and nothing more is said (tmux 3.2 and 3.4)", async () => {
    for (const [version, ms] of [["tmux 3.2", DEAD_WAIT_MS], ["tmux 3.4", STATUS_WAIT_MS]]) {
      const { world, panel, closed, id, heard, timers } = await opened({ version });
      world.emit(dead(id));
      await waitFor("the panel to hear it", () => heard().includes(`${dead(id)}\n`));
      assert.equal(timers.delays().includes(ms), true, version);
      assert.equal(timers.delays().includes(REAP_ASK_MS), true, `${version}: an ask to reap armed`);
      panel.end();
      assert.equal(timers.delays().includes(ms), false, `${version}: cleared`);
      assert.equal(timers.delays().includes(REAP_ASK_MS), false, `${version}: the asks to reap cleared`);
      assert.deepEqual(closed, [], version);
    }
  });

  test("the trace: each line of a viewer's end the control client printed, as printed, and what the panel made of it, in order; nothing of a pane's text", async () => {
    const lines = [];
    const { world, panel, closed, id, heard } = await opened({ window: { stderr: "secret words of the pane" } }, { trace: (text) => lines.push(text) });
    world.emit("%output %1 secret\\040words");
    world.emit(dead(id));
    await waitFor("the panel to hear it", () => heard().includes(`${dead(id)}\n`));
    world.emit("%subscription-changed oats-tui-dead $0 @1 1 %1 : 1 x ");
    world.emit(dead(id, 1));
    await waitFor("the end", () => closed.length === 1);
    await waitFor("its window's end, after the kill", () => heard().includes(`%unlinked-window-close ${id}\n`));
    assert.deepEqual(lines, [
      `${id} %1 opened`,
      dead(id),
      `${id} dead, waiting ${STATUS_WAIT_MS} ms for its status`,
      "oats-tui-dead: a line not of its shape",
      dead(id, 1),
      `${id} over, status 1`,
      `%unlinked-window-close ${id}`,
    ]);
    assert.equal(lines.some((line) => line.includes("secret")), false);
    panel.end();
  });

  test("a new-window that does not name its window as asked: the open refuses (E_PANEL_OPEN); a window it names at all is killed at once, not left until end()", async () => {
    const world = makeWorld({ window: { print: "@{n}\n" } }), { panel, closed, heard } = panelOf(world);
    await assert.rejects(panel.open({ argv: VIEWER, cols: 50, rows: 10 }), { code: "E_PANEL_OPEN", message: "tmux did not name the window it opened" });
    await waitFor("the window killed", () => world.control().includes("kill-window -t @1"));
    await waitFor("its end heard", () => heard().includes("%unlinked-window-close @1\n"));
    world.plan({ window: { print: "no id here\n" } });
    await assert.rejects(panel.open({ argv: VIEWER, cols: 50, rows: 10 }), { code: "E_PANEL_OPEN" });
    assert.equal(count(world.control(), "kill-window"), 1, "nothing named: nothing killed");
    world.plan({});
    assert.deepEqual(await panel.open({ argv: VIEWER, cols: 50, rows: 10 }), { id: "@3" });
    assert.deepEqual(closed, [], "a window that was never the viewer is no viewer's end");
    panel.end();
  });

  test("%exit: the control client ended, the open viewer is closed with no status, and the next open starts a new server", async () => {
    const { world, panel, closed, id } = await opened();
    world.inject("exit");
    await waitFor("the end", () => closed.length === 1);
    assert.deepEqual(closed[0], { id, status: null, stderr: "", asked: false });
    assert.equal(panel.current, null);
    const before = world.invocations().length;
    const { id: again } = await panel.open({ argv: VIEWER, cols: 50, rows: 10 });
    assert.equal(again, "@2");
    const shape = world.invocations().slice(before).map((call) => (call.flags.includes("-C") ? `control ${call.commands[0]?.[0]}` : call.commands[0]?.[0] ?? call.flags.at(-1)));
    assert.deepEqual(shape, ["kill-server", "control new-session", "set-option"], "no version asked again; whatever was left of the old server killed first");
    assert.equal(world.invocations().filter((call) => call.flags.includes("-C")).length, 2, "a new control client, with the whole start list again");
    panel.end();
  });

  test("a control client that dies without a word is the same as %exit", async () => {
    const { world, panel, closed } = await opened();
    world.inject("die");
    await waitFor("the end", () => closed.length === 1);
    assert.equal(closed[0].status, null);
    panel.end();
  });

  test("open() refuses with a code: another open under way (E_PANEL_BUSY; a viewer already open is no refusal now, it is a tab: THE TABS), after end() (E_PANEL_ENDED), a bad argv (E_PANEL_OPEN)", async () => {
    const { panel } = await opened();
    const second = panel.open({ argv: VIEWER });
    await assert.rejects(panel.open({ argv: VIEWER }), { code: "E_PANEL_BUSY" });
    assert.deepEqual(await second, { id: "@2" }, "an open beside an open viewer is a second tab");
    assert.deepEqual(panel.tabs, { ids: ["@1", "@2"], shown: "@2", displayed: ["@2"] });
    panel.close();
    const one = panel.open({ argv: VIEWER });
    await assert.rejects(panel.open({ argv: VIEWER }), { code: "E_PANEL_BUSY" });
    await one;
    panel.end();
    await assert.rejects(panel.open({ argv: VIEWER }), { code: "E_PANEL_ENDED" });
    const other = panelOf(makeWorld()).panel;
    await assert.rejects(other.open({ argv: [] }), { code: "E_PANEL_OPEN" });
    await assert.rejects(other.open({ argv: ["a\0b"] }), { code: "E_PANEL_OPEN" });
    assert.equal(MAX_TERMINALS, 4);
    other.end();
  });

  test("open() refuses when tmux is missing or older than 3.2 (E_PANEL_TMUX), and when the start fails (E_PANEL_START, with what tmux said), leaving no server", async () => {
    const missing = makeWorld();
    await assert.rejects(panelOf(missing, { tmux: path.join(missing.fake, "no-such-tmux") }).panel.open({ argv: VIEWER }), { code: "E_PANEL_TMUX" });
    const old = makeWorld({ version: "tmux 3.1c" });
    await assert.rejects(panelOf(old).panel.open({ argv: VIEWER }), { code: "E_PANEL_TMUX" });
    assert.equal(old.invocations().length, 1, "nothing after the version");
    const fails = makeWorld({ newSession: { fail: true } });
    await assert.rejects(panelOf(fails).panel.open({ argv: VIEWER }), (error) => error.code === "E_PANEL_START" && /did not start/.test(error.detail));
    assert.equal(fails.invocations().at(-1).commands[0][0], "kill-server");
    // A command of the list after the session fails: the list ends there (tmux runs no more of it),
    // the start is refused at once, its client ended, and the server killed.
    const refused = makeWorld({ start: { failAt: 1 } });
    await assert.rejects(panelOf(refused).panel.open({ argv: VIEWER }), { code: "E_PANEL_START", detail: "fake: set-option failed" });
    assert.equal(refused.invocations().at(-1).commands[0][0], "kill-server", "a server whose options were not all set is killed");
    const starter = refused.invocations().find((call) => call.flags.includes("-C")).pid;
    await waitFor("the starting client gone", () => !isFake(starter));
    // A repository build names no version: taken as new enough.
    const master = makeWorld({ version: "tmux master" }), { panel } = panelOf(master);
    assert.deepEqual(await panel.open({ argv: VIEWER }), { id: "@1" });
    panel.end();
  });

  test("end() while the start is under way: the open rejects (E_PANEL_ENDED), the starting client is ended, and nothing is sent to it", async () => {
    const world = makeWorld({ start: { hold: true } }), { panel } = panelOf(world);
    const opening = panel.open({ argv: VIEWER, cols: 50, rows: 10 });
    await waitFor("the starting client", () => world.invocations().some((call) => call.flags.includes("-C")));
    const starter = world.invocations().find((call) => call.flags.includes("-C")).pid;
    panel.end();
    await assert.rejects(opening, { code: "E_PANEL_ENDED" });
    await waitFor("the starting client gone", () => !isFake(starter));
    assert.deepEqual(world.control(), []);
    assert.equal(world.calls().some((call) => call.started), false, "it ended before its list was answered");
  });

  test("end(): kill-server (synchronous), the control client ended, the socket, owner.json and the view files removed, the run directory kept; idempotent, and every method quiet after it", async () => {
    const { world, panel, closed } = await opened();
    const control = world.invocations().find((call) => call.flags.includes("-C")).pid;
    assert.ok(existsSync(world.socket) && lstatSync(world.socket).isSocket());
    assert.ok(existsSync(path.join(world.run, "capture")));
    panel.end();
    assert.equal(world.invocations().at(-1).commands[0][0], "kill-server");
    assert.deepEqual(readdirSync(world.run), [], "the socket, the capture's file, owner.json, the FIFO and the view file");
    assert.ok(existsSync(world.run), "the directory is the reader's to remove");
    await waitFor("the control client gone", () => !isFake(control));
    const calls = world.invocations().length;
    panel.end();
    for (const act of [() => panel.input("x"), () => panel.paste("x"), () => panel.resize(10, 10), () => panel.close(), () => panel.refresh(), () => panel.setVisible(false), () => panel.pause(), () => panel.resume()]) assert.doesNotThrow(act);
    assert.equal(world.invocations().length, calls, "a second end() calls nothing");
    assert.equal(closed.length, 0, "nothing is said on the way out");
  });

  // THE TABS -------------------------------------------------------------------------------------

  /** The capture-pane lines the control client was sent, by the pane each targets. */
  const capturedPanes = (world) => world.control().filter((line) => line.startsWith("capture-pane")).map((line) => / -t (%\d+)$/.exec(line)?.[1]);
  /** `n` more tabs opened one after the other (each shown as it opens): their ids. */
  async function moreTabs(panel, n, size = { cols: 50, rows: 10 }) {
    const ids = [];
    for (let k = 0; k < n; k++) ids.push((await panel.open({ argv: VIEWER, ...size })).id);
    return ids;
  }

  test("tabs: each open is a new window, listed in opening order and shown, the tab before hidden from the call on; show() switches; close(id) ends a hidden or the shown tab; after the shown one is closed nothing is shown until show(), and current is always tabs.shown", async () => {
    const { world, panel, screens, closed, id } = await opened();
    assert.deepEqual(panel.tabs, { ids: [id], shown: id, displayed: [id] });
    const opening = panel.open({ argv: VIEWER, cols: 50, rows: 10 });
    assert.deepEqual(panel.tabs, { ids: ["@1"], shown: null, displayed: [] }, "the tab before is hidden from the call, and an open under way is not listed");
    assert.equal(panel.current, null);
    assert.deepEqual(await opening, { id: "@2" });
    assert.deepEqual(panel.tabs, { ids: ["@1", "@2"], shown: "@2", displayed: ["@2"] });
    assert.deepEqual(await moreTabs(panel, 1), ["@3"]);
    assert.deepEqual(panel.tabs, { ids: ["@1", "@2", "@3"], shown: "@3", displayed: ["@3"] });
    assert.equal(panel.current, "@3");
    assert.equal(world.windows().length, 3, "a window each");
    await waitFor("the third tab's first capture", () => screens.some((screen) => screen.id === "@3"));
    // show(): the tab, and one fresh capture of it.
    const before = capturedPanes(world).length;
    panel.show("@1");
    assert.deepEqual(panel.tabs, { ids: ["@1", "@2", "@3"], shown: "@1", displayed: ["@1"] });
    await waitFor("the capture of the tab shown", () => screens.at(-1).id === "@1" && capturedPanes(world).length === before + 1);
    assert.equal(capturedPanes(world).at(-1), "%1");
    // The tab already shown, or an id no tab has: nothing.
    panel.show("@1");
    panel.show("@9");
    await sleep(30);
    assert.deepEqual([capturedPanes(world).length, panel.tabs.shown], [before + 1, "@1"]);
    // close(id) of a hidden tab: its place is free at once, the shown one stays.
    panel.close("@2");
    assert.deepEqual(panel.tabs, { ids: ["@1", "@3"], shown: "@1", displayed: ["@1"] });
    await waitFor("the hidden tab's end", () => closed.length === 1);
    assert.deepEqual(closed[0], { id: "@2", status: null, stderr: "", asked: true });
    assert.ok(world.control().includes("kill-pane -t %2"));
    // close() with no id: the shown tab. Nothing is shown then, and the panel picks no neighbour.
    panel.close();
    assert.deepEqual(panel.tabs, { ids: ["@3"], shown: null, displayed: [] });
    assert.equal(panel.current, null);
    await waitFor("the shown tab's end", () => closed.length === 2);
    assert.deepEqual(closed[1], { id: "@1", status: null, stderr: "", asked: true });
    panel.input("dropped");
    panel.close("@9");
    await sleep(30);
    assert.equal(count(world.control(), "send-keys"), 0, "with none shown, keys are dropped");
    assert.deepEqual(panel.tabs, { ids: ["@3"], shown: null, displayed: [] }, "an unknown id closes nothing");
    panel.show("@3");
    assert.deepEqual(panel.tabs, { ids: ["@3"], shown: "@3", displayed: ["@3"] });
    assert.equal(panel.current, "@3");
    panel.end();
  });

  test("tabs: input() and paste() go to the shown tab only, and are dropped while a new tab opens", async () => {
    const { world, panel } = await opened();
    await moreTabs(panel, 1);
    panel.input("b");
    panel.show("@1");
    panel.input("a");
    panel.paste("p");
    const opening = panel.open({ argv: VIEWER, cols: 50, rows: 10 });
    panel.input("lost");
    panel.paste("lost");
    await opening;
    panel.input("c");
    await waitFor("the keys sent", () => count(world.control(), "send-keys") === 4);
    await sleep(30);
    const sent = world.control().filter((line) => line.startsWith("send-keys")).map((line) => {
      const [, pane, bytes] = /^send-keys -t (%\d+) -H (.*)$/.exec(line);
      return [pane, Buffer.from(bytes.split(" ").map((h) => parseInt(h, 16))).toString("latin1")];
    });
    assert.deepEqual(sent, [["%2", "b"], ["%1", "a"], ["%1", "\x1b[200~p\x1b[201~"], ["%3", "c"]]);
    panel.end();
  });

  test("tabs: a hidden tab is heard until it prints: its first output marks it and pauses its pane, once in each spell hidden, and captures nothing; shown again it is continued before its capture; the shown tab's output is never activity; the panel hidden pauses the displayed tab and shown continues it before its capture; a hidden window's layout change is nothing", async () => {
    const activity = [];
    const { world, panel, timers, screens, heard } = await opened({}, { onActivity: (event) => activity.push(event) });
    await moreTabs(panel, 1);
    await waitFor("the second tab's first capture", () => screens.at(-1).id === "@2");
    const drawn = screens.length, asked = capturedPanes(world).length;
    world.emit("%layout-change @1 fa5e,72x20,0,0,1 fa5e,72x20,0,0,1 *");
    await waitFor("the panel to hear the hidden tab", () => heard().includes("%layout-change @1 "));
    assert.deepEqual([activity, flows(world)], [[], []], "hidden and quiet: heard, not marked, not paused");
    for (const n of [1, 2, 3]) world.emit(`%output %1 hidden ${n}`);
    await waitFor("the panel to hear the last of it", () => heard().includes("%output %1 hidden 3\n"));
    assert.deepEqual(activity, [{ id: "@1" }], "once in the spell, whatever the output");
    await waitFor("its pause", () => flows(world).length > 0);
    await sleep(30);
    assert.deepEqual(flows(world), ["%1:pause"], "paused at its first output, once");
    assert.equal(timers.count, 0, "no tick for a hidden tab");
    await sleep(30);
    assert.deepEqual([screens.length, capturedPanes(world).length], [drawn, asked], "nothing captured for it");
    assert.deepEqual(capturedPanes(world), ["%1", "%2"], "each capture of the tab shown at the time");
    // The shown tab's output: a tick and a capture of it, and no activity.
    world.emit("%output %2 shown");
    await waitFor("the tick", () => timers.count === 1);
    timers.fire();
    await waitFor("the capture", () => screens.length === drawn + 1);
    assert.equal(screens.at(-1).id, "@2");
    // Shown: continued before its capture.
    const before = world.control().length;
    panel.show("@1");
    await waitFor("the capture of @1", () => screens.at(-1).id === "@1");
    const after = world.control().slice(before);
    const continued = after.indexOf("refresh-client -A '%1:continue'");
    assert.ok(continued >= 0 && continued < after.findIndex((line) => line.startsWith("capture-pane") && line.endsWith("-t %1")), `continued before the capture: ${after.join(" | ")}`);
    world.emit("%output %1 while shown");
    await waitFor("the panel to hear it", () => heard().includes("%output %1 while shown\n"));
    // Hidden again: a new spell.
    panel.show("@2");
    world.emit("%output %1 hidden again");
    await waitFor("the second spell's activity", () => activity.length === 2);
    assert.deepEqual(activity, [{ id: "@1" }, { id: "@1" }]);
    await waitFor("its second pause", () => flows(world).length === 3);
    assert.deepEqual(flows(world), ["%1:pause", "%1:continue", "%1:pause"], "@2, shown and never marked, never paused");
    await waitFor("the capture of @2", () => screens.at(-1).id === "@2");
    // The panel hidden as a whole: the shown tab paused, its output only marks its screen stale.
    panel.setVisible(false);
    await waitFor("the shown tab paused", () => flows(world).at(-1) === "%2:pause");
    world.emit("%output %2 behind another view");
    world.emit("%output %1 still the same spell");
    await waitFor("the panel to hear it", () => heard().includes("%output %1 still the same spell\n"));
    assert.equal(activity.length, 2, "the shown tab's output is no activity, and @1 is told once in its spell");
    assert.equal(timers.count, 0);
    const hiddenAt = capturedPanes(world).length;
    panel.setVisible(true);
    await waitFor("one fresh capture of the shown tab", () => capturedPanes(world).length === hiddenAt + 1);
    assert.equal(capturedPanes(world).at(-1), "%2");
    await waitFor("the shown tab continued", () => flows(world).at(-1) === "%2:continue");
    const shownAt = world.control();
    const resumed = shownAt.lastIndexOf("refresh-client -A '%2:continue'");
    assert.ok(resumed > shownAt.lastIndexOf("refresh-client -A '%2:pause'") && resumed < shownAt.findLastIndex((line) => line.startsWith("capture-pane") && line.endsWith("-t %2")), "continued before its capture");
    panel.end();
  });

  test("tabs: a capture in flight when another tab is shown is not drawn, and the shown tab's capture follows it: onScreen is only ever the shown tab's", async () => {
    const { world, panel, screens } = await opened();
    await moreTabs(panel, 1);
    await waitFor("the second tab's first capture", () => screens.at(-1).id === "@2");
    world.plan({ holdCapture: true });
    panel.refresh();
    await waitFor("the capture of @2 asked", () => capturedPanes(world).length === 3);
    panel.show("@1");
    await sleep(30);
    assert.equal(capturedPanes(world).length, 3, "one capture in flight at a time");
    world.plan({});
    world.inject("release");
    await waitFor("the capture of @1", () => screens.at(-1).id === "@1");
    assert.deepEqual(capturedPanes(world), ["%1", "%2", "%2", "%1"]);
    assert.deepEqual(screens.map((screen) => screen.id), ["@1", "@2", "@1"], "the capture of @2 that came back after @1 was shown is not drawn");
    panel.end();
  });

  // T3 moved one meaning here: an open of another size made it the panel's and fitted every tab to
  // it; now each window has its own size, and an open sizes its own window only.
  test("tabs: a resize reaches every tab's window, each by its own resize-window (never the global window-size), then one capture of the shown tab; an open of another size makes its own window at it and resizes no other, and a resize of every tab while a tab opens is that tab's too", async () => {
    const { world, panel, screens, captured } = await opened();
    await moreTabs(panel, 2);
    await waitFor("the third tab's first capture", () => screens.at(-1).id === "@3");
    const from = world.control().length, drawn = screens.length;
    panel.resize(72, 20);
    await waitFor("the capture", () => screens.length === drawn + 1);
    const after = world.control().slice(from);
    assert.deepEqual(after.filter((line) => line.startsWith("resize-window")), ["resize-window -t @1 -x 72 -y 20", "resize-window -t @2 -x 72 -y 20", "resize-window -t @3 -x 72 -y 20"]);
    assert.ok(after.findIndex((line) => line.startsWith("capture-pane")) > after.findLastIndex((line) => line.startsWith("resize-window")), "the capture after every window's resize");
    assert.deepEqual(capturedPanes(world).slice(-1), ["%3"]);
    assert.deepEqual(captured.at(-1).size, { cols: 72, rows: 20 });
    assert.equal(world.control().some((line) => line.includes("window-size")), false, "no global window-size");
    // An open of another size: its own window made at it, and no other window resized.
    const at = world.control().length;
    const opening = panel.open({ argv: VIEWER, cols: 60, rows: 15 });
    panel.resize(64, 16); // every tab, while the window is being made (no 60x15 below: the open resized no other)
    assert.deepEqual(await opening, { id: "@4" });
    await waitFor("the new tab's capture", () => screens.at(-1).id === "@4");
    const resized = world.control().slice(at).filter((line) => line.startsWith("resize-window"));
    assert.deepEqual(resized, ["resize-window -t @1 -x 64 -y 16", "resize-window -t @2 -x 64 -y 16", "resize-window -t @3 -x 64 -y 16", "resize-window -t @4 -x 64 -y 16"]);
    const made = world.invocations().filter((call) => call.commands.some((command) => command[0] === "new-window")).at(-1);
    assert.deepEqual(made.commands[0], ["set-option", "-t", SESSION, "default-size", "60x15"], "the window made at the size its open gave");
    assert.deepEqual(captured.at(-1).size, { cols: 64, rows: 16 });
    panel.end();
  });

  test("tabs: the cap, MAX_TERMINALS tabs open, refuses E_PANEL_FULL, an open under way counted; E_PANEL_BUSY only while another open is under way; a close frees a place at once", async () => {
    assert.equal(MAX_TERMINALS, 4);
    const { panel } = await opened();
    const second = panel.open({ argv: VIEWER, cols: 50, rows: 10 });
    await assert.rejects(panel.open({ argv: VIEWER }), { code: "E_PANEL_BUSY" }, "two tabs counted, and one is still opening");
    await second;
    await moreTabs(panel, 1);
    const fourth = panel.open({ argv: VIEWER, cols: 50, rows: 10 });
    await assert.rejects(panel.open({ argv: VIEWER }), { code: "E_PANEL_FULL", message: "4 terminals are open in the panel" }, "three open and one under way");
    assert.deepEqual(await fourth, { id: "@4" });
    // A refused open changes nothing: the shown tab stays shown.
    await assert.rejects(panel.open({ argv: VIEWER }), { code: "E_PANEL_FULL" });
    assert.deepEqual(panel.tabs, { ids: ["@1", "@2", "@3", "@4"], shown: "@4", displayed: ["@4"] });
    panel.close("@2");
    assert.deepEqual(await panel.open({ argv: VIEWER, cols: 50, rows: 10 }), { id: "@5" }, "the place is free when close() returns");
    assert.deepEqual(panel.tabs, { ids: ["@1", "@3", "@4", "@5"], shown: "@5", displayed: ["@5"] });
    await assert.rejects(panel.open({ argv: VIEWER }), { code: "E_PANEL_FULL" });
    // An open given up (close() with no id while it is under way) frees its place at once too.
    panel.close("@1");
    const given = panel.open({ argv: VIEWER, cols: 50, rows: 10 });
    panel.close();
    assert.deepEqual(panel.tabs, { ids: ["@3", "@4", "@5"], shown: null, displayed: [] }, "close() with no id gave up the open, not a tab");
    // The next would not be refused now; it follows the given-up one's window (the fake numbers
    // windows one invocation at a time).
    assert.deepEqual(await given, { id: "@6" });
    const next = panel.open({ argv: VIEWER, cols: 50, rows: 10 });
    assert.deepEqual(await next, { id: "@7" });
    assert.deepEqual(panel.tabs, { ids: ["@3", "@4", "@5", "@7"], shown: "@7", displayed: ["@7"] });
    panel.end();
  });

  test("tabs: a hidden tab's viewer that ends by itself is reported (its status, asked false), its place freed and the shown tab left shown; the shown one's end leaves nothing shown, and the panel picks no neighbour", async () => {
    const { world, panel, closed } = await opened({ window: { stderr: "tab's words" } });
    await moreTabs(panel, 2);
    panel.show("@2");
    world.emit(dead("@1", 5));
    await waitFor("the hidden tab's end", () => closed.length === 1);
    assert.deepEqual(closed[0], { id: "@1", status: 5, stderr: "tab's words", asked: false });
    await waitFor("its dead pane killed", () => world.control().includes("kill-pane -t %1"));
    assert.deepEqual(panel.tabs, { ids: ["@2", "@3"], shown: "@2", displayed: ["@2"] });
    // A hidden tab heard dead before tmux has its status waits for it, as a shown one does.
    world.emit(dead("@3"));
    await waitFor("the ask to reap", () => world.control().includes("run-shell true"));
    assert.deepEqual(panel.tabs, { ids: ["@2", "@3"], shown: "@2", displayed: ["@2"] });
    world.emit(dead("@3", 0));
    await waitFor("the second hidden tab's end", () => closed.length === 2);
    assert.deepEqual(closed[1], { id: "@3", status: 0, stderr: "tab's words", asked: false });
    await moreTabs(panel, 1);
    panel.show("@2");
    world.emit(`%window-close @2`);
    await waitFor("the shown tab's end", () => closed.length === 3);
    assert.deepEqual(closed[2], { id: "@2", status: null, stderr: "tab's words", asked: false });
    assert.deepEqual(panel.tabs, { ids: ["@4"], shown: null, displayed: [] }, "nothing shown: the neighbour is the caller's");
    assert.deepEqual(readdirSync(world.run).filter((name) => name.includes(".view.")), ["4.view.err"], "the ended tabs' files removed");
    panel.end();
  });

  test("tabs: %exit with several tabs closes every one of them with no status, and the next open starts a new server with no tab left", async () => {
    const { world, panel, closed } = await opened();
    await moreTabs(panel, 2);
    panel.show("@2");
    world.inject("exit");
    await waitFor("every tab's end", () => closed.length === 3);
    assert.deepEqual(closed.map((event) => [event.id, event.status, event.asked]).sort(), [["@1", null, false], ["@2", null, false], ["@3", null, false]]);
    assert.deepEqual(panel.tabs, { ids: [], shown: null, displayed: [] });
    assert.deepEqual(await panel.open({ argv: VIEWER, cols: 50, rows: 10 }), { id: "@4" });
    assert.deepEqual(panel.tabs, { ids: ["@4"], shown: "@4", displayed: ["@4"] });
    panel.end();
  });

  test("tabs: end() with 4 open kills the server once (synchronous), removes every tab's file, says nothing of any tab, and leaves no tab", async () => {
    const { world, panel, closed, timers } = await opened();
    await moreTabs(panel, 3);
    panel.show("@2");
    world.emit(dead("@3")); // one of them waiting for its status
    await waitFor("its wait", () => timers.delays().includes(STATUS_WAIT_MS));
    const control = world.invocations().find((call) => call.flags.includes("-C")).pid;
    assert.deepEqual(readdirSync(world.run).filter((name) => name.includes(".view.")).sort(), ["1.view.err", "2.view.err", "3.view.err", "4.view.err"]);
    const before = world.invocations().length;
    panel.end();
    assert.deepEqual(world.invocations().slice(before).map((call) => call.commands[0][0]), ["kill-server"], "one kill-server ends every tab");
    assert.deepEqual(readdirSync(world.run), []);
    assert.deepEqual(panel.tabs, { ids: [], shown: null, displayed: [] });
    assert.equal(panel.current, null);
    assert.equal(timers.count, 0, "the wait put away");
    await waitFor("the control client gone", () => !isFake(control));
    assert.deepEqual(closed, [], "nothing is said on the way out");
    for (const act of [() => panel.show("@1"), () => panel.close("@1"), () => panel.close(), () => panel.resize(10, 10)]) assert.doesNotThrow(act);
    assert.equal(world.invocations().length, before + 1, "every method quiet after it");
  });

  // TWO DISPLAYED (THE TABS: one tab displayed per group of a split, one of them shown) ---------

  /** The keys the control client was sent, as [pane, text]. */
  const sentKeys = (world) => world.control().filter((line) => line.startsWith("send-keys")).map((line) => {
    const [, pane, bytes] = /^send-keys -t (%\d+) -H (.*)$/.exec(line);
    return [pane, Buffer.from(bytes.split(" ").map((h) => parseInt(h, 16))).toString("latin1")];
  });
  /** Each window's size as the panel last asked it (resize-window), by window id. */
  const windowSizes = (world) => Object.fromEntries(world.control().map((line) => /^resize-window -t (@\d+) -x (\d+) -y (\d+)$/.exec(line)).filter(Boolean).map(([, id, cols, rows]) => [id, `${cols}x${rows}`]));
  /** A panel with @1 (50x10) displayed and @2 (40x8) opened beside it (`instead: null`), shown,
   *  each with its first capture drawn. */
  async function twoDisplayed(plan = {}, more = {}) {
    const made = await opened(plan, more);
    const { id } = await made.panel.open({ argv: VIEWER, cols: 40, rows: 8, instead: null });
    await waitFor("the second tab's first capture", () => made.screens.some((screen) => screen.id === id));
    return { ...made, second: id };
  }

  test("two displayed: an open with instead: null displays its tab beside the one displayed (that one stays displayed, nothing shown while it opens), at its own size; both are captured when tmux says they changed, each handed back with its own id and size, and neither is activity", async () => {
    assert.equal(MAX_SHOWN, 2);
    const activity = [];
    const made = await opened({}, { onActivity: (event) => activity.push(event) });
    const { world, panel, timers, screens, heard } = made;
    const opening = panel.open({ argv: VIEWER, cols: 40, rows: 8, instead: null });
    assert.deepEqual(panel.tabs, { ids: ["@1"], shown: null, displayed: ["@1"] }, "the one displayed stays displayed; nothing is shown while the new one opens");
    assert.deepEqual(await opening, { id: "@2" });
    assert.deepEqual(panel.tabs, { ids: ["@1", "@2"], shown: "@2", displayed: ["@1", "@2"] });
    assert.equal(panel.current, "@2");
    await waitFor("the second tab's first capture", () => screens.some((screen) => screen.id === "@2"));
    const made2 = world.invocations().filter((call) => call.commands.some((command) => command[0] === "new-window")).at(-1);
    assert.deepEqual(made2.commands[0], ["set-option", "-t", SESSION, "default-size", "40x8"], "its window made at its own size");
    assert.deepEqual(windowSizes(world), { "@1": "50x10", "@2": "40x8" }, "each window its own size: the open resized no other");
    // Both changed: one tick, then both captured, one after the other.
    const drawn = screens.length;
    world.emit("%output %1 left");
    world.emit("%output %2 right");
    await waitFor("the panel to hear both", () => heard().includes("%output %2 right\n"));
    assert.deepEqual(timers.delays(), [FRAME_MS], "one tick for both");
    timers.fire();
    await waitFor("both captured", () => screens.length === drawn + 2);
    assert.deepEqual(screens.slice(drawn).map((screen) => [screen.id, screen.screen.size]).sort(), [["@1", { cols: 50, rows: 10 }], ["@2", { cols: 40, rows: 8 }]]);
    assert.deepEqual(capturedPanes(world).slice(-2).sort(), ["%1", "%2"]);
    // A layout change of either displayed window is a change of its screen.
    world.emit("%layout-change @1 fa5e,50x10,0,0,1 fa5e,50x10,0,0,1 *");
    await waitFor("the tick of a layout change", () => timers.count === 1);
    timers.fire();
    await waitFor("its capture", () => screens.length === drawn + 3);
    assert.equal(screens.at(-1).id, "@1");
    assert.deepEqual(activity, [], "a displayed tab's output is never activity, shown or not");
    panel.end();
  });

  test("two displayed: captures are one at a time, out of band: the second displayed pane is captured only after the first's four commands are answered, never mixed, the one waiting longest first", async () => {
    const { world, panel, timers, screens, heard, second } = await twoDisplayed();
    world.plan({ holdCapture: true });
    const from = world.control().length, drawn = screens.length;
    world.emit("%output %2 first");
    await waitFor("the tick", () => timers.count === 1);
    world.emit("%output %1 then");
    await waitFor("the panel to hear it", () => heard().includes("%output %1 then\n"));
    timers.fire();
    await waitFor("the first capture asked", () => count(world.control().slice(from), "capture-pane") === 1);
    await sleep(50);
    assert.equal(count(world.control().slice(from), "capture-pane"), 1, "one capture in flight");
    world.inject("release");
    await waitFor("the first drawn, the second asked", () => screens.length === drawn + 1 && count(world.control().slice(from), "capture-pane") === 2);
    world.plan({});
    world.inject("release");
    await waitFor("the second drawn", () => screens.length === drawn + 2);
    const lines = world.control().slice(from).filter((line) => !line.startsWith("resize-window"));
    assert.deepEqual(lines, [
      "capture-pane -e -N -b oats-tui-capture -t %2", `save-buffer -b oats-tui-capture '${path.join(world.run, "capture")}'`, "delete-buffer -b oats-tui-capture", "display -p -t %2 '#{cursor_x} #{cursor_y} #{cursor_flag}'",
      "capture-pane -e -N -b oats-tui-capture -t %1", `save-buffer -b oats-tui-capture '${path.join(world.run, "capture")}'`, "delete-buffer -b oats-tui-capture", "display -p -t %1 '#{cursor_x} #{cursor_y} #{cursor_flag}'"]);
    assert.deepEqual(screens.slice(drawn).map((screen) => screen.id), [second, "@1"], "the one stale first is captured first");
    // A fresh capture asked while one is in flight waits for it.
    world.plan({ holdCapture: true });
    world.emit("%output %1 again");
    await waitFor("the tick", () => timers.count === 1);
    timers.fire();
    await waitFor("its capture asked", () => count(world.control().slice(from), "capture-pane") === 3);
    panel.refresh();
    await sleep(50);
    assert.equal(count(world.control().slice(from), "capture-pane"), 3, "the refresh waits for the capture in flight");
    world.plan({});
    world.inject("release");
    await waitFor("the refresh's captures", () => count(world.control().slice(from), "capture-pane") === 5);
    assert.deepEqual(capturedPanes(world).slice(-3), ["%1", "%1", "%2"], "after the one in flight, each displayed tab once, in the order they began to wait");
    panel.end();
  });

  test("two displayed: input() and paste() go to the shown one only; focus() moves the keys and captures nothing; focus() of a tab not displayed, or unknown, does nothing", async () => {
    const { world, panel, second } = await twoDisplayed();
    panel.input("b");
    const asked = capturedPanes(world).length;
    panel.focus("@1");
    assert.deepEqual(panel.tabs, { ids: ["@1", second], shown: "@1", displayed: ["@1", second] }, "nothing else changes");
    panel.input("a");
    panel.paste("p");
    panel.focus(second);
    panel.input("c");
    // A third tab, opened in @1's place: @1 is no longer displayed, and focus() of it does nothing.
    const { id: third } = await panel.open({ argv: VIEWER, cols: 50, rows: 10, instead: "@1" });
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: third, displayed: [second, third] });
    panel.focus("@1");
    panel.focus("@9");
    assert.equal(panel.tabs.shown, third, "a tab not displayed, or unknown, takes no keys");
    panel.input("d");
    await waitFor("the keys sent", () => count(world.control(), "send-keys") === 5);
    await sleep(30);
    assert.deepEqual(sentKeys(world), [[`%${second.slice(1)}`, "b"], ["%1", "a"], ["%1", "\x1b[200~p\x1b[201~"], [`%${second.slice(1)}`, "c"], [`%${third.slice(1)}`, "d"]]);
    assert.equal(capturedPanes(world).length, asked + 1, "focus() captured nothing: the one capture is the new tab's");
    panel.end();
  });

  test("two displayed: show() with instead an id replaces that displayed tab, with instead: null puts it beside while there is room and with two displayed acts as omitted (the shown one's place); a tab already displayed only becomes the shown one, captured nothing; open() with instead an id; hide() of the other or the shown one", async () => {
    const { world, panel, screens, second } = await twoDisplayed();
    const third = (await panel.open({ argv: VIEWER, cols: 40, rows: 8, instead: second })).id;
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: third, displayed: ["@1", third] }, "open() instead of the shown tab");
    await waitFor("its first capture", () => screens.at(-1).id === third);
    // show() instead of the tab that is not shown: replaced, and the new one shown and captured.
    let asked = capturedPanes(world).length;
    panel.show(second, { instead: "@1" });
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: second, displayed: [second, third] });
    await waitFor("one fresh capture of it", () => capturedPanes(world).length === asked + 1 && screens.at(-1).id === second);
    // instead: null with two displayed: as omitted, the shown one's place.
    panel.show("@1", { instead: null });
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: "@1", displayed: ["@1", third] });
    // Omitted: the shown one's place.
    panel.show(second);
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: second, displayed: [second, third] });
    // A tab already displayed only becomes the shown one: no capture, `instead` ignored.
    await waitFor("the captures of the shows", () => capturedPanes(world).length === asked + 3);
    asked = capturedPanes(world).length;
    panel.show(third, { instead: second });
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: third, displayed: [second, third] });
    await sleep(30);
    assert.equal(capturedPanes(world).length, asked, "nothing captured");
    // hide() of the one not shown: it alone goes; then the room it leaves takes a show beside.
    panel.hide(second);
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: third, displayed: [third] });
    panel.show("@1", { instead: null });
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: "@1", displayed: ["@1", third] }, "beside, there is room");
    // hide() of the shown one: the other displayed is shown.
    panel.hide("@1");
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: third, displayed: [third] });
    panel.hide(third);
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: null, displayed: [] }, "the last one hidden: none shown");
    for (const act of [() => panel.hide(third), () => panel.hide("@9"), () => panel.show("@9"), () => panel.show("@9", { instead: null })]) act();
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: null, displayed: [] }, "a tab not displayed, or unknown, does nothing");
    // With none displayed, a show takes a place of its own whatever `instead` names.
    panel.show(second, { instead: "@1" });
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: second, displayed: [second] });
    panel.end();
  });

  test("two displayed: activity only for a tab not displayed, once in each spell: replaced by an open or a show it is marked and paused at its first output, displayed again it is continued and not marked, and replaced again it may be marked again; the displayed ones never", async () => {
    const activity = [];
    const { world, panel, heard, second } = await twoDisplayed({}, { onActivity: (event) => activity.push(event) });
    const third = (await panel.open({ argv: VIEWER, cols: 50, rows: 10, instead: "@1" })).id;
    assert.deepEqual(panel.tabs.displayed, [second, third]);
    const [p2, p3] = [second, third].map((id) => `%${id.slice(1)}`);
    for (const n of [1, 2, 3]) world.emit(`%output %1 unseen ${n}`);
    world.emit(`%output ${p2} seen`);
    world.emit(`%output ${p3} seen`);
    await waitFor("the panel to hear them", () => heard().includes(`%output ${p3} seen\n`));
    assert.deepEqual(activity, [{ id: "@1" }], "once in the spell; the two displayed never");
    await waitFor("its pause", () => flows(world).length > 0);
    assert.deepEqual(flows(world), ["%1:pause"]);
    panel.show("@1", { instead: second });
    world.emit("%output %1 now displayed");
    world.emit(`%output ${p2} now not`);
    await waitFor("the second spell's mark", () => activity.length === 2);
    await waitFor("the panel to hear it", () => heard().includes(`%output ${p2} now not\n`));
    assert.deepEqual(activity, [{ id: "@1" }, { id: second }]);
    await waitFor("the replaced one paused", () => flows(world).length === 3);
    assert.deepEqual(flows(world), ["%1:pause", "%1:continue", `${p2}:pause`]);
    panel.hide("@1");
    world.emit("%output %1 a new spell");
    await waitFor("the new spell's mark", () => activity.length === 3);
    assert.deepEqual(activity.at(-1), { id: "@1" });
    panel.end();
  });

  test("resize(cols, rows, ids): only those windows, each by its own resize-window, then one capture of each displayed tab whose size changed; the same size again resizes and captures nothing; without ids every window; each window keeps its own size", async () => {
    const { world, panel, screens, second } = await twoDisplayed();
    // A third tab in the second's place (the second's group, as the caller sees it), at its size.
    const third = (await panel.open({ argv: VIEWER, cols: 40, rows: 8, instead: second })).id;
    await waitFor("its first capture", () => screens.at(-1).id === third);
    assert.deepEqual(windowSizes(world), { "@1": "50x10", [second]: "40x8", [third]: "40x8" });
    let from = world.control().length, drawn = screens.length;
    panel.resize(44, 9, [second, third]);
    await waitFor("the capture of the displayed one", () => screens.length === drawn + 1);
    await sleep(30);
    let after = world.control().slice(from);
    assert.deepEqual(after.filter((line) => line.startsWith("resize-window")), [`resize-window -t ${second} -x 44 -y 9`, `resize-window -t ${third} -x 44 -y 9`], "those windows, and no other");
    assert.deepEqual(capturedPanes(world).slice(-1), [`%${third.slice(1)}`], "one capture: the displayed one's (the other is not displayed)");
    assert.deepEqual([screens.at(-1).id, screens.at(-1).screen.size], [third, { cols: 44, rows: 9 }]);
    assert.ok(after.findIndex((line) => line.startsWith("capture-pane")) > after.findLastIndex((line) => line.startsWith("resize-window")));
    assert.deepEqual(windowSizes(world), { "@1": "50x10", [second]: "44x9", [third]: "44x9" }, "each window its own size");
    // The same size again, an unknown id and an empty list: nothing.
    from = world.control().length;
    panel.resize(44, 9, [second, third, "@9"]);
    panel.resize(70, 20, []);
    await sleep(50);
    assert.deepEqual(world.control().slice(from), [], "nothing resized, nothing captured");
    // The other displayed one alone.
    drawn = screens.length;
    panel.resize(60, 12, ["@1"]);
    await waitFor("its capture", () => screens.length === drawn + 1);
    assert.deepEqual([screens.at(-1).id, screens.at(-1).screen.size], ["@1", { cols: 60, rows: 12 }]);
    assert.deepEqual(windowSizes(world), { "@1": "60x12", [second]: "44x9", [third]: "44x9" });
    // Without ids: every window, and a capture of each displayed one.
    from = world.control().length;
    drawn = screens.length;
    panel.resize(72, 20);
    await waitFor("both displayed captured", () => screens.length === drawn + 2);
    after = world.control().slice(from);
    assert.deepEqual(after.filter((line) => line.startsWith("resize-window")), ["resize-window -t @1 -x 72 -y 20", `resize-window -t ${second} -x 72 -y 20`, `resize-window -t ${third} -x 72 -y 20`]);
    assert.deepEqual(screens.slice(drawn).map((screen) => screen.id).sort(), ["@1", third].sort());
    assert.equal(world.control().some((line) => line.includes("window-size")), false, "never the global window-size");
    panel.end();
  });

  test("two displayed: closing the one not shown leaves the shown one shown; closing the shown one leaves nothing shown, the other still displayed and captured, until focus(); a displayed tab's viewer ending by itself, the other's or the shown one's", async () => {
    const { world, panel, timers, screens, closed, second } = await twoDisplayed({ window: { stderr: "words" } });
    panel.close("@1");
    assert.deepEqual(panel.tabs, { ids: [second], shown: second, displayed: [second] }, "the other closed: the shown one stays shown");
    await waitFor("its end", () => closed.length === 1);
    assert.deepEqual(closed[0], { id: "@1", status: null, stderr: "words", asked: true });
    const third = (await panel.open({ argv: VIEWER, cols: 50, rows: 10, instead: null })).id;
    assert.deepEqual(panel.tabs, { ids: [second, third], shown: third, displayed: [second, third] });
    panel.close();
    assert.deepEqual(panel.tabs, { ids: [second], shown: null, displayed: [second] }, "the shown one closed: nothing shown, and the panel picks no neighbour, the other still displayed");
    await waitFor("its end", () => closed.length === 2);
    assert.deepEqual(closed[1], { id: third, status: null, stderr: "words", asked: true });
    panel.input("dropped");
    // Still displayed: captured when tmux says it changed.
    const drawn = screens.length;
    world.emit(`%output %${second.slice(1)} still drawn`);
    await waitFor("the tick", () => timers.count === 1);
    timers.fire();
    await waitFor("its capture", () => screens.length === drawn + 1);
    assert.equal(screens.at(-1).id, second);
    panel.focus(second);
    panel.input("k");
    await waitFor("the key", () => count(world.control(), "send-keys") === 1);
    assert.deepEqual(sentKeys(world), [[`%${second.slice(1)}`, "k"]], "nothing while none was shown; then to the focused one");
    // Viewers that end by themselves: the one not shown, then the shown one.
    const fourth = (await panel.open({ argv: VIEWER, cols: 50, rows: 10, instead: null })).id;
    assert.deepEqual(panel.tabs, { ids: [second, fourth], shown: fourth, displayed: [second, fourth] });
    world.emit(dead(second, 5));
    await waitFor("its end", () => closed.length === 3);
    assert.deepEqual(closed[2], { id: second, status: 5, stderr: "words", asked: false });
    assert.deepEqual(panel.tabs, { ids: [fourth], shown: fourth, displayed: [fourth] }, "the shown one stays shown");
    const fifth = (await panel.open({ argv: VIEWER, cols: 50, rows: 10, instead: null })).id;
    panel.focus(fourth);
    world.emit(dead(fourth, 0));
    await waitFor("the shown one's end", () => closed.length === 4);
    assert.deepEqual(closed[3], { id: fourth, status: 0, stderr: "words", asked: false });
    assert.deepEqual(panel.tabs, { ids: [fifth], shown: null, displayed: [fifth] }, "nothing shown: the neighbour is the caller's");
    panel.end();
  });

  test("two displayed: the cap counts every tab, displayed or not, and the open under way (E_PANEL_FULL); E_PANEL_BUSY only while another open is under way, an open beside included", async () => {
    const { panel, second } = await twoDisplayed();
    const beside = panel.open({ argv: VIEWER, cols: 40, rows: 8, instead: null });
    await assert.rejects(panel.open({ argv: VIEWER, instead: null }), { code: "E_PANEL_BUSY" });
    const third = (await beside).id;
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: third, displayed: ["@1", third] }, "instead: null with two displayed: the shown one's place");
    const fourth = panel.open({ argv: VIEWER, cols: 40, rows: 8, instead: "@1" });
    await assert.rejects(panel.open({ argv: VIEWER, instead: null }), { code: "E_PANEL_FULL", message: "4 terminals are open in the panel" }, "three open, two of them displayed, and one under way");
    await fourth;
    await assert.rejects(panel.open({ argv: VIEWER, instead: null }), { code: "E_PANEL_FULL" });
    assert.equal(panel.tabs.ids.length, MAX_TERMINALS);
    assert.deepEqual(panel.tabs.displayed, [third, "@4"], "a refused open changes nothing");
    panel.close(second);
    assert.deepEqual(await panel.open({ argv: VIEWER, cols: 50, rows: 10, instead: null }), { id: "@5" }, "a tab not displayed closed frees its place at once");
    panel.end();
  });

  test("an open under way holds its place: a show() or focus() meanwhile is overridden when its window exists; a failed open displays nothing in its place, the other displayed tab stays, and its place is free again", async () => {
    const { world, panel, second } = await twoDisplayed();
    const opening = panel.open({ argv: VIEWER, cols: 50, rows: 10, instead: "@1" });
    assert.deepEqual(panel.tabs, { ids: ["@1", second], shown: null, displayed: [second] }, "@1 is no longer displayed from the call on");
    // A show meanwhile, omitted `instead` and nothing shown: in the place the open holds.
    panel.show("@1");
    assert.deepEqual(panel.tabs, { ids: ["@1", second], shown: "@1", displayed: ["@1", second] });
    panel.input("s");
    panel.focus(second);
    panel.input("f");
    const third = (await opening).id;
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: third, displayed: [second, third] }, "the new tab in its place, shown: the show and the focus overridden");
    panel.input("n");
    await waitFor("the keys", () => count(world.control(), "send-keys") === 3);
    assert.deepEqual(sentKeys(world), [["%1", "s"], [`%${second.slice(1)}`, "f"], [`%${third.slice(1)}`, "n"]]);
    // A failed open: nothing displayed in its place, the other stays displayed, nothing shown.
    world.plan({ window: { print: "no id here\n" } });
    await assert.rejects(panel.open({ argv: VIEWER, cols: 50, rows: 10 }), { code: "E_PANEL_OPEN" });
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: null, displayed: [second] }, "the shown one's place was the open's: nothing in it now");
    world.plan({});
    // Its place is free: a show beside fits.
    panel.show(third, { instead: null });
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: third, displayed: [second, third] });
    // An open given up (close() with no id) frees its place at once: the tab shown there before stays out.
    const given = panel.open({ argv: VIEWER, cols: 50, rows: 10, instead: second });
    panel.close();
    assert.deepEqual(panel.tabs, { ids: ["@1", second, third], shown: null, displayed: [third] });
    panel.show("@1", { instead: null });
    assert.deepEqual(panel.tabs.displayed, ["@1", third], "its place free again");
    await given;
    assert.deepEqual(panel.tabs.displayed, ["@1", third], "the given-up open displays nothing");
    panel.end();
  });

  // THE SWEEP ------------------------------------------------------------------------------------

  /** A dead pid: a child that has exited and been reaped. */
  async function deadPid() {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await new Promise((resolve) => child.once("exit", resolve));
    return child.pid;
  }
  /** A stale socket file at `at`: a child listens there and exits without closing it. */
  function staleSocket(at) {
    execFileSync(process.execPath, ["-e", `require("net").createServer().listen(${JSON.stringify(at)}, () => process.exit(0))`]);
    assert.ok(lstatSync(at).isSocket());
  }
  /** A run directory as a crashed run leaves it. */
  function runDir(tmp, name, { pid, tool = "oats-tui", mode = 0o700, socket = true, owner = true, fifo = true, extra = [] } = {}) {
    const at = path.join(tmp, name);
    mkdirSync(at);
    chmodSync(at, mode);
    if (owner) writeFileSync(path.join(at, "owner.json"), JSON.stringify({ tool, pid, started: "2026-10-14T00:00:00.000Z" }), { mode: 0o600 });
    if (socket) staleSocket(path.join(at, "tmux"));
    if (fifo) execFileSync("mkfifo", ["-m", "600", path.join(at, "alive")]);
    for (const file of ["1.view.err", "1.view.status", ...extra]) writeFileSync(path.join(at, file), "x");
    return at;
  }

  test("the sweep removes what a dead run left (socket, owner.json, the FIFO, the capture's file, view files, then the directory), and nothing else: never a live pid, a socket that answers, another tool's or user's directory, a wrong mode, a link, or a directory with no owner.json", async () => {
    const world = makeWorld(), tmp = path.join(world.dir, "tmp");
    mkdirSync(tmp);
    const dead = await deadPid();
    const removedDirs = [runDir(tmp, "oats-tui-dead01", { pid: dead, extra: ["capture"] }), runDir(tmp, "oats-tui-nosock", { pid: dead, socket: false })];
    const withChange = runDir(tmp, "oats-tui-change", { pid: dead, fifo: false, extra: ["1.out", "1.err", "10.view.err.bak", "alive"] });
    const kept = {
      live: runDir(tmp, "oats-tui-live01", { pid: process.pid }),
      self: runDir(tmp, "oats-tui-self01", { pid: 4242 }),
      answers: runDir(tmp, "oats-tui-answer", { pid: dead }),
      tool: runDir(tmp, "oats-tui-other1", { pid: dead, tool: "something-else" }),
      mode: runDir(tmp, "oats-tui-mode01", { pid: dead, mode: 0o755 }),
      noOwner: runDir(tmp, "oats-tui-noown1", { pid: dead, owner: false }),
      user: runDir(tmp, "oats-tui-user01", { pid: dead }),
      named: runDir(tmp, "not-oats-tui-01", { pid: dead }),
    };
    writeFileSync(path.join(kept.answers, "tmux.answers"), ""); // the fake's list-sessions answers for this socket
    const target = runDir(tmp, "elsewhere", { pid: dead });
    symlinkSync(target, path.join(tmp, "oats-tui-link01"));
    const uid = process.getuid();
    // Another user's directory, as lstat would say it.
    const lstat = (at) => { const stat = lstatSync(at); return at === kept.user ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: uid + 1 }) : stat; };
    const signals = [];
    const answer = sweep({ tmpdir: tmp, uid, pid: 4242, tmux: world.tmux, env: process.env, fs: { lstat }, kill: (pid, signal) => { signals.push(signal); return process.kill(pid, signal); } });
    assert.deepEqual(answer.removed.sort(), [...removedDirs, withChange].sort());
    for (const at of removedDirs) assert.equal(existsSync(at), false, at);
    assert.deepEqual(readdirSync(withChange).sort(), ["1.err", "1.out", "10.view.err.bak", "alive"], "a reader's files stay, an `alive` that is no FIFO stays, and so does the directory");
    for (const [why, at] of Object.entries(kept)) assert.ok(readdirSync(at).includes("owner.json") || why === "noOwner", why);
    for (const at of Object.values(kept)) assert.ok(readdirSync(at).includes("1.view.err"), at);
    assert.ok(existsSync(path.join(target, "tmux")) && existsSync(path.join(tmp, "oats-tui-link01")), "a link is not followed");
    assert.deepEqual([...new Set(signals)], [0], "signal 0 only: it asks, it never signals");
    const asked = world.invocations();
    assert.ok(asked.every((call) => call.commands.length === 1 && call.commands[0][0] === "list-sessions"), "list-sessions only: never kill-server");
    assert.ok(asked.every((call) => path.dirname(call.flags[4]).startsWith(path.join(tmp, "oats-tui-"))), "only the sockets of such directories");
    assert.ok(asked.every((call) => call.env.TMUX === false && call.env.TMUX_PANE === false));
  });

  test("the sweep is bounded, and quiet: no uid, no temp dir, an owner.json that is not JSON", async () => {
    const world = makeWorld(), tmp = path.join(world.dir, "tmp");
    mkdirSync(tmp);
    const dead = await deadPid();
    for (let n = 0; n < 5; n++) runDir(tmp, `oats-tui-many0${n}`, { pid: dead, socket: false });
    assert.equal(sweep({ tmpdir: tmp, uid: process.getuid(), tmux: world.tmux, max: 3 }).removed.length, 3);
    assert.deepEqual(sweep({ tmpdir: tmp, uid: null }).removed, []);
    assert.deepEqual(sweep({ tmpdir: path.join(tmp, "missing"), uid: process.getuid() }).removed, []);
    const bad = runDir(tmp, "oats-tui-badjsn", { pid: dead, socket: false });
    writeFileSync(path.join(bad, "owner.json"), "{ not json");
    assert.deepEqual(sweep({ tmpdir: tmp, uid: process.getuid(), tmux: world.tmux }).removed.sort(), [path.join(tmp, "oats-tui-many03"), path.join(tmp, "oats-tui-many04")]);
    assert.ok(existsSync(path.join(bad, "owner.json")));
  });

  test("the sweep's limit counts only candidates, directories whose owner.json names this tool: look-alikes and a directory a sweep emptied but could not remove come first in order and do not crowd out a dead run", async () => {
    const world = makeWorld(), tmp = path.join(world.dir, "tmp");
    mkdirSync(tmp);
    const dead = await deadPid();
    for (let n = 0; n < 4; n++) runDir(tmp, `oats-tui-aaaa0${n}`, { pid: dead, owner: false, socket: false });
    // A dead run's directory that holds a file the sweep does not know: the first sweep empties it
    // of what it knows, owner.json with it, and cannot remove it; after that it is no candidate.
    const stuck = runDir(tmp, "oats-tui-aaab00", { pid: dead, socket: false, extra: ["1.out"] });
    assert.deepEqual(sweep({ tmpdir: tmp, uid: process.getuid(), tmux: world.tmux, max: 2 }).removed, [stuck]);
    assert.deepEqual(readdirSync(stuck), ["1.out"]);
    const deadRuns = [runDir(tmp, "oats-tui-zzzz01", { pid: dead, socket: false }), runDir(tmp, "oats-tui-zzzz02", { pid: dead, socket: false })];
    assert.deepEqual(sweep({ tmpdir: tmp, uid: process.getuid(), tmux: world.tmux, max: 2 }).removed.sort(), deadRuns);
  });
});

test("a callback that throws does not break the panel: it is thrown again outside it", async () => {
  const thrown = [];
  const listener = (error) => thrown.push(error.message);
  const before = process.listeners("uncaughtException");
  process.removeAllListeners("uncaughtException");
  process.on("uncaughtException", listener);
  try {
    const world = makeWorld(), { panel, timers } = panelOf(world, { onScreen: () => { throw new Error("the caller's own"); } });
    await panel.open({ argv: VIEWER, cols: 50, rows: 10 });
    await waitFor("the throw heard", () => thrown.length === 1);
    world.emit("%output %1 x");
    await waitFor("the tick", () => timers.count === 1);
    timers.fire();
    await waitFor("the second throw", () => thrown.length === 2);
    assert.deepEqual(thrown, ["the caller's own", "the caller's own"]);
    panel.end();
  } finally {
    process.removeListener("uncaughtException", listener);
    for (const other of before) process.on("uncaughtException", other);
  }
});

// THE KEEPER'S SCRIPT, run by itself: a stand-in for the server (`/bin/sh`, the keeper's parent)
// starts it with the FIFO, then says "keeper done" and waits on its stdin. The test holds the
// FIFO's write end and lets go: a keeper that can tell its parent is the server `TMUX` names kills
// it (SIGKILL); one that cannot kills nothing, and the stand-in lives on. PATH holds `cat` and, as
// the case says, a `ps`. Every process a keeper here could kill is the test's own: the stand-in,
// a decoy, or a subreaper the test made (never `$PPID` read at a start: awebai/oats#1615).
/** A directory for PATH: `cat`, and `ps` as given (null: none). */
function keeperPath(ps) {
  const bin = mkdtempSync(path.join(ROOT, "keeper-bin-"));
  symlinkSync(execFileSync("/bin/sh", ["-c", "command -v cat"], { encoding: "utf8" }).trim(), path.join(bin, "cat"));
  if (ps !== null) { writeFileSync(path.join(bin, "ps"), ps); chmodSync(path.join(bin, "ps"), 0o755); }
  return bin;
}
/** The stand-in's `TMUX`, as a tmux server sets it for a pane: `<socket>,<pid>,<session>`, the
 *  socket's path with a comma in it, as one may have. `server` names the stand-in itself. */
const STAND_IN_TMUX = { server: "server", none: "none", of: (pid) => `/tmp/oats,tui/tmux,${pid},0` };
/** Run the keeper under a stand-in server whose panes get `tmux` (STAND_IN_TMUX: its own pid, none,
 *  or another), let go of the FIFO: -> "killed" or "left". */
async function keeperRun(bin, tmux = STAND_IN_TMUX.server) {
  const fifo = path.join(mkdtempSync(path.join(ROOT, "keeper-")), "alive");
  execFileSync("mkfifo", ["-m", "600", fifo]);
  const held = PANEL_FS.hold(fifo);
  const standIn = 'case $3 in server) TMUX="/tmp/oats,tui/tmux,$$,0"; export TMUX;; none) unset TMUX;; *) TMUX=$3; export TMUX;; esac; /bin/sh -c "$1" oats-tui-keeper "$2"; echo "keeper done"; read x';
  const server = spawn("/bin/sh", ["-c", standIn, "server", KEEPER_SCRIPT, fifo, tmux], { env: { PATH: bin }, stdio: ["pipe", "pipe", "ignore"] });
  let said = "";
  server.stdout.on("data", (chunk) => { said += chunk; });
  const ended = new Promise((resolve) => server.once("exit", (code, signal) => resolve(signal)));
  await sleep(200); // the keeper is in its read of the FIFO (and if not yet, it finds no writer: the same)
  PANEL_FS.release(held);
  // Whichever comes first: the stand-in's end, or the keeper's own end with the stand-in alive.
  let outcome = null;
  ended.then((signal) => { outcome ??= signal === "SIGKILL" ? "killed" : `ended ${signal}`; });
  for (let waited = 0; outcome === null && waited < 5000; waited += 10) {
    if (said.includes("keeper done")) outcome = "left";
    else await sleep(10);
  }
  try { server.kill("SIGKILL"); } catch { /* gone */ }
  return outcome ?? "neither within 5 s";
}
const HAS_PROC = existsSync("/proc/self/stat");

test("the keeper names its parent from /proc where there is one: with no ps on PATH it still kills its server; with no /proc and no ps it kills nothing (fail safe)", async () => {
  assert.equal(await keeperRun(keeperPath(null)), HAS_PROC ? "killed" : "left");
});

test("the keeper with a BusyBox-like ps that refuses -p: /proc gives the parent and the server is killed", { skip: HAS_PROC ? false : "no /proc here: the ps path is the one taken" }, async () => {
  assert.equal(await keeperRun(keeperPath("#!/bin/sh\necho 'ps: unrecognized option: p' >&2\nexit 1\n")), "killed");
});

test("the keeper with a ps that names its parent, and no /proc to read first (macOS): the server is killed", { skip: HAS_PROC ? "/proc is read first here" : false }, async () => {
  assert.equal(await keeperRun(keeperPath(`#!/bin/sh\nexec ${execFileSync("/bin/sh", ["-c", "command -v ps"], { encoding: "utf8" }).trim()} "$@"\n`)), "killed");
});

test("the keeper kills only the server `TMUX` names, while that server is its parent: with another pid there (a decoy of the test's), none, or pid 1, nothing is killed (awebai/oats#1615)", async () => {
  const decoy = spawn("/bin/sh", ["-c", "exec sleep 30"], { stdio: "ignore" });
  try {
    assert.equal(await keeperRun(keeperPath(null), STAND_IN_TMUX.of(decoy.pid)), "left", "another pid: the stand-in lives");
    assert.doesNotThrow(() => process.kill(decoy.pid, 0), "and so does the decoy");
    assert.equal(await keeperRun(keeperPath(null), STAND_IN_TMUX.none), "left", "no TMUX");
    assert.equal(await keeperRun(keeperPath(null), STAND_IN_TMUX.of(1)), "left", "pid 1");
    assert.equal(await keeperRun(keeperPath(null), "/tmp/oats-tui/tmux"), "left", "a TMUX that names no pid");
  } finally { decoy.kill("SIGKILL"); }
});

/** python3, for a subreaper of the test's own (prctl PR_SET_CHILD_SUBREAPER, Linux), or null. */
const PYTHON = (() => { try { return execFileSync("/bin/sh", ["-c", "command -v python3"], { encoding: "utf8" }).trim() || null; } catch { return null; } })();
/** The parent of `pid` now, from /proc, or null when it is gone. */
const parentOf = (pid) => { try { return Number(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").pop().split(" ")[1]); } catch { return null; } };
/** Whether `pid` has ended: gone, or a zombie its subreaper has not reaped yet (the test's waits on its stdin). */
const endedProcess = (pid) => { try { return /^[ZX]/.test(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").pop()); } catch { return true; } };
/** Whether `pid` is the keeper's own shell: its $0 is `oats-tui-keeper` once it has exec'd (the subshell it forks from names it only in its script). */
const isKeeper = (pid) => { try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[3] === "oats-tui-keeper"; } catch { return false; } };

test("a keeper whose server ended before its shell started kills nothing: reparented by then to a subreaper (systemd --user on a host, the test's own here), whose pid is both its $PPID and its parent now (awebai/oats#1615)", { skip: HAS_PROC && PYTHON ? false : "needs /proc and python3 for a subreaper of the test's own" }, async (t) => {
  // The subreaper: python, PR_SET_CHILD_SUBREAPER (36) set, says its pid, runs the stand-in, which
  // starts the keeper a second later and exits at once (its `$$` is the pid TMUX names, as the
  // server's), and then waits on its stdin. The keeper is let go only once it is seen adopted by
  // that subreaper: if it is not, it is killed itself, and the FIFO never let go. The subreaper
  // leads a process group of its own, and the whole group is killed at the end: nothing of the
  // test's is ever left for the host's own subreaper to adopt.
  const fifo = path.join(mkdtempSync(path.join(ROOT, "keeper-")), "alive"), pidFile = `${fifo}.pid`;
  execFileSync("mkfifo", ["-m", "600", fifo]);
  const held = PANEL_FS.hold(fifo);
  const standIn = '( sleep 1; TMUX="/tmp/oats-tui/tmux,$$,0" exec /bin/sh -c "$1" oats-tui-keeper "$2" ) & echo $! >"$3"; exit 0';
  const reaper = "import ctypes, os, subprocess, sys\nif ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0: sys.exit(3)\nprint(os.getpid(), flush=True)\nsubprocess.run(['/bin/sh', '-c', sys.argv[1], 'server', sys.argv[2], sys.argv[3], sys.argv[4]])\nsys.stdin.read()\n";
  const sub = spawn(PYTHON, ["-c", reaper, standIn, KEEPER_SCRIPT, fifo, pidFile], { stdio: ["pipe", "pipe", "ignore"], detached: true });
  const ended = new Promise((resolve) => sub.once("exit", (code, signal) => resolve({ code, signal })));
  let said = "";
  sub.stdout.on("data", (chunk) => { said += chunk; });
  let keeper = null, released = false;
  try {
    for (let waited = 0; !/^\d+\n/.test(said) && waited < 5000; waited += 10) await sleep(10);
    if (!/^\d+\n/.test(said)) { const { code } = await Promise.race([ended, sleep(500).then(() => ({}))]); if (code === 3) return t.skip("prctl PR_SET_CHILD_SUBREAPER refused here"); assert.fail("the subreaper never said its pid"); }
    const reaperPid = Number(said.trim());
    for (let waited = 0; waited < 5000 && !(keeper && isKeeper(keeper) && parentOf(keeper) === reaperPid); waited += 10) {
      if (keeper === null && existsSync(pidFile)) keeper = Number(readFileSync(pidFile, "utf8").trim()) || null;
      await sleep(10);
    }
    assert.ok(keeper && isKeeper(keeper) && parentOf(keeper) === reaperPid, `the keeper adopted by the test's subreaper ${reaperPid} (its parent: ${keeper && parentOf(keeper)}): not let go`);
    await sleep(200); // in its read of the FIFO
    PANEL_FS.release(held);
    released = true;
    for (let waited = 0; waited < 3000 && !endedProcess(keeper); waited += 10) await sleep(10);
    assert.ok(endedProcess(keeper), "the keeper ended");
    assert.doesNotThrow(() => process.kill(reaperPid, 0), "the subreaper, its $PPID and its parent, was not killed");
    sub.stdin.end();
    assert.deepEqual(await ended, { code: 0, signal: null }, "and it ends on its own");
  } finally {
    try { process.kill(-sub.pid, "SIGKILL"); } catch { /* gone */ }
    if (!released) PANEL_FS.release(held);
  }
});

// Last and alone, so that nothing else keeps the event loop alive: a start that fails with a
// control client whose `close` never comes still settles. The wait for what the client said is
// bounded by a timer that holds the loop (an unref'd one let the loop empty with the await
// pending: main's CI, "Promise resolution is still pending but the event loop has already resolved").
test("a failed start whose control client never closes still rejects, within the wait's bound: the open never hangs", async () => {
  const world = makeWorld();
  const spawned = [];
  const neverCloses = () => {
    const child = Object.assign(new EventEmitter(), { pid: 999999, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true, unref: () => {} });
    spawned.push(child);
    setImmediate(() => child.stdout.write("%begin 1 1 0\nfake: the server did not start\n%error 1 1 0\n"));
    return child;
  };
  const { panel } = panelOf(world, { spawn: neverCloses });
  const started = Date.now();
  await assert.rejects(panel.open({ argv: VIEWER, cols: 50, rows: 10 }), { code: "E_PANEL_START", detail: "fake: the server did not start" });
  assert.equal(spawned.length, 1);
  assert.ok(Date.now() - started < 5000, "bounded by the wait, not by the close");
  panel.end();
});
