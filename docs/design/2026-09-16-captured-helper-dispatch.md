# Retained helper selection — supported subset

A capability's independent work must retain TWO selections: the source provider's
saved `ExecutionBinding`, and the dedicated helper execution binding. A resolution
ID describes immutable composition, not an instance or admitted request identity.
This API resolves exact helper authority; it does not qualify runtime launch.

## Core and CLI

```text
resolveCapturedHelper({executionBinding, helper, name?})

oats inspect --deployment ABS --resolution SOURCE_ID --json
oats inspect --deployment ABS --resolution SOURCE_ID --helper EXACT_MAP_KEY --json
oats inspect --deployment ABS --resolution SOURCE_ID --helper EXACT_MAP_KEY --composition --json
```

`executionBinding` is the SOURCE's saved binding, not a worker's ambient selector.
`helper` is an exact own key in that source record's `helpers` map. Source inspection
lists those keys/references. If supplied, `name` must match the retained helper name.
The sole static loader verifies both source and dedicated helper records, including
its exact provider artifact, exported definition, curriculum and retained resources.
No live soul/capability/config/lock lookup or name-based substitution occurs.

The core result is:

```text
{schemaVersion:1,
 sourceExecutionBinding, executionBinding,
 helper:{key,name,subject}, context, responsibleHuman, workMode,
 launch:{status:'unsupported',reason:'captured-helper-launch-not-qualified'}}
```

`sourceExecutionBinding` remains the selection for provider completion/retry calls;
`executionBinding` selects the helper. Static verification is not approval, mutable
provider readiness, incarnation admission or launch. Missing keys/records/resources
refuse even when a healthy newer selection exists. The initial supported subset
requires matching captured source/helper contexts and human choices; distinct
helper contexts/owners require explicit helper-request policy and currently refuse.
They are never silently overwritten. Runtime differences likewise require real
retained launch inputs rather than flags that select ambient runtime software.

## Scaffold is not launch

After resolving the helper, the existing public captured spawn can exercise only
its explicit directory/no-launch subset:

```text
oats spawn HELPER_NAME --deployment ABS --resolution HELPER_ID --home NEW_ABS_HOME --no-launch --json
```

That route consumes the DEDICATED helper record and exact approvals/hooks, not a
legacy name-only scaffold. It does not satisfy a request for a running worker.
A separate public captured start now follows this scaffold/hooks stage:

```text
oats session start --deployment SOURCE_DEPLOYMENT --resolution SOURCE_ID --helper EXACT_MAP_KEY --home OWNED_HELPER_HOME --request ABS_NATIVE_REQUEST_JSON --json
```

It revalidates the exact source edge, checks that the owned home belongs to that
dedicated helper, and calls the existing captured native session transaction.
See the [public native request contract](2026-09-17-public-captured-start.md).
The original static `launch:unsupported` lookup projection is unchanged: it is
not a runtime-readiness certificate or a claim about the newer callable API.
Providers must qualify this API at an exact compatible version before replacing
their unsupported-helper guard. `launch:null` is never filled from current config;
unsupported runtime prerequisites still refuse. Helper-authored policy holds and
the existing recursion guards remain intact.

## Completion belongs to the source selection

The capability saves a completion command using its source descriptor's explicit
selection (provider arguments are owned by that capability):

```text
oats NAMESPACE COMPLETE_COMMAND --deployment SOURCE_DEPLOYMENT --resolution SOURCE_ID -- PROVIDER_ARGS
```

Do not use `--soul`, inherited worker selectors, or the helper execution binding
for this command. Explicit selector pairs replace inherited selectors as a unit.
Private invocation files are transient; freeze required data in existing provider
source/run custody before returning. This contract imposes no harvester name,
prompt, store layout, evidence-selection algorithm or publication mechanism.

## Evidence and limits

Focused A/B fixtures prepare distinct dedicated helper records, remove original
source/config/lock state, and inspect A and B independently through core/public CLI.
Missing/prototype keys, wrong expected names and missing A records refuse; no home,
job, provider setup or model process is created by inspection. This is retained
selection evidence—not real source-independent worker launch, completion judgment,
publication acceptance or provider/privacy qualification.
