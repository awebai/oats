import test from "node:test";
import assert from "node:assert/strict";
import { prepareSessionViewer } from "../lib/session-viewer.mjs";
const target = { backend: "tmux", socket: "/tmp/owned.sock", session: "oats", window: "agent" };
function fixture(failLink = false) {
  const calls = [];
  return { calls, exec(bin, args) {
    assert.equal(bin, "tmux");
    // The shared tmux helper forces UTF-8 (-u) ahead of the socket (a0b0e14).
    assert.deepEqual(args.slice(0, 3), ["-u", "-S", target.socket]);
    const cmd = args.slice(3); calls.push(cmd);
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
  const viewerName = io.calls.find((c) => c[0] === "new-session")[3];
  assert.match(viewerName, /^oatsview-/);
  assert.ok(io.calls.some((c) => c.join(" ") === `set-option -t ${viewerName} status off`), "the status line is hidden on the temporary viewer session only");
  assert.equal(io.calls.some((c) => c[0] === "set-option" && c[2] !== viewerName), false, "no option is set on the agents' session");
  viewer.cleanup();
  assert.equal(io.calls.at(-1)[0], "kill-session");
  assert.match(io.calls.at(-1)[2], /^=oatsview-/);
  assert.deepEqual(viewer.args.slice(0, 4), ["-u", "-S", target.socket, "attach-session"]);
});
test("failed viewer allocation cleans its placeholder without touching source", () => {
  const io = fixture(true);
  assert.throws(() => prepareSessionViewer(target, io), /disappeared/);
  assert.equal(io.calls.at(-1)[0], "kill-session");
  assert.match(io.calls.at(-1)[2], /^=oatsview-/);
});
test("the viewer's locked table lets a drag start a tmux copy selection (#520), passing it through when the app grabbed the mouse", () => {
  const io = fixture();
  prepareSessionViewer(target, io);
  const binds = io.calls.filter((c) => c[0] === "bind-key" && c[2] === "oatsview-locked").map((c) => c[3]);
  assert.deepEqual(binds, ["WheelUpPane", "MouseDrag1Pane"]);
  assert.deepEqual(io.calls.find((c) => c[0] === "bind-key" && c[3] === "MouseDrag1Pane"),
    ["bind-key", "-T", "oatsview-locked", "MouseDrag1Pane", "if-shell", "-F", "#{||:#{pane_in_mode},#{mouse_any_flag}}", "send-keys -M", "copy-mode -M"]);
});
