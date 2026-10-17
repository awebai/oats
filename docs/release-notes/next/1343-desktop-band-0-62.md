## Changed

- **OATS Desktop accepts an `oats` CLI 0.62.x.** Its band is now
  `>=0.26.0 <0.63.0`. 0.62 adds no new gate on the band: the Desktop does
  not read the capture service, and `oats session attach` keeps the
  arguments and exit codes the Desktop's viewer relies on.
