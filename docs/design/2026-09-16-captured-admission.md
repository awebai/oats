# Captured incarnation and admitted actions

This is generic lifecycle custody, not a provider identity database or an enrollment guarantee. It extends the unreleased [shared invocation wire](2026-09-16-provider-binding-wire.md). Existing provider pins must be updated and tested explicitly.

## Identities and storage

A fresh directory scaffold mints `instance.json.incarnationId` with `randomUUID()` once, before any provider hook. The value is independent of composition, path, name, account and OS user. Metadata also records `captured.custody:{home:{dev,ino},work:{dev,ino}}`. Neither restart nor retry remints these fields.

The existing `.agents/portable/instance-references.json` becomes schema v2. Its rows retain the existing home/instance/agent/kind/status/executionBinding/responsibleHuman plus:

```
incarnationId: UUIDv4
custody: {home:{dev,ino},work:{dev,ino}}
intents: [{executionId,capability,action,inputIntegrity,state,attempt,receipt,replayable}]
```

Rows remain home-indexed, with unique incarnation IDs. A recreated home cannot replace an indexed incarnation's obligations. Old homes and v1 indexes without witnesses refuse `migration-required`; there is no silent backfill, deletion or automatic historical conversion. Release/reprovisioning of an occupied index location is not implemented here.

Index limits are 4 MiB, depth 32, 40000 entries, at most 128 retained intent rows per incarnation. Receipts use the shared 128 KiB/depth-24/8192-entry bound. Limits refuse rather than prune receipts. All index transitions use the existing portable-state write guard. Identity metadata and index publication are synchronized before returning authorization to execute. Failed publication/synchronization or guard cleanup retains custody; an uncertain index publication does not trigger scaffold deletion.

## Admission and retries

The public core API is:

```js
admitCapturedAction({deployment, resolution, home, action,
  input: {/* explicit NONSECRET request data, not environment/credentials */},
  retryExecutionId // omitted for a distinct new logical request
})
// -> {intent:{schemaVersion:1,executionId,incarnationId,attempt},
//     receipt, replayed:false}
// or completed replay: {..., replayed:true, replayable:boolean}
```

Static retained record/action/approval/executable and owned metadata checks run before admission, without a provider phase. `inputIntegrity` commits canonical request data in the existing JSON digest domain. CLI operations commit their exact declared argument flags/values, not runtime environment. Secrets belong in provider credential references, not operation arguments.

New requests mint independent opaque execution IDs, even for identical actions and inputs. One unsettled intent blocks replacement requests. `beginCapturedIntent({deployment,home,intent,action})` changes `admitted` to `running` once, immediately before the child can have effects. `settleCapturedIntent({... ,state,receipt,replayable})` records `completed`, `unconfirmed`, or pre-execution `blocked` outcomes. State, incarnation, action and attempt must match.

An explicit retry names the saved execution ID and exact original action/input. `blocked` and `unconfirmed` retry keep the logical ID and observed receipt, incrementing the attempt. This authorizes a provider to reconcile, not blindly repeat native mutation. `running` and abandoned `admitted` states refuse concurrent retry: process-crash reconciliation remains a held boundary, not guessed liveness. Completed retry returns stored outcome without provider code; non-replayable runtime/environment contributions refuse rather than re-execute a completed hook.

The latest indexed receipt for the selected capability takes precedence over the compatibility `capabilityMeta` mirror. The mirror seeds only the first action. An admitted retry uses its own intent receipt; it never falls back to another request or erases partial effects when metadata mirroring fails.

## Shared invocation

```
instance: null | {home,work,name,agent,incarnationId}
intent: null | {schemaVersion:1,executionId,incarnationId,attempt}
```

These are required fields in the unreleased v1 projection. Existing exact subject, context, human, messaging choice, capability/action, execution binding and optional caller receipt equality checks remain. Instance identity is derived from current owned metadata and the matching index, not accepted from a caller's target description. An intent must match that incarnation, capability, action and active indexed attempt. Public broker checks rederive the same projection; check stdin and execution snapshots do not have different authority rules.

Read-only scope checks can have no instance/intent. A null intent grants no mutation authority. Provider-specific account reuse, reconciliation, privacy qualification and grants remain provider responsibilities.

## Integrated execution paths

- Fresh scaffold registers incarnation custody before hooks. Activation statically preflights every hook, then admits, checks readiness and executes each hook in retained order. Readiness sees the intent but cannot have effects. Required failure retains home, hook intent references and observed provider metadata.
- `activateCapturedScaffold({...,retryIntents:{[capability]:executionId}})` requires the exact entire saved hook-intent map on cleanup-required retry. Completed hooks are not repeated. Unsupported contribution refresh refuses.
- Home `kind:action` operations admit before readiness/execution. `--retry-intent EXECUTION_ID` explicitly retries/replays; output and error details carry the intent reference. Nonzero/contradictory/malformed/timeout/cleanup outcomes remain unconfirmed with observed receipts. A saved successful envelope is replayed without readiness or effects.
- Scope mutation operations refuse `admission-required`; no scope incarnation is invented. `kind:view` inspection stays nonmutating. Raw capability commands without admitted instance context grant no setup authority; identity-dependent providers must continue refusing such mutation.

Actual managed-runtime launch, start/restart/wake/retire recovery, scheduler execution-ID propagation, and helper launch are not qualified by these tests. Next steps are explicit retained launch inputs, exact runtime-root retention, then native backend/history/work-custody integration with preflight-before-stop. No `--no-launch` result can stand in for successful helper execution.
