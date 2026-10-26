// Regression for merged-state round 3: the desktop attach target must be
// exact-match anchored (=session:=window) — tmux -t prefix-matches by
// default, so an unanchored target with a stale roster attaches keystrokes
// to the WRONG agent's similarly named window. Includes a live-tmux proof
// (skipped when tmux is unavailable) that the anchored form rejects a
// missing exact target instead of prefix-matching.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync as makeTempDir, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir as systemTmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmuxAttachTarget, openTerm, sweepViewers, strayPrefixKeys, LOCKED_TABLE_BINDINGS, LOCKED_PREFIX_TABLE, LOCKED_PREFIX_BINDINGS, PREFIX_KEY } from "../packages/desktop/tmux-target.mjs";
import { tmuxForwardsBoundKey } from "../packages/desktop/local-tmux-io.mjs";
import * as kernelViewer from "../lib/session-viewer.mjs";
import { isolateSessionEnvironment, isolatedTmuxTmpdir } from "./helpers/host-fixture.mjs";

const RENDERER_PKG = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "desktop");

/** For a live test that does not address its own -S socket: install the fixture's private tmux
 * (isolateSessionEnvironment) for this test only, restored after it whatever its outcome. Its wrapper
 * is the only tmux on PATH and refuses a call that names no fixture server, so a call that would
 * reach the operator's default server fails the test. Returns the arguments that select the
 * fixture's server, or null when tmux is not installed (the test is skipped). */
function privateTmuxServer(t) {
  const probe = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) { t.skip("tmux not available"); return null; }
  const base = realpathSync(makeTempDir(join(systemTmpdir(), "oats-tgt-")));
  const restore = isolateSessionEnvironment(base);
  t.after(() => { restore(); rmSync(base, { recursive: true, force: true }); });
  assert.ok(isolatedTmuxTmpdir(), "the fixture's tmux isolation is installed");
  assert.match(spawnSync("tmux", ["list-sessions"], { encoding: "utf8" }).stderr, /test tmux refused a non-fixture socket/,
    "a call naming no fixture server is refused, not sent to the default server");
  return ["-L", "oats"];
}

test("anchors both components: =session:=window", () => {
  assert.equal(tmuxAttachTarget("pi-agents", "reviewer-1"), "=pi-agents:=reviewer-1");
  assert.equal(tmuxAttachTarget("s", 3), "=s:=3");
  assert.equal(tmuxAttachTarget("s"), "=s");
  assert.equal(tmuxAttachTarget("s", null), "=s");
});

test("rejects malformed session/window values", () => {
  for (const bad of [undefined, 42, "", "a:b", "a b", "$(x)", "a;b", "=s"]) {
    assert.throws(() => tmuxAttachTarget(bad, "w"), /bad session/, `session ${JSON.stringify(bad)}`);
  }
  for (const bad of ["a:b", "a b", "$(x)", "a;b", "=w", ""]) {
    assert.throws(() => tmuxAttachTarget("s", bad), /bad window/, `window ${JSON.stringify(bad)}`);
  }
});

test("only undefined/null mean 'no window' — empty string fails closed", () => {
  // review tmuxtgt nit: an explicit "" must not silently become a
  // session-only target (selecting the session's CURRENT window).
  assert.equal(tmuxAttachTarget("s", undefined), "=s");
  assert.equal(tmuxAttachTarget("s", null), "=s");
  assert.throws(() => tmuxAttachTarget("s", ""), /bad window/);
});

// openTerm: the sequence that had the bug (review tmuxtgt2) — preflight must
// run and reject BEFORE any pty is spawned; success builds a LINKED-WINDOW
// viewer session (phase-2 hook 2 + reviewer-936f9a3's escape: grouping
// shared window MEMBERSHIP, so sibling auto-select on window death and
// viewer-side window-nav keys could steer the tab to another agent — the
// viewer must contain ONLY a link to the exact window, with keys locked).
const fakeIo = (calls, opts = {}) => ({
  preflight: (t) => { calls.push(["preflight", t]); if (opts.preflightFails) throw new Error("absent"); },
  tmux: (args) => { calls.push(["tmux", ...args]); if (opts.tmuxFails?.(args)) throw new Error("tmux failed"); },
  tmuxOut: (args) => { calls.push(["tmuxOut", ...args]); return args[0] === "list-keys" ? opts.listKeys ?? "" : opts.windowId ?? "@7"; },
  spawnPty: (t, c, r) => { calls.push(["spawn", t, c, r]); if (opts.spawnFails) throw new Error("pty failed"); return opts.pty ?? {}; },
  forwardsBoundKey: () => opts.forwardsBoundKey ?? true,
  uniqueName: () => "oatsdesk-test-1",
});
/** The C-b table's provisioning (#1502), where tmux sends a bound key on (3.3 and later): bound again, then
 * its strays removed one by one, never emptied (an emptied table drops another viewer's pending C-b), and
 * only then is C-b bound in the locked table. */
const PREFIX_CALLS = [
  ...LOCKED_PREFIX_BINDINGS.map((b) => ["tmux", "bind-key", "-T", "oatsdesk-locked-prefix", ...b]),
  ["tmuxOut", "list-keys"],                                                                      // what else the server-global table holds
  ["tmux", "bind-key", "-T", "oatsdesk-locked", "C-b", "switch-client -T oatsdesk-locked-prefix"], // the one switch-client: into the C-b table
];
/** `tmux list-keys` as tmux 3.8 prints it: the C-b table with the approved keys (Shift+PgUp listed as S-PPage) and
 * strays (escaped as tmux escapes them), and other tables, whose keys are never this table's. */
const LISTING = [
  'bind-key    -T copy-mode    n                         send-keys -X search-again',
  'bind-key    -T oatsdesk-locked  WheelUpPane           if-shell -F "#{||:#{pane_in_mode},#{mouse_any_flag}}" "send-keys -M" "copy-mode -e; send-keys -M"',
  'bind-key    -T oatsdesk-locked-prefix  [             copy-mode',
  'bind-key    -T oatsdesk-locked-prefix  Any           send-keys C-b \\; if-shell -F "#{!=:#{mouse_x},}" "send-keys -M" send-keys',
  'bind-key    -T oatsdesk-locked-prefix  MouseDrag1Pane send-keys C-b',
  'bind-key    -T oatsdesk-locked-prefix  S-PPage       send-keys C-b \\; copy-mode -u',
  'bind-key    -T oatsdesk-locked-prefix  WheelUpPane   send-keys C-b',
  'bind-key    -T oatsdesk-locked-prefix  n             next-window',
  'bind-key -r -T oatsdesk-locked-prefix  c             new-window',
  'bind-key    -T oatsdesk-locked-prefix  \\;           command-prompt',
  'bind-key    -T oatsdesk-locked-prefix  \\#           choose-tree',
  'bind-key    -T oatsdesk-locked-prefix  \\\\           kill-window',
  'bind-key    -T oatsdesk-locked-prefix  \\"           split-window',
  'bind-key    -T oatsdesk-locked-prefixes  x           kill-server',
  'bind-key    -T prefix       n                         next-window',
].join("\n");

