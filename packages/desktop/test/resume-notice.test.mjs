// Lost sessions resumed, the renderer's side (resume-notice.mjs): main's queued summaries, taken as an array at start
// and on each ready event, each decoded at the boundary (one that does not decode skipped, at most 10 read) and
// posted in order as its own sticky `app` notice of the `session-resume` group, its detail as text; in the real
// notification center more than three collapse into one group that a workspace switch keeps. shell.mjs's wiring is a
// source check.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createResumeNotice, RESUME_NOTICE_TAKE, RESUME_NOTICE_GROUP } from "../renderer/resume-notice.mjs";
import { createNotificationCenter } from "../renderer/notifications.mjs";
import { readResumeSweep, REFUSED_REASONS } from "../../client/session-resume.mjs";
import { refusedRow, resumedRow, sweepAnswer } from "./helpers/resume-sweep.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((y, n) => { resolve = y; reject = n; }); return { promise, resolve, reject }; }
const HOSTILE = "<img src=x onerror=evil()>";
/** A summary as main hands it over: one resumed and one refused row, the refusal's kernel message HTML-looking. */
function summaryOf(rows = [
  resumedRow("writer", { deployment: "/home/ana/work/oats" }),
  refusedRow("reviewer", { deployment: "/home/ana/other", reason: REFUSED_REASONS[0], code: "E_X", message: HOSTILE }),
]) {
  const read = readResumeSweep(sweepAnswer(rows));
  assert.equal(read.kind, "notice");
  return read.summary;
}
/** One sweep's summary: `instance` resumed, in its only deployment. */
const resumedOne = (instance) => summaryOf([resumedRow(instance, { deployment: "/home/ana/work/oats" })]);
const ONE = "OATS resumed 1 instance whose session was lost.";
const detailOf = (instance) => `${instance}: resumed in its own conversation.`; // one deployment: no "in …"
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

test("the notices: taken at start and on each ready event; each summary posted, oldest first, sticky, the app's own and grouped, its detail as text", async (t) => {
  const u = center(t), posts = [];
  const desk = bridge([[], [summaryOf(), resumedOne("second")]]);
  const notify = (message, options) => { posts.push([message, options]); return u.center.notify(message, options); };
  const notice = createResumeNotice({ desk, notify });
  notice.start(); await tick();
  assert.equal(desk.takes, 1, "asked once at start"); assert.equal(typeof desk.ready, "function", "and listens for the ready event");
  assert.deepEqual(posts, [], "an empty queue posts nothing");
  desk.ready(); await tick();
  assert.equal(desk.takes, 2);
  assert.deepEqual(posts.map(([message]) => message), ["OATS resumed 1 instance whose session was lost. 1 could not be resumed.", ONE], "each its own notice, in the queue's order");
  for (const [, options] of posts) {
    assert.deepEqual(Object.keys(options).sort(), ["app", "detail", "group", "groupLabel", "sticky"], "no buttons, no descriptor");
    assert.equal(options.sticky, true); assert.equal(options.app, true);
    assert.equal(options.group, "session-resume"); assert.equal(RESUME_NOTICE_GROUP, "session-resume");
    assert.equal(options.groupLabel(4), "4 notices about resumed sessions");
  }
  // The deployment label is shortPath's /home/<name> guess (the renderer has no home directory).
  assert.equal(posts[0][1].detail, `reviewer in ~/other: could not be resumed.\nOATS says: ${HOSTILE}\nwriter in ~/work/oats: resumed in its own conversation.`);
  assert.equal(posts[1][1].detail, detailOf("second"));
  assert.deepEqual([...u.doc.querySelectorAll(".app-toast-text")].map((el) => el.textContent), posts.map(([message]) => message));
  assert.equal(u.doc.querySelector(".app-toast-detail").textContent, posts[0][1].detail, "the center shows the detail as text");
  assert.equal(u.doc.querySelector(".app-toast img, .app-toast script"), null, "never as HTML");
  desk.ready(); await tick();
  assert.equal(posts.length, 2, "a later take (null: taken already) posts nothing");
  // The app's own: a workspace switch keeps them.
  u.visit(); assert.equal(u.doc.querySelectorAll(".app-toast").length, 2);
  notice.dispose(); assert.equal(desk.unsubscribed, 1, "dispose stops listening");
});

