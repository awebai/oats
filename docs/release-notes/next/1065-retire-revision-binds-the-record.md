## Changed

- **Every retire plan has a new `planRevision`, once (#1065).** A retire
  plan's revision now binds what the plan shows that the instance can
  rewrite, in every home (the defect is under Fixed). So a plan read under
  an older kernel is stale under this one: its guarded apply is refused
  with `E_PLAN_STALE` and the fresh plan in `details.plan`, nothing is
  stopped, run or removed, and the person confirms again. The revision's
  form is unchanged (24 lowercase hex characters), a client treats it as
  opaque as before, and there is no feature word and no change of
  `lifecycleApi`. A repeated apply with the idempotency key of a retire
  that did run is answered from its stored receipt as before, whatever
  revision it carries. A stop plan's revision is unchanged. See [the retire
  plan](../desktop-cli-api.md#retire-revision-work), which also names what
  is left out of the revision by decision.
- **A guarded retire after the record was rewritten is refused as stale
  (#1065).** These went through, or were refused late, on a plan that no
  longer said what the kernel read:
  - with nothing at `work/`, a plan read under a record that said
    `worktree` and applied after the record said `attached` went through;
  - a plan applied after the record's `branch` was rewritten went through;
  - a plan applied after the record's `repo` was rewritten to a path that
    is no repository was refused only after the retire hooks had run
    (`E_WORK_PRESERVATION_FAILED`).

  Each is now `E_PLAN_STALE` with the fresh plan, before anything runs.
  Where such an apply was refused for the retire's own reason before
  anything ran (`E_WORK_INSPECTION_FAILED`: a file at `work/`; an own tree,
  or a link, under a record rewritten to `directory`), the answer is now
  `E_PLAN_STALE` first, and the fresh plan's revision meets that refusal as
  before.

## Fixed

- **A retire plan's revision did not bind what the plan showed of the
  record (#1065).** A plan's revision is hashed from the facts that make
  the retire safe, and a guarded apply is refused when one of them moved.
  The record is a file the instance can write, and the revision held
  little of it: not its work mode, its repository or its branch, and of
  the session only the state. So the record could be rewritten between a
  plan and its apply without the revision moving, and two plans that
  differed in `facts.ownWorktree`, `defaults.retainWorktree`,
  `facts.repo`, `facts.recordedBranch`, a note or the text's `defaults:`
  line shared one `planRevision`. The revision now holds what the plan
  reports of the record about `work/` (work mode, repository, branch),
  what `work/` is with the repository Git names for it, the session as the
  plan shows it, and, of other homes' records, the edges that could not be
  followed and the children attached to this home's `work/`. 0.52.0 has
  the defect too.
