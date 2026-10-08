# Desktop Stop and Retire confirmations

Stop and Retire are consumers of the installed CLI's **lifecycleApi1**. The
Desktop does not implement stopping, ancestry, retention, Git deletion, recovery
or lifecycle policy. It never signals a reported PID or creates a Stop+Retire
recipe. The kernel owns those actions and their per-target outcomes.

## Compatibility and admission

Before any command, require an accepted installed CLI, a real `features` array
containing `lifecycle-plans`, and **`lifecycleApi === 1`**. Retire apply also
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
Ambiguous parent edges are shown as **not included**, with the reason (another
instance has the same parent name): Stop uses `plan.ambiguous`, Retire uses
`plan.facts.ambiguous`.

## Confirmation references, resource bounds and retry

Four distinct plan flights may run concurrently; equal reads coalesce. Each
confirmation gets a **different opaque planRef after that shared read**. A plan
reference binds exact workspace/scope/target, CLI contract, operation, options
and producer revision. At most32 pending references live for5 minutes. Plans
have a128-target total display limit and1 MiB output ceiling; an oversized plan
is refused, never truncated into a smaller executable action. Plan execution
is bounded to30 seconds; proxy35 seconds.

Changing any option obtains a new plan/reference and revokes the old controls.
Retire has one choice, the worktree: deleting it requires an owned worktree.
Retire no longer offers to delete a branch: retirement leaves branches to the
operator, and the kernel refuses the flag. A retire request whose options
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
`replayed` fact. Replay of a recorded Retire result never resolves a newly
created same-name home. Lost server/reference/CLI identity requires a fresh
observation, not a silently minted retry key.

**Transport loss after dispatch means unknown outcome, not no effect.** Check
again resubmits the same planRef. An uncertain CLI result stays
uncertain rather than re-executing a mutation. Closing the dialog only closes
status; it does not cancel the dispatched operation or signal its process.

## Effects are reported individually

- Stop processes the kernel's ordered targets. Nested `ok:false` remains partial
  even inside a successful envelope. Reported still-running PIDs are text only;
  no stronger-kill control. Home/work/transcript/launch remain retained.
- Retire stops recorded children first. `E_CHILDREN_RUNNING` displays
  `details.childrenStopped` and refuses retirement; **some children may already
  have stopped**, so “nothing retired” is not “nothing happened”. Read a fresh
  plan before a new confirmation; do not compose another Stop in Desktop.
- Retire accepts both the documented first raw receipt and enveloped replay,
  checking revision/key/name against the transaction. Home removal, worktree
  retention/removal and recovery are separate facts.
- Retire never deletes a branch and asks for no deletion, so a receipt,
  deferred or not, that reports a branch deletion or a skip (`branchDeleted: true`, or
  `retention.branchDeleted` or `retention.branchDeletionSkipped` present with
  any value) is not the answer to its request. It is refused whole, at the
  server and again in the dialog, and reported as an **unknown outcome** with
  Desktop's two fixed sentences (`E_OUTCOME_UNKNOWN`, then `E_CLI_PROTOCOL` as
  the cause): no field of that receipt is forwarded or shown. `branchDeleted`
  `false` or absent is accepted, and so is a plan whose `defaults.deleteBranch`
  is `false` or absent; any other value there is an invalid plan. No Desktop
  Git preflight is used.