test("openTerm: failed preflight rejects before any viewer/pty exists", () => {
  const calls = [];
  assert.throws(() => openTerm({ session: "s", window: "gone" }, fakeIo(calls, { preflightFails: true })),
    /no tmux target =s:=gone/);
  assert.deepEqual(calls, [["preflight", "=s:=gone"]], "no viewer created, no pty spawned");
});

test("openTerm: linked-window viewer built in order, keys locked, pty attaches to the viewer", () => {
  const calls = [];
  const fake = { fake: true };
  const r = openTerm({ session: "s", window: "w", cols: 120, rows: 40 }, fakeIo(calls, { pty: fake }));
  assert.deepEqual(calls, [
    ["preflight", "=s:=w"],
    ["tmuxOut", "new-session", "-d", "-s", "oatsdesk-test-1", "-P", "-F", "#{window_id}"], // placeholder, id captured (index-agnostic)
    ["tmux", "link-window", "-s", "=s:=w", "-t", "=oatsdesk-test-1:"],        // exact window linked; tmux picks a free index
    ["tmux", "kill-window", "-t", "@7"],                                      // placeholder dropped BY ID — link is the ONLY window
    ["tmux", "set-option", "-t", "oatsdesk-test-1", "prefix", "None"],         // key lock: no prefix → no window-management ops
    ["tmux", "set-option", "-t", "oatsdesk-test-1", "prefix2", "None"],
    ["tmux", "set-option", "-t", "oatsdesk-test-1", "key-table", "oatsdesk-locked"],
    ["tmux", "unbind-key", "-a", "-q", "-T", "oatsdesk-locked"],              // tables are server-global: clear stale bindings first
    ...LOCKED_TABLE_BINDINGS.map((b) => ["tmux", "bind-key", "-T", "oatsdesk-locked", ...b]), // provisioned wheel, drag and Shift+PgUp bindings
    ...PREFIX_CALLS,                                                            // C-b [ scrolls back; C-b then any other key reaches the agent
    ["tmux", "set-option", "-t", "oatsdesk-test-1", "mouse", "on"],            // wheel events reach tmux
    ["tmux", "set-option", "-t", "oatsdesk-test-1", "status", "off"],          // no duplicate terminal chrome
    ["tmux", "set-option", "-t", "oatsdesk-test-1", "detach-on-destroy", "on"], // source death detaches the pty, never moves it (#1237)
    ["spawn", "=oatsdesk-test-1", 120, 40],                                     // pty attaches to the viewer
  ]);
  assert.equal(r.pty, fake);
  assert.equal(r.viewer, "oatsdesk-test-1");
  // cleanup contract: killViewer kills ONLY the =-anchored viewer session
  r.killViewer();
  assert.deepEqual(calls.at(-1), ["tmux", "kill-session", "-t", "=oatsdesk-test-1"]);
});

test("openTerm (#1237): detach-on-destroy on is set on the viewer before the pty spawns, and no option is set server-wide or globally", () => {
  // With a global `detach-on-destroy off` (an operator's ~/.tmux.conf), tmux
  // moves a destroyed session's client to another session: the tab would show
  // another agent under the old name. The viewer's own option prevents that;
  // the operator's global value and own sessions must stay untouched.
  const calls = [];
  openTerm({ session: "s", window: "w" }, fakeIo(calls));
  const dod = calls.findIndex((c) => c[0] === "tmux" && c[1] === "set-option" && c.includes("detach-on-destroy"));
  const spawn = calls.findIndex((c) => c[0] === "spawn");
  assert.ok(dod >= 0, "detach-on-destroy is set");
  assert.deepEqual(calls[dod], ["tmux", "set-option", "-t", "oatsdesk-test-1", "detach-on-destroy", "on"], "set on the viewer only");
  assert.ok(dod < spawn, "set before the pty client attaches");
  for (const c of calls.filter((c) => c[1] === "set-option" || c[1] === "set" || c[1] === "set-window-option" || c[1] === "setw")) {
    assert.ok(!c.includes("-g") && !c.includes("-s"), `no global or server-wide option: ${JSON.stringify(c)}`);
    assert.equal(c[2], "-t", `every option is targeted: ${JSON.stringify(c)}`);
    assert.equal(c[3], "oatsdesk-test-1", `every option targets the viewer: ${JSON.stringify(c)}`);
  }
});

test("openTerm: viewer is killed (not leaked) when link, lock, or pty spawn fails — and on a malformed window id", () => {
  for (const opts of [
    { tmuxFails: (a) => a[0] === "link-window" },
    { tmuxFails: (a) => a[0] === "set-option" },
    { spawnFails: true },
    { windowId: "definitely-not-an-id" },
  ]) {
    const calls = [];
    assert.throws(() => openTerm({ session: "s", window: "w" }, fakeIo(calls, opts)));
    assert.deepEqual(calls.at(-1), ["tmux", "kill-session", "-t", "=oatsdesk-test-1"], `viewer cleaned up (${JSON.stringify(Object.keys(opts))})`);
  }
});

test("openTerm: dimension clamping and validation flow through", () => {
  const calls = [];
  openTerm({ session: "s", cols: 0, rows: -5 }, fakeIo(calls));
  assert.deepEqual(calls.at(-1), ["spawn", "=oatsdesk-test-1", 80, 5], "cols default applied, rows clamped to minimum");
  // no window → whole session linked? No: link-window needs a window — the
  // session-only form links the session's target shorthand — assert we still
  // linked from the anchored session target.
  assert.ok(calls.some((c) => c[1] === "link-window" && c[3] === "=s"), "session-only target linked as-is");
  assert.throws(() => openTerm({ session: "a:b", window: "w" }, fakeIo([])), /bad session/);
});

test("sweepViewers: kills only dead-pid oatsdesk sessions", () => {
  const killed = [];
  const swept = sweepViewers({
    listSessions: () => ["pi-agents", "oatsdesk-99999999-1-abc", `oatsdesk-${process.pid}-1-live`, "oatsdesk-1-2-x", "unrelated"],
    killSession: (n) => killed.push(n),
    pidAlive: (pid) => pid === 1, // pid 1 "alive", 99999999 dead
  });
  assert.deepEqual(swept, ["oatsdesk-99999999-1-abc"], "only the dead orphan");
  assert.deepEqual(killed, ["oatsdesk-99999999-1-abc"]);
});

test("live tmux: anchored target rejects a missing exact window instead of prefix-matching", (t) => {
  const server = privateTmuxServer(t);
  if (!server) return;
  const session = `oatstgt${process.pid}`;
  try {
    execFileSync("tmux", [...server, "new-session", "-d", "-s", session, "-n", "reviewer-15c135c", "sh"], { timeout: 5000 });
    // Unanchored "session:reviewer-1" would PREFIX-MATCH the live
    // "reviewer-15c135c" window — the wrong-agent hazard.
    const unanchored = spawnSync("tmux", [...server, "list-panes", "-t", `${session}:reviewer-1`], { encoding: "utf8", timeout: 5000 });
    // Anchored form must refuse: no exact "reviewer-1" window exists. This
    // is what makes openTerm's preflight (which runs exactly this
    // list-panes check) reject a missing exact target.
    const anchored = spawnSync("tmux", [...server, "list-panes", "-t", tmuxAttachTarget(session, "reviewer-1")], { encoding: "utf8", timeout: 5000 });
    assert.notEqual(anchored.status, 0, "anchored target must NOT resolve a prefix match");
    if (unanchored.status === 0) {
      // this tmux prefix-matches (the hazard is real on this box) — the
      // anchored form above is what protects us; nothing more to assert.
    }
    // And the anchored form still resolves the EXACT window.
    const exact = spawnSync("tmux", [...server, "list-panes", "-t", tmuxAttachTarget(session, "reviewer-15c135c")], { encoding: "utf8", timeout: 5000 });
    assert.equal(exact.status, 0, "anchored exact target resolves");
  } finally {
    spawnSync("tmux", [...server, "kill-session", "-t", `=${session}`], { timeout: 5000 });
  }
});

