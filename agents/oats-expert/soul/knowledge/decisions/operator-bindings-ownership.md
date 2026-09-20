---
type: Decision
title: Operator bindings are a flat map with declared ownership; providers ignore keys they do not own
status: accepted
description: `operator.bindings` stays one flat JSON-pointer map, but every provider consumes only the keys it owns and ignores the rest; providers declare their owned operator keys in the manifest (`binding.keys`) so the kernel can attribute unknown keys to the right slot and refuse truly unowned keys by name. Adopted after an independent operator hit a deadlock — messaging required `wider`, knowledge refused it as a malformed store locator.
tags: [kernel, providers, operator-bindings, binding-wire, second-operator, contract]
timestamp: 2026-09-21
---

Decided 2026-09-21 by the lead from the second-operator gate on 0.24.3 with
imports at 906b1558; the human is informed through the program board because
it fixes a contract rule and adds a manifest field.

# Context

The kernel forwards the operator's whole `bindings` map to every selected
provider's normalize/bind phase. Nothing said who owns which key. OKF 2.1.1
validated **every** entry as a store locator and mapped any non-`stores.`
name into `/bindings/knowledge/<name>`; aweb read `responsibleHuman`,
`privateTeam`, `wider` from the same object. With two providers selected,
the operator could not satisfy both: supplying `wider: []` (required by
messaging) made knowledge `invalid-binding`; omitting it left messaging
`needs-configuration`. No resolution could publish regardless of the
operator's identity, and the error landed on the *innocent* slot.

# Decision

1. **Ownership, not nesting.** `operator.bindings` remains one flat map
   (recorded resolutions, fixtures and aweb 1.11.0's reader keep working).
   A provider MUST consume only the keys it owns and MUST ignore every
   other key. Validating a foreign key is a provider defect.
2. **Declared owned keys.** A provider manifest lists its owned operator
   keys under `binding.keys` (exact key names or `prefix.` patterns such as
   `stores.`). Providers without the field are treated as owning only what
   they consume; the kernel cannot filter for them.
3. **Kernel uses the declaration** when present: forwards each provider only
   its owned keys (defense in depth), attributes a rejected key to the slot
   whose provider owns it, and reports a key owned by **no** selected
   provider as an operator `invalid-declaration` that names the key — the
   only case where the kernel decides about a binding key itself.
4. **Rollout.** Provider ignore rule: OKF 2.1.2 (owned-bindings filter),
   aweb 1.11.1 (already ignores; declares keys). Kernel filtering and
   attribution: 0.24.4 if it fits the open inspection/reasons PR, else 0.25.

# Consequences

- Two providers with overlapping needs no longer deadlock; a stray key is
  named at the operator's document rather than blamed on another slot.
- Manifest schema gains optional `binding.keys` beside `binding.reasons`.
- The second-operator fixtures gain a mixed-provider request (both
  `stores.oats` and `wider` present) that must resolve knowledge.

# Rejected

- Nesting `operator.bindings.<slot>.*`: breaks every recorded document and
  published reader for a problem ownership solves.
- Kernel-hardcoded key tables per provider: the kernel would encode provider
  semantics; the declaration belongs to the provider.
