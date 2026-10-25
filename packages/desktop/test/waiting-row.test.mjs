// #1502: the waiting row over a terminal pane. Executes the shipped waiting-row.mjs over a JSDOM pane drawn
// as openTerminalTabInner draws it (a .tab-pane holding a .term-wrap); no shell startup, Electron or session.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { syncWaitingRow, fitWaitingLines, waitingFit, WAITING_LINES } from "../renderer/waiting-row.mjs";
import { waitingLabel, waitedText } from "../../client/waiting-on-you.mjs";

const css = readFileSync(new URL("../renderer/shell.css", import.meta.url), "utf8");
const SINCE = "2026-10-03T09:00:00.000Z", AT = Date.parse(SINCE) + 12 * 60e3;
const claim = (extra = {}) => ({ since: SINCE, producer: "agent", reason: "attention", message: "Survey done: yes/no on the upgrade?", ...extra });

function fixture(t) {
  const dom = new JSDOM("<!doctype html><body><div class='tab-pane active'><div class='term-wrap'></div></div></body>");
  t.after(() => dom.window.close());
  const doc = dom.window.document, pane = doc.querySelector(".tab-pane"), wrap = doc.querySelector(".term-wrap");
  const observed = [];
  // The pane's resize observation: records what is observed and lets a test fire it, as a ResizeObserver would.
  const observe = (el, fn) => { const entry = { el, fn, live: true }; observed.push(entry); return () => { entry.live = false; }; };
  return { dom, doc, pane, wrap, observed, sync: (c, now = AT) => syncWaitingRow(pane, c, now, { observe }) };
}
const rowOf = pane => pane.querySelector(":scope > .waiting-row");
const part = (pane, name) => rowOf(pane)?.querySelector(`.waiting-${name}`);

test("a claim puts the row over the terminal: Needs input, the age, then the message", t => {
  const u = fixture(t);
  u.sync(null);
  assert.equal(rowOf(u.pane), null, "no claim, no row");
  u.sync(claim());
  const row = rowOf(u.pane);
  assert.ok(row);
  assert.equal(u.pane.firstElementChild, row, "the row comes first");
  assert.equal(row.nextElementSibling, u.wrap, "directly over the terminal");
  const head = part(u.pane, "head");
  assert.equal(head.querySelector(".ctx-attn").textContent, "Needs input", "the list's tag, in words");
  assert.ok(head.querySelector(".ctx-attn svg[aria-hidden='true']"), "with the alert shape, hidden from the name");
  assert.equal(part(u.pane, "age").textContent, ` · ${waitedText(SINCE, AT)}`);
  assert.equal(part(u.pane, "age").textContent, " · 12 min");
  assert.equal(head.textContent, "Needs input · 12 min", "the age comes before the message");
  assert.equal(part(u.pane, "message").textContent, "Survey done: yes/no on the upgrade?");
  assert.equal(part(u.pane, "message").getAttribute("dir"), "auto", "agent text keeps its own direction");
  assert.equal(part(u.pane, "message").classList.contains("reason"), false);
  assert.deepEqual([...row.children].map(el => el.className), ["waiting-head", "waiting-message"]);
});

test("the message is agent text: markup is shown as text, never rendered", t => {
  const u = fixture(t);
  u.sync(claim({ message: "<b>bold</b><img src=x onerror=alert(1)>" }));
  const message = part(u.pane, "message");
  assert.equal(message.textContent, "<b>bold</b><img src=x onerror=alert(1)>");
  assert.equal(message.children.length, 0, "no element was made from it");
  assert.equal(u.doc.querySelector("img, b"), null);
});

test("a null message: the row says why in words, from the reason", t => {
  const u = fixture(t);
  for (const reason of ["permission", "question", "attention", "approval", null]) {
    u.sync(claim({ message: null, reason }));
    const message = part(u.pane, "message");
    assert.equal(message.textContent, waitingLabel({ reason }), String(reason));
    assert.ok(message.classList.contains("reason"), "our words, styled apart from agent text");
  }
  assert.equal(waitingLabel({ reason: "permission" }), "Waiting for a tool approval");
  u.sync(claim());
  assert.equal(part(u.pane, "message").classList.contains("reason"), false, "the agent's text again");
});

