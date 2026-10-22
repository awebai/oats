## Fixed

- `oats worktree remove` completes Git's partial deletion of a clean extra
  tree containing read-only ignored output, such as a Go module cache. A
  retry of an unregistered tree with a dangling `.git` file verifies its
  surviving files against the recorded branch before deletion, refusing
  modified or nonignored untracked paths even when tracked `.gitignore`
  files were deleted. Permission changes stay within the tree and never
  follow symlinks. Cleanup preserves `.git` until other entries are gone.
  Incomplete removal keeps the record and reports partial deletion
  accurately, with a manual recovery step when Git removed `.git` too.
