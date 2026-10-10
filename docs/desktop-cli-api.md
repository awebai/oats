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
`/w` as the deployment and shorten ids and digests with `…`. Package versions
in example payloads are illustrative snapshots, not deployment pin advice;
see the [official catalog](official-catalog.md) for current pins.

## The probe

`oats version --json` prints one object (not an envelope):

```json
{"schemaVersion":1,"name":"@awebai/oats","version":"0.30.0","desktopApi":1,
 "harnesses":["pi","claude","codex"],"sessionBackends":["tmux"],"launchOptions":["yolo"],
 "remote":["spawn","retire","status","session","session-start","session-restart","launch-config","roster","harvest","schedule","session-upload","operations",
           "readiness","instance-events","instance-git","lifecycle-plans"],
 "features":["retire-home","session-start","session-restart","launch-config","schedule","schedule-host-caps","session-upload","operations","instance-git",
             "instance-git-remote","souls-declarations","lifecycle-plans","retire-retention","readiness","spawn-preview","instance-events",
             "instance-events-2","schedule-history","schedule-read-2","spawn-preview-2","spawn-idempotency","spawn-idempotency-2","spawn-apply-2",
             "workspace-v2","instance-modules","spawn-provider-payload","served-identity","packages-no-approval","spawn-name","settings-origins",
             "team-model-3","settings-declared","capabilities-private","layers-from","harness","package-souls","triggers","automations","desktop-facts","launch-preference",
             "preview-composed-from","observe-max-age","spawn-preview-max-age","launch-config-default","capability-show","capture-file",
             "workspace-identity","server-connect","capability-route","servers-per-workspace","operator-default-soul","waiting-on-you",
             "automation-descriptions","souls-capabilities","soul-composed-instructions","teams-conditional-default",
             "server-probe-features","worktree-event","trigger-sources","session-attach-detach-key",
             "lifecycle-kernel-codes","lifecycle-claim-stop"],
 "automationsApi":1,"workspaceApi":2,"instanceGitApi":1,"spawnApplyApi":1,"soulsApi":2,"lifecycleApi":1,
 "readinessApi":2,"spawnPreviewApi":2,"eventsApi":2,"scheduleHistoryApi":3,"scheduleApi":2,"operationsApi":2,
 "capabilityShowApi":1}
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
| `schedule-host-caps` | both host-install cap options, their `default` / `none` reset semantics, and cap status reporting; no promise about a particular stored cap value | |
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
| `team-model-3` | every team field; `oats teams`, `oats soul teams` (0.38.0; replaces `team-model-2`) | `teamsApi: 2`, `soulTeamsApi: 2` (payload only) |
| `harness` | the harness names ([Harness input spellings](#the-harness-rename-feature-harness-oats-0270)) | |
| `package-souls` | package soul rows, `qualifiedName`, `packages[].souls` | |
| `triggers` | `oats trigger …` | `triggerApi: 1` (payload only) |
| `automations` | workspace triggers and schedules; `oats automations refresh` | `automationsApi: 1` |
| `desktop-facts` | the facts under [Desktop facts](#desktop-facts-feature-desktop-facts-oats-0290) | |
| `launch-preference` | soul and local launch preferences; `launch`, `launchCurrent`, `launchFrom`; `--reselect-launch`; `key` on soul and agent rows ([Launch preferences](#soul-launch-preferences-feature-launch-preference-oats-0300)) | |
| `preview-composed-from` | `composedFrom` on preview `modules[]` ([Composition](#the-preview)) | |
| `observe-max-age` | `--max-age <s>` on the read verbs and their `observation` block ([Observation reuse](#observation-reuse-feature-observe-max-age-oats-0311)) | |
| `spawn-preview-max-age` | `--max-age <s>` on `spawn --preview` and its `observation` block ([Observation reuse](#observation-reuse-feature-observe-max-age-oats-0311), [The preview](#the-preview)) | |
| `capability-show` | `oats capabilities show <name>` and its `--file` form, OATS 0.34.0 ([`oats capabilities show`](#oats-capabilities-show)) | `capabilityShowApi: 1` |
| `capture-file` | `oats capture --file <path> --format cc\|pi\|codex --home <instance home> [--json]`: one session file captured as `--home` capture would, with a receipt bound to its bytes, OATS 0.35.0 (the capture USAGE and packages/record/README.md) | |
| `workspace-identity` | the deployment's workspace identity on `oats status --json` `workspace` (`key`, `ref`, `keyFrom`, `standalone`, `defaultTeam`, `teams`, `teamsFrom`) and each `oats server roster --json` group's relayed `workspace`, OATS 0.36.0 ([Workspace identity](#workspace-identity-feature-workspace-identity-oats-0360)) | |
| `servers-per-workspace` | `workspaceKey` on registrations and `oats server list --json` rows; `oats server list --workspace-ref <ref>` and its `unknownWorkspace`; `workspaceKey` on `oats server check --json`, OATS 0.39.0 ([Servers per workspace](#servers-per-workspace)) | |
| `server-connect` | `oats server connect`; `oats onboard --check`; `workspaceReadable` on `oats server check --json`, OATS 0.39.0 ([`oats server connect`](#oats-server-connect)) | |
| `capability-route` | `oats <namespace> <command> … --server <id>` runs the capability command on the server, OATS 0.39.0 ([Capability commands on a server](#capability-commands-on-a-server)) | |
| `operator-default-soul` | a capability command from a deployment without `--soul` runs as the first soul that provides its namespace (named on stderr); none is `E_BAD_ARGS`, OATS 0.39.0 ([capabilities.md](capabilities.md)) | |
| `waiting-on-you` | the `waiting` event kind and the session boundary rule; `oats instance waiting` and `oats instance attention`; `waitingOnYou` (with `message`) on `oats status --json` instance rows, on `oats session inspect --json` and in the events read, OATS 0.40.0 ([Waiting on you](#waiting-on-you)) | `eventsApi: 2` |
| `automation-descriptions` | a `description` on every trigger and schedule row, local or workspace, by one rule; `oats schedule update <id> --description=<text>` (the description only) and `oats trigger update <id> --description=<text>`; `--description=<text>` on `schedule add` and `trigger add`, OATS 0.43.0 ([Shared row fields](#automations-shared-rows)) | |
| `souls-capabilities` | `capabilities` on `oats souls --json` rows: the capabilities each soul composes, keyed like `oats capabilities` rows, with `from`, OATS 0.45.0 ([`oats capabilities` and `oats souls`](#oats-capabilities---dir---json--capabilitiesapi-1--oats-souls---dir---json--soulsapi-1)) | |
| `soul-composed-instructions` | `oats inspect --soul <soul> --instructions` and its `souls[].composedInstructions`: the AGENTS.md a spawn of the soul here would write, with the soul body and each composed block as ranges, OATS 0.46.0 ([`oats inspect`](#oats-inspect---home-----soul----dir----json--operationsapi-2)) | |
| `teams-conditional-default` | `oats teams default <label> --if-absent \| --expect <label>` and `E_TEAM_DEFAULT_MISMATCH`; `oats teams add … --no-default` and its `reused` answer; `E_TEAM_EXISTS` `observed`; unknown flags on `oats teams` refused, OATS 0.48.0 ([`oats teams`](#oats-teams)). A kernel without it ignores the flags: `--if-absent` there is an unconditional set, so check the feature before passing them | |
| `worktree-event` | the `worktree` hook event; `oats worktree add\|remove` ([`oats worktree`](#oats-worktree)); `worktreeHooks` on `spawn --preview` and on the spawn result and `spawned` event; `spawnInProgress` on `oats status --json` instance rows; the `worktree-added` event kind; `E_INTERRUPTED` and `E_WORKTREE_DIRTY`, OATS 0.49.0 | |
| `trigger-sources` | capability-declared trigger sources: `on.source: "<capability>:<source>"` triggers and their added row keys, `oats trigger poll`, `--run-source` on `trigger test` and `trigger poll` (`E_TRIGGER_SOURCE_RUN` without it), `E_TRIGGER_SOURCE`, `E_TRIGGER_POLL` `details.cause`, and `triggerSources`/`triggerSourceProblems` on `oats capabilities show`, OATS 0.50.0 ([`oats trigger`](#oats-trigger)) | `triggerApi: 1` (payload only) |
| `server-probe-features` | `features` on `oats status --json` (this kernel's own list, as `version --json` answers it), and each `oats server roster --json` group's `probe.features`: the host's list, relayed from that status answer after validation, `null` when unknown, OATS 0.49.0 ([The remote roster](#the-remote-roster-oats-server-roster---json)) | |
| `session-attach-detach-key` | `oats session attach … --detach-key <key>`, local and `--server`: the one key that detaches that viewer, and exit status 20 when it did, OATS 0.51.0 ([execution-targets.md](execution-targets.md#inspect-input-and-attach)). Gate on the probe and never try: a kernel without it ignores the flag and opens a viewer with no exit. A routed attach refuses a host without it (`E_REMOTE_INCOMPATIBLE`, `details: {"feature":"session-attach-detach-key"}`) | |
| `lifecycle-kernel-codes` | `oats retire`, `oats instance stop`, `oats session …` and `oats worktree add\|remove` answer kernel codes only (`^E_[A-Z0-9_]+$`), in `error.code` and in the codes inside their results, with one exception: a document with an unsafe mapping key or value is refused under its own name, `unsafe-config-key` or `unsafe-config-value`, by these commands as by every other; `error.details.cause` on an error that has a code which is not a kernel code (`{code, syscall}`) and on a defect of the kernel (`{name}`), and none on a refusal that has no code, which is answered with the command's general code and its message alone ([The envelope](#kernel-codes)); `error.details.reached` on every error of a retire apply once the retire of the home has begun, and its absence before that ([`error.details.reached`](#retire-reached)), OATS 0.52.0. Gate on the probe: a kernel without it can answer one of these commands with a system code (`ENOENT`, `EACCES`), and an absent `reached` there says nothing | |
| `lifecycle-claim-stop` | `oats instance stop --apply` holds the claim of every target (the file one retire of a home at a time is ordered by), so a stop is refused beside a retire in flight (`E_INSTANCE_RETIRING`) or another stop (`E_LIFECYCLE_BUSY`), a retire beside a stop (`E_LIFECYCLE_BUSY`), and `oats worktree add` beside a retire (`E_INSTANCE_RETIRING`), each before any effect ([Commands that meet on one home](#lifecycle-pairs)); a stop that was killed refuses nothing afterwards, and `<home>/.oats-stop-pending.json` is no longer written or read: a client's own handling of a stale stop marker is not needed for a kernel that lists this; `error.details.action` (the holder's verb) on those refusals, and `error.details.holder` on every `E_LIFECYCLE_BUSY` ([`details.holder`](#busy-holder)); the codes a stop and a retire answer only before any effect, as one list ([the list](#before-effect-codes)), with two retire answers that came after an effect given codes outside it (`E_WORK_PRESERVATION_FAILED`, `E_RUNTIME_QUIESCE_FAILED`), OATS 0.52.0. Gate on the probe; routed with `--server`, on the host's list | |

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
- <a id="kernel-codes"></a>**The lifecycle commands answer kernel codes only**
  (`oats retire`, `oats instance stop`, `oats session …`, `oats worktree
  add|remove`; feature `lifecycle-kernel-codes`, OATS 0.52.0). A kernel
  whose probe does not list the feature can answer one of these commands with
  the system's own code (`ENOENT`, `EACCES`, `ENOTEMPTY`) and has no
  `details.cause`: a client keeps its guard for such a code there. Routed
  with `--server`, one of these commands is answered by the host's kernel:
  gate on that host's list (`probe.features` of
  [`oats server roster --json`](#the-remote-roster-oats-server-roster---json)).
  A kernel code is `E_` followed by upper-case letters, digits
  and underscores (`^E_[A-Z0-9_]+$`). The kernel tests that shape, not a list
  of known codes, and the shape is enough: the kernel has no dependency, and
  neither the system (`ENOENT`) nor Node (`ERR_…`) gives a code of that shape.
  An error that is not the kernel's is answered with the command's general
  code (`E_LIFECYCLE_FAILED`, `E_SESSION_FAILED`, or the one its section
  names). What the answer adds depends on the error:
  - **One that has a code which is not a kernel code** gets
    **`error.details.cause`**, beside the command's other details:
    `{code, syscall}`. `code` is the system's (`ENOENT`), Node's (`ERR_…`),
    or one of the kernel's own lower-case names, which these commands wrap
    like the rest (`invalid-declaration`, `resource-limit`,
    `integrity-drift`, `invalid-source`); `syscall` only when the error has
    one.
  - **A defect of the kernel** gets `details.cause: {name}`, and its stack
    goes to stderr, in JSON and in text mode. A defect is an error without a
    code that is one of the language's own kinds, whose `name` is not
    `"Error"` (`TypeError`, `ReferenceError`, `RangeError`, `SyntaxError`, …),
    or a thrown value that is no error at all (`name` is then `"Error"`; it
    has no stack, and one line on stderr shows the value instead). It is
    answered as one envelope like the rest. One defect has a name of the
    kernel's own, `LateRefusal`: a stop or a retire met, after its first
    effect, an error whose code says that nothing happened
    ([the list](#before-effect-codes)).
  - **A refusal without a code** (the kernel words some of its refusals that
    way, and a `tmux` or `git` command that fails is reported that way) gets
    neither: the general code and its message alone, no `details.cause`, no
    stack. Text mode prints `oats: <message>`, as a kernel without the
    feature does.

  `cause` holds nothing else: no message, no path, no stack. The same rule
  holds for a `code` inside a result of these commands (a stop receipt's
  `results[].code`, a retire's `childrenStopped[].code`, a plan's
  `session.reason` and `work.reason`). **The one exception:** an OATS
  document with an unsafe mapping key or value is refused under its own name,
  `unsafe-config-key` or `unsafe-config-value`, by these commands as by every
  other; neither is wrapped. Elsewhere an `error.code` may still be the
  system's.
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
option (`--model=--yolo`). The one exception is the free-text `--message`
(`oats instance waiting`, `oats instance attention`): `--message=--text` is
accepted, and its value is only ever the message. A capability command's own flags are forwarded as
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

<a id="observation-reuse-feature-observe-max-age-oats-0311"></a>
### Observation reuse (feature `observe-max-age`, OATS 0.32.0)

Every read asks each remote for its current head (`git ls-remote`). With
`--max-age <seconds>` a read verb reuses a head this machine observed at most
that many seconds ago instead, so a refresh right after another costs no
network round trip. Gate the flag on the feature: an older kernel may ignore
it and answer live, without the block.

```text
oats status | workspace status | souls | capabilities | inspect --soul|--home
     | teams | soul teams <soul>   … --max-age <seconds> --json
oats spawn <soul> … --preview --max-age <seconds> --json    (feature spawn-preview-max-age)
oats capabilities show <name> … --max-age <seconds> --json  (feature capability-show)
oats trigger poll <id> --run-source … --max-age <seconds> --json   (feature trigger-sources)
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
  exactly as before. A refusal (`E_SOUL_UNKNOWN`, any error envelope) never
  carries the block.
- **Spawn preview** (feature `spawn-preview-max-age`, OATS 0.33.0): the
  preview's `result` gains the same block, so you can say "as of
  `<observedAt>`". The `decision` covers the heads the preview used, reused
  or live: a reused head the member has since moved from makes the apply
  (which always observes live) refuse `E_DECISION_STALE`, and the apply
  records the head it observed, so the next preview under `--max-age` shows
  it with a new `decision.revision`. The apply itself refuses the flag.
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
- **Refusals:** every other command, a spawn apply (with or without
  `--expect-decision`; the form named is `spawn`), every edit form (`teams add|remove|default`)
  and any `--server`
  invocation refuse the flag before reading or writing anything (the removed
  `soul teams --add|--remove|--default|--clear-default` answer their own
  `E_BAD_ARGS` first), with
  `E_BAD_ARGS` "--max-age is not accepted by \`oats <form>\`: only the read
  verbs reuse observations (status, workspace status, souls, capabilities,
  capabilities show, inspect --soul|--home, spawn --preview, trigger poll,
  and the read forms of teams and soul teams)" and,
  with `--server`, "--max-age cannot be combined with --server: observation
  reuse is local to this machine".
  A capability command's argv (`oats <namespace> …`) is its provider's: the
  kernel neither reads nor refuses `--max-age` there. The same holds for
  `capture`, `recall`, `setup` and `experimental`, which parse their own argv:
  `capture`, `setup` and `experimental` refuse it as an unknown argument (not
  `E_BAD_ARGS`), and `recall` ignores unknown flags.

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
oats inspect (--home <abs> | --soul <name> [--dir <d>] [--instructions]) [--max-age <s>] --json
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
| `workspace` | `{key, name, deployment, commit, standalone}`; for a home, `name` is the recorded name (`null` if the spawn predates it). `standalone` is the view the subject resolves in (a fallback for an unreadable host included), unlike `oats status`'s configured-only [`standalone`](#workspace-identity-feature-workspace-identity-oats-0360) |
| `souls` | exactly the subject's soul |
| `layers` | `{knowledge, messaging, tasks}`, each `{id, from}` |
| `capabilities`, `capabilitiesOff` | the resolved modules (by id) and the ones the soul turned off |
| `teams`, `defaultTeam`, `teamsSource`, `recordedDefaultTeam` | [Where teams appear](#where-teams-appear); `recordedDefaultTeam` is home only |
| `knowledge` | `{provider, version, operations: [{name, kind, available, reason}]}` for the knowledge slot (`null`s and `[]` when empty) |
| `instance` | `null` for a soul; the home's facts above. `instructions.sources` lists each composed inject in order |
| `identity` | home only (absent for a soul): the served identity a messaging provider recorded, `{…, provider}`, or `null`. Read on every call, so after a start whose launch hook returned new `meta` it is that start's record, not the spawn's |
| `problems` | below |
| `warnings` | always present (0.49.0): [capability warnings](#capability-warnings-hook-event-unsupported-oats-0490); for `--home`, `path` is home-relative |

**Soul row** (`soulsApi: 2`). For a home it is read from the recorded
`soulDir` (`path` and `kind` are `null`); for a soul it is the member's current
definition (`kind` is `member` or `external`, `path` inside the member).
`declarations` is `{requires, defaults, knowledge, resources, children,
capabilities}`, each the soul.yaml section as written or `null`.
`instructions` is `{file, text, truncated}` of the soul's `AGENTS.md`, or
`null` before a spawn has copied the soul. `declarationProblems` holds
`soul-declarations-unreadable` when soul.yaml does not parse.

`composedInstructions` (feature `soul-composed-instructions`) is present only
with `--instructions`, which takes a soul subject (`--home` is `E_BAD_ARGS`);
without the flag the key is absent and nothing extra is composed. It is the
AGENTS.md a spawn of this soul here with no flags would write, produced by
spawn's own composition — the kernel blocks, then each capability's inject,
materialized into a scratch home outside the deployment and removed. It is
`{file: null, text, truncated, resolution, body, sources}`. `text` and
`truncated` follow the 200,000-character cap of `instructions`; `resolution` is
the resolution revision it was composed at. `body` is the soul's own AGENTS.md,
`{start, end, truncated}`, and `body.start` is always 0. `sources` lists each
block in text order like `instance.instructions.sources`, as `{source, file,
start, end, truncated}`: `source` is the marker's (`kernel:instance-boundary`,
`work-mode:<mode>`, `capability:<id>`). `file` is home-relative by design here
— `.oats/modules/<id>/<inject>` for a capability, `null` for a kernel block —
while `instance.instructions.sources[].file` is a host path: same key,
different base. Ranges are `[start, end)` into `text` in JavaScript string
units; `sources` is contiguous with `body` and with each other, with no
overlaps (each part ends after the blank line that separates it from the
next). A block's range includes its opening and closing marker lines. Ranges
are clamped to `text`: a part cut by the cap has `truncated: true` and may lack
its closing marker, and one wholly past the cap has `start == end ==
text.length`. The text equals what the spawn writes except that capability
markers' `src=` is home-relative. It is `null` when the soul resolves but
cannot be composed here, with the kernel's code and sentence, naming
`composedInstructions`, in `problems[]`. Routed with `--server <id>`, the flag
travels to the host; a host whose probe does not advertise
`soul-composed-instructions` is refused with `E_REMOTE_INCOMPATIBLE`, and
nothing is sent.

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
`E_TEAM_UNKNOWN`, and `E_WORKSPACE_SCHEMA` reason `local-teams-closed`);
readiness reports the same condition
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
  unknown | not-applicable`. An item's `reason`, `remedy` and kernel
  `problems[].message` are at most 1000 characters (0.44.0). Longer text,
  such as a remote error, is clipped with `…`. A provider's `result` is
  relayed verbatim.
- A check's status rolls up its required items (any `fail` → `fail`, else any
  `unknown` → `unknown`, else `pass`; `not-applicable` with none required).
- `summary.ready` is true when every required item passes or is
  not-applicable and at least one required item exists; the counts are over
  required items. `byCapability[]` is `{capability, checks, ownReady,
  ready}` (`ready` also needs no subject blocker). `subjectBlockers[]` is
  `{check, subject, status}` for each failing required item not about a
  capability. `notes` is prose.
- `warnings` (0.49.0) is always present: the
  [capability warnings](#capability-warnings-hook-event-unsupported-oats-0490)
  of the subject's capabilities. They are not items and change no status.

**`installed`**, one item per module with `evidence: {from}`. `--home`
(producer `instance modules`): passes when the home's copy holds `oats.json`
(remedy on failure: spawn a new instance). `--soul` (producer `workspace
resolution`): each resolved module. A resolution refusal is one failing item about the soul
with `code`, the message as `reason`, the details as `evidence` and a remedy
naming `oats sync`; team refusals go under `configured` instead.

**`configured`.** Producer `capability manifest`: each manifest `requires`
command, `evidence: {command}`, the manifest's `install` hint as remedy.
Producer `team model`: the soul's [team readiness items](#team-readiness-items).
Producer `operator coverage` (0.44.0): the workspace's and the soul's teams'
[operator coverage items](#operator-coverage-items), warnings only.

**`member`** (producer `workspace discovery`): the soul's repository is a
confirmed member (`evidence: {repoKey, workspace, commit}`); `fail` when not
(the remedy names `oats-membership.yaml`); `unknown` when the workspace could
not be read. External souls and standalone views are `not-applicable`,
`required: false` (a standalone item carries `evidence.standaloneReason`).
A package soul is trusted through the workspace's `packages:` pin, never
through membership ([the non-collapse rule](workspaces.md#member-tier-vs-package-tier-the-non-collapse-rule)):
its item is `package <package>/<soul>` (producer `workspace lock`,
`evidence: {repoKey, workspace, commit, version, integrity, from}` with
`from.kind: "package"`). It passes when the package is declared and locked
and ships the soul at the locked commit, and the soul's copy is intact: for
`--soul`, the copy a spawn would link matches the locked digest; for
`--home`, the home's copy matches the digest it recorded, and a lock still
at that commit records the same digest. The copy is digested on every read.
It fails otherwise, with `code: "E_PACKAGE_INTEGRITY"` on a digest mismatch
and the remedy naming `oats sync` or a fresh spawn.

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
  unconfirmed?}`. A literal provider `error.details.unconfirmed: true` is
  promoted to the outer details while its full envelope stays nested. Existing
  retained-effect text checks remain for compatibility during migration.
  `E_OPERATION_TIMEOUT` (240 s) and `E_OPERATION_RESULT` are
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
  "network" | "timeout" | "killed" | "cache" | "unknown"}`. `killed` (the
  system killed git, for example out of memory) also carries `signal`.
  `cache` (OATS 0.33.0) is local: the
  remote cache on this machine could not be written (a git lock still held,
  another oats process still writing it, or a lock file one left when it
  died); `details.cacheDir` and, when known, `details.lock`,
  `details.guard` or `details.holderPid` say which, and the message says
  what to do.
- **How the Desktop reads it** (0.33.0). Of an `E_REMOTE_UNREADABLE` from
  `status` / `workspace status`, the Desktop keeps the `message` (shown as
  given) and only a bounded cause: `details.reason` (matching
  `^[a-z][a-z-]{0,31}$`) and the host of `details.url`. No path, pid, lock,
  `cacheDir` or other detail field crosses to the renderer. It keys only on
  `code` + `details.reason`: `cache` words the roster "OATS cache
  problem" with the message in full; `network` / `timeout` read "Couldn't
  reach <host>"; any other reason keeps the generic wording. When the
  deployment was observed before, the failed read keeps that observation:
  `/api/panel` serves it with `error` (the message) and `errorCause {code,
  reason, host?}`, and the roster shows it stale instead of empty.
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
| `soul teams --add`, `--remove`, `--default`, `--clear-default` (0.38.0) | `E_BAD_ARGS` (`details: {flag, replacement}`) | `souls:` in `oats-workspace.yaml` |
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
oats sync [--dir <d>] [--plan] --json
```

Discovers the workspace, confirms membership, resolves `packages:`, writes
`oats-lock.json` (lockfileVersion 3), takes the automations snapshot and
reports. It creates `agents/` if missing.

`--plan` (0.44.0) previews: the same discovery, resolution and report, with
`plan: true`, and nothing written (no lock, no `agents/`, no automations
snapshot; the remote cache fills as any read fills it). `changes[]` is what a
bare `oats sync` would apply, `workspace.lock` the lock it would write, and
`automations` counts what it would snapshot. A flag or a positional `sync` does
not read is refused with `E_BAD_ARGS` (`details: {flag}` or `{argument}`) before
anything is read or written. A kernel before 0.44.0 ignores `--plan` and
applies: gate `sync --plan` on `version` 0.44.0 or later, never by trying.

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

