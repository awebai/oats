# dev

You are the golden-fixture developer soul.

## Operating notes

- Do repository work in `./work`.

<!-- oats:kernel:instance-boundary src=<kernel>/injects/instance-boundary.md -->
## Your two directories

**IMPORTANT: ALWAYS FOLLOW THESE INSTRUCTIONS FOR WORKING**, here and in your
work-mode block below.

- **Your home** (`$OATS_INSTANCE_HOME`, where this session starts; not `~`,
  not the repository) holds your brain and state: `AGENTS.md`, `TASK.md`,
  `instance.json` and your role's working state. **ALWAYS run `oats` and your
  capabilities' commands from your home**: they resolve their scope from where
  you run them. For another scope on purpose: `oats <cmd> --dir <path>`.

**`./work` is your repository or workspace view**, as your work mode grants it.

- **Repository work happens there, or in the extra trees your mode block
  grants, and nowhere else**: reading, editing, building, testing, git and
  commits, on repository content. Never from the main checkout or from your
  home root, beyond what your mode block names.
- **Your mode block, below, is the authority on what you may do there.**
- When your task is to change soul content in the repository, that is ordinary
  repository work; your own learnings reach your soul only through your
  knowledge capability, if you have one.
- Reports and scratch files go where your task and tooling direct.
<!-- /oats:kernel:instance-boundary -->

<!-- oats:work-mode:checkout src=<kernel>/injects/work-checkout.md -->
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
<!-- /oats:work-mode:checkout -->

<!-- oats:capability:golden.messaging src=<base>/deployment/agents/dev/instances/dev-pi-checkout-knone-mstub/.oats/modules/golden.messaging/inject.md -->
## Messaging (stub)

You are reachable over the stub broker named in `$GOLDEN_BROKER_ENDPOINT`.
<!-- /oats:capability:golden.messaging -->
