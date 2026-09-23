# Desktop CLI API v1

The contract between the OATS Desktop app and the `oats` CLI. Desktop never
imports kernel code; it shells out (via `execFile`, argv, absolute binary — no
shell) to a discovered `oats` and speaks this JSON protocol. **API version, not
source adjacency, is authoritative.**

## Probe

```
oats version --json
```

prints exactly one JSON object on stdout:

```json
{"schemaVersion":1,"name":"@awebai/oats","version":"<installed version>","desktopApi":1}
```

`version` is the installed package's exact semver (e.g. `0.20.0`).
Desktop 0.24 accepts `desktopApi === 1` and semver `>=0.22.0 <0.25.0`
(the earlier Desktop 0.23 band was `>=0.22.0 <0.24.0`). This admits the paired
0.24 CLI without changing Desktop API v1. It does not establish complete captured
UI, backend, plugin, retirement or recovery parity; capability checks and explicit
refusals below remain authoritative.

Optional features are negotiated from the probe's `features` array. Starting
an existing home requires `session-start`; named launch configurations and
runtime/permission overrides require `launch-config`; restarting a running
home also requires `session-restart`. Desktop checks the corresponding
`remote` entries before offering these operations for a server. The router
then probes the execution host before sending a mutation. An absent feature
means an update is needed; it is not inferred from the version number.

The band is widened one kernel minor at a time, after confirming this v1
surface is unchanged, and always admits the kernel published by the same
release — Desktop and the CLI are built from one tag, so a band excluding its
own kernel would degrade the shipped app to observation-only. Prereleases are
never accepted.

## Envelope

Every other `--json` command emits **exactly one JSON object on stdout** and
no progress prose (progress goes to stderr):

- success (exit 0): `{"schemaVersion":1,"ok":true,"result":{...}}`
- failure (nonzero exit): `{"schemaVersion":1,"ok":false,"error":{"code":"...","message":"..."}}`

## Souls and sources (`oats inspect --json`, `soulsApi: 1`, OATS 0.24.7+)

Every entry in `result.souls[]` carries what the soul's **own `soul.yaml`
declares**, parsed by the kernel — a consumer never parses YAML and never
infers a field that is not there:

- `soulsApi: 1`
- `declarations: { requires, defaults, knowledge, teams, resources, children }` — each
  the declared object, or `null` when the section is absent (`children`
  since 0.24.8: `{spawn: boolean}`, see readiness policy).
