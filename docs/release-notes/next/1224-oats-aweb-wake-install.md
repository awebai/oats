## Provider updates

- **oats.framework 1.11.1, oats.setup 2.6.1: `/oats-host-delivery` teaches
  `oats aweb wake install` (oats.aweb 1.28.0)**
  ([#1224](https://github.com/awebai/oats/issues/1224)).
  - Choice 2 now leads with the oats.aweb 1.28.0 command: `--plan`,
    `install`, `status`, `uninstall`, and rerunning `install` after an aw
    upgrade.
  - The hand-written systemd and launchd units remain as the fallback, for
    older providers or an operator's own unit.
  - It names the migration from the hand-written `ai.aweb.wake` unit that
    oats.setup 2.6.0 taught: that unit carries no install marker, so `install`
    refuses it with `E_WAKE_UNIT_CONFLICT`. Retire it with the printed steps,
    then rerun.
  - On macOS, `install` runs at the desktop login. Over ssh, `launchctl
    bootstrap` can fail after the plist is written (`E_WAKE_UNIT`); rerun it
    at the desktop.
  - The broker is installed before onboarding card 6. From oats.aweb 1.28.0,
    card 6's readiness fails without it for a soul with `delivery: session` or
    a join.
  - Choice 1 and the checks name the new readiness warning
    `claude-channel-mode-default`, and the soul-scope broker check.
  - Instruction text only; the floors are unchanged.
  - A deployment gets it by pinning `oats.framework: v1.11.1` and running
    `oats sync`. Instances already running keep the skills they were spawned
    with.
