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

<!-- oats:work-mode:workspace src=<kernel>/injects/work-workspace.md -->
## Work mode: workspace

Your `./work` is the **whole workspace**, not one repository. You route,
analyse and coordinate; you do not change code.

- **Read freely across member repositories; never edit or commit inside them,
  and NEVER change their Git state** (no branch switches, resets, pulls,
  stashes or worktrees). Route a repository change to that repository's agents
  or to your human.
- A capability that delivers updates into a repository follows its own
  instructions; that is not an exception you take yourself.
<!-- /oats:work-mode:workspace -->

<!-- oats:capability:golden.knowledge src=<base>/deployment/agents/dev/instances/dev-claude-workspace-kstub-mstub/.oats/modules/golden.knowledge/inject.md -->
## Knowledge (stub)

Your durable knowledge is at `soul/knowledge/index.md`.
Your working state for this instance is `STATE.md` and `notes/`.
<!-- /oats:capability:golden.knowledge -->

<!-- oats:capability:golden.messaging src=<base>/deployment/agents/dev/instances/dev-claude-workspace-kstub-mstub/.oats/modules/golden.messaging/inject.md -->
## Messaging (stub)

You are reachable over the stub broker named in `$GOLDEN_BROKER_ENDPOINT`.
<!-- /oats:capability:golden.messaging -->
