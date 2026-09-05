import test from "node:test";
import assert from "node:assert/strict";
import { prepareSessionViewer } from "../lib/session-viewer.mjs";
const target = { backend: "tmux", socket: "/tmp/owned.sock", session: "oats", window: "agent" };
function fixture(failLink = false) {
  const calls = [];
  return { calls, exec(bin, args) {
    assert.equal(bin, "tmux");
    assert.deepEqual(args.slice(0, 2), ["-S", target.socket]);
    const cmd = args.slice(2); calls.push(cmd);
    if (cmd[0] === "list-panes") return "%1\t0\tcodex\t123\n";
    if (cmd[0] === "new-session") return "@98\n";
    if (cmd[0] === "link-window" && failLink) throw new Error("target disappeared");
    return "";
  } };
}
test("tmux attach isolates one exact window and cleanup kills only the viewer", () => {
  const io = fixture();
  const viewer = prepareSessionViewer(target, io);
  assert.deepEqual(io.calls.find((c) => c[0] === "link-window").slice(0, 3), ["link-window", "-s", "=oats:=agent"]);
  assert.deepEqual(io.calls.find((c) => c[0] === "kill-window"), ["kill-window", "-t", "@98"]);
  viewer.cleanup();
  assert.equal(io.calls.at(-1)[0], "kill-session");
  assert.match(io.calls.at(-1)[2], /^=oatsview-/);
  assert.deepEqual(viewer.args.slice(0, 3), ["-S", target.socket, "attach-session"]);
});
test("failed viewer allocation cleans its placeholder without touching source", () => {
  const io = fixture(true);
  assert.throws(() => prepareSessionViewer(target, io), /disappeared/);
  assert.equal(io.calls.at(-1)[0], "kill-session");
  assert.match(io.calls.at(-1)[2], /^=oatsview-/);
});
