import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { inputSessionTarget, inspectSessionTarget } from "../lib/session-input.mjs";
const target = { backend: "tmux", socket: "/tmp/original.sock", session: "oats", window: "agent" };
// The fake tmux answers each look at the pane (pane size, capture-pane, pane
// size, in one call) from `screen({ enters, captures })`: a string at 80x24,
// or { size, sizeAfter, text }. A throw is an unreadable pane. It runs on a
// fake clock: no real sleeps. By default the screen changes once an Enter has
// been sent; display movement is not harness acceptance evidence.
function fixture(output = "%12\t0\tcodex\t123\n", processes = "123 1 zsh\n", { screen = ({ enters }) => enters ? "submitted" : "pasted" } = {}) {
  const calls = [], sleeps = [];
  let clock = 0, enters = 0, captures = 0;
  return { calls, sleeps, get enters() { return enters; }, get clock() { return clock; }, advance(ms) { clock += ms; },
    sleep(ms) { sleeps.push(ms); clock += ms; },
    now() { return clock; },
    exec(bin, args, opts) {
      if (bin === "ps") return processes;
      assert.equal(bin, "tmux");
      assert.deepEqual(args.slice(0, 3), ["-u", "-S", target.socket]);
      calls.push({ args: args.slice(3), input: opts.input, at: clock, timeout: opts.timeout });
      if (args[3] === "list-panes") return output;
      if (args[3] === "send-keys") enters++;
      if (args.includes("capture-pane")) {
        const look = screen({ enters, captures: ++captures });
        const { size = "80x24", sizeAfter = size, text } = typeof look === "string" ? { text: look } : look;
        return `${size}\n${text}\n${sizeAfter}\n`;
      }
      return "";
    } };
}
const named = (io, name) => io.calls.filter((c) => c.args[0] === name);
function receipt(io, result, verified) {
  assert.deepEqual(result, { backend: "tmux", present: true, state: "unknown", paneId: "%12", submitted: true, verified });
  for (const command of ["load-buffer", "paste-buffer", "send-keys"]) {
    assert.equal(named(io, command).length, 1, `${command} happens exactly once`);
    assert.equal(named(io, command)[0].timeout, 10000, "terminal-command timeout is unchanged");
  }
  assert.deepEqual(named(io, "send-keys")[0].args, ["send-keys", "-t", "%12", "Enter"]);
  const after = io.calls.slice(io.calls.findIndex(c => c.args[0] === "send-keys") + 1);
  assert.ok(after.length <= 2, "at most two read-only post-Enter probes");
  assert.ok(after.every(c => c.args.includes("capture-pane")), "observations never trigger another key or paste");
}
test("tmux submits literal multiline input using bracketed paste and one Enter and an observational result", () => {
  const io = fixture();
  const text = "$(touch forbidden)\n`literal`";
  const result = inputSessionTarget(target, text, io);
  receipt(io, result, true);
  assert.equal("reason" in result, false);
  assert.equal(io.calls[1].input, text);
  assert.equal(io.calls[1].args[0], "load-buffer");
  assert.deepEqual(io.calls[2].args.slice(0, 2), ["paste-buffer", "-p"]);
  assert.equal(io.calls[3].args[0], "delete-buffer");
  assert.deepEqual(named(io, "send-keys").map((c) => c.args), [["send-keys", "-t", "%12", "Enter"]]);
  assert.deepEqual(io.calls.find((c) => c.args.includes("capture-pane")).args, [
    "display-message", "-p", "-t", "%12", "#{pane_width}x#{pane_height}", ";",
    "capture-pane", "-p", "-J", "-t", "%12", "-S", "-200", ";",
    "display-message", "-p", "-t", "%12", "#{pane_width}x#{pane_height}"]);
});
test("tmux refuses fallback shells, dead panes and ambiguous split windows", () => {
  for (const out of ["%1\t0\tzsh\t123", "%1\t1\tcodex", "%1\t0\tcodex\n%2\t0\tpi"]) {
    const io = fixture(out);
    assert.throws(() => inputSessionTarget(target, "wake", io));
    assert.equal(io.calls.length, 1);
  }
});
test("tmux unavailable socket is not reported absent", () => {
  const io = { exec() { throw Object.assign(new Error("failure"), { stderr: "error connecting to socket: Permission denied" }); } };
  assert.throws(() => inspectSessionTarget(target, io), /failure/);
});

