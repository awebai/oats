## Changed

- `spawnOrigin` now describes the caller independently of lineage: valid
  instance context in this deployment records `instance`; otherwise `operator`,
  including operator spawns with `--parent`. Existing instances keep their
  recorded values, whose older meaning followed the relation. Attribution is
  informational and does not change permissions (#1371).
