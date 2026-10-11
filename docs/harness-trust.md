# Explicit native harness trust

Run this command on the host where Claude or Codex runs, while other native
configuration editors are quiescent:

```sh
oats harness trust --dir /absolute/deployment --harness all --plan
oats harness trust --dir /absolute/deployment --harness all
```

`--plan` reads only. The bare command applies a fresh plan; there is no `--apply`.
The default harness is `all`, in Claude-then-Codex order. `claude` or `codex`
selects one. The deployment is resolved from the existing local command context,
including when invoked from an instance home, then canonicalized with the native
filesystem lookup. The result, native key, audit and reader verification use that
on-disk spelling, including on case-insensitive APFS. No remote
adapter, arbitrary file selector, parent-root substitution or harness launch is
performed. A native executable need not be installed to edit the qualified format.

The command writes only the canonical deployment root's native trust leaf:

- Claude: `projects[root].hasTrustDialogAccepted = true` in
  `$CLAUDE_CONFIG_DIR/.claude.json`, or `~/.claude.json`.
- Codex: `projects[root].trust_level = "trusted"` in
  `$CODEX_HOME/config.toml`, or `~/.codex/config.toml`.

It writes that leaf into every configuration file a launch of the deployment
reads. The targets of each selected harness are:

- the ambient file, selected by the operator's own `CLAUDE_CONFIG_DIR` or
  `CODEX_HOME`, else the default above;
