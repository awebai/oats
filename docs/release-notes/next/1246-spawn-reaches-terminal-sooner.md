## Changed

- **Desktop: a spawn reaches its terminal sooner**
  ([#1246](https://github.com/awebai/oats/issues/1246)). Pressing Spawn no
  longer runs a second spawn preview when the dialog has been open more than
  a minute: the press uses the preview on screen for up to five minutes, and
  if anything changed meanwhile the spawn is refused as before ("Something
  changed before the spawn went through…") and the values are read again.
  Once the spawn is created, the Desktop reads that one workspace at once
  instead of waiting for its next full refresh, so the new instance's row and
  terminal appear without the extra second or more.
