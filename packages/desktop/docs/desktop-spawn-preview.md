# Spawn preview — API 2 read boundary (6b, read-first stage)

This stage adds **observations**, not guarded apply. It accepts only a compatible
installed CLI advertising **`spawn-preview-2` and integer `spawnPreviewApi:2`**.
API 1 is the pre-fix producer marker and is never invoked: an older parser may
ignore `--preview`, and the original preview implementation had pre-return effects.
Neither an OATS version alone nor the old `spawn-preview` feature enables this read.

## HTTP / IPC

`POST /api/workspace-spawn-preview?ws=<advertised workspace>` accepts one JSON
object, at most **16 KiB**, with exactly `action:"preview"`, `selector` and
`choices`. Duplicate/missing/extra workspace query parameters refuse.

The selector is `{soul,agentsRoot}`, admitted as one current local roster soul.
Choices may include purpose, branch/base, runtime/backend, launchConfig, yolo,
allowChildSpawns, a tagged model, and an optional qualified relation anchor.
Unknown fields, task, file flags, arbitrary repo/cwd/home/workDir/env, captured
selectors, remote/server-marked targets and mutation/expected-decision requests
refuse. Attached work needs authority this reader does not accept and is unavailable.

Model modes are `{kind:"inherit"}`, `{kind:"native-default"}` or
`{kind:"custom",value}`. The native sentinel is reserved, not silently interpreted
as a custom model. Custom model text is advisory, not restricted to a catalog.
A relation is `{kind:"unrelated"}` or `{kind:"child"|"sibling"|"parent",
anchor:{instance,agent,agentsRoot,server:null}}`. Shared instance admission checks
the anchor, and its CLI name/root pair must be unique. No inferred ancestry or
cross-host substitution. Branch/base choices are worktree-only; Git/kernel owns
ref validation, not the Desktop.

The normalized classifier introduced by PR73 routes every alias through the same
main-frame/navigation/server-epoch guards. `apiUrl` still owns origin and workspace
checks. Domain failures resolve with safe codes, never raw stderr/stack text.
Backend admission is rechecked on both completion paths; disappeared/replaced
souls, anchors or CLI identity cannot lend an old result to a new selection.

## Process boundary

The adapter repeats the API2 feature fence at the actual execution owner. Fixed
`execFile`, `shell:false` argv starts with:

```text
spawn <admitted-soul> --dir <admitted-context> --agents-root <admitted-root> --preview
```

Only validated optional flags follow; `--json` terminates the fixed invocation.
There is **no** fallback, `--no-launch` workaround, apply, `--expect-decision`,
`--task`, `--task-file`, upsert, arbitrary path or renderer environment.
Ambient `PI_AGENTS_ROOT`, `OATS_DEPLOYMENT` and `OATS_RESOLUTION` cannot redirect
this explicitly addressed read. The test-only `OATS_PREVIEW_PREFLIGHT_BUDGET_MS`
override is also removed so it cannot expand the negotiated producer budget. Ordinary host observation environment belongs to
the installed CLI. The corrected producer owns its native preflight custody.

Two distinct reads may be in flight across the process, reserved before await;
exact invoker/CLI/workspace/subject/anchor/choice duplicates coalesce. No unbounded
queue or settled-result cache. CLI deadline **30 seconds**, output limit **4 MiB**,
proxy deadline **35 seconds**. Success requires clean exit and JSON-v1 envelope.

Opening instruction stays local during preview. It is not needed for placement
or launch-option resolution, and neither task text nor wake configuration is sent
to this read. Actual explicit legacy spawn retains its private0600 task-file
boundary and existing partial-wake behavior.

## Projection

The Desktop response is `{spawnPreviewViewApi:1,status,target,data,reason}`.
Successful data requires `spawnPreviewApi:2`, `preview:true`, a byte-exact
`subject {soul,agentsRoot,dir}` echo and a consistent
`decision {instance,home,branch,base,revision}`. Names/paths are producer text;
Desktop never derives a home or branch. Decision revision is opaque and never
computed, applied or treated as a reservation by this consumer. Its published
format is 24 lowercase hex characters.

The allowlisted projection includes resolved work mode/repo/worktree,
runtime/model/modelSource/config, yolo (unknown if omitted), relation/parent,
prospective child policy with origin, bounded capability/skill names, backend
name plus `backendStatus {name,installed,started:false}` and
`preflight {status:complete|timeout,budgetMs,elapsedMs}`. Binary installation is
not backend reachability; no daemon was started by this preview. It omits task,
env, executable recipes and unknown trees. Missing/oversized/mismatched data is
not an empty successful preview. Timed-out preflight is not silently Complete.
A preview path is not file-access authority or a terminal/launch receipt.

## Modal behavior and staged submit

- API2 reads run only on explicit **Preview spawn** or **Suggest default name**.
  Typing, selecting a launch configuration, CLI refresh and roster polling do not
  invoke K6. Supported local API2 replaces the older automatic invocation preview;
  older/remote ordinary launch behavior remains separate, never a K6 fallback.
- Suggest omits purpose, reports the kernel's default candidate and leaves the
  real purpose input unchanged. Manual branch/base inputs never invent a branch
  catalog or assume `main`; the kernel default is HEAD.
- Native default and child permission are explicit preview choices, not implicit
  model strings or permission granted by a successful read.
- **Preview-only choices block existing Spawn/Mod+Enter**. A visible reset clears
  them without clearing opening instruction. Downgrades retain values and keep
  reset reachable. Legacy `/api/spawn` also refuses those new keys/model modes
  with `E_PREVIEW_ONLY` instead of silently dropping them. No mutation options are
  added by this stage; guarded apply is a separately approved companion.
- K5 is labelled **Observed soul readiness — not the proposed launch’s readiness**.
  It does not certify draft runtime/config/base overrides. A K6 refusal remains
  visible regardless of an independent K5 Ready result.
- Request/mount/workspace/CLI/selection/draft ownership gates success, rejection
  and cleanup. Old controls cannot act after close; edits revoke old results;
  independent read tickets do not overwrite a newer form or unlock a pending
  legacy mutation. No terminal input, tmux viewer or workspace-transaction change.

Attach knowledge, ADE auto-PR and branch enumeration remain named follow-ups,
not parity-complete. K5 signature verification and K11 enrolment are not enabled.

Qualification uses inert CLI/HTTP/IPC/DOM fixtures and computed three-theme AA,
not native UI/model/auth acceptance. Full root gates belong to PR CI; no operator
preview/spawn, GUI, signature fetch, install or restart is part of local testing.
