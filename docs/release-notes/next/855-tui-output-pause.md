## Changed

- **A hidden tab in `oats tui` no longer costs CPU while its agent
  prints** ([#855](https://github.com/awebai/oats/issues/855)). Its first
  output marks the tab as before. Its pane is then paused for `oats tui`
  (tmux's `refresh-client -A '%<pane>:pause'`) until the tab is shown
  again, when it is drawn from the pane's current screen. Measured with a
  hidden agent printing without pause, `oats tui` takes about 0.4% of a
  core instead of 11%, and its private tmux server 9% instead of 14%. The
  same holds while another view or an overlay covers the panel.
