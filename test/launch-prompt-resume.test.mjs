import test from "node:test";
import assert from "node:assert/strict";
import { RESUME_CONFIRMATION_ENTRIES, validateResumeConfirmationEntries, validateDevChannelEntries, matchResumeConfirmation,
  DEV_CHANNEL_ENTRIES, showsClaudeSession, normalizeScreen } from "../lib/launch-prompt-fixtures.mjs";
import { watchResumeConfirmation } from "../lib/launch-prompt-resume.mjs";
import { sessions } from "./helpers/dev-channel-screens.mjs";

// No real capture of the resume dialogs exists: these screens are built from the
// strings the entries were derived from (README: resume-confirmation entries).
const NOTICE = "OATS resumed this session after it was lost (the host restarted or its terminal server ended). Continue from where you were.";
const COST = "claude-resume-cost-2.1.308";
const DOCUMENTED = "claude-resume-conversation-documented";
const BODY = "Resuming the full session will consume a substantial portion of your usage limits. We recommend resuming from a summary.";

const costDialog = first => [
  "This session is 3 days old and 182k tokens.", "", BODY, "",
  `❯ 1. ${first}`, "  2. Resume full session as-is", "  3. Don't ask me again", "", "Enter to confirm · Esc to cancel"];
const documentedDialog = [
  "Resume this conversation?", "", "This session is 5 days old and 140k tokens. Resuming it will use part of your usage limits.", "",
  "❯ 1. Resume", "  2. Start a new conversation", "", "Enter to confirm · Esc to cancel"];

/** Word-wrap one row to `width` columns, never breaking a word. */
function wrap(row, width) {
  const rows = [];
  let line = "";
  for (const word of row.split(" ")) {
    if (line && (line + " " + word).length > width) { rows.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  rows.push(line);
  return rows;
}
/** A dialog as a pane of `width` columns: `ruled` is Claude 2.1's style (a ─ rule
 *  above, two-space indent); `boxed` draws a ╭─╮ │ │ ╰─╯ box around it. */
function render(dialog, width, style) {
  const pad = row => row.padEnd(width);
  if (style === "ruled") {
    const body = dialog.flatMap(row => row ? wrap(row, width - 2).map(r => pad(`  ${r}`)) : [""]);
    return ["", "─".repeat(width), ...body, "", ""].join("\n") + "\n";
  }
  const inner = width - 4;
  const body = dialog.flatMap(row => row ? wrap(row, inner) : [""]).map(r => `│ ${r.padEnd(inner)} │`);
  return ["", `╭${"─".repeat(width - 2)}╮`, ...body, `╰${"─".repeat(width - 2)}╯`, ""].join("\n") + "\n";
}

const VARIANTS = [
  ["the resume-cost dialog, recommended", costDialog("Resume from summary (recommended)"), COST],
  ["the resume-cost dialog, instant and recommended", costDialog("Resume from summary (instant, recommended)"), COST],
  ["the documented 'Resume this conversation?' dialog", documentedDialog, DOCUMENTED],
];
const LAYOUTS = [["narrow (50 columns, ruled)", 50, "ruled"], ["narrow (50 columns, boxed)", 50, "boxed"],
  ["wide (120 columns, ruled)", 120, "ruled"], ["wide (120 columns, boxed)", 120, "boxed"], ["very narrow (20 columns, ruled)", 20, "ruled"]];

for (const [name, dialog, id] of VARIANTS) {
  for (const [layout, width, style] of LAYOUTS) {
    test(`matches ${name} at ${layout}`, () => {
      const screen = render(dialog, width, style);
      assert.ok(screen.split("\n").every(row => [...row].length <= width), "the rendered pane fits its width");
      assert.equal(matchResumeConfirmation(screen)?.id, id);
    });
  }
}

test("the narrow panes really wrap, labels included at 20 columns", () => {
  const narrow = render(costDialog("Resume from summary (recommended)"), 50, "ruled");
  assert.ok(!narrow.split("\n").some(row => row.includes(BODY)), "the body wraps at 50 columns");
  const veryNarrow = render(costDialog("Resume from summary (recommended)"), 20, "ruled");
  assert.ok(!veryNarrow.split("\n").some(row => row.includes("Resume from summary")), "the label wraps at 20 columns");
});

test("one label of a pair alone is no match", () => {
  const onlyFirst = costDialog("Resume from summary (recommended)").map(r => r.replace("Resume full session as-is", "Resume the whole session"));
  const onlySecond = costDialog("Resume from scratch").map(r => r);
  const onlyTitle = documentedDialog.map(r => r.replace("Start a new conversation", "Start over"));
  const onlyOption = documentedDialog.map(r => r.replace("Resume this conversation?", "Resume this session?"));
  for (const dialog of [onlyFirst, onlySecond, onlyTitle, onlyOption]) {
    for (const width of [50, 120]) assert.equal(matchResumeConfirmation(render(dialog, width, "ruled")), null);
  }
});

test("labels match only whole: a letter or digit next to one is no match", () => {
  for (const first of ["Resume from summaryX", "XResume from summary", "Resume from summary2"]) {
    assert.equal(matchResumeConfirmation(render(costDialog(first), 120, "ruled")), null, first);
  }
  assert.equal(matchResumeConfirmation("1. Resume from summary (recommended) 2. Resume full session as-isx"), null);
  assert.equal(matchResumeConfirmation("❯ 1. Resume from summary (recommended) 2. Resume full session as-is.")?.id, COST, "punctuation is not a letter");
  assert.equal(matchResumeConfirmation("Resume from summaryX Resume from summary Resume full session as-is")?.id, COST, "a later whole occurrence counts");
});

const sessionScreen = [
  "", " ▐▛███▜▌   Claude Code v2.1.308", "▝▜█████▛▘  Opus · Claude Max", "  ▘▘ ▝▝    ~/agents/x/work", "",
  ...wrap(`> ${NOTICE}`, 78), "", "● Picking up where I left off.", "", "─".repeat(80), "> ", "─".repeat(80), ""].join("\n");
const echoedOnly = ["", ...wrap(`> ${NOTICE}`, 48), "", "✻ Thinking…", ""].join("\n");
const bannerOnly = ["", " ▐▛███▜▌   Claude Code v2.1.308", "▝▜█████▛▘  Opus · Claude Max", "", "─".repeat(80), "> ", "─".repeat(80), ""].join("\n");

test("a working Claude session is no match", () => {
  assert.equal(matchResumeConfirmation(sessionScreen), null);
  assert.equal(matchResumeConfirmation(echoedOnly), null);
  assert.equal(matchResumeConfirmation(bannerOnly), null);
  for (const [name, screen] of Object.entries(sessions)) assert.equal(matchResumeConfirmation(screen), null, name);
  assert.equal(matchResumeConfirmation(""), null);
});

test("the shipped list loads: two frozen, report-only entries with derived provenance", () => {
  assert.deepEqual(RESUME_CONFIRMATION_ENTRIES.map(e => e.id), [COST, DOCUMENTED]);
  assert.deepEqual(RESUME_CONFIRMATION_ENTRIES.map(e => e.labels), [["Resume from summary", "Resume full session as-is"],
    ["Resume this conversation?", "Start a new conversation"]]);
  for (const entry of RESUME_CONFIRMATION_ENTRIES) {
    assert.equal(entry.kind, "resume-confirmation");
    assert.equal(entry.input, "none");
    assert.ok(!Object.hasOwn(entry, "selected"));
    assert.ok(entry.provenance.every(p => p.source === "derived"));
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.labels) && Object.isFrozen(entry.provenance[0]));
  }
  assert.ok(Object.isFrozen(RESUME_CONFIRMATION_ENTRIES));
  assert.doesNotThrow(() => validateResumeConfirmationEntries(structuredClone(RESUME_CONFIRMATION_ENTRIES)));
});

