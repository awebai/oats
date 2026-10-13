## Changed

- **Repeated setup retries capture service activation even when its file is
  unchanged** ([#1099](https://github.com/awebai/oats/issues/1099)). Linux
  ensures the user unit is enabled and started again. macOS enables the
  agent, loads it when needed and starts it without stopping a healthy
  watcher on an unchanged plist. A failed activation reports the manager's
  reason and a recovery command, including when the manager is missing.
  `--dry-run` and `--no-service` do not contact the manager. The capture pass
  still determines setup's exit status; see
  [Upgrading](../upgrading.md#after-a-change-of-node-version).
  Starting with the release carrying this fix, the manual Linux enable
  workaround in the [0.53.0 Upgrade notes](v0.53.0.md#upgrade) is no longer
  needed after setup successfully enables and starts the watcher. Actual
  service errors still require the remedy reported by setup.
