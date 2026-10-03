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
import { revealInScrollport } from "./reveal-in-scrollport.mjs";
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
 *          dot?: boolean|null, run?: Function, depth?: number, under?: string,
 *          group?: {key: string, label: string}, context?: boolean}>} spec.computeRows
 *        query → result rows, already scored/sorted/sliced by the caller.
 *        Optional tree shape (the palette's instances): consecutive rows sharing
 *        a group.key sit in one role=group named by group.label; depth indents
 *        (visual only); `under` is visually hidden text read with the option;
 *        a `context` row is shown dimmed with aria-disabled="true" and is never
 *        active, so the arrows, the cycle chord and pointer hover skip it.
 *        Async run callbacks must return their promise to carry the original
 *        cancellation opener across awaits; rejections are logged, not focused.
 *        Callbacks still own their destination's async selection/intent guards.
 * @param {(e: KeyboardEvent) => (1|-1|0)} [spec.cycleKey] the picker's own
 *        opening chord while it is open: 1 moves the active row down, -1 up,
 *        both wrapping and skipping context rows; it never commits (Enter does).
 *        With it, toggle() on an open picker cycles down instead of closing.
 * @param {Document} [spec.doc]
 * @returns {{ open: Function, close: Function, toggle: Function }} Opening
 *        replaces any other picker in this Document without returning focus.
 */
export function createOverlayPicker({ placeholder, ariaLabel, loadItems, computeRows, cycleKey = null, doc = globalThis.document }) {
  // IDs belong to the picker, not a render or a data-derived label. Result
  // slots keep their IDs across selection updates and cannot collide with a
  // second picker (including a palette → Quick Open handoff).
  const id = `overlay-picker-${++nextPickerId}`;
  if (!pickerDocuments.has(doc)) pickerDocuments.set(doc, { current: null, handoff: null });
  const coordinator = pickerDocuments.get(doc);
  let overlay = null;
  let gen = 0; // load generation — a stale item list must not paint over a newer open
  let hide = null;
  let cycle = null; // the open lifetime's cycle(direction), for toggle()

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
      cycle = null;
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
      // Before the keymap engine sees it: the picker's own chord cycles rows
      // instead of reopening, closing or reaching a terminal.
      const direction = cycleKey?.(e) || 0;
      if (direction) {
        e.preventDefault(); e.stopPropagation(); move(direction, true);
      } else if (e.key === "Escape") {
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
    let items = [];   // current result rows: { label, detail, dot, run, ... }
    let options = []; // the option element of each row, in row order
    let active = 0;
    const selectable = (i) => !!items[i] && !items[i].context;
    /** The next selectable row from `active` in `direction`: wrapping for the
     * cycle chord, clamped for the arrows; context rows are never landed on. */
    const step = (direction, wrap) => {
      for (let n = 1; n <= items.length; n++) {
        let i = active + direction * n;
        if (wrap) i = (i + items.length) % items.length;
        else if (i < 0 || i >= items.length) break;
        if (selectable(i)) return i;
      }
      return active;
    };
    function move(direction, wrap = false) {
      if (!items.length || !selectable(active)) return;
      active = step(direction, wrap); select();
    }
    cycle = (direction) => { if (owns()) move(direction, true); };

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
      options.forEach((row, i) => {
        const on = i === active && selectable(i);
        row.classList.toggle("active", on);
        row.setAttribute("aria-selected", String(on));
        if (on) input.setAttribute("aria-activedescendant", row.id);
      });
      // Only the list scrolls (never the overlay or the shell behind it).
      if (selectable(active)) revealInScrollport(list, options[active]);
    };
    const render = () => {
      if (!owns()) return;
      input.removeAttribute("aria-activedescendant");
      list.innerHTML = "";
      options = [];
      if (!items.length) {
        const d = doc.createElement("div");
        d.className = "palette-empty";
        d.textContent = "No matches.";
        list.append(d);
        return;
      }
      let group = null; // the role=group of the current run of rows sharing a group key
      items.forEach((it, i) => {
        const row = doc.createElement("div");
        row.id = `${id}-option-${i}`;
        row.className = "palette-item";
        row.setAttribute("role", "option");
        const dot = it.dot != null ? `<span class="pdot${it.dot ? " on" : ""}" aria-hidden="true"></span>` : `<span class="picon" aria-hidden="true">${icon("chevronRight", { size: 13 })}</span>`;
        row.innerHTML = `${dot}<span class="plabel"></span><span class="pdetail"></span>`;
        row.querySelector(".plabel").textContent = it.label;
        row.querySelector(".pdetail").textContent = it.detail || "";
        if (Number.isInteger(it.depth) && it.depth > 0) row.style.setProperty("--depth", String(it.depth));
        if (it.under) {
          const under = doc.createElement("span");
          under.className = "sr-only"; under.textContent = `, ${it.under}`;
          row.querySelector(".pdetail").append(under); // read as one phrase with the detail
        }
        // A match's ancestor, shown for its place in the tree: never active or run.
        if (it.context) { row.classList.add("context"); row.setAttribute("aria-disabled", "true"); }
        const inList = () => row.parentNode === list || row.parentNode?.parentNode === list;
        // Keep DOM focus in the combobox, but activate via click so keyboard/
        // assistive-technology synthesized clicks work without mousedown.
        row.addEventListener("mousedown", (e) => { e.preventDefault(); });
        row.addEventListener("click", () => { if (inList() && selectable(i)) activate(it); });
        row.addEventListener("mousemove", () => {
          if (owns() && inList() && active !== i && selectable(i)) {
            active = i; select(); // do not replace the row between pointer down/up
          }
        });
        if (!it.group) group = null;
        else if (group?.dataset.group !== it.group.key) {
          group = doc.createElement("div");
          group.className = "palette-group";
          group.setAttribute("role", "group");
          group.setAttribute("aria-label", it.group.label);
          group.dataset.group = it.group.key;
          list.append(group);
        }
        (group || list).append(row);
        options.push(row);
      });
      select();
    };

    const update = () => {
      if (!owns()) return;
      items = computeRows(data, input.value);
      active = Math.max(0, items.findIndex((it) => !it.context));
      render();
    };

    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => {
      if (!owns()) return;
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (selectable(active)) activate(items[active]);
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

  // A cycling picker's chord moves its rows while open (modalKeydown consumes it
  // first); toggle() — the same action from anywhere else — agrees.
  return { open, close, toggle: () => (!overlay ? open() : cycleKey ? cycle?.(1) : close()) };
}
