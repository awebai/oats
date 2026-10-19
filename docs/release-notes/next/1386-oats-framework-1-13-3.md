## Provider updates

- **oats.framework 1.13.3: oats.core 2.6.5 and oats.setup 2.8.2.** Text
  only: neither capability's floor (`compatibility.oats`) changes.
  - **`/oats-operate`** says what `spawnOrigin` records from OATS 0.64.0: the
    caller's context (`instance` from a valid instance environment in this
    deployment, otherwise `operator`), independent of the relation. It is
    attribution, not a permission check, and a remote spawn records the
    host side. The skill also says how `--branch` and `--base` choose a
    worktree's branch and start point
    ([#1371](https://github.com/awebai/oats/issues/1371),
    [#1370](https://github.com/awebai/oats/issues/1370)).
  - **oats.setup names the right OATS version for the getting-started entry
    path.** `/oats-setup-expert`, `/oats-setup-model` and the oats.setup
    briefing said the `oats-getting-started` skill writes the setup expert's
    hand-over and creates its soul from OATS 0.62.0. That skill first ships
    in 0.64.0, and they now say so
    ([#1314](https://github.com/awebai/oats/issues/1314)).