- A home left by a failed spawn that still owes its branch stays incomplete
  (`E_RETIRE_INCOMPLETE`: "Retirement didn't finish cleaning up. Check what
  was kept before trying again.") while that branch exists, and Retire
  can no longer complete it: the person checks the branch and deletes it with
  Git, then removes the home again.
- **The one exception** (feature `worktree-event`, OATS 0.49.0): retiring the
  home of a spawn killed while its `worktree` hooks ran can finish that spawn's
  own compensation and delete the branch it created, when the branch still
  points at its creation commit. The kernel reports it only in the additive
  `spawnCompensation` (`{branch, branchDeleted: true}` or `{branch,
  branchDeleted: false, reason}`), never in `branchDeleted`, so the strict rule
  above is unchanged. It is projected tolerantly (`spawnCompensationOf` in
  `renderer/lifecycle-contract.mjs`: anything malformed is ignored, never a
  refused receipt) and shown as one result line: "Branch <branch> deleted: an
  interrupted spawn left it, and it held no work." or "Branch <branch> kept:
  <reason>", branch and reason through `displayLine`.
- `E_LIFECYCLE_BUSY` keeps its sentence, with one exception: a retire the
  kernel refuses as busy for a row with `rollbackIncomplete` says "OATS can't
  confirm that the spawn which left this home has stopped, so it won't retire it
  yet. Check the process it names, then retire it from the CLI with --force.",
  with the kernel's message (it names the process) under it. Desktop offers no
  `--force`. Desktop's own busy (an apply slot or the plan cap) carries no kernel
  message and keeps today's sentence.
- `E_PLAN_STALE` displays the validated producer's fresh plan and a new reference;
  the operator must explicitly confirm again. It never auto-applies.
- Preservation/cleanup failure may follow earlier effects. Render retained/partial
  or unknown state honestly; never automatically add discard/force flags.
- An inspection refusal of Retire (`E_WORK_INSPECTION_FAILED`) is reported as
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

## Quarantined and spawning rows

The roster says what a home is when it is not an ordinary instance, in text
(never colour alone):

- `spawnInProgress` (feature `worktree-event`): a spawn still running its
  `worktree` hooks, verified alive. **Setting up worktree…**, no actions at
  all (no Start, Stop, Retire or split; activating it opens nothing); its hover
  card's status is "Spawning (setting up worktree)". The kernel refuses its
  retire anyway (`E_LIFECYCLE_BUSY`).
- `rollbackIncomplete`: **Spawn didn't finish**, muted "Retire it to clean up".
- `retirePending`: **Retire didn't finish**, muted "Retire it again to
  complete".

The two quarantined states offer **Retire instance…** only: no Start, Stop or
split. The kernel's retire completes both, through the ordinary plan → apply
dialog. A row never shows `spawnInProgress` and `rollbackIncomplete` together;
if both arrive, `rollbackIncomplete` wins.

The retire plan of a `rollbackIncomplete` row says "Branches and pull requests
are not changed, except a branch an interrupted spawn left with no work, which
is deleted.": that retire finishes the spawn's compensation, and the result's
`spawnCompensation` line says whether the branch was deleted or kept. With
**Also delete the worktree** checked, its plan line and warning drop "Branch
… stays in the repository.", so that sentence is the plan's only word on
branches (the kernel deletes the branch only when the worktree is removed).
Every other retire plan keeps "Branches and pull requests are not changed."

## UI and ownership

The 420px confirmation surface follows the supplied layout, semantic theme
colors and keyboard focus language. Stop/Retire are separate from existing
Start/Restart/Inspect; the roster row's menu says **Retire instance…**, the
context panel's footer **Stop…** and **Retire…**. Stop always requires explicit
confirmation. The Retire PR row is only an informational 2b overlay: exact
home/server/workspace, revision, branch and remote host/path must correlate. A
PR that is not known (disconnected, unmatched, failed) is left out, never shown
as "no PR"; Retire never closes or changes the remote PR. While a new plan is
read, the row stays only if the new plan has the same revision, branch and
remote host/path and the connection has not changed; it is then read again, and
a re-read that cannot confirm it drops it. Its link opens the PR on screen, not
the read that drew it, so a kept link stays usable (and keeps focus) until then.

### UI states

One phase decides which controls exist (`lifecycle-dialog.mjs`); a control
with no use in a phase is not rendered, and one that cannot act yet carries
its reason in the visible status line (`aria-describedby`).

| Phase | Title | Body | Footer |
|---|---|---|---|
| loading | Retire X? / Stop X? | "Checking what retiring X will do…" (or "Reading from <server>…"); What will happen and Current state as skeletons, `aria-busy`; the option's place held by one skeleton line | Cancel · confirm (disabled, described by the status line) |
| review | same | What will happen (plain lines built from the plan), Current state, the option, "Observed <age>" with **Check again** | Cancel · **Retire instance** / **Stop session(s)** |
| updating | same | the previous facts stay on screen, `aria-busy`, until the new plan replaces them at once; "Updating for this choice…" or "Checking again…" | Cancel · confirm (disabled, described by the status line) |
| running | Retiring X… / Stopping X… | spinner and status; What will happen kept, muted; "You can close this window; retirement continues." | Close |
| done | X retired / X stopped / N sessions stopped | a short summary from the receipt (paths muted and selectable) | **Done** |
| result | per outcome | the fixed sentence (or a remote host's headline), the effects that did happen, Details | Check again (uncertain) or Review again · Close |

- **Cancel and Close.** Before anything is dispatched the secondary button is
  Cancel: nothing happened. After dispatch it is Close, and closing never
  cancels the operation. Esc does what the visible button does in each phase.
- **Option changes and Check again** revoke the reference on screen at once,
  keep the facts on screen and swap in the new plan when it lands; the latest
  choice wins (older answers are dropped by their ticket). The worktree option
  is shown only for an instance with its own worktree (`workMode: worktree`),
  or while that choice is still checked, so `E_OPTION_UNAVAILABLE` stays
  visible and undoable.
- **Results.** An uncertain outcome (`unknown`, `pending`, a deferred retire,
  transport loss, a refused receipt) offers **Check again**, which resubmits
  the same planRef. Anything else that did not succeed (a refusal, a partial
  receipt, a plan that could not be read) offers **Review again**, which reads
  a fresh plan and returns to loading, with Cancel. `E_PLAN_STALE` returns to
  review with the fresh plan and "Something changed since you opened this.
  Review it and confirm again."; it never applies by itself. A partial outcome
  is never shown as done.
- **Focus.** It starts on Cancel and does not move when a plan lands. Running
  and every result focus Close (never an action that resubmits); done focuses
  Done; stale focuses Cancel. A focused control that leaves (a PR link that is
  dropped, a button the next phase does not have) hands focus to the control
  that stays. On close, focus returns to the opener or a control with its
  identity (`focus-return.mjs` `restoreExact`), else to the roster (the row that
  followed a retired row, else the one before, else the roster's tab stop:
  `shell.mjs` `lifecycleFallbackFocus`, `successorRow`), else to the generic
  return near the opener; never `<body>`.
- **Copy.** Plain words, no timestamps and no kernel vocabulary: the plan's
  `at` is shown as an age, a session as Running / Not running / Unknown.
  Work the kernel did not observe reads "Unknown (couldn't be checked)", its
  reason (a code such as `E_NO_WORKTREE`) only in the row's title; an instance
  without its own worktree has no Uncommitted work row. The
  fixed sentences live in `lifecycle-contract.mjs`.

Modal lifetime, workspace generation, target and request/operation tickets guard
success, rejection and cleanup. Old controls cannot close or confirm a new
modal. Connection generation separately invalidates only the informational PR
row. Workspace changes dispose the dialog; late receipts cannot close another
tab or steal its focus. Agent tmux/viewer/key/PTY paths remain untouched.

Tests use inert CLI/HTTP/IPC/dialog/DOM fixtures, caps/retry/expiry and adversarial
completion order, plus computed three-theme contrast. No native lifecycle action
or rendered/Electron acceptance is implied; final native acceptance is owned by
the operator/CI.
