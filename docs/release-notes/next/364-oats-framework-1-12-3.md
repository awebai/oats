## Provider updates

- **oats.framework 1.12.3, oats.core 2.6.3: `/oats-operate` says what
  `running` means** ([#364](https://github.com/awebai/oats/issues/364)).
  From OATS 0.60.0, a status row's `running` is the harness's liveness: a
  window left at its fallback shell after Stop reads `running: false`,
  `runtimeState: "shell"`. The skill dates the rule, since an older kernel
  still reports such a window as running. Instruction text only; the floors
  are unchanged. A deployment gets it by pinning `oats.framework: v1.12.3`
  and running `oats sync`.
