// oats desktop — shared overlay picker machinery (command palette family).
// One input over a fuzzy-filtered listbox: type-to-filter, ArrowUp/Down,
// Enter runs the active row, Esc/backdrop closes. Extracted from palette.mjs
// so Quick Open (Mod+P) and the palette (Mod+K) share ONE overlay + fuzzy
// implementation instead of duplicating chrome, a11y roles, and the
// stale-load generation guard.
//
// The house fuzzy matcher: simple subsequence scoring — lower is better,
// null means no match, a prefix match gets a strong (negative) bonus.
// (No-match is null, NOT -1: the prefix bonus makes real scores negative,
// and the palette's legacy `sc < 0` no-match filter silently dropped exact
// prefix matches — fixed with this extraction.)
import { captureFocusReturn } from "./focus-return.mjs";
import { icon } from "./shell-icons.mjs";

export function subsequenceScore(text, query) {
  const t = String(text).toLowerCase();
  const s = String(query).toLowerCase();
  let ti = 0, gaps = 0;
  for (const ch of s) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    gaps += found - ti; ti = found + 1;
  }
  return gaps + (t.startsWith(s) ? -100 : 0);
}

let nextPickerId = 0;
// A document has one picker lifetime, not a stack of modal focus traps.
// During activation only opener provenance survives (never DOM/listeners that
// trap focus), so a callback can hand off to another picker even after an await.
const pickerDocuments = new WeakMap();

// Native browser choosers participate in the same focus handoff without
// keeping an underlying palette modal mounted. Consuming never focuses.
export function takePickerFocusReturn(doc) {
  const coordinator = pickerDocuments.get(doc);
  const opener = coordinator?.current?.opener ?? coordinator?.handoff?.opener ?? captureFocusReturn(doc);
  coordinator?.current?.dismiss(false);
  coordinator?.handoff?.release();
  return opener;
}

/**
 * @param {object} spec
 * @param {string} spec.placeholder     input placeholder text
 * @param {string} spec.ariaLabel       dialog + input accessible name
 * @param {() => Promise<any>} spec.loadItems  async data source; resolves to
 *        the picker's backing data (shape is the caller's — computeRows gets
 *        it verbatim). A load that resolves after the picker was closed or
 *        reopened must not paint (generation-guarded here).
 * @param {(data: any, query: string) => Array<{label: string, detail?: string,
 *          dot?: boolean|null, run: Function}>} spec.computeRows
 *        query → result rows, already scored/sorted/sliced by the caller.
 *        Async run callbacks must return their promise to carry the original
 *        cancellation opener across awaits; rejections are logged, not focused.
 *        Callbacks still own their destination's async selection/intent guards.
 * @param {Document} [spec.doc]
 * @returns {{ open: Function, close: Function, toggle: Function }} Opening
 *        replaces any other picker in this Document without returning focus.
 */