test("live tmux: linked-window viewer — source window death terminates the viewer, never activates a sibling", (t) => {
  // reviewer-936f9a3 regression (a): live A+B; viewer on A; destroy A →
  // viewer/pty target dies (NEVER activates B); B and the source survive.
  const server = privateTmuxServer(t);
  if (!server) return;
  const src = `oatslwsrc${process.pid}`;
  let viewer = null;
  try {
    execFileSync("tmux", [...server, "new-session", "-d", "-s", src, "-n", "instA", "sh"], { timeout: 5000 });
    execFileSync("tmux", [...server, "new-window", "-t", `=${src}`, "-n", "instB", "sh"], { timeout: 5000 });

    const r = openTerm({ session: src, window: "instA" }, {
      preflight: (target) => execFileSync("tmux", [...server, "list-panes", "-t", target], { stdio: "ignore", timeout: 5000 }),
      tmux: (args) => execFileSync("tmux", [...server, ...args], { stdio: "ignore", timeout: 5000 }),
      tmuxOut: (args) => execFileSync("tmux", [...server, ...args], { encoding: "utf8", timeout: 5000 }).trim(),
      spawnPty: (target) => ({ target }),
    });
    viewer = r.viewer;
    assert.equal(r.pty.target, `=${viewer}`, "pty attaches to the viewer session");
    const vwins = spawnSync("tmux", [...server, "list-windows", "-t", `=${viewer}`, "-F", "#{window_name}"], { encoding: "utf8", timeout: 5000 }).stdout.trim().split("\n");
    assert.deepEqual(vwins, ["instA"], "viewer contains ONLY the linked window");

    // membership isolation: source window switches don't affect the viewer
    execFileSync("tmux", [...server, "select-window", "-t", `=${src}:=instB`], { timeout: 5000 });
    const vactive = spawnSync("tmux", [...server, "list-windows", "-t", `=${viewer}`, "-F", "#{window_name} #{?window_active,A,}"], { encoding: "utf8", timeout: 5000 }).stdout;
    assert.match(vactive, /instA A/, "viewer still on instA");

    // THE escape: retire (kill) source instA — viewer must DIE, never show instB
    execFileSync("tmux", [...server, "kill-window", "-t", `=${src}:=instA`], { timeout: 5000 });
    let alive = true;
    for (let i = 0; i < 20 && alive; i++) {
      alive = spawnSync("tmux", [...server, "has-session", "-t", `=${viewer}`], { timeout: 5000 }).status === 0;
      if (alive) { const w = spawnSync("tmux", [...server, "list-windows", "-t", `=${viewer}`, "-F", "#{window_name}"], { encoding: "utf8", timeout: 5000 }).stdout; assert.ok(!w.includes("instB"), "viewer must NEVER contain/activate instB"); }
    }
    assert.equal(alive, false, "viewer terminated when its only (linked) window died");
    viewer = null;
    const sessions = spawnSync("tmux", [...server, "list-sessions", "-F", "#{session_name}"], { encoding: "utf8", timeout: 5000 }).stdout;
    assert.ok(sessions.includes(src), "source session survives");
    const windows = spawnSync("tmux", [...server, "list-windows", "-t", `=${src}`, "-F", "#{window_name}"], { encoding: "utf8", timeout: 5000 }).stdout;
    assert.ok(windows.includes("instB"), "sibling window B survives");
  } finally {
    if (viewer) spawnSync("tmux", [...server, "kill-session", "-t", `=${viewer}`], { timeout: 5000 });
    spawnSync("tmux", [...server, "kill-session", "-t", `=${src}`], { timeout: 5000 });
  }
});

test("live tmux: viewer key path cannot leave the linked window; viewer kill spares the source", (t) => {
  // reviewer-936f9a3 regression (b): window-management keys are inert in the
  // viewer (prefix None + locked key-table), and teardown never touches the
  // source. Driven via send-keys of the default prefix + window-nav keys.
  const server = privateTmuxServer(t);
  if (!server) return;
  const src = `oatslwsrc2${process.pid}`;
  let viewer = null;
  try {
    execFileSync("tmux", [...server, "new-session", "-d", "-s", src, "-n", "instA", "sh"], { timeout: 5000 });
    execFileSync("tmux", [...server, "new-window", "-t", `=${src}`, "-n", "instB", "sh"], { timeout: 5000 });
    const r = openTerm({ session: src, window: "instA" }, {
      preflight: (target) => execFileSync("tmux", [...server, "list-panes", "-t", target], { stdio: "ignore", timeout: 5000 }),
      tmux: (args) => execFileSync("tmux", [...server, ...args], { stdio: "ignore", timeout: 5000 }),
      tmuxOut: (args) => execFileSync("tmux", [...server, ...args], { encoding: "utf8", timeout: 5000 }).trim(),
      spawnPty: (target) => ({ target }),
    });
    viewer = r.viewer;
    // prefix and key-table are locked
    const opts = spawnSync("tmux", [...server, "show-options", "-t", viewer], { encoding: "utf8", timeout: 5000 }).stdout;
    assert.match(opts, /prefix None/, "prefix disabled");
    assert.match(opts, /key-table oatsdesk-locked/, "nonexistent key table");
    // attempt window-management via the (disabled) prefix path: C-b n / C-b l /
    // C-b c / C-b 1 — with prefix None these are raw bytes to the pane, not commands
    for (const keys of [["C-b", "n"], ["C-b", "l"], ["C-b", "c"], ["C-b", "1"]]) {
      spawnSync("tmux", [...server, "send-keys", "-t", `=${viewer}`, ...keys], { timeout: 5000 });
    }
    const wins = spawnSync("tmux", [...server, "list-windows", "-t", `=${viewer}`, "-F", "#{window_name}"], { encoding: "utf8", timeout: 5000 }).stdout.trim().split("\n");
    assert.deepEqual(wins, ["instA"], "no nav/new escaped the linked window (no new/other windows)");
    // teardown: killing the viewer spares the source and both its windows
    r.killViewer();
    viewer = null;
    const windows = spawnSync("tmux", [...server, "list-windows", "-t", `=${src}`, "-F", "#{window_name}"], { encoding: "utf8", timeout: 5000 }).stdout;
    assert.ok(windows.includes("instA") && windows.includes("instB"), "source windows survive viewer kill");
  } finally {
    if (viewer) spawnSync("tmux", [...server, "kill-session", "-t", `=${viewer}`], { timeout: 5000 });
    spawnSync("tmux", [...server, "kill-session", "-t", `=${src}`], { timeout: 5000 });
  }
});

