---
name: plan-release
description: Plan a release before anything is tagged - which PRs are in and why the others are out, patch, minor or major, release notes for each change, the merge order (including PRs that all append to the same notes file), the release-prep PR and its review, and what users must do. Agree it with the peer maintainer. Use before any tag, and when deciding whether a PR waits for the next release.
---

# Plan a release

A release is a promise about exact content. Plan it in writing before anyone tags, so the
merge order, the notes and the version all tell the same story.

## Scope
1. **What's merged since the last release:** `git log <last-tag>..<default-branch>`,
   grouped by change, each with its PR.
2. **What should still go in:** open PRs that are ready or nearly ready. For each one left
   out, write down why ("waits for the contract decision", "not reviewed").
3. **The version:** your project's versioning policy decides. Without one: patch for fixes
   only, minor for new features and backward-compatible additions, major for anything that
   breaks an existing user. A contract change that breaks someone is never a patch.
4. **What users must do:** migrations, changed settings, a component to upgrade alongside,
   errors they may hit and what each one tells them to do.

## Notes
- Each change carries its own release-notes entry, written in the same PR as the change.
  Behaviour and docs change together.
- Several PRs appending to the **same notes file** conflict with each other. Choose one way
  before merging them:
  - merge in a fixed order and have each author rebase on the previous merge;
  - give each change its own entry file or section that a release step assembles; or
  - leave the notes to the release-prep PR, written by you from the merged PRs.
  Say which in the plan, and keep to it.

## Hotfixes and backports
- **A hotfix** is a patch release for a break in the current version: only the fix and its
  notes, planned like any release but small, and reviewed by your peer like any other.
  It doesn't wait for the planned release, and the rule below that new PRs wait for the
  next release doesn't hold it back.
- **A backport** to an older supported line goes on that line's branch, from the fix
  already merged on the default branch, and gets its own patch version and notes. Which
  lines are supported is your project's decision; record it in your knowledge.

## Order
- Consumers that accept a new shape land before the producers that emit it.
- A PR that others rebase onto goes first; say who rebases after each merge.
- Once the plan is set, new PRs wait for the next release unless you and your peer agree
  otherwise.

## Project-specific steps
Version bumps across companion components, compatibility ranges, pinned dependencies,
generated files: list them once in your project's own release skill or docs, and follow
that list. This skill doesn't know them.

## The release-prep PR
The version bump and the assembled notes are your own small PR: open it, keep it green and
up to date, answer its review, and merge it only once reviewed. It goes through review like
any other, at an exact head: your peer's, or, without a peer, the reviewer you agreed
with your human (`/cross-review-peer`).

## Write the plan down
In your state file (`/maintainer-intake`): the version; PRs in, and those out with their
reasons; the merge order; who reviews the release-prep PR; the gates still to run; what
users must do. Share it with your peer before the first merge of the plan. When it's done,
ship it with `/ship-release`.