test("tmux wrapper shell with a live generic harness descendant remains an input target", () => {
  const io = fixture("%12\t0\tzsh\t123", "123 1 zsh\n124 123 /bin/sh\n125 124 /opt/bin/custom-harness\n");
  assert.equal(inputSessionTarget(target, "wake", io).submitted, true);
});
test("retired homes inspect as stopped for broker deregistration", async () => {
  const { inspectInstanceSession } = await import("../lib/core.mjs");
  const state = inspectInstanceSession("/tmp/oats-session-already-retired-does-not-exist");
  assert.equal(state.present, false);
  assert.equal(state.state, "stopped");
});

test("tmux never sends a second Enter even when a display would change only after another key", () => {
  const io = fixture(undefined, undefined, { screen: ({ enters }) => enters >= 2 ? "changed" : "same look" });
  receipt(io, inputSessionTarget(target, "wake", io), false);
});
test("tmux unchanged display is successful terminal input with no refusal or retransmission", () => {
  const io = fixture(undefined, undefined, { screen: () => "same look" });
  receipt(io, inputSessionTarget(target, "wake", io), false);
  assert.ok(io.clock <= 3000, `observational budgets: ${io.clock} ms`);
});
test("tmux sends no extra key when the pane cannot be read", () => {
  const unreadable = () => { throw Object.assign(new Error("can't find pane"), { stderr: "can't find pane: %12" }); };
  for (const screen of [unreadable, ({ enters }) => enters ? unreadable() : "pasted"]) {
    const io = fixture(undefined, undefined, { screen });
    const result = inputSessionTarget(target, "wake", io);
    receipt(io, result, false);
    assert.equal("reason" in result, false);
    assert.equal(io.enters, 1);
  }
});
test("tmux observes a delayed display change without another key", () => {
  // First read-only post-Enter look is unchanged; only the second look moves.
  let seen = 0;
  const io = fixture(undefined, undefined, { screen: ({ enters }) => enters && ++seen > 1 ? "taken" : "pasted" });
  const result = inputSessionTarget(target, "wake", io);
  receipt(io, result, true);
  assert.equal(io.enters, 1);
});
test("tmux waits for the pane to settle on two identical captures before Enter", () => {
  const frames = ["p1", "p2", "p3", "p3"];
  const io = fixture(undefined, undefined, { screen: ({ enters, captures }) => enters ? "taken" : frames[captures - 1] });
  inputSessionTarget(target, "wake", io);
  const enterAt = io.calls.findIndex((c) => c.args[0] === "send-keys");
  assert.equal(io.calls.slice(0, enterAt).filter((c) => c.args.includes("capture-pane")).length, 4);
  assert.deepEqual(io.sleeps.slice(0, 4), [203, 100, 100, 100], "a floor for a 1 KiB paste, then 100 ms polls");
});
test("tmux gives up settling at the cap and scales the floor with paste size", () => {
  const io = fixture(undefined, undefined, { screen: ({ enters, captures }) => enters ? "taken" : `spinner ${captures}` });
  const result = inputSessionTarget(target, "x".repeat(256 * 1024), io);
  receipt(io, result, false);
  assert.equal(io.sleeps[0], 200 + 256 * 3);
  const enterAt = named(io, "send-keys")[0].at;
  assert.equal(enterAt, 2000, `Enter at the 2 s cap, not before: ${enterAt}`);
});
test("tmux compares only the bottom 15 lines, ignoring trailing blank rows", () => {
  const top = Array.from({ length: 30 }, (_, i) => `history ${i}`);
  const bottom = Array.from({ length: 15 }, (_, i) => `row ${i}`);
  // Movement outside the observed region does not prove anything about input effects.
  const io = fixture(undefined, undefined, { screen: ({ captures }) => [`clock ${captures}`, ...top, ...bottom, "", "  "].join("\n") });
  receipt(io, inputSessionTarget(target, "wake", io), false);
});
test("tmux losing its server at Enter is an error, with no retry", () => {
  const io = fixture();
  const exec = io.exec;
  io.exec = (bin, args, opts) => {
    if (args[3] === "send-keys") { exec(bin, args, opts); throw Object.assign(new Error("no server"), { stderr: "no server running" }); }
    return exec(bin, args, opts);
  };
  assert.throws(() => inputSessionTarget(target, "wake", io), /no server/);
  assert.equal(io.enters, 1);
});
test("tmux reads a reflow as unchanged display without resending", () => {
  // The same content redrawn narrower and wider: rules change length, lines
  // rewrap, and the region's top cut moves. Geometry alone is not new content.
  const at = (width) => {
    const rule = "─".repeat(width);
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const wrapped = words.match(new RegExp(`.{1,${width - 2}}(\\s|$)`, "g")).map((l) => l.trimEnd());
    return [...wrapped, rule, "❯ [Pasted text #3 +40 lines]", rule, "  status"].join("\n");
  };
  // Settled at 80 columns; the single Enter is followed by a narrower redraw.
  const widths = [80, 30, 120, 50];
  const io = fixture(undefined, undefined, { screen: ({ enters }) => ({ size: `${widths[enters]}x24`, text: at(widths[enters]) }) });
  assert.notEqual(at(30), at(80));
  assert.ok(at(30).split("\n").length > 15, "the narrow redraw moves the region's top cut");
  const result = inputSessionTarget(target, "wake", io);
  receipt(io, result, false);
});
test("tmux reads a cleared input row as changed display even when nothing else moved", () => {
  const io = fixture(undefined, undefined, { screen: ({ enters }) => ["header", enters ? "❯" : "❯ wake text", "status"].join("\n") });
  const result = inputSessionTarget(target, "wake", io);
  receipt(io, result, true);
  assert.equal(io.enters, 1);
});
test("tmux reads content that appeared above the input as changed display, on a pane of the same size", () => {
  const io = fixture(undefined, undefined, { screen: ({ enters }) => (enters ? "Confirm queued request?\n" : "") + "❯ wake\nstatus" });
  const result = inputSessionTarget(target, "wake", io);
  receipt(io, result, true);
  assert.equal(io.enters, 1);
});
test("tmux reads a cleared box-drawing input as changed display, on a pane of the same size", () => {
  const io = fixture(undefined, undefined, { screen: ({ enters }) => `header\n${enters ? "❯" : "❯ ─"}\nstatus` });
  const result = inputSessionTarget(target, "─", io);
  receipt(io, result, true);
  assert.equal(io.enters, 1);
});
test("tmux still reads new or removed content as changed display when the pane also changed size", () => {
  const rule = (w) => "─".repeat(w);
  for (const after of [`Confirm queued request?\n${rule(60)}\n❯ wake\n${rule(60)}\nstatus`, `header\n${rule(60)}\n❯\n${rule(60)}\nstatus`]) {
    const io = fixture(undefined, undefined, { screen: ({ enters }) => enters
      ? { size: "60x24", text: after }
      : { size: "80x24", text: `header\n${rule(80)}\n❯ wake\n${rule(80)}\nstatus` } });
    const result = inputSessionTarget(target, "wake", io);
    receipt(io, result, true);
    assert.equal(io.enters, 1);
  }
});
test("tmux reads a cleared box-drawing input as changed display when the pane also changed size", () => {
  const rule = (w) => "─".repeat(w);
  const io = fixture(undefined, undefined, { screen: ({ enters }) => enters
    ? { size: "60x24", text: `header\n${rule(60)}\n❯\n${rule(60)}\nstatus` }
    : { size: "80x24", text: `header\n${rule(80)}\n❯ ─\n${rule(80)}\nstatus` } });
  const result = inputSessionTarget(target, "─", io);
  receipt(io, result, true);
  assert.equal(io.enters, 1);
});
test("tmux treats a size that moved during one capture as a size change", () => {
  // Same content with its size moving mid-capture remains an unchanged look.
  const io = fixture(undefined, undefined, { screen: ({ enters }) => enters
    ? { size: "80x24", sizeAfter: "100x24", text: "header\n" + "─".repeat(100) + "\n❯ wake\nstatus" }
    : "header\n" + "─".repeat(80) + "\n❯ wake\nstatus" });
  receipt(io, inputSessionTarget(target, "wake", io), false);
});
test("tmux observation failure on its second post-Enter look is unverified, never input failure", () => {
  let looks = 0;
  const io = fixture(undefined, undefined, { screen: ({ enters }) => { if (enters && ++looks === 2) throw new Error("pane gone"); return "same look"; } });
  receipt(io, inputSessionTarget(target, "wake", io), false);
});
test("tmux ignores trailing spaces a redraw pads differently, on a pane of the same size", () => {
  const io = fixture(undefined, undefined, { screen: ({ enters }) => enters ? "reply   \n❯ [Pasted text #1 +9 lines]\nstatus" : "reply\n❯ [Pasted text #1 +9 lines]      \nstatus  " });
  receipt(io, inputSessionTarget(target, "wake", io), false);
});


