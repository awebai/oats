## Added

- **Desktop: the Start and Restart dialog offers the bare harness**
  ([#1079](https://github.com/awebai/oats/issues/1079)). The Launch
  configuration list has a second entry, "No launch configuration (the harness
  as installed)". It runs the harness itself, with no configuration's
  executable, arguments or environment, and without the default configuration
  the host declares for that harness. The Harness list stays usable with it:
  alone it starts the recorded harness bare, and beside a picked harness, that
  one. "Preview invocation" shows the same choice. It is what
  `--launch-config none` does on the command line.
  - **For an instance on a server** the entry is offered only when the host
    is known to read it: a host on OATS 0.49.0 or later, read through an OATS
    here that relays the hosts' feature lists. On an older host, pick a
    configuration, or use the command line there.
  [Starting an existing instance](../desktop-instance-start.md) has the
  whole of it.

## Changed

- **Desktop: the Start and Restart dialog says in its own words a start that
  OATS refuses for want of a configuration**
  ([#1079](https://github.com/awebai/oats/issues/1079)). When OATS refuses a
  start or a restart with `E_LAUNCH_CONFIG_AMBIGUOUS` (the start names a
  harness and no configuration, several configurations are declared for that
  harness, and none is the default), the dialog's status reads "More than one
  launch configuration is declared for the chosen harness, and none is the
  default. Choose one under Launch configuration, or choose "No launch
  configuration" to run the harness as installed.", and under it "OATS says:
  `<message>`" as one line, in place of OATS's message, written in
  command-line flags, as the status. A message that looks like a credential
  reads "[Detail withheld]", with no name before it.
  - **"Preview invocation"** refused with that code reads the same sentence,
    then "Preview only. No agent was started or stopped.", with OATS's line
    under it. That refusal's message is no longer cut at 300 characters.
  - **Unchanged:** every other refusal of a start, a restart or a preview
    reads as before, and after any refusal Start is offered again once
    "Refresh status" is pressed.
