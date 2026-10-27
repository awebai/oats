## Changed

- On Linux, on the unified cgroup hierarchy, each agent's harness now runs in
  a systemd scope of its own, `oats-agent-<hash>-<random>.scope` in the user
  manager's default slice, at every launch (spawn, session start and restart),
  wherever the OATS tmux server runs: systemd-oomd, which ends a whole cgroup
  under memory pressure, then ends one agent, never the server or the others.
  The harness stays the pane's direct child, and nothing recorded changes (the
  home's command, its launch recipe, receipts, `oats spawn --preview`). Before
  it wraps, a launch checks with `systemd-run --user --scope -- true`, in the
  pane's environment, that a scope can be created. When it cannot on a host
  booted with systemd (no user manager or bus in the pane, no `systemd-run`),
  the harness is launched as before, and the answer's `warnings` say `the agent's harness runs in the OATS
  tmux server's cgroup, not a scope of its own: <reason>`, as does a
  `launch-warning` event once the launch is recorded (a start refused after
  the check leaves none). Off Linux, on a Linux host not booted with systemd
  (a container's own init, another init system) and on the old or hybrid
  hierarchy, nothing changes and nothing is said (#1559).
- The OATS tmux server is now started in a scope of its own from inside any
  unit of the user manager, not only a service: a client launched from a
  desktop session (OATS Desktop or `oats tui` in its `app-*.scope`), a
  terminal's scope, an agent's scope. A login session's `session-N.scope` (an
  ssh or tty login) starts the server as before. A server that already runs
  keeps the cgroup it has (#1559). See
  [Where sessions run](../execution-targets.md#where-sessions-run-the-servers-scope-and-each-agents).
