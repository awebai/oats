---
name: git-tag-release
description: "Use when assigned to prepare or ship an OATS release, verify release artifacts, or diagnose a partial tag-driven or runnerless release."
---

# Release exact artifacts under explicit authority

Start read-only. Confirm the requested tag/version, immutable source SHA, permitted destinations and whether the task authorizes publication. This skill grants no push, merge, credential repair or protected-ref bypass authority.

## Read the live release contract

In the assigned framework checkout read `.github/workflows/release.yml`, `docs/release-lane.md`, `scripts/release-lane.mjs` and the tag's release notes. Inspect release and registry state before retrying anything. The script and workflow are the executable authority; record disagreements rather than improvising around them.

- CI builds the exact tag SHA and requires main ancestry plus `docs/release-notes/<tag>.md`.
- The tag version is derived into root, adapter and Desktop manifests with `--allow-same-version`. A pre-aligned version is not an error and does not justify reverting versions or retagging.
- The default tag workflow gates all build/test/smoke legs before publication, publishes kernel then adapter, and creates the Desktop GitHub Release last.
- A runnerless lane is available. Its documented kernel-first exception is a distinct explicitly selected release scope, not proof Desktop is ready. Use its recorded manifest/status and preserve unfinished obligations.

## Prepare and qualify

1. Pin the source, notes, package closure and release scope. Use an isolated clean export; do not reset a dirty shared tree to satisfy a gate.
2. Run the chosen lane's checks, locked tests, packaging and clean-room installed-artifact smoke. `node scripts/release-lane.mjs status --tag <tag>` reports staged state but cannot prove a remote publication.
3. For Desktop, distinguish artifact inventory/native ABI/signature verification from actual GUI use. Ad-hoc signing is not Developer ID signing or notarization; headless build smoke is not live GUI acceptance.
4. For runtime composition or knowledge changes, require the assigned installed-runtime and real-task evidence. A no-launch scaffold is not a model session or a learning test; lifecycle hooks may still run.
5. Record artifact digests, exact source/tag identity, executed gates and unrun host legs. Only then perform the separately authorized publication using the current lane or workflow.

## Partial publication

Observe exact registry versions, source/tag provenance and staged bytes before choosing recovery. Same-version retries can skip immutable npm versions already present; a skip by version alone does not prove those bytes came from this source. If identity/content is uncertain, stop for reconciliation. Never delete or move a published tag, overwrite an immutable version, or cut a patch merely to hide an unknown partial outcome.

A failed release/bump-PR step does not undo earlier npm publication. A same-tag asset retry must match the reviewed artifacts; `--clobber` is not permission to replace unknown content. Authentication, runner and protected-ref faults go to the operator. Verify publication and actual deployment separately, and report all outstanding acceptance gates.
