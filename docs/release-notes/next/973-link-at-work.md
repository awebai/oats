## Changed

- **A retire that was refused for a link at `work/` now completes (#973).**
  For a home whose record says `worktree` and whose `work/` is a symbolic
  link, `oats retire` was refused with `E_WORK_PRESERVATION_FAILED`,
  `--force` included. It now completes, removes no tree, with
  `--discard-worktree` as without it (`retention: null`, `worktreeRemoved:
  false`), and says in the receipt's `warnings` where the link led. Its
  plan has `defaults.retainWorktree: false` where it was `true`, and a plan
  of it read before the upgrade is stale. See the entry under Fixed.
- **A retire plan no longer gives two notes for a tree that is not the
  instance's own (#973).** The plan of an attached, a checkout or a
  workspace instance gave `N changed and M untracked file(s) would be
  retained with the worktree` and `the worktree is on <branch>, not the
  recorded <branch>` for the tree its link leads to, which the retire
  neither keeps nor moves. Both are now given for the instance's own tree
  alone. `facts.work` is unchanged.
- **`oats retire` spells what a terminal would act on in a warning
  (#973).** The retire's text (without `--json`) prints each warning of the
  receipt on one line, and a control character (an escape, a newline), a
  line separator or a bidi override in it is spelled `\u{<hex>}`. The text
  of a warning that holds such a character differs from before, a retire
  hook's own warning included; every other warning is printed as it was.
  The JSON does not change: a receipt's strings are what they are.

## Fixed

- **`oats retire`: a link at `work/` is never the instance's own tree
  (#973).** For anything at `<home>/work` that was not a real directory, a
  retire went by the record's work mode. A home whose record said `worktree`
  and whose `work/` was a symbolic link was then read as holding the
  instance's own tree: its plan said `defaults.retainWorktree: true`, and
  its retire was refused (`E_WORK_PRESERVATION_FAILED`) by a comparison
  written for something else. Nothing was lost, by accident. The record is
  a file the instance can write; what the link leads to is not the
  instance's. Now a link is a link, whatever the record says:
  - The plan of such a home has `defaults.retainWorktree: false`, the note
    `the record says work mode worktree, but work/ is a link and not a work
    tree of the instance's own: the retire removes the link with the home
    and does not touch what it leads to, with --discard-worktree as well`
    (a plan takes no option, so the note names the flag), and in its text's
    `defaults:`
    line `no work tree of its own (work/ is a link, though the record says
    worktree: what it leads to is not touched)`. Its `planRevision` binds
    it: a plan read by an older kernel, or while `work/` was the instance's
    own tree, is stale.
  - The retire completes, with every flag (it was refused: see Changed):
    the link goes with the home, and what it led to is not copied, moved,
    removed or read through Git, and no branch is deleted. The receipt's `warnings` say where the link led
    (`<home>/work was a link though the record says work mode worktree:
    nothing was retained or removed as a work tree, and what it led to
    (<path>) was not touched`), or that it led nowhere that could be read.
    The receipt holds the path as the system gave it; the retire's text
    spells a character a terminal would act on (see Changed).
    A registered worktree that was moved elsewhere, with a link left in its
    place, stays registered in its repository.
  - A link at `work/` that is a directory or a file by the time the retire
    inspects the home again after its hooks refuses the retire
    (`E_WORK_INSPECTION_FAILED`) and keeps the home, in every work mode:
    the home's removal would have taken what replaced the link, uncopied.
    The message says what is there now and how it ends: for a directory,
    that `oats retire <instance> --plan` shows what a retire would do with
    it and that running the retire again does that; for a file, or an entry
    that is neither a link, a directory nor a file, that no retire removes
    it, and to move it out of the home or remove it, then run the retire
    again; for an entry that cannot be read, that the retire reads it again
    when it is run again.
  - The two notes about a worktree that is retained are given for the
    instance's own tree alone (see Changed).
  - No key of the plan or of the receipt is new, and no code. A `worktree`
    record whose `work/` is gone, or is a file, answers as before.

  See [what `work/` is at retire](../souls-and-instances.md#what-work-is-at-retire).
