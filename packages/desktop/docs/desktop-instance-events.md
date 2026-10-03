# Selected-instance activity (K7 API 2)

The Deployments page (formerly the Active overview) reads **reported lifecycle activity** only after the user
selects an instance and presses **Load activity / Refresh activity**. Opening a
card, polling the roster, moving the camera or changing selection never runs an
events command. The shared shell CLI status enables the control; this view does
not probe, install or reconfigure OATS on its own.

## Boundary

- Both exact integer `eventsApi: 2` and `instance-events-2` are required at server
  admission and the actual CLI execution owner. API 1 and version-only guesses
  are insufficient.
- `POST /api/instance-events?ws=<advertised-id>` accepts a 16 KiB JSON object:
  `{action:"read", selector:{instance,agent,agentsRoot,server}, limit?}` (`server`
  is `null` for a local row).
  Limits are exactly 50, 100 or 200 (default 100; the overview uses 100).
- The server admits one current roster home and pins its recorded birth,
  workspace and CLI. The renderer cannot choose a home, cwd, log, environment,
  command, cursor or `--since`. Captured refusals have no classic fallback.
- Fixed no-shell argv: `instance events NAME --dir CONTEXT --home HOME --limit N
  --json`; a remote row's is `instance events NAME --server S --home HOME --limit
  N --json` ([remote rows](desktop-deployment-model.md#remote-rows)). CLI budget:
  15 seconds (45 for a remote read) / 4 MiB. Two process-wide read slots, identical
  reads coalesce before dispatch, no queue or settled server cache.
- Main normalizes route aliases before selecting the specialized proxy. Trusted
  mainFrame/navigation and copied backend base/epoch/workspace are checked on
  both outcomes. The 20-second proxy caps streaming bytes at 4 MiB before copying
  an over-budget chunk and reprojects the public response.

## Meaning of the observation

This is **address history**, not a report of what the model is doing now. The
current roster's runtime state remains separate and authoritative for its own
existing actions. Earlier-incarnation events remain visible as earlier; missing
incarnation is unknown. `instance.json.createdAt` supplies the incarnation tag.
A historical stopped/retired event never disables or launches an action.

The display preserves `integrity.unreadableRows`, `foreignRows`, and logical
`home`/`workspace` source statuses and byte counts. Bytes describe source size,
not bytes read. A refused source, corruption, foreign rows or truncation is
visibly incomplete, including an empty selected window. Counts describe the
bounded observed read, not all recorded history or a number of live instances.

Waiting is a producer-attributed claim for a known current incarnation. Cleared
claims remain visible per producer. `waitingOnYou: null` means **unknown**, never
“not waiting”. The producer computes claims before windowing; the consumer does
not reconstruct state from selected rows, transcripts, TASK/STATE prose or Git.
Unknown current incarnation cannot authorize current claims.

Only allowlisted scalar facts and target counts are shown. Text is plain,
bounded and credential/URL-redacted. Raw notes, task/environment/recipe/command
payloads and PID arrays are not forwarded. Paths and past plan revisions are
provenance text, not file links, terminal targets or executable confirmations.

A claim may carry a `message` (one line, at most 200 characters, no control
characters). It is optional: a kernel without it omits the key, which reads as
`null`. An invalid or empty message is `null` and the claim is kept. When
either `waitingOnYou` or the newest positive claim owns `message`, the raw values
must be equal (a missing key counts as `null`), as for producer, since and
reason. The summary shows it after the producer and time, as plain text.

## Needs input on the sidebar roster

The roster shows the same kind of claim without a read: `oats status --json`
rows carry `waitingOnYou: {since, producer, reason, message} | null`, under
probe feature `waiting-on-you`. Desktop gates on that feature, never the
version. Without it, `observeDeployment` drops the field from every local row.
A remote row carries it only when the remote kernel reported it. Desktop
validates the field and never synthesizes it.

- **Validation** (`renderer/waiting-on-you.mjs`, `waitingOnYouData`) never
  throws and never fails the roster. Only an invalid `since` or `producer`
  drops a claim, which then reads as `null` (unknown). A missing or malformed
  `reason` becomes `null`, because the raw reason is never rendered. A
  malformed `message` becomes `null`, and an unsafe one becomes `[Detail withheld]`.
  `deployment-data.mjs` and `remotePanel` both validate through it. The
  module is the claim contract only: the server imports it, so it imports
  contract modules and nothing else (a test pins its imports). The tree
  roll-up lives in `renderer/instance-tree.mjs`.
- **One gate.** Every surface reads a claim through `waitingClaim(row,
  {stale})`. It returns the claim only when the Desktop's own liveness says
  running (`running === true`, with `runtimeState` absent or `running`), the
  remote server answered this read (`serverUnreached` is not true), and the
  roster does not hold the row stale. A tmux shell, a stopped, unreachable or
  unsupported session, or a last-known roster never shows it, whatever the
  kernel said.
- **The mark.** A "Needs input" pill (an alert icon and text, never colour
  alone) sits on the row's name line, before "New". It becomes part of the
  row's accessible name. The dot stays liveness. Rows are not reordered, and
  nothing animates.
- **The card** (hover or keyboard focus) adds `Waiting` (the reason in words,
  how long, and the local start time) and `Message`. The age is computed when
  the card is shown. A row that has no card (an unavailable remote row) appends
  the message or label and the start time to its title and description.
- **Collapsed parents.** A waiting row hidden by a collapse is counted on its
  nearest visible ancestor as "N below" (`waitingRollup` in
  `renderer/instance-tree.mjs`, beside `instanceVisibleInTree`, which it mirrors), following the parent relation only
  (never across a remote server), and never outside the deployment section the
  waiting row is painted in. The card's `Below` fact names up to three of
  them. The roll-up is derived on every paint, so it goes as soon as the parent
  is expanded. Filtering collapses nothing, so it shows no roll-up.
- **Display only.** Nothing in Desktop acts on a claim. The terminal tab dot
  does not follow it.

The waited age is never painted into the row, so the roster signature changes
only when a claim appears, clears or changes.

## Renderer ownership and retention

Each explicit read mints a new event ticket, independent of roster/action
requests. Both success and rejection must still own the selected composite
address/birth, workspace generation, CLI observation, visible popup and ticket.
Close/dispose, hide→show ABA, blur→focus, same-address recreation and shared CLI
changes revoke pending work. The shell's existing broker invalidation signal also
covers backend replacement; its monotonic connection generation revokes reads
and clears retained evidence without another command or new IPC surface. A newer read can supersede a pending read; the
server coalesces identical commands.

One observation, at most 4 MiB, is retained **only in the current popup** (below
the 32-target upper bound). There is no cross-selection/server cache,
persistence or reopening-by-name. A failed refresh keeps the actual older rows
with explicit stale labeling. Unrelated roster updates keep the visible popup
connected, preserving controls, focus, disclosure, scroll and native text ranges.
Hidden views cannot reclaim focus. Popup wheel and disclosure keys remain native
reading controls, not graph-pan/terminal commands. Expanding the disclosure
repositions the viewport-bounded popup without focusing or moving the camera.
No event completion selects a graph node or moves the camera.

## Qualification

Tests use injected CLI recorders, the shipped HTTP/main handler bodies, memory
streams and JSDOM. Stored producer receipts exercise private and public
projection without accessing receipt-named paths. Intended-assertion mutations
cover fences, budgets, both-path ownership, corruption visibility and renderer
selection/visibility races. Three-theme computed AA is not native GUI acceptance.

Producer corrections for descriptor-open races and unknown-current-incarnation
claims must be qualified on their named merged implementation before release;
Desktop must not compensate with a duplicate log scanner or optimistic old mode.