- one file for each launch configuration (`launch-configs:` in the
  deployment's `oats-local.yaml`) of that harness whose `env` sets
  `CLAUDE_CONFIG_DIR` (claude) or `CODEX_HOME` (codex), as a literal or a
  `{fromEnv: NAME}` reference resolved from the environment the command runs
  in.

Targets with the same canonical directory are one file. Each plan entry says
whether it is the ambient file (`ambient`) and which launch configurations
use it (`launchConfigs`). A launch configuration whose reference is not set,
whose path is not absolute, or whose directory does not exist is a named
`problem` on its entry. OATS never creates a harness configuration directory:
create it, or start the harness with it once, then rerun. A missing ambient
directory (`~/.codex` for a user who has never run Codex, for example) means
the harness has not run as this user: with `--harness all` that harness's
entry is `skipped`, with its `reason`, and the other harness proceeds; naming
that harness (`--harness codex`) makes it a problem. Any problem refuses the
whole plan before a write, as an unsupported file does.
Each file is verified through the reader under the environment that selects
it.

Nonempty override directories must be absolute. Directory aliases are resolved;
symlink/nonregular/hardlinked leaves, foreign ownership and ACLs refuse. On Linux, GNU ls's single `.` security-context marker is accepted;
the context must be readable, match the same-directory candidate before replacement,
and remain unchanged at verification. A differing directory-default context refuses
before rename; OATS does not relabel files. This comparison narrows metadata races,
not the documented uncooperative-writer race. Tests simulate these SELinux probes;
they are not a live SELinux-host qualification.

On macOS, any extended-attribute (`@`) or ACL (`+`) marker deliberately refuses,
including `com.apple.provenance`. This v1 writer does not copy or remove those
attributes. Inspect the selected file; a refusal never authorizes stripping its
metadata automatically. Existing file permissions are preserved.
No configuration directory is ever created; a new file uses 0600. The plan shows the effective file,
semantic key, current/desired trust scalar, byte digests and override provenance;
it never returns other config values or credentials.

This explicit act is the exception to read-only launch trust checks. Spawning,
scaffolding, starting and retiring do not write native trust or create consent
records. Existing Codex root-trust/yolo per-invocation overrides are unchanged.
This command does not enable development-channel prompt consent, change permission
mode, authenticate, install a plugin, or establish model/channel readiness.

## Qualified scope and formats

Claude 2.1.289 darwin-arm64 was qualified against pinned native source and a
private no-Git deployment. One native root acceptance preceded two fresh child
launches. Root trust was true before each; neither child had accepted trust;
both reached ordinary UI. Native child bookkeeping later contained false.
Both bypass-mode controls in a separate disposable deployment still asked trust.
Native source independently walks trusted ancestors outside repository boundaries.
The recorded recipe and source exclude channel argv as a grant of trust. There
was no contemporaneous per-process environment snapshot; the same-runner root
trust question and absence of child recipe/capability bypass settings support
this bounded evidence. This is not qualification of other versions, nested Git
layouts or account/channel readiness.

Codex 0.160.1 native source independently declares a project `trust_level` and
writes `trusted`/`untrusted` under the project path. See the pinned
[native writer](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/core/src/config/mod.rs)
and [configuration type](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/config/src/config_toml.rs).
OATS's existing root-consent-to-exact-home invocation override remains separate
from native ancestor inheritance; Claude evidence is not Codex evidence.

JSON parsing rejects duplicate keys and wrong shapes. Only the required missing
object suffix or existing boolean token changes; unrelated large numbers, keys,
spacing and newlines remain byte-identical. False becomes true; an existing true
is a byte/mtime-preserving no-op.

The dependency-free TOML editor supports ordinary single-line assignments,
quoted/bare/dotted keys, explicit project tables, dotted trust keys and the
reader's inline project form containing only `trust_level`. It validates scalar,
single-line array and inline-table structure, duplicate/conflicting definitions,
and signed 64-bit integers. Multiline values, array-of-table headers, dates,
nondecimal numbers and unsupported representations refuse even if another TOML
parser accepts them. Root-level inline `projects` and inline project entries with
additional fields refuse rather than write a shape the existing readiness reader
does not consume. Comments, whitespace and line endings outside edit spans stay
unchanged. Untrusted becomes trusted; other trust values/types refuse. Both
editors validate the candidate and compare semantic trees with only the intended
leaf changed. Unsupported native format changes require refreshed qualification.

A Claude root entry cannot cover a home behind an intervening Git boundary.
Readiness may still warn after an unchanged root apply. Inspect that boundary;
do not automatically write a second root or answer a trust dialog.

## Launch-time checks and readiness

Spawn, `session start|restart`, `launch-config preview` and `oats readiness`
read folder trust from the file the launch's own environment selects: the
host's environment plus the launch configuration's `env`. Codex's
per-invocation home trust follows the same file. They never write it.

Readiness reports one `harness-trust` item (in `checks.configured`, never
required) for the launch a home recorded, or for the launch a soul selects.
It passes, naming the file, when that file trusts the deployment root or an
ancestor (for Claude, up to a Git boundary; a yolo Codex launch always
passes). Otherwise it warns, and the spawn warns with the same text:

```text
<harness> folder trust is not established in <file>: oats harness trust --dir <deployment>
```

A missing root entry does not prove that the harness will prompt (a native
gate can skip the question), so neither says the session will stop. A launch
configuration whose reference is not set on this host is named instead of a
file. OATS never answers a folder-trust prompt, and launch consent authorizes
no trust write.

## Durability, audit and recovery

All selected configs are preflighted before any native write. Cooperating OATS
writers acquire exclusive destination locks in canonical-path order plus an audit
lock. Existing locks refuse promptly. The human/JSON error message names the exact
lock path so an operator can inspect an interrupted apply; OATS never steals or
deletes another invocation's lock, even when it appears stale. Identity and
raw-byte digests are rechecked after locking and immediately before replacement.
Candidate files are exclusively created beside the destination, fsynced, atomically
renamed and verified through the existing trust reader. Native writers do not
honor OATS locks: final checks detect observed drift but cannot guarantee exclusion
against an uncooperative writer racing the rename. No native process is stopped.

The deployment-private `.agents/harness-trust.jsonl` is independent of instance
lifetime, alongside other private kernel events. Its new directory/file modes are
0700/0600. A checked, durable intent precedes each changed file; a checked outcome
follows it. An unchanged apply records an outcome without touching config bytes
or mtime. Plan creates no audit, directory, lock or temporary file. Invalid or
truncated existing JSONL refuses until operator inspection.

`all` is not a transaction. Failure stops later work, retains earlier changes and
reports unattempted entries; the error message names the failed files. Trust may already have been consumed, so no rollback
is simulated. Inspect the native files and audit before rerunning; a correct
existing entry converges as a no-op. `E_HARNESS_TRUST_INCOMPLETE` has closed reasons
`locked|changed|audit|write|verify` and a conservative `mayHaveChanged` flag.
An audit failure before a write prevents it; failure after a possible replacement
reports incomplete and preserves intent evidence. The command never claims that
failure means native trust was undone.

### Native qualification references

Claude source qualification used executable SHA256
`03d66745e3bb69ec727d66023696f3820bc0a00a8a5ba725eb6706d0c67cbe69`.
Its native exact/ancestor lookup is in byte range 182226330–182227750;
the startup trust decision is 197759244–197759315. The lookup has no
permission-mode or channel-argument input. Environment gates remain a separate
limit: `CLAUDE_CODE_SANDBOXED`, `IS_DEMO`, `CLAUBBIT` and the native `Le(false)`
gate can bypass the question. The disposable observation did not record a
contemporaneous child-process environment snapshot. No proprietary source is
included here.

Codex qualification is source-derived from `rust-v0.160.1`, independently of the
Claude observation. `set_project_trust_level_inner` (core config lines 2343–2410)
writes the exact project key and trust scalar; `ProjectConfig` (config type
lines 603–615) consumes the enum. The
[loader](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/config/src/loader/mod.rs)
uses exact normalized project lookup keys (lines 1030–1082), preferring canonical
path spelling (1370–1398). This qualifies the native representation; OATS retains
its separately tested invocation override instead of claiming universal native
ancestor inheritance. The source files' SHA256 digests are:

| Upstream path | SHA256 |
| --- | --- |
| `codex-rs/core/src/config/mod.rs` | `854f5a6b184714740500b8d3eae2bb04cb88172efccf11d38a74f2f6189c0341` |
| `codex-rs/config/src/config_toml.rs` | `453b5ed4d49cf3768ce47e1f2fe1987c92d694bba9b52373dcf10f15901ab9d1` |
| `codex-rs/config/src/loader/mod.rs` | `2ec85a665f827dd7080f8e562c960e49158b0d8a11b1022cc0a93eed05986d0c` |
