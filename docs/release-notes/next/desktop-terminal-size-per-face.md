## Fixed

- **Desktop: the terminal font size belongs to its face**
  ([#1571](https://github.com/awebai/oats/issues/1571)). Omarchy's font in the
  terminals used a size chosen for Inconsolata, which in the wider face is a
  fifth larger. Each face now keeps its own size and default: Omarchy's font
  13px, Inconsolata (System font, macOS, and Omarchy's font where it shows
  System font's faces) 15px, on every computer. A size stored before keeps
  applying to Inconsolata; Omarchy's font starts at its default. Changing the
  size (⌘= / ⌘-, the palette, Settings → Terminal) or resetting it (⌘0,
  **Terminal: reset typography**, Settings' **Reset to default**) changes the
  face in use only. A font change gives open terminals that face's size in
  place, and Settings shows its default (**Theme and font**, under
  [Workspaces](../desktop.md#workspaces)).
