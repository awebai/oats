---
type: Lesson
title: A release that pins a new provider floor does not force that provider on an existing deployment
description: A kernel upgrade and a knowledge-layer migration are separable — the installed capability manifests' declared compatibility, not the release note's pinned provider, decides whether the kernel can move alone.
tags: [upgrade, capabilities, compatibility, deployment]
timestamp: 2026-09-19
---

# The trap

A kernel release note can read as one indivisible step. A cut that says it
"pins provider X 2.1.0, requiring kernel >=0.24.0" invites the reading that
upgrading the kernel means adopting provider 2.1.0 — and if that provider's
major version carries a migration (new storage location, a spawn hook that
refuses the old layout), the whole upgrade then looks gated behind that
migration.

That reading conflates two different facts:

- **What the release pins** is the pairing the release was *qualified with*,
  and the floor is a statement about the provider ("2.1.0 needs a kernel at
  least this new"). It is not an upper bound on the older provider.
- **What an existing deployment runs** is whatever its lock pins, and a bare
  install does not advance an exact lock.

# The check

Read the declared compatibility of every *installed* capability, not only the
release note:

```bash
for m in <deployment>/.agents/capabilities/installed/*/oats.json; do
  python3 -c "import json,sys; d=json.load(open('$m')); print(d.get('version'), d.get('compatibility'))"
done
```

A capability declaring `{"oats": ">=A"}` with **no upper bound** stays valid
across the kernel upgrade. If every installed capability is open-ended, the
kernel can move alone and the provider migration becomes a separate, later,
independently schedulable decision.

Check alongside it:

- the lock's `lockfileVersion` against the kernel's current `LOCKFILE_VERSION`
  (equal means no lock migration),
- any *separately versioned consumer* with its own accepted kernel band — a
  desktop or GUI client typically declares a band like `>=0.22.0 <0.24.0` and
  will **refuse** a kernel above it. That, not the provider floor, is the
  constraint most likely to actually bite.

# Why it matters

The separation turns one blocked all-or-nothing migration into a cheap
reversible step plus a deliberate one. The cheap step delivers the kernel's
accumulated fixes immediately; the deliberate one — relocating accumulated
knowledge — keeps its own schedule, its own backups and its own verification,
instead of being rushed because it was mistaken for part of an upgrade.

Verify the cheap step the normal way: a scaffold-only spawn, an inspection of
the created layout (composition should be byte-identical if no soul or
capability changed), and a clean retirement.

This refines the kernel/provider boundary in [Kernel and providers](/decisions/kernel-and-providers.md):
release qualification and installed capability compatibility are separate facts.
