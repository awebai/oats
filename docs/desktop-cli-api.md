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
- `declarations: { requires, defaults, knowledge, teams, resources }` — each
  the declared object, or `null` when the section is absent.
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

No forge (PR/checks/reviews) data here: that is the `oats.forge` capability seam (P1 decision).

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
