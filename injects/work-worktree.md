## Work mode: worktree

Your `./work` is a **git worktree on your own branch**, yours alone: build,
test and commit there.

- **NEVER work in a shared checkout** (the main checkout, or a clone others
  use). Touch a clone only through `oats worktree add`/`remove`. If unsure, `pwd`.
- Every repository change, **your own soul included**, is a change on your
  branch or an extra tree's, reviewed and merged like code. Leave your branch
  and worktree list clean at the end.

### Extra trees

For another branch or repository, from your home (`--preview` first; `--repo
<member key|clone path>` for another repository; `<base>`: the remote branch
to start from, or the one you rework):

    oats worktree add --purpose <purpose> --branch <branch> --base <base>

- Name `<branch>` by the repository's rules, else `agents/<instance>-<purpose>`
  (if taken, `<instance>/<branch>`). Never reset a branch with `-B`/`-C`.
- `add` may take minutes: use a long timeout; if killed, rerun it.
- Push with `git push origin HEAD:<remote-branch>` (`<base>` when reworking).
- Before you finish, merge each tree into your PR branch, or push it and name
  it in your hand-back; then `oats worktree remove --purpose <purpose>`.
  Retirement may keep a tree with uncommitted work; don't rely on it.
  Details: `oats worktree --help`, and `/oats-operate` if you have it.
