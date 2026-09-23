# Run your first OATS team

> **0.24 guide.** This page describes the 0.24.x surface (`oats-config.yaml`, `oats init`/`install`/`use`/`trust`). Under the workspace model (0.25) that surface no longer exists: read [workspaces.md](workspaces.md), [packages.md](packages.md) and the [rebuild guide](rebuild-to-v2.md) first; the commands below are kept for 0.24 deployments only.

Start with one repository and one small, real task. A soul keeps the role and
curated skills; an instance gets a working session and repository view. With OKF
v2, expertise lives in external owned nodes, not the soul or task branch.

> This guide targets the **v0.23.1 integration of published OKF 2.0.0**, whose
> published kernel prerequisite is OATS >=0.23.0. Check the matching framework
> release availability before installation; see [release notes](release-notes/v0.23.1.md).
> The [qualification example](first-team-demo.md) records real **v1** tasks on
> earlier versions, not v2 acceptance. Existing knowledge needs
> [v1 preservation and cutover](knowledge-migration.md), not fresh initialization.

## Install and choose a scope

Install matching published kernel and Pi adapter releases. Have Node.js 22+, Git, tmux and an authenticated working runtime
available. OKF's independent worker can use Pi, Claude or Codex; authenticate
that selected runtime too. Plain-directory knowledge needs no Git/gh, although
this guide's coding worktree does need Git.

```bash
npm install -g @awebai/oats@latest
pi install npm:@awebai/oats-pi@latest
node --version
tmux -V
oats version
cd /path/to/project
oats init --raw
oats install git:github.com/awebai/oats-okf@v2.0.0
oats list
```

Use a repository with an initial commit for this coding-worktree example.
Raw initialization writes editable configuration with integrations disabled;
installation separately acquires the published OKF 2.0.0 closure and exact lock.
Neither step approves hooks, authenticates a runtime or joins a team. Inspect
the acquired version before continuing. An existing development template or
lock may still select v1: follow explicit preservation/update/cutover instead
of applying fresh initialization or carrying v1 knowledge settings into v2.

For several repositories initialize their common workspace, then select the
repository owning the soul with `--dir /path/to/workspace/project` for
create/spawn/retire. A team roster does not select a work repository for spawn.

## Onboarding with the setup expert

On **OATS 0.24.2 or later**, start in an explicit empty deployment:

```bash
oats onboard --dir /absolute/new-deployment --json
```

`oats onboard` ships from 0.24.2 (earlier kernels refuse it). It is a
classic local bootstrap, not captured preparation or workspace enrollment. It
acquires `oats.framework` from the official catalog, exact-locks its artifacts,
selects only `oats.core` and `oats.setup` for the new local `oats-setup-expert`,
and prints the exact next spawn command. Review and run the returned
`result.next.command` when ready; it addresses this same kernel and deployment.
Onboarding itself never launches a model, changes native authentication or
installs capture hooks/services. **`oats setup` remains the separate record
capture-setup command**, not an alias for onboarding.

The expert receives `oats-operate`, `oats-souls`, `oats-config`, `oats-packages`
and `oats-workspace-setup`, without duplicate legacy kernel skill copies. It has
no hard knowledge/messaging dependency, so it can help select and configure those
providers afterward. Catalog identity grants no executable trust: the bootstrap
uses resource-only core/setup capabilities and refuses unexpected executable
surfaces instead of auto-approving them.

An existing roster is refused unless `--force-existing` is explicit. That flag
permits adding the new soul, not overwriting an existing setup expert or disabling
providers for other souls. Failures report partial acquisition/creation rather
than claiming atomic captured preparation. Preserve that evidence before retrying.

Optional `--workspace git:host/org/repository[@revision]` reads the selected
repository through ordinary discovery: use its pinned `oats-setup-expert` import
when present, otherwise its own advertised `souls/oats-setup-expert` edition at
the observed revision. Missing or incompatible explicit sources refuse; they do
not fall back to the packaged default. The copied edition's package must match
the official acquisition; workspace policy, teams and provider adoption values
are not silently adopted. Without this option, only the packaged definition and
instruction text are used—no knowledge corpus is bundled. From 0.24.5, a
`--workspace` onboarding also reads `package-catalog.json` **from the workspace
repository at its observed revision** and acquires the `oats.framework` that
catalog names; the kernel's bundled catalog is only the fallback (it is a
snapshot at the kernel's own release and lags every framework release cut
afterwards). `OATS_PACKAGE_CATALOG` still overrides both. The result reports
`catalog.origin` (`workspace` | `bundled` | `override`), and an integrity
refusal names the lag when the bundled entry caused it.

The manual path below retains its stated older integration/version scope.

## Configure explicit knowledge and optional messaging

Edit the existing entries in `oats-config.yaml`; do not append a second
`capabilities` map. This example targets only the source soul for knowledge:

```yaml
agent-types:
  developers:
    description: Coding experts
capabilities:
  layers:
    knowledge:
      capability: oats.okf
      from: installed
      souls:
        backend-expert:
          enabled: true
          settings:
            bindings-file: /absolute/config/okf-bindings.json
            harvest-runtime: pi
    messaging: none
    tasks: none
```

There is no hardcoded required harvester model in v2: omitted `harvest-model`
uses the selected runtime's configured default. Choose a model explicitly if
needed. Source and worker runtimes are independent.

