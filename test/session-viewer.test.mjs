import test from "node:test";
import assert from "node:assert/strict";
import { DETACH_KEY_FEATURE, LOCKED_PREFIX_BINDINGS, LOCKED_PREFIX_TABLE, NO_STATUS_LINE_FEATURE, PREFIX_KEY, SESSION_DETACHED_EXIT, VIEWER_BINDINGS, VIEWER_PREFIX_MIN_TMUX, VIEWER_SCROLL_HINT, VIEWER_SCROLL_HINT_WITHOUT_PREFIX, tmuxForwardsBoundKey, VIEWER_CLOSED_HOOK_INDEX, isDetachKey, prepareSessionViewer, requireDetachKey, tmuxHasClientFeatures } from "../lib/session-viewer.mjs";
const target = { backend: "tmux", socket: "/tmp/owned.sock", session: "oats", window: "agent" };
function fixture(failLink = false, { marker = "", version = "", sessions = "", keys = "" } = {}) {
  const calls = [], options = [];
  return { calls, options, exec(bin, args, opts) {
    assert.equal(bin, "tmux");
    // The shared tmux helper forces UTF-8 (-u) ahead of the socket (a0b0e14).
    assert.deepEqual(args.slice(0, 3), ["-u", "-S", target.socket]);
    const cmd = args.slice(3); calls.push(cmd); options.push(opts);
    if (cmd[0] === "list-panes") return "%1\t0\tcodex\t123\n";
    if (cmd[0] === "list-keys") return keys;
    if (cmd[0] === "list-sessions") return sessions;
    if (cmd[0] === "new-session") return "@98\n";
    if (cmd[0] === "link-window" && failLink) throw new Error("target disappeared");
    if (cmd[0] === "show-options") { if (marker instanceof Error) throw marker; return marker; }
    if (cmd[0] === "-V") { if (version instanceof Error) throw version; return version; }
    return "";
  } };
}
const MOUSE = "#{||:#{pane_in_mode},#{mouse_any_flag}}";
/** The server's two tables that every locked viewer empties and binds again: never a sweep's. */
const SHARED_TABLES = ["oatsview-locked", "oatsview-locked-prefix"];
/** The locked viewer's C-b table (#1502 part D): `[` is copy mode; any other key, the C-b first and
 *  then that key, as the agent would have read them, the viewer's own wheel, drag and S-PageUp
 *  doing after the C-b what they do without it. */
const PREFIX_BINDINGS = [
  ["[", "copy-mode"],
  ["WheelUpPane", `send-keys C-b ; if-shell -F '${MOUSE}' 'send-keys -M' 'copy-mode -e; send-keys -M'`],
  ["MouseDrag1Pane", `send-keys C-b ; if-shell -F '${MOUSE}' 'send-keys -M' 'copy-mode -M'`],
  ["S-PageUp", "send-keys C-b ; copy-mode -u"],
  ["Any", "send-keys C-b ; if-shell -F '#{!=:#{mouse_x},}' 'send-keys -M' 'send-keys'"],
];
/** The one global hook entry the kernel owns: when a session whose name is a viewer's closes, its
 *  key table is unbound. The name is matched before it is used in a command (a format inside
 *  `#{...}` cannot hold `}`, so the 8 hex digits are spelled out). */
