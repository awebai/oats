// The small number at the end of each tab: its position in its own strip, the
// N that "go to tab N" (tabs.goto1..9, Alt+N; ⌥⌘N on macOS) reaches. The shell's
// gotoTab takes tab n of the active tab's strip and the last tab for 9, as in
// browsers, so a strip numbers its first eight tabs 1–8 and its last tab 9 once
// it has nine or more; a tab past the eighth that is not the last has no number.
//
// Every strip numbers its own tabs: the flat #tabbar and, while the tabs are
// split, each group's .group-tabbar. Only the strip's tabs that are not hidden
// count, in the order the strip draws them, which is the order the tab keys walk
// (shell.mjs walkedTabs); a hidden tab belongs to another context or workspace,
// and its number is cleared. The number is decorative (aria-hidden, created
// empty by createTabChrome in tab-a11y.mjs): the trigger's accessible name stays
// the bare title. How it gives way at narrow widths is shell.css's (.tab-trigger).
// The shell calls numberTabStrips whenever a strip's tabs change.

/** The number tab `index` (0-based) of a strip of `count` tabs shows: 1–8, 9 for the last of nine or more, else null. */
export function tabNumber(index, count) {
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || index >= count) return null;
  if (index < 8) return index + 1;
  return index === count - 1 ? 9 : null;
}

function show(tab, number) {
  const num = tab.querySelector(":scope > .tab-trigger > .tab-num");
  if (!num) return;
  const text = number == null ? "" : String(number);
  // Write only on a change: the strip's observers and the trigger's layout see nothing when nothing moved.
  if (num.textContent !== text) num.textContent = text;
  if (num.hidden !== !text) num.hidden = !text;
}

/** Number every strip's tabs (an iterable of strip elements; missing ones are skipped). */
export function numberTabStrips(strips) {
  for (const strip of strips ?? []) {
    if (!strip) continue;
    const tabs = [...strip.querySelectorAll(":scope > .tab")];
    const shown = tabs.filter(tab => !tab.hidden);
    for (const tab of tabs) if (tab.hidden) show(tab, null);
    shown.forEach((tab, i) => show(tab, tabNumber(i, shown.length)));
  }
}
