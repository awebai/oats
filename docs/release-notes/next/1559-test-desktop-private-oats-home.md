## Documentation

- **A test Desktop or TUI never restarts the operator's agents.** The live-check rule
  (`electron-live-verification`, and the Desktop and kernel developer souls) now gives a test
  Desktop or TUI a private `HOME` and `OATS_HOME_DIR` beside its private tmux directory. The session
  resume sweep a client runs when it opens restarts every lost home on this computer's deployments
  list, which lives under `OATS_HOME_DIR`, and the list's first use imports `$HOME/Agents`. With
  both private, a test client's sweep sees only its own fixture deployment: a home of the
  operator's that is lost while a check runs is never restarted on the test's private tmux server,
  out of the operator's sight, and the fixture never joins the operator's list. The rule also
  opens only the fixture deployment, names the CLI by absolute path and never runs the sweep,
  `--plan` included, under the operator's environment.
