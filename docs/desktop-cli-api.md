# Desktop CLI API

The JSON contract between the `oats` CLI and the OATS Desktop.

## Scope

The Desktop never imports kernel code. Its server runs a discovered `oats`
binary with `execFile` (absolute path, argv, no shell) and decodes the JSON it
prints, strictly. This page describes one current shape per command, as the
kernel emits it.

- **Versioning is by capability, never by version string.** The probe lists
  `features` and per-API integers. Gate every read and mutation on them; an
  absent feature means the kernel cannot do it.
- **A document carries its own integer** where one exists (`operationsApi`,
  `readinessApi`, `eventsApi`, …). Dispatch on the payload's integer.
- **The envelope is authoritative over this prose.** If a captured payload
  and this page disagree, this page is the bug.
- **Shapes are closed.** The Desktop decodes many documents with exact key
  sets, so a new key is a contract change and is announced here first.

Conventions: paths are absolute; a `commit` is a full 40-hex id; `integrity`
and `digest` are `sha256-<hex>`; times are ISO-8601 UTC; repository keys are
canonical (`github.com/<org>/<repo>`, or `local/<abs-path>`). Examples use
`/w` as the deployment and shorten ids and digests with `…`.

## The probe

`oats version --json` prints one object (not an envelope):

```json
{"schemaVersion":1,"name":"@awebai/oats","version":"0.30.0","desktopApi":1,
 "harnesses":["pi","claude","codex"],"sessionBackends":["tmux"],"launchOptions":["yolo"],
 "remote":["spawn","retire","status","session","session-start","session-restart","launch-config","roster","harvest","schedule","session-upload","operations",
           "readiness","instance-events","instance-git","lifecycle-plans"],
 "features":["retire-home","session-start","session-restart","launch-config","schedule","session-upload","operations","instance-git",
             "instance-git-remote","souls-declarations","lifecycle-plans","retire-retention","readiness","spawn-preview","instance-events",
             "instance-events-2","schedule-history","schedule-read-2","spawn-preview-2","spawn-idempotency","spawn-idempotency-2","spawn-apply-2",
             "workspace-v2","instance-modules","spawn-provider-payload","served-identity","packages-no-approval","spawn-name","settings-origins",
             "team-model-2","settings-declared","capabilities-private","layers-from","harness","package-souls","triggers","automations","desktop-facts","launch-preference",
             "preview-composed-from","observe-max-age"],
 "automationsApi":1,"workspaceApi":2,"instanceGitApi":1,"spawnApplyApi":1,"soulsApi":2,"lifecycleApi":1,
 "readinessApi":2,"spawnPreviewApi":2,"eventsApi":2,"scheduleHistoryApi":3,"scheduleApi":2,"operationsApi":2}
```

- The Desktop accepts `desktopApi === 1` and a released `version` inside
  `ACCEPT_RANGE` (`packages/desktop/cli-locator.mjs`); a prerelease is never
  accepted. The real gate is the feature list; its minimum is
  `packages-no-approval`.
- `harnesses` is what `--harness` accepts; `sessionBackends` what `--backend`
  accepts: `["tmux"]` since 0.31.0, when Herdr was removed (`--backend herdr`
  is refused with `E_HERDR_REMOVED`). A host without the `harness` feature
  lists `runtimes` instead.