const VIEWER_CLOSED_HOOK = `if-shell -F '#{m/r:^oatsview-([0-9]+)-${"[0-9a-f]".repeat(8)}$,#{hook_session_name}}' "run-shell -C 'unbind-key -a -q -T #{hook_session_name}'"`;
test("tmux attach isolates one exact window and cleanup kills only the viewer", () => {
  const io = fixture();
  const viewer = prepareSessionViewer(target, io);
  assert.deepEqual(io.calls.find((c) => c[0] === "link-window").slice(0, 3), ["link-window", "-s", "=oats:=agent"]);
  assert.deepEqual(io.calls.find((c) => c[0] === "kill-window"), ["kill-window", "-t", "@98"]);
  const viewerName = io.calls.find((c) => c[0] === "new-session")[3];
  assert.match(viewerName, /^oatsview-/);
  assert.ok(io.calls.some((c) => c.join(" ") === `set-option -t ${viewerName} status on`), "the status line, its scroll keys, is the temporary viewer session's only");
  assert.equal(io.calls.some((c) => c[0] === "set-option" && c[2] !== viewerName), false, "no option is set on the agents' session");
  viewer.cleanup();
  assert.equal(io.calls.at(-1)[0], "kill-session");
  assert.match(io.calls.at(-1)[2], /^=oatsview-/);
  assert.deepEqual(viewer.args.slice(0, 4), ["-u", "-S", target.socket, "attach-session"]);
});
test("the viewer's client leaves when the agent's window ends, never moved to another session (#1237)", () => {
  // Under an operator's `set -g detach-on-destroy off`, a destroyed viewer would hand its client to
  // another session: another agent's terminal under this viewer. The viewer sets `on` for itself.
  const io = fixture();
  prepareSessionViewer(target, io);
  const name = io.calls.find((c) => c[0] === "new-session")[3];
  const set = io.calls.filter((c) => c[0] === "set-option" && c.includes("detach-on-destroy"));
  assert.deepEqual(set, [["set-option", "-t", name, "detach-on-destroy", "on"]], "on the viewer session only, never -g");
  assert.ok(io.calls.findIndex((c) => c.includes("detach-on-destroy")) > io.calls.findIndex((c) => c[0] === "kill-window"), "set once the viewer holds the agent's window alone");
});
test("every tmux call of the viewer runs in a session and process group of its own, so a signal to the attach's group cannot kill one in flight (#1243)", () => {
  // list-panes is the shared inspection's, before any viewer exists; every call after it is the
  // viewer's: preparation, the -V probe, the marker read and cleanup's kill-session and unbind-key.
  const viewerCalls = (io) => io.calls.map((cmd, i) => [cmd[0], io.options[i]]).filter(([cmd]) => cmd !== "list-panes");
  const ownGroup = (calls, what) => {
    assert.ok(calls.length > 0, what);
    for (const [cmd, opts] of calls) assert.equal(opts?.detached, true, `${what}: ${cmd}`);
  };
  for (const detachKey of [undefined, "C-\\"]) {
    const io = fixture(false, { version: "tmux 3.7c\n", marker: "1\n" });
    const viewer = prepareSessionViewer(target, { ...io, detachKey });
    viewer.detached();
    viewer.cleanup();
    const calls = viewerCalls(io);
    for (const cmd of ["new-session", "kill-window", "set-option", "-V", "kill-session"]) assert.ok(calls.some(([c]) => c === cmd), cmd);
    if (detachKey !== undefined) for (const cmd of ["show-options", "bind-key"]) assert.ok(calls.some(([c]) => c === cmd), cmd);
    assert.equal(io.calls.at(-1)[0], detachKey === undefined ? "kill-session" : "unbind-key");
    ownGroup(calls, detachKey ?? "no key");
  }
  // And the cleanup of a preparation that failed.
  const failed = fixture(true);
  assert.throws(() => prepareSessionViewer(target, { ...failed, detachKey: "F12" }), /disappeared/);
  assert.deepEqual(failed.calls.slice(-2).map((c) => c[0]), ["kill-session", "unbind-key"]);
  ownGroup(viewerCalls(failed), "a failed preparation");
});
test("failed viewer allocation cleans its placeholder without touching source", () => {
  const io = fixture(true);
  assert.throws(() => prepareSessionViewer(target, io), /disappeared/);
  assert.equal(io.calls.at(-1)[0], "kill-session");
  assert.match(io.calls.at(-1)[2], /^=oatsview-/);
});
test("the viewer's locked table lets a drag start a tmux copy selection (#520), passing it through when the app grabbed the mouse", () => {
  const io = fixture(false, { version: "tmux 3.8\n" });
  prepareSessionViewer(target, io);
  const binds = io.calls.filter((c) => c[0] === "bind-key" && c[2] === "oatsview-locked").map((c) => c[3]);
  assert.deepEqual(binds, ["WheelUpPane", "MouseDrag1Pane", "S-PageUp", "C-b"]);
  assert.deepEqual(io.calls.find((c) => c[0] === "bind-key" && c[3] === "MouseDrag1Pane"),
    ["bind-key", "-T", "oatsview-locked", "MouseDrag1Pane", "if-shell", "-F", "#{||:#{pane_in_mode},#{mouse_any_flag}}", "send-keys -M", "copy-mode -M"]);
});
test("every viewer's table binds S-PageUp to copy mode, scrolled up a page, whatever the app does with the mouse (#1476)", () => {
  for (const detachKey of [undefined, "F12"]) {
    const io = fixture();
    prepareSessionViewer(target, { ...io, detachKey });
    const table = io.calls.find((c) => c[0] === "set-option" && c[3] === "key-table")[4];
    assert.deepEqual(io.calls.filter((c) => c[0] === "bind-key" && c[2] === table && c[3] === "S-PageUp"), [["bind-key", "-T", table, "S-PageUp", "copy-mode -u"]], String(detachKey));
  }
});

