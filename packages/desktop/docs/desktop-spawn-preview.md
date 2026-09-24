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
process owner. Existing optional advertisements remain required too: runtime and
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
runtime/backend, launchConfig, yolo, model, relation and identity.
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
process-wide; exact invoker/CLI/workspace/subject/anchor/choice duplicates coalesce
before await. No unbounded queue or settled observation cache. **30s / 4MiB CLI,
35s proxy**, clean exit and JSON-v1 envelope. Admission revalidation applies to
success and rejection.

Response: `{spawnPreviewViewApi:1,status,target,data,reason}`. Success requires
API2, `preview:true`, byte-exact `subject{soul,agentsRoot,dir}` and consistent
`decision{instance,home,branch,base,revision}`. Revision is opaque24-hex producer data.
K6d additionally reports `decision.effective {repo,work,runtime,model,launchConfig,
yolo,backend,childSpawns,relation}`. Child policy is boolean; relation is null or
`{kind,anchor{instance,agentsRoot}}`; model/config/yolo can be null. Old API2 READ
without effective remains an observation, never a synthesized executable plan.

Projection preserves bounded work/runtime/model provenance, the `resolution`
binding (top-level facts cross-checked against `decision.effective`),
`messaging{provider, identity{mode,resident}|null}` — the identity
`decision.effective.providers[<cap>]` binds, which must equal the preview's
`settings[<cap>]`; none means the provider's documented default, local —
`backendStatus{name,installed,started:false}` and
`preflight{status:complete|timeout,budgetMs,elapsedMs}`. Installation is not daemon
reachability. Omitted yolo remains unknown. Capabilities, skills, providers, task,
environment, executable recipes and unknown trees are not exposed. Missing/mismatched data is not empty success.

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
and model/runtime facts, and typed launched/replayed fields. Raw recipes, attach
commands, task content and warning text are dropped; only warning count crosses.
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
values before pressing **Spawn** (or Mod+Enter) once. Spawn prepares, and the
server applies only if the prepared decision equals the one on screen; if the
kernel now decides differently, nothing is applied and the new values are shown
for another explicit Spawn. An unseen decision never continues into mutation. Any relevant draft,
selection, CLI/workspace or mount change revokes pending read/confirmation authority.
Older completion cannot clear a new task, re-enable a successor operation, steal
focus or navigate another workspace. Roster changes alone are not new user drafts.

**Check result** reads the retained record. Only a prior settled **unknown** may
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
home/root/agent and running-session match before handoff. Not-launched, partial,
incomplete, unknown, stale or mismatched results never open a guessed terminal.
Existing anchored targets, linked-window viewers, locked keys and detach-only
closure remain unchanged. A changed submitted draft can check its original result
but cannot turn that old completion into authority over the new draft.

A CLI without the confirmed-apply fence can still preview but never spawn
locally; submitted uncertainty does not fall back. Launch readiness is not shown
in the dialog; soul readiness remains the soul inspector's (F3b).

Knowledge attachment, ADE auto-PR, branch enumeration, K5 signature verification
and K11 enrolment remain separate open contracts, not parity-complete. Qualification
uses inert CLI/HTTP/IPC/DOM fixtures and computed three-theme AA, not native GUI,
model/auth/lifecycle acceptance. Full root gates belong to PR CI; no operator
spawn/preview/signature fetch, install or restart is part of local testing.
