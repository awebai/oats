## Fixed

- **An instance whose window has another pane is no longer unreachable**
  ([#1569](https://github.com/awebai/oats/issues/1569)). A split window, such
  as oats.setup's no-echo prompt opens beside the agent, made status read the
  instance `unreachable` and session inspect, input, wakes, attach, stop and
  restart refuse it. Status and every session command now act on the agent's
  pane alone, and the other panes never make the instance unknown. See
  [which pane is the agent's](../execution-targets.md#which-pane-is-the-agents).
  - **The mark.** OATS sets the tmux pane option `@oats-agent`, its value the
    instance name, on the agent's pane whenever it creates or respawns it: a
    spawn's window, a start's or restart's new window, and a restart in place.
    A mark that cannot be set does not fail the launch. It is internal, not an
    interface.
  - **The rule.** In a window with one pane, that pane is the agent's. With
    several, the pane marked with the instance's name; when none is, the
    unmarked pane with the lowest pane id (the window's own pane comes before
    any split of it). A pane marked with another instance's name is never the
    agent's. A window launched before this release has no mark and resolves
    to its lowest pane id until the next start or restart marks it.
  - Wakes and `oats session input` paste into the agent's pane even when the
    person's focus is in another pane. Stop signals only the processes under
    the agent's pane, and a restart in place respawns that pane alone. No JSON
    field or state name changed.
  - **The viewer** (`oats session attach`, the Desktop and the TUI) still
    shows the whole window, every pane. In a window with more than one pane it
    selects the agent's pane before its client attaches, so typing goes to
    the agent. The viewer has no key or click that moves to another pane.
  - **When OATS cannot tell** (two panes marked with the instance's name, or
    several panes and none unmarked or marked with it), status reads
    `running: null`, `runtimeState: "unreachable"`, and the sentence that
    names the panes and how to close them is the `runtimeError`; session
    inspect, input, attach, stop and restart refuse with the same sentence.
  - **oats.setup route 2 guidance.** The no-echo prompt's instructions no
    longer say that the window is refused while the prompt is open: wakes and
    input keep reaching the agent, and a viewer opened after the prompt
    selects the agent's pane, so the agent closes the prompt and opens it
    again while the person watches. It
    reaches deployments with the next oats.framework release.
  - **Known limit.** A development-channel Claude started or restarted in
    place on a split window comes back with its launch prompt `blocked`,
    Claude waiting at its development-channel prompt: the confirmation still
    requires the agent's window to have one pane. Close the other pane before
    the restart
    ([the development-channel confirmation](../configuration.md#the-development-channel-confirmation)).