// ---- a detach key (awebai/oats#856) --------------------------------------------------------------

test("without a detach key the viewer's tmux calls are exactly these, in this order, and cleanup is one kill-session", () => {
  const io = fixture();
  const viewer = prepareSessionViewer(target, io);
  const name = io.calls.find((c) => c[0] === "new-session")[3];
  assert.match(name, /^oatsview-\d+-[0-9a-f]{8}$/);
  const prepared = [
    ["list-panes", "-t", "=oats:=agent", "-F", "#{pane_id}\t#{pane_dead}\t#{pane_current_command}\t#{pane_pid}"],
    ["list-keys"],
    ["list-sessions", "-F", "#{session_name}\t#{session_attached}"],
    ["new-session", "-d", "-s", name, "-P", "-F", "#{window_id}"],
    ["link-window", "-s", "=oats:=agent", "-t", `=${name}:`],
    ["kill-window", "-t", "@98"],
    ["set-option", "-t", name, "prefix", "None"],
    ["set-option", "-t", name, "prefix2", "None"],
    ["set-option", "-t", name, "key-table", "oatsview-locked"],
    ["-V"],
    ["set-option", "-t", name, "status", "on"],
    ["set-option", "-t", name, "status-format[0]", "Shift+PgUp to scroll back"],
    ["set-option", "-t", name, "detach-on-destroy", "on"],
    ["unbind-key", "-a", "-q", "-T", "oatsview-locked"],
    ["bind-key", "-T", "oatsview-locked", "WheelUpPane", "if-shell", "-F", MOUSE, "send-keys -M", "copy-mode -e; send-keys -M"],
    ["bind-key", "-T", "oatsview-locked", "MouseDrag1Pane", "if-shell", "-F", MOUSE, "send-keys -M", "copy-mode -M"],
    ["bind-key", "-T", "oatsview-locked", "S-PageUp", "copy-mode -u"],
    ["set-option", "-t", name, "mouse", "on"],
  ];
  assert.deepEqual(io.calls, prepared);
  assert.deepEqual(viewer.args, ["-u", "-S", target.socket, "attach-session", "-t", `=${name}`, ";", "set-hook", "-t", `=${name}:`, "client-detached", `if-shell -F '#{==:#{session_attached},0}' 'kill-session -t =${name}'`]);
  assert.equal(viewer.session, name);
  assert.deepEqual(viewer.swept, { sessions: 0, tables: 0 });
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
      ["list-keys"],
      ["list-sessions", "-F", "#{session_name}\t#{session_attached}"],
      ["new-session", "-d", "-s", name, "-P", "-F", "#{window_id}"],
      ["link-window", "-s", "=oats:=agent", "-t", `=${name}:`],
      ["kill-window", "-t", "@98"],
      ["set-option", "-t", name, "prefix", "None"],
      ["set-option", "-t", name, "prefix2", "None"],
      ["set-option", "-t", name, "key-table", name],
      ["-V"],
      ["set-option", "-t", name, "status", "off"],
      ["set-option", "-t", name, "detach-on-destroy", "on"],
      ["unbind-key", "-a", "-q", "-T", name],
      ["bind-key", "-T", name, "WheelUpPane", "if-shell", "-F", MOUSE, "send-keys -M", "copy-mode -e; send-keys -M"],
      ["bind-key", "-T", name, "MouseDrag1Pane", "if-shell", "-F", MOUSE, "send-keys -M", "copy-mode -M"],
      ["bind-key", "-T", name, "S-PageUp", "copy-mode -u"],
      ["bind-key", "-T", name, key, "set-option @oats-detached 1 ; set-hook -u client-detached ; detach-client"],
      ["set-hook", "-g", "session-closed[900]", VIEWER_CLOSED_HOOK],
      ["set-option", "-t", name, "mouse", "on"],
    ], key);
    // The hook unbinds the table itself: a session its kill-session ends runs no other hook.
    assert.deepEqual(viewer.args, ["-u", "-S", target.socket, "attach-session", "-t", `=${name}`, ";", "set-hook", "-t", `=${name}:`, "client-detached", `if-shell -F '#{==:#{session_attached},0}' 'unbind-key -a -q -T ${name} ; kill-session -t =${name}'`], key);
    assert.deepEqual(io.calls.filter((c) => c[0] === "bind-key" && c[2] === name).map((c) => c[3]), ["WheelUpPane", "MouseDrag1Pane", "S-PageUp", key]);
    assert.equal(io.calls.some((c) => c.some((a) => a.includes("oatsview-locked"))), false, "no call names the locked table or its C-b table");
    assert.equal(io.calls.some((c) => c[0] === "bind-key" && c[3] === "C-b"), false, "a keyed viewer has no C-b of its own");
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
    ..."abcdefgjklnopqrstuvwxyz".split("").map((c) => `C-${c}`), "C-\\", "C-]", "C-^", "C-_",
    ..."abcdefghijklmnopqrstuvwxyz0123456789".split("").map((c) => `M-${c}`),
    ...["", "C-", "M-", "S-"].flatMap((m) => Array.from({ length: 12 }, (_, i) => `${m}F${i + 1}`)),
  ];
  assert.equal(accepted.length, 111);
  assert.equal(new Set(accepted).size, 111);
  for (const key of accepted) {
    assert.equal(isDetachKey(key), true, key);
    assert.equal(requireDetachKey(key), key);
  }
  const refused = [
    ["a plain character", "a"], ["a plain character", "q"], ["a digit", "1"], ["a symbol", "\\"],
    ["the byte of Ctrl+Backspace on many terminals", "C-h"], ["Tab on tmux before 3.5", "C-i"], ["Enter on tmux before 3.5", "C-m"], ["Escape", "C-["],
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
      assert.equal(e.message, `--detach-key must be one key: C-<a letter except h, i and m, or one of \\ ] ^ _>, M-<a lowercase letter or digit>, or F1 to F12 with at most one of C-, M-, S- (got ${JSON.stringify(value)})`);
      return true;
    }, `${why}: ${JSON.stringify(value)}`);
    assert.deepEqual(io.calls, [], `${why}: refused before any tmux call`);
  }
});

