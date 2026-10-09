import test from "node:test";
import assert from "node:assert/strict";
import { DETACH_KEY_FEATURE, SESSION_DETACHED_EXIT, isDetachKey, prepareSessionViewer, requireDetachKey } from "../lib/session-viewer.mjs";
const target = { backend: "tmux", socket: "/tmp/owned.sock", session: "oats", window: "agent" };
function fixture(failLink = false, { marker = "" } = {}) {
  const calls = [];
  return { calls, exec(bin, args) {
    assert.equal(bin, "tmux");
    // The shared tmux helper forces UTF-8 (-u) ahead of the socket (a0b0e14).
    assert.deepEqual(args.slice(0, 3), ["-u", "-S", target.socket]);
    const cmd = args.slice(3); calls.push(cmd);
    if (cmd[0] === "list-panes") return "%1\t0\tcodex\t123\n";
    if (cmd[0] === "new-session") return "@98\n";
    if (cmd[0] === "link-window" && failLink) throw new Error("target disappeared");
    if (cmd[0] === "show-options") { if (marker instanceof Error) throw marker; return marker; }
    return "";
  } };
}
const MOUSE = "#{||:#{pane_in_mode},#{mouse_any_flag}}";
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

// ---- a detach key (awebai/oats#856) --------------------------------------------------------------

test("without a detach key the viewer's tmux calls are exactly these, in this order, and cleanup is one kill-session", () => {
  const io = fixture();
  const viewer = prepareSessionViewer(target, io);
  const name = io.calls.find((c) => c[0] === "new-session")[3];
  assert.match(name, /^oatsview-\d+-[0-9a-f]{8}$/);
  const prepared = [
    ["list-panes", "-t", "=oats:=agent", "-F", "#{pane_id}\t#{pane_dead}\t#{pane_current_command}\t#{pane_pid}"],
    ["new-session", "-d", "-s", name, "-P", "-F", "#{window_id}"],
    ["link-window", "-s", "=oats:=agent", "-t", `=${name}:`],
    ["kill-window", "-t", "@98"],
    ["set-option", "-t", name, "prefix", "None"],
    ["set-option", "-t", name, "prefix2", "None"],
    ["set-option", "-t", name, "key-table", "oatsview-locked"],
    ["set-option", "-t", name, "status", "off"],
    ["unbind-key", "-a", "-q", "-T", "oatsview-locked"],
    ["bind-key", "-T", "oatsview-locked", "WheelUpPane", "if-shell", "-F", MOUSE, "send-keys -M", "copy-mode -e; send-keys -M"],
    ["bind-key", "-T", "oatsview-locked", "MouseDrag1Pane", "if-shell", "-F", MOUSE, "send-keys -M", "copy-mode -M"],
    ["set-option", "-t", name, "mouse", "on"],
  ];
  assert.deepEqual(io.calls, prepared);
  assert.deepEqual(viewer.args, ["-u", "-S", target.socket, "attach-session", "-t", `=${name}`]);
  assert.equal(viewer.detached(), false, "a viewer without a key was never left by one");
  assert.deepEqual(io.calls, prepared, "and no tmux call asks");
  viewer.cleanup();
  assert.deepEqual(io.calls.slice(prepared.length), [["kill-session", "-t", `=${name}`]]);
  // The same holds for `detachKey: undefined`, which is how the CLI passes an absent flag.
  const again = fixture();
  prepareSessionViewer(target, { ...again, detachKey: undefined });
  assert.deepEqual(again.calls.map((c) => c.map((a) => a.replace(/oatsview-\d+-[0-9a-f]{8}/, "V"))), prepared.map((c) => c.map((a) => a.replace(name, "V"))));
});

