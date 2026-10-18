## Fixed

- Status and session inspection now recognize a fallback shell when tmux
  reports an empty or `unset` pane command, so a stopped harness no longer
  appears to be running in that case.