test("tmux includes cleanup time in the pre-Enter budget and skips exhausted observations", () => {
  const io = fixture();
  const exec = io.exec;
  io.exec = (bin, args, opts) => {
    const out = exec(bin, args, opts);
    if (args[3] === "delete-buffer") io.advance(2100);
    return out;
  };
  receipt(io, inputSessionTarget(target, "wake", io), false);
  assert.deepEqual(io.sleeps, []);
  assert.equal(io.calls.filter(c => c.args.includes("capture-pane")).length, 0);
});

test("tmux clips slow pre-Enter capture timeout and sleeps to the single remaining budget", () => {
  const io = fixture(undefined, undefined, { screen: () => "changing" });
  const exec = io.exec;
  let probes = 0;
  const budgets = [];
  io.exec = (bin, args, opts) => {
    const out = exec(bin, args, opts);
    if (args.includes("capture-pane")) {
      budgets.push([opts.timeout, Math.floor(2000 - io.clock)]);
      io.advance(++probes === 1 ? 1700 : opts.timeout);
    }
    return out;
  };
  receipt(io, inputSessionTarget(target, "wake", io), false);
  assert.deepEqual(budgets.map(([actual, expected]) => actual), budgets.map(([, expected]) => expected));
  assert.equal(probes, 1, "clipped poll sleep exhausts the deadline before another probe");
  assert.equal(named(io, "send-keys")[0].at, 2000);
  assert.deepEqual(io.sleeps, [203, 97]);
});

