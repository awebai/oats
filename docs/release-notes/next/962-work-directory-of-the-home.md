## Changed

- **Three answers a client reads are different for some homes, by the fix of
  #962 under Fixed.**
  - A retire plan's `defaults.retainWorktree`. A record with no work mode
    whose `work/` Git confirms is a registered linked worktree has
    `defaults.retainWorktree: true` in its plan, where it was `false`; the
    retire already retained that tree. For a home whose record says
    `worktree` while its spawn's receipt says that no tree was given, a real
    directory at `work/` is a directory of the home, and its plan has
    `defaults.retainWorktree: false` where it was `true`.
  - A refusal's code. A `directory` instance whose record was changed to say
    `worktree` is refused with `E_WORK_INSPECTION_FAILED` (the record
    disagrees with the spawn's receipt) with `--force` as without it; with
    `--force` the code was `E_WORK_PRESERVATION_FAILED`. Nothing is stopped,
    run or removed in either case, as before.
  - `E_NO_WORKTREE` where an enclosing checkout was read. For a real
    directory at `work/` that is not the top level Git names for it, `oats
    instance git` and `oats instance diff` answer `E_NO_WORKTREE`, and a
    stop plan's and a retire plan's `work` is `{observed: false, reason:
    "E_NO_WORKTREE"}`.

  See [what `work/` is at retire](../souls-and-instances.md#what-work-is-at-retire).

## Fixed

- **`oats retire`: a real directory at `work/` is no longer removed without
  a copy, and is no longer read as a work tree (#962).** A retire decided
  that an instance had a work tree of its own from any real directory at
  `<home>/work`, whatever the work mode. For a home that was given a link
  (an attached, a checkout or a workspace instance) or whose record held no
  work mode, most retires then refused, and two shapes lost what the
  directory held: under a record that named no repository, a directory that
  was a Git repository of its own, or the registered worktree of a spawn
  that had not finished, was removed with the home and nothing of it was
  copied. What `work/` is now comes from one reading, which the retire and
  its plan share:
  - A real directory that is not the instance's own tree is a directory of
    the home. The retire copies it to recovery (`workRecovery.path/work`,
    class `directory work bytes`), checks the copy, and removes it with the
    home, a `.git` in it included. It is never moved or removed through
    Git. Three refusals of such a home are now a completed retire with a
    recovery copy. An entry the copy cannot take (a FIFO, a socket) still
    refuses before anything is touched.
  - The instance's own tree is retained as before, under a record with no
    work mode too when Git confirms that `work/` is a registered linked
    worktree (its plan's default is under Changed). When the record names no
    repository, the retire uses the one Git names for the tree, does not
    write it into the record, and says so in the plan's note and the
    receipt's `warnings`.
    What such a tree holds uncommitted is copied to recovery as a `worktree`
    instance's is. An own tree with no repository at all is refused
    (`E_WORK_PRESERVATION_FAILED`, nothing stopped, run or removed) and
    never removed with the home.
  - A registered worktree that is a directory of the home leaves its entry
    in its repository until a prune: the receipt's `warnings` name the
    repository and the command, and its branch and commits are untouched.
  - The plan's notes and its text's `defaults:` line say the above. No key
    of the plan or of the receipt is new, and no code.
  - The plan of a `directory` instance whose `work/` is a Git repository of
    its own no longer has the note `N changed and M untracked file(s) would
    be retained with the worktree`: nothing of it is retained. Its bytes are
    copied to recovery and removed with the home, as the plan's recovery
    note and its text's `defaults:` line say. The plan's `facts.work` for
    that home is unchanged.

  See [what `work/` is at retire](../souls-and-instances.md#what-work-is-at-retire).
- **`oats instance git` and the plans no longer read an enclosing checkout
  as an instance's work (#962).** Git answers for any directory inside a
  work tree, so a plain `work/` in a home whose deployment directory is a
  Git checkout was reported with that checkout's branch and files. A real
  directory at `work/` is now the instance's work tree only when it is the
  top level Git names for it (what is answered otherwise is under Changed).
  The rule is the path, in every work mode. A `directory` instance in such a
  deployment has no work tree observed (its retire is unchanged: its bytes
  are copied to recovery and removed with the home); one whose `work/` is
  the top level of a repository of its own is observed as before. A `work/`
  that is a link is read as what it leads to, as before: a `workspace`
  instance's deployment directory included.
