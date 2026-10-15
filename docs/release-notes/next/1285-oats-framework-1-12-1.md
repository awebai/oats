## Provider updates

- **oats.framework 1.12.1, oats.core 2.6.2: `/oats-operate` says how to read
  an agent window's size** ([#1285](https://github.com/awebai/oats/issues/1285)).
  `oats session inspect --json` reports `size: { cols, rows }` where the
  kernel lists `session-inspect-size` in `oats version --json`; the skill
  names that check, and that a `--server` inspect needs it on the host.
  Instruction text only; the floors are unchanged. A deployment gets it by
  pinning `oats.framework: v1.12.1` and running `oats sync`. Instances already
  running keep the skills they were spawned with.