export function createOverlayPicker({ placeholder, ariaLabel, loadItems, computeRows, doc = globalThis.document }) {
  // IDs belong to the picker, not a render or a data-derived label. Result
  // slots keep their IDs across selection updates and cannot collide with a
  // second picker (including a palette → Quick Open handoff).
  const id = `overlay-picker-${++nextPickerId}`;
  if (!pickerDocuments.has(doc)) pickerDocuments.set(doc, { current: null, handoff: null });
  const coordinator = pickerDocuments.get(doc);
  let overlay = null;
  let gen = 0; // load generation — a stale item list must not paint over a newer open
  let hide = null;

  function close() { hide?.(true); }

  async function open() {
    if (overlay) return;
    const myGen = ++gen;
    const opener = coordinator.current?.opener ?? coordinator.handoff?.opener ?? captureFocusReturn(doc);
    // Transfer the original non-picker opener before removing the old input.
    // Shortcut replacement must dismiss without any intermediate focus return.
    coordinator.current?.dismiss(false);
    coordinator.handoff?.release();
    const root = doc.createElement("div");
    overlay = root;
    const owns = () => myGen === gen && overlay === root && coordinator.current === lifetime;
    root.className = "palette-overlay";
    root.innerHTML = `
      <div class="palette" role="dialog" aria-modal="true">
        <input class="palette-input" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" autocomplete="off" spellcheck="false">
        <div class="palette-list" role="listbox"></div>
      </div>`;
    const dialog = root.querySelector(".palette");
    dialog.id = `${id}-dialog`;
    dialog.setAttribute("aria-label", ariaLabel);
    const input = root.querySelector(".palette-input");
    input.id = `${id}-input`;
    input.placeholder = placeholder;
    input.setAttribute("aria-label", ariaLabel);
    input.setAttribute("aria-expanded", "true");
    const list = root.querySelector(".palette-list");
    list.id = `${id}-list`;
    list.setAttribute("aria-label", `${ariaLabel} results`);
    input.setAttribute("aria-controls", list.id);

    const dismiss = (restoreFocus) => {
      if (!owns()) return;
      ++gen;
      overlay = null;
      hide = null;
      coordinator.current = null;
      doc.removeEventListener("keydown", modalKeydown, true);
      doc.removeEventListener("focusin", containFocus);
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      root.remove();
      if (restoreFocus) opener.restore();
    };
    const lifetime = { opener, dismiss };
    coordinator.current = lifetime;
    hide = dismiss;

    function modalKeydown(e) {
      if (!owns()) return;
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation(); dismiss(true);
      } else if (e.key === "Tab") {
        // This editable combobox is the modal's only tab stop; options use
        // virtual focus, never individual tab stops. Cover Shift-Tab too.
        e.preventDefault(); e.stopPropagation(); input.focus();
      }
    }
    function containFocus(e) {
      if (owns() && !root.contains(e.target)) input.focus();
    }
    const outsideDismiss = (e) => {
      if (owns() && e.target === root) {
        // Do not let the pointer's default focus action undo focus return.
        e.preventDefault(); dismiss(true);
      }
    };
    root.addEventListener("mousedown", outsideDismiss);
    root.addEventListener("click", outsideDismiss);
    doc.body.append(root);
    doc.addEventListener("keydown", modalKeydown, true);
    doc.addEventListener("focusin", containFocus);
    input.focus();

    let data = null;
    let items = [];   // current result rows: { label, detail, dot, run }
    let active = 0;

    const activate = (it) => {
      if (!owns()) return;
      // The callback owns destination focus, synchronously or later. Preserve
      // only its cancellation return target until a picker consumes it, focus
      // moves elsewhere, or the callback settles. Never focus the opener here.
      dismiss(false);
      const release = () => {
        if (coordinator.handoff === handoff) coordinator.handoff = null;
        doc.removeEventListener("focusin", release);
      };
      const handoff = { opener, release };
      coordinator.handoff = handoff;
      doc.addEventListener("focusin", release);
      try {
        const result = it.run();
        if (result && typeof result.then === "function") {
          Promise.resolve(result).then(release, (error) => {
            release(); // stale success AND rejection cannot clear a newer handoff
            console.error("Picker activation failed", error);
          });
        } else release();
      } catch (error) {
        release();
        throw error;
      }
    };
    const select = () => {
      input.removeAttribute("aria-activedescendant");
      [...list.children].forEach((row, i) => {
        if (row.getAttribute("role") !== "option") return;
        row.classList.toggle("active", i === active);
        row.setAttribute("aria-selected", String(i === active));
        if (i === active) input.setAttribute("aria-activedescendant", row.id);
      });
      if (items.length) list.children[active]?.scrollIntoView?.({ block: "nearest" });
    };
    const render = () => {
      if (!owns()) return;
      input.removeAttribute("aria-activedescendant");
      list.innerHTML = "";
      if (!items.length) {
        const d = doc.createElement("div");
        d.className = "palette-empty";
        d.textContent = "No matches.";
        list.append(d);
        return;
      }
      items.forEach((it, i) => {
        const row = doc.createElement("div");
        row.id = `${id}-option-${i}`;
        row.className = "palette-item";
        row.setAttribute("role", "option");
        const dot = it.dot != null ? `<span class="pdot${it.dot ? " on" : ""}" aria-hidden="true"></span>` : `<span class="picon" aria-hidden="true">${icon("chevronRight", { size: 13 })}</span>`;
        row.innerHTML = `${dot}<span class="plabel"></span><span class="pdetail"></span>`;
        row.querySelector(".plabel").textContent = it.label;
        row.querySelector(".pdetail").textContent = it.detail || "";
        // Keep DOM focus in the combobox, but activate via click so keyboard/
        // assistive-technology synthesized clicks work without mousedown.
        row.addEventListener("mousedown", (e) => { e.preventDefault(); });
        row.addEventListener("click", () => { if (row.parentNode === list) activate(it); });
        row.addEventListener("mousemove", () => {
          if (owns() && row.parentNode === list && active !== i) {
            active = i; select(); // do not replace the row between pointer down/up
          }
        });
        list.append(row);
      });
      select();
    };

    const update = () => {
      if (!owns()) return;
      items = computeRows(data, input.value);
      active = 0;
      render();
    };

    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => {
      if (!owns()) return;
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, items.length - 1); select(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); select(); }
      else if (e.key === "Enter") {
        e.preventDefault();
        const it = items[active];
        if (it) activate(it);
      }
    });

    list.innerHTML = '<div class="palette-empty">Loading…</div>';
    let loaded;
    try { loaded = await loadItems(); } catch { loaded = null; }
    // Success AND rejection use the same ownership check. close() tears down
    // this mounted overlay; a later open() starts a fresh lifetime.
    if (!owns()) return;
    data = loaded;
    update();
  }

  return { open, close, toggle: () => (overlay ? close() : open()) };
}
