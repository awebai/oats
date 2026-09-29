---
name: verify-developer-work
description: The expert's verification of work a developer hands back, after it has passed adversarial code review. Checks architecture, coherence, fit with the whole system, simplicity, and glaring bugs; does not redo the line-by-line review. Use when a developer hands back its reviewed local branch, before any PR is opened for it.
---

# Verify developer work

The work has been through an adversarial code review on the developer's local branch:
line-level bugs, security and simplification were that reviewer's job. You review the same
branch, before any PR exists: a PR is opened only after you accept it. Yours is the view the reviewer doesn't have:
does this belong in the system, the way it was built?

## 0. Check the handover is complete
It needs:
- what was done, against the spec's "done when";
- how it was verified (tests run, real runs, with results);
- **the adversarial review's final verdict**, and the rounds it took;
- anything deliberately left out.

If the review didn't happen, or ended without the reviewer being satisfied, send it back:
you don't do the reviewer's job for it.

## 1. Architecture
- Is it the design the spec asked for? If it deviates, is the deviation better, and
  recorded?
- Are the responsibilities in the right places, or did logic leak across a boundary to
  make something easy?
- Are contracts kept? A changed contract must have its consumers handled, in the right
  order.

## 2. Coherence and fit
- Does it follow the system's existing patterns and names, or invent a parallel way?
- Does it duplicate something that exists?
- Will the next change in this area be easier or harder because of it?

## 3. Simplicity
- Is it the simplest solution that meets "done"? Look for layers, options, flags or
  generality nobody asked for.
- Could a piece be deleted with no loss?

## 4. Glaring bugs
- Read the main path and the failure paths once, as a user would hit them. You are
  looking for what's obviously wrong, not auditing every line.
- Check that the tests prove the "done when" items, not just that the code runs.

## Verdict
- **Accept**: then, and only then, the work becomes a PR (`/land-your-prs`).
- Or **return** with numbered reasons, each saying what's wrong and why it
  matters. Keep matters of taste out of a return.
- A return goes to the same developer. Architecture-level returns may need a spec change
  first: make it, then return.
