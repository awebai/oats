// Static, app-owned SVGs in the supplied design's simple line-icon language.
// Only named entries are accepted: no paths, attributes, URLs or SVG from data.
const paths = Object.freeze({
  overview: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="2"/>',
  workspace: '<path d="m2 7 6-5 6 5M3.5 6v8h9V6M6 14V9h4v5"/>',
  schedules: '<circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  sidebar: '<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M6 3v10"/>',
  theme: '<circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 0 0 12Z" fill="currentColor" stroke="none"/>',
  shortcuts: '<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M4 6h.1M6.5 6h.1M9 6h.1M11.5 6h.1M4 8.5h.1M6.5 8.5h.1M9 8.5h.1M11.5 8.5h.1M5 10.5h6"/>',
  palette: '<path d="m3 4 4 4-4 4M9 12h4"/>',
  settings: '<path d="M2 4h2m3 0h7M2 8h7m3 0h2M2 12h4m3 0h5"/><circle cx="5.5" cy="4" r="1.5"/><circle cx="10.5" cy="8" r="1.5"/><circle cx="7.5" cy="12" r="1.5"/>',
  chevron: '<path d="m4 6 4 4 4-4"/>',
  splitRight: '<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M8 2v12"/>',
  splitDown: '<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 8h12"/>',
  splitClose: '<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="m6 6 4 4m0-4-4 4"/>',
});

export function shellIcon(name) {
  if (!Object.hasOwn(paths, name)) throw new TypeError("Unknown shell icon");
  return `<svg class="shell-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${["splitRight", "splitDown", "splitClose"].includes(name) ? "1.1" : "1.4"}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

/** Fill only shell-owned, explicitly named icon slots. Names never come from APIs. */
export function mountShellIcons(document) {
  for (const slot of document.querySelectorAll("[data-shell-icon]")) {
    slot.innerHTML = shellIcon(slot.dataset.shellIcon);
  }
}
