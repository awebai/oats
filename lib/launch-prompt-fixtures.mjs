import { readFileSync, realpathSync } from "node:fs";

const PLUGIN = "plugin:aweb-channel@awebai-marketplace";
const DEVELOPMENT = "--dangerously-load-development-channels";
const SELECTION = "❯";
// Claude's notices sit in a block of rows that each begin with this bar.
const NOTICE_BAR = "▎";
const SNIPPET = 40;

function channelEligible(argv) {
  if (!Array.isArray(argv) || argv.some(a => typeof a !== "string")) return false;
  const channelFlags = argv.filter(a => a === DEVELOPMENT || a.startsWith(DEVELOPMENT + "=") || a === "--channels" || a.startsWith("--channels="));
  if (channelFlags.length !== 1 || channelFlags[0] !== DEVELOPMENT) return false;
  const at = argv.indexOf(DEVELOPMENT);
  if (argv[at + 1] !== PLUGIN) return false;
  // Variadic channel arguments must end before another flag or end of argv.
  if (at + 2 < argv.length && !argv[at + 2].startsWith("--")) return false;
  return argv.filter(a => a.startsWith("plugin:")).length === 1;
}

/** The launcher confirms Claude's development-channel prompt exactly when it
 *  starts Claude with the single aweb development-channel argument: the argv is
 *  the decision, there is no other consent. argv excludes the executable. */
export function launchPromptEngages({ harness, argv }) {
  return harness === "claude" && channelEligible(argv);
}

/** The enumerated tolerance, and only this: drop rows made only of box-drawing
 *  characters (U+2500–U+257F) and whitespace, join the rest with single spaces
 *  collapsing every whitespace run, trim. This absorbs wrapping at any pane
 *  width, indentation and padding. No case folding, removal or pattern. */
export function normalizeScreen(text) {
  return String(text).split("\n").filter(row => !/^[\s─-╿]*$/u.test(row)).join(" ").replace(/\s+/gu, " ").trim();
}

const count = (text, part) => text.split(part).length - 1;

/** Reject an entry whose text could confirm anything but the affirmative option
 *  for the one aweb channel: one selection marker, immediately before `1.`.
 *  A `flag-ignored` entry is the notice Claude shows when it ignores the flag:
 *  it names the flag and the one channel, and carries no option or selection. */
export function validateDevChannelEntries(entries) {
  const bad = (entry, why) => { throw new Error(`dev-channel tolerance entry ${JSON.stringify(entry?.id ?? null)}: ${why}`); };
  if (!Array.isArray(entries) || !entries.length) bad(null, "the list must be a non-empty array");
  const ids = new Set();
  for (const entry of entries) {
    if (typeof entry?.id !== "string" || !entry.id || ids.has(entry.id)) bad(entry, "needs a unique id");
    ids.add(entry.id);
    if (!["confirmation", "flag-ignored"].includes(entry.kind)) bad(entry, "kind must be confirmation or flag-ignored");
    if (typeof entry.text !== "string" || !entry.text || normalizeScreen(entry.text) !== entry.text) bad(entry, "text must be non-empty and already normalized");
    if (entry.kind === "confirmation") {
      if (count(entry.text, SELECTION) !== 1 || !entry.text.includes(`${SELECTION} 1. `)) bad(entry, `${SELECTION} must occur exactly once, immediately before option 1.`);
      if (typeof entry.selected !== "string" || !entry.selected.startsWith(`${SELECTION} 1. `) || !entry.text.includes(entry.selected)) bad(entry, `selected must be the ${SELECTION} 1. option line within text`);
    } else {
      if (entry.input !== "none") bad(entry, "a flag-ignored notice takes no input: input must be \"none\"");
      if (entry.text.includes(SELECTION) || Object.hasOwn(entry, "selected")) bad(entry, `a flag-ignored notice has no ${SELECTION} and no selected option`);
      if (count(entry.text, DEVELOPMENT) !== 1) bad(entry, `text must name ${DEVELOPMENT} once`);
    }
    if (count(entry.text, "plugin:") !== 1 || count(entry.text, PLUGIN) !== 1) bad(entry, `text must name exactly one channel, ${PLUGIN}`);
    if (!Array.isArray(entry.provenance) || !entry.provenance.length
      || entry.provenance.some(p => ["claudeVersion", "platform", "capturedAt", "source"].some(k => typeof p?.[k] !== "string" || !p[k]))) {
      bad(entry, "provenance must list captures, each with claudeVersion, platform, capturedAt and source");
    }
  }
  return deepFreeze(entries);
}
function deepFreeze(value) {
  if (value && typeof value === "object") { for (const v of Object.values(value)) deepFreeze(v); Object.freeze(value); }
  return value;
}

