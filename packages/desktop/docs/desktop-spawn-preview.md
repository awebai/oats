# Spawn: API 2 observations and confirmed apply

All lifecycle effects go through a compatible installed OATS CLI. Desktop never
resolves placement/model defaults, computes a decision revision, imports the
kernel to mutate, or treats preview paths as filesystem/terminal authority.

## Independent capability fences

- **READ:** integer `spawnPreviewApi===2` AND `spawn-preview-2`.
- **Confirmed apply/retry:** integer `spawnPreviewApi===2`, integer
  `spawnApplyApi===1`, AND all of `spawn-preview-2`, `spawn-apply-2`,
  **`spawn-idempotency-2`**. The older `spawn-idempotency` name is insufficient:
  its replay could fail at the branch-existence check and lacked completion custody.

The full apply fence is checked at admission/confirmation and at the actual
process owner. Existing optional advertisements remain required too: harness and
backend lists, yolo launch option, launch-config and schedule (for wake input).
A version string or optimistic flag probe never enables a mode.
API 1 preview is never invoked: older parsers can ignore unknown flags and spawn.
Missing compatible CLI means observation-only. Every **local** spawn goes through
the confirmed transaction; an ordinary local `/api/spawn` body is refused
(`E_PLAN_REQUIRED`) whatever the CLI advertises. The ordinary body is accepted
only for an execution server (`serverId`), where the host decides defaults and
naming; decision fields (key, ref, revision) cannot enter it
(`E_UNSUPPORTED_OPTION`). There is no remote-to-local fallback.
`--name` (feature `spawn-name`) and a messaging identity (feature
`spawn-provider-payload`) are admitted only when advertised.

## Selector and choices

A selector is `{soul,agentsRoot}`, matched to one soul of the deployment's spawn
catalog (`oats souls --json`); a catalog that could not be read, or a name it
reports twice, refuses rather than falling back to the roster.
Choices include purpose **or** name (exclusive; the kernel owns naming rules and
refuses with `E_INSTANCE_NAME_INVALID`/`E_INSTANCE_NAME_TAKEN`), work
(`worktree` for a checkout soul), worktree-only branch/base, advertised
harness/backend, launchConfig, yolo, model, relation and identity.
`identity` is `{provider, mode:"local"}` or `{provider, mode:"global", resident}`
(decision 27): `provider` is the soul's messaging capability as the preview
reported it (the one module on layer `messaging`), and the argv is
`--provider <cap> identity.mode=<mode>` [`--provider <cap> identity.resident=<r>`]
— there is no kernel flag. The kernel refuses a capability the soul does not
resolve (`E_CAPABILITY_MISSING`); the provider validates the resident. Models are
`{kind:"inherit"}`, `{kind:"native-default"}` or `{kind:"custom",value}`; the native
sentinel is reserved, not a custom model. Custom model text is advisory, not
restricted to a catalog. Relations are `{kind:"unrelated"}` or
`{kind:"child"|"sibling"|"parent",anchor:{instance,agent,agentsRoot,server:null}}`.
Shared admission checks anchor identity/incarnation and uniqueness of the public
CLI's name/root pair. No inferred ancestry or cross-host substitution.

No arbitrary repo/cwd/home/workDir/env/file authority comes from the renderer.
Remote/captured/attached transactions are unavailable, not translated to classic
local operations. Git and the kernel own ref validity and default naming.

## Read-only HTTP / process boundary

`POST /api/workspace-spawn-preview?ws=<workspace>` accepts exactly
`{action:"preview",selector,choices}`, at most **16 KiB**. Opening instruction and
wake configuration are absent. Missing/duplicate/extra workspace query selectors
refuse. CLI argv is fixed `execFile`, `shell:false`:

```text
spawn <admitted-soul> --dir <admitted-context> --agents-root <admitted-root> --preview
  [validated choices] --json
```

No task/file, expected-decision/key, no-launch workaround or fallback. Two reads
process-wide (a third refuses `E_BUSY`); exact invoker/CLI/workspace/subject/anchor/choice
duplicates coalesce before await. No unbounded queue. **30s / 4MiB CLI,
35s proxy**, clean exit and JSON-v1 envelope. Admission revalidation applies to
success and rejection.

