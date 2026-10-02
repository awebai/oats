// One Desktop window per workspace (#481): the registry of open windows, in main. Pure over the
// windows it is given: `create(key, options)` makes a window (a BrowserWindow in main), which only needs
// isDestroyed, isMinimized, restore, show and focus here.
//
// A window's key is the workspace view id it is bound to, or null while it has none (a New Window
// showing the switcher). At most one live window holds a key. Every binding goes through open()
// (main creating a window for a workspace) or claim() (a window switching in place).

/** Restore (if minimized), show and focus a window. */
function present(win) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function createWindowSet({ create }) {
  const keys = new Map();   // window -> key | null, for every registered window
  const holders = new Map(); // key -> window
  let order = [];           // windows by last focus, the most recent last
  const live = (win) => !!win && keys.has(win) && !win.isDestroyed();
  const holder = (key) => { const win = holders.get(key); return live(win) ? win : null; };
  const bind = (win, key) => {
    const old = keys.get(win);
    if (old != null && holders.get(old) === win) holders.delete(old);
    keys.set(win, key);
    if (key != null) holders.set(key, win);
  };
  const add = (win, key) => { bind(win, key); order.push(win); return win; };
  const mostRecent = () => {
    for (let i = order.length - 1; i >= 0; i--) if (live(order[i])) return order[i];
    return null;
  };

  return {
    /** The workspace's window: `{ focused: true, win }` after presenting the one that holds it,
     * else `{ opened: true, win }` for a window created for it. */
    open(key, options) {
      const held = holder(key);
      if (held) { present(held); return { focused: true, win: held }; }
      return { opened: true, win: add(create(key, options), key) };
    },
    /** A window bound to no workspace yet. */
    openUnbound(options) {
      return add(create(null, options), null);
    },
    /** Bind `win` to `key` in place. A key another live window holds is refused: that window is
     * presented (`focused-other`) unless `focus` is false (`open-elsewhere`). */
    claim(win, key, { focus = true } = {}) {
      if (!live(win)) return { ok: false, code: 'unknown-window' };
      const held = holder(key);
      if (held && held !== win) {
        if (!focus) return { ok: false, code: 'open-elsewhere' };
        present(held);
        return { ok: false, code: 'focused-other' };
      }
      bind(win, key);
      return { ok: true };
    },
    /** The window keeps running with no workspace. */
    unbind(win) {
      if (keys.has(win)) bind(win, null);
    },
    /** A closed window leaves the registry. */
    remove(win) {
      if (!keys.has(win)) return;
      bind(win, null);
      keys.delete(win);
      order = order.filter((w) => w !== win);
    },
    focused(win) {
      if (!keys.has(win)) return;
      order = [...order.filter((w) => w !== win), win];
    },
    /** The key a window is bound to: a key, null (unbound), undefined (not registered). */
    keyOf: (win) => keys.get(win),
    windowOf: (key) => holder(key),
    /** The most recently focused live window, or null. */
    mostRecent,
    /** Present the most recently focused live window; it, or null. */
    focusRecent() {
      const win = mostRecent();
      if (win) present(win);
      return win;
    },
    /** Every live registered window with its key. */
    entries: () => [...keys].filter(([win]) => live(win)),
  };
}
