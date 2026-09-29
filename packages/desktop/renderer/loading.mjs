/** The shared loading-state primitive (desktop/loading-states).
 *
 * One state model for every data region:
 *   pending     no data for this subject yet; after PENDING_DELAY_MS a skeleton
 *               shaped like the final content (never an empty-state message)
 *   ready       data present, last read succeeded
 *   refreshing  data present, a read in flight; content stays interactive and a
 *               muted "Refreshing…" appears after REFRESHING_DELAY_MS
 *   stale       data present, last read failed: content kept, an attention line
 *               "Couldn't refresh <noun> · observed <age>" with Retry
 *   empty       a successful read returned zero items (the surface paints its copy)
 *   failed      no data and the read failed: cause, Details (code), Retry
 *
 * The controller owns the delays, `aria-busy`, the status line announcements,
 * the age line and the Retry wiring. The surface owns its latest-intent
 * tokens: it calls begin()/succeed()/fail() only for the read it still owns.
 * Wording is fixed here so no surface drifts. No framework: vanilla DOM. */

export const PENDING_DELAY_MS = 150;
export const REFRESHING_DELAY_MS = 400;
/** Data observed longer ago than this is labelled with its age even after a successful read. */
export const OLD_AFTER_MS = 2 * 60_000;
/** How often a shown age line is re-rendered. */
export const AGE_TICK_MS = 30_000;

const capitalise = s => s ? s[0].toUpperCase() + s.slice(1) : s;
export const wording = Object.freeze({
  loading: noun => `Loading ${noun}…`,
  refreshing: 'Refreshing…',
  couldNotRefresh: noun => `Couldn't refresh ${noun}`,
  retry: 'Retry',
  updated: noun => `${capitalise(noun)} updated`,
  observed: age => `Observed ${age}`,
});

