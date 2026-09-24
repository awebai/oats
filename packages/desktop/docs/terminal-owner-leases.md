# Terminal owner leases (Desktop wire2)

The terminal is still a viewer of the exact existing tmux/Herdr/remote source.
This boundary protects Desktop-owned PTY resources, not every general HTTP/API
operation as a per-window sandbox. Kernel lifecycle stays with the compatible
installed CLI. Workspace-v2/catalog/editor/detach changes are not part of this fix.

## Authority and hot path

Main registers app-created webContents **before load/terminal IPC**, installing
navigation, crash and destruction hooks. The principal is the registered object,
its current admitted main frame, exact renderer URL, and main-issued document
epoch. Electron43 `did-start-navigation` details (`isMainFrame`,
`isSameDocument`) revoke synchronously on main-document replacement, including a
same-URL reload. Genuine same-document navigation retains the epoch. Detached
frames, child frames with the same URL, foreign/unregistered senders and destroyed
frame accessors fail closed. Loading a new document cannot revive old promises.

A handle is a copied immutable `{id, lease}`; the lease is random256-bit main-owned
material. It is **not bearer authority**: every operation also checks the sender
and document. There is no numeric compatibility lane or preload id→latest-lease
map. A tab retains its original handle across every await and cleanup callback.

`terminal-owner.mjs` uses **one `Map<lease,record>.get` on each write**, then direct
resource-ID/webContents/epoch comparisons and state checks. Principal checks use
private registered-owner object metadata and a membership Set, not a nested
owner/target Map. No hashing, target serialization or dedup-index lookup is on the
keystroke path. The test records1000 writes →1000 lease gets and0 target-index gets;
this is an algorithmic-shape measurement, not a native latency benchmark.

## Resources and effects

- Dedupe is per canonical backend target and owner document. `reused` does not
  grant a second renderer tab an acquisition; closing its refused placeholder
  cannot detach the existing tab.
- **MAX_TERMINALS=20 is process-wide**, not20 per owner/backend. Reserve before
  any await. Pending/revoked inspection, awaiting-ready, closing, active attachment
  work and uncertain partial creation remain counted until settlement/confirmation.
  No unbounded queue, fulfilled preparation cache, eviction or conflicting overwrite.
- Remote preparation uses bounded loopback cached CLI metadata, the installed
  CLI's positive remote capability advertisement and fixed inspect/attach argv.
  It checks backend context/CLI identity before creation and both completion paths.
  Metadata reads are≤1MiB/5s, inspection≤1MiB/20s, overall preparation30s.
  Aborting does **not** release an unsettled process reservation. The owned command
  runner waits for both its result callback and child `close`, since AbortError can
  precede actual exit. No stronger/additional signal policy is introduced.
- Established direct viewers survive app-backend replacement; dependent pending
  preparation is invalidated. No fallback target resolution or alternate source.
- tmux component validation/anchors, saved socket, linked-window-only viewer,
  source-death isolation and provisioned locked wheel key table are unchanged.
  Cleanup targets only the exact owned viewer, never the durable source.
- PTY exit and confirmed viewer cleanup are both necessary to release a slot.
  A successful exact-name inventory can confirm an already-absent viewer;
  inaccessible/failed inventory is uncertainty, not absence. Partial-creation
  failures carry a private cleanup receipt rather than silently orphaning a slot.
- Viewer cleanup is asynchronous with the same fixed tmux argv/socket. Close
  returns `E_TERM_CLOSE_PENDING` after2s while the slot stays quarantined. An
  explicit retry or a late confirmation can settle it; the PTY detach signal is
  not repeated. Main quit revokes synchronously and allows a bounded2s cleanup
  grace, then follows the existing server-stop/quit path. Timeout never fabricates
  resource release; the existing scoped dead-owner sweep remains recovery.

## Private IPC and renderer lifecycle

Invocations return `{terminalApi:2, ok:true, status, ...}` or a stable static
`E_TERM_*` refusal. Raw native/CLI/filesystem errors are not forwarded. Write and
resize remain one-way, zero-effect/no-throw on invalid, foreign or stale requests;
there is no synchronous IPC or awaited keystroke round trip.

- `term:open(spec)` admits exactly one existing backend shape, not owner/bin/env/
  command authority. `term:close(handle)` is invoke, not an unleased send path.
- `term:ready(handle)` acknowledges **after renderer data/exit listeners exist**.
  Early output is FIFO-buffered≤64KiB for≤5s inside the global slot budget; early
  exit also waits for this acknowledgment. Overflow/expiry rolls back only the
  viewer, with an explicit failure rather than a healthy truncated terminal.
- Output goes through the current admitted main frame on `term:data:<lease>` /
  `term:exit:<lease>`. Exit receipts distinguish pending from confirmed cleanup.
  Native callbacks consult the current resource record, not a captured old window.
- Caller write≤1MiB is validated before any send. UTF-8 chunks≤64KiB do not split
  code points or alter control bytes. Local refusal is visible, not silent paste
  truncation. Geometry is finite integer1–1000, retaining existing opener defaults
  and minima. Shift+Enter/raw Ctrl policy and local copy selection remain intact.
- All subscriptions/observers are created inside lifecycle onReady, before its
  settlement signal. Close during open skips late setup and detaches the original
  handle when it arrives. Close during ready waits for setup before disposal.
- The shell keeps an unconfirmed-close tab, key and split destination visible:
  **closing… not yet confirmed**. A ready timeout remains an explicit failed view:
  **terminal did not become ready; closed**. Neither is a healthy terminal or
  silently removed tab. Only confirmed explicit close disposes a pending view.
  Late completion must not steal a newer workspace/stage/selection or focus.

The main-only `rekey(resource,newOwner)` primitive rotates lease/index/output
custody atomically and is exercised only by tests. **No escrow/staging, transfer
IPC, extra window, detach UI, automatic return, screen/scrollback transfer or
independent-viewer mode is introduced.** Those need the later approved transaction.

## Attachments

Preserve16 files/25MiB per batch, with4 batches process-wide and one per lease.
Native File paths are obtained in preload. Main copies/adopts the original
handle/target and revalidates before/after async validation and before each
mkdir/write/upload. Remote upload uses only fixed CLI argv and fresh compatible
CLI identity; reownership is blocked during a batch. Already-started effects can
exist after interruption: report unknown effects and insert no filenames, never
claim undo or delete a user/remote file. Renderer success AND rejection check the
original handle/operation, with focus gated by current explicit intent.

## Evidence boundaries

Tests use real shared broker/handler/bridge/adapter/renderer code with inert owners,
PTYs, clocks, CLI/FS recorders and DOM. The main composition/window-registration
and quit wiring are source-exercised under injected effects. These tests do not
need Electron/CDP/tmux/SSH/Herdr sessions, native signals, live models or an operator
backend. The mixed root `test/desktop-tmux-target.test.mjs` contains live native
cases and must not be loaded for inert Desktop qualification: a test-name filter
is not an isolation boundary. Computed style/DOM tests and incidental native test
passes are not native acceptance. Native Electron and exact tmux before/after
remain the maintainer's separate acceptance gate.