- `plan`: `true` on a `--plan` answer, absent otherwise.
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
  for a soul.yaml still carrying `private`; then (0.49.0)
  `hook-event-unsupported {code, capability, path, message}` per hook event a
  listed member capability declares and this kernel does not run
  ([capability warnings](#capability-warnings-hook-event-unsupported-oats-0490)).
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
              "capabilities":["oats.okf"],"souls":[],"latest":{"version":"4.1.1","ref":"v4.1.1"}}],
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
- **Remote budget (0.33.1).** `oats workspace status` and `oats status` finish
  their remote work within 12 s of their first remote read, whatever the
  machine's load or another process holding a remote's cache. A member not
  read by then is a `cannot-read` row whose `detail` ends `(timeout)`, and its
  git is ended; the command still answers. The workspace definition itself
  (the host) not read by then fails the command as any unreadable host does
  (`E_REMOTE_UNREADABLE`, `reason: "timeout"`). Spawn, sync and every other
  verb have no such budget.
- `declaredPackages`: the ids in `packages:` (standalone: the kernel's
  default). `unsynced`: declared, not locked. `stale`: locked, no longer
  declared. `external[]`: `{source, soul}`.
- `workspace.teams` (feature `team-model-3`): the shared teams `{label, team,
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
    "file":{"path":"souls/writer/soul.yaml","url":null},"spawnable":true,"problem":null,
    "capabilities":[{"name":"oats.aweb","kind":"package","package":"oats.aweb","from":"workspace"}]},
   {"name":"knowledge-maintainer","qualifiedName":"oats.okf/knowledge-maintainer","origin":"package oats.okf v4.1.1","kind":"package","package":"oats.okf",
    "version":"4.1.1","repoKey":"github.com/awebai/oats-okf","commit":"e1d604f7…","teams":null,"defaultTeam":null,"private":false,
    "path":"oats-package/souls/knowledge-maintainer","work":"directory","description":"Reviews harvested knowledge.","harness":"pi","model":null,
    "harnessFrom":"kernel-default","file":{"path":"oats-package/souls/knowledge-maintainer/soul.yaml","url":null},
    "spawnable":false,"problem":{"code":"E_TEAM_UNKNOWN","message":"team \"reviewers\" is not declared (oats-local.yaml#/defaultTeam): …"},
    "capabilities":null}],
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
problem`, (feature `souls-capabilities`) `capabilities`, and (feature
`launch-preference`) `key` and `launch`.
- `key` is the soul key that `souls.launch` uses, and that
  `oats soul teams <key>` takes: `qualifiedName` for a package
  soul, the bare `name` for a member or external soul. Two member souls that
  share a bare name share one entry (spawning that name is
  `E_SOUL_AMBIGUOUS`).
