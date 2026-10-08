# Exact Library command contract

Verified with real aw 1.36.26/public `8d70c506` (upstream `873ed2bf`) against
the Library manifest v1/app 0.1.0, SHA256
`0019130d90bbbc61fde49c144b4f883eabac837889b0c69f515d206b35552329`.
Exact manifest bytes were used for local help; dispatch changed only the origin
to loopback with a synthetic LOCAL identity. This proves argv/serialization,
not service acceptance, grant admission or live readiness.

Every row is the suffix after `aw library` in the unchanged selected identity
context. `<private-json>` is a private UTF-8 JSON object file with the body
fields shown. `!` means required by the manifest schema. Supply those fields
even where the CLI accepts their omission. Path/query selectors remain flags;
putting them in the body does not fill a path or query argument. Include optional
fields only when appropriate to the authorized act. Rows describe syntax and
are not permission to perform mutations.

| Command suffix | Body fields (`!` required) | Access / effect |
|---|---|---|
| `list-blueprints [--tags <tag>]` | — | anonymous read; repeat --tags for multiple query values |
| `get-blueprint --blueprint_ref <ref>` | — | anonymous read |
| `get-profile --blueprint_ref <ref> --profile_ref <ref>` | — | anonymous read |
| `publish-blueprint --body-file <private-json>` | files!, schema! | signed; public publication |
| `register --body-file <private-json>` | owner, display_name | signed; team registration |
| `create-shelf-profile --body-file <private-json>` | files!, tags | signed; private creation |
| `shelf-version --profile_ref <ref> --body-file <private-json>` | files! | signed; private version |
| `update-from-source --profile_ref <ref> --body-file <private-json>` | target_version!, source_blueprint_version | signed; source merge/version or no-op |
| `import-to-shelf --body-file <private-json>` | source_blueprint_ref!, source_blueprint_version, profile_ref!, tags | signed; private import |
| `publish-profile --profile_ref <ref> --body-file <private-json>` | profile_version, blueprint_version!, target_blueprint_ref, new_blueprint | signed; public publication |
| `set-profile-tags --profile_ref <ref> --body-file <private-json>` | tags! | signed; replace profile tags |
| `set-blueprint-tags --blueprint_ref <ref> --body-file <private-json>` | tags! | signed; replace blueprint tags |
| `bind --agent_id <id> --body-file <private-json>` | profile_ref!, profile_version!, profile_digest!, source_blueprint_ref | signed; change association |
| `get-binding --agent_id <id>` | — | signed read |
| `shelf` | — | signed read |
| `materialize --body-file <private-json>` | agent_id, profile_ref, runtime_kind!, target! | signed; runtime output/local writes |
| `propose --body-file <private-json>` | target!, profile_ref!, content!, summary, rationale | signed; submit proposal |
| `proposals` | — | signed read |
| `approve --proposal_id <id>` | — | signed; approve and mint patch version |
| `reject --proposal_id <id>` | — | signed; reject proposal |
| `get-shelf-profile --profile_ref <ref> [--include files]` | — | signed private read |
| `delete-blueprint --blueprint_ref <ref>` | — | signed; irreversible all-version deletion |
| `delete-shelf-profile --profile_ref <ref>` | — | signed; irreversible profile/binding/proposal deletion |

Body types: `files` and `tags` are arrays; `content` and `new_blueprint` are
objects; all other listed body fields are strings. Preserve the exact underscore
names. The full nested `propose.content` schema requires the changeset schema
and nonempty assets described in [proposals](proposals-and-publishing.md).
The CLI does not supply complete service-level validation of canonical payloads.
No Library raw-body tool exists. Put Markdown inside a JSON string such as an
asset's `content_utf8`, not directly in `--body-file`.

JSON body files must contain a single object. Explicit body flags merge over
matching file values. Prefer a reviewed complete file to avoid accidental
overrides. Body array/object flags, if used, take JSON; query values behave
differently: `--tags a --tags b` emits `tags=a&tags=b`, while `--tags '["a","b"]'`
emits one literal JSON-looking query value. There are no integer parameters in
this manifest. No positional arguments or underscore-to-hyphen aliases exist.

## Errors and evidence boundaries

- `unexpected positional argument "…"`: use the named selector flag.
- `missing value for --…`: provide the selected value; do not change identity.
- `unknown flag --… for aw library …`: use the exact documented underscore name;
  inspect local help rather than guessing a replacement verb.
- `missing path param "…"`: supply its explicit path flag, not a body member.
- `--body-file for json-mode verbs must contain a single JSON object: …` or
  `… must contain a JSON object`: fix malformed/trailing JSON, a raw Markdown
  file or an array body. Preserve the private body; do not echo it in reports.
- `body param files: expected array (JSON): …` / `body param content: expected
  object (JSON): …`: repair the supplied array/object flag type.

The pinned negative control omitted BOTH `files` and `schema` from
`publish-blueprint` and reached loopback with an empty body. Those exact omissions
were exercised; they are not valid recipes. Source `internal/appmanifest/interpret.go`
(buildBody) skips absent body arguments, while `cmd/aw/plugin.go` uses required
metadata in help. A successful CLI parse or HTTP fixture response therefore
cannot establish complete required-field/schema validation or service acceptance.

For nonzero/uncertain service results, record the nonsecret status/code and
reconcile in the same selected context. Do not infer rollback, install/approve,
mint a replacement grant, probe signing authority, or retry using another seat.
