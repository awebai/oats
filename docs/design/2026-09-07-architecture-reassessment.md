# Architecture reassessment: usable agents with replaceable services

Assessment of main `76c0ea4`, September 7, 2026. Requested by Juan after
operating the Desktop; incorporates Pepe's terminal, shortcut, split and soul
management feedback. This records the direction and implementation gaps, not a
claim that every item below has shipped.

The requirements authority for this assessment is Juan's September 3
“Architecture simplification and generlization” in his OATS project KB:
souls carry instructions and capabilities; a harvester converts ephemeral
state into knowledge accessible through the selected knowledge capability;
packages distribute souls and capabilities; OATS constructs and operates
instances across runtimes and platforms. The private Bookshelf README points
to September 1's adoption/sovereignty strategy. Its relevant constraint is that
changing a runtime or service provider must not erase the team's relationships
or working knowledge. The older August proposals about genomes, clothes and
turn-record experiments are background, not reasons to expand this release.

## Decision

Keep the existing package and capability-layer mechanism. Correct the places
where the CLI and GUI bypass it. The architecture is broadly right; the
operator experience and some service boundaries are incomplete. More
abstractions will not fix a terminal that cannot accept a screenshot.

| Component | Owns | Must not assume |
|---|---|---|
| OATS kernel | Soul/instance construction, configuration, lifecycle, host placement, scheduling, capability resolution | A particular knowledge provider, messaging service, or GUI |
| Session backend | Durable terminal, attach/detach, resize, literal input, observation | OATS soul/package semantics or task success |
| Knowledge capability | Knowledge access and representation; its harvester and promotion policy | Every installation uses OKF or stores memory in the same files |
| Messaging capability / aweb | Durable messages, identities, event subscriptions and delivery policy | A particular model harness or an open Desktop window |
| Task capability | Durable work and task semantics | A particular terminal backend |
| Desktop | Inspect effective configuration; explicit operator actions; terminal input, files, layout | Provider names, SSH commands, or a second lifecycle implementation |

Scheduling belongs to OATS, and a scheduled harvest is one use of scheduling.
Harvesting behavior belongs to the knowledge capability. Starting an agent,
writing a prompt, and producing reviewed knowledge are different outcomes.
The UI must retain those distinctions.

## What already fits, and what does not

`lib/core.mjs` already selects exclusive knowledge/messaging/tasks layers by
manifest, resolves scoped capability settings, dispatches lifecycle hooks, and
materializes runtime instructions. Jira and Linear demonstrate that a layer
can have alternative implementations. OKF's harvester is already an exported
capability agent. There is no reason to replace this machinery.

The remaining coupling is concrete:

- The retire receipt reads `hookResults.meta["oats.okf"].harvested`, although
  current OKF does not supply a retire hook. Remove the dead provider-specific
  inference; do not invent successful harvesting at retirement.
- Remote capability routing recognizes `okf harvest` specifically in
  `bin/oats.mjs` and `lib/servers.mjs`.
- Desktop harvest actions and scheduled-harvest definitions construct
  `oats okf harvest`; the editor recognizes that exact argv.
- The “brain” view presents `STATE.md`, `log.md` and `notes/` as universal
  knowledge structure. These are conventions of the current setup.

The next service contract should expose the **effective knowledge provider and
its supported operations for a specific soul/home**. Discovering a capability
command namespace alone is insufficient: it does not promise a `harvest` verb
or a shared file layout. A provider may offer harvest, different operations,
or read-only access. Desktop must show only declared operations and route
execution through the selected CLI capability. The same resolution must apply
locally, remotely, and when a scheduled operation runs.

Keep that change small: explicit operation metadata, scoped discovery, and one
invocation route using the existing capability engine. Do not add a plugin
framework, generic workflow language, or a second knowledge store. Demonstrate
replaceability with a tiny alternative-provider fixture that uses a different
command and storage layout; a full second product is unnecessary.

## tmux and Herdr

The current kernel defaults to a shared tmux session (`pi-agents`) with a
window per instance. An agent does not require another tmux server. The GUI
creates a temporary session linking only the selected window. That isolates
viewers: switching a terminal elsewhere cannot redirect a GUI tab to another
agent, and an agent exiting cannot silently expose a sibling under its label.
The `oatsdesk-*` name in Juan's screenshot is this viewer. Its status bar can
be hidden with a viewer-local setting. Do not alter global tmux settings or
merge/move live agent sessions to solve a display defect.

Herdr 0.8.2 is a separate terminal runtime, not a tmux-compatible superset.
Its documented direct terminal attachment, socket API, events and SSH support
are useful. Its semantic agent state comes from detection and/or integrations;
it is richer evidence, not proof that a particular message was consumed.
The [socket API](https://herdr.dev/docs/socket-api/) explicitly distinguishes
agent-state waits from arbitrary command completion. The
[remote documentation](https://herdr.dev/docs/persistence-remote/) also
separates a local thin client from running a client entirely on the server;
only the former can directly bridge the local desktop clipboard.

Keep one OATS session contract and both existing adapters for now. Do not add
another supervisor above them. Qualify Herdr's actual literal multi-line
input, exact occupant checks, detach, resize, process exit and remote behavior
before selecting it as the default for new instances. Inspect `pane run`
implementation before replacing it merely because its name sounds like shell
execution. Removing tmux is a later deployment choice, not a prerequisite for
consistent UI or remote agents. Existing tmux agents stay where they are.

## Desktop correction sequence

1. **Terminal essentials.** Hide viewer chrome, accept dropped files and pasted
   images without pressing Enter, upload remote files to the execution host,
   preserve the destination tab across async work, and show transfer failures.
   Keep a single GUI and bounded viewers. This is the immediate implementation.
2. **Keyboard and splits.** Restore Ctrl+Tab navigation inside Mac terminals;
   let an already-open terminal fill an empty split without a second attach;
   expose draggable and keyboard-operable separators. Follow up specific
   keyboard reports with real input tests, especially terminal editing keys
   and non-US layouts. App shortcuts must not silently steal terminal edits.
3. **Souls & capabilities.** Replace the launch-centric roster with a management
   surface showing souls, installed capabilities, effective layer providers,
   source/version, scoped activation and runtime defaults. Inspect and launch
   are distinct actions. Edits use existing CLI operations with the exact scope
   visible; installing a capability must not silently activate it. This is not
   a marketplace or Team Builder project.
4. **Provider-neutral operations.** Introduce the scoped operation contract
   above, then use it for manual harvest, schedules and knowledge inspection.
   No second hardcoded default is accepted as a generalization.
5. **Operating rollout.** Enable schedules per team with the owner's learning
   policy. Capture-lock recovery is a separate reliability issue affecting
   unattended harvesting; it does not block arbitrary scheduled wakes.

Acceptance must include real Electron file objects, actual terminal bytes,
remote transfer hashes, split focus/resize without extra PTYs, and a provider
replacement fixture. Unit tests of mocked argv alone do not establish these
boundaries. Reuse the existing agents and GUI sparingly; no model is needed to
exercise attachment transport or terminal layout.
