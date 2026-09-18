# Captured Pi print host — kernel implementation boundary

This increment implements an explicit SDK host, not a reinterpretation of a Pi
CLI executable. It is not interactive/plugin/private-provider qualification.
The host is packaged by the existing `bin/` and `lib/` file inclusion; no new
package metadata or mandatory model capability is introduced.

## Selection and native behavior

Choose the physical installed `bin/oats-pi-sdk-host.mjs` path as an explicit
captured Pi executable. Operator args are exactly:

```
--oats-pi-host 1 --mode print --thinking medium --sdk-root /physical/pi/package --sdk-version 0.85.1
```

Launch env is empty (no additional OATS contribution, NOT an empty inherited
process environment); yolo is false; model is an exact `provider/id`. The kernel
alone prefixes `--home H --session-dir S --model M --task-file H/TASK.md`.
There is exactly one session-dir flag at prefix indices2/3. Unknown/duplicate
args, arbitrary task/history/model flags and empty tasks refuse.

The public SDK export is resolved from the exact selected package name/version
and public export map without PATH/package acquisition or private imports.
ModelRuntime.create() uses its normal native defaults. Native getAgentDir and
SettingsManager.create preserve the user's ordinary profile/auth/helpers/OAuth,
model config and persistence. There is no OATS credential selector/parser/store,
no copied auth, and no null/empty/no-refresh production fixture configuration.

The public ResourceLoader consumes only reverified retained instructions and
exact skill files (`includeDefaults:false`). It has zero extensions and refuses
resource additions. Public services, createAgentSessionFromServices,
AgentSessionRuntime and runPrintMode remain the actual engine. The print host
rejects session switch/import/fork/new operations before delegation. Native
compaction/retry are not disabled. The captured exact model must exist; no
first-available/default substitution occurs.

## Admission, history and activation hold

The execution-side host verifies the original index/incarnation/intent, native
pending receipt/target, task input digest, capability approvals, selected launch,
zero-plugin eligibility and projected curriculum. It revalidates for resource
reload and startup; it does not admit another action or create an identity.

S is `nativeHistoryPath(H)`'s sibling named `<history-basename>.pi`, never inside
the native UUID-receipt directory and never the native auth/profile directory.
Core hooks the EXISTING native transaction's record preparation point, preserving
its record-ID/pending/target/replay/uncertainty logic. Legacy noncaptured renderers
are unchanged. A captured Pi CLI recipe is held rather than silently converted
or launched with unqualified ambient extension behavior.

**Fail-closed dependency:** the record library must provide the complete v2 root
witness AND discovery/read/each-append guard implementation. This kernel checks
`CAPTURED_PI_RECORD_VERSION === 2` and these synchronous native-history APIs:

- `inspectCapturedPiRoot(home, { incarnationId, sessionDir })`: read-only original
  proof validation or truly absent fresh root; missing/ambiguous evidence holds.
- `prepareCapturedPiStart(home, { incarnationId, intent, sessionDir, assertAuthority })`:
  pending-v2 before exclusive creation; kernel-authority checks around effects;
  durable witness outside S before dependent execution; original witness on reuse;
  returns the existing native record ID, never a replacement action identity.
- `assertCapturedPiStart(home, id, { incarnationId, intent, sessionDir })`: validate
  the execution-side started-v2 receipt, original associations and root identity.

The existing recordNativeStart execution must understand/check v2 before exec;
all downstream guards must be present before the version advertises support.
Until then, this increment refuses ZP1 BEFORE admission/backend effects. It does
not fake a complete runnable path or bypass the separate record source exception.
The API seam is subject to the parent-owned combined code review and coordinated
record implementation; no record lib/bin edits occur in this increment.

## Evidence and honest results

Targeted unit tests use explicit SDK doubles to check parser/assembly argument
flow, normal native service initialization, loader and before-delegation guards.
They are NOT another SDK-consumer/model proof. Real retained preparation/scaffold
checks establish missing-record-support refusal before native effects. Existing
inert native regression checks cover unchanged custody/replay/placement behavior.
The previously completed public SDK consumer proof remains separate and closed.

`dispatchAccepted` proves native dispatch acceptance, not a model response.
The existing `.oats-start-exited` ID marker does not contain a success code.
Real acceptance must observe SDK-created native session/assistant turns and
actual capture/recall under the completed witness guards, on BOTH selected native
backends. Do not fabricate process names, sessions, worker runs or learning.
