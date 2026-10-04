---
name: git-tag-release
description: "OATS's release lane: the release workflow and scripts, how a tag becomes the kernel, adapter and Desktop releases, the runnerless lane, Desktop signing and acceptance, and OATS's artifacts and bump PR. Load it with /ship-release whenever you prepare, ship or verify an OATS release, or diagnose a partial tag-driven or runnerless release."
---

# OATS's release lane

`/ship-release` (from `oats.maintainer`) is the method: authority, exact source, gates,
tagging, the verify-release checklist and partial-publication rules. This skill is what
OATS's lane adds.

## The live contract
In an exact-commit checkout, read `.github/workflows/release.yml`, `docs/release-lane.md`,
`scripts/release-lane.mjs` and the tag's release notes.

- CI builds the exact tag SHA, and requires that it is on `main` and that
  `docs/release-notes/<tag>.md` exists.
- The tag version is derived into the root, adapter and Desktop manifests with
  `--allow-same-version`. A version already aligned is not an error, and doesn't justify
  reverting versions or retagging.
- The default tag workflow gates all build, test and smoke legs before publishing, then
  publishes the kernel, then the adapter, and creates the Desktop GitHub Release last.
- The runnerless lane's documented kernel-first exception is a separate, explicitly
  chosen release scope, not proof that the Desktop is ready. Use its recorded manifest and
  status, and keep its unfinished obligations.

## Gates specific to OATS
- `node scripts/release-lane.mjs status --tag <tag>` reports staged state; it can't prove
  a remote publication.
- The clean-room installed-artifact smoke (`npm run smoke:tarball`).
- **Desktop:** artifact inventory, native ABI and signature checks are not GUI use.
  Ad-hoc signing is not Developer ID signing or notarization, and a headless build smoke
  is not live GUI acceptance.
- **Runtime composition or knowledge changes** need the assigned installed-runtime and
  real-task evidence. A no-launch scaffold is not a model session or a learning test;
  lifecycle hooks may still run.

## OATS's artifacts
- npm: `@awebai/oats` (the kernel) and `@awebai/oats-pi` (the adapter), published in that
  order. `@awebai/oats-desktop` ships as the Desktop GitHub Release's assets, with their
  checksums.
- The workflow's last step opens the version-bump PR (root, pi and Desktop manifests) to
  `main`. It runs after publication: when it fails, both npm versions and the Desktop
  Release are already out, and the bump PR is opened by hand.