**The reuse window.** This route and `/api/spawn` prepare (below) answer from one
bounded settled-answer cache (`spawnPreviewCache`, `server/spawn-preview.mjs`):
64 entries, **60 s**, keyed by the admission identity (workspace id and scope,
subject, soul work/repo/capability, anchor incarnation, choices and every CLI
field the admission reads). It holds `available` answers and the name refusals
`E_INSTANCE_NAME_TAKEN`/`E_INSTANCE_NAME_INVALID`, nothing else. A held answer is
returned only after the request is admitted against the current context, like a
fresh one, and costs no flight slot. Returning to choices the kernel answered
within the window (a toggle back, a retyped name, the dialog reopened for the
same soul) settles without a CLI call.

Invalidation drops a workspace's entries when Desktop performs a change that
can alter a preview: every `/api/spawn` apply (when it starts, before the kernel
runs, and again when it settles), a local lifecycle apply, a
workspace sync and instance start/restart (all through `observeMutation`), a
teams or soul-teams write, a launch-configuration `set`/`remove`, and a
capability run. A CLI re-probe that changes the CLI clears it all (its fields
are in the key anyway). The backend's workspace set is fixed per process: adding
a workspace replaces the backend, and its cache with it. A flight that started
before an invalidation never fills the cache, even when a later request joined
it (a monotonic clock stamps flight starts and invalidations). What Desktop does
not observe (a spawn by another window's backend or by the CLI, an on-disk edit)
may show an older answer for up to 60 s. That is safe: the apply passes the
decision's revision as `--expect-decision`, and the kernel refuses a decision
that no longer holds (`E_DECISION_STALE`) before it creates anything.

**Prepare reuses the dialog's answer** (Spec C). `/api/spawn` prepare reads
through `spawnPreviewPrepareRequest`, the same cache: when the dialog already
holds a fresh settled answer for exactly this admission identity (not
invalidated, younger than 60 s), prepare binds it without a CLI call (well under
50 ms); otherwise it reads fresh as before, and may coalesce onto an identical
read in the air. `--expect-decision` at apply is the drift guard that makes this
safe; the apply-start invalidation keeps a spawn's own decision from being
reused by the next one.

**Member-head reuse (`--max-age`).** When the admitted CLI advertises the feature
`spawn-preview-max-age`, the dialog's reads pass `--max-age 60`, letting the
kernel answer from member heads it observed within 60 s (its reply may carry an
`observation {observedAt, reused, localRevision}` block, which the projection
drops and never shows). Prepare's own uncached read and the apply never pass it,
and a reusing read never coalesces with a live one (their flights are keyed
apart). Without the feature, no read passes it.

Response: `{spawnPreviewViewApi:1,status,target,data,reason}`. Success requires
API2, `preview:true`, byte-exact `subject{soul,agentsRoot,dir}` and consistent
`decision{instance,home,branch,base,revision}`. Revision is opaque24-hex producer data.
K6d additionally reports `decision.effective {repo,work,harness,model,launchConfig,
yolo,backend,childSpawns,relation}` (a released kernel without feature `harness`
reports `runtime`; the Desktop reads either and sends `--harness` or `--runtime`
by the feature: renderer/harness-names.mjs). Child policy is boolean; relation is null or
`{kind,anchor{instance,agentsRoot}}`; model/config/yolo can be null. Old API2 READ
without effective remains an observation, never a synthesized executable plan.

Projection preserves bounded work/harness/model provenance, the `resolution`
binding (top-level facts cross-checked against `decision.effective`),
`messaging{provider, identity{mode,resident}|null, origin{kind,at}|null}` —
the identity `decision.effective.providers[<cap>]` binds, which must equal the
preview's `settings[<cap>]`, and where its mode came from
(`settingsOrigins[<cap>]['/identity/mode']`: `manifest-default` | `workspace` |
`soul` | `host` | `spawn`, or a newer kind shown as sent).
The dialog's identity **Default** option shows a mode only when the kernel
reported it: with feature `settings-origins`, `Default · <mode>` for a
manifest default and `Default · <mode> — from <origin>` otherwise (the hint
names `at`); without the feature, or with no identity in the payload, plain
`Default` (a bound global resident is shown from the identity itself). The
Desktop never supplies a mode the kernel did not report —
`backendStatus{name,installed,started:false}` and
`preflight{status:complete|timeout,budgetMs,elapsedMs}`. Installation is not daemon
reachability. Omitted yolo remains unknown.

`modules[{name, layer|null, from{kind, package?, version?, repoKey?}, composedFrom?}]` (kernel
`modules[]`, feature `instance-modules`) is the composition this spawn will
record, for the dialog's Core capabilities and Capabilities list: the same
composition `/api/capabilities` exposes, scoped to this spawn. Each string has a
fixed grammar (the capability-name grammar for `name` and `package`; bounded
`layer`, `kind`, `version` and `repoKey`); a row's `commit`, `integrity`,
`declares`, `private` and `changedSince` are not projected. More than 256 rows,
a duplicate name or a malformed row refuses the preview (`E_CLI_PROTOCOL`), and
the renderer re-validates the projection with its keys exact. A kernel without
`modules[]` projects `null`.

**Why each module is there.** `composedFrom` is the kernel's reason (feature
`preview-composed-from`, OATS 0.30.2; the same value `oats inspect --soul`
reports): `"soul"` (the soul declares it) or `"workspace"` (a `defaults.<slot>`
or `defaults.capabilities` entry). The server reads it only when the admitted CLI
advertises the feature (`previewComposedFrom(cli)`, the same `cli.features` check
as `desktop-facts`, passed to `previewData` as `{composedFrom}`); without the
feature no row carries it, whatever the kernel sent. It is kept only when it is
exactly `"soul"` or `"workspace"`: any other value, or none, is dropped and the row
still projects. It is optional in the projection's exact key list, so the proxy
and the renderer re-validate it the same way. It is provenance only and never
enters the decision the apply binds.

