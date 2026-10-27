# dev

You are the golden-fixture developer soul.

## Operating notes

- Do repository work in `./work`.

<!-- oats:kernel:instance-boundary src=<kernel>/injects/instance-boundary.md -->
## Your two directories

**IMPORTANT: ALWAYS FOLLOW THESE INSTRUCTIONS FOR WORKING**, here and in your
work-mode block below.

**Your home is where this session starts** (`$OATS_INSTANCE_HOME`). It is not
your user home (`~`), not the repository root, and not the work tree.

- It holds your brain and state: `AGENTS.md`, `TASK.md`, `instance.json` and
  your role's working state. Never put them in `./work`.
- **ALWAYS run OATS commands, and commands from active capabilities, from
  instance home** (for example, when the aweb messaging capability is active,
  `aw` too): they resolve their scope from where you run them. For another
  scope on purpose: `oats <cmd> --dir <path>`.

**`<instance-home>/work` is your repository or workspace view**, as your work
mode grants it.

- **Repository work happens there, or in the extra trees your mode block
  grants, and nowhere else**: reading, editing, building, testing, git and
  commits, on repository content. Never from the main checkout or from your
  home root, beyond what your mode block names.
- **What your mode permits is the mode block's call**: your mode block, below,
  is the authority.
- If your TASK is to change soul content that lives in this repository, that is
  ordinary repository work. How your own learnings reach your soul is your
  knowledge capability's business.
- Reports and scratch files go where your task and tooling direct.
<!-- /oats:kernel:instance-boundary -->

<!-- oats:work-mode:worktree src=<kernel>/injects/work-worktree.md -->
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
<!-- /oats:work-mode:worktree -->

<!-- oats:capability:golden.knowledge src=<base>/deployment/agents/dev/instances/dev-claude-worktree-kstub-mstub-model/.oats/modules/golden.knowledge/inject.md -->
## Knowledge (stub)

Your durable knowledge is at `soul/knowledge/index.md`.
Your working state for this instance is `STATE.md` and `notes/`.
<!-- /oats:capability:golden.knowledge -->

<!-- oats:capability:golden.messaging src=<base>/deployment/agents/dev/instances/dev-claude-worktree-kstub-mstub-model/.oats/modules/golden.messaging/inject.md -->
## Messaging (stub)

You are reachable over the stub broker named in `$GOLDEN_BROKER_ENDPOINT`.
<!-- /oats:capability:golden.messaging -->
