# Captured native backend parity: tmux and Herdr

Implementation candidate over the existing native session transaction. Herdr is a required backend, not optional post-release work. This increment supports captured primary/helper public start/restart with both adapters; applicable wake/retire/recovery/provider-worker paths and real model/host qualification remain separate required gates before overall rollout completion.

## Exact public endpoint and receipt shapes

The existing native request remains `{schemaVersion:1,backend?,task?,stopGraceMs?}`. Backend is a closed tagged union:

```json
{"backend":"tmux","binary":"/absolute/tmux","socket":"/absolute/tmux.sock","session":"selected-session"}
```

```json
{"backend":"herdr","binary":"/absolute/herdr","socket":"/absolute/herdr.sock","protocol":20}
```

No Herdr `session`/`window`, caller-created workspace/pane/terminal ID, config lookup or inferred socket. First start requires explicit endpoint/task; later calls may reuse their guarded owned values. A supplied malformed/null endpoint is not omission. Model/runtime/yolo/managed resources still come from the captured recipe, credentials only through the existing nonsecret references.

Existing `allocateHerdr` issues `workspace create --cwd HOME --label INSTANCE --no-focus` and returns the actual `root_pane` IDs. Receipts retain:

```json
{"backend":"herdr","binary":"/absolute/herdr","socket":"/absolute/herdr.sock","protocol":20,"workspaceId":"w1","paneId":"w1:p1","terminalId":"term_native"}
```

These are observations allocated after admission, never IDs fabricated from a name/home/hash. The protocol adapter targets Herdr 0.8.x, with documented reference baseline 0.8.2; enforced runtime prerequisite is snapshot protocol **20** plus the existing commands/result fields. This source increment does not claim an installed version or live socket was checked. An explicit existing operator-managed socket and executable are required; unavailable or incompatible snapshots refuse. Captured start does NOT call `ensureHerdr`, start a daemon, install a backend or fall back to tmux.

## Existing transaction, stronger target custody

Both branches use `startCapturedInstanceSession` and the existing private-plan route into `startInstanceSession`, including independent home/work/native-history/baseline witnesses, admitted task/endpoint commitment, locks, pending start, bounded stop, native location recording and result publication. Source completion still uses SOURCE binding; helper execution uses its exact dedicated binding and owned incarnation.

NS1 metadata/index lifecycle agreement and explicit cleanup-debt retry rules apply unchanged. NS2 returns same-ID present non-shell pending adoption without another stop/dispatch; absent/exited/shell uncertainty remains held. NS3 checks the backend-tagged metadata and independent endpoint before provider/backend effects. Herdr targets additionally need indexed observation custody; residual tmux metadata, unrecorded/changed workspace/pane/terminal IDs, wrong endpoint or missing launched-target metadata refuse.

First Herdr allocation extends the EXISTING pending record with `phase:"allocating"` and explicit endpoint before `workspace create`. If the response is lost or fails, the same intent remains unconfirmed and retry refuses automatic reallocation or label-based lookup. No new journal service or silent repair is introduced.

When allocation returns, its exact valid target and native-history reference are persisted in the EXISTING running index intent BEFORE pane launch. The full pending record is then written. Returned target facts reach failure custody even if later publication/root checks fail. An unknown allocation with no IDs cannot be replaced by invented authority. Complete pending target IDs must agree with indexed evidence; the pending request must be the latest session intent. Baseline, indexed known targets and metadata are checked together, including during interrupted acknowledgment.

The existing Herdr adapter's captured strict observation compares workspace + pane + terminal and rejects ambiguous/missing workspace matches. A replacement terminal is not the old target. Transport carries the exact admitted `HERDR_SOCKET_PATH`, scrubbing inherited `HERDR_SESSION`/socket values. Native guards do not accidentally discard the adapter's endpoint environment. Normal legacy adapter behavior is unchanged outside the explicit captured strict path.

## Availability is not readiness

`oats.captured-session` API **version2** advertises supported adapters without claiming host readiness:

```json
{"schemaVersion":1,"api":{"contract":"oats.captured-session","version":2,"available":true,"backends":["tmux","herdr"]},"readiness":{"status":"not-checked"}}
```

Request envelope1 is still native action input, not configuration or authorization to choose a different model/provider. Version1 pins remain historical; consumers must require a understood version/backend contract and validate actual results/refusals, not guess from backend names. Static discovery never probes or provisions. Dispatch acceptance is not model health, task completion, provider/private messaging readiness or release acceptance.

## Evidence and limits

Focused public tests run the real CLI with fake backend EXECUTABLES and actual inert native children for both primary/helper records. Herdr fixture verifies the explicit transport socket and indexed target/intent BEFORE the child effect; tests first start, distinct restart, same-ID uncertain restart adoption, allocation-response uncertainty with no duplicate allocation, poisoned metadata/terminal refusal, workspace mismatch before launch, wrong protocol with no allocation and retained target/history facts. A synthetic present-agent snapshot after an inert child exits drives the uncertain-adoption branch; it is not a live-model observation.

Tmux public regressions and native NS1/NS2/NS3 guards remain covered. This is a small implementation parity check, not a full platform matrix or real daemon/Pi/provider qualification. No production socket/account/backend was changed. Coherent integration and later real Herdr/native-Pi gates belong to the coordinator, with independent reviewers owning source verdicts.