for (const [name, mutate] of [
  ["a selected option", e => { e.selected = "❯ 1. Resume from summary"; }],
  ["a selection marker in a label", e => { e.labels[0] = `❯ ${e.labels[0]}`; }],
  ["a selection marker in its note", e => { e.note = "❯ here"; }],
  ["an input other than none", e => { e.input = "Enter"; }],
  ["no input statement", e => { delete e.input; }],
  ["another kind", e => { e.kind = "confirmation"; }],
  ["one label", e => { e.labels = [e.labels[0]]; }],
  ["no labels", e => { delete e.labels; }],
  ["an empty label", e => { e.labels[1] = ""; }],
  ["a label that is not normalized", e => { e.labels[1] = "Resume full  session as-is"; }],
  ["a label with surrounding space", e => { e.labels[1] = " Resume full session as-is"; }],
  ["a provenance row without source", e => { delete e.provenance[0].source; }],
  ["no provenance", e => { e.provenance = []; }],
  ["no id", e => { delete e.id; }],
]) {
  test(`a hand-edited resume-confirmation entry with ${name} fails validation`, () => {
    const entries = structuredClone(RESUME_CONFIRMATION_ENTRIES);
    mutate(entries[0]);
    assert.throws(() => validateResumeConfirmationEntries(entries), /resume-confirmation entry/);
  });
}

test("duplicate ids and an empty list fail validation; the dev-channel loader refuses the kind", () => {
  const entries = structuredClone(RESUME_CONFIRMATION_ENTRIES);
  entries[1].id = entries[0].id;
  assert.throws(() => validateResumeConfirmationEntries(entries), /unique id/);
  assert.throws(() => validateResumeConfirmationEntries([]), /non-empty/);
  assert.throws(() => validateDevChannelEntries([...structuredClone(DEV_CHANNEL_ENTRIES), structuredClone(RESUME_CONFIRMATION_ENTRIES[0])]),
    /kind must be confirmation or flag-ignored/);
});

