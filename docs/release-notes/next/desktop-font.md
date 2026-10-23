## Added

- **Desktop: a font picker.** **Font…** in the settings cog's menu, or
  **Font: choose…** in the command palette (no default shortcut; give it one
  in the shortcuts editor), chooses between
  **Omarchy's font** and **System font**. The choice is kept on this computer
  and applies at once: open terminals switch font in place and keep their
  session. The terminal font size and zoom are unchanged
  ([Workspaces](../desktop.md#workspaces)).

## Changed

- **Desktop: the font is Omarchy's by default.** On Linux the window and its
  terminals use the computer's monospace font, the one `omarchy font set`
  changes (fontconfig's `monospace`); on Windows the system's monospace font.
  On macOS the window uses JetBrains Mono, Omarchy's default face, and the
  terminals keep Inconsolata. **System font** in the font picker brings back
  the previous faces. A terminal font family set with **Terminal: set font
  family…** still wins. Where the computer's monospace font does not draw at
  a fixed width (none installed, or a bitmap font), Omarchy's font shows
  System font's faces and its row in the picker says so.
