// Lost sessions resumed when Desktop opens, the renderer's side (resume-notice.mjs): the launch's notice (taken at
// start and on each ready event, decoded at the boundary, posted once, sticky and the app's own, its detail as text
// in the real notification center) and the preference (the toggle through main, a failed read or write keeping the
// stored state with its notice, the palette's On/Off detail read as it opens). shell.mjs's wiring is a source check.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createResumeNotice, createResumePreference, resumePaletteCommand, RESUME_PREFERENCE_FAILED, RESUME_PREFERENCE_LABEL, RESUME_PREFERENCE_ACTION }
  from "../renderer/resume-notice.mjs";
import { createNotificationCenter } from "../renderer/notifications.mjs";
import { readResumeSweep } from "../../client/session-resume.mjs";
import { createPalette } from "../renderer/palette.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((y, n) => { resolve = y; reject = n; }); return { promise, resolve, reject }; }
const HOSTILE = "<img src=x onerror=evil()>";
/** A summary as main hands it over: one resumed and one refused row, the refusal's kernel message HTML-looking. */
function summaryOf(rows = [
  { deployment: "/home/ana/work/oats", instance: "writer", home: "/h/w", outcome: "resumed" },
  { deployment: "/home/ana/other", instance: "reviewer", home: "/h/r", outcome: "refused", reason: "start-refused", code: "E_X", message: HOSTILE },
]) {
  const read = readResumeSweep({ schemaVersion: 1, ok: true, result: { schemaVersion: 1, plan: false, deployments: [], rows } });
  assert.equal(read.kind, "notice");
  return read.summary;
}
/** A bridge whose take answers from `answers` in turn (then null), with the ready event's subscription. */
function bridge(answers) {
  const queue = [...answers];
  const desk = { takes: 0, ready: null, unsubscribed: 0,
    takeResumeNotice() { desk.takes++; const next = queue.length ? queue.shift() : null; return typeof next === "function" ? next() : Promise.resolve(next); },
    onResumeNoticeReady(cb) { desk.ready = cb; return () => { desk.unsubscribed++; desk.ready = null; }; } };
  return desk;
}
function center(t) {
  const dom = new JSDOM("<!doctype html><body></body>"); t.after(() => dom.window.close());
  let gen = 0, switched;
  const c = createNotificationCenter({ document: dom.window.document, generation: () => gen, subscribe: (fn) => { switched = fn; return () => {}; } });
  t.after(() => c.dispose());
  return { doc: dom.window.document, center: c, visit: () => { gen++; switched(); } };
}

test("the notice: taken at start and on each ready event, posted once, sticky and the app's own, its detail as text", async (t) => {
  const u = center(t), posts = [];
  const desk = bridge([null, summaryOf()]);
  const notify = (message, options) => { posts.push([message, options]); return u.center.notify(message, options); };
  const notice = createResumeNotice({ desk, notify });
  notice.start(); await tick();
  assert.equal(desk.takes, 1, "asked once at start"); assert.equal(typeof desk.ready, "function", "and listens for the ready event");
  assert.deepEqual(posts, [], "a null answer (no summary yet) posts nothing");
  desk.ready(); await tick();
  assert.equal(desk.takes, 2);
  assert.equal(posts.length, 1, "posted once");
  const [message, options] = posts[0];
  assert.equal(message, "OATS resumed 1 instance whose session was lost. 1 could not be resumed.");
  assert.deepEqual(Object.keys(options).sort(), ["app", "detail", "sticky"], "no buttons, no descriptor");
  assert.equal(options.sticky, true); assert.equal(options.app, true);
  // The deployment label is shortPath's /home/<name> guess (the renderer has no home directory).
  assert.equal(options.detail, `reviewer in ~/other: could not be resumed.\nOATS says: ${HOSTILE}\nwriter in ~/work/oats: resumed in its own conversation.`);
  assert.equal(u.doc.querySelector(".app-toast-text").textContent, message);
  assert.equal(u.doc.querySelector(".app-toast-detail").textContent, options.detail, "the center shows the detail as text");
  assert.equal(u.doc.querySelector(".app-toast img, .app-toast script"), null, "never as HTML");
  desk.ready(); await tick();
  assert.equal(posts.length, 1, "a later take (null: taken already) posts nothing");
  // The app's own: a workspace switch keeps it.
  u.visit(); assert.equal(u.doc.querySelectorAll(".app-toast").length, 1);
  notice.dispose(); assert.equal(desk.unsubscribed, 1, "dispose stops listening");
});