The dialog's Core capabilities and Capabilities are two bordered boxes of one
row grammar, the same at every column width: line 1 is the module in mono, which
may wrap anywhere; line 2 is its source chip and a reason tag, left-aligned and
wrapping as a group. Both chips use the same muted tag pair (`--muted` on
`--tag-bg`, one CSS rule), and the reason tag reads **Soul** or
**Workspace default**. Nothing in a row is right-justified. A core row leads with its slot (Knowledge, Messaging,
Tasks) as a fixed left column beside those two lines, so its reason never repeats it; an empty slot reads **None**, with no
chips (the preview does not project `capabilitiesOff`, so it cannot say whether
the soul emptied it). A module filling a core slot (`layer` knowledge,
messaging or tasks) is Core's only: never in the Capabilities list or its
count. The tag is plain text in the row, part of its accessible text. No
`composedFrom`, no tag: the Desktop never guesses a reason from the soul.
`test/fixtures/composed-from` is the real kernel's preview for a soul with both
origins (`capture-composed-from.mjs`).

`capabilities[]`, skills, settings, providers, task, environment, executable
recipes and unknown trees are not exposed. Missing/mismatched data is not empty success.

## Confirmed HTTP transaction

`POST /api/spawn?ws=<workspace>` has three strict action shapes:

1. **prepare:** `{action:"prepare",selector,choices,task?,wake?}`. Capture an
   immutable private draft; perform the read-only preview without task/wake/file
   flags. Only a complete strong preview and observed installed backend can mint
   an opaque server-owned `spawnRef`. Each requester gets a separate ref even if
   the underlying observation coalesces. Prepare neither creates files nor spawns.
2. **apply:** `{action:"apply",spawnRef}` only. No caller key, revision, target or
   changed payload. Re-admit context/CLI/soul/anchor, synchronously reserve the one
   backend-wide apply slot, and mint a separate64-hex key on **first confirmation**.
   Every allowed retry retains this exact original intent/key/revision.
