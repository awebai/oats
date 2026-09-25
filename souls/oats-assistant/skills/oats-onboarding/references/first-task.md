# First-task checklist — classic OATS 0.23 compatibility

This retained procedure describes the classic 0.23 config/command path only,
not portable adoption or a fallback for captured instances. Its raw-init and
optional-layer examples must never disable a portable soul's hard requirements.
For retained portable work, use the selected version's public preparation,
exact approval and source/home selectors through current adoption guidance;
do not apply the legacy commands below to that authority.

The public helper still requires a human/operator to acquire and activate it
first. This checklist grants no provisioning, runtime, credential or timer
permission and does not make a helper a persistent knowledge owner.

## 1. Observe and agree

Ask for the task, desired output and how the user will consume it. Establish
which exact existing or new scope is intended, installed CLI/runtime versions,
Git versus non-Git target, current layers/locks, and permitted changes. Do not
ask for tokens. In a clean operator shell, substitute an absolute SCOPE:

```sh
oats --version
oats doctor --dir "$SCOPE" --json
oats status --dir "$SCOPE" --json
oats list --dir "$SCOPE" --json
```

A missing deployment is a result, not permission to initialize it. Do not run
cross-deployment provisioning from an instance with inherited identity/settings;
hand the commands to a clean operator context instead. Instance operations run
from instance home. Always name a different scope explicitly.

## 2. Choose the smallest setup

- For a fresh authorized scope, `oats init --raw --dir "$SCOPE" --json` creates configuration
  with integrations disabled; it does not make knowledge, accounts or a team.
  Bare init selects provider defaults; do not substitute it for raw init.
  Existing scopes require inspection and explicit preservation, not blind init.
- Pick an installed/authenticated runtime with the user. The helper does not
  install or authenticate it. No default model, yolo flag or provider is needed.
- Start with knowledge, messaging and tasks disabled unless needed. To suppress
  an inherited layer explicitly, use `oats use none --layer knowledge --dir
  "$SCOPE"` (or messaging/tasks), only after explaining the affected scope.
- For an optional package, load `oats-packages`: install the full selected source,
  inspect its exact lock/integrity and executable surfaces, approve only those
  authorized, then activate the desired capability with `oats use`. Installation
  alone does not activate it. Never hand-edit a lock or installed store.
- If a provider is needed, use its acquired version's composed procedure.
  Missing provider curriculum is a blocker, not a reason to invent a setup or
  replay an identity hook. Host installation and credential use need separate
  consent. Preserve uncertain outcomes and escalate with redacted evidence.

## 3. Choose a persistent specialist only if needed

The public capability agent named oats-assistant is **not** a persistent soul.
Do not create a persistent soul of that name in a context also activating this
helper: that is a collision, not a fallback or a curriculum merge.

An authorized new ordinary specialist is a soul authored in a member
repository (`souls/<name>/soul.yaml` + `AGENTS.md`), then `oats sync`, with a
supported work/runtime configuration. Choose a unique name and explicit work
discipline. Checkout shares the user's Git tree;
worktree isolates approved branch work; directory creates independent scratch
inside the instance, not a link to the configured context. Directory output
must be deliberately delivered; it does not silently edit the user's files.

If knowledge is desired, stop for the selected capability's provisioning
procedure before its required spawn hook runs. In OKF v2 that means a binding
file, accepted external base/node metadata, stable owner and soul/okf.json
owns/reads declarations. Merely writing the declaration is not provisioning.
Do not embed knowledge in a soul or substitute an empty private-base replica.
The helper requires neither OKF nor the optional theory-authoring package.

## 4. Preview, probe, perform and consume

Use `oats doctor --soul <name> --dir "$SCOPE" --json` to inspect the composed
skills, layers, instructions, provenance, requirements and trust. Agree on a
bounded task before spawn. A human-authorized scaffold uses:

```sh
oats spawn <name> --purpose first-task --runtime <runtime> --no-launch --dir "$SCOPE" --json
```

Use the returned exact home/name, never infer an identity. A helper spawned by
another instance must have the explicit relation required by that task; load
the kernel lifecycle skill for relation flags. No-launch still invokes active
hooks; in fixtures disable external layers and block runtime/scheduler tools.
Check AGENTS.md, CLAUDE.md -> AGENTS.md, selected skills, instance.json and work
mode. A successful scaffold is **not** a real runtime task.

For a real session, separately authorize launch and evaluate its promised
output in the intended context. Verify that the user or downstream consumer
actually received/used the result, not merely that it was sent. Before authorized
retirement preserve output and unfinished work, then use the exact returned
instance name with `oats retire <instance> --dir "$SCOPE"`. Inspect the outcome
and any recovery receipt; never delete a home manually to simulate retirement.

## 5. Report only proven outcomes

Report version, scope, task, observed evidence, remaining blocker and one next
authorized action. Fixture layout, live runtime usability, delivered output and
learning are different gates. Learning requires independent judgment, accepted
external delivery and a fresh reader; the ephemeral helper does not own that
pipeline. Do not claim a persistent assistant learned merely because it ran.

Grounding: the public OATS v0.23.1 kernel skills oats, oats-config and
 oats-packages, and docs/souls-and-instances.md and docs/knowledge.md. Consult
those released sources when changing this procedure, not historical repair
recipes. No external page is needed to traverse this packaged checklist.
