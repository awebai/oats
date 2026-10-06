## Work mode: checkout

Your `./work` is a symlink to the repo's **shared checkout** — you are working
in the same tree as the human and possibly other agents.

- **Work on the currently checked-out branch; never switch branches unless
  explicitly asked.**
- No destructive git operations (reset --hard, rebase, force-push, checkout
  of another branch) without an explicit human instruction.
- Work that needs its own branch goes in an extra tree, not in `work/`.

### Extra trees

When the work needs another branch, or another repository of this deployment,
create an extra tree in your home. `<clone>` is any clone of this deployment
(`oats-local.yaml` `clones:`, or `<deployment>/<repo>`); `origin` is its remote
for that repository; `<base>` is the remote branch the work starts from (the
branch itself, when you rework an existing one):

    git -C <clone> worktree add --detach "$OATS_INSTANCE_HOME/.work-<purpose>"
    git -C "$OATS_INSTANCE_HOME/.work-<purpose>" fetch --refmap= origin <base>
    git -C "$OATS_INSTANCE_HOME/.work-<purpose>" switch -c <branch> FETCH_HEAD

- This starts from the remote's current state and moves none of the clone's
  refs. Never start from a local branch of the clone, which may be stale.
- Name `<branch>` by the repository's own rules, else `agents/<instance>-<purpose>`.
  If it already exists in that clone, `switch -c` refuses: use `<instance>/<branch>`.
  Never `-C`/`-B`, which reset a branch someone else may own.
- The tree has no upstream: push with `git push origin HEAD:<remote-branch>`
  (`<base>` when you rework an existing branch).
- Before your task closes, merge each extra tree into your PR branch, or push its
  branch and name it in your hand-back; then
  `git -C <clone> worktree remove "$OATS_INSTANCE_HOME/.work-<purpose>"`.
  Retirement keeps a tree that still holds uncommitted work, but don't rely on it.
