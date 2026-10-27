## Fixed

- **`oats instance upgrade` moves a home whose oats.framework changes**
  ([#1549](https://github.com/awebai/oats/issues/1549)). oats.core has spawn
  and launch hooks but declared no `upgrade` hook, so the upgrade refused every
  home that carries it ("oats.core does not declare an upgrade hook; respawn
  the instance to change it").
  - **oats.core 2.8.0 declares a non-required `upgrade` hook.** The hook that
    runs is the destination's, so homes spawned on any earlier oats.core are
    covered, including framework 1.4.1, 1.8.0 and 1.14.1 homes.
  - `plan` adopts when the home records no oats.core metadata (no oats.core
    ever wrote any), `{}`, or a falsy value (`null`, `false`, `0`, `""`),
    which the kernel passes as `{}`. Any other recorded value is refused with
    the remedy `respawn the instance: oats retire <instance>, then oats spawn`.
  - `apply` carries the empty metadata unchanged. Neither phase reads the home
    or calls the host. The next start's launch hook rewrites the Claude Code
    waiting hooks for the moved module copy.
  - **oats.core's kernel floor rises from 0.40.0 to 0.49.0.** A kernel before
    0.49.0 drops a capability that declares a hook event it does not know, so
    it would lose oats.core on every soul. From 0.49.0 the kernel ignores the
    hook; only OATS 0.68.0 and later (`oats instance upgrade`) run it.
  - Known effect: after the move, the record holds
    `capabilityMeta["oats.core"]: {}`, as oats.aweb-tasks' adoption leaves it.
  - See [oats.core across `oats instance upgrade`](../capabilities.md#oatscore-needs-input).
    It reaches deployments with the next oats.framework release.
