---
type: Lesson
title: Public, same-repository, and writable-in-place are three separate knowledge requirements
description: A decision to "keep knowledge where it is" can mean any of three independent things, and conflating them makes an unnecessary migration look mandatory or an available option look impossible.
tags: [knowledge, placement, requirements, architecture]
timestamp: 2026-09-19
---

# The conflation

When someone says knowledge should stay where it is, that can mean:

1. **Public** — anyone may read it.
2. **In the same Git repository** as the code the experts work on.
3. **At the same writable in-soul paths** the current tooling uses.

These are independent. Knowledge can be external to a soul and still public,
still in the same repository, and still Git-hosted on the same service.
"External to the soul" describes *ownership and write path*, not visibility and
not hosting.

Conflating them produces two opposite errors, and both are expensive:

- Treating a placement change as a *privacy* change, so it gets justified or
  refused on grounds that were never at stake.
- Treating "keep it here" as ruling out every new arrangement, when only the
  third requirement actually constrains the layout.

# How to hold it straight

Ask for the three answers separately, and record them separately. The answer
that usually binds is the third, because it is the one the tooling enforces — a
provider version either supports in-place writable co-located knowledge or it
does not, regardless of who may read the files or where they are hosted.

Record the requirement the user actually stated, not the nearest architectural
category. "Keep the existing paths and procedure" is a different instruction
from "keep it public", and a later implementer will act on whichever one was
written down.

This complements [Flexible knowledge and instance expertise](/decisions/flexible-knowledge-and-instance-expertise.md)
and [External knowledge custody](/decisions/external-knowledge-custody.md): both
separate knowledge ownership/write-path choices from publication and hosting.

# Corollary: an accepted option is not a scheduled one

An architecture can *accept* a placement model while no released provider
implements it. Accepted-and-unimplemented is a normal, stable state, not an
oversight to route around. Before telling someone a wait is short, get the
implementing side to say whether the work is assigned and whether there is a
committed date — absent both, describe it as indefinite.
