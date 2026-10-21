// keybindings.mjs reads the platform from the global navigator.platform (defaultIsMac). Under Node
// that is the host's: "MacIntel" on a macOS runner, where the Mac keymap applies and the Linux and
// Windows defaults (the Alt+Shift arrows among them) are not the keymap's. A test of those defaults
// that dispatches through a view, with no isMac to pass, pins the platform for its own run.
export function pinPlatform(t, platform = "Linux x86_64") {
  const nav = globalThis.navigator;
  if (!nav) return; // no navigator: defaultIsMac already answers false
  const own = Object.getOwnPropertyDescriptor(nav, "platform");
  Object.defineProperty(nav, "platform", { value: platform, configurable: true });
  t.after(() => { if (own) Object.defineProperty(nav, "platform", own); else delete nav.platform; });
}