test("without its status line (--no-status-line, #1502 part D) a locked viewer has no status line and no hint, and keeps its C-b table and its keys; a keyed viewer has none either way", () => {
  const io = fixture(false, { version: "tmux 3.8\n" });
  prepareSessionViewer(target, { ...io, statusLine: false });
  const name = io.calls.find((c) => c[0] === "new-session")[3];
  assert.deepEqual(io.calls.filter((c) => c[0] === "set-option" && c[3].startsWith("status")), [["set-option", "-t", name, "status", "off"]]);
  assert.deepEqual(io.calls.filter((c) => c[0] === "bind-key" && c[2] === "oatsview-locked").map((c) => c[3]), ["WheelUpPane", "MouseDrag1Pane", "S-PageUp", "C-b"]);
  assert.deepEqual(io.calls.filter((c) => c[0] === "bind-key" && c[2] === "oatsview-locked-prefix").map((c) => c[3]), PREFIX_BINDINGS.map(([key]) => key));
  for (const statusLine of [true, false]) {
    const keyed = fixture();
    prepareSessionViewer(target, { ...keyed, detachKey: "F12", statusLine });
    const own = keyed.calls.find((c) => c[0] === "new-session")[3];
    assert.deepEqual(keyed.calls.filter((c) => c[0] === "set-option" && c[3].startsWith("status")), [["set-option", "-t", own, "status", "off"]], String(statusLine));
  }
});

