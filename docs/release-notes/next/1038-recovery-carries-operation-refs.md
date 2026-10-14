## Fixed

- **A retire's recovery of a worktree carries a stopped cherry-pick, revert,
  rebase or merge, and the stash, in both ref formats
  ([#1038](https://github.com/awebai/oats/issues/1038)).** The recovery
  copied an operation's state as files of the Git directory. Three things
  were missing from it, and nothing said so:
  - where the repository stores its refs in the reftable format,
    `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `REBASE_HEAD` and `AUTO_MERGE` are not
    files. The recovery had none of them, and its `git status` no longer said
    a cherry-pick or a revert was in progress. The stash's log is not a file
    there either: the recovery's `git stash list` was empty;
  - in both formats, the commit or tree those refs and `MERGE_HEAD` name is
    often in no branch (a commit reset away, a conflict's tree). The recovery
    named it without holding it, so `git cherry-pick --continue`, `git merge
    --continue` or a diff against `AUTO_MERGE` failed there;
  - a link at one of the copied names was left out when it led nowhere.

  The recovery now writes those four refs through Git at the same ids and
  holds every object they and `MERGE_HEAD` name. It stores the stash's
  entries again, oldest first, with their messages, so `git stash list`
  reads the same. A link is copied as the same link. A ref the source holds
  in the reftable format without its object cannot be written, and refuses
  the retire with `E_WORK_PRESERVATION_FAILED`, the home kept, as any
  recovery that cannot be made does. Which homes a retire recovers, the
  receipt and every code are unchanged.
