// xterm/leased-IPC composition. All subscriptions/observers are installed inside
// lifecycle onReady, before its settlement signal; no late setup after disposal.
import { createTermLifecycle } from './term-lifecycle.mjs';
import { wireTerminalAttachments } from './terminal-attachments.mjs';
import { terminalHandle, terminalSameHandle, terminalFailure } from './terminal-contract.mjs';

// Shift+Enter writes pi's raw Ctrl+J alias exactly once. Suppress all three key
// phases, otherwise xterm's subsequent keypress writes CR and submits the draft.
export function shiftEnterAction(ev) {
  if (ev.key !== 'Enter' || !ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) return { suppress: false, byte: null };
  return { suppress: true, byte: ev.type === 'keydown' ? '\n' : null };
}
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

export function createTerminalTab({ desk, term, tmux, sessionTarget, remote, wrap, isActive, ownsFocus = () => false,
  focusInput = () => term.focus(), fit, observe, interceptKey, onError = () => {} }) {
  let offData, offExit, unobserve, detachAttachments, bannerEl;
  let ready = false, closed = false, ended = false, arming = false;
  const subscriptions = [];
  const banner = text => {
    if (!bannerEl) { bannerEl = wrap.ownerDocument.createElement('div'); bannerEl.className = 'term-banner'; bannerEl.setAttribute('role', 'status'); wrap.append(bannerEl); }
    bannerEl.textContent = text;
  };
  const focus = () => {
    if (closed || !ready || ended || !ownsFocus()) return;
    try { focusInput(); } catch { /* no focus into a disposed input */ }
  };
  const life = createTermLifecycle({
    open: async () => {
      const result = await desk.termOpen({ ...(remote ? { remote } : sessionTarget ? { sessionTarget } : {
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
  const disposeUi = () => {
    offData?.(); offExit?.(); unobserve?.(); detachAttachments?.();
    for (const subscription of subscriptions) subscription?.dispose?.();
    term.dispose(); bannerEl?.remove(); bannerEl = null;
  };
  const defaultObserve = el => {
    const ro = new ResizeObserver(() => { if (!closed && isActive()) { try { fit(); } catch { /* hidden geometry */ } } });
    ro.observe(el); return () => ro.disconnect();
  };
  const write = (h, data) => {
    if (!arming || closed || ended || !terminalSameHandle(life.ptyId(), h)) return;
    const result = desk.termWrite(h, data);
    if (result?.ok === false) banner(terminalFailure(result.code).message);
  };
  return {
    start: () => life.start(async h => {
      offData = desk.onTermData(h, data => { if (!closed && terminalSameHandle(life.ptyId(), h)) term.write(data); });
      offExit = desk.onTermExit(h, result => {
        if (!terminalSameHandle(result?.handle, h) || !terminalSameHandle(life.ptyId(), h)) return;
        ready = false; ended = true; arming = false;
        if (!result.cleanupPending) life.forget(h);
        banner(result.reason?.code === 'E_TERM_READY_TIMEOUT' ? terminalFailure('E_TERM_READY_TIMEOUT').message
          : result.cleanupPending ? terminalFailure('E_TERM_CLOSE_PENDING').message
            : result.reason ? terminalFailure(result.reason.code).message : 'session ended — close this tab');
      });
      subscriptions.push(term.onData(data => write(h, data)));
      term.attachCustomKeyEventHandler?.(event => {
        const { handled, byte } = terminalKeyDecision(event, interceptKey);
        if (!handled) return true;
        if (byte !== null) write(h, byte);
        return false;
      });
      subscriptions.push(term.onResize(({ cols, rows }) => {
        if (ready && !closed && !ended && terminalSameHandle(life.ptyId(), h)) desk.termResize(h, cols, rows);
      }));
      unobserve = (observe || defaultObserve)(wrap);
      if (desk.termAttachFiles) detachAttachments = wireTerminalAttachments({ wrap, desk, term,
        ptyId: () => !closed && !ended && ready ? life.ptyId() : null, ownsFocus,
      });
      // Permit xterm protocol replies while the ready FIFO is being flushed;
      // main alone admits writes once it has acknowledged this lease's readiness.
      arming = true;
      let result;
      try { result = await desk.termReady(h); } catch { result = terminalFailure('E_TERM_TRANSPORT'); }
      if (closed || !terminalSameHandle(life.ptyId(), h) || ended) return;
      if (result?.terminalApi !== 2 || !result.ok || result.status !== 'ready' || !terminalSameHandle(result.handle, h)) {
        ready = false; arming = false; ended = true;
        banner(terminalFailure('E_TERM_READY_TIMEOUT').message);
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
      ready = true; desk.termResize(h, term.cols, term.rows); focus();
    }, error => banner(`could not attach: ${terminalFailure(error?.code).message}`)),
    focus,
    async close() {
      closed = true; ready = false; arming = false;
      banner(terminalFailure('E_TERM_CLOSE_PENDING').message);
      const result = await life.close(disposeUi);
      if (!result.ok) banner(terminalFailure('E_TERM_CLOSE_PENDING').message);
      return result;
    },
  };
}
