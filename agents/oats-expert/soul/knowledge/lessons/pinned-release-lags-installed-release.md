---
type: Lesson
title: A pinned release that lags an installed one refuses correctly and reads like a bug — three times in one day
description: Kernel catalog snapshot vs a newer framework tag; provider manifest field vs a kernel validator that predates it; a Pi-profile pinned to one bridge release vs a newer bridge installed globally. Each refusal was fail-closed and right; each cost a diagnosis because the message named the mismatch, not the lag. Design rule — a pin that can lag names its lag; operations rule — every upgrade of one side re-reviews the pins on the other.
tags: [lessons, release, pins, compatibility, drift, catalog, pi-profile, validator]
timestamp: 2026-09-22
---

# The pattern

Within one day of shipping the 0.24.4 wave, three unrelated components
refused with what looked like corruption and was in fact **a pin lagging a
release**:

1. **Kernel catalog snapshot vs framework tag.** The kernel tarball ships
   `package-catalog.json` as of its own tag. `oats.framework` 1.1.3 was cut
   afterwards; onboarding the current editions against the bundled entry
   refused `integrity-drift` (edition package ≠ acquired package). Fixed in
   0.24.5 by reading the catalog from the workspace revision.
2. **Provider manifest field vs kernel validator.** `binding.reasons` declared
   by OKF 2.1.2 / aweb 1.11.1 is rejected at manifest load by every kernel
   ≤0.24.3 (closed `validateBindingInterface`). Fixed by ordering the wave
   kernel-first and flooring the providers on `>=0.24.4`.
3. **Pi-profile pin vs installed bridge.** A deployment's owned `pi-profile`
   capability pins `@awebai/oats-pi` at one release with an exact tree
   digest; the global Pi install had moved to a newer bridge. Every new spawn
   in that deployment rolls back with `E_ARTIFACT: bridge identity/manifest
   differs from reviewed release shape`. Correct — the profile exists to
   refuse an unreviewed bridge — but the operator's first read was "spawn is
   broken".

# Lessons

- **Fail-closed on a lag is right; the message must name the lag.** "X
  differs from Y" sends the reader to look for corruption; "pinned X (r1)
  lags installed/published Y (r2); re-review the pin" sends them to the
  decision. Every pin that can lag a release should surface both revisions
  and the word *lag* (the 0.24.5 onboard refusal now does).
- **Upgrading one side is a review event for the other.** Installing a new
  kernel, bridge or provider release without re-reviewing the pins that
  reference it produces exactly these refusals later, out of context. The
  operations rule: the change that moves a release *lists* the pins that
  reference the old one (catalog snapshot, profile files, edition
  requirements, validator floors) and either moves them in the same change or
  records why not.
- **Pins that are snapshots of a moving list are a design smell.** The
  kernel's bundled catalog is a convenience copy of the reviewed marketplace;
  anything that treats it as authority will lag. Prefer reading the reviewed
  list at the revision the consumer already names (the workspace), and keep
  the snapshot as the fallback for consumers that have no such revision.
- **A profile that pins a release is deployment policy, not framework code.**
  Re-pinning it (choosing which bridge release is trusted) belongs to the
  deployment's human; the framework's job is to make the refusal legible and
  the re-pin procedure obvious.
