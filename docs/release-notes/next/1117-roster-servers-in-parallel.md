## Fixed

- **A server that can't be reached no longer hides the others.** The remote
  roster (`oats server roster`, the Desktop's view of other machines) probes
  every registered server at once, each within its own deadline. A server
  that is switched off now costs only its own entry, which shows that it
  timed out (`E_SSH`, `ssh to <host> timed out: no answer within <n> s`), and
  the servers registered after it are read as usual. Before, the probes ran
  one after another against one 45 s budget. Four registrations on one
  offline host could use the budget up, and the servers after them were
  never asked ([#1117](https://github.com/awebai/oats/issues/1117)).
- **Retry on a remote window reads the servers again.** In the Desktop, the
  roster's **Retry** on a window with a deployment on another machine now
  reads the servers at once, or waits for the read already running, before it
  shows the roster. Before, it showed the last read's result until the next
  background read, 10 s later
  ([#1117](https://github.com/awebai/oats/issues/1117)).

## Removed

- **`E_ROSTER_BUDGET` and `bounds.skipped`** in `oats server roster --json`.
  Every group is probed, so no group is reported as not reached any more, and
  `bounds` is `{budgetMs, perTargetTimeoutMs, elapsedMs}`. `--budget` stays,
  as the deadline of the whole answer, which caps each probe's `--per-target`
  allowance
  ([the roster](../desktop-cli-api.md#the-remote-roster-oats-server-roster---json)).
