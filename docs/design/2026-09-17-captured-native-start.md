# Captured native start through the existing session transaction

**Implementation candidate; not release, privacy or live-model acceptance.** This is an actual native dispatch path, not replay of a no-launch scaffold. Tests execute inert native fixture binaries through the existing backend command path. The subsequent [public start/helper CLI bridge](2026-09-17-public-captured-start.md) exposes this transaction; provider-worker and Pi qualification remain separate.

## Explicit executable inputs

The [launch request](2026-09-16-captured-launch-inputs.md) now accepts either:

- `executable:{capability,command}` for an OATS-managed retained entrypoint; or
- `executable:"/absolute/normalized/host/tool"` for an explicit external host executable.

An external host tool is not forced into a new runtime capability and its binary bytes are not represented as an OATS artifact pin. Dispatch checks availability/executability at the recorded path, not current PATH/config aliases. An executable resolving into this deployment's managed `.agents` namespace must use retained-resource authority, not this escape. Managed entrypoints must match the selected retained manifest command and its exact resource.

Runtime, model, environment references and yolo remain explicit captured inputs. There is no current launch-config/model resolver. Native runtime configuration is not claimed totally hermetic; credential reference values stay outside records.

## Fresh native evidence

Public `scaffoldCapturedInstance` initializes the existing native-history and independent retirement/session baseline **only for a freshly created owned home**, before hooks. Existing sidecars at a reused address cause refusal, not deletion or history backfill. Home existence retains its normal refusal.

Metadata and the existing guarded instance index retain a versioned `nativeScaffold` directory-witness set (native-history root/home directory and retirement root/baseline directory). Native start checks those witnesses and the unchanged complete fresh-history header. Older/unwitnessed captured homes do not gain these facts by starting.

The existing `packages/record` APIs are reused without modifying that package. Native location recording still happens inside the backend shell under the actual execution environment, before native exec. Location rules, historical preservation and unsupported explicit-session handling remain that contract's responsibility.

## Core API and authority

```js
startCapturedInstanceSession(home, {
  deployment, resolution, // optional equality assertions; owned binding is authoritative
  backend: {backend:"tmux", binary:"/absolute/tmux", socket:"/absolute/socket", session:"name"},
  task: "explicit initial task",
  restart: false,
  retryExecutionId // explicit retry/replay only
})
```

Embedding/test options include explicit `env`, existing backend `io`, and bounded-stop configuration. These are not a new provider protocol. Initial task/backend placement must be supplied; later calls can use their owned metadata/TASK.md. Backend relocation refuses rather than adopting another endpoint.

The old public home-only `startInstanceSession`/`restartInstanceSession` routes captured homes into this path **before** legacy `planLaunch` or current configuration resolution. Runtime/model/config/yolo replacements are refused; a new captured selection is required. Omitted legacy option properties do not create overrides.

Before provider readiness, validate the exact record, approvals, subject/human/home/work, native sidecars, instruction/skill bytes and aliases, executable, supported arguments, environment references, backend and task. Selected bindings then receive their existing read-only `inspect` check with the owned generic invocation. This is availability checking, not invented enrollment or a provider-native action. Recheck custody/curriculum/task before every backend call.

## Admission and native transaction reuse

A kernel-owned index intent uses `{kind:"session",name:"start"|"restart"}` with `capability:null`. It extends the existing bounded index, not the provider invocation action table or a new journal service. Provider wire remains unchanged. Its input commitment binds the explicit backend and task bytes; resolution/incarnation remain independently verified authority.

Acquire `start-running` from the expected lifecycle state, then mark the admitted attempt running before task/metadata/backend effects. The existing `startInstanceSession` transaction consumes a private captured plan instead of invoking the legacy planner. It reuses locking, endpoint observation, preflight-before-stop, tmux allocation/respawn, native-history recording, pending receipt, independent endpoint baseline and metadata publication.

Pending/start IDs use the admitted logical executionId. Native-history segment IDs remain their existing evidence IDs and are linked in the pending/result receipts as `nativeRecordId`; they are not replacement logical request identities. The native process receives exact OATS deployment/resolution/incarnation/execution/attempt markers, not its caller's identity.

Successful backend dispatch records `start-dispatched` and returns `dispatchAccepted:true`; that means the existing native transaction accepted the dispatch, **not** that a model is healthy, a task finished, or a provider is private/enrolled. Completed explicit replay performs no backend dispatch. Distinct new requests get distinct execution IDs under the same incarnation.

On uncertainty, preserve pending target/native-history references and an unconfirmed indexed intent using original authority and the owned lifecycle state; never write a replacement home. A retry cannot turn an absent/exited uncertain pending target into another launch under the same logical request. Such evidence remains held for explicit reconciliation. No force cleanup or fabricated success is provided.

## Initial limits and evidence

Unsupported work modes, non-tmux first placement, arbitrary extra native arguments, required managed runtime packages without a qualified captured loader, and unresolved launch/spawn runtime contributions explicitly refuse. This does not replace their missing implementation with `--no-launch`. The static helper resolver and provider `E_CAPTURED_HELPER` gate remain unchanged; the public CLI bridge now consumes this core route, but each provider-worker path still needs its own qualification.

The focused test prepares separate primary/helper recipes, deletes source/current config authority, executes actual inert fixture processes through a fake tmux transport, verifies admission inside those processes, checks captured model/identity markers and native history linkage, exercises new-request/replay/restart and preflight-before-backend refusal, holds a metadata-write uncertainty without duplicate execution, and refuses missing native scaffold evidence or replaced native custody directories. No real model, GUI, backend daemon, provider enrollment, timer, release or deployment operation runs in that fixture.
