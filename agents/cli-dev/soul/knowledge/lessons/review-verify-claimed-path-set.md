---
type: Lesson
title: Verify a review content claim against the full reviewed path set
description: A content-unchanged notice that diffs only named paths proves only those paths; re-derive the reviewed path set before ACKing a moved branch tip.
tags: [review, git, verification]
timestamp: 2026-09-05
---

# The situation

While a review was in flight, the branch merged `origin/main` twice. The
coordinator reported that the tip moved but the reviewed content was unchanged,
backing the claim with a diff over four paths:

```bash
git diff 53700cb origin/record-fed-harvest -- packages/record capabilities/oats-okf \
  test/okf-record-harvest.test.mjs docs/souls-and-instances.md
```

That command was empty as claimed. The reviewed three-dot diff, however, covered
fourteen files across six top-level paths. The command omitted `package.json`
and `package-catalog.json`, and `package-catalog.json` had changed between the
two tips.

# Why the ACK still ended cleanly

The omitted change was `oats.aweb` v1.8.0 to v1.9.0 arriving from `origin/main`;
the `oats.okf` pin under review was untouched. The conclusion happened to hold,
but for a reason the supplied command could not distinguish.

# The rule

Re-derive the path set from the review itself, not from the notice:

```bash
git diff --stat origin/main...<branch>
git diff <acked-sha> <new-tip> -- <every path from that stat>
```

Then report the precise result: for example, "identical except `<file>`, which
is main's `<change>` arriving through the merge." That is stronger than
repeating "unchanged" because it states the checked boundary.

A verification command supplied by the party being verified bounds the answer to
what they included. Widen it before relying on it. For merge-preservation checks,
see [prove auto-merge preserved both deltas](/lessons/prove-auto-merge-preserved-both-deltas.md);
for cwd-safe review git commands, see [instance home bare git cwd](/lessons/instance-home-bare-git-cwd.md).
