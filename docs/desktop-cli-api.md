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
  it (`oats onboard` records `packaged-definition` or
  `exported-edition-copy`). Souls created before 0.24.7 or authored by hand
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

## Instance events (`oats instance events`, `eventsApi: 1`, OATS 0.24.8+) — K7

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

## Schedule run history (`scheduleApi: 2`, OATS 0.24.8+) — K8

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

`oats version --json` `features` now lists: `catalog`, `instance-git`,
`instance-git-remote`, `souls-declarations`, `lifecycle-plans`,
`retire-retention`, `readiness`, `spawn-preview`, `instance-events`,
`schedule-history`, and carries the API integers (`instanceGitApi`, `soulsApi`,
`lifecycleApi`, `readinessApi`, `spawnPreviewApi`, `eventsApi`,
`scheduleHistoryApi`). **Gate on these, never on a version string and never by
optimistic invocation**: an older CLI ignores an unknown `--plan` on `retire`
and *retires*. Absent feature → the view is unavailable.

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
