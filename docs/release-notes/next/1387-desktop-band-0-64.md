## Changed

- **OATS Desktop accepts an `oats` CLI 0.64.x.** Its band is now
  `>=0.26.0 <0.65.0`. 0.64 adds no new gate on the band: `spawnOrigin` keeps
  its `instance`/`operator` values, which the Desktop passes through without
  reading, and the Desktop already shows a fallback shell as `shell`.
