# Desktop Stop and Remove confirmations

Stop and Remove are consumers of the installed CLI's **lifecycleApi1**. The
Desktop does not implement stopping, ancestry, retention, Git deletion, recovery
or lifecycle policy. It never signals a reported PID or creates a Stop+Retire
recipe. The kernel owns those actions and their per-target outcomes.

## Compatibility and admission

Before any command, require an accepted installed CLI, a real `features` array
containing `lifecycle-plans`, and **`lifecycleApi === 1`**. Remove apply also
requires `retire-retention` and `retire-home`. Neither a version number nor a
trial invocation establishes support: older `retire` ignores unknown `--plan`
and retires. Missing/malformed advertisement means unavailable, zero invocation.

**POST `/api/instance-lifecycle?ws=<id>`** is the only Desktop K3 route. It uses
loopback Host / POST Origin guards, exactly one advertised workspace and no
extra query arguments. The privileged proxy pins the entire body-addressed
instance family. Bodies are strict JSON objects up to64 KiB:

```json
{"action":"plan","operation":"stop","selector":{"instance":"dev-1","agent":"dev","agentsRoot":"/team/agents","server":null},"options":{"recursive":true}}
{"action":"plan","operation":"retire","selector":{"instance":"dev-1","agent":"dev","agentsRoot":"/team/agents","server":null},"options":{"discardWorktree":false}}
{"action":"apply","planRef":"<opaque server reference>"}
```