test("the viewer's bindings are data a caller can pin its own table to (the Desktop's local viewer): every viewer's three, the locked viewer's C-b and its table's five, each a bind-key's arguments after the table", () => {
  assert.deepEqual(VIEWER_BINDINGS, [
    ["WheelUpPane", "if-shell", "-F", MOUSE, "send-keys -M", "copy-mode -e; send-keys -M"],
    ["MouseDrag1Pane", "if-shell", "-F", MOUSE, "send-keys -M", "copy-mode -M"],
    ["S-PageUp", "copy-mode -u"],
  ]);
  assert.equal(PREFIX_KEY, "C-b");
  assert.equal(LOCKED_PREFIX_TABLE, "oatsview-locked-prefix");
  assert.deepEqual(LOCKED_PREFIX_BINDINGS, PREFIX_BINDINGS);
  for (const list of [VIEWER_BINDINGS, LOCKED_PREFIX_BINDINGS]) {
    assert.ok(Object.isFrozen(list) && list.every(Object.isFrozen), "frozen: a caller reads them, never changes the kernel's");
  }
});

test("the C-b table only where tmux forwards a bound key (tmux 3.3: send-keys with no key sends the key it is bound to): there the locked viewer binds C-b and its table, and its status line names both keys; on 3.0 to 3.2a, a development build of an earlier one, an unreadable version (master) or none, neither, and the line names Shift+PgUp alone", () => {
  assert.equal(VIEWER_PREFIX_MIN_TMUX, "3.3");
  // A development build next-X.Y is newer than X.Y's predecessor: it reads as X.Y.
  for (const v of ["tmux 3.3", "tmux 3.3a", "tmux 3.8", "tmux 3.10", "tmux 4.0", "tmux 3.8\n", "tmux next-3.3", "tmux next-3.6", "tmux next-4.0\n"]) assert.equal(tmuxForwardsBoundKey(v), true, JSON.stringify(v));
  for (const v of ["tmux 3.0", "tmux 3.0a", "tmux 3.1c", "tmux 3.2", "tmux 3.2a", "tmux next-3.2", "tmux master", "openbsd-7.4", "tmux 3", "", null, undefined]) assert.equal(tmuxForwardsBoundKey(v), false, JSON.stringify(v));
  const on = fixture(false, { version: "tmux 3.3\n" });
  const viewer = prepareSessionViewer(target, on);
  const name = viewer.session;
  assert.deepEqual(on.calls.slice(on.calls.findIndex((c) => c[0] === "-V")), [
    ["-V"],
    ["set-option", "-t", name, "status", "on"],
    ["set-option", "-t", name, "status-format[0]", VIEWER_SCROLL_HINT],
    ["set-option", "-t", name, "detach-on-destroy", "on"],
    ["unbind-key", "-a", "-q", "-T", "oatsview-locked"],
    ["bind-key", "-T", "oatsview-locked", "WheelUpPane", "if-shell", "-F", MOUSE, "send-keys -M", "copy-mode -e; send-keys -M"],
    ["bind-key", "-T", "oatsview-locked", "MouseDrag1Pane", "if-shell", "-F", MOUSE, "send-keys -M", "copy-mode -M"],
    ["bind-key", "-T", "oatsview-locked", "S-PageUp", "copy-mode -u"],
    ["bind-key", "-T", "oatsview-locked", "C-b", "switch-client -T oatsview-locked-prefix"],
    // Bound again, never emptied: tmux returns every client reading a table it empties to its
    // default table, so another viewer's pending C-b would be lost.
    ...PREFIX_BINDINGS.map((binding) => ["bind-key", "-T", "oatsview-locked-prefix", ...binding]),
    // Then what else the table holds (a server's, so anyone's) goes, key by key.
    ["list-keys"],
    ["set-option", "-t", name, "mouse", "on"],
  ]);
  assert.equal(on.calls.filter((c) => c[0] === "-V").length, 1, "one probe answers both questions");
  assert.equal(on.calls.some((c) => c[0] === "unbind-key" && c.includes("oatsview-locked-prefix")), false, "the C-b table is never emptied");
  assert.deepEqual(viewer.args.slice(0, 5), ["-u", "-S", target.socket, "-T", "sync"]);
  assert.equal(VIEWER_SCROLL_HINT, "Shift+PgUp or C-b [ to scroll back");
  assert.equal(VIEWER_SCROLL_HINT_WITHOUT_PREFIX, "Shift+PgUp to scroll back");
  for (const version of ["tmux 3.2a\n", "tmux 3.0\n", "tmux next-3.2\n", "tmux master\n", "", new Error("no tmux -V")]) {
    const off = fixture(false, { version });
    prepareSessionViewer(target, off);
    assert.equal(off.calls.some((c) => c.includes("C-b") || c.includes("oatsview-locked-prefix") || c.some((a) => String(a).includes("oatsview-locked-prefix"))), false, `${version}: no C-b and no C-b table`);
    assert.deepEqual(off.calls.find((c) => c[3] === "status-format[0]"), ["set-option", "-t", off.calls.find((c) => c[0] === "new-session")[3], "status-format[0]", VIEWER_SCROLL_HINT_WITHOUT_PREFIX], String(version));
  }
});

