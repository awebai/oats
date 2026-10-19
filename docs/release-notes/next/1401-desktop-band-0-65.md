## Changed

- **OATS Desktop accepts an `oats` CLI 0.65.x.** Its band is now
  `>=0.26.0 <0.66.0`. 0.65 adds no new gate on the band: the Desktop reads
  `oats deployments` only behind its feature `deployments-list`, and does not
  read `listed` on `oats onboard --json`.