test("tmux caps timed-out capture by remaining pre/post budget and still sends one Enter", () => {
  for (const phase of ["pre", "post"]) {
    const io = fixture(undefined, undefined, { screen: () => "same look" });
    const exec = io.exec;
    let afterEnter;
    const budgets = [];
    io.exec = (bin, args, opts) => {
      const out = exec(bin, args, opts);
      if (args[3] === "send-keys") afterEnter = io.clock;
      if (args.includes("capture-pane") && (phase === "pre" || io.enters)) {
        const deadline = phase === "pre" ? 2000 : afterEnter + 1000;
        budgets.push([opts.timeout, Math.floor(deadline - io.clock)]);
        io.advance(opts.timeout);
        throw Object.assign(new Error("inert timeout"), { code: "ETIMEDOUT" });
      }
      return out;
    };
    receipt(io, inputSessionTarget(target, "wake", io), false);
    assert.ok(budgets.length > 0);
    assert.deepEqual(budgets.map(([actual]) => actual), budgets.map(([, expected]) => expected));
    assert.ok(io.clock <= 3000);
  }
});

test("tmux discards a capture that returns changed display after its observation deadline", () => {
  const io = fixture();
  const exec = io.exec;
  io.exec = (bin, args, opts) => {
    const out = exec(bin, args, opts);
    if (args.includes("capture-pane") && io.enters) io.advance(opts.timeout + 1);
    return out;
  };
  receipt(io, inputSessionTarget(target, "wake", io), false);
});

