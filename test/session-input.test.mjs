import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { AGENT_PANE_OPTION, createSessionPaneInspector, inputSessionTarget, inspectSessionTarget, resolveAgentPane } from "../lib/session-input.mjs";
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

// Missing tmux labels are resolved from the pane's own process, never from
// an unrelated shell or from the absence of a known harness name.
for (const command of ["unset", ""]) {
  const label = command || "empty";
  test(`1381: ${label} command with a bare shell is present at a fallback prompt`, () => {
    const io = fixture(`%12\t0\t${command}\t123\n`, "123 1 zsh\n999 1 custom-worker\n");
    assert.deepEqual(inspectSessionTarget(target, io), { backend: "tmux", present: true, state: "shell", paneId: "%12" });
  });
  test(`1381: ${label} command with a live generic descendant remains unknown`, () => {
    const io = fixture(`%12\t0\t${command}\t123\n`, "125 124 /opt/custom-worker\n124 123 /bin/-sh\n123 1 /bin/-zsh\n");
    assert.deepEqual(inspectSessionTarget(target, io), { backend: "tmux", present: true, state: "unknown", paneId: "%12" });
  });
  test(`1381: ${label} command accepts basename and login-shell names with only shell descendants`, () => {
    const io = fixture(`%12\t0\t${command}\t123\n`, "125 124 /bin/dash\n124 123 -sh\n123 1 /bin/-bash\n");
    assert.deepEqual(inspectSessionTarget(target, io), { backend: "tmux", present: true, state: "shell", paneId: "%12" });
  });
  test(`1381: ${label} command without a readable own shell remains unknown`, () => {
    for (const processes of ["123 1 /opt/custom-worker\n", "999 1 zsh\n", "123 1\n", "123 invalid zsh\n", "123 1 -\n", "123 1 /\n", ""]) {
      const io = fixture(`%12\t0\t${command}\t123\n`, processes);
      assert.deepEqual(inspectSessionTarget(target, io), { backend: "tmux", present: true, state: "unknown", paneId: "%12" }, JSON.stringify(processes));
    }
    for (const pid of ["", "not-a-pid"]) {
      const io = fixture(`%12\t0\t${command}\t${pid}\n`);
      assert.deepEqual(inspectSessionTarget(target, io), { backend: "tmux", present: true, state: "unknown", paneId: "%12" });
    }
  });
}
test("1381: optional and required shell reads share one successful process scan across panes", () => {
  let scans = 0;
  const inspect = createSessionPaneInspector({ exec(binary) {
    assert.equal(binary, "ps"); scans++;
    return "123 1 /bin/-zsh\n456 1 bash\n789 1 sh\n790 789 /opt/custom-worker\n";
  } });
  for (const [command, pid, state] of [["unset", "123", "shell"], ["", "456", "shell"], ["sh", "789", "unknown"]]) {
    assert.deepEqual(inspect([`%12\t0\t${command}\t${pid}`]), { backend: "tmux", present: true, state, paneId: "%12" });
  }
  assert.equal(scans, 1, "one snapshot resolves different pane PIDs and command labels");
});
test("1381: failed optional scans stay unknown and cache the error for required shell reads", () => {
  let scans = 0;
  const failure = new Error("ps denied");
  const inspect = createSessionPaneInspector({ exec(binary) { assert.equal(binary, "ps"); scans++; throw failure; } });
  for (const command of ["unset", ""]) {
    assert.deepEqual(inspect([`%12\t0\t${command}\t123`]), { backend: "tmux", present: true, state: "unknown", paneId: "%12" });
  }
  assert.throws(() => inspect(["%12\t0\tzsh\t123"]), (error) => error === failure);
  assert.equal(scans, 1);
});
test("1381: dead, malformed, split and other labelled panes retain their observation rules", () => {
  const inspect = createSessionPaneInspector({ exec() { assert.fail("these observations need no process scan"); } });
  for (const command of ["unset", "", "custom-worker", "UNSET", " unset", "unset "]) {
    assert.deepEqual(inspect([`%12\t1\t${command}\t123`]), { backend: "tmux", present: false, state: "stopped", paneId: "%12" });
  }
  for (const command of ["custom-worker", "UNSET", " unset", "unset "]) {
    assert.deepEqual(inspect([`%12\t0\t${command}\t123`]), { backend: "tmux", present: true, state: "unknown", paneId: "%12" });
  }
  assert.throws(() => inspect(["garbage"]), /invalid tmux pane response/);
  // A split window (#1569): its agent's pane is judged alone, here the unmarked one with the lowest
  // id, dead; when the agent's pane cannot be told, the observation is refused.
  assert.deepEqual(inspect(["%13\t0\tunset\t456", "%12\t1\tunset\t123"]), { backend: "tmux", present: false, state: "stopped", paneId: "%12" });
  assert.throws(() => inspect(["%12\t0\tunset\t123\tdev-1", "%13\t0\tunset\t456\tdev-1"], { name: "dev-1" }), /^Error: the window has 2 panes marked as dev-1's agent pane/);
  assert.throws(() => inspect(["%12\t0\tzsh\tbad"]), /no pane process id/);
});
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
  // Ambiguous (#1569): two panes marked as this window's agent pane, or only another instance's.
  for (const out of ["%1\t0\tzsh\t123", "%1\t1\tcodex", "%1\t0\tcodex\t11\tagent\n%2\t0\tpi\t12\tagent", "%1\t0\tcodex\t11\tother\n%2\t0\tpi\t12\tother"]) {
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

test("inspect size is read with the pane identity in one tmux call", () => {
  const io = fixture("%12\t0\tcodex\t123\t137\t43\n");
  assert.deepEqual(inspectSessionTarget(target, io, { includeSize: true }), {
    backend: "tmux", present: true, state: "unknown", paneId: "%12", size: { cols: 137, rows: 43 },
  });
  assert.deepEqual(io.calls.map(c => c.args), [["list-panes", "-t", "=oats:=agent", "-F",
    "#{pane_id}\t#{pane_dead}\t#{pane_current_command}\t#{pane_pid}\t#{window_width}\t#{window_height}\t#{@oats-agent}"]]);
});

test("inspect size rejects malformed dimensions with the existing pane-response error", () => {
  for (const bad of [undefined, "", "0", "-1", "1.5", "NaN", "Infinity", "80px", "1e2", " 80", "80 ", "9007199254740992"]) {
    for (const dims of [[bad, "24"], ["80", bad]]) {
      const io = fixture(["%12", "0", "codex", "123", ...dims].join("\t") + "\n");
      assert.throws(() => inspectSessionTarget(target, io, { includeSize: true }), /^Error: invalid tmux pane response$/, JSON.stringify(dims));
    }
  }
});

test("inspect omits size for absent and retained dead panes", () => {
  for (const output of ["", "%12\t1\tcodex\t123\t80\t24\n"]) {
    const result = inspectSessionTarget(target, fixture(output), { includeSize: true });
    assert.equal(result.present, false);
    assert.equal(Object.hasOwn(result, "size"), false);
  }
});

// ---- the agent's pane in a window with other panes (#1569) --------------------------------------

const TWICE = "the window has 2 panes marked as dev-1's agent pane (%3, %7); close all but the agent's with tmux kill-pane -t <id>, or close the window and start the instance";
const NONE = "the window has 2 panes and none is dev-1's agent pane (%3, %7); close the panes that aren't, or close the window and start the instance";
const panesOf = (...specs) => specs.map(([paneId, mark = ""]) => ({ paneId, mark }));
test("1569: resolveAgentPane: one pane is the agent's; of several, the one marked with the name, else the unmarked pane with the lowest id; never another instance's", () => {
  assert.equal(AGENT_PANE_OPTION, "@oats-agent");
  assert.deepEqual(resolveAgentPane([], "dev-1"), { pane: null });
  for (const mark of ["", "dev-1", "dev-2"]) {
    const [only] = panesOf(["%4", mark]);
    assert.equal(resolveAgentPane([only], "dev-1").pane, only, `one pane, marked ${JSON.stringify(mark)}: the element itself`);
  }
  // The marked pane, wherever it is listed and whatever its id.
  for (const panes of [panesOf(["%3"], ["%7", "dev-1"]), panesOf(["%7", "dev-1"], ["%3"]), panesOf(["%3", "dev-2"], ["%7", "dev-1"], ["%1"])]) {
    assert.equal(resolveAgentPane(panes, "dev-1").pane.paneId, "%7", JSON.stringify(panes));
  }
  // No mark: the lowest id, by number (%9 before %10), whatever the listing's order.
  assert.equal(resolveAgentPane(panesOf(["%10"], ["%9"]), "dev-1").pane.paneId, "%9");
  assert.equal(resolveAgentPane(panesOf(["%9"], ["%10"]), "dev-1").pane.paneId, "%9");
  // Another instance's mark is never the agent's, even on the lowest id.
  assert.equal(resolveAgentPane(panesOf(["%1", "dev-2"], ["%5"]), "dev-1").pane.paneId, "%5");
  // Cannot tell: two marked with the name, or no candidate at all. Ids ascending, by number.
  assert.deepEqual(resolveAgentPane(panesOf(["%7", "dev-1"], ["%3", "dev-1"]), "dev-1"), { error: TWICE });
  assert.deepEqual(resolveAgentPane(panesOf(["%7", "dev-1"], ["%3", "dev-1"], ["%1"]), "dev-1"), { error: TWICE }, "two marked: an unmarked pane does not settle it");
  assert.deepEqual(resolveAgentPane(panesOf(["%7", "dev-2"], ["%3", "dev-3"]), "dev-1"), { error: NONE });
  assert.match(resolveAgentPane(panesOf(["%10", "x"], ["%9", "x"], ["%100", "x"]), "dev-1").error, /^the window has 3 panes and none is dev-1's agent pane \(%9, %10, %100\);/);
  // Every other field of a pane is carried along.
  const pane = { paneId: "%2", mark: "dev-1", fields: ["%2"] };
  assert.equal(resolveAgentPane([{ paneId: "%1", mark: "" }, pane], "dev-1").pane, pane);
});

test("1569: the inspector judges the agent's pane alone in a split window", () => {
  const inspect = createSessionPaneInspector({ exec(binary) {
    assert.equal(binary, "ps");
    // %3's shell 300 has only a shell below it; %7's shell 700 runs an editor.
    return "300 1 zsh\n301 300 -zsh\n700 1 zsh\n701 700 vim\n";
  } });
  const live = (paneId) => ({ backend: "tmux", present: true, state: "unknown", paneId });
  // One pane is the agent's, whatever its mark.
  assert.deepEqual(inspect(["%7\t0\tcodex\t700"], { name: "dev-1" }), live("%7"));
  assert.deepEqual(inspect(["%7\t0\tcodex\t700\tdev-2"], { name: "dev-1" }), live("%7"));
  // The marked pane, listed first or second (the active pane is not asked).
  assert.deepEqual(inspect(["%7\t0\tcodex\t700\tdev-1", "%3\t0\tvim\t300\t"], { name: "dev-1" }), live("%7"));
  assert.deepEqual(inspect(["%3\t0\tvim\t300\t", "%7\t0\tcodex\t700\tdev-1"], { name: "dev-1" }), live("%7"));
  // No mark: the lowest id, numerically.
  assert.deepEqual(inspect(["%10\t0\tvim\t300", "%9\t0\tcodex\t700"], { name: "dev-1" }), live("%9"));
  // Another instance's mark is never chosen; only such panes: cannot tell.
  assert.deepEqual(inspect(["%1\t0\tvim\t300\tdev-2", "%5\t0\tcodex\t700\t"], { name: "dev-1" }), live("%5"));
  assert.throws(() => inspect(["%7\t0\tcodex\t700\tdev-2", "%3\t0\tcodex\t300\tdev-3"], { name: "dev-1" }), (e) => e.message === NONE);
  // Two marked with the name: cannot tell.
  assert.throws(() => inspect(["%7\t0\tcodex\t700\tdev-1", "%3\t0\tcodex\t300\tdev-1"], { name: "dev-1" }), (e) => e.message === TWICE);
  // The agent's pane dead beside a live one: stopped.
  assert.deepEqual(inspect(["%3\t0\tvim\t300\t", "%7\t1\tcodex\t700\tdev-1"], { name: "dev-1" }), { backend: "tmux", present: false, state: "stopped", paneId: "%7" });
  // The agent's pane a fallback shell beside a pane that runs something: shell. The other pane's
  // processes (vim under 700) are not the agent's.
  assert.deepEqual(inspect(["%3\t0\tzsh\t300\tdev-1", "%7\t0\tzsh\t700\t"], { name: "dev-1" }), { backend: "tmux", present: true, state: "shell", paneId: "%3" });
  assert.deepEqual(inspect(["%3\t0\tzsh\t300\t", "%7\t0\tzsh\t700\tdev-1"], { name: "dev-1" }), live("%7"), "and the other way round: a live descendant under the agent's pane");
  // A malformed row anywhere in the window is a malformed answer.
  assert.throws(() => inspect(["%3\t0\tcodex\t300\tdev-1", "garbage"], { name: "dev-1" }), /^Error: invalid tmux pane response$/);
});

test("1569: inspection reads the mark last in the one list-panes call, with and without size, and counts the panes when asked", () => {
  const io = fixture("%12\t0\tvim\t123\t\n%13\t0\tcodex\t124\tagent\n");
  assert.deepEqual(inspectSessionTarget(target, io), { backend: "tmux", present: true, state: "unknown", paneId: "%13" });
  assert.deepEqual(io.calls.map((c) => c.args), [["list-panes", "-t", "=oats:=agent", "-F", "#{pane_id}\t#{pane_dead}\t#{pane_current_command}\t#{pane_pid}\t#{@oats-agent}"]]);
  assert.deepEqual(inspectSessionTarget(target, io, { includePanes: true }), { backend: "tmux", present: true, state: "unknown", paneId: "%13", panes: 2 });
  assert.deepEqual(inspectSessionTarget(target, fixture("%12\t0\tcodex\t123\t\n"), { includePanes: true }), { backend: "tmux", present: true, state: "unknown", paneId: "%12", panes: 1 });
  const sized = fixture("%12\t0\tvim\t123\t137\t43\t\n%13\t0\tcodex\t124\t137\t43\tagent\n");
  assert.deepEqual(inspectSessionTarget(target, sized, { includeSize: true, includePanes: true }), {
    backend: "tmux", present: true, state: "unknown", paneId: "%13", size: { cols: 137, rows: 43 }, panes: 2,
  });
  // A row without the mark (a pane listed before the option existed) is an unmarked pane.
  assert.deepEqual(inspectSessionTarget(target, fixture("%12\t0\tcodex\t123\t137\t43\n"), { includeSize: true }).size, { cols: 137, rows: 43 });
});

test("1569: input into a split window goes to the agent's pane alone", () => {
  const io = fixture("%12\t0\tvim\t123\t\n%13\t0\tcodex\t124\tagent\n");
  const result = inputSessionTarget(target, "wake", io);
  assert.equal(result.paneId, "%13");
  assert.equal(result.submitted, true);
  assert.deepEqual(named(io, "paste-buffer")[0].args.slice(-2), ["-t", "%13"]);
  assert.deepEqual(named(io, "send-keys").map((c) => c.args), [["send-keys", "-t", "%13", "Enter"]]);
  assert.equal(io.calls.some((c) => c.args.includes("%12")), false, "the other pane is never addressed");
});

// Stop (lib/core.mjs harnessProcesses, stopHarness) in a window `dev-1` split in two: %2, unmarked
// and the lower id, runs vim under its shell 200; %3, marked as dev-1's, runs the harness under its
// shell 300. Only %3's descendants are ever signalled.
const SPLIT = { backend: "tmux", socket: "/tmp/original.sock", session: "oats", window: "dev-1" };
const HARNESS_ROWS = "#{pane_id}\t#{pane_pid}\t#{@oats-agent}";
/** `inspected`: what the window's inspection reads (`exited`, once the signalled processes are gone);
 *  `listed`: what the signalling step's own list-panes reads. `kill` records each signal; a signalled
 *  process is gone from then on. */
function splitHost({ inspected, exited = inspected, listed }) {
  const table = ["200 1 200 zsh", "201 200 201 vim", "300 1 300 zsh", "301 300 301 claude", "302 301 301 node"];
  const gone = new Set(), signalled = [], reads = { harness: 0, ps: 0 };
  const exec = (binary, args) => {
    const rows = table.filter((row) => !gone.has(Number(row.split(" ")[0])));
    if (binary === "ps") {
      reads.ps++;
      if (args[1] === "pid=,ppid=,pgid=,comm=") return rows.join("\n") + "\n";
      assert.equal(args[1], "pid=,ppid=,comm=");
      return rows.map((row) => { const [pid, ppid, , comm] = row.split(" "); return `${pid} ${ppid} ${comm}`; }).join("\n") + "\n";
    }
    assert.equal(binary, "tmux");
    assert.deepEqual(args.slice(0, 3), ["-u", "-S", SPLIT.socket]);
    assert.deepEqual(args.slice(3, 6), ["list-panes", "-t", "=oats:=dev-1"], "only the window's panes are read");
    if (args.at(-1) === HARNESS_ROWS) { reads.harness++; return listed; }
    return gone.size ? exited : inspected;
  };
  const kill = (pid, signal) => {
    if (gone.has(pid)) throw Object.assign(new Error(`kill ESRCH ${pid}`), { code: "ESRCH" });
    if (signal !== 0) { signalled.push([pid, signal]); gone.add(pid); }
    return true;
  };
  return { io: { exec }, kill, signalled, reads };
}
const RUNNING = "%2\t0\tvim\t200\t\n%3\t0\tclaude\t300\tdev-1\n";
const AT_PROMPT = "%2\t0\tvim\t200\t\n%3\t0\tzsh\t300\tdev-1\n";
const LISTED = "%2\t200\t\n%3\t300\tdev-1\n";

test("1569: harnessProcesses and stopHarness signal only the agent's pane's processes, never a split's", async () => {
  const { harnessProcesses, stopHarness } = await import("../lib/core.mjs");
  const host = splitHost({ inspected: RUNNING, exited: AT_PROMPT, listed: LISTED });
  assert.deepEqual(harnessProcesses(SPLIT, host.io), [
    { pid: 301, ppid: 300, pgid: 301, comm: "claude", depth: 1 },
    { pid: 302, ppid: 301, pgid: 301, comm: "node", depth: 2 },
  ]);
  assert.deepEqual(harnessProcesses(SPLIT, host.io, { paneId: "%3" }).map((r) => r.pid), [301, 302], "the pane the caller inspected");
  const receipt = stopHarness(SPLIT, { io: host.io, kill: host.kill, sleep() {} });
  assert.deepEqual(host.signalled, [[301, "SIGTERM"], [302, "SIGTERM"]], "the harness and its child, topmost first; nothing under %2");
  assert.deepEqual(receipt.requested.map((r) => r.pid), [301, 302]);
  assert.equal(receipt.exited, true);
  assert.equal(receipt.state, "shell");
});

test("1569: a window whose agent's pane cannot be told, or whose agent's pane changed since it was inspected, is never signalled", async () => {
  const { harnessProcesses, stopHarness } = await import("../lib/core.mjs");
  const refused = (message) => (e) => e.code === "E_SESSION_UNKNOWN" && e.message === message;
  for (const [listed, sentence] of [
    ["%2\t200\tdev-1\n%3\t300\tdev-1\n", "the window has 2 panes marked as dev-1's agent pane (%2, %3); close all but the agent's with tmux kill-pane -t <id>, or close the window and start the instance"],
    ["%3\t300\tdev-2\n%2\t200\tdev-3\n", "the window has 2 panes and none is dev-1's agent pane (%2, %3); close the panes that aren't, or close the window and start the instance"],
  ]) {
    const host = splitHost({ inspected: RUNNING, listed });
    assert.throws(() => harnessProcesses(SPLIT, host.io), refused(`${sentence}; nothing was signalled`));
    assert.equal(host.reads.ps, 0, "no process is even looked for");
  }
  // Inspected as %3; by the signal the agent's pane is %4 (a restart in a new pane), or gone.
  for (const [listed, now] of [["%3\t300\t\n%4\t400\tdev-1\n", "%4"], ["", "gone"]]) {
    const host = splitHost({ inspected: RUNNING, listed });
    assert.throws(() => stopHarness(SPLIT, { io: host.io, kill: host.kill, sleep() {} }), refused(`the agent's pane was %3 and is now ${now}; nothing was signalled`));
    assert.deepEqual(host.signalled, []);
    assert.equal(host.reads.harness, 1);
  }
  // A malformed pane id in the signalling step's read.
  assert.throws(() => harnessProcesses(SPLIT, splitHost({ inspected: RUNNING, listed: "300\n" }).io), refused("invalid tmux pane response"));
});
