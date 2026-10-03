---
name: ship-release
description: Ship a planned release as exact artifacts under explicit authority - pin the source, read the project's live release contract, tag, let the release run - then verify the publication item by item with the checklist, and handle a partial publication without hiding it. Use before and after any tag, and when diagnosing a release that half-ran.
---

# Ship a release

Start read-only. Confirm the version and its plan (`/plan-release`), the exact source SHA
(on the default branch, reviewed, CI green), where it will be published, and whether you
have the authority to publish (your task or your human, with that scope). This skill grants
no push, merge, credential or protected-ref authority.

## Read the live release contract
Read what actually runs the release: the release workflow, its scripts, and the project's
release docs or release skill. The executable is the authority; where the docs disagree
with it, record the disagreement instead of improvising around it. **Get a broken release
step fixed in the project** instead of working around it by hand, release after release: a
small fix to the workflow is release-prep you may do yourself; anything larger goes to the
expert who owns the release tooling.

## Prepare
1. Pin the source SHA, the release notes for this version, and the scope (which artifacts,
   which channels).
2. Work from a clean, isolated checkout of that SHA. Never reset a shared, dirty tree to make
   a gate pass.
3. Run the gates the release contract requires, and record what ran and what didn't
   (a platform you can't build here, a manual acceptance step).

## Tag and publish
- Tag the exact SHA (an annotated tag, if your project uses them), then let the release run
  as the contract says. If publishing is a separate, explicitly authorised step, do it only
  with that authority.
- Watch the release to its end; don't report "released" when the tag is pushed.

## Verify
Go through [references/verify-release.md](references/verify-release.md) item by item, and
report what you **observed**, with identifiers: versions, commits, digests, URLs. "No
errors" is not verification.

## Partial publication
- Observe what was actually published (versions, their source commits, their contents)
  before choosing how to recover.
- A failed later step doesn't undo earlier publication. A retry that skips a version that's
  already published doesn't prove that version came from this source: check it.
- Never delete or move a published tag, never overwrite an immutable version, and never cut
  a patch just to hide an unknown partial outcome. Reconcile first; when identity or
  content is uncertain, stop and report.
- A same-name re-upload must match the reviewed artifacts byte for byte; a "replace"
  flag is not permission to replace unknown content.
- Authentication, runner and protected-ref faults go to your human or the operator.

## If the release is bad
A published release that breaks users is fixed forward, never rewritten:
- Stop the spread first: move the channel tag (for example `latest`) back to the last good
  version, or deprecate or yank the bad one where the registry allows it, with a message
  saying what to use instead.
- Ship a fixed version through the normal plan, quickly (`/plan-release`, as a hotfix).
- Tell the users and your human what broke, who is affected and what to do. Record what
  happened in your state, and a coherence rule if it can happen again.

## Close
Record the outcome under "Since the last sweep" in your state file (`/maintainer-intake`).
Tell the experts and your human it's out, with the version and what users must do.
Publishing is not deploying: who adopts the release, and when, is separate.
