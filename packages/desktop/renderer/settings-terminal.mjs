// Settings → Terminal: the visible way to change the terminal font size (spec F,
// the operator's 2026-10-02 decision). A stepper (− [16] +, or a typed value)
// over the same typography store the keys and the palette use (theme.mjs), so
// ⌘= / ⌘- / ⌘0 and this control always agree. The font family stays on the
// palette's prompt. Built from the Settings dialog's own components (.forge-*).
import {
  terminalTypography, setTerminalFontSize, resetTerminalFontSize, onTerminalTypographyChange,
  clampTerminalFontSize, TERMINAL_FONT_SIZE, TERMINAL_FONT_MIN, TERMINAL_FONT_MAX,
} from "./theme.mjs";

export const settingsTerminalCSS = `
.forge-settings .term-size { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.forge-settings .term-size label { flex:none; }
.forge-settings .term-size input { width:7ch; /* room for the native spinner */ text-align:center; font-variant-numeric:tabular-nums; }
.forge-settings .term-size input:focus-visible { outline:none; border-color:var(--accent); }
.forge-settings .term-size button { min-width:32px; }
.forge-settings .term-size [aria-disabled=true] { cursor:default; }
`;

/** One mounted section; `dispose()` drops its typography subscription. The
 * store is injectable so the section is testable without a live renderer. */
export function createTerminalSettings({ doc, store = {
  read: () => terminalTypography().fontSize, set: setTerminalFontSize, reset: resetTerminalFontSize,
  subscribe: onTerminalTypographyChange,
}, chords = {} } = {}) {
  const node = (tag, text, cls) => { const n = doc.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = (text, label, fn) => { const b = node("button", text); b.type = "button"; if (label) b.setAttribute("aria-label", label); b.addEventListener("click", fn); return b; };
  const section = node("section"); section.setAttribute("aria-labelledby", "settings-terminal-title");
  const title = node("h3", "Terminal"); title.id = "settings-terminal-title";
  const card = node("div", undefined, "forge-card");

  const input = node("input"); input.type = "number"; input.id = "settings-terminal-size";
  input.min = String(TERMINAL_FONT_MIN); input.max = String(TERMINAL_FONT_MAX); input.step = "1"; input.inputMode = "numeric";
  const label = node("label", "Font size"); label.htmlFor = input.id;
  const unit = node("span", "px", "forge-hint"); unit.setAttribute("aria-hidden", "true");
  // aria-disabled, not disabled: a focused button at a bound keeps focus.
  const smaller = button("−", "Decrease font size", () => { if (current > TERMINAL_FONT_MIN) store.set(current - 1); });
  const bigger = button("+", "Increase font size", () => { if (current < TERMINAL_FONT_MAX) store.set(current + 1); });
  const row = node("div", undefined, "term-size");
  row.append(label, smaller, input, unit, bigger);
  const reset = button(`Reset to default (${TERMINAL_FONT_SIZE})`, undefined, () => store.reset());
  const actions = node("div", undefined, "forge-actions"); actions.append(reset);
  const keys = [chords.bigger, chords.smaller, chords.reset].every(Boolean) ? ` ${chords.bigger} / ${chords.smaller} / ${chords.reset} change it too.` : "";
  const hint = node("p", `Applies to every open terminal, from ${TERMINAL_FONT_MIN} to ${TERMINAL_FONT_MAX}px.${keys}`, "forge-hint");
  hint.id = "settings-terminal-hint"; input.setAttribute("aria-describedby", hint.id);
  card.append(row, actions, hint);
  section.append(title, card);

  let current = TERMINAL_FONT_SIZE;
  function show(size) {
    current = clampTerminalFontSize(size);
    input.value = String(current);
    smaller.setAttribute("aria-disabled", String(current <= TERMINAL_FONT_MIN));
    bigger.setAttribute("aria-disabled", String(current >= TERMINAL_FONT_MAX));
  }
  // A typed value commits on Enter or when the field is left (change), never
  // per keystroke: typing "12" must not apply 1 (clamped to 9) on the way.
  function commit() {
    const typed = Number(input.value);
    if (input.value.trim() === "" || !Number.isFinite(typed)) { show(current); return; }
    const next = clampTerminalFontSize(typed);
    show(next); // a clamped or rounded entry reads back as what applies
    if (next !== store.read()) store.set(next);
  }
  input.addEventListener("change", commit);
  input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); commit(); } });
  show(store.read());
  const unsubscribe = store.subscribe(value => show(value.fontSize));
  return { element: section, input, dispose: () => unsubscribe() };
}
