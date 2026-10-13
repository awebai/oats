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