- `launch` is a [Launch](#the-launch-report-launch).
- `teams` and `defaultTeam` (feature `team-model-3`) are a
  [TeamRow](#the-team-row-teamrow) list and a
  [DefaultTeam](#the-default-defaultteam); both `null` when the soul's teams
  do not resolve (`problem` names the `E_TEAM_*` code).
- `capabilities` (feature `souls-capabilities`, OATS 0.45.0): what the soul's
  resolution composes, slots and additive alike, sorted by `name`. Each entry
  names its capability with the capability row's own keys: `name`, `kind`
  (`member` | `package`), then `repoKey` for a member or `package` for a
  package, so it matches exactly one `oats capabilities` row. `from` is why
  the soul has it: `soul` (it declares it) or `workspace` (a workspace
  default), as in inspect's `layers.<slot>.from`. A capability the soul
  turned off (`off`, or `<slot>: none` over a workspace default) is not
  listed. `null` whenever `spawnable` is false (`problem` names why),
  including a soul disabled on this machine; never `[]` for unknown.
- Package souls (feature `package-souls`) add `qualifiedName`
  (`<package>/<soul>`), `package` and `version`. Spawn one by
  `qualifiedName` (the bare name when unique). Its instances live under
  `agents/<package>--<soul>/` with `.` written `-` (for example
  `oats-okf--knowledge-maintainer`), which is its agent `name` in the roster.

This document keeps `soulsApi: 1`; the probe's `soulsApi: 2` is the inspect
soul row's.

### `oats capabilities show`

Feature `capability-show`, `capabilityShowApi: 1`, OATS 0.34.0.

```text
oats capabilities show <name> [--member <repoKey> | --package <id>] [--dir <d>] [--max-age <s>] --json
oats capabilities show <name> [--member <repoKey> | --package <id>] --file <path> [--dir <d>] [--max-age <s>] --json
```

What one capability ships: its inject text and each skill's files, and one
file's text on request. The Desktop's capability page shows them without
reading clones or caches itself.

> **Every `text` and `description` is untrusted repository content.** Render
> it as plain text (`textContent`), or through a sanitising Markdown renderer
> that allows no raw HTML, no scripts and no remote images.

**Selection.** The rows are exactly the rows of `oats capabilities --json`
(one discovery, honouring `--max-age`), so the answer's `commit` equals that
row's `commit`.

- `<name>` alone selects the one row with that name.
- `--member <repoKey>` selects a member row of that repository: the key as a
  row shows it, or any ref spelling of the same repository.
- `--package <id>` selects that package's row.
- No row: `E_CAPABILITY_UNKNOWN`, `details: {name}` plus `member` or
  `package` when one was given. An unsynced package is not in the catalog, so
  its capabilities are `E_CAPABILITY_UNKNOWN` until `oats sync`.
- More than one row: `E_CAPABILITY_AMBIGUOUS`, `details: {name, candidates}`,
  each candidate `{kind, repoKey, origin}` (member) or `{kind, package,
  origin}` (package). Choose one with `--member` or `--package`.
- `E_BAD_ARGS` for `--member` with `--package`, a missing or second name, an
  unknown flag, and `--server` (the verb reads this machine's workspace only).
  An unknown word after `oats capabilities` (`oats capabilities foo`) is
  `E_BAD_ARGS` too.

**Trust path.** Every read goes through the remote cache at a full commit id;
nothing reads a working clone.

- A member capability is read from its member repository at the row's commit.
- A package capability is read at the locked commit, the same trust path
  spawn uses. First comes spawn's lock check: when the package manifest at
  that commit does not list the capability, or its capability list differs
  from the lock's, the show refuses `E_PACKAGE_INTEGRITY` with spawn's
  details. The full-tree content digest is not recomputed per show: `oats
  sync` proved the lock's integrity over the tree of exactly that commit, and
  the commit id content-addresses the tree.

**The show:**

```json
{"capabilityShowApi":1,"name":"oats.okf","kind":"package","repoKey":"github.com/awebai/oats-okf","package":"oats.okf","version":"4.1.1",
 "commit":"e1d604f7…","path":"oats-package/capabilities/oats-okf",
 "inject":{"path":"injects/okf.md","bytes":2422,"text":"## Knowledge: OKF\n\nYou have two kinds of knowledge. …","binary":false,"truncated":false},
 "skills":[{"name":"okf-consultation","path":"skills/okf-consultation","description":"Consulting your soul's knowledge with the `oats okf` CLI: …",
            "files":[{"path":"skills/okf-consultation/SKILL.md","bytes":6947},{"path":"skills/okf-consultation/references/consult.md","bytes":4465}],
            "filesTruncated":false},
           {"name":"okf-instance-knowledge","path":"skills/okf-instance-knowledge","description":"Keeping this instance's own knowledge …",
            "files":[{"path":"skills/okf-instance-knowledge/SKILL.md","bytes":4787}],"filesTruncated":false}],
 "problems":[]}
```

- `kind` is `member` or `package`. `repoKey` is set for both kinds; for a
  package it is the repository the package is read from. `package` and
  `version` are the package id and locked version, `null` for a member.
- `commit` is 40 hex and equals the catalog row's `commit`. `path` is the
  capability directory, repository-relative.
- `inject` is `{path, bytes, text, binary, truncated}` or `null`. `skills`
  is a list of `{name, path, description, files, filesTruncated}`, each file
  `{path, bytes}`, or `null`. `problems` is a list of `{code, message,
  path}`.
- `warnings` (0.49.0) is always present, on the show and the `--file`
  answer: the capability's
  [capability warnings](#capability-warnings-hook-event-unsupported-oats-0490).
  Their `path` is the repository-relative form, unlike the paths above. The
  text form prints them (to stderr with `--file`).
- `triggerSources` (feature `trigger-sources`), after
  `warnings`, only when the manifest declares the key: the declaration
  exactly as written, whatever its shape (untrusted text: render it as
  text). `triggerSourceProblems: [{source, pointer, message}]` follows only
  when the declaration has problems: the ones a trigger naming a source
  would get as `E_TRIGGER_SOURCE`, `source` `null` for a top-level problem,
  `pointer` a JSON pointer into the manifest. A malformed declaration never
  refuses the command and adds nothing to `problems`
  ([capabilities.md](capabilities.md#trigger-sources-triggersources)).
- With `--max-age` (`0` included) both the show and the `--file` answer gain
  the [`observation`](#observation-reuse-feature-observe-max-age-oats-0311)
  block `{observedAt, reused, localRevision}`.

**The `--file` answer:**

```json
{"capabilityShowApi":1,"name":"oats.okf","kind":"package","commit":"e1d604f7…",
 "file":{"path":"skills/okf-instance-knowledge/SKILL.md","bytes":4787,"text":"---\nname: okf-instance-knowledge\n…","binary":false,"truncated":false}}
```

**Rules.**

- **Paths.** Every `path` in `inject`, `skills`, `file` and `problems` is
  POSIX and relative to the capability directory, never the repository.
  Every non-null `path` is a safe relative path: no `.`, `..` or `.git`
  component (any case), no empty component, no `\`. A manifest's inject and
  skill paths are reported as the module install reads them: a `\` is a
  separator, and a leading `./` and trailing slashes are dropped
  (`injects\guide.md` is `injects/guide.md`).
- **The inject** is the committed file exactly: untrimmed and untemplated.
  (Spawn composes it raw and trimmed, with no settings substitution.)
  - `inject: null`: the manifest declares no inject.
  - Declared but unreadable (missing, a symlink, a directory, over the read
    budget): `inject: {path, bytes: null, text: null, binary: false,
    truncated: false}` and a `problems[]` entry with the remote's code
    (`E_REMOTE_PATH_MISSING`, `E_REMOTE_TREE_UNSAFE`, `E_REMOTE_FILE_OVERSIZE`,
    …). The show still answers ok.
  - Declared as a path that is not a safe relative path (spawn refuses it):
    `inject: {path: null, bytes: null, text: null, binary: false, truncated:
    false}` and a problem with spawn's code (`E_CAPABILITY_MISSING` for a
    member, `E_PACKAGE_MANIFEST` for a package) and `path: null`. The raw
    manifest value appears only inside `message`, JSON-quoted. So
    `inject.path` is `null` only with a problem.
- **Skills** are in the catalog row's order (by name, in codepoint order),
  enumerated exactly as a spawn enumerates them. `skills` is `null` exactly
  when the catalog row's `skills` is `null`, with a problem carrying spawn's
  code (`E_CAPABILITY_MISSING` or `E_PACKAGE_MANIFEST`) or an `E_REMOTE_*`
  code, and `path: null`. A skill whose path is not safe (a `.git`
  directory) makes the skills unlistable the same way, in both answers.
- **Files.** `files` is every regular file under the skill directory,
  recursively (no symlinks, no submodules), sorted by path in codepoint order.
  At most 200 per skill; beyond that `filesTruncated` is `true`. `bytes` is
  the blob size. When a skill's files cannot be listed (an unsafe entry name
  in the tree, an unreadable remote), `files` is `null`, `filesTruncated` is
  `false`, and a problem's `path` is the skill's `path`: "could not list"
  never collapses into "listed nothing".
- **`description`** is the `description` key of SKILL.md's leading `---` YAML
  front matter, when it is a string. It is parsed from the whole SKILL.md,
  not from its 262144-byte text cut. It is `null` when the front matter is
  absent or does not parse, the key is absent or not a string, or SKILL.md is
  unreadable or binary (no problem is reported for it). It is cut to at most
  1024 UTF-8 bytes on a code point boundary.
- **Text.** A file is `binary: true, text: null` when it contains a NUL byte
  or is not valid UTF-8. Only the first 262144 + 3 bytes are examined, so the
  cut is decided on the same bytes; when the file is longer, a valid sequence
  they end inside of is not held against it. Otherwise `text` is the content cut to at
  most 262144 UTF-8 bytes on a code point boundary, with `truncated: true`
  when cut. A byte order mark is kept in the text. `bytes` is always the real
  size.
- **Invariants** (pinned for the Desktop):
  - `binary: true` ⇒ `text: null` and `truncated: false` (`truncated` is a
    text-only flag).
  - `truncated: true` ⇒ `text` is a string and `binary: false`.
  - `bytes` is `null` only for an unreadable declared inject (with its
    problem). In a `--file` answer it is always an integer.
- **Large files.** A file over the read budget (4 MiB) is listed with its
  size. `--file` refuses it with `E_REMOTE_FILE_OVERSIZE`, passed through
  unchanged: its `details.path` is repository-relative, not
  capability-relative.

**`--file <path>`** reads one file the show lists, and nothing else.

- A syntactically unsafe path is `E_CAPABILITY_FILE_UNSAFE`, `details:
  {path}`, before anything is read: absolute, empty, a `.`, `..` or `.git`
  component (any case), an empty component, a trailing slash, a `\` or a NUL.
- Otherwise the path must be the inject's `path` or a path in some skill's
  `files` as the show lists it (the 200 cap included). Anything else is
  `E_CAPABILITY_FILE_UNKNOWN`, `details: {path, name}`. No other file of the
  capability (`oats.json`, scripts, `bin/`) is readable through this verb.
- A file the show does not list (beyond the 200 cap, a symlink, under a skill
  whose files cannot be listed) is `E_CAPABILITY_FILE_UNKNOWN` by design:
  show "not available", not an error.
- A listed file the remote cannot read answers the remote's own code
  (`E_REMOTE_FILE_OVERSIZE`, `E_REMOTE_PATH_MISSING`, `E_REMOTE_TREE_UNSAFE`,
  …).

**Failures.** Every failure is exactly one error envelope on stdout with a
nonzero exit, as for every command: `E_BAD_ARGS`, `E_CAPABILITY_UNKNOWN`,
`E_CAPABILITY_AMBIGUOUS`, `E_PACKAGE_INTEGRITY`, `E_CAPABILITY_FILE_UNSAFE`,
`E_CAPABILITY_FILE_UNKNOWN`, an `E_REMOTE_*` code, and the workspace's own
(`E_LOCAL_MISSING`, `E_LOCK_SCHEMA`, …).

**Without `--json`** the show prints a short listing for an operator: the
inject's path and size, each skill with its files and sizes, the trigger
sources (name, command, events, description) and their problems, and the
problems. `--file` prints the text; a binary file prints a one-line note
instead, and a truncated file prints its text followed by a one-line note.

<a id="desktop-facts-feature-desktop-facts-oats-0290"></a>
### Capability warnings (`hook-event-unsupported`, OATS 0.49.0)

A capability may declare a hook event this kernel does not run (a newer
kernel's). It composes, the event never runs, and each answer that shows the
capability carries one warning per such event
([capabilities.md](capabilities.md#manifest)):

```json
{"code":"hook-event-unsupported","capability":"acme.tool",
 "path":"github.com/acme/agents:capabilities/acme-tool/oats.json#/hooks/on-merge",
 "message":"capability acme.tool declares hook \"on-merge\", which this kernel does not run; it is ignored (this kernel runs soul-scaffold, spawn, retire, launch, worktree)"}
```

| Answer | Where | Covers |
|---|---|---|
| `oats sync`, `oats workspace status` | `warnings[]`, beside `soul-private-ignored` | every listed member capability |
| `oats capabilities show` (and `--file`) | `warnings[]`, always present | the capability shown |
| `oats inspect`, `oats readiness` | `warnings[]`, always present | `--soul`: the soul's resolved modules; `--home`: the home's module copies |
| `oats doctor --json` | `warnings[]` | `--soul`: the soul's resolved modules; without it, every member capability and every locked package's, from this machine's cache |
| `oats spawn --preview`, `oats spawn` | `warnings[]`, strings | the message of each, for the soul's resolved modules, each at most 1000 characters and at most 32 lines (past that, one line naming how many more); a same-key replay answers them from the home's module copies |

`path` is never an absolute host path. It is `<repoKey>:<dir>/oats.json#<pointer>`
for a member capability, `package:<id>:<dir>/oats.json#<pointer>` for a
package capability (`<dir>` relative to the repository), and, for `--home`,
`.oats/modules/<name>/oats.json#<pointer>`, relative to the home: the copy
actually read. Without `--soul`, doctor reads only this machine's cache; what
it cannot answer is one `information[]` line `hook-events-unchecked: <member
capabilities | package <id>'s capabilities> were not checked …`, never an
empty list read as "no warning". Older kernels answer no such `warnings` key
(inspect, readiness, show, doctor) and refuse the capability instead.

`oats doctor --json` also lists what retires left behind in `information[]`:
one `retained-recovery:` and one `retained-worktree:` line per item, after a
line that gives each kind's total, and at most 50 items per kind
([After a retire](souls-and-instances.md#after-a-retire-inspect-restore-dispose)).
Each element is one line of text with no newline. The answer has no new key.

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
  `E_TEAM_UNKNOWN`, `E_WORKSPACE_SCHEMA` (local-teams-closed), `E_CAPABILITY_*`, `E_PACKAGE_*`,
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

<a id="team-model-3-feature-team-model-3-oats-0370-replaces-feature-team-model-2"></a>
<a id="team-model-v2-feature-team-model-2-oats-0300-replaces-feature-teams"></a>
## Teams

Feature `team-model-3` (OATS 0.38.0; it replaces `team-model-2`): gate every
team field and verb on it. Design: [team model 3](design/2026-10-02-team-model-3.md);
operator guide: [workspaces.md](workspaces.md#teams).

- **The workspace file** (`oats-workspace.yaml`, committed) holds the shared
  teams `teams.<label> = {description?, team?}` (a shared team without `team`,
  the provider id, is **unmapped**), `defaultTeam: <label>` (the workspace's
  fallback default), `localTeams: true|false` (absent: false) and `souls:`
  (per pattern, `{default?, teams?: [labels] | "any"}`). Every label there is
  a shared label of that file; anything else is `E_WORKSPACE_SCHEMA` when the
  file is read.
- **`oats-local.yaml`** may declare local teams `teams.<label> = {team,
  description?}` and `defaultTeam: <label>` only where the workspace says
  `localTeams: true`, or in the standalone view (no workspace file is read).
  Elsewhere they are refused: `E_WORKSPACE_SCHEMA` with details `{reason:
  "local-teams-closed", path: "oats-local.yaml", keys}`, the message naming
  both fixes. `souls.teams` and `souls.default` are removed keys
  (`E_WORKSPACE_SCHEMA`, reason `removed-key`): the refusal names each key
  found, and `details.replacement` is the `souls:` YAML to commit instead (a
  bare soul name written `<member>/<soul>` for the operator to qualify), also
  printed at the end of the message. Every command that reads the file
  refuses, an instance home's messaging commands, operations, `inspect --home`
  and `readiness --home` included: they never fall back to the home's
  recorded teams for it. A home's other capability commands read only the
  home's own record, as always.
- **A soul's key** is its qualified name: `<package>/<soul>`, or
  `<member>/<soul>` with the member repository's name (as `souls.disabled`
  names it). A label matches `[a-z0-9][a-z0-9._-]*` and is at most 64
  characters (0.44.0). A longer one is refused: `E_WORKSPACE_SCHEMA` in
  either file, `E_BAD_ARGS` from `oats teams add`, and `E_TRIGGER_INVALID`
  (`field: spawn.teams`) in a trigger.
- **Team ids.** A `team` value (in either file, and `oats teams add --team`)
  matches `^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,255}$`: the kernel's safety rule
  (never `-`-led, no whitespace or control characters, bounded). Otherwise
  `E_WORKSPACE_SCHEMA` (a file) or `E_BAD_ARGS` (the verb). The messaging
  provider validates its own id shape (oats.aweb: `<name>:<namespace>`).
- **Resolution.** The `souls:` patterns for a soul are its key, then
  `<member|package>/*`, then `"*"`. The most specific one that exists gives
  the soul's teams outright (lists never merge); the most specific one that
  sets `default` gives its default. So `a/*: {default: security}` and
  `a/x: {teams: [docs]}` give `a/x` the default `security` and the teams
  `[docs]` only. The default is that `default`; else the local `defaultTeam`
  where local teams are allowed; else the workspace's `defaultTeam`; else
  none. A soul's teams are its default, its pattern's `teams` (`any`: every
  shared team) and, where local teams are allowed, every local team. A soul
  no pattern matches has its default only. A label in both files is a
  `team-label-collision` warning, and the shared definition wins. A local
  default no file declares is `E_TEAM_UNKNOWN`.
- **Removed keys** are `E_WORKSPACE_SCHEMA` with `reason: "removed-key"`:
  `oats-local.yaml` `souls.teams` and `souls.default` (0.38.0);
  `messaging.byTeam`, `defaults.byTeam`, a soul.yaml `team`, an
  oats-membership.yaml `team`, and `byTeam` in any provider payload layer
  (0.30). Other payload keys are opaque (a `team` setting passes through).

### The team row (`TeamRow`)

Exactly `{label, team, default, from, via}`:

```json
[{"label":"security","team":"security:acme.aweb.ai","default":true,"from":"shared","via":["default"]},
 {"label":"docs","team":null,"default":false,"from":"shared","via":["workspace"]},
 {"label":"mine","team":"mine:ana.aweb.ai","default":false,"from":"local","via":["local"]}]
```

`team` is `null` for an unmapped team. `default` is true on exactly the
soul's default row; the others are teams an instance may join (offered, never
joined automatically). `from` is where the label is defined: `"shared"` or
`"local"`. `via` is why the soul may join it, an ordered non-empty subset of
`"default"`, `"workspace"` (its `souls:` pattern) and `"local"` (a local team
where local teams are allowed). The default row comes first, then the rest by
label (codepoint order). Reports include unmapped rows; `OATS_TEAMS` and
`instance.json.teams` carry mapped rows only. A home spawned before 0.38.0
recorded rows without `via`, and they are reported as recorded.

### The default (`DefaultTeam`)

```json
{"label":"security","team":"security:acme.aweb.ai","from":"soul"}
```

`from` is `"soul"` (the soul's `souls:` default in the workspace file; before
0.38.0 it meant `oats-local.yaml` `souls.default`), `"deployment"` (the local
`defaultTeam`) or `"workspace"` (the workspace's `defaultTeam`). It is `null`
only when no default is configured (with messaging active, that is
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
`OATS_TEAMS` is exactly the soul's eligible mapped rows, so a provider that
admits joins from it refuses any other team. `OATS_WORKSPACE_NAME` is the
recorded workspace name (the discovered one for a soul subject), `""` when
unknown.

<a id="oats-teams"></a>
### `oats teams`

```text
oats teams [--dir <d>] [--max-age <s>] --json
oats teams add <label> --team <id> [--description <d>] [--no-default] --json
oats teams remove <label> --json
oats teams default <label> [--if-absent | --expect <label>] --json
```

```json
{"teamsApi":2,"deployment":"/w","localTeams":true,"defaultTeam":{"label":"mine","team":"mine:ana.aweb.ai","from":"deployment"},
 "teams":[{"label":"mine","team":"mine:ana.aweb.ai","description":null,"from":"local","default":true,"at":"oats-local.yaml#/teams/mine"},
          {"label":"docs","team":null,"description":null,"from":"shared","default":false,"at":"github.com/acme/agents:oats-workspace.yaml#/teams/docs"}],
 "souls":{"*":{"teams":["docs"]},"security-souls/*":{"default":"security","teams":["engineering"]}},
 "problems":[{"code":"team-unmapped","label":"docs","default":false,"severity":"warning","at":"github.com/acme/agents:oats-workspace.yaml#/teams/docs",
              "message":"shared team docs has no provider id yet","fix":"its owner runs `oats aweb setup`, then commits the id"}]}
```

- `localTeams`: the workspace's answer (`true`/`false`), `null` in the
  standalone view. `defaultTeam` is the `DefaultTeam` a soul without a
  `souls:` default gets here (`from` `"deployment"` or `"workspace"`), or
  `null`.
- `teams[]`: every declared team by label, `{label, team, description, from,
  default, at}`; `default` marks that `defaultTeam`; `at` is a pointer into
  `oats-local.yaml` or `<workspace key>:oats-workspace.yaml#/teams/<label>`.
  A collision shows the shared definition.
- `souls`: the workspace's `souls:` as committed (`{}` when none).
  `problems`: the deployment's [team readiness items](#team-readiness-items).
  The command discovers the workspace (every member's souls), for the
  `team-soul-unknown` check.
- The verbs never call a provider. They validate, rewrite `oats-local.yaml` in
  place, and answer the document plus `changed: bool`.
- **Where local teams are not allowed**, `add` and `default` are refused
  before anything is written: `E_WORKSPACE_SCHEMA {reason:
  "local-teams-closed", path, keys}` (`keys` what the verb writes). `remove`
  still runs there: taking local teams away is the last step of committing
  them in the workspace.
- **`add`**: the first team added also becomes the local `defaultTeam`. A
  label already declared is `E_TEAM_EXISTS {label, from, observed: {label,
  team, from}}` (`observed` is the declared mapping; `from` is `"local"` or
  `"shared"`); a bad label or no `--team` is `E_BAD_ARGS`.
- **`add --no-default`** (feature `teams-conditional-default`) writes the
  mapping and never touches `defaultTeam`. A mapping already declared with
  the same label and the same team id (local or shared) is reuse: the answer
  is `changed: false, reused: true`, so a setup can retry it. The description
  is neither compared nor changed. The same label with another id is
  `E_TEAM_EXISTS` as above. `reused` appears only on that answer. Where local
  teams are not allowed, `add --no-default` is refused with local-teams-closed
  like every `add`, before reuse is considered.
- **`remove`**: a label the local `defaultTeam` names is `E_TEAM_IN_USE
  {label, usedBy: ["defaultTeam"]}`; a shared label is `E_TEAM_SHARED {label,
  at}` (a label in both files can be removed locally); unknown is
  `E_TEAM_UNKNOWN {label}`.
- **`default`**: any declared label, else `E_TEAM_UNKNOWN`.
- **`default --if-absent`** sets it only where the deployment has no effective
  default (this document's `defaultTeam` is `null`); **`default --expect
  <label0>`** only where the effective default's label is `<label0>`, local
  or inherited from the workspace (feature `teams-conditional-default`). The
  two together are `E_BAD_ARGS`. A failed condition is `E_TEAM_DEFAULT_MISMATCH
  {expected: {absent: true} | {label}, observed}`, `observed` being the
  `defaultTeam` exactly as this document reports it (or `null`); nothing was
  written. A soul's `souls:` default is not the deployment's and is not
  looked at. The refusals above run first, in order: `E_BAD_ARGS`,
  local-teams-closed, `E_TEAM_UNKNOWN`, then the condition. When the
  condition holds and `<label>` already is the local default, `changed` is
  `false`.
- **Flags**: each form refuses a flag it does not take with `E_USAGE {flag}`,
  naming the flag and the usage, before anything is read. `add` takes
  `--team`, `--description`, `--no-default`; `remove` none; `default`
  `--if-absent`, `--expect`; every form `--dir` and `--json`, and the read
  form `--max-age` (on a write form, `--max-age` is the kernel's own
  `E_BAD_ARGS`, as for every write verb). `--help` is the kernel's usage
  answer, as for every command.
- A write that would introduce an unknown reference is refused with that
  code; an invalid result is `E_WORKSPACE_SCHEMA`.
- **Writes** edit `oats-local.yaml` in place and touch only the entries that
  change: comments and styles elsewhere, including inline comments on sibling
  entries, are kept. Each verb re-reads the file and judges its refusals on it
  as it is now, and writes only if the file did not change meanwhile (else it
  redoes the edit on the new content). A file that keeps changing is
  `E_LOCAL_CHANGED {path}`; nothing was written. The condition of `--if-absent`
  and `--expect` is judged the same way, on the file as it is now and again on
  every redo.
- **Concurrency.** Every `add`, `remove` and `default` holds
  `<deployment>/.agents/locks/local.lock` for its whole read-compare-write.
  Among concurrent `oats teams` writers on one deployment, a conditional write
  therefore never overwrites a default another of them set: when two race, the
  later one sees the earlier result and refuses with
  `E_TEAM_DEFAULT_MISMATCH`. A lock still held after 5 s is `E_LOCAL_BUSY
  {path, lock}`, naming the directory to remove when no oats process is
  editing; nothing was written. The limits: a person or tool editing
  `oats-local.yaml` directly does not take the lock (the content compare still
  catches most such edits, but not one landing between the compare and the
  rename), and changes to the committed `oats-workspace.yaml` (a pull, a
  merge) are not serialized with it: the condition reads the workspace file
  when it is judged, and that is the only promise.

<a id="oats-soul-teams"></a>
### `oats soul teams`

```text
oats soul teams <soul>|'*' [--dir <d>] [--max-age <s>] --json
```

```json
{"soulTeamsApi":2,"soul":"incident-responder","key":"security-souls/incident-responder",
 "match":"security-souls/incident-responder","defaultMatch":"security-souls/*",
 "defaultTeam":{"label":"security","team":"security:acme.aweb.ai","from":"soul"},
 "teams":[{"label":"security","team":"security:acme.aweb.ai","default":true,"from":"shared","via":["default"]},
          {"label":"docs","team":null,"default":false,"from":"shared","via":["workspace"]},
          {"label":"engineering","team":"engineering:acme.aweb.ai","default":false,"from":"shared","via":["workspace"]}]}
```

- Read only. `key` is the soul's key; `match` the `souls:` key its teams come
  from and `defaultMatch` the one its default comes from (`null`: none
  matches, or none sets a default). For `'*'`, `soul`, `key` and the only
  pattern tried are `"*"`. Soul lookup: `E_SOUL_UNKNOWN`, `E_SOUL_AMBIGUOUS`;
  the soul's teams: `E_WORKSPACE_SCHEMA` (local-teams-closed), `E_TEAM_UNKNOWN`.
- The edit flags `--add`, `--remove`, `--default` and `--clear-default` were
  removed in 0.38.0: `E_BAD_ARGS` with details `{flag, replacement: "souls: in
  oats-workspace.yaml (a PR to the workspace file)"}`, before anything else
  is judged.

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
"team model"`, `code`, `reason` (the message), `remedy` (the fix), `status:
"fail"`, `required: true` for a failure and `false` for a warning, plus the
problem's own keys.

| Code | Severity | Keys | When |
|---|---|---|---|
| `E_TEAM_UNCONFIGURED` | failure | | messaging is active and the soul has no default |
| `team-unmapped` | failure if `default`, else warning | `label`, `default`, `at` | a shared team without `team` |
| `team-label-collision` | warning | `label`, `shared`, `local` (each `{team, description, at}`) | a label in both files |
| `default-team-changed` | warning | `recorded`, `current` | `--home` with live teams: the default changed since the spawn |
| `E_TEAM_UNKNOWN` | failure | `label`, `at` | a local default no file declares |
| `E_WORKSPACE_SCHEMA` | failure | `condition: "local-teams-closed"`, `path`, `keys` | `oats-local.yaml` declares `teams` / `defaultTeam` and the workspace does not allow local teams |
| `team-soul-unknown` | warning | `key`, `at` | a `souls:` key that is neither `"*"` nor `<name>/*` nor a discovered soul's key (a typo guard) |

`E_TEAM_UNKNOWN` and local-teams-closed are also spawn, preview and inspect
refusals (local-teams-closed as `E_WORKSPACE_SCHEMA` with details `{reason,
path, keys}`). While local teams are closed, that one item is the soul's only
team item. `team-soul-unknown` is reported where the souls are discovered
(`oats teams`, readiness).

```json
{"code":"E_WORKSPACE_SCHEMA","severity":"failure","condition":"local-teams-closed","path":"oats-local.yaml","keys":["teams","defaultTeam"],
 "message":"oats-local.yaml declares teams, defaultTeam, but oats-workspace.yaml does not allow local teams (localTeams: true): either (a) add `localTeams: true` to oats-workspace.yaml, or (b) commit the teams and defaultTeam in oats-workspace.yaml, then remove them from oats-local.yaml",
 "fix":"either (a) add `localTeams: true` to oats-workspace.yaml, or (b) commit the teams and defaultTeam in oats-workspace.yaml, then remove them from oats-local.yaml"}
```

`oats doctor --json` lists local-teams-closed under `problems[]` (text: `!
E_WORKSPACE_SCHEMA (local-teams-closed): …`). Doctor stays offline: it reads
only the workspace file this machine's parsed cache holds; when there is
none, it adds no problem and says so in `information[]`:
`"local-teams-closed: whether oats-workspace.yaml allows oats-local.yaml
teams/defaultTeam (localTeams: true) couldn't be checked: this deployment
hasn't observed its workspace yet; run oats sync"`. A removed key in
`oats-local.yaml` makes doctor answer that refusal, as for any unreadable
local file.

<a id="operator-coverage-items"></a>
### Operator coverage items

(0.44.0, [#671](https://github.com/awebai/oats/issues/671)) Every workspace
needs an operator: a soul that composes `oats.setup`. A soul the workspace
offers **covers** it when all of these hold on this machine:

- it is a confirmed member's soul, a locked package soul or an external soul;
- it is not in `souls.disabled`;
- it resolves as a spawn would;
- its modules include `oats.setup`;
- it does not empty the messaging slot the workspace fills (`messaging:
  none`), so it stays reachable. Emptying `knowledge` or `tasks` does not
  disqualify it (0.45.0).

It covers a team when that team is among its resolved teams. Detection is by
composition only: a soul's name never counts, and there is no role marker. An
eligible soul is not a launched or authorized seat. These are warnings: they
never refuse anything, and nothing is spawned.

`oats readiness` lists them under `checks.configured` with `producer:
"operator coverage"`, `required: false`, `code`, `reason` and `remedy`. Team
items cover the subject's own teams only.

| Code | Subject | Status | Keys | When |
|---|---|---|---|---|
| `operator-soul-missing` | `operator` | `fail` | `evidence.excluded` | no soul the workspace offers composes `oats.setup` |
| `operator-team-uncovered` | `team <label>` | `fail` | `label` | no such soul is eligible for one of the subject's teams |
| `operator-coverage-unknown` | `operator` | `unknown` | | a question is still open and a source could not be read; it never asserts absence |

A source could not be read when:

- the workspace itself could not be read;
- only its member view could (an unreadable host);
- discovery dropped a member as `cannot-read`;
- a soul file or listing could not be read;
- a resolution hit `E_REMOTE_UNREADABLE`.

A covering soul that was found is still reported. Any other refusal belongs to
the soul, since a spawn would meet it too, so that soul does not cover.

`evidence.excluded` lists the souls that cannot cover although they are
relevant, each as `{soul, code}`:

- a soul whose `soul.yaml` names `oats.setup` but that is disabled
  (`E_SOUL_DISABLED`), ambiguous (`E_SOUL_AMBIGUOUS`) or refused (the
  resolution's code);
- a soul that composes `oats.setup` but empties the messaging slot the
  workspace fills (`slot-none`, with `slots: ["messaging"]`).

Coverage that holds adds no item.

`oats doctor` stays offline. It resolves the souls from this machine's cache
only (no git process, no network) and checks the workspace and **every**
declared team. It lists `operator-soul-missing` and `operator-team-uncovered`
under `problems[]` as `{code, label?, message, remedy}` (text: `! <code>:
<message>`, then the remedy).

Doctor reads the resolutions that `oats souls`, readiness and spawn keep in the
cache. `oats sync` alone does not resolve souls. When the cache cannot answer,
doctor adds no problem. Instead it adds one `information[]` line, starting
`operator-coverage-unknown:`, whose remedy is `oats sync`, then `oats souls`.
The cache cannot answer when:

- the machine never synced;
- the cache was pruned;
- a soul was not yet resolved here;
- the deployment uses a configured `standalone:` view, whose membership read
  is not cached. There, ask readiness.

Any other error, such as an invalid lock, is named as itself.

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

## Launch prompt results

Spawn preview adds `launchPromptAnswers` with the strict effective boolean
`awebDevelopmentChannel` and `consentSource` (a config-file
JSON pointer or `null`). This is a policy report, not a terminal observation
or readiness assertion. Only the aweb development-channel confirmation is
covered, restricted to the qualified Claude executable digest, platform and
geometry documented under [launch consent](configuration.md#exact-home-launch-prompt-consent).
Folder-trust prompts remain unexpected and blocked.

An observed launch has `launchPrompts: {status, answers, reason, receipt}`.
`receipt` carries the actual checked launch-prompt event-write results,
including partial log availability; it is not a receive-readiness receipt.
The `launch-prompt` event records the launch start and pane/PID identity,
consent provenance, signature identifier/digest, action and outcome. Intent is
durable before input; submission (`submitted`, `failed`, `uncertain`) and an
observed screen transition are distinct. Unexpected raw screen text is never
included in the receipt.

Spawn and start both reuse `E_SPAWN_INCOMPLETE` for retained prompt outcomes,
with `launchPrompts.status` set to `blocked` or `incomplete`. Error details
preserve `instance`, `home`, `launched:"unknown"`, `unconfirmed:true` and add
`retained:true`, `target`,
`parentLineageCommitted`, and `launchPrompts`. Unknown prompts report
`blocked: unexpected prompt`. An incomplete audit can follow a possible key;
clients must not offer automatic key retry. `launched:false` in retained
metadata does not mean there is no process or that another harness may be
allocated. Use runtime inspection and the existing start/restart lifecycle.
Same-key spawn replay cannot convert a blocked outcome to successful spawn.

`answers` can contain a `submitted` answer even when the final status is
`blocked`: even after exact or structural completion recognition is qualified,
unsupported input/footer shapes and known question markers can block after Enter
while the actual pane is active. Consumers must preserve that submitted receipt
and never translate this outcome into “nothing started” or automatic retry.
The [completion limitation](configuration.md#exact-home-launch-prompt-consent)
is part of the shipping contract. Structural completion closes observation only;
unknown dialogs retaining the recognized composer/footer can be misclassified.
Mandatory structural evidence-save failure reports checked `incomplete` with the
same answer and target preserved. Private receipt v2 adds no public DTO fields.

Strict Desktop/pi readers must accept these additive fields and the new event
kind before a writer containing them ships. For operator recovery, see
[launch prompt outcomes](execution-targets.md#launch-prompt-outcomes).

## Spawn

### The preview

```text
oats spawn <soul> [the flags of a real spawn] --preview [--max-age <s>] --json
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
 "decision":{"instance":"rm-api","home":"/w/agents/rm/instances/rm-api","branch":"agents/rm-api","base":{"ref":"github.com/nw/agents","oid":"66566512…"},
             "effective":{"repo":"/w/agents-repo","work":"worktree","harness":"pi","model":null,"launchConfig":null,"yolo":null,"backend":"tmux",
                          "childSpawns":true,"relation":null,"providers":{"nw-tools":{},"oats.okf":{"owns":"rm"}}},
             "resolution":"abacbdb5a7975098d77007c8","revision":"c557d8ec9a272ba1c1739dc3"},
 "preflight":{"status":"complete","budgetMs":20000,"elapsedMs":53},"backendStatus":{"name":"tmux","installed":true,"started":false},
 "harness":"pi","model":null,"modelSource":"native default","launchConfig":null,"backend":"tmux",
 "branch":"agents/rm-api","base":{"ref":"github.com/nw/agents","oid":"66566512…"},"worktree":"/w/agents/rm/instances/rm-api/work",
 "worktreeHooks":[{"capability":"nw-tools","required":true}],
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
  `--base` resolved to `oid`. Without `--base`, when `repo` is a clone of the
  soul's repository, `base` is `{ref: <repo key>, oid: <the commit the spawn
  observed>}`, fetched into the clone at apply (`E_REMOTE_UNREADABLE` when it
  cannot be); otherwise `HEAD`. `E_BRANCH_EXISTS` and `E_BASE_UNKNOWN` refuse
  preview and apply alike.
- `worktreeHooks` (feature `worktree-event`, OATS 0.49.0): for a `worktree`
  spawn, the capabilities whose `worktree` hook the spawn would fire, in the
  order they run, as `[{capability, required}]` (`[]` when none declares
  one); `null` in every other mode. `worktree` stays the path string. The
  text preview prints `worktree hooks: a, b (required)` or `worktree hooks:
  none` ([the worktree event](capabilities.md#the-worktree-event)).
- `subject` echoes `{soul, agentsRoot, dir}` byte-exact.
- `warnings`, present only when there is one, is an array of strings: the
  launch-prompt notice, and (0.49.0) the message of each
  [capability warning](#capability-warnings-hook-event-unsupported-oats-0490)
  of the resolved modules. The apply's `warnings` carries the same messages.

**Launch.**
- `harness`, `model`, `modelSource`, `launchConfig`, `backend`, `yolo`
  (absent when nothing sets it) are the resolved selection.
  `backendStatus` is `{name, installed, started: false}`, `null` with
  `--no-launch`. `executable` is the resolved harness binary.
- `launchConfigDefault` (0.32, feature `launch-config-default`) is `true`
  when `launchConfig` is this host's default for the harness (its
  executable, args, env and `yolo` apply without being chosen), `false`
  otherwise. Show it, and `yolo`, whenever it is `true`. An explicit
  `--launch-config none` asks for the bare harness and bypasses the default;
  to run the host's default, omit `--launch-config`.
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

**Observation reuse** (feature `spawn-preview-max-age`, OATS 0.33.0).
- `--preview --max-age <s>` reuses member heads this machine observed at
  most `<s>` seconds ago, as the read verbs do ([Observation
  reuse](#observation-reuse-feature-observe-max-age-oats-0311): the same
  values, refusals and fallbacks to a live observation). With the flag (`0`
  included) the result gains `observation: {observedAt, reused,
  localRevision}`, shaped exactly as the read verbs' block; without it the
  preview is exactly as before, and no other field changes shape.
- `decision.revision` covers the heads the preview used, reused or live.
  Apply never reuses (it refuses `--max-age`): a head that moved since the
  reused observation refuses `E_DECISION_STALE`, and the apply records what
  it observed, so re-preview under `--max-age` to get the new head and
  revision.

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
  launched, unconfirmed: true}` (recover through the session surface).
- The key lives in the home. Mint it on the first confirmation and keep it
  for that intent's retries.
- `wake: {requested, saved, error}` is recorded and replayed; `saved: null`
  means the outcome was not recorded.

**Result** (`oats spawn <soul> … --json`):

```json
{"instance":"rm-api","agent":"rm","home":"/w/agents/rm/instances/rm-api","work":"worktree","branch":"agents/rm-api",
 "base":{"ref":"github.com/nw/agents","oid":"66566512…"},"launched":true,"warnings":[],
 "tmux":{"session":"oats-agents","window":"rm-api","socket":"/tmp/tmux-1000/oats"},"backend":"tmux","repo":"/w/agents-repo","harness":"pi","model":null,"parent":null,"sibling":null,"relation":null,
 "spawnOrigin":"operator","attach":"tmux -S /tmp/tmux-1000/oats attach -t oats-agents","decision":{"instance":"rm-api","revision":"c557d8ec9a272ba1c1739dc3"},"replayed":false,
 "wake":{"requested":false,"saved":null,"error":null},"launchConfig":null,
 "launch":{"version":2,"harness":"pi","launchConfig":null,"launchConfigSource":null,"executable":"/usr/local/bin/pi","executableDeclared":null,
           "executableResolvedFrom":"PATH","args":[],"env":{},"model":null,"hooks":{"launch":{},"env":{},"contributions":[]},"prompt":{"kind":"task-file","file":"TASK.md"}}}
```

(`decision` is abridged: it is the full bound decision.)

- Always present: `instance, agent, home, work, branch, base ({ref, oid}
  the new branch started at; `null` without one), launched, warnings
  (array), tmux ({session, window, socket?} | null), backend ("tmux"), repo, harness,
  model, parent,
  sibling, relation, spawnOrigin (operator | instance), attach, launchConfig,
  launch` (the redacted recipe).
- `tmux.socket` is the absolute socket of the tmux server the window was
  created on; a launched spawn has it, a `--no-launch` one does not. It is
  the OATS tmux server's
  ([execution-targets.md](execution-targets.md#the-oats-tmux-server)), where
  earlier kernels recorded the default server's; the shape is unchanged.
- `attach` is one string, a command for a person to paste, the same in text
  and JSON. It is `tmux -S <tmux.socket> attach -t <session>` for a
  launched spawn (earlier kernels: `tmux attach -t <session>`) and `oats session attach
  --home <home>` for `--no-launch`. A value is single-quoted only when it
  holds a character outside `A-Za-z0-9_./:-`. It is not a field to parse:
  read `tmux` for the target.
- When they apply: `yolo`, `decision` and
  `replayed` (bound apply), `wake` (keyed apply), `wakeSchedule` and
  `wakeScheduleError` (a requested wake), `worktreeHooks` (feature
  `worktree-event`: only when the spawn ran `worktree` hooks, the receipt
  `[{capability, ok, required, log, exitCode, signal?, timedOut?,
  contract?}]`, `log` being the hook's log file).
- A spawn that runs `worktree` hooks can take up to 30 minutes per hook
  ([the worktree event](capabilities.md#the-worktree-event)).

<a id="instance-names"></a>
### Instance names

Feature `spawn-name`. `--name <slug>` is the exact name, with no prefix.
- `--name` with `--purpose`, or without a value: `E_BAD_ARGS`.
- A name that is not a slug (lowercase letters and digits, single dashes),
  equals a soul name, or exceeds 64 characters (derived names included, with
  their suffix) is `E_INSTANCE_NAME_INVALID`.
- A name any soul's `instances/` holds, or a live window of the target
  session on the OATS tmux server carries, is
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
| `E_TEAM_UNKNOWN`, `E_WORKSPACE_SCHEMA` (local-teams-closed) | `{label, at}`, `{reason, path, keys}` | the soul's teams do not resolve |
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
| `E_SPAWN_INCOMPLETE` | `{instance, home, launched, unconfirmed: true}`; retained launch-prompt outcomes additionally carry `{retained: true, target, parentLineageCommitted, launchPrompts}` | See [launch prompt results](#launch-prompt-results). |
| `E_LAUNCH_*`, `E_MODEL_UNKNOWN`, `E_UNSUPPORTED_HARNESS` | | the launch selection is refused |
| `E_LAUNCH_SHIM` | | the home's `oats` (`<home>/.oats/bin/oats`) cannot be written; the spawn is rolled back |
| `E_SCHEDULE_INVALID` | | a bad wake (`--wake-json`, `--wake-file`, `--wake-*`) |
| `E_INTERRUPTED` | `{signal, hooks}` | SIGINT, SIGTERM or SIGHUP while the spawn's `worktree` hooks ran (feature `worktree-event`): the running hook's process group is ended, the spawn is rolled back as for a required hook failure, and the process exits 128 + the signal number |
| `E_REQUIRED_HOOK_FAILED` | `{hooks}`, plus `unconfirmed: true` when compensation cannot finish | a required `spawn` or `worktree` hook failed or timed out; the spawn is rolled back. `hooks` holds the receipt of the event that failed: one entry per hook that ran, `{capability, ok, required, log, exitCode?, signal?, timedOut?, contract?}`, paths only. `log` is `null` for a spawn hook (it keeps no log) and once the rollback removed the home; a retained home keeps a `worktree` hook's log path. Never `home`. Before 0.49.0 a required spawn hook's failure answered `E_SPAWN_FAILED` |
| `E_HOOK_ENVIRONMENT_CONTRACT` | the same as `E_REQUIRED_HOOK_FAILED`, the failed entry with `contract: "environment"` | a `spawn` hook answered an `env` its manifest does not allow, or a `worktree` hook answered `env` at all |
| `E_SPAWN_FAILED` | `{unconfirmed: true}` when compensation cannot finish | anything else |

Spawn failure envelopes carry `error.details.unconfirmed: true` when an existing
keyed spawn is incomplete (`E_SPAWN_INCOMPLETE`) or compensation cannot confirm
cleanup. The keyed-spawn details retain `instance`, `home` and `launched`.
Confirmed completed compensation does not set this marker. This is an additive
producer migration; existing text-based compatibility checks remain.

<a id="oats-worktree"></a>
### `oats worktree`

Feature `worktree-event` (OATS 0.49.0). An instance's extra trees,
`<home>/.work-<purpose>`, made and removed from its home
([extra trees](souls-and-instances.md#extra-trees)). There is no `--home`,
`--dir` or `--server`: the home is `$OATS_INSTANCE_HOME` (or `$OATS_HOME`),
else the home enclosing the working directory.

```text
oats worktree add --purpose <p> --branch <b> --base <remote-branch> [--repo <member key|clone path>] [--preview] [--json]
oats worktree remove --purpose <p> [--json]
```

`add` creates the tree with Git, fires the `worktree` hooks
([the worktree event](capabilities.md#the-worktree-event)), writes
`<home>/.oats/trees/<p>.json` and appends a `worktree-added` event. It can run
for minutes; the hooks' output goes to stderr, and stdout holds only the
envelope. A reader that closes either pipe early only stops reading: the add
runs to its end (and its record to `ready`), the hooks' logs are whole, and
what could not be printed is dropped. Its result:

```json
{"purpose":"docs","path":"/w/agents/dev/instances/dev-1/.work-docs","clone":"/w/docs","remote":"https://github.com/nw/docs.git",
 "member":"github.com/nw/docs","branch":"agents/dev-1-docs","base":"main","baseOid":"9f2c41d0…","state":"ready",
 "hooks":[{"capability":"nw-setup","ok":true,"required":true,"log":"/w/agents/dev/instances/dev-1/.oats/logs/worktree-docs-nw-setup.log","exitCode":0}],
 "record":"/w/agents/dev/instances/dev-1/.oats/trees/docs.json","resumed":false,"warnings":[]}
```

- `remote` never carries credentials; `member` is a member key or `null`.
- `resumed: true`: a `ready` record with the same clone, branch and base was
  found; nothing ran, and the result is the recorded receipt.
- `treeMissing: true` appears when a non-required hook removed or moved the
  tree.
- `--preview` fetches and writes nothing: `{preview: true, purpose, path,
  clone, remote, member, branch, base, record, resume, hooks}`, `resume`
  being `null` or `"recover"` (an interrupted add is rolled back first), and
  `hooks` the hooks that would run, `[{capability, required}]`. When the tree
  is already made, it is the recorded receipt with `preview: true`,
  `resume: "noop"` and `hooksToRun: []`.

`remove` answers `{purpose, path, removed: true, rolledBack, branch,
branchKept, branchKeptReason?, warnings?}`. After removing a `ready` tree,
`rolledBack` is `false` and `branchKept` is `true`. When it completed an
interrupted add's rollback, `rolledBack` is `true` and `branchKept` says
whether the branch still exists. The rollback deletes the branch only when
that add created it, no worktree has it checked out, and it still points at
the commit the add created it at. A branch kept for one of those reasons is
named in `branchKeptReason`, and is not debt.

The rollback signals a hook process group that the interrupted add left only
when the group's leader is alive with its recorded start time. A group whose
leader has exited is never signalled, because its id may already belong to
an unrelated group. Instead `warnings` names it, so that leftover processes
can be ended by hand.

Every `add` or `remove` that reads a record it may act on holds the
purpose's claim, `<home>/.oats/trees/<purpose>.lock`. The claim is a file
that names its holder by pid and start time. A second command waits up to
3 s for a live holder, then answers `E_LIFECYCLE_BUSY` (`details.lock`,
`details.pid`, and [`details.holder`](#busy-holder) on this and on every
other `E_LIFECYCLE_BUSY` of these commands: OATS 0.52.0). A claim whose holder has died, for example one killed in the
middle of a recovery, is taken over by the next command. So a killed `add`
or `remove` can always be run again. A holder that has exited or was killed
and that its parent has not reaped (a zombie) has died: its claim is taken
over, and a `creating` record whose adder is a zombie is recovered, without
waiting for that reap (0.52.0, #870).

Two files at the claim's path are never taken over and never removed
(0.52.0, #874). The command answers `E_LIFECYCLE_BUSY`, in one line that
names the file, says that nothing was done and never says that a command is
running: at once for a file it has read, and for a path that exists and
reads as absent after its 3 s wait and five more attempts, 50 ms apart; `details.lock` is the file the
message names (for the claim of a takeover, `<lock>.reclaim-<nonce>`):

- A path that is no readable claim: a file that does not parse, a directory,
  or a path that exists and cannot be read, such as a dangling symbolic link.
  `<file> is not a readable claim; nothing was done — inspect it and remove
  it if no oats worktree command holds it, then retry`.
- A claim whose holder is gone and that this kernel cannot take over: its
  `nonce` is not the 32 hexadecimal digits a claim carries (a file written
  or damaged by hand); or it is the claim of a takeover that died, at the
  end of a chain of them so long that the system will not name the claim of
  one more (each adds 41 bytes to the file's name: four or five on a file
  system whose names are 255 bytes at most). `the process that held <file>
  (pid <pid>) is gone, and this file is not a claim this kernel can take
  over (<why>); nothing was done — inspect <file> and remove it if no oats
  worktree command holds it, then retry`. Removing that one file lets the
  next command take the rest over.

A killed parent does not take its running git with it. So every git step
that changes a tree, a ref or the worktree list runs in its own process
group, and is recorded (pid and start time) before it starts: in the claim,
or for an `add`'s own steps, in the tree record. A takeover or recovery
first ends a recorded git step that still runs, signalling it only while its
leader runs with the recorded start time (SIGTERM, which git answers by
removing its lock files, then SIGKILL). Only then does it act, so a dead
command's git never finishes late on a tree or branch made after it. A git
step that times out is cleared from the record only once its whole process
group is gone. A git step that cannot be ended keeps the claim, or the
record, and the command answers `E_LIFECYCLE_BUSY`.

`E_LIFECYCLE_BUSY` says that nothing was done, so it is never answered once
a takeover has ended a dead command's git step (0.52.0). A command that
ends such a step and is then refused the claim (another command took it
first, it is held again by a process that is gone, or the system refuses
it) answers `E_LIFECYCLE_FAILED`. Its message names the group it ended
first, then the refusal it met, with "nothing else was done": `git process
group <pgid>, left running by a killed oats worktree command, was ended;
after that: <the refusal>`. `details` are that refusal's own. Run the
command again: nothing of that step is left to end.

A recorded hook group or git step that still has members while its leader's
start cannot be read (where `ps` fails) is never signalled and never passed
over: the leader may still be that hook or git step. The command answers
`E_LIFECYCLE_BUSY`, keeping the claim or the record and touching nothing
else. Its message names the group, its recorded start, why the start cannot
be read and the way out: check the group by hand; if it is that step, end it
(`kill -TERM -- -<pgid>`) and retry; if it is not, remove the claim or the
record it names (a record with what that add left) and retry. A claim's refusal
carries `details.gitPid` and `details.gitStart`.

A failed `add` reports the same facts about its rollback in `details`:
`rolledBack`, `branchKept`, `branchKeptReason` and `warnings`.

| Code | When |
|---|---|
| `E_BAD_ARGS` | not run from an instance home; `--dir`, `--home` or `--server`; a missing value; a value starting with `-`; an invalid purpose, branch or base; `remove` of a purpose with no record (a tree made with raw Git is removed with `git worktree remove`) |
| `E_INSTANCE_RETIRING` | `add` in a quarantined home; in one for which a self-retire is scheduled; or in one whose retire is running (OATS 0.52.0: `add` reads the home's claim and takes nothing; `<instance> is being retired (pid <pid>, since <at>); no tree was made`, `details: {instance, home, lock, pid, since, action: "retire"}`; [Commands that meet on one home](#lifecycle-pairs)) |
| `E_CLONE_MISSING` | the repository is not found, or is not a Git repository |
| `E_CLONE_MISMATCH` | the path is a linked worktree, or the clone has no `origin` |
| `E_BRANCH_EXISTS` | the branch exists in the clone (before the tree is made, or made by another `add` at the same moment); `details.remedy` is `<instance>/<branch>` |
| `E_GIT_FAILED` | a Git step failed on its own (`git worktree add`, or `git switch` while the branch does not exist), with Git's message: `git <sub> failed in <dir>: …`; the tree is removed |
| `E_PLACEMENT_TAKEN` | a `ready` record with another clone, branch or base (`details.differ`); `.work-<p>` with no record, or a file or symbolic link there; an unreadable record |
| `E_LIFECYCLE_BUSY` | an add of that purpose is still running (pid and start time verified); another add or remove of that purpose holds its claim (`details.lock`); a file at the claim's path is no claim this kernel can read or take over (`details.lock`); an interrupted add's rollback could not be completed (`details.owed`; the message says what to deal with and to run `oats worktree remove --purpose <purpose>`, which finishes the rollback); or, `add` only (OATS 0.52.0), the home's claim is held by a retire whose liveness cannot be read, or is a file that is no readable claim (`no tree was made`; [Commands that meet on one home](#lifecycle-pairs)). Every one carries [`details.holder`](#busy-holder) |
| `E_REMOTE_UNREADABLE` | the fetch of `<base>` from `origin` failed; the tree is removed |
| `E_BASE_UNKNOWN` | the new HEAD is not the fetched commit; the message names both |
| `E_REQUIRED_HOOK_FAILED`, `E_HOOK_ENVIRONMENT_CONTRACT` | a required `worktree` hook failed or timed out, or a hook answered `env`; the tree is removed (`details.hooks`, `details.rolledBack`) |
| `E_INTERRUPTED` | SIGINT, SIGTERM or SIGHUP while the hooks ran; the tree is removed and the process exits 128 + the signal number (`details.signal`) |
| `E_WORKTREE_DIRTY` | `remove`: Git refused a tree with uncommitted or untracked work (`details.git` is Git's message); the record is kept. Commit and push, or discard, then retry |
| `E_WORK_PRESERVATION_FAILED` | `remove`: Git refused for another reason, or the tree is still there; the record is kept |
| `E_LIFECYCLE_FAILED` | an error that is not the kernel's, with [`details.cause`](#kernel-codes) when that rule gives it one (an error of the system's or of Node's, and a defect; a refusal written as a plain error without a code has none). When it is the purpose's claim that could not be taken (`<home>/.oats/trees` cannot be made, the claim's file cannot be written), the message is `the claim <path> could not be taken (…); nothing was done`. Also a command that was refused the claim after its takeover had ended a dead command's git step: the message names the group it ended first, then the refusal, and `details` are that refusal's (a refusal of the kernel's has no `details.cause`; anything else has it by the same rule) |

A rollback that cannot finish keeps the record and says so in the message
(`details.rolledBack: false`, `details.owed`); the next `add` or `remove` of
that purpose finishes it.

## `instance.json` and the roster

<a id="instancejson"></a>
### `instance.json`

Written by the spawn; read by the roster and every `--home` command. The
workspace-model fields (feature `instance-modules`):

```json
{"agent":"rm","kind":"persistent","instance":"rm-api","home":"/w/agents/rm/instances/rm-api","soulDir":"/w/agents/rm/souls/66566512168e",
 "repo":"/w/agents-repo","work":"worktree","branch":"agents/rm-api","base":{"ref":"github.com/nw/agents","oid":"66566512…"},
 "harness":"pi","modelFrom":"harness-default","spawnOrigin":"operator",
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
- `branch`: for a worktree instance, the branch its worktree was created on.
  For an attached or checkout instance, the branch the tree's HEAD named at
  the spawn, or `null` when HEAD was detached or named a ref OATS carries no
  branch name for (one whose name is not valid UTF-8); never the word
  `"HEAD"`. The key is absent when the tree's HEAD could not be read, and for
  directory and workspace instances. A home spawned before 0.49.0 may record
  `"HEAD"` for a detached tree; [`oats instance git`](#instance-git-state-oats-instance-gitdiff-instancegitapi-1-oats-0247)
  reads it as no recorded branch. The roster row and the spawn result carry
  the same value (the spawn result has `null` where the key is absent).
- `base` (a worktree instance): `{ref, oid}`, the commit its branch started
  at, as the spawn result states it (see Placement under the spawn preview).
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

Not an envelope: `{root, agents, observation?, features, workspace?, problems?, warnings?}`
(`observation` only with [`--max-age`](#observation-reuse-feature-observe-max-age-oats-0311)).
It carries no `schemaVersion`: a remote caller recognizes the bare roster by
its absence.

```json
{"root":"/w/agents",
 "agents":[{"name":"rm","description":"Cuts releases.","work":"worktree","kind":"persistent","dir":"/w/agents/rm",
            "soulSource":{"repoKey":"github.com/nw/agents","commit":"66566512…","path":"souls/rm","current":"66566512…","status":"current"},
            "instances":[{"agent":"rm","instance":"rm-api","home":"/w/agents/rm/instances/rm-api","harness":"pi","launched":true,
                          "createdAt":"2026-09-28T10:08:01.281Z","modelFrom":"harness-default","startedAt":"2026-09-28T10:08:01.281Z","identityAddress":null,"running":true,
                          "modules":[{"name":"oats.okf","from":{"kind":"package","package":"oats.okf","version":"2.1.3","commit":"ab897841…","integrity":"sha256-bada35…","repoKey":"github.com/awebai/oats-okf"},
                                      "commit":"ab897841…","current":{"commit":"ab897841…","version":"2.1.3"},"status":"current"}],
                          "soul":{"repoKey":"github.com/nw/agents","commit":"66566512…","current":"66566512…","status":"current"}}]}],
 "features":["retire-home","session-start","…","server-probe-features"],
 "workspace":{"reachable":true,"key":"github.com/nw/agents","ref":"git:github.com/nw/agents","keyFrom":"workspace","standalone":false,"defaultTeam":{"label":"eng","team":"eng:nw.aweb.ai"},
              "teams":{"eng":"eng:nw.aweb.ai","mine":"mine:ana.aweb.ai","ops":null},"teamsFrom":"observed"}}
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
  `runtimeError` when that server cannot be read, and also when its socket
  file is missing while a process works in the home or the process scan
  cannot run, `runtimeError` then naming the processes or the scan's error
  ([#624](execution-targets.md#missing-socket); with no process in the home
  a missing socket file reads `false`, as after a reboot); `null` for a home a
  Herdr-era kernel recorded, with `runtimeState: "unsupported"` and
  `runtimeError: "E_HERDR_REMOVED: …"`, the recorded `sessionTarget` staying
  in the row),
  `identity` when a provider recorded one, `rollbackIncomplete` and
  `retirePending` when present, and the Desktop facts below.
- <a id="unreadable-record-row"></a>**A home whose `instance.json` cannot be
  read** (OATS 0.52.0) is listed like every other, and one such home never
  fails the listing. Its row has the fields of a home with no `instance.json`
  and nothing from the record: `instance`, `home`, the Desktop facts
  (`startedAt`, `identityAddress`, `modelFrom`, each `null`), `waitingOnYou:
  null`, `rollbackIncomplete` and `retirePending` when present, and `running:
  null` with `runtimeState: "unreachable"` and `runtimeError:
  "E_UNIDENTIFIED_INSTANCE_HOME: <home>/instance.json cannot be read
  (<reason>)"`. The reason is the system's (`EACCES: permission denied`), the
  parser's (a file cut off, or empty), or what the file is instead: a
  directory, a symbolic link to nothing, JSON that is not an object. A home
  with no `instance.json` keeps its row: the same fields, `running: false`
  and no `runtimeState`. What the lifecycle commands answer for such a home:
  [below](#unreadable-record).
- **`spawnInProgress`** (feature `worktree-event`, OATS 0.49.0): `true` only
  while a spawn that is running its `worktree` hooks is verifiably alive (its
  pid runs with the recorded start time). Such a home holds the quarantine marker
  with an `inProgress` field ([capabilities.md](capabilities.md#manifest)),
  and its row carries `spawnInProgress: true` and **no**
  `rollbackIncomplete`: a live spawn, not a failed one. Once that process is
  gone, or when its start time cannot be read (where `ps` fails), the row
  carries `rollbackIncomplete` as for any quarantine, its `inProgress` naming
  the pid; retire still refuses an unreadable one with `E_LIFECYCLE_BUSY`
  until `--force`. A spawn whose process has exited or was killed and that
  its parent has not reaped (a zombie) is gone (0.52.0, #870): its row
  carries `rollbackIncomplete`, where before it read `spawnInProgress: true`
  until the reap, and retire completes it. Absent otherwise, and from older
  kernels.
- **`waitingOnYou`** (feature `waiting-on-you`): `{since, producer, reason,
  message}` when the row is `running: true` and a producer holds a live claim
  that the instance needs input from a human, else `null` (unknown, not "not
  waiting"). Its rules are the events read's ([Waiting on you](#waiting-on-you)):
  one bounded read of the home's log per running row. A remote roster row
  carries what the remote kernel reports; an older kernel omits the field.
  `running` is the window's presence, which a crashed harness's fallback
  shell or a retained dead pane keeps, so a row with a claim is checked
  against its session (as `oats session inspect` observes it) and reads
  `null` unless a harness runs there.
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
  message}` (modules then stay the recorded map), plus the deployment's
  [workspace identity](#workspace-identity-feature-workspace-identity-oats-0360)
  either way. Absent without `oats-local.yaml`.
- **`features`** (feature `server-probe-features`, OATS 0.49.0): the
  running kernel's own feature list, the same array as `version --json`
  `features`, so a [remote roster](#the-remote-roster-oats-server-roster---json)
  relays a host's features from the status answer it already pulls. It is
  emitted at output time, never part of a reused observation. A kernel
  before 0.49.0 omits it.
- `problems`: the legacy-home rows ([dispatch errors](#dispatch-errors)).
  `warnings`: envelope warnings. `--team` is `E_BAD_ARGS` (an envelope).

<a id="workspace-identity-feature-workspace-identity-oats-0360"></a>
**Workspace identity** (feature `workspace-identity`, OATS 0.36.0). The
`workspace` object says which workspace and teams this deployment is, read
offline with no network, so it is there whether `reachable` is `true` or
`false`:

| Key | Meaning |
|---|---|
| `key` | the canonical repo key of the workspace HOST (`parseRepoRef(…).key`: every spelling of one repository gives one key, e.g. `git:github.com/nw/agents`, `https://github.com/nw/agents.git` and `git@github.com:nw/agents.git` all give `github.com/nw/agents`). When `oats-local.yaml` names a member in place of its host, it is the host's key once the member's backlink is known. `null` when `parseRepoRef` refuses the reference |
| `ref` | the reference exactly as `oats-local.yaml` writes it (`workspace:`), for display only |
| `keyFrom` | `"workspace"`: `key` is the host's, because this run observed it, or the cache holds the ref's workspace file, or a member's cached backlink names the host. With nothing observed or cached, the ref is taken as the host, as the schema defines `workspace:`. `"member"`: the ref names a member whose host is not known yet, so `key` is the member's own. `null` with a `null` key |
| `standalone` | `true` only when `oats-local.yaml` sets `standalone:` (the configured standalone view, whose local teams are its whole team model). A run that fell back to the standalone view because the host is unreadable is `false`: its teams are the workspace's, read through the sources below. Unlike `workspace.standalone` on [inspect](#oats-inspect), which is the view a home runs in |
| `defaultTeam` | `{label, team}`: the label is `oats-local.yaml`'s `defaultTeam`, `team` its provider id from `teams` (`null` when that map gives none). `null` when `oats-local.yaml` names no default team |
| `teams` | `{<label>: <provider team id> \| null}`: every team label the deployment maps, local and shared, by label; a label in both is the committed (shared) one, as [`oats teams`](#oats-teams) resolves it |
| `teamsFrom` | where the shared teams came from: `"observed"`, the workspace file this run read; `"cache"`, this machine's cached copy at the host commit it last observed (no git process, no network; when `key` names a member, the host its cached `oats-membership.yaml` names); `"local"`, none: `teams` holds the local teams only |

A configured standalone deployment reads no workspace file, so it is always
`teamsFrom: "local"`, with its local teams only (as spawn resolves them there).
`oats status` only reads the workspace when an instance records modules or a
workspace soul, so an empty deployment answers from the cache, or from local
teams on a host that has not observed its workspace (`oats sync` and
`oats teams` observe it). The cache is the running kernel's own: after an
OATS upgrade it is empty until the host next observes its workspace.

**Matching workspaces across machines.** Two deployments are the same
workspace when their `key`s are equal; `ref` is never compared. The identity
is resolved the same offline way for every deployment, standalone included,
whatever its team view:

- `keyFrom: "member"` is unresolved: never match it, and show it as
  unresolved (the host is learned when the deployment observes its
  workspace, e.g. `oats sync`).
- `keyFrom: "workspace"` with nothing observed (`teamsFrom: "local"` on a
  deployment that is not standalone) means the ref was taken as the host, as
  the schema defines. If it is really a member, the worst case is a split
  (one workspace shown as two until `oats sync` there), never a wrong merge.
- A `null` key is an unusable reference and never matches. Show `ref` with
  "this deployment's workspace reference isn't valid; fix oats-local.yaml".
- Known limit: `parseRepoRef` lowercases the host but keeps the path's case,
  so references that differ in owner or repository case give different keys.

**Matching teams across machines.** This is the rule for comparing two
deployments' teams (as the Desktop does to attach a remote machine to a
workspace):

- `teamsFrom` `"observed"` or `"cache"`: a `null` team is **unmapped**, and
  unmapped matches only unmapped.
- `standalone: true` with `teamsFrom: "local"`: the local config IS the
  complete team model, so a `null` team is **unmapped** (matches only
  unmapped). Reason to show: "teams are local only on this host
  (standalone)", with no sync advice.
- `standalone: false` with `teamsFrom: "local"`: a `null` default team is
  **unknown** and never matches. Reason to show: "this host hasn't observed
  its workspace yet; run oats sync there". A non-null default team (a locally
  mapped team) matches normally.

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
 "probe":{"ok":true,"features":["retire-home","session-start","…","server-probe-features"]},"agentsRoot":"/srv/team/agents",
 "workspace":{"reachable":true,"key":"github.com/acme/team","ref":"git:github.com/acme/team","keyFrom":"workspace","standalone":false,"defaultTeam":{"label":"default","team":"acme:team"},
              "teams":{"default":"acme:team"},"teamsFrom":"observed"},
 "souls":[{"name":"dev","harness":"claude","work":"worktree","agentsRoot":"/srv/team/agents"}],
 "instances":[{"server":"build","instance":"dev-a","agent":"dev","home":"/srv/team/agents/dev/instances/dev-a",
               "agentsRoot":"/srv/team/agents","harness":"claude","backend":"tmux","tmux":{"session":"oats-agents","window":"dev-a"},
               "running":true,"identity":{"alias":"dev-a","address":"acme/dev-a"},"identityAddress":"acme/dev-a",
               "teams":[{"label":"default","team":"acme:team"}],"startedAt":"2026-09-29T10:00:00.000Z","createdAt":"2026-09-29T09:58:12.004Z",
               "model":"opus","runtimeState":null,"parentInstance":"lead","siblingInstance":null,"relation":"child","relativeTo":"lead",
               "spawnOrigin":"instance","work":"worktree","repo":"/srv/team/ws","branch":"agents/dev-a","modelFrom":"soul",
               "soul":{"repoKey":"github.com/acme/team","commit":"66566512…","current":"9c1e04ab…","status":"moved"},
               "modules":[{"name":"oats.okf","from":{"kind":"package","package":"oats.okf","version":"2.1.3","commit":"ab897841…","integrity":"sha256-bada35…","repoKey":"github.com/awebai/oats-okf"},
                           "commit":"ab897841…","current":{"commit":"ab897841…","version":"2.1.3"},"status":"current"}],
               "retirePending":false,"rollbackIncomplete":false,
               "savedRoute":false,"addressable":true,"missingRemotely":false}],
 "retireFailures":[]}
```

- **`probe`**: `{ok: true, features}` when the host's `status --json` was
  pulled, else `{ok: false, error: {code, message}}` (ssh failed, the host
  answered `ok: false`, or `E_ROSTER_BUDGET`: the roster's budget ran out
  before this target), with no `features` key.
- **`probe.features`** (feature `server-probe-features`, OATS 0.49.0): the
  host's kernel features, relayed from the top-level `features` of its
  [`status --json`](#the-roster-oats-status---json), never probed: the roster
  runs no `version --json` and stores nothing. The answer is untrusted, so it
  is relayed only when it is an array of at most 256 entries, each a string
  of at most 64 characters matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`; then it is
  the host's list as answered (order and any duplicate kept). Anything else,
  even one bad entry among good ones, is `null`: never a filtered list. A
  host before 0.49.0 omits the key, so its group reads `null` too, whatever
  its version. Read it as `Array.isArray(probe?.features)`: not an array
  means unknown; `[]` is a valid answer (a host with no features), not
  unknown.
- **`workspace`** (feature `workspace-identity`, OATS 0.36.0): the host's
  own `status --json` [`workspace` object](#workspace-identity-feature-workspace-identity-oats-0360),
  relayed verbatim, or `null` when the host reports none (a deployment
  without `oats-local.yaml`, or a failed or skipped probe). A host before
  0.36.0 answers the reachability-only object (`{reachable, code?, reason?,
  message?}`) with no identity fields, so the identity is there only when
  the object has a `key` field (which a 0.36.0 host always sends, `null` for
  an unusable reference). It is never derived on this side. It is on the group, not the
  rows, so an empty remote deployment still reports it.
- **Instance rows** relay the host's own `status --json` row: `identity`,
  `identityAddress`, `teams`, `startedAt`, `createdAt`, `model`,
  `runtimeState`, `parentInstance`, `siblingInstance`, `relation`,
  `relativeTo` and `spawnOrigin`, and (relayed from 0.42.1) `work`, `repo`,
  `branch`, `modelFrom`, `soul` and `modules`, are always present, `null`
  when the host does not supply them (an older host, a fact it never
  recorded, or a saved route the host no longer lists). Each is the
  [local row's](#the-roster-oats-status---json) fact of the same name,
  relayed as the host answered it. Nothing is derived on this side: `repo`
  is a path on the host, never read here, and `soul` and `modules` are the
  host's own drift observation (against its own members and lock), not
  recomputed: `modules` is the drift rows, or the recorded map when the host
  could not read its workspace, as on a local row.
- **`waitingOnYou`** (0.40.2, [Waiting on you](#waiting-on-you)) is on a row
  only when the host's kernel reports it: a row from a host before 0.40.0,
  and a saved route the host did not list, have no such key. Absent means
  "not reported", which is not `null` ("no claim"). When present it is `null`
  or `{since, producer, reason, message}`, passed through the kernel's read
  rule again on this side: a value that is not a claim (no valid `since` or
  `producer`) is `null`, and an unknown `reason` or an invalid `message` is
  `null` inside a claim that still counts. As on a local row, the host
  reports a claim only for a running instance.
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

<a id="servers-per-workspace"></a>
### Servers per workspace (feature `servers-per-workspace`)

```text
oats server list [--workspace-ref <ref>] --json
oats server check <id> --json
```

`server list` is an envelope whose `result` is `{file, servers}`; each row is
the registration (`id`, `sshHost`, `workspace`, and `oatsPath`, `path`,
`label` when set) plus `workspaceKey` (`null` when not known yet), `target`
and `snapshots`. With `--workspace-ref <ref>`, `servers` holds only the rows
whose `workspaceKey` is the canonical key of `<ref>` (`parseRepoRef`; any
spelling of the repository), and `result.unknownWorkspace` lists the ids
whose key is not known; an unparsable ref is `E_REPO_REF`.

```json
{"file":"/Users/me/.oats/servers.json",
 "servers":[{"id":"altair-aweb","sshHost":"altair","workspace":"/Users/me/Agents/aweb","path":"/opt/homebrew/bin","label":"altair",
             "workspaceKey":"github.com/awebai/ac",
             "target":{"sshHost":"altair","workspace":"/Users/me/Agents/aweb","oatsPath":"oats","path":"/opt/homebrew/bin"},"snapshots":0}],
 "unknownWorkspace":["build"]}
```

`server check` adds `workspaceKey` (the host's answer, else the recorded one,
else `null`), `workspaceReadable` (`true`, `false`, or `null` when the host
does not advertise `server-connect` or cannot say) and, when it is `false`,
`workspaceReadError: {code, message, reason, hint?}` beside `id`, `target`,
`remote`, `workspaceReachable`, `agents` and `error`. A recorded key the host
contradicts fails the check with `E_SERVER_WORKSPACE_MISMATCH`, `details:
{recorded, reported}`, and the registration is not rewritten. `server add
--json` answers the registration with `workspaceKey` (`null`, and a
`warnings` entry, when the host answered none).

<a id="oats-server-connect"></a>
### `oats server connect` (feature `server-connect`)

```text
oats server connect <id> --ssh <host> [--workspace-ref <ref>] [--dir </abs/path or ~/path on the host>]
                    [--oats <path>] [--path <dirs>] [--label <text>] [--install-oats] [--replace] --json
```

An envelope, `ok: true` whenever no step failed, human steps included
([servers.md](servers.md#connect-a-machine) has what each step does):

```json
{"id":"altair-aweb","ready":false,
 "registration":null,
 "steps":[{"step":"ssh","status":"ok"},
          {"step":"oats","status":"done","detail":"installed @awebai/oats 0.39.0 (was missing)"},
          {"step":"git","status":"needs-human","code":"E_REMOTE_UNREADABLE",
           "detail":"cannot read remote https://github.com/awebai/ac (auth): on macOS a session without a terminal …",
           "remedy":"on altair: on macOS a session without a terminal … (`gh auth login --insecure-storage`, then `gh auth setup-git`), or use an SSH key the session can reach: …",
           "hint":"keychain-non-interactive"},
          {"step":"deployment","status":"skipped","detail":"waits for git"},
          {"step":"register","status":"skipped","detail":"waits for git"},
          {"step":"readiness","status":"skipped","detail":"waits for git"}],
 "human":["on altair: on macOS a session without a terminal … or the desktop login's ssh-agent (point SSH_AUTH_SOCK at it in the shell's startup file)"]}
```

- `steps` is always the six steps `ssh`, `oats`, `git`, `deployment`,
  `register`, `readiness`, in that order. A step is `{step, status}` plus
  `detail` when there is something to say; `needs-human` adds `remedy` (and
  on `git` the error's `code` and any `hint`), in which every command to run
  is a Markdown code span with each argument quoted for a POSIX shell (a
  value from a reference or a host path is always one literal argument), and
  a value in the surrounding text has its backslashes and backticks escaped
  (`` \\ ``, `` \` ``), so the code spans are exactly the commands (a readiness line relays the provider's own wording); `failed` adds `code` and, for
  some codes, `details`. `skipped` steps say `waits for <step>`.
- `registration` is the registration as written or found (`sshHost`,
  `workspace`: the absolute path the host resolved for `--dir`, never `~`;
  `workspaceKey`; and `oatsPath`, `path`,
  `label` when set), `null` until the `register` step has run.
- `human` lists the remedies of the `needs-human` steps, in order. A
  `readiness` step that needs a human has one line per problem
  (`<souls>: <subject>: <reason>[ → <remedy>]`, plus `readiness not checked
  for N souls: …` when the 60 s budget ran out, or `readiness not checked: the
  host did not list its souls within 60 s; …` when the listing itself did not
  finish); its `remedy` is those lines joined by `\n`.
- `ready` is `true` when no step is `needs-human` or `failed`.
- A `failed` step ends the run: `ok: false`, `error.code` is the step's code
  (`E_SSH`, `E_REMOTE_INSTALL`, `E_SERVER_WORKSPACE_MISMATCH`,
  `E_DIR_NOT_EMPTY`, `E_SERVER_EXISTS`, `E_SERVERS_BUSY`, or the host's own
  code relayed),
  `error.details` is the step's `details` plus `steps`, the steps so far
  (the failed one last). A mismatch at `deployment` has `details: {expected,
  reported, dir}`; at `register`, `{recorded, reported}`.

The host-side read it uses, `oats onboard <dir> [--workspace <ref>] --check
--json`, answers `{check: true, dir, state, workspace: {ref, key, url}, remote}`:
`state` is `absent`, `empty`, `not-empty`, `not-a-directory` or `deployment`;
`remote` is `{readable: true, commit}` or `{readable: false, error: {code,
message, reason, hint?, remedy?}}`. It writes nothing.

<a id="capability-commands-on-a-server"></a>
### Capability commands on a server (feature `capability-route`)

`oats <namespace> <command> … --server <id>` runs `oats <namespace>
<command> …`, the argv as typed minus `--server <id>`, from the registered
workspace directory on the server. With `--json` the host's stdout (its
envelope) is relayed verbatim and the exit status is the host's. When the
host gave no output this side answers one envelope: `E_SSH` (`ssh to <host>
failed running \`oats …\` on server <id>`) or `E_REMOTE_ENVELOPE`, with
`details: {server, status}`; any `--invite` value in the printed argv is
`<redacted>`. `--server` with no value is `E_BAD_ARGS`, an unknown id
`E_SERVER_UNKNOWN`. Stdin is forwarded untouched unless it is a terminal.

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
- `recorded` is what the spawn recorded in `instance.json`: `branch` (`null`
  when none was recorded) and `repo`. `drift` is `true` only when a branch
  was recorded and the tree is not on it. A home spawned before 0.49.0 may
  record the word `"HEAD"` for a detached attached or checkout tree; no
  branch has that name, so it reads as `branch: null` with `drift: false`.
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
- The read runs without external diff, textconv, fsmonitor, hooks, lazy
  fetch, the caller's Git environment or global config, and writes nothing
  (`readOnly`). An object a partial clone lacks is not fetched: the read
  fails with `E_GIT_FAILED` (with Git 2.44 or later; an older Git ignores
  `GIT_NO_LAZY_FETCH`).
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
  home). The deployment is the one the home's spawn recorded, when that
  directory really holds the home at `agents/<agent>/instances/<instance>`;
  otherwise it is the fourth ancestor of the home as it was addressed. Each is `{path, status: "ok" | "absent" | "refused" | "tail",
  bytes}`. Only a regular file is opened (no symlinks, same device and inode
  after open), and at most its last 4 MiB is read (`"tail"`).
- **Kinds:** `spawned`, `launched`, `restarted`, `stopped`, `stop-refused`,
  `retire-planned`, `retired`, `worktree-retained`, `worktree-removed`,
  `branch-deleted` (not written since 0.41.0: no retire deletes a branch;
  older logs hold it), `child-spawn-refused`, `launch-warning` (0.30: a
  `launch` hook's warning at session start/restart, `data: {message}`),
  `recomposed` (from earlier kernels), `waiting` (0.40: a producer's claim,
  [Waiting on you](#waiting-on-you)), `worktree-added` (0.49.0, feature
  `worktree-event`: `oats worktree add` made an extra tree, `data: {purpose,
  path, branch, base, baseOid, remote, member, hooks}`, `remote` without
  credentials, `member` a key or `null`, `hooks` the `worktree` hooks'
  receipt). `producer` is `kernel`, a capability id,
  or another producer id (`agent`). Older rows may carry `eventsApi: 1`.
  `launched` is written by spawn and, since 0.40, once per session start or
  restart, as soon as the session exists (`data: {harness, backend,
  launchConfig, phase, startId}`; spawn's row has neither `phase` nor
  `startId`). `phase` is `start` or `restart`, or `recovered` when a later
  start adopted an interrupted start's receipt that had no boundary; that row
  is dated at the receipt's launch time. The boundary is complete per log: a
  log that missed it gets a copy of the same row (same time and data), never
  a second one.
- `spawned` carries `worktreeHooks` (the receipt `[{capability, ok,
  required, log, exitCode, …}]`) in its `data` only when the spawn ran
  `worktree` hooks (0.49.0).
- `retired` (`data: {agent, keepDir, self, quarantine, workRecovery, hooks,
  reason?}`) is written to the workspace log only,
  `<deployment>/.agents/events/<agent>--<instance>.jsonl`, which outlives the
  home. `reason` is present only when
  the retire completed a self-retire an older OATS recorded with
  `--delete-branch` (since 0.41.0: `this self-retire was requested with
  --delete-branch by an older OATS; retirement no longer deletes branches, so
  the branch and the worktree were left`).
- `worktree-retained` (`data: {movedTo, branch, recordedBranch}`) and
  `worktree-removed` (`data: {branch}`) are written to the workspace log only,
  by the retire's worktree step. Since 0.42.1 the retire also writes one per
  extra tree it handled
  ([extra trees at retire](souls-and-instances.md#extra-trees-at-retire)),
  with `extra: true` and the tree's absolute `path` added:
  `worktree-retained` `{movedTo, branch, recordedBranch: null, extra: true,
  path}` and `worktree-removed` `{branch, extra: true, path}`. A row without
  `extra` is about `work/`.
- **Incarnation.** Each row carries the writing home's `createdAt` (or
  `null` for old rows); the top-level `incarnation` is the current home's (or
  `null`). Earlier incarnations are returned as this address's history.
- **Address.** `--home` must be a home of `<instance>` (`E_HOME_MISMATCH`),
  or a retired one (below). A home has one address in storage, its real path (since 0.40.2): rows are
  written and matched under it, whatever spelling a writer or reader used (a
  deployment reached through a symlink, a symlinked agents root). The answer
  keeps the spelling it was asked in: the top-level `home` and every
  returned row's `home` are the home as the caller addressed it (`--home`,
  or the home found under `--dir`), the same string a status row carries.
  Rows for another address are dropped and counted in
  `integrity.foreignRows`; torn or invalid lines are counted in
  `integrity.unreadableRows`. A row present in both logs is returned once;
  identical rows repeated within one log (a set, a clear and the same set in
  one millisecond) are all returned, as many as the log holding the most
  copies has.
- **Rows from before 0.40.2**, in a deployment addressed through a symlink
  only. A stored `home` is never rewritten, and never matched under another
  spelling. A row an earlier kernel wrote under the lexical spelling (a
  spawn's rows, and the claims of a session that was spawned and never
  restarted) is foreign after the upgrade, and counted in
  `integrity.foreignRows`. What that means for a claim:
  - A claim that was live under the lexical spelling stops showing. Nothing
    brings that row back: the claim shows again only when a producer makes it
    anew (the next permission prompt or question, the agent's next
    `oats instance attention`). A restart starts a new session with no
    claim, as always.
  - A claim that stayed set because the restart that should have voided it
    was recorded under the real path (#583) is gone.
  - The rows a started or restarted session wrote under the real path, which
    `oats status --dir <symlink>` could not see, are read now. They cannot
    surface a stale claim: such a session wrote its clears and its session
    boundaries under the real path too, so that history is complete.
- **A retired instance** (#642) answers from its workspace log, which
  outlives the home. This applies only when no live home resolves: a live
  home of `<instance>` under the scope is always answered as above. Without
  `--home`, the kernel lists `<deployment>/.agents/events/*--<instance>.jsonl`
  (the deployment is the directory holding the scope's agents root) and takes
  the agent from the file name. One log answers for
  `<agents root>/<agent>/instances/<instance>`. Several (one name retired
  under two agents) refuse with `E_AMBIGUOUS_INSTANCE`, the message naming
  the count and asking for `--home`, and `details.candidates[]` listing each
  as `{root, agent, home}`. No log is `E_SESSION_UNKNOWN`, as before. A
  `--home` naming a removed home answers only when it is
  `<agents root>/<agent>/instances/<instance>` (compared by real path, so a
  symlinked spelling of the root is the same address) and
  `<deployment>/.agents/events/<agent>--<instance>.jsonl` exists; the agent
  is taken from the path. The logs are read from the scope's spelling of the
  home, and the answer's `home` (and each row's) is the `--home` as given.
  Any other removed `--home` is `E_HOME_MISMATCH`.
  The answer has the same shape as a live home's: the `home` source is
  `absent`, and `incarnation` is `null` (no `instance.json` remains), so
  `waitingOnYou` is `null` and `waitingClaims` is empty. The rows keep the
  incarnation they were written with.
- **Window.** `count` is the rows after `--since`; `returned` the window
  (`--limit`, default 200, 1–2000); `truncated` means rows were cut or a
  source was a tail. `lastEvent` is `{kind, at, producer, incarnation}` of
  the last returned row, or `null`.
- **Waiting.** `waitingClaims[]` is `{producer, waiting, since, reason,
  message}` per producer with a live claim in the current incarnation
  (cleared ones included). A producer's latest row with `data.waitingOnYou`
  decides. `waitingOnYou` is `{since, producer, reason, message}` of the
  newest positive claim, or `null` (unknown, not "not waiting"). See
  [Waiting on you](#waiting-on-you) for the producers and the rules.
- Errors: `E_SESSION_UNKNOWN`, `E_AMBIGUOUS_INSTANCE`, `E_HOME_MISMATCH`,
  `E_BAD_ARGS`, `E_EVENTS_FAILED`.

### Waiting on you

Feature `waiting-on-you` (OATS 0.40.0): an instance blocked on a human (a
permission prompt, a question, an agent asking for an answer) says so through
a producer's claim. **Claims are display-only:** nothing in the kernel acts
on `waitingOnYou`. In particular `oats session input` behaves exactly as
before whether or not a claim is set.

```text
oats instance waiting <set|clear> --producer <id> [--reason permission|question|attention] [--message <text>] [--home <abs>] [--dir <d>] --json
oats instance attention [--message <text>] [--clear] --json
```

```json
{"eventsApi":2,"instance":"dev-1","home":"/w/agents/dev/instances/dev-1","producer":"oats.core","changed":true,
 "waitingOnYou":{"since":"2026-10-03T12:00:00.000Z","producer":"oats.core","reason":"permission","message":null}}
```

- **The row.** A claim is a `waiting` event, `data: {waitingOnYou: true,
  reason, message?}` or `{waitingOnYou: false}`, appended to both logs, with
  `producer` the caller's `--producer`.
- **`waiting`.** `--producer` matches `^[a-z0-9][a-z0-9._/-]{0,63}$` and is
  not `kernel`. `set` needs `--reason`, one of `permission`, `question`,
  `attention` (closed). `clear` refuses `--reason` and `--message`. The home
  is `--home`, else `$OATS_INSTANCE_HOME`, else the instance home enclosing
  the working directory; it must be a home of its own name under the scope
  (`--dir`, else the agents root the home sits in).
- **`attention`** is the agent's own claim, run by the instance from its
  home: sugar for `waiting set --producer agent --reason attention
  [--message]`, and `--clear` for `waiting clear --producer agent`. Its home
  comes only from `$OATS_INSTANCE_HOME`: it has no `--home` or `--dir` and
  never targets another instance. Unset, or not an instance home (no readable
  `instance.json`), is `E_USAGE`. `--clear` with `--message` is `E_BAD_ARGS`.
- **`--message`**: one line of 1 to 200 characters (code points). Refused,
  as `E_BAD_ARGS` naming `--message`: control characters (`\p{Cc}`: C0, DEL,
  C1; so no newline, tab or ESC), the line and paragraph separators U+2028
  and U+2029, the bidi embeddings, overrides and isolates U+202A–202E and
  U+2066–2069, the invisible U+200B (zero width space), U+2060 (word
  joiner) and U+FEFF (BOM), and the tag characters U+E0000–E007F. Everything
  else is allowed, including ZWJ and ZWNJ (U+200C, U+200D: emoji sequences
  such as 👩‍💻, Persian and Indic text), the marks LRM, RLM and ALM (U+200E,
  U+200F, U+061C) and the soft hyphen. A message that
  starts with `--` goes inline, `--message=--deploy failed`: that value is
  only ever the message, never a flag (`--message=--clear` sets the message
  "--clear"). The spaced form `--message --deploy` reads `--deploy` as a
  flag and is `E_BAD_ARGS`. It is stored as given, only on a
  positive claim. The reader applies the same rule again: an invalid stored
  message (a hand-edited log) reads as `null`, and the claim still counts.
  A stored `reason` outside `permission`, `question`, `attention` reads as
  `null` too, and a row whose `producer` is neither `kernel` nor a valid
  producer id, or whose `at` is not a date, is no claim at all.
- **Idempotent.** The verb reads the producer's live claim first and appends
  only on a change: a `set` whose reason or message differs from the live
  positive claim appends (`changed: true`), an identical one does not; a
  `clear` appends only over a live positive claim. The answer is
  `{eventsApi, instance, home, producer, changed, waitingOnYou}`, where
  `waitingOnYou` is that producer's resulting claim (`null` when it holds
  none) and `home` is the home as the caller addressed it (`--home`,
  `$OATS_INSTANCE_HOME` or the enclosing home); the row is stored under the
  real path, so a set and a clear through different spellings of one home
  meet. Concurrent writers append whole lines; the latest row decides.
  Each log is judged on its own, and success means both took the row: a
  write either log refused is `E_EVENTS_FAILED` naming it, and the next call
  (a retry) appends again to repair it.
- **Session boundary.** A claim written before the incarnation's latest
  kernel `launched`, `restarted` or `stopped` row (in time order; rows of the
  same millisecond in append order) is not live: it belongs to an ended
  session and is not listed in `waitingClaims`. A crash
  while waiting reads `null` on the roster (not running), and the next start
  writes `launched`, which voids the claim.
- **Producers.**
  - `oats.core`: the Claude Code emitter oats.core installs in a Claude
    instance's `<home>/.claude/settings.json` (`permission` on a permission
    prompt, `question` on AskUserQuestion or an MCP elicitation, cleared when
    the session moves on). See [capabilities.md](capabilities.md), "oats.core:
    needs input".
  - `agent`: the instance itself, through `oats instance attention`, and
    only through it: `oats instance waiting --producer agent` is
    `E_BAD_ARGS`. **Agent claims are cleared only by the agent (`--clear`)
    or a session boundary**; no hook clears them (a wake broker's paste is
    also a prompt submit).
- **Where it shows.** `waitingOnYou` on the events read, on `oats status
  --json` instance rows (running rows only) and on `oats session inspect
  --json` (beside `state`, whose enum is unchanged; `null` unless the harness
  is running). Plain `oats status` prints `! needs input (<reason>):
  <message>` under a running instance's row while it holds a claim.
- **Cost.** To compute the field, `oats status` reads the home log of each
  running row (the workspace log only when the home log is absent), with
  the same bounded read as the events read: at most the last 4 MiB, so a
  claim older than the last 4 MiB of a very busy log is not seen. Stopped
  rows read nothing.
- **Local only.** Neither verb routes with `--server`: producers run on the
  instance's own host.
- Errors: `E_BAD_ARGS`, `E_USAGE` (attention), `E_SESSION_UNKNOWN` (no
  readable `instance.json`), `E_HOME_MISMATCH`, `E_EVENTS_FAILED` (the write
  failed; nothing else is affected).

## Lifecycle: stop and retire

Feature `lifecycle-plans` (and `retire-retention`), `lifecycleApi: 1`. A
**plan** lists what an action would touch, with a `planRevision` (24 hex)
hashed from the facts that make it safe. Apply carries the revision back; if
reality moved it refuses `E_PLAN_STALE` with the fresh `details.plan`. An
idempotency key (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`) makes a retried apply
return the first receipt. Recorded parentage (`parentInstance`) is the only
relation followed; a child whose parent name matches several homes is listed
under `ambiguous` and never acted on. Parentage is read from each home's
`instance.json`: a home whose record cannot be read is never stopped as
anyone's child. It is in no plan's `targets`, `children` or `ambiguous`, and
no stop or retire of its parent names it, so its session may go on running
under a parent that was stopped or retired. `oats status` is where it shows
([its row](#unreadable-record-row)).

<a id="unreadable-record"></a>
**A home whose `instance.json` is there and cannot be read** as a JSON object
(cut off, empty, kept from the user, a directory, a link to nothing, JSON
that is not an object; OATS 0.52.0) decides only for itself.

- Every command about another instance answers as if that home were not
  there: its stop and retire plans and applies, `oats session`, `oats
  instance events`, a spawn, the roster.
- Every lifecycle command about that home is refused with
  `E_UNIDENTIFIED_INSTANCE_HOME` before it takes a claim, reads the home or
  touches anything: `oats retire` (plain, `--plan`, guarded, `--self`), `oats
  instance stop --plan` and `--apply`, `oats session start` and `restart`.
  The answer has no `details`, and the message is `<home>/instance.json
  cannot be read (<reason>); nothing was done. Restoring the file from a copy
  makes the home usable again; removing such a home through OATS is not
  possible yet.`
- `oats retire --force` is refused the same way. `--force` removes a home
  that has no `instance.json`; a home whose record is there and cannot be
  read may be a whole instance with work, and is never removed blind.
- The lineage is read from records. A parent whose record cannot be read has
  no recorded children for a stop or a retire: they are listed, and each is
  stopped and retired on its own. A home whose record cannot be read is never
  stopped as anyone's child: it is not a target of its parent's stop or
  retire, no plan and no answer of either names it, and a retire does not
  repair its lineage. Its session may go on running under a parent that was
  retired; `oats status` is where it shows.
- A spawn that names such a home as its parent or anchor is refused
  (`E_SPAWN_FAILED`, the same sentence with `nothing was spawned`): the
  parent's child-spawn policy and the lineage are in that record.
- `oats session inspect`, `input` and `attach` on that home answer
  `E_RUNTIME_ENDPOINT_UNKNOWN`, and `oats instance events` still reads its
  logs.

`E_UNIDENTIFIED_INSTANCE_HOME` for a record that cannot be read is answered
only before any effect: nothing was signalled, run, copied or removed. A
record that becomes unreadable after a retire has taken the home's claim is
refused with the same sentence, before the retire's first signal (the end of
the hook group an interrupted spawn left). That answer alone carries
[`details.reached`](#retire-reached), untouched: `{phase: "before-effects",
sessionStopAttempted: false, hooksStarted: false, home: "kept", recovery:
null}`. A plan refuses the same way when the record became unreadable after
the home was resolved.

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
  reason}`; render it as unknown, never idle. `reason` is the kernel code of
  what failed (`E_SESSION_UNAVAILABLE` for an error that has none).
- `work` is the Git observation summarized (`changed` counts changed,
  renamed, copied and unmerged rows), or `{observed: false, reason}`:
  `"no-worktree"`, or the kernel code of what failed (`E_GIT_FAILED` for an
  error that has none; `E_WORK_INSPECTION_FAILED` for a home the kernel
  cannot look into, where whether it has a `work/` cannot be told; OATS
  0.52.0).
- `midTask`: `true`, `false` or `"unknown"`.
- `retiring` and `stopPending`, booleans on every target, say who holds the
  target's home when the plan is read (OATS 0.52.0, feature
  `lifecycle-claim-stop`). `retiring`: a self-retire is scheduled for it
  (its pending marker is there), or a retire holds its
  [claim](#retire-one-at-a-time). `stopPending`: a stop apply holds its
  claim. A holder counts while it is not known to be gone: alive, or of a
  liveness that cannot be read. `retiring` is one of the facts
  `planRevision` is hashed from, as it was; `stopPending` is not. The
  plan's `notes` say in a line that an apply will refuse either: a note is
  a sentence for a person, and no client keys on its text (`retiring` and
  `stopPending` are the data). Before
  0.52.0 `retiring` read the pending marker alone and `stopPending` read a
  file inside the home ([below](#stop-claim)).

```text
oats instance stop <instance> --apply --plan-revision <rev> --idempotency-key <key> [--no-recursive] [--grace-ms <n>] [--home <abs>] --json
```

Children first: SIGTERM to the harness processes and a bounded wait
(`--grace-ms`, 1–300000, default 20000), never escalated. Home, work,
transcript and launch configuration are kept; `oats session restart` brings
the instance back.

<a id="stop-claim"></a>
**A stop holds the claim of every target** (OATS 0.52.0, feature
`lifecycle-claim-stop`; #866, #890). It is the file that orders the retires
of a home ([One retire of a home at a time](#retire-one-at-a-time)):
`<instances>/.oats-retirement/claims/<instance>.lock`, beside the homes, its
record naming the holder by pid and start time and by its verb (`action:
"stop"`). With `--server` it is taken on the host. An apply does this, in
this order:

1. It refuses bad arguments (`E_BAD_ARGS`), `--grace-ms` among them.
2. It reads the plan, for its targets.
3. It replays a receipt stored under the same key (below). No claim is
   taken for that.
4. It takes the claim of every target, in one fixed order (by the claim's
   path), so that two overlapping stops never each hold half: one takes the
   first file both want, and the other is refused at once and releases what
   it took. **A holder is answered here, before a stale plan**, as a guarded
   retire answers it: `E_INSTANCE_RETIRING` beside a retire,
   `E_LIFECYCLE_BUSY` beside another stop
   ([Commands that meet on one home](#lifecycle-pairs)). A stop never waits
   for a holder.
5. It reads the plan again, under the claims: this is the plan it acts on.
   **It holds the claim of every target of this plan before it does
   anything.** A target it does not hold yet (a child recorded, or readable
   again, since step 2) sends it back to step 4 with this plan's targets,
   every claim released first so that the order of step 4 holds. A stop
   whose targets are others under each of three such reads (a constant of
   the kernel: there is no setting for it) gives up:
   `E_LIFECYCLE_BUSY`, `holder: "none"`, `… nothing was stopped — run the
   command again`. It then compares the plan's revision with the one sent,
   once: `E_PLAN_STALE` with the fresh `details.plan` (the claims this
   apply holds are not reported in it as `stopPending`). A home that was
   retired since the plan was shown answers `E_SESSION_UNKNOWN`; one whose
   `instance.json` can no longer be read, `E_UNIDENTIFIED_INSTANCE_HOME`; a
   child in that state is no longer a target, which is a changed plan.
6. It refuses a target for which a self-retire is scheduled
   (`E_INSTANCE_RETIRING`, with `details.plan`).
7. It stops each target, writes the receipt and releases the claims.

Everything through step 6 is before any effect: nothing was signalled, and
nothing was written into a home. From step 7 on a target's failure is a row
of the receipt, and no answer of the apply carries a code of
[the list](#before-effect-codes). A target that was never launched, or is
idle, is claimed and released like any other; its row says `alreadyIdle`.

A stop that is killed (SIGKILL, SIGTERM, SIGINT or SIGHUP) leaves its claim
files, and they refuse nothing: the next stop or retire of that home takes
over the claim of a holder that is gone. Before 0.52.0 a stop marked each
target with `<home>/.oats-stop-pending.json`, a file that named no holder,
so a killed stop left every later stop of that instance refused
(`E_LIFECYCLE_BUSY`) until someone removed the file (#890).
**`.oats-stop-pending.json` stays a reserved name.** This kernel neither
writes nor reads it. One that an older kernel left refuses nothing, does not
make `stopPending` true, and is removed by the next stop apply of that home
once it holds the claim; a removal that fails is a warning on stderr (`oats:
warning: …`, in both modes) and the stop goes on.

Two kernel versions acting on one deployment at once are not covered: a
kernel before 0.52.0 takes no claim for a stop and does not read a stop's
claim. A machine has one installed CLI, and a command routed with `--server`
runs with the host's own, so the only overlap is a command of the old
version still running across an upgrade: upgrade with no lifecycle command
in flight.

- The receipt is `{lifecycleApi: 1, action: "stop", instance, home,
  idempotencyKey, planRevision, at, ok, results, retained: ["home", "work",
  "transcript", "launch"], replayed: false}`. A result is `{instance, home,
  ok: true, stopped, alreadyIdle, state}` or `{instance, home, ok: false,
  code, message, stillRunning: [pid]}`. `code` is `E_SESSION_UNAVAILABLE` when
  whether the instance runs cannot be established, among them a recorded
  tmux socket file that is missing while a process works in the home
  ([#624](execution-targets.md#missing-socket)): never `alreadyIdle`.
- `code` is always a [kernel code](#kernel-codes). A stop that fails for a
  reason of the system's (the home removed under it, a write refused) is
  `E_SESSION_STOP_FAILED`, as one whose harness still runs after the wait is.
  Its `message` then holds the system's text and ends with what is true of
  the harness: `its harness was signalled (SIGTERM) and has exited`, `… and
  is still running`, `no signal reached its harness, which had already
  exited` (the stop found it idle, or its processes gone, when it came to
  signal), `… which was not seen to exit`, `whether its harness was signalled
  is not known`, or `its harness was not signalled`. `stillRunning` is what
  the stop established by then: the pids still alive, `[]` when it
  established that none is, `null` when it established nothing. A stop that
  fails on a [defect of the kernel](#kernel-codes) is that same row, and the
  defect's stack is printed on stderr; a stop that fails on a refusal without
  a code (a `tmux` command that failed) is that row and prints no stack. The
  same holds for a child's stop in a retire's `childrenStopped`.
- `ok: false`: at least one target still runs (text mode exits 1).
- A replay is the stored receipt (`<home>/.oats-stop-receipt.<key>.json`)
  with `replayed: true`. A receipt stored by a kernel from before feature
  `lifecycle-kernel-codes` can hold the system's code in a failed target's
  `code`; a replay answers `E_SESSION_STOP_FAILED` there (the `message` keeps
  the system's text), so the rule holds for a replay too. The stored file is
  not rewritten. A replay takes no claim. The same key sent again while the
  first apply still holds its claims is refused on the claim
  (`E_LIFECYCLE_BUSY`): the receipt is not written yet. Once the first apply
  has ended, the key replays.
- Refusals: `E_BAD_ARGS` (no `--plan-revision`, a bad key, not exactly one of
  `--plan`/`--apply`, a `--grace-ms` that is not 1–300000: answered before
  the plan is read and before the key is used. Before 0.52.0 a bad grace was
  one `E_BAD_ARGS` row per target, in a receipt stored under the key),
  `E_INSTANCE_RETIRING` and `E_LIFECYCLE_BUSY` (a target's claim is held:
  the holder's [`details`](#lifecycle-pairs), with `details.plan`, the plan
  read before the claims), `E_PLAN_STALE` (`details.plan`, the fresh one),
  `E_INSTANCE_RETIRING` for a scheduled self-retire (`details.plan`),
  `E_SESSION_UNKNOWN`,
  `E_AMBIGUOUS_INSTANCE`, `E_HOME_MISMATCH`, `E_UNIDENTIFIED_INSTANCE_HOME`
  (the home's `instance.json` [cannot be read](#unreadable-record); `--plan`
  and `--apply`, nothing was done), `E_LIFECYCLE_FAILED` (any error
  that is not the kernel's, with [`details.cause`](#kernel-codes) when it
  has one; among them a claim that cannot be taken for a reason of the
  system's: `the claim <path> could not be taken (…); nothing was done`). A
  stop never answers `E_WORK_INSPECTION_FAILED`.

<a id="lifecycle-pairs"></a>
### Commands that meet on one home

Feature `lifecycle-claim-stop`, OATS 0.52.0 (#866). A retire and a stop apply
hold the home's claim for their whole run, and `oats worktree add` reads it.
Each cell is the answer of the command that **arrives**. It is given at once
and before any effect: that command stopped, ran, copied, made and removed
nothing, and the command already on the home is not disturbed.

| On the home ↓ / arrives → | `oats retire` | `oats instance stop --apply` | `oats worktree add` |
|---|---|---|---|
| a retire is running | `E_LIFECYCLE_BUSY` | `E_INSTANCE_RETIRING` | `E_INSTANCE_RETIRING` |
| a self-retire is scheduled | `E_LIFECYCLE_BUSY` | `E_INSTANCE_RETIRING` | `E_INSTANCE_RETIRING` |
| a stop apply is running | `E_LIFECYCLE_BUSY` | `E_LIFECYCLE_BUSY` | not refused |
| a retire whose liveness cannot be read holds the claim | `E_LIFECYCLE_BUSY` | `E_LIFECYCLE_BUSY` | `E_LIFECYCLE_BUSY` |
| a stop whose liveness cannot be read holds the claim | `E_LIFECYCLE_BUSY` | `E_LIFECYCLE_BUSY` | not refused |
| the claim file is no readable claim | `E_LIFECYCLE_BUSY` | `E_LIFECYCLE_BUSY` | `E_LIFECYCLE_BUSY` |
| the holder of the claim is gone | not refused | not refused | not refused |

- **A holder is answered before a stale plan, by both verbs.** A guarded
  retire and a stop apply compare the revision they were sent only once
  they hold the claim, so beside a holder the answer is the cell above
  whatever the plan would read by then.
- **A scheduled self-retire holds no claim** until its completion runs: it
  is its pending marker. A retire reads the marker under the claim, while
  the completion lives (`E_LIFECYCLE_BUSY`, [below](#retire-one-at-a-time)).
  A stop apply reads it in the plan it makes under its claims: a plan that
  showed `retiring: true` is answered `E_INSTANCE_RETIRING`, and an apply
  whose plan was shown before the retire was scheduled is answered
  `E_PLAN_STALE` first, with the fresh plan.
- **A claim file that is no readable claim** is one that does not parse as
  a claim, a directory, or a path that is there and cannot be read, such as
  a dangling symbolic link. All three commands read it the same way, and
  none removes it.
- **A holder that is gone** (it exited or was killed, a zombie too) refuses
  nothing: a retire or a stop takes its claim over and runs, and a `worktree
  add` takes nothing and runs. One file of a gone holder still refuses the
  two verbs that must take the claim: one this kernel
  [cannot take over](#retire-one-at-a-time) (a `nonce` that is not a
  claim's, written or damaged by hand) answers `E_LIFECYCLE_BUSY`, `holder:
  "none"`, to a retire and to a stop; a `worktree add` reads the same file
  as a holder that is gone, and runs. So does a file that parses and names
  no pid (`{}`, `[]`, a verb alone): a claim
  [always carries its pid](#retire-one-at-a-time), so no kernel wrote that
  file as one.
- **A stop does not refuse a `worktree add`:** a tree does not depend on the
  session.
- `--plan` of either verb takes no claim and is never refused by one; a
  stop plan reports the holder (`retiring`, `stopPending`). `oats worktree
  remove` does not read the home's claim. `oats session start` and `restart`
  do not read it yet: they are refused only beside a scheduled self-retire
  (`E_INSTANCE_RETIRING`). `oats status` does not show a held claim.

Several targets:

1. **A stop of a parent whose recorded child is being retired** answers
   `E_INSTANCE_RETIRING` before the first target is stopped, never after:
   the claim of every target is taken first, and the claims already taken
   are released.
2. **Two overlapping stops of one parent:** one stops everything, and the
   other is refused whole with `E_LIFECYCLE_BUSY`.
3. **A retire whose recorded child is held by someone else.** A retire does
   not hold its children's claims. It stops each child, and that stop takes
   the child's claim for its own span. A child whose claim is held is a row
   of `childrenStopped` with `ok: false`, `stillRunning: null` and the code
   of the cell above for an arriving stop (`E_LIFECYCLE_BUSY` beside a stop,
   `E_INSTANCE_RETIRING` beside a retire), and the retire answers
   **`E_CHILDREN_RUNNING`**, whether or not it had already stopped another
   child ([`reached.sessionStopAttempted`](#retire-reached) says whether a
   signal was sent). A stop of a child beside its parent's retire is not
   refused.

**`error.details` of a claim's refusal** is `{instance, home, lock, pid,
since, action}`, with `holder` on `E_LIFECYCLE_BUSY`:

- `instance` and `home`: the home whose claim refused. **In a recursive
  stop this may be a child of the instance asked for.**
- `lock`: the file that names the holder. `pid` and `since`: the holder's
  pid and when it took the claim.
- **`action`: the holder's verb**, `"retire"` or `"stop"`. A claim written
  by a kernel before this feature has no verb and reads as `"retire"`. A
  reader treats a value it does not know as busy.
- A refusal that names no holder has no `pid`, no `since` and no `action`:
  a claim file that is no readable claim, and a command that cannot read
  its own start time.
- **A scheduled self-retire is no claim.** A retire's refusal beside one
  has the same keys, with `lock` the pending marker and `pid` the
  completion's. A stop apply's has `details.plan` alone, and a `worktree
  add`'s has no `details`; their message is `<instance> is being retired;
  nothing was stopped` (`no tree was made`), with no pid.
- A stop apply's refusal carries `details.plan` beside them: the plan it
  read before it took the claims.
- A holder whose liveness cannot be read: `details.unknown` is the reason,
  and the message names the recorded verb, the pid, its recorded start and
  the way out (check that pid by hand; if it is not that command, remove
  `<lock>`, then retry).

The messages: `<instance> is being retired (pid <pid>, since <at>); nothing
was stopped` (a `worktree add`: `no tree was made`); `a stop of <instance>
is already running (pid <pid>, since <at>); nothing was done — wait for it
to finish` (an arriving stop: `nothing was stopped`). A client shows the
message and never parses it.

<a id="busy-holder"></a>
**`error.details.holder`, on every `E_LIFECYCLE_BUSY`** of `oats retire`,
`oats instance stop` and `oats worktree add|remove`, for a claim or for
anything else the code is answered for (a tree record, a spawn's marker, a
scheduled completion, an owed rollback). It says, as data, whether waiting
ends the refusal:

| `details.holder` | It means | What ends it |
|---|---|---|
| `"running"` | the kernel established that another `oats` command is alive (a retire, a stop, a worktree command, a spawn, a scheduled completion) | waiting |
| `"unknown"` | whether one still runs cannot be read | a person checks what the message names (the process, the file) |
| `"none"` | nobody is running: something that a dead command left, or that this host lacks, has to be dealt with | what the message says (a file to inspect and remove, a group to end, a command to run) |

A reader treats a value it does not know, or the field's absence (a kernel
without the feature), as **do not promise that waiting ends it**. For
`"unknown"` and `"none"` the message always names the step that ends it,
after ` — `. The field has a meaning only under `E_LIFECYCLE_BUSY`: under
any other code a reader ignores it (an `E_LIFECYCLE_FAILED` made after a
takeover ended a dead holder's step carries the details of the refusal it
then met, `holder` among them).

<a id="before-effect-codes"></a>
**The codes a stop and a retire answer only before any effect.** The kernel
holds one list, by verb. A code in it means *refused, nothing happened*: no
process was signalled, no hook ran, and nothing of a home was written, copied
or removed. For a retire that is `reached.phase: "before-effects"`, or no
[`reached`](#retire-reached) at all; for a stop apply, that no target's stop
had begun.

| Code | `oats instance stop` | `oats retire` |
|---|---|---|
| `E_BAD_ARGS` | yes | yes |
| `E_PLAN_STALE` | yes | yes |
| `E_INSTANCE_RETIRING` | yes | yes |
| `E_LIFECYCLE_BUSY` | yes | yes |
| `E_HOME_MISMATCH` | yes | yes |
| `E_SESSION_UNKNOWN` | yes | yes |
| `E_AMBIGUOUS_INSTANCE` | yes | yes |
| `E_UNIDENTIFIED_INSTANCE_HOME` | yes | yes |
| `E_REMOTE_INCOMPATIBLE` | yes | yes |
| `E_AMBIGUOUS` | yes | yes |
| `E_SNAPSHOT_UNKNOWN` | yes | yes |

The last three are the router's (`--server`): they are answered before the
command is sent to the host. The list is about the envelope's `error.code`.
A row of a result (a stop receipt's `results[].code`, a retire's
`childrenStopped[].code`) says why that one target was not stopped, and
other rows may say that theirs was. Every other code may come after an
effect: `E_CHILDREN_RUNNING`, `E_SESSION_STOP_FAILED`,
`E_RUNTIME_QUIESCE_FAILED`, `E_WORK_PRESERVATION_FAILED`,
`E_WORK_INSPECTION_FAILED`, `E_LIFECYCLE_FAILED` and the rest; for a retire
`reached` says how far it got.

The rule holds by construction. Each verb knows how far it got at one place
(a retire: the `phase` it reports in `reached`; a stop apply: whether a
target's stop had begun), and an error that would leave that place with a
listed code after the first effect is not answered with it. It is a
[defect of the kernel](#kernel-codes): `E_LIFECYCLE_FAILED`,
`details.cause: {name: "LateRefusal"}`, its other details kept, and its
stack on stderr.

Two answers of a retire that came after an effect had a listed code before
0.52.0 and have another now (#895):

- A guarded retire whose extra trees no longer read as its plan said, found
  at the step that moves them, after the hooks: `E_WORK_PRESERVATION_FAILED`
  (it was `E_PLAN_STALE`). The home and its work are kept.
- The worktree hook process group that an interrupted spawn left, when it
  survives SIGTERM and SIGKILL: `E_RUNTIME_QUIESCE_FAILED`, naming the group
  (it was `E_LIFECYCLE_BUSY`, "nothing was retired", after two signals).
  `reached.phase` is `"before-hooks"`; no session was stopped, no retire
  hook was run and nothing was removed.

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
          "ambiguous":[],"pullRequest":"unknown",
          "extraWorktrees":[{"path":"/w/agents/dev/instances/dev-1/.work-docs","repo":"/w/docs","branch":"agents/dev-1-docs","detachedAt":null,
                             "disposition":"retain","movedTo":"/w/.agents/worktrees/docs/agents-dev-1-docs","reason":"…"}]},
 "defaults":{"retainWorktree":true,"deleteBranch":false,"stopChildren":true,"retainChildren":true},
 "planRevision":"4e5f6a7b8c9d0e1f2a3b4c5d","notes":["the worktree is on feat/x, not the recorded agents/dev-1; …"]}
```

- `facts.session` and `facts.work` read as a [stop plan](#stop)'s
  `session` and `work`. Work that was not observed is `{observed: false,
  reason}`: `"no-worktree"`, or the kernel code of what failed
  (`E_GIT_FAILED` for an error that has none; `E_WORK_INSPECTION_FAILED` for
  a home the kernel cannot look into, where whether it has a `work/` cannot be
  told; OATS 0.52.0).
- The plan changes nothing except appending a `retire-planned` event to the
  workspace log. `pullRequest` is always `"unknown"`. Branch actions use the
  worktree's branch, never `recordedBranch`.
- A home spawned before 0.25.9 has no session receipt (0.30). Its
  `facts.session` is `{state: "absent", present: false, backend, established:
  true, note}` when the session is observably gone: instance.json records no
  launch, or the recorded tmux server is not running, or the recorded window
  is gone and no pane on that server works in the home, and in every case no
  live process on the host has its working directory in the home
  ([the process scan](souls-and-instances.md#the-process-scan): `/proc` on
  Linux, `lsof` elsewhere; a scan that cannot run counts as not absent). Retire then proceeds
  without quiescing (hooks run, work is preserved). Otherwise it stays
  `unestablished`, with a `note` saying why, and retire refuses with
  `E_RUNTIME_ENDPOINT_UNKNOWN`, `--force` included. `notes` repeats either
  case. Read an unknown `state` as not idle.
- `notes` says what a retire would copy to recovery (0.42), in up to two
  strings read from the home's retirement baseline and the work mode, without
  hashing anything:

  ```text
  recovery: the home is copied to /w/agents/dev/instances/.oats-retirement/recovery before the home is removed, when it changed since spawn; not copied: .aw, .aweb-identity, .aweb-identity-*, .oats-aweb (oats.aweb)
  recovery: uncommitted worktree state is copied there too
  ```

  The first is always present. Its `; not copied: …` tail is there only when
  the baseline records declared home entries
  (`retirement.disposable.home`): `not copied: <roots> (<capability>)`, the
  roots as written in the manifest, in the order the baseline stores them
  (sorted by capability, then root), one group per capability, groups
  separated by `; `. At most 16 roots are listed, and only as many as fit in
  about 1024 characters; the rest are `, and N more`. When not even one
  fits, the tail is `not copied: N declared roots, too long to list here`.
  The recovery path is never cut: when it is too long for the note, the
  note reads `recovery: the home is copied to the recovery directory beside
  the home … (its path is too long for this note: the retire receipt names
  it as workRecovery.path, and the retire summary prints it)`.
  The second is the line above in worktree mode, `recovery: work/ is copied
  there when it is not empty` in directory mode, and absent in checkout,
  attached and workspace modes. They are strings in `notes`: no other key
  changes, and `planRevision` is unaffected.
- `facts.extraWorktrees` (0.42.1) lists the instance's
  [extra trees](souls-and-instances.md#extra-trees-at-retire): linked
  worktrees at `<home>/.work-*` that Git confirms. It is an array, empty when
  there are none, in every work mode. Each row is `{path, repo, branch,
  detachedAt, disposition, movedTo, reason}`:
  - `path`: the tree's absolute path in the home.
  - `repo`: its repository, the first entry of that repository's `git
    worktree list` (the main worktree, or the bare repository).
  - `branch`: the branch its HEAD is on, or `null`. `detachedAt`: the commit
    when HEAD is detached, else `null`.
  - `disposition`: `"remove"` (the tree is clean: it would be removed, its
    branch kept), `"retain"` (it would be moved to `movedTo`, as `work/` is
    retained) or `"refuse"` (the retire would refuse with
    `E_WORK_PRESERVATION_FAILED` and keep the home).
  - `movedTo`: the target for `"retain"`, else `null`.
  - `reason`: `null` for `"remove"`, why the tree is not clean for
    `"retain"`, why it is refused for `"refuse"`.

  `notes` also carries one string per tree that says the same. When one is
  too long for a note, its longest parts (branch, repository, target,
  reason) are replaced, longest first, by a pointer to `facts.extraWorktrees`;
  the tree's path stays whole, or, when the path alone is too long, the note
  says `an extra worktree whose path is too long for this note …;
  facts.extraWorktrees in the plan JSON lists it`. The trees are
  part of `planRevision`: a tree created, removed, dirtied or cleaned between
  the plan and the apply, or a change of its disposition or target (another
  directory taking the `<leaf>-N` it would move to, for example), refuses a
  guarded apply with `E_PLAN_STALE` before anything runs. A reader that does
  not know the key can ignore it; the `notes` strings say the same.
- Every string in `notes` is at most 4096 characters, and a plan has at most
  64 of them, the limits the Desktop reads (0.49.0, #658). The extra trees
  are the only notes whose number is not fixed: when they would pass 64, the
  last tree note kept says `and N more extra worktrees (facts.extraWorktrees
  in the plan JSON lists every one)`. A note never cuts a name or a path:
  the drift note gives way, longest name first, to a pointer to
  `facts.work.branch` or `facts.recordedBranch`; a session note whose reason
  is too long (a process's command line, a tmux error) points to
  `facts.session.note`.
- A worktree-mode plan whose recorded children include attached instances
  that use this home's `work/` (`instance.json` `work: "attached"`, `work` a
  link to `<home>/work`, directly or through another link) has one note naming them (0.49.0, #718): `attached
  child instance(s) <names> use this home's work/ as their work: a retire
  that keeps the worktree repoints their work link to it; with
  --discard-worktree the worktree is removed and their work link will
  dangle`. It holds for either choice; no other key changes. A relink that
  fails is a string in the receipt's `warnings`.
- `facts.recordedBranch` is `null` where the home records the word `"HEAD"`
  (a detached checkout or attached spawn before 0.49.0, #641): it is not a
  branch name, so `facts.work.drift` is `false` for it as well.

Plain `retire` keeps a worktree-mode instance's work: the worktree is moved
(`git worktree move`) to `<deployment>/.agents/worktrees/<repo>/<branch>` (a
`-2` suffix if taken; `detached-<oid12>` when detached), state intact. The
`<branch>` leaf is the branch flattened to one path component, and a long one
is cut and hashed to fit NAME_MAX
([souls-and-instances.md](souls-and-instances.md#extra-trees-at-retire)). An
extra tree that is not clean is moved the same way; a clean one is removed.

```text
oats retire <instance> [--plan-revision <rev> --idempotency-key <key>] [--discard-worktree] [--home <abs>] --json
```

A first retire prints the **raw receipt**, not an envelope:

```json
{"retired":"dev-1","agent":"dev",
 "retention":{"worktree":"retained","movedTo":"/w/.agents/worktrees/one/feat-x","branch":"feat/x","detachedAt":null,"recordedBranch":"agents/dev-1"},
 "worktreeRemoved":false,"branchDeleted":false,"removedDir":true,
 "workRecovery":{"path":"/w/agents/dev/instances/.oats-retirement/recovery/dev-1-AbC123",
                 "classes":["changed instance-home bytes","untracked or ignored worktree bytes"],"bytes":48444211,
                 "home":{"paths":[{"path":".oats/","bytes":874696},{"path":".agents/","bytes":141312},{"path":"notes/","bytes":2048},{"path":"STATE.md","bytes":512}],"bytes":1018568},
                 "outputs":{"paths":[{"path":"scratch/","bytes":1258291},{"path":"note.txt","bytes":12}],"bytes":1258303},
                 "notCopied":[{"scope":"home","path":".aw","owner":"oats.aweb"}],
                 "afterHooks":{"home":true,"work":false}},
 "childrenStopped":[{"instance":"dev-1-child","home":"/w/agents/dev/instances/dev-1-child","ok":true,"stopped":false,"alreadyIdle":true}],
 "planRevision":"4e5f6a7b8c9d0e1f2a3b4c5d","idempotencyKey":"r1","replayed":false}
```

- `retention`: `{worktree: "retained" | "removed" | "absent", movedTo?,
  branch, detachedAt?, recordedBranch}`, or `null` when no
  worktree step ran: a non-worktree mode, or a worktree kept for the retry.
  A retire whose hooks left cleanup outstanding keeps the worktree exactly as
  it was (with `worktreeRemoved: false`) and says why in `rollbackIncomplete`
  (`git worktree <path>: kept for the retry; outstanding: …`); the retry does
  the step once nothing else is outstanding. A work directory whose git admin
  entry is gone is never touched: it is an incomplete item (`git worktree
  <path>: its admin entry is missing; …`), and `--force` refuses it with
  `E_WORK_PRESERVATION_FAILED`.
- `--discard-worktree` removes the worktree, and verifies that it is gone (nothing
  at `work/`, not in `git worktree list`); a removal that did not happen, or
  cannot be verified, refuses with `E_WORK_PRESERVATION_FAILED` and keeps the
  home, `--force` included. One exception: with no entry at all at `work/`
  (a dangling link is an entry) and a repository that cannot be read,
  `retention.worktree` is `"absent"`, never `"removed"`, and a quarantine
  retry keeps `could not verify removal` as an incomplete item, which only
  `--force` clears ([souls-and-instances.md](souls-and-instances.md)). No retire deletes a branch, a
  retried or `--force`d quarantine included, with the one exception below.
  `branchDeleted` means exactly "retire's own `--delete-branch`", which is
  refused, so it is always `false`; it does not say whether a branch was
  deleted. `spawnCompensation` (below) is the one place a branch deletion by
  retire is reported. `retention.branchDeleted` and
  `retention.branchDeletionSkipped` are not written. `--delete-branch` is refused with `E_BAD_ARGS` (`oats
  retire no longer deletes branches: …`) before any effect: before a plan
  revision is compared and before a recorded child is stopped. A failed
  spawn's quarantine that still owes the branch the spawn created stays
  incomplete while the branch is there (`the branch the failed spawn created
  is left: OATS does not delete it. Inspect it and delete it with Git if it
  is not wanted, then retry`; the item names no branch:
  `retention.recordedBranch` has it when the worktree step ran, otherwise the
  retained home's `instance.json` `branch`) or while
  Git cannot show it gone (`git branch <b>: could not verify whether it still
  exists (…)`). Such a home cannot be completed from Desktop: the operator
  deletes the branch with Git and retries, or uses `--force` from the CLI.
- **The one exception** (feature `worktree-event`, OATS 0.49.0): a spawn
  killed while its `worktree` hooks ran (SIGKILL, or its rollback cut short)
  leaves a marker with `inProgress.branch` and `inProgress.baseOid`. Once
  that process is verified dead, retire ends the leftover hook process group,
  runs the retire hooks, removes the worktree and verifies the removal, and
  only then deletes the branch with an atomic compare-and-delete (`git
  update-ref -d refs/heads/<b> <baseOid>`), finishing the spawn's own
  compensation: a branch still at its creation commit holds no work. When
  the tip moved, the branch is checked out in any worktree, or the ref cannot
  be read, it is not deleted, and the retry stays incomplete with the
  "branch left" item above (the home is kept). `branchDeleted` stays
  `false` (retire's own `--delete-branch`); the step is reported in the
  additive `spawnCompensation`, the one place such a deletion is reported:
  `{branch, branchDeleted: true}`, or `{branch, branchDeleted: false, reason}`
  (`reason`: the tip moved, it is checked out in a worktree, it could not be
  read, or Git refused), present only when the step was reached. Desktop's
  retire-receipt reader accepts it as an unknown field.
- Before the worktree is removed, HEAD is read again: a HEAD that moved since
  the retire's last inspection stops it with `E_WORK_PRESERVATION_FAILED`
  (`the worktree's HEAD changed after it was inspected, so the worktree was
  not removed. The home and the worktree are kept, and so is any recovery the
  retire wrote; retry the retire.`), and a HEAD that cannot be read with
  `E_WORK_INSPECTION_FAILED`. Either may follow earlier effects of the same
  retire (hooks run, a recovery copied): an error here is not proof that
  nothing happened, nor that a recovery exists. Read
  [`error.details.reached`](#retire-reached), which says both.
- `extraWorktrees` (0.42.1): the extra trees the retire handled, present only
  when it handled at least one. Each row is the plan's row (`{path, repo,
  branch, detachedAt, disposition, movedTo, reason}`) plus `outcome`:
  `"removed"` or `"retained"`, with `movedTo` where a retained tree went. The
  step runs only when the home is removed (not with `--keep-dir`, not when the
  home is kept for a retry), after the hooks and before the worktree step of
  `work/`. `--discard-worktree` does not apply to it. A locked tree
  (`"refuse"` in the plan) stops the retire with `E_WORK_PRESERVATION_FAILED`
  naming the tree before anything runs (no session stop, no retire hook);
  a lock that appears during the hooks, or a move or removal Git refuses,
  stops it at the step, after the hooks. `--force` does not bypass either;
  the home and `work/` are kept, and trees already handled stay handled. A tree
  that no longer matches what the applied plan said refuses with
  `E_WORK_PRESERVATION_FAILED`, the home kept, rather than be moved or
  removed unplanned (OATS 0.52.0; it was `E_PLAN_STALE`, a code that says
  nothing happened, answered after the hooks: #895).
  The key is additive.
- `workRecovery`: `{path, classes, bytes, home, outputs?, repoCopy?,
  notCopied?, afterHooks?}`, present when a recovery was written. One retire
  writes at most one recovery directory, and `path` is that directory.
  - `classes` is the union of the classes seen before and after the retire
    hooks, in first-seen order. `bytes` covers the whole directory,
    `after-hooks/` included.
  - `home`, `outputs` and `repoCopy` describe the pre-hook snapshot (the
    top-level `home/`, `repo/` or `work/`) and are not rewritten by the
    post-hook pass. So `repoCopy.copied: false` (a home-only snapshot) can
    appear with `afterHooks.work: true`: the repository copy is then under
    `after-hooks/repo/` only. A recovery first written after the hooks (the
    instance was clean before them) has no `after-hooks/`, and those keys
    describe that one snapshot.
  - `home`: `{paths: [{path, bytes}], bytes}`. The top-level entries of the
    `home/` snapshot, largest first, a directory ending in `/`. Always
    present when a recovery is written.
  - `outputs`: `{paths: [{path, bytes}], bytes}` names what was copied
    beyond tracked state, largest first.
  - `notCopied`: `[{scope, path, owner}]`, sorted by `path`. The home
    entries that existed at any point of the retire (before or after the
    hooks) and were left out by a capability's `retirement.disposable.home`
    declaration ([capabilities.md](capabilities.md#manifest)), by their real
    names: a prefix that matches several entries lists each one, and a
    declared entry that does not exist is not listed. `owner` is the
    declaring capability; when two declare the same entry it is the first in
    capability-name order. Since 0.42.1 the list also holds each verified
    extra tree (`.work-<purpose>`), with `owner: "kernel:extra-worktree"`: the
    retire handles it at its own step, never in the copy. Each entry has
    exactly these three keys: names and owners only, no sizes, hashes, modes
    or contents of what was left out. `scope` is always `"home"` in this
    release. Present only when there is at least one.
  - `afterHooks`: `{home: boolean, work: boolean}`, saying which parts were
    copied again under `after-hooks/`: `after-hooks/home/` when a retire hook
    changed the home (its bytes and permission bits, the kernel's own
    records included), and `after-hooks/repo/` (worktree mode) or
    `after-hooks/work/` (directory mode) unless the work is proven unchanged
    after the hooks: a directory by its bytes and bits, a worktree by its Git
    state and the bytes and bits of its files
    ([souls and instances](souls-and-instances.md#retire)). A worktree that
    holds a repository is never proven unchanged: for it `work: true` says
    that a work copy was made after the hooks, not that a hook changed the
    work. `work` is also `true` when the pre-hook snapshot held the home
    only and the work was copied for the first time after the hooks, moved
    or not, because something beyond the home was there to preserve. The
    home is not copied again because the work is.
    Each part is whole and verified, not a delta, but `after-hooks/` is not
    a complete picture of the instance after the hooks: with `home: false`
    the recovery's home is the pre-hook one, and it holds the kernel's own
    records (the event log, the stop and restart receipts, listed in
    [souls and instances](souls-and-instances.md#retire)) as of then.
    Present only when that directory was written.
  - `workRecoveries` is no longer emitted. An older kernel on a server may
    still send `workRecoveries[]` beside `workRecovery` (one `{path, classes,
    bytes, outputs?, repoCopy?}` per recovery directory it wrote), so a
    reader must keep accepting it. A kernel before 0.42 sends no `home`,
    `notCopied` or `afterHooks`.
  - `recovery.json` inside the directory stays `version: 1`. It carries
    `phase` (`"before-hooks"`, then `"complete"` once the post-hook check has
    concluded), `home` and, when they apply, `notCopied` and `afterHooks`.
    `phase` is not in the receipt: a receipt is produced only once that check
    has concluded. A retried retire writes its own recovery and its receipt
    names only that one
    ([souls-and-instances.md](souls-and-instances.md#retire)).
- When they apply: `rollbackIncomplete` and `retainedHome` (cleanup
  incomplete, home kept, exit 1), `forcedIncomplete`, `relinked`,
  `capabilityMeta`, `warnings`, `wakeSchedulesRemoved`.
- A deferred self-retire (`--self`) prints `{retired, agent, deferred: true,
  pendingMarker, resultPath, logPath, completesInSec, completionPid}`, or
  `{…, alreadyScheduled: true, requestedAt}` while one is scheduled and its
  completion has not started (below).

**Recorded children**, on every apply (plain, guarded and `--self`), as the
plan says: each child the plan lists is stopped first (bounded SIGTERM,
never escalated) and kept, once the retire has resolved the home and before
the instance's own session is stopped. A home whose `instance.json`
[cannot be read](#unreadable-record) is never stopped as anyone's child: the
plan does not list it, `childrenStopped[]` does not name it, and its session
may go on running after its parent is retired; `oats status` is where it
shows. `childrenStopped[]` lists the children stopped,
deepest first, as `{instance, home, ok: true, stopped, alreadyIdle}` or
`{instance, home, ok: false, code, message, stillRunning}`. A plain or
`--self` receipt carries it only when there are children; a guarded receipt
always does (`[]` when there are none). One child still running after the
grace, or whose stop could not be established (`E_SESSION_UNAVAILABLE`,
`E_INSTANCE_RETIRING`, `E_LIFECYCLE_BUSY`, …), refuses everything: nothing is retired, exit 1,
`E_CHILDREN_RUNNING {childrenStopped}` (the text form names each child and its
`code`, always a [kernel code](#kernel-codes); the message says `still running after a bounded stop`
only of a child whose row lists processes in `stillRunning`, and `<child> could not be stopped
(<code>)` of any other, OATS 0.52.0). **`--force` does not bypass it**: `--force` covers incomplete
cleanup, not a running child. A `--self` retirement stops the children
recorded when it was scheduled that are still instances (a child retired in
between is skipped), in its detached completion before it stops the caller;
a refusal there leaves the caller's window and home in place and
writes `{ok: false, error: {code: "E_CHILDREN_RUNNING"}, childrenStopped,
retry}` to `resultPath`. Before 0.48.0 only a guarded apply stopped children.

**Guarded apply** (what the Desktop sends): `--plan-revision` and
`--idempotency-key` together.
- A used key replays its receipt as an **envelope** with `replayed: true`
  (receipts live beside the instances directory and outlive the home).
- The revision is checked against a fresh plan: `E_PLAN_STALE {plan}`. That
  plan is read once, when the retire holds the home's claim (below): it is
  the state the retire starts from, and one apply appends one
  `retire-planned` event. Against a retire in flight or a scheduled
  self-retire the answer is `E_LIFECYCLE_BUSY` and no plan is read, whatever
  the plan would read by then: a retire in flight has usually changed it (it
  stops the session of a launched instance before its hooks run). Before the
  claim an apply only replays a used key and resolves the home
  (`E_SESSION_UNKNOWN`, `E_AMBIGUOUS_INSTANCE`, `E_HOME_MISMATCH`,
  `E_UNIDENTIFIED_INSTANCE_HOME` for a home whose `instance.json`
  [cannot be read](#unreadable-record)).
- The children stopped are those of the revalidated plan, and a refusal
  carries it: `E_CHILDREN_RUNNING {childrenStopped, plan}`.
- A first guarded retire prints the raw receipt with `planRevision`,
  `idempotencyKey` and `replayed: false`.

<a id="retire-one-at-a-time"></a>
**One retire of a home at a time** (0.51.0, #863), **and one retire or stop**
(0.52.0, #866: a stop apply holds the same claim,
[above](#stop-claim)). Every retire that applies (plain,
guarded, `--self` and its detached completion; with `--server`, on the host)
holds the home's claim,
`<instances>/.oats-retirement/claims/<instance>.lock`, from the moment it
has resolved the home until it ends, by success or by any refusal or failure.
The claim is a file that names its holder by pid and start time, and by its
verb (`action`: `"retire"` or `"stop"`; 0.52.0). It is written whole to a
private file and linked into place, so a kernel's claim is never seen
without its `pid`: a file there that parses and names no pid was not
written by a kernel as a claim, and a kernel that wrote one without it would
be changing the lock format, which is a contract decision. It lies
beside the homes, never inside one: a home's bytes are what its retire
observes, copies and removes. A second retire of that home, or a retire that
meets a stop of it, does not wait: it
answers `E_LIFECYCLE_BUSY` at once (exit 1; the text form prints the
message), before it stops a session or a child, writes a recovery, runs a
hook or changes a file of the home. **`--force` does not bypass it**, and
`--plan` takes no claim and refuses nothing new. A guarded apply answers it
before `E_PLAN_STALE`: under the claim the answers come in this order: the
home is gone (`E_SESSION_UNKNOWN`), a self-retire is scheduled
(`E_LIFECYCLE_BUSY`), the plan is stale (`E_PLAN_STALE`), then the retire. A claim whose holder has
died, for example a retire killed while its hooks ran, is taken over by the
next retire of that name. So a killed retire can always be run again. A
holder that has exited or was killed and that its parent has not reaped (a
zombie) has died: its claim is taken over without waiting for that reap
(0.52.0, #870; before, the retire was refused as running until the reap). The
claim does not end what the killed retire left running: one of its retire
hooks may still be running when the next retire takes the claim over and
runs the hooks again (#865). Until
that name is retired again its claim file stays where it is, and it is safe
to remove once its pid is gone. A retire that ends removes its claim file;
the `claims/` directory itself stays, empty.

`details` is `{instance, home, lock, pid, since, action, holder}`: `lock` is
the file that names the holder, `since` when the holder took it, `action`
the holder's verb and [`holder`](#busy-holder) whether waiting ends it (both
0.52.0, feature `lifecycle-claim-stop`;
[Commands that meet on one home](#lifecycle-pairs)). Every message is one
line and says that nothing was done:

- A live holder (`holder: "running"`): `a retire of <name> is already
  running (pid <pid>, since <at>); nothing was done — wait for it to
  finish`; beside a stop, `a stop of <name> is already running …`, with
  `action: "stop"`.
- A holder whose start time cannot be read (where `ps` fails, or a claim
  that records none) is never taken for gone, and its claim is never taken
  over (`holder: "unknown"`). `details.unknown` is the reason. The message
  names the holder's verb, the pid, its recorded start, the reason and the
  way out: check that pid by hand, and if it is not that command (`oats
  retire`, `oats instance stop`), remove `<lock>`, then retry.
- A claim file that is not a readable claim is never removed: a file that
  does not parse, a directory, or a path that exists and cannot be read, such
  as a dangling symbolic link (0.52.0, #874: that one made the retire spin
  without end; it is now refused once its retries are spent, a quarter of a
  second for a retire, which does not wait).
  `details` is `{instance, home, lock, holder: "unknown"}`; the message is
  `<lock> is not a readable claim; nothing was done — inspect it and remove
  it if no oats retire or oats instance stop holds it, then retry`.
- A claim whose holder is gone and that this kernel cannot take over is
  never removed either: its `nonce` is not the 32 hexadecimal digits a claim
  carries (a file written or damaged by hand); or it is the claim of a
  takeover that died (`<lock>.reclaim-<nonce>`), at the end of a chain of
  them so long that the system will not name the claim of one more (each
  adds 41 bytes to the file's name: three to five on a file system whose
  names are 255 bytes at most). `details` is `{instance, home, lock, pid,
  since, action, holder: "none"}`, `lock` being the file the message names.
  The message is `the
  process that held <lock> (pid <pid>) is gone, and this file is not a claim
  this kernel can take over (<why>); nothing was done — inspect <lock> and
  remove it if no oats retire or oats instance stop holds it, then retry` (0.52.0, #874; before,
  the first was answered as a live holder, to wait for, and the second as
  `E_LIFECYCLE_FAILED` with the system's `ENAMETOOLONG` about a file that
  does not exist). Removing that one file lets the next retire take the
  rest over. A retire of a name that has no home leaves a file whose nonce
  is not a claim's as it is.
- The retire's own start time cannot be read, so it could not hold the claim
  verifiably: `details` is `{instance, home, lock, holder: "none"}`, and the
  message gives the reader's own reason (the `/proc` read, or what `ps`
  answered) and the check to run by hand in a shell on that host: `cat
  /proc/$$/stat` where there is a `/proc`; elsewhere `PATH=/usr/bin:/bin ps
  -o lstart= -o stat= -p $$`, which must print a start time and a state.
  Then the command again.

A scheduled self-retire counts from the moment it is scheduled. Its pending
marker (`pendingMarker`) records the completion process as `completionPid`
and `completionStart` (`null` when the start could not be read). While that
process lives, every other retire of the instance is refused the same way,
`--self --keep-dir` included: `a retire of <name> is already scheduled (its
completion, pid <pid>, requested at <requestedAt>); nothing was done — wait
for it to finish`, with `details.lock` the pending marker, `details.pid` the
completion and `details.since` the marker's `requestedAt`. A completion
whose start cannot be read is refused as a holder's is (`details.unknown`),
the file to remove being the pending marker. A second `--self` answers
`alreadyScheduled: true` only while the completion has not started. While
the first `--self` is still scheduling, or once the completion holds the
claim, it is refused the claim and answers `E_LIFECYCLE_BUSY` like any other
retire, where it answered `alreadyScheduled: true` before 0.51.0. The marker refuses nothing once its completion has
left its outcome at `resultPath` (it failed) or is gone (it died; a
completion that is a zombie, not reaped by its parent, has died: 0.52.0,
#870), nor when
it names no completion (a marker written before 0.51.0): `oats retire
<instance>` then retries the retirement, as before. The completion waits up
to 3 s for the retire that scheduled it to release the claim, then takes it
as any retire does; one that meets another retire still running is refused,
and records that at `resultPath` like any failed completion. The `error`
recorded there has the code and the message the same failure has as an
envelope: a kernel code, and what the retire had done by then.

A `--self` that cannot finish scheduling (the completion's log cannot be
opened, no process is created, the marker cannot be written) answers
`E_SELF_RETIRE_SCHEDULE_FAILED`, with `reached.phase: "before-effects"`. That
stays true after the answer: a completion this command had started is not
running when it answers (it is ended, unless it had gone by itself; a
completion does nothing to the instance before it holds the home's claim,
which the retire that scheduled it holds until it has answered), and its
log and any result it had recorded are removed. One leftover is possible and
is not a debt of the instance: a completion that was kept waiting for the
claim until it gave up may write its result (`E_LIFECYCLE_BUSY`) at the
moment it is ended, after that removal. The next `oats retire` of the
instance removes it. The instance is still live and can be retired
externally.

The home is resolved again once the claim is held. One that another retire
removed in between answers `E_SESSION_UNKNOWN`, as a retire of a retired
instance does. If the name is by then the home of another agent, the retire
starts over on that home, under that home's claim; after two such changes it
answers `E_LIFECYCLE_BUSY` (`the home of <name> changed while its claim was
being taken …; nothing was done — retry`, `details: {instance, home, lock}`).
A retire of a name that has no home also removes a claim of that name whose
holder is gone, left by a retire that was killed after it removed the home.

The claim orders the retires and the stops of a home (0.52.0, #866): `oats
instance stop --apply` takes it, and `oats worktree add` reads it
([Commands that meet on one home](#lifecycle-pairs)). `oats session start`
and `restart` do not read it yet, and `oats status` does not show a held
claim. Before 0.52.0 the claim ordered retires only: a stop was not refused
beside a retire in flight, and wrote into the home that the retire was
inspecting or removing.

Refusals (envelopes): `E_PLAN_STALE` (a guarded apply's revision, checked
under the claim: before any effect), `E_CHILDREN_RUNNING`,
`E_WORK_PRESERVATION_FAILED` (the home is kept; retry, or
`--discard-worktree` when it is `work/` that could not be re-homed: it does
not apply to an extra tree; also a guarded retire whose extra trees no
longer read as its plan said, after the hooks: review the fresh plan and
apply again), `E_RUNTIME_QUIESCE_FAILED` (the session's window could not be
shown gone; or the worktree hook process group an interrupted spawn left
survived SIGTERM and SIGKILL: end that group by hand, then retire again),
`E_WORK_INSPECTION_FAILED` (the home is kept; the
message names the entry or the state that could not be read, or the directory
Git reads as the top level of a `work/` whose `core.worktree` names another
one),
`E_SESSION_UNKNOWN`, `E_AMBIGUOUS_INSTANCE`,
`E_UNIDENTIFIED_INSTANCE_HOME` (a home with no `instance.json` and no cleanup
descriptor, or a rollback marker that cannot drive a retry, until `--force`;
a home whose `instance.json` [cannot be read](#unreadable-record), `--plan`
and `--force` included),
`E_NO_ROOT`, `E_LIFECYCLE_FAILED`, `E_LIFECYCLE_BUSY` (another retire of the
home is running or scheduled, or a stop of it is running, `--force`
included: one retire or stop of a home at a time, above; or, feature
`worktree-event`: the home is a spawn still running its `worktree` hooks, a
row with `spawnInProgress: true`, `--force` included; or one whose start time
cannot be read, a `rollbackIncomplete` row, until `--force`; or a hook or git
group whose leader's start cannot be read, until `--force`; every one is
answered before any effect and carries [`details.holder`](#busy-holder)). The
codes a retire answers only before any effect are
[one list](#before-effect-codes). A recovery whose Git status disagrees with
the source's carries `details: {home, statusDisagreement: {repo, rows: [{path,
source, recovery}], total}}` (the first 10 paths). Usage errors are text on
stderr, not envelopes.

<a id="retire-reached"></a>
**What a failed retire had done: `error.details.reached`** (feature
`lifecycle-kernel-codes`, OATS 0.52.0). Every error a
retire apply answers once it has resolved the home and holds its claim, a
typed refusal or not, carries it beside its other details. A client shows the
message and never parses it; this is the same statement as data. Gate on the
probe, never on the field: from a kernel that lists the feature an absent
`reached` means the error was answered before the retire of the home began
and nothing was done (below); from a kernel without it an absent `reached`
says nothing.

```json
{"phase":"after-hooks","sessionStopAttempted":true,"hooksStarted":true,"home":"kept",
 "recovery":{"path":"/w/agents/dev/instances/.oats-retirement/recovery/dev-1-Ab12Cd","phase":"before-hooks"}}
```

- `phase`: how far the retire got. `"before-effects"`: nothing of the
  instance was touched and no process was signalled (the first inspection
  is usually here).
  `"before-hooks"`: from the step that stops its recorded children on,
  whether or not that step had anything to signal (then the stop of its own
  session, the second inspection, the copy made before the hooks), until the
  hook runner is called. It begins earlier in one case: a home whose
  interrupted spawn left a worktree hook process group that the retire can
  prove is that spawn's has that group ended before the first inspection, and
  `phase` is `"before-hooks"` from the moment the retire may have signalled
  it. So `"before-hooks"` says neither that a process was signalled nor that
  the children step was reached; `"before-effects"` is never answered after
  a signal. `"after-hooks"`: from
  the call of the retire hooks on (the third inspection, the copy's
  conclusion, the extra trees and the worktree). `"removal"`: from the
  removal of the home on.
- **In the other four fields the untouched value is a guarantee, and the
  other value means only that the retire reached that step, which may not
  have completed.**
  - `sessionStopAttempted`: `false` = this retire sent no signal to the
    instance's session nor to any child's harness. `true` = it began to.
  - `hooksStarted`: `false` = no retire hook was started. `true` = the hook
    runner was called.
  - `home`: `"kept"` = the removal has not begun. Otherwise what is on disk
    when the error is answered: `"partial"` (the removal began and the
    directory is still there: it is no longer guaranteed to be a whole
    instance home) or `"removed"` (it is not there).
  - `recovery`: `null` = no copy of this retire whose manifest can be read.
    Otherwise `{path, phase}`: the absolute path of the copy, and the `phase`
    its `recovery.json` holds on disk when the error is answered
    (`"before-hooks"` or `"complete"`). A removal that fails after a complete
    recovery therefore names where the work is.
- Four points where a step was reached and its outcome is not established:
  the hook process group an interrupted spawn left was signalled and did not
  end (`E_RUNTIME_QUIESCE_FAILED`; `phase: "before-hooks"`, and
  `sessionStopAttempted: false`: that group is no session);
  the kill of the session's window was sent and the check that the window is
  gone failed (`E_RUNTIME_QUIESCE_FAILED`; `sessionStopAttempted: true`, and
  the harness may still run); a child's stop that signalled its harness and
  then failed, or failed while signalling (`sessionStopAttempted: true`); the
  hook runner throwing part-way (`hooksStarted: true`, and some hooks may not
  have run).
- `phase`, `home` and `recovery.phase` are closed lists. A reader treats a
  value it does not know as "effects may have happened".
- It is absent from the answers given before the retire of the home begins,
  where nothing was done: a name that resolves to no home, to several or to
  another one, the claim, a scheduled self-retire, a guarded apply's plan
  (`E_PLAN_STALE` with `details.plan`). It is not part of a plan.

**An error that is not the kernel's** (a file the system refuses to read, a
directory that cannot be removed) is answered with a
[kernel code](#kernel-codes), [`details.cause`](#kernel-codes), `reached`, and
a message that ends with the sentence the typed refusals at that point carry:

| Where it fails | Code | The message ends with |
|---|---|---|
| before the home's retire begins (the resolution, the plan a guarded apply reads) | `E_LIFECYCLE_FAILED`, no `reached` | `Nothing was done: <instance> is not retired.` |
| the claim cannot be taken (its directory cannot be made, its file cannot be written) | `E_LIFECYCLE_FAILED`, no `reached` | `the claim <path> could not be taken (…); nothing was done` |
| an inspection of the home or the work meets an entry it cannot read, or one that is gone when it is read | `E_WORK_INSPECTION_FAILED` | the sentence of its phase: `Nothing was stopped, run or removed.` (or, once it has signalled the hook group an interrupted spawn left, `The worktree hook process group <pgid> that an interrupted spawn left was ended; no session was stopped, no retire hook was run and nothing was removed.`, with `was signalled and may still run` when it is not seen to have ended); `No retire hook has run and nothing was deleted: <instance> is not retired and its home and work are kept; …`; `The retire hooks have run; the home, its work and the pre-hook recovery (if any) are kept; …` |
| anything else before the removal | `E_LIFECYCLE_FAILED` | the sentence of its phase; once the retire has begun to remove or re-home trees, `The retire hooks have run; the home is kept, and so is any recovery the retire wrote; …` and what it has already done with them |
| the removal of the home (a directory that is written into while it is removed, or that cannot be emptied) | `E_LIFECYCLE_FAILED`, `reached.home: "partial"` | `<instance>: the directory at <home> could not be removed: … The retire hooks have run; its recovery (complete) is at <path>; its retired event is recorded; what is left at <home> may not be a whole instance home; …` |

`E_WORK_INSPECTION_FAILED` is answered only by a retire, only before the
removal begins, and only with the home kept (`reached.home: "kept"`). A
typed refusal keeps its code, its details and its own words; the inspections'
and the recovery's refusals end with the sentence of their phase, once.

## Sessions and launch configurations

### Input

```text
oats session input --home <abs> [--text-file <path>] --json
```

Input bytes come from stdin or the named file. The existing version-1 success
answer is `{schemaVersion: 1, ok: true, result: {home, backend: "tmux",
present: true, state, paneId, submitted: true, verified}}`. Session input runs
on the execution host, including when the wake broker invokes it there;
`--server` is not supported for input. The adapter sends one literal
bracketed paste and one Enter after the existing input/authority/target checks.

`submitted` means terminal-operation success, **not model acceptance or
processing**. `verified` is display observation only: `true` means a bounded
look changed, possibly because of unrelated output or a dialog; `false` means
unchanged, unreadable or exhausted observation. False never authorizes retry
and is not proof of a pending draft or absence of effects. No `reason` is
emitted; the `enter-not-taken` result from 0.39.4 is removed.

Read-only settling before Enter shares one monotonic 2-second budget starting
when paste returns; up to two post-Enter looks share a 1-second budget. Probe
timeouts and sleeps use the remaining budget. Observation failures produce
`verified: false`, not input errors or extra keys. The original paste/key
command timeouts and `E_SESSION_INPUT_FAILED` errors remain; the observation
budgets do not bound those commands, failed buffer cleanup or OS scheduling.
No busy-pane submission or exactly-once guarantee is provided. Generic command
errors can still be uncertain after partial effects.

The Desktop terminal's authorized PTY writes are a separate stream; they do not
consume this `verified` field. The Pi bridge does not interpret this result.
Scheduler wake still records a nonthrowing input operation as delivered without
adding acceptance/history fields. Actual broker acknowledgement and retry
policy require their own consumer qualification; this result is not a native
harness receipt. See [execution targets](execution-targets.md).

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
- The kernel adds one warning of its own, in the same array and as
  the same event: when the start had to create the window again and created
  it on a tmux server other than the one the home recorded, the line names
  the instance, the old socket and the new one (each as a JSON string).
  `target.socket` is then the new socket
  ([execution-targets.md](execution-targets.md#existing-instances)).
- A start or restart appends a `launched` event as soon as its session
  exists (0.40, `phase: "start"` or `"restart"`, `startId`), the session
  boundary that voids earlier waiting claims ([Waiting on you](#waiting-on-you)).
  A start whose metadata write failed has it already, so its adoption adds
  none to a log that holds it and copies it into a log that does not.
- Restart is one command: the kernel validates the new selection before
  stopping, and owns the stop, lock, launch recovery and metadata. Never
  restart by retiring and spawning.
- Launch recovery (0.44.0). A start keeps its launch receipt in the home
  until the next start replaces it. The next start **adopts** a receipt only
  for a start `instance.json` does not record (one whose metadata write
  failed): it records that target and launches nothing again. A receipt for
  a start `instance.json` already records, on the target it records, is
  **completed**, and none of it is recorded again: a newer launch recipe or
  provider metadata stays. A plain start then answers `E_SESSION_RUNNING`
  while that target runs, writing nothing and running no hook; a restart, or
  a start after the target is gone or the harness exited, starts from
  `instance.json` as it is, and its own receipt replaces the old one. A
  receipt that names the recorded start on another target is ambiguous:
  `E_SESSION_UNKNOWN`, the receipt kept, nothing started. The message names
  that target and the way out: stop it, then `oats session restart`, which
  goes ahead once that target no longer runs. Never edit or remove a receipt by hand.
- A recorded tmux socket file that is missing while a process works in the
  home, or the process scan cannot run, is not a stopped server:
  `E_SESSION_UNKNOWN`, nothing started and no server created at that path
  ([#624](execution-targets.md#missing-socket)).
- A lost response does not mean the launch failed: check status before a
  retry. A remote home's saved route names its execution host.
- Errors: `E_BAD_ARGS`, `E_SESSION_UNKNOWN`, `E_UNSUPPORTED_MODE`,
  `E_UNIDENTIFIED_INSTANCE_HOME` (the home's `instance.json`
  [cannot be read](#unreadable-record): nothing was started, `start` and
  `restart`),
  `E_SESSION_START_BUSY`, `E_INSTANCE_RETIRING`, `E_LAUNCH_*` (among them
  `E_LAUNCH_SHIM`: the home's `oats` link cannot be written, nothing was
  started), `E_MODEL_UNKNOWN`, `E_UNSUPPORTED_HARNESS`, `E_SESSION_FAILED`
  (any error that is not the kernel's, with
  [`details.cause`](#kernel-codes)).

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
                    "model":"opus","yolo":null,"default":false,"source":"/w/oats-local.yaml","shadows":[]}]}
```

- **list**: `selected` is `null`, `{home, instance}` or `{soul, agentsRoot}`;
  `level` and `file` are `null` without an `oats-local.yaml` (the set is then
  empty). An environment literal is `{redacted: true}`, a reference
  `{fromEnv}`; values never leave the file. `default` (0.32, feature
  `launch-config-default`) is always a boolean: `true` marks this host's
  default for the configuration's harness.
- **set**/**remove**: `{name, action, level, file, before, after,
  effective}`. `set --file` takes `{harness, executable?, args?, env?, model?,
  yolo?, default?}` (`-` reads stdin); it replaces the whole entry and refuses
  a key it does not know, so an editor sends `default` back to keep it.
  `default: false` is written as its absence. A second `default: true` for a
  harness is `E_LAUNCH_CONFIG_INVALID` with `details: {harness,
  configurations: [<the declared one>, <this one>]}` and nothing is written;
  moving the default is two writes, never an automatic move. `--keep-env`
  keeps the declared environment when `env` is omitted. Routed with
  `--server`, a definition with `default: true` to a host that does not
  advertise `launch-config-default` is `E_REMOTE_INCOMPATIBLE` before
  anything is sent (`default: false` is dropped). Errors: `E_LOCAL_MISSING`,
  `E_BAD_ARGS` (including `--home`/`--soul`), `E_LAUNCH_CONFIG_UNKNOWN`,
  `E_LAUNCH_CONFIG_INVALID`, `E_CONFIG_BROKEN`, `E_HOME_UNKNOWN`,
  `E_REMOTE_INCOMPATIBLE`.
- **preview** (read-only) answers `{context, selected, selection: {source,
  launchConfig, harness, model, yolo}, harness, model, modelSource, yolo,
  launchConfig, launchConfigSource, launchConfigDefault, executable: {path,
  declared, resolvedFrom}, argv, environment: [{name, fromEnv} | {name, redacted:
  true} | {name, reference: true}], command (redacted), prompt, hooks,
  preflight: [{check, ok, detail}], ok}`.

`launchConfigDefault` (0.32) is `true` when `launchConfig` is this host's
default for the harness rather than a chosen configuration; the spawn preview
carries the same top-level field, `instance.json` records it as
`launch.launchConfigDefault: true`, and `inspect --json` of a home answers
`instance.launchConfig` and `instance.launchConfigDefault`. The closed `Launch`
object is unchanged: its `effective.launchConfig` names the default
configuration.

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
oats schedule update <id> --description=<text> [--dir <d>] --json
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
- `update <id> --description=<text>` without `--file`/`--spec-json` (feature
  `automation-descriptions`) changes only a local schedule's description,
  any kind's (a command schedule too), and is allowed while the job runs or
  has an unresolved attempt. `--description=` (empty) removes it. It answers
  `{schedule}` (the row `show` answers). A workspace schedule refuses
  `E_AUTOMATION_WORKSPACE`; out of the rule is `E_SCHEDULE_INVALID {field:
  "description"}`. Run it as argv, without a shell, always in the `=` form.
  An older kernel refuses it as a missing `--file`.
- **A readable row**: the definition (`id, kind, cron, tz, enabled, …`, and
  `agent/task/purpose/harness` for a spawn, `argv/cwd` for a command, the
  message for a wake, the operation for an operation) plus `scope,
  scheduleApi, scheduleHistoryApi, executionStatus, nextRun, lastRun, history,
  recentRuns, running, attempt?, pendingWake?` and the
  [shared row fields](#automations-shared-rows).
  `executionStatus` is `{kind: "legacy" | "invalid", capture: "unknown",
  migrationRequired: true, reason?, intent?}`; only `legacy` runs.
- **`attempt`** (present while a launch has no recorded result; reconcile
  resolves it): `{scheduledFor, startedAt, wallClock, error?, exited?,
  exitStatus?, exitSignal?}`. `error` (0.40.0) is the first run's cause. A
  `command` or `operation` attempt with `exited: true` (0.40.0) holds no host
  slot (`running: false`) but still blocks its own job; show it as needing
  `oats schedule reconcile <id>` (or `--clear`) either way.
- **Schedule IDs**: local and workspace schedule definition names permit 1–100
  lowercase letters, digits and dashes; trigger names retain their 40-character
  limit. Desktop accepts these schedule names for creation, editing and row
  actions (enable, disable, test, run and reconcile), including qualified IDs.
  A spawn's derived instance name still has a 64-character limit.
- **`description`**: the [shared row field](#automations-shared-rows).
  Desktop preserves it unchanged through edits to timing and other fields.
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
oats trigger list | show <id> | status [<id>] | test <id> [--run-source] | poll <id> --run-source [--max-age <s>] | add (--file <json> | --from <package>:<template> [--set k=v]) [--description=<text>] | update <id> --description=<text> | enable <id> | disable <id> | remove <id> --json
```

Event-driven spawns. Local definitions live in `oats-schedules.json` (`kind:
"trigger"`). A trigger's source is the built-in `github.pull_request` or, with
feature `trigger-sources`, `<capability>:<source>`, a source a
capability declares ([schedules.md](schedules.md#capability-sources)).

- `list`: `{triggerApi, scope, host, snapshot, triggers, scheduler}`.
  `show`, `add`, `update`, `enable`, `disable` → `{trigger}`; `remove` → `{removed,
  live: [instance]}`. A stored definition that no longer validates carries
  `invalid: {code, message, field?}`.
- **A trigger row**: the [shared row fields](#automations-shared-rows) plus
  `kind: "trigger", on, spawn, template?, enabled, triggerApi, scope,
  createdAt, updatedAt`.
  - `id` is always qualified (`local/<id>` or `<member>/<id>`); verbs accept
    `local/<id>` or a bare local id.
  - `on`: `{source: "github.pull_request", repo, events: [opened | reopened |
    ready_for_review | labeled | synchronize], labels, base?, poll}`, or for a
    capability source `{source: "<capability>:<source>", params: {<name>:
    <string>}, events: [<the source's event names>], poll}`.
  - `spawn`: `{soul, purpose, task, teams, launchConfig?, harness?, model?,
    yolo?, backend?}`. `purpose` and `task` template over `{repo}`,
    `{number}`, `{url}`, `{event}`, `{trigger}`, `{headSha}`, `{subject}` and
    `{key}`; a capability source's over `{trigger}`, `{source}`, `{subject}`,
    `{event}`, `{key}`, `{url}` and `{fields.<name>}`. `teams` are
    distinct labels passed as `--provider <messaging cap> join=<labels>`; a
    soul without messaging refuses `E_TRIGGER_TEAMS {soul, teams}`.
  - `template?`: `{package, version, commit, template}`.
  - `lastRun`: `{at, instance, home, event, number, subject, key}`
    (`subject`, 0.49.0: the event's subject, a PR's number as a string;
    for a run recorded before 0.49.0, its number; a capability source's
    run has `number: null`); `nextDue`: the next poll here, `null` before
    the first.
  - `invalid?`: `{code, message, field?}` when the stored definition no
    longer validates, as before. A capability source's trigger whose last
    meaning check failed at a poll carries `invalid: {code, message, field?,
    at}` instead (`code` `E_TRIGGER_SOURCE` or `E_TRIGGER_INVALID`; `at` when
    the check ran), until a good poll. `invalid` always means the trigger
    itself is invalid; an event the source answered badly is an *invalid
    event* (`invalidEvents`).
- `status [<id>]` → `{triggerApi, scope, triggers: [{id, name, enabled,
  runsHere, reason, enabledHere, repo, soul, concurrency: {max, perKey},
  liveCount, live: [{instance, home, repo, number, subject, event}], lastPoll:
  {at, ok: true, prs, matching} | {at, ok: false, error} | null, nextPollAt,
  nextDue, pending: [{key, event, number, subject, url, observedAt}], fired:
  [{key, at, instance, home, event, number, subject}] (newest 50), firedTotal,
  lastError: {at, code, message, key?} | null}]}`. It writes nothing.
  `subject` (0.49.0) is the event's subject, the thing `perKey` counts: a
  PR's number, as a string. A record written before 0.49.0 has none, and
  its number is reported.
- **A capability source's `status` row** (feature `trigger-sources`) has
  `repo: null`, `number: null` in `pending[]`, `fired[]` and `live[]`, and
  adds `source: {capability, name}`, `invalidEvents: [{text, rule}]` (the
  last good poll's, at most 20; `rule` is `shape`, `unknown-key`, `key`,
  `subject`, `event`, `url`, `fields` or `duplicate-key`, `text` the first
  200 characters of the event's JSON), `skipped: [{subject, why}]` (the last
  good poll's, at most 100) and, when its last meaning check failed,
  `invalid: {code, message, field?, at}`. Its `lastPoll` is `{at, ok: true,
  events, invalidEvents, skipped, filtered}` (counts) or `{at, ok: false,
  cause, error, source?}`, and `lastError` may carry the same `source`.
  `cause` is `exit`, `result`, `too-many-events`, `timeout`, `refused` or
  `resolution`; `source: {code, message?}` is the source's own refusal.
  `why`, `source.code` and `source.message` are the source's untrusted text,
  capped (200, 128, 500 characters) with control, separator, bidi,
  invisible and tag characters replaced by U+FFFD: render them as text,
  marked as the source's.
  - **Presence and staleness.** `source`, `invalidEvents` and `skipped` are
    always present on a capability source's status row. The two lists are
    `[]` until the trigger's first good poll and hold the last good poll's
    lists after that. A failed poll (`lastPoll.ok: false`) and a failed
    meaning check (`invalid`, which leaves `lastPoll` as it was) leave them
    unchanged, so they can be older than `lastPoll.at`, `lastError.at` and
    `invalid.at`. The lists are the current source's: changing a trigger's
    `on.source` empties them and `pending`, and clears `invalid`, `lastPoll`
    and `lastError` (`fired` stays), in what `status` and `list` answer at
    once and in the state at the next tick.
  - **Arrays versus counts.** In `trigger test`'s `source` (`ok: true`) and
    in `trigger poll`'s answer, `events`, `invalidEvents` and `skipped` are
    arrays and `filtered` is a count. In `lastPoll` (`ok: true`) and in the
    tick's `polled` row, all four are counts.
- `test <id>` → `{triggerApi, id, ok, placement: {runsOn, owner, host,
  runsHere, reason, detail?, enabledHere}, gh: {ok, account,
  credentialSource, reachesHostTimer, note, detail}, repo: {key, readable,
  fullName, permissions: {push, maintain, admin}, canMerge} | {key, readable:
  false, error}, soul: {resolves, name, agent, messaging} | {resolves: false,
  name, error}, teams: {requested, undeclared | null, messaging}, wouldFire:
  [{key, repo, number, subject, event, url, instance, nameCut, held?}],
  pollError?, problems, warnings, spawned: false}`. `ok` counts `problems`
  only; a credential the host timer cannot reach is a warning. `instance`
  and `nameCut` (0.49.0) are the name the spawn would be asked to derive
  (`<stem>-<purpose as passed>`, before spawn's `-<n>`) and whether its
  purpose was cut to fit ([schedules.md](schedules.md#triggers)); both are
  `null` when the soul does not resolve or its name is too long for a
  triggered spawn (that error is then in `problems`).
- **`test <id> --run-source` of a capability source's trigger** runs the
  source (it executes the capability's source command, whatever the host's
  trust and `runsOn` say, and so only with the flag: see **`--run-source`**
  below) and answers `{triggerApi, id, ok, placement, gh, repo: null,
  soul, teams, source, wouldFire, problems, warnings, spawned: false}`, no
  `pollError`. `gh` is `null` unless the trigger has an `owner` (then as
  above, for the owner's host). `source` is `{capability, name, ok: true,
  events, invalidEvents, skipped, filtered}`, `{capability, name, ok: false,
  filtered: 0, invalid: {code, message, field?, at}, events: [],
  invalidEvents: [], skipped: []}` when its meaning fails, or `{capability,
  name, ok: false, filtered: 0, cause, error: {code, message}, source?,
  events: [], invalidEvents: [], skipped: []}` when the poll fails.
  Without `--run-source`, `test` answers a trigger whose meaning or
  resolution fails as above (exit 0, `source.ok: false`: no capability code
  runs to say so), and a trigger whose meaning holds with
  `E_TRIGGER_SOURCE_RUN`. `wouldFire` rows are `{key, subject,
  event, url?, instance, nameCut, held?}`. When the tick would not run the
  trigger here, `problems` holds `run manually with --run-source; the tick
  will not run it here: <reason>` (with the placement's detail). `warnings` always holds
  "this source's credential may not be visible to the host timer: it runs
  with only PATH and OATS_HOME_DIR set, so keep the source's login in its
  own store, not in an exported variable".
- **`poll <id> --run-source`** (feature `trigger-sources`) runs a capability
  source's trigger's source once, its meaning checked first, and answers
  `{triggerApi, id, source: {capability, name}, events: [{key, subject,
  event, url?, fields}], invalidEvents: [{text, rule}], skipped: [{subject,
  why}], filtered}`, plus `observation` with `--max-age`. `events` are the
  valid events the trigger selects, `key` as the source wrote it (stored
  prefixed `<trigger>:`); `filtered` counts the valid events whose `event`
  the trigger does not select. It records nothing and spawns nothing, but it
  executes the capability's source command. A failed poll is `E_TRIGGER_POLL`
  with `details: {cause, source?}`; a meaning failure is `E_TRIGGER_SOURCE`
  `{capability, source, pointer?}` or `E_TRIGGER_INVALID {field}`; without
  the flag it is `E_TRIGGER_SOURCE_RUN`; a `github.pull_request` trigger is
  `E_BAD_ARGS`, with or without the flag. Without `--max-age` it observes
  the members live.
- **`--run-source`** (feature `trigger-sources`): by hand, `test` and `poll`
  run a capability source's command only with this switch (it takes no
  value). It is caller intent, never trust consent: with it they run the
  source whatever the host's `automations.trust` and the trigger's `runsOn`
  say, and trust, `runsOn` and `owner` gate the tick exactly as before (the
  tick passes the flag to its own child). Without it, on a capability
  source's trigger: `E_TRIGGER_SOURCE_RUN`, `ok: false`, a non-zero exit,
  `details: {capability, source, flag: "--run-source"}`, and a message
  naming the command to run again (`oats trigger test|poll <id>
  --run-source`), and the trigger's `runsOn` when that is another host: it
  holds only the id, the capability and source names and `runsOn`, never
  text of the source's. Nothing of the capability has executed and nothing
  has been written in the deployment, the soul's copy under `agents/` and
  the capability's directory in the module store included. The
  order is fixed: a valid definition (`E_TRIGGER_INVALID`), then its meaning
  and the soul's resolution (`E_TRIGGER_SOURCE`, `E_TRIGGER_INVALID
  {field}`, `E_TRIGGER_POLL` `cause: "resolution"`), then this gate, then
  the run. On a `github.pull_request` trigger the flag is accepted and
  inert: `test` answers byte for byte the same.
- **What a `triggerApi: 1` reader sees.** `triggerApi` stays 1. `on.source`
  is an open string: tell rows apart by it, and gate on `trigger-sources`.
  The keys above (`source`, `invalidEvents`, `skipped`, a meaning failure's
  `invalid`, `test`'s `source`) appear only on capability-source rows and
  are absent, not `null`, on a `github.pull_request` row, whose outputs are
  exactly as before. On a capability source's rows the PR-only fields are
  `null` (`repo`, `number`) or absent (`on.repo`, `on.labels`, `on.base`,
  `wouldFire[].repo`), and `lastPoll` carries the counts above instead of
  `prs` and `matching`.
- A triggered instance records `instance.json.trigger`: `{id, key, source,
  repo, number, subject, url, event, headSha, observedAt, eventFile}`
  (`subject` since 0.49.0; `null` when the event had none). Its event file is
  `OATS_TRIGGER_EVENT_FILE`: `{trigger, source, repo, number, subject, url,
  event, headSha, labels, observedAt, key}`. For a capability source the
  record has `repo: null`, `number: null`, `headSha: null` and adds `fields`,
  and the event file is `{trigger, source, subject, event, key, url?,
  fields, observedAt}`.
- `update <id> --description=<text>` (feature `automation-descriptions`)
  changes only a local trigger's description; `--description=` (empty)
  removes it. It sets `updatedAt` and leaves fired and pending events
  untouched. `<id>` is `local/<id>` or the bare id; a workspace trigger
  refuses `E_AUTOMATION_WORKSPACE`. Any other flag is `E_BAD_ARGS` ("only
  --description is supported for now"). An older kernel has no `update`.
- `add` of a capability source's trigger checks its meaning against the
  soul's resolution before anything is written (`E_TRIGGER_SOURCE`,
  `E_TRIGGER_INVALID {field}`, or the soul's own resolution error).
- Errors: `E_TRIGGER_INVALID {field}`, `E_TRIGGER_EXISTS`,
  `E_TRIGGER_UNKNOWN`, `E_TRIGGER_TEAMS`, `E_TRIGGER_SOURCE {capability,
  source, pointer?}` (a capability source that is undeclared or malformed,
  whose capability the soul does not compose, or whose command is not a file
  inside the capability; `pointer` is a JSON pointer into the manifest),
  `E_TRIGGER_POLL` (`details.cause` and `details.source` for a capability
  source), `E_TRIGGER_SOURCE_RUN {capability, source, flag}` (`test` or
  `poll` of a capability source's trigger without `--run-source`: nothing
  ran, nothing was written), `E_TRIGGER_FAILED`, `E_BAD_ARGS`, `E_PACKAGE_MISSING`,
  `E_PACKAGE_MANIFEST`, `E_LOCAL_MISSING`.

<a id="automations-shared-rows"></a>
### Shared row fields and workspace automations

Details: [schedules.md](schedules.md#workspace-triggers-and-schedules).

**Both lists** carry `host: {name | null, ghUser: {<gh host>: <login> |
null}}` (this machine's `host.name` and its `gh` logins, compared with a
row's `owner`), `snapshot: {takenAt, problems (a count)} | null` (the last
`oats sync` snapshot), and `scheduler: {installed, active, registered,
lastTick, maxConcurrent, triggersMaxConcurrent, …}` (nothing runs unless installed, active and
registered). `maxConcurrent` is the effective scheduled-job cap (default 5);
`triggersMaxConcurrent` is the separate trigger cap, or `null` for no host cap.

**Every row** carries:
- `id` (a local schedule keeps its bare id; a workspace item is
  `<member>/<id>`), `qualifiedId` (always qualified), `name` (the bare id).
- `origin`: `{kind: "local", path: "oats-schedules.json", url: null,
  localPath}` or `{kind: "workspace", repoKey, path, commit, url,
  localPath}` (`url` for `github.com` only; `localPath` `null` when the
  member is not cloned here).
- `description`: what it is for, in words, or `null`. One rule for both kinds
  and every level: one line of 1 to 200 characters with no control
  characters (no `\p{Cc}`, U+2028 or U+2029). A local item's comes from its
  definition; a workspace item's from its file header, and for a trigger made
  `from:` a package template, the template's when the header has none. A
  header out of the rule counts as none (the item still runs) and leaves a
  snapshot problem at `<path>#/description`. Like `task`, it is untrusted
  text: render it as text. A kernel before 0.43.0 (feature
  `automation-descriptions`) sends `null` for every local trigger and refuses
  a trigger `description`; one before 0.40.0 sends `null` for every local
  schedule too.
- `owner`, `runsOn`, `runsHere`, `reason` (`null` |
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
  `spawn-failed` (`key`, `code`, `error`), `would-fire` (`key`, `event`,
  `number`, `subject`, `url`, `instance`, `nameCut`; a dry run previews the
  soul as a tick does, and reports a preview failure or a name that cannot
  fit as `spawn-failed`), `invalid` and
  `not-here`. A capability source's trigger adds `poll-deferred`
  (`deadline`: its poll could not end by 50 s after the tick started; it
  goes first next tick), its `polled` carries `events`, `invalidEvents`,
  `skipped` and `filtered`, `poll-failed` a `cause`, `invalid` a failed
  meaning check, and its `would-fire` has no `number`, and no `url` when the
  event has none. A workspace schedule's state key is `<member>~<id>`. A failed
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

### `harness trust`

`oats harness trust [--dir <deployment>] [--harness claude|codex|all] [--plan] [--json]`
is host-local. Bare applies; `--apply`, remote selectors, unsupported harnesses,
unknown flags and extra positionals are `E_BAD_ARGS`. Default harness is `all`.
It uses the existing success/error JSON envelope. Result:

```json
{
  "operation": "harness-trust",
  "mode": "plan",
  "root": "/canonical/deployment",
  "entries": [{
    "harness": "claude", "file": "/native/.claude.json",
    "key": ["projects", "/canonical/deployment", "hasTrustDialogAccepted"],
    "current": null, "desired": true,
    "beforeDigest": null, "afterDigest": "sha256-hex", "status": "change"
  }],
  "audit": null,
  "warnings": []
}
```

Entry statuses are `change|unchanged|refused|applied|failed|incomplete|not-attempted`.
`current` contains only the known trust scalar, or null when missing. Codex's key
ends in `trust_level` and its desired value is `trusted`. Digests are raw-byte
SHA256 hex; missing files have null beforeDigest. Plan and unattempted entries
carry the candidate afterDigest. Failed/incomplete attempted entries carry the
last observed digest, or null for an absent/unverifiable file (a warning marks
unverifiable observations). The intent retains the candidate digest. Apply's audit is
`{path,operationId,status:"recorded"|"incomplete"}`. Override provenance is conveyed
in warnings, without native configuration contents.

Preflight failures use `E_CONFIG_BROKEN` with the result in details. Apply failures
use `E_HARNESS_TRUST_INCOMPLETE`, details `{...result,reason,mayHaveChanged}`;
reason is the closed set `locked|changed|audit|write|verify`. Partial writes are
retained. No existing instance-event envelope or lifecycle DTO changes.

Audit JSONL rows have `version: 1`, `kind: "harness-trust"`, ISO `at`,
`operationId`, `phase: "intent"|"outcome"`, harness, root, file, beforeDigest,
afterDigest and status.
Intent status is planned; outcome status is applied, unchanged, failed or
incomplete. See [native trust](harness-trust.md) for durability and race limits.
