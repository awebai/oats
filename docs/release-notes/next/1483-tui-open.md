## Added

- **`oats tui --open` and `oats session attach --open`** open the TUI, or a
  viewer of one instance, in a new terminal window of the person's desktop
  session, from an agent's shell
  ([#1483](https://github.com/awebai/oats/issues/1483)). macOS asks
  Terminal through `osascript`. Linux starts the window through
  `systemd-run --user` with `xdg-terminal-exec`, else `x-terminal-emulator`,
  so it gets the desktop session's environment and not the agent's. The
  window's command carries the `node` and `oats` directories on its `PATH`.
  `--json` answers `{ opened: "requested", via, command }`: a window was
  asked for, which is all `oats` can see. Without a launcher, or when it
  fails, the answer is `E_OPEN_UNAVAILABLE`, with the command to run by
  hand. See [Open it from an agent](../tui.md#open-it-from-an-agent).
