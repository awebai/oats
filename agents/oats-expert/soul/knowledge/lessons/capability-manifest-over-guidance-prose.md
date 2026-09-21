---
type: Lesson
title: A capability's own manifest overrides guidance prose about what its settings require
description: Prose from a maintainer can be stricter than the code, so declaring an input blocked on a human decision without first reading the declared settings can stall work on a choice that does not exist.
tags: [verification, capabilities, configuration, collaboration]
timestamp: 2026-09-20
---

When a maintainer hands over example configuration with placeholders like
`REPLACE_WITH_INTENDED_MODEL`, it is easy to read every placeholder as a required
decision. It often is not. Prose is written from memory and tends to describe the
fully specified case, while the manifest states what the code actually enforces.

Before telling anyone that an input needs their decision, open the capability's
declared settings and read them. They say which keys exist, which have defaults,
and which are optional. A field documented as "optional; when omitted the default
applies" is not a decision. A capability that declares one setting does not need
the three the prose implied.

The cost of getting this wrong is asymmetric and worth naming. Inventing a value
that should have been a human's is a real error. But wrongly declaring a choice
"blocked on a human" stalls the work, spends someone's attention on a
non-question, and looks like diligence while producing nothing — so it tends not
to get corrected. Reading the manifest costs one command.

Keep the distinction the manifest cannot make for you: a setting that is merely
required is yours to fill with anything legitimate; a setting that carries real
identity — an account, a team, a credential — stays the human's even when the
schema would happily accept a guess.

Related: [diff diagnostics against invalid input](/lessons/diagnostic-diff-invalid-input.md).
