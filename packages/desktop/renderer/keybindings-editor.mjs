// oats desktop — keyboard shortcuts editor (shell-owned dialog).
//
// Like the palette overlay: plain DOM, semantic tokens from theme.css /
// shell.css, keyboard-first, ARIA dialog. Lists every registered action
// grouped by context with its effective chord as keycaps; a search at the top
// filters rows by name, group or keys; click a chord to record a new one (Esc
// cancels, Backspace unbinds), conflicts warned inline via findConflict,
// per-row reset, reset-all. docs/desktop-keyboard.md has its keys.

import {
  listActions, getBinding, setBinding, resetBinding, resetAllBindings,
  onKeymapChange, findConflict, keymapConflicts, formatChord, chordFromEvent, chordToString,
  isPlainChord, defaultBinding, chordKeys, terminalAllows,
} from "./keybindings.mjs";
import { takePickerFocusReturn } from "./overlay-picker.mjs";
import { icon } from "./shell-icons.mjs";

const CONTEXT_LABELS = {
  global: "Global",
  tabs: "Tabs",
  roster: "Instance roster",
  "stage:hierarchy": "Deployments",
  "stage:spawn": "Soul roster",
  // view-local contexts: never activated for window dispatch — the actions
  // dispatch inside their view surface but stay editor-visible here.
  "view:hierarchy": "Deployments",
  "view:spawn": "Soul roster",
  // a modal dialog's own keys: dispatched only by the open dialog (spawn-dialog-keys.mjs)
  "spawn-dialog-local": "Spawn dialog",
};

// A terminal lives in the tab layer, where the shell activates only the "tabs" context
// (shell.mjs, updateActiveContexts): global and tabs actions are the ones that can
// fire while a terminal has focus. Whether one does is the engine's terminalAllows.
const TERMINAL_LAYER_CONTEXTS = new Set(["global", "tabs"]);

/** Group registered actions by context, stable order, for rendering. */
export function groupActions(actions = listActions()) {
  const order = ["global", "tabs", "roster", "stage:hierarchy", "view:hierarchy", "stage:spawn", "view:spawn", "spawn-dialog-local"];
  const groups = new Map();
  for (const a of actions) {
    if (!groups.has(a.context)) groups.set(a.context, []);
    groups.get(a.context).push(a);
  }
  const sorted = [...groups.entries()].sort((x, y) => {
    const xi = order.indexOf(x[0]); const yi = order.indexOf(y[0]);
    return (xi < 0 ? order.length : xi) - (yi < 0 ? order.length : yi);
  });
  for (const [, list] of sorted) list.sort((a, b) => a.label.localeCompare(b.label));
  return sorted.map(([context, list]) => ({
    context, label: CONTEXT_LABELS[context] || context, actions: list,
  }));
}

// Each modifier keycap and the words a search may use for it.
const KEY_WORDS = new Map([
  ["ctrl", ["ctrl", "control"]], ["⌃", ["⌃", "ctrl", "control"]],
  ["alt", ["alt", "option"]], ["⌥", ["⌥", "option", "opt", "alt"]],
  ["shift", ["shift"]], ["⇧", ["⇧", "shift"]],
  ["⌘", ["⌘", "cmd", "command"]],
]);

/** Does a row match the search? Case-insensitive, on the action's label, its group's
 * name, or the chord as shown: "shift+b", "ctrl shift b" and "ctrlshiftb" all find
 * Ctrl+Shift+B, and on macOS "cmd shift b" finds ⇧⌘B (each word starts one of the
 * chord's keys, in any order). An unbound row's chord reads "unbound". */
export function shortcutMatches({ label = "", group = "", chord = null }, query, isMac) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  if (label.toLowerCase().includes(q) || group.toLowerCase().includes(q)) return true;
  const keys = chord ? chordKeys(chord, isMac).map(k => k.toLowerCase()) : [];
  if (!keys.length) return "unbound".includes(q);
  const compact = q.replace(/[\s+]+/g, "");
  if (compact && keys.join("").includes(compact)) return true;
  const words = q.split(/[\s+]+/).filter(Boolean);
  return words.length > 0 && words.every(w => keys.some(k => (KEY_WORDS.get(k) || [k]).some(name => name.startsWith(w))));
}

