---
type: Playbook
title: Cut a kernel release from one reviewed commit and finish the manifests by hand
description: The tag-driven release workflow publishes npm and the GitHub release but cannot open the version-bump PR against protected main; the coordinator opens that PR.
timestamp: 2026-09-05
---

Candidate: a commit on main whose tree carries the release version in the
root package.json and the release notes under docs/release-notes/. Run the
full kernel suite (`npm test`) and the Desktop suite
(`node --test packages/desktop/test/*.test.mjs`) once, from a detached
worktree at that commit, with OATS_INSTANCE* and PI_AGENT* scrubbed from the
environment. Do not rerun green suites for later docs-only commits.

Tag: `git tag -a vX.Y.Z <commit>` and push the tag. `.github/workflows/release.yml`
runs build-and-test, three Desktop builds, and publish: npm for the kernel
and the Pi bridge (idempotent), the GitHub release with installers and
SHA256SUMS, then a version-bump PR. That last step fails: the workflow bot
cannot open PRs against protected main. Open the PR by hand from a branch
that bumps the Pi and Desktop manifests and both lock files
(`npm version X.Y.Z --no-git-tag-version` in each package), get an ACK, merge.

Verify what was published, not what was attempted: `npm view @awebai/oats
version`, `gh release view vX.Y.Z` for the asset list, and a downloaded
installer's checksum against SHA256SUMS. 0.22.2 and 0.22.3 both ran this way.

When hosted messaging is down, reviews and ACKs can travel as files in a
shared local directory; git and GitHub keep working. Nothing in the lane
depends on the messaging service.
