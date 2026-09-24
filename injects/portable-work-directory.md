## Portable work mode: owned directory

Your `./work` is an **instance-owned execution directory**, not a Git worktree,
a checkout, or a link to the source, deployment or another instance. No Git
repository or branch is created by this mode. Do not initialize a fake repository
to satisfy a workflow; a containing Git repository does not grant authority over
its contents.

- Do task work inside `./work`. External inputs and delivery destinations require
  explicit task/capability authorization. Neither a source link nor a recorded
  `repo` or work-target path grants permission to edit that external directory.
- Execution uses the explicit captured deployment/resolution and, for home-bound
  actions, the matching owned home/incarnation binding. Cwd does not resolve
  configuration or select a provider; do not rebind from a current checkout,
  config cascade, package lock or another instance.
- Preserve home/work separation and canonical instruction aliases:
  `AGENTS.md` in home, `CLAUDE.md -> AGENTS.md`, and the generated skill aliases.
  Retained soul source and software are read-only, not edit surfaces.
- Deliver results using the task and selected capability's supported protocol.
  This mode imposes no knowledge layout, harvester, storage backend or publication
  policy. A recovery copy, if independently verified, is not publication or
  accepted delivery.

Keep nonempty work and its custody evidence intact. This mode does not promise
implemented captured launch, start/restart/wake/retire or automatic recovery.
Before any supported, explicitly authorized teardown, require verified
preservation of outstanding work and receipts; if that capability is unavailable,
hold and report rather than deleting or moving the home/work yourself. A
`launchPending` result means runtime launch remains pending.
