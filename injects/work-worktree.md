## Work mode: worktree

Your `./work` is a **git worktree on your own branch** — a full checkout that is
yours alone: build, test and commit there, on your branch.

- **Never work in a shared checkout** (the repo's main checkout, or any clone
  others use): don't edit, commit or switch branches there. A clone is touched
  only through `oats worktree add`/`remove` below. If unsure, `pwd`.
- Everything you change happens in `work/` or your extra trees — **including your
  own soul** when it lives in this repo: soul edits are branch changes, reviewed
  and merged like code.
- Leave your branch and the worktree list clean when your task closes.

### Extra trees

When the work needs another branch, or another repository of this deployment,
create an extra tree in your home. Run this from your home; `<base>` is the
remote branch the work starts from (the branch itself, when you rework an
existing one):

    oats worktree add --purpose <purpose> --branch <branch> --base <base>

It makes `.work-<purpose>` in your home, on a new `<branch>` at `origin`'s
`<base>`. The repository is yours unless `--repo <member key|clone path>`
names another; `--preview` shows what it would do.

- It starts from the remote's current state and moves none of the clone's
  refs. Never start a tree from a local branch of the clone, which may be stale.
- Name `<branch>` by the repository's own rules, else `agents/<instance>-<purpose>`.
  If it already exists in that clone, `add` refuses: use `<instance>/<branch>`.
  Never `-C`/`-B`, which reset a branch someone else may own.
- If a capability of yours sets up new trees, `add` runs that setup, which
  may take minutes: give it a long timeout, or run it in the background and
  wait for it to exit. A killed `add` rolls back; run it again. Once it has
  finished, running it again with the same arguments does nothing.
- The tree has no upstream: push with `git push origin HEAD:<remote-branch>`
  (`<base>` when you rework an existing branch).
- Before your task closes, merge each extra tree into your PR branch, or push its
  branch and name it in your hand-back; then
  `oats worktree remove --purpose <purpose>`, which keeps the branch and
  refuses a tree with uncommitted work.
  Retirement keeps a tree that still holds uncommitted work, but don't rely on it.
