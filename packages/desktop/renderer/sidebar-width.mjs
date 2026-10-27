// oats desktop — the sidebar's width, resizable. One custom property, --sidebar-w on #app (shell.css: 288px by
// default), which #sidebar takes as its width and min-width. A handle on the sidebar's right edge sets it: the
// split panes' resizer (split-resize.mjs), its class and its drag and keys, in px.
//
// Bounds: 240px (the narrowest the foot bar and the rows' truncation hold) to min(480px, 45% of the window), so
// the workbench keeps the rest; at a window under 534px the minimum wins. The width the person chose is kept
// (and stored per computer, beside the theme); the applied width is that one clamped into the window's bounds
// now, so a window that shrinks and grows again gives it back. Hiding the sidebar (display: none) leaves
// --sidebar-w alone.
//
// Terminals refit through their own ResizeObservers, as when the sidebar hides; the drag writes at most once a
// frame. Their programs hear the new size once: a drag holds the PTY resizes (holdTerminalResizes,
// terminal-tab.mjs) until it lets go, and key steps hold them until the keys rest.
import { createResizeHandle, wireResizer } from "./split-resize.mjs";

export const SIDEBAR_WIDTH_KEY = "oats.desktop.sidebarWidth";
export const SIDEBAR_DEFAULT = 288;
export const SIDEBAR_MIN = 240;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_STEP = 8;
export const SIDEBAR_BIG_STEP = 32;
/** How long the keys rest before their held PTY resizes are sent. */
export const SIDEBAR_KEY_SETTLE_MS = 150;

/** The widest the sidebar may be in a window this wide: min(480px, 45%), never under the minimum. */
export function sidebarMax(windowWidth) {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.floor(windowWidth * .45)));
}

export function clampSidebarWidth(width, windowWidth) {
  return Math.max(SIDEBAR_MIN, Math.min(sidebarMax(windowWidth), Math.round(width)));
}

/** The stored width: whole px within 240–480, else (missing, invalid, storage that throws) the default. */
export function readSidebarWidth(storage) {
  let raw;
  try { raw = storage?.getItem(SIDEBAR_WIDTH_KEY); } catch { return SIDEBAR_DEFAULT; }
  if (typeof raw !== "string" || !/^\d{1,4}$/.test(raw)) return SIDEBAR_DEFAULT;
  const width = Number(raw);
  return width >= SIDEBAR_MIN && width <= SIDEBAR_MAX ? width : SIDEBAR_DEFAULT;
}

/**
 * @param {object} deps
 * @param {Document} deps.doc  holds #app and #sidebar
 * @param {Window} deps.win  its innerWidth bounds the width; its resize clamps it; its frames pace a drag
 * @param {Storage|null} [deps.storage]
 * @param {() => () => void} [deps.hold]  holds the terminals' PTY resizes; answers the release
 */
export function createSidebarWidth({ doc, win, storage = null, hold = () => () => {},
  clock = { setTimeout: (fn, ms) => win.setTimeout(fn, ms), clearTimeout: t => win.clearTimeout(t) } }) {
  const app = doc.getElementById("app"), sidebar = doc.getElementById("sidebar");
  let chosen = readSidebarWidth(storage), applied = SIDEBAR_DEFAULT;
  let dragRelease = null, keyRelease = null, keyTimer = null;

  const handle = createResizeHandle(doc, { label: "Sidebar width", orientation: "row" });
  handle.id = "sidebar-resizer";
  handle.setAttribute("aria-controls", "sidebar");
  sidebar.append(handle);

  function apply() {
    applied = clampSidebarWidth(chosen, win.innerWidth);
    app.style.setProperty("--sidebar-w", `${applied}px`);
    handle.setAttribute("aria-valuemin", String(SIDEBAR_MIN));
    handle.setAttribute("aria-valuemax", String(sidebarMax(win.innerWidth)));
    handle.setAttribute("aria-valuenow", String(applied));
  }
  // A reset chooses the default itself, even when the window can't show it now: it comes back as the window grows.
  function chooseDefault() { chosen = SIDEBAR_DEFAULT; apply(); }
  function persist() {
    try { storage?.setItem(SIDEBAR_WIDTH_KEY, String(chosen)); } catch { /* storage-less */ }
  }
  /** Key steps (and the resets) hold the PTY resizes until the keys have rested. */
  function settleSoon() {
    keyRelease ??= hold();
    if (keyTimer !== null) clock.clearTimeout(keyTimer);
    keyTimer = clock.setTimeout(() => { keyTimer = null; const release = keyRelease; keyRelease = null; release?.(); }, SIDEBAR_KEY_SETTLE_MS);
  }

  wireResizer(handle, {
    measure: () => ({ value: applied, min: SIDEBAR_MIN, max: sidebarMax(win.innerWidth), step: SIDEBAR_STEP,
      big: SIDEBAR_BIG_STEP, reset: SIDEBAR_DEFAULT, scale: 1, row: true }),
    resize: (m, value) => { chosen = clampSidebarWidth(value, win.innerWidth); apply(); },
    reset: chooseDefault,
    frame: fn => win.requestAnimationFrame(fn),
    onDragStart: () => { dragRelease?.(); dragRelease = hold(); },
    onDragEnd: () => { persist(); const release = dragRelease; dragRelease = null; release?.(); },
    onStep: () => { persist(); settleSoon(); },
  });
  win.addEventListener("resize", apply);
  apply();

  return {
    handle,
    /** The width applied now, in px. */
    get width() { return applied; },
    /** Back to the default width: sidebar.resetWidth, the palette's "Sidebar: reset width". */
    reset() { chooseDefault(); persist(); settleSoon(); },
  };
}
