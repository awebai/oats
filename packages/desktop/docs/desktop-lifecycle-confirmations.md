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
{"action":"plan","operation":"retire","selector":{"instance":"dev-1","agent":"dev","agentsRoot":"/team/agents","server":null},"options":{"discardWorktree":false,"deleteBranch":false}}
{"action":"apply","planRef":"<opaque server reference>"}
```

The selector matches one exact server-owned roster record. Home and scope come
from that record, never request paths. Unknown/duplicate/replaced targets and
remote workspaces/instances refuse; no local or old remote fallback. CLI, argv,
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
Delete-branch requires an explicitly selected worktree discard, an owned
worktree and a reported branch; unknown/detached work cannot authorize a named
branch deletion. There is no force/self/keep-dir/grace override or “don't ask
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
  --home HOME --dir SCOPE [--discard-worktree] [--delete-branch] --json
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
  retention/removal, recovery and branch deletion are separate facts.
- `retention.branchDeletionSkipped` is reported as a skipped named deletion,
  even if home/worktree retirement completed. Neither a switched branch nor the
  confirmed branch is invented as deleted. No Desktop Git preflight is used.
- `E_PLAN_STALE` displays the validated producer's fresh plan and a new reference;
  the operator must explicitly confirm again. It never auto-applies.
- Preservation/cleanup failure may follow earlier effects. Render retained/partial
  or unknown state honestly; never automatically add discard/force flags.
- Unknown errors, malformed receipts and timeouts are closed local messages.
  Raw stderr, exception stacks and unprojected diagnostic fields never render.

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
unknown; a local branch action never closes or changes the remote PR.

Modal lifetime, workspace generation, target and request/operation tickets guard
success, rejection and cleanup. Old controls cannot close or confirm a new
modal. Connection generation separately invalidates only the informational PR
row. Workspace changes dispose the dialog; late receipts cannot close another
tab or steal its focus. Agent tmux/viewer/key/PTY paths remain untouched.

Tests use inert CLI/HTTP/IPC/dialog/DOM fixtures, caps/retry/expiry and adversarial
completion order, plus computed three-theme contrast. No native lifecycle action
or rendered/Electron acceptance is implied; final native acceptance is owned by
the operator/CI.
