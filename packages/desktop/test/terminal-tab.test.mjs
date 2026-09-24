// Shell-composition regressions for the terminal tab (review termlc2): the
// lifecycle-only tests pass even if the composition performs setup after
// `await start()` — these drive createTerminalTab, the exact code shell.mjs
// runs, with doubles for the preload bridge and xterm.
//   * close-during-pending: NO setup happens (no handlers, no observer, no
//     focus) and the late pty is detached;
//   * live path: every resource set up in onReady is disposed by close, and
//     setup strictly precedes teardown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createTerminalTab } from "../renderer/terminal-tab.mjs";
import { handle, opened, ready, confirmed } from './helpers/terminal-wire.mjs';
import { terminalFailure } from '../renderer/terminal-contract.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

function makeDoubles(openPromise) {
  const log = [];
  const doc = new JSDOM("<!doctype html><body></body>").window.document;
  const wrap = doc.createElement("div");
  doc.body.append(wrap);
  const desk = {
    termOpen: () => { log.push("open"); return openPromise.then(value => typeof value === 'number' ? opened(value) : value); },
    termReady: h => { log.push('ready'); return ready(h); },
    termClose: h => { log.push(`closePty:${h.id}`); return confirmed(h); },
    termWrite: () => log.push("write"),
    termResize: () => log.push("resize"),
    onTermData: () => { log.push("onData+"); return () => log.push("onData-"); },
    onTermExit: () => { log.push("onExit+"); return () => log.push("onExit-"); },
  };
  const term = {
    cols: 80, rows: 24,
    onData: () => log.push("term.onData"),
    onResize: () => log.push("term.onResize"),
    focus: () => log.push("focus"),
    dispose: () => log.push("term.dispose"),
    write: () => {},
  };
  return { log, wrap, desk, term };
}

const mk = (d, extra = {}) => createTerminalTab({
  desk: d.desk, term: d.term, tmux: { session: "s", window: 1 }, wrap: d.wrap,
  isActive: () => true, ownsFocus: () => true, fit: () => {},
  observe: () => { d.log.push("observe+"); return () => d.log.push("observe-"); },
  onError: () => {},
  ...extra,
});

test("terminal tab forwards the instance's saved socket to the privileged bridge", async () => {
  const d = makeDoubles(Promise.resolve(7));
  let spec;
  d.desk.termOpen = async (value) => { spec = value; return opened(7); };
  const tab = mk(d, { tmux: { session: "team", window: "minerva", socket: "/saved/socket" } });
  await tab.start();
  assert.equal(spec.socket, "/saved/socket");
  assert.equal(spec.session, "team");
  assert.equal(spec.window, "minerva");
  await tab.close();
});

test("close during pending open: no setup at all, late pty detached, UI disposed once", async () => {
  const gate = deferred();
  const d = makeDoubles(gate.promise);
  const tab = mk(d);
  const starting = tab.start();
  const closing = tab.close();          // close while termOpen is pending
  gate.resolve(42);                     // pty materializes late
  await starting;
  await closing;
  assert.deepEqual(d.log, ["open", "closePty:42", "term.dispose"],
    "no handlers/observer/focus on a closed tab; late pty detached; single teardown");
  assert.equal(d.wrap.querySelector(".term-banner"), null, "no banner on a closed tab");
});

test("live path: setup in onReady, close disposes every resource, setup precedes teardown", async () => {
  const d = makeDoubles(Promise.resolve(7));
  const tab = mk(d);
  await tab.start();
  const setupEnd = d.log.length;
  assert.deepEqual(d.log.slice(0, setupEnd),
    ["open", "onData+", "onExit+", "term.onData", "term.onResize", "observe+", "ready", "resize", "focus"],
    "all setup inside onReady, in order");
  await tab.close();
  assert.deepEqual(d.log.slice(setupEnd),
    ["onData-", "onExit-", "observe-", "term.dispose", "closePty:7"].sort((a, b) =>
      d.log.slice(setupEnd).indexOf(a) - d.log.slice(setupEnd).indexOf(b)),
    "teardown disposes exactly the resources setup created");
  // every '+' has its '-' and teardown comes strictly after setup
  for (const r of ["onData", "onExit", "observe"]) {
    assert.ok(d.log.indexOf(`${r}+`) < d.log.indexOf(`${r}-`), `${r}: setup before teardown`);
  }
});

