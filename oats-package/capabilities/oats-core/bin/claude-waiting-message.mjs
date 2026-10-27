#!/usr/bin/env node
/**
 * oats.core: the text of a Claude Code waiting claim (awebai/oats#1502).
 *
 * claude-waiting.sh runs this on a `set`, with the hook's JSON input on stdin, and passes what it
 * prints as `--message` to `oats instance waiting set`. It reads what Claude Code 2.1.300 sends:
 * a PreToolUse of AskUserQuestion carries the question itself (`tool_input.questions[].question`),
 * and a Notification its own words (`message`, "Claude needs your permission to use Bash").
 *
 * What it prints is one message the kernel accepts (lib/instance-events.mjs validWaitingMessage):
 * one line, the kernel's refused characters replaced with U+FFFD, at most 200 code points. Nothing
 * for an input that says nothing it can use, and nothing at all on any failure: the claim is then
 * set without a text. It always exits 0.
 */
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The characters the kernel refuses in a claim's message: a copy of its set (lib/refused-text.mjs
 *  REFUSED_TEXT), which a capability cannot import. A test pins the two equal. */
export const MESSAGE_REFUSED = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF\u{E0000}-\u{E007F}]/u;
const MESSAGE_REFUSED_ALL = new RegExp(MESSAGE_REFUSED.source, "gu");
/** The kernel's longest message, in code points (lib/instance-events.mjs WAITING_MESSAGE_MAX). */
const MESSAGE_MAX = 200;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The words the input says the session waits on, before they are made one message, or null. */
function wordsOf(input) {
  if (!isObject(input)) return null;
  if (input.hook_event_name === "PreToolUse") {
    if (input.tool_name !== "AskUserQuestion" || !isObject(input.tool_input) || !Array.isArray(input.tool_input.questions)) return null;
    const questions = input.tool_input.questions;
    const first = questions[0]?.question;
    if (typeof first !== "string") return null;
    return questions.length > 1 ? `${first} (+${questions.length - 1} more)` : first;
  }
  return typeof input.message === "string" ? input.message : null;
}

/** The claim's message for a hook's JSON input (a string), or "" when there is none. */
export function waitingMessageOf(text) {
  let input;
  try { input = JSON.parse(text); } catch { return ""; }
  const words = wordsOf(input);
  if (words === null) return "";
  const line = words.replace(/\s+/gu, " ").trim().replace(MESSAGE_REFUSED_ALL, "�");
  const points = [...line];
  return points.length > MESSAGE_MAX ? `${points.slice(0, MESSAGE_MAX - 1).join("")}…` : line;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try { process.stdout.write(waitingMessageOf(readFileSync(0, "utf8"))); } catch { /* no text */ }
  process.exitCode = 0;
}
