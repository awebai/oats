// xterm/leased-IPC composition. All subscriptions/observers are installed inside
// lifecycle onReady, before its settlement signal; no late setup after disposal.
// A remote lease that ends with ssh's own exit 255 (a lost link) is re-opened for the
// same target with backoff; the tab, its xterm and its scrollback stay. Reconnecting
// never touches the server: each lease ends only its local ssh child.
import { createTermLifecycle } from './term-lifecycle.mjs';
import { wireTerminalAttachments } from './terminal-attachments.mjs';
import { terminalHandle, terminalSameHandle, terminalFailure, terminalMessage } from './terminal-contract.mjs';

// Shift+Enter writes pi's raw Ctrl+J alias exactly once. Suppress all three key
// phases, otherwise xterm's subsequent keypress writes CR and submits the draft.
export function shiftEnterAction(ev) {
  if (ev.key !== 'Enter' || !ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return { suppress: false, byte: null };
  return { suppress: true, byte: ev.type === 'keydown' ? '\n' : null };
}
// Native terminal geometry: no lineHeight (xterm's default 1.0), so cells and
// the block cursor keep their natural height and tmux owns row spacing.
export function terminalOptions({ fontSize, fontFamily, theme }) {
  // tmux mouse capture must not defeat Option-drag local copy selection on macOS.
  return { fontSize, fontFamily, theme, scrollback: 5000, macOptionClickForcesSelection: true };
}
export function terminalKeyDecision(ev, interceptKey) {
  const { suppress, byte } = shiftEnterAction(ev);
  if (suppress) return { handled: true, byte };
  if (interceptKey && interceptKey(ev)) return { handled: true, byte: null };
  return { handled: false, byte: null };
}

/** Waits before each reconnect attempt; the last one repeats while the tab is open. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];
/** Open failures that may be the link again, so reconnecting goes on; any other stops it. */
export const RECONNECT_RETRIED = new Set(['E_TERM_REMOTE_UNREACHABLE', 'E_TERM_PREPARE_TIMEOUT']);
/** ssh exits 255 for its own failures: here, a link that died under the viewer. */
export const LOST_LINK_EXIT = 255;

export function createTerminalTab({ desk, term, tmux, remote, serverLabel, wrap, isActive, ownsFocus = () => false,
  focusInput = () => term.focus(), fit, observe, interceptKey, onError = () => {},
  clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: t => clearTimeout(t) } }) {
  let offData, offExit, unobserve, detachAttachments, bannerEl, stripEl, liveEl;
  let ready = false, closed = false, ended = false, arming = false, wired = false;
  // Reconnect state: connected, waiting (for the next attempt's time and the old lease's
  // cleanup), attempting (a lease open in flight) or stopped. One timer drives the waiting.
  let link = 'connected', failures = 0, dueAt = 0, timer = null;
  const server = serverLabel || remote?.serverId;
  const subscriptions = [];
  const doc = wrap.ownerDocument;
  const clearStrip = () => { stripEl?.remove(); stripEl = null; };
  const banner = text => {
    clearStrip();
    if (!bannerEl) { bannerEl = doc.createElement('div'); bannerEl.className = 'term-banner'; bannerEl.setAttribute('role', 'status'); wrap.append(bannerEl); }
    bannerEl.textContent = text;
  };
  // Only state changes are written here; the visible countdown stays outside it.
  const announce = text => {
    if (!liveEl) {
      liveEl = doc.createElement('div'); liveEl.className = 'term-live term-sr-only';
      liveEl.setAttribute('role', 'status'); liveEl.setAttribute('aria-live', 'polite'); wrap.append(liveEl);
    }
    liveEl.textContent = text;
  };
  const strip = (text, busy) => {
    if (!stripEl) {
      stripEl = doc.createElement('div'); stripEl.className = 'term-reconnect';
      const words = doc.createElement('span'); words.className = 'term-reconnect-text';
      const now = doc.createElement('button'); now.type = 'button'; now.textContent = 'Reconnect now';
      now.addEventListener('click', reconnectNow);
      stripEl.append(words, now); wrap.append(stripEl);
    }
    stripEl.querySelector('.term-reconnect-text').textContent = text;
    const now = stripEl.querySelector('button');
    if (busy) now.setAttribute('aria-disabled', 'true'); else now.removeAttribute('aria-disabled');
  };
  const focus = () => {
    if (closed || !ready || ended || !ownsFocus()) return;
    try { focusInput(); } catch { /* no focus into a disposed input */ }
  };
  const life = createTermLifecycle({
    open: async () => {
      const result = await desk.termOpen({ ...(remote ? { remote } : {
        session: tmux.session, window: tmux.window, socket: tmux.socket,
      }), cols: term.cols, rows: term.rows });
      if (result?.terminalApi !== 2) throw terminalFailure('E_TERM_TRANSPORT');
      if (!result.ok) throw terminalFailure(result.code);
      // Reuse is not a second tab's lease acquisition. Its close must not detach
      // the already-open tab, even though both tabs share this document owner.
      if (result.status === 'reused') throw terminalFailure('E_TERM_REUSED');
      const h = terminalHandle(result.handle);
      if (result.status !== 'opened' || !h) throw terminalFailure('E_TERM_TRANSPORT');
      return h;
    },
    closePty: h => desk.termClose(h),
  }, onError);
  const clearTimer = () => { if (timer !== null) { clock.clearTimeout(timer); timer = null; } };
  const disposeUi = () => {
    clearTimer();
    offData?.(); offExit?.(); unobserve?.(); detachAttachments?.();
    for (const subscription of subscriptions) subscription?.dispose?.();
    term.dispose(); bannerEl?.remove(); bannerEl = null; clearStrip(); liveEl?.remove(); liveEl = null;
  };
  const defaultObserve = el => {
    const ro = new ResizeObserver(() => { if (!closed && isActive()) { try { fit(); } catch { /* hidden geometry */ } } });
    ro.observe(el); return () => ro.disconnect();
  };
  // Input goes to the current lease only; between leases there is none.
  const write = data => {
    const h = life.ptyId();
    if (!arming || closed || ended || !h) return;
    const result = desk.termWrite(h, data);
    if (result?.ok === false) banner(terminalFailure(result.code).message);
  };
  function wait() {
    link = 'waiting';
    dueAt = clock.now() + RECONNECT_DELAYS_MS[Math.min(failures, RECONNECT_DELAYS_MS.length - 1)];
    failures++;
    announce(`Disconnected from ${server}.`);
    tick();
  }
  // Wall-clock due time: after a sleep the overdue attempt runs once, at the first tick.
  function tick() {
    clearTimer();
    if (closed || link !== 'waiting') return;
    const left = dueAt - clock.now();
    if (left > 0) {
      strip(`Disconnected from ${server}. Reconnecting in ${Math.ceil(left / 1000)}s…`, false);
      timer = clock.setTimeout(tick, left % 1000 || 1000);
    } else if (life.ptyId()) strip(`Reconnecting to ${server}…`, true); // the old lease's confirmed exit ticks again
    else attempt();
  }
  function attempt() {
    link = 'attempting';
    strip(`Reconnecting to ${server}…`, true); announce(`Reconnecting to ${server}…`);
    life.reopen(connect, error => {
      if (closed) return;
      if (RECONNECT_RETRIED.has(error?.code)) wait();
      else stop(`${terminalMessage(error?.code, server)} Close this tab.`);
    });
  }
  function reconnectNow() {
    if (closed || link !== 'waiting') return;
    dueAt = clock.now(); tick();
  }
  function stop(text) {
    link = 'stopped'; clearTimer(); ended = true;
    banner(text); announce(text);
  }
  function exited(h, result) {
    if (!terminalSameHandle(result?.handle, h) || !terminalSameHandle(life.ptyId(), h)) return;
    ready = false; ended = true; arming = false;
    if (!result.cleanupPending) life.forget(h);
    if (remote && !closed && result.exitCode === LOST_LINK_EXIT && !result.reason) {
      if (link === 'connected') { term.options.disableStdin = true; wait(); }
      else if (link === 'attempting') wait(); // this attempt's own lease died before it was ready
      else if (link === 'waiting' && !life.ptyId()) tick(); // cleanup confirmed
      return;
    }
    banner(result.reason?.code === 'E_TERM_READY_TIMEOUT' ? terminalFailure('E_TERM_READY_TIMEOUT').message
      : result.cleanupPending ? terminalFailure('E_TERM_CLOSE_PENDING').message
        : result.reason ? terminalFailure(result.reason.code).message : 'session ended — close this tab');
  }
  // One lease's setup: its data/exit listeners, then (once per tab) the xterm wiring.
  async function connect(h) {
    offData?.(); offExit?.();
    ended = false;
    offData = desk.onTermData(h, data => { if (!closed && terminalSameHandle(life.ptyId(), h)) term.write(data); });
    offExit = desk.onTermExit(h, result => exited(h, result));
    if (!wired) {
      wired = true;
      subscriptions.push(term.onData(data => write(data)));
      term.attachCustomKeyEventHandler?.(event => {
        const { handled, byte } = terminalKeyDecision(event, interceptKey);
        if (!handled) return true;
        if (byte !== null) write(byte);
        return false;
      });
      subscriptions.push(term.onResize(({ cols, rows }) => {
        const current = life.ptyId();
        if (ready && !closed && !ended && current) desk.termResize(current, cols, rows);
      }));
      unobserve = (observe || defaultObserve)(wrap);
      if (desk.termAttachFiles) detachAttachments = wireTerminalAttachments({ wrap, desk, term,
        ptyId: () => !closed && !ended && ready ? life.ptyId() : null, ownsFocus,
      });
    }
    // Permit xterm protocol replies while the ready FIFO is being flushed;
    // main alone admits writes once it has acknowledged this lease's readiness.
    arming = true;
    let result;
    try { result = await desk.termReady(h); } catch { result = terminalFailure('E_TERM_TRANSPORT'); }
    if (closed || !terminalSameHandle(life.ptyId(), h) || ended) return;
    if (result?.terminalApi !== 2 || !result.ok || result.status !== 'ready' || !terminalSameHandle(result.handle, h)) {
      ready = false; arming = false; ended = true;
      if (link === 'connected') banner(terminalFailure('E_TERM_READY_TIMEOUT').message);
      else stop(terminalFailure('E_TERM_READY_TIMEOUT').message);
      // An absent/revoked lease is no longer ours to detach. This clears only
      // the local handle, NOT main's quota or any other owner's resource.
      if (result?.code === 'E_TERM_LEASE') life.forget(h);
      else {
        try {
          const cleanup = await desk.termClose(h);
          if (cleanup?.ok && cleanup.status === 'closed' && terminalSameHandle(cleanup.handle, h)) life.forget(h);
        } catch { /* retain handle; explicit close must confirm cleanup */ }
      }
      return;
    }
    ready = true;
    if (remote) term.options.disableStdin = false;
    // tmux redraws the screen for the new client: the scrollback is left as it is.
    desk.termResize(h, term.cols, term.rows);
    if (link !== 'connected') { link = 'connected'; failures = 0; clearStrip(); announce(`Reconnected to ${server}.`); }
    focus();
  }
  return {
    start: () => life.start(connect, error => banner(`could not attach: ${terminalFailure(error?.code).message}`)),
    focus,
    async close() {
      closed = true; ready = false; arming = false; clearTimer();
      banner(terminalFailure('E_TERM_CLOSE_PENDING').message);
      const result = await life.close(disposeUi);
      if (!result.ok) banner(terminalFailure('E_TERM_CLOSE_PENDING').message);
      return result;
    },
  };
}
