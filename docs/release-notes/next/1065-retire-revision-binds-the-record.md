## Changed

- **Every retire plan has a new `planRevision`, once (#1065).** A retire
  plan's revision now binds the record's work mode and what `work/` is, in
  every home (the defect is under Fixed). So a plan read under an older
  kernel is stale under this one: its guarded apply is refused with
  `E_PLAN_STALE` and the fresh plan in `details.plan`, nothing is stopped,
  run or removed, and the person confirms again. The revision's form is
  unchanged (24 lowercase hex characters), a client treats it as opaque as
  before, and there is no feature word and no change of `lifecycleApi`. A
  repeated apply with the idempotency key of a retire that did run is
  answered from its stored receipt as before, whatever revision it carries.
  A stop plan's revision is unchanged. See [the retire
  plan](../desktop-cli-api.md#retire-revision-work).
- **A guarded retire after the record's work mode was rewritten is refused
  as stale (#1065).** With nothing at `work/`, a plan read under a record
  that said `worktree` and applied after the record said `attached` went
  through; it is now `E_PLAN_STALE` with the fresh plan. Where such an apply
  was refused for the retire's own reason (`E_WORK_INSPECTION_FAILED`: a
  file at `work/`; an own tree, or a link, under a record rewritten to
  `directory`), the answer is now `E_PLAN_STALE` first, and the fresh plan's
  revision meets that refusal as before.

## Fixed

- **A retire plan's revision did not bind the record's work mode (#1065).**
  A plan's revision is hashed from the facts that make the retire safe, and
  a guarded apply is refused when one of them moved. What the retire does
  with `work/` follows from the record's work mode, which the instance can
  write, and from what `work/` is; the revision held the second only where
  it was not what the mode alone gives, and the mode in no home. Wherever
  the reading follows the record, the record could be rewritten between a
  plan and its apply without the revision moving: two plans that differed
  in `facts.ownWorktree`, `defaults.retainWorktree`, a note and the text's
  `defaults:` line shared one `planRevision` (an own tree under `worktree`
  and `directory`; nothing or a file at `work/` under every record; a link
  under every record but `worktree`). Both are now part of every retire
  plan's revision, with the repository read from Git where the reading
  takes it from there, so no two plans of one home that the record or the
  reading makes different share a revision. 0.52.0 has the defect too.
