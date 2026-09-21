---
type: Lesson
title: Compare messages across independent providers to tell a missing message from a discarded one
description: When two unrelated plugins fail with the same templated wording while the host's own determinations read specifically, the host is replacing each plugin's diagnostic rather than lacking one.
tags: [diagnostics, error-reporting, plugin-architecture, verification]
timestamp: 2026-09-20
---

A vague error invites the conclusion that nobody wrote a good message. In a
host-plus-plugin design the likelier cause is that a good message exists and is
being thrown away at the boundary, and the two call for completely different
fixes: write better text in the host, versus stop discarding what the plugin
returned.

The discriminator is cheap. Collect the failures the host determines by itself
and the failures each plugin determines, then compare the wording. If the host's
own determinations are specific while every plugin's failure reads as the same
template with an identifier substituted, the template is a wrapper. Two
independent plugins producing identical phrasing is the strong signal: unrelated
authors do not converge on one sentence by accident.

Then confirm it from the plugin source by naming the exact strings that never
appear in the output. "These specific messages exist and are not being surfaced"
is checkable and hard to argue with; "the errors are unhelpful" is neither.

This matters beyond wording, because a discarded diagnostic hides the class of
the problem. A plugin refusing because its own required declaration is absent
from the source reads, once wrapped, exactly like an operator who forgot a
setting — sending everyone to configure their way out of a defect they cannot
configure around.

Related: [source declarations without payloads](/lessons/source-declaration-requirement-without-payload.md), [diff diagnostics against invalid input](/lessons/diagnostic-diff-invalid-input.md).
