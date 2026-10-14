## Changed

- **Desktop shortcuts work from a focused terminal on Linux and Windows.**
  Three defaults moved so they no longer take a key a program reads: the
  sidebar is Ctrl+Shift+B (was Ctrl+B, the tmux prefix), the instance panel
  Ctrl+Shift+I (was Ctrl+I, the Tab key) and filter instances Ctrl+Shift+F
  (was Ctrl+F). These three, the stages (Ctrl+1, Ctrl+2, Ctrl+3), the
  shortcuts editor (Ctrl+,) and terminal zoom (Ctrl+= Ctrl+- Ctrl+0) now work
  while a terminal has focus. Plain Ctrl+B, Ctrl+I and Ctrl+F reach the
  program, and a shortcut you set yourself is kept. Ctrl+3 from a terminal now
  opens Automations instead of sending ESC: use Esc. macOS is unchanged. See
  [Desktop keyboard](../../packages/desktop/docs/desktop-keyboard.md).
