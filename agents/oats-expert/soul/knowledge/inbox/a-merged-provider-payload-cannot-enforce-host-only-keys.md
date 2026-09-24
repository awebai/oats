---
type: Lesson
title: A merged provider payload cannot enforce host-only keys
description: A spawn hook sees one deep-merged OATS_SETTINGS map with no layer provenance, so a rule like "this key may come only from the host file" must be enforced by the resolver, not the provider.
tags: [oats, capabilities, settings, security]
timestamp: 2026-09-23
---

The kernel builds a capability's `OATS_SETTINGS` by deep-merging workspace base, `byTeam[team]`, the soul's slot payload, the host's `oats-local.yaml` `settings.<cap>` and `spawn --provider` pairs. By the time the hook runs, the origin of each key is gone.

Consequence: a setting that must be host-owned (a path to a credential custody directory, for example) cannot be protected inside the provider. A committed workspace file could carry it and the hook could not tell. The place to refuse it is the resolver, where layers are still separate: declare the key host-only in the manifest and have the kernel reject it in every other layer, the same way the reserved `byTeam` key is rejected today.

Until such enforcement exists, document the rule and fail on unresolvable values; do not guess provenance from the shape of the value.
