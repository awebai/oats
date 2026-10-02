// The globals shell.mjs functions use for one window per workspace (#481), for tests that run them in a
// vm: a window bound to its workspace (never choosing) and a bridge with no window channels. A test's
// own values win.
export function withShellWindowGlobals(context) {
  return Object.assign(context, { windowState: () => 'bound', desktopBridge: {} },
    Object.fromEntries(['windowState', 'desktopBridge'].filter((name) => Object.hasOwn(context, name)).map((name) => [name, context[name]])));
}
