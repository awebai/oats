import { lstatSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { DEV_CHANNEL_ENTRIES, FLAG_IGNORED_ENTRIES, matchDevChannelEntry, matchFlagIgnoredEntry, devChannelDifference, normalizeScreen, showsClaudeSession } from "./launch-prompt-fixtures.mjs";
import { hasClaudeQuestionMarker } from "./launch-prompt-completion.mjs";

const LIMIT = 30000;
const INTERVAL = 100;
// The settle window. Before the Enter, an unknown screen is a verdict only once it has held this
// long unchanged: Claude paints transient frames while it starts (a logo mid-animation, a renderer
// notice) and, under load, holds one for a second or more. After the Enter, a start completes only
// once its captures have been clean (non-blank, no question marker, no entry) this long in a row,
// the screen free to change: a working session repaints all the time. No key is sent while waiting.
const SETTLE = 2000;
// The confirmation may stay painted briefly after its Enter; seen again after
// this long, it came back.
const RETURN = 2000;
const OBSERVATION_TIMEOUT = "blocked: observation timeout";
/** Whether a recorded reason says the screen never settled within the bound, so no prompt
 *  was established (a failed evidence write appends to the reason, never changes its start). */
export const neverSettled = (reason) => typeof reason === "string" && reason.startsWith(OBSERVATION_TIMEOUT);
const digest = (text) => createHash("sha256").update(text).digest("hex");
const sameTarget = (a, b, pid = true) => a && b && ["socket", "windowId", "paneId", ...(pid ? ["pid"] : [])].every(k => String(a[k]) === String(b[k]));
const validTarget = t => t && typeof t.socket === "string" && t.socket.length > 0 && /^@\d+$/.test(t.windowId) && /^%\d+$/.test(t.paneId) && /^[1-9]\d*$/.test(String(t.pid));
const wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Private, single-invocation authority over the development-channel
 * confirmation in the one pane this start created. The caller constructs it only
 * when the launch argv engages it (launchPromptEngages). It sends at most one
 * fixed Enter, and only while the normalized screen EQUALS a tolerance entry.
 * A screen whose notice block EQUALS a flag-ignored entry means Claude ignored
 * the flag and shows no confirmation: that start ends flag-ignored, with no key.
 * Transport captures visible bytes only and independently verifies ownership
 * around capture. Every call receives the remaining deadline.
 * audit receives launch-prompt event data and returns appendEvent's checked result.
 */
export function createLaunchPromptController({ home, startId, transport, audit, retainFrame, entries = DEV_CHANNEL_ENTRIES, flagIgnoredEntries = FLAG_IGNORED_ENTRIES,
  claudeVersion = "unknown", claudeVersionSource = "unknown", now = () => performance.now(), sleep = wait, expectedHomeIdentity }) {
  let identity;
  try {
    const st = lstatSync(home);
    if (!st.isDirectory() || realpathSync(home) !== home
      || (expectedHomeIdentity && (st.dev !== expectedHomeIdentity.dev || st.ino !== expectedHomeIdentity.ino))) throw new Error("home identity");
    identity = { dev: st.dev, ino: st.ino };
  } catch { /* Observation reports a retained blocked result, not a launch throw. */ }
  const tokens = new WeakMap();
  const deadline = now() + LIMIT;
  let used = false, terminal, target, lastText = "", auditFailed = false;
  const answers = [], receipts = [];
  function checkHome() {
    if (!identity || !startId) throw new Error("home identity changed");
    const st = lstatSync(home);
    if (!st.isDirectory() || st.dev !== identity.dev || st.ino !== identity.ino || realpathSync(home) !== home) throw new Error("home identity changed");
  }
  function remaining() {
    const left = deadline - now();
    if (!(left > 0)) throw new Error("observation timeout");
    return Math.max(1, Math.ceil(left));
  }
  function capture(t) {
    checkHome();
    if (!validTarget(t)) throw new Error("invalid target");
    const screen = transport.snapshot(t, remaining());
    remaining();
    checkHome();
    if (!sameTarget(t, screen) || !Number.isInteger(screen.width) || screen.width < 1 || !Number.isInteger(screen.height) || screen.height < 1 || typeof screen.text !== "string") throw new Error("target or geometry changed");
    lastText = screen.text;
    return { ...screen };
  }
  function record(data) {
    let result;
    try {
      checkHome();
      result = audit({ home, startId, socket: target?.socket, windowId: target?.windowId,
        paneId: target?.paneId, pid: target?.pid, claudeVersion, claudeVersionSource, ...data });
    } catch { auditFailed = true; return false; }
    // Preserve actual appendEvent paths, including partial-log availability.
    if (result && Array.isArray(result.results)) receipts.push({ ok: result.ok === true, ...(result.row ? { row: structuredClone(result.row) } : {}), results: result.results.map(r => ({ ...r })) });
    if (result?.ok !== true) auditFailed = true;
    return result?.ok === true;
  }
  function finish(status, reason, extra = {}) {
    if (terminal) return terminal;
    if (auditFailed) {
      status = "incomplete";
      reason = "launch prompt audit failed";
    }
    const recorded = record({ status, reason, signatureDigest: digest(lastText), ...extra });
    if (!recorded || auditFailed) {
      status = "incomplete";
      reason = "launch prompt audit failed";
    }
    // A blocked result carries what differed, and whether Claude's session UI was
    // shown, for the readiness warning (R2).
    terminal = { status, answers: answers.map(a => ({ ...a })), reason, receipt: receipts,
      ...(status === "flag-ignored" ? { signatureId: extra.signatureId } : {}),
      ...(status === "blocked" && extra.differed ? { differed: extra.differed } : {}),
      ...(status === "blocked" && extra.claudeSessionShown ? { claudeSessionShown: true } : {}) };
    return terminal;
  }
  const exact = (a, b) => sameTarget(a, b) && a.width === b.width && a.height === b.height && a.text === b.text;
  function retain(screen, outcome, recognition) {
    try {
      return retainFrame?.({ home, homeIdentity: { ...identity }, startId, target: { ...target },
        screen: { text: screen.text, width: screen.width, height: screen.height }, outcome, recognition })?.ok === true;
    } catch { return false; } // No raw text, OS diagnostic or private receipt escapes.
  }
  // A loud miss: the receipt row says what differed; private evidence holds the
  // exact compared screen, never the row.
  // Before any Enter, Claude's running-session banner on the blocked screen says
  // the session may already be up with the flag ignored and its notice hidden.
  function blocked(screen, reason, beforeEnter = false) {
    const sessionShown = beforeEnter && showsClaudeSession(screen.text);
    if (!retain(screen, "blocked", "unmatched")) reason += "; private launch evidence retention failed";
    return finish("blocked", reason, { differed: devChannelDifference(screen.text, entries), ...(sessionShown ? { claudeSessionShown: true } : {}) });
  }
  function observe(t, before) {
    if (used) return terminal ?? { status: "blocked", answers: [], reason: "blocked: launch authority already used", receipt: [] };
    used = true;
    target = { ...t };
    // `unknown` is the last non-blank screen before the Enter that equalled no entry: a screen
    // that never settles is an observation timeout at the bound, and says what differed.
    // After the Enter: `clean` is when the current run of clean captures began, `left` whether the
    // confirmation has been off screen since, and `last` the last non-blank screen.
    let fresh = before === undefined, enteredAt, pending, unknown, clean, left = false, last;
    const submitted = () => answers.length === 1 && answers[0].status === "submitted";
    try {
      checkHome();
      if (!validTarget(target)) return finish("blocked", "blocked: invalid target");
      if (before !== undefined && (!before || !sameTarget(target, before, false) || String(target.pid) === String(before.pid))) return finish("blocked", "blocked: respawn ownership not proven");
      // Hard iteration bound also protects against a broken injected clock.
      for (let observations = 0; observations <= LIMIT / INTERVAL; observations++) {
        const screen = capture(target);
        if (!fresh) {
          // A resize can reflow the *old* prompt into different bytes that still
          // normalize to an entry. Require a fresh process screen at the original geometry.
          if (screen.width !== before.width || screen.height !== before.height) return finish("blocked", "blocked: respawn geometry changed before fresh screen");
          if (screen.text !== before.text) fresh = true;
        }
        const reading = normalizeScreen(screen.text);
        if (!fresh || reading === "") {
          // A blank screen restarts any window; after the Enter it also means the confirmation left.
          pending = undefined;
          if (submitted()) { clean = undefined; left = true; }
          sleep(Math.min(INTERVAL, remaining()));
          continue;
        }
        const entry = matchDevChannelEntry(screen.text, entries);
        if (submitted()) {
          // Completion reporting only, never input authority: no key follows.
          last = screen;
          if (entry) {
            // Still painted just after the Enter is waited out; back after leaving, or still there
            // after RETURN, it came back.
            if (left || now() - enteredAt >= RETURN) return blocked(screen, "blocked: repeated or unsupported prompt");
            clean = undefined;
          } else if (hasClaudeQuestionMarker(screen.text)) {
            return blocked(screen, "blocked: unexpected prompt");
          } else {
            left = true;
            clean ??= now();
            if (now() - clean >= SETTLE) {
              if (!retain(screen, "completed", "stable-screen")) return finish("incomplete", "private launch evidence retention failed");
              return finish("completed", "recognized launch boundary", { signatureId: answers[0].signatureId });
            }
          }
          sleep(Math.min(INTERVAL, remaining()));
          continue;
        }
        if (!entry) {
          // A question beside the notice means someone must answer: that screen is a miss.
          const ignored = !hasClaudeQuestionMarker(screen.text) && matchFlagIgnoredEntry(screen.text, flagIgnoredEntries);
          if (ignored) {
            // Claude ignored the flag and asks nothing: no key, ever.
            if (!retain(screen, "flag-ignored", "notice-block")) return finish("incomplete", "private launch evidence retention failed");
            return finish("flag-ignored", "channels-unavailable", { signatureId: ignored.id });
          }
          // A screen still being painted keeps changing; an unknown one that
          // holds still for the settle window is a miss, and blocks without any key.
          unknown = screen;
          if (pending?.reading === reading && now() - pending.at >= SETTLE) return blocked(screen, "blocked: unexpected prompt", true);
          if (pending?.reading !== reading) pending = { reading, at: now() };
          sleep(Math.min(INTERVAL, remaining()));
          continue;
        }
        const expected = screen;
        if (!exact(capture(target), expected)) return finish("blocked", "blocked: prompt changed before input");
        const fields = { signatureId: entry.id, signatureDigest: digest(expected.text), class: "awebDevelopmentChannel", key: "Enter" };
        if (!record({ ...fields, status: "attempted" })) {
          terminal = { status: "incomplete", answers: answers.map(a => ({ ...a })), reason: "launch prompt audit failed", receipt: receipts };
          return terminal;
        }
        // Durable intent may take time or run hooks. Revalidate the visible
        // signature, PID and home again after it and immediately before input.
        if (!exact(capture(target), expected)) return finish("blocked", "blocked: prompt changed before input", fields);
        let outcome = "uncertain";
        try {
          checkHome();
          const sent = transport.send(target, "Enter", remaining());
          outcome = sent?.status === "submitted" ? "submitted" : sent?.status === "failed" ? "failed" : "uncertain";
        } catch { /* A thrown send might already have delivered the key. */ }
        if (!record({ ...fields, status: outcome })) {
          terminal = { status: "incomplete", answers: answers.map(a => ({ ...a })), reason: "launch prompt audit failed after possible input", receipt: receipts };
          return terminal;
        }
        if (outcome !== "submitted") return finish("incomplete", `launch prompt input ${outcome}`, fields);
        answers.push({ class: "awebDevelopmentChannel", signatureId: entry.id, status: "submitted" });
        enteredAt = now();
        pending = undefined;
        sleep(Math.min(INTERVAL, remaining()));
      }
      throw new Error("observation timeout");
    } catch (error) {
      if (error?.message !== "observation timeout") return finish("blocked", "blocked: launch observation failed");
      // After the Enter, no complete clean window by the bound: an observation timeout, with the one
      // Enter recorded in the answers.
      if (submitted()) return last ? blocked(last, OBSERVATION_TIMEOUT) : finish("blocked", OBSERVATION_TIMEOUT);
      // A screen still changing at the bound never settled into a prompt: an observation timeout,
      // with what differed and the last screen kept as evidence.
      return unknown ? blocked(unknown, OBSERVATION_TIMEOUT, true) : finish("blocked", OBSERVATION_TIMEOUT);
    }
  }
  return {
    captureBeforeRespawn(t) {
      if (used) return Object.freeze({ ok: false, reason: "launch authority already used" });
      try {
        const snapshot = capture({ ...t });
        const token = Object.freeze({ ok: true });
        tokens.set(token, snapshot);
        return token;
      } catch { return Object.freeze({ ok: false, reason: "prior pane capture failed" }); }
    },
    observeNew(t) { return observe(t); },
    observeRespawn(t, token) {
      const before = tokens.get(token);
      tokens.delete(token);
      return observe(t, before ?? null);
    },
  };
}
