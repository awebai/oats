# dev

You are the golden-fixture developer soul.

## Operating notes

- Do repository work in `./work`.

<!-- oats:capability:golden.messaging src=<base>/deployment/agents/dev/instances/dev-pi-attached-knone-mstub/.oats/modules/golden.messaging/inject.md -->
## Messaging (stub)

You are reachable over the stub broker named in `$GOLDEN_BROKER_ENDPOINT`.
<!-- /oats:capability:golden.messaging -->

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

<!-- oats:work-mode:attached src=<kernel>/injects/work-attached.md -->
## Work mode: attached

Your `./work` is **another instance's work tree**, its branch and uncommitted
state. You are a guest.

- **NEVER switch branches, rebase or reset.** Make focused additions on top of
  the owner's current state; keep changes and commits small, and name yourself
  in commit messages where authorship could be unclear.
- Leave files the owner is editing alone unless your task says otherwise; when
  unsure, ask through your messaging capability or your spawner.
- The tree's cleanup is its owner's; retiring you never removes it.
<!-- /oats:work-mode:attached -->