test("a stray binding in the C-b table (a tmux.conf's, another program's) is removed key by key once the viewer's are bound, so C-b n never runs next-window; the viewer's own are kept whatever tmux calls them; the table is never emptied", () => {
  const keys = [
    "bind-key -T oatsview-locked-prefix n next-window",
    "bind-key -T oatsview-locked-prefix C-c new-window",
    "bind-key -T oatsview-locked-prefix \\; display-message hi",
    // tmux 3.8 lists a key holding `;` in double quotes.
    "bind-key -T oatsview-locked-prefix \"M-;\" display-message hi",
    "bind-key -T oatsview-locked-prefix \\# display-message hi",
    "bind-key -T oatsview-locked-prefix \\\" display-message hi",
    "bind-key -T oatsview-locked-prefix \\\\ display-message hi",
    "bind-key -T oatsview-locked-prefix \\[ copy-mode",
    "bind-key -T oatsview-locked-prefix S-PPage send-keys C-b \\; copy-mode -u",
    "bind-key -T oatsview-locked-prefix WheelUpPane send-keys C-b",
    "bind-key -T oatsview-locked-prefix MouseDrag1Pane send-keys C-b",
    "bind-key -T oatsview-locked-prefix Any send-keys C-b",
    "bind-key -T root n next-window",
    "bind-key -T oatsview-locked C-b switch-client -T oatsview-locked-prefix",
  ].join("\n") + "\n";
  const io = fixture(false, { version: "tmux 3.8\n", keys });
  prepareSessionViewer(target, io);
  const at = (c) => io.calls.findIndex((x) => x.join("\u0000") === c.join("\u0000"));
  const lastBind = io.calls.findLastIndex((c) => c[0] === "bind-key" && c[2] === "oatsview-locked-prefix");
  const removals = io.calls.filter((c) => c[0] === "unbind-key" && c.includes("oatsview-locked-prefix"));
  // A key that ends in `;` goes escaped: tmux takes a bare trailing `;` in its argv as the end of
  // the command, and the unbind would have no key.
  // tmux lists keys escaped (\#, \", \\, \;) and S-PageUp as S-PPage, which is the viewer's own.
  const un = (key) => ["unbind-key", "-q", "-T", "oatsview-locked-prefix", key];
  assert.deepEqual(removals, [un("n"), un("C-c"), un("\\;"), un("M-\\;"), un("#"), un('"'), un("\\")], "the strays only, by the key tmux listed, quietly, never -a");
  assert.ok(removals.every((c) => at(c) > lastBind), "after the viewer's own are bound");
  assert.equal(io.calls.some((c) => c[0] === "unbind-key" && c[1] === "-T" && c[2] === "root"), false, "another table is not touched");
});

