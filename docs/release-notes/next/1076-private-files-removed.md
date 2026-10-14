## Fixed

- **A failed write of the scheduler's, the triggers' or an extra tree's
  files leaves no private file behind
  ([#1076](https://github.com/awebai/oats/issues/1076)).** The kernel writes
  each of these files through a private file beside it, renamed into place:
  the automations snapshot (`.agents/automations/snapshot.json`), the
  schedules (`oats-schedules.json`), their run state and the triggers' state
  (`.agents/schedules/state.json`, `triggers.json`), the host scheduler's
  `~/.oats/schedules/registry.json` and `state.json`, an extra tree's record
  (`.oats/trees/<purpose>.json`) and the step `oats worktree add` records in
  its claim (`.oats/trees/<purpose>.lock`). On a file system with no space
  the private file was created, its write failed, and nothing removed it:
  each failed attempt left one more empty `<name>.tmp-<pid>` (for a claim,
  `<name>.tmp-<pid>-<nonce>`) beside the file. Each of them now removes its
  private file when the write or the rename fails, as the two writers of a
  stop have since 0.53.0, and every such write goes through one writer in
  the kernel. The error answered is the one answered before. An upgrade does
  not remove the files an earlier version left.
