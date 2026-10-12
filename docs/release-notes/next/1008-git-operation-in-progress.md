## Fixed

- **A retire no longer keeps a clean extra tree for a Git operation that has
  ended ([#1008](https://github.com/awebai/oats/issues/1008)).** Git leaves
  `REBASE_HEAD` behind a rebase that stopped on a conflict and was continued,
  and `AUTO_MERGE` or `MERGE_MSG` behind others. A retire read each as "an
  operation is in progress", so the tree stayed on the host under
  `.agents/worktrees/` with its branch. A retire now reads what `git status`
  reads: an open rebase, `git am`, merge, cherry-pick, revert or bisect keeps
  the tree as before, and a tree that holds only such leftovers is removed,
  its branch kept. The recovery of an instance's own worktree and `oats
  doctor` use the same answer.
  [What counts](../souls-and-instances.md#git-operation-in-progress).
