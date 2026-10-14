## Changed

- `oats update` now says, in one line under its steps, that the Desktop goes
  first when its plan installs a CLI of another minor or major version: `OATS
  Desktop refuses a CLI newer than its own minor version: if you use it,
  install OATS Desktop <version> first.` It prints the line with `--check`,
  before it asks, and without a terminal. A patch update, or a prerelease to
  its own release, prints nothing. Nothing detects an installed Desktop, so
  the line also shows on hosts without one ([Upgrading](../upgrading.md#the-steps),
  [#1107](https://github.com/awebai/oats/issues/1107)).
