## Added

- **TUI: lost sessions are resumed when `oats tui` opens**
  ([#1559](https://github.com/awebai/oats/issues/1559)). After a shutdown, a
  reboot or a crash, `oats tui` asks OATS to resume every instance whose
  session was lost, on every deployment on this computer, without holding up
  its first screen. It asks again whenever a read shows a session lost while
  it is open, at most every 30 seconds. `oats tui` says nothing about a
  resume: the list is read again after each one, so a resumed instance shows
  running. `oats session resume --plan --json` shows what a resume would do,
  and `oats session resume` run by hand says why an instance could not be
  resumed. Quitting while the sessions are being resumed does not cut that
  short. There is no setting: stop an instance with OATS to keep it down.
  `S` and `R` are unchanged and never resume a conversation. See
  [Resuming lost sessions](../tui.md#resuming-lost-sessions).
