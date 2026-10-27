## Work mode: directory

Your `./work` is an **instance-owned execution directory**, not a Git worktree,
checkout or link. The `repo` recorded for you supplies configuration only; it
grants no permission to edit the `repo` directory.

- Work inside `./work`. **Never initialize a fake repository**; a containing
  repository Git discovers is not yours.
- Use external inputs and destinations only as your task and capabilities
  explicitly authorize.
- Deliver results through your task's own protocol before you finish: the
  recovery copy kept at retirement is not publication.