The selector matches one exact server-owned roster record. Home and scope come
from that record, never request paths. Unknown/duplicate/replaced targets
refuse; no local or old remote fallback. A remote row's plan and apply are
routed by `--server S --home H` (see
[desktop-deployment-model.md](desktop-deployment-model.md#remote-rows)). CLI, argv,
environment, revision/key and apply options cannot be supplied by the renderer.
The old **POST `/api/retire/<name>` returns `E_PLAN_REQUIRED`** before lookup or
invocation, even for remote callers.

Plan payloads validate the exact primary home/name, producer revision, all
bounded target identities, session/work states and ambiguity. Unestablished is
not idle; unobserved work is not clean; nullable comparisons are not zeros.
Ambiguous parent edges are shown as **not acted on — parent name not unique**:
Stop uses `plan.ambiguous`, Remove uses `plan.facts.ambiguous`.

## Confirmation references, resource bounds and retry

Four distinct plan flights may run concurrently; equal reads coalesce. Each
confirmation gets a **different opaque planRef after that shared read**. A plan
reference binds exact workspace/scope/target, CLI contract, operation, options
and producer revision. At most32 pending references live for5 minutes. Plans
have a128-target total display limit and1 MiB output ceiling; an oversized plan
is refused, never truncated into a smaller executable action. Plan execution
is bounded to30 seconds; proxy35 seconds.

Changing any option obtains a new plan/reference and revokes the old controls.
Remove has one choice, the worktree: deleting it requires an owned worktree.
Remove no longer offers to delete a branch: retirement leaves branches to the
operator, and the kernel will refuse the flag. A retire request whose options
hold any other key is refused before a command, and no retire command carries
`--delete-branch`. There is no force/self/keep-dir/grace override or “don't ask
again” shortcut.

On the FIRST explicit confirmation, the server reserves its **one global apply
slot**, mints the idempotency key and freezes the operation. Apply sends only
that reference. Duplicate HTTP attempts share its pending promise or recorded
result; no new key or second native command is created. The CLI receives fixed
argv, absolute binary, shell:false and server scope cwd:

```text
oats instance stop NAME --plan --home HOME --dir SCOPE [--no-recursive] --json
oats retire NAME --plan --home HOME --dir SCOPE --json

oats instance stop NAME --apply --plan-revision REV --idempotency-key KEY \
  --home HOME --dir SCOPE [--no-recursive] --json
oats retire NAME --plan-revision REV --idempotency-key KEY \
  --home HOME --dir SCOPE [--discard-worktree] --json
```

Applies have a600-second/4 MiB bound; proxy610 seconds. At most32 settled or
uncertain results are kept for30 minutes, without expiring an in-flight action.
This is a bounded process-local transaction record, not a persistent journal.
A repeated cached result is marked `repeated`; it does not rewrite the kernel's
`replayed` fact. Replay of a recorded Remove result never resolves a newly
created same-name home. Lost server/reference/CLI identity requires a fresh
observation, not a silently minted retry key.

**Transport loss after dispatch means unknown outcome, not no effect.** Check
recorded result resubmits the same planRef. An uncertain CLI result stays
uncertain rather than re-executing a mutation. Closing the dialog only closes
status; it does not cancel the dispatched operation or signal its process.

## Effects are reported individually

- Stop processes the kernel's ordered targets. Nested `ok:false` remains partial
  even inside a successful envelope. Reported still-running PIDs are text only;
  no stronger-kill control. Home/work/transcript/launch remain retained.
- Remove stops recorded children first. `E_CHILDREN_RUNNING` displays
  `details.childrenStopped` and refuses retirement; **some children may already
  have stopped**, so “nothing retired” is not “nothing happened”. Read a fresh
  plan before a new confirmation; do not compose another Stop in Desktop.
- Remove accepts both the documented first raw receipt and enveloped replay,
  checking revision/key/name against the transaction. Home removal, worktree
  retention/removal and recovery are separate facts.
- Remove never deletes a branch and asks for no deletion, so a receipt that
  reports a branch deletion or a skip (`branchDeleted: true`, or
  `retention.branchDeleted` or `retention.branchDeletionSkipped` present with
  any value) is not the answer to its request. It is refused whole, at the
  server and again in the dialog, and reported as an **unknown outcome** with
  Desktop's two fixed sentences (`E_OUTCOME_UNKNOWN`, then `E_CLI_PROTOCOL` as
  the cause): no field of that receipt is forwarded or shown. `branchDeleted`
  `false` or absent is accepted, and so is a plan whose `defaults.deleteBranch`
  is `false` or absent; any other value there is an invalid plan. No Desktop
  Git preflight is used.
- A home left by a failed spawn that still owes its branch stays incomplete
  (`E_RETIRE_INCOMPLETE`: "Retirement cleanup is incomplete. Inspect the
  retained state before another action.") while that branch exists, and Remove
  can no longer complete it: the person checks the branch and deletes it with
  Git, then removes the home again.
- `E_PLAN_STALE` displays the validated producer's fresh plan and a new reference;
  the operator must explicitly confirm again. It never auto-applies.
- Preservation/cleanup failure may follow earlier effects. Render retained/partial
  or unknown state honestly; never automatically add discard/force flags.
- An inspection refusal of Remove (`E_WORK_INSPECTION_FAILED`) is reported as
  an **unknown outcome** with its own fixed sentence, never as a refusal before
  any effect: the kernel can raise it after the children stop, the session
  stop and the retire hooks. The kernel's own message (it names the path and
  the remedy) is in Details, for a local refusal and a remote one alike.
- Unknown errors, malformed receipts and timeouts are closed local messages.
  An error envelope's `message` renders only through the display filter
  (`renderer/display-text.mjs`; see
  [desktop-deployment-model.md](desktop-deployment-model.md#remote-rows)), in
  the dialog's Details as `CODE: message`, under Desktop's fixed sentence for
  the code. The headline is never the CLI's text. A local failure carries the
  message only when both hold:
  - the installed CLI answered with an error envelope. A failure Desktop's own
    adapter or boundary raises (`E_CLI_TIMEOUT`, `E_CLI_OUTPUT_LIMIT`,
    `E_CLI_PROTOCOL`, `E_CLI_FAILED`, `E_OUTCOME_UNKNOWN`, the plan and
    admission codes of the boundary) never carries one, whatever came with it;
  - the code has its own sentence (`lifecycleDetailCode`). A code without one
    reads as `E_CLI_FAILED`, with no CLI text.

  The server builds the detail (`failureReason`) and the dialog re-validates it
  (a display line, the same code rule) before showing it: it is set as text,
  never parsed, linked or acted on. Raw stderr, exception stacks and every
  other field of an error still never render.

The kernel's Stop replay horizon is per key while its home exists. Retire
receipts live beside the instances directory and survive home removal. Desktop
cannot make those horizons stronger. Plan reads mutate no instance/session or
worktree; the kernel may append its documented `retire-planned` audit event.

## UI and ownership

The420px confirmation surface follows the supplied layout, semantic theme
colors and keyboard focus language. Stop/Remove are separate from existing
Start/Restart/Inspect. Stop always requires explicit confirmation. The Remove
PR row is only an informational2b overlay: exact home/server/workspace, revision,
branch and remote host/path must correlate. Disconnected/unmatched facts remain
unknown; Remove never closes or changes the remote PR.

Modal lifetime, workspace generation, target and request/operation tickets guard
success, rejection and cleanup. Old controls cannot close or confirm a new
modal. Connection generation separately invalidates only the informational PR
row. Workspace changes dispose the dialog; late receipts cannot close another
tab or steal its focus. Agent tmux/viewer/key/PTY paths remain untouched.

Tests use inert CLI/HTTP/IPC/dialog/DOM fixtures, caps/retry/expiry and adversarial
completion order, plus computed three-theme contrast. No native lifecycle action
or rendered/Electron acceptance is implied; final native acceptance is owned by
the operator/CI.
