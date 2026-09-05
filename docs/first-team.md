# Run your first OATS team

Start with one repository and one small, real task. An OATS soul keeps the
role and knowledge; an instance gets a working session and a Git worktree.
Review its work, let it promote useful notes, then retire the instance.

This guide follows the published **0.22.0** path exercised on 2026-09-05
with `oats.dev` 1.0.0, `oats.okf` 1.4.1, `oats.aweb` 1.8.0, and
`oats.authoring` 1.0.0. The [qualification example](first-team-demo.md)
records the actual tasks and outcomes. Existing OAS users should follow
[the migration guide](migration-from-oas.md) first.

## Install and choose a scope

Have Node.js 22+, Git, tmux, and an authenticated agent runtime available.
Launch Pi or Claude Code once yourself to confirm that your chosen model
works. The current OKF package runs its harvester in **Pi**, including when
its working agent uses Claude Code, so this configuration needs Pi too.

```bash
npm install -g @awebai/oats@latest
pi install npm:@awebai/oats-pi@latest
node --version
tmux -V
oats version
```

Install matching kernel and adapter versions from the same release.

Use a repository with an initial Git commit. Keep your normal working
changes committed or otherwise accounted for before giving an agent work.
The commands below run from that repository:

```bash
cd /path/to/project
oats init --package oats.dev --config default
oats list
```

Initialization acquires the package closure and writes an editable
`oats-config.yaml` plus an exact lock. It does not create a team account or
approve executable hooks. `oats.dev` is our reference development policy;
edit its team name and provider choices for your own project.

For several repositories, initialize their common workspace directory
instead. Run create/spawn/retire with `--dir /path/to/workspace/project` for
the repository that owns the soul. `oats status --team` at the workspace
shows the combined roster, but that does not select a repository for spawn.

## Set the model and connect messaging

Edit the existing entries in `oats-config.yaml`; do not append a second
`capabilities` block. Set `team.name` to your own team. If you already use
aw, set `team.id` to its exact existing ID so instances join that team.

Under `capabilities.layers`, configure the model your Pi installation can
actually use. This example was used in our qualification; replace the
model if you authenticate through another provider:

```yaml
knowledge:
  capability: oats.okf
  from: installed
  settings:
    harvest-model: openai-codex/gpt-5.5
messaging:
  capability: oats.aweb
  from: installed
  global: true
  souls:
    memory-harvest: false
tasks: none
```

The `oats.okf` 1.4.1 default harvester model is
`github-copilot/gpt-5.5`; it will not work without that provider. The
messaging exclusion above keeps temporary harvesters from creating aliases
while an identity-retirement issue is being corrected. Workers still get
messaging identities. With a `souls` exclusion, state `global: true`
explicitly so scope-level commands such as `oats aweb setup` stay active.

Review and approve the executable capabilities, then check onboarding:

```bash
oats trust oats.okf
oats trust oats.aweb
oats aweb setup
oats doctor
```

`oats aweb setup` prints the next step: install the `aw` CLI if needed,
initialize an identity with `aw init`, then create or join your team. Follow
that output and rerun setup until it confirms membership. For an existing
team, join it rather than creating another with the same name. Setup's exit
status alone does not establish that onboarding finished.

Messaging is optional. To work without it, set `messaging: none`, omit the
aweb trust/setup commands, and keep the knowledge configuration above.
Packages, souls, Git worktrees, and local knowledge do not require hosted
messaging. See [configuration](configuration.md) for other providers.

## Give an instance a real task

On 0.22.0, create the roster directory first; a fresh-scope creation fix is
included in 0.22.1.

```bash
mkdir -p agents
oats create backend-expert --type developers --repo . --work worktree --runtime pi
```

Edit `agents/backend-expert/soul/AGENTS.md` to describe the role, repository
conventions, and the checks that matter. Review and commit the new soul,
configuration, lock, generated ignore rules, and adopted template base under
`.agents/config-templates/adopted/`. A worktree starts from a Git commit;
uncommitted soul changes are not present on the worker's branch. Keep aw
credentials out of Git.

Then launch one bounded task:

```bash
oats spawn backend-expert --purpose first-fix --task "Fix one small issue, run the relevant checks, commit the change, and report what changed. Capture any reusable lesson and harvest it before finishing."
oats status --team
```

Choose `--runtime claude` at creation for a Claude Code worker. Today its
first session can require **two interactive confirmations**: folder trust
and the development-channels confirmation used by the aweb integration.
Attach to the tmux session printed by spawn and answer them. A created
window is not evidence that the agent has started working.

Each instance has a home under `agents/<soul>/instances/<instance>/`; its
`work/` directory is the repository worktree. Read the instance's report
and review its commits there. Agents using aw run coordination commands
from their own home, which holds their identity.

## Harvest, review, and retire

With OKF active, the worker keeps state and notes in its home. After a
commit it can run `oats okf harvest` there. If it reports pending notes but
has not harvested, ask it to do so, or run the command from that instance's
home yourself. Retirement does not initiate knowledge promotion.

The harvester reviews notes, updates the soul's knowledge, and commits the
promotion into the worker's branch. Let it finish before final review or
retirement. Review **all** commits, including the promotion, and merge the
accepted work into the repository's main branch through your normal
workflow. Then, from the repository scope:

```bash
oats retire backend-expert-first-fix
oats status --team
```

Read the retirement result, including any retained home or recovery path.
With aweb enabled, also inspect `oats aweb roster`: local retirement alone
is not proof that a remote alias was removed. During the current hosted
alias-retirement issue, use a fresh purpose for the next instance and have
the team administrator clear any stale alias before reusing its name.

Start the same soul on the next useful task after its knowledge commit is
on main. Check that the new instance can find and use the promoted lesson.
That completes the first lifecycle: useful work, reviewed learning, clean
local retirement, and a successor with the updated soul.

## Optional conversation record

Knowledge promotion and conversation capture are separate. To enable the
local transcript record and query it:

```bash
oats setup
oats capture --status
oats recall "a phrase from your completed task"
```

Capture reads supported transcripts and aweb logs after setup, subject to
ignore rules. Native turns are content-addressed; signed aweb messages
retain their source signatures. See [the turn record](../README.md#the-turn-record).
