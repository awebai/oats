---
name: pr-review
description: "Use when assigned to review an OATS pull request, verify fixes, assess merge readiness, or reconcile a stale review handoff or HOLD/GO instruction."
---

# Review the exact change, not the role's presumed authority

Review is not permission to merge, push, change another branch or publish. Establish the assigned action and repository governance first. Read `references/reviewed-delivery.md` whenever a head moved, a freeze applies, or a verdict could trigger a mutation.

## Four gates

1. **Direction.** Consult the relevant external knowledge index and accepted decisions. Compare the PR's promised outcome with its full merge range. Ask whether the change belongs in kernel, capability, skill, docs or Desktop. A correctness finding does not authorize a new product surface.
2. **Correctness.** Pin base and head SHAs. Read the full diff and affected consumers, not only the newest fix. Use an authorized isolated exact-commit review tree; never switch the shared checkout. Install locked test dependencies there under the repository's current instructions. Use repository fixtures, never copy the deployment's installed capability store to make tests pass.
3. **Security.** Check data-to-execution boundaries, artifact containment and provenance, per-capability executable trust, exact instance/host identity, user-content rendering, and preservation of retry authority. Declared required setup must not silently disappear when untrusted.
4. **Mergeability.** Recheck head/base/check-run identity, conflicts and all pending author/reviewer edits. Require docs, migrations and release impact to match the reviewed scope. Have the author resolve branch conflicts unless separately assigned.

## Verification and verdict

From the isolated review tree, use the current package scripts. The framework gates are `npm test`, `npm run check`, `npm run check:pi`, `npm run validate`, and `npm run pack:check`; release-impact changes also need the published/installed-consumer gates owned by the release lane. Read the scripts before running them and record any host/network/native prerequisites not exercised. Never use unbounded bare `node --test` in an instance-bearing tree.

For knowledge changes, validate the whole external base with the selected OKF validator and inspect zero warnings, not just exit status. Then review semantic currentness, acceptance evidence, sole ownership, exclusions and links. A green structure check does not prove learning.

Return a verdict bound to immutable SHAs: APPROVE, RETURN with prioritized findings, or ESCALATE. Include reproducible file/line evidence, exact tests, limits and release impact. Record operational status in instance/task state, not a universal KB ledger. Only missing generalized rationale is a knowledge candidate.

If explicitly authorized to merge, use the repository's permitted strategy and an expected-head guard, then observe the remote result. A comment cannot satisfy a protected approval requirement. Report permission failures; do not bypass account or branch rules. Branch cleanup is separate authorization and must not alter another instance's worktree.