test("with a detach key the viewer reads a table of its own, named as its session: the two mouse bindings and the key, the key's command one constant argument, and nothing names oatsview-locked", () => {
  for (const key of ["C-\\", "F12", "M-a", "C-]"]) {
    const io = fixture();
    const viewer = prepareSessionViewer(target, { ...io, detachKey: key });
    const name = io.calls.find((c) => c[0] === "new-session")[3];
    assert.match(name, /^oatsview-\d+-[0-9a-f]{8}$/);
    assert.deepEqual(io.calls, [
      ["list-panes", "-t", "=oats:=agent", "-F", "#{pane_id}\t#{pane_dead}\t#{pane_current_command}\t#{pane_pid}"],
      ["new-session", "-d", "-s", name, "-P", "-F", "#{window_id}"],
      ["link-window", "-s", "=oats:=agent", "-t", `=${name}:`],
      ["kill-window", "-t", "@98"],
      ["set-option", "-t", name, "prefix", "None"],
      ["set-option", "-t", name, "prefix2", "None"],
      ["set-option", "-t", name, "key-table", name],
      ["set-option", "-t", name, "status", "off"],
      ["unbind-key", "-a", "-q", "-T", name],
      ["bind-key", "-T", name, "WheelUpPane", "if-shell", "-F", MOUSE, "send-keys -M", "copy-mode -e; send-keys -M"],
      ["bind-key", "-T", name, "MouseDrag1Pane", "if-shell", "-F", MOUSE, "send-keys -M", "copy-mode -M"],
      ["bind-key", "-T", name, key, "set-option @oats-detached 1 ; detach-client"],
      ["set-option", "-t", name, "mouse", "on"],
    ], key);
    assert.deepEqual(io.calls.filter((c) => c[0] === "bind-key" && c[2] === name).map((c) => c[3]), ["WheelUpPane", "MouseDrag1Pane", key]);
    assert.equal(io.calls.some((c) => c.some((a) => a.includes("oatsview-locked"))), false, "no call names the locked table");
    const before = io.calls.length;
    viewer.cleanup();
    assert.deepEqual(io.calls.slice(before), [["kill-session", "-t", `=${name}`], ["unbind-key", "-a", "-q", "-T", name]], "cleanup kills the session and unbinds its table");
    assert.equal(io.calls.some((c) => c.some((a) => a.includes("oatsview-locked"))), false);
  }
});

test("a keyed viewer whose allocation fails kills its session and unbinds its table; a failed kill does not skip the unbind", () => {
  const io = fixture(true);
  assert.throws(() => prepareSessionViewer(target, { ...io, detachKey: "C-\\" }), /disappeared/);
  const name = io.calls.find((c) => c[0] === "new-session")[3];
  assert.deepEqual(io.calls.slice(-2), [["kill-session", "-t", `=${name}`], ["unbind-key", "-a", "-q", "-T", name]]);
  assert.equal(io.calls.some((c) => c[0] === "bind-key"), false, "it failed before any binding");
  // The session is already gone (its window ended): kill-session fails, the table is still unbound.
  const calls = [];
  const viewer = prepareSessionViewer(target, { detachKey: "F12", exec(bin, args) {
    const cmd = args.slice(3); calls.push(cmd);
    if (cmd[0] === "list-panes") return "%1\t0\tcodex\t123\n";
    if (cmd[0] === "new-session") return "@98\n";
    if (cmd[0] === "kill-session") throw new Error("can't find session");
    return "";
  } });
  viewer.cleanup();
  assert.equal(calls.at(-2)[0], "kill-session");
  assert.deepEqual(calls.at(-1).slice(0, 4), ["unbind-key", "-a", "-q", "-T"]);
});

test("whether the key was used is the viewer session's @oats-detached option: true for 1, false for anything else and for any error", () => {
  const ask = (marker) => {
    const io = fixture(false, { marker });
    const viewer = prepareSessionViewer(target, { ...io, detachKey: "C-\\" });
    const name = io.calls.find((c) => c[0] === "new-session")[3];
    const answer = viewer.detached();
    assert.deepEqual(io.calls.at(-1), ["show-options", "-t", `=${name}:`, "-qv", "@oats-detached"]);
    return answer;
  };
  assert.equal(ask("1\n"), true);
  assert.equal(ask(""), false, "never set: the window ended, or another client detached this one");
  assert.equal(ask("0\n"), false);
  assert.equal(ask("11\n"), false);
  assert.equal(ask(new Error("no server running")), false);
});