- `remote` is the routed surface: the commands `--server <id>` sends to a
  registered server, plus `roster`. The Desktop checks the execution host's
  probe before a routed mutation. From 0.31: `readiness`, `instance-events`,
  `instance-git` and `lifecycle-plans` name the
  [routed reads and plans](#routed-reads-and-plans).
- In text mode the command prints `@awebai/oats <version> (desktop API v1)`.

### Features

| Feature | What it enables | API number |
|---|---|---|
| `retire-home` | `oats retire <instance> --home <abs>` | |
| `session-start`, `session-restart` | `oats session start/restart --home` | |
| `launch-config` | `oats launch-config …`; the selection flags on start and restart | |
| `schedule` | `oats schedule …` | `scheduleApi: 2` |
| `session-upload` | `oats session upload` (and the host's `session receive`) | |
| `operations` | `oats operation run`; `operations[]` in inspect | `operationsApi: 2` |
| `instance-git`, `instance-git-remote` | `oats instance git/diff`; the observation's `remote` | `instanceGitApi: 1` |
| `souls-declarations` | `souls[].declarations` in inspect | `soulsApi: 2` |
| `lifecycle-plans`, `retire-retention` | stop and retire plans and guarded applies; retire keeps a worktree | `lifecycleApi: 1` |
| `readiness` | `oats readiness` | `readinessApi: 2` |
| `spawn-preview`, `spawn-preview-2` | the no-write preview with a bound `decision` (gate on `-2`) | `spawnPreviewApi: 2` |
| `spawn-apply-2` | `--expect-decision` apply | `spawnApplyApi: 1` |
| `spawn-idempotency`, `spawn-idempotency-2` | `--idempotency-key`; recovery before placement (gate on `-2`) | `spawnApplyApi: 1` |
| `instance-events`, `instance-events-2` | the bounded events read (gate on `-2`) | `eventsApi: 2` |
| `schedule-history`, `schedule-read-2` | run history with identity and provenance (gate on `schedule-read-2`) | `scheduleHistoryApi: 3` |
| `workspace-v2` | `onboard`, `sync`, `package`, `workspace status`, `capabilities`, `souls` | `workspaceApi: 2` |
| `instance-modules` | `instance.json` `modules`/`providers`/`workspace`; module drift in status; preview `modules[]` | |
| `spawn-provider-payload` | `oats spawn … --provider <cap> <key>=<value>` | |
| `served-identity` | `decision.effective.providers`; the served `identity` in inspect and status | |
| `packages-no-approval` | no package approval anywhere | |
| `spawn-name` | `oats spawn --name <slug>` | |
| `settings-origins` | preview `settingsOrigins` | |
| `settings-declared` | `declares` on inspect capabilities and preview modules | |
| `capabilities-private` | `private` on `oats capabilities` rows | |
| `layers-from` | `layers.<slot>.from` in inspect | |
| `team-model-2` | every team field; `oats teams`, `oats soul teams` | `teamsApi: 1`, `soulTeamsApi: 1` (payload only) |
| `harness` | the harness names ([Harness input spellings](#the-harness-rename-feature-harness-oats-0270)) | |
| `package-souls` | package soul rows, `qualifiedName`, `packages[].souls` | |
| `triggers` | `oats trigger …` | `triggerApi: 1` (payload only) |
| `automations` | workspace triggers and schedules; `oats automations refresh` | `automationsApi: 1` |
| `desktop-facts` | the facts under [Desktop facts](#desktop-facts-feature-desktop-facts-oats-0290) | |
| `launch-preference` | soul and local launch preferences; `launch`, `launchCurrent`, `launchFrom`; `--reselect-launch`; `key` on soul and agent rows ([Launch preferences](#soul-launch-preferences-feature-launch-preference-oats-0300)) | |
| `preview-composed-from` | `composedFrom` on preview `modules[]` ([Composition](#the-preview)) | |
| `observe-max-age` | `--max-age <s>` on the read verbs and their `observation` block ([Observation reuse](#observation-reuse-feature-observe-max-age-oats-0303)) | |

Payload-only integers, never in the probe: `onboardApi: 2`, `syncApi: 1`,
`workspaceStatusApi: 1`, `capabilitiesApi: 1`, the `oats souls` document's
`soulsApi: 1`, `teamsApi: 1`, `soulTeamsApi: 1`, `triggerApi: 1`.

**Gate on the probe, never by trying.** An older kernel can ignore an unknown
flag and act: without `lifecycle-plans`, `retire --plan` retires.

## The envelope and dispatch errors

Every `--json` command except those below prints exactly one JSON object on
stdout (progress goes to stderr):

```json
{"schemaVersion":1,"ok":true,"result":{}}
```

```json
{"schemaVersion":1,"ok":false,"error":{"code":"E_BAD_ARGS","message":"--home needs an absolute instance home"}}
```

- Success exits 0, failure nonzero. `error.details` is present only when the
  command has details.
- Either envelope may carry `warnings: [ … ]`, only when there is something
  to say. The one warning is `deprecated-runtime-name`
  ([Harness input spellings](#the-harness-rename-feature-harness-oats-0270));
  in text mode it is an `oats: warning: …` line on stderr.
- `<kernel command> --help --json` answers `{command, usage}` and runs
  nothing.

| Not an envelope | stdout |
|---|---|
| `oats version --json` | the probe |
| `oats status --json` | the [roster document](#the-roster-oats-status---json) |
| a first `oats retire --json`, and a deferred self-retire | the raw [retire receipt](#retire) |

<a id="flags"></a>
### Flag syntax

A kernel command reads `--flag=value` exactly as `--flag value` (the value is
everything after the first `=`). `E_BAD_ARGS` for an empty `--flag=`, a value
on a switch (`--yolo=false` never turns yolo on) and a value that is itself an
option (`--model=--yolo`). A capability command's own flags are forwarded as
typed; the kernel reads only its dispatch flag (`--soul`). There is no feature
string for this: to support older kernels, use the spaced form.

### Dispatch errors

| Code | When |
|---|---|
| `E_UNKNOWN_COMMAND` | No kernel command or capability namespace matches; an unknown capability subcommand; a [removed verb](#removed-verbs-and-flags) (`details: {removed, replacement}`) |
| `E_CAPABILITY_INACTIVE` | In a home: the namespace's module is not one of the home's recorded capabilities |
| `E_CAPABILITY_BLOCKED` | In a home: the manifest claiming the namespace is not a workspace module copy of that home. There is no package trust gate |
| `E_CAPABILITY_BROKEN` | The manifest command is not a non-empty string, its script is missing or outside the module, or the dispatcher failed |
| `E_DUPLICATE_NAMESPACE` | Two modules claim the namespace |
| `E_CONFIG_BROKEN` | The home's `instance.json` or the deployment's configuration cannot be read |
| `E_LOCAL_MISSING` | No `oats-local.yaml` in reach of `--dir` or the working directory |
| `E_UNSUPPORTED_MODE` | A home or selector the kernel no longer runs (below) |

<a id="ssh-failures-e_ssh"></a>
### ssh failures (`E_SSH`)

A routed command (`--server`, and `oats server check`) reports ssh's own
failure as `E_SSH`, message `ssh to <host> failed: …`:

- `error.details` is `{"sshStarted": false}` when ssh never started on this
  machine (not installed, not executable): nothing reached the host, and
  retrying cannot help.
- No `details`: ssh ran and the link failed (unreachable host, refused key,
  lost connection, timeout); a retry may succeed.

(0.31.0; before it `E_SSH` never carried details.)

Capability dispatch inside a home uses the home's module copies; from a
deployment it resolves the module as `oats spawn --soul <x>` would and runs it
with the soul's merged payload. `oats <namespace> --help --json` answers
`{capability, namespace, command, commands, description, help}`.

`E_UNSUPPORTED_MODE` covers a home with no recorded `modules` (re-spawn it), a
captured home (`details: {home, captured: true}`), the selectors
`--deployment`, `--resolution` and `--artifact-set` (`details.selector`), and
an inherited `OATS_DEPLOYMENT` or `OATS_RESOLUTION` (`details.inherited`).
`oats version` and `oats retire` still work. `oats status --json` names such
homes in `problems[]`: `legacy-captured-home {code, instances, homes,
message}` and `legacy-local-agents {code, dirs, instances, message}`.

<a id="observation-reuse-feature-observe-max-age-oats-0303"></a>
### Observation reuse (feature `observe-max-age`, OATS 0.30.3)

Every read asks each remote for its current head (`git ls-remote`). With
`--max-age <seconds>` a read verb reuses a head this machine observed at most
that many seconds ago instead, so a refresh right after another costs no
network round trip. Gate the flag on the feature: an older kernel may ignore
it and answer live, without the block.

```text
oats status | workspace status | souls | capabilities | inspect --soul|--home
     | teams | soul teams <soul>   … --max-age <seconds> --json
```

- **Values:** whole seconds, `0` to `86400`. `0` is live: it reuses nothing.
  Anything else is `E_BAD_ARGS` (`--max-age needs a value: whole seconds from 0
  to 86400`, `--max-age takes whole seconds from 0 to 86400, got "<v>"`).
- **The block:** with the flag (`0` included) the document gains one key,
  `observation: {observedAt, reused, localRevision}`: in the result of an
  envelope, at the top level of the roster (after `agents`). `observedAt` is the
  OLDEST remote head the answer used, so the answer is at least that fresh
  everywhere; `reused` is `true` when any head came from an earlier observation.
  A command that read no remote head reports the time it started and
  `reused: false`. Without the flag the key is absent and every document is
  exactly as before.
- **`localRevision`:** 24 lowercase hex characters, opaque. It digests every
  piece of local configuration the kernel read for this answer:
  `oats-local.yaml` (and each closer `oats-local.yaml` it looked for and did
  not find), `oats-lock.json`, an `OATS_PACKAGE_CATALOG` file, and the
  automations snapshot. Only what the verb actually read counts. The same inputs
  give the same revision; any byte change, or one of those files appearing or
  disappearing, gives another. It names no path and no content. Different verbs
  read different inputs (`workspace status` also reads the automations
  snapshot; `inspect --home` reads no lock), so compare revisions of the same
  verb and arguments only. Keep what you
  hold (catalogs, inspect results) keyed on it: a different revision means the
  deployment's configuration changed outside you (a `teams` edit, a sync, a
  hand edit). A kernel upgrade shows through the probe (`oats version --json`),
  not through `localRevision`: the bundled catalog is not an input. Instance
  homes, member clones and tmux are not inputs either, because the answer
  itself reports them.
- **What is reused:** only remote heads (the commit a branch or tag named),
  never local state. Instances, `oats-local.yaml` and the lock are read afresh
  by every command. A member's backlink (`oats-membership.yaml`) is read at
  the member's observed head, which may be a reused one: a backlink removed
  less than `<s>` seconds ago can still show the member `confirmed` under
  `--max-age <s>`. Only the backlink's comparison with this workspace is made
  afresh. A reused head's
  `observedAt` (for example `workspace.observedAt` in `workspace status`) is
  the time it was observed, not now.
- **When a head is not reused:** it is older than the flag allows (or dated
  more than 5 s in the future); it was observed through a different URL
  spelling of the same repository (ssh vs https) or for a different ref; its
  commit can no longer be fetched. Each is observed live, as without the flag.
  A live observation that fails is the usual error, never an older head.
- **Refusals:** every other command, every edit form (`teams add|remove|default`,
  `soul teams --add|--remove|--default|--clear-default`) and any `--server`
  invocation refuse the flag before reading or writing anything, with
  `E_BAD_ARGS` "--max-age is not accepted by \`oats <form>\`: only the read
  verbs reuse observations (status, workspace status, souls, capabilities,
  inspect --soul|--home, and the read forms of teams and soul teams)" and,
  with `--server`, "--max-age cannot be combined with --server: observation
  reuse is local to this machine".
  A capability command's argv (`oats <namespace> …`) is its provider's: the
  kernel neither reads nor refuses `--max-age` there.

The observations are kept under the remote cache
(`$OATS_REMOTE_CACHE`, default `~/.cache/oats/remotes`), in `.observed/`,
beside the bounded parsed-read cache in `.parsed/`. An observation record
keeps a digest of the fetch URL, never the URL. A parsed entry keeps repository
content as committed (member refs included), and a value that carries a
credential-bearing URL (userinfo on http(s), or `user:password@` on any
scheme) is never written. Deleting either is always safe.

<a id="inspect-readiness-and-operation-run-on-the-workspace-model-operationsapi-2-soulsapi-2-readinessapi-2-oats-0260"></a>
## Inspect, readiness and operation run

These answer about one **subject**: an instance home (`--home <abs>`) or a
soul of a deployment (`--soul <name> [--dir <d>]`).

| Command | Integer |
|---|---|
| `oats inspect --json` | `operationsApi: 2`; each `souls[]` row `soulsApi: 2` |
| `oats readiness --json` | `readinessApi: 2` |
| `oats operation run --json` | `operationsApi: 2` |

**Addressing.**
- `--home` reads the home's `instance.json` and its module copies under
  `<home>/.oats/modules/`. The home must be
  `<deployment>/agents/<soul>/instances/<name>` with
  `<deployment>/oats-local.yaml` exactly there, else `E_HOME_MISMATCH
  {home, expected}`. A `--dir`, `--agents-root` or `--soul` that disagrees
  with it is `E_HOME_MISMATCH`. An unreadable home is `E_SESSION_UNKNOWN`; a
  home without `modules`, or a captured one, is `E_UNSUPPORTED_MODE`.
- `--soul` resolves the soul exactly as a spawn would (discovery, the soul's
  `capabilities:` plus workspace defaults, the lock). No `oats-local.yaml` is
  `E_LOCAL_MISSING`; an `--agents-root` other than `<deployment>/agents` is
  `E_SOUL_UNKNOWN`.
- Neither is `E_BAD_ARGS`. `PI_AGENTS_ROOT` is ignored.

A module's origin (`from`) is `{kind: "member", repoKey, commit}` or `{kind:
"package", package, version, commit, integrity, repoKey}`.

<a id="oats-inspect---home-----soul----dir----json--operationsapi-2"></a>
### `oats inspect`

```text
oats inspect (--home <abs> | --soul <name> [--dir <d>]) [--max-age <s>] --json
```

An instance subject, abridged:

```json
{"operationsApi":2,"kernel":"0.30.0",
 "subject":{"kind":"instance","instance":"rm-1","home":"/w/agents/rm/instances/rm-1","soul":"rm"},
 "workspace":{"key":"github.com/nw/agents","name":"northwind","deployment":"/w","commit":"66566512…","standalone":false},
 "souls":[{"soulsApi":2,"name":"rm","repoKey":"github.com/nw/agents","commit":"66566512…","kind":null,"path":null,
   "description":"Cuts releases.","work":"worktree","harness":null,"model":null,
   "declarations":{"requires":null,"defaults":null,"knowledge":{"owns":"rm","reads":[]},"resources":null,"children":null,"capabilities":{"oats.okf":{"from":"package"}}},
   "declarationProblems":[],"instructions":{"file":"/w/agents/rm/souls/66566512168e/AGENTS.md","text":"# rm\n","truncated":false}}],
 "layers":{"knowledge":{"id":"oats.okf","from":"workspace"},"messaging":{"id":null,"from":null},"tasks":{"id":null,"from":null}},
 "capabilities":[{"id":"oats.okf","version":"2.1.3","layer":"knowledge","command":"okf",
   "from":{"kind":"package","package":"oats.okf","version":"2.1.3","commit":"ab897841…","integrity":"sha256-bada35…","repoKey":"github.com/awebai/oats-okf"},
   "composedFrom":null,"dir":"/w/agents/rm/instances/rm-1/.oats/modules/oats.okf","settings":{"owns":"rm","reads":[]},
   "declares":["state-dir"],"compatibility":{"ok":true,"range":">=0.24.0","kernel":"0.30.0"},"missingRequires":[],
   "operations":[{"name":"status","kind":"view","command":"status","context":"home","description":"Knowledge status","args":[],
                  "argv":["okf","status"],"available":true,"reason":null}]}],
 "capabilitiesOff":[],
 "teams":[{"label":"eng","team":null,"default":true,"from":"shared"},{"label":"mine","team":"mine:ana.aweb.ai","default":false,"from":"local"}],
 "defaultTeam":{"label":"eng","team":null,"from":"soul"},"teamsSource":"live",
 "recordedDefaultTeam":{"label":"eng","team":null,"from":"soul"},
 "knowledge":{"provider":"oats.okf","version":"2.1.3","operations":[{"name":"status","kind":"view","available":true,"reason":null}]},
 "instance":{"home":"/w/agents/rm/instances/rm-1","instance":"rm-1","agent":"rm","harness":"pi","model":null,"yolo":null,"launched":false,
   "createdAt":"2026-09-28T10:08:01.281Z","resolution":"abacbdb5a7975098d77007c8","soulDir":"/w/agents/rm/souls/66566512168e",
   "instructions":{"file":"/w/agents/rm/instances/rm-1/AGENTS.md","text":"…","truncated":false,
                   "sources":[{"source":"capability:oats.okf","file":"/w/agents/rm/instances/rm-1/.oats/modules/oats.okf/injects/okf.md"}]}},
 "identity":null,
 "problems":[]}
```

| Key | Meaning |
|---|---|
| `subject` | `{kind: "instance", instance, home, soul}` or `{kind: "soul", soul, repoKey, commit}` |
| `workspace` | `{key, name, deployment, commit, standalone}`; for a home, `name` is the recorded name (`null` if the spawn predates it) |
| `souls` | exactly the subject's soul |
| `layers` | `{knowledge, messaging, tasks}`, each `{id, from}` |
| `capabilities`, `capabilitiesOff` | the resolved modules (by id) and the ones the soul turned off |
| `teams`, `defaultTeam`, `teamsSource`, `recordedDefaultTeam` | [Where teams appear](#where-teams-appear); `recordedDefaultTeam` is home only |
| `knowledge` | `{provider, version, operations: [{name, kind, available, reason}]}` for the knowledge slot (`null`s and `[]` when empty) |
| `instance` | `null` for a soul; the home's facts above. `instructions.sources` lists each composed inject in order |
| `identity` | home only (absent for a soul): the served identity a messaging provider recorded, `{…, provider}`, or `null` |
| `problems` | below |

**Soul row** (`soulsApi: 2`). For a home it is read from the recorded
`soulDir` (`path` and `kind` are `null`); for a soul it is the member's current
definition (`kind` is `member` or `external`, `path` inside the member).
`declarations` is `{requires, defaults, knowledge, resources, children,
capabilities}`, each the soul.yaml section as written or `null`.
`instructions` is `{file, text, truncated}` of the soul's `AGENTS.md`, or
`null` before a spawn has copied the soul. `declarationProblems` holds
`soul-declarations-unreadable` when soul.yaml does not parse.

**Layers.** `id` is the capability filling the slot or `null`. `from`
(feature `layers-from`) is `"soul"` or `"workspace"`, `null` for an empty slot
or a home spawned before it was recorded.

**Capability rows.**
- `dir` is the home's module copy, `null` for a soul.
- `composedFrom` (feature `desktop-facts`): `"workspace"` or `"soul"` for a
  soul subject; `null` for a home.
- `settings` is the merged provider payload; `declares` (feature
  `settings-declared`) the manifest's setting keys, sorted.
- `compatibility` is `{ok, range, kernel}` (`range` is the manifest's
  `compatibility.oats` or `null`). A soul's resolution refuses an incompatible
  module, so `ok: false` appears only for a home.
- `missingRequires`: `{command, why, install}` for each manifest `requires`
  command absent from `PATH`.
- `operations[]`: the declared operation (`name`, `kind`, `command`,
  `context`, `description`, `args`) plus `argv`, `available` and `reason`
  (for example a missing command, or a `context: "home"` operation on a soul).

**`capabilitiesOff[]`** (feature `desktop-facts`): `{id, off: true, from:
"soul", reason, slot?, overrides}`, sorted by id. `reason` is `"off"` (the
soul wrote `<id>: off`) or `"slot-none"` (the soul wrote `<slot>: none`,
emptying the slot the workspace filled with `<id>`). `overrides` is the layer
whose default was turned off (`"workspace"`). `[]` for a home.

**Problems:** `soul-declarations-unreadable`, `module-manifest-invalid`,
`module-missing {capability}`, `capability-incompatible {capability, range,
kernel}`, and for a home whose discovery failed, that error's `{code,
message}`.

A soul whose resolution is refused is an inspect error with the resolver's
code and details (`E_PACKAGE_MISSING`, `E_PACKAGE_INTEGRITY`,
`E_CAPABILITY_MISSING`, `E_LOCK_SCHEMA`, `E_REQUIREMENT_INACTIVE`,
`E_TEAM_UNKNOWN`, `E_TEAM_NOT_ELIGIBLE`); readiness reports the same condition
as an item. Soul lookup errors are those of [spawn](#spawn-errors).

<a id="oats-readiness---home-----soul----dir----policy---json--readinessapi-2"></a>
### `oats readiness`

```text
oats readiness (--home <abs> | --soul <name> [--dir <d>]) [--policy] --json
```

```json
{"readinessApi":2,
 "subject":{"kind":"soul","soul":"rm","repoKey":"github.com/nw/agents","commit":"66566512…"},
 "selector":{"kind":"soul","soul":"rm","agentsRoot":null,"dir":"/w"},
 "at":"2026-09-28T10:07:57.549Z",
 "checks":{
  "installed":{"status":"pass","items":[{"subject":"oats.okf","status":"pass","required":true,"reason":null,"producer":"workspace resolution",
    "evidence":{"from":{"kind":"package","package":"oats.okf","version":"2.1.3","commit":"ab897841…","integrity":"sha256-bada35…","repoKey":"github.com/awebai/oats-okf"}},
    "remedy":null,"capability":{"id":"oats.okf"}}]},
  "configured":{"status":"not-applicable","items":[]},
  "member":{"status":"pass","items":[{"subject":"member github.com/nw/agents","status":"pass","required":true,"reason":null,
    "producer":"workspace discovery","evidence":{"repoKey":"github.com/nw/agents","workspace":"github.com/nw/agents","commit":"66566512…"},"remedy":null}]},
  "providers":{"status":"fail","items":[{"subject":"oats.okf","status":"fail","required":true,"reason":"setting state-dir is required",
    "producer":"provider binding check","evidence":null,"remedy":null,
    "result":{"status":"needs-configuration","problems":[{"code":"needs-configuration","message":"setting state-dir is required"}],"warnings":[]},
    "capability":{"id":"oats.okf"}}]}},
 "summary":{"ready":false,"required":3,"pass":2,"fail":1,"unknown":0,
   "byCapability":[{"capability":{"id":"oats.okf"},"checks":{"installed":"pass","configured":"not-applicable","member":"not-applicable","providers":"fail"},"ownReady":false,"ready":false}],
   "subjectBlockers":[]},
 "notes":["ready means every REQUIRED check passes; it is never inferred from an empty set"]}
```

- `selector` echoes the arguments byte-exact: `{kind: "soul", soul,
  agentsRoot, dir}` or `{kind: "home", home, soul, agentsRoot}`.
- Four checks, each `{status, items}`. An item is `{subject, status,
  required, reason, producer, evidence, remedy}`, plus `capability: {id}` on a
  per-capability item and the keys named below. Statuses are `pass | fail |
  unknown | not-applicable`.
- A check's status rolls up its required items (any `fail` → `fail`, else any
  `unknown` → `unknown`, else `pass`; `not-applicable` with none required).
- `summary.ready` is true when every required item passes or is
  not-applicable and at least one required item exists; the counts are over
  required items. `byCapability[]` is `{capability, checks, ownReady,
  ready}` (`ready` also needs no subject blocker). `subjectBlockers[]` is
  `{check, subject, status}` for each failing required item not about a
  capability. `notes` is prose.

**`installed`**, one item per module with `evidence: {from}`. `--home`
(producer `instance modules`): passes when the home's copy holds `oats.json`
(remedy on failure: spawn a new instance). `--soul` (producer `workspace
resolution`): each resolved module. A resolution refusal is one failing item about the soul
with `code`, the message as `reason`, the details as `evidence` and a remedy
naming `oats sync`; team refusals go under `configured` instead.

**`configured`.** Producer `capability manifest`: each manifest `requires`
command, `evidence: {command}`, the manifest's `install` hint as remedy.
Producer `team model`: the soul's [team readiness items](#team-readiness-items).

**`member`** (producer `workspace discovery`): the soul's repository is a
confirmed member (`evidence: {repoKey, workspace, commit}`); `fail` when not
(the remedy names `oats-membership.yaml`); `unknown` when the workspace could
not be read. External souls and standalone views are `not-applicable`,
`required: false` (a standalone item carries `evidence.standaloneReason`).

**`providers`** (producer `provider binding check`): for each module whose
manifest declares `binding`, the kernel runs its `binding.check` and relays
the answer as `item.result: {status, problems, warnings}`. The request,
environment and validation are in
[capabilities.md](capabilities.md#readiness-check-bindingcheck).

| `result.status` | item `status` |
|---|---|
| `ready` | `pass` |
| `needs-configuration`, `authorization-required` | `fail` |
| `unavailable` | `unknown` |

- `reason` is the first problem's message. `warnings` is always present and
  never changes the status.
- A provider that cannot answer is `unknown` with `result: null` and
  `item.problems: [{code, message}]`: its refusal code,
  `provider-unavailable`, `resource-not-found` (the check executable is not a
  regular file in the module, or a member module checked from `--soul`),
  `provider-not-qualified`, or a module-store error.
- One budget per read: 60 s total, 30 s per check; an unreached check is
  `unknown` with `time-budget-exhausted`.

**`--policy`** adds `policy` and a note:

```json
{"childSpawns":{"allowed":true,"enforced":true,"origin":{"kind":"default","detail":"no recorded policy: children allowed (pre-0.24.8 instance)"}},
 "worktrees":{"allowed":false,"mode":"directory","enforced":true,"origin":{"kind":"work-mode","detail":"work: directory"}}}
```

With `--home` it is the recorded, enforced policy; with `--soul`, the soul's
declaration (`children.spawn`, `work`) with `enforced: false`. The spawn route
enforces `childSpawns`: a child spawn under a parent whose policy is off is
`E_CHILD_SPAWNS_DISABLED {parent, policy}`, before anything is created.

### `oats operation run`

```text
oats operation run <layer>:<name> (--home <abs> | --soul <name> [--dir <d>]) [--arg k=v …] --json
```

```json
{"operationsApi":2,"operation":"knowledge:status","capability":"oats.okf","version":"2.1.3","argv":["okf","status"],
 "cwd":"/w/agents/rm/instances/rm-1","target":{"home":"/w/agents/rm/instances/rm-1","instance":"rm-1"},
 "result":{"documents":[{"label":"Working state","kind":"markdown","text":"…"}]}}
```

- `<layer>` is `knowledge`, `messaging` or `tasks`; `<name>` matches
  `[a-z][a-z0-9-]*` (`E_BAD_ARGS` otherwise).
- The provider is the module filling the slot. `cwd` is the home for a
  `context: "home"` operation, else the deployment; `target` is `{home,
  instance}` or `null`.
- A launched `instance` or `home` named by the provider's result is repeated
  at the top level; `stderr` appears when the provider wrote any.
- A `view` operation must answer `{documents: [{label, kind?, path?, text?}]}`
  (`kind` `markdown` or `text`), else `E_OPERATION_RESULT`.
- Errors: `E_OPERATION_UNKNOWN`, `E_OPERATION_UNAVAILABLE` (empty slot, or a
  home operation without `--home`), `E_CAPABILITY_REQUIRES`, `E_BAD_ARGS`
  (undeclared or missing `--arg`), `E_CAPABILITY_BROKEN`. A provider's `ok:
  false` is relayed with its code and `details: {exit, envelope,
  unconfirmed?}`. `E_OPERATION_TIMEOUT` (240 s) and `E_OPERATION_RESULT` are
  unconfirmed outcomes: `details: {exit, signal, unconfirmed: true,
  envelope?, stderr?, cleanup?}`.

`--server <id>` routes inspect and operation run when the destination
advertises `operations`.

**Knowledge operations.** Discover a knowledge provider's operations from
inspect; the provider's version owns their result shapes. For oats.okf, see
[knowledge.md](knowledge.md#knowledge-operations).

<a id="workspace-model-workspaceapi-2"></a>
## Workspace

Feature `workspace-v2`, `workspaceApi: 2`. Model: [workspaces.md](workspaces.md).

- Each command needs an `oats-local.yaml` found walking up from `--dir`, else
  `E_LOCAL_MISSING {dir, searched}`.
- The workspace is read over Git remotes with the operator's credentials,
  never prompting: `E_REMOTE_UNREADABLE {url, reason: "auth" | "not-found" |
  "network" | "timeout"}`.
- There is no package approval: declaring a package is the trust decision.
  No payload carries `approvalNeeded`, `approval` or `approved`.
- A **standalone view** is a member repository whose workspace is not read
  (`standalone:` in `oats-local.yaml`, or an unreadable host): its own souls
  plus `oats.core`. Documents then carry `standalone: true`; otherwise the key
  is absent.

### Removed verbs and flags

A removed verb answers, before any namespace can claim it:

```json
{"schemaVersion":1,"ok":false,"error":{"code":"E_UNKNOWN_COMMAND","message":"unknown command \"install\" — removed by the workspace model v2; use oats sync","details":{"removed":"install","replacement":"oats sync"}}}
```

| Removed | Code | Replacement |
|---|---|---|
| `install`, `restore` | `E_UNKNOWN_COMMAND` | `oats sync` |
| `init` | `E_UNKNOWN_COMMAND` | `oats-local.yaml` + `oats sync` |
| `use` | `E_UNKNOWN_COMMAND` | soul.yaml `capabilities:` + workspace defaults |
| `trust` | `E_UNKNOWN_COMMAND` | declaring the package in `packages:` |
| `list` | `E_UNKNOWN_COMMAND` | `oats workspace status` / `oats capabilities` |
| `catalog` | `E_UNKNOWN_COMMAND` | `oats package add <id> <version>` |
| `remove` | `E_UNKNOWN_COMMAND` | `oats package remove <id>` |
| `migrate` | `E_UNKNOWN_COMMAND` | a rebuild |
| `config` | `E_UNKNOWN_COMMAND` | `oats-local.yaml` and `oats-workspace.yaml` |
| `create`, `type` | `E_UNKNOWN_COMMAND` | the soul's `soul.yaml` in its member repository |
| `inject` | `E_UNKNOWN_COMMAND` | the capability's inject in its member repository |
| `prepare` | `E_UNKNOWN_COMMAND` | `oats onboard` / `oats sync`; `oats spawn <soul> --preview` |
| `inspect --request` | `E_UNKNOWN_COMMAND` | `oats onboard / oats sync; oats spawn --preview` |
| `session recompose` | `E_UNKNOWN_COMMAND` (no details) | a re-spawn |
| `readiness --verify-signatures` | `E_BAD_ARGS` | none |
| `sync --approve`, `onboard --approve` | `E_BAD_ARGS` (`details: {flag}`) | none |
| `status --team` | `E_BAD_ARGS` | `oats status` in the deployment |
| `spawn --instance` | `E_BAD_ARGS` | `--purpose` or `--name` |
| `spawn --ephemeral`, `--instructions-file`, `--def-file` | `E_BAD_ARGS` | a soul in a member repository |
| `session … --native-record` | `E_BAD_ARGS` | none |

`details.replacement` is the kernel's prose (shortened above): show it, do not
parse it.

<a id="oats-onboard-onboardapi-2"></a>
### `oats onboard`

```text
oats onboard [<dir>] --workspace <repo ref> [--json]
```

Writes `<dir>/oats-local.yaml` (`{schemaVersion: 2, workspace: <ref>}`),
creates `<dir>/agents/`, then runs the `oats sync` body. It creates no soul
and spawns nothing. `<dir>` defaults to the working directory (`--dir` is the
same argument, given once). The ref is checked before anything is written.

```json
{"onboardApi":2,"local":"/w/oats-local.yaml","dir":"/w","agents":"/w/agents","lock":"/w/oats-lock.json",
 "sync":{"syncApi":1,"workspace":{"name":"acme","key":"github.com/acme/agents"},"members":[],"packages":[],"changes":[],"problems":[],"warnings":[]},
 "hosting":{"host":"github.com/acme/agents","hostIsMember":true,"rule":"If any member is private, host oats-workspace.yaml in a private repo …"},
 "next":{"clone":[{"key":"github.com/acme/agents","name":"agents","url":"https://github.com/acme/agents.git","dir":"/w/agents-repo","present":false,"host":true},
                  {"key":"github.com/acme/platform","name":"platform","url":"https://github.com/acme/platform.git","dir":"/w/platform","present":true,"host":false}],
         "spawn":"oats spawn oats-operator-expert --dir /w",
         "souls":["oats-operator-expert","platform-engineer","release-manager"]}}
```

- `sync` is the full [`oats sync`](#oats-sync) report (abridged above).
  `standalone: true` is present on a standalone view.
- `hosting`: whether the host is itself a member, and the hosting rule (the
  kernel cannot see forge visibility).
- `next.clone[]`: one row per confirmed member (or, standalone, the
  repository itself): `{key, name, url, dir, present, host}`. `dir` is the
  existing clone (the `clones:` entry, else `<dir>/<name>`), else where to
  clone it: `<dir>/<name>`, or `<dir>/agents-repo` for a member named
  `agents`. `url` is `null` when unknown.
- `next.spawn` is `oats spawn oats-operator-expert --dir <dir>` when the
  workspace has a soul by that name, else `null`. `next.souls` is the first
  three soul names, sorted.
- Errors: `E_BAD_ARGS` (usage, no `--workspace`, a repeated directory, an
  unknown flag), `E_REPO_REF`, `E_ALREADY_ONBOARDED {local, dir}` (this
  directory already has `oats-local.yaml`), `E_ONBOARD_FAILED {dir}`. A
  failure before the workspace was read removes what onboarding created and
  carries `details: {…, dir, rolledBack: true}`; a later failure keeps the
  files and carries `details: {…, dir, local}`.

### `oats sync`

```text
oats sync [--dir <d>] --json
```

Discovers the workspace, confirms membership, resolves `packages:`, writes
`oats-lock.json` (lockfileVersion 3), takes the automations snapshot and
reports. It creates `agents/` if missing.

```json
{"syncApi":1,"automations":{"triggers":3,"schedules":2,"problems":1,"takenAt":"2026-09-26T19:58:09.281Z"},
 "workspace":{"name":"acme","key":"github.com/acme/agents","url":"https://github.com/acme/agents.git","commit":"45b86f64…",
              "observedAt":"2026-09-26T19:58:07.810Z","local":"/w/oats-local.yaml","lock":"/w/oats-lock.json"},
 "members":[{"key":"github.com/acme/tools","name":"tools","commit":"19839f9e…","confirmed":true,"status":"confirmed","detail":null,
             "souls":["tools-expert"],"capabilities":["acme-tools-dev"],"publishes":{"package":"acme.tools","version":"0.4.0"}},
            {"key":"github.com/acme/billing","name":"billing","commit":"8f2c0d1e…","confirmed":false,"status":"no-backlink",
             "detail":"github.com/acme/billing has no oats-membership.yaml","souls":[],"capabilities":[],"publishes":null}],
 "packages":[{"id":"oats.okf","version":"2.1.3","source":"catalog:oats.okf","commit":"ab897841…","integrity":"sha256-bada35…",
              "capabilities":["oats.okf"],"souls":["knowledge-maintainer"]}],
 "changes":[{"id":"oats.okf","from":null,"to":"2.1.3","commit":"ab897841…"}],
 "problems":[],"warnings":[]}
```

- `automations`: counts from the snapshot this sync took.
- `workspace.name` is `standalone:<repo>` on a standalone view.
- `members[]`: `status` is `confirmed | not-listed | no-backlink |
  backlink-elsewhere | cannot-read`, `detail` explains an unconfirmed row.
  `publishes` reports a member's `oats-package/` (informational).
- `packages[]` are the lock rows; `souls` (feature `package-souls`) the
  package souls it records. `changes[]`: `{id, from, to, commit}`, `to: null`
  when a package left.
- `problems[]`: `{code, path, message, repoKey?, …}`, for example
  `E_WORKSPACE_SCHEMA`, `E_REMOTE_*`, `E_SOUL_AMBIGUOUS` (colliding package
  souls), `E_PACKAGE_MISSING` (a standalone catalog gap: `{code, id, reason:
  "no-catalog", catalog, path, message}`), `E_AUTOMATION_SCHEMA` and
  `E_AUTOMATION_DUPLICATE` (with `kind`). A problem never aborts the sync.
- `warnings[]`: `soul-private-ignored {code, soul, repoKey, path, message}`
  for a soul.yaml still carrying `private`.
- Errors: `E_LOCAL_MISSING`, `E_WORKSPACE_SCHEMA {path, problems}`,
  `E_REMOTE_UNREADABLE`, `E_LOCK_SCHEMA`, `E_PACKAGE_MISSING`,
  `E_PACKAGE_INTEGRITY`, `E_PACKAGE_MANIFEST`, `E_REPO_REF`, `E_BAD_ARGS`.

### `oats package add` and `remove`

```text
oats package add <id> <version | git:<repo>@<ref>> [--dir <d>] --json
oats package remove <id> [--dir <d>] --json
```

Edits `packages:` only when `oats-workspace.yaml` is tracked by the checkout
found from `--dir`; otherwise it reports the change to make.

```json
{"action":"add","id":"oats.aweb","value":"v1.17.1","previous":null,"edited":true,"file":"/w/agents-repo/oats-workspace.yaml"}
```

```json
{"action":"add","id":"oats.aweb","value":"v1.17.1","edited":false,"file":null,"line":"packages:\n  oats.aweb: v1.17.1","hint":"oats-workspace.yaml is not in this checkout; commit the change in the workspace repo, then `oats sync`"}
```

`remove` answers `value: null` (and `line: null` when not tracked). An id that
is not declared is `E_PACKAGE_MISSING {id, …}`; an untracked `remove`
discovers the workspace over the network to check. Other errors: `E_USAGE`,
`E_WORKSPACE_SCHEMA` (a bad id or value), `E_REPO_REF`.

### `oats workspace status`

```text
oats workspace status [--dir <d>] [--max-age <s>] --json
```

Read-only (it writes no lock):

```json
{"workspaceStatusApi":1,
 "workspace":{"name":"northwind","key":"github.com/nw/agents","url":"https://github.com/nw/agents.git","commit":"66566512…",
              "observedAt":"2026-09-28T10:07:51.783Z","local":"/w/oats-local.yaml",
              "teams":[{"label":"eng","team":null,"description":"Platform engineering"},{"label":"oats","team":"oats:oats.aweb.ai","description":"The OATS project"}],
              "file":{"path":"oats-workspace.yaml","url":"https://github.com/nw/agents/blob/66566512…/oats-workspace.yaml"}},
 "members":[{"key":"github.com/nw/agents","name":"agents","commit":"66566512…","confirmed":true,"status":"confirmed","detail":null,
             "souls":["rm"],"capabilities":["nw-house-style"],"publishes":null,"url":"https://github.com/nw/agents/tree/66566512…",
             "membershipFile":{"path":"oats-membership.yaml","url":"https://github.com/nw/agents/blob/66566512…/oats-membership.yaml"}}],
 "packages":[{"id":"oats.okf","version":"3.0.0","source":"catalog:oats.okf","commit":"ab897841…","integrity":"sha256-bada35…",
              "capabilities":["oats.okf"],"souls":[],"latest":{"version":"4.0.5","ref":"v4.0.5"}}],
 "declaredPackages":["oats.framework","oats.okf"],"unsynced":["oats.framework"],"stale":[],
 "external":[{"source":"git:github.com/oss/experts@3c606e09…","soul":"security-reviewer"}],
 "problems":[],"warnings":[],
 "automations":{"host":"ana-laptop","snapshot":{"takenAt":"2026-09-28T10:00:00.000Z","problems":0},
                "rows":[{"kind":"schedule","id":"agents/nightly","runsOn":"ana-laptop","owner":"github.com/ana","runsHere":true,"reason":null,"enabledHere":true,
                         "origin":{"kind":"workspace","repoKey":"github.com/nw/agents","path":"oats-schedules/nightly.yaml","commit":"66566512…","url":null,"localPath":null}}]},
 "defaults":{"slots":{"knowledge":{"name":"oats.okf","from":"package"},"messaging":"none","tasks":null},
             "capabilities":[{"name":"oats.core","from":"package","off":false}]},
 "clones":[{"key":"github.com/nw/agents","name":"agents","path":"/w/agents-repo","rule":"convention"}],
 "disabledSouls":[],"lock":{"path":"/w/oats-lock.json","lockfileVersion":3}}
```

- `members[]` and `packages[]` are the sync rows (packages from the lock).
- `declaredPackages`: the ids in `packages:` (standalone: the kernel's
  default). `unsynced`: declared, not locked. `stale`: locked, no longer
  declared. `external[]`: `{source, soul}`.
- `workspace.teams` (feature `team-model-2`): the shared teams `{label, team,
  description}` by label; `[]` standalone.
- `problems`, `warnings`: as in sync.
- `automations` (feature `automations`): `{host, snapshot: {takenAt,
  problems (a count)} | null, rows: [{kind, id, runsOn, owner, runsHere,
  reason, enabledHere, origin, invalid?}]}`.
- Automation trust (0.30) adds to `warnings`:
  - `{code: "automation-untrusted", kind, id, message, remedy}` for each row
    whose reason is `untrusted`. `remedy` is the `oats-local.yaml` line.
  - `{code: "automation-trust-stale", entry, message}` for a trust entry that
    names no workspace trigger or schedule (a member may not have synced yet).
- The rest are [Desktop facts](#desktop-facts-feature-desktop-facts-oats-0290).

<a id="oats-capabilities---dir---json--capabilitiesapi-1--oats-souls---dir---json--soulsapi-1"></a>
### `oats capabilities` and `oats souls`

```text
oats capabilities [--dir <d>] [--max-age <s>] --json
oats souls [--dir <d>] [--max-age <s>] --json
```

Every item of every confirmed member, the external souls, and the locked
packages' capabilities and souls, sorted by name, then origin. Both carry
`workspace: {name, key, commit}`, `problems` and, on a standalone view,
`standalone: true`.

```json
{"soulsApi":1,"workspace":{"name":"northwind","key":"github.com/nw/agents","commit":"66566512…"},
 "souls":[
   {"name":"writer","origin":"member github.com/nw/mkt @ 46b3494a","kind":"member","repoKey":"github.com/nw/mkt","commit":"46b3494a…",
    "teams":[{"label":"mine","team":"mine:ana.aweb.ai","default":true,"from":"local"},{"label":"global","team":null,"default":false,"from":"shared"}],
    "defaultTeam":{"label":"mine","team":"mine:ana.aweb.ai","from":"deployment"},
    "private":false,"path":"souls/writer","work":"directory","description":"Drafts campaigns.","harness":"pi","model":null,"harnessFrom":"kernel-default",
    "file":{"path":"souls/writer/soul.yaml","url":null},"spawnable":true,"problem":null},
   {"name":"knowledge-maintainer","qualifiedName":"oats.okf/knowledge-maintainer","origin":"package oats.okf v4.0.5","kind":"package","package":"oats.okf",
    "version":"4.0.5","repoKey":"github.com/awebai/oats-okf","commit":"26d8216f…","teams":null,"defaultTeam":null,"private":false,
    "path":"oats-package/souls/knowledge-maintainer","work":"directory","description":"Reviews harvested knowledge.","harness":"pi","model":null,
    "harnessFrom":"kernel-default","file":{"path":"oats-package/souls/knowledge-maintainer/soul.yaml","url":null},
    "spawnable":false,"problem":{"code":"E_TEAM_UNKNOWN","message":"team \"reviewers\" is not declared (oats-local.yaml#/souls/teams/…)"}}],
 "problems":[]}
```

**Capability rows:** `name`, `origin` (display text), `kind`, then for a
member `repoKey, commit, private, path, layer, version`, for a package
`package, version, commit, private: false, layer`; plus the Desktop facts
`description, skills, commands, hooks, file, tree`. `private: true` (feature
`capabilities-private`) marks a capability usable only by its own repository's
souls (`E_CAPABILITY_PRIVATE` otherwise). An unsynced package's capabilities
are absent until `sync`.

**Soul rows:** `name, origin, kind (member | external | package), repoKey,
commit, teams, defaultTeam, private (always false), path, work, description`,
plus the Desktop facts `harness, model, harnessFrom, file, spawnable,
problem`, and (feature `launch-preference`) `key` and `launch`.
- `key` is the soul key that `souls.teams`, `souls.default` and `souls.launch`
  use, and that `oats soul teams <key>` takes: `qualifiedName` for a package
  soul, the bare `name` for a member or external soul. Two member souls that
  share a bare name share one entry (spawning that name is
  `E_SOUL_AMBIGUOUS`).
- `launch` is a [Launch](#the-launch-report-launch).
- `teams` and `defaultTeam` (feature `team-model-2`) are a
  [TeamRow](#the-team-row-teamrow) list and a
  [DefaultTeam](#the-default-defaultteam); both `null` when the soul's teams
  do not resolve (`problem` names the `E_TEAM_*` code).
- Package souls (feature `package-souls`) add `qualifiedName`
  (`<package>/<soul>`), `package` and `version`. Spawn one by
  `qualifiedName` (the bare name when unique). Its instances live under
  `agents/<package>--<soul>/` with `.` written `-` (for example
  `oats-okf--knowledge-maintainer`), which is its agent `name` in the roster.

This document keeps `soulsApi: 1`; the probe's `soulsApi: 2` is the inspect
soul row's.

<a id="desktop-facts-feature-desktop-facts-oats-0290"></a>
### Desktop facts

Feature `desktop-facts`: facts the kernel reports so the Desktop never derives
them. Gate each field below on it.

| Document | Fields |
|---|---|
| `oats inspect --soul` | `capabilities[].composedFrom`, `capabilitiesOff[]` |
| `oats souls` rows | `harness`, `model`, `harnessFrom`, `spawnable`, `problem`, `file` |
| `oats capabilities` rows | `layer`, `description`, `skills`, `commands`, `hooks`, `file`, `tree` |
| `oats workspace status` | `workspace.file`, `members[].url`, `members[].membershipFile`, `packages[].latest`, `defaults`, `clones`, `disabledSouls`, `lock` |
| `oats status` instance rows | `startedAt`, `modelFrom`, `identityAddress`; `modules[].current.version` on member rows |

- **Souls.** `harness`, `model`, `harnessFrom`: what a spawn starts with when
  no selection flag is given, else `harness: "pi"`, `model: null`,
  `harnessFrom: "kernel-default"` (`"soul"` when the definition names one; a
  v2 soul.yaml cannot). `spawnable`/`problem`: whether a spawn here would
  refuse, resolved without spawning, writing or reaching past the sync cache;
  `problem` is `{code, message}` or `null` (`E_SOUL_DISABLED`,
  `E_TEAM_UNKNOWN`, `E_TEAM_NOT_ELIGIBLE`, `E_CAPABILITY_*`, `E_PACKAGE_*`,
  `E_LOCK_SCHEMA`, `E_REMOTE_*`, …). `file`: `{path, url}` of soul.yaml.
- **Capabilities.** `layer` on every row, `null` outside the slots.
  `description` or `null`. `skills`, `commands`, `hooks`: names, sorted
  (`skills` is `null` when they cannot be listed). `file`: `{path, url}` of
  `oats.json`, or `null` when unreadable. `tree`: a member capability's Git
  tree id at the member commit; `null` for a package (its fingerprint is the
  lock's `integrity`). Package facts are read from the sync cache; unreadable
  manifests leave them `null`.
- **`defaults`**: the workspace file's defaults as declared. `slots.<slot>` is
  `{name, from}`, `"none"` or `null`; `capabilities` are `{name, from, off}`
  by name (`from` is `"package"`, `"here"` or a member key; `null` when off).
  Standalone: every slot `null`, `capabilities: []`.
- **`clones[]`**: `{key, name, path, rule}` with `rule` `"clones"`,
  `"convention"` or `null`. A path that is not the member's clone gives
  `path: null, rule: null, problem: {code: "E_CLONE_MISMATCH", message}`.
- **`disabledSouls`**: `souls.disabled` as written. **`lock`**: `{path,
  lockfileVersion}`.
- **`packages[].latest`**: `{version, ref}` when the kernel's bundled catalog
  has a newer version of a catalog package; `null` otherwise and for `git:`
  packages. No network (`OATS_PACKAGE_CATALOG` overrides the catalog).
- **`workspace.file`**, **`members[].url`**, **`members[].membershipFile`**:
  `{path, url}` at the named commit (`workspace.file` is `null` standalone).
- **URLs** exist only for `github.com` (`…/blob/<commit>/<path>` or
  `…/tree/<commit>`); any other host gives `url: null` with `path` set.
  `path` is repository-relative.

<a id="team-model-v2-feature-team-model-2-oats-0300-replaces-feature-teams"></a>
## Teams

Feature `team-model-2`: gate every team field and verb on it. Design:
[team model v2](design/2026-09-27-team-model-v2.md); operator guide:
[workspaces.md](workspaces.md).

- **Shared teams** live in the committed `oats-workspace.yaml`:
  `teams.<label> = {description?, team?}`. A shared team without `team` (the
  provider id) is **unmapped**.
- **Local** configuration lives in `oats-local.yaml`: `teams.<label> = {team,
  description?}`, `defaultTeam: <label>`, `souls.teams: {"*": [labels],
  "<soul>": [labels]}` and `souls.default: {"<soul>": <label>}`. A soul key is
  the spawn name (`<package>/<soul>` for a package soul). A label matches
  `[a-z0-9][a-z0-9._-]*`.
- **Team ids.** A `team` value (in either file, and `oats teams add --team`)
  matches `^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,255}$`: the kernel's safety rule
  (never `-`-led, no whitespace or control characters, bounded). Otherwise
  `E_WORKSPACE_SCHEMA` (a file) or `E_BAD_ARGS` (the verb). The messaging
  provider validates its own id shape (oats.aweb: `<name>:<namespace>`).
- **Resolution.** The soul's default is `souls.default[soul] ??
  defaultTeam`; its teams are that default plus `souls.teams["*"]` plus
  `souls.teams[soul]`. A label in both files is a `team-label-collision`
  warning, and the shared definition wins. An undeclared label is
  `E_TEAM_UNKNOWN`; a `souls.default` outside the soul's teams is
  `E_TEAM_NOT_ELIGIBLE`.
- **Removed keys** are `E_WORKSPACE_SCHEMA` with `reason: "removed-key"`:
  `messaging.byTeam`, `defaults.byTeam`, a soul.yaml `team`, an
  oats-membership.yaml `team`, and `byTeam` in any provider payload layer.
  Other payload keys are opaque (a `team` setting passes through).

### The team row (`TeamRow`)

Exactly `{label, team, default, from}`:

```json
[{"label":"antares","team":"antares:ana.aweb.ai","default":true,"from":"local"},
 {"label":"oats","team":"oats:oats.aweb.ai","default":false,"from":"shared"},
 {"label":"reviewers","team":null,"default":false,"from":"shared"}]
```

`team` is `null` for an unmapped team. `default` is true on exactly the
soul's default row; the others are teams an instance may join (offered, never
joined automatically). `from` is `"shared"` or `"local"`. The default row
comes first, then the rest by label (codepoint order). Reports include
unmapped rows; `OATS_TEAMS` and `instance.json.teams` carry mapped rows only.

### The default (`DefaultTeam`)

```json
{"label":"antares","team":"antares:ana.aweb.ai","from":"deployment"}
```

`from` is `"deployment"` (`defaultTeam`) or `"soul"` (`souls.default`). It is
`null` only when no default is configured (with messaging active, that is
`E_TEAM_UNCONFIGURED`). An unmapped default is `{label, team: null, from}`,
the blocking problem `team-unmapped`.

<a id="where-teams-appear"></a>
### Where teams appear

| Document | Team fields |
|---|---|
| `oats spawn … --preview` | `teams` (unmapped included), `defaultTeam` |
| `oats inspect --soul` | `teams`, `defaultTeam`, `teamsSource: "live"` |
| `oats inspect --home` | `teams`, `defaultTeam`, `teamsSource` (`"live"`, or `"recorded"` when the workspace cannot be read; `teams: null` when none was recorded), `recordedDefaultTeam` |
| `oats readiness` | items under `checks.configured` |
| `oats souls` rows | `teams`, `defaultTeam` (`null` when they do not resolve) |
| `oats workspace status` | `workspace.teams` |
| `instance.json` | `teams` (mapped rows), `defaultTeam` |

A home's live teams are the files as they are now; a running instance keeps
its spawn-time default until respawned (readiness says so with
`default-team-changed`). No document carries a soul-level `team`, `labels`,
`primary`, `mapped` or `byTeam`, and no capability origin is `team:<label>`.

**Provider environment.** Hooks, commands, operations and provider checks get
the teams in `OATS_DEFAULT_TEAM`, `OATS_DEFAULT_TEAM_ID`,
`OATS_DEFAULT_TEAM_FROM`, `OATS_TEAMS` and `OATS_TEAMS_SOURCE`:
[capabilities.md](capabilities.md#teams-in-the-provider-environment).
`OATS_WORKSPACE_NAME` is the recorded workspace name (the discovered one for a
soul subject), `""` when unknown.

### `oats teams`

```text
oats teams [--dir <d>] [--max-age <s>] --json
oats teams add <label> --team <id> [--description <d>] --json
oats teams remove <label> --json
oats teams default <label> --json
```

```json
{"teamsApi":1,"deployment":"/w","defaultTeam":"antares",
 "teams":[{"label":"antares","team":"antares:ana.aweb.ai","description":null,"from":"local","default":true,"at":"oats-local.yaml#/teams/antares"},
          {"label":"reviewers","team":null,"description":null,"from":"shared","default":false,"at":"github.com/awebai/oats:oats-workspace.yaml#/teams/reviewers"}],
 "souls":{"teams":{"*":["oats"],"oats-expert":["reviewers"]},"default":{"oats-expert":"oats"}},
 "problems":[{"code":"team-unmapped","label":"reviewers","default":false,"severity":"warning","at":"github.com/awebai/oats:oats-workspace.yaml#/teams/reviewers",
              "message":"shared team reviewers has no provider id yet","fix":"its owner runs `oats aweb setup`, then commits the id"}]}
```

- `defaultTeam` is the deployment's label (or `null`), not a `DefaultTeam`.
- `teams[]`: every declared team by label, `{label, team, description, from,
  default, at}`; `at` is a pointer into `oats-local.yaml` or
  `<workspace key>:oats-workspace.yaml#/teams/<label>`. A collision shows the
  shared definition.
- `souls`: `souls.teams` and `souls.default` as written. `problems`: the
  deployment's [team readiness items](#team-readiness-items).
- The verbs never call a provider. They validate, rewrite `oats-local.yaml` in
  place, and answer the document plus `changed: bool`.
- **`add`**: the first team added also becomes `defaultTeam`. A label already
  declared is `E_TEAM_EXISTS {label, from}`; a bad label or no `--team` is
  `E_BAD_ARGS`.
- **`remove`**: a referenced label is `E_TEAM_IN_USE {label, usedBy}` (each
  `"defaultTeam"`, `"souls.teams:<key>"` or `"souls.default:<key>"`); a shared
  label is `E_TEAM_SHARED {label, at}` (a label in both files can be removed
  locally); unknown is `E_TEAM_UNKNOWN {label}`.
- **`default`**: any declared label, else `E_TEAM_UNKNOWN`.
- A write that would introduce an unknown or ineligible reference is refused
  with that code; an invalid result is `E_WORKSPACE_SCHEMA`.

### `oats soul teams`

```text
oats soul teams <soul>|'*' [--add a,b] [--remove a,b] [--default <label> | --clear-default] [--dir <d>] --json
oats soul teams <soul>|'*' [--dir <d>] [--max-age <s>] --json    (the read form only)
```

```json
{"soulTeamsApi":1,"soul":"oats-expert","key":"oats-expert","defaultTeam":{"label":"oats","team":"oats:oats.aweb.ai","from":"soul"},
 "teams":[{"label":"oats","team":"oats:oats.aweb.ai","default":true,"from":"shared","via":["default","*"]},
          {"label":"reviewers","team":null,"default":false,"from":"shared","via":["soul"]}],
 "local":{"teams":["reviewers"],"default":"oats"},"all":["oats"]}
```

- Rows are `TeamRow` plus `via`, a non-empty ordered subset of `"default"`,
  `"*"` and `"soul"`. `key` is the soul's `souls.*` key; `local` its own
  entries; `all` is `souls.teams["*"]`.
- For `'*'`: `soul` and `key` are `"*"`, `teams` the deployment default plus
  `souls.teams["*"]`, `local.default: null`.
- Mutations answer the document plus `changed`. Unknown label:
  `E_TEAM_UNKNOWN {label}`. A `--default` outside the soul's teams:
  `E_TEAM_NOT_ELIGIBLE {soul, label, at}` (`at`: `oats-local.yaml#/souls/default/<key>`,
  `/` written `~1`). `--default`/`--clear-default` with
  `'*'`, or both together: `E_BAD_ARGS`. Soul lookup: `E_SOUL_UNKNOWN`,
  `E_SOUL_AMBIGUOUS`.
- **Writes** (`oats teams add|remove|default`, `oats soul teams`) edit
  `oats-local.yaml` in place and touch only the entries that change: comments
  and styles elsewhere, including inline comments on sibling entries and flow
  lists, are kept. Each verb re-reads the file and judges its refusals on it
  as it is now, and writes only if the file did not change meanwhile (else it
  redoes the edit on the new content). A file that keeps changing is
  `E_LOCAL_CHANGED {path}`; nothing was written.

### The messaging provider's teams document

The messaging provider's `teams` operation (`messaging:teams`) is produced by
the provider (oats.aweb 1.17 or later), not the kernel:

```json
{"defaultTeam":{"label":"antares","team":"antares:ana.aweb.ai","from":"deployment"},
 "eligible":[{"label":"oats","team":"oats:oats.aweb.ai","joined":true}],
 "joined":[{"label":"oats","team":"oats:oats.aweb.ai","identityHome":"/w/agents/oe/instances/oe-1/.aw-teams/oats","receive":"live","since":"2026-09-28T09:00:00.000Z"}],
 "left":[{"label":"reviewers","team":"reviewers:acme.aweb.ai","at":"2026-09-28T09:30:00.000Z","reason":"no-longer-eligible"}],
 "at":"2026-09-28T10:00:00.000Z"}
```

`defaultTeam` is the kernel's `DefaultTeam` from the environment. `eligible`
are the non-default `OATS_TEAMS` rows; `joined[].receive` is `live` or
`poll`; `left` holds the last 20 leaves. A join or leave answer adds
`actions: [{action: "join" | "leave", label, released?, receipt?}]`. There is
no `primary` and no `unmapped`: unmapped teams are kernel readiness items.

<a id="team-readiness-items"></a>
### Team readiness items

`oats teams` lists them under `problems[]` as `{code, severity: "failure" |
"warning", message, fix, …}`. `oats readiness` lists the soul's under
`checks.configured` with `subject` `"team <label>"` (or `"teams"`), `producer:
"team model"`, `code`, `reason`, `remedy`, `status: "fail"`, `required: true`
for a failure and `false` for a warning, plus the problem's own keys.

| Code | Severity | Keys | When |
|---|---|---|---|
| `E_TEAM_UNCONFIGURED` | failure | | messaging is active and the soul has no default |
| `team-unmapped` | failure if `default`, else warning | `label`, `default`, `at` | a shared team without `team` |
| `team-label-collision` | warning | `label`, `shared`, `local` (each `{team, description, at}`) | a label in both files |
| `default-team-changed` | warning | `recorded`, `current` | `--home` with live teams: the default changed since the spawn |
| `E_TEAM_UNKNOWN` | failure | `label`, `at` | a reference to an undeclared label |
| `E_TEAM_NOT_ELIGIBLE` | failure | `soul`, `label`, `at` | `souls.default` outside the soul's teams |

The last two are also spawn, preview and inspect refusals, with the same
details.

<a id="soul-launch-preferences-feature-launch-preference-oats-0300"></a>
## Launch preferences

Feature `launch-preference` (OATS 0.30.0): gate every field and flag below on
it. Design: [soul launch preferences](design/2026-09-28-soul-launch-preference.md).
Every object shape here is closed.

- **The soul** may declare `launch: {harness, model?}` in soul.yaml.
  - `harness` is `pi`, `claude` or `codex`. `model` is a non-empty model id for
    that harness.
  - Nothing else is allowed (no args, env, yolo or executable; those stay host
    facts, in launch configurations). Another key is `E_WORKSPACE_SCHEMA`.
  - A package soul may declare one too.
- **The machine** may override it in `oats-local.yaml` `souls.launch`. A key is
  a soul key (as for `souls.teams`: `"*"`, a bare soul name, or
  `<package>/<soul>`). A value is a `launch-configs` name in the same file, or
  an inline `{harness, model?}` with the soul's rules.
  ```yaml
  souls:
    launch:
      "*": opus                                          # every soul on this machine
      oats-expert: opus                                  # a launch configuration
      oats.engineering/code-reviewer: {harness: codex}   # an inline preference
  ```
- **Migration.** 0.29.x refuses an unknown soul.yaml key, and members are read
  at their latest commit. A committed soul gains `launch:` only on the flag day
  (every deployment of the workspace runs 0.30). Until then, use `souls.launch`
  or `--launch-config`.

**Precedence** for a new selection. The first layer with a value decides:
1. The flags: `--launch-config` or `--harness` (`from: "flag"`). `--model`
   alone keeps the next deciding layer's harness and replaces only its model.
2. `souls.launch.<key>` (`"local"`).
3. `souls.launch."*"` (`"local-default"`).
4. The soul's `launch` (`"soul"`).
5. The host default: `pi`, its own model, no configuration (`"host"`).

- A **launch configuration** name runs that configuration's full recipe.
- An **inline or soul preference** runs its harness with this host's baseline
  for it (the executable the host resolves; no args, no env) and its `model`.
- A preference is a unit. Without `model`, the harness's own model runs; a
  lower layer's model is never borrowed. A model never crosses harnesses
  (`E_MODEL_UNKNOWN`, as before).

**Existing homes.** A home's recorded launch is frozen. A plain `session
start`/`restart` runs it unchanged. The precedence decides only a new
selection: a spawn, a start/restart with `--launch-config` or `--harness`, or
a start/restart with `--reselect-launch`, which applies the current layers
without naming anything. A start/restart with `--model` alone is not a new
selection: it keeps the recorded harness (and configuration) and replaces only
the model (`modelFrom: "start"`; `launchFrom` is unchanged). **A changed preference does not affect
a running or existing home until `--reselect-launch` or a respawn.** Readiness
shows the drift as `launch-changed`.

**Refusals** (spawn, preview, and a reselecting start):
- `E_HARNESS_UNAVAILABLE {harness, from, at, fix}`: the chosen harness has no
  executable on this machine. There is no fallback to another harness. `fix`
  is "install <harness>, or override it on this machine in oats-local.yaml
  souls.launch" (from the soul or the host), "install <harness>, or change
  oats-local.yaml souls.launch" (from local layers), or "install <harness>, or
  choose another --harness / --launch-config" (from a flag).
- `E_LAUNCH_CONFIG_UNKNOWN {name, from, at}`: `souls.launch` names a launch
  configuration this `oats-local.yaml` does not declare.
- `E_WORKSPACE_SCHEMA`: a malformed `launch` or `souls.launch`, path named.

### The launch report (`Launch`)

```json
{"declared":{"harness":"claude","model":"claude-opus-5-5"},
 "effective":{"harness":"codex","model":null,"launchConfig":null},
 "from":"local","at":"oats-local.yaml#/souls/launch/oats.engineering~1code-reviewer",
 "problem":null}
```

- `declared`: the soul's own `launch` as `{harness, model}` (`model` may be
  `null`), or `null` when the soul declares none.
- `effective`: `{harness, model, launchConfig}`. `model` is the id passed to the
  harness, or `null` (the harness's own). `launchConfig` is a configuration
  name or `null`.
- `from`: `"flag"`, `"local"`, `"local-default"`, `"soul"` or `"host"`; on a
  home, also `"recorded"` (a home from before 0.30).
- `at`: where the deciding value lives, or `null` (a flag, the host):
  `"oats-local.yaml#/souls/launch/<key>"` (JSON-pointer escaped: `/` is `~1`),
  `"oats-local.yaml#/souls/launch/*"`, `"<repoKey>:<path>/soul.yaml#/launch"`,
  or `"package:<id>:<path>/soul.yaml#/launch"`.
- `problem`: `null`, or `{code, message, fix}` when a spawn would refuse
  (`E_HARNESS_UNAVAILABLE`, `E_LAUNCH_CONFIG_UNKNOWN`, or `E_LAUNCH_EXECUTABLE`
  for a configuration whose own executable is missing). Only reports carry it;
  spawn and preview refuse instead. With `E_LAUNCH_CONFIG_UNKNOWN`,
  `effective` is the host default (`pi`, `null`, `null`): the named
  configuration launches nothing here.
- In listings (`oats souls`, `inspect --soul`, `launchCurrent`) `model` is the
  configured id: no model catalogue is probed. The preview's `model` is the
  resolved one.

### Where the launch appears

- **`oats spawn … --preview --json`**: `launch`, flags applied. The existing
  `harness`, `model`, `launchConfig` equal `launch.effective`, and
  `decision.effective` binds them (a preference edited between preview and
  apply is `E_DECISION_STALE`).
- **`oats inspect --soul <name>`** and **`oats souls` rows**: `launch` as a
  spawn with no flags would decide it here (`from` is never `"flag"`). A soul
  whose harness is missing still lists, with `problem` set. The souls rows'
  Desktop facts `harness`, `model`, `harnessFrom` equal `launch.effective`;
  `harnessFrom` is `"soul"`, `"local"`, `"local-default"` or `"kernel-default"`
  (the host default).
- **`oats inspect --home <abs>`**: `launch` is the record (`from` the recorded
  layer; `declared` the soul's preference then), and `launchCurrent: Launch |
  null` is what `--reselect-launch` would choose now: the home's recorded soul
  copy's `launch` and this deployment's `souls.launch` as they are now (`null`
  when `oats-local.yaml` cannot be read).
- **`instance.json`** (a spawn, and a start that makes a new selection):
  `launchFrom` (a `from` value), `launchAt` (its `at`) and `launchDeclared`
  (the soul's own preference then, `{harness, model}` or `null`). All three
  are absent on a home from before 0.30. A start with `--launch-config` or
  `--harness` records `launchFrom: "flag"`; a plain or `--model`-only start
  keeps them. `harness`, `model`, `launchConfig` and the recipe
  record the effective launch as before.
- **`modelFrom`** (instance.json and roster rows) gains `"local"` and
  `"local-default"` (an inline override's model). `"soul"` is the soul's
  `launch.model`.
- **Readiness** (`--home` only), in `checks.configured`: `launch-changed`, a
  warning (`required: false`), `subject: "launch"`, `producer: "launch
  preference"`, with `recorded` and `current` (each `{harness, model,
  launchConfig}`), `from` and `at` (the current layer's). `remedy`:
  "`oats session restart --reselect-launch`, or respawn". Only a home whose
  recorded launch a layer chose (`launchFrom` `local`, `local-default`,
  `soul` or `host`) is compared: one launched with explicit flags, or from
  before 0.30, never warns.
- **`--reselect-launch`** with `--launch-config` is `E_BAD_ARGS` (choose one);
  with `--harness` the flag decides, as at spawn.

No verb writes `souls.launch`; it is plain YAML. A GUI that edits it checks
the result with `oats inspect --soul <name> --json`.

## Spawn

### The preview

```text
oats spawn <soul> [the flags of a real spawn] --preview --json
```

Feature `spawn-preview-2`, `spawnPreviewApi: 2`. The preview runs every
preflight a spawn runs and writes nothing, on success or refusal. It reads the
soul from the per-commit cache (`agents/<soul>/souls/<commit12>/`) or fetches
it to a temporary copy (`soulFetched: true`).

```json
{"modules":[
   {"name":"nw-tools","from":{"kind":"member","repoKey":"github.com/nw/agents","commit":"66566512…"},"layer":null,"private":false,"declares":[],
    "changedSince":{"instance":"rm-2","was":"45b86f64…"},"composedFrom":"soul"},
   {"name":"oats.okf","from":{"kind":"package","package":"oats.okf","version":"2.1.3","commit":"ab897841…","integrity":"sha256-bada35…","repoKey":"github.com/awebai/oats-okf"},
    "layer":"knowledge","private":false,"declares":["state-dir"],"changedSince":false,"composedFrom":"workspace"}],
 "teams":[{"label":"eng","team":"eng:nw.aweb.ai","default":true,"from":"shared"}],
 "defaultTeam":{"label":"eng","team":"eng:nw.aweb.ai","from":"soul"},
 "resolution":"abacbdb5a7975098d77007c8","declRevision":"068a0d3f1311a9e84e9aff2e","payloadRevision":"81a368006c610194aa35dbe0",
 "workspace":"github.com/nw/agents","standalone":false,"providers":{},
 "settings":{"nw-tools":{},"oats.okf":{"owns":"rm"}},
 "settingsOrigins":{"nw-tools":{},"oats.okf":{"/owns":{"kind":"soul","at":"soul.yaml#/knowledge"}}},
 "spawnPreviewApi":2,"preview":true,"agent":"rm","kind":"persistent","instance":"rm-api","home":"/w/agents/rm/instances/rm-api",
 "repo":"/w/agents-repo","work":"worktree","subject":{"soul":"rm","agentsRoot":null,"dir":"/w"},
 "decision":{"instance":"rm-api","home":"/w/agents/rm/instances/rm-api","branch":"agents/rm-api","base":{"ref":"HEAD","oid":"66566512…"},
             "effective":{"repo":"/w/agents-repo","work":"worktree","harness":"pi","model":null,"launchConfig":null,"yolo":null,"backend":"tmux",
                          "childSpawns":true,"relation":null,"providers":{"nw-tools":{},"oats.okf":{"owns":"rm"}}},
             "resolution":"abacbdb5a7975098d77007c8","revision":"c557d8ec9a272ba1c1739dc3"},
 "preflight":{"status":"complete","budgetMs":20000,"elapsedMs":53},"backendStatus":{"name":"tmux","installed":true,"started":false},
 "harness":"pi","model":null,"modelSource":"native default","launchConfig":null,"backend":"tmux",
 "branch":"agents/rm-api","base":{"ref":"HEAD","oid":"66566512…"},"worktree":"/w/agents/rm/instances/rm-api/work",
 "relation":null,"parentInstance":null,"policy":{"childSpawns":{"allowed":true,"origin":{"kind":"default","detail":"no spawn option: children allowed"}}},
 "executable":"/usr/local/bin/pi",
 "capabilities":[{"name":"nw-tools","origin":"member:github.com/nw/agents@66566512…"},{"name":"oats.okf","origin":"package:oats.okf@2.1.3"}],
 "skills":["release-checklist",{"name":"okf","source":"module:oats.okf"}],
 "task":null,"soulFetched":true}
```

**Placement.**
- `instance`: `<agent>-<purpose>` with `--purpose`, else `<agent>-<n>`,
  de-duplicated across the deployment; or exactly `--name`
  ([Instance names](#instance-names)). `home` and `worktree` (worktree mode,
  else `null`) are canonical: never derive paths.
- `repo`: `--repo`, else the `clones:` entry, else `<deployment>/<member>`.
- `branch` defaults to `agents/<instance>` (`--branch` overrides); `base` is
  `--base` (default `HEAD`) resolved to `oid`. `E_BRANCH_EXISTS` and
  `E_BASE_UNKNOWN` refuse preview and apply alike.
- `subject` echoes `{soul, agentsRoot, dir}` byte-exact.

**Launch.**
- `harness`, `model`, `modelSource`, `launchConfig`, `backend`, `yolo`
  (absent when nothing sets it) are the resolved selection.
  `backendStatus` is `{name, installed, started: false}`, `null` with
  `--no-launch`. `executable` is the resolved harness binary.
- `modelSource` is `"explicit"`, `"soul default"`, `"launch-config <name>"`,
  `"native default"` or `"native default (explicit)"` (`--model
  @native-default`). Omitting `--model` and asking for the native default are
  different requests.
- `preflight`: `{status: "complete" | "timeout", budgetMs, elapsedMs}`; all
  native probes share one 20 s budget.
- `policy.childSpawns` is what the instance will record.

**Composition.**
- `modules[]` (feature `instance-modules`): `{name, from, layer, private,
  declares, changedSince, composedFrom}`; `from` is what `instance.json` will
  record. `changedSince` is `null` (no previous instance), `false` (unchanged
  since the newest one) or `{instance, was}`.
- `composedFrom` (feature `preview-composed-from`, OATS 0.30.2): why the
  module is there — `"soul"` (the soul declares it, including a soul entry
  that overrides a workspace default of the same name, a package soul's
  `from: here`, and every module of a standalone view) or `"workspace"` (a
  `defaults.<slot>` or `defaults.capabilities` entry). It is the same value
  `oats inspect --soul` reports as `capabilities[].composedFrom`. It is
  provenance only: it never enters `resolution`, `declRevision`,
  `payloadRevision` or `decision.revision`, and `instance.json` does not
  record it. `from` says where the bytes come from.
- `capabilities[]` (`{name, origin}`, `origin` `package:<id>@<v>` or
  `member:<repoKey>@<commit>`) and `skills[]` (the soul's own skills as
  strings, module skills as `{name, source: "module:<cap>"}`) are display
  only: bind to `modules[]` and `decision`.
- `resolution` (24 hex) hashes `declRevision` (the declarations) and
  `payloadRevision` (the merged payloads). `workspace` is the host key;
  `standalone` marks a standalone view. `task` is the task text or `null`.

**Provider settings.**
- `providers` is the `--provider` map as typed.
- `settings.<cap>`: the merged payload (manifest defaults, then workspace,
  soul, `oats-local.yaml` `settings.<cap>`, `--provider`).
- `settingsOrigins.<cap>` (feature `settings-origins`) maps each leaf pointer
  (`/identity/mode`) to `{kind, at}`: `kind` is `manifest-default | workspace |
  soul | host | spawn`, `at` names the place.
- `--provider <cap> <key>=<value>` (feature `spawn-provider-payload`,
  repeatable, `a.b=c` nests): a malformed pair is `E_BAD_ARGS`; a capability
  the soul does not resolve is `E_CAPABILITY_MISSING {capability, soul,
  modules}`.
- Any other positional after the soul, or a flag spawn does not read, is
  `E_BAD_ARGS` naming the argument, before anything is resolved; a bare
  `key=value` is refused with the `--provider <capability> key=value` form.

### The decision

`decision` is `{instance, home, branch, base, effective, resolution,
revision}`. `effective` (feature `spawn-apply-2`) is `{repo, work, harness,
model, launchConfig, yolo, backend, childSpawns, relation, providers}`;
`relation` is `null` or `{kind, anchor: {instance, agentsRoot}}`; `providers`
(feature `served-identity`) equals `settings`. `revision` (24 hex) hashes the
decision.

Apply with `oats spawn <soul> … --expect-decision <revision> --json`. Any drift
refuses `E_DECISION_STALE` with the fresh `details.decision`; nothing is
created. Without `--expect-decision` the CLI keeps its interactive
auto-suffix.

### Apply

Feature `spawn-apply-2`, `spawnApplyApi: 1`. The Desktop gates on
`spawn-preview-2`, `spawn-apply-2` and `spawn-idempotency-2`.

- Backend startup runs only after the decision check and the placement
  reservation; a missing backend binary is refused before placement.
- The home is reserved with a non-recursive `mkdir`. A concurrent loser
  refuses `E_PLACEMENT_TAKEN {instance, home}` having touched nothing. Names
  are deployment-wide: a same-name race with another soul ends in
  `E_INSTANCE_NAME_TAKEN` (for `--name`) or `E_PLACEMENT_TAKEN`.
- A refused child spawn appends `child-spawn-refused` to the parent's log (on
  apply only).

**Idempotency** (feature `spawn-idempotency-2`): `--idempotency-key <key>`
with `--expect-decision` records the key and decision in `instance.json`.
- Recovery runs right after naming, before placement or preflight. A retry
  with the same key replays the receipt (`replayed: true`, no second spawn,
  no second wake). The same key with another decision is
  `E_IDEMPOTENCY_CONFLICT {instance, home}`.
- `spawnCompleted` is `false` until launch, lineage and events are done; a
  retry of an unfinished spawn is `E_SPAWN_INCOMPLETE {instance, home,
  launched}` (recover through the session surface).
- The key lives in the home. Mint it on the first confirmation and keep it
  for that intent's retries.
- `wake: {requested, saved, error}` is recorded and replayed; `saved: null`
  means the outcome was not recorded.

**Result** (`oats spawn <soul> … --json`):

```json
{"instance":"rm-api","agent":"rm","home":"/w/agents/rm/instances/rm-api","work":"worktree","branch":"agents/rm-api","launched":true,"warnings":[],
 "tmux":{"session":"oats-agents","window":"rm-api"},"backend":"tmux","repo":"/w/agents-repo","harness":"pi","model":null,"parent":null,"sibling":null,"relation":null,
 "spawnOrigin":"operator","attach":"tmux attach -t oats-agents","decision":{"instance":"rm-api","revision":"c557d8ec9a272ba1c1739dc3"},"replayed":false,
 "wake":{"requested":false,"saved":null,"error":null},"launchConfig":null,
 "launch":{"version":2,"harness":"pi","launchConfig":null,"launchConfigSource":null,"executable":"/usr/local/bin/pi","executableDeclared":null,
           "executableResolvedFrom":"PATH","args":[],"env":{},"model":null,"hooks":{"launch":{},"env":{},"contributions":[]},"prompt":{"kind":"task-file","file":"TASK.md"}}}
```

(`decision` is abridged: it is the full bound decision.)

- Always present: `instance, agent, home, work, branch, launched, warnings
  (array), tmux ({session, window} | null), backend ("tmux"), repo, harness,
  model, parent,
  sibling, relation, spawnOrigin (operator | instance), attach, launchConfig,
  launch` (the redacted recipe).
- When they apply: `yolo`, `decision` and
  `replayed` (bound apply), `wake` (keyed apply), `wakeSchedule` and
  `wakeScheduleError` (a requested wake).

<a id="instance-names"></a>
### Instance names

Feature `spawn-name`. `--name <slug>` is the exact name, with no prefix.
- `--name` with `--purpose`, or without a value: `E_BAD_ARGS`.
- A name that is not a slug (lowercase letters and digits, single dashes),
  equals a soul name, or exceeds 64 characters (derived names included, with
  their suffix) is `E_INSTANCE_NAME_INVALID`.
- A name any soul's `instances/` holds, or a live tmux window carries, is
  `E_INSTANCE_NAME_TAKEN {instance, home, session?}`; a typed name never gets
  a silent `-2`.
- The name is part of the decision.

<a id="spawn-errors"></a>
### Spawn errors

| Code | Details | When |
|---|---|---|
| `E_USAGE`, `E_BAD_ARGS` | | no soul; bad, contradictory, removed or unknown flags; an argument after the soul |
| `E_LOCAL_MISSING`, `E_NO_DEPLOYMENT` | | no `oats-local.yaml`; no `agents/` root |
| `E_SOUL_UNKNOWN` | `{name, members, packages}` | no such soul, or not at `--agents-root` |
| `E_SOUL_AMBIGUOUS` | `{name, repos, qualified}` | several souls answer the bare name; use one of `qualified` |
| `E_SOUL_DISABLED` | `{name, qualifiedName, entry}` | listed in `souls.disabled` |
| `E_UNKNOWN_AGENT` | | the resolved soul is not under the deployment's agents root |
| `E_TEAM_UNKNOWN`, `E_TEAM_NOT_ELIGIBLE` | `{label, at}`, `{soul, label, at}` | the soul's teams do not resolve |
| `E_NOT_A_MEMBER`, `E_MEMBERSHIP_UNCONFIRMED` | | the soul's repository is not a confirmed member |
| `E_CAPABILITY_MISSING`, `E_CAPABILITY_PRIVATE`, `E_CAPABILITY_INCOMPATIBLE`, `E_COMPATIBILITY` | | a capability cannot be resolved |
| `E_PACKAGE_MISSING`, `E_PACKAGE_INTEGRITY`, `E_LOCK_SCHEMA` | | the lock does not provide it (standalone: `{…, standalone: true, reason: "no-catalog", catalog}`) |
| `E_SLOT_CONFLICT`, `E_SKILL_DUPLICATE` | | the composition conflicts |
| `E_WORKSPACE_SCHEMA` | `{path, key, reason}` | a removed key or invalid payload |
| `E_CLONE_MISSING`, `E_CLONE_MISMATCH` | | the member's clone is missing or wrong |
| `E_REQUIREMENT_INACTIVE` | `{soul, capabilities, context, remedy}` | a declared requirement is not active |
| `E_CHILD_SPAWNS_DISABLED` | `{parent, policy}` | the parent's policy is off |
| `E_PARENT_NOT_FOUND`, `E_RELATIVE_NOT_FOUND` | | the anchor name matches no instance |
| `E_RELATIVE_AMBIGUOUS` | | the anchor matches several instances (`--relative-root` picks one) or a same-named instance would shadow the edge |
| `E_BRANCH_EXISTS`, `E_BASE_UNKNOWN` | | |
| `E_INSTANCE_NAME_INVALID`, `E_INSTANCE_NAME_TAKEN` | see above | |
| `E_DECISION_STALE` | `{decision}` | |
| `E_PLACEMENT_TAKEN`, `E_IDEMPOTENCY_CONFLICT` | `{instance, home}` | |
| `E_SPAWN_INCOMPLETE` | `{instance, home, launched}` | |
| `E_LAUNCH_*`, `E_MODEL_UNKNOWN`, `E_UNSUPPORTED_HARNESS` | | the launch selection is refused |
| `E_LAUNCH_SHIM` | | the home's `oats` (`<home>/.oats/bin/oats`) cannot be written; the spawn is rolled back |
| `E_SCHEDULE_INVALID` | | a bad wake (`--wake-json`, `--wake-file`, `--wake-*`) |
| `E_SPAWN_FAILED` | | anything else |

## `instance.json` and the roster

<a id="instancejson"></a>
### `instance.json`

Written by the spawn; read by the roster and every `--home` command. The
workspace-model fields (feature `instance-modules`):

```json
{"agent":"rm","kind":"persistent","instance":"rm-api","home":"/w/agents/rm/instances/rm-api","soulDir":"/w/agents/rm/souls/66566512168e",
 "repo":"/w/agents-repo","work":"worktree","branch":"agents/rm-api","harness":"pi","modelFrom":"harness-default","spawnOrigin":"operator",
 "policy":{"childSpawns":{"allowed":true,"origin":{"kind":"default","detail":"no spawn option: children allowed"}}},
 "modules":{"oats.okf":{"from":{"kind":"package","package":"oats.okf","version":"2.1.3","commit":"ab897841…","integrity":"sha256-bada35…","repoKey":"github.com/awebai/oats-okf"},
                        "commit":"ab897841…","digest":"sha256-9a0e…","materializedAt":"2026-09-28T10:08:01.100Z"}},
 "providers":{"oats.okf":{"owns":"rm","state-dir":"/Users/ana/.oats/okf"}},
 "workspace":{"key":"github.com/nw/agents","name":"northwind","deployment":"/w","commit":"66566512…","resolution":"abacbdb5a7975098d77007c8","standalone":false,
              "soul":{"id":"github.com/nw/agents#rm","repoKey":"github.com/nw/agents","commit":"66566512…"},
              "layers":{"knowledge":{"capability":"oats.okf","from":"workspace"},"messaging":null,"tasks":null}},
 "teams":[{"label":"mine","team":"mine:ana.aweb.ai","default":false,"from":"local"}],
 "defaultTeam":{"label":"eng","team":null,"from":"soul"},
 "capabilities":[{"id":"oats.okf","layer":"knowledge","command":"okf","origin":"package:oats.okf@2.1.3","level":"/w/agents/rm/instances/rm-api",
                  "settings":{"owns":"rm","state-dir":"/Users/ana/.oats/okf"},"settingsOrigins":{},"provenance":["package oats.okf v2.1.3"],
                  "skills":["/w/agents/rm/instances/rm-api/.agents/skills/oats.okf/okf"],"hooks":["retire","spawn"],"trusted":true}],
 "skills":[{"name":"release-checklist","source":"soul"},{"name":"okf","source":"module:oats.okf"}],
 "createdAt":"2026-09-28T10:08:01.281Z"}
```

Abridged: the record also carries the launch recipe and command,
composition evidence, the capability runtime, the tmux target,
lineage (`parentInstance`, `siblingInstance`, `relation`, `relativeTo`), and
the keyed-spawn fields `decision`, `spawnIdempotencyKey`, `spawnCompleted` and
`wake`; later starts add `restarts` and `restartCount`.

- `modules.<cap>`: `{from, commit, digest, materializedAt}`; `digest` hashes
  the copy at `<home>/.oats/modules/<cap>/`. Module skills are copied flat to
  `<home>/.agents/skills/<skill>/` (homes spawned by 0.30.1 or earlier keep
  `<home>/.agents/skills/<cap>/<skill>/`).
- `providers.<cap>`: the merged payload (`{}` when none).
- `workspace`: `{key, name, deployment, commit, resolution, standalone, soul,
  layers}`. `name` is recorded, and every hook, command and operation of the
  home receives it as `OATS_WORKSPACE_NAME`. `soul.id` is `<repoKey>#<soul>`,
  or `package:<id>#<soul>` for a package soul, which also records `name`,
  `qualifiedName` and `package: {id, version, commit, digest, path}`.
  `layers.<slot>` is `{capability, from}` or `null`. A standalone spawn
  records `standalone: true` and the member's key.
- `teams` (mapped rows, as the providers received them) and `defaultTeam`
  are never rewritten.
- `soulDir` is the soul the instance incarnates; hooks receive it as
  `OATS_SOUL`. Homes carry no `soul` link.
- `modelFrom`: see the roster. `trigger` (a triggered instance): `{id, key,
  source, repo, number, url, event, headSha, observedAt, eventFile}`.
  `capabilityMeta.<cap>.identity`: the served identity a provider recorded.

<a id="the-roster-oats-status---json"></a>
### The roster (`oats status --json`)

```text
oats status [--dir <d>] [--max-age <s>] --json
```

Not an envelope: `{root, agents, observation?, workspace?, problems?, warnings?}`
(`observation` only with [`--max-age`](#observation-reuse-feature-observe-max-age-oats-0303)).

```json
{"root":"/w/agents",
 "agents":[{"name":"rm","description":"Cuts releases.","work":"worktree","kind":"persistent","dir":"/w/agents/rm",
            "soulSource":{"repoKey":"github.com/nw/agents","commit":"66566512…","path":"souls/rm","current":"66566512…","status":"current"},
            "instances":[{"agent":"rm","instance":"rm-api","home":"/w/agents/rm/instances/rm-api","harness":"pi","launched":true,
                          "createdAt":"2026-09-28T10:08:01.281Z","modelFrom":"harness-default","startedAt":"2026-09-28T10:08:01.281Z","identityAddress":null,"running":true,
                          "modules":[{"name":"oats.okf","from":{"kind":"package","package":"oats.okf","version":"2.1.3","commit":"ab897841…","integrity":"sha256-bada35…","repoKey":"github.com/awebai/oats-okf"},
                                      "commit":"ab897841…","current":{"commit":"ab897841…","version":"2.1.3"},"status":"current"}],
                          "soul":{"repoKey":"github.com/nw/agents","commit":"66566512…","current":"66566512…","status":"current"}}]}],
 "workspace":{"reachable":true}}
```

- **Agent rows**: the soul's recorded definition plus `dir` and `instances`,
  and (feature `launch-preference`) `key`: the soul key, as on
  [soul rows](#oats-capabilities-and-oats-souls), or `null` when no instance
  records a workspace soul;
  `soulSource` (`{repoKey, commit, path, current?, status?}`, `current` or
  `moved`) for a workspace soul; `retireFailures[]` (`{instance, completedAt,
  error, incomplete, retry, resultPath}`) when a deferred self-retire failed.
  A capability agent's row is `{name, kind: "capability", capability,
  description, dir, instances}`.
- **Instance rows**: the home's `instance.json` (launch recipe and command
  redacted) plus `home` and `instance` (from the directory; a disagreeing
  claim is kept as `recordedHome`/`recordedInstance`), `running` (read from
  the row's recorded tmux socket and session, never the caller's `$TMUX`;
  `null` with `runtimeState: "unreachable"` and the tmux error as
  `runtimeError` when that server cannot be read; `null` for a home a
  Herdr-era kernel recorded, with `runtimeState: "unsupported"` and
  `runtimeError: "E_HERDR_REMOVED: …"`, the recorded `sessionTarget` staying
  in the row),
  `identity` when a provider recorded one, `rollbackIncomplete` and
  `retirePending` when present, and the Desktop facts below.
- **`modules`** becomes drift rows `{name, from, commit, current, status,
  reason?}` when the workspace was read. `status` is `current`, `moved` or
  `missing` (`reason`: `capability-absent`, `package-absent`, or the member's
  unconfirmed reason; `current: null`). `current` is `{commit, version}`
  (`version` on member rows is a Desktop fact). A package module without a
  lock reads `current`.
- **`soul`** is the soul source's drift `{repoKey, commit, current, status,
  reason?}`; a package soul adds `package`, `version`, `currentVersion`
  (`missing` reasons: `package-absent`, `soul-absent`).
- **`workspace`**: `{reachable: true}`, or `{reachable: false, code, reason,
  message}` (modules then stay the recorded map). Absent without
  `oats-local.yaml`.
- `problems`: the legacy-home rows ([dispatch errors](#dispatch-errors)).
  `warnings`: envelope warnings. `--team` is `E_BAD_ARGS` (an envelope).

**Desktop facts** (feature `desktop-facts`): `startedAt` is the last start or
restart, else `createdAt` for a launched home, else `null`. `modelFrom` is
`"soul"`, `"spawn"` or `"start"` (an explicit `--model`), `"launch-config"`,
`"harness-default"`, or `null` for an older home. `identityAddress` is the
messaging identity's `address` (else `alias`), or `null`.

<a id="the-remote-roster-oats-server-roster---json"></a>
### The remote roster (`oats server roster --json`)

```text
oats server roster [--server <id>] [--per-target <ms>] [--budget <ms>] --json
```

An envelope; `result` is `{groups, bounds}` (remote `roster`,
[servers.md](servers.md#the-roster-and-harvest)). One group per server id and
route target:

```json
{"id":"build:3f2a…","server":"build","label":"Build box","registrationPresent":true,
 "target":{"sshHost":"build-host","workspace":"/srv/team","oatsPath":"oats"},
 "probe":{"ok":true},"agentsRoot":"/srv/team/agents",
 "souls":[{"name":"dev","harness":"claude","work":"worktree","agentsRoot":"/srv/team/agents"}],
 "instances":[{"server":"build","instance":"dev-a","agent":"dev","home":"/srv/team/agents/dev/instances/dev-a",
               "agentsRoot":"/srv/team/agents","harness":"claude","backend":"tmux","tmux":{"session":"oats-agents","window":"dev-a"},
               "running":true,"identity":{"alias":"dev-a","address":"acme/dev-a"},"identityAddress":"acme/dev-a",
               "teams":[{"label":"default","team":"acme:team"}],"startedAt":"2026-09-29T10:00:00.000Z","createdAt":"2026-09-29T09:58:12.004Z",
               "model":"opus","runtimeState":null,"parentInstance":"lead","siblingInstance":null,"relation":"child","relativeTo":"lead",
               "spawnOrigin":"instance","retirePending":false,"rollbackIncomplete":false,
               "savedRoute":false,"addressable":true,"missingRemotely":false}],
 "retireFailures":[]}
```

- **Instance rows** relay the host's own `status --json` row: `identity`,
  `identityAddress`, `teams`, `startedAt`, `createdAt`, `model`,
  `runtimeState`, `parentInstance`, `siblingInstance`, `relation`,
  `relativeTo` and `spawnOrigin` are always present, `null` when the host
  does not supply them (a host before 0.31, a fact it never recorded, or a
  saved route the host no longer lists). Nothing is derived on this side.
- **`addressable`** (0.31): `true` for every row the host reports. Routed
  session and lifecycle commands reach it by `--home`, or by name when the
  name is unique on the host ([addressing](servers.md#run-there); a shared
  name is `E_AMBIGUOUS` with `error.details.candidates: [{agent, home}]`). A
  saved-route row the host did not list is addressable only while the host's
  answer is unknown (`missingRemotely: false`).
- **`savedRoute`**: the instance was spawned from this machine and has a
  saved route here. Information only; no action depends on it.
- `running` is `null` when unknown; `backend` is `tmux` for a row with a tmux
  target, else `null`; `tmux`, `sessionTarget` (the recorded target of a home
  a Herdr-era kernel opened) and `runtimeError` are as the host reports them.

<a id="routed-reads-and-plans"></a>
### Routed reads and plans (`--server`, 0.31)

The Desktop's per-instance reads and the lifecycle plans run on the
instance's own machine: the local command, with `--server <id>` added.

| Command | `remote` entry | The host must advertise |
|---|---|---|
| `oats readiness --server <id> (--home <abs> \| --soul <n>) …` | `readiness` | `readiness`, `readinessApi: 2` |
| `oats instance events <name> --server <id> …` | `instance-events` | `instance-events-2`, `eventsApi: 2` |
| `oats instance git\|diff <name> --server <id> …` | `instance-git` | `instance-git`, `instanceGitApi: 1` |
| `oats instance stop <name> --server <id> (--plan \| --apply …)` | `lifecycle-plans` | `lifecycle-plans`, `lifecycleApi: 1` |
| `oats retire <name> --server <id> --plan`, and the guarded apply (`--plan-revision`, `--idempotency-key`) | `lifecycle-plans` | `lifecycle-plans`, `lifecycleApi: 1` |

- The flags are the local command's. The instance is addressed like every
  routed instance command ([servers.md](servers.md#run-there)): `--home` as
  given, else the name through its saved route or the host's roster, sent
  as `--home`. `--dir` names a directory on the host and travels as is;
  without it the registered workspace is sent (not for `readiness --home`,
  whose home is its own context). A retire plan and its guarded apply take
  `--dir` like the rest; an unguarded `retire --server` refuses it.
- An instance with a saved route is reached through it, registration or not.
  A guarded retire apply whose name the host no longer lists is sent by name,
  so a repeated key gets the host's recorded receipt (or its refusal).
- The host's envelope is relayed unchanged, success or failure: the same
  document the local command answers, with no routing keys added. The
  guarded retire apply is the routed `retire`, whose result carries
  `server` and `target` as before.
- A host that does not advertise the feature and API number is refused with
  `E_REMOTE_INCOMPATIBLE`, naming both and the host's version, before
  anything is sent. A name two homes share on the host is `E_AMBIGUOUS`.

<a id="instance-git-state-oats-instance-gitdiff-instancegitapi-1-oats-0247"></a>
## Git and diff

Feature `instance-git` (`instance-git-remote` for `remote`),
`instanceGitApi: 1`. A read-only observation of one instance's work tree: the
branch the tree is on, not the recorded one (reported under `recorded`).

```text
oats instance git <instance> [--home <abs>] [--dir <d>] --json
oats instance diff <instance> --file <id> --revision <rev> [--index-revision <idx>] [--home <abs>] [--dir <d>] --json
```

`<instance>` is resolved under the deployment's agents root. Several homes of
that name: `E_AMBIGUOUS_INSTANCE {candidates: [{root, agent, home}]}` (pass
`--home`; a wrong one is `E_HOME_MISMATCH`). Unknown: `E_SESSION_UNKNOWN`. No
tree: `E_NO_WORKTREE`.

```json
{"instanceGitApi":1,"instance":"dev-1","agent":"dev","home":"/w/agents/dev/instances/dev-1","workMode":"worktree",
 "observation":{"revision":"46c20668…","indexRevision":"3147fef2…","at":"2026-09-26T18:15:26.487Z","worktree":"/w/agents/dev/instances/dev-1/work",
                "branch":"feat/y","detached":false,"unborn":false},
 "recorded":{"branch":"agents/dev-1","repo":"/w/one","drift":true},
 "upstream":{"ref":"origin/feat/y","ahead":1,"behind":0},
 "base":{"ref":"origin/main","source":"origin/HEAD","mergeBase":"46c20668…","ahead":2,"behind":0},
 "remote":{"name":"origin","url":"git@github.com:acme/one.git","host":"github.com","path":"acme/one","source":"branch-upstream"},
 "summary":{"changed":1,"renamed":1,"copied":0,"unmerged":0,"untracked":1},
 "files":[{"id":"0d0cd6557e40c03eba2abd46","kind":"renamed","xy":"R.","submodule":false,"score":"R100","path":"src/new.txt","origPath":"src/old.txt",
           "additions":84,"deletions":3,"binary":false}],
 "notes":[]}
```

- `observation.revision` is the HEAD oid (or `unborn`); `branch` is `null`
  when detached.
- `upstream` without one is all `null` (unknown, not zero). `base` compares
  with the default branch's merge-base; `source` is `origin/HEAD` or
  `well-known`; none found is all `null` plus a note.
- `remote` (feature `instance-git-remote`): the branch's remote (`source:
  "branch-upstream"`), else `origin` (`"origin"`), else `null`; `host` and
  `path` are parsed from the URL (`host: null` for a local path). The kernel
  has no forge data.
- `files[]` come from porcelain v2: `kind` is `changed | renamed | copied |
  unmerged | untracked`; renames and copies carry `origPath` and `score`;
  ignored files are omitted. `summary` counts rows per kind.
- `files[].id` is opaque, minted under (`revision`, `indexRevision`); it is
  the only way to ask for a diff.
- `additions`, `deletions`, `binary`: line counts of the working tree against
  the observed commit. A binary file is `{null, null, true}`; an untracked
  file or submodule is all `null`; if counting fails every entry is `null`
  with a note. `null` means unknown.

The diff answers `{instanceGitApi: 1, observation, file: {id, kind, xy,
path, origPath}, against, binary, bytes, truncated, limit: 262144, patch,
readOnly: {helpers: "disabled", optionalLocks: "off", objectsWritten: 0}}`.

- `against` is the observed revision (the working tree against that commit,
  index included) or `"empty"` for an untracked file. A binary file has an
  empty patch; over 256 KiB, `truncated: true`.
- The read runs without external diff, textconv, fsmonitor, hooks, the
  caller's Git environment or global config, and writes nothing (`readOnly`).
- If HEAD or the index moved, the id is not in the current observation, or
  anything moved during the read: `E_STALE_OBSERVATION` with
  `details.observation`. Re-observe; never render a diff of another tree.
- A `--file` that is not 24 hex, or no `--revision`: `E_BAD_ARGS`. Git
  failure: `E_GIT_FAILED`.

## Events

Feature `instance-events-2`, `eventsApi: 2`: typed lifecycle events, written
by the kernel action that made them true.

```text
oats instance events <instance> [--limit <n>] [--since <iso>] [--home <abs>] [--dir <d>] --json
```

```json
{"eventsApi":2,"instance":"dev-1","home":"/w/agents/dev/instances/dev-1","incarnation":"2026-09-28T10:08:01.281Z",
 "count":1,"returned":1,"truncated":false,
 "integrity":{"unreadableRows":0,"foreignRows":0,"sources":[{"path":"home","status":"ok","bytes":612},{"path":"workspace","status":"ok","bytes":612}]},
 "events":[{"eventsApi":2,"at":"2026-09-28T10:08:02.000Z","instance":"dev-1","home":"/w/agents/dev/instances/dev-1","incarnation":"2026-09-28T10:08:01.281Z",
            "producer":"kernel","kind":"spawned",
            "data":{"agent":"dev","work":"worktree","branch":"agents/dev-1","harness":"claude","model":null,"parentInstance":null,"relation":null,"launched":true}}],
 "lastEvent":{"kind":"spawned","at":"2026-09-28T10:08:02.000Z","producer":"kernel","incarnation":"2026-09-28T10:08:01.281Z"},
 "waitingOnYou":null,"waitingClaims":[],"notes":["…"]}
```

- **Sources.** `home` is `<home>/.oats-events.jsonl`; `workspace` is
  `<deployment>/.agents/events/<agent>--<instance>.jsonl` (it survives the
  home). Each is `{path, status: "ok" | "absent" | "refused" | "tail",
  bytes}`. Only a regular file is opened (no symlinks, same device and inode
  after open), and at most its last 4 MiB is read (`"tail"`).
- **Kinds:** `spawned`, `launched`, `restarted`, `stopped`, `stop-refused`,
  `retire-planned`, `retired`, `worktree-retained`, `worktree-removed`,
  `branch-deleted`, `child-spawn-refused`, `launch-warning` (0.30: a
  `launch` hook's warning at session start/restart, `data: {message}`),
  `recomposed` (from earlier kernels). `producer` is `kernel` or a capability id. Older rows may carry
  `eventsApi: 1`.
- **Incarnation.** Each row carries the writing home's `createdAt` (or
  `null` for old rows); the top-level `incarnation` is the current home's (or
  `null`). Earlier incarnations are returned as this address's history.
- **Address.** `--home` must be a home of `<instance>` (`E_HOME_MISMATCH`).
  Rows for another address are dropped and counted in
  `integrity.foreignRows`; torn or invalid lines are counted in
  `integrity.unreadableRows`. Duplicates are removed.
- **Window.** `count` is the rows after `--since`; `returned` the window
  (`--limit`, default 200, 1–2000); `truncated` means rows were cut or a
  source was a tail. `lastEvent` is `{kind, at, producer, incarnation}` of
  the last returned row, or `null`.
- **Waiting.** `waitingClaims[]` is `{producer, waiting, since, reason}` per
  producer with a claim in the current incarnation (cleared ones included).
  A producer's latest row with `data.waitingOnYou` decides. `waitingOnYou` is
  `{since, producer, reason}` of the newest positive claim, or `null`
  (unknown, not "not waiting"). No kernel path claims waiting today.
- Errors: `E_SESSION_UNKNOWN`, `E_AMBIGUOUS_INSTANCE`, `E_HOME_MISMATCH`,
  `E_BAD_ARGS`, `E_EVENTS_FAILED`.

## Lifecycle: stop and retire

Feature `lifecycle-plans` (and `retire-retention`), `lifecycleApi: 1`. A
**plan** lists what an action would touch, with a `planRevision` (24 hex)
hashed from the facts that make it safe. Apply carries the revision back; if
reality moved it refuses `E_PLAN_STALE` with the fresh `details.plan`. An
idempotency key (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`) makes a retried apply
return the first receipt. Recorded parentage (`parentInstance`) is the only
relation followed; a child whose parent name matches several homes is listed
under `ambiguous` and never acted on.

### Stop

```text
oats instance stop <instance> --plan [--no-recursive] [--home <abs>] [--dir <d>] --json
```

```json
{"lifecycleApi":1,"action":"stop","instance":"dev-1","home":"/w/agents/dev/instances/dev-1","recursive":true,"at":"2026-09-28T11:00:00.000Z",
 "targets":[{"instance":"dev-1","agent":"dev","home":"/w/agents/dev/instances/dev-1","depth":0,"workMode":"worktree","launched":true,
             "session":{"state":"unknown","present":true,"backend":"tmux","established":true},
             "work":{"observed":true,"revision":"46c20668…","branch":"feat/x","detached":false,"drift":false,"changed":2,"untracked":1,
                     "upstream":{"ref":null,"ahead":null,"behind":null},"base":{"ref":"origin/main","ahead":1,"behind":0},"remote":{"host":"github.com","path":"acme/one"}},
             "retiring":false,"stopPending":false,"midTask":true}],
 "skipped":[],"ambiguous":[],"planRevision":"9c1f2e3d4b5a69788796a5b4","notes":[]}
```

- `targets`: the recorded descendants, deepest first, then the instance
  (`depth: 0`). With `--no-recursive` descendants go to `skipped` (`{instance,
  agent, home, reason: "recursive=false"}`). `ambiguous[]`: `{instance, agent,
  home, reason}`.
- `session.state` is the backend's word: `shell`, `stopped` and
  `not-launched` are idle; `unknown` is a running process tmux cannot name
  (the normal state of a harness). Not established: `{state:
  "unestablished", present: null, backend: null, established: false,
  reason}`; render it as unknown, never idle.
- `work` is the Git observation summarized (`changed` counts changed,
  renamed, copied and unmerged rows), or `{observed: false, reason}`.
- `midTask`: `true`, `false` or `"unknown"`.

```text
oats instance stop <instance> --apply --plan-revision <rev> --idempotency-key <key> [--no-recursive] [--grace-ms <n>] [--home <abs>] --json
```

Children first: SIGTERM to the harness processes and a bounded wait
(`--grace-ms`, 1–300000, default 20000), never escalated. Home, work,
transcript and launch configuration are kept; `oats session restart` brings
the instance back.

- The receipt is `{lifecycleApi: 1, action: "stop", instance, home,
  idempotencyKey, planRevision, at, ok, results, retained: ["home", "work",
  "transcript", "launch"], replayed: false}`. A result is `{instance, home,
  ok: true, stopped, alreadyIdle, state}` or `{instance, home, ok: false,
  code, message, stillRunning: [pid]}`.
- `ok: false`: at least one target still runs (text mode exits 1).
- A replay is the stored receipt (`<home>/.oats-stop-receipt.<key>.json`)
  with `replayed: true`.
- Refusals: `E_BAD_ARGS` (no `--plan-revision`, a bad key, not exactly one of
  `--plan`/`--apply`), `E_PLAN_STALE`, `E_INSTANCE_RETIRING` and
  `E_LIFECYCLE_BUSY` (each with `details.plan`), `E_SESSION_UNKNOWN`,
  `E_AMBIGUOUS_INSTANCE`, `E_HOME_MISMATCH`, `E_LIFECYCLE_FAILED`.

<a id="retire"></a>
### Retire

```text
oats retire <instance> --plan [--home <abs>] [--dir <d>] --json
```

```json
{"lifecycleApi":1,"action":"retire","instance":"dev-1","home":"/w/agents/dev/instances/dev-1","at":"2026-09-28T11:10:00.000Z",
 "facts":{"session":{"state":"shell","present":true,"backend":"tmux","established":true},
          "work":{"observed":true,"revision":"46c20668…","branch":"feat/x","detached":false,"drift":true,"changed":0,"untracked":1,
                  "upstream":{"ref":null,"ahead":null,"behind":null},"base":{"ref":null,"ahead":null,"behind":null},"remote":null},
          "workMode":"worktree","repo":"/w/one","recordedBranch":"agents/dev-1",
          "children":[{"instance":"dev-1-child","agent":"dev","home":"/w/agents/dev/instances/dev-1-child","session":{"state":"shell","present":true,"backend":"tmux","established":true}}],
          "ambiguous":[],"pullRequest":"unknown"},
 "defaults":{"retainWorktree":true,"deleteBranch":false,"stopChildren":true,"retainChildren":true},
 "planRevision":"4e5f6a7b8c9d0e1f2a3b4c5d","notes":["the worktree is on feat/x, not the recorded agents/dev-1; …"]}
```

- The plan changes nothing except appending a `retire-planned` event to the
  workspace log. `pullRequest` is always `"unknown"`. Branch actions use the
  worktree's branch, never `recordedBranch`.
- A home spawned before 0.25.9 has no session receipt (0.30). Its
  `facts.session` is `{state: "absent", present: false, backend, established:
  true, note}` when the session is observably gone: instance.json records no
  launch, or the recorded tmux server is not running, or the recorded window
  is gone and no pane on that server works in the home, and in every case no
  live process on the host has its working directory in the home (`lsof`; a
  scan that cannot run counts as not absent). Retire then proceeds
  without quiescing (hooks run, work is preserved). Otherwise it stays
  `unestablished`, with a `note` saying why, and retire refuses with
  `E_RUNTIME_ENDPOINT_UNKNOWN`, `--force` included. `notes` repeats either
  case. Read an unknown `state` as not idle.

Plain `retire` keeps a worktree-mode instance's work: the worktree is moved
(`git worktree move`) to `<deployment>/.agents/worktrees/<repo>/<branch>` (a
`-2` suffix if taken; `detached-<oid12>` when detached), state intact.

```text
oats retire <instance> [--plan-revision <rev> --idempotency-key <key>] [--discard-worktree] [--delete-branch] [--home <abs>] --json
```

A first retire prints the **raw receipt**, not an envelope:

```json
{"retired":"dev-1","agent":"dev",
 "retention":{"worktree":"retained","movedTo":"/w/.agents/worktrees/one/feat-x","branch":"feat/x","detachedAt":null,"recordedBranch":"agents/dev-1"},
 "worktreeRemoved":false,"branchDeleted":false,"removedDir":true,
 "workRecovery":{"path":"/w/.agents/recovered/dev-1-20260928T111000Z","classes":["untracked"],"bytes":2048,
                 "outputs":{"paths":[{"path":"notes.md","bytes":2048}],"bytes":2048}},
 "childrenStopped":[{"instance":"dev-1-child","home":"/w/agents/dev/instances/dev-1-child","ok":true,"stopped":false,"alreadyIdle":true}],
 "planRevision":"4e5f6a7b8c9d0e1f2a3b4c5d","idempotencyKey":"r1","replayed":false}
```

- `retention`: `{worktree: "retained" | "removed" | "absent", movedTo?,
  branch, detachedAt?, recordedBranch, branchDeleted?,
  branchDeletionSkipped?: {expected, actual, reason}}`, or `null` for a
  non-worktree mode.
- `--discard-worktree` removes the worktree. `--delete-branch` deletes the
  worktree's verified branch (re-verified at deletion time) and implies
  discarding; a mismatch deletes nothing and reports
  `branchDeletionSkipped`.
- `workRecovery` (or `workRecoveries[]`): `{path, classes, bytes, outputs?,
  repoCopy?}`; `outputs: {paths: [{path, bytes}], bytes}` names what was
  copied beyond tracked state, largest first.
- When they apply: `rollbackIncomplete` and `retainedHome` (cleanup
  incomplete, home kept, exit 1), `forcedIncomplete`, `relinked`,
  `capabilityMeta`, `warnings`, `wakeSchedulesRemoved`.
- A deferred self-retire (`--self`) prints `{retired, agent, deferred: true,
  pendingMarker, resultPath, logPath, completesInSec, completionPid}`, or
  `{…, alreadyScheduled: true, requestedAt}`.

**Guarded apply** (what the Desktop sends): `--plan-revision` and
`--idempotency-key` together.
- A used key replays its receipt as an **envelope** with `replayed: true`
  (receipts live beside the instances directory and outlive the home).
- The revision is checked against a fresh plan: `E_PLAN_STALE {plan}`.
- Children are stopped first (never escalated) and kept; `childrenStopped[]`
  lists them. One still running refuses everything: `E_CHILDREN_RUNNING
  {childrenStopped, plan}`.
- A first guarded retire prints the raw receipt with `planRevision`,
  `idempotencyKey` and `replayed: false`.

Refusals (envelopes): `E_PLAN_STALE`, `E_CHILDREN_RUNNING`,
`E_WORK_PRESERVATION_FAILED` (the home is kept; retry or
`--discard-worktree`), `E_SESSION_UNKNOWN`, `E_AMBIGUOUS_INSTANCE`,
`E_NO_ROOT`, `E_LIFECYCLE_FAILED`. A recovery whose Git status disagrees with
the source's carries `details: {home, statusDisagreement: {repo, rows: [{path,
source, recovery}], total}}` (the first 10 paths). Usage errors are text on
stderr, not envelopes.

## Sessions and launch configurations

### Start and restart

```text
oats session start --home <abs> [--launch-config <name>|none] [--harness pi|claude|codex] [--model <id>] [--yolo|--no-yolo] [--server <id>] --json
oats session restart --home <abs> [the same options] [--stop-grace <1-300 s>] --json
```

Features `session-start`, `session-restart`, and `launch-config` for the
selection flags. See [the start workflow](desktop-instance-start.md).

- The result is `{instance, agent, home, harness, backend, model,
  launchConfig, yolo, target, startedAt, restartCount, reused, warnings}`,
  plus `nativeRecordId` and `stop` (a restart's stop receipt) when they apply.
- `warnings` (0.30) is always present: an array of strings, the warnings the
  capabilities' `launch` hooks returned for this start (as spawn's
  `warnings`), `[]` when there are none. Each is also appended to the
  instance's events as a `launch-warning` row, `data: {message}`. They are
  advisory: the start went ahead. Earlier kernels omit the field; read a
  missing `warnings` as `[]`.
- Restart is one command: the kernel validates the new selection before
  stopping, and owns the stop, lock, launch recovery and metadata. Never
  restart by retiring and spawning.
- A lost response does not mean the launch failed: check status before a
  retry. A remote home's saved route names its execution host.
- Errors: `E_BAD_ARGS`, `E_SESSION_UNKNOWN`, `E_UNSUPPORTED_MODE`,
  `E_SESSION_START_BUSY`, `E_INSTANCE_RETIRING`, `E_LAUNCH_*` (among them
  `E_LAUNCH_SHIM`: the home's `oats` link cannot be written, nothing was
  started), `E_MODEL_UNKNOWN`, `E_UNSUPPORTED_HARNESS`, `E_SESSION_FAILED`.

### Upload

```text
oats session upload (--home <abs> | --server <id> --instance <name> | --server <id> --home <abs>) --file <path> --json
```

Feature `session-upload`: copies a file (at most 64 MiB) into the instance's
attachments. Remotely the bytes go on ssh stdin to the host's `session
receive`, and the sha256 is verified.

The result is `{path, bytes, sha256, name, home, source}` (`path` is the
stored file); a remote upload adds `server`, `instance` and `stderr?`. Errors:
`E_BAD_ARGS`, `E_UPLOAD_TOO_LARGE`, `E_UPLOAD_FAILED` (including a remote
sha256 mismatch; the remote file is left), `E_SESSION_UNKNOWN`,
`E_REMOTE_INCOMPATIBLE`.

### Launch configurations

```text
oats launch-config list [--dir <d> | --home <abs> | --soul <name> [--dir <d>] [--agents-root <abs>]] --json
oats launch-config set <name> --file <definition.json | -> [--keep-env] [--dir <d>] --json
oats launch-config remove <name> [--dir <d>] --json
oats launch-config preview (--home <abs> | --soul <name> [--dir <d>]) [--launch-config <name>|none] [--harness <h>] [--model <id>] [--yolo|--no-yolo] --json
```

Feature `launch-config`. Configurations are a host choice in
`oats-local.yaml` `launch-configs:` ([syntax](configuration.md)). All four
accept `--server <id>`.

```json
{"context":"/w","level":"/w","file":"/w/oats-local.yaml","selected":null,
 "configurations":[{"name":"reviewers","harness":"claude","executable":null,"args":["--permission-mode","plan"],
                    "env":{"ANTHROPIC_API_KEY":{"fromEnv":"REVIEW_KEY"},"REVIEW_MODE":{"redacted":true}},
                    "model":"opus","yolo":null,"source":"/w/oats-local.yaml","shadows":[]}]}
```

- **list**: `selected` is `null`, `{home, instance}` or `{soul, agentsRoot}`;
  `level` and `file` are `null` without an `oats-local.yaml` (the set is then
  empty). An environment literal is `{redacted: true}`, a reference
  `{fromEnv}`; values never leave the file.
- **set**/**remove**: `{name, action, level, file, before, after,
  effective}`. `set --file` takes `{harness, executable?, args?, env?, model?,
  yolo?}` (`-` reads stdin). `--keep-env` keeps the declared environment when
  `env` is omitted. Errors: `E_LOCAL_MISSING`, `E_BAD_ARGS` (including
  `--home`/`--soul`), `E_LAUNCH_CONFIG_UNKNOWN`, `E_LAUNCH_CONFIG_INVALID`,
  `E_CONFIG_BROKEN`, `E_HOME_UNKNOWN`.
- **preview** (read-only) answers `{context, selected, selection: {source,
  launchConfig, harness, model, yolo}, harness, model, modelSource, yolo,
  launchConfig, launchConfigSource, executable: {path, declared,
  resolvedFrom}, argv, environment: [{name, fromEnv} | {name, redacted:
  true} | {name, reference: true}], command (redacted), prompt, hooks,
  preflight: [{check, ok, detail}], ok}`.

A successful envelope can carry `ok: false`: show the failed `preflight`
checks. The prompt is named, never the task body. A home predating launch
recipes answers its frozen command with `selection.source: "frozen-command"`
and `hooks: null`; a selection on it is `E_LAUNCH_LEGACY`. Editing a
definition never changes a running instance's recipe.

<a id="schedules-and-triggers"></a>
## Schedules and triggers

Schedules (feature `schedule`, `scheduleApi: 2`; history feature
`schedule-read-2`, `scheduleHistoryApi: 3`), triggers (feature `triggers`,
`triggerApi: 1`) and workspace automations (feature `automations`,
`automationsApi: 1`). Model: [schedules.md](schedules.md#triggers).

The lists stay separate: a trigger never appears in `schedule list`, nor a
schedule in `trigger list`. Each answers this machine's local items and every
workspace item of a readable member. Render the rows; never re-derive them.

### `oats schedule`

```text
oats schedule list [--dir <d>] --json
oats schedule show <id> --json
```

```json
{"scope":"/w","scheduleApi":2,"scheduleHistoryApi":3,
 "integrity":{"sources":[{"path":"definitions","status":"ok","bytes":1206},{"path":"state","status":"ok","bytes":4410}]},
 "host":{"name":"ana-laptop","ghUser":{"github.com":"ana"}},"triggers":{"count":4,"command":"oats trigger list"},
 "snapshot":{"takenAt":"2026-09-26T19:58:09.281Z","problems":1},
 "schedules":[{"id":"nightly","kind":"spawn","cron":"0 7 * * *","tz":"Europe/Madrid","agent":"rm","task":"Check the release branch.","purpose":"nightly",
               "enabled":true,"createdAt":"2026-09-26T19:58:09.380Z","updatedAt":"2026-09-26T19:58:09.380Z","scope":"/w","scheduleApi":2,"scheduleHistoryApi":3,
               "executionStatus":{"kind":"legacy","capture":"unknown","migrationRequired":true},
               "nextRun":"2026-09-29T05:00:00.000Z","nextDue":"2026-09-29T05:00:00.000Z","lastRun":null,
               "history":{"status":"ok","stored":1,"truncated":false},
               "recentRuns":[{"scheduledFor":"2026-09-28T05:00:00.000Z","startedAt":"2026-09-28T05:00:01.000Z","kind":"spawn","outcome":"ended",
                              "runId":"3f9a0b1c2d3e4f5a6b7c8d9e","legacy":false,"settled":true,"recordedAt":"2026-09-28T05:40:00.000Z","transitions":["started","ended"],
                              "session":{"instance":"rm-nightly","home":"/w/agents/rm/instances/rm-nightly","incarnation":"2026-09-28T05:00:01.000Z","server":null,"delivery":"launched"}}],
               "running":false,"name":"nightly","qualifiedId":"local/nightly",
               "origin":{"kind":"local","path":"oats-schedules.json","url":null,"localPath":"/w/oats-schedules.json"},
               "description":null,"owner":null,"runsOn":null,"runsHere":true,"reason":null,"enabledHere":true,
               "soul":{"name":"rm","origin":{"kind":"member","repoKey":"github.com/nw/agents","member":"agents"}},
               "teams":[],"launchConfig":null,"harness":null,"model":null,"concurrency":null}],
 "scheduler":{"installed":true,"active":true,"registered":true,"lastTick":"2026-09-28T11:59:00.000Z","maxConcurrent":2}}
```

- `list`: `{scope, scheduleApi, scheduleHistoryApi, integrity, host,
  triggers, snapshot, schedules, scheduler}`; `triggers` counts the trigger
  definitions left out. `show <id>`: `{schedule}`, without `integrity`.
- **A readable row**: the definition (`id, kind, cron, tz, enabled, …`, and
  `agent/task/purpose/harness` for a spawn, `argv/cwd` for a command, the
  message for a wake, the operation for an operation) plus `scope,
  scheduleApi, scheduleHistoryApi, executionStatus, nextRun, lastRun, history,
  recentRuns, running, attempt?, pendingWake?` and the
  [shared row fields](#automations-shared-rows).
  `executionStatus` is `{kind: "legacy" | "invalid", capture: "unknown",
  migrationRequired: true, reason?, intent?}`; only `legacy` runs.
- **An unreadable row** (`list` only): `{id, scope, scheduleApi,
  scheduleHistoryApi, unreadable: {code, message}, history: {status:
  "corrupt", stored: null, truncated: false}, recentRuns: []}`. One bad job
  never fails the others.
- `history`: `{status: "ok", stored, truncated}` or the corrupt form; capped
  at 50 rows.
- **A run** (`recentRuns[]`, `lastRun`): the producer's fields
  (`scheduledFor, startedAt, kind, outcome, …`) plus `runId, legacy: false,
  settled, recordedAt, transitions, session`.
  - `runId` = `sha256(scheduledFor|startedAt|attemptId)[0:24]`, opaque: never
    recompute or dedupe by it. `lastRun` shares its history row's `runId`.
  - `transitions` is the outcome sequence; `settled` a boolean. `outcome` is
    the producer's word (`ended`, `stopped`, `blocked`, `invalid`,
    `delivered`, `skipped`, `unknown`, …).
  - A pre-API-3 row: `runId: null, legacy: true, settled: null, transitions:
    null`, `session`, no `recordedAt`. A corrupt element: `{runId: null,
    legacy: true, corrupt: true}`.
  - `session` is `{instance, home, incarnation, server, delivery: "launched"
    | "delivered-active" | "none"}`: recorded provenance, not a transcript
    reader.
- `nextDue` is "when it next runs" in every row (`null` when another host
  runs it); a schedule row also keeps `nextRun`.
- **Integrity.** `oats-schedules.json` and `.agents/schedules/state.json` are
  opened as regular files only, at most 1 MiB. `integrity.sources[]` is
  `{path: "definitions" | "state", status: "ok" | "absent" | "refused" |
  "oversize" | "corrupt", bytes}`.
- Refusals: `E_SCHEDULE_STATE_OVERSIZE` and `E_SCHEDULE_INVALID` (`details:
  {source, field?}`), `E_SCHEDULE_IDENTITY` (`details: {key, declared}`), and
  `E_BAD_ARGS` for an id not matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`.
  `list` refuses as a whole only when a scope file is unreadable.

**Other verbs** (envelopes):
- `add <id> (--file <spec.json> | --spec-json <json>)`, `update`, `enable`,
  `disable` → `{schedule}`. `run [--force]`, `remove [--force]`, `reconcile
  [--clear]` → the action's receipt. `tick [--dry-run] [--host]` →
  `{tickedAt, considered, scheduler}`; `host install | uninstall | status` →
  `{scheduler}`.
- `test <id>` → `{test: {id, qualifiedId, kind, placement: {runsHere, reason,
  reasonDetail?, enabledHere, runsOn, owner, host}, soul: {name, origin,
  resolves, error} | null, nextDue, spawned: false, problems, ok}}`. The soul
  is checked as the run would start it; not running here, disabled, invalid
  or unresolved is a problem. It runs nothing.
- Errors: `E_SCHEDULE_UNKNOWN`, `E_SCHEDULE_EXISTS`, `E_SCHEDULE_INVALID`,
  `E_SCHEDULE_RUNNING`, `E_SCHEDULE_DISABLED`, `E_SCHEDULE_UNRESOLVED`,
  `E_SCHEDULE_FAILED`, `E_LOCAL_MISSING`, `E_BAD_ARGS`.

### `oats trigger`

```text
oats trigger list | show <id> | status [<id>] | test <id> | add (--file <json> | --from <package>:<template> [--set k=v]) | enable <id> | disable <id> | remove <id> --json
```

Event-driven spawns. Local definitions live in `oats-schedules.json` (`kind:
"trigger"`).

- `list`: `{triggerApi, scope, host, snapshot, triggers, scheduler}`.
  `show`, `add`, `enable`, `disable` → `{trigger}`; `remove` → `{removed,
  live: [instance]}`. A stored definition that no longer validates carries
  `invalid: {code, message, field?}`.
- **A trigger row**: the [shared row fields](#automations-shared-rows) plus
  `kind: "trigger", on, spawn, template?, enabled, triggerApi, scope,
  createdAt, updatedAt`.
  - `id` is always qualified (`local/<id>` or `<member>/<id>`); verbs accept
    `local/<id>` or a bare local id.
  - `on`: `{source: "github.pull_request", repo, events: [opened | reopened |
    ready_for_review | labeled | synchronize], labels, base?, poll}`.
  - `spawn`: `{soul, purpose, task, teams, launchConfig?, harness?, model?,
    yolo?, backend?}`. `purpose` and `task` template over `{repo}`,
    `{number}`, `{url}`, `{event}`, `{trigger}`, `{headSha}`. `teams` are
    distinct labels passed as `--provider <messaging cap> join=<labels>`; a
    soul without messaging refuses `E_TRIGGER_TEAMS {soul, teams}`.
  - `template?`: `{package, version, commit, template}`.
  - `lastRun`: `{at, instance, home, event, number, key}`; `nextDue`: the
    next poll here, `null` before the first.
- `status [<id>]` → `{triggerApi, scope, triggers: [{id, name, enabled,
  runsHere, reason, enabledHere, repo, soul, concurrency: {max, perKey},
  liveCount, live: [{instance, home, repo, number, event}], lastPoll: {at, ok:
  true, prs, matching} | {at, ok: false, error} | null, nextPollAt, nextDue,
  pending: [{key, event, number, url, observedAt}], fired: [{key, at,
  instance, home, event, number}] (newest 50), firedTotal, lastError: {at,
  code, message, key?} | null}]}`. It writes nothing.
- `test <id>` → `{triggerApi, id, ok, placement: {runsOn, owner, host,
  runsHere, reason, detail?, enabledHere}, gh: {ok, account,
  credentialSource, reachesHostTimer, note, detail}, repo: {key, readable,
  fullName, permissions: {push, maintain, admin}, canMerge} | {key, readable:
  false, error}, soul: {resolves, name, agent, messaging} | {resolves: false,
  name, error}, teams: {requested, undeclared | null, messaging}, wouldFire:
  [{key, repo, number, event, url, held?}], pollError?, problems, warnings,
  spawned: false}`. `ok` counts `problems` only; a credential the host timer
  cannot reach is a warning.
- A triggered instance records `instance.json.trigger`; its event file is
  `OATS_TRIGGER_EVENT_FILE`.
- Errors: `E_TRIGGER_INVALID {field}`, `E_TRIGGER_EXISTS`,
  `E_TRIGGER_UNKNOWN`, `E_TRIGGER_TEAMS`, `E_TRIGGER_POLL`,
  `E_TRIGGER_FAILED`, `E_BAD_ARGS`, `E_PACKAGE_MISSING`,
  `E_PACKAGE_MANIFEST`, `E_LOCAL_MISSING`.

<a id="automations-shared-rows"></a>
### Shared row fields and workspace automations

Details: [schedules.md](schedules.md#workspace-triggers-and-schedules).

**Both lists** carry `host: {name | null, ghUser: {<gh host>: <login> |
null}}` (this machine's `host.name` and its `gh` logins, compared with a
row's `owner`), `snapshot: {takenAt, problems (a count)} | null` (the last
`oats sync` snapshot), and `scheduler: {installed, active, registered,
lastTick, maxConcurrent, …}` (nothing runs unless installed, active and
registered).

**Every row** carries:
- `id` (a local schedule keeps its bare id; a workspace item is
  `<member>/<id>`), `qualifiedId` (always qualified), `name` (the bare id).
- `origin`: `{kind: "local", path: "oats-schedules.json", url: null,
  localPath}` or `{kind: "workspace", repoKey, path, commit, url,
  localPath}` (`url` for `github.com` only; `localPath` `null` when the
  member is not cloned here).
- `description`, `owner`, `runsOn`, `runsHere`, `reason` (`null` |
  `host-unnamed` | `assigned-elsewhere` | `owner-mismatch` | `untrusted`),
  `reasonDetail`, `enabledHere`.
- `untrusted` (0.30, [automations.trust](configuration.md#who-runs-workspace-automations)):
  placed on this host (`runsOn` and `owner` match) but `oats-local.yaml`
  `automations.trust` does not admit it, so it never runs here. Its
  `reasonDetail` names the line to add. Group it as needing attention, like
  `owner-mismatch`. A kernel before 0.30 never sends it; treat an unknown
  reason as "does not run here".
- `soul: {name, origin} | null` (`null` for command, wake and operation
  schedules). `origin` is `{kind: "member", repoKey, member}`, `{kind:
  "package", package, version}`, `{kind: "external", repoKey, source}`,
  `{kind: "ambiguous", candidates (a count)}`, or `null`.
- `task`, `teams`, `launchConfig`, `harness`, `model`, `concurrency`,
  `lastRun`, `nextDue`, `invalid?`. A schedule row's `kind` is its run
  (`spawn | command | wake | operation`), its `teams` is `[]` and
  `concurrency` `null`. A workspace item another host runs carries its
  definition and placement only.

**Workspace items:**
- `enable`/`disable` edit `oats-local.yaml` `triggers.disabled` or
  `schedules.disabled`. `update` and `remove` refuse `E_AUTOMATION_WORKSPACE
  {id, origin}`. `schedule run`/`reconcile` elsewhere refuse
  `E_AUTOMATION_NOT_HERE {id, reason, runsOn, owner}`.
- `oats trigger|schedule add … --workspace <member> --runs-on <host> --owner
  <host>/<login> --json` writes the file in the member clone and answers
  `{id, written, file: {member, repoKey, path, content, written?}}`. Errors:
  `E_AUTOMATION_MEMBER`, `E_TRIGGER_EXISTS`/`E_SCHEDULE_EXISTS`, and the
  kind's validation codes.
- `oats automations refresh --json` → `{automationsApi, snapshot (the file's
  path), triggers, schedules (counts), problems, takenAt}`.
- The tick's `considered[]` holds schedule rows and trigger rows `{workspace,
  trigger, action, …}` with actions `not-due`, `poll-failed`, `polled`
  (`prs`, `matching`), `held`, `fired` (`key`, `instance`, `home`),
  `spawn-failed` (`key`, `code`, `error`), `would-fire`, `invalid` and
  `not-here`. A workspace schedule's state key is `<member>~<id>`. A failed
  snapshot refresh is `{workspace, action: "error", error}`.

<a id="the-harness-rename-feature-harness-oats-0270"></a>
## Harness input spellings

What starts an instance (pi, claude or codex) is its **harness** (feature
`harness`), and every output uses that name. These inputs still accept the
older `runtime` spelling: it is read as `harness`, and the next write records
`harness`. A pair that disagrees is refused.

| Input | Old spelling | Warning | Both, disagreeing |
|---|---|---|---|
| `spawn` (and `--preview`), `session start`/`restart`, `launch-config preview`, and their `--server` forms | `--runtime <h>` | yes | `E_BAD_ARGS` |
| `oats-local.yaml` `launch-configs.<name>` | `runtime:` | yes | `E_WORKSPACE_SCHEMA` (`reason: "harness-conflict"`) |
| `launch-config set --file` | `runtime` | yes; written as `harness` | `E_LAUNCH_CONFIG_INVALID` |
| a home's `instance.json` and launch recipe `version: 1` | `runtime` | yes, naming the home; the next start records `harness` | |
| schedule definitions (`add`/`update`, stored jobs) | `runtime` | yes | `E_SCHEDULE_INVALID` |
| schedule run records | `startedRuntime` | no | |
| a flat soul.yaml (a capability-defined agent) | `runtime:` | no | `E_BAD_MANIFEST` |
| a manifest `requires[]` harness-package row | `runtime` | no | a spawn problem |

One warning per command, however many old spellings it read:

```json
{"code":"deprecated-runtime-name","key":"runtime","replacement":"harness","sources":["the --runtime flag (use --harness)"],"message":"`runtime` was renamed to `harness` in 0.27.0; the old name is still read here (the --runtime flag (use --harness)) and a later release drops it"}
```

The `--server` routes translate for a host without the `harness` feature:
they send `--runtime` and `runtime` keys and read its `runtimes` list.
