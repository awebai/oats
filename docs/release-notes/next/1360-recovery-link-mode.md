## Fixed

- A retire's recovery copy now keeps each symbolic link's own mode. The copy
  recreated a link with its exact target but the platform's default mode,
  while the verification digest holds the link's mode, so on macOS a worktree
  whose ignored dependency tree has links of another mode (for example
  `node_modules/.bin` links at 0700) was refused with "worktree recovery
  verification disagreed with the source". The link is now given its source's
  mode with lchmod, on the link itself, never on its target. Where the
  platform cannot set a link's mode and the new link's differs, the copy is
  refused rather than verified against another digest, and no target
  changes. Spawn's copies of skills and the other recovery copies use the
  same copier. See
  [what a recovery copy carries](../souls-and-instances.md#retire) (#1360).
