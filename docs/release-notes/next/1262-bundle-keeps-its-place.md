## Changed

- **Desktop and TUI: the instance list is in name order**
  ([#1262](https://github.com/awebai/oats/issues/1262)). The sidebar, the
  command palette and the TUI's list order instances by name, each bundle by
  its top instance. Starting or stopping an instance no longer moves it, and
  running instances are no longer gathered at the top.

## Fixed

- **Desktop and TUI: a bundle keeps its place when its instance gains or
  loses children** ([#1262](https://github.com/awebai/oats/issues/1262)).
  An instance that spawns its first child no longer jumps to the top of the
  list with its new bundle: it stays where it was, with the child under it,
  and it stays there when its last child goes.
