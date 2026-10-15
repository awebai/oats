## Provider updates

- **oats.framework 1.11.1, oats.setup 2.6.1: `/oats-host-delivery` teaches
  `oats aweb wake install`**
  ([#1224](https://github.com/awebai/oats/issues/1224)).
  - Choice 2 now leads with the oats.aweb 1.28.0 command: `--plan`,
    `install`, `status`, `uninstall`, and rerunning `install` after an aw
    upgrade.
  - The hand-written systemd and launchd units remain as the fallback, for
    older providers or an operator's own unit.
  - It names the migration from a hand-written unit: `install` refuses it
    with `E_WAKE_UNIT_CONFLICT`. Retire that unit with the printed steps,
    then rerun.
  - Choice 1 and the checks name the new readiness warning
    `claude-channel-mode-default`, and the soul-scope broker check.
  - Instruction text only; the floors are unchanged.
