---
type: Lesson
title: An unscoped shared input namespace reports its collisions against the wrong component
description: When several providers read operator input from one flat object and each validates the whole object, a key belonging to one provider fails another, so correct attribution points confidently at the wrong place.
tags: [diagnostics, configuration, plugin-architecture, api-design]
timestamp: 2026-09-20
---

A single flat map of operator-supplied values, consumed by several independent
providers, only works while every provider ignores the keys it does not own. If
each instead validates the whole map, the key sets must stay disjoint forever,
and nothing in the design enforces that. The first overlap produces a failure
reported against a provider that has nothing to do with the offending key.

This defeats attribution rather than being helped by it. Knowing the failing slot
is normally what tells you where to look; here the slot is reported accurately
and is the wrong place. An investigator who trusts it examines a provider whose
input was perfectly valid.

Two properties make it worth ruling out early. The failure appears only when both
providers are exercised together, so each looks fine in isolation and in any test
that covers one at a time. And it can be a true deadlock: if provider A requires a
key that provider B refuses, no input satisfies both, and the whole composition is
unreachable regardless of what the operator does.

Diagnose it by ablation. Remove one key and see which *other* component's verdict
changes; a component whose result depends on a key it does not own is reading
input that is not its own. Then check the source for whether the namespace has any
per-provider scoping or an ignore rule for foreign keys — if neither exists, the
defect is the namespace, not either provider.

Report it as a design question with the two fixes named — scope the keys per
provider, or require providers to ignore what they do not own — because choosing
between them belongs to the owners, and a report that only describes the symptom
invites a patch to whichever provider happened to complain.

Related: [discarded plugin diagnostics](/lessons/plugin-diagnostic-wrapper-discarded-message.md), [source declarations without payloads](/lessons/source-declaration-requirement-without-payload.md).
