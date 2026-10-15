## Changed

- **Desktop: a spawn no longer re-reads every member repository at the
  press** ([#1246](https://github.com/awebai/oats/issues/1246)). With a
  kernel that can reuse them, the Desktop's spawn lets the kernel use the
  member repositories' heads it observed in the last minute instead of
  reading each one again when you press Spawn. If anything changed, the
  spawn is still refused as before ("Something changed before the spawn went
  through…") and the values are read again.
