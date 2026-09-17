# Public captured start and retained helper dispatch

This is the public CLI bridge to [captured native session custody](2026-09-17-captured-native-start.md). It adds no backend, configuration resolver, provider action registry or harvester. CLI support and inert process evidence are not provider-worker, live-model, Pi-loader, privacy or rollout acceptance.

## Callable interface

```text
oats session start|restart --deployment DEPLOYMENT --resolution RESOLUTION_ID \
  --home NORMALIZED_ABSOLUTE_HOME [--helper EXACT_SOURCE_HELPER_KEY] \
  [--request NORMALIZED_ABSOLUTE_JSON] [--retry-intent SAVED_EXECUTION_ID] [--json]
```

The existing global `capturedSelector` still owns selector parsing (including explicit pairs replacing poisoned inheritance as a unit). Only start/restart adopt this route. Current-context flags, runtime/model/yolo/config overrides and unknown/duplicate native flags refuse; no fallback to legacy session routing.

Request files reuse the unchanged bounded strict object-file reader already used for preparation. Native request validation is separate: a closed object with required `schemaVersion:1`, and optional `backend`, `task`, `stopGraceMs`. Unknown fields are rejected before any projection; env/io/credentials/provider settings/selectors are not accepted. Symlinks/nonregular files, invalid UTF-8/JSON, malformed paths and bounds retain that shared reader's typed refusals. Its historical diagnostics may still say "preparation request"; it does not prepare or resolve anything on this route.

```json
{
  "schemaVersion": 1,
  "backend": {
    "backend": "tmux",
    "binary": "/absolute/host/tmux",
    "socket": "/absolute/selected/socket",
    "session": "captured"
  },
  "task": "Explicit initial task",
  "stopGraceMs": 20000
}
```

The backend is a closed tagged union: the tmux form above, or
`{"backend":"herdr","binary":"/absolute/herdr","socket":"/absolute/herdr.sock","protocol":20}`.
Herdr returns actual `workspaceId`/`paneId`/`terminalId` in target receipts; request
fields never invent them or substitute tmux session/window names. See
[backend parity and allocation custody](2026-09-17-captured-backend-parity.md).

First start needs task/backend. Later calls can use owned TASK.md and native endpoint. A supplied null backend is invalid, not omission. Core validates all backend fields, availability, task text/bounds, stop grace 1–300000ms and exact captured native prerequisites before backend access. Endpoint relocation, contradictory residual native placement metadata and unsupported work/root/package/argument/contribution/backend paths refuse. First placement uses the exact admitted endpoint, not a legacy metadata fallback. Nothing is inferred from a current model/config alias.

## Read-only API availability, separate from readiness

Public `inspect` returns `result.nativeSession`; helper inspection also returns
the same value as `helperSelection.launch`:

```json
{"schemaVersion":1,"api":{"contract":"oats.captured-session","version":2,"available":true,"backends":["tmux","herdr"]},"readiness":{"status":"not-checked"}}
```

This closed `CapturedNativeSessionAvailability` shape identifies the implemented
callable request/result contract, not the selected record's or execution host's
readiness. Core exposes the same static value through
`capturedNativeSessionAvailability()`. Inspection has no target home/task/backend
and performs no provider readiness/backend call, provisioning or admission. The
descriptor stays `not-checked` before and after native dispatch; it never stores
readiness as permanent authority. Missing launch recipes, approvals, supported
roots/args/backends/contributions or clear custody still refuse during start.

Consumers must recognize the contract/version, treat old/absent/unknown or
contradictory descriptors as unqualified rather than fabricate a replacement,
and still validate the actual action result/error and source/helper authority.
API availability alone does not remove a provider's `E_CAPTURED_HELPER` gate or
satisfy provider/runtime/Pi/privacy/release acceptance. The previous unreleased
blanket helper launch-unsupported signal is not emitted alongside this descriptor.

## Persistent and helper stages

For a persistent home, use its own binding. For a helper:

1. `inspect --helper EXACT_KEY` on the SOURCE selection returns the dedicated helper selection/name.
2. Existing `spawn HELPER_NAME --deployment HELPER_DEPLOYMENT --resolution HELPER_ID --home NEW_HOME --no-launch --json` creates the fresh owned scaffold and runs retained hooks. It is not native dispatch.
3. Invoke the new `session start` with SOURCE selectors, the same `--helper EXACT_KEY`, that owned home and the native request. The kernel revalidates the retained edge and context/human equality, then passes the HELPER binding to `startCapturedInstanceSession`. A source home or another helper home does not match and refuses.

An occupied home is not silently recreated. Hook failures/custody gaps remain held; this API does not add automatic hook replay or a compound scaffold/start transaction. Keep source completion calls on the source's saved binding, not the helper's inherited runtime selection. Static helper lookup uses the versioned availability/not-checked descriptor above; consumers require that qualified callable contract and real action result, never the lookup as proof of running status.

## Result and failure custody

Success uses the existing one-object CLI envelope `{schemaVersion:1,ok:true,result}`. Result includes the canonical selected `executionBinding`, existing native target/history/intent fields and, for `--helper`, exact `sourceExecutionBinding` and `helper:{key,name,subject}`. Initial dispatch has `dispatchAccepted:true`. Completed explicit replay returns `replayed:true` with the saved receipt and intent; it does not dispatch again or certify a currently live process.

Failure uses one nonzero envelope. Native uncertainty remains in `error.details.nativeCustody`, including admitted intent, pending path and observed native/history evidence; `details.unconfirmed:true` is not flattened into an ordinary static error. Source/helper bindings remain distinguishable in failure details. Preserve that evidence. Lifecycle mismatch/held publication debt is returned separately as `error.details.custody` with indexed/metadata status and any saved intent/receipt, without claiming a new native effect. New requests cannot bypass cleanup-required even when its intent is completed; that completed publication debt stays held for explicit reconciliation. Retry with `--retry-intent` names the saved logical ID; it cannot silently rerun an exited/absent uncertain dispatch under the same ID. A present non-shell same-ID pending restart is adopted and returned without another stop/dispatch, just like start. An unknown Herdr workspace allocation retains its existing pending phase/endpoint/intent and refuses duplicate allocation or label-based identity inference. A new distinct restart request gets a new execution ID within the same incarnation. There is no metadata wipe, ID derived from a home/name, or borrowed provider credential/context.

## Evidence

The public test prepares separate primary/helper launch records, removes source and poisons current config/lock, then uses CLI subprocesses for lookup, scaffold/hooks, native start, completed replay and restart. An actual fake-backend executable runs inert native executables; those processes verify indexed running admission before writing. This is not a private backend `io` seam or a real backend daemon/model.

Refusals include unknown request/override fields, null/unsupported backend, wrong task, symlink request, conflicting flags, missing helper and wrong home, all before native backend access. A backend fixture executes the native process and then fails its response; public JSON retains unknown custody. Retry preserves the execution ID/attempt chain and never runs the process twice. Occupied helper homes and their metadata are retained. Source completion/publication policy, Pi managed loaders, live credentials/models, and provider runtime integration are not tested or accepted by this fixture.
