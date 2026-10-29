## Changed

- `oats tui` reads its deployments in the background through one warm
  `oats reader --stdio` of its own kernel, when that kernel lists feature
  `warm-reader`, in place of two kernel commands per deployment and read.
  Its answers are the commands' own, and a live read (`r`), every read
  before the reader is ready and every read it does not answer still run
  the commands, as before. Under feature `status-liveness` the TUI no
  longer runs its probe of the terminals: each instance is as `oats status`
  reported it (#1630; [What it reads, and what it
  runs](../tui.md#what-it-reads-and-what-it-runs)).