test("the notice: an answer that does not decode, a rejected or throwing take, or no bridge shows nothing", async (t) => {
  const posts = [], notify = (...args) => { posts.push(args); return true; };
  const decoded = summaryOf();
  for (const answer of [undefined, {}, "summary", { ...decoded, extra: 1 }, { ...decoded, totals: { resumed: 0, fresh: 0, waiting: 0, refused: 0 } },
    () => Promise.reject(new Error("ipc")), () => { throw new Error("sync"); }]) {
    const desk = bridge([answer]);
    const notice = createResumeNotice({ desk, notify }); notice.start(); await tick(); notice.dispose();
    assert.equal(desk.takes, 1);
  }
  assert.deepEqual(posts, [], "nothing posted, nothing thrown");
  for (const desk of [undefined, null, {}, { onResumeNoticeReady: () => assert.fail("no take, no listener") }]) {
    const notice = createResumeNotice({ desk, notify }); notice.start(); notice.dispose();
  }
  // A take still in flight when the window goes is not posted.
  const late = deferred(), desk = bridge([() => late.promise]);
  const notice = createResumeNotice({ desk, notify }); notice.start(); notice.dispose();
  late.resolve(decoded); await tick();
  assert.deepEqual(posts, []);
});

/** A preference bridge: `stored` is main's file; reads and writes answer through the given hooks. */
function preferenceBridge({ stored = true, read, write } = {}) {
  const desk = { stored, reads: 0, writes: [],
    resumeAtLaunch() { desk.reads++; return read ? read(desk) : Promise.resolve({ resumeAtLaunch: desk.stored }); },
    setResumeAtLaunch(value) { desk.writes.push(value); if (write) return write(desk, value); desk.stored = value; return Promise.resolve({ ok: true, resumeAtLaunch: value }); } };
  return desk;
}

test("the preference: its action and words; toggle reads main's value and writes its opposite, one toggle at a time", async () => {
  assert.equal(RESUME_PREFERENCE_ACTION, "app.resumeAtLaunch");
  assert.equal(RESUME_PREFERENCE_LABEL, "Resume lost sessions when Desktop opens");
  assert.equal(RESUME_PREFERENCE_FAILED, "The preference could not be saved.");
  const notices = [], desk = preferenceBridge({ stored: true });
  const pref = createResumePreference({ desk, notify: (text) => notices.push(text) });
  assert.equal(await pref.read(), true, "read asks main");
  await pref.toggle();
  assert.deepEqual(desk.writes, [false]); assert.equal(desk.stored, false);
  assert.equal(pref.detail(), "Off", "the shell holds the value it wrote");
  await Promise.all([pref.toggle(), pref.toggle()]);
  assert.deepEqual(desk.writes, [false, true, false], "two toggles in a row: each reads after the last write");
  assert.equal(pref.detail(), "Off");
  assert.deepEqual(notices, [], "a saved preference says nothing");
});

test("the preference: a failed write (rejection or ok:false) or an unreadable value keeps the stored state and says so, non-sticky", async () => {
  for (const [name, hooks] of [
    ["a rejected write", { write: () => Promise.reject(new Error("ipc")) }],
    ["E_PREFERENCE_WRITE", { write: () => Promise.resolve({ ok: false, code: "E_PREFERENCE_WRITE" }) }],
    ["E_BAD_ARGS", { write: () => Promise.resolve({ ok: false, code: "E_BAD_ARGS" }) }],
    ["a malformed answer", { write: () => Promise.resolve(null) }],
  ]) {
    const notices = [], desk = preferenceBridge({ stored: true, ...hooks });
    const pref = createResumePreference({ desk, notify: (...args) => notices.push(args) });
    await pref.toggle();
    assert.deepEqual(desk.writes, [false], name); assert.equal(desk.stored, true, `${name}: the old state stays`);
    assert.deepEqual(notices, [["The preference could not be saved."]], `${name}: one notice, no options (non-sticky)`);
    assert.equal(await pref.read(), true);
  }
  for (const read of [() => Promise.reject(new Error("ipc")), () => Promise.resolve({}), () => Promise.resolve({ resumeAtLaunch: "true" })]) {
    const notices = [], desk = preferenceBridge({ read });
    const pref = createResumePreference({ desk, notify: (text) => notices.push(text) });
    assert.equal(await pref.read(), null, "an unreadable value is null, never a rejection");
    await pref.toggle();
    assert.deepEqual(desk.writes, [], "nothing is written without the current value");
    assert.deepEqual(notices, ["The preference could not be saved."]);
  }
  const notices = [], pref = createResumePreference({ desk: undefined, notify: (text) => notices.push(text) });
  assert.equal(await pref.read(), null); await pref.toggle(); assert.deepEqual(notices, ["The preference could not be saved."], "no bridge: said too");
});