// The watcher, against a fake transport and an injected clock: instant.
const TARGET = Object.freeze({ socket: "/tmp/oats-test.sock", windowId: "@1", paneId: "%1", pid: "42" });
function fake(screens) {
  let t = 0, i = 0;
  const calls = { snapshots: [], sends: 0 };
  const transport = {
    snapshot(target, timeout) {
      assert.equal(target, TARGET);
      calls.snapshots.push({ at: t, timeout });
      const next = screens[Math.min(i++, screens.length - 1)];
      if (next instanceof Error) throw next;
      return { ...TARGET, width: 120, height: 30, text: next };
    },
    send() { calls.sends++; throw new Error("the resume watcher must never send a key"); },
  };
  return { calls, now: () => t, sleep: ms => { t += ms; }, transport, time: () => t };
}
const watch = (f, extra = {}) => watchResumeConfirmation({ transport: f.transport, target: TARGET, notice: NOTICE, now: f.now, sleep: f.sleep, ...extra });

test("the watcher reports the dialog at once, with no key", () => {
  const dialog = render(costDialog("Resume from summary (instant, recommended)"), 80, "ruled");
  const f = fake(["", "\n  loading\n", dialog]);
  assert.deepEqual(watch(f), { waiting: "resume-confirmation", entry: COST });
  assert.equal(f.calls.snapshots.length, 3);
  assert.equal(f.calls.sends, 0);
});

test("a dialog that appears after the session first showed still reports waiting", () => {
  const f = fake([sessionScreen, sessionScreen, sessionScreen, render(documentedDialog, 50, "boxed")]);
  assert.deepEqual(watch(f), { waiting: "resume-confirmation", entry: DOCUMENTED });
  assert.equal(f.calls.sends, 0);
});

test("the session screens are what they say", () => {
  assert.ok(showsClaudeSession(bannerOnly) && !normalizeScreen(bannerOnly).includes(NOTICE));
  assert.ok(!showsClaudeSession(echoedOnly) && normalizeScreen(echoedOnly).includes(NOTICE));
});

for (const [name, screen] of [["Claude's running-session banner", bannerOnly], ["the echoed notice", echoedOnly], ["banner and notice", sessionScreen]]) {
  test(`a working session (${name}) held for the settle window stops early: why session`, () => {
    const f = fake(["", screen]);
    assert.deepEqual(watch(f), { waiting: null, why: "session" });
    assert.ok(f.time() >= 2000 && f.time() < 3000, `stopped at ${f.time()} ms, well before the 20 s bound`);
    assert.equal(f.calls.sends, 0);
  });
}

test("an interrupted session run restarts the settle window", () => {
  const screens = [];
  for (let i = 0; i < 400; i++) screens.push(i % 15 === 14 ? "\n  something else\n" : sessionScreen);
  const f = fake(screens);
  assert.deepEqual(watch(f), { waiting: null, why: "bound" });
});

test("an unknown screen until the bound is not a block: why bound, within 20 s", () => {
  const f = fake(["\n  Some screen OATS does not know\n"]);
  assert.deepEqual(watch(f), { waiting: null, why: "bound" });
  assert.ok(f.time() >= 20000 && f.time() <= 20100, `ended at ${f.time()} ms`);
  assert.ok(f.calls.snapshots.every(s => s.timeout >= 1 && s.timeout <= 20000), "every snapshot gets the remaining bound");
  assert.equal(f.calls.sends, 0);
});

test("the bound never exceeds 20 s", () => {
  const f = fake(["\n  unknown\n"]);
  assert.deepEqual(watch(f, { limitMs: 600000 }), { waiting: null, why: "bound" });
  assert.ok(f.time() <= 20100, `ended at ${f.time()} ms`);
  const g = fake(["\n  unknown\n"]);
  assert.deepEqual(watch(g, { limitMs: 500 }), { waiting: null, why: "bound" });
  assert.ok(g.time() >= 500 && g.time() <= 600);
});

test("a snapshot that throws is unobservable, and the watcher stops", () => {
  for (const error of ["launch pane replaced", "launch pane is not exclusively owned", "can't find pane"]) {
    const f = fake(["", new Error(error), sessionScreen]);
    assert.deepEqual(watch(f), { waiting: null, why: "unobservable" });
    assert.equal(f.calls.snapshots.length, 2);
    assert.equal(f.calls.sends, 0);
  }
  const g = fake([]);
  g.transport.snapshot = () => ({ text: undefined });
  assert.deepEqual(watch(g), { waiting: null, why: "unobservable" });
});