Review the acquired Git payload and approve executable surfaces:

```bash
oats trust oats.okf
```

Use the catalog Git package, not the bundled npm mirror: npm omits the source
worker's `CLAUDE.md` symlink, so the mirror is not a self-contained distribution.
Acquisition alone is not activation or trust.

Messaging is optional. If desired, retain/configure the template's `oats.aweb`
layer, set `team.name` and any existing `team.id`, then review/trust it and run
`oats aweb setup`. Follow its install, initialization and create/join instructions
until it confirms membership. Join an existing team rather than duplicating it;
setup's exit status alone does not establish onboarding completion. A source-only
knowledge target does not require the service worker to have a messaging identity.

## Create the soul and provision an external base

```bash
oats create backend-expert --type developers --repo . --work worktree --runtime pi
```

Edit `agents/backend-expert/soul/AGENTS.md` for the role and required checks.
V2 does not scaffold knowledge in the soul. For a small local first base, create
`/absolute/config/okf-bindings.json`:

```json
{"version":1,"stateDir":"../durable-okf-state","bases":{"team":{"id":"team-knowledge","kind":"directory","path":"../team-knowledge"}}}
```

Those paths resolve from `/absolute/config`, not the project. Choose durable,
physical paths outside the source home/worktree and **outside every Git working
tree**, including ignored directories. State, accepted bases and bindings must
not overlap. Review [full placement rules](knowledge.md#bindings-document).

Create `/absolute/config/team-nodes.json`:

```json
{"backend":{"path":"backend","owner":"backend-expert-stable-id"}}
```

Explicitly provision the new base, refusing any existing destination:

```bash
oats okf init --base team --nodes /absolute/config/team-nodes.json --confirm --soul backend-expert --json
```

Write `agents/backend-expert/soul/okf.json`:

```json
{"version":1,"owner":"backend-expert-stable-id","owns":["team/backend"],"reads":[]}
```

For team-shared Git knowledge instead, follow [Git provisioning](knowledge.md#owner-and-base-descriptors)
and review/merge its initialization PR before spawning. Git knowledge always
uses PR delivery, not commits on the coding instance's branch.

Review and commit soul/configuration/lock changes, generated ignore rules and
the adopted template base under `.agents/config-templates/adopted/`. Keep
credentials and private durable evidence out of Git. Check `oats doctor --soul
backend-expert --json`. Configuration and a successful doctor do not substitute
for accepted-base validation by the required spawn hook.

## Give an instance a real task

```bash
oats spawn backend-expert --purpose first-fix --task "Fix one small issue, run the relevant checks, commit the code change, and report what changed. Read the relevant accepted knowledge indexes and capture non-obvious lessons in notes."
oats status --team
```

Choose `--runtime claude` or `codex` if preferred. Complete any native folder
trust, authentication or messaging-plugin confirmations in the printed session.
A created window is not proof the agent is working.

The instance home is under `agents/<soul>/instances/<instance>/`; `work/` is its
Git worktree. `knowledge/view.json` identifies immutable accepted snapshots.
The worker reads indexes selectively, maintains state/log/notes, and never edits
accepted knowledge. This is instructional, not an OS filesystem sandbox.
Review its code commits through the repository's ordinary PR workflow.

## Inspect, judge and retire

From the source home, read-only inspection shows identity-matching state/log/notes
plus durable processing receipts:

```bash
oats okf inspect --json
```

Spawn registered one per-source command job, but **did not install a host timer**.
For this first task an operator may request one manual harvest from the source
home; without `--no-launch` this starts the configured model worker:

```bash
oats okf harvest --json
```

The worker judges durable notes **and captured record**, in its own directory
execution space. It leaves live notes and soul skills untouched. Directory
delivery is recoverable publication with validation and receipts. Git delivery
requires a real reviewed PR and merge-visible acceptance. Inspect receipts rather
than equating a worker spawn with learning. See [operator commands](knowledge.md#inspection-and-operator-commands)
for scaffold-only requests, completion and retry.

Source retirement need not wait for a worker to finish: it must first certify
final notes/record custody. From the repository scope:

```bash
oats retire backend-expert-first-fix
oats status --team
```

Read the retirement result. An uncertified capture retains the home for retry;
never delete it to bypass recovery. Durable descriptors, evidence and runs survive
successful retirement. Use `oats okf inspect --source <absolute-source.json>
--soul backend-expert --json` from deployment context afterward. If messaging is
active, also verify its retirement receipt and roster rather than assuming local
cleanup proves identity release.

For automatic future judgment, review [source jobs](schedules.md#okf-v2-source-jobs)
and explicitly opt into host-timer installation. No-launch tests should never
install it or enable live model launches.

After provider acceptance, start a fresh instance of the same soul on a useful
task. Check that it finds **and uses** the promoted lesson without the original
source. That is the learning acceptance step; a no-launch reader only verifies
scaffolding and references.

## Optional host-wide conversation capture

Knowledge judgment and the native conversation record are separate. OKF uses
source-targeted native capture through the CLI; host-wide watcher/hook setup is
an additional deliberate operator action:

```bash
oats setup
oats capture --status
oats recall "a phrase from your completed task"
```

Capture respects privacy exclusions. Native turns are content-addressed; signed
aweb messages retain their source signatures. See [where the turn record fits](2026-09-03-architecture-proposal.md#where-the-turn-record-fits).