test("the notices: an element that does not decode is skipped while the others post; a non-array, a rejected or throwing take, or no bridge shows nothing", async () => {
  const posts = [], notify = (...args) => { posts.push(args); return true; };
  const decoded = resumedOne("kept");
  const bad = [undefined, null, {}, "summary", [decoded], { ...decoded, extra: 1 }, { ...decoded, totals: { resumed: 0, fresh: 0, waiting: 0, refused: 0 } }];
  const desk = bridge([[...bad.slice(0, 4), decoded, ...bad.slice(4)]]);
  const notice = createResumeNotice({ desk, notify }); notice.start(); await tick(); notice.dispose();
  assert.deepEqual(posts.map(([, options]) => options.detail), [detailOf("kept")], "only the element that decodes posts");
  posts.length = 0;
  for (const answer of [undefined, {}, "summary", decoded, { 0: decoded, length: 1 },
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
  const late = deferred(), lateDesk = bridge([() => late.promise]);
  const lateNotice = createResumeNotice({ desk: lateDesk, notify }); lateNotice.start(); lateNotice.dispose();
  late.resolve([decoded]); await tick();
  assert.deepEqual(posts, []);
});

test("the notices: at most 10 elements are read (main's cap), the first ten", async () => {
  assert.equal(RESUME_NOTICE_TAKE, 10);
  const posts = [], names = Array.from({ length: 12 }, (_, n) => `i${n + 1}`);
  const desk = bridge([names.map(resumedOne)]);
  const notice = createResumeNotice({ desk, notify: (...args) => { posts.push(args); return true; } }); notice.start(); await tick(); notice.dispose();
  assert.deepEqual(posts.map(([, options]) => options.detail), names.slice(0, 10).map(detailOf));
});

test("the real center: four notices collapse into one group, and a workspace switch keeps the group with its members", async (t) => {
  const u = center(t);
  const desk = bridge([["a", "b", "c", "d"].map(resumedOne)]);
  const notice = createResumeNotice({ desk, notify: u.center.notify }); notice.start(); await tick();
  const top = () => [...u.doc.querySelectorAll(".app-notifications > ol > .app-toast")].map((li) => li.querySelector(":scope > .app-toast-text").textContent);
  const members = () => [...u.doc.querySelectorAll(".app-toast-group-list > .app-toast .app-toast-detail")].map((el) => el.textContent);
  const group = u.doc.querySelector(".app-toast-group"); assert.ok(group, "past three they collapse");
  assert.deepEqual(top(), ["4 notices about resumed sessions"]);
  assert.deepEqual(members(), ["a", "b", "c", "d"].map(detailOf));
  u.center.notify("workspace message");
  u.visit();
  assert.equal(u.doc.querySelector(".app-toast-group"), group, "the switch keeps the group");
  assert.deepEqual(top(), ["4 notices about resumed sessions"], "and drops the workspace's own");
  assert.deepEqual(members(), ["a", "b", "c", "d"].map(detailOf), "with its members");
  notice.dispose();
});

test("shell.mjs wires it: the import, the notice with the center's notify, start, and dispose on pagehide", () => {
  const shell = readFileSync(new URL("../renderer/shell.mjs", import.meta.url), "utf8");
  assert.match(shell, /^import \{ createResumeNotice \} from "\.\/resume-notice\.mjs";$/m);
  assert.match(shell, /^const resumeNotices = createResumeNotice\(\{ desk, notify: notifications\.notify \}\);\nresumeNotices\.start\(\);\nwindow\.addEventListener\("pagehide", \(\) => resumeNotices\.dispose\(\), \{ once: true \}\);$/m);
  assert.doesNotMatch(shell, /resumeAtLaunch|createResumePreference|resumePaletteCommand/, "no preference left");
  // Declared after every top-level await, so nothing calls it before it exists.
  assert.ok(shell.indexOf("const resumeNotices =") > shell.lastIndexOf("\nawait "), "after the shell's top-level awaits");
});