/** The shipped tolerance list, by kind. A new Claude wording is a new entry with
 *  its captured provenance, in a reviewed change; see launch-prompt-fixtures/README.md. */
const SHIPPED = validateDevChannelEntries(
  JSON.parse(readFileSync(new URL("./launch-prompt-fixtures/dev-channel-confirmation.json", import.meta.url), "utf8")).entries);
export const DEV_CHANNEL_ENTRIES = Object.freeze(SHIPPED.filter(entry => entry.kind === "confirmation"));
export const FLAG_IGNORED_ENTRIES = Object.freeze(SHIPPED.filter(entry => entry.kind === "flag-ignored"));

/** The confirmation entry whose text the normalized screen EQUALS, or null. Never a contains test. */
export function matchDevChannelEntry(text, entries = DEV_CHANNEL_ENTRIES) {
  const screen = normalizeScreen(text);
  return entries.find(entry => entry.kind === "confirmation" && entry.text === screen) ?? null;
}

/** The screen's notice blocks: each maximal run of rows that begin with the
 *  notice bar, with the bar dropped from each row, normalized. */
function noticeBlocks(text) {
  const blocks = [];
  let rows = null;
  for (const row of String(text).split("\n")) {
    if (row.startsWith(NOTICE_BAR)) (rows ??= []).push(row.slice(NOTICE_BAR.length));
    else if (rows) { blocks.push(normalizeScreen(rows.join("\n"))); rows = null; }
  }
  if (rows) blocks.push(normalizeScreen(rows.join("\n")));
  return blocks;
}

/** The flag-ignored entry one notice block of the screen EQUALS, or null: equality
 *  of a delimited block, never a contains test on the screen. */
export function matchFlagIgnoredEntry(text, entries = FLAG_IGNORED_ENTRIES) {
  const blocks = noticeBlocks(text);
  return entries.find(entry => entry.kind === "flag-ignored" && blocks.includes(entry.text)) ?? null;
}

/** Reject a resume-confirmation entry that could be anything but a report: it
 *  takes no input, carries no selection, and names at least two whole option
 *  labels, each already normalized. These entries are derived from Claude's
 *  strings and documentation, not captured (launch-prompt-fixtures/README.md),
 *  so they are matched by labels, and they never gate a key. */
export function validateResumeConfirmationEntries(entries) {
  const bad = (entry, why) => { throw new Error(`resume-confirmation entry ${JSON.stringify(entry?.id ?? null)}: ${why}`); };
  if (!Array.isArray(entries) || !entries.length) bad(null, "the list must be a non-empty array");
  const ids = new Set();
  for (const entry of entries) {
    if (typeof entry?.id !== "string" || !entry.id || ids.has(entry.id)) bad(entry, "needs a unique id");
    ids.add(entry.id);
    if (entry.kind !== "resume-confirmation") bad(entry, "kind must be resume-confirmation");
    if (entry.input !== "none") bad(entry, "a resume confirmation is only reported: input must be \"none\"");
    if (Object.hasOwn(entry, "selected")) bad(entry, "a resume confirmation has no selected option");
    if (JSON.stringify(entry).includes(SELECTION)) bad(entry, `a resume confirmation carries no ${SELECTION}`);
    if (!Array.isArray(entry.labels) || entry.labels.length < 2) bad(entry, "labels must list at least two option labels");
    if (entry.labels.some(label => typeof label !== "string" || !label || normalizeScreen(label) !== label)) bad(entry, "each label must be non-empty and already normalized");
    if (!Array.isArray(entry.provenance) || !entry.provenance.length || entry.provenance.some(p => typeof p?.source !== "string" || !p.source)) {
      bad(entry, "provenance must list rows, each with a source");
    }
  }
  return deepFreeze(entries);
}

