import test from "node:test";
import assert from "node:assert/strict";
import { inputSessionTarget, inspectSessionTarget } from "../lib/session-input.mjs";
const target = { backend: "tmux", socket: "/tmp/original.sock", session: "oats", window: "agent" };
function fixture(output = "%12\t0\tcodex\n") {
  const calls = [];
  return { calls, exec(bin, args, opts) {
    assert.equal(bin, "tmux");
    assert.deepEqual(args.slice(0, 2), ["-S", target.socket]);
    calls.push({ args: args.slice(2), input: opts.input });
    return args[2] === "list-panes" ? output : "";
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
  for (const out of ["%1\t0\tzsh", "%1\t1\tcodex", "%1\t0\tcodex\n%2\t0\tpi"]) {
    const io = fixture(out);
    assert.throws(() => inputSessionTarget(target, "wake", io));
    assert.equal(io.calls.length, 1);
  }
});
test("tmux unavailable socket is not reported absent", () => {
  const io = { exec() { throw Object.assign(new Error("failure"), { stderr: "error connecting to socket: Permission denied" }); } };
  assert.throws(() => inspectSessionTarget(target, io), /failure/);
});
