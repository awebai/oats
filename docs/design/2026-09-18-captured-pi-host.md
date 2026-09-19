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

The record owner's approved `history.json` v2 expected-ID claim is mutable
record custody. For the exact strict Pi profile, Core's authority callback keeps
index/incarnation/lifecycle/home/native-directory/baseline/target checks but does
not duplicate that private codec or freeze its bytes to v1. The pinned read-only
inspection, guarded preparation and started-v2 assertion own that validation.
Re-entering inspection during a pending publication would incorrectly reject the
record owner's own transition. Non-Pi retains literal v1 manifest equality.
This narrow consumer correction was demonstrated by the combined package fixture;
it is not acceptance of a path/self-marker or a weaker record implementation.

The existing recordNativeStart execution must understand/check v2 before exec;
all downstream guards must be present before the version advertises support.
Until then, this increment refuses ZP1 BEFORE admission/backend effects. It does
not fake a complete runnable path or bypass the separate record source exception.
The API seam is subject to the parent-owned combined code review and coordinated
record implementation; no record lib/bin edits occur in this increment.

## Non-authorizing print-completion observation (version 1)

The dispatch ID marker and native SDK return value answer different questions.
Neither proves that the native process terminated successfully AND produced an
attributable final turn. The small observation increment uses the existing
native ID, original pending/index/started-v2 custody and witnessed S, not another
resolver, admission, identity, transcript parser or observation service.

Two exclusive 0600 JSON files live in S:

- `.oats-pi-sdk-<nativeRecordId>.json`: `kind: oats.pi-sdk-outcome`;
- `.oats-pi-process-<nativeRecordId>.json`: `kind: oats.pi-process-outcome`.

Both have `schemaVersion: 1`, `authority` and `observed`. Authority contains the
original home/sessionDir/incarnation/IntentRef/nativeRecordId/executionBinding,
target/admitted input integrity and expected `{runtime: pi, provider, id,
sdkVersion}` selection. It is attribution, NOT an additional authorization.
The original attempt remains original even when same-ID reconciliation advances
the index counter (PH1). Existing/partial/conflicting receipt files are not
rewritten, adopted or cleaned up. File and directory sync plus custody checks
surround publication. Before ANY content read, and again before every bounded
read, the opened outcome descriptor must match the CURRENT physically named
regular file under original-root proof. An earlier stat can itself come from a
redirected ancestor; a restored root or a post-read exception is not FD authority.
Size/version stability checks remain, with no bytes read to discover a mismatch.
These files are neither root witnesses nor native JSONL;
the record3API, native inventory, S formula, v1 readers and capture parsing are
unchanged. Their presence never establishes root ownership.

SDK `observed` is `{exitCode, observation}`. `exitCode` is the actual numeric
return from native `runPrintMode`, never a default. The public runtime's
synchronous `setBeforeSessionInvalidate` hook snapshots actual public session
metadata after shutdown handlers and BEFORE native disposal. It copies only
SDK VERSION, SessionManager header/id/file, session.model, and the final native
branch assistant entry's id/provider/model/optional responseModel/stopReason/
timestamp. That entry must agree with the last state message; an earlier
assistant followed by another message is not a final assistant. No prompt,
content/nonce, raw error, profile, credential or request-as-response is copied.
Unavailable observation stays null; it does not prevent native disposal or
manufacture a successful turn. The host publishes only after native print mode
returns and original custody is reverified. Native print output is unchanged.

Process `observed` is `{exitCode, source: launcher-wait-status}`. The COMMON
captured Pi completion wrapper used by tmux AND Herdr saves the native execution
chain's actual shell `$?`, then invokes the existing host executable's PRIVATE
`--oats-pi-record-exit 1 --home H --native-record UUID --exit-status N` mode under
the ORIGINAL kernel command environment. The native recorder execs the original
host, so this is post-process wait status, not a sidecar's intent or the SDK
return value. Nonzero/signaled shell status is retained literally; no signal
number is guessed. The observer imports/creates no SDK/model/auth services and
cannot change the enclosing shell's saved native status. This private mode is
NOT accepted by the launch recipe grammar. Ordinary/Claude/Codex paths are
unchanged, including explicit permission settings and native defaults.

