## Fixed

- **`oats session attach`: a late hang-up no longer leaves the viewer session
  behind** ([#1243](https://github.com/awebai/oats/issues/1243)). A hang-up,
  termination or interrupt can reach `oats session attach` late, for example
  under a wrapping shell or a terminal profile, where it arrives once the
  wrapper has died and goes to the whole process group. If it arrived just
  after the viewer's client had exited, or while the viewer was still being
  prepared, it could end `oats` before its cleanup, or kill the cleanup's
  tmux call, and leave the `oatsview-*` session (and a keyed viewer's key
  table) on the agents' tmux server. `oats` now handles these signals from
  before it creates the viewer until its cleanup has finished, and runs its
  tmux calls outside its own process group, so the viewer is always removed.
  Exit statuses are unchanged. A routed attach (`--server`) runs the viewer on
  the host, so this holds there once the host runs this release.
