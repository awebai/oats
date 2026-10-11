// A Start or Restart that worked while Claude Code ignored the channel option (OATS 0.52.0, awebai/oats#917):
// the start's successful answer carries `launchPrompts: {status: "flag-ignored", ...}` and the kernel's own
// words as one string among its `warnings`. The start worked, so the dialog closes and the terminal opens as
// for any start; a notice then says that mail and chat will not wake the instance, with every warning of
// that answer under "OATS says:". The answers are helpers/launch-prompt-fixture.mjs (hand-written from the
// kernel's documented shapes at head 7dc5a20c).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createInstanceStarter } from "../renderer/start-instance.mjs";
import { setWorkspace } from "../renderer/views/common.mjs";
import { createNotificationCenter } from "../renderer/notifications.mjs";
import { launchFlagIgnored, flagIgnoredFact, flagIgnoredNotice, launchPromptOutcome, FLAG_IGNORED_WARNINGS, FLAG_IGNORED_UNITS } from "../../client/launch-prompt-outcome.mjs";
import { DETAIL_WITHHELD, MAX_DISPLAY_LINE } from "../../client/display-text.mjs";
import { started, flagIgnored, FLAG_IGNORED_WARNING, DEV_CHANNEL_STATEMENT } from "./helpers/launch-prompt-fixture.mjs";

const tick = () => new Promise((r) => setImmediate(r));
const HOME = "/workspace/agents/accountant/instances/accountant-minerva", NAME = "accountant-minerva";
const D = { instance: NAME, home: HOME };
const UNAVAILABLE = `${NAME} started. Claude Code reported that channels are not available and ignored the channel option, so mail and chat will not wake this instance.`;
const IGNORED = `${NAME} started. Claude Code ignored the channel option, so mail and chat will not wake this instance.`;
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
// The notice of an answer, as the start dialog makes it: the reader's fact, then the notice for it.
const noticeOf = (name, answer) => flagIgnoredNotice(name, launchFlagIgnored(answer));

