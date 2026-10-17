## Changed

- **OATS Desktop accepts an `oats` CLI 0.63.x.** Its band is now
  `>=0.26.0 <0.64.0`. 0.63 adds no new gate on the band: the Desktop does
  not read `running` on `session inspect --json` or the mismatch's
  `details.fields`, and it already reads a `launched` event's
  `launchConfig: null` as no configuration.