Only after guarded process-receipt publication does the observer atomically
publish the EXISTING `.oats-start-exited` with its unchanged dispatch-ID-only
contents. Legacy readers remain correlation-only. If custody or publication is
uncertain, missing evidence is held; there is no success fallback, repair or
new native attempt. A failed process can have a process-only observation; a
successful-looking SDK receipt without process observation is incomplete.

### Public read-only query

```
oats session inspect --deployment /deployment --resolution <retained-id> \
  --home /original/home --native-record <native-UUID> --json
```

For a helper, use the SOURCE resolution plus `--helper <exact-source-map-key>`.
There is no current-context lookup. Inspect accepts only home/helper/native-record
and json after the captured selectors; request/retry/model overrides are refused.
It admits/provisions nothing, calls no backend/model, and does not forge process
environment to inspect evidence. Existing source/helper and physical custody
checks plus pinned `assertCapturedPiStart` surround every receipt read and
native session-path check. The narrow query requires the ORIGINAL current
pending dispatch; an old ID after another dispatch replaces pending, a deleted
incarnation, changed curriculum/input or uncertain root remains held. Files in
S remain retained; this is not a new historical-incarnation recovery API.

The normal JSON envelope's `result.outcome` has `schemaVersion: 1`,
`contract: oats.pi-print-completion`, `nonAuthorizing: true`, `authority`,
`status: succeeded|failed|incomplete`, `qualified`, `processExitCode`,
`sdkExitCode`, `finalObserved`, nullable `sdk`, and evidence-presence flags.
Envelope `ok: true` means the QUERY succeeded, not that execution did.

`qualified: true` requires BOTH actual exit codes0, the observed selected SDK
version/header-v3/home/session-id/file, observed session and final assistant model
tuples equal to the retained selection, and final `stopReason: stop`. Missing
facts, mismatches, truncation/tool-use/error/aborted or nonzero status never pass.
This qualifies only **native-print completion**, NOT meaningful task completion,
automatic SOURCE helper execution, learning/privacy/capture correctness,
installation or release. A gate must still compare the expected original IDs,
consume protected native capture, and establish its domain-specific result.
Optional native `responseModel` is reported literally, not substituted for a
missing value or treated as cryptographic provider-side model attestation.
Receipts share the existing trusted execution-host/filesystem boundary; they do
not introduce signatures or promise detection of coherent privileged tampering.

Packaging needs the new `lib/captured-pi-outcome.mjs` alongside the existing
host/custody/SDK modules and bin. Existing lib inclusion already ships it; no
package/version metadata changes are needed.

## Evidence and honest results

Targeted unit tests use explicit SDK doubles to check parser/assembly argument
flow, normal native service initialization, loader and before-delegation guards.
They are NOT another SDK-consumer/model proof. Real retained preparation/scaffold
checks establish missing-record-support refusal before native effects. Existing
inert native regression checks cover unchanged custody/replay/placement behavior.
The previously completed public SDK consumer proof remains separate and closed.

`dispatchAccepted` proves native dispatch acceptance, not a model response.
The existing `.oats-start-exited` ID marker still does not contain a success code.
The new completion receipts/query are implemented as bounded kernel consumers;
unit doubles and inert shells are not actual SDK/model/backend qualification.
The coupled integration fixture REQUIRES actual complete record-v2 source (no
skip/stub of record support), exercising kernel/record/CLI wiring on both backend
paths with an explicitly FAKE SDK and inert transport. The bounded negative case
uses an existing unwitnessed S and retains legacy CLI refusal, rather than an
obsolete assumption that record support is absent. Neither fixture is actual
native SDK/model/backend qualification.
Real acceptance must observe SDK-created native session/assistant turns and
actual capture/recall under the completed witness guards, on BOTH selected native
backends. Do not fabricate process names, sessions, worker runs or learning.
