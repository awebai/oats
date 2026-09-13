## Work mode: directory

Your `./work` is an **instance-owned execution directory**. It is not a Git
worktree, a checkout, or a link to the source instance or deployment context.
The context recorded as `repo` supplies configuration; it grants no permission
to edit that directory.

- Do task work inside `./work`. No Git repository or branch is created for you;
  do not initialize a fake repository to satisfy a workflow. Git might discover
  a containing repository; that does not authorize work in the containing tree.
- Access external inputs and destinations only as explicitly authorized by the
  task and active capabilities. This mode does not impose a storage provider or
  a publication protocol.
- Keep canonical instructions in the instance's `AGENTS.md`; `CLAUDE.md` is its
  compatibility symlink. Run OATS lifecycle/capability commands from home.
- Retirement removes the execution directory only after nonempty work has a
  verified copy in the reported recovery storage beside the home. Recovery is
  not publication: deliver your results through the task's own protocol first.