test("open rejection on a live tab shows the banner and close stays safe", async () => {
  const gate = deferred();
  const d = makeDoubles(gate.promise);
  const tab = mk(d);
  const starting = tab.start();
  gate.reject(new Error("attach failed"));
  await starting;
  const banner = d.wrap.querySelector(".term-banner");
  assert.ok(banner && /Could not attach/.test(banner.textContent), "safe error banner rendered");
  assert.ok(!banner.textContent.includes('attach failed'), 'raw error withheld');
  await tab.close();                    // no pty to detach; UI still disposed
  assert.ok(d.log.includes("term.dispose"));
  assert.ok(!d.log.some((l) => l.startsWith("closePty")), "no pty was created");
});

test("session-ended (pty exit) then close: banner shown, no double-kill", async () => {
  const d = makeDoubles(Promise.resolve(9));
  let exitCb;
  d.desk.onTermExit = (_id, cb) => { exitCb = cb; d.log.push("onExit+"); return () => d.log.push("onExit-"); };
  const tab = mk(d);
  await tab.start();
  exitCb({ terminalApi: 2, status: 'ended', handle: handle(9), cleanupPending: false }); // confirmed cleanup
  assert.ok(/session ended/.test(d.wrap.querySelector(".term-banner")?.textContent || ""));
  await tab.close();
  assert.ok(!d.log.some((l) => l.startsWith("closePty")), "forget() prevented a double-kill");
});

// Private wire2 only. Numeric values in makeDoubles are synthetic producer IDs,
// translated by the fixture into leased results, never a production fallback.
test("term:open wire2 resolves to a copied lease (attach proceeds)", async () => {
  const d = makeDoubles(Promise.resolve(opened(7)));
  const tab = mk(d);
  await tab.start();
  assert.ok(d.log.includes("focus"), "onReady ran → attach proceeded with the unwrapped id");
  assert.ok(!d.wrap.querySelector(".term-banner"), "no error banner on success");
  await tab.close();
  assert.ok(d.log.includes("closePty:7"), "the unwrapped id is what gets closed");
});

test("term:open reuse is not a second lease acquisition; its close never detaches the existing view", async () => {
  const d = makeDoubles(Promise.resolve({ ...opened(3), status: 'reused' }));
  const tab = mk(d);
  await tab.start();
  const banner = d.wrap.querySelector(".term-banner");
  assert.ok(banner && /already open/i.test(banner.textContent), `reused banner (got: ${banner?.textContent})`);
  assert.ok(!d.log.includes("focus"), "no attach for a reused target");
  await tab.close();
});

test("term:open typed cap → actionable safe failure", async () => {
  const d = makeDoubles(Promise.resolve(terminalFailure('E_TERM_CAP')));
  const tab = mk(d);
  await tab.start();
  const banner = d.wrap.querySelector(".term-banner");
  assert.ok(banner && /Terminal limit reached/.test(banner.textContent), `cap banner (got: ${banner?.textContent})`);
  assert.ok(/Close a terminal first/.test(banner.textContent), "actionable guidance present");
  assert.ok(!d.log.includes("focus"), "no attach when capped");
  await tab.close();
});

test("term:open typed failure → safe literal message, no attach", async () => {
  const d = makeDoubles(Promise.resolve(terminalFailure('E_TERM_OPEN_FAILED')));
  const tab = mk(d);
  await tab.start();
  const banner = d.wrap.querySelector(".term-banner");
  assert.ok(banner && /Could not attach/.test(banner.textContent), `error banner (got: ${banner?.textContent})`);
  assert.ok(!d.log.includes("focus"), "no attach on error");
  await tab.close();
});