3. **result:** `{action:"result",spawnRef}` only. Reads retained state, never
   invokes a CLI, re-previews, mints a key or guesses success from names.

Request limit **64KiB**; selector/choices16KiB, task32KiB UTF-8, wake message8KiB
with bounded cron/timezone. At most32 prepared refs/5min,32 submitted records/30min
and8MiB retained payload including outcome reservations. No unbounded queue or
active-entry eviction. Pending duplicates report pending without another command;
known complete/partial/incomplete/refused/stale results are retained. A prepared
ref is neither a kernel reservation nor a lease over future configuration.

The new view is `{spawnApplyViewApi:1,status,target,spawnRef,preview,receipt,reason}`
with a task-free `wakeRequested` indicator on prepared/pending/completed views.
The normalized `/api/spawn` classifier covers aliases and ordinary requests too.
Trusted mainFrame/navigation plus copied server/connection epoch guards precede
and follow both awaited outcomes. Origin/workspace pinning remains in `apiUrl`;
duplicate selectors are preserved for refusal, not silently normalized away.
Domain errors resolve with stable safe codes.

## Apply transport and qualified results

```text
spawn <admitted-soul> --dir <admitted-context> --agents-root <admitted-root>
  [original validated choices] --expect-decision <stored-revision>
  --idempotency-key <stored-key> --task-file <owned-temp>
  [--wake-file <owned-temp>] --json
```

Private files are created0600 inside private directories; short writes refuse
before CLI dispatch rather than launch with truncated instructions. Cleanup is
attempted on all construction/settlement/error paths. Retries use new owned paths with the
same bytes, not expired temp paths. `PI_AGENTS_ROOT`, `OATS_DEPLOYMENT`,
`OATS_RESOLUTION` and test-only `OATS_PREVIEW_PREFLIGHT_BUDGET_MS` are stripped.
No shell, renderer recipe/env, direct kernel fallback, automatic acquire/trust,
`--no-launch`, or task text in argv/logs/replies. **60s / 4MiB CLI,65s proxy**;
result lookup has a short10s proxy deadline, prepare35s.

The private adapter's `{started,envelope}` records possible dispatch, not creation
or rollback. The broker must qualify success: full returned decision equals the
confirmed decision (including effective), exact soul/name/home/work/repo/branch
and model/harness facts, and typed launched/replayed fields. Raw recipes, attach
commands, task content and warning text are dropped; only warning count crosses
(the preview shows the warnings before the press: see the preview column, Warnings).
Malformed/mismatched receipts, transport loss and ambiguous post-dispatch failures
are **unknown**, not permission for a fresh spawn/key. A timeout does not prove
rollback or stop an already launched agent.

- `E_DECISION_STALE`, `E_IDEMPOTENCY_CONFLICT`, `E_PLACEMENT_TAKEN`,
  `E_INSTANCE_NAME_TAKEN` (an explicit `--name` taken since the preview): consume the
  attempt; any fresh decision/home is advisory. Full new review and explicit new
  confirmation are required. Never auto-suffix, change original refs or auto-apply.
- `E_SPAWN_INCOMPLETE`: a keyed home is recorded but launch/lineage completion is
  unconfirmed. No completed receipt, automatic terminal handoff or second spawn.
  Inspect its existing session through ordinary admitted surfaces.
- Wake result: `wake{requested,saved,error}`, with nullable booleans. Known failure
  means **created, wake not saved**, never retry-spawn. `saved:null` means
  **“Agent created; wake outcome unavailable — check Schedules”**. No inference
  from absence, and no raw provider error message. An explicit first-response
  `wakeScheduleError` can still establish a save failure if home recording failed.

## Recovery limits and modal ownership

The dialog previews in the background, so the operator reviews the kernel's own
values before pressing **Spawn** (or Mod+Enter) once.

**Editing never waits on the kernel.** Each change schedules a read (250 ms
debounce for typing, at once for a choice). A newer schedule starts its own read
without waiting for one in the air; only the latest ticket may settle, and a
superseded answer, success or failure, is discarded (every completion is
ownership-checked: dialog alive, same workspace mount, latest ticket). An
`E_BUSY` refusal (both server slots held, usually by this dialog's superseded
reads) is retried inside the dialog as soon as one of its reads lands, else
after 400 ms, for about the CLI's timeout, and is never shown while it retries.

