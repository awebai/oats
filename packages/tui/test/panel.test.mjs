// The panel (lib/panel.mjs): the private tmux server of a run, its control client, the viewer in
// a window of it, frames, keys, and the sweep of what a crashed run left. Against a FAKE tmux
// (fixtures/panel/tmux.mjs) behind a shell wrapper in a temp directory: it records every call and
// plays a control client the test drives. No test here starts a real tmux.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { execFile as nodeExecFile, execFileSync, spawn } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import os from "node:os";
import { PassThrough } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FRAME_MS, KEEPER_SCRIPT, MAX_TERMINALS, SESSION, STDERR_KEPT, VIEW_SCRIPT, createPanel, startCommands, sweep, tmuxArgument } from "../lib/panel.mjs";

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
    plan(next) { writeFileSync(path.join(fake, "plan.json"), JSON.stringify(next)); },
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
/** Timers that fire when the test says so: the panel's frame tick is its only timer. */
function frameTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimeout(fn, ms) { const id = next++; pending.set(id, { fn, ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    get count() { return pending.size; },
    delays() { return [...pending.values()].map((t) => t.ms); },
    fire() { const all = [...pending.values()]; pending.clear(); for (const t of all) t.fn(); },
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
      "new-session,set-option,set-option,set-option,set-option,set-option,set-option,unbind-key,unbind-key,unbind-key,unbind-key",
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
      ["set-option", "-gw", "remain-on-exit", "off"],
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

  test("owner.json marks the run directory (0600, its tool, the TUI's pid, the time), and the viewer's two files exist, 0600 and empty, before its window is made", async () => {
    const { world, panel } = await opened();
    const owner = path.join(world.run, "owner.json");
    assert.deepEqual(JSON.parse(readFileSync(owner, "utf8")), { tool: "oats-tui", pid: 4242, started: "2026-10-15T00:00:00.000Z" });
    assert.equal(statSync(owner).mode & 0o777, 0o600);
    assert.equal(statSync(world.run).mode & 0o777, 0o700, "the directory is the caller's, as it made it");
    const [window] = world.windows();
    assert.deepEqual(window.e, { E: path.join(world.run, "1.view.err"), S: path.join(world.run, "1.view.status") });
    assert.deepEqual(window.files, { E: { mode: 0o600, size: 0 }, S: { mode: 0o600, size: 0 } });
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
    assert.equal(VIEW_SCRIPT, '"$0" "$@" 2>"$E"; echo $? >"$S"');
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

  test("a capture: capture-pane -p -e -N and the cursor through the control client, its lines handed to the caller's capture with the size; a pane line that looks like %end does not end the block", async () => {
    const { world, panel, screens, captured, id } = await opened();
    assert.deepEqual(world.control(), ["resize-window -t @1 -x 50 -y 10", "capture-pane -p -e -N -t %1", "display -p -t %1 '#{cursor_x} #{cursor_y} #{cursor_flag}'"]);
    assert.deepEqual(captured, [{ text: "screen 1\n%end 1 2 1\nlast", size: { cols: 50, rows: 10 } }]);
    assert.deepEqual(screens, [{ id, screen: { built: "screen 1\n%end 1 2 1\nlast", size: { cols: 50, rows: 10 } }, cursor: { x: 3, y: 4, visible: true } }]);
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

  test("resize(): resize-window of the open window, then a capture of the new size", async () => {
    const { world, panel, screens, captured } = await opened();
    panel.resize(72, 20);
    await waitFor("the capture", () => screens.length === 2);
    const lines = world.control();
    assert.ok(lines.indexOf("resize-window -t @1 -x 72 -y 20") < lines.lastIndexOf("capture-pane -p -e -N -t %1"));
    assert.deepEqual(captured[1].size, { cols: 72, rows: 20 });
    panel.resize("x", -1);
    await waitFor("the next capture", () => screens.length === 3);
    assert.equal(world.control().filter((line) => line.startsWith("resize-window")).at(-1), "resize-window -t @1 -x 72 -y 20", "a size that is no number keeps the last");
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

  test("a viewer that ends by itself: onClosed with the status its file holds and the last 4096 bytes of its stderr, then both files removed", async () => {
    // 5097 bytes: the last 4096 begin inside the first "é", whose second byte is dropped.
    const head = "x".repeat(1000), tail = `${"é".repeat(STDERR_KEPT / 2)}z`;
    const { world, panel, closed, id } = await opened({ window: { status: "3\n", stderr: head + "y" + tail } });
    world.emit(`%unlinked-window-close ${id}`);
    await waitFor("the end", () => closed.length === 1);
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
    const world = makeWorld({ window: { status: "7\n", stderr: "gone at once", closeAtOnce: true } }), { panel, closed } = panelOf(world, { execFile });
    const order = [];
    const answer = await panel.open({ argv: VIEWER, cols: 50, rows: 10 }).then((value) => { order.push(["open", closed.length]); return value; });
    assert.deepEqual(answer, { id: "@1" });
    await waitFor("the end", () => closed.length === 1);
    assert.deepEqual(order, [["open", 0]], "onClosed came after open() answered");
    assert.deepEqual(closed[0], { id: "@1", status: 7, stderr: "gone at once", asked: false });
    assert.equal(panel.current, null);
    assert.equal(count(world.control(), "capture-pane"), 0);
    panel.end();
  });

  test("%exit: the control client ended, the open viewer is closed with no status, and the next open starts a new server", async () => {
    const { world, panel, closed, id } = await opened({ window: { status: "0\n" } });
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

  test("open() refuses with a code: a viewer open or an open under way (E_PANEL_BUSY), after end() (E_PANEL_ENDED), a bad argv (E_PANEL_OPEN)", async () => {
    const { panel } = await opened();
    await assert.rejects(panel.open({ argv: VIEWER }), { code: "E_PANEL_BUSY" });
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
    panel.end();
    assert.equal(world.invocations().at(-1).commands[0][0], "kill-server");
    assert.deepEqual(readdirSync(world.run), [], "the socket, owner.json, the FIFO and both view files");
    assert.ok(existsSync(world.run), "the directory is the reader's to remove");
    await waitFor("the control client gone", () => !isFake(control));
    const calls = world.invocations().length;
    panel.end();
    for (const act of [() => panel.input("x"), () => panel.paste("x"), () => panel.resize(10, 10), () => panel.close(), () => panel.refresh(), () => panel.setVisible(false), () => panel.pause(), () => panel.resume()]) assert.doesNotThrow(act);
    assert.equal(world.invocations().length, calls, "a second end() calls nothing");
    assert.equal(closed.length, 0, "nothing is said on the way out");
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

  test("the sweep removes what a dead run left (socket, owner.json, the FIFO, view files, then the directory), and nothing else: never a live pid, a socket that answers, another tool's or user's directory, a wrong mode, a link, or a directory with no owner.json", async () => {
    const world = makeWorld(), tmp = path.join(world.dir, "tmp");
    mkdirSync(tmp);
    const dead = await deadPid();
    const removedDirs = [runDir(tmp, "oats-tui-dead01", { pid: dead }), runDir(tmp, "oats-tui-nosock", { pid: dead, socket: false })];
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