test("tmux uses monotonic time even when the wall clock moves backwards", (t) => {
  const io = fixture(undefined, undefined, { screen: ({ captures }) => `moving ${captures}` });
  delete io.now;
  t.mock.method(performance, "now", () => io.clock);
  t.mock.method(Date, "now", () => 100000 - io.clock);
  receipt(io, inputSessionTarget(target, "wake", io), false);
  assert.equal(named(io, "send-keys")[0].at, 2000);
});

test("tmux load/paste/key failures propagate while buffer cleanup remains best effort", () => {
  for (const failure of ["load-buffer", "paste-buffer", "send-keys"]) {
    const io = fixture(), exec = io.exec;
    io.exec = (bin, args, opts) => {
      const out = exec(bin, args, opts);
      if (args[3] === failure) throw new Error(`inert ${failure} failure`);
      return out;
    };
    assert.throws(() => inputSessionTarget(target, "literal", io), new RegExp(failure));
    assert.equal(named(io, "delete-buffer").length, 1);
    assert.ok(io.enters <= 1);
  }
});

test("slow post-Enter observation consumes the one shared deadline before another probe", () => {
  const io = fixture(undefined, undefined, { screen: () => "same look" }), exec = io.exec;
  let postProbes = 0;
  io.exec = (bin, args, opts) => {
    const out = exec(bin, args, opts);
    if (args.includes("capture-pane") && io.enters) { postProbes++; io.advance(500); }
    return out;
  };
  receipt(io, inputSessionTarget(target, "wake", io), false);
  assert.equal(postProbes, 1);
  assert.equal(io.clock - named(io, "send-keys")[0].at, 1000);
  assert.equal(io.sleeps.at(-1), 200);
});

// The process scans read the real `ps` whatever the caller's PATH holds (#878): a pane whose shell
// runs a non-shell child, read with this process's PATH holding no `ps`, tmux answered by the fake.
async function shellWithChild(t) {
  const { spawn } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const shell = spawn("/bin/sh", ["-c", "sleep 30; :"], { stdio: "ignore" });
  const empty = mkdtempSync(join(tmpdir(), "oats-no-ps-"));
  const path = process.env.PATH;
  t.after(() => { process.env.PATH = path; shell.kill("SIGKILL"); rmSync(empty, { recursive: true, force: true }); });
  // The child is forked once its shell has read the command: wait until the shell has one.
  const { execFileSync } = await import("node:child_process");
  for (let i = 0; i < 200 && !execFileSync("ps", ["-axo", "ppid="], { encoding: "utf8" }).split("\n").some((l) => Number(l) === shell.pid); i++) await new Promise((r) => setTimeout(r, 25));
  process.env.PATH = empty;
  /** → an io whose tmux answers `answer(pid)` and whose `ps` is the real one, run as the kernel asks. */
  return { io: (answer) => ({ exec: (bin, args, opts) => (bin === "ps" ? execFileSync(bin, args, opts) : answer(shell.pid)) }) };
}

test("a pane's shell is read through the real ps when the caller's PATH holds none (#878)", async (t) => {
  const pane = await shellWithChild(t);
  assert.deepEqual(inspectSessionTarget(target, pane.io((pid) => `%12\t0\tsh\t${pid}\n`)), { backend: "tmux", present: true, state: "unknown", paneId: "%12" }, "its non-shell child is seen: not a fallback shell");
});

test("a pane's harness processes are read through the real ps when the caller's PATH holds none (#878)", async (t) => {
  const { harnessProcesses } = await import("../lib/core.mjs");
  const pane = await shellWithChild(t);
  assert.deepEqual(harnessProcesses(target, pane.io((pid) => `${pid}\n`)).map((r) => r.comm), ["sleep"]);
});
