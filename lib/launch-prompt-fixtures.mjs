import { readFileSync, realpathSync } from "node:fs";

const PLUGIN = "plugin:aweb-channel@awebai-marketplace";
const DEVELOPMENT = "--dangerously-load-development-channels";
const SELECTION = "❯";
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
 *  for the one aweb channel: one selection marker, immediately before `1.`. */
export function validateDevChannelEntries(entries) {
  const bad = (entry, why) => { throw new Error(`dev-channel tolerance entry ${JSON.stringify(entry?.id ?? null)}: ${why}`); };
  if (!Array.isArray(entries) || !entries.length) bad(null, "the list must be a non-empty array");
  const ids = new Set();
  for (const entry of entries) {
    if (typeof entry?.id !== "string" || !entry.id || ids.has(entry.id)) bad(entry, "needs a unique id");
    ids.add(entry.id);
    if (typeof entry.text !== "string" || !entry.text || normalizeScreen(entry.text) !== entry.text) bad(entry, "text must be non-empty and already normalized");
    if (count(entry.text, SELECTION) !== 1 || !entry.text.includes(`${SELECTION} 1. `)) bad(entry, `${SELECTION} must occur exactly once, immediately before option 1.`);
    if (typeof entry.selected !== "string" || !entry.selected.startsWith(`${SELECTION} 1. `) || !entry.text.includes(entry.selected)) bad(entry, `selected must be the ${SELECTION} 1. option line within text`);
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

/** The shipped tolerance list. A new Claude wording is a new entry with its
 *  captured provenance, in a reviewed change; see launch-prompt-fixtures/README.md. */
export const DEV_CHANNEL_ENTRIES = validateDevChannelEntries(
  JSON.parse(readFileSync(new URL("./launch-prompt-fixtures/dev-channel-confirmation.json", import.meta.url), "utf8")).entries);

/** The entry whose text the normalized screen EQUALS, or null. Never a contains test. */
export function matchDevChannelEntry(text, entries = DEV_CHANNEL_ENTRIES) {
  const screen = normalizeScreen(text);
  return entries.find(entry => entry.text === screen) ?? null;
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