test('wire2 has no numeric or old-object fallback', async () => {
  for (const value of [7, { id: 7 }, { reused: true, id: 7 }]) {
    const d = makeDoubles(Promise.resolve(7)); d.desk.termOpen = async () => value;
    const tab = mk(d); await tab.start();
    assert.ok(!d.log.includes('onData+')); assert.ok(!d.log.includes('focus')); await tab.close();
    assert.ok(!d.log.some(value => value.startsWith('closePty')));
  }
});

test('pending close remains literal and undisposed; input is disabled and an explicit retry can confirm', async () => {
  const d = makeDoubles(Promise.resolve(12)); let attempts = 0, input;
  d.term.onData = cb => { input = cb; };
  d.desk.termClose = h => ++attempts === 1 ? terminalFailure('E_TERM_CLOSE_PENDING') : confirmed(h);
  const tab = mk(d); await tab.start();
  assert.equal((await tab.close()).ok, false);
  assert.equal(d.wrap.querySelector('.term-banner').textContent, 'closing… not yet confirmed');
  assert.ok(!d.log.includes('term.dispose')); input('must not write'); assert.ok(!d.log.includes('write'));
  assert.equal((await tab.close()).ok, true); assert.equal(d.log.filter(v => v === 'term.dispose').length, 1);
});

test('ready timeout is a retained literal failed view, not healthy; listeners precede acknowledgment', async () => {
  const d = makeDoubles(Promise.resolve(13));
  d.desk.termReady = () => {
    assert.ok(d.log.includes('onData+')); assert.ok(d.log.includes('onExit+'));
    return terminalFailure('E_TERM_READY_TIMEOUT');
  };
  const tab = mk(d); await tab.start();
  assert.equal(d.wrap.querySelector('.term-banner').textContent, 'terminal did not become ready; closed');
  assert.ok(!d.log.includes('focus')); assert.ok(!d.log.includes('term.dispose'));
  await tab.close(); assert.ok(d.log.includes('term.dispose'));
});

test('exit while ready acknowledgment is pending never restores healthy input or focus', async () => {
  const d = makeDoubles(Promise.resolve(14)), gate = deferred(); let exit;
  d.desk.onTermExit = (_h, cb) => { exit = cb; return () => {}; };
  d.desk.termReady = () => gate.promise;
  const tab = mk(d), starting = tab.start();
  await new Promise(setImmediate);
  exit({ terminalApi: 2, handle: handle(14), status: 'ended', cleanupPending: false });
  gate.resolve(ready(handle(14))); await starting;
  assert.ok(!d.log.includes('focus')); assert.match(d.wrap.querySelector('.term-banner').textContent, /session ended/);
  await tab.close(); assert.ok(!d.log.includes('closePty:14'));
});

// ── Shift+Enter → newline (chat-input fix) ────────────────────────────────
// xterm emits a plain \r for Enter with or without Shift, so the modifier
// never reaches tmux/pi. The composition installs a custom key handler that
// translates Shift+Enter into a raw \n (pi's Ctrl+J newline alias) and
// suppresses the default \r. xterm invokes the handler for keydown,
// keypress AND keyup of the same press — suppressing only keydown leaks a
// \r through the keypress path, which SENT the message right after the
// newline (the v0.18.4 field failure). These drive the pure classifier AND
// the wired handler behavior — a regression that keeps the classifier but
// forgets to suppress the default (returning true) would send anyway.
import { shiftEnterAction } from "../renderer/terminal-tab.mjs";

test("shiftEnterAction: Shift+Enter suppresses every event; \\n only on keydown", () => {
  const ev = (o) => ({ type: "keydown", key: "Enter", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...o });
  assert.deepEqual(shiftEnterAction(ev({ shiftKey: true })), { suppress: true, byte: "\n" });
  assert.deepEqual(shiftEnterAction(ev({ shiftKey: true, type: "keypress" })), { suppress: true, byte: null }, "keypress suppressed, no second write");
  assert.deepEqual(shiftEnterAction(ev({ shiftKey: true, type: "keyup" })), { suppress: true, byte: null }, "keyup suppressed, no write");
  assert.deepEqual(shiftEnterAction(ev({})), { suppress: false, byte: null }, "plain Enter untouched (still sends)");
  assert.deepEqual(shiftEnterAction(ev({ shiftKey: true, ctrlKey: true })), { suppress: false, byte: null }, "extra modifiers pass through");
  assert.deepEqual(shiftEnterAction(ev({ shiftKey: true, metaKey: true })), { suppress: false, byte: null });
  assert.deepEqual(shiftEnterAction(ev({ shiftKey: true, altKey: true })), { suppress: false, byte: null });
  assert.deepEqual(shiftEnterAction(ev({ key: "a", shiftKey: true })), { suppress: false, byte: null }, "shifted letters untouched");
});

