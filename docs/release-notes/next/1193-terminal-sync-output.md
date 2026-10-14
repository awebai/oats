## Fixed

- **Desktop: the cursor no longer flashes while you type in a terminal tab**
  ([#1193](https://github.com/awebai/oats/issues/1193)). Each keystroke in a
  program like Claude Code reaches the tab as one redraw that hides the cursor,
  repaints the line and shows the cursor again; a redraw that arrived in two
  pieces was sometimes painted half done, with the cursor hidden. The Desktop
  now attaches its tmux viewer with synchronized output (on tmux 3.2 and later)
  and paints each redraw only once it is whole. Local terminal tabs have the fix
  now; a tab on another machine has it once that machine's oats has the
  matching viewer change.
