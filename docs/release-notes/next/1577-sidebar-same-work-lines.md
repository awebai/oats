## Changed

- **Desktop and TUI: a parent's line joins only the children that do its
  work.** With an OATS that has the `instance-same-work` feature, the
  Desktop's sidebar and command palette draw a parent's line only to a child
  flagged as doing the same work (`sameWork: true`), and list those children
  first under their parent; the TUI, which draws no lines, lists them first
  too. The tree keeps its rows, indent and groups. So once the clients read the
  feature, the lines go away until flags are set: experts with live developers
  set them with the CLI, `oats instance same-work <instance> on`. Nothing is
  migrated automatically. A host without the feature keeps today's lines
  ([desktop.md](../desktop.md#the-sidebars-instance-tree),
  [tui.md](../tui.md#what-it-shows)).