test("the constants a caller reads: the feature names and the status of a leave by the key", () => {
  assert.equal(DETACH_KEY_FEATURE, "session-attach-detach-key");
  assert.equal(NO_STATUS_LINE_FEATURE, "session-attach-no-status-line");
  assert.equal(SESSION_DETACHED_EXIT, 20);
  assert.equal(VIEWER_CLOSED_HOOK_INDEX, 900, "the index of session-closed the kernel owns on the agents' server");
});

// ---- synchronized output (awebai/oats#1193) ------------------------------------------------------

test("a tmux -V answer names a release with the client's -T flag from tmux 3.2 on, and nothing it cannot read does", () => {
  for (const v of ["tmux 3.2", "tmux 3.2a", "tmux 3.3a", "tmux 3.7c", "tmux 4.0", "tmux 3.10", "tmux 10.1", "tmux 3.7c\n"]) assert.equal(tmuxHasClientFeatures(v), true, JSON.stringify(v));
  for (const v of ["tmux 3.0", "tmux 3.0a", "tmux 3.1", "tmux 3.1c", "tmux 2.9a", "tmux 1.8",
    "tmux next-3.6", "tmux master", "tmux openbsd-7.4", "tmux 3.2-rc2", "tmux 3", "tmux 3.", "tmux3.2", "3.2", "", "\n", undefined, null]) {
    assert.equal(tmuxHasClientFeatures(v), false, JSON.stringify(v));
  }
});

test("the viewer's client asks for synchronized output (-T sync, before the command) on tmux 3.2 and later, and is today's client otherwise", () => {
  const args = (version) => {
    const io = fixture(false, { version });
    const viewer = prepareSessionViewer(target, io);
    const name = io.calls.find((c) => c[0] === "new-session")[3];
    assert.equal(io.calls.filter((c) => c[0] === "-V").length, 1, "one probe");
    return viewer.args.map((a) => a.replace(name, "V"));
  };
  const attach = ["attach-session", "-t", "=V", ";", "set-hook", "-t", "=V:", "client-detached", "if-shell -F '#{==:#{session_attached},0}' 'kill-session -t =V'"];
  const synced = ["-u", "-S", target.socket, "-T", "sync", ...attach];
  const today = ["-u", "-S", target.socket, ...attach];
  assert.deepEqual(args("tmux 3.7c\n"), synced);
  assert.deepEqual(args("tmux 3.2\n"), synced);
  assert.deepEqual(args("tmux 3.1c\n"), today);
  assert.deepEqual(args("tmux 3.0\n"), today);
  assert.deepEqual(args("tmux next-3.6\n"), today, "unparsed");
  assert.deepEqual(args(""), today, "no answer");
  assert.deepEqual(args(new Error("spawnSync tmux ENOENT")), today, "a failed probe is not the attach's failure");
});

test("the probe runs once per exec: later viewers reuse its answer, a failed one included", () => {
  for (const version of ["tmux 3.7c\n", "tmux 3.1c\n", new Error("timed out")]) {
    const io = fixture(false, { version });
    const first = prepareSessionViewer(target, io).args.includes("sync");
    for (let i = 0; i < 2; i++) assert.equal(prepareSessionViewer(target, { ...io, detachKey: "F12" }).args.includes("sync"), first, String(version));
    assert.equal(io.calls.filter((c) => c[0] === "-V").length, 1, String(version));
  }
});

// ---- leftovers of an attach that died without detaching (awebai/oats#1332) ------------------------

