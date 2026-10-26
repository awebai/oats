## Added

- **Desktop: a font picker.** **Font…** in the settings cog's menu, or
  **Font: choose…** in the command palette (no default shortcut; give it one
  in the shortcuts editor), chooses between
  **Omarchy's font** and **System font**. The choice is kept on this computer
  and applies at once: open terminals switch font in place and keep their
  session. The terminal font size and zoom are unchanged (**Theme and
  font**, under [Workspaces](../desktop.md#workspaces)).

## Changed

- **Desktop: on Omarchy, the font is Omarchy's by default.** On a computer
  that runs Omarchy, the window and its terminals use the computer's
  monospace font, the one `omarchy font set` changes (fontconfig's
  `monospace`), and the terminal's default size is 13px (JetBrains Mono,
  Omarchy's default face, at 13px; 15px elsewhere). In Omarchy's font,
  instance names in the sidebar and on tabs are 12px, a little smaller than
  System font's 12.5px. Everywhere else the
  default stays **System font**, the previous faces; **Omarchy's font** can be
  chosen there too (on Windows the system's monospace font; on macOS JetBrains
  Mono, with the terminals keeping Inconsolata). A chosen font or terminal size
  always wins. A terminal font family set with **Terminal: set font
  family…** still wins. Where the computer's monospace font does not draw at
  a fixed width (none installed, or a bitmap font), Omarchy's font shows
  System font's faces and its row in the picker says so.
