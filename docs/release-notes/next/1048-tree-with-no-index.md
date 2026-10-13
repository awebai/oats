## Changed

- **A retire that was refused for a work tree with no index file now
  completes ([#1048](https://github.com/awebai/oats/issues/1048)).** For an
  instance whose own tree has no index file, `oats retire` answered
  `E_WORK_PRESERVATION_FAILED`, with `--force` and with
  `--discard-worktree` as without them. It now completes and writes a
  recovery whose `repo/` has no index file either. No code, no key of the
  receipt and no warning is new. See the entry under Fixed.

## Fixed

- **An instance whose work tree has no index file can be retired
  ([#1048](https://github.com/awebai/oats/issues/1048)).** A tree made by
  `git worktree add --no-checkout`, or one whose index file was removed,
  reads to Git as a tree whose index lists nothing: every committed file is
  a staged deletion. A retire copies such a tree, as any tree that holds
  work, and the copy refused it: it copies the index as one file, and none
  was there. The instance could not be retired until someone ran
  `git reset` in its tree. The recovery now carries "no index" as no index:
  its `repo/` has no index file, and Git reads it as it read the tree, file
  for file. The same holds for a nested repository that has a commit and no
  index file. `git reset` in the recovery makes an index from `HEAD`. An
  extra tree with no index file was never refused: a retire re-homes it as
  it is, as before.
  [The rule](../souls-and-instances.md#no-index-file).
