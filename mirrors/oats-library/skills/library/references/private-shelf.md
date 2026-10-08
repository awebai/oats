# Private shelf

All tools here use the selected identity and signed team access. Read
[seat and evidence](seat-and-evidence.md) first. Never use registration or a
shelf request as an authority probe. Registration mutates team state even
though the service describes it as idempotent.

For an authorized private read:

```text
aw library shelf
aw library get-shelf-profile --profile_ref <profile-ref>
aw library get-shelf-profile --profile_ref <profile-ref> --include files
```

`--include files` is a query flag and returns private content plus
`proposal_asset_digests` keyed by exact proposal paths. Keep that response in
the authorized private work area; do not paste it into coordination messages.

For a requested write, prepare a private JSON object containing only the
[body fields](commands.md). Review its target and content, then use the selected
command. The JSON file cannot supply a path or query selector.

```text
aw library register --body-file <private-json>
aw library create-shelf-profile --body-file <private-json>
aw library shelf-version --profile_ref <profile-ref> --body-file <private-json>
aw library update-from-source --profile_ref <profile-ref> --body-file <private-json>
aw library import-to-shelf --body-file <private-json>
aw library set-profile-tags --profile_ref <profile-ref> --body-file <private-json>
aw library set-blueprint-tags --blueprint_ref <blueprint-ref> --body-file <private-json>
```

Import copies a public profile onto the team's private shelf. Re-import is
idempotent per source profile and returns the existing copy unchanged; it is
not an update recipe. `shelf-version` creates a content version.
`update-from-source` performs a per-part three-way merge: it pulls upstream
changes into unmodified parts and retains local edits. Supply `target_version`
and optionally `source_blueprint_version`; inspect the result for a real merge
versus no-op. Use returned refs/versions, never assume a next version number.
Tags replace the organizational tags; review the complete intended replacement.
Blueprint tags act on public catalog metadata and require that specific authority.

Keep file payloads in the canonical Library profile/import format chosen by the
caller; a `files` array alone is not proof of a valid profile. CLI parsing does
not validate the complete service schema or enforce required body fields.
On uncertain writes, use the relevant readback in the same selected context
before considering replay. Do not treat a private shelf write as consent to
publish, bind, materialize or approve a proposal.
