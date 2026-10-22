## Upgrade

- After bumping a package pin and running `oats sync`, stop each existing home
  that should adopt it and review `oats instance upgrade <instance> --plan`.
  Apply with the plan revision and an idempotency key, then start the session.
  Providers with state must support the `upgrade` adoption hook; a provider
  refusal names the remedy. See [the deploy step](../upgrading.md#moving-existing-homes-to-locked-package-versions).
  This command requires a kernel advertising `instance-upgrade`; older
  kernels keep their existing spawn-only behavior.

## Added

- `oats instance upgrade` moves a stopped local home's package modules to the
  deployment lock, recomposing skills, instructions and hooks while keeping
  the recorded soul and member modules. Plans show provider adoption and
  composition changes and whether the home changed since spawn. Dirty homes
  retain their original retirement baseline for recovery, including with older
  kernels; work-tree baselines never change. Apply checks the revision and supports idempotent
  retries. Undo verifies the latest saved state and asks the restored version
  to adopt it. Before commit, a partial upgrade after a successful provider
  hook or an interrupted hook with an uncertain outcome finishes forward
  with the same key and blocks start with
  `E_UPGRADE_PARTIAL`. After commit, a cleanup failure permits start with a
  warning and the same-key retry finishes event publication and cleanup; another move waits
  until cleanup finishes.
- Start and restart report package drift and the command to move those
  modules. Their JSON includes `drift`; they keep the recorded copies. An
  unreadable lock yields one warning and no `drift`, without blocking launch.
  `modules.<cap>.previous` records the latest move, and `modules-upgraded`
  records its completion in instance events. Desktop tolerates the additive
  `previous` field and labels the new events: `modules-upgraded`, and
  `upgrade-refused` with its failed step and reported reason.
