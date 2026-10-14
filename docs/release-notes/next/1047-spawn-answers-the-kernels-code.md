## Added

- **Feature `spawn-kernel-codes` (#1047).** `oats spawn` answers the
  kernel's own code; a kernel without the word may answer `E_SPAWN_FAILED`
  where a kernel code was raised. See
  [spawn errors](../desktop-cli-api.md#spawn-errors).

## Changed

- **`oats spawn` answers the kernel's own code (#1047).** Apply and
  `--preview`, text and `--json`: an error with a kernel code is answered
  with that code, as the lifecycle commands have done since 0.52.0, and
  `E_SPAWN_FAILED` is what an error with no kernel code is answered with,
  with `details.cause` for one that has a system code or is a defect (its
  stack on stderr). Until now the spawn's kernel stage passed a list of
  codes and answered every other one as `E_SPAWN_FAILED`, so a refusal with
  a remedy, such as a missing harness package (`E_HARNESS_RESOURCE_MISSING`)
  or a tmux server that cannot be read (`E_RUNTIME_ENDPOINT_UNKNOWN`),
  reached a client as a failure of the spawn mechanism. An operator's script
  or a capability that matched `E_SPAWN_FAILED` to mean "the spawn failed"
  now sees the specific code: match on the command's exit status, or on
  `ok: false`, to mean "it failed". A code is not a stable signal of how far
  a spawn got: `details.unconfirmed` is. The details of each code are what
  they were: a code that carried details keeps exactly those, and every
  other one carries the error's details only when `unconfirmed` is true. In
  text mode an error with no kernel code that a spawn meets outside its
  kernel stage prints `oats: <message>` where it printed Node's trace (a
  defect still prints its stack on stderr). See
  [spawn errors](../desktop-cli-api.md#spawn-errors).
- **The harness-package gate has one name, `E_HARNESS_RESOURCE_MISSING`
  (#1047).** A start or a restart refused for a missing harness package
  answers `E_HARNESS_RESOURCE_MISSING` where it answered
  `E_HARNESS_PACKAGE`, and so does the `harness-packages` check of a launch
  plan (`oats launch-config preview`); the message is unchanged, and a spawn
  answers the same code. A script that matched `E_HARNESS_PACKAGE` matches
  `E_HARNESS_RESOURCE_MISSING` now. A preview in which the gate itself
  faults (an error that is no verdict on a package) now fails as a fault,
  where it showed a row that called the fault a missing package.