test("the palette's detail: On / Off as read when it opens, '' until it lands or when it fails; a later read or a toggle supersedes", async () => {
  const pending = [], desk = preferenceBridge({ read: () => { const d = deferred(); pending.push(d); return d.promise; } });
  const pref = createResumePreference({ desk, notify: () => {} });
  assert.equal(pref.detail(), "", "nothing read yet");
  pref.refresh(); assert.equal(pref.detail(), "", "until the read lands");
  pending[0].resolve({ resumeAtLaunch: true }); await tick();
  assert.equal(pref.detail(), "On");
  pref.refresh(); assert.equal(pref.detail(), "", "each opening reads again: no long-lived copy");
  pending[1].resolve({ resumeAtLaunch: false }); await tick();
  assert.equal(pref.detail(), "Off");
  pref.refresh(); pref.refresh();
  pending[3].resolve({ resumeAtLaunch: true }); await tick();
  pending[2].resolve({ resumeAtLaunch: false }); await tick();
  assert.equal(pref.detail(), "On", "an earlier opening's late answer never paints over the latest");
  pref.refresh(); pending[4].reject(new Error("ipc")); await tick();
  assert.equal(pref.detail(), "", "a failed read shows nothing");
  // A toggle completing after a read was sent: the toggle's written value stands.
  pref.refresh();
  const toggled = pref.toggle(); await tick();
  pending[6].resolve({ resumeAtLaunch: true }); await toggled; // the toggle's own read: on, so it writes off
  assert.deepEqual(desk.writes, [false]);
  pending[5].resolve({ resumeAtLaunch: true }); await tick();
  assert.equal(pref.detail(), "Off", "the palette read sent before the write landed does not paint over it");
});

test("the real palette: a detail that lands after the instances is shown; the entry returns focus where the palette opened", async (t) => {
  const dom = new JSDOM('<!doctype html><body><button id="origin">Origin</button></body>'); t.after(() => dom.window.close());
  const doc = dom.window.document, notices = [];
  const reads = [], desk = preferenceBridge({ stored: true, read: () => { const d = deferred(); reads.push(d); return d.promise; },
    write: (bridge, value) => (value === "fail" ? Promise.reject(new Error("x")) : (bridge.stored = value, Promise.resolve({ ok: !bridge.failWrite, resumeAtLaunch: value }))) });
  const pref = createResumePreference({ desk, notify: (text) => notices.push(text) });
  // The shell's shapes: the instances answer at once (a window choosing a workspace), the preference later.
  const palette = createPalette({ doc, loadInstances: () => pref.alongside(async () => ({ instances: [], deployments: [] })),
    commands: [resumePaletteCommand({ doc, preference: () => pref, run: () => pref.toggle() })] });
  const detail = () => doc.querySelector(".pdetail")?.textContent;
  const origin = doc.getElementById("origin");
  for (const [stored, shown, failWrite] of [[true, "On", false], [false, "Off", true]]) {
    desk.stored = stored; desk.failWrite = failWrite; notices.length = 0;
    origin.focus();
    const opened = palette.open(); await tick();
    reads.at(-1).resolve({ resumeAtLaunch: stored }); await opened; await tick();
    assert.equal(detail(), shown, "the read landed after the instances, and the palette shows it");
    doc.querySelector(".palette-item").click(); await tick();
    assert.equal(doc.activeElement, origin, "focus is back where the palette was opened");
    reads.at(-1).resolve({ resumeAtLaunch: stored }); await tick(); await tick();
    assert.equal(doc.activeElement, origin, "and stays there once the write has answered");
    assert.deepEqual(notices, failWrite ? [RESUME_PREFERENCE_FAILED] : [], failWrite ? "a failed write says so" : "a saved write says nothing");
  }
  assert.deepEqual(desk.writes, [false, true]);
});

test("shell.mjs wires both: the notice at start with its pagehide, the action, the menu's read, the palette entry and its read at open", () => {
  const shell = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
  assert.match(shell, /^import \{ createResumeNotice, createResumePreference, resumePaletteCommand \} from "\.\/resume-notice\.mjs";$/m);
  assert.match(shell, /^const resumePreference = createResumePreference\(\{ desk, notify: \(text\) => notifications\.notify\(text\) \}\);$/m);
  assert.match(shell, /^const resumeLaunchNotice = createResumeNotice\(\{ desk, notify: notifications\.notify \}\);\nresumeLaunchNotice\.start\(\);\nwindow\.addEventListener\("pagehide", \(\) => resumeLaunchNotice\.dispose\(\), \{ once: true \}\);$/m);
  assert.match(shell, /^registerAction\(\{ id: "app\.resumeAtLaunch", label: "Resume lost sessions when Desktop opens", context: "global", run: \(\) => resumePreference\.toggle\(\) \}\);$/m);
  assert.match(shell, /readChecked: \(id\) => \(id === "app\.resumeAtLaunch" \? resumePreference\.read\(\) : null\),/);
  assert.match(shell, /^    resumePaletteCommand\(\{ doc: document, preference: \(\) => resumePreference, run: \(\) => runAction\("app\.resumeAtLaunch"\) \}\),$/m);
  // The read starts as the palette opens, beside its instance load, and the load ends when both have.
  assert.match(shell, /^  loadInstances: \(\) => resumePreference\.alongside\(async \(\) => \{\n    if \(windowState\(\) === "choosing"\)/m);
  // Declared after every top-level await, so nothing calls them before they exist.
  assert.ok(shell.indexOf("const resumePreference =") > shell.lastIndexOf("\nawait "), "after the shell's top-level awaits");
});
