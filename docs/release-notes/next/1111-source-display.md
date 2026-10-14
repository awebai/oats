## Added

- An external soul's `source` now comes with a display beside it,
  `sourceDisplay`: in `oats workspace status --json` `external[]`, and in the
  soul `origin` of kind `external` of trigger and schedule rows. It is built by
  the one [repository-reference display policy](../workspaces.md#repository-references-in-diagnostics)
  in pinned-source context: the reference without its user information and
  its commit, or the whole source withheld. `source` stays exact, and the
  automations snapshot keeps its shape: the display is built when a row is
  answered, so an existing snapshot carries it too. Feature `source-display`
  ([`oats workspace status`](../desktop-cli-api.md#oats-workspace-status)).
