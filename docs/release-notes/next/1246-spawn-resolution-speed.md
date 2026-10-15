## Added

- **`oats spawn … --expect-decision <revision> --max-age <seconds>`: a
  confirmed spawn reuses its preview's observations** (feature
  `spawn-apply-max-age`, [#1246](https://github.com/awebai/oats/issues/1246)).
  An apply bound by `--expect-decision` now takes `--max-age`, as
  `spawn --preview` already did: it reuses member heads this machine observed
  at most that many seconds ago instead of asking each remote again, which
  saves the apply's `git ls-remote` round (about 0.3–0.45 s). The decision is
  computed from those heads, and one that differs from the confirmed revision
  is still `E_DECISION_STALE`, with nothing created. `--max-age 0` is live, as
  without the flag. The apply's answer is unchanged: it carries no
  `observation` block. A spawn apply without `--expect-decision` still refuses
  the flag (`E_BAD_ARGS`), now with a message that says so, and `--server`
  still refuses it. A client passes the flag on an apply only when
  `oats version --json` lists `spawn-apply-max-age`: an older kernel refuses
  it ([Apply](../desktop-cli-api.md#apply)).

## Changed

- **Spawn preview and apply are about 0.4 s faster on Claude souls whose
  capabilities require a Claude plugin**
  ([#1246](https://github.com/awebai/oats/issues/1246)). The harness-package
  check's probe, `claude plugin list --json`, now runs with
  `DISABLE_TELEMETRY=1` set for its own run, so Claude no longer flushes
  telemetry before it exits. The probe's answer, and so the check, is
  unchanged; the launch, the install steps and every other probe run as
  before ([The checks read the pane](../execution-targets.md#the-checks-read-the-pane)).