function setup({ start, restart = false, running = false, server } = {}) {
  const dom = new JSDOM("<body><button id='opener'>Start</button></body>");
  setWorkspace("/workspace");
  const instance = { instance: NAME, home: HOME, runtime: "claude", model: "sonnet", running, ...(server ? { server, addressable: true } : {}) };
  const calls = [], opened = [], notices = [];
  let modal;
  const cli = { ok: true, features: ["session-start", "session-restart"], remote: ["session-start", "session-restart"] };
  const ctx = { api: async (path, opts) => {
    calls.push({ path, opts });
    if (path === "/api/cli") return cli;
    if (path.startsWith("/api/panel")) return { instances: [{ ...instance, running }] };
    if (path === "/api/models") return { models: [] };
    if (path.startsWith("/api/start/") || path.startsWith("/api/restart/")) return start();
    assert.fail(path);
  }, openTerminal: async (ref) => opened.push(ref),
    notify: (...args) => { notices.push({ args, dialogOpen: modal.isConnected, opened: opened.length }); } };
  const open = createInstanceStarter(dom.window.document, ctx, { waitForReady: async () => true });
  modal = open(instance, { restart });
  const q = (s) => modal.querySelector(s);
  return { dom, modal, q, calls, opened, notices,
    submit: () => q("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true })),
    run: async function () { await tick(); this.submit(); await tick(); await tick(); await tick(); },
    cleanup: () => { setWorkspace("/finished"); dom.window.close(); } };
}

test("the notice's two headlines: one clause from the reason `channels-unavailable`, the plain one for any other reason or none", () => {
  assert.deepEqual(noticeOf(NAME, started(D, flagIgnored())), { headline: UNAVAILABLE });
  for (const reason of ["another-reason", "", 7, null, { code: "channels-unavailable" }, ["channels-unavailable"], "Channels-Unavailable", "channels-unavailable "])
    assert.deepEqual(noticeOf(NAME, started(D, flagIgnored({ reason }))), { headline: IGNORED }, JSON.stringify(reason));
  const { reason, ...none } = flagIgnored();
  assert.deepEqual(noticeOf(NAME, started(D, none)), { headline: IGNORED });
  // The start worked: never a failure and never "could not confirm"; no account, no variable name, no path.
  for (const headline of [UNAVAILABLE, IGNORED]) assert.doesNotMatch(headline, /fail|could not|couldn|unknown|this account|DISABLE_|settings\.|\/workspace\//i);
  // The reader takes an answer's `launchPrompts` and `warnings` and nothing else of it: it knows nothing of the act.
  assert.deepEqual(noticeOf(NAME, { launchPrompts: flagIgnored(), warnings: ["one"] }), noticeOf(NAME, started(D, flagIgnored(), ["one"])));
  assert.deepEqual(noticeOf(NAME, { launchPrompts: flagIgnored(), warnings: ["one"] }), { headline: UNAVAILABLE, detail: "OATS says:\none" });
  // The fields the reader does not use are not validated: a start that worked is never unsaid over them.
  assert.deepEqual(noticeOf(NAME, started(D, flagIgnored({ signatureId: 7, startId: null, at: "yesterday" }))), { headline: UNAVAILABLE });
});

test("a malformed `launchPrompts`, an unknown status, or none gives nothing", () => {
  for (const prompts of [undefined, null, "flag-ignored", 7, true, [], ["flag-ignored"], [flagIgnored()], {}, { reason: "channels-unavailable" },
    { status: 7 }, { status: null }, { status: ["flag-ignored"] }, { status: "flag-ignored " }, { status: "Flag-Ignored" }, { status: "flag_ignored" },
    { status: "not-engaged", startId: "s", at: "t" }, { status: "completed", answers: [], reason: "recognized launch boundary", receipt: [] },
    { status: "blocked", reason: "channels-unavailable" }, { status: "flag-seen", reason: "channels-unavailable" }]) {
    // The kernel's own sentence among the warnings changes nothing: it is not looked for.
    for (const warnings of [[], [FLAG_IGNORED_WARNING]]) {
      const answer = started(D, prompts, warnings);
      assert.equal(launchFlagIgnored(answer), null, JSON.stringify(prompts));
      assert.equal(noticeOf(NAME, answer), null);
    }
  }
  for (const answer of [undefined, null, "", "flag-ignored", 7, [], [started(D, flagIgnored())], { launchPrompts: flagIgnored }])
    assert.equal(noticeOf(NAME, answer), null);
});

test("the detail: \"OATS says:\" and every warning, whole, in the order given, each one display line; a withheld one shows the marker", () => {
  const first = "launch hook: the model sonnet is not in this host's catalog", last = "tmux: the window was created on another server";
  const secret = "the provider answered with token=ghp_abcdefghijklmnopqrstuvwxyz012345";
  const answer = started(D, flagIgnored(), [first, DEV_CHANNEL_STATEMENT, secret, FLAG_IGNORED_WARNING, last]);
  assert.deepEqual(launchFlagIgnored(answer), { reason: "channels-unavailable", warnings: [first, DEV_CHANNEL_STATEMENT, DETAIL_WITHHELD, FLAG_IGNORED_WARNING, last], omitted: 0 });
  assert.deepEqual(noticeOf(NAME, answer), { headline: UNAVAILABLE,
    detail: ["OATS says:", first, DEV_CHANNEL_STATEMENT, DETAIL_WITHHELD, FLAG_IGNORED_WARNING, last].join("\n") });
  // Each is one line: a line break or a bidi control inside a warning never makes a second line or reorders the text.
  const folded = noticeOf(NAME, started(D, flagIgnored(), ["one\ntwo\u2028three", "right\u202Eleft", "\ttabbed  twice "]));
  assert.equal(folded.detail, "OATS says:\none two three\nright\uFFFDleft\ntabbed twice");
  // An entry with nothing to show is not a line; nothing is dropped for what it says.
  assert.equal(noticeOf(NAME, started(D, flagIgnored(), ["", 7, null, { message: "x" }, ["y"], " \n ", "kept"])).detail, "OATS says:\nkept");
  // No warnings, no detail. A kernel before 0.30 sends no `warnings`.
  for (const warnings of [[], ["", null], undefined, null, "Claude ignored the flag", { 0: "x", length: 1 }, 7]) {
    const answer = { ...started(D, flagIgnored()), warnings };
    assert.deepEqual(noticeOf(NAME, answer), { headline: UNAVAILABLE }, JSON.stringify(warnings));
    assert.equal(Object.hasOwn(noticeOf(NAME, answer), "detail"), false);
  }
});

test("no warning is picked, matched or dropped by its words", () => {
  // The same answer with the kernel's sentence replaced, moved or absent gives the same headline and exactly its own lines.
  const others = ["a warning of a launch hook", "another one"];
  const headline = (warnings) => noticeOf(NAME, started(D, flagIgnored(), warnings)).headline;
  const lines = (warnings) => launchFlagIgnored(started(D, flagIgnored(), warnings)).warnings;
  for (const warnings of [[FLAG_IGNORED_WARNING, ...others], [...others, FLAG_IGNORED_WARNING], others, [DEV_CHANNEL_STATEMENT, ...others],
    [FLAG_IGNORED_WARNING, FLAG_IGNORED_WARNING], ["Claude ignored nothing", "This start passes nothing", "channels-unavailable", "flag-ignored"]]) {
    assert.equal(headline(warnings), UNAVAILABLE);
    assert.deepEqual(lines(warnings), warnings);
  }
  // And in the code: the reader and the dialog hold none of the kernel's words, and no test of a warning's text.
  const source = read("../../client/launch-prompt-outcome.mjs");
  const reader = source.slice(source.indexOf("export function launchFlagIgnored"));
  assert.ok(reader.includes("export function flagIgnoredNotice"));
  const dialog = read("../renderer/start-instance.mjs");
  for (const text of [reader, dialog]) assert.doesNotMatch(text, /Claude ignored|This start passes|dangerously|not available for this/);
  assert.doesNotMatch(reader, /\.(?:includes|startsWith|endsWith|match|matchAll|search|test|indexOf|replace|split|localeCompare)\(|===\s*w\b|\bw\s*===|new RegExp|\/[^/\n]+\/[a-z]*\.test/);
  assert.deepEqual(reader.match(/displayLine\(w\)/g), ["displayLine(w)"], "a warning goes to the display filter and nowhere else");
  assert.equal(dialog.match(/flagIgnoredNotice\(/g).length, 1);
  assert.doesNotMatch(dialog, /\.warnings\b/);
});

const numbered = (n, from = 1) => Array.from({ length: n }, (_, i) => `warning ${from + i}`);

test("the bound: the first 16 display lines, cut by position, and how many more in the Desktop's words", () => {
  assert.equal(FLAG_IGNORED_WARNINGS, 16);
  const fact = (warnings) => launchFlagIgnored(started(D, flagIgnored(), warnings));
  // Exactly 16: all of them, and nothing is said of more.
  assert.deepEqual(fact(numbered(16)), { reason: "channels-unavailable", warnings: numbered(16), omitted: 0 });
  assert.equal(noticeOf(NAME, started(D, flagIgnored(), numbered(16))).detail, ["OATS says:", ...numbered(16)].join("\n"));
  // 17: the first 16 in the order given, and one line for the last.
  assert.deepEqual(fact(numbered(17)), { reason: "channels-unavailable", warnings: numbered(16), omitted: 1 });
  assert.equal(noticeOf(NAME, started(D, flagIgnored(), numbered(17))).detail, ["OATS says:", ...numbered(16), "1 more not shown."].join("\n"));
  assert.deepEqual(fact(numbered(512)), { reason: "channels-unavailable", warnings: numbered(16), omitted: 496 });
  assert.equal(noticeOf(NAME, started(D, flagIgnored(), numbered(512))).detail.split("\n").at(-1), "496 more not shown.");
  // An entry with nothing to show was never a line: 17 entries of which one is empty are 16 lines, none omitted.
  for (const at of [0, 8, 16]) {
    const entries = numbered(16); entries.splice(at, 0, at === 8 ? " \n " : at ? null : "");
    assert.deepEqual(fact(entries), { reason: "channels-unavailable", warnings: numbered(16), omitted: 0 }, String(at));
  }
  // A withheld warning's line is the marker, and it counts: as one of the 16, and as one of those left out.
  const secret = "token=ghp_abcdefghijklmnopqrstuvwxyz012345";
  assert.deepEqual(fact([secret, ...numbered(16)]), { reason: "channels-unavailable", warnings: [DETAIL_WITHHELD, ...numbered(15)], omitted: 1 });
  assert.deepEqual(fact([...numbered(16), secret, secret]), { reason: "channels-unavailable", warnings: numbered(16), omitted: 2 });
  // The cut is by position: the kernel's own sentence past the 16th line is left out like any other.
  assert.deepEqual(fact([...numbered(16), FLAG_IGNORED_WARNING]).warnings, numbered(16));
  assert.equal(noticeOf(NAME, started(D, flagIgnored(), [...numbered(16), FLAG_IGNORED_WARNING])).headline, UNAVAILABLE);
});

test("the bound on the total: at most 4096 units of lines, cut by position, and no line is cut inside", () => {
  assert.equal(FLAG_IGNORED_UNITS, 4096); assert.equal(MAX_DISPLAY_LINE * 2, FLAG_IGNORED_UNITS);
  const fact = (warnings) => launchFlagIgnored(started(D, flagIgnored(), warnings));
  const line = (letter, units) => letter.repeat(units), kb = (letter) => line(letter, 1024);
  const kept = (warnings, lines, omitted) => assert.deepEqual(fact(warnings), { reason: "channels-unavailable", warnings: lines, omitted });
  // Lines that fit exactly: all of them, none left out.
  kept([kb("a"), kb("b"), kb("c"), kb("d")], [kb("a"), kb("b"), kb("c"), kb("d")], 0);
  // One unit over: the line that does not fit is left out whole, and counted.
  kept([kb("a"), kb("b"), kb("c"), line("d", 1025)], [kb("a"), kb("b"), kb("c")], 1);
  // And every line after it, also one that would have fitted: the cut is by position, not a search for what fits.
  kept([kb("a"), kb("b"), kb("c"), line("d", 1025), "short", "another"], [kb("a"), kb("b"), kb("c")], 3);
  // Two lines of the longest a display line can be fill the bound; a third of one unit does not fit.
  kept([line("a", 2048), line("b", 2048), "c"], [line("a", 2048), line("b", 2048)], 1);
  // The first line always fits: a longer warning is one display line of 2048 units before it is counted.
  kept([line("a", 9000)], [line("a", 2048)], 0);
  kept([line("a", 9000), line("b", 9000), line("c", 9000)], [line("a", 2048), line("b", 2048)], 1);
  // An entry with nothing to show takes no room and is not counted.
  kept([kb("a"), "", kb("b"), null, kb("c"), " \n ", kb("d"), "e"], [kb("a"), kb("b"), kb("c"), kb("d")], 1);
  // Both bounds hold together: 16 short lines are 16 lines; the 16th line is also left out when it does not fit.
  const fifteen = Array.from({ length: 15 }, (_, i) => line(String.fromCharCode(97 + i), 200));
  kept([...fifteen, line("z", 2048)], fifteen, 1); kept([...fifteen, line("z", 1096), "y"], [...fifteen, line("z", 1096)], 1);
  // The notice says how many, whichever bound cut.
  assert.equal(noticeOf(NAME, started(D, flagIgnored(), [line("a", 2048), line("b", 2048), "c", "d"])).detail,
    ["OATS says:", line("a", 2048), line("b", 2048), "2 more not shown."].join("\n"));
  // The decoder holds the same two bounds, and knows where a cut can have happened.
  const good = (warnings, omitted) => assert.deepEqual(flagIgnoredFact({ reason: null, warnings, omitted }), { reason: null, warnings, omitted });
  const bad = (warnings, omitted) => assert.equal(flagIgnoredFact({ reason: null, warnings, omitted }), undefined, `${warnings.map((w) => w.length)} ${omitted}`);
  good([line("a", 2048), line("b", 2048)], 0); good([line("a", 2048), line("b", 2048)], 7);
  bad([line("a", 2048), line("b", 2048), "c"], 0); bad([line("a", 2048), line("b", 2048), "c"], 1); bad([kb("a"), kb("b"), kb("c"), line("d", 1025)], 0);
  // Left out beside fewer than 16 lines: only when a line of 2048 units would not have fitted after them.
  good([line("a", 2048), "b"], 1); good([line("a", 2049 - 1024), kb("b")], 1);
  bad([line("a", 2048)], 1); bad([kb("a"), kb("b")], 1); bad(["a"], 1);
});

test("the fact decodes to itself at a boundary, and a malformed one is undefined", () => {
  const long = "x".repeat(MAX_DISPLAY_LINE + 40), lone = String.fromCharCode(0xD83D) + "x";
  for (const warnings of [undefined, [], ["one"], numbered(16), numbered(17), numbered(40), [long, lone, "token=ghp_abcdefghijklmnopqrstuvwxyz012345", "a\tb\nc"],
    [long, long, "c"], [long, "b", long, "d"], ["x".repeat(1024), "y".repeat(1024), "z".repeat(1024), "w".repeat(1025), "v"], [...numbered(15), long, long]]) {
    for (const prompts of [flagIgnored(), flagIgnored({ reason: "another-reason" })]) {
      const fact = launchFlagIgnored({ ...started(D, prompts), warnings });
      assert.deepEqual(flagIgnoredFact(fact), fact, JSON.stringify(warnings)?.slice(0, 60));
      assert.notEqual(flagIgnoredFact(fact), fact, "a copy, never the value that crossed");
      // Through a serialisation too, and decoding twice is decoding once.
      assert.deepEqual(flagIgnoredFact(JSON.parse(JSON.stringify(fact))), fact);
      assert.deepEqual(flagIgnoredFact(flagIgnoredFact(fact)), fact);
    }
  }
  const good = { reason: "channels-unavailable", warnings: ["one"], omitted: 0 }, full = { reason: null, warnings: numbered(16), omitted: 3 };
  assert.deepEqual(flagIgnoredFact(good), good); assert.deepEqual(flagIgnoredFact(full), full);
  const bad = [undefined, null, "", "flag-ignored", 7, true, [], [good], () => good,
    // Not exactly the three keys.
    {}, { reason: null, warnings: [] }, { warnings: [], omitted: 0 }, { reason: null, omitted: 0 }, { ...good, headline: "x" }, { ...good, status: "flag-ignored" },
    // The reason: the one known value or null.
    { ...good, reason: "another-reason" }, { ...good, reason: "" }, { ...good, reason: undefined }, { ...good, reason: 7 }, { ...good, reason: ["channels-unavailable"] },
    // The warnings: an array of at most 16 display lines.
    { ...good, warnings: "one" }, { ...good, warnings: null }, { ...good, warnings: { 0: "one", length: 1 } }, { ...good, warnings: numbered(17) },
    { ...good, warnings: [7] }, { ...good, warnings: [null] }, { ...good, warnings: [""] }, { ...good, warnings: [" padded "] }, { ...good, warnings: ["two\nlines"] },
    { ...good, warnings: ["a  b"] }, { ...good, warnings: ["token=ghp_abcdefghijklmnopqrstuvwxyz012345"] }, { ...good, warnings: ["x".repeat(MAX_DISPLAY_LINE + 1)] },
    { ...good, warnings: [["one"]] }, { ...good, warnings: [{ toString: () => "one" }] },
    // What was left out: a count, and only beside a full list.
    { ...good, omitted: -1 }, { ...good, omitted: 1.5 }, { ...good, omitted: "0" }, { ...good, omitted: null }, { ...good, omitted: NaN }, { ...good, omitted: Infinity },
    { ...good, omitted: Number.MAX_SAFE_INTEGER + 1 }, { ...good, omitted: 1 }, { ...good, warnings: [], omitted: 2 }, { ...good, warnings: numbered(15), omitted: 1 }];
  for (const value of bad) {
    assert.equal(flagIgnoredFact(value), undefined, JSON.stringify(value)?.slice(0, 80));
    // And nothing is said for it: the notice is made from a fact, never from what did not decode.
    assert.equal(flagIgnoredNotice(NAME, value), null);
  }
  // The answer itself is not the fact: the notice is not made from it.
  assert.equal(flagIgnoredNotice(NAME, started(D, flagIgnored(), ["one"])), null);
  // The longest line the filter gives is accepted: the decoder's bound on a line is the filter's.
  assert.equal(flagIgnoredFact({ ...good, warnings: ["x".repeat(MAX_DISPLAY_LINE)] }).warnings[0].length, MAX_DISPLAY_LINE);
  // Three of them are over the bound on the total.
  assert.equal(flagIgnoredFact({ ...good, warnings: Array(3).fill("x".repeat(MAX_DISPLAY_LINE)) }), undefined);
});

test("the kept-session reader does not change: it knows no such status", () => {
  assert.deepEqual(launchPromptOutcome(flagIgnored()), { status: "unknown", answers: [], reason: "Launch requires inspection", receipt: [] });
});

test("the start dialog calls the reader and then the notice, once each", () => {
  const dialog = read("../renderer/start-instance.mjs");
  assert.match(dialog, /flagIgnoredNotice\(instance\.instance, launchFlagIgnored\(result\)\)/);
  assert.equal(dialog.match(/launchFlagIgnored\(/g).length, 1);
  // The spawn's receipt carries the same reader's fact (spawn-flag-ignored.test.mjs); the start reads no receipt.
  assert.doesNotMatch(dialog, /flagIgnoredFact|receipt/);
});

for (const restart of [false, true]) {
  const act = restart ? "Restart" : "Start";
  test(`${act} dialog: the start worked, so the dialog closes and the terminal opens as for any start; then the notice`, async () => {
    for (const [prompts, headline] of [[flagIgnored(), UNAVAILABLE], [flagIgnored({ reason: "another-reason" }), IGNORED]]) {
      const s = setup({ restart, running: restart, start: () => started(D, prompts, [DEV_CHANNEL_STATEMENT, FLAG_IGNORED_WARNING]) });
      try {
        await s.run();
        assert.equal(s.calls.some((c) => c.path.startsWith(restart ? "/api/restart/" : "/api/start/")), true);
        assert.equal(s.modal.isConnected, false); assert.equal(s.opened.length, 1);
        assert.equal(s.notices.length, 1);
        assert.deepEqual(s.notices[0].args, [headline, { detail: `OATS says:\n${DEV_CHANNEL_STATEMENT}\n${FLAG_IGNORED_WARNING}` }]);
        // After the dialog closed, and the dialog itself said nothing of it.
        assert.equal(s.notices[0].dialogOpen, false);
      } finally { s.cleanup(); }
    }
  });
}

test("Start dialog: no warnings, no detail; a fetch-shaped answer and a routed host read the same", async () => {
  const bare = setup({ start: () => started(D, flagIgnored()) });
  try { await bare.run(); assert.deepEqual(bare.notices.map((n) => n.args), [[UNAVAILABLE, undefined]]); assert.equal(bare.opened.length, 1); } finally { bare.cleanup(); }
  const body = started(D, flagIgnored(), [FLAG_IGNORED_WARNING]);
  for (const options of [{ start: () => ({ ok: true, status: 200, json: async () => body }) }, { server: "build", start: () => body }]) {
    const s = setup(options);
    try {
      await s.run();
      assert.deepEqual(s.notices.map((n) => n.args), [[UNAVAILABLE, { detail: `OATS says:\n${FLAG_IGNORED_WARNING}` }]]);
      assert.equal(s.modal.isConnected, false); assert.equal(s.opened.length, 1);
    } finally { s.cleanup(); }
  }
});

test("Start dialog: 17 warnings show 16 and \"1 more not shown.\"", async () => {
  const s = setup({ start: () => started(D, flagIgnored(), numbered(17)) });
  try {
    await s.run();
    assert.deepEqual(s.notices.map((n) => n.args), [[UNAVAILABLE, { detail: ["OATS says:", ...numbered(16), "1 more not shown."].join("\n") }]]);
    assert.equal(s.modal.isConnected, false); assert.equal(s.opened.length, 1);
  } finally { s.cleanup(); }
});

test("Start dialog: any other start that worked reads as today, with no notice, whatever its warnings say", async () => {
  for (const answer of [{ launched: true }, started(D, undefined, [FLAG_IGNORED_WARNING]), started(D, { status: "not-engaged", startId: "s", at: "t" }, [FLAG_IGNORED_WARNING]),
    started(D, { status: "completed", answers: [], reason: "recognized launch boundary", receipt: [] }, [DEV_CHANNEL_STATEMENT]),
    started(D, "flag-ignored", [FLAG_IGNORED_WARNING]), started(D, { status: "flag-future", reason: "channels-unavailable" }, [FLAG_IGNORED_WARNING]), null, "ok", []]) {
    const s = setup({ start: () => answer });
    try {
      await s.run();
      assert.deepEqual(s.notices, [], JSON.stringify(answer)?.slice(0, 80));
      assert.equal(s.modal.isConnected, false); assert.equal(s.opened.length, 1);
    } finally { s.cleanup(); }
  }
});

test("Start dialog: closed by the person while the start ran, the notice still says it and no terminal opens; another workspace on screen, nothing", async () => {
  let release;
  const gate = () => new Promise((resolve) => { release = () => resolve(started(D, flagIgnored(), [FLAG_IGNORED_WARNING])); });
  const closed = setup({ start: gate });
  try {
    await tick(); closed.submit(); await tick();
    closed.q(".start-cancel").click();
    assert.equal(closed.modal.isConnected, false);
    release(); await tick(); await tick();
    assert.deepEqual(closed.notices.map((n) => n.args), [[UNAVAILABLE, { detail: `OATS says:\n${FLAG_IGNORED_WARNING}` }]]);
    assert.deepEqual(closed.opened, []);
  } finally { closed.cleanup(); }
  const moved = setup({ start: gate });
  try {
    await tick(); moved.submit(); await tick();
    setWorkspace("/another");
    release(); await tick(); await tick();
    assert.deepEqual(moved.notices, []); assert.deepEqual(moved.opened, []);
  } finally { moved.cleanup(); }
});

test("the notice in the notification center: the headline is the message, the warnings sit behind Details as text", async () => {
  const dom = new JSDOM("<body></body>");
  try {
    const center = createNotificationCenter({ document: dom.window.document });
    const notice = noticeOf(NAME, started(D, flagIgnored(), ["<b>bold</b> launch hook", FLAG_IGNORED_WARNING]));
    assert.ok(center.notify(notice.headline, { detail: notice.detail }));
    const toast = dom.window.document.querySelector(".app-toast");
    assert.equal(toast.querySelector(".app-toast-text").textContent, UNAVAILABLE);
    const panel = toast.querySelector(".app-toast-detail");
    assert.equal(panel.textContent, `OATS says:\n<b>bold</b> launch hook\n${FLAG_IGNORED_WARNING}`);
    assert.equal(panel.querySelector("b"), null); assert.equal(panel.hidden, true);
    assert.equal(toast.querySelector(".app-toast-details").textContent, "Details");
    center.dispose();
  } finally { dom.window.close(); }
});