test("the sweep removes a viewer session only when no client is attached and the pid in its name is gone, and a key table only when no listed session has its name; it touches nothing else", () => {
  const dead = 2147483646; // above every pid_max: no such process
  const live = process.pid;
  const sessions = [
    `oatsview-${dead}-0badc0de\t0`, // a dead attach's session: removed
    `oatsview-${dead}-a77ac4ed\t1`, // attached: a client holds it, whoever made it
    `oatsview-${live}-5ca1ab1e\t0`, // a live attach before its client: kept
    `oatsview-${dead}-NOTHEX00\t0`, // not a viewer's name
    "oatsview-locked\t0",
    "team\t0",
  ].join("\n");
  const keys = [
    `bind-key    -T oatsview-${dead}-0badc0de F12 detach-client`, // its session is removed: removed
    `bind-key    -T oatsview-${dead}-feedf00d F12 detach-client`, // no session: removed
    `bind-key    -T oatsview-${dead}-feedf00d WheelUpPane send-keys -M`, // the same table, counted once
    `bind-key -r -T oatsview-${dead}-a77ac4ed F12 detach-client`, // its session is attached: kept
    `bind-key    -T oatsview-${live}-5ca1ab1e F12 detach-client`, // its session is kept: kept
    "bind-key    -T oatsview-locked WheelUpPane send-keys -M", // shared by plain viewers: kept
    "bind-key    -T prefix d detach-client",
  ].join("\n");
  const io = fixture(false, { sessions, keys });
  const viewer = prepareSessionViewer(target, io);
  assert.deepEqual(viewer.swept, { sessions: 1, tables: 2 });
  const removals = io.calls.filter((c) => c[0] === "kill-session" || c[0] === "unbind-key" && !SHARED_TABLES.includes(c[4]));
  assert.deepEqual(removals, [
    ["kill-session", "-t", `=oatsview-${dead}-0badc0de`],
    ["unbind-key", "-a", "-q", "-T", `oatsview-${dead}-0badc0de`],
    ["unbind-key", "-a", "-q", "-T", `oatsview-${dead}-feedf00d`],
  ]);
  assert.ok(io.calls.findIndex((c) => c[0] === "list-keys") < io.calls.findIndex((c) => c[0] === "list-sessions"), "keys are listed first: a table seen there has its session in the later list");
  assert.ok(io.calls.findIndex((c) => c[2] === `oatsview-${dead}-feedf00d`) < io.calls.findIndex((c) => c[0] === "new-session"), "swept before the viewer exists");
});

test("a sweep that tmux refuses is not the attach's failure: what it could not remove is not counted", () => {
  const dead = 2147483646;
  const calls = [];
  const viewer = prepareSessionViewer(target, { exec(bin, args) {
    const cmd = args.slice(3); calls.push(cmd);
    if (cmd[0] === "list-panes") return "%1\t0\tcodex\t123\n";
    if (cmd[0] === "list-keys") return `bind-key -T oatsview-${dead}-feedf00d F12 detach-client\nbind-key -T oatsview-${dead}-0badc0de F12 detach-client\n`;
    if (cmd[0] === "list-sessions") return `oatsview-${dead}-0badc0de\t0\n`;
    if (cmd[0] === "kill-session" || cmd[0] === "unbind-key" && !SHARED_TABLES.includes(cmd[4])) throw new Error("refused");
    if (cmd[0] === "new-session") return "@98\n";
    return "";
  } });
  assert.deepEqual(viewer.swept, { sessions: 0, tables: 0 });
  assert.ok(calls.some((c) => c[0] === "new-session"));
  assert.equal(calls.some((c) => c[0] === "unbind-key" && c[4] === `oatsview-${dead}-0badc0de`), false, "a session the sweep could not remove keeps its table");
  const listing = prepareSessionViewer(target, { exec(bin, args) {
    const cmd = args.slice(3);
    if (cmd[0] === "list-panes") return "%1\t0\tcodex\t123\n";
    if (cmd[0] === "list-keys") throw new Error("refused");
    if (cmd[0] === "new-session") return "@98\n";
    return "";
  } });
  assert.deepEqual(listing.swept, { sessions: 0, tables: 0 });
});
