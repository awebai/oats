## Changed

- **A retire that was refused for a nested repository with no commit now
  completes ([#1078](https://github.com/awebai/oats/issues/1078)).** For an
  instance whose work tree holds a repository whose `HEAD` has no commit,
  `oats retire` answered `E_WORK_PRESERVATION_FAILED`, with `--force` and
  with `--discard-worktree` as without them. It now completes, and the
  recovery holds that repository under the class nested repositories
  already have. No code, no key of the receipt and no warning is new. Where
  such a `HEAD` names no local branch the retire is refused as before, and
  the message is now the kernel's, naming the repository, where it was
  Git's. See the entry under Fixed.

## Fixed

- **A work tree that holds a repository with no commit can be retired
  ([#1078](https://github.com/awebai/oats/issues/1078)).** `git init` in a
  directory of the work, and no commit in it, was enough to make an
  instance impossible to retire: the copy of a nested repository read the
  commit at its `HEAD` before anything else, and that `HEAD` has none. The
  same held after `git switch --orphan` in a repository that has commits.
  The recovery now rebuilds such a repository as any other: its `HEAD` is on
  the same branch with no commit, its other branches, their commits and
  their logs are there, and its index, what is staged in it and its files
  are the source's. A `HEAD` with no commit that names no local branch (a
  ref outside `refs/heads/`, or a branch whose name is not UTF-8) is still
  refused: a commit there, or `git switch -c <branch>`, makes the work tree
  retirable.
  [The rule](../souls-and-instances.md#nested-no-commit).
