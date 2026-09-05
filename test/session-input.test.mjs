import test from "node:test";
import assert from "node:assert/strict";
import { inputSessionTarget, inspectSessionTarget } from "../lib/session-input.mjs";
const target = { backend: "tmux", socket: "/tmp/original.sock", session: "oats", window: "agent" };
function fixture(output = "%12\t0\tcodex\t123\n", processes = "123 1 zsh\n") {
  const calls = [];
  return { calls, exec(bin, args, opts) {
    if (bin === "ps") return processes;
    assert.equal(bin, "tmux");
    assert.deepEqual(args.slice(0, 3), ["-u", "-S", target.socket]);
    calls.push({ args: args.slice(3), input: opts.input });
    return args[3] === "list-panes" ? output : "";
  } };
}
test("tmux submits literal multiline input using bracketed paste and Enter", () => {
  const io = fixture();
  const text = "$(touch forbidden)\n`literal`";
  assert.equal(inputSessionTarget(target, text, io).submitted, true);
  assert.equal(io.calls[1].input, text);
  assert.equal(io.calls[1].args[0], "load-buffer");
  assert.deepEqual(io.calls[2].args.slice(0, 2), ["paste-buffer", "-p"]);
  assert.deepEqual(io.calls[3].args, ["send-keys", "-t", "%12", "Enter"]);
  assert.equal(io.calls[4].args[0], "delete-buffer");
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
