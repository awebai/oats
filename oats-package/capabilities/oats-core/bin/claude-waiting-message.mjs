#!/usr/bin/env node
/**
 * oats.core: the text of a Claude Code waiting claim (awebai/oats#1502).
 *
 * claude-waiting.sh runs this on a `set`, with the hook's JSON input on stdin, and passes what it
 * prints as `--message` to `oats instance waiting set`. It reads what Claude Code 2.1.300 sends:
 * a PreToolUse of AskUserQuestion carries the question itself (`tool_input.questions[].question`),
 * and a Notification its own words (`message`, "Claude needs your permission to use Bash"). A
 * StopFailure (2.1.308) carries the error's text (`last_assistant_message`, "API Error: 400 …")
 * and its class (`error`, "rate_limit", "unknown").
 *
 * What it prints is one message the kernel accepts (lib/instance-events.mjs validWaitingMessage):
 * one line, the kernel's refused characters replaced with U+FFFD, at most 200 code points. Nothing
 * for an input that says nothing it can use, and nothing at all on any failure: the claim is then
 * set without a text. It always exits 0.
 *
 * With the argument `failed-turn` it prints the reason first, then a space, then that message.
 */
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The characters the kernel refuses in a claim's message: a copy of its set (lib/refused-text.mjs
 *  REFUSED_TEXT), which a capability cannot import. A test pins the two equal. */
export const MESSAGE_REFUSED = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF\u{E0000}-\u{E007F}]/u;
const MESSAGE_REFUSED_ALL = new RegExp(MESSAGE_REFUSED.source, "gu");
/** The kernel's longest message, in code points (lib/instance-events.mjs WAITING_MESSAGE_MAX). */
const MESSAGE_MAX = 200;

/** The StopFailure `error` classes known to open nothing an Enter answers (#1670). Claude's limit
 *  menu opens from a usage-limit text, which only `rate_limit` carries; these were failed in a real
 *  pane, on an API key, and a paste and an Enter then reached the model. Every other class, a new one
 *  included, takes `question`, so a wake holds rather than answer what nobody saw. */
const NO_DIALOG_FAILURES = new Set(["unknown", "invalid_request", "authentication_failed", "billing_error", "oauth_org_not_allowed", "model_not_found", "server_error", "max_output_tokens"]);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const said = (v) => typeof v === "string" && v.trim() !== "";

/** The words the input says the session waits on, before they are made one message, or null. */
function wordsOf(input) {
  if (!isObject(input)) return null;
  if (input.hook_event_name === "StopFailure") {
    const error = [input.last_assistant_message, input.error].find(said);
    return error === undefined ? "Turn failed" : `Turn failed: ${error}`;
  }
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

/** A failed turn's claim for a hook's JSON input (a string): its reason, a space, its message.
 *  Only a class known to open no dialog is `attention`; an input that names none is `question`. */
export function failedTurnOf(text) {
  let input;
  try { input = JSON.parse(text); } catch { return "question "; }
  return `${isObject(input) && NO_DIALOG_FAILURES.has(input.error) ? "attention" : "question"} ${waitingMessageOf(text)}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const read = process.argv[2] === "failed-turn" ? failedTurnOf : waitingMessageOf;
    process.stdout.write(read(readFileSync(0, "utf8")));
  } catch { /* no text */ }
  process.exitCode = 0;
}
