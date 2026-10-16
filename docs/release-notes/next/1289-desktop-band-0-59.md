## Changed

- **OATS Desktop accepts an `oats` CLI 0.59.x.** Its band is now
  `>=0.26.0 <0.60.0`. 0.59 adds no new gate on the band: the Desktop reads
  the `retire` field on status rows where it is present (feature
  `status-retire-state`).