/** Milliseconds since `iso`, or null when absent or unparseable. */
export function observedAgeMs(iso, now = Date.now()) {
  if (typeof iso !== 'string' || !iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}
/** "just now" (< 10s) / "45s ago" / "3 min ago" / "at 14:05" (an hour or more, local time); null when unknown. */
export function observedAgeText(iso, now = Date.now()) {
  const ms = observedAgeMs(iso, now);
  if (ms === null) return null;
  const s = Math.round(ms / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const d = new Date(Date.parse(iso));
  return `at ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** "observed 3 min ago", for the stale line; null when the age is unknown. */
export function observedText(iso, now = Date.now()) {
  const age = observedAgeText(iso, now);
  return age === null ? null : `observed ${age}`;
}
export function isOldObservation(iso, now = Date.now()) {
  const ms = observedAgeMs(iso, now);
  return ms !== null && ms > OLD_AFTER_MS;
}

/* ── skeletons (decorative: aria-hidden, no text) ────────────────────────── */
const SHAPES = new Set(['roster-row', 'soul-card', 'table-row', 'detail-section', 'pill', 'line']);
function element(doc, tag, className) { const el = doc.createElement(tag); el.className = className; return el; }
function bone(doc, className) { const el = element(doc, 'span', `skeleton ${className}`); el.setAttribute('aria-hidden', 'true'); return el; }
/** One skeleton of `shape`. Sizes live in loading.css and mirror the real rows. */
export function skeleton(doc, shape, { columns = 4, width } = {}) {
  if (!SHAPES.has(shape)) throw new Error(`unknown skeleton shape: ${shape}`);
  let el;
  switch (shape) {
    case 'roster-row': {
      // Wears the real row classes (.ctx-tree-row > .ctx-inst > .ctx-dot + .ctx-copy > .ctx-name / .ctx-repo-label)
      // so its height, gap and padding are shell.css's, never a copied pixel value: a row redesign moves both.
      el = element(doc, 'div', 'skeleton-item skeleton-roster-row ctx-tree-row');
      el.style.setProperty('--depth', '0');
      const inst = element(doc, 'span', 'ctx-inst skeleton-inst');
      const copy = element(doc, 'span', 'ctx-copy skeleton-copy');
      copy.append(bone(doc, 'skeleton-line skeleton-name ctx-name'), bone(doc, 'skeleton-line skeleton-meta ctx-meta ctx-repo-label'));
      inst.append(bone(doc, 'skeleton-dot ctx-dot'), copy);
      el.append(inst);
      break;
    }
    case 'soul-card': {
      el = element(doc, 'div', 'skeleton-item skeleton-soul-card');
      const head = element(doc, 'span', 'skeleton-card-head');
      head.append(bone(doc, 'skeleton-mark'), bone(doc, 'skeleton-line skeleton-name'));
      el.append(head, bone(doc, 'skeleton-line skeleton-text'), bone(doc, 'skeleton-line skeleton-text short'));
      break;
    }
    case 'table-row': {
      el = element(doc, 'div', 'skeleton-item skeleton-table-row');
      el.style.setProperty('--skeleton-columns', String(columns));
      for (let i = 0; i < columns; i++) el.append(bone(doc, `skeleton-line skeleton-cell${i === 0 ? ' first' : ''}`));
      break;
    }
    case 'detail-section': {
      el = element(doc, 'div', 'skeleton-item skeleton-detail-section');
      el.append(bone(doc, 'skeleton-line skeleton-title'), bone(doc, 'skeleton-block'));
      break;
    }
    case 'pill': el = bone(doc, 'skeleton-pill'); break;
    case 'line': el = bone(doc, 'skeleton-line'); break;
  }
  if (width) el.style.width = width;
  el.setAttribute('aria-hidden', 'true');
  el.dataset.skeleton = shape;
  return el;
}
/** `count` skeletons of `shape` in one aria-hidden block. */
export function skeletonBlock(doc, shape, { count = 3, ...options } = {}) {
  const block = element(doc, 'div', `skeleton-block-list skeleton-${shape}s`);
  block.setAttribute('aria-hidden', 'true'); block.dataset.skeleton = `${shape}s`;
  for (let i = 0; i < count; i++) block.append(skeleton(doc, shape, options));
  return block;
}

/** A `role="status"` line. Visually hidden when the surface has no place for a visible one. */
export function statusLine(doc, { visuallyHidden = false, className = '' } = {}) {
  const el = element(doc, 'p', ['loading-status', visuallyHidden ? 'loading-sr' : '', className].filter(Boolean).join(' '));
  el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  return el;
}

/** Capture the focused element inside `root` (and `scroller`'s scroll) right before
 * a rebuild and return a restore callback. Call it immediately before the repaint,
 * not when the read starts: focus may have moved into the content meanwhile.
 * Identity: an actionable control carries `data-focus-key` (e.g. `remove:<label>`,
 * `op:<layer>:<name>`) and is found again ONLY by that key — a repaint happens when
 * the data changed, which is exactly when positions shift, and a keyboard user must
 * never land on a different mutation control. Anything else (a disclosure summary,
 * a plain element) is found by its structural path, but a path is never trusted
 * onto a button, select, input or link. When nothing matches, `fallback` (an
 * element or a function returning one) receives focus, else focus is left alone.
 * Returns whether focus was restored to the same identity. */
export function captureFocusState(root, { scroller = root, fallback = null } = {}) {
  const doc = root.ownerDocument, active = doc.activeElement;
  const inside = !!active && root.contains(active);
  const key = inside ? active.dataset?.focusKey || null : null;
  const path = inside && !key ? pathFrom(root, active) : null;
  const scrollTop = scroller?.scrollTop ?? 0;
  return () => {
    // A focused control the repaint never touched stays exactly where it is.
    if (inside && active.isConnected && root.contains(active)) { if (scroller) scroller.scrollTop = scrollTop; return true; }
    let target = null;
    if (key) target = [...root.querySelectorAll('[data-focus-key]')].find(el => el.dataset.focusKey === key) || null;
    else if (path) { target = walk(root, path); if (target && ACTIONABLE.test(target.tagName)) target = null; }
    const focusable = !!target && typeof target.focus === 'function' && !target.disabled && target.isConnected;
    if (focusable) target.focus({ preventScroll: true });
    else if (inside) {
      const to = typeof fallback === 'function' ? fallback() : fallback;
      if (to && typeof to.focus === 'function') to.focus({ preventScroll: true });
    }
    if (scroller) scroller.scrollTop = scrollTop;
    return focusable ? doc.activeElement === target : false;
  };
}
const ACTIONABLE = /^(BUTTON|SELECT|INPUT|TEXTAREA|A)$/;
function pathFrom(root, el) {
  const path = [];
  for (let node = el; node && node !== root; node = node.parentElement) {
    const parent = node.parentElement; if (!parent) return null;
    path.unshift([...parent.children].indexOf(node));
  }
  return path;
}
function walk(root, path) {
  let node = root;
  for (const index of path) { node = node?.children?.[index]; if (!node) return null; }
  return node;
}

/* ── the data-state controller ───────────────────────────────────────────── */
/**
 * @param {object} o
 * @param {Document} o.doc
 * @param {string} o.noun               "instances", "roster", "soul", "readiness"…
 * @param {Element} o.region            gets aria-busy while pending; hosts the skeleton and the failed block unless a host is given
 * @param {Element} [o.skeletonHost]    where the skeleton is appended (default: region)
 * @param {Element|null} [o.failedHost] where the failed block is appended (default: skeletonHost; null when the surface
 *                                      keeps its own failure notice and only wants the state, aria-busy and the announcement)
 * @param {() => Element} [o.skeleton]  builds a fresh skeleton (default: none — the region only becomes busy)
 * @param {Element} [o.status]          the role="status" line; text-only announcements
 * @param {Element} [o.indicatorHost]   where "Refreshing…" is appended
 * @param {Element} [o.noticeHost]      where the stale / observed line is appended (default: indicatorHost)
 * @param {() => void} [o.onRetry]      Retry / the failed block's Retry
 * @param {Element|(() => Element|null)} [o.focusFallback]  receives focus when a focused Retry has to vanish (a successful
 *                                      retry removes its line); default: the first bound Refresh control
 * @param {() => number} [o.now]
 */
export function createDataState({ doc, noun, region, skeletonHost = region, failedHost = skeletonHost, skeleton: buildSkeleton = null, status = null,
  indicatorHost = null, noticeHost = indicatorHost, onRetry = null, focusFallback = null, now = Date.now,
  setTimeout: schedule = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: cancel = id => globalThis.clearTimeout(id) } = {}) {
  // `settled` is the last state a read left behind (ready / empty / stale / failed): what cancel() returns to.
  let state = 'idle', settled = 'idle', busy = false, hasData = false, user = false, disposed = false;
  let observedAt = null, announced = null;
  let pendingTimer = null, refreshingTimer = null, ageTimer = null;
  let skeletonEl = null, failedEl = null, indicatorEl = null, noticeEl = null;
  const refreshControls = new Set();

  const clearTimer = id => { if (id !== null) cancel(id); return null; };
  function say(text) {
    if (!status || text === announced) return;
    announced = text; status.textContent = text;
  }
  // While the stale line or the failed block is on screen, the status line is announced but not shown
  // (.loading-quiet: loading.css clips it, its 1.5em box stays so nothing shifts; the class works on any surface's own status element): one visible message, calm.
  function syncQuiet() {
    if (!status) return;
    status.classList.toggle('loading-quiet', noticeEl?.dataset.kind === 'stale' || !!failedEl);
  }
  // A focused Retry never disappears under the finger silently: focus moves to the fallback first.
  function removeKeepingFocus(el) {
    if (!el) return;
    if (el.contains(doc.activeElement)) {
      const target = typeof focusFallback === 'function' ? focusFallback() : focusFallback || [...refreshControls].find(c => c.isConnected) || null;
      if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
    }
    el.remove();
  }
  function removeSkeleton() { skeletonEl?.remove(); skeletonEl = null; }
  function removeFailed() { removeKeepingFocus(failedEl); failedEl = null; }
  function removeIndicator() { indicatorEl?.remove(); indicatorEl = null; }
  function removeNotice() { removeKeepingFocus(noticeEl); noticeEl = null; ageTimer = clearTimer(ageTimer); }
  function setBusyControls() {
    const mark = el => busy ? el.setAttribute('aria-disabled', 'true') : el.removeAttribute('aria-disabled');
    refreshControls.forEach(mark);
    for (const host of [noticeEl, failedEl]) { const retry = host?.querySelector('.loading-retry'); if (retry) mark(retry); }
  }
  function retryButton() {
    const b = element(doc, 'button', 'act loading-retry'); b.type = 'button'; b.textContent = wording.retry;
    b.addEventListener('click', () => { if (disposed || busy || b.getAttribute('aria-disabled') === 'true') return; onRetry?.(); });
    if (busy) b.setAttribute('aria-disabled', 'true');
    return b;
  }
  function showSkeleton() {
    pendingTimer = null;
    if (disposed || state !== 'pending' || failedEl || !buildSkeleton || !skeletonHost) return;
    removeSkeleton(); skeletonEl = buildSkeleton(); skeletonEl.dataset.loadingSkeleton = '1'; skeletonHost.append(skeletonEl);
  }
  function showIndicator() {
    refreshingTimer = null;
    if (disposed || state !== 'refreshing' || !indicatorHost) return;
    removeIndicator();
    indicatorEl = element(doc, 'span', 'loading-refreshing');
    const dot = element(doc, 'span', 'loading-dot'); dot.setAttribute('aria-hidden', 'true');
    indicatorEl.append(dot, doc.createTextNode(wording.refreshing));
    indicatorHost.append(indicatorEl);
  }
  function noticeText(kind) {
    const age = observedText(observedAt, now());
    if (kind === 'stale') return age ? `${wording.couldNotRefresh(noun)} · ${age}` : wording.couldNotRefresh(noun);
    return wording.observed(observedAgeText(observedAt, now()));
  }
  function showNotice(kind, { cause = null } = {}) {
    // `cause`: the read's message; code appended when the error carried one (set by fail()).
    if (!noticeHost) return;
    if (!noticeEl || noticeEl.dataset.kind !== kind) {
      removeNotice();
      noticeEl = element(doc, 'div', 'loading-notice'); noticeEl.dataset.kind = kind;
      noticeEl.append(element(doc, 'span', 'loading-notice-text'));
      if (kind === 'stale') {
        // The cause is reachable by keyboard and screen reader through a Details disclosure
        // (a title alone is hover-only); the title is kept for the pointer.
        const more = element(doc, 'details', 'loading-notice-details');
        const summary = element(doc, 'summary', ''); summary.textContent = 'Details';
        more.append(summary, element(doc, 'p', 'loading-notice-cause'));
        noticeEl.append(retryButton(), more);
      }
      noticeHost.append(noticeEl);
    }
    noticeEl.querySelector('.loading-notice-text').textContent = noticeText(kind);
    if (cause) noticeEl.title = cause; else noticeEl.removeAttribute('title');
    const more = noticeEl.querySelector('.loading-notice-details');
    if (more) { more.hidden = !cause; more.querySelector('.loading-notice-cause').textContent = cause || ''; }
    ageTimer = clearTimer(ageTimer);
    if (observedText(observedAt, now())) ageTimer = schedule(() => { ageTimer = null; touch(); }, AGE_TICK_MS);
  }
  // The failed block is updated in place on a repeated failure: its Retry may hold focus.
  function showFailed(error) {
    removeSkeleton();
    if (!failedHost) return;
    if (!failedEl) {
      failedEl = element(doc, 'div', 'loading-failed');
      failedEl.append(element(doc, 'p', 'loading-failed-message'));
      const more = element(doc, 'details', 'loading-failed-details');
      const summary = element(doc, 'summary', ''); summary.textContent = 'Details';
      more.append(summary, element(doc, 'p', 'loading-failed-code muted'));
      failedEl.append(more, retryButton());
      failedHost.append(failedEl);
    }
    const message = typeof error?.message === 'string' && error.message ? error.message : `${wording.couldNotRefresh(noun)}.`;
    failedEl.querySelector('.loading-failed-message').textContent = message;
    const code = typeof error?.code === 'string' && error.code ? error.code : null;
    const more = failedEl.querySelector('.loading-failed-details');
    more.hidden = !code; more.querySelector('.loading-failed-code').textContent = code || '';
  }
  function setRegionBusy(value) {
    if (!region) return;
    if (value) region.setAttribute('aria-busy', 'true'); else region.removeAttribute('aria-busy');
  }
  /** Re-render the age line (called on a timer, and by surfaces on their own polls). */
  function touch() {
    if (disposed || !noticeEl) return;
    showNotice(noticeEl.dataset.kind, { cause: noticeEl.title || null });
  }

  const api = {
    get state() { return state; },
    get busy() { return busy; },
    get hasData() { return hasData; },
    get observedAt() { return observedAt; },
    /** A new subject: forget the data and every visual; the next begin() is pending. */
    reset() {
      if (disposed) return;
      pendingTimer = clearTimer(pendingTimer); refreshingTimer = clearTimer(refreshingTimer);
      removeSkeleton(); removeFailed(); removeIndicator(); removeNotice();
      state = settled = 'idle'; busy = false; hasData = false; user = false; observedAt = null; announced = null;
      if (status) status.textContent = '';
      setRegionBusy(false); setBusyControls(); syncQuiet();
    },
    /** A read starts. `user`: a Refresh/Retry the person asked for (its completion is announced). */
    begin({ user: invoked = false } = {}) {
      if (disposed) return;
      user = user || invoked; busy = true;
      if (!hasData) {
        // A retry from `failed` keeps the block (its Retry may be focused) and shows no skeleton beside it.
        if (state !== 'pending') {
          state = 'pending'; setRegionBusy(true); say(wording.loading(noun));
          if (!failedEl && pendingTimer === null) pendingTimer = schedule(showSkeleton, PENDING_DELAY_MS);
        }
      } else if (state !== 'refreshing') {
        state = 'refreshing'; setRegionBusy(false);
        if (refreshingTimer === null) refreshingTimer = schedule(showIndicator, REFRESHING_DELAY_MS);
      }
      setBusyControls();
    },
    /** The owning read succeeded. `observedAt` (ISO) labels old data; `empty` paints no notice but marks the state. */
    succeed({ observedAt: at = null, empty = false } = {}) {
      if (disposed) return;
      pendingTimer = clearTimer(pendingTimer); refreshingTimer = clearTimer(refreshingTimer);
      removeSkeleton(); removeFailed(); removeIndicator();
      const wasUser = user; user = false; busy = false; hasData = true;
      observedAt = typeof at === 'string' && at ? at : null;
      state = settled = empty ? 'empty' : 'ready'; setRegionBusy(false);
      if (isOldObservation(observedAt, now())) showNotice('observed'); else removeNotice();
      if (wasUser) say(wording.updated(noun)); else { announced = null; if (status) status.textContent = ''; }
      setBusyControls(); syncQuiet();
    },
    /** The owning read failed: stale with data, failed without. */
    fail(error = null) {
      if (disposed) return;
      pendingTimer = clearTimer(pendingTimer); refreshingTimer = clearTimer(refreshingTimer);
      removeSkeleton(); removeIndicator();
      user = false; busy = false;
      const message = typeof error?.message === 'string' && error.message ? error.message : null;
      const code = typeof error?.code === 'string' && error.code ? error.code : null;
      const cause = message && code ? `${message} (${code})` : message || code;
      if (hasData) {
        state = settled = 'stale'; setRegionBusy(false);
        showNotice('stale', { cause });
        say(`${wording.couldNotRefresh(noun)}.`);
      } else {
        state = settled = 'failed'; setRegionBusy(false); removeNotice();
        showFailed(error);
        say(message ? `${wording.couldNotRefresh(noun)}. ${message}` : `${wording.couldNotRefresh(noun)}.`);
      }
      setBusyControls(); syncQuiet();
    },
    touch,
    /** A surface's own message on the status line (an operation's result, a miss): goes through the
     * controller so its own announcements stay in sync (a direct textContent write would leave a
     * later identical announcement deduplicated away). */
    say(text) { if (disposed || !status) return; announced = text; status.textContent = text; },
    /** The read settled without an observation (the server's deployment is still pending): stay
     * pending — aria-busy, the one announcement — but with no skeleton, since the surface paints the
     * deployment's own copy. The next begin() adds nothing; the first observation settles it. */
    defer() {
      if (disposed) return;
      if (hasData) { api.cancel(); return; } // with data on screen there is nothing to hold: the read is simply over
      pendingTimer = clearTimer(pendingTimer); refreshingTimer = clearTimer(refreshingTimer);
      removeSkeleton(); removeIndicator(); removeFailed();
      busy = false; user = false; state = 'pending'; setRegionBusy(true); say(wording.loading(noun));
      setBusyControls(); syncQuiet();
    },
    /** The in-flight read was superseded or abandoned (the view hid, the host cancelled): drop the
     * pending visuals and the busy mark without announcing anything; the settled state stays. */
    cancel() {
      if (disposed || !busy) return;
      pendingTimer = clearTimer(pendingTimer); refreshingTimer = clearTimer(refreshingTimer);
      removeSkeleton(); removeIndicator();
      busy = false; user = false;
      if (state === 'pending' && settled === 'idle') { announced = null; if (status) status.textContent = ''; }
      state = settled; setRegionBusy(false);
      setBusyControls();
    },
    /** A Refresh control: aria-disabled while a read is in flight; `run` ignored meanwhile (never `disabled`: focus survives). */
    bindRefresh(control, run) {
      refreshControls.add(control);
      if (busy) control.setAttribute('aria-disabled', 'true');
      if (typeof run === 'function') control.addEventListener('click', () => { if (!disposed && !busy && control.getAttribute('aria-disabled') !== 'true') run(); });
      return () => refreshControls.delete(control);
    },
    dispose() {
      if (disposed) return;
      api.reset(); disposed = true; refreshControls.clear();
    },
  };
  return api;
}
