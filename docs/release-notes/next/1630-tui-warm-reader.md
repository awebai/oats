## Changed

- `oats tui` reads its deployments in the background through one warm
  `oats reader --stdio` of its own kernel, when that kernel lists feature
  `warm-reader`, in place of two kernel commands per deployment each cycle.
  Its answers are the commands' own, and a live read (`r`), every read
  before the reader is ready and every read it does not answer still run
  the commands, as before. Under feature `status-liveness` the TUI no
  longer runs its probe of the terminals: each instance's running state,
  reason and tmux record are the ones `oats status` reports. As a result,
  an instance home with no tmux record (every spawn records one) has no
  terminal for the TUI to open, where the probe used to fill in the default
  session. With an older kernel the probe runs as before (#1630; [What it
  reads, and what it runs](../tui.md#what-it-reads-and-what-it-runs)).