test("live tmux: viewer construction works under a nonzero base-index (isolated server)", (t) => {
  // reviewer-linkview regression: with base-index 1 the placeholder is not
  // at index 0 — window-id-based construction must not care. Isolated tmux
  // server (-S socket) so the user's real server/options are untouched.
  const probe = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return t.skip("tmux not available");
  const sock = `/tmp/oatsbi-${process.pid}.sock`;
  const T = (args, out = false) => {
    const r = spawnSync("tmux", ["-S", sock, ...args], { encoding: "utf8", timeout: 5000 });
    if (r.status !== 0) throw new Error(`tmux ${args[0]} failed: ${r.stderr}`);
    return out ? r.stdout.trim() : undefined;
  };
  try {
    T(["new-session", "-d", "-s", "boot", "sh"]);        // boot the server
    T(["set-option", "-g", "base-index", "1"]);           // the customization that broke fixed indices
    T(["new-session", "-d", "-s", "src", "-n", "instA", "sh"]);
    T(["new-window", "-t", "=src", "-n", "instB", "sh"]);
    assert.equal(T(["list-windows", "-t", "=src", "-F", "#{window_index} #{window_name}"], true).split("\n")[0], "1 instA",
      "base-index 1 active: first window at index 1");

    const r = openTerm({ session: "src", window: "instA" }, {
      preflight: (target) => T(["list-panes", "-t", target]),
      tmux: (args) => T(args),
      tmuxOut: (args) => T(args, true),
      spawnPty: (target) => ({ target }),
    });
    const wins = T(["list-windows", "-t", `=${r.viewer}`, "-F", "#{window_name}"], true).split("\n");
    assert.deepEqual(wins, ["instA"], "viewer contains ONLY the linked window despite base-index 1");
    r.killViewer();
    assert.ok(T(["list-windows", "-t", "=src", "-F", "#{window_name}"], true).includes("instA"), "source intact");
  } finally {
    spawnSync("tmux", ["-S", sock, "kill-server"], { timeout: 5000 });
    spawnSync("rm", ["-f", sock], { timeout: 5000 });
  }
});

test("openTerm (#1502): below tmux 3.3 (or an unknown version) there is no C-b binding and no C-b table", () => {
  const calls = [];
  openTerm({ session: "s", window: "w", cols: 120, rows: 40 }, fakeIo(calls, { forwardsBoundKey: false }));
  assert.ok(!calls.some(call => call.includes("C-b") || call.includes("oatsdesk-locked-prefix")), "nothing of the C-b table");
  assert.ok(LOCKED_TABLE_BINDINGS.every(b => calls.some(call => call.join("\0") === ["tmux", "bind-key", "-T", "oatsdesk-locked", ...b].join("\0"))),
    "the wheel, drag and Shift+PgUp still are");
  const { forwardsBoundKey, ...without } = fakeIo([]);
  const none = [];
  openTerm({ session: "s", window: "w" }, { ...without, preflight: (t) => none.push(["preflight", t]), tmux: (args) => none.push(["tmux", ...args]) });
  assert.ok(!none.some(call => call.includes("C-b")), "an io that cannot say has no C-b");
});

test("strayPrefixKeys (#1502): the C-b table's keys that are not the approved ones, as unbind-key takes them; other tables are never touched", () => {
  assert.deepEqual(strayPrefixKeys(LISTING), ["n", "c", "\\;", "#", "\\", '"']);
  assert.deepEqual(strayPrefixKeys(""), []);
  assert.deepEqual(strayPrefixKeys(LISTING.split("\n").filter(line => !/ (n|c|\\.) /.test(line.split("oatsdesk-locked-prefix")[1] ?? "")).join("\n")), [],
    "only approved keys: nothing to remove");
});

test("openTerm (#1502): the C-b table is bound again and its strays removed one by one, never emptied, before C-b reaches it", () => {
  const calls = [];
  openTerm({ session: "s", window: "w" }, fakeIo(calls, { listKeys: LISTING }));
  assert.ok(!calls.some(call => call.includes("unbind-key") && call.includes("-a") && call.includes("oatsdesk-locked-prefix")), "never unbind-key -a on the C-b table");
  const at = call => calls.findIndex(c => c.join("\0") === call.join("\0"));
  const strays = ["n", "c", "\\;", "#", "\\", '"'].map(key => ["tmux", "unbind-key", "-q", "-T", "oatsdesk-locked-prefix", key]);
  for (const stray of strays) assert.ok(at(stray) > at(["tmuxOut", "list-keys"]), `${stray.at(-1)}: removed, after the listing`);
  const lastBind = Math.max(...LOCKED_PREFIX_BINDINGS.map(b => at(["tmux", "bind-key", "-T", "oatsdesk-locked-prefix", ...b])));
  assert.ok(lastBind < at(["tmuxOut", "list-keys"]), "the approved keys are bound first: the table is never empty");
  const cb = at(["tmux", "bind-key", "-T", "oatsdesk-locked", "C-b", "switch-client -T oatsdesk-locked-prefix"]);
  assert.ok(strays.every(stray => at(stray) < cb), "C-b reaches the table only once its strays are gone");
  assert.ok(!calls.some(call => call.includes("unbind-key") && call.at(-1) === "S-PPage"), "the approved Shift+PgUp, listed as S-PPage, stays");
});

const FORBIDDEN = ["next-window", "previous-window", "last-window", "new-window", "select-window", "kill-window", "choose-",
  "command-prompt", "switch-client", "new-session", "attach-session", "detach-client", "kill-session", "run-shell", "source-file"];
test("locked table provisions ONLY the approved bindings — no window management", () => {
  // Unit guard on the exported binding set itself (the live test asserts
  // the installed table): exactly the approved keys, and none of the
  // window-management commands can appear in any binding.
  const keys = LOCKED_TABLE_BINDINGS.map(([k]) => k);
  assert.deepEqual(keys, ["WheelUpPane", "MouseDrag1Pane", "S-PageUp"], "exactly the approved binding keys");
  const flat = LOCKED_TABLE_BINDINGS.flat().join(" ");
  for (const forbidden of FORBIDDEN) assert.ok(!flat.includes(forbidden), `no ${forbidden} in the locked table`);
  assert.match(flat, /copy-mode -e/, "wheel enters exit-at-bottom copy mode");
  assert.match(flat, /send-keys -M/, "mouse event forwarded");
  assert.deepEqual(LOCKED_TABLE_BINDINGS.find(([k]) => k === "S-PageUp"), ["S-PageUp", "copy-mode -u"], "Shift+PgUp: copy mode, a page up");
  // #520: a plain drag starts a tmux copy selection (its release copies, and tmux sends OSC 52), unless the app grabbed the mouse.
  assert.deepEqual(LOCKED_TABLE_BINDINGS.find(([k]) => k === "MouseDrag1Pane"),
    ["MouseDrag1Pane", "if-shell", "-F", "#{||:#{pane_in_mode},#{mouse_any_flag}}", "send-keys -M", "copy-mode -M"]);
});

