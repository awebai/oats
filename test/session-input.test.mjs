import test from "node:test";
import assert from "node:assert/strict";
import { inputSessionTarget, inspectSessionTarget } from "../lib/session-input.mjs";
const target = { backend: "tmux", socket: "/tmp/original.sock", session: "oats", window: "agent" };
// The fake tmux answers each look at the pane (pane size, capture-pane, pane
// size, in one call) from `screen({ enters, captures })`: a string at 80x24,
// or { size, sizeAfter, text }. A throw is an unreadable pane. It runs on a
// fake clock: no real sleeps. By default the screen changes once an Enter has
// been sent: a clean submit.
function fixture(output = "%12\t0\tcodex\t123\n", processes = "123 1 zsh\n", { screen = ({ enters }) => enters ? "submitted" : "pasted" } = {}) {
  const calls = [], sleeps = [];
  let clock = 0, enters = 0, captures = 0;
  return { calls, sleeps, get enters() { return enters; }, get clock() { return clock; },
    sleep(ms) { sleeps.push(ms); clock += ms; },
    now() { return clock; },
    exec(bin, args, opts) {
      if (bin === "ps") return processes;
      assert.equal(bin, "tmux");
      assert.deepEqual(args.slice(0, 3), ["-u", "-S", target.socket]);
      calls.push({ args: args.slice(3), input: opts.input, at: clock });
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
test("tmux submits literal multiline input using bracketed paste and one verified Enter", () => {
  const io = fixture();
  const text = "$(touch forbidden)\n`literal`";
  const result = inputSessionTarget(target, text, io);
  assert.equal(result.submitted, true);
  assert.equal(result.verified, true);
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

test("tmux resends a swallowed Enter and stops at the first one taken", () => {
  const io = fixture(undefined, undefined, { screen: ({ enters }) => enters >= 2 ? "taken" : "pasted" });
  const result = inputSessionTarget(target, "wake", io);
  assert.deepEqual([result.submitted, result.verified], [true, true]);
  assert.equal(io.enters, 2);
  assert.equal(named(io, "paste-buffer").length, 1);
});
test("tmux answers enter-not-taken after three unchanged Enters and never pastes again", () => {
  const io = fixture(undefined, undefined, { screen: () => "pasted" });
  const result = inputSessionTarget(target, "wake", io);
  assert.equal(result.submitted, false);
  assert.equal(result.verified, true);
  assert.equal(result.reason, "enter-not-taken");
  assert.equal(io.enters, 3);
  assert.equal(named(io, "load-buffer").length, 1);
  assert.equal(named(io, "paste-buffer").length, 1);
  // Backoff grows between resends, and the whole call stays well under 5 s.
  const sends = named(io, "send-keys").map((c) => c.at);
  assert.ok(sends[2] - sends[1] > sends[1] - sends[0], `backoff grows: ${sends}`);
  assert.ok(io.clock < 5000, `bounded: ${io.clock} ms`);
});
test("tmux sends no extra key when the pane cannot be read", () => {
  const unreadable = () => { throw Object.assign(new Error("can't find pane"), { stderr: "can't find pane: %12" }); };
  for (const screen of [unreadable, ({ enters }) => enters ? unreadable() : "pasted"]) {
    const io = fixture(undefined, undefined, { screen });
    const result = inputSessionTarget(target, "wake", io);
    assert.deepEqual([result.submitted, result.verified], [true, false]);
    assert.equal("reason" in result, false);
    assert.equal(io.enters, 1);
  }
});
test("tmux does not resend an Enter that was taken late, during the backoff", () => {
  // Unchanged 300 ms after the Enter, changed by the look before the resend.
  let seen = 0;
  const io = fixture(undefined, undefined, { screen: ({ enters }) => enters && ++seen > 1 ? "taken" : "pasted" });
  const result = inputSessionTarget(target, "wake", io);
  assert.deepEqual([result.submitted, result.verified], [true, true]);
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
  assert.equal(result.verified, true);
  assert.equal(io.sleeps[0], 200 + 256 * 3);
  const enterAt = named(io, "send-keys")[0].at;
  assert.ok(enterAt >= 2000 && enterAt < 2200, `Enter at the 2 s cap, not before: ${enterAt}`);
});
test("tmux compares only the bottom 15 lines, ignoring trailing blank rows", () => {
  const top = Array.from({ length: 30 }, (_, i) => `history ${i}`);
  const bottom = Array.from({ length: 15 }, (_, i) => `row ${i}`);
  // Only a line above the bottom region changes, so the Enter reads as swallowed.
  const io = fixture(undefined, undefined, { screen: ({ captures }) => [`clock ${captures}`, ...top, ...bottom, "", "  "].join("\n") });
  assert.equal(inputSessionTarget(target, "wake", io).reason, "enter-not-taken");
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
test("tmux reads a reflow on a pane seen to change size as no change, so a swallowed Enter is still resent", () => {
  // The same content redrawn narrower and wider: rules change length, lines
  // rewrap, and the region's top cut moves. None of that is an Enter.
  const at = (width) => {
    const rule = "─".repeat(width);
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const wrapped = words.match(new RegExp(`.{1,${width - 2}}(\\s|$)`, "g")).map((l) => l.trimEnd());
    return [...wrapped, rule, "❯ [Pasted text #3 +40 lines]", rule, "  status"].join("\n");
  };
  // Settled at 80 columns; each Enter is followed by a redraw at a new width.
  const widths = [80, 30, 120, 50];
  const io = fixture(undefined, undefined, { screen: ({ enters }) => ({ size: `${widths[enters]}x24`, text: at(widths[enters]) }) });
  assert.notEqual(at(30), at(80));
  assert.ok(at(30).split("\n").length > 15, "the narrow redraw moves the region's top cut");
  const result = inputSessionTarget(target, "wake", io);
  assert.equal(result.reason, "enter-not-taken");
  assert.equal(io.enters, 3);
});
test("tmux reads a cleared input row as taken even when nothing else moved", () => {
  const io = fixture(undefined, undefined, { screen: ({ enters }) => ["header", enters ? "❯" : "❯ wake text", "status"].join("\n") });
  const result = inputSessionTarget(target, "wake", io);
  assert.deepEqual([result.submitted, result.verified], [true, true]);
  assert.equal(io.enters, 1);
});
test("tmux reads content that appeared above the input as taken, on a pane of the same size", () => {
  const io = fixture(undefined, undefined, { screen: ({ enters }) => (enters ? "Confirm queued request?\n" : "") + "❯ wake\nstatus" });
  const result = inputSessionTarget(target, "wake", io);
  assert.deepEqual([result.submitted, result.verified], [true, true]);
  assert.equal(io.enters, 1);
});
test("tmux reads a cleared box-drawing input as taken, on a pane of the same size", () => {
  const io = fixture(undefined, undefined, { screen: ({ enters }) => `header\n${enters ? "❯" : "❯ ─"}\nstatus` });
  const result = inputSessionTarget(target, "─", io);
  assert.deepEqual([result.submitted, result.verified], [true, true]);
  assert.equal(io.enters, 1);
});
test("tmux still reads new or removed content as taken when the pane also changed size", () => {
  const rule = (w) => "─".repeat(w);
  for (const after of [`Confirm queued request?\n${rule(60)}\n❯ wake\n${rule(60)}\nstatus`, `header\n${rule(60)}\n❯\n${rule(60)}\nstatus`]) {
    const io = fixture(undefined, undefined, { screen: ({ enters }) => enters
      ? { size: "60x24", text: after }
      : { size: "80x24", text: `header\n${rule(80)}\n❯ wake\n${rule(80)}\nstatus` } });
    const result = inputSessionTarget(target, "wake", io);
    assert.deepEqual([result.submitted, result.verified], [true, true]);
    assert.equal(io.enters, 1);
  }
});
test("tmux treats a size that moved during one capture as a size change", () => {
  // Same content, its size seen moving mid-capture: a reflow, not an Enter.
  const io = fixture(undefined, undefined, { screen: ({ enters }) => enters
    ? { size: "80x24", sizeAfter: "100x24", text: "header\n" + "─".repeat(100) + "\n❯ wake\nstatus" }
    : "header\n" + "─".repeat(80) + "\n❯ wake\nstatus" });
  assert.equal(inputSessionTarget(target, "wake", io).reason, "enter-not-taken");
});
test("tmux sends no further Enter once a capture fails after a resend", () => {
  const io = fixture(undefined, undefined, { screen: ({ enters }) => { if (enters >= 2) throw new Error("pane gone"); return "pasted"; } });
  const result = inputSessionTarget(target, "wake", io);
  assert.deepEqual([result.submitted, result.verified], [true, false]);
  assert.equal(io.enters, 2);
});
test("tmux ignores trailing spaces a redraw pads differently, on a pane of the same size", () => {
  const io = fixture(undefined, undefined, { screen: ({ enters }) => enters ? "reply   \n❯ [Pasted text #1 +9 lines]\nstatus" : "reply\n❯ [Pasted text #1 +9 lines]      \nstatus  " });
  assert.equal(inputSessionTarget(target, "wake", io).reason, "enter-not-taken");
});