test("custom key handler: Shift+Enter writes \\n once and suppresses keydown, keypress and keyup", async () => {
  const d = makeDoubles(Promise.resolve(5));
  let handler = null;
  const writes = [];
  d.term.attachCustomKeyEventHandler = (h) => { handler = h; };
  d.desk.termWrite = (id, data) => writes.push([id, data]);
  const tab = mk(d);
  await tab.start();
  assert.equal(typeof handler, "function", "handler installed during onReady");
  const ev = (o) => ({ type: "keydown", key: "Enter", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...o });
  assert.equal(handler(ev({ shiftKey: true })), false, "keydown suppressed (default \\r blocked)");
  assert.deepEqual(writes, [[handle(5), "\n"]], "newline byte written with the original lease");
  assert.equal(handler(ev({ shiftKey: true, type: "keypress" })), false, "keypress suppressed — the \\r leak that SENT the message");
  assert.equal(handler(ev({ shiftKey: true, type: "keyup" })), false, "keyup suppressed");
  assert.deepEqual(writes, [[handle(5), "\n"]], "exactly one write for the whole chord");
  assert.equal(handler(ev({})), true, "plain Enter left to xterm (message sends)");
  assert.equal(writes.length, 1, "no extra writes for pass-through keys");
  await tab.close();
  writes.length = 0;
  assert.equal(handler(ev({ shiftKey: true })), false);
  assert.deepEqual(writes, [], "no write after the pty is gone");
});

// ── Option+drag local selection (copy fix) ────────────────────────────────
// The viewer tmux session runs `mouse on`, so tmux consumes plain drags and
// xterm never builds a local selection — copy from a terminal looked broken.
// terminalOptions() must force macOptionClickForcesSelection on, and
// shell.mjs must actually construct its Terminal through terminalOptions
// (an inline options object would silently drop the invariant).
import { terminalOptions } from "../renderer/terminal-tab.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

test("terminalOptions: forces Option+drag local selection and carries typography/theme", () => {
  const o = terminalOptions({ fontSize: 13, fontFamily: "mono", theme: { background: "#000" } });
  assert.equal(o.macOptionClickForcesSelection, true, "Option+drag must force a LOCAL xterm selection (tmux mouse-on eats plain drags)");
  assert.equal(o.scrollback, 5000);
  assert.equal(o.fontSize, 13);
  assert.equal(o.fontFamily, "mono");
  assert.deepEqual(o.theme, { background: "#000" });
});

test("shell.mjs constructs its Terminal through terminalOptions", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "..", "renderer", "shell.mjs"), "utf8");
  assert.match(src, /new Terminal\(terminalOptions\(/, "shell must build xterm options via terminalOptions()");
});

// ── shortcut interception before the pty (review d64daeb important) ──────
// xterm's capture-phase textarea handler consumes allowlisted chords (e.g.
// Ctrl+K) — preventDefault + stopPropagation — so the shell's bubble-phase
// window listener NEVER sees them and a control byte goes to the attached
// program instead. The composition's interceptKey hook runs inside xterm's
// custom key handler (before any pty write): a claimed chord is suppressed
// for every phase and its byte never reaches the pty.
import { terminalKeyDecision } from "../renderer/terminal-tab.mjs";