test("the C-b entry (#1502) is the locked table's one switch-client: always -T, into the Desktop's own C-b table, which holds no window management", () => {
  // The guard as approved for #1502: exactly one switch-client, `-T oatsdesk-locked-prefix`, a key table and
  // never a session; the C-b table holds only the kernel's LOCKED_PREFIX_BINDINGS, mirrored.
  const calls = [];
  openTerm({ session: "s", window: "w" }, fakeIo(calls));
  const switches = calls.filter(call => call.join(" ").includes("switch-client"));
  assert.deepEqual(switches, [["tmux", "bind-key", "-T", "oatsdesk-locked", "C-b", "switch-client -T oatsdesk-locked-prefix"]]);
  assert.equal(PREFIX_KEY, "C-b"); assert.equal(LOCKED_PREFIX_TABLE, "oatsdesk-locked-prefix");
  assert.notEqual(LOCKED_PREFIX_TABLE, kernelViewer.LOCKED_PREFIX_TABLE, "the Desktop's tables are its own: a kernel viewer's unbind never empties them");
  assert.deepEqual(LOCKED_PREFIX_BINDINGS.map(([k]) => k), ["[", "WheelUpPane", "MouseDrag1Pane", "S-PageUp", "Any"]);
  const flat = LOCKED_PREFIX_BINDINGS.flat().join(" ");
  for (const forbidden of FORBIDDEN) assert.ok(!flat.includes(forbidden), `no ${forbidden} in the C-b table`);
  assert.deepEqual(LOCKED_PREFIX_BINDINGS.find(([k]) => k === "["), ["[", "copy-mode"]);
  for (const [key, command] of LOCKED_PREFIX_BINDINGS.filter(([k]) => k !== "[")) {
    assert.match(command, /^send-keys C-b ; /, `${key}: the C-b reaches the agent first`);
  }
});

test("pinned to the kernel's viewer (#1502): the same bindings, the same C-b table and the same tmux gate", () => {
  assert.deepEqual(LOCKED_TABLE_BINDINGS, kernelViewer.VIEWER_BINDINGS.map(b => [...b]), "the locked table is the kernel viewer's");
  assert.deepEqual(LOCKED_PREFIX_BINDINGS, kernelViewer.LOCKED_PREFIX_BINDINGS.map(b => [...b]), "the C-b table is the kernel's");
  assert.equal(PREFIX_KEY, kernelViewer.PREFIX_KEY);
  assert.equal(kernelViewer.VIEWER_PREFIX_MIN_TMUX, "3.3");
  for (const version of ["tmux 3.3", "tmux 3.3a", "tmux 3.2a", "tmux 3.2", "tmux 3.0", "tmux 2.9a", "tmux 3.4", "tmux 3.8", "tmux 3.10",
    "tmux 4.0", "tmux next-3.3", "tmux next-3.2", "tmux next-3.6", "tmux 10.1-rc", "tmux master", "tmux openbsd-7.4", "not tmux 3.4",
    "tmux 3.4\n", "  tmux 3.5  ", "tmux", "3.4", "", undefined, null, 3.4]) {
    assert.equal(tmuxForwardsBoundKey(version), kernelViewer.tmuxForwardsBoundKey(version), JSON.stringify(version));
  }
  assert.equal(tmuxForwardsBoundKey("tmux 3.3"), true); assert.equal(tmuxForwardsBoundKey("tmux 3.2a"), false);
});

test("live tmux: real wheel events through an attached pty client — installed binding enters copy mode and scrolls; stale table bindings are cleared", async (t) => {
  // reviewer-wheelbind regressions: (1) key tables are server-global — a
  // stale forbidden binding seeded into oatsdesk-locked BEFORE openTerm must
  // be gone after construction; (2) the INSTALLED WheelUpPane binding is
  // driven by real SGR mouse bytes from an attached client (node-pty), not
  // by manually running copy-mode: first wheel enters copy mode, second
  // scrolls (position increases), wheel-down returns to bottom and exits.
  const probe = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return t.skip("tmux not available");
  let ptyMod;
  try {
    // node-pty lives in packages/desktop's node_modules — resolve from there
    ptyMod = createRequire(join(RENDERER_PKG, "package.json"))("node-pty");
    // ABI probe: after `npm run rebuild` node-pty targets the Electron ABI
    // and plain-node spawns fail with posix_spawnp — skip rather than fail
    // (CI's fresh npm ci builds the node ABI and runs this test for real).
    const probePty = ptyMod.spawn("true", [], { name: "xterm", cols: 10, rows: 5 });
    probePty.kill();
  }
  catch (error) {
    // Say why, so a local pass is not mistaken for this test having run. A fresh `npm ci`
    // (install scripts withheld) leaves node-pty's prebuilt spawn-helper non-executable.
    return t.skip(`node-pty can't spawn here (${String(error?.message || error).slice(0, 120)}): not built for this node ABI, `
      + "or its prebuilds/<platform>/spawn-helper is not executable (chmod +x it, or npm rebuild node-pty)");
  }
  const sock = `/tmp/oatswhl-${process.pid}.sock`;
  const T = (args, out = false) => {
    const r = spawnSync("tmux", ["-S", sock, ...args], { encoding: "utf8", timeout: 5000 });
    if (r.status !== 0) throw new Error(`tmux ${args.join(" ")} failed: ${r.stderr}`);
    return out ? r.stdout.trim() : undefined;
  };
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  let client = null;
  try {
    T(["new-session", "-d", "-s", "src", "-n", "instA", "sh"]);
    T(["send-keys", "-t", "=src:=instA", "seq 1 200", "Enter"]);
    await sleep(800); // >pane-height history

    // seed a STALE forbidden binding into the (server-global) locked table
    T(["bind-key", "-T", "oatsdesk-locked", "n", "next-window"]);

    const r = openTerm({ session: "src", window: "instA" }, {
      preflight: (target) => T(["list-panes", "-t", target]),
      tmux: (args) => T(args),
      tmuxOut: (args) => T(args, true),
      spawnPty: (target, cols, rows) => ptyMod.spawn("tmux", ["-S", sock, "attach-session", "-t", target], {
        name: "xterm-256color", cols, rows, env: process.env,
      }),
    });
    client = r.pty;
    await sleep(1200); // client attached

    // (1) the stale forbidden binding was cleared by the unbind-all
    // Read every binding and keep this table's lines: tmux 3.7 lists nothing for a CUSTOM
    // table under `list-keys -T <table>` (built-in tables still list), though its bindings exist.
    const table = T(["list-keys"], true).split("\n").filter(line => /-T oatsdesk-locked\s/.test(line)).join("\n");
    assert.ok(!table.includes("next-window"), "stale forbidden binding cleared from the server-global table");
    assert.match(table, /WheelUpPane/, "allow-list installed");

    // (2) REAL wheel events (SGR mouse) through the attached client drive
    // the installed binding — mutations breaking the if-shell condition or
    // command syntax fail here.
    client.write("\x1b[<64;10;10M");           // wheel up: binding fires → copy-mode -e
    await sleep(600);
    assert.equal(T(["display-message", "-p", "-t", r.viewer, "#{pane_in_mode}"], true), "1", "first wheel entered copy mode");
    client.write("\x1b[<64;10;10M");           // second wheel: copy-mode WheelUpPane scrolls
    await sleep(600);
    const pos = Number(T(["display-message", "-p", "-t", r.viewer, "#{scroll_position}"], true));
    assert.ok(pos > 0, `scroll position increased (${pos})`);
    // wheel-down back to bottom: -e exits copy mode
    for (let i = 0; i < 4; i++) { client.write("\x1b[<65;10;10M"); await sleep(200); }
    assert.equal(T(["display-message", "-p", "-t", r.viewer, "#{pane_in_mode}"], true), "0", "copy mode exited at bottom");

    // window pinned throughout; teardown spares the source
    assert.deepEqual(T(["list-windows", "-t", `=${r.viewer}`, "-F", "#{window_name}"], true).split("\n"), ["instA"]);
    client.kill();
    client = null;
    r.killViewer();
    assert.ok(T(["list-windows", "-t", "=src", "-F", "#{window_name}"], true).includes("instA"), "source intact");
  } finally {
    if (client) { try { client.kill(); } catch { /* gone */ } }
    spawnSync("tmux", ["-S", sock, "kill-server"], { timeout: 5000 });
    spawnSync("rm", ["-f", sock], { timeout: 5000 });
  }
});