test("the row clears with the claim, leaving the terminal pane as it was drawn", t => {
  const u = fixture(t), drawn = u.pane.outerHTML;
  u.sync(claim());
  u.sync(null);
  assert.equal(rowOf(u.pane), null);
  assert.equal(u.pane.outerHTML, drawn, "byte-identical to the pane without a claim");
  assert.equal(u.observed.length, 1); assert.equal(u.observed[0].live, false, "its pane observation is disconnected");
  u.sync(claim());
  assert.ok(rowOf(u.pane), "and comes back with the next claim");
});

test("geometry changes only when the claim starts, clears or its text changes: an age tick touches the age alone", t => {
  const u = fixture(t);
  u.sync(claim());
  const row = rowOf(u.pane), message = part(u.pane, "message"), age = part(u.pane, "age");
  const records = [];
  const observer = new u.dom.window.MutationObserver(list => records.push(...list));
  observer.observe(u.pane, { subtree: true, childList: true, characterData: true, attributes: true });
  const changed = () => { const out = [...records, ...observer.takeRecords()]; records.length = 0; return out; };
  // Every tick of a claim's first day: "12 min" → "59 min" → "1 h" → "23 h"; a reason or producer change with the same text.
  for (const [now, c] of [[AT + 60e3, claim()], [Date.parse(SINCE) + 3600e3, claim()], [Date.parse(SINCE) + 23 * 3600e3, claim({ producer: "claude-hook" })],
    [AT, claim({ reason: "question" })]]) {
    u.sync(c, now);
    for (const record of changed()) assert.ok(age.contains(record.target), `only the age changed (${record.type} on ${record.target.nodeName})`);
    assert.equal(rowOf(u.pane), row, "the same row"); assert.equal(part(u.pane, "message"), message, "the same message element");
  }
  assert.equal(age.textContent, " · 12 min");
  u.sync(claim(), AT);
  assert.deepEqual(changed(), [], "the same claim at the same age changes nothing");
  u.sync(claim({ message: "Another question?" }));
  assert.ok(changed().some(record => message.contains(record.target)), "its text changed: the message is rewritten");
  assert.equal(message.textContent, "Another question?");
  observer.disconnect();
});

test("the message gets at most 3 lines, and the whole row never more than a quarter of the pane", () => {
  assert.equal(WAITING_LINES, 3);
  // chrome: the row's padding, border and head line (33px under shell.css, as Chromium lays it out);
  // line: the message's line height (shell.css, 18px).
  const C = 33, L = 18;
  for (const [pane, fit] of [[2000, { row: true, lines: 3 }], [400, { row: true, lines: 3 }], [4 * (C + 3 * L), { row: true, lines: 3 }],
    [4 * (C + 3 * L) - 1, { row: true, lines: 2 }], [4 * (C + 2 * L), { row: true, lines: 2 }], [4 * (C + L), { row: true, lines: 1 }],
    [4 * (C + L) - 1, { row: true, lines: 0 }], [4 * C, { row: true, lines: 0 }], [4 * C - 1, { row: false, lines: 0 }], [100, { row: false, lines: 0 }],
    [40, { row: false, lines: 0 }]]) {
    assert.deepEqual(waitingFit({ pane, chrome: C, line: L }), fit, `pane ${pane}px`);
    if (fit.row) assert.ok(C + fit.lines * L <= pane / 4, `the row fits a quarter of ${pane}px`);
  }
  for (const pane of [0, -5, NaN, undefined]) assert.equal(waitingFit({ pane, chrome: C, line: L }), null, `a hidden pane (${pane}) keeps what it had`);
  assert.equal(waitingFit({ pane: 800, chrome: C, line: 0 }), null, "an unmeasured line keeps what it had");
  assert.equal(waitingFit({ pane: 800, chrome: 0, line: L }), null, "an unmeasured head keeps what it had");
});

