## Changed

- **A tree that goes away says what it leaves its attached instances with
  (#964).** An instance can be attached to an extra tree of its owner as to
  the owner's `work/` (#958). Three things change for such a tree:

  - **A retire that re-homes an extra tree repoints its attached children**
    to the tree's new path, as it does for `work/`: only the recorded
    children the retire stopped, only once the tree is seen at its new path
    with nothing left at the old one, and only a link that is still the one
    the retire found. One that cannot be repointed is a warning in the
    receipt, with the command to do it by hand.
  - **A retire that removes a tree names the attached children it leaves
    without one.** A clean extra tree is removed, as before, and so is
    `work/` with `--discard-worktree`. The plan's note for the tree now
    names its attached children and says that their `work` link would then
    point at a path that is gone, and the receipt's `warnings` (and the
    summary) say so afterwards, naming each child, the tree and the link.
    Before, the plan and the receipt said nothing of them.
  - **`oats worktree remove` refuses a tree under a running session.** When
    an instance attached to the tree has a session that is running, or that
    cannot be read, the command answers `E_CHILDREN_RUNNING` before Git is
    asked anything: nothing is removed and the record is kept. `details` is
    `{purpose, path, children: [{instance, home, session}]}`, `session` being
    `"running"` or `"unknown"`. The message names each instance and the
    step: stop it (`oats instance stop <instance>`) or retire it, then remove
    again. The command stops nobody, and no flag removes the tree anyway. An
    attached instance whose session is stopped does not refuse: the tree is
    removed and the answer's `warnings` name the instance and its link.

  The new sentences are strings in arrays the plan and the answers already
  have (`notes`, `warnings`): no key, field or flag is new, and a tree with
  no attached instance is handled as before. `E_CHILDREN_RUNNING` is the code
  a retire already answers, there for a child it asked to stop and that did
  not; `oats worktree remove` answers it with `details` of its own and no
  `childrenStopped`. See
  [extra trees at retire](../souls-and-instances.md#extra-trees-at-retire)
  and [extra trees](../souls-and-instances.md#extra-trees).