test("terminalKeyDecision: Shift+Enter wins, then interception, else pass-through", () => {
  const ev = (o) => ({ type: "keydown", key: "k", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...o });
  // Shift+Enter translation takes precedence and carries its byte
  assert.deepEqual(terminalKeyDecision(ev({ key: "Enter", shiftKey: true }), () => true), { handled: true, byte: "\n" });
  // intercepted chord: handled, no byte
  assert.deepEqual(terminalKeyDecision(ev({ ctrlKey: true }), () => true), { handled: true, byte: null });
  // not intercepted: xterm processes normally
  assert.deepEqual(terminalKeyDecision(ev({ ctrlKey: true }), () => false), { handled: false, byte: null });
  assert.deepEqual(terminalKeyDecision(ev({}), undefined), { handled: false, byte: null }, "no hook, no claim");
});

test("wired handler: an intercepted chord is suppressed in every phase and writes nothing to the pty", async () => {
  const d = makeDoubles(Promise.resolve(9));
  let handler = null;
  const writes = [];
  const intercepted = [];
  d.term.attachCustomKeyEventHandler = (h) => { handler = h; };
  d.desk.termWrite = (id, data) => writes.push([id, data]);
  // stand-in for the engine's terminal-allowlist match: claims Ctrl+K
  const interceptKey = (ev) => {
    const hit = ev.key === "k" && ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey;
    if (hit && ev.type === "keydown") intercepted.push(ev.type);
    return hit;
  };
  const tab = mk(d, { interceptKey });
  await tab.start();
  const ev = (o) => ({ type: "keydown", key: "k", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...o });
  assert.equal(handler(ev({ ctrlKey: true })), false, "keydown claimed — xterm must not write the control byte");
  assert.equal(handler(ev({ ctrlKey: true, type: "keypress" })), false, "keypress claimed too (no byte leak)");
  assert.equal(handler(ev({ ctrlKey: true, type: "keyup" })), false, "keyup claimed");
  assert.deepEqual(writes, [], "nothing written to the pty for an intercepted chord");
  assert.deepEqual(intercepted, ["keydown"], "action dispatch observed once, on keydown");
  assert.equal(handler(ev({})), true, "plain k left to xterm (types into the terminal)");
  assert.equal(handler(ev({ key: "Enter", shiftKey: true })), false, "Shift+Enter still composes");
  assert.deepEqual(writes, [[handle(9), "\n"]], "Shift+Enter newline still written");
  await tab.close();
});

test("shell wires interceptKey through the engine's terminal policy", () => {
  const here2 = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here2, "..", "renderer", "shell.mjs"), "utf8");
  assert.match(src, /interceptKey: \(ev\) => \{/, "shell provides the interception hook");
  assert.match(src, /matchEvent\(ev, \{ insideTerminal: true \}\)/, "hook consults the engine allowlist");
  assert.match(src, /if \(ev\.type === "keydown"\) handleKeydown\(ev, \{ insideTerminal: true \}\)/, "action runs once, on keydown");
});

test("readiness focus fails closed without an explicit owner, while attachment setup is retained", async () => {
  const d = makeDoubles(Promise.resolve(8));
  const tab = mk(d, { ownsFocus: undefined });
  await tab.start(); tab.focus();
  assert.ok(d.log.includes("onData+")); assert.ok(d.log.includes("observe+"));
  assert.ok(!d.log.includes("focus"));
  await tab.close();
  tab.focus();
  assert.ok(!d.log.includes("focus"), "closed input cannot be focused");
  assert.equal(d.log.filter(x => x === "closePty:8").length, 1);
});

test("losing intent does not dispose a pending attachment; subsequent explicit intent may focus it", async () => {
  const gate = deferred(), d = makeDoubles(gate.promise);
  let owns = true;
  const tab = mk(d, { ownsFocus: () => owns });
  const pending = tab.start();
  tab.focus(); assert.ok(!d.log.includes("focus"), "pending focus waits for readiness");
  owns = false;
  gate.resolve(9); await pending;
  assert.ok(!d.log.includes("focus"));
  assert.ok(!d.log.includes("term.dispose"));
  owns = true; tab.focus();
  assert.equal(d.log.filter(x => x === "focus").length, 1);
  await tab.close(); tab.focus();
  assert.equal(d.log.filter(x => x === "focus").length, 1, "closed input stays unfocused even with an owner");
});
