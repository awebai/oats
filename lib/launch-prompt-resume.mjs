import { performance } from "node:perf_hooks";
import { RESUME_CONFIRMATION_ENTRIES, matchResumeConfirmation, normalizeScreen, showsClaudeSession } from "./launch-prompt-fixtures.mjs";

// The longest a resumed start is watched for Claude's resume-cost dialog.
const BOUND = 20000;
const wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Watch a resumed Claude session's pane for the dialog asking how to resume a
 *  long, inactive conversation, and report it. Report-only: this never sends a
 *  key and never calls transport.send; the operator answers the dialog.
 *
 *  Polls transport.snapshot(target, remaining) until the bound (at most 20 s):
 *  - a screen matching a resume-confirmation entry → { waiting: "resume-confirmation", entry: <id> }, at once;
 *  - a working session held for settleMs with no match → { waiting: null, why: "session" };
 *  - a snapshot that throws (pane gone, replaced, not exclusively owned) → { waiting: null, why: "unobservable" };
 *  - anything else at the bound → { waiting: null, why: "bound" }: an unknown screen is not a block. */
export function watchResumeConfirmation({ transport, target, notice, limitMs = BOUND, intervalMs = 100, settleMs = 2000,
  now = () => performance.now(), sleep = wait, entries = RESUME_CONFIRMATION_ENTRIES }) {
  const limit = Math.min(Number.isFinite(limitMs) && limitMs > 0 ? limitMs : BOUND, BOUND);
  const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 100;
  const echoed = typeof notice === "string" ? normalizeScreen(notice) : "";
  const deadline = now() + limit;
  // When the current run of working-session screens without a match began.
  let session;
  // Hard iteration bound also protects against a broken injected clock.
  for (let observations = 0; observations <= limit / interval; observations++) {
    const left = deadline - now();
    if (!(left > 0)) break;
    let text;
    try {
      const screen = transport.snapshot(target, Math.max(1, Math.ceil(left)));
      if (typeof screen?.text !== "string") throw new Error("no screen text");
      text = screen.text;
    } catch {
      return { waiting: null, why: "unobservable" };
    }
    const entry = matchResumeConfirmation(text, entries);
    if (entry) return { waiting: "resume-confirmation", entry: entry.id };
    // Claude shows this dialog on the first message after resuming, so a session
    // that shows that message (the notice, echoed as its first turn) or Claude's
    // running-session banner without the dialog, held for the settle window, has
    // passed it. A false early stop costs only a missing "waiting" line, never a key.
    if (showsClaudeSession(text) || (echoed && normalizeScreen(text).includes(echoed))) {
      session ??= now();
      if (now() - session >= settleMs) return { waiting: null, why: "session" };
    } else {
      session = undefined;
    }
    const rest = deadline - now();
    if (!(rest > 0)) break;
    sleep(Math.min(interval, rest));
  }
  return { waiting: null, why: "bound" };
}
