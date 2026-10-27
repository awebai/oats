## Fixed

- **Add a machine (`oats server connect`) finds an OATS and npm that only the
  host's login files put on PATH**
  ([#1517](https://github.com/awebai/oats/issues/1517)). Without `--path`, connect
  asks the host user's own login shell (bash, zsh or fish, run `-l -i`) for its
  PATH once. It records that PATH as the registration's `path`, and the oats it
  finds there as `oatsPath`, so installing, onboarding, readiness and every later
  `--server` command use the same environment. When the shell cannot be read,
  the `ssh` step's detail says why and connect uses ssh's own PATH. When even the
  login shell has no npm, the remedy names the PATH it searched and a command
  that checks it on the host, and you act on it by checking again, in Desktop
  too. An explicit `--path` is used as given. A machine registered before keeps
  its `path` and `oatsPath`; connect fills in only the ones it lacks.
