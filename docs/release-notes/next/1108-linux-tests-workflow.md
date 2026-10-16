## Added

- **Named test files can be run by hand on a Linux runner whose user manager
  works** ([#1108](https://github.com/awebai/oats/issues/1108)). The workflow
  `Linux tests` (`linux-tests.yml`) is the Linux counterpart of `macOS tests`.
  It runs named test files of a named ref, each alone, on `ubuntu-24.04`.
  Before the header, it enables lingering for the runner user and waits at
  most 60 seconds for `systemctl --user` to answer. The header says whether
  the manager answered, and a manager that did not answer fails the run
  before anything is installed. Its terms are the macOS workflow's:
  dispatch only, a read-only token, no secret, artifact or cache, and no
  input in a shell line. Both workflows run one script. The workflow's name
  is a contract that guarded tests key on, together with `workflow_dispatch`
  and `linux`. The macOS workflow's name, inputs and printed evidence are
  unchanged ([named test runs](../named-test-runs.md)).

## Documentation

- **`docs/macos-test-runs.md` is now
  [`docs/named-test-runs.md`](../named-test-runs.md)** and covers both
  runners. It adds each workflow's name as a guard contract and says what a
  Linux run is not evidence of: a hosted VM's user manager with lingering is
  not a person's login session.
