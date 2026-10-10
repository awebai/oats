import { lstatSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { DEV_CHANNEL_ENTRIES, matchDevChannelEntry, devChannelDifference, normalizeScreen } from "./launch-prompt-fixtures.mjs";
import { hasClaudeQuestionMarker } from "./launch-prompt-completion.mjs";

const LIMIT = 30000;
const INTERVAL = 100;
// Two captures this far apart with the same reading make a screen stable.
const STABLE = 200;
// The confirmation may stay painted briefly after its Enter; seen again after
// this long, it came back.
const RETURN = 2000;
const digest = (text) => createHash("sha256").update(text).digest("hex");
const sameTarget = (a, b, pid = true) => a && b && ["socket", "windowId", "paneId", ...(pid ? ["pid"] : [])].every(k => String(a[k]) === String(b[k]));
const validTarget = t => t && typeof t.socket === "string" && t.socket.length > 0 && /^@\d+$/.test(t.windowId) && /^%\d+$/.test(t.paneId) && /^[1-9]\d*$/.test(String(t.pid));
const wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Private, single-invocation authority over the development-channel
 * confirmation in the one pane this start created. The caller constructs it only
 * when the launch argv engages it (launchPromptEngages). It sends at most one
 * fixed Enter, and only while the normalized screen EQUALS a tolerance entry.
 * Transport captures visible bytes only and independently verifies ownership
 * around capture. Every call receives the remaining deadline.
 * audit receives launch-prompt event data and returns appendEvent's checked result.
 */
export function createLaunchPromptController({ home, startId, transport, audit, retainFrame, entries = DEV_CHANNEL_ENTRIES,
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
    // A blocked result carries what differed, for the readiness warning (R2).
    terminal = { status, answers: answers.map(a => ({ ...a })), reason, receipt: receipts, ...(status === "blocked" && extra.differed ? { differed: extra.differed } : {}) };
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
  function blocked(screen, reason) {
    if (!retain(screen, "blocked", "unmatched")) reason += "; private launch evidence retention failed";
    return finish("blocked", reason, { differed: devChannelDifference(screen.text, entries) });
  }
  function observe(t, before) {
    if (used) return terminal ?? { status: "blocked", answers: [], reason: "blocked: launch authority already used", receipt: [] };
    used = true;
    target = { ...t };
    let fresh = before === undefined, enteredAt, pending;
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
          pending = undefined;
          sleep(Math.min(INTERVAL, remaining()));
          continue;
        }
        const entry = matchDevChannelEntry(screen.text, entries);
        if (submitted()) {
          // Completion reporting only, never input authority: no key follows.
          if (entry) {
            if (now() - enteredAt >= RETURN) return blocked(screen, "blocked: repeated or unsupported prompt");
            pending = undefined;
          } else if (hasClaudeQuestionMarker(screen.text)) {
            return blocked(screen, "blocked: unexpected prompt");
          } else if (pending && now() - pending.at >= STABLE) {
            if (!retain(screen, "completed", "stable-screen")) return finish("incomplete", "private launch evidence retention failed");
            return finish("completed", "recognized launch boundary", { signatureId: answers[0].signatureId });
          } else pending ??= { at: now() };
          sleep(Math.min(INTERVAL, remaining()));
          continue;
        }
        if (!entry) {
          // A screen still being painted keeps changing; an unknown one that
          // holds still is a miss, and blocks without any key.
          if (pending?.reading === reading && now() - pending.at >= STABLE) return blocked(screen, "blocked: unexpected prompt");
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
      return submitted() ? finish("incomplete", "launch prompt completion not observed") : finish("blocked", "blocked: observation timeout");
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