test("fitWaitingLines clamps the message from the pane's measured height, and hides what does not fit in a quarter", t => {
  const u = fixture(t);
  u.sync(claim());
  const row = rowOf(u.pane), message = part(u.pane, "message");
  // Layout as Chromium gives it: a hidden element measures 0, so the row's own height is its chrome plus its shown lines.
  const geometry = pane => {
    Object.defineProperty(u.pane, "clientHeight", { configurable: true, get: () => pane });
    Object.defineProperty(message, "offsetHeight", { configurable: true, get: () => row.hidden || message.hidden ? 0 : 18 * Number(row.style.getPropertyValue("--waiting-lines") || 3) });
    Object.defineProperty(row, "offsetHeight", { configurable: true, get: () => row.hidden ? 0 : 33 + message.offsetHeight });
  };
  message.style.lineHeight = "18px";
  const shown = () => ({ row: !row.hidden, message: !message.hidden, lines: row.style.getPropertyValue("--waiting-lines") });
  geometry(800); fitWaitingLines(row);
  assert.deepEqual(shown(), { row: true, message: true, lines: "3" });
  geometry(4 * (33 + 18)); fitWaitingLines(row);
  assert.deepEqual(shown(), { row: true, message: true, lines: "1" }, "a short pane: one line");
  geometry(140); fitWaitingLines(row);
  assert.deepEqual(shown(), { row: true, message: false, lines: "1" }, "no line fits: the head alone");
  geometry(100); fitWaitingLines(row);
  assert.equal(row.hidden, true, "not even the head fits in a quarter: no row, the terminal keeps the pane");
  geometry(800); fitWaitingLines(row);
  assert.deepEqual(shown(), { row: true, message: true, lines: "3" }, "a hidden row still knows its head's height, and comes back");
  geometry(0); fitWaitingLines(row);
  assert.deepEqual(shown(), { row: true, message: true, lines: "3" }, "a hidden pane keeps what it had");
});

test("the pane's size drives the clamp: the row observes its pane, never a timer", t => {
  const u = fixture(t);
  u.sync(claim());
  assert.equal(u.observed.length, 1);
  assert.equal(u.observed[0].el, u.pane, "it observes the pane, whose size the layout sets, never its own");
  u.sync(claim({ message: "Changed?" })); u.sync(claim(), AT + 3600e3);
  assert.equal(u.observed.length, 1, "one observation for the row's life");
  const src = readFileSync(new URL("../renderer/waiting-row.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /setInterval|setTimeout|requestAnimationFrame/, "nothing on a timer");
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML/, "text only");
});

test("CSS: the row takes its rows from the terminal, wraps and cuts the message with an ellipsis, in tokens", () => {
  const rule = selector => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.()>:~*+\[\]]/g, "\\$&")} \\{([^}]*)\\}`))?.[1];
  const pane = rule(".tab-pane.active:has(> .waiting-row)");
  assert.ok(pane, "a pane with the row is a column");
  assert.match(pane, /display: flex/); assert.match(pane, /flex-direction: column/);
  const wrap = rule(".waiting-row ~ .term-wrap");
  assert.ok(wrap, "the terminal takes the rest");
  assert.match(wrap, /position: relative/); assert.match(wrap, /flex: 1 1 0/); assert.match(wrap, /min-height: 0/);
  const row = rule(".tab-pane > .waiting-row");
  assert.ok(row, "over .tab-pane > div's 100% height");
  assert.match(row, /flex: none/); assert.match(row, /height: auto/, "never the pane's 100% for a div child");
  assert.match(row, /background-color: var\(--attn-bg\)/); assert.match(row, /color: var\(--fg\)/);
  const head = rule(".waiting-head");
  assert.match(head, /white-space: nowrap/, "the head never wraps, so the age never moves the message");
  const message = rule(".waiting-message");
  assert.match(message, /-webkit-line-clamp: var\(--waiting-lines, 3\)/); assert.match(message, /-webkit-box-orient: vertical/);
  assert.match(message, /overflow: hidden/); assert.match(message, /line-height: 18px/); assert.match(message, /overflow-wrap: anywhere/);
  assert.match(rule(".waiting-age"), /color: var\(--muted\)/);
  assert.match(rule(".waiting-age"), /white-space: pre/, "its leading space stays a space");
  assert.match(message, /margin: 0;/, "no margin of its own, so hiding it leaves the measured chrome as it was");
  assert.match(css, /\.tab-pane > \.waiting-row\[hidden\] \{ display: none; \}/, "a row that does not fit leaves the pane to the terminal");
  assert.match(rule(".waiting-message.reason"), /color: var\(--muted\)/);
  for (const body of [row, head, message, rule(".waiting-age"), rule(".waiting-message.reason")]) {
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|opacity|animation|transition/i, "tokens only, no opacity, no motion");
  }
});
