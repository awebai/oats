import { lstatSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

const LIMIT = 30000;
const INTERVAL = 100;
const digest = (text) => createHash("sha256").update(text).digest("hex");
const sameTarget = (a, b, pid = true) => a && b && ["socket", "windowId", "paneId", ...(pid ? ["pid"] : [])].every(k => String(a[k]) === String(b[k]));
const validTarget = t => t && typeof t.socket === "string" && t.socket.length > 0 && /^@\d+$/.test(t.windowId) && /^%\d+$/.test(t.paneId) && /^[1-9]\d*$/.test(String(t.pid));
const wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Private, single-invocation authority. Production fixtures must pass the separate qualification adapter.
 * Transport captures visible bytes only and independently verifies ownership and
 * stable geometry around capture. Every call receives the remaining deadline.
 * Synthetic fixtures are injectable for tests; accepting a real version/platform
 * fixture is a separate review gate. A fixture binds an exact home and complete
 * frames (text, width, height), never a substring or whitespace normalization.
 * audit receives launch-prompt event data and returns appendEvent's checked result.
 */
export function createLaunchPromptController({ home, startId, harness, policy = {}, transport, audit,
  now = () => performance.now(), sleep = wait, fixtures = [], geometry, validateExecutable, expectedHomeIdentity }) {
  const selectedHarness = typeof harness === "string" ? { name: harness } : { ...harness };
  const consent = { ...policy };
  // Copy fixture data so a caller cannot change signatures during an answer.
  const accepted = structuredClone(fixtures);
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
  function checkAuthority() {
    checkHome();
    if (validateExecutable && validateExecutable() !== true) throw new Error("launch executable changed");
  }
  function remaining() {
    const left = deadline - now();
    if (!(left > 0)) throw new Error("observation timeout");
    return Math.max(1, Math.ceil(left));
  }
  function capture(t) {
    checkAuthority();
    if (!validTarget(t)) throw new Error("invalid target");
    const screen = transport.snapshot(t, remaining());
    remaining();
    checkAuthority();
    if (!sameTarget(t, screen) || !Number.isInteger(screen.width) || screen.width < 1 || !Number.isInteger(screen.height) || screen.height < 1 || typeof screen.text !== "string") throw new Error("target or geometry changed");
    lastText = screen.text;
    return { ...screen };
  }
  function record(data) {
    let result;
    try {
      checkHome();
      result = audit({ home, startId, socket: target?.socket, windowId: target?.windowId,
        paneId: target?.paneId, pid: target?.pid, consentSource: consent.consentSource ?? null, ...data });
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
    terminal = { status, answers: answers.map(a => ({ ...a })), reason, receipt: receipts };
    return terminal;
  }
  function matching(screen) {
    const candidates = [];
    for (const fixture of accepted) {
      if (!fixture.id || fixture.home !== home || fixture.harness !== selectedHarness.name || !fixture.version || fixture.version !== selectedHarness.version || !fixture.platform || fixture.platform !== selectedHarness.platform) continue;
      for (const frame of fixture.frames ?? []) {
        if (frame.text === screen.text && frame.width === screen.width && frame.height === screen.height
          && JSON.stringify(frame.after) === JSON.stringify(answers.map(a => a.class))) candidates.push({ fixture, frame });
      }
    }
    return candidates.length === 1 ? candidates[0] : null;
  }
  const exact = (a, b) => sameTarget(a, b) && a.width === b.width && a.height === b.height && a.text === b.text;
  function observe(t, before) {
    if (used) return terminal ?? { status: "blocked", answers: [], reason: "blocked: launch authority already used", receipt: [] };
    used = true;
    target = { ...t };
    let fresh = before === undefined, resizeToken;
    const wantsGeometry = geometry && Number.isInteger(geometry.width) && geometry.width > 0 && Number.isInteger(geometry.height) && geometry.height > 0
      && consent.awebDevelopmentChannel === true
      && accepted.some(f => f.home === home && f.harness === selectedHarness.name && f.version === selectedHarness.version && f.platform === selectedHarness.platform
        && f.frames?.some(frame => frame.width === geometry.width && frame.height === geometry.height));
    let geometryHandled = !wantsGeometry;
    function incompleteCleanup() {
      if (!terminal) terminal = { answers: answers.map(a => ({ ...a })), receipt: receipts };
      terminal.status = "incomplete";
      terminal.reason = "launch prompt geometry restoration incomplete";
    }
    try {
      checkHome();
      if (!validTarget(target)) return finish("blocked", "blocked: invalid target");
      if (before !== undefined && (!before || !sameTarget(target, before, false) || String(target.pid) === String(before.pid))) return finish("blocked", "blocked: respawn ownership not proven");
      // Hard iteration bound also protects against a broken injected clock.
      for (let observations = 0; observations <= LIMIT / INTERVAL; observations++) {
        let screen = capture(target);
        if (!fresh) {
          // A resize can reflow the *old* prompt into different bytes. Require
          // a fresh process screen at the original geometry before pinning.
          if (screen.width !== before.width || screen.height !== before.height) return finish("blocked", "blocked: respawn geometry changed before fresh screen");
          if (screen.text !== before.text) fresh = true;
        }
        if (fresh && !geometryHandled) {
          geometryHandled = true;
          const fields = { action: "pin-geometry", width: geometry.width, height: geometry.height, signatureDigest: digest(screen.text) };
          if (!record({ ...fields, status: "attempted" })) return finish("incomplete", "launch prompt audit failed before geometry pin");
          checkAuthority();
          resizeToken = transport.pin(target, { ...geometry }, remaining());
          if (!resizeToken) return finish("incomplete", "launch prompt geometry pin failed");
          if (!record({ ...fields, status: "submitted" })) return finish("incomplete", "launch prompt audit failed after geometry pin");
          sleep(Math.min(INTERVAL, remaining()));
          screen = capture(target);
          if (screen.width !== geometry.width || screen.height !== geometry.height) return finish("blocked", "blocked: launch geometry not pinned");
        }
        if (!fresh || screen.text.trim() === "") {
          sleep(Math.min(INTERVAL, remaining()));
          continue;
        }
        const match = matching(screen);
        if (!match) return finish("blocked", "blocked: unexpected prompt");
        const { fixture, frame } = match;
        const prior = answers.map(a => a.class);
        if (frame.kind === "completed") return finish("completed", "recognized launch boundary");
        if (frame.kind === "startup") {
          sleep(Math.min(INTERVAL, remaining()));
          continue;
        }
        const klass = frame.class;
        if (frame.kind !== "prompt" || klass !== "awebDevelopmentChannel" || prior.length !== 0) return finish("blocked", "blocked: repeated or unsupported prompt");
        if (consent.awebDevelopmentChannel !== true || selectedHarness.name !== "claude" || selectedHarness.developmentChannelEligible !== true) return finish("blocked", "blocked: prompt consent absent");
        const expected = screen;
        if (!exact(capture(target), expected)) return finish("blocked", "blocked: prompt changed before input");
        const fields = { signatureId: fixture.id, version: fixture.version, platform: fixture.platform,
          signatureDigest: digest(expected.text), class: klass, key: "Enter" };
        if (!record({ ...fields, status: "attempted" })) {
          terminal = { status: "incomplete", answers: answers.map(a => ({ ...a })), reason: "launch prompt audit failed", receipt: receipts };
          return terminal;
        }
        // Durable intent may take time or run hooks. Revalidate the visible
        // signature, PID and home again after it and immediately before input.
        if (!exact(capture(target), expected)) return finish("blocked", "blocked: prompt changed before input", fields);
        let outcome = "uncertain";
        try {
          checkAuthority();
          const sent = transport.send(target, "Enter", remaining());
          outcome = sent?.status === "submitted" ? "submitted" : sent?.status === "failed" ? "failed" : "uncertain";
        } catch { /* A thrown send might already have delivered the key. */ }
        if (!record({ ...fields, status: outcome })) {
          terminal = { status: "incomplete", answers: answers.map(a => ({ ...a })), reason: "launch prompt audit failed after possible input", receipt: receipts };
          return terminal;
        }
        if (outcome !== "submitted") return finish("incomplete", `launch prompt input ${outcome}`, fields);
        answers.push({ class: klass, signatureId: fixture.id, status: "submitted" });
        sleep(Math.min(INTERVAL, remaining()));
      }
      return finish("blocked", "blocked: observation timeout");
    } catch (error) {
      if (error?.geometryRestored || error?.geometryRestoreFailed) record({ action: "restore-geometry", status: error.geometryRestored ? "submitted" : "failed", reason: "partial pin rollback", signatureDigest: digest(lastText) });
      if (error?.geometryRestoreFailed) return finish("incomplete", "launch prompt geometry restoration incomplete");
      return finish("blocked", error?.message === "observation timeout" ? "blocked: observation timeout" : "blocked: launch observation failed");
    } finally {
      if (resizeToken) {
        // Restoration is cleanup of our own bounded mutation. Attempt it even
        // when auditing failed or the observation deadline expired; the adapter
        // independently refuses a replaced process/window before touching it.
        const fields = { action: "restore-geometry", previous: resizeToken.previous, signatureDigest: digest(lastText) };
        let audited = record({ ...fields, status: "attempted" });
        let restored = false;
        try { restored = transport.restore(target, resizeToken, 3000)?.status === "restored"; } catch { /* retained incomplete below */ }
        audited = record({ ...fields, status: restored ? "submitted" : "failed" }) && audited;
        if (!restored || !audited) incompleteCleanup();
      }
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
