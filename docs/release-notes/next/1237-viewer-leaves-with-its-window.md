## Fixed

- **`oats session attach`: the viewer ends with the agent's window, even under
  `detach-on-destroy off`**
  ([#1237](https://github.com/awebai/oats/issues/1237)). When an attached
  instance was retired, a tmux configured with `set -g detach-on-destroy off`
  moved the viewer's client to another session, so the terminal went on
  showing, and typing into, another agent. The viewer session now sets
  `detach-on-destroy on` for itself alone, and the viewer ends as it does
  under tmux's default. Your own sessions keep your setting. A routed attach
  (`--server`) runs the viewer on the host, so this holds there once the host
  runs this release. Remote Desktop terminals use that viewer.
