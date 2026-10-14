## Changed

- With an OATS CLI that lists `roster-workspace-key`, the Desktop's roster read
  contacts only the machines of the workspaces its windows show, plus those
  whose workspace is not known yet and those known only from a saved route. A
  machine registered for another workspace is no longer contacted, so one
  that is switched off no longer slows every window's roster. Opening a window
  on another workspace reads its machines at once; with an older CLI every
  machine is read, as before ([Which machines the Desktop
  reads](../desktop.md#a-workspaces-machines),
  [#1124](https://github.com/awebai/oats/issues/1124)).
