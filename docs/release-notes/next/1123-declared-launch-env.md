## Upgrade

- **A launch now gets exactly its capabilities' declared environment**
  ([#1123](https://github.com/awebai/oats/issues/1123)). An instance that
  relied on an ambient value of a variable one of its capabilities declares
  (in the tmux server's or the session's environment, the login shell's, the
  Desktop's) and that the capability's hooks do not return now starts without
  it. Nothing is required of you. An ambient value set before stays in the
  tmux environment until the server or the session is recreated, but no
  longer reaches a launch whose capabilities declare it; an instance already
  running keeps the environment it started with until it is restarted. To
  clear a stale value: `tmux -L oats set-environment -t <session> -u NAME`
  for a session, `tmux -L oats set-environment -g -u NAME` for the server,
  or recreate the server; then restart the affected instances.

## Fixed

- **An instance no longer inherits another instance's provider settings
  through the tmux session or server**
  ([#1123](https://github.com/awebai/oats/issues/1123)). OATS set only the
  variables a capability's hook returned; a variable the capability declares
  in its manifest `environment` but left out of its answer kept whatever the
  pane's environment held. A Claude Code instance on the aweb channel path
  started with `AWEB_DELIVERY=session` that way, so its channel delivered
  nothing and it was never woken. Now, for every capability, a declared
  variable its hooks leave out is removed from the launch: each window's
  command unsets it (for a spawn, a start, a start in place and a restart),
  and the checks of the launch read it as not set. A launch configuration's
  explicit `env` still applies. The persisted launch command does not
  change. See
  [a declared name is the provider's](../capabilities.md#a-declared-name-is-the-providers).
