# Command/curriculum preparation

`prepareCapturedComposition(input)` now connects native by-reference import,
workspace/adoption choices, package preparation, manifest defaults and retained
resources into real records. This is command/curriculum preparation, NOT yet
launch/profile/provider/migration completion.

Public CLI (new command/curriculum preparation, no launch):

```text
oats prepare --dir /deployment --source git:github.com/example/souls --revision v1 --export agents/expert --alias expert --json
oats prepare --dir /deployment --workspace git:github.com/example/workspace --alias expert --json
```

Use `--workspace-revision` to select a workspace revision explicitly; otherwise the
hosting default is observed, never guessed. `--work` overrides the source's work hint.
A new-work request needs its own explicit absolute `--dir`; an inherited command
selector does not supply or change that intent. Unsupported/mixed flags refuse.
Incomplete preparation returns a failing envelope with prospective software details;
a complete but unapproved record reports `approval-required`, not executable readiness.

Input names an explicit deployment and four-field source reference
`{source,soul,revision,alias}`. A workspace request permits selecting an advertised
alias instead. Optional member context requires reciprocal eligibility. Workspace
adoption entries apply by qualified source identity across aliases; an alias cannot
hide another entry's contradictory defaults. No publisher workspace is adopted.

The wrapper reads one lock-v3 snapshot before creating scratch/fetching. Legacy
state requires migration. A native repository transaction freezes observations;
same-repo package roots and dependencies share that source commit. Packages use
the existing walker/materializer/validators. Only selected capabilities enter the
main record; per-root projections of the resolved package graph populate lock v3.
They are graph projections, not another dependency resolver.

Source retention includes the entire soul subtree, declared resources and needed
same-repository package roots. Kernel instructions/skills are copied from explicitly
named trusted resources, never by sweeping a checkout, credentials or node_modules.
The record includes ordered instructions, discovered skill entries, inventoried
command/hook files, and dedicated helper records. Duplicate skill names or a helper's
own unresolved software policy refuse rather than silently inheriting incompatible
choices. Helper records are committed before the main record.

Missing provider binding qualification returns `needs-configuration` with no main
resolution, while exact prospective package sets remain available for explicit
artifact-set approval. Provider code does not run merely because it was downloaded.
No guessed nonsecret payload, owner, enrollment or privacy guarantee is generated.
Valid retained orphan objects/records may survive later refusal or selection CAS loss;
shared immutable stores are never rolled back wholesale.

Result fields include `status`, `resolution`, `executionBinding`, exact observed
source revision, per-root software selections and problems. Complete results expose
`responsibleHuman`: null means messaging is actually disabled; incomplete preparation
does not manufacture that claim. Approval-required is separate from complete capture.
No spawn/setup/launch/scheduler side effect occurs during preparation.

The home/worker binding extension agreed with the scheduler consumer is:

```text
executionBinding = {
  schemaVersion: 1,
  deployment: <absolute local scope>,
  resolution: {schemaVersion: 1, id: <sha256-id>}
}
```

It will be stored in instance metadata by captured lifecycle adoption. Existing homes
without it are legacy/evidence cases, not an excuse to infer current configuration.
Scheduler fields `definitionVersion`, `recurrencePolicy` and `execution` are coordinated
with that lane. A distinct execution ID identifies each admitted attempt; immutable
capsule content identity must not collapse two otherwise identical work intents.

Current records deliberately have no launch recipe or managed runtime-package claim.
Provider codecs, full helper-policy planning, work-target setup, captured lifecycle
adoption and explicit historical migration remain the next integration work. Native
source-deletion tests prove preparation, curriculum/helper reads, explicit prospective
approval and retained command execution—not those unfinished paths.