### What will be created

The column reads top to bottom:

1. **The instance.** Its name comes first and largest (mono, `--fg`). Under it
   is its home (mono, `--muted`), relative to the deployment (the preview's
   `subject.dir`) when the home lies inside it, else `…/` plus its last three
   segments. The full path is the home's `title`.
2. **The facts**, a label/value list in this order:
   - **Works in.** A worktree reads "worktree · branch `<branch>` from
     `<base ref>`"; every other mode keeps its phrase.
   - **Harness.** The badge, the harness and the model (or "default model").
     Where that choice came from sits on its own muted line beneath.
   - **Team.** "`<default>` · default", then a muted "may also join …" line
     naming the other teams in `teams`.
   - **Relationship.** Shown only when the spawn is not independent: "child of
     `<anchor>`".
   - **Runs on.** Shown with two or more deployments; in the loading and refusal
     states it shows alone.

   Labels are 11.5px `--muted` and values 12.5px `--fg`. The preview is a size
   container: below 300px of content width the facts stack label-above-value.
3. **Launch prompts**, when the preview reports them: a full-width muted note
   after the facts, holding the policy sentence and its consent source verbatim
   (see Launch-prompt diagnostics).
4. **Warnings**, when the preview's `warnings` (OATS 0.49.0: strings, one per
   capability warning such as `hook-event-unsupported`, each at most 32 lines)
   holds any: a list after the launch prompts, each warning marked by the word
   "Warning" and an icon, then each of its lines as text, filtered by
   `displayLine`. No Details and no Open capability: a preview warning is only
   its message. A warning never blocks the spawn or changes the footer. At most
   32 show, then "and N more". An older kernel sends none, and nothing shows.

The footer keeps **Cancel** and **Spawn** together, right-aligned on one line, at
every width. The status beside them yields first: its text wraps, or the status
sits on its own line above them.

No field is disabled, hidden or rebuilt because a read is in the air; focus and
caret stay. Before the first settled answer the preview column shows the loading
shape and the footer says **Reading defaults…**. Afterwards the column keeps the
last settled facts, Core capabilities and Capabilities in place, marked
**Updating…** beside the "What will be created" title with `aria-busy="true"` on
the column (words in `--muted`, never faded text), until the answer for the
choices on screen lands; the footer stays quiet. The **Name** fact follows the
form at once: the kernel's name from a settled answer for the same name input,
else the name the form spells (the kernel may still number a taken one), else
"numbered by the kernel". Rows derived from the preview (teams, messaging
identity, defaults in Developer settings) read the last settled answer; the
harness and model defaults read it only while the harness, model and launch
configuration on screen are the ones it answered (desktop/loading-states item 9),
and the work text only for the same work, branch and base. A refusal for the
choices on screen replaces the facts, as does any failure, and stays (marked
Updating…, the footer unchanged) while a poll retries it. An invalid form reads
nothing, so nothing is marked: the settled facts stay without the marker (before
the first answer, the column says the preview reads once the form is valid).

**A press before the preview settled is kept as intent.** Spawn is pressable
whenever the form is valid, except on a settled refusal for exactly these
choices or a settled answer that does not bind the ticked teams. Pressed before
the answer for the choices on screen settled, the button reads **Checking…**
(busy) and nothing is sent. When that answer lands, the ordinary prepare/apply
flow continues with it as the reference for the drift check; if it failed, the
failure shows and nothing spawns; if it did not bind the ticked teams, nothing
spawns. Any edit while the press waits, or **Change soul**, drops it
(**Changed: press Spawn again**): the intent belonged to the choices at press
time. So does a read that cannot answer them (the form turned invalid under it,
or the CLI can no longer preview): the press ends there and never spawns later
without a new press. Sending prepare at
once was rejected: it duplicates the read in the air and turns a value the
operator just typed into a "values changed" drift. Spawn prepares, and the
server applies only if the prepared decision equals the one on screen; if the
kernel now decides differently, nothing is applied and the new values are shown
for another explicit Spawn. An unseen decision never continues into mutation. Any relevant draft,
selection, CLI/workspace or mount change revokes pending read/confirmation authority.
Older completion cannot clear a new task, re-enable a successor operation, steal
focus or navigate another workspace. Roster changes alone are not new user drafts.

