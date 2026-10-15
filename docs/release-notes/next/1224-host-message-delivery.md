## Provider updates

- **oats.framework 1.11.0: oats.setup 2.6.0. Onboarding now makes a host's two
  delivery choices and checks them**
  ([#1224](https://github.com/awebai/oats/issues/1224)).
  - **Why.** A host could finish onboarding with `oats doctor` clean and still
    have two problems nobody had chosen:
    - its Claude homes ran in development channel mode, because
      `claudeChannelMode` was unset;
    - no host wake broker ran, so every joined team was poll-only, and Codex
      and `delivery: session` homes were not woken at all.
  - **A new skill, `/oats-host-delivery`,** is the one place that teaches both
    choices. `/oats-workspace-config` now points to it, instead of holding
    the approved-route steps itself:
    - **Choice 1, Claude channel delivery:** the approved route (the
      managed-settings file, `claudeChannelMode: approved`, the plugin in the
      launch's `CLAUDE_CONFIG_DIR`, respawning homes, the banner check) as the
      default for unattended hosts. The development fallback is written
      explicitly, with its costs stated. Session delivery is the third
      option.
    - **Choice 2, the host wake broker:** when a host needs it (a joined
      team, Codex, `delivery: session`); how the operator installs `aw wake
      run` as a per-user systemd or launchd service, with `AW_WAKE_OATS_BIN`
      and `PATH`; the restart after an aw upgrade; the check (`aw wake status
      --json`, and readiness free of `wake-daemon-*` and
      `joined-team-poll-only`); and the false `wake-status-stale` of oats.aweb
      1.27.2 ([oats-aweb#116](https://github.com/awebai/oats-aweb/issues/116),
      fixed in 1.27.3).
  - **`/oats-onboarding`:**
    - the intake asks for the host's delivery choices;
    - card 4 requires both choices, and onboarding does not complete while
      either is unmade;
    - card 8 checks them, and the hand-back records them;
    - card 4 also requires Git that works without a terminal on a macOS
      host that another machine drives, linking
      [Git on a macOS host](../servers.md#git-on-a-macos-host).
  - **`/oats-setup-model`** names both host facts and answers “why didn't my
    agent wake”.
  - Instruction text and one new skill: there is no hook, command, schema or
    provider contract change, and the capability floors are unchanged
    (oats.setup `>=0.30.0`).
  - A deployment gets it by pinning `oats.framework: v1.11.0` and running
    `oats sync`. Instances already running keep the skills they were spawned
    with.

## Documentation

- [Configuration](../configuration.md), “Claude channel delivery: the approved
  route”:
  - an unset `claudeChannelMode` is development mode, so set it explicitly;
  - the host wake broker is the other host delivery choice;
  - the operator's procedure for both is oats.setup's `/oats-host-delivery`
    ([#1224](https://github.com/awebai/oats/issues/1224)).
- [Servers](../servers.md), “Git on a macOS host”, adds four things:
  - which remedy applies to an `https://` remote and which to a
    `git@github.com:` one;
  - that SSH commit signing has the same requirement;
  - the `--insecure-storage` trade-off;
  - when to set it up, and how to verify it from a session without a
    terminal ([#1224](https://github.com/awebai/oats/issues/1224)).
