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
Desktop 0.22 accepts `desktopApi === 1` and semver `>=0.22.0 <0.23.0`.

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
| `work`     | string          | work mode (worktree/checkout/attached/workspace) |
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

### `oats okf harvest --json`

Run with cwd fixed to the resolved instance home. `result` is one of:

```json
{"harvest":"spawned","instance":"memory-harvest-<slug>","window":"memory-harvest-<slug>"}
{"harvest":"skipped","reason":"no pending notes"}
```

Failure: `{"schemaVersion":1,"ok":false,"error":{"code":"E_HARVEST_FAILED","message":"..."}}`
with exit 1. Skip reasons are human-readable strings (loop guard, no notes,
no root, no identity, harvester already running, workspace-mode soul not in a
git repo).

Contract tests / canonical fixtures: `test/cli-json-contract.test.mjs`.
