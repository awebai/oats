## Upgrade

- **A host with several launch configurations for one harness and none
  `default: true`: a start or restart that selects its launch anew is now
  refused there until it names one
  ([#999](https://github.com/awebai/oats/issues/999)).** `oats session
  start|restart --reselect-launch`, and `oats session start|restart --harness
  <h>` alone, started the bare harness in that state. They now answer
  `E_LAUNCH_CONFIG_AMBIGUOUS`, as a spawn has since 0.52.0, and stop nothing.
  A script or a client that runs either of them goes on when it does one of
  these:
  - names a configuration: `--launch-config <name>` (in place of
    `--reselect-launch`, which refuses it beside itself);
  - asks for the bare harness on purpose: `--launch-config none --harness
    <h>` (likewise);
  - or the host marks one configuration of that harness `default: true`
    (`oats launch-config set`).

  A plain `oats session start|restart` runs the recorded launch and is not
  affected, nor is one that already passes `--launch-config`. To see whether
  a host is in that state: `oats launch-config list` prints each
  configuration with its harness and marks a default ("this machine's
  \<harness\> default"); a harness with two or more lines and no such mark is.
  `oats launch-config preview --home <home> --harness <h> --json` answers the
  refusal for one home without starting anything.

## Changed

- **One rule for a launch that is selected anew and names no configuration
  ([#999](https://github.com/awebai/oats/issues/999)).** Among several
  configurations for its harness with none `default: true`, such a launch is
  refused with `E_LAUNCH_CONFIG_AMBIGUOUS`, whichever command asks. Before,
  only `oats spawn` and its preview were refused; a start or restart in the
  same state ran the bare harness. Now also refused, before anything is
  stopped: `oats session start|restart --reselect-launch` (with or without
  `--harness`), `oats session start|restart --harness <h>` alone (also for
  the harness the home already runs), and `oats launch-config preview`, which
  plans as a start does. A refused restart leaves the session running on the
  same process, with `instance.json` and its receipt as they were. Not
  refused, and unchanged: a plain start or restart, `--launch-config <name>`,
  and `--launch-config none` alone or with `--harness`. The code and its
  `details` (`{harness, configurations, fix}`) are as before
  ([Launch preferences](../desktop-cli-api.md#launch-preferences)).
- **Every way out the refusal names works for the command that was refused
  ([#999](https://github.com/awebai/oats/issues/999)).** The `fix` of
  `E_LAUNCH_CONFIG_AMBIGUOUS`, which also ends its message, changed in three
  ways:
  - **It names the bare harness on purpose, with its harness:**
    "--launch-config none --harness \<h\>". `--launch-config none` alone
    drops the harness a soul or `souls.launch` chose, so on a spawn it starts
    the host default's harness.
  - **Where `--harness` was given it names no pin of the soul.** A flag
    decides before any layer, so `oats soul launch set` changed nothing for
    `oats spawn <soul> --harness <h>`, which the sentence used to suggest.
  - **Under `--reselect-launch` it says to pass the flags in its place,**
    since `--reselect-launch` with `--launch-config` is `E_BAD_ARGS`, and to
    pin the soul or mark a default before reselecting again.

  A `fix` is a sentence for a person: a client shows it and never parses it.
