## Added

- **`oats tui` spawns an agent on this machine**
  ([#855](https://github.com/awebai/oats/issues/855)). `n` (or the leader
  then `n`) opens a picker of the open workspace's souls; `N` spawns
  another of the selected instance's soul. The preview is the OATS
  Desktop's, read with `oats spawn <soul> --preview --json`: the name, the
  home, where it works, the harness and model and where they were chosen,
  the team and the worktree setup, with the launch-prompt policy, the
  warnings and the modules folded to one row each. `Tab` moves between
  Spawn, the name (the instance's `--purpose`), the parent and the folds;
  `Enter` on Spawn applies exactly the decision on screen, through the
  shared apply, and a pasted `n` and `Enter`s never spawn. When the agent
  is created and started its terminal opens beside the list; any other
  outcome is said in the Desktop's words, with what to do next, and an
  outcome that is not known is checked once with `C`. One spawn runs at a
  time; spawning on another machine, or with another harness, model or a
  task, stays `oats spawn`. The palette lists Spawn an agent and Spawn
  another. `tui.json` has three new actions, `spawn` (default `n`),
  `spawn-another` (`N`) and `spawn-check` (`C`). See
  [the TUI page](../tui.md#spawning-an-agent).