test("live tmux (#1502): through a real attached client, C-b [ and Shift+PgUp scroll back, and C-b then any other key reaches the agent as both keys without leaving the linked window", async (t) => {
  const probe = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return t.skip("tmux not available");
  if (!tmuxForwardsBoundKey(probe.stdout)) return t.skip(`${probe.stdout.trim()}: before 3.3 the viewer has no C-b table`);
  let ptyMod;
  try {
    ptyMod = createRequire(join(RENDERER_PKG, "package.json"))("node-pty");
    const probePty = ptyMod.spawn("true", [], { name: "xterm", cols: 10, rows: 5 });
    probePty.kill();
  } catch (error) {
    return t.skip(`node-pty can't spawn here (${String(error?.message || error).slice(0, 120)})`);
  }
  const sock = `/tmp/oatspfx-${process.pid}.sock`;
  const T = (args, out = false) => {
    const r = spawnSync("tmux", ["-S", sock, ...args], { encoding: "utf8", timeout: 5000 });
    if (r.status !== 0) throw new Error(`tmux ${args.join(" ")} failed: ${r.stderr}`);
    return out ? r.stdout.trim() : undefined;
  };
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  let client = null;
  try {
    T(["new-session", "-d", "-s", "src", "-n", "instA", "sh"]);
    T(["new-window", "-t", "=src", "-n", "instB", "sh"]);
    T(["send-keys", "-t", "=src:=instA", "seq 1 200", "Enter"]);
    await sleep(800); // more history than the pane is high
    // A stale binding in the (server-global) C-b table is cleared before the table is bound.
    T(["bind-key", "-T", "oatsdesk-locked-prefix", "n", "next-window"]);
    const r = openTerm({ session: "src", window: "instA", cols: 80, rows: 24 }, {
      preflight: (target) => T(["list-panes", "-t", target]),
      tmux: (args) => T(args),
      tmuxOut: (args) => T(args, true),
      forwardsBoundKey: () => tmuxForwardsBoundKey(T(["-V"], true)),
      spawnPty: (target, cols, rows) => ptyMod.spawn("tmux", ["-S", sock, "attach-session", "-t", target], { name: "xterm-256color", cols, rows, env: process.env }),
    });
    client = r.pty;
    await sleep(1200); // client attached
    const mode = () => T(["display-message", "-p", "-t", r.viewer, "#{pane_in_mode}"], true);
    const keyTable = () => T(["list-clients", "-F", "#{client_key_table}"], true);
    assert.equal(mode(), "0");
    assert.equal(keyTable(), "oatsdesk-locked");

    // C-b [ enters copy mode; the agent reads nothing.
    client.write("\x02[");
    await sleep(600);
    assert.equal(mode(), "1", "C-b [ entered copy mode");
    client.write("q"); await sleep(400);
    assert.equal(mode(), "0", "q left it");
    assert.equal(keyTable(), "oatsdesk-locked", "back in the locked table after the one key");

    // Shift+PgUp, as the Desktop's key path writes it (CSI 5;2 ~): copy mode, a page up.
    client.write("\x1b[5;2~");
    await sleep(600);
    assert.equal(mode(), "1", "Shift+PgUp entered copy mode");
    assert.ok(Number(T(["display-message", "-p", "-t", r.viewer, "#{scroll_position}"], true)) > 0, "and scrolled back a page");
    client.write("q"); await sleep(400);
    assert.equal(mode(), "0");

    // A C-b this client is waiting on survives another viewer opening: the C-b table is bound again, never emptied.
    const second = openTerm({ session: "src", window: "instB", cols: 80, rows: 24 }, {
      preflight: (target) => T(["list-panes", "-t", target]),
      tmux: (args) => T(args),
      tmuxOut: (args) => T(args, true),
      forwardsBoundKey: () => true,
      spawnPty: () => ({}),
    });
    T(["send-keys", "-t", "=src:=instA", "clear; cat -v", "Enter"]);
    await sleep(500);
    client.write("\x02");
    await sleep(400);
    assert.equal(keyTable(), "oatsdesk-locked-prefix", "waiting after C-b");
    const third = openTerm({ session: "src", window: "instB", cols: 80, rows: 24 }, {
      preflight: (target) => T(["list-panes", "-t", target]),
      tmux: (args) => T(args),
      tmuxOut: (args) => T(args, true),
      forwardsBoundKey: () => true,
      spawnPty: () => ({}),
    });
    assert.equal(keyTable(), "oatsdesk-locked-prefix", "still waiting after another viewer bound the table");
    client.write("x\r");
    await sleep(600);
    assert.match(T(["capture-pane", "-p", "-t", "=src:=instA"], true), /\^Bx/, "the pending C-b reached the agent with the next key");
    second.killViewer(); third.killViewer();
    T(["send-keys", "-t", "=src:=instA", "C-c", ""]);
    await sleep(300);

    // C-b then any other key: both keys reach the agent, as typed; nothing navigates.
    T(["send-keys", "-t", "=src:=instA", "clear; cat -v", "Enter"]);
    await sleep(500);
    client.write("\x02n\x02c\x02l\x021\x02\x02\r");
    await sleep(800);
    const screen = T(["capture-pane", "-p", "-t", "=src:=instA"], true);
    assert.match(screen, /\^Bn\^Bc\^Bl\^B1\^B\^B/, `the agent read C-b n, C-b c, C-b l, C-b 1 and C-b C-b:\n${screen}`);
    assert.ok(!T(["list-keys"], true).split("\n").some(line => /-T oatsdesk-locked-prefix\s+n\s/.test(line)), "the stale binding was cleared");
    assert.deepEqual(T(["list-windows", "-t", `=${r.viewer}`, "-F", "#{window_name}"], true).split("\n"), ["instA"], "the viewer still holds only its linked window");
    assert.equal(T(["list-clients", "-F", "#{client_session}"], true), r.viewer, "the client never left the viewer");
    assert.equal(keyTable(), "oatsdesk-locked");

    client.kill();
    client = null;
    r.killViewer();
    assert.deepEqual(T(["list-windows", "-t", "=src", "-F", "#{window_name}"], true).split("\n"), ["instA", "instB"], "the source is intact");
  } finally {
    if (client) { try { client.kill(); } catch { /* gone */ } }
    spawnSync("tmux", ["-S", sock, "kill-server"], { timeout: 5000 });
    spawnSync("rm", ["-f", sock], { timeout: 5000 });
  }
});

