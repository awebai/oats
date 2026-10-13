## Changed

- **Desktop: the Retire dialog reads from the plan whose tree `work/` is**
  ([#1071](https://github.com/awebai/oats/issues/1071)). The dialog decided
  it from the instance's record, which can disagree with what is at `work/`.
  Under a record that says `worktree`, a link to another instance's tree, or
  a directory of the home, was promised to be kept as a worktree and offered
  for deletion. From a kernel that lists `retire-plan-own-worktree` (0.53.0)
  the dialog reads the plan's `facts.ownWorktree` instead:
  - **The tree is the instance's own and was read:** as before.
  - **It is the instance's own and could not be read** (nothing, or a file,
    is at `work/`, or Git failed): "Keeps its worktree, moved aside, if there
    is one. It couldn't be checked." With **Also delete the worktree**
    checked: "Deletes its worktree, if there is one. It couldn't be checked.",
    and under the choice "Deletes the worktree folder, if there is one, with
    any uncommitted changes (a recovery copy is saved first). It couldn't be
    checked." No branch is named. Before, these sentences promised a tree and
    named the branch of the record.
  - **It is not the instance's own:** "It has no worktree of its own, so no
    worktree is kept or deleted. A tree it links to is not touched." **Also
    delete the worktree** is not offered, and a confirmation that carries it
    is refused before any command: "Only an instance with its own worktree
    can delete it. Review the choice again." When a fresh plan says so while
    the choice is checked, the choice stays so that it can be undone, and no
    warning stands under it.

  A retire plan from such a kernel that does not carry the key is refused as
  malformed, as every other malformed fact of a plan. A plan relayed from a
  server is read by its host's features, not this computer's. From a kernel
  that does not list the word every sentence stays as before, from the
  record. See [Whose tree `work/` is](../../packages/desktop/docs/desktop-lifecycle-confirmations.md#whose-tree-work-is).
