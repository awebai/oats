## Changed

- **The Desktop's command palette lists instances by last focus.** With an
  empty query, ⌘K / Ctrl+Shift+P starts with a **Recent** group: every
  instance of the window's workspace whose terminal you have focused, most
  recent first, each with its parent as quiet text. The instances you have
  not focused follow in the sidebar's tree order. When the most recent is the
  terminal in front, the palette opens on the one before it, so ⌘K then Enter
  returns to the previous agent. With a query, recent matches come first. The
  sidebar roster keeps its stable order. The record stays on this machine, in
  the Desktop's own storage (the 200 most recent per workspace), and survives a
  restart; it is never written to a deployment.