- `provenance: { kind, source, revision, path, workspaceRevision } | null` —
  where this soul copy came from, as recorded by the kernel when it created
  it (the 0.24 bootstrap recorded `packaged-definition` or
  `exported-edition-copy`; the 0.25 `oats onboard` creates no soul and records
  nothing here — see [`oats onboard`](#oats-onboard-dir---workspace-repo-ref---json--onboardapi-2)).
  Souls created before 0.24.7 or authored by hand
  read `null`; render that as *unrecorded*, not as local or as anything else.
- `readiness` — the soul's **declared sources**, joined against
  `result.capabilities[]` from the same payload. Distinct from launchability
  (`oats spawn`) and adoption (`oats prepare`); never a green "Ready".
  - `source: "recorded" | "unrecorded"`
  - `requirements: [{ capability, source, installed, approved, active, version }] | null`
    (`null` = nothing declared). `installed: false` = not in the inventory;
    `approved`/`active`/`version` are `null` when there is no inventory row.
  - `status: "undeclared" | "sources-installed" | "sources-missing" | "unknown"`
- `declarationProblems: [{ code, message }]` — an unreadable file reports why;
  the soul is still listed.

`result.sources` is the scope's **portable source context**: the distinct
provenance sources its souls record.

```json
{"soulsApi":1,"kind":"recorded-provenance","note":null,
 "items":[{"kind":"exported-edition-copy","source":"git:https://…/oats.git","revision":"<sha>","path":"souls/oats-setup-expert","workspaceRevision":"<sha>","souls":["oats-setup-expert"]}]}
```

`kind: "none-recorded"` (empty `items`, explanatory `note`) means no soul in the
scope records a portable **source address** — a soul may still carry a
`provenance` of kind `packaged-definition` with `source: null`. Say "no portable
source recorded"; do not infer "local" or "authored" from this state.
Workspace imports adopted onto a deployment will appear here at their pinned
revisions when that adoption is recorded on the deployment; nothing is
enumerated from a source repository that the deployment does not record.

## Instance Git state (`oats instance git|diff`, `instanceGitApi: 1`, OATS 0.24.7+)

Read-only observation of one instance's **work tree**. Truth comes from the
tree — the branch the tree is on, not the branch recorded at spawn (that is
reported under `recorded` with a `drift` flag). Fixed-argv `git`, no shell.

Address the instance qualified: `oats instance git <instance> --dir <scope>`
resolves the name under the scope's agents roots (team roots included) and
**refuses when several homes match** (`E_AMBIGUOUS_INSTANCE`, `details.candidates`);
pass `--home <abs>` to pick one. Unknown → `E_SESSION_UNKNOWN`; retired or
un-materialized tree → `E_NO_WORKTREE`.

```json
{"instanceGitApi":1,"instance":"dev-1","agent":"dev","home":"/abs/home","workMode":"worktree",
 "observation":{"revision":"<HEAD oid|unborn>","indexRevision":"<index tree oid>","at":"<iso>","worktree":"/abs/work","branch":"feat/y","detached":false,"unborn":false},
 "recorded":{"branch":"feat/x","repo":"/abs/repo","drift":true},
 "upstream":{"ref":"origin/feat/y","ahead":1,"behind":0},
 "base":{"ref":"origin/main","source":"origin/HEAD","mergeBase":"<oid>","ahead":2,"behind":0},
 "remote":{"name":"origin","url":"git@github.com:acme/one.git","host":"github.com","path":"acme/one","source":"branch-upstream|origin"},
 "summary":{"changed":1,"renamed":1,"copied":0,"unmerged":0,"untracked":1},
 "files":[{"id":"<24 hex>","kind":"renamed","xy":"R.","submodule":false,"score":"R100","path":"src/new.txt","origPath":"src/old.txt"}],
 "notes":[]}
```

- `upstream` and `base` are **two separate comparisons**. No upstream →
  `upstream: {ref:null, ahead:null, behind:null}` — unknown, **not 0/0**. `base`
  is against the merge-base with the default branch (`origin/HEAD`, else a
  well-known name; `source` says which); none found → all `null` plus a note.
- Status is porcelain v2, NUL-delimited: renames/copies carry `origPath`;
  paths with spaces/newlines are intact. `kind` ∈ changed | renamed | copied |
  unmerged | untracked. Ignored files are not listed.
- `files[].id` is **opaque**, minted under (`revision`, `indexRevision`). It is
  the only way to ask for a diff.
- `remote` (0.24.8+): the branch's configured remote (`source: branch-upstream`),
  else `origin`, else `null` — never invented. `host`/`path` are **parsed** from
  the URL (ssh/https forms; `.git` stripped) so an ADE can choose a forge backend
  and a `owner/repo` **without running Git**; a local path has `host: null`. No
  network, no forge knowledge in the kernel.

`oats instance diff <instance> --file <id> --revision <rev> [--index-revision <idx>] --json`
returns a bounded unified diff:

```json
{"instanceGitApi":1,"observation":{…},"file":{"id":"…","kind":"changed","xy":".M","path":"README.md","origPath":null},
 "against":"<captured revision oid>","binary":false,"bytes":2683,"truncated":false,"limit":262144,"patch":"diff --git …",
 "readOnly":{"helpers":"disabled","optionalLocks":"off","objectsWritten":0}}
```

- `against` is the **captured revision oid** for tracked changes (working tree
  vs that exact commit, index included — never the moving `HEAD`) and `empty`
  for untracked files. Binary → `binary: true`, empty patch. Over 256 KiB →
  `truncated: true` at the byte limit.
- **Read-only, helper-free, consistent across the read** (`readOnly` echoes
  it): the observed tree may carry a hostile repo config, so external diff,
  textconv, fsmonitor and hooks are disabled and the caller's Git environment
  and global config are not inherited; `--no-optional-locks` means no index
  refresh and no object is written (`ls-files --stage` hash, not `write-tree`).
  After producing the patch the CLI re-checks HEAD, index and the file's own
  content against the observation and refuses `E_STALE_OBSERVATION` if any
  moved mid-read — the result is never internally inconsistent.
- If HEAD or the index moved since the id was minted, or the id is not in the
  current observation, the CLI **refuses** with `E_STALE_OBSERVATION` and
  attaches the current `observation` in `error.details` — re-observe, never
  render a diff against a tree that is not the one on screen. A path in
  `--file` is `E_BAD_ARGS`.

No forge (PR/checks/reviews) data here: forge connections are an ADE/workstation integration (P1 decision), read by the Desktop server through the forge's own CLI; the kernel only reports the instance's `remote` so the ADE can pick a backend.

## Instance events (`oats instance events`, `eventsApi: 1` → **2**, OATS 0.24.8+) — K7

Typed lifecycle events per instance, **written by the kernel action that made
them true**, with the receipt it produced. Nothing is inferred from
transcripts, TASK/STATE files or prose. Append-only, two logs: `<home>/.oats-events.jsonl`
and `<workspace>/.agents/events/<agent>--<instance>.jsonl` (survives the
home's removal, so a retired instance's `retired` event is still readable).

`oats instance events <instance> [--limit <n>] [--since <iso>] [--home <abs>] [--dir <d>] --json`

```json
{"eventsApi":1,"instance":"dev-1","home":"/abs/home","count":7,"returned":7,"truncated":false,
 "events":[{"eventsApi":1,"at":"<iso>","instance":"dev-1","home":"/abs/home","producer":"kernel","kind":"spawned","data":{"agent":"dev","work":"worktree","branch":"agents/dev-1","runtime":"claude","model":null,"parentInstance":null,"relation":null,"launched":true}},
           {"…":"launched | restarted | stopped | stop-refused | retire-planned | worktree-retained | worktree-removed | branch-deleted | retired | child-spawn-refused"}],
 "lastEvent":{"kind":"stopped","at":"<iso>","producer":"kernel"},
 "waitingOnYou":null,
 "notes":["…"]}
```

- `kind` is a closed set (unknown kinds are refused at write). `producer` is
  `kernel` for lifecycle facts; a capability may append its own events with
  its id as producer (the write API is `appendEvent`, not the renderer).
- **`waitingOnYou` is `null` unless a producer reported it** (`data.waitingOnYou:
  true` with a `reason`). `null` means *unknown*, not "not waiting". Today no
  kernel path claims it; the Active overview keeps rendering unknown until a
  producer (a messaging or review capability) does.
- Window is bounded (`--limit`, default 200; `truncated` says so). A torn line
  appears as `kind: "unreadable"` rather than vanishing.

### Events API 2 (`eventsApi: 2`, feature `instance-events-2`, OATS 0.24.12+) — K7b

Gate a Desktop read on **both** `eventsApi === 2` and `"instance-events-2"` in
`features[]`. API 1 is not a sufficient fence for a bounded read: its reader
opened and read a source whole, followed symlinks, kept foreign rows and lost
torn lines and cleared claims silently. API 2:

- **Bounded, descriptor-safe read.** Each source (`home` =
  `<home>/.oats-events.jsonl`, `workspace` = `<ws>/.agents/events/<agent>--<instance>.jsonl`)
  is `lstat`ed first; anything but a regular file is **refused unopened**.
  The open itself is `O_RDONLY|O_NOFOLLOW|O_NONBLOCK` and the descriptor is
  `fstat`ed: it must be a regular file with the same device+inode lstat saw
  (closes the lstat→open swap). At most the last 4 MiB is read by descriptor.
  **Canonical source shape**: `{path: "home"|"workspace", status: "ok"|"absent"|"refused"|"tail", bytes}`
  — `"tail"` means only the last 4 MiB was read (partial first line dropped);
  there is no separate `tail` boolean.
- **Row fields.** `incarnation` is the writing home's `instance.json.createdAt`
  (ISO) or `null` for rows written before the tag; the result's top-level
  `incarnation` is the current home's `createdAt` or `null` if unreadable. A
  row with `incarnation: null` never matches the current incarnation, so it
  cannot contribute a current waiting claim. **An unknown current incarnation
  (top-level `incarnation: null`) admits NO claim**: `waitingOnYou: null`,
  `waitingClaims: []`, rows still returned as history. A consumer must refuse
  a null-incarnation response that nevertheless carries claims. Dedup identity is
  `producer|at|kind|incarnation|data`.
- **`waitingClaims[]` row shape**: `{producer: string, waiting: boolean, since: ISO, reason: string|null}`
  — one row per producer with a claim in the current incarnation, INCLUDING
  cleared ones (`waiting: false`, `reason: null`, `since` = the clearing row's
  `at`). `waitingOnYou` = the newest `waiting: true` row or `null`.
- **Address history.** `--home <abs>` must be a home of exactly `<instance>` under
  the scope (`E_HOME_MISMATCH` otherwise, like K1). Rows whose `instance`/`home`
  are not the admitted address are dropped and counted (`integrity.foreignRows`).
  Every row carries `incarnation` (the writing home's `instance.json.createdAt`);
  the result echoes the current home's `incarnation`. Rows tagged with an earlier
  incarnation ARE returned — they are this address's history — so a consumer can
  label them "earlier instance at this address". No current home → no read
  (archived access is a separate contract).
- **`waitingOnYou` is a producer STATE for the current incarnation**, decided per
  producer by that producer's latest row that carries the field: an explicit
  `false` clears, a row without the field does not; earlier incarnations never
  contribute; computed over the FULL admitted read (a `--limit` window cannot
  hide a clear). `waitingClaims[]` lists every producer's current claim
  (`{producer, waiting, since, reason}`); `waitingOnYou` is the newest positive.
  Still `null` today — no producer emits it.
- **Provenance and corruption never disappear.** Dedup is by
  `producer|at|kind|incarnation|data` (the same facts from two producers are two
  rows). `integrity.unreadableRows` counts torn/invalid lines regardless of
  `--since` or the window. `count` = admitted rows after `--since`, `returned` =
  the window, `truncated` = window cut OR any source read as a tail.

```
{"eventsApi":2,"instance":"dev-1","home":"/abs/home","incarnation":"<iso>","count":7,"returned":7,"truncated":false,
 "integrity":{"unreadableRows":0,"foreignRows":0,"sources":[{"path":"home","status":"ok","bytes":1234},{"path":"workspace","status":"ok","bytes":1234}]},
 "events":[{"eventsApi":2,"at":"<iso>","instance":"dev-1","home":"/abs/home","incarnation":"<iso>","producer":"kernel","kind":"spawned","data":{...}}, ...],
 "lastEvent":{"kind":"launched","at":"<iso>","producer":"kernel","incarnation":"<iso>"},
 "waitingOnYou":null,"waitingClaims":[],"notes":[...]}
```

Desktop passes `--limit` (50|100|200) only; `--since` remains a human flag.

## Schedule run history (`scheduleApi: 2`, `scheduleHistoryApi: 2` → **3**, OATS 0.24.8+) — K8

`oats schedule show|list --json` entries gain **`recentRuns`**: the last 50
settled runs (newest first) — every `lastRun` the scheduler recorded once its
outcome settled (`ended | stopped | blocked | invalid | delivered | skipped |
unknown …`, never `active`/`starting`), exactly as the producer wrote it,
deduplicated per run. Where the run launched or targeted an instance, a
`transcript: {instance, home, kind: "session"}` pointer says which home's
session to open (the existing `oats session` surface); the kernel does not
copy transcripts. `nextRun`/`lastRun`/`executionStatus` are unchanged. The
Schedules view (frame 08) renders `recentRuns` as the recent-runs list and the
transcript pointer as the handoff; captured-policy definitions are preserved
as they are (definition fields are untouched by this addition).

### History API 3 (`scheduleHistoryApi: 3`, feature `schedule-read-2`, OATS 0.24.13+) — K8b

Gate a Desktop history read on **both** `scheduleHistoryApi === 3` and
`"schedule-read-2"` in `features[]` (`scheduleApi` stays 2 — mutation verbs are
unchanged). API 2's reader keyed runs by outcome, read state files whole and
unchecked, echoed a stored `definition.id` without checking it, and named a
`transcript` that no reader backs. API 3:

- **Run identity is time, not outcome.** `runId = sha256(scheduledFor|startedAt|attemptId)[0:24]`.
  A run's later facts update its one row; `transitions[]` keeps the outcome
  sequence (`["started","unknown","ended"]`); `settled: boolean`
  (`pending: true` is never settled); `recordedAt`. Pre-API-3 rows are returned
  with `runId: null, legacy: true, settled: null, transitions: null` and are
  never merged. `lastRun` carries the same `runId` as its history row.
- **Bounded, descriptor-safe state.** `oats-schedules.json` and
  `.agents/schedules/state.json` are `lstat`ed (regular file only), opened
  `O_NOFOLLOW|O_NONBLOCK`, `fstat`-verified (dev+ino), and read whole **only
  within a 1 MiB budget** — over budget is a typed `E_SCHEDULE_STATE_OVERSIZE`
  refusal with `details.source`, never truncated JSON. `list`/`show` carry
  `integrity: {sources: [{path: "definitions"|"state", status: "ok"|"absent"|"refused"|"oversize"|"corrupt", bytes}]}`.
  History is capped at 50 rows **at read** (`history: {status, stored, truncated}`);
  one job's corrupt history (`history.status: "corrupt"`, `recentRuns: []`) or
  bad identity (`unreadable: {code, message}`) never fails the other jobs in `list`.
- **Subject truth.** `list` and `show` echo `scope` (the resolved schedule-owning
  workspace) and canonical `id`. A definition whose own `id` differs from its
  key → `E_SCHEDULE_IDENTITY` (`details.key`, `details.declared`). IDs must match
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` (`E_BAD_ARGS` otherwise, before any read).
- **Session provenance, never a transcript.** The `transcript` key is gone.
  Each run (and `lastRun`) carries
  `session: {instance: string|null, home: string|null, incarnation: string|null, server: string|null, delivery: "launched"|"delivered-active"|"none"}`
  — facts the recorder had at write time (an active-session wake names the
  instance only when the input result did; `incarnation` = the home's
  `instance.json.createdAt` at record time; `server` = the answering peer for a
  remote command). **There is no reader behind this block**: a consumer renders
  provenance and a precise unavailable reason. A read-only transcript verb is a
  separate seam (K12), not implied by this API.

```
{"scope":"/abs/ws","scheduleApi":2,"scheduleHistoryApi":3,
 "integrity":{"sources":[{"path":"definitions","status":"ok","bytes":812},{"path":"state","status":"ok","bytes":4410}]},
 "schedules":[{"id":"nightly","scope":"/abs/ws","scheduleApi":2,"scheduleHistoryApi":3,…,
   "history":{"status":"ok","stored":7,"truncated":false},
   "recentRuns":[{"runId":"3f…","scheduledFor":"<iso>","startedAt":"<iso>","outcome":"ended","settled":true,"transitions":["started","ended"],"recordedAt":"<iso>",
                  "session":{"instance":"dev-1","home":"/abs/home","incarnation":"<iso>","server":null,"delivery":"launched"}}]}],
 "scheduler":{…}}
```

**Exact shapes (API 3):**
- `schedule list --json` → `result = {scope, scheduleApi: 2, scheduleHistoryApi: 3, integrity, schedules: Entry[], scheduler}`.
- `schedule show <id> --json` → `result = {schedule: Entry}` (one level of nesting; `integrity` is NOT on `show` — it is a scope fact reported by `list`).
- `Entry` (readable) = definition fields (`id, kind, home, message|operation, cron, enabled, …`) + `{scope, scheduleApi: 2, scheduleHistoryApi: 3, executionStatus, nextRun: ISO|null, lastRun: Run|null, history, recentRuns: Run[], running: boolean, attempt?, pendingWake?}`.
- `Entry` (unreadable, `list` only) = `{id, scope, scheduleApi: 2, scheduleHistoryApi: 3, unreadable: {code, message}, history: {status: "corrupt", stored: null, truncated: false}, recentRuns: []}` — no definition fields.
- `history` = `{status: "ok", stored: integer, truncated: boolean}` | `{status: "corrupt", stored: null, truncated: false}`.
- `Run` (API 3 row) = producer-written fields (`scheduledFor, startedAt, kind, outcome, …`) + `{runId: string, legacy: false, settled: boolean, recordedAt: ISO, transitions: string[], session}`; `transitions[]` elements are outcome strings in write order, first element = the first recorded outcome.
- `Run` (legacy row) = producer-written fields + `{runId: null, legacy: true, settled: null, transitions: null, session}` — no `recordedAt`, no `key`.
- `Run` (corrupt element) = `{runId: null, legacy: true, corrupt: true}` only.
- `session` = `{instance: string|null, home: string|null, incarnation: ISO|null, server: string|null, delivery: "launched"|"delivered-active"|"none"}`; always present on rows and on `lastRun`.
- `runId` is opaque to consumers: never recompute, never dedup client-side.
- **Refusals** (`ok:false`): `E_SCHEDULE_STATE_OVERSIZE` / `E_SCHEDULE_INVALID` carry `error.details.source = {path, status, bytes}` (+ `field`); `E_SCHEDULE_IDENTITY` carries `error.details.key` and `error.details.declared`; `E_BAD_ARGS` (id shape) carries no details. A refusal has no `integrity` block — `list` refuses as a whole only when a scope file itself is unreadable.
- **Open path** (both files): `lstat` → regular file → `open(O_RDONLY|O_NOFOLLOW|O_NONBLOCK)` → `fstat` regular + same dev/ino + `size ≤ 1 MiB` → read exactly `fstat.size` bytes by descriptor (a file that grows past the budget between lstat and fstat is refused, never partially read).

## Spawn preview (`oats spawn … --preview`, `spawnPreviewApi: 1`, OATS 0.24.8+)

The Spawn modal's fields are backed by the kernel's own decision, taken **before
any side effect**: `oats spawn <agent> [same flags as a real spawn] --preview --json`
runs every preflight a spawn runs (placement, composition, resources,
executable, runtime packages, child-spawn policy) and returns what the spawn
*would* do — then returns without creating a home, branch or worktree.

```json
{"spawnPreviewApi":1,"preview":true,"agent":"dev","kind":"persistent","instance":"dev-fix-login","home":"/abs/agents/dev/instances/dev-fix-login",
 "repo":"/abs/repo","work":"worktree","runtime":"claude","model":"opus","modelSource":"soul","launchConfig":null,"yolo":false,"backend":"tmux",
 "branch":"agents/dev-fix-login","base":{"ref":"HEAD","oid":"<oid>"},"worktree":"/abs/agents/dev/instances/dev-fix-login/work",
 "relation":null,"parentInstance":null,"policy":{"childSpawns":{"allowed":true,"origin":{"kind":"default","detail":"…"}}},
 "executable":"/abs/bin/claude","capabilities":["oats.core"],"skills":["oats-operate","oats-souls"],"task":"…"}
```

- **Name / work area**: `instance` is the canonical name (`<agent>-<purpose>`,
  de-duplicated with `-2`, `-3`…); `home` and `worktree` are the canonical
  paths. The renderer never derives paths.
- **Branch / base** (worktree mode): `branch` defaults to `agents/<instance>`
  (`--branch <name>` overrides; validated); `base` is `--base <ref>` resolved
  to its commit oid (default `HEAD`). `E_BRANCH_EXISTS` and `E_BASE_UNKNOWN`
  are refused in preview and in apply, before anything exists. Apply creates
  the worktree **from that exact oid**.
- **Model**: `model`/`modelSource` are the resolved selection. Omitting
  `--model` **inherits** the launch configuration's or soul's preference;
  `--model @native-default` is the explicit "use the runtime's own default"
  (`modelSource: "native default (explicit)"`). These are different requests
  and the UI must not relabel one as the other.
- **Policy**: `policy.childSpawns` is what this instance will record (soul
  declaration / spawn option / default), enforced later by the spawn route for
  its children (see readiness).
- **Apply** = the same command without `--preview`; the same inputs yield the
  same decisions (instance, branch, base oid). If the world moved between
  preview and apply (name taken, branch created, base gone) the apply refuses
  with the same typed codes — the preview is a statement, not a reservation.
- Not in preview (later K6 follow-ups): attach-knowledge refs from the
  knowledge provider (05 excluded, attach stays), auto-PR intent (ADE-owned,
  P1).

### Preview API 2 (0.24.9+, feature `spawn-preview-2`) — the safe-mode fence

**API 1 previews wrote before they returned** (a refused child spawn appended an
event to the parent; a Herdr backend could be started; an unknown soul could be
imported from an importable def). A consumer must therefore gate on
**`spawnPreviewApi === 2` AND `features.includes("spawn-preview-2")`** — API 1 is
the pre-fix marker and is never accepted for dispatch.

- **No writes, success or refusal.** A preview appends no event, starts no
  daemon (`backendStatus {name, installed, started:false}` reports what it
  observed), and never creates/updates a soul (`E_SOUL_UNKNOWN` instead of an
  import; `--instructions-file`/`--def-file` refused with `E_BAD_ARGS`). Test:
  the deployment tree is byte-identical after a success, a refusal and an
  unknown-soul preview.
- **Exact root**: `spawn <soul> --agents-root <abs>` binds the soul to that root
  (as inspect/readiness take it) — no team-soul / capability-agent / importable-
  def fallback; mismatch → `E_SOUL_UNKNOWN`. The preview echoes
  `subject {soul, agentsRoot|null, dir|null}` **as given, byte-exact**.
- **Decision binding**: `decision {instance, home, branch, base{ref,oid},
  revision}` (24-hex). Apply with `spawn … --expect-decision <revision>`: the
  kernel recomputes name/home/branch/base under the same placement path and
  refuses **`E_DECISION_STALE`** with `details.decision` (the fresh one) on ANY
  drift — no auto-suffix, no silent re-base, nothing created. A GUI re-previews
  and re-confirms; it never second-guesses names or paths. Without the flag the
  CLI keeps its legacy auto-suffix for humans.
- **Bounded preflight**: every native probe a preview runs (`pi --list-models`,
  `pi list`, `claude plugin list`) shares ONE budget (20 s default), runs in its
  own process group and is group-killed on timeout; `preflight {status:
  complete|timeout, budgetMs, elapsedMs}` says which. A hanging runtime cannot
  hang a preview.
- **Confirmed apply contract** (0.24.10+, feature `spawn-apply-2`,
  `spawnApplyApi: 1`) — what a GUI may promise at "Confirm spawn":
  - `decision` gains **`effective {repo, work, runtime, model, launchConfig,
    yolo, backend, childSpawns, relation{kind, anchor{instance, agentsRoot}}}`**
    and `revision` hashes placement + effective. An inherited default that would
    change what launches (the soul's model edited between preview and apply,
    say) → `E_DECISION_STALE`. A GUI does not re-resolve anything itself.
  - **No effect before the fence**: backend presence and `ensureHerdr` run only
    AFTER a successful `--expect-decision` binding and after the placement
    reservation. A stale apply with `--backend herdr` starts nothing. (The
    parent-policy refusal still appends `child-spawn-refused` to the PARENT's
    log on a non-preview apply — that is an audit of a real refusal, not an
    effect on the target.)
  - **Exclusive placement**: the home is reserved with a non-recursive `mkdir`
    immediately after the decision check; a concurrent spawn that lost refuses
    **`E_PLACEMENT_TAKEN`** having touched nothing. Two concurrent applies of
    one decision yield exactly one home. There is no wider lock; this
    reservation is the guarantee.
  - Gate confirmation AND the exec owner on `spawn-preview-2` +
    `spawn-apply-2` + `spawn-idempotency`; a legacy local request on such a CLI
    is refused by the Desktop (`E_PLAN_REQUIRED`), not routed around the fence.
- **Replay custody** (0.24.10+, feature **`spawn-idempotency-2`** — gate on
  this, not on `spawn-idempotency`, whose replay could be blocked by
  `E_BRANCH_EXISTS`): key recovery runs **first**, right after the name is
  decided and before any placement/branch/base/preflight/backend work — so a
  retry of a spawn that created its explicit branch still reaches its receipt.
  The key-bearing home records `spawnCompleted:false` at its first write and
  `true` only after launch + lineage + final events; a same-key retry of an
  unfinished spawn refuses **`E_SPAWN_INCOMPLETE`** (`details.{instance, home,
  launched}`; remedy is the session surface, never another spawn). The key
  lives in the home by design: durable across the GUI's restart, gone with a
  retired home — after a retire, "check result" is a roster question. The wake
  outcome is recorded (`wake {requested, saved, error}`) and returned on
  replay; `saved:null` means *not recorded* (crash in the interval) — render
  "Agent created; wake outcome unavailable — check Schedules", never
  saved/not-saved without the record.
- **Retention stays clean**: the completion marker and the wake record are
  kernel writes to `instance.json` made after the spawn's retirement baseline;
  the kernel re-stamps the baseline's home fingerprint after each, so a fresh
  keyed home retires with **no** `changed instance-home bytes` — only the
  agent's own changes ever read as work to recover.
- **Idempotent apply** (0.24.10+, feature `spawn-idempotency`): `spawn …
  --expect-decision <rev> --idempotency-key <key>` records the key and the
  decision in the new home's `instance.json`; a **retry with the same key**
  replays the recorded receipt (`replayed: true`, same instance/home, no second
  spawn, no wake re-saved) — found by key across the soul's instances, never by
  name (the planned name may have been auto-suffixed past it, which is exactly
  the retry case). The same key with a *different* decision refuses
  **`E_IDEMPOTENCY_CONFLICT`** (`details.instance/home` of the prior spawn); a
  different key with a fresh decision is a genuinely new confirmation. Mint the
  key server-side on the first confirmation and keep it for that intent's
  retries (as 2c does); a lost response is a replay, never a guess by name.
- Still absent (named follow-ups, not parity-done): attach-knowledge node refs
  (provider contract), auto-PR (P1/ADE write approval), branch enumeration
  (producer seam).

## Readiness quartet, signatures, enforced policy (`oats readiness`, `readinessApi: 1`, OATS 0.24.8+)

`oats readiness [--soul <name>] [--home <abs>] [--verify-signatures] [--policy] [--dir <d>] --json`
is the first-run readiness view (frame 09) and the Capabilities readiness rows
(frame 04). Every fact is derived from the **same** data `oats inspect` reports
— never a second opinion — and rolled into four checks:

```json
{"readinessApi":1,"subject":{"kind":"soul","name":"dev"},"at":"<iso>",
 "checks":{
  "installed": {"status":"pass","items":[{"subject":"oats.core","status":"pass","required":true,"reason":null,"producer":"oats list","evidence":{"version":"1.1.3","integrity":"sha256-…","origin":"installed"},"remedy":null}]},
  "trusted":   {"status":"fail","items":[{"subject":"oats.core","status":"fail","required":true,"reason":"executable surface not approved","producer":"artifact approval","evidence":{"integrity":"sha256-…"},"remedy":"oats trust oats.core",
                                          "signature":{"status":"unknown","signer":null,"reason":"signature verification needs a network fetch; pass --verify-signatures"}}]},
  "configured":{"status":"pass","items":[{"subject":"oats.core activation","status":"pass","required":true,"producer":"oats-config.yaml","evidence":{"target":"declared","level":"/abs"},"remedy":null}]},
  "enrolled":  {"status":"not-applicable","items":[{"subject":"workspace membership","status":"not-applicable","required":false,"producer":"oats.yaml","reason":"standalone deployment: no workspace declared in oats.yaml"}]}},
 "summary":{"ready":false,"required":3,"pass":2,"fail":1,"unknown":0},
 "notes":["…"]}
```

- Each check is `pass | fail | unknown | not-applicable`; items carry
  `subject, status, required, reason, producer, evidence, remedy`. **"Ready" is
  `summary.ready`**: every *required* item passes (or is not-applicable) and
  there is at least one required item — never inferred from an empty set.
- **`installed`**: artifact present, locked, integrity matches. **`trusted`**:
  executable approval of the exact artifact (`oats trust`). Separately,
  `signature {status: verified | unsigned | unknown | invalid | not-applicable,
  signer: {id, label} | null, reason}` — the source commit's **verified Git
  signature**, named signer or nothing. It is `unknown` unless
  `--verify-signatures` (a network fetch of that one commit; `git log %G?`);
  a catalog URL, repository owner or byte hash is never a signer. Render
  "Trusted · signed by <label>" only for `verified`.
- **`configured`**: activation for the subject, runtime-package requirements
  (`missingRequires`), runtime-settings problems. **`enrolled`**: workspace
  **member admission** (decision §3) — `not-applicable` for a standalone
  deployment (no `workspace:` in `oats.yaml`), `unknown` until admission is
  verified against the workspace observation, `pass`/`fail` when it is. Never
  login, never team registration; "Skip" leaves it not-applicable, never pass.
  *(The readiness producer still reads the 0.24 `oats.yaml` backlink; under the
  workspace model membership is `oats-membership.yaml` observed by
  `oats workspace status` — re-basing this item is an open thread.)*
- Subject: `--soul <name>` scopes required items to the soul's declared
  requirements; without it, to the scope's active capabilities.

`--policy` adds the **enforced** policy view with origins:

```json
"policy":{"childSpawns":{"allowed":false,"enforced":true,"origin":{"kind":"soul","detail":"children.spawn: false in soul.yaml"}},
          "worktrees":{"allowed":true,"mode":"worktree","enforced":true,"origin":{"kind":"work-mode","detail":"work: worktree"}}}
```

`childSpawns` is **enforced by the spawn route**: `soul.yaml` may declare
`children: {spawn: false}`; `oats spawn --allow-child-spawns | --no-child-spawns`
overrides per spawn; the result is recorded in `instance.json`
`policy.childSpawns {allowed, origin}`. A spawn with `--parent <p>` (or
`--relation child --relative-to <p>`) under a parent whose recorded policy is
off refuses **`E_CHILD_SPAWNS_DISABLED`** (`details.parent`, `details.policy`)
before anything is created. Absent policy (pre-0.24.8 instances) = allowed,
reported as `origin.kind: "default"`. With `--home <abs>` the policy is the
instance's recorded (enforced) one; with only `--soul` it is the declaration
(`enforced: false`). It is a lifecycle-authority claim, not an OS sandbox —
the UI says so.

### Slice-5 producer pins (0.24.9+; all additive — gate items on field presence)

- **`configured` is EFFECTIVE activation.** `activation.enabled` is the resolved
  verdict for the subject; a capability *declared* for the soul but disabled is
  `fail` with reason `declared for soul <n> but disabled (…)`. Declaration is
  never activation.
- **Trust is not-applicable for data-only capabilities.** The inspect row now
  carries `health.executableSurface` (manifest commands/hooks/launch env — what
  `oats trust` approves). No surface → `trusted` item `not-applicable`, reason
  `no executable surface`, whatever the lock records. This is why a fresh
  `oats trust <package> --all-capabilities` "skipped" `oats.core` and readiness
  still said fail before 0.24.9.
- **Typed linkage on every item**: `capability {id, level, scope}` and
  `origin {kind: requires|declares|default|inventory, target}`; plus
  `summary.byCapability[] {capability, origin, required, checks{installed,
  trusted, configured, enrolled}, ownReady, ready}` — the SAME items regrouped,
  no second observation. `ownReady` is the capability's own four verdicts;
  `ready` is `ownReady` AND no **subject-level blocker** — items that belong to
  no capability (workspace membership, soul declarations) are listed in
  `summary.subjectBlockers[] {check, subject, status}` and block every row.
  A per-capability row never says ready while the subject is blocked, and a
  row's verdict is never promoted to the subject's `summary.ready`. Render
  per-capability rows from this; never parse subjects.
- **Selector echo**: `subject.selector` = the arguments **as given, byte-exact,
  no realpath** — `{kind:"scope", dir|null}` · `{kind:"soul", soul,
  agentsRoot|null, dir|null}` · `{kind:"home", home, soul, agentsRoot|null}`.
  Compare with what you sent, byte for byte; never filesystem-normalize a
  response path. The canonical scope is `subject.context` (may differ from
  `dir`, e.g. `/var` vs `/private/var` on macOS).
- **Unreadable member document** (`oats.yaml` unreadable, or `workspace:`
  present but not a mapping) → `enrolled` item `unknown` with
  `evidence.file`, never `not-applicable`. A declared backlink stays `unknown`
  with reason `reciprocal admission not observed …` until the CLI fetches the
  workspace's members (K11).
- **Captured homes refuse**: `readiness --home <captured>` →
  `E_UNSUPPORTED_MODE` (`details.captured: true`) before any current-config
  interpretation.
- **`--agents-root <abs>`** is accepted with `--soul` (and with `--home`), as
  inspect takes it — pin the exact root you admitted.
- **Signature verification (feature `readiness-verify`)**: `--verify-signatures`
  is bounded custody — **one total budget per readiness read** (120 s default)
  shared by every capability's fetch and verify (an exhausted budget refuses the
  remaining capabilities with `budget-exhausted`, no fetch), each Git child in
  its own process group and the **whole group** SIGKILLed on timeout or failure,
  scratch repositories removed on normal exit and on SIGINT/SIGTERM/SIGHUP, `GIT_CONFIG_GLOBAL
  =/dev/null` + no system config + no prompts/askpass, **only https/ssh**
  transports. `signature.failure` is `null` or `{code}` from the closed set
  `transport-not-allowed | fetch-failed | fetch-timeout | budget-exhausted |
  verifier-failed | verifier-timeout | cannot-check`; `signature.reason` is a
  fixed sentence, **never stderr**. Gate the *Verify signatures…* action on the
  feature name; keep it an explicit user action.

## Lifecycle plans — Stop and Remove (`lifecycleApi: 1`, OATS 0.24.8+)

The Desktop's Stop and Remove confirmations render **plans**: a read-only
statement of what the action would touch, with the facts a human needs, and a
`planRevision` hashed from the facts that make the action safe. Apply carries
the revision back; if reality moved, apply **refuses with the fresh plan**
(`E_PLAN_STALE`, `details.plan`) instead of acting on a world the human did
not see. An `idempotencyKey` makes a retried apply return the first receipt.

### `oats instance stop <instance> --plan [--no-recursive] [--home <abs>] [--dir <d>] --json`

```json
{"lifecycleApi":1,"action":"stop","instance":"dev-1","home":"/abs/home","recursive":true,"at":"<iso>",
 "targets":[{"instance":"dev-1-child","agent":"dev","home":"/abs/child","depth":1,"workMode":"worktree","launched":true,
   "session":{"state":"unknown","present":true,"backend":"tmux","established":true},
   "work":{"observed":true,"revision":"<oid>","branch":"feat/x","detached":false,"drift":false,"changed":2,"untracked":1,"upstream":{"ref":null,"ahead":null,"behind":null},"base":{"ref":"origin/main","ahead":1,"behind":0},"remote":{"host":"github.com","path":"acme/one"}},
   "retiring":false,"stopPending":false,"midTask":true}],
 "skipped":[],"planRevision":"<24 hex>","notes":[]}
```

- `targets` are the instance's **recorded descendants deepest-first, then the
  instance** (recorded parentage — `parentInstance` — is the only relation the
  kernel knows). `--no-recursive` lists them under `skipped` instead.
- `session.state` is the backend's word: `shell`/`stopped`/`not-launched` are
  idle; `unknown` means a non-shell process is running whose identity tmux
  cannot name (the ordinary state of a launched harness). If the state **could
  not be established**, `established:false`, `present:null`,
  `state:"unestablished"`, with a `reason` — render that as unknown, never as
  idle.
- `work` is K1's observation (`observed:false` with a `reason` when there is no
  work tree or it cannot be read — not "clean").
- `midTask` is **reported** activity: `true` (running session or dirty work),
  `false` (established idle and observed clean), or `"unknown"`.

### `oats instance stop <instance> --apply --plan-revision <rev> --idempotency-key <key> [--no-recursive] [--grace-ms <n>] --json`

Quiesces each target (SIGTERM to the harness processes, bounded wait, **never
escalated**), children first, under a per-home stop marker; retains home, work
tree, transcript and launch configuration so `oats session restart` brings the
instance back. Refuses `E_PLAN_STALE` (fresh plan attached),
`E_INSTANCE_RETIRING`, `E_LIFECYCLE_BUSY`.

```json
{"lifecycleApi":1,"action":"stop","instance":"dev-1","home":"/abs/home","idempotencyKey":"k","planRevision":"<rev>","at":"<iso>",
 "ok":false,"results":[{"instance":"dev-1-child","home":"/abs/child","ok":false,"code":"E_SESSION_STOP_FAILED","message":"…still running after 1500 ms; nothing was escalated","stillRunning":[4242]},
                       {"instance":"dev-1","home":"/abs/home","ok":true,"stopped":true,"alreadyIdle":false,"state":"shell"}],
 "retained":["home","work","transcript","launch"],"replayed":false}
```

`ok:false` means at least one target is still running; the receipt says which
pid. Nothing was killed harder. A replay (`replayed:true`) is the recorded
receipt for that key, not a second action.

### `oats retire <instance> --plan [--home <abs>] [--dir <d>] --json`

What Remove would touch, with the design's defaults. Read-only.

```json
{"lifecycleApi":1,"action":"retire","instance":"dev-1","home":"/abs/home","at":"<iso>",
 "facts":{"session":{…},"work":{…K1 summary…},"workMode":"worktree","repo":"/abs/repo","recordedBranch":"agents/dev-1",
          "children":[{"instance":"dev-1-child","agent":"dev","home":"/abs/child","session":{…}}],"pullRequest":"unknown"},
 "defaults":{"retainWorktree":true,"deleteBranch":false,"stopChildren":true,"retainChildren":true},
 "planRevision":"<24 hex>","notes":["the worktree is on feat/x, not the recorded agents/dev-1; branch actions use the worktree's branch", "…"]}
```

`pullRequest` is **always `"unknown"` from the kernel**: forge facts belong to
the ADE's connection (P1). Branch actions use the **worktree's** branch
(`facts.work.branch`), never `recordedBranch`.

### `oats retire <instance> [--discard-worktree] [--delete-branch] --json` — retention is the default (K3b)

Plain `retire` now **retains** a worktree-mode instance's work: the worktree
cannot stay under the removed home, so it is **re-homed** with
`git worktree move` to `<workspace>/.agents/worktrees/<repo>/<branch>` (a
`-2`, `-3` suffix if taken; detached → `detached-<oid12>`), with staged,
unstaged and untracked state intact, and the repository knows the new
location. The receipt says so:

```json
{"retired":"dev-1","retention":{"worktree":"retained","movedTo":"/ws/.agents/worktrees/repo/feat-x","branch":"feat/x","detachedAt":null,"recordedBranch":"agents/dev-1"},
 "worktreeRemoved":false,"branchDeleted":false, "workRecovery":{…}}
```

- `--discard-worktree` restores removal (`retention.worktree: "removed"`).
- `--delete-branch` deletes the **worktree's verified branch**
  (`retention.branchDeleted`), never the recorded spawn name, and implies
  discarding the worktree (a checked-out branch cannot be deleted).
- A failed move keeps the home and refuses `E_WORK_PRESERVATION_FAILED` —
  nothing is lost; retry or pass `--discard-worktree`.
- Non-worktree modes report `retention: null`. Quarantine/rollback paths keep
  their removal semantics.
- The Remove dialog's "also delete worktree / branch" checkboxes map to these
  two flags; the kernel never touches a PR.
- **Guarded apply** (what a GUI sends): `oats retire <i> --plan-revision <rev>
  --idempotency-key <key> [--discard-worktree] [--delete-branch] --json`. The
  revision is revalidated against a fresh plan first — facts moved →
  `E_PLAN_STALE` with `details.plan` (re-render, re-confirm; nothing retired);
  a repeated key **replays** the recorded receipt (`replayed: true`, JSON-v1
  envelope) instead of retiring twice. A first retire prints its raw receipt
  (pre-existing shape) with `planRevision`/`idempotencyKey`/`replayed:false`
  added. Mint the key server-side per confirmation intent and keep it for that
  intent's retries.
  - **Children first, kernel-owned.** The plan's `facts.children` are stopped
    by the kernel before retirement (bounded SIGTERM, never escalated) and
    retained; the receipt lists `childrenStopped[]`. A child still running
    after the grace **refuses the whole retirement** — `E_CHILDREN_RUNNING`
    with `details.childrenStopped` (pids) and `details.plan`; nothing retired.
  - **Branch deletion is bound to the confirmed branch.** The kernel re-verifies
    the worktree's branch at the moment of deletion, after hooks (which may
    mutate the tree); a mismatch deletes nothing and reports
    `retention.branchDeletionSkipped {expected, actual, reason}`.
  - **Ambiguous parentage is reported, never acted on.** Recorded parentage is
    a bare name; if a child's parent name resolves to several homes under the
    root, that child appears under `ambiguous[]` — `plan.ambiguous` on a stop
    plan, `plan.facts.ambiguous` on a retire plan — with the reason, and is
    excluded from `targets`/`children`.
- **Stop replay horizon**: stop receipts are stored **per idempotency key**
  (`<home>/.oats-stop-receipt.<key>.json`); any earlier key replays its own
  receipt for as long as the home exists. Retire receipts live beside the
  instances directory and replay after the home is gone.

### Feature advertisement — gate every new command on the probe

`oats version --json` `features` now lists: `instance-git`,
`instance-git-remote`, `souls-declarations`, `lifecycle-plans`,
`retire-retention`, `readiness`, `spawn-preview`, `instance-events`,
`schedule-history`, and carries the API integers (`instanceGitApi`, `soulsApi`,
`lifecycleApi`, `readinessApi`, `spawnPreviewApi`, `eventsApi`,
`scheduleHistoryApi`). **Gate on these, never on a version string and never by
optimistic invocation**: an older CLI ignores an unknown `--plan` on `retire`
and *retires*. Absent feature → the view is unavailable. (`catalog` was the
0.24 `oats catalog` verb's flag; the verb is removed under the workspace model
and the flag is no longer advertised — the official catalog is reached through
`packages:` + `oats sync`, not a command.)

## Workspace model (`workspaceApi: 2`)

Features: **`workspace-v2`** (the declaration files, `sync`, `package`,
`workspace status`, `capabilities`, `souls`; `init`/`use`/`install`/`restore`
removed), **`instance-modules`** (`instance.json.modules` / `providers` /
`workspace`; `status --json` module drift; preview `modules[]`),
**`spawn-provider-payload`** (`oats spawn … --provider <cap> k=v`). The probe
carries `workspaceApi: 2`. Model: [workspaces.md](workspaces.md).

Every command below needs a deployment with `oats-local.yaml` (walked up from
`--dir`/cwd) — else `E_LOCAL_MISSING { dir, searched[] }` — and reads the
workspace over Git remotes with the operator's credentials, never prompting
(`E_REMOTE_UNREADABLE { url, reason: "auth"|"not-found"|"network"|"timeout" }`).
Every `commit` is a full 40-hex OID; every digest is `sha256-<hex>`; every
`at`/`observedAt` is ISO-8601 UTC. Repo keys are canonical
(`github.com/org/repo`; `local/<abs-path>` for file remotes).

### Removed verbs answer `E_UNKNOWN_COMMAND` with a replacement

`install`, `restore`, `init`, `use`, `trust`, `list`, `catalog`, `remove`,
`migrate`, `config` — checked before capability dispatch, both modes:

```json
{"schemaVersion":1,"ok":false,"error":{"code":"E_UNKNOWN_COMMAND","message":"unknown command \"install\" — removed by the workspace model v2; use oats sync","details":{"removed":"install","replacement":"oats sync"}}}
```

### `oats onboard [<dir>] --workspace <repo ref> [--json]` → `onboardApi: 2`

The **bootstrap** of a deployment (decision 9): realizes a workspace on this
machine in the taught `<name>-workspace/` layout. It writes
`<dir>/oats-local.yaml` (`{ schemaVersion: 2, workspace: <ref> }`), creates
`<dir>/agents/` (the instance homes), then runs exactly the `oats sync` body
over the directory just written — discover over the remotes, confirm
membership, resolve `packages:`, approve (TTY) or list what needs approval,
write `oats-lock.json`. It installs nothing, creates no soul, spawns nothing
and writes no `oats-config.yaml`; the member clones and the setup-expert spawn
are printed as next steps. `<dir>` defaults to cwd; `--dir <d>` is the same
argument (give it once). `--workspace` is required and must be a ref
`lib/remote.mjs` parses (`E_REPO_REF`) — checked **before** anything is
written. Captured selectors are refused (`E_BAD_ARGS`).

```json
{"onboardApi":2,
 "local":"/abs/acme-workspace/oats-local.yaml","dir":"/abs/acme-workspace","agents":"/abs/acme-workspace/agents",
 "lock":"/abs/acme-workspace/oats-lock.json",
 "sync":{"syncApi":1,"…":"the full sync report (next section)"},
 "hosting":{"host":"github.com/acme/agents","hostIsMember":true,
            "rule":"If any member is private, host oats-workspace.yaml in a private repo that is not a public member (a dedicated <org>/workspace repo); public contributors then use the standalone case (from: here capabilities + oats.core)."},
 "next":{"clone":[{"key":"github.com/acme/agents","name":"agents","url":"https://github.com/acme/agents.git","dir":"/abs/acme-workspace/agents-repo"},
                  {"key":"github.com/acme/platform","name":"platform","url":"https://github.com/acme/platform.git","dir":"/abs/acme-workspace/platform"}],
         "spawn":"oats spawn oats-setup-expert --dir /abs/acme-workspace"}}
```

- `sync` is the `syncApi: 1` report of the first sync (members, packages,
  changes, `approvalNeeded`, `problems`); `lock` is the lock it wrote.
- **Exit `2` with `ok: true`** when `sync.approvalNeeded` is non-empty (approval
  is interactive-only; tell the operator to run `oats sync --dir <dir>` in a
  terminal). Exit `0` otherwise.
- `hosting` states decision 26 (the kernel cannot see forge visibility, so it
  reports `hostIsMember` and the rule rather than judging).
- `next.clone[]` is one row per **confirmed** member (`url` = what the
  workspace's `members:` ref resolves to; `dir` = `<dir>/<name>`, or
  `<dir>/agents-repo` for a member called `agents`, since `agents/` is the
  instance homes). `next.spawn` is the setup-expert spawn command string.
- Errors (all `E_*`): `E_BAD_ARGS` (usage; missing `--workspace`; dir given
  twice), `E_REPO_REF`, `E_ALREADY_ONBOARDED { local, dir }` — **this**
  directory already has `oats-local.yaml` (an enclosing deployment's file does
  not count; run `oats sync` there instead), `E_ONBOARD_FAILED { dir }`
  (cannot inspect/write the directory; `<dir>` exists and is not a directory).
  Failures while **discovering** — `E_REMOTE_UNREADABLE`, `E_WORKSPACE_SCHEMA`
  (not a workspace host), `E_LOCAL_MISSING`, plus `E_PACKAGE_MISSING` /
  `E_PACKAGE_INTEGRITY` / `E_LOCK_SCHEMA` and the other `sync` errors raised
  before the workspace was read — roll back the files onboarding created and
  carry `details.rolledBack: true` and `details.dir`; a typo'd ref never
  leaves a half-onboarded directory that looks finished. Once the workspace
  has been read, a later failure keeps the files (a lock may exist) and
  carries `details.dir` + `details.local` instead.

### `oats sync [--dir <d>] --json` → `syncApi: 1`

Discovers, confirms membership, resolves `packages:` to commits, writes
`oats-lock.json` (lockfileVersion 3), reports. **Exit `2` with `ok: true`** when
the lock was written but approvals are pending (`approvalNeeded` non-empty);
approval is interactive-only, so a Desktop must tell the operator to run
`oats sync` in a terminal. Exit `0` otherwise.

```json
{"syncApi":1,
 "workspace":{"name":"acme","key":"github.com/acme/agents","url":"https://github.com/acme/agents.git","commit":"<oid>","observedAt":"<iso>",
              "local":"/abs/acme-workspace/oats-local.yaml","lock":"/abs/acme-workspace/oats-lock.json"},
 "members":[{"key":"github.com/acme/agents","name":"agents","commit":"<oid>","confirmed":true,"status":"confirmed","detail":null,"team":"global",
             "souls":["release-manager"],"capabilities":["acme-house-style"],"publishes":null},
            {"key":"github.com/acme/tools","name":"tools","commit":"<oid>","confirmed":true,"status":"confirmed","detail":null,"team":"engineering",
             "souls":["tools-expert"],"capabilities":["acme-tools-dev"],"publishes":{"package":"acme.tools","version":"0.4.0"}},
            {"key":"github.com/acme/billing","name":"billing","commit":"<oid>","confirmed":false,"status":"no-backlink","detail":"github.com/acme/billing@… has no oats-membership.yaml","team":null,
             "souls":[],"capabilities":[],"publishes":null}],
 "packages":[{"id":"oats.okf","version":"2.1.3","source":"catalog:oats.okf","commit":"<oid>","integrity":"sha256-…","capabilities":["oats.okf"],
              "approved":{"executables":"sha256-…","at":"<iso>"}},
             {"id":"acme.tools","version":"0.4.0","source":"git:github.com/acme/tools@v0.4.0","commit":"<oid>","integrity":"sha256-…","capabilities":["acme-deploy","acme-lint"],"approved":null}],
 "changes":[{"id":"acme.tools","from":null,"to":"0.4.0","commit":"<oid>","approvalNeeded":true}],
 "approvalNeeded":[{"id":"acme.tools","version":"0.4.0","commit":"<oid>","executables":"sha256-…",
                    "targets":["acme-deploy: command apply → bin/acme-deploy.mjs","acme-deploy: hook spawn → bin/acme-deploy.mjs"]}],
 "problems":[]}
```

- `members[].status`: `confirmed` | `not-listed` | `no-backlink` |
  `backlink-elsewhere` | `cannot-read`; `detail` explains an unconfirmed row.
  `publishes` reports a member's `oats-package/` (informational — its
  capabilities are **not** in `capabilities[]`; the non-collapse rule).
- `changes[]`: `from` = previously locked version or `null`; `to` = `null` when
  the package was dropped from `packages:` and from the lock.
- `approvalNeeded[].targets` are human-readable lines
  (`<cap>: command|hook <name> → <relpath>`); `executables` is the digest an
  approval would record.
- `problems[]`: `{ code, path, message, repoKey? }` — per-item discovery
  problems (`E_WORKSPACE_SCHEMA`, `E_TEAM_UNKNOWN`, `E_REMOTE_*`, …). Never an
  abort: an unreadable member directory is a problem of that member.
- Errors: `E_LOCAL_MISSING`, `E_WORKSPACE_SCHEMA { path, problems[] }`,
  `E_REMOTE_UNREADABLE`, `E_LOCK_SCHEMA`, `E_PACKAGE_MISSING` (catalog has no
  such id), `E_PACKAGE_INTEGRITY { why: "branch" | locked/observed }`,
  `E_PACKAGE_UNAPPROVED` (approval digest no longer matches),
  `E_PACKAGE_MANIFEST`, `E_REPO_REF`.

### `oats package add <id> <version|git:<repo>@<ref>> | remove <id> [--dir] --json`

Edits `packages:` **only** when `oats-workspace.yaml` is tracked by the Git
checkout walked up from `--dir`; otherwise reports the line to add.

```json
{"action":"add","id":"oats.aweb","value":"v1.11.2","previous":null,"edited":true,"file":"/abs/agents/oats-workspace.yaml"}
{"action":"add","id":"oats.aweb","value":"v1.11.2","edited":false,"file":null,"line":"packages:\n  oats.aweb: v1.11.2","hint":"oats-workspace.yaml is not in this checkout; commit the change in the workspace repo, then `oats sync`"}
```

`remove` → `{ action: "remove", id, value: null, previous: "<old value>", edited: true, file }`
on the tracked branch. On the untracked branch the shape is
`{ action: "remove", id, value: null, edited: false, file: null, line: null, hint }`
— **no `previous`** (nothing was read), `line: null` (there is no line to add
for a removal). **Both branches** answer `E_PACKAGE_MISSING { id, path? }` when
`<id>` is not declared in `packages:` — the untracked branch reads the file it
found to check the declaration even though it does not edit it. `E_USAGE`,
`E_WORKSPACE_SCHEMA` (bad id/value, or the edit would make the file invalid),
`E_REPO_REF`. No network.

### `oats workspace status [--dir] --json` → `workspaceStatusApi: 1`

```json
{"workspaceStatusApi":1,
 "workspace":{"name":"acme","key":"github.com/acme/agents","url":"…","commit":"<oid>","observedAt":"<iso>","local":"/abs/…/oats-local.yaml","teams":["global","engineering"]},
 "members":[ … same rows as sync … ],
 "packages":[ … same rows as sync (from the lock) … ],
 "declaredPackages":["acme.tools","oats.okf"],
 "unsynced":[],
 "stale":[],
 "approval":{"approved":["oats.okf"],"needed":["acme.tools"]},
 "external":[{"source":"git:github.com/oss-collective/experts@<oid>","soul":"security-reviewer","team":"unassigned"}],
 "problems":[]}
```

`unsynced` = declared in `packages:` but not in the lock (run `sync`);
`stale` = locked but no longer declared. Read-only: does not write the lock.

### `oats capabilities [--dir] --json` → `capabilitiesApi: 1` · `oats souls [--dir] --json` → `soulsApi: 1`

Every **non-private** item of every confirmed member, external souls, and
locked package capabilities, sorted by name then origin. `origin` is the
human string (`member <key> @ <8-char commit>` | `package <id> v<version>` |
`external <key> @ <commit>`); `kind` is the machine field. `team` is the label
or `"unassigned"`.

```json
{"capabilitiesApi":1,"workspace":{"name":"acme","key":"github.com/acme/agents","commit":"<oid>"},
 "capabilities":[
   {"name":"acme-house-style","origin":"member github.com/acme/agents @ 3f2a9c1e","kind":"member","repoKey":"github.com/acme/agents","commit":"<oid>",
    "team":"global","private":false,"path":"capabilities/acme-house-style","layer":null,"version":"0.0.0-workspace"},
   {"name":"oats.okf","origin":"package oats.okf v2.1.3","kind":"package","package":"oats.okf","version":"2.1.3","commit":"<oid>",
    "team":"unassigned","private":false,"approved":true}],
 "problems":[]}
```

```json
{"soulsApi":1,"workspace":{…},
 "souls":[
   {"name":"release-manager","origin":"member github.com/acme/agents @ 3f2a9c1e","kind":"member","repoKey":"github.com/acme/agents","commit":"<oid>",
    "team":"engineering","private":false,"path":"souls/release-manager","work":"worktree","description":"Cuts, verifies and announces releases."},
   {"name":"security-reviewer","origin":"external github.com/oss-collective/experts @ 9c4e1f2a","kind":"external",…}],
 "problems":[]}
```

Package capabilities of declared-but-unsynced packages are absent until `sync`.
(`soulsApi: 1` is also the integer of the existing `oats inspect --json`
declarations block; the two payloads are distinguished by their command.)

### `oats spawn <soul> … --preview --json` — additions (Preview API 2 unchanged)

On a workspace deployment the preview carries four extra top-level fields, and
`decision.resolution` binds the resolution revision (so a member that moved
between preview and apply is `E_DECISION_STALE`):

```json
{"modules":[
   {"name":"acme-release-tooling","from":{"kind":"member","repoKey":"github.com/acme/agents","commit":"<oid>"},"layer":null,"private":false,
    "changedSince":{"instance":"release-manager-v2","was":"<old oid>"}},
   {"name":"oats.okf","from":{"kind":"package","package":"oats.okf","version":"2.1.3","commit":"<oid>","integrity":"sha256-…","repoKey":"github.com/awebai/oats-okf"},
    "layer":"knowledge","private":false,"changedSince":false}],
 "team":"engineering",
 "resolution":"6e3050c0d005879441ab017d",
 "workspace":"github.com/acme/agents",
 "spawnPreviewApi":2,"preview":true,"agent":"release-manager","instance":"release-manager-cut","home":"/abs/…",
 "decision":{"instance":"…","home":"…","branch":"…","base":{…},"effective":{…},"resolution":"6e3050c0d005879441ab017d","revision":"<24 hex>"},
 "…":"every Preview API 2 field as before"}
```

- `modules[].from` is exactly the `from` recorded in `instance.json` on apply.
- `changedSince`: `null` (no previous instance of this soul), `false`
  (unchanged since the newest previous instance), or
  `{ instance, was }` (`was` = the previous commit, or `null` when the previous
  instance had no such module).
- `capabilities[]` / `skills[]` keep their Preview-1 meaning; on a workspace
  spawn the authoritative module set is `modules[]` (`capabilities[]` may be
  empty there, since capability rows are filled after materialization).
- `workspace` is the workspace host's canonical key, `team` the soul's label
  (or `null`), `resolution` the 24-hex revision `decision.resolution` binds.
- `--provider <cap> <key>=<value>` (repeatable; `a.b=c` nests) is accepted by
  preview and apply. `E_BAD_ARGS` for a malformed pair or when the deployment
  has no `oats-local.yaml`; `E_CAPABILITY_MISSING { capability, soul, modules[] }`
  when the soul does not resolve that capability. `byTeam` is a **reserved
  key**: legal only at the top level of the workspace file's `messaging:`;
  anywhere else in any payload layer (soul, `oats-local.yaml` `settings`,
  `--provider`, at any depth) it is `E_WORKSPACE_SCHEMA { reason: "reserved-key", path, key }`.
- Soul lookup: `E_SOUL_UNKNOWN { name, members[] }` (not among confirmed
  members or externals), `E_SOUL_AMBIGUOUS { name, repos[] }` (name it
  `<repo>/<soul>`). Resolution errors keep their codes (`E_NOT_A_MEMBER`,
  `E_MEMBERSHIP_UNCONFIRMED { repoKey, reason }`, `E_CAPABILITY_MISSING { hint? }`,
  `E_CAPABILITY_PRIVATE`, `E_PACKAGE_MISSING`, `E_PACKAGE_UNAPPROVED { id, version, commit }`,
  `E_SLOT_CONFLICT { slot, modules[], reason? }`, `E_SKILL_DUPLICATE { name, modules[] }`,
  `E_COMPATIBILITY { capability, package, version, range, why? }`).

The apply result (`oats spawn … --json`) is unchanged in shape; the new facts
live in the home's `instance.json`.

### `instance.json` — `modules`, `providers`, `workspace` (feature `instance-modules`)

Written by materialization inside the spawn transaction; read back by
`oats status --json` and the roster.

```json
{"modules":{
   "acme-release-tooling":{"from":{"kind":"member","repoKey":"github.com/acme/agents","commit":"<oid>"},
                           "commit":"<oid>","digest":"sha256-…","materializedAt":"<iso>"},
   "oats.okf":{"from":{"kind":"package","package":"oats.okf","version":"2.1.3","commit":"<oid>","integrity":"sha256-…","repoKey":"github.com/awebai/oats-okf"},
               "commit":"<oid>","digest":"sha256-…","materializedAt":"<iso>"}},
 "providers":{"acme-release-tooling":{},"oats.okf":{"owns":"release-manager","reads":["platform-engineer"],"state-dir":"/Users/ana/.oats/okf"}},
 "workspace":{"key":"github.com/acme/agents","commit":"<oid>","resolution":"<24 hex>","standalone":false,
              "soul":{"repoKey":"github.com/acme/agents","commit":"<oid>","team":"engineering"}},
 "capabilities":[{"id":"oats.okf","capability":"oats.okf","origin":"package:oats.okf@2.1.3","…":"one row per module"}]}
```

`workspace.standalone` is `true` when the instance was spawned from the
**standalone view** (decisions 10/25: a *member* whose workspace could not be
read — `workspace.key` is then the member repo's key, and `modules` holds the
soul's `from: here` capabilities plus `oats.core`); `false` for a workspace
spawn. The same view is marked `standalone: true` in `oats sync --json` (with
`workspace.name` = `standalone:<repo>`) and in the roster. `capabilities[]` is
the per-module row set (`toCapabilityRows`) that `oats inspect`/`status` read.

`digest` is the sha256 of the copied module tree (`<home>/.oats/modules/<cap>/`);
`providers.<cap>` is the merged payload (soul ⊕ `oats-local.yaml`
`settings.<cap>` ⊕ `--provider`), `{}` for a capability with none. Copies live at
`<home>/.oats/modules/<cap>/` and `<home>/.agents/skills/<cap>/<skill>/`.

### `oats status [--dir] --json` — module drift

On a workspace deployment the roster does one discovery and rewrites each
instance's `modules` from the recorded map into **drift rows**, and adds a
top-level `workspace` reachability field:

```json
{"root":"/abs/acme-workspace/agents",
 "agents":[{"name":"release-manager",…,"instances":[{"instance":"release-manager-cut",…,
   "modules":[
     {"name":"acme-release-tooling","from":{"kind":"member","repoKey":"github.com/acme/agents","commit":"<oid>"},"commit":"<oid>",
      "current":{"commit":"<new oid>"},"status":"moved"},
     {"name":"acme-house-style","from":{…},"commit":"<oid>","current":{"commit":"<oid>"},"status":"missing","reason":"capability-absent"},
     {"name":"oats.okf","from":{"kind":"package",…},"commit":"<oid>","current":{"commit":"<oid>","version":"2.1.3"},"status":"current"}]}]}],
 "workspace":{"reachable":true}}
```

- `status`: `current` | `moved` (member or locked package now at another
  commit) | `missing` with `reason`: `capability-absent` (gone from the member /
  package), `package-absent` (no longer locked), or the member's unconfirmed
  reason (`no-backlink`, `cannot-read`, `unconfirmed`, …; `current: null`).
- Package modules without a lock are reported `current`.
- Offline: `"workspace":{"reachable":false,"code":"E_REMOTE_UNREADABLE","reason":"E_REMOTE_UNREADABLE: network","message":"…"}`
  and `modules` stays the recorded map (no drift rows). A deployment without
  `oats-local.yaml` has no `workspace` field and `modules` as recorded.
- Text mode prints `modules: <cap> from <member|package …> @ <7-char>` lines
  for non-current modules (`--verbose` for all).

### Probe

```json
{"…":"…","features":["…","workspace-v2","instance-modules","spawn-provider-payload"],"workspaceApi":2}
```

A feature is listed only once the binary implements it. Gate `sync`/`package`/
`workspace status`/`capabilities`/`souls` on `workspace-v2`; gate reading
`instance.json.modules` and preview `modules[]` on `instance-modules`; gate
`--provider` on `spawn-provider-payload`.

## Instruction refresh (`oats session recompose`, feature `session-recompose`, OATS 0.24.8+)

A live instance's composed `AGENTS.md` is generated at spawn and outranks any
mail or tracked file *in the running context*. When a soul changes (a role or
budget amendment) and a respawn is not possible or wanted, an operator
refreshes the home in place:

- `oats session recompose --home <abs> [--dry-run] --json` → `{home, instance,
  agent, soulDir, contextDir, changed, dryRun, blocks[{source,file}], previous,
  note}`. Same composer spawn used, the home's own `soul` link and recorded
  context/work mode. `changed:false` is a no-op (no receipt). On change the
  prior text is retained as `previous` (`<home>/.oats-agents-md.<stamp>.previous`),
  `instance.json` gains `instructions[]`/`recomposedAt`, and a `recomposed`
  event is appended.
- **Nothing is signalled or restarted** — the harness re-reads on its own
  schedule; the receipt's `note` says so. Refuses a retiring home
  (`E_INSTANCE_RETIRING`), captured incarnations and capability-defined souls
  (`E_UNSUPPORTED_MODE`: those are refreshed by a new resolution / package).
- Gate on `features.includes("session-recompose")`. It is an **operator
  action** (the human or the instance's parent), never something a Desktop
  poll or an agent runs on itself.

## Mutations exposed to Desktop v1

The commands below use the same envelope. Additional capability operations
are described in [the operations contract](design/operations-contract.md).

### Existing-home launch and restart

```text
oats session start --home /absolute/home [--server id] \
  [--launch-config name] [--runtime pi|claude|codex] \
  [--model id] [--yolo|--no-yolo] --json
oats session restart --home /absolute/home [the same options] --json
```

Desktop addresses the exact existing home from the selected workspace's
roster. Restart is one kernel command. The kernel owns configuration
validation, stop observation, the lifecycle lock, launch recovery and session
metadata. Desktop does not implement restart by retiring and spawning.
Failure or timeout requires a fresh status check before retrying: a lost
response does not establish that launch failed.

For a remote home, its saved route supplies the execution host even if its
registration has subsequently changed. The remote kernel validates the new
configuration before stopping the current harness. A missing feature fails
before any stop/start command is sent.

### Launch configurations

```text
oats launch-config list [--dir /scope | --home /home | --soul name --agents-root /scope/agents] --json
oats launch-config set name --file /private/definition.json [--keep-env] --dir /scope --json
oats launch-config remove name --dir /scope --json
oats launch-config preview (--home /home | --soul name --agents-root /scope/agents --dir /scope) \
  [--launch-config name] [--runtime runtime] [--model id] [--yolo|--no-yolo] --json
```

All accept `--server id`. Scope edits follow the registration; inspection and
preview of an existing home follow its saved route. A local definition file
is serialized to SSH stdin and read on the host with `--file -`; the local
filename is never passed to the server as though it existed there.

The list result supplies `context`, `selected` and `configurations`. Each
configuration has a name, runtime, executable, literal argument array,
environment, model, permission choice and declaring `source`. Environment
literals appear as `{ "redacted": true }`; references appear as
`{ "fromEnv": "VARIABLE_NAME" }`. Optional executable/model/yolo fields can be
null. An editor must not write redaction markers back. `--keep-env`, with
`env` omitted from the replacement definition, copies the effective named
configuration's environment once into the complete replacement.

Preview is read-only and returns a redacted invocation plus `preflight`
checks. A successful inspection envelope can contain `result.ok: false`:
the selected launch is not ready. Desktop displays the failed checks rather
than treating successful inspection as permission to launch. Environment
references resolve on the execution host at launch, including subsequent
starts of the saved recipe. Editing a named definition does not change a
running instance or silently update its frozen launch recipe. Select the
configuration explicitly on a later start/restart to apply the new definition.

See [launch configuration syntax](configuration.md) and
[the Desktop start/restart workflow](desktop-instance-start.md).

### `oats spawn <agent> … --json`

`result` fields (always present):

| field      | type            | meaning                                    |
| ---------- | --------------- | ------------------------------------------ |
| `instance` | string          | new instance name                          |
| `agent`    | string          | soul/agent name                            |
| `home`     | string          | absolute instance home path                |
| `work`     | string          | work mode (worktree/checkout/attached/workspace/directory) |
| `branch`   | string \| null  | work branch when applicable                |
| `launched` | boolean         | whether a tmux window was started          |
| `warnings` | string[]        | non-fatal warnings (always an array)       |
| `tmux`     | {session,window} \| null | tmux target                       |

Additional informative fields: `repo`, `runtime`, `model`, `parent`,
`sibling` (explicit sibling cluster link when a root-level sibling relation
was declared, else null), `relation` (`child`/`sibling`/`parent` when a
relation was declared at spawn, else null), `spawnOrigin`, `attach`.

Stable error codes: `E_USAGE`, `E_NO_DEPLOYMENT`, `E_UNKNOWN_AGENT`,
`E_AMBIGUOUS_SOUL`, `E_PARENT_NOT_FOUND`, `E_RELATIVE_NOT_FOUND`,
`E_RELATIVE_AMBIGUOUS` (a `--relative-to`/`--parent` anchor name matches
multiple team instances — disambiguate with `--relative-root <agents-root>`
— or the chosen anchor is shadowed by a same-named instance so the lineage
edge would resolve wrongly), `E_BAD_ARGS`,
`E_SPAWN_FAILED`.

Dispatch-level failures (any `--json` command): `E_UNKNOWN_COMMAND` (no
kernel subcommand or capability namespace matches, or unknown capability
subcommand), `E_CAPABILITY_INACTIVE`, `E_CAPABILITY_BLOCKED` (untrusted),
`E_CAPABILITY_BROKEN`, `E_DUPLICATE_NAMESPACE`, `E_CONFIG_BROKEN` — all still
exactly one stdout envelope with a nonzero exit.

### Knowledge operations and OKF v2

Discover provider-declared operations rather than assuming a particular memory
format. The knowledge capability's version owns its result shape; CLI API v1
does not freeze the old OKF v1 `harvest: spawned|skipped` body for every provider.
See [knowledge](knowledge.md) for the prepared OKF 2.0.0 version scope.

```bash
oats operation run knowledge:inspect --home /absolute/source-home --json
oats operation run knowledge:harvest --home /absolute/source-home --json
```

The operation runner preserves the provider view/action through the ordinary
operations contract. Direct `oats okf inspect` returns the standard JSON-v1
success/error envelope. Its result includes:

- `summary`, durable `source`, frozen `owns`, `reads`, `bases`;
- `acceptedView` (the registered snapshot, not a fresh read), `status` with
  capture/processing/delivery/acceptance receipts, and `scheduler` diagnostics;
- `liveMemory: {available, reason, observedAt}` and labeled `documents`.

Live Markdown documents are `Working state (STATE.md)`, `Log (log.md)` and
sorted `Pending note: <relative-name>`, including nested notes. Missing files
are omitted; durable receipts follow as a text document. Only a live source
whose pointer/metadata still matches may supply live memory. Retired, missing,
reused or unverified homes return durable documents and explicit unavailability.
Unsafe live documents fail instead of returning a partial success. Inspection is
read-only and does not capture, refresh, schedule or launch a model.

The explicit preview limit is **256 KiB per document**, with `truncated: true`
and original `bytes` for larger files. Smaller files are byte-exact. The complete
JSON envelope drains stdout; consumers must not clip it at a small output-buffer
limit. Provider `read` returns full Markdown, not this inspection preview.

After the home disappears, operate from durable deployment context:

```bash
oats okf inspect --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
oats okf refresh --source /absolute/state/sources/UUID/source.json --soul domain-expert --json
```

Every descriptor-selected read/refresh creates its new view under that source's
state directory, not the invoking repository or a replacement home.

Direct `oats okf harvest --json` captures notes and record and requests an
independent directory worker. Representative result shapes (not exhaustive):

```json
{"status":"running","run":"<run-id>","instance":"<worker-instance>","home":"/absolute/worker-home"}
```

```json
{"status":"empty","processed":true}
```

An explicit `--no-launch` request can return `status: "ready"` without starting
a model; existing runs report their current status without starting duplicates.
Nonzero errors use the ordinary JSON-v1 error envelope. `running`/`ready` are not
successful knowledge delivery. Inspect and reconcile provider receipts; never
infer acceptance from a launch or from a worker disappearing.

Kernel envelope/dispatch tests live in `test/cli-json-contract.test.mjs`;
provider-specific behavior is qualified against the exported OKF runtime.
