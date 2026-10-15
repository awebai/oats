## Added

- **`oats tui` stops, starts, restarts and retires an agent**
  ([#855](https://github.com/awebai/oats/issues/855)). With an instance
  selected, `X` stops it, `D` retires it, `S` starts it and `R` restarts it,
  each after a confirmation that opens with the focus on `Cancel`: the act
  takes a move (`Left`/`Right` or `Tab`) and a press of `Enter`, and pasted
  text never acts. The rules and the words are the Desktop's: a stop or a
  retire shows the kernel's plan first and applies exactly that plan, on
  this machine or on a registered one; a start or a restart uses the launch
  recorded for the agent. An act you sent runs to its end whatever
  `oats tui` does: closing the confirmation, quitting, a suspend or a signal
  never ends it, and when you leave while one runs a line on standard error
  says so. `tui.json` changes the keys (`stop`, `retire`, `start`,
  `restart`). See [the TUI page](../tui.md#stopping-starting-restarting-and-retiring).
