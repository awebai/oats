## Changed

- **OATS Desktop accepts an `oats` CLI 0.60.x.** Its band is now
  `>=0.26.0 <0.61.0`. 0.60 adds no new gate on the band: a status row's
  `running: false` with `runtimeState: "shell"` for a window at its fallback
  shell is what the Desktop's own terminal probe already reports for a local
  row, and a server's rows now read the same way.