/** The shipped resume-confirmation entries: report-only, see launch-prompt-fixtures/README.md. */
export const RESUME_CONFIRMATION_ENTRIES = Object.freeze(validateResumeConfirmationEntries(
  JSON.parse(readFileSync(new URL("./launch-prompt-fixtures/resume-confirmation.json", import.meta.url), "utf8")).entries));

const WORD = /[\p{L}\p{N}]/u;
/** Whether `label` occurs in `screen` as a whole label: an occurrence neither
 *  preceded nor followed by a letter or digit. */
function hasWholeLabel(screen, label) {
  for (let at = screen.indexOf(label); at >= 0; at = screen.indexOf(label, at + 1)) {
    const before = [...screen.slice(Math.max(0, at - 2), at)].at(-1) ?? "";
    const next = screen.codePointAt(at + label.length);
    const after = next === undefined ? "" : String.fromCodePoint(next);
    if (!WORD.test(before) && !WORD.test(after)) return true;
  }
  return false;
}

/** The resume-confirmation entry whose labels ALL appear as whole labels in the
 *  normalized screen, or null. Report-only: a match never authorizes a key. */
export function matchResumeConfirmation(text, entries = RESUME_CONFIRMATION_ENTRIES) {
  const screen = normalizeScreen(text);
  return entries.find(entry => entry.kind === "resume-confirmation" && entry.labels.every(label => hasWholeLabel(screen, label))) ?? null;
}

// Claude's running-session banner, as every captured session screen starts
// (2.1.289 and 2.1.296): `Claude Code v<semver>`, after the logo's row. The logo
// animates, so its row is any run of block elements (U+2580–U+259F) and spaces.
const SESSION_BANNER = /^[▀-▟ ]*Claude Code v\d+\.\d+\.\d+(?: |$)/u;

/** What a blocked start that showed Claude's running-session banner adds to its
 *  error and readiness remedy: the notice saying Claude ignored the flag may be hidden. */
export const CLAUDE_SESSION_HINT = "Claude may have reported that channels are not currently available and ignored the development-channel flag, its notice hidden behind another one: look at the pane. If the session is running, restart the instance, and the notice will then show. Check first for a telemetry opt-out in the launch environment (DISABLE_TELEMETRY, DO_NOT_TRACK or CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC), then whether this Claude account offers channels; otherwise change the messaging provider's delivery (its readiness warning says where the setting is). See docs/configuration.md#the-development-channel-confirmation.";

/** Whether the normalized screen starts with Claude's running-session banner: a
 *  session is up, so no prompt is in front of it. Only a hint for a blocked start,
 *  never input authority. */
export function showsClaudeSession(text) {
  return SESSION_BANNER.test(normalizeScreen(text));
}

/** What a non-matching screen differed in, against the entry with the longest
 *  common prefix: bounded snippets of the normalized texts, never the screen. */
export function devChannelDifference(text, entries = DEV_CHANNEL_ENTRIES) {
  const screen = normalizeScreen(text);
  let best, index = -1;
  for (const entry of entries) {
    let i = 0;
    while (i < entry.text.length && i < screen.length && entry.text[i] === screen[i]) i++;
    if (i > index) { best = entry; index = i; }
  }
  return { nearest: best.id, firstDifference: { index, expected: best.text.slice(index, index + SNIPPET), found: screen.slice(index, index + SNIPPET) } };
}

/** Claude's version for the audit, read without executing the harness: the
 *  first plain-semver segment, from the end, of the executable's real path
 *  (`…/claude-code@latest/2.1.296/claude`, `…/claude/versions/2.1.296`).
 *  Informational only; it never gates. */
export function claudeVersionOf(executablePath) {
  try {
    const segment = realpathSync(executablePath).split("/").reverse().find(part => /^\d+\.\d+\.\d+$/.test(part));
    if (segment) return { claudeVersion: segment, claudeVersionSource: "executable-path" };
  } catch { /* unresolvable path: unknown */ }
  return { claudeVersion: "unknown", claudeVersionSource: "unknown" };
}
