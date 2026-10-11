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
import { launchFlagIgnored, flagIgnoredNotice, launchPromptOutcome } from "../../client/launch-prompt-outcome.mjs";
import { DETAIL_WITHHELD } from "../../client/display-text.mjs";
import { started, flagIgnored, FLAG_IGNORED_WARNING, DEV_CHANNEL_STATEMENT } from "./helpers/launch-prompt-fixture.mjs";

const tick = () => new Promise((r) => setImmediate(r));
const HOME = "/workspace/agents/accountant/instances/accountant-minerva", NAME = "accountant-minerva";
const D = { instance: NAME, home: HOME };
const UNAVAILABLE = `${NAME} started. Claude Code reported that channels are not available and ignored the channel option, so mail and chat will not wake this instance.`;
const IGNORED = `${NAME} started. Claude Code ignored the channel option, so mail and chat will not wake this instance.`;
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

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
  assert.deepEqual(flagIgnoredNotice(NAME, started(D, flagIgnored())), { headline: UNAVAILABLE });
  for (const reason of ["another-reason", "", 7, null, { code: "channels-unavailable" }, ["channels-unavailable"], "Channels-Unavailable", "channels-unavailable "])
    assert.deepEqual(flagIgnoredNotice(NAME, started(D, flagIgnored({ reason }))), { headline: IGNORED }, JSON.stringify(reason));
  const { reason, ...none } = flagIgnored();
  assert.deepEqual(flagIgnoredNotice(NAME, started(D, none)), { headline: IGNORED });
  // The start worked: never a failure and never "could not confirm"; no account, no variable name, no path.
  for (const headline of [UNAVAILABLE, IGNORED]) assert.doesNotMatch(headline, /fail|could not|couldn|unknown|this account|DISABLE_|settings\.|\/workspace\//i);
  // The reader takes an answer's `launchPrompts` and `warnings` and nothing else of it: it knows nothing of the act.
  assert.deepEqual(flagIgnoredNotice(NAME, { launchPrompts: flagIgnored(), warnings: ["one"] }), flagIgnoredNotice(NAME, started(D, flagIgnored(), ["one"])));
  assert.deepEqual(flagIgnoredNotice(NAME, { launchPrompts: flagIgnored(), warnings: ["one"] }), { headline: UNAVAILABLE, detail: "OATS says:\none" });
  // The fields the reader does not use are not validated: a start that worked is never unsaid over them.
  assert.deepEqual(flagIgnoredNotice(NAME, started(D, flagIgnored({ signatureId: 7, startId: null, at: "yesterday" }))), { headline: UNAVAILABLE });
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
      assert.equal(flagIgnoredNotice(NAME, answer), null);
    }
  }
  for (const answer of [undefined, null, "", "flag-ignored", 7, [], [started(D, flagIgnored())], { launchPrompts: flagIgnored }])
    assert.equal(flagIgnoredNotice(NAME, answer), null);
});

test("the detail: \"OATS says:\" and every warning, whole, in the order given, each one display line; a withheld one shows the marker", () => {
  const first = "launch hook: the model sonnet is not in this host's catalog", last = "tmux: the window was created on another server";
  const secret = "the provider answered with token=ghp_abcdefghijklmnopqrstuvwxyz012345";
  const answer = started(D, flagIgnored(), [first, DEV_CHANNEL_STATEMENT, secret, FLAG_IGNORED_WARNING, last]);
  assert.deepEqual(launchFlagIgnored(answer), { reason: "channels-unavailable", warnings: [first, DEV_CHANNEL_STATEMENT, DETAIL_WITHHELD, FLAG_IGNORED_WARNING, last] });
  assert.deepEqual(flagIgnoredNotice(NAME, answer), { headline: UNAVAILABLE,
    detail: ["OATS says:", first, DEV_CHANNEL_STATEMENT, DETAIL_WITHHELD, FLAG_IGNORED_WARNING, last].join("\n") });
  // Each is one line: a line break or a bidi control inside a warning never makes a second line or reorders the text.
  const folded = flagIgnoredNotice(NAME, started(D, flagIgnored(), ["one\ntwo\u2028three", "right\u202Eleft", "\ttabbed  twice "]));
  assert.equal(folded.detail, "OATS says:\none two three\nright\uFFFDleft\ntabbed twice");
  // An entry with nothing to show is not a line; nothing is dropped for what it says.
  assert.equal(flagIgnoredNotice(NAME, started(D, flagIgnored(), ["", 7, null, { message: "x" }, ["y"], " \n ", "kept"])).detail, "OATS says:\nkept");
  // No warnings, no detail. A kernel before 0.30 sends no `warnings`.
  for (const warnings of [[], ["", null], undefined, null, "Claude ignored the flag", { 0: "x", length: 1 }, 7]) {
    const answer = { ...started(D, flagIgnored()), warnings };
    assert.deepEqual(flagIgnoredNotice(NAME, answer), { headline: UNAVAILABLE }, JSON.stringify(warnings));
    assert.equal(Object.hasOwn(flagIgnoredNotice(NAME, answer), "detail"), false);
  }
});

test("no warning is picked, matched or dropped by its words", () => {
  // The same answer with the kernel's sentence replaced, moved or absent gives the same headline and exactly its own lines.
  const others = ["a warning of a launch hook", "another one"];
  const headline = (warnings) => flagIgnoredNotice(NAME, started(D, flagIgnored(), warnings)).headline;
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

test("the kept-session reader does not change: it knows no such status", () => {
  assert.deepEqual(launchPromptOutcome(flagIgnored()), { status: "unknown", answers: [], reason: "Launch requires inspection", receipt: [] });
});

test("not the spawn: no module of the spawn's path reads the status or calls the reader", () => {
  for (const path of ["../renderer/spawn-jobs.mjs", "../renderer/spawn-dialog.mjs", "../renderer/views/spawn.mjs", "../server/spawn-apply.mjs", "../spawn-apply-proxy.mjs",
    "../../client/spawn-apply-contract.mjs", "../../client/spawn-apply-cli.mjs", "../../client/spawn-messages.mjs"])
    assert.doesNotMatch(read(path), /flag-ignored|flagIgnored|FlagIgnored|channels-unavailable/, path);
  // The one caller of the reader in what the app ships is the start dialog.
  assert.match(read("../renderer/start-instance.mjs"), /flagIgnoredNotice\(instance\.instance, result\)/);
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
    const notice = flagIgnoredNotice(NAME, started(D, flagIgnored(), ["<b>bold</b> launch hook", FLAG_IGNORED_WARNING]));
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
