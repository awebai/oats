---
type: Lesson
title: A checkout-mode instance reads its soul through the work tree, so a stale checkout serves stale knowledge
description: When the soul lives in the repository, a behind-by-N shared checkout silently supplies an old knowledge bundle; nothing in the bundle signals staleness, so verify the tree against the remote before trusting what you read.
tags: [orientation, knowledge, git, checkout-mode]
timestamp: 2026-09-19
---

# The failure

An instance whose `soul/` link resolves into the repository work tree reads
whatever that tree currently has. In `checkout` work mode the tree is shared and
nobody owns keeping it current, so it can sit many commits behind the remote.
The instance then follows its session protocol correctly — index first, follow
the relevant links — and gets a coherent, well-formed, weeks-old picture.

**Nothing in the bundle reports this.** Every concept parses, the validator
passes, and the frontmatter `timestamp` of a stale file is indistinguishable
from the timestamp of a file that simply has not needed changing. A stewardship
concept is the worst case: its whole job is to be current, and an old copy of it
reads as a confident statement about the present.

The gap compounds when the canonical soul on the remote HAS been updated in the
meantime by other instances — the freshest knowledge is exactly the knowledge
the stale tree cannot show.

# What to do instead

At the start of any session whose soul is repository-resident, establish the
tree's position before reading the bundle for content:

```bash
git fetch origin                         # read-only: updates remote-tracking refs only
git rev-list --count HEAD..origin/main   # behind
git rev-list --count origin/main..HEAD   # ahead
```

Non-zero behind means the bundle under `soul/` is not the canonical one. Read
the canonical version directly without touching the tree:

```bash
git show origin/main:<path-to>/soul/knowledge/stewardship/repo-state.md
```

Then say so in the orientation report. In a **shared** checkout, do not
fast-forward to fix it — the tree belongs to the human and possibly other
agents, and a pull is a change to their working state, not a private correction.
Report the gap and let the owner decide.

# Why the cheap check is worth it

`git fetch` is the one git operation that changes no branch, no index and no
file, so it is safe even under a strict no-destructive-git rule. It converts an
invisible correctness problem — reasoning from an old world and reporting it as
the present — into a visible, one-line fact.