test("the detach key grammar is closed: what it accepts and what it refuses, and a refusal makes no tmux call", () => {
  const accepted = [
    ..."abcdefghjklnopqrstuvwxyz".split("").map((c) => `C-${c}`), "C-\\", "C-]", "C-^", "C-_",
    ..."abcdefghijklmnopqrstuvwxyz0123456789".split("").map((c) => `M-${c}`),
    ...["", "C-", "M-", "S-"].flatMap((m) => Array.from({ length: 12 }, (_, i) => `${m}F${i + 1}`)),
  ];
  assert.equal(accepted.length, 112);
  assert.equal(new Set(accepted).size, 112);
  for (const key of accepted) {
    assert.equal(isDetachKey(key), true, key);
    assert.equal(requireDetachKey(key), key);
  }
  const refused = [
    ["a plain character", "a"], ["a plain character", "q"], ["a digit", "1"], ["a symbol", "\\"],
    ["Tab on tmux before 3.5", "C-i"], ["Enter on tmux before 3.5", "C-m"], ["Escape", "C-["],
    ["an ESC + C1 introducer", "M-["], ["an ESC + C1 introducer", "M-]"], ["an ESC + C1 introducer", "M-\\"], ["an ESC + C1 introducer", "M-O"],
    ["an ESC + C1 introducer", "M-P"], ["an ESC + C1 introducer", "M-N"], ["an ESC + C1 introducer", "M-X"], ["an ESC + C1 introducer", "M-^"], ["an ESC + C1 introducer", "M-_"],
    ["Any", "Any"], ["a mouse key", "WheelUpPane"], ["a mouse key", "MouseDown1Pane"], ["a mouse key", "MouseDrag1Pane"], ["a mouse key", "M-MouseDown1Pane"],
    ["two keys", "C-a C-b"], ["two keys", "C-aC-b"], ["two keys", "C-b d"], ["two modifiers", "C-M-a"], ["two modifiers", "C-S-F1"], ["two modifiers", "M-C-F1"],
    ["upper case", "C-A"], ["upper case", "M-A"], ["upper case", "c-a"], ["upper case", "C-\\ "], ["lower case", "f12"],
    ["a space", " C-a"], ["a space", "C-a "], ["a space", "C- a"], ["a space", "F 1"],
    ["a command separator", "C-]; kill-server"], ["a command separator", "C-a;"], ["a command separator", ";"], ["a command separator", "C-;"],
    ["a control character", "C-a\n"], ["a control character", "\nC-a"], ["a control character", "C-a\nF1"], ["a control character", "C-\u0001"], ["a control character", "F1\u0000"], ["a control character", "\u001c"],
    ["no function key", "F0"], ["no function key", "F13"], ["no function key", "F01"], ["no function key", "F"], ["no function key", "S-F"], ["no function key", "S-a"],
    ["another named key", "Escape"], ["another named key", "Enter"], ["another named key", "Tab"], ["another named key", "Space"], ["another named key", "BSpace"], ["another named key", "C-Space"], ["another named key", "C-Up"], ["another named key", "PPage"],
    ["a control symbol outside the list", "C-@"], ["a control symbol outside the list", "C-?"], ["a control symbol outside the list", "C-/"], ["a control symbol outside the list", "C--"], ["a control digit", "C-1"],
    ["a meta symbol", "M-."], ["a meta symbol", "M--"], ["a tmux key prefix", "^A"], ["a hex key", "0x1c"], ["the flag's own boolean", "true"], ["an empty value", ""], ["an option", "-x"], ["an option", "--print"],
    ["not a string", true], ["not a string", null], ["not a string", 12], ["not a string", ["C-a"]], ["not a string", { key: "C-a" }],
  ];
  for (const [why, value] of refused) {
    assert.equal(isDetachKey(value), false, `${why}: ${JSON.stringify(value)}`);
    const io = fixture();
    assert.throws(() => prepareSessionViewer(target, { ...io, detachKey: value }), (e) => {
      assert.equal(e.code, "E_BAD_ARGS", JSON.stringify(value));
      assert.equal(e.message, `--detach-key must be one key: C-<a letter except i and m, or one of \\ ] ^ _>, M-<a lowercase letter or digit>, or F1 to F12 with at most one of C-, M-, S- (got ${JSON.stringify(value)})`);
      return true;
    }, `${why}: ${JSON.stringify(value)}`);
    assert.deepEqual(io.calls, [], `${why}: refused before any tmux call`);
  }
});

test("the constants a caller reads: the feature name and the status of a leave by the key", () => {
  assert.equal(DETACH_KEY_FEATURE, "session-attach-detach-key");
  assert.equal(SESSION_DETACHED_EXIT, 20);
});