/** #1237 live fixture: an isolated -S server whose GLOBAL detach-on-destroy is off (an
 * operator's ~/.tmux.conf setting), a source session with instA and instB, and one openTerm
 * viewer on each with a real attached node-pty client. Runs `body` with the fixture, then
 * kills every client and the throwaway server. Skips when tmux or a spawnable node-pty is absent. */
async function withTwoAttachedViewers(t, body) {
  const probe = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return t.skip("tmux not available");
  let ptyMod;
  try {
    ptyMod = createRequire(join(RENDERER_PKG, "package.json"))("node-pty");
    const probePty = ptyMod.spawn("true", [], { name: "xterm", cols: 10, rows: 5 });
    probePty.kill();
  }
  catch (error) {
    return t.skip(`node-pty can't spawn here (${String(error?.message || error).slice(0, 120)}): not built for this node ABI, `
      + "or its prebuilds/<platform>/spawn-helper is not executable (chmod +x it, or npm rebuild node-pty)");
  }
  const sock = `/tmp/oatsdod-${process.pid}.sock`;
  const T = (args, out = false) => {
    const r = spawnSync("tmux", ["-S", sock, ...args], { encoding: "utf8", timeout: 5000 });
    if (r.status !== 0) throw new Error(`tmux ${args.join(" ")} failed: ${r.stderr}`);
    return out ? r.stdout.trim() : undefined;
  };
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const env = { ...process.env };
  delete env.TMUX; // an attached client inside an outer tmux would refuse to nest
  const clients = [];
  const io = {
    preflight: (target) => T(["list-panes", "-t", target]),
    tmux: (args) => T(args),
    tmuxOut: (args) => T(args, true),
    spawnPty: (target, cols, rows) => {
      const pty = ptyMod.spawn("tmux", ["-S", sock, "attach-session", "-t", target], { name: "xterm-256color", cols, rows, env });
      pty.exited = null;
      pty.onExit((e) => { pty.exited = e; });
      clients.push(pty);
      return pty;
    },
  };
  const clientSessions = () => T(["list-clients", "-F", "#{client_session}"], true).split("\n").filter(Boolean).sort();
  try {
    T(["new-session", "-d", "-s", "src", "-n", "instA", "sh"]);
    T(["new-window", "-t", "=src", "-n", "instB", "sh"]);
    T(["set-option", "-g", "detach-on-destroy", "off"]);           // the operator's hazardous global
    const v1 = openTerm({ session: "src", window: "instA" }, io);
    const v2 = openTerm({ session: "src", window: "instB" }, io);
    const both = [v1.viewer, v2.viewer].sort();
    for (let i = 0; i < 50 && clientSessions().join(" ") !== both.join(" "); i++) await sleep(100);
    assert.deepEqual(clientSessions(), both, "one client attached to each viewer");
    await body({ T, v1, v2, sleep, clientSessions,
      sessionExists: (name) => spawnSync("tmux", ["-S", sock, "has-session", "-t", `=${name}`], { timeout: 5000 }).status === 0 });
  } finally {
    for (const c of clients) { try { c.kill(); } catch { /* gone */ } }
    spawnSync("tmux", ["-S", sock, "kill-server"], { timeout: 5000 });
    spawnSync("rm", ["-f", sock], { timeout: 5000 });
  }
}

test("live tmux (#1237): under a global detach-on-destroy off, source window death exits the viewer's attached client instead of moving it to another viewer", async (t) => {
  // An operator's `set -g detach-on-destroy off` makes tmux move a destroyed
  // session's client to another session (often another Desktop viewer): the
  // pty never exits and the tab shows another agent under the old name.
  // Retiring instA must exit viewer 1's client and leave viewer 2 and the
  // operator's global alone.
  await withTwoAttachedViewers(t, async ({ T, v1, v2, sleep, clientSessions, sessionExists }) => {
    T(["kill-window", "-t", "=src:=instA"]);                        // retire instA: viewer 1 is destroyed
    for (let i = 0; i < 50 && !v1.pty.exited; i++) await sleep(100);
    assert.ok(v1.pty.exited, "viewer 1's pty client exited (the tab shows session ended)");
    assert.equal(sessionExists(v1.viewer), false, "viewer 1's session is gone");
    assert.equal(T(["show-options", "-g", "detach-on-destroy"], true), "detach-on-destroy off", "the global option is untouched");
    assert.equal(v2.pty.exited, null, "viewer 2's pty client is still alive");
    assert.deepEqual(T(["list-windows", "-t", `=${v2.viewer}`, "-F", "#{window_name}"], true).split("\n"), ["instB"],
      "viewer 2 still lists only instB");
    assert.deepEqual(clientSessions(), [v2.viewer], "only viewer 2's own client remains: none was moved onto it");
  });
});

test("live tmux (#1237) control: without the viewer's own option, the global off moves the dying viewer's client to another session", async (t) => {
  // Proves the hazard the option guards against is real on this tmux, so the
  // test above is not passing vacuously: unset viewer 1's option (it then
  // inherits the global off) and the same retire moves its client to viewer 2.
  await withTwoAttachedViewers(t, async ({ T, v1, v2, sleep, clientSessions, sessionExists }) => {
    T(["set-option", "-u", "-t", v1.viewer, "detach-on-destroy"]);
    T(["kill-window", "-t", "=src:=instA"]);
    for (let i = 0; i < 50 && sessionExists(v1.viewer); i++) await sleep(100);
    assert.equal(sessionExists(v1.viewer), false, "viewer 1's session is gone");
    for (let i = 0; i < 10 && !v1.pty.exited; i++) await sleep(100);  // give a wrong exit time to show
    assert.equal(v1.pty.exited, null, "viewer 1's pty client did NOT exit");
    // tmux picks the target session (here viewer 2, the most recently active, or src): either way
    // the client lives on, showing another session under viewer 1's tab.
    const moved = clientSessions();
    assert.equal(moved.length, 2, "viewer 1's client is still attached");
    assert.ok(!moved.includes(v1.viewer), `viewer 1's client was moved to another session (${moved.join(", ")})`);
  });
});

