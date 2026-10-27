## Fixed

- **Desktop and TUI: an agent whose window has a second pane can be opened
  again** ([#1569](https://github.com/awebai/oats/issues/1569)). A window
  with more than one pane read as unknown, "Instance window has multiple
  panes; check its terminal before starting", and its row had no Open. So
  you couldn't reach the extra pane to close it. OATS's own setup splits one
  off for a no-echo prompt, such as an API key or an invite token.
  - Desktop's and TUI's own terminal check now read the agent's pane as
    the kernel does. That's the pane OATS marks as the agent's; for a
    window from before the mark, the window's own first pane. The other
    panes never make the agent unknown. When it can't tell (two panes marked
    as the agent's, or none that can be), the row stays unknown and says
    which panes, with the kernel's sentence.
  - Desktop: a terminal opened on such a window starts on the agent's pane,
    wherever the focus was, so typing goes to the agent and never into a
    forgotten prompt. In the TUI, and in Desktop for another machine, the
    kernel's viewer does the same. A click doesn't select a pane in these
    terminals, so a terminal opened after the split can't reach the prompt:
    the agent closes the prompt and opens it again while you watch.
  - Desktop: a pull request's **Send N threads to <instance>** pastes into
    the agent's pane, as the kernel names it, never the window's active pane. When the kernel can't
    tell which pane is the agent's, nothing is pasted.
