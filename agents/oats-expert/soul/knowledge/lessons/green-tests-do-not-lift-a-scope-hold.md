---
type: Lesson
title: A clean merge, a matching diff and a green suite do not establish that content is permitted to land
description: Mergeability checks answer whether a change applies and works; none of them answers whether a human or process has forbidden integrating it, so a held patch can pass every gate and still be wrong to push.
tags: [integration, review, holds, merge, process]
timestamp: 2026-09-19
---

# What happened

A branch merge landed a four-file change. Every gate passed: the merge was
textually clean, the three-dot diff was small and exactly what was intended,
the affected package was 227/227 and the full suite 2782 pass / 0 fail.

The change was nonetheless under an explicit standing hold — "must never be
integrated" — recorded in five design documents and reaffirmed in successive
delivery-log entries. It reached the shared branch buried inside a long merge
ancestry, where no gate was looking for it.

# Why the gates could not catch it

The standard pre-push questions are *what am I adding*, *is it what was
reviewed*, and *would I lose anything*. They are about **mergeability and
fidelity**. None of them asks the separate question:

> Is this content **permitted** to land?

Permission lives in prose — a handoff document, a decision concept, a scope
boundary — not in the tree, so a diff review cannot surface it. And "is it
what was reviewed" is answerable against one's own intent, which feels like
verification while checking nothing external. Absent an actual ACK, that
question silently becomes a no-op.

A merge makes this worse in a specific way: the patch's own commit is one entry
in a long ancestry list that is mostly noise, and the reviewer's attention is
correctly on the small net diff. The net diff shows *what* changes, never
*whether it was allowed to*.

# The check

Before landing a merge that carries ancestry you did not write:

- Search the project's own prose for holds on what you are landing — the words
  *held*, *hold*, *excluded*, *must not*, *never integrate* — in design docs and
  decision records, not only in the code.
- Check **both ancestry and content**, in that order. An ordinary merge
  preserves the original commit SHA, so `git merge-base --is-ancestor <held>
  <head>` does detect a held commit arriving through a merge — the check works,
  and the reason it is skipped is that nobody thought to name the commit.
  Cherry-picks, rebases and reimplementations are what change identity; there,
  compare patch-ids:

```bash
git merge-base --is-ancestor <held-commit> <head>      # ancestry
git show <held-commit> | git patch-id --stable          # content
git diff <base> <head> -- <paths> | git patch-id --stable
```

  Equal patch-ids mean the same normalized textual delta. That is strong
  evidence, not proof of semantic equivalence, and it will not catch a
  reimplementation that achieves the same effect with different text.
- Treat an instruction to "merge everything" as scoping the *work*, not as
  clearing a hold. The person giving it may not know the hold exists.

# Repairing a breach

The correction is **forward-only**: a bounded corrective commit restoring the
affected paths to their last approved postimages. Not a revert of the whole
merge, not a rewrite, not a restoration of some older parent.

Two things the recorded disposition must state, because neither is implied by
the commit itself. First, the held commit **remains in ancestry** — an ancestry
check still returns true afterwards, so the decision has to authorise continuing
from honestly repaired history rather than pretending the merge never happened.
Second, whether the held change is now permitted on its own merits is a
*separate* question, routed through ordinary review; unblocking is not a reason
to decide it.

Do not lift a hold retrospectively to unblock work its breach created. That
launders a mistake into a policy change, and it decides on the wrong grounds.

# The principle

Green tests establish that a change is safe to *run*. A hold says it is not safe
to *ship yet* — for reasons that are usually about sequencing, review debt or
unproven interactions with things the suite does not exercise. Passing tests is
therefore never an argument for lifting a hold, and offering them as one
mistakes the question.

When a hold has already been breached: do not force-push, rewrite history or
unilaterally revert. The breach is now shared state, and its disposition belongs
to the people who set the hold.
