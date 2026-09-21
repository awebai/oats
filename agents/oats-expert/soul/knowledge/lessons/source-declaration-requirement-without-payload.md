---
type: Lesson
title: A source that requires a provider but omits the provider's declaration block cannot be configured by anyone
description: When a definition names a required capability yet carries no payload for that capability to normalize, the failure looks like missing operator configuration but no operator input can ever resolve it.
tags: [diagnostics, capabilities, acceptance-testing, source-defects]
timestamp: 2026-09-20
---

Layered configuration makes two very different failures look identical. In one,
the operator has not supplied an input the provider needs. In the other, the
source itself never gave the provider anything to work with, so no operator
input is even consulted. Both surface as "needs configuration", and the second
is commonly misdiagnosed as the first — including by the people who wrote the
source, who will predict a downstream error message that the run never reaches.

The tell is the phase. Providers normalize a declaration before they check
readiness. A failure in normalize means the declaration was absent or malformed;
a failure in check means the declaration was fine and the world is not ready.
When a maintainer predicts a check-phase message and the run stops earlier, stop
adding operator inputs and go read what normalize requires of the source.

Verify by inspecting the published definitions directly rather than the
materialized copy alone, and count: how many of them carry the block the provider
needs? Zero across every definition is not a configuration problem. The same
applies to the container — a workspace-level policy the provider requires can be
missing from the workspace document while every individual definition looks fine,
and that failure appears only on the route that goes through the workspace.

Report it as a source defect with the exact predicate that failed. "No operator
input can resolve this" is a much stronger and more useful statement than "still
needs configuration", and it redirects the fix to the people who can make it.

Related: [diff diagnostics against invalid input](/lessons/diagnostic-diff-invalid-input.md), [read the manifest before declaring a block](/lessons/capability-manifest-over-guidance-prose.md).
