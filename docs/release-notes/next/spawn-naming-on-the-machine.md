## Added

- `oats instance suggest-name --soul <soul> --task-file <f> --json`
  (feature `instance-suggest-name`) chooses the name a `--suggest-name` spawn
  of a soul would get, on this machine, for a spawn that may land on another:
  the soul only gives the role and needn't exist here. It resolves no
  workspace, writes nothing, records nothing and reserves no name; it reads
  only this machine's launch configurations and the OATS tmux server's
  environment. Its model call is bounded as the preview's is, and the task
  text goes to this machine's harness and model, as the preview's naming
  does. [A name for a spawn elsewhere](../desktop-cli-api.md#a-name-for-a-spawn-elsewhere-oats-instance-suggest-name).
  The name is not made unique: the host the spawn lands on does that.
  A naming failure answers a numbered result with its reason, never an error.
  It is never routed: `--server` is refused.
- `oats spawn <soul> --suggest-name` on an apply (feature
  `spawn-apply-suggest-name`): without `--preview`, the machine that spawns
  names the instance `<descriptive>-<role>`, made unique as today, and
  numbers it on any failure. The result carries `naming`. The naming call
  can add up to 20 s to the apply. A spawn without the flag is unchanged.
  Routed, the host needs the feature (`E_REMOTE_INCOMPATIBLE`, nothing sent).
  [Desktop CLI API](../desktop-cli-api.md#on-an-apply-feature-spawn-apply-suggest-name)

## Changed

- `--suggest-name` with `--expect-decision`, which a preview accepted and
  ignored, is refused (`E_BAD_ARGS`): the decision already binds a name.
