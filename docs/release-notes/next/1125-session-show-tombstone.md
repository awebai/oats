## Fixed

- `oats recall --show` now refuses session turns hidden by their author's
  tombstone, including claims in another stream. It reports the turn as
  tombstoned with exit status 1 and emits no payload. Record-owner authority
  resolution and index authority changes remain separate work under #1125.