test("live tmux (#520): a plain drag through an attached client selects in copy mode, and its release copies and sends OSC 52 to the client", async (t) => {
  const probe = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return t.skip("tmux not available");
  let ptyMod;
  try {
    ptyMod = createRequire(join(RENDERER_PKG, "package.json"))("node-pty");
    const probePty = ptyMod.spawn("true", [], { name: "xterm", cols: 10, rows: 5 });
    probePty.kill();
  } catch (error) {
    return t.skip(`node-pty can't spawn here (${String(error?.message || error).slice(0, 120)}): not built for this node ABI, `
      + "or its prebuilds/<platform>/spawn-helper is not executable (chmod +x it, or npm rebuild node-pty)");
  }
  const sock = `/tmp/oatsdrag-${process.pid}.sock`;
  const T = (args, out = false) => {
    const r = spawnSync("tmux", ["-S", sock, "-f", "/dev/null", ...args], { encoding: "utf8", timeout: 5000 });
    if (r.status !== 0) throw new Error(`tmux ${args.join(" ")} failed: ${r.stderr}`);
    return out ? r.stdout.trim() : undefined;
  };
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  let client = null;
  try {
    T(["new-session", "-d", "-s", "src", "-n", "instA", "-x", "80", "-y", "20", "printf 'alpha one\\nbravo two\\n'; sleep 60"]);
    await sleep(500);
    const r = openTerm({ session: "src", window: "instA" }, {
      preflight: (target) => T(["list-panes", "-t", target]),
      tmux: (args) => T(args), tmuxOut: (args) => T(args, true),
      spawnPty: (target, cols, rows) => ptyMod.spawn("tmux", ["-S", sock, "-f", "/dev/null", "attach-session", "-t", target], { name: "xterm-256color", cols, rows, env: process.env }),
    });
    client = r.pty;
    let seen = "";
    client.onData((d) => { seen += d; });
    await sleep(1200);
    // SGR mouse: press at the first row's first column, drag to the second row's end, release.
    client.write("\x1b[<0;1;1M"); await sleep(150);
    client.write("\x1b[<32;5;1M"); await sleep(150);
    client.write("\x1b[<32;10;2M"); await sleep(150);
    client.write("\x1b[<0;10;2m"); await sleep(800);
    const osc = /\x1b\]52;[^;]*;([A-Za-z0-9+/=]*)\x07/.exec(seen);
    assert.ok(osc, "the client received an OSC 52 copy");
    // The drag ends past the last character of "bravo two": tmux 3.7c (macOS) copies up to it, while the
    // Ubuntu CI's tmux also copies that line's end. Exactly one trailing newline is that difference; the
    // selected text itself must match exactly.
    const copied = Buffer.from(osc[1], "base64").toString("utf8");
    const version = spawnSync("tmux", ["-V"], { encoding: "utf8" }).stdout.trim();
    assert.equal(copied.endsWith("\n") ? copied.slice(0, -1) : copied, "alpha one\nbravo two", `the dragged lines (${version}, copied ${JSON.stringify(copied)})`);
    assert.equal(T(["display-message", "-p", "-t", r.viewer, "#{pane_in_mode}"], true), "0", "the copy left copy mode");
    client.kill(); client = null;
    r.killViewer();
  } finally {
    if (client) { try { client.kill(); } catch { /* gone */ } }
    spawnSync("tmux", ["-S", sock, "kill-server"], { timeout: 5000 });
    spawnSync("rm", ["-f", sock], { timeout: 5000 });
  }
});

// ── Slice G: resource containment end to end on an isolated live tmux ──────
// Human release blocker: dedupe by target + hard cap 6 + baseline-restoring
// cleanup, proven against REAL viewer sessions (no GUI). Uses an isolated
// tmux server (-S socket) so it never touches the operator's durable
// sessions and leaves ZERO residue.
test("live tmux: dedupe + cap 6 + baseline restoration on an isolated server", async (t) => {
  const probe = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return t.skip("tmux not available");
  const { createTerminalRegistry, terminalTargetKey } = await import("../packages/desktop/terminal-registry.mjs");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "oatsg-")), sock = join(dir, "s");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tx = (args, out = false) => {
    const r = spawnSync("tmux", ["-S", sock, ...args], { encoding: "utf8", timeout: 5000 });
    if (r.status !== 0 && !out) throw new Error(`tmux ${args.join(" ")}: ${r.stderr}`);
    return (r.stdout || "").trim();
  };
  const viewerCount = () => tx(["list-sessions", "-F", "#{session_name}"], true).split("\n").filter((s) => s.startsWith("oatsdesk-")).length;
  // Faithful main.mjs handler over REAL openTerm on the isolated server.
  const reg = createTerminalRegistry({ max: 6 });
  const ptys = new Map(); // id -> { key, killViewer }
  let nextId = 1, viewersCreated = 0;
  const io = {
    preflight: (target) => { const r = spawnSync("tmux", ["-S", sock, "list-panes", "-t", target], { timeout: 5000 }); if (r.status !== 0) throw new Error("no target"); },
    tmux: (args) => tx(args),
    tmuxOut: (args) => tx(args),
    spawnPty: (target) => ({ target }), // no real attach needed to prove the resource bound
  };
  const openHandler = (session, window) => {
    const key = terminalTargetKey(session, window);
    const plan = reg.plan(key);
    if (plan.action === "reuse") return { reused: true, id: plan.id };
    if (plan.action === "cap") return { capped: true, active: plan.active, max: plan.max };
    let r;
    try { r = openTerm({ session, window }, io); } catch (e) { return { error: String(e.message) }; }
    viewersCreated++;
    const id = nextId++;
    ptys.set(id, { key, killViewer: r.killViewer, viewer: r.viewer });
    reg.commit(key, id);
    return { id };
  };
  const closeHandler = (id) => { const t2 = ptys.get(id); if (!t2) return; try { t2.killViewer(); } catch {} ptys.delete(id); reg.release(id); };

  try {
    // one durable session with 8 windows = 8 distinct terminal targets
    tx(["new-session", "-d", "-s", "durable", "-n", "inst1", "sh"]);
    for (let i = 2; i <= 8; i++) tx(["new-window", "-t", "=durable", "-n", `inst${i}`, "sh"]);
    const baseline = viewerCount();
    assert.equal(baseline, 0, "no viewers at baseline");

    // dedupe: 50 opens of the SAME target → one viewer
    let firstId = null;
    for (let i = 0; i < 50; i++) {
      const r = openHandler("durable", "inst1");
      if (i === 0) firstId = r.id; else assert.equal(r.reused, true, "repeat open reuses");
    }
    assert.equal(viewerCount(), 1, "50 same-target opens created exactly one viewer session");

    // cap: fill to 6 distinct, 7th refused, no 7th viewer created
    for (let i = 2; i <= 6; i++) assert.ok(openHandler("durable", `inst${i}`).id !== undefined, `open inst${i}`);
    assert.equal(viewerCount(), 6, "six live viewers");
    const seventh = openHandler("durable", "inst7");
    assert.equal(seventh.capped, true, "7th refused");
    assert.equal(viewerCount(), 6, "no 7th viewer session was created on the tmux server");

    // close one → a slot frees → 7th now opens
    closeHandler(firstId);
    assert.equal(viewerCount(), 5, "closing a terminal killed exactly its viewer");
    assert.ok(openHandler("durable", "inst7").id !== undefined, "freed slot allows a new distinct open");
    assert.equal(viewerCount(), 6, "back at the cap");

    // baseline restoration: close all → ZERO viewers, durable windows survive
    for (const id of [...ptys.keys()]) closeHandler(id);
    assert.equal(viewerCount(), baseline, "all viewers cleaned up — baseline restored");
    assert.equal(reg.activeCount(), 0, "registry drained");
    const durableWins = tx(["list-windows", "-t", "=durable", "-F", "#{window_name}"], true).split("\n");
    assert.equal(durableWins.length, 8, "every durable window survived the viewer churn");
    assert.ok(viewersCreated >= 7, "the churn really created and tore down viewers");
  } finally {
    spawnSync("tmux", ["-S", sock, "kill-server"], { timeout: 5000 });
    spawnSync("rm", ["-f", sock], { timeout: 5000 });
  }
});