export function createKeybindingsEditor({ doc = document, isMac } = {}) {
  let overlay = null;
  let offKeymap = null;
  let restoreFocus = null;
  let stopRecording = null; // teardown for an in-flight chord capture

  function endRecording() {
    if (stopRecording) { const stop = stopRecording; stopRecording = null; stop(); }
  }

  function close() {
    if (!overlay) return;
    endRecording(); // the capture listener must not outlive the dialog
    offKeymap?.(); offKeymap = null;
    overlay.remove(); overlay = null;
    try { restoreFocus?.restore(); } catch { /* focus target may be gone */ }
    restoreFocus = null;
  }

  function open() {
    // Direct Mod+, must release an existing picker exactly like a palette-row
    // handoff, without leaving its document-level focus trap behind the editor.
    const opener = takePickerFocusReturn(doc);
    if (overlay) { overlay.querySelector(".kb-search").focus(); return; }
    restoreFocus = opener;
    overlay = doc.createElement("div");
    overlay.className = "palette-overlay kb-overlay";
    overlay.innerHTML = `
      <div class="kb-editor" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div class="kb-head">
          <h2 class="kb-title">Keyboard shortcuts</h2>
          <div class="kb-search-field">${icon("search", { size: 13 })}<input type="search" class="kb-search"
            aria-label="Search shortcuts" placeholder="Search by name, group or keys" autocomplete="off" spellcheck="false"></div>
          <button type="button" class="kb-reset-all">Reset all</button>
          <button type="button" class="kb-close" aria-label="Close shortcuts editor">${icon("close", { size: 14 })}</button>
        </div>
        <p class="kb-hint">Click a shortcut to record a new one — Esc cancels, Backspace unbinds.</p>
        <p class="kb-clashes" role="status" hidden></p>
        <p class="kb-count sr-only" role="status"></p>
        <div class="kb-body"></div>
      </div>`;
    const search = overlay.querySelector(".kb-search");
    const body = overlay.querySelector(".kb-body");
    // The chord buttons of the rows the search shows, in order (Up/Down move along them).
    const visibleChords = () => [...body.querySelectorAll(".kb-chord")].filter((el) => !el.closest("[hidden]"));

    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
    overlay.addEventListener("keydown", (e) => {
      if (stopRecording) return; // the recorder owns every key, Esc included (it cancels)
      if (e.key === "Escape") {
        e.preventDefault();
        // A search is cleared first, from anywhere in the editor; the next Esc closes.
        if (search.value) { search.value = ""; applySearch({ announce: true }); search.focus(); } else close();
        return;
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const chords = visibleChords();
        const row = e.target.closest?.(".kb-row");
        let to = null;
        if (e.target === search) to = e.key === "ArrowDown" ? chords[0] : null;
        else if (row) {
          const at = chords.indexOf(row.querySelector(".kb-chord"));
          to = e.key === "ArrowDown" ? chords[at + 1] : at === 0 ? search : chords[at - 1];
        }
        if (to) { e.preventDefault(); to.focus(); }
        return;
      }
      if (e.key !== "Tab") return;
      // aria-modal promises focus containment — wrap Tab/Shift+Tab inside the
      // dialog (same handling as the workspace-switcher modal). The search is
      // the first stop; rows the search hides have none.
      const dialog = overlay.querySelector(".kb-editor");
      const focusable = [...dialog.querySelectorAll("input, button:not([disabled])")]
        .filter((el) => !el.closest("[hidden]") && el.tabIndex >= 0);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) {
        e.preventDefault(); first.focus();
      }
    });
    doc.body.append(overlay);
    overlay.querySelector(".kb-close").addEventListener("click", close);
    overlay.querySelector(".kb-reset-all").addEventListener("click", () => { endRecording(); resetAllBindings(); });
    search.addEventListener("input", () => applySearch({ announce: true }));

    // Show the rows that match the search, hide groups left empty, say when nothing
    // matches, and (when the query changed) announce the count politely.
    const applySearch = ({ announce = false } = {}) => {
      const query = search.value;
      let shown = 0;
      for (const group of body.querySelectorAll(".kb-group")) {
        let inGroup = 0;
        for (const row of group.querySelectorAll(".kb-row")) {
          const match = shortcutMatches({ label: row.dataset.label, group: group.dataset.label, chord: row.dataset.chord || null }, query, isMac);
          row.hidden = !match;
          if (match) inGroup++;
        }
        group.hidden = inGroup === 0;
        shown += inGroup;
      }
      const none = body.querySelector(".kb-nomatch");
      if (none) {
        none.hidden = shown > 0;
        none.textContent = shown > 0 ? "" : `No shortcut matches “${query.trim()}”`;
      }
      if (announce) overlay.querySelector(".kb-count").textContent = `${shown} ${shown === 1 ? "shortcut" : "shortcuts"}`;
    };

    const render = () => {
      endRecording(); // a rerender invalidates any in-flight capture
      // Preserve keyboard focus across the rebuild (review 267c551): remember
      // which row control owned focus (keyed by action id + control kind) and
      // restore it on the replacement node, else fall back into the dialog so
      // Tab can never restart from <body> outside the trap.
      const focused = doc.activeElement;
      const hadDialogFocus = overlay.contains(focused);
      const focusKey = hadDialogFocus && focused?.dataset?.actionId
        ? { id: focused.dataset.actionId, kind: focused.classList.contains("kb-reset") ? "kb-reset" : "kb-chord" }
        : null;
      body.innerHTML = "";
      // A shortcut you set that now shares its chord with another (a new default, say): named
      // up top, marked on its row. Nothing is rebound for you.
      const clashes = keymapConflicts(isMac);
      const clashEl = overlay.querySelector(".kb-clashes");
      clashEl.hidden = !clashes.length;
      clashEl.textContent = clashes.length
        ? `${clashes.length === 1 ? "A shortcut you set clashes" : `${clashes.length} shortcuts you set clash`} with another: ${clashes
          .map(({ chord, actions: [a, b] }) => `${formatChord(chord, isMac)} is both “${a.label}” and “${b.label}”`).join("; ")}. Rebind or reset one.`
        : "";
      const groups = groupActions();
      if (!groups.length) {
        const d = doc.createElement("div");
        d.className = "kb-empty";
        d.textContent = "No actions registered.";
        body.append(d);
      } else {
        for (const group of groups) {
          // One group: its heading sticks to the top of the scroll area while its rows scroll.
          const section = doc.createElement("section");
          section.className = "kb-group";
          section.dataset.label = group.label;
          const h = doc.createElement("h3");
          h.className = "kb-context";
          h.textContent = group.label;
          section.append(h);
          for (const action of group.actions) section.append(row(action, group));
          body.append(section);
        }
        const none = doc.createElement("p");
        none.className = "kb-empty kb-nomatch";
        none.hidden = true;
        body.append(none);
      }
      applySearch();
      if (focusKey) {
        const controls = [...body.querySelectorAll(".kb-chord, .kb-reset")];
        const target = controls.find((el) => el.dataset.actionId === focusKey.id && el.classList.contains(focusKey.kind) && !el.hidden)
          // a hidden per-row reset (row back at default) falls back to its chord button
          ?? controls.find((el) => el.dataset.actionId === focusKey.id && el.classList.contains("kb-chord"));
        if (target && !target.closest("[hidden]")) { target.focus(); return; }
      }
      // focus left the rebuilt rows, or its row is filtered out: keep it inside the dialog
      if (hadDialogFocus && !overlay.contains(doc.activeElement)) search.focus();
    };

    const row = (action, group) => {
      const el = doc.createElement("div");
      el.className = "kb-row";
      const chordStr = getBinding(action.id, isMac); // this platform's effective chord
      // the effective default: static table or registration-supplied
      const fixed = defaultBinding(action.id, isMac);
      const defaultChord = fixed !== undefined ? fixed : action.defaultChord ?? null;
      const isDefault = chordStr === defaultChord;
      const chordText = chordStr ? formatChord(chordStr, isMac) : "unbound";
      // What matchEvent would allow from a focused terminal: by id on Linux/Windows, by chord on macOS.
      const inTerminal = !!chordStr && TERMINAL_LAYER_CONTEXTS.has(action.context) && terminalAllows(action.id, chordStr, isMac);
      el.dataset.label = action.label;
      if (chordStr) el.dataset.chord = chordStr;
      el.innerHTML = `
        <span class="kb-main"><span class="kb-label"></span><span class="kb-conflict" role="status"></span></span>
        <span class="kb-marks" aria-hidden="true"></span>
        <span class="kb-chord-cell"><button type="button" class="kb-chord"></button></span>
        <span class="kb-reset-slot"><button type="button" class="kb-reset" title="Reset to default" aria-label="Reset to default">${icon("reset", { size: 14 })}</button></span>`;
      el.querySelector(".kb-label").textContent = action.label;
      // Quiet markers; the chord button's name carries them for assistive technology.
      const marks = el.querySelector(".kb-marks");
      const mark = (kind, text, title) => {
        const m = doc.createElement("span");
        m.className = `kb-mark kb-mark-${kind}`;
        m.textContent = text;
        m.title = title;
        marks.append(m);
      };
      if (inTerminal) mark("terminal", "terminal", "Works while a terminal has focus");
      if (!isDefault) mark("changed", "changed", `Changed from the default, ${defaultChord ? formatChord(defaultChord, isMac) : "unbound"}`);
      const chordBtn = el.querySelector(".kb-chord");
      chordBtn.dataset.actionId = action.id;
      if (chordStr) {
        // One keycap per key, not read key by key: the button's name has the chord as one string.
        const keys = doc.createElement("span");
        keys.className = "kb-keys";
        keys.setAttribute("aria-hidden", "true");
        for (const k of chordKeys(chordStr, isMac)) {
          const kbd = doc.createElement("kbd");
          kbd.textContent = k;
          keys.append(kbd);
        }
        chordBtn.append(keys);
      } else chordBtn.textContent = "unbound";
      chordBtn.classList.toggle("kb-unbound", !chordStr);
      chordBtn.setAttribute("aria-label", `Change shortcut for ${action.label}, currently ${chordText}`
        + (inTerminal ? ", works in a terminal" : "") + (isDefault ? "" : ", changed from the default"));
      const resetBtn = el.querySelector(".kb-reset");
      resetBtn.dataset.actionId = action.id;
      resetBtn.hidden = isDefault;
      resetBtn.setAttribute("aria-label", `Reset shortcut for ${action.label} to default`);
      resetBtn.addEventListener("click", () => resetBinding(action.id));

      const conflictEl = el.querySelector(".kb-conflict");
      const existing = chordStr ? findConflict(chordStr, action.context, action.id, isMac) : null;
      // Both facts matter independently: a bare chord that ALSO conflicts
      // must still disclose the editable-field suppression (review c5493b1).
      const warnings = [];
      if (existing) warnings.push(`Also bound to “${existing.label}”`);
      if (chordStr && isPlainChord(chordStr)) {
        // review-mandated warning: bare-key bindings are suppressed while an
        // editable field has focus (matchEvent's editable-field guard).
        warnings.push("Bare key — won’t fire while typing in a text field");
      }
      conflictEl.textContent = warnings.join(" · ");

      chordBtn.addEventListener("click", () => startRecording(action, chordBtn, conflictEl));
      return el;
    };

    const startRecording = (action, btn, conflictEl) => {
      if (stopRecording) return;
      btn.classList.add("kb-recording");
      btn.textContent = "Press keys…";
      const onKey = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") { endRecording(); render(); return; }
        if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
          endRecording(); setBinding(action.id, null); return;
        }
        const chord = chordFromEvent(e, isMac);
        if (!chord) return; // bare modifier — keep recording
        const conflict = findConflict(chord, action.context, action.id, isMac);
        if (conflict) conflictEl.textContent = `Also bound to “${conflict.label}”`;
        endRecording();
        setBinding(action.id, chordToString(chord));
      };
      stopRecording = () => {
        doc.removeEventListener("keydown", onKey, true);
        btn.classList.remove("kb-recording");
      };
      doc.addEventListener("keydown", onKey, true);
    };

    offKeymap = onKeymapChange(render);
    render();
    search.focus();
  }

  return {
    open,
    close,
    toggle: () => (overlay ? close() : open()),
    isOpen: () => !!overlay,
  };
}
