## Work mode: checkout

Your `./work` is the repository's **shared checkout**: the human and other
agents work in the same tree.

- **Stay on the checked-out branch; never switch unless explicitly asked.**
- **NO destructive git** (reset --hard, rebase, force-push, checking out
  another branch) without an explicit human instruction.
- Work that needs its own branch goes in an extra tree, not in `work/`.

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
  Details: `oats worktree --help`, and `/oats-operate` if you have it.
