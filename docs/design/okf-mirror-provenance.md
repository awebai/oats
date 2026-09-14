# Internal: finalizing the OKF mirror's source provenance

The standalone `oats.okf` distribution is authoritative. The framework's
`capabilities/oats-okf/` and `scripts/okf-source-inventory.json` are generated
mirrors, not authoring surfaces. This procedure does not publish the source,
accept a PR, update the catalog, commit, fetch, or change branches.

## Development versus publication

- `node scripts/check-okf-mirror.mjs --generate --source <standalone-repository>`
  captures current exported working bytes, including dirty/untracked files.
  It always records `release.status: pending`, null final refs and
  `published: false`, even when HEAD happens to have a published tag.
- `node scripts/check-okf-mirror.mjs --verify` uses only the checked-in inventory
  and mirror. No Git, clone, credentials or network is needed for either a
  pending or finalized inventory. It checks exact file sets (including empty
  directories), file bytes, portable Git executable modes, literal symlink
  targets, wrapper hashes, and consistent release metadata.
- `--verify-source --source <standalone-repository>` verifies pending snapshots
  against their exact recorded working state, including branch/dirty metadata.
  For published inventories it rechecks the immutable commit, payload, origin
  tag object and peeled commit, ignoring the recorded local branch name. The
  checkout must still be clean at the recorded accepted commit; renamed
  branches and detached HEAD are supported. This published-source check needs
  origin access. It does not depend on cached remote-tracking refs.

Offline verification is an integrity check of a reviewed checked-in inventory,
not independent proof that a remote still advertises a tag. The explicit source
check supplies that evidence. No boolean flag is a publication attestation.

## Post-publication command

Only after source review/merge and actual publication of `v2.0.0`:

1. Obtain the **accepted full merged commit ID** from the source review/release
   record. Do not substitute a mutable branch name, abbreviated hash, or whatever
   HEAD happens to resolve to. The legacy inventory field `finalMergedCommit`
   records this caller-supplied acceptance; Git cannot prove human PR approval.
2. Have a clean standalone checkout at that commit, with the published tag
   available locally and `origin` pointing to `awebai/oats-okf`. Fetch/check out
   deliberately through the parent release procedure; the checker never does it.
3. From the framework checkout, run:

   ```bash
   node scripts/check-okf-mirror.mjs --finalize \
     --source .agents/knowledge-rework/repos/okf \
     --final-tag v2.0.0 \
     --final-commit "${OKF_V2_ACCEPTED_COMMIT:?set the reviewed full merged source commit ID}" &&
   node scripts/check-okf-mirror.mjs --verify-source \
     --source .agents/knowledge-rework/repos/okf &&
   node --test test/okf-mirror-parity.test.mjs
   ```

   The relative source path above is the existing ignored work-view convention;
   substitute an explicitly resolved standalone repository path in other work
   views. The command must not be run while source acceptance is still changing.

4. Review the resulting payload/inventory diff, run the remaining release gates,
   then advance the catalog through the parent integration process. Finalization
   itself never touches the catalog.

`--finalize` requires both `--final-tag` and a full SHA-1/SHA-256 `--final-commit`.
It replaces only the mirrored capability and inventory, just like `--generate`,
but stamps `release.status: published` only after all checks succeed:

- The version tag is exactly `v<distribution version>`; HEAD is the explicitly
  accepted commit and Git reports a clean source tree. Masked index entries
  (`assume-unchanged`/`skip-worktree`) are not accepted.
- Actual exported files and wrappers match raw objects at that commit, not just
  Git status or filtered checkout content. Ignored exported extras, untracked
  empty directories, CRLF/filter changes, hidden byte changes, mode drift with
  `core.filemode=false`, and literal symlink-target differences fail closed.
  Git replacement objects are disabled. Published inventories also record and
  hash wrapper file modes; materialization preserves those modes and bytes.
- Exactly one effective origin fetch URL identifies the official source. The
  usual official GitHub HTTPS/SSH spellings are equivalent. URL rewrites to an
  unrelated repository are rejected. The remote query uses canonical public
  HTTPS with source-local Git configuration disabled, so local upload-pack/SSH
  overrides cannot fabricate its response. Prompts/helpers are disabled and
  Git commands have a bounded timeout.
- The local tag resolves to the accepted commit. A fresh `ls-remote` query must
  advertise the same tag object and the same peeled commit (or direct commit
  for a lightweight tag). Both annotated and lightweight tags are supported.
  Missing/unreachable origin, unpublished tags or mismatched refs fail closed.
- The source is checked again after staging the copy, before replacing the
  mirror or inventory. Failed acceptance checks leave both untouched. Ordinary
  filesystem failures during replacement are not a multi-file transaction.

The published record retains `source.head`, clean-state metadata, the branch
observed at generation (informational during immutable verification), the
accepted final tag/commit, `remote: origin`, and the exact `tagObject`. Thus
changing an annotated tag object without changing its commit still invalidates
`--verify-source`. Remote checks attest what was advertised when queried; they
cannot prevent an upstream tag from being moved later. Do not move released
tags, and re-run source verification at the release gate.

## Isolated regression coverage

`test/okf-mirror-parity.test.mjs` uses temporary source repositories and local bare
origins only, including tag creation/deletion/movement solely inside fixtures.
The JavaScript `finalizeOkfMirror`/`verifyOkfSource` APIs accept an explicit
`repository` expectation for these fixtures and record their real source
identity; the CLI cannot override the official repository. No tests publish to
GitHub. Checked-in mirror tests accept consistent pending **or** published
provenance, so finalizing the source does not require weakening those tests.