The roster poll re-reads the preview (a read, never an apply) only when a fact it
depends on changed (the CLI's identity and features, the workspace, the relation
anchor's roster rows) or when the settled answer is a failure other than a name
refusal; a read in flight or a settled preview otherwise stands. That key does not
watch the rest of the roster or on-disk soul and team edits: this is safe, because
the decision check refuses at **Spawn** if they changed what the kernel decides.

**Check result** (on the pending roster row, below; in the dialog on the view
harness) reads the retained record. Only a prior settled **unknown** may
then invoke apply with the same ref/key as part of that explicit recovery click.
Pending and known outcomes never re-invoke. There is no timer-driven retry.

No Desktop instruction/key journal. Restart/expiry can lose the RAM ref mapping;
a lost submitted ref is unavailable/unknown and mints nothing. Kernel key custody
lasts only while its home survives. If that home is removed, same-key invocation
can follow the normal creation path: it is **not** a replay-only/read-only lookup.
Known retirement/disappearance is a roster question; prior positive keyed-home
observations can block retry after disappearance, but no roster read closes a
concurrent retire race. No lifetime exactly-once/no-resurrection promise.

A qualified completed receipt still needs the current **exact** composite roster
home/root/agent and running-session match before the new instance is reported
(the operator is taken to it, or its row says **New**; see Background spawn). Not-launched, partial, incomplete, unknown, stale or mismatched results
never offer a guessed terminal.
Existing anchored targets, linked-window viewers, locked keys and detach-only
closure remain unchanged. A changed submitted draft can check its original result
but cannot turn that old completion into authority over the new draft.

## Background spawn: the dialog closes on Spawn

Spec C. In the shell, a confirmed local press does not wait for the transaction:
the dialog hands it to the spawn-jobs store (`renderer/spawn-jobs.mjs`, created by
`shell.mjs` as `ctx.spawnJobs`) and closes in the same task as the press, focus
returning where the dialog was opened from. A press still waiting for its preview
(**Checking…**) closes when that preview settles. The dialog stays open only when
the press cannot proceed: an invalid form, a settled refusal, or an answer that
does not bind the ticked teams. Remote (server) spawns, and a host without a store
(the view harness), keep the in-dialog transaction.

**After the press** (Spec E): once the dialog has closed and returned focus, the
shell reveals the pending row (its ancestors expanded, scrolled into view in the
roster, and highlighted with the selection's fill) without taking focus or
cancelling anything pending. An operator's roster filter that hides it stays;
**Show its row** is the explicit request that clears it.

The handoff carries the press token, the prepare input, the decision on screen,
the relation and the draft (name, every choice, teams, opening instruction,
wake). The store is single-flight per press token, so one press never starts two
spawns, and per soul (Spec D, #383): while a spawn of a soul is in flight in this
window (**Spawning…** or **Checking result…**), the store refuses another of the same
workspace and soul, and the dialog opened for that soul from any entry point keeps
Spawn disabled under a polite line, "A spawn of <soul> is in progress.", with **Show
its row** (focuses the pending row). It re-enables when the job settles: created,
refused, or unknown (an unknown outcome does not block, or a record lost to a backend
restart would block the soul for the life of the window). Another soul is never
blocked; a new spawn of the same soul afterwards is its own job with a fresh preview. The store then runs the same transaction: prepare (usually a cache hit),
the same decision check against what the operator saw, apply, and `result` for
recovery. Every completion checks that the store is alive and the job is still
its own.

**The pending row.** The job's workspace roster shows a row at once, under its
parent when there is a relation (the placement the kernel will record:
`pendingPlacement`), with the kernel's name from the decision. It reads
**Spawning…** beside a small spinner (the text carries the state; the spinner
stands still under reduced motion), is `aria-disabled` with no instance actions
and no hover card, and is announced once through the roster's polite live
region. It carries the real row's identity (`data-tree-instance` is the decided
home), so when the roster reports that home the real row replaces it in place
and a focused pending row stays focused. The head's count stays the kernel's
observation; pending rows are not counted. While a created instance is awaited
the shell reads the roster every 700 ms (the dialog's former pace) instead of
every 4 s.

**Window reload.** Pending rows are Desktop-local. A submitted job is kept in the
window's `sessionStorage` until its outcome has been reported: while in flight or
unknown, a failure until it is dismissed or reopened, and any other outcome until
its notification is posted (an outcome settled while another workspace is on
screen is held, and settling is not reporting). It is kept as `{workspace,
deployment, spawnRef, soul, selector, instance, home, placement, startedAt}`:
`workspace` is the view that owns the job (its pending row, its notices) and
`deployment` the one it spawns in, which every `/api/spawn` request and checked
reply is addressed to (#482; an entry without it is addressed to its view, as
before). Never the opening
instruction, and never the idempotency key, which the renderer does not hold (the
server keeps a `spawnRef` 30 minutes after it settles, bound to the workspace scope,
not to a frame). After a reload the store brings each one back as a pending row and
reads the existing `result` action (every 2 s while the server says pending, for up
to the 65 s apply deadline, then **Outcome unknown**); the outcome is reported like
any other, held for its workspace like any other, and the entry dropped once
reported. A recovered failure's **Reopen spawn** restores the
soul and the exact name only. If the backend itself restarted, its records are gone:
the job reads **Outcome unknown** with Check result, never a guess. Closing the window
or quitting Desktop (a new session) loses the entries; a created instance still
appears through the roster as usual, but a failure is then not reported. A refusal
before apply (no `spawnRef` yet) and a record past the server's 30 minutes (read
as **Outcome unknown**) are the other limits.

**Outcomes.** Creation, roster presence and a live session are separate
observations. Success posts no notification; everything that needs the
operator's attention still does:

| Outcome | What the operator gets |
|---|---|
| `complete` | The row stays **Spawning…** until the roster reports the instance running with a session. Then the operator is **taken to it**: its terminal tab opens and its roster row is the selected one, as clicking the row does. No toast: arriving is the confirmation. When a guard holds (below), they stay where they are and the real row, which replaced the pending one in place, says **New** (text and a dot, never colour alone; AA) until that row is opened or its tab becomes the active one. Either way the roster's polite live region says "<name> spawned" once. Not seen running within 14 s: "Created <name> — not yet visible as a running session. Open it from the roster when it appears." |
| `partial` | The kernel's words (the wake was not saved, or its outcome is unknown) with **View schedules**. A launched one is then followed like `complete` (taken to it when no guard holds; no **New**, no second notice). |
| `incomplete` | "<name> was created but didn't finish starting. Open it from the instance list instead of spawning again." |
| Created, not launched | "Created <name> — not launched. Open its session from the roster." |
| Refused or failed (nothing was created) | The row goes, and a sticky notification gives the reason (the `spawnProblem` text, Details behind a disclosure) with **Reopen spawn** ("Reopen spawn for <name>"), which reopens the dialog for that soul with the whole draft restored. Only `E_DECISION_STALE`, or a prepared decision that differs from the one the operator saw, reads "These values changed since you last looked. Reopen spawn to check them."; `E_IDEMPOTENCY_CONFLICT`, `E_PLACEMENT_TAKEN`, `E_INSTANCE_NAME_TAKEN` and every other refusal keep their own words. |
| `unknown` / `pending` | The row stays, reading **Outcome unknown**, with a visible **Check result** button ("Check result for <name>") that runs the recovery above. The notification says it once. The row never silently disappears. |

**Never a yank** (`renderer/spawn-follow.mjs`). Taking the operator to the new
instance must never take them from something they are doing, and they are doing
something only if they **acted since the press**. Where focus merely rests does
not count: the dialog's close returns focus to where it was opened from, often a
terminal (⌘N while working in an agent's terminal), and an operator who has not
touched anything since is taken to the new instance from there. They stay where
they are when, at the moment it runs:

- a modal or an overlay is open: a dialog, the palette, Quick Open, a
  lifecycle confirmation, the shortcuts editor, an open popover menu;
- they produced input since the press: a keydown other than a lone modifier
  (Shift, Control, Alt, Meta, Caps Lock…), `input`, `paste` or
  `compositionstart`, anywhere in the window. The shell watches them at the
  document in the capture phase (`watchOperator`), so a terminal that consumes
  its keys still counts them, as an input generation recorded at the press and
  compared later. Only operator-generated (trusted) events count; terminal
  output is not input;
- they moved focus since the press: it is no longer where the dialog returned
  it, after a pointer press of theirs (Tab is already input). Focus the app moves
  itself (the dialog's return landing after a stage switch, a terminal's
  readiness) is not theirs;
- they navigated since the press: opened or activated another tab or view, used
  the sidebar, switched workspace, or the connection changed. The press takes a
  selection-ownership ticket (`watch()`: unlike `begin()` it cancels nothing
  pending) and the connection generation, after the dialog's own focus return,
  and every explicit action supersedes the ticket.

The open itself is asynchronous (the roster read, the terminal's key and
readiness), so the same holds all through it: every step of the open, and the
terminal's readiness focus, goes on only while the operator still has not acted,
on the same connection and workspace. Any input during the open stops it,
nothing is selected and the row says **New**; so does any open that never
selects that terminal (refused, superseded or failed). Its tab is selected as
soon as it is made, before the terminal attaches: an operator who moves on while
it attaches was already taken there, so the row is not **New** (and readiness
takes no focus).

Only a spawn pressed in this window is followed; one recovered after a reload is
only marked **New**. Remote (server) spawns keep their own flow.

**Where outcomes appear.** An outcome belongs to its workspace: while another
workspace is on screen it is held, and posted on return. Failure notifications
are exempt from the notification cap and come back after a scope clear; more
than three collapse into one "N spawns failed" entry that expands. The draft is
kept until the spawn completes, Reopen takes it back into the dialog, or the
operator dismisses its failure (the × of that notification).

A CLI without the confirmed-apply fence can still preview but never spawn
locally; submitted uncertainty does not fall back. Launch readiness is not shown
in the dialog; soul readiness remains the soul inspector's (F3b).

Knowledge attachment, ADE auto-PR, branch enumeration, K5 signature verification
and K11 enrolment remain separate open contracts, not parity-complete. Qualification
uses inert CLI/HTTP/IPC/DOM fixtures and computed three-theme AA, not native GUI,
model/auth/lifecycle acceptance. Full root gates belong to PR CI; no operator
spawn/preview/signature fetch, install or restart is part of local testing.

### Launch-prompt diagnostics

An optional preview `launchPromptAnswers` reports the exact home's
`awebDevelopmentChannel` boolean and `consentSource` (string or null). The dialog
shows the development-channel confirmation or none, with available provenance.
Enabled policy also explains that a harness update can block launch until its
qualified prompt fixtures are refreshed, with no fallback key.
An older CLI omitting the field makes no policy claim. This is read-only policy,
not observed input or readiness; workspace-trust prompt answering is not included.

`E_SPAWN_INCOMPLETE` can carry additive `launchPrompts` diagnostics. The CLI,
broker and renderer preserve its retained home and incomplete outcome even if
these optional diagnostics are malformed. A bounded projection keeps blocked or
incomplete status, submitted answer facts, and audit-write outcomes/paths; raw
event rows and OS failure text do not cross this projection. Activity owns event
rendering. Target fields are inspection data only, never terminal input authority.
Unknown reason strings receive a generic inspection message.

Both the dialog and background spawn notice show the reason and direct the
operator to inspect the existing pane, then use `oats session start --home` for
that home. No new spawn or key retry is offered. A submitted answer does not
confirm readiness; empty answers after audit failure do not prove no input was
sent. Result reads and repeated apply requests keep the same retained result.
