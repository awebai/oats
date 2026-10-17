## Provider updates

- **oats.framework 1.13.2, oats.core 2.6.4: `/oats-operate` reads inspect's
  `running`** ([#1346](https://github.com/awebai/oats/issues/1346)). From OATS
  0.63.0 (feature `session-inspect-running`), the skill says what `running` on
  `oats session inspect --json` means: activity at the session endpoint, not
  health or readiness. A failed inspect is an error, never `running: false`.
  Without the field, `state: unknown` on a successful result reads as running.
  Text only: the capability's floor (`compatibility.oats`) is unchanged.
